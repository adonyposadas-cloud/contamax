-- ═══════════════════════════════════════════════════════════════
--  RAP (Reserva Laboral 4 %) y FOVIIF (vivienda 1.5 % + 1.5 %)
--  Comunicado RAP 12/05/2026 · Decreto 47-2024. Correr en Supabase de CONTAMAX.
--  La app los aplica a planillas que empiezan desde el 2026-10-01.
--
--  OJO con los códigos: la primera versión de este archivo usaba los sufijos 041 y
--  042, que en producción YA estaban ocupados por cuentas de otro uso (610101-041
--  remodelación Yonker, 610101-042 canon IHTT, 610102-041 mantenimiento de vehículos
--  con 67 movimientos). Se usan 044 y 045, libres en las tres secciones. Tienen que
--  coincidir con los códigos de js/rrhh.js (bloque CUENTAS_SECCION, rap_gasto/foviif_gasto).
-- ═══════════════════════════════════════════════════════════════
begin;

-- 0) Freno de mano: si alguno de los códigos ya existe, se aborta todo. Antes se
--    saltaban en silencio y la planilla habría contabilizado contra la cuenta ajena.
do $$
declare ocupados text;
begin
  select string_agg(codigo || ' = ' || nombre, ' · ')
    into ocupados
    from catalogo_cuentas
   where codigo in ('610101-044','610101-045','610102-044','610102-045',
                    '610103-044','610103-045','210303-003','210303-004');
  if ocupados is not null then
    raise exception 'Estos codigos ya estan en uso, no se crea nada: %', ocupados;
  end if;
end $$;

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

-- 3) Cuentas contables
--    Gasto por sección, junto a sus sueldos: GO 610101, GV 610102, GA 610103
--    Por pagar, junto al IHSS: 210303
with nuevas (codigo, padre, nombre) as (values
  ('610101-044', '610101', 'GO - APORTACION RAP RESERVA LABORAL'),
  ('610101-045', '610101', 'GO - APORTACION FOVIIF PATRONAL'),
  ('610102-044', '610102', 'GV - APORTACION RAP RESERVA LABORAL'),
  ('610102-045', '610102', 'GV - APORTACION FOVIIF PATRONAL'),
  ('610103-044', '610103', 'GA - APORTACION RAP RESERVA LABORAL'),
  ('610103-045', '610103', 'GA - APORTACION FOVIIF PATRONAL'),
  ('210303-003', '210303', 'RAP RESERVA LABORAL POR PAGAR'),
  ('210303-004', '210303', 'FOVIIF POR PAGAR (PATRONAL Y LABORAL)')
)
insert into catalogo_cuentas (codigo, nombre, tipo, naturaleza, nivel, cuenta_padre, es_detalle, es_cuenta_puente, activa)
select n.codigo, n.nombre, p.tipo, p.naturaleza, coalesce(p.nivel, 4) + 1, p.id, true, false, true
  from nuevas n
  join catalogo_cuentas p on p.codigo = n.padre;

-- Las 8 tienen que haberse creado; si un padre faltara, esto aborta la transacción.
do $$
declare n int;
begin
  select count(*) into n from catalogo_cuentas
   where codigo in ('610101-044','610101-045','610102-044','610102-045',
                    '610103-044','610103-045','210303-003','210303-004');
  if n <> 8 then
    raise exception 'Se esperaban 8 cuentas creadas y hay %. Revisar que existan los padres 610101, 610102, 610103 y 210303.', n;
  end if;
end $$;

commit;

-- Verificación
select codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa
  from catalogo_cuentas
 where codigo in ('610101-044','610101-045','610102-044','610102-045',
                  '610103-044','610103-045','210303-003','210303-004')
 order by codigo;
