-- ═══════════════════════════════════════════════════════════════
--  Libro de ventas: guardar el descuento de cada factura
--  Correr en Supabase de CONTAMAX → SQL Editor.
--
--  El reporte de ventas de Alpha trae la columna "Descuento" por factura. Desde
--  ahora el importador la guarda y el Cierre diario la muestra (ventas brutas sin
--  ISV = total − ISV + descuento). Las ventas ya cargadas quedan en 0.
--  Sin "not null": una inserción que no lo mande queda en null y se lee como 0.
-- ═══════════════════════════════════════════════════════════════
alter table public.libro_ventas add column if not exists descuento numeric(14,2) default 0;
