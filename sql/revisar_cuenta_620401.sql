-- ¿Por qué el importador de líneas no encuentra 620401-008?
--
-- El importador normaliza lo que se escribe a 6 dígitos, guion y 3 dígitos:
-- "620401-8" y "620401-08" se vuelven los dos "620401-008" (app.js, _impCodigo).
-- Después compara ese texto contra el código TAL CUAL está guardado, y solo
-- mira cuentas con es_detalle = true:
--
--     cuentasDetalle.find(c => c.codigo === codigo)
--
-- Así que la línea puede fallar por tres razones distintas, y el mensaje de la
-- pantalla las dice todas igual ("no está en el catálogo"):
--
--   1. la cuenta no existe
--   2. existe, pero es_detalle = false (es cuenta madre, no de movimiento)
--   3. existe con el sufijo de 2 dígitos — 620401-08 — y nunca va a casar
--      contra el 620401-008 que arma el importador
--
-- Esta consulta las separa de un vistazo. Mirá la fila de 620401-008: si no
-- aparece, es el caso 1. Si aparece con es_detalle en false, es el caso 2. Si
-- en vez de -008 ves -08, es el caso 3.

select
  codigo,
  nombre,
  es_detalle,
  tipo,
  length(split_part(codigo, '-', 2)) as digitos_del_sufijo
from catalogo_cuentas
where codigo like '6204%'
order by codigo;
