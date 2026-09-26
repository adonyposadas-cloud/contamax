-- ═══════════════════════════════════════════════════════════════
--  RAP (Reserva Laboral 4 %) y FOVIIF (vivienda 1.5 % + 1.5 %)
--  Comunicado RAP 12/05/2026 · Decreto 47-2024. Correr en Supabase de CONTAMAX.
--  La app los aplica a planillas que empiezan desde el 2026-10-01.
-- ═══════════════════════════════════════════════════════════════
begin;

-- 1) Columnas en el detalle de planilla
alter table detalle_planilla add column if not exists rap_patronal    numeric(14,2) default 0;
alter table detalle_planilla add column if not exists foviif_patronal numeric(14,2) default 0;
alter table detalle_planilla add column if not exists foviif_laboral  numeric(14,2) default 0;

-- 2) Parámetros (editables en RRHH → Config. planilla)
insert into config_planilla (clave, valor, descripcion) values
  ('rap_pct_patronal',    0.04,     'RAP Reserva Laboral: % patronal sobre el salario (4%)'),
  ('rap_techo_mensual',   57896.16, 'RAP: techo de cotización 2026 (3 salarios mínimos)'),
  ('foviif_piso_mensual', 11903.13, 'FOVIIF: piso (techo IHSS-IVM); se aporta sobre el exceso'),
  ('foviif_pct_patronal', 0.015,    'FOVIIF: % patronal sobre el exceso del piso (1.5%)'),
  ('foviif_pct_laboral',  0.015,    'FOVIIF: % del trabajador sobre el exceso del piso (1.5%)')
on conflict (clave) do nothing;

-- 3) Cuentas contables (solo se crean si el código no existe)
--    Gasto por sección, junto a sus sueldos: GO 610101, GV 610102, GA 610103
--    Por pagar, junto al IHSS: 210303
with nuevas (codigo, padre, nombre) as (values
  ('610101-041', '610101', 'GO - APORTACION RAP RESERVA LABORAL'),
  ('610101-042', '610101', 'GO - APORTACION FOVIIF PATRONAL'),
  ('610102-041', '610102', 'GV - APORTACION RAP RESERVA LABORAL'),
  ('610102-042', '610102', 'GV - APORTACION FOVIIF PATRONAL'),
  ('610103-041', '610103', 'GA - APORTACION RAP RESERVA LABORAL'),
  ('610103-042', '610103', 'GA - APORTACION FOVIIF PATRONAL'),
  ('210303-003', '210303', 'RAP RESERVA LABORAL POR PAGAR'),
  ('210303-004', '210303', 'FOVIIF POR PAGAR (PATRONAL Y LABORAL)')
)
insert into catalogo_cuentas (codigo, nombre, tipo, naturaleza, nivel, cuenta_padre, es_detalle, es_cuenta_puente, activa)
select n.codigo, n.nombre, p.tipo, p.naturaleza, coalesce(p.nivel, 4) + 1, p.id, true, false, true
  from nuevas n
  join catalogo_cuentas p on p.codigo = n.padre
 where not exists (select 1 from catalogo_cuentas c where c.codigo = n.codigo);

commit;

-- Verificación: deben salir las 8 cuentas. Si alguna YA EXISTÍA con otro nombre
-- (otro uso), avisar: hay que cambiar su código en js/rrhh.js (bloque RAP/FOVIIF).
select codigo, nombre, tipo, naturaleza, activa
  from catalogo_cuentas
 where codigo in ('610101-041','610101-042','610102-041','610102-042','610103-041','610103-042','210303-003','210303-004')
 order by codigo;
