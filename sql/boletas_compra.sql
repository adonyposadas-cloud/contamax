-- ═══════════════════════════════════════════════════════════════
--  Boletas de compra (autoimpresor) · Acuerdo 481-2017, arts. 20 a 22
--  Correr en Supabase de CONTAMAX → SQL Editor.
--
--  · boleta_compra_rangos: lo que autoriza el SAR (CAI, rango, fecha límite). Se carga
--    el de la solicitud SAR-927 del 11/11/2026: punto de emisión 002 (autoimpresor),
--    documento 11, del 000-002-11-00000201 al 000-002-11-00001200, vence 11/11/2027.
--  · boletas_compra: cada boleta emitida. No se borran: una mal hecha se ANULA y su
--    número queda usado (el correlativo no puede tener huecos sin explicación).
--  · emitir_boleta_compra(): toma el siguiente número del rango bajo candado (dos
--    personas emitiendo a la vez no sacan el mismo), valida vigencia y requisitos del
--    art. 21 y graba la boleta. Es la única forma de crear una.
-- ═══════════════════════════════════════════════════════════════
begin;

create table if not exists public.boleta_compra_rangos (
  id               uuid primary key default gen_random_uuid(),
  cai              text not null unique,
  establecimiento  text not null,
  punto_emision    text not null,
  tipo_documento   text not null,
  desde            int  not null,
  hasta            int  not null,
  siguiente        int  not null,
  fecha_limite     date not null,
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  check (desde <= hasta and siguiente >= desde)
);

create table if not exists public.boletas_compra (
  id                    uuid primary key default gen_random_uuid(),
  rango_id              uuid not null references public.boleta_compra_rangos(id),
  numero                text not null unique,
  correlativo           int  not null,
  fecha                 date not null,
  proveedor_nombre      text not null,
  proveedor_rtn         text not null,
  proveedor_direccion   text not null,
  proveedor_telefono    text not null,
  proveedor_correo      text,
  orden_compra_exenta   text,
  constancia_exonerado  text,
  registro_sag          text,
  lineas                jsonb not null,
  total                 numeric(14,2) not null check (total > 0),
  total_letras          text not null,
  estado                text not null default 'emitida' check (estado in ('emitida', 'anulada')),
  motivo_anulacion      text,
  anulada_at            timestamptz,
  emitida_por           uuid,
  emitida_nombre        text,
  created_at            timestamptz not null default now()
);
create index if not exists boletas_compra_fecha on public.boletas_compra (fecha);
create index if not exists boletas_compra_proveedor on public.boletas_compra (proveedor_rtn);

alter table public.boleta_compra_rangos enable row level security;
alter table public.boletas_compra       enable row level security;
drop policy if exists boleta_compra_rangos_select on public.boleta_compra_rangos;
create policy boleta_compra_rangos_select on public.boleta_compra_rangos for select to authenticated using (true);
drop policy if exists boletas_compra_select on public.boletas_compra;
create policy boletas_compra_select on public.boletas_compra for select to authenticated using (true);
-- sin políticas de escritura: solo por las funciones de abajo

create or replace function public.emitir_boleta_compra(p jsonb) returns public.boletas_compra
language plpgsql security definer set search_path = public as $$
declare
  r      boleta_compra_rangos;
  b      boletas_compra;
  v_uid  uuid; v_nom text;
  v_fecha date := coalesce((p->>'fecha')::date, current_date);
begin
  select id, nombre into v_uid, v_nom from usuarios where auth_user_id = auth.uid();
  if v_uid is null then raise exception 'Usuario no registrado en Contamax'; end if;

  -- Rango activo y vigente, con candado de fila: el número no se repite
  select * into r from boleta_compra_rangos
   where activo and fecha_limite >= v_fecha and siguiente <= hasta
   order by fecha_limite, desde limit 1 for update;
  if r.id is null then
    raise exception 'No hay rango de boletas de compra vigente con números disponibles (revisá CAI, fecha límite y rango)';
  end if;

  -- Requisitos del art. 21 (lo que se llena al emitir)
  if coalesce(trim(p->>'proveedor_nombre'), '') = '' then raise exception 'Falta el nombre del proveedor'; end if;
  if coalesce(trim(p->>'proveedor_rtn'), '') = '' then raise exception 'Falta el RTN o número de identidad del proveedor'; end if;
  if coalesce(trim(p->>'proveedor_direccion'), '') = '' then raise exception 'Falta la dirección del proveedor'; end if;
  if coalesce(trim(p->>'proveedor_telefono'), '') = '' then raise exception 'Falta el teléfono del proveedor'; end if;
  if jsonb_typeof(p->'lineas') <> 'array' or jsonb_array_length(p->'lineas') = 0 then raise exception 'La boleta no tiene detalle'; end if;
  if coalesce((p->>'total')::numeric, 0) <= 0 then raise exception 'El total debe ser mayor que cero'; end if;
  if coalesce(trim(p->>'total_letras'), '') = '' then raise exception 'Falta el total en letras'; end if;

  insert into boletas_compra (rango_id, numero, correlativo, fecha, proveedor_nombre, proveedor_rtn, proveedor_direccion,
         proveedor_telefono, proveedor_correo, orden_compra_exenta, constancia_exonerado, registro_sag, lineas, total,
         total_letras, emitida_por, emitida_nombre)
  values (r.id, r.establecimiento || '-' || r.punto_emision || '-' || r.tipo_documento || '-' || lpad(r.siguiente::text, 8, '0'),
         r.siguiente, v_fecha, upper(trim(p->>'proveedor_nombre')), trim(p->>'proveedor_rtn'), trim(p->>'proveedor_direccion'),
         trim(p->>'proveedor_telefono'), nullif(trim(p->>'proveedor_correo'), ''), nullif(trim(p->>'orden_compra_exenta'), ''),
         nullif(trim(p->>'constancia_exonerado'), ''), nullif(trim(p->>'registro_sag'), ''), p->'lineas',
         round((p->>'total')::numeric, 2), trim(p->>'total_letras'), v_uid, v_nom)
  returning * into b;

  update boleta_compra_rangos set siguiente = siguiente + 1 where id = r.id;
  return b;
end $$;

-- Anular: el número queda usado, con motivo. Solo super_admin y contador.
create or replace function public.anular_boleta_compra(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from usuarios where auth_user_id = auth.uid() and rol in ('super_admin', 'contador')) then
    raise exception 'Solo super_admin o contador pueden anular una boleta de compra';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
  update boletas_compra set estado = 'anulada', motivo_anulacion = trim(p_motivo), anulada_at = now()
   where id = p_id and estado = 'emitida';
  if not found then raise exception 'La boleta no existe o ya estaba anulada'; end if;
end $$;

grant execute on function public.emitir_boleta_compra(jsonb) to authenticated;
grant execute on function public.anular_boleta_compra(uuid, text) to authenticated;

-- Rango autorizado por el SAR (solicitud SAR-927, 11/11/2026)
insert into public.boleta_compra_rangos (cai, establecimiento, punto_emision, tipo_documento, desde, hasta, siguiente, fecha_limite)
values ('60025F-4CEB76-4E3CE0-63BE03-0909A5-12', '000', '002', '11', 201, 1200, 201, '2027-11-11')
on conflict (cai) do nothing;

commit;

select cai, establecimiento || '-' || punto_emision || '-' || tipo_documento || '-' || lpad(desde::text, 8, '0') as desde,
       establecimiento || '-' || punto_emision || '-' || tipo_documento || '-' || lpad(hasta::text, 8, '0') as hasta,
       siguiente, fecha_limite from public.boleta_compra_rangos;
