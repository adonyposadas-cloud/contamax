-- ¿Qué quedó en productos_vendidos del 2 y 3 de noviembre de 2026?
--
-- El 4-nov-2026 el RPA de reportes por fin inyectó sin error, después de
-- arreglar dos cosas: el GRANT que le faltaba a service_role sobre las tablas
-- de Yonker, y el on_conflict=linea_hash que el inyector nunca mandaba. Ese
-- segundo bug importa para esta consulta: los lotes van de 500 y PostgREST los
-- aplica atómicos, así que durante días UNA línea repetida tumbaba el lote
-- entero y se perdían las nuevas que venían con ella.
--
-- Esto dice si el taller de esos dos días quedó completo. Solo lee.
--
-- Se traen también el 30 y 31 de octubre como punto de comparación: son días
-- que cargaron normal, así que dan una idea de cuántas líneas es "un día
-- normal" y si las del 2 y 3 se ven cortas.
--
-- (Nota: `id` es uuid, no serial, así que no sirve para saber cuándo entró
-- cada fila. Si hace falta esa pista habrá que ver qué columna de fecha de
-- carga tiene la tabla.)
SELECT
  fecha,
  count(*)                                                          AS lineas,
  count(*) FILTER (WHERE es_estado_fisico)                          AS de_estado_fisico,
  count(*) FILTER (WHERE es_estado_fisico AND placa_norm IS NULL)   AS ef_sin_placa,
  count(DISTINCT no_factura)                                        AS facturas
FROM public.productos_vendidos
WHERE fecha BETWEEN DATE '2026-10-30' AND DATE '2026-11-03'
GROUP BY fecha
ORDER BY fecha;

-- Cómo leer el resultado:
--
--   · Falta una fila del 2 o del 3  → ese día no entró nada. Hay que volver a
--     correr el workflow con esa fecha en desde/hasta.
--
--   · ef_sin_placa > 0 → esas líneas de estado físico no traen placa en la
--     descripción y NO van a conciliar solas en la pantalla de Estados
--     Físicos. Hay que ponerles la placa a mano.
