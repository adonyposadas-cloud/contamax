-- ¿Qué permisos tiene hoy service_role sobre las tablas de Yonker?
--
-- El 3-nov-2026 el RPA de reportes murió al inyectar las ventas de Yonker:
--
--   Supabase GET yonker_unidades → 403 {"code":"42501",
--     "message":"permission denied for table yonker_unidades"}
--
-- El 42501 es permiso de tabla, no RLS: la llave de servicio sí pasa el RLS,
-- pero si nunca se le dio GRANT sobre la tabla, PostgREST corta antes. Las
-- tablas del taller (productos_vendidos, estados_fisicos) sí funcionan, así
-- que el GRANT se quedó sin hacer solo en las de Yonker.
--
-- Esto no cambia nada: solo dice qué hay. Corré esto PRIMERO y después
-- grants_yonker_service_role.sql.
SELECT
  t.table_name                                        AS tabla,
  COALESCE(string_agg(DISTINCT g.privilege_type, ', '
           ORDER BY g.privilege_type), '(NINGUNO)')   AS privilegios_service_role,
  c.relrowsecurity                                    AS rls_activo
FROM information_schema.tables t
JOIN pg_class    c ON c.relname = t.table_name
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
LEFT JOIN information_schema.role_table_grants g
       ON g.table_schema = t.table_schema
      AND g.table_name   = t.table_name
      AND g.grantee      = 'service_role'
WHERE t.table_schema = 'public'
  AND t.table_name LIKE 'yonker%'
GROUP BY t.table_name, c.relrowsecurity
ORDER BY t.table_name;

-- Lo que el inyector necesita de cada una (inyectar_contamax.mjs):
--   yonker_unidades → SELECT          (marca, modelo, año y contenedor)
--   yonker_ventas   → SELECT, INSERT  (SELECT para no duplicar, INSERT para meter)
