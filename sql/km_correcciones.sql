-- ═══════════════════════════════════════════════════════════════
--  Corrección manual del KM diario de taxis (saltos del GPS).
--  Correr en Supabase de CONTAMAX → SQL Editor.
--
--  · La corrección vive en su propia tabla, con el km original del GPS, el motivo,
--    quién y cuándo. No se toca tx_km_importar ni tx_km_listar.
--  · Un disparador en km_diarios_taxis aplica la corrección en cada INSERT/UPDATE de
--    ese día y esa unidad: si se vuelve a subir el Excel del GPS, el km corregido se
--    mantiene (y el km nuevo del GPS queda guardado como km_gps).
--  · Solo Administración (super_admin / admin) corrige o quita una corrección.
-- ═══════════════════════════════════════════════════════════════
begin;

create table if not exists public.km_correcciones (
  fecha             date not null,
  unidad            text not null,             -- sin ceros a la izquierda ("0398" → "398")
  km                numeric(12,3) not null,    -- el km correcto
  km_gps            numeric(12,3),             -- lo que reportó el GPS (el último importado)
  motivo            text not null,
  corregido_por     uuid,
  corregido_nombre  text,
  corregido_at      timestamptz not null default now(),
  primary key (fecha, unidad)
);
alter table public.km_correcciones enable row level security;
-- sin políticas: se lee y escribe solo por las funciones de abajo

-- Aplica la corrección a cualquier fila de km de ese día/unidad (venga de donde venga)
create or replace function public._km_aplicar_correccion() returns trigger
language plpgsql security definer set search_path = public as $$
declare c km_correcciones;
begin
  select * into c from km_correcciones
   where fecha = new.fecha and unidad = ltrim(new.unidad::text, '0');
  if found then
    if new.km_recorridos is distinct from c.km then
      update km_correcciones set km_gps = new.km_recorridos
       where fecha = c.fecha and unidad = c.unidad;    -- guarda lo último que dijo el GPS
    end if;
    new.km_recorridos := c.km;
  end if;
  return new;
end $$;

drop trigger if exists trg_km_aplicar_correccion on public.km_diarios_taxis;
create trigger trg_km_aplicar_correccion
  before insert or update on public.km_diarios_taxis
  for each row execute function public._km_aplicar_correccion();

create or replace function public._km_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where id = auth.uid() and rol in ('super_admin', 'admin'));
$$;

-- Corregir (o volver a corregir) el km de una unidad en un día
create or replace function public.tx_km_corregir(p_fecha date, p_unidad text, p_km numeric, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_u text := ltrim(trim(p_unidad), '0'); v_gps numeric; v_nombre text; n int;
begin
  if not _km_es_admin() then return jsonb_build_object('ok', false, 'error', 'Solo Administración puede corregir el km'); end if;
  if p_km is null or p_km < 0 then return jsonb_build_object('ok', false, 'error', 'Km inválido'); end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then return jsonb_build_object('ok', false, 'error', 'Escribí el motivo de la corrección'); end if;

  -- km original: si ya había corrección se conserva el del GPS; si no, el que está ahora
  select km_gps into v_gps from km_correcciones where fecha = p_fecha and unidad = v_u;
  if v_gps is null then
    select max(km_recorridos) into v_gps from km_diarios_taxis
     where fecha = p_fecha and ltrim(unidad::text, '0') = v_u;
  end if;
  if v_gps is null then return jsonb_build_object('ok', false, 'error', 'No hay km del GPS para esa unidad y fecha'); end if;

  select nombre into v_nombre from usuarios where id = auth.uid();
  insert into km_correcciones (fecha, unidad, km, km_gps, motivo, corregido_por, corregido_nombre, corregido_at)
  values (p_fecha, v_u, p_km, v_gps, trim(p_motivo), auth.uid(), v_nombre, now())
  on conflict (fecha, unidad) do update set
    km = excluded.km, motivo = excluded.motivo, corregido_por = excluded.corregido_por,
    corregido_nombre = excluded.corregido_nombre, corregido_at = now();

  update km_diarios_taxis set km_recorridos = p_km      -- el disparador deja el km corregido
   where fecha = p_fecha and ltrim(unidad::text, '0') = v_u;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'km_gps', v_gps, 'filas', n);
end $$;

-- Quitar la corrección: vuelve al km del GPS
create or replace function public.tx_km_quitar_correccion(p_fecha date, p_unidad text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_u text := ltrim(trim(p_unidad), '0'); v_gps numeric;
begin
  if not _km_es_admin() then return jsonb_build_object('ok', false, 'error', 'Solo Administración puede quitar la corrección'); end if;
  delete from km_correcciones where fecha = p_fecha and unidad = v_u returning km_gps into v_gps;
  if v_gps is null then return jsonb_build_object('ok', false, 'error', 'Esa unidad no tiene corrección ese día'); end if;
  update km_diarios_taxis set km_recorridos = v_gps
   where fecha = p_fecha and ltrim(unidad::text, '0') = v_u;
  return jsonb_build_object('ok', true, 'km_gps', v_gps);
end $$;

-- Correcciones de un día (para mostrarlas en la pestaña KM recorridos)
create or replace function public.tx_km_correcciones(p_fecha date)
returns setof public.km_correcciones language sql stable security definer set search_path = public as $$
  select * from km_correcciones where fecha = p_fecha;
$$;

revoke all on function public._km_aplicar_correccion() from public, anon, authenticated;
revoke all on function public._km_es_admin() from public, anon;
revoke all on function public.tx_km_corregir(date, text, numeric, text) from public, anon;
revoke all on function public.tx_km_quitar_correccion(date, text) from public, anon;
revoke all on function public.tx_km_correcciones(date) from public, anon;
grant execute on function public._km_es_admin() to authenticated;
grant execute on function public.tx_km_corregir(date, text, numeric, text) to authenticated;
grant execute on function public.tx_km_quitar_correccion(date, text) to authenticated;
grant execute on function public.tx_km_correcciones(date) to authenticated;

commit;
