-- Usuario de SOLO LECTURA para consultar CONTAMAX desde la terminal.
--
-- SE PUEDE CORRER LAS VECES QUE HAGA FALTA. No falla si el rol ya existe ni si
-- las politicas ya estan: revisa antes de crear cada cosa.
--
-- Historia, para que se entienda el por que de esto:
--   1er intento: termino en ALTER ROLE ... BYPASSRLS, que en los proyectos
--     nuevos de Supabase falla porque 'postgres' ya no es superusuario.
--   2do intento: CREATE ROLE pelado -> 42710 "role already exists", porque el
--     primero si habia creado el rol.
-- De ahi que esta version no asuma nada sobre lo que ya esta hecho.
--
-- Lo que este rol NO puede hacer: INSERT, UPDATE, DELETE, crear ni borrar nada.

-- 1. El rol: se crea solo si falta. Si ya estaba, se le reafirma la clave para
--    que sea con seguridad la misma que va en la variable de entorno.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contamax_lectura') THEN
    ALTER ROLE contamax_lectura WITH LOGIN PASSWORD 'PEGAR_CLAVE_AQUI';
    RAISE NOTICE 'El rol ya existia: se le reafirmo la clave.';
  ELSE
    CREATE ROLE contamax_lectura WITH LOGIN NOINHERIT PASSWORD 'PEGAR_CLAVE_AQUI';
    RAISE NOTICE 'Rol creado.';
  END IF;
END $$;

-- 2. Permisos. Repetirlos no hace nada malo.
GRANT CONNECT ON DATABASE postgres TO contamax_lectura;
GRANT USAGE   ON SCHEMA public     TO contamax_lectura;
GRANT SELECT  ON ALL TABLES IN SCHEMA public TO contamax_lectura;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO contamax_lectura;

-- 3. Sus transacciones arrancan en solo lectura, y las consultas se cortan a
--    los 30 segundos.
ALTER ROLE contamax_lectura SET default_transaction_read_only = on;
ALTER ROLE contamax_lectura SET statement_timeout = '30s';

-- 4. RLS: una politica de SOLO SELECT por cada tabla que lo tenga activo y
--    todavia no la tenga. FOR SELECT es la parte importante: no habilita
--    escritura, y el rol tampoco tiene el permiso para escribir.
DO $$
DECLARE t record; creadas int := 0; ya int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    IF EXISTS (SELECT 1 FROM pg_policies
               WHERE schemaname = 'public' AND tablename = t.relname
                 AND policyname = 'lectura_contamax') THEN
      ya := ya + 1;
    ELSE
      EXECUTE format(
        'CREATE POLICY lectura_contamax ON public.%I FOR SELECT TO contamax_lectura USING (true)',
        t.relname);
      creadas := creadas + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Politicas: % creadas, % ya estaban.', creadas, ya;
END $$;

-- 5. COMO QUEDO. Mandame esta tabla entera, son 5 filas.
SELECT 'puede entrar'          AS dato, (SELECT rolcanlogin::text FROM pg_roles WHERE rolname='contamax_lectura') AS valor
UNION ALL SELECT 'es superusuario',     (SELECT rolsuper::text     FROM pg_roles WHERE rolname='contamax_lectura')
UNION ALL SELECT 'se salta el RLS',     (SELECT rolbypassrls::text FROM pg_roles WHERE rolname='contamax_lectura')
UNION ALL SELECT 'tablas que puede leer',
  (SELECT count(DISTINCT table_name)::text FROM information_schema.role_table_grants
    WHERE table_schema='public' AND grantee='contamax_lectura' AND privilege_type='SELECT')
UNION ALL SELECT 'permisos de ESCRITURA (tiene que ser 0)',
  (SELECT count(*)::text FROM information_schema.role_table_grants
    WHERE table_schema='public' AND grantee='contamax_lectura'
      AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE'));
