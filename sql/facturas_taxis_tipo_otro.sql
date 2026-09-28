-- ═══════════════════════════════════════════════════════════════
--  FACTURAS TAXIS · permitir tipo_unidad = 'OTRO'
--  Correr en Supabase de CONTAMAX. No necesita cambio de frontend.
--
--  Por qué: cuando una línea del Excel no trae prefijo de unidad (T_, TAXI_,
--  VIP_, VIN_), el importador la guarda como gasto sin unidad con
--  tipo_unidad = 'OTRO' y la pantalla la muestra como "S/A". Pero el check de
--  la tabla solo aceptaba TAXI, VIP, VIN y YONKER, así que el insert fallaba y
--  se caía la partida del día COMPLETO.
--
--  Pasó con el archivo del 21-09-2026: la línea "HYSTER YONKER_ACEITE DE
--  TRASNSMISION, LIQUIDO DE FRENSO" (22-sep) hizo fallar ese día entero.
--  Ese camino del importador nunca habia funcionado.
--
--  'YONKER' se conserva en la lista aunque hoy el código no lo genere: hay
--  frontend viejo en caché de los usuarios y no cuesta nada dejarlo.
-- ═══════════════════════════════════════════════════════════════
begin;

-- 0) Freno: que no haya filas que la nueva lista dejaría fuera.
do $$
declare v_malas text;
begin
  select string_agg(distinct coalesce(tipo_unidad, '(nulo)'), ', ')
    into v_malas
    from facturas_taxis
   where tipo_unidad is null
      or tipo_unidad <> all (array['TAXI', 'VIP', 'VIN', 'YONKER', 'OTRO']);
  if v_malas is not null then
    raise exception 'Hay filas con tipo_unidad fuera de la lista nueva: %. Revisar antes de seguir.', v_malas;
  end if;
end $$;

-- 1) La lista con 'OTRO' incluido
alter table facturas_taxis drop constraint if exists facturas_taxis_tipo_unidad_check;
alter table facturas_taxis add constraint facturas_taxis_tipo_unidad_check
  check (tipo_unidad = any (array['TAXI'::text, 'VIP'::text, 'VIN'::text, 'YONKER'::text, 'OTRO'::text]));

commit;

-- Verificación: la definición nueva del check.
select conname, pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'public.facturas_taxis'::regclass
   and conname = 'facturas_taxis_tipo_unidad_check';
