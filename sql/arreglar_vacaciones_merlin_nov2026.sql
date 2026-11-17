-- Arreglar las vacaciones de Merlin Ivan Garcia, 01 al 15 de noviembre de 2026.
--
-- QUÉ PASÓ
-- Los 15 días se registraron con tipo 'salida_anticipada' (14) y
-- 'falta_justificada' (1). El tratamiento sí quedó en 'vacaciones', pero el
-- tipo manda: para una salida anticipada, asistencia.js calcula la FRACCIÓN de
-- día desde la hora de salida (_diasDePermiso, js/asistencia.js:376). Esa hora
-- está nula y, estando de vacaciones, tampoco marcó el reloj, así que la
-- función devuelve 0. Catorce veces cero.
--
-- Resultado: la planilla 2026-11-Q1 le puso dias_trabajados = 15 y
-- vacaciones = 0.00, y como la rebaja al aprobar solo toca a quien tenga
-- vacaciones > 0, el saldo nunca se iba a mover.
--
-- En octubre salió bien porque ahí se usó 'permiso_dia': 9 días, L 4,114.26 a
-- vacaciones y 6 días trabajados.
--
-- QUÉ HACE ESTO
--   1. Los 12 días hábiles (2 al 7 y 9 al 14) pasan a 'permiso_dia'.
--   2. Los 3 domingos (1, 8 y 15) se dan de baja, igual que en octubre, donde
--      el domingo 25 no se registró. La baja es LÓGICA (eliminado = true), que
--      es lo que hace el botón ✕ de la pantalla: la fila queda como evidencia.
--
-- El neto NO cambia: 12 x 457.14 de vacaciones + 3 x 457.14 de sueldo = 6,857.10,
-- el mismo que ya dice el voucher. Lo que cambia es a qué cuenta va y que el
-- saldo de vacaciones por fin baje.
--
-- DESPUÉS DE CORRER ESTO hay que REGENERAR el borrador de la planilla
-- 2026-11-Q1. Si no, sigue con los números viejos.

-- 1. Los días hábiles: al tipo correcto.
UPDATE public.permisos_empleados
SET tipo = 'permiso_dia'
WHERE empleado_nombre ILIKE '%MERLIN IVAN GARCIA%'
  AND fecha IN ('2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07',
                '2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14')
  AND NOT eliminado;

-- 2. Los domingos: baja lógica, con constancia de por qué.
UPDATE public.permisos_empleados
SET eliminado          = true,
    eliminado_por      = 'ADONY POSADAS',
    eliminado_at       = now(),
    motivo_eliminacion = 'Domingo: las vacaciones se cargan en dias habiles (mismo criterio de octubre)'
WHERE empleado_nombre ILIKE '%MERLIN IVAN GARCIA%'
  AND fecha IN ('2026-11-01','2026-11-08','2026-11-15')
  AND NOT eliminado;

-- 3. Comprobación: tienen que quedar 12 vivos, todos 'permiso_dia' con
--    tratamiento 'vacaciones', y 3 dados de baja.
SELECT
  CASE WHEN eliminado THEN 'dados de baja' ELSE 'vivos' END AS estado,
  tipo,
  coalesce(tratamiento, '(nulo)') AS tratamiento,
  count(*)                        AS dias,
  min(fecha)                      AS desde,
  max(fecha)                      AS hasta
FROM public.permisos_empleados
WHERE empleado_nombre ILIKE '%MERLIN IVAN GARCIA%'
  AND fecha BETWEEN '2026-11-01' AND '2026-11-15'
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2;

-- Lo esperado:
--   vivos          permiso_dia        vacaciones   12   2026-11-02  2026-11-14
--   dados de baja  falta_justificada  vacaciones    1   2026-11-01  2026-11-01
--   dados de baja  salida_anticipada  vacaciones    2   2026-11-08  2026-11-15
--
-- Y al regenerar la planilla 2026-11-Q1, el detalle de Merlin tiene que quedar:
--   dias_trabajados   3
--   vacaciones        5,485.68
--   sueldo_quincenal  1,371.42
--   total_devengado   6,857.10   (el mismo de ahora)
--
-- Al APROBARLA, recién ahí el saldo pasa de -7 a -19 días.
