-- Darle a service_role permiso sobre las tablas de Yonker.
--
-- Arregla el fallo del RPA de reportes del 3-nov-2026:
--
--   Supabase GET yonker_unidades → 403 {"code":"42501",
--     "message":"permission denied for table yonker_unidades"}
--
-- service_role se salta el RLS, pero no se salta los GRANT de tabla. A las
-- del taller (productos_vendidos, estados_fisicos) se les dio en su momento;
-- a las de Yonker no, y por eso el bot bajaba bien los Excel y reventaba al
-- momento de subirlos.
--
-- Esto NO abre nada al público: service_role es la llave de servidor que solo
-- usan el RPA y las funciones, nunca el navegador. anon y authenticated
-- quedan exactamente como están.
--
-- Correr después de revisar_grants_yonker.sql.

-- Lo que lee para completar marca/modelo/año/contenedor.
GRANT SELECT ON public.yonker_unidades TO service_role;

-- Lee para no duplicar (fecha + producto) y escribe las líneas nuevas.
GRANT SELECT, INSERT ON public.yonker_ventas TO service_role;

-- Si yonker_ventas tiene id serial, el INSERT también necesita la secuencia.
-- Con IDENTITY no hace falta, pero darlo de más no rompe nada.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Comprobación: las dos filas tienen que quedar con los privilegios de arriba.
SELECT table_name  AS tabla,
       string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type) AS ahora_puede
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee      = 'service_role'
  AND table_name IN ('yonker_unidades', 'yonker_ventas')
GROUP BY table_name
ORDER BY table_name;
