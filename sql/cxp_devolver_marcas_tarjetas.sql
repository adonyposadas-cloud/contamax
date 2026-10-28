-- ═══════════════════════════════════════════════════════════════
--  Devolver las marcas de pago a los cargos de tarjeta
--  Correr en Supabase de CONTAMAX, paso por paso, leyendo cada guardia.
--
--  Cada bloque aborta solo si no encuentra exactamente lo que espera, así que
--  si algo cambió desde que se analizó, no toca nada.
--
--  DE DÓNDE SALE ESTO
--  La pantalla de Cuentas por Pagar pedía L.246,158.91 más de lo que las
--  cuentas de tarjeta debían. La diferencia, en aritmética limpia, es
--  "lo debitado menos los cargos marcados como pagados", y se repartía así:
--
--    partida 22 (cargos del sistema anterior) ......... 160,837.02  [corregida]
--    partida 4344 (compra con el signo invertido) ........ 4,561.61  [corregida]
--    partida 5679 (cargos con el signo invertido) ........ 2,177.05  [corregida]
--    línea de la 840 que perdió el enlace ................ 6,639.98  ← paso 1
--    cargos pagados que nunca se marcaron ............... ~54,633.79 ← paso 2
--    sin identificar todavía ............................ ~21,642.54
--
--  El paso 2 solo incluye los cuatro pagos donde la combinación de cargos que
--  explica el hueco es ÚNICA: no hay otra forma de llegar a ese monto con los
--  cargos pendientes de esas cuentas anteriores a la fecha del pago. Dos de
--  los cuatro se confirman además por el conteo de movimientos que el propio
--  asiento declara en su descripción.
-- ═══════════════════════════════════════════════════════════════


-- ── PASO 1 · Devolverle el enlace a la línea huérfana de la partida 840 ──
-- Está marcada pagada pero sin número de partida de pago: es el rastro del
-- editor viejo, que al guardar una partida borraba sus líneas y las volvía a
-- insertar con id nuevo, perdiendo los flags. No hay plata de por medio, solo
-- el enlace. El hueco de la 840 es exactamente su monto.

-- Mirar primero qué se va a tocar. Debe salir UNA fila, de L.6,639.98.
select l.id, p.numero_partida as partida_del_cargo, p.fecha_partida,
       l.cuenta_codigo, l.descripcion, l.monto, l.pagado, l.pagado_at
  from lineas_partida l
  join partidas_contables p on p.id = l.partida_id
 where l.cuenta_codigo between '210701-002' and '210701-008'
   and l.tipo = 'credito' and l.pagado = true
   and l.pagado_partida_num is null
   and p.estado = 'aprobada';

do $$
declare v_id uuid; v_monto numeric; v_n int;
begin
  select count(*) into v_n
    from lineas_partida l join partidas_contables p on p.id = l.partida_id
   where l.cuenta_codigo between '210701-002' and '210701-008'
     and l.tipo = 'credito' and l.pagado = true
     and l.pagado_partida_num is null and p.estado = 'aprobada';
  if v_n <> 1 then
    raise exception 'Se esperaba 1 línea huérfana y hay %. No se toca nada.', v_n;
  end if;

  select l.id, l.monto into v_id, v_monto
    from lineas_partida l join partidas_contables p on p.id = l.partida_id
   where l.cuenta_codigo between '210701-002' and '210701-008'
     and l.tipo = 'credito' and l.pagado = true
     and l.pagado_partida_num is null and p.estado = 'aprobada';
  if round(v_monto, 2) <> 6639.98 then
    raise exception 'La línea huérfana es de L.% y se esperaba L.6,639.98.', v_monto;
  end if;

  update lineas_partida set pagado_partida_num = '840' where id = v_id;
  raise notice 'Línea % enlazada al pago 840.', v_id;
end $$;


-- ── PASO 2 · Marcar los cargos que se pagaron y nunca se marcaron ──
-- CORRER SOLO DESPUÉS DE CONFIRMAR CONTRA EL ESTADO DE CUENTA.
-- Cada bloque es independiente: se puede correr uno y dejar los otros.

-- 2.1 · Pago 2033 del 11/07 · hueco L.32,547.40
-- El asiento dice "71 MOVIMIENTOS" y solo 68 cargos quedaron enlazados.
-- Faltan 3, y hay exactamente 3 cargos pendientes que suman el hueco.
do $$
declare v_ids uuid[]; v_sum numeric;
begin
  select array_agg(l.id), sum(l.monto) into v_ids, v_sum
    from lineas_partida l join partidas_contables p on p.id = l.partida_id
   where l.tipo = 'credito' and l.pagado = false and l.cuenta_codigo = '210701-002'
     and p.estado = 'aprobada'
     and (p.numero_partida::text, round(l.monto, 2)) in
         (('548', 953.99), ('1851', 31436.87), ('1851', 156.54));
  if coalesce(array_length(v_ids, 1), 0) <> 3 or round(v_sum, 2) <> 32547.40 then
    raise exception 'Pago 2033: se esperaban 3 cargos por L.32,547.40; hay % por L.%',
      coalesce(array_length(v_ids, 1), 0), coalesce(v_sum, 0);
  end if;
  update lineas_partida
     set pagado = true, pagado_at = now(), pagado_partida_num = '2033'
   where id = any(v_ids);
  raise notice 'Pago 2033: 3 cargos marcados.';
end $$;

-- 2.2 · Pago 3646 del 12/08 · hueco L.13,059.80
-- Un solo cargo pendiente tiene ese monto exacto: el seguro MAPFRE del 23/07.
do $$
declare v_ids uuid[]; v_sum numeric;
begin
  select array_agg(l.id), sum(l.monto) into v_ids, v_sum
    from lineas_partida l join partidas_contables p on p.id = l.partida_id
   where l.tipo = 'credito' and l.pagado = false and l.cuenta_codigo = '210701-002'
     and p.estado = 'aprobada'
     and (p.numero_partida::text, round(l.monto, 2)) in (('2692', 13059.80));
  if coalesce(array_length(v_ids, 1), 0) <> 1 or round(v_sum, 2) <> 13059.80 then
    raise exception 'Pago 3646: se esperaba 1 cargo por L.13,059.80; hay % por L.%',
      coalesce(array_length(v_ids, 1), 0), coalesce(v_sum, 0);
  end if;
  update lineas_partida
     set pagado = true, pagado_at = now(), pagado_partida_num = '3646'
   where id = any(v_ids);
  raise notice 'Pago 3646: 1 cargo marcado.';
end $$;

-- 2.3 · Pago 4342 del 25/08 · hueco L.5,831.59
-- El asiento dice "18 MOVIMIENTOS" y solo 14 quedaron enlazados. Faltan 4, y
-- hay exactamente 4 cargos pendientes que suman el hueco.
do $$
declare v_ids uuid[]; v_sum numeric;
begin
  select array_agg(l.id), sum(l.monto) into v_ids, v_sum
    from lineas_partida l join partidas_contables p on p.id = l.partida_id
   where l.tipo = 'credito' and l.pagado = false and l.cuenta_codigo = '210701-002'
     and p.estado = 'aprobada'
     and (p.numero_partida::text, round(l.monto, 2)) in
         (('4337', 840.94), ('4337', 309.64), ('4341', 112.43), ('4341', 4568.58));
  if coalesce(array_length(v_ids, 1), 0) <> 4 or round(v_sum, 2) <> 5831.59 then
    raise exception 'Pago 4342: se esperaban 4 cargos por L.5,831.59; hay % por L.%',
      coalesce(array_length(v_ids, 1), 0), coalesce(v_sum, 0);
  end if;
  update lineas_partida
     set pagado = true, pagado_at = now(), pagado_partida_num = '4342'
   where id = any(v_ids);
  raise notice 'Pago 4342: 4 cargos marcados.';
end $$;

-- 2.4 · Pago 4390 del 26/08 · hueco L.3,195.00
-- Cinco cargos chicos, de dos cuentas. Única combinación posible, pero este
-- NO tiene conteo de movimientos que lo confirme: revisalo con más cuidado.
do $$
declare v_ids uuid[]; v_sum numeric;
begin
  select array_agg(l.id), sum(l.monto) into v_ids, v_sum
    from lineas_partida l join partidas_contables p on p.id = l.partida_id
   where l.tipo = 'credito' and l.pagado = false
     and p.estado = 'aprobada'
     and (p.numero_partida::text, l.cuenta_codigo, round(l.monto, 2)) in
         (('1807', '210701-002', 1168.48),
          ('2520', '210701-002', 205.00),
          ('3832', '210701-002', 1303.73),
          ('4165', '210701-002', 10.74),
          ('672',  '210701-006', 507.05));
  if coalesce(array_length(v_ids, 1), 0) <> 5 or round(v_sum, 2) <> 3195.00 then
    raise exception 'Pago 4390: se esperaban 5 cargos por L.3,195.00; hay % por L.%',
      coalesce(array_length(v_ids, 1), 0), coalesce(v_sum, 0);
  end if;
  update lineas_partida
     set pagado = true, pagado_at = now(), pagado_partida_num = '4390'
   where id = any(v_ids);
  raise notice 'Pago 4390: 5 cargos marcados.';
end $$;


-- ── VERIFICACIÓN · volver a comparar saldo contra lo que la pantalla pide ──
select l.cuenta_codigo, l.cuenta_nombre,
       sum(case when l.tipo = 'credito' then l.monto else -l.monto end) as saldo_real,
       sum(case when l.tipo = 'credito' and l.pagado = false then l.monto else 0 end) as marcados_pendientes,
       sum(case when l.tipo = 'credito' and l.pagado = false then l.monto else 0 end)
       - sum(case when l.tipo = 'credito' then l.monto else -l.monto end) as descuadre
  from lineas_partida l
  join partidas_contables p on p.id = l.partida_id
 where l.cuenta_codigo between '210701-002' and '210701-008'
   and p.estado = 'aprobada'
 group by 1, 2 order by 1;
