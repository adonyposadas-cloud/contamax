-- ¿Desde cuándo no entran marcaciones del reloj?
--
-- El 16-nov-2026 el puente (reloj-bridge.js, en la CPU Lenovo) avisó dos cosas
-- en la misma vuelta:
--
--   "La marcación más reciente tiene 272 días. Si hoy marcaron, la fecha del
--    reloj está mal."
--   "Lectura dañada (1636 registros imposibles de 9820). No se envió nada;
--    se reintenta en la próxima vuelta."
--
-- 272 días antes del 16-nov-2026 es el 17-feb-2026. Esta consulta dice si la
-- base también se quedó en febrero (el reloj lleva meses sin grabar) o si
-- siguió recibiendo (entonces lo dañado es la lectura de ahora, no el reloj).
--
-- Solo lee.
SELECT
  to_char(fecha, 'YYYY-MM')        AS mes,
  count(*)                         AS marcaciones,
  count(DISTINCT pin)              AS empleados,
  min(fecha)                       AS primera,
  max(fecha)                       AS ultima
FROM public.marcaciones_raw
GROUP BY to_char(fecha, 'YYYY-MM')
ORDER BY mes DESC
LIMIT 15;

-- Cómo leer el resultado:
--
--   · Hay filas de octubre y noviembre con números normales
--       → el reloj SÍ estuvo grabando y mandando. Lo de hoy es una lectura
--         dañada puntual; el puente hizo lo correcto al no mandar nada.
--         Si se repite varias vueltas seguidas, ahí sí hay que ir al reloj.
--
--   · La última fila es de febrero (o nada después)
--       → lleva 9 meses sin entrar una sola marcación. Entonces los 9820
--         registros que ve el puente son los viejos, y el reloj dejó de
--         grabar. Ojo con el número: muchos relojes de estos guardan 10,000
--         marcaciones y 9820 está pegado al tope. Cuando se llena, algunos
--         dejan de grabar en vez de pisar lo viejo, y nadie se entera porque
--         el aparato sigue pitando y mostrando "OK" al empleado.
--
--   · Hay filas hasta cierto mes y después se corta
--       → ese mes es cuando se rompió. Sirve para saber qué pasó ese día
--         (corte de luz, cambio de red, se llenó la memoria).
