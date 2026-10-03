-- ═══════════════════════════════════════════════════════════════
--  Cuentas de gasto para COMISIONES a empleados (Taller y Yonker).
--  Correr en Supabase de CONTAMAX.
--
--  Van junto a los sueldos de cada sección, con el mismo sufijo 046 en las tres:
--    GO 610101-046  → mecánicos / operación (taller, desarme yonker)
--    GV 610102-046  → vendedores (repuestos, yonker)
--    GA 610103-046  → administración (si algún administrativo comisiona)
--  La zona (Taller / Yonker) se separa por CENTRO DE COSTO en la línea de la partida,
--  igual que hace la planilla.
-- ═══════════════════════════════════════════════════════════════
begin;

-- 0) Frenos: no crear si el código está ocupado o si ya hay cuentas de comisiones en sueldos
do $$
declare ocupados text; existentes text;
begin
  select string_agg(codigo || ' = ' || nombre, ' · ') into ocupados
    from catalogo_cuentas where codigo in ('610101-046','610102-046','610103-046');
  if ocupados is not null then
    raise exception 'Estos codigos ya estan en uso, no se crea nada: %', ocupados;
  end if;
  select string_agg(codigo || ' = ' || nombre, ' · ') into existentes
    from catalogo_cuentas
   where (codigo like '610101-%' or codigo like '610102-%' or codigo like '610103-%')
     and nombre ilike '%comisi%';
  if existentes is not null then
    raise exception 'Ya existen cuentas de comisiones, usar esas en vez de crear nuevas: %', existentes;
  end if;
end $$;

with nuevas (codigo, padre, nombre) as (values
  ('610101-046', '610101', 'GO - COMISIONES A EMPLEADOS'),
  ('610102-046', '610102', 'GV - COMISIONES SOBRE VENTAS A EMPLEADOS'),
  ('610103-046', '610103', 'GA - COMISIONES A EMPLEADOS')
)
insert into catalogo_cuentas (codigo, nombre, tipo, naturaleza, nivel, cuenta_padre, es_detalle, es_cuenta_puente, activa)
select n.codigo, n.nombre, p.tipo, p.naturaleza, coalesce(p.nivel, 4) + 1, p.id, true, false, true
  from nuevas n
  join catalogo_cuentas p on p.codigo = n.padre;

do $$
declare n int;
begin
  select count(*) into n from catalogo_cuentas where codigo in ('610101-046','610102-046','610103-046');
  if n <> 3 then
    raise exception 'Se esperaban 3 cuentas y hay %. Revisar que existan los padres 610101, 610102 y 610103.', n;
  end if;
end $$;

commit;

select codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa
  from catalogo_cuentas where codigo in ('610101-046','610102-046','610103-046') order by codigo;
