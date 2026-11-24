-- ═══════════════════════════════════════════════════════════════
--  Panel de timers de Taxis (eWeLink)
--  Correr en Supabase de CONTAMAX → SQL Editor. NO lleva la clave del bot:
--  las funciones del bot la validan con _tx_bot_ok() (ya creada por sql_bot_taxis.sql).
--
--  · tx_timers_estado: foto de cada dispositivo que el bot lee de eWeLink cada 15 min
--    (en línea, timers, modo, fecha de corte). La pantalla "Timers Taxis" la lee.
--  · tx_timer_ordenes: órdenes que se dan desde la pantalla (hoy: ACTIVAR un timer
--    desactivado con la fecha de corte elegida). El bot las ejecuta cuando el
--    dispositivo está en línea y anota el resultado.
-- ═══════════════════════════════════════════════════════════════
begin;

create table if not exists public.tx_timers_estado (
  device_id     text primary key,
  nombre        text not null default '',
  unidad        text,                       -- número sacado del nombre del dispositivo
  online        boolean not null default false,
  timers        jsonb not null default '[]',
  ciclo_at      timestamptz,                -- inicio del timer de ciclo (corte), si tiene
  ciclo_activo  boolean,                    -- null = no tiene timer de ciclo
  n_ciclo       int not null default 0,     -- cuántos timers de ciclo tiene
  modo          text,                       -- 'ciclo' | 'unico' | 'repetir' | 'otro' | 'sin timer' (resumen)
  leido_at      timestamptz not null default now()
);
create index if not exists tx_timers_estado_unidad on public.tx_timers_estado (unidad);
-- v2: cuándo se vio en línea (los GSM se desconectan con el carro apagado: "fuera de línea" ahora
-- no dice nada; lo que importa es si se ha conectado). Se puede correr el archivo otra vez.
alter table public.tx_timers_estado add column if not exists visto_en_linea_at timestamptz;   -- última foto en que estaba en línea
alter table public.tx_timers_estado add column if not exists primera_foto_at   timestamptz default now();
alter table public.tx_timers_estado add column if not exists ewelink_online_at  timestamptz;  -- lo que diga eWeLink, si lo trae
alter table public.tx_timers_estado add column if not exists ewelink_offline_at timestamptz;

create table if not exists public.tx_timer_ordenes (
  id          bigserial primary key,
  device_id   text not null,
  unidad      text,
  accion      text not null check (accion in ('activar')),
  at_nuevo    timestamptz not null,          -- corte con que se activa
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'hecha', 'error', 'cancelada')),
  detalle     text,
  creada_por  uuid,
  creada_nombre text,
  created_at  timestamptz not null default now(),
  hecha_at    timestamptz
);
create index if not exists tx_timer_ordenes_pend on public.tx_timer_ordenes (estado) where estado = 'pendiente';
-- v3: ciclo encendido/apagado elegido en la orden (en minutos, como lo muestra eWeLink: On / Off).
-- Null = se deja el ciclo que ya tiene el timer.
alter table public.tx_timer_ordenes add column if not exists min_on  int check (min_on  between 1 and 1440);
alter table public.tx_timer_ordenes add column if not exists min_off int check (min_off between 1 and 1440);
-- v4: orden de DESACTIVAR (apaga el timer en el dispositivo; no lleva fecha)
alter table public.tx_timer_ordenes alter column at_nuevo drop not null;
alter table public.tx_timer_ordenes drop constraint if exists tx_timer_ordenes_accion_check;
alter table public.tx_timer_ordenes add constraint tx_timer_ordenes_accion_check check (accion in ('activar', 'desactivar'));
-- v5: con qué arranca el ciclo ('on' = encendiendo, como la mayoría; 'off' = apagando). Null = se deja igual.
alter table public.tx_timer_ordenes add column if not exists arranca text check (arranca in ('on', 'off'));

alter table public.tx_timers_estado enable row level security;
alter table public.tx_timer_ordenes enable row level security;
drop policy if exists tx_timers_estado_sel on public.tx_timers_estado;
create policy tx_timers_estado_sel on public.tx_timers_estado for select to authenticated using (true);
drop policy if exists tx_timer_ordenes_sel on public.tx_timer_ordenes;
create policy tx_timer_ordenes_sel on public.tx_timer_ordenes for select to authenticated using (true);
-- sin políticas de escritura: solo por las funciones de abajo

-- ── Bot: guarda la foto de todos los dispositivos (reemplaza la anterior) ──
create or replace function public.tx_bot_snapshot(p_clave text, p_devs jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform _tx_bot_ok(p_clave);
  insert into tx_timers_estado as t (device_id, nombre, unidad, online, timers, ciclo_at, ciclo_activo, n_ciclo, modo, leido_at,
         visto_en_linea_at, primera_foto_at, ewelink_online_at, ewelink_offline_at)
  select d->>'id', coalesce(d->>'name', ''), nullif(d->>'unidad', ''), coalesce((d->>'online')::boolean, false),
         coalesce(d->'timers', '[]'::jsonb), nullif(d->>'ciclo_at', '')::timestamptz,
         case when d ? 'ciclo_activo' and d->>'ciclo_activo' is not null then (d->>'ciclo_activo')::boolean end,
         coalesce((d->>'n_ciclo')::int, 0), d->>'modo', now(),
         case when coalesce((d->>'online')::boolean, false) then now() end, now(),
         nullif(d->>'online_at', '')::timestamptz, nullif(d->>'offline_at', '')::timestamptz
    from jsonb_array_elements(p_devs) d
   where coalesce(d->>'id', '') <> ''
  on conflict (device_id) do update set nombre = excluded.nombre, unidad = excluded.unidad, online = excluded.online,
    timers = excluded.timers, ciclo_at = excluded.ciclo_at, ciclo_activo = excluded.ciclo_activo,
    n_ciclo = excluded.n_ciclo, modo = excluded.modo, leido_at = excluded.leido_at,
    visto_en_linea_at = case when excluded.online then now() else t.visto_en_linea_at end,
    primera_foto_at = coalesce(t.primera_foto_at, now()),
    ewelink_online_at = coalesce(excluded.ewelink_online_at, t.ewelink_online_at),
    ewelink_offline_at = coalesce(excluded.ewelink_offline_at, t.ewelink_offline_at);
  get diagnostics n = row_count;
  -- Dispositivos que ya no están en la cuenta de eWeLink
  delete from tx_timers_estado where device_id not in (select d->>'id' from jsonb_array_elements(p_devs) d);
  return n;
end $$;

-- ── Bot: órdenes pendientes ──
create or replace function public.tx_bot_ordenes(p_clave text)
returns setof public.tx_timer_ordenes language plpgsql security definer set search_path = public as $$
begin
  perform _tx_bot_ok(p_clave);
  return query select * from tx_timer_ordenes where estado = 'pendiente' order by created_at;
end $$;

-- ── Bot: resultado de una orden ──
create or replace function public.tx_bot_orden_resultado(p_clave text, p_id bigint, p_ok boolean, p_detalle text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _tx_bot_ok(p_clave);
  update tx_timer_ordenes set estado = case when p_ok then 'hecha' else 'error' end,
         detalle = left(p_detalle, 500), hecha_at = now()
   where id = p_id and estado = 'pendiente';
end $$;

-- ── Quién puede dar órdenes: cualquiera que vea la pestaña "Timers Taxis" ──
-- Igual que la app: super_admin siempre; si el usuario tiene casillas de módulos guardadas,
-- manda la casilla nav-timers-taxis; si no tiene, la plantilla de su rol (contador y admin la traen).
create or replace function public._tx_timer_puede()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuarios u
     where u.auth_user_id = auth.uid()
       and (u.rol = 'super_admin'
         or coalesce(u.permisos_modulos::text, '') like '%nav-timers-taxis%'
         or (u.rol in ('contador', 'admin')
             and coalesce(nullif(nullif(u.permisos_modulos::text, '{}'), '[]'), '') = ''))
  )
$$;
revoke all on function public._tx_timer_puede() from public, anon;
grant execute on function public._tx_timer_puede() to authenticated;

-- ── Pantalla: dar o cancelar una orden (quien tenga la pestaña) ──
drop function if exists public.tx_timer_ordenar(text, timestamptz);
drop function if exists public.tx_timer_ordenar(text, timestamptz, int, int);
drop function if exists public.tx_timer_ordenar(text, timestamptz, int, int, text);
create or replace function public.tx_timer_ordenar(p_device_id text, p_at timestamptz, p_min_on int default null, p_min_off int default null,
                                                   p_accion text default 'activar', p_arranca text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_nom text; v_id bigint; v_unidad text;
begin
  if not _tx_timer_puede() then raise exception 'No tenés acceso a Timers Taxis para dar órdenes'; end if;
  select id, nombre into v_uid, v_nom from usuarios where auth_user_id = auth.uid();
  if p_accion not in ('activar', 'desactivar') then raise exception 'Acción desconocida: %', p_accion; end if;
  if p_arranca is not null and p_arranca not in ('on', 'off') then raise exception 'Arranque inválido: %', p_arranca; end if;
  if p_arranca is not null and p_min_on is null then raise exception 'Para cambiar con qué arranca el ciclo indicá también los tiempos'; end if;
  if p_accion = 'desactivar' then p_at := null; p_min_on := null; p_min_off := null; p_arranca := null;
  elsif p_at is null or p_at < now() then raise exception 'La fecha de corte debe ser futura'; end if;
  if (p_min_on is null) <> (p_min_off is null) then raise exception 'Indicá los dos tiempos del ciclo (encendido y apagado) o ninguno'; end if;
  if p_min_on is not null and (p_min_on not between 1 and 1440 or p_min_off not between 1 and 1440) then
    raise exception 'Cada tiempo del ciclo va de 1 a 1440 minutos';
  end if;
  select unidad into v_unidad from tx_timers_estado where device_id = p_device_id;
  if not found then raise exception 'Ese dispositivo no está en la última lectura de eWeLink'; end if;
  -- Una sola orden pendiente por dispositivo: la nueva reemplaza a la anterior
  update tx_timer_ordenes set estado = 'cancelada', detalle = 'Reemplazada por una orden nueva', hecha_at = now()
   where device_id = p_device_id and estado = 'pendiente';
  insert into tx_timer_ordenes (device_id, unidad, accion, at_nuevo, min_on, min_off, arranca, creada_por, creada_nombre)
  values (p_device_id, v_unidad, p_accion, p_at, p_min_on, p_min_off, p_arranca, v_uid, v_nom) returning id into v_id;
  return v_id;
end $$;

create or replace function public.tx_timer_cancelar(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not _tx_timer_puede() then raise exception 'No tenés acceso a Timers Taxis'; end if;
  update tx_timer_ordenes set estado = 'cancelada', detalle = 'Cancelada desde la pantalla', hecha_at = now()
   where id = p_id and estado = 'pendiente';
end $$;

-- ── Pantalla: última programación del bot por dispositivo (el log no se lee directo) ──
create or replace function public.tx_timers_ultima_prog()
returns table (device_id text, unidad text, ultima_at timestamptz, at_nuevo text, entregas_30d int)
language sql security definer set search_path = public as $$
  select l.device_id, max(l.unidad), max(l.updated_at),
         (array_agg(l.at_nuevo order by l.updated_at desc))[1],
         count(*) filter (where l.updated_at > now() - interval '30 days')::int
    from tx_bot_timer_log l
   where l.resultado in ('programado', 'aprobado') and l.device_id is not null and l.at_nuevo is not null   -- al aprobar pasa a 'aprobado'
   group by l.device_id
$$;

-- ── Memoria del bot en Contamax (v6) ──
-- Antes vivía solo en archivos de la PC del bot (domingos prestados, intentos para no sumar días
-- dos veces, horas de corte por carro). Si se mudaba el bot sin esos archivos al día, se perdían.
-- Ahora el bot la guarda aquí cada vez que cambia y la lee al arrancar (usa la más reciente).
create table if not exists public.tx_bot_memoria (
  nombre      text primary key check (nombre in ('domingos', 'intentos', 'horas')),
  datos       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);
alter table public.tx_bot_memoria enable row level security;
drop policy if exists tx_bot_memoria_sel on public.tx_bot_memoria;
create policy tx_bot_memoria_sel on public.tx_bot_memoria for select to authenticated using (true);

create or replace function public.tx_bot_memoria_leer(p_clave text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _tx_bot_ok(p_clave);
  return coalesce((select jsonb_object_agg(nombre, jsonb_build_object('datos', datos, 'updated_at', updated_at)) from tx_bot_memoria), '{}'::jsonb);
end $$;

create or replace function public.tx_bot_memoria_guardar(p_clave text, p_nombre text, p_datos jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _tx_bot_ok(p_clave);
  insert into tx_bot_memoria (nombre, datos, updated_at) values (p_nombre, coalesce(p_datos, '{}'::jsonb), now())
  on conflict (nombre) do update set datos = excluded.datos, updated_at = now();
end $$;

revoke all on function public.tx_bot_memoria_leer(text) from public, authenticated;
revoke all on function public.tx_bot_memoria_guardar(text, text, jsonb) from public, authenticated;
grant execute on function public.tx_bot_memoria_leer(text) to anon;
grant execute on function public.tx_bot_memoria_guardar(text, text, jsonb) to anon;

revoke all on function public.tx_bot_snapshot(text, jsonb) from public, authenticated;
revoke all on function public.tx_bot_ordenes(text) from public, authenticated;
revoke all on function public.tx_bot_orden_resultado(text, bigint, boolean, text) from public, authenticated;
grant execute on function public.tx_bot_snapshot(text, jsonb) to anon;
grant execute on function public.tx_bot_ordenes(text) to anon;
grant execute on function public.tx_bot_orden_resultado(text, bigint, boolean, text) to anon;
revoke all on function public.tx_timer_ordenar(text, timestamptz, int, int, text, text) from public, anon;
revoke all on function public.tx_timer_cancelar(bigint) from public, anon;
revoke all on function public.tx_timers_ultima_prog() from public, anon;
grant execute on function public.tx_timer_ordenar(text, timestamptz, int, int, text, text) to authenticated;
grant execute on function public.tx_timer_cancelar(bigint) to authenticated;
grant execute on function public.tx_timers_ultima_prog() to authenticated;

commit;
