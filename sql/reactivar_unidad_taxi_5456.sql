-- Reactivar la unidad de taxi 5456 para poder meterle el vehículo nuevo.
--
-- Correr DESPUÉS de revisar_unidad_taxi_5456.sql y de haber visto qué traía.
--
-- Por qué reactivar en vez de crear otra fila: el detalle de unidad hace
-- .eq('registro', …).maybeSingle() (js/app.js:11233), que falla con dos filas
-- del mismo registro. Y el historial de entregas se enlaza por NÚMERO de
-- unidad, no por el id de la fila, así que una fila nueva tampoco arrancaría
-- en cero. El modelo asume una fila por número de taxi.
--
-- Esto NO pone los datos del vehículo nuevo: solo la vuelve visible. Los datos
-- se cambian desde la pantalla, con el lápiz, como cualquier otra unidad.

UPDATE public.unidades_taxis
SET activo = true
WHERE registro = 5456
  AND activo = false;

-- Comprobación: tiene que decir activo = true y traer los datos VIEJOS, los
-- del vehículo que diste de baja. Eso es lo que vas a pisar desde la pantalla.
SELECT *
FROM public.unidades_taxis
WHERE registro = 5456;

-- Ahora, en CONTAMAX:
--   1. Unidades Taxis → buscar 5456 (ya aparece)
--   2. Lápiz → cambiar placa, marca, año, color, motorista, propietario y lo
--      del financiamiento por los del vehículo NUEVO
--   3. Guardar
--
-- OJO con una cosa que este SQL no arregla: las entregas viejas del 5456 van a
-- seguir saliendo bajo ese número, porque así las enlaza el sistema. Si
-- contablemente el vehículo nuevo tiene que arrancar en cero, eso es otra
-- conversación y no se resuelve acá.
