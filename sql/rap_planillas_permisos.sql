-- ═══════════════════════════════════════════════════════════════
--  Permiso de escritura en rap_planillas / rap_planilla_detalle
--
--  Hasta ahora esas dos tablas se llenaban corriendo un SQL en Supabase, o sea
--  con el rol de servicio, que se salta el RLS. Desde que RRHH → "Cargar planilla
--  del RAP" las escribe desde el navegador, la escritura pasa por el RLS del
--  usuario que está con sesión abierta. Si no hay política de insert, el guardado
--  falla con un error de permisos.
--
--  Este archivo NO toca nada que ya exista: solo crea lo que falte. Correlo si al
--  guardar sale un error de permisos (o para dejarlo listo de una vez).
--
--  Quién puede escribir: super_admin y contador, los mismos dos roles que la app
--  exige para abrir el importador. Nadie más, porque el detalle lleva sueldos
--  implícitos (el RL es el 4 % del salario, así que de la fila se deduce cuánto
--  gana la persona).
-- ═══════════════════════════════════════════════════════════════

-- 1) Cómo están hoy. Mirá esto ANTES de seguir.
select c.relname  as tabla,
       c.relrowsecurity as rls_activo,
       coalesce(p.polname, '(sin políticas)') as politica,
       p.polcmd as comando,
       p.polroles::regrole[] as roles
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  left join pg_policy p on p.polrelid = c.oid
 where c.relname in ('rap_planillas', 'rap_planilla_detalle')
 order by c.relname, p.polcmd;

-- 2) Crear lo que falte, sin pisar nada.
begin;

do $$
declare
  t text;
  falta_ins boolean;
  falta_del boolean;
  hechas text := '';
begin
  -- Sin la tabla usuarios no hay a quién preguntarle el rol: mejor abortar que
  -- crear una política que deje pasar a cualquiera.
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'usuarios') then
    raise exception 'No existe public.usuarios; este archivo asume que el rol sale de ahí.';
  end if;

  foreach t in array array['rap_planillas', 'rap_planilla_detalle'] loop
    if not exists (select 1 from information_schema.tables
                    where table_schema = 'public' and table_name = t) then
      raise exception 'No existe public.% ; cargá primero las planillas del RAP.', t;
    end if;

    -- Si el RLS está apagado, las políticas no harían nada y la escritura ya pasa.
    -- Se crean igual, para que queden puestas si algún día se enciende.
    select not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                        where c.relname = t and p.polcmd in ('a', '*'))
      into falta_ins;
    select not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                        where c.relname = t and p.polcmd in ('d', '*'))
      into falta_del;

    if falta_ins then
      execute format($f$
        create policy %I on public.%I for insert to authenticated
        with check (exists (select 1 from usuarios
                             where auth_user_id = auth.uid()
                               and rol in ('super_admin', 'contador')))
      $f$, t || '_insert_rrhh', t);
      hechas := hechas || ' ' || t || ':insert';
    end if;

    if falta_del then
      -- El delete es para poder reemplazar una planilla que el RAP volvió a emitir
      -- corregida. Sin él habría que entrar a Supabase cada vez.
      execute format($f$
        create policy %I on public.%I for delete to authenticated
        using (exists (select 1 from usuarios
                        where auth_user_id = auth.uid()
                          and rol in ('super_admin', 'contador')))
      $f$, t || '_delete_rrhh', t);
      hechas := hechas || ' ' || t || ':delete';
    end if;
  end loop;

  if hechas = '' then
    raise notice 'No se creó nada: las dos tablas ya tenían políticas de insert y de delete.';
  else
    raise notice 'Políticas creadas:%', hechas;
  end if;
end $$;

commit;

-- 3) Cómo quedaron.
select c.relname as tabla, c.relrowsecurity as rls_activo, p.polname as politica, p.polcmd as comando
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  left join pg_policy p on p.polrelid = c.oid
 where c.relname in ('rap_planillas', 'rap_planilla_detalle')
 order by c.relname, p.polcmd;
