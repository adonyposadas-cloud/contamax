-- ¿Por qué no deja crear la unidad de taxi 5456?
--
-- Porque ya existe. "Dar de baja" en CONTAMAX no borra: hace
-- update({ activo: false }) (js/app.js:11154), y la lista de la pantalla filtra
-- .eq('activo', true) (js/app.js:10969), así que la fila queda invisible pero
-- sigue ocupando el registro. Al guardar, la base rechaza el duplicado y la app
-- lo traduce a "Ya existe una unidad con registro #5456".
--
-- SELECT * a propósito: el esquema no está versionado y no conviene adivinar
-- nombres de columnas. Esto solo lee.
SELECT *
FROM public.unidades_taxis
WHERE registro = 5456;

-- Cómo leer el resultado:
--
--   · 1 fila con activo = false  → es lo esperado. Seguir con
--     reactivar_unidad_taxi_5456.sql y después editarla desde la pantalla.
--
--   · 1 fila con activo = true   → entonces el duplicado NO es por registro,
--     sino por otro índice único (la placa, probablemente). Avisame.
--
--   · 0 filas                    → lo mismo: el choque viene de otra columna.
--
--   · 2 o más filas              → problema aparte: el detalle de unidad usa
--     .eq('registro', …).maybeSingle() y se cae con más de una. Avisame antes
--     de tocar nada.
