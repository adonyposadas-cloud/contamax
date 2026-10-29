-- ═══════════════════════════════════════════════════════════════
--  Declaración de ISV presentada = lo declarado queda fijo (candado fiscal)
--  Correr en Supabase de CONTAMAX → SQL Editor.
--
--  · declaraciones_isv guarda cada presentación: mes, versión, acuse del SAR y
--    los totales tal como se declararon. Al presentar se guarda la lista exacta
--    de lo que la formó:
--      - ventas del mes (libro_ventas),
--      - compras INCLUIDAS en el crédito de ese mes (libro_compras),
--      - partidas: las aprobadas del mes con líneas fiscales + las de esos libros.
--  · Lo que está en esa lista no se puede cambiar, venga de la pantalla que venga:
--      - venta o compra declarada: nada (ni montos, ni marca, ni mes, ni borrarla);
--      - partida declarada: no se anula, borra, ni cambia fecha, total o centro;
--      - sus líneas fiscales: no cambia marca, monto, cuenta, debe/haber ni centro;
--        no se borran; no se le agregan líneas fiscales.
--    Lo que no es fiscal sigue libre (fotos, descripción, pagado, centralizado…).
--  · Lo que NO entró en la declaración sigue libre aunque tenga fecha de ese mes:
--      - una compra de septiembre registrada en octubre (o dejada fuera) entra sin
--        problema; su período fiscal se pasa solo al siguiente mes abierto y queda
--        SIN incluir: la pantalla de ISV avisa y pregunta si se incluye (plazo legal).
--      - no se puede incluir una compra en un mes ya declarado (eso es rectificativa).
--      - una VENTA nueva con fecha de un mes declarado se rechaza: las ventas no
--        ruedan, eso pide reabrir la declaración (rectificativa).
--  · Presentar: super_admin, contador o contador_fiscal. Reabrir (rectificativa):
--    solo super_admin, con motivo. Al volver a presentar queda como versión 2; la
--    versión 1 y su lista no se borran.
--  · Arreglos a mano por SQL: dentro de la misma transacción
--      set local contamax.fiscal_bypass = 'on';
-- ═══════════════════════════════════════════════════════════════
begin;

create table if not exists public.declaraciones_isv (
  id                  uuid primary key default gen_random_uuid(),
  periodo             text not null check (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  version             int  not null default 1,
  estado              text not null default 'presentada' check (estado in ('presentada', 'reabierta')),
  numero_acuse        text,
  fecha_presentacion  date not null,
  totales             jsonb not null default '{}'::jsonb,   -- débito, crédito, ISV a pagar, prorrata… (como se vieron en pantalla)
  n_ventas            int, n_compras int, n_partidas int,
  presentada_por      uuid,
  presentada_nombre   text,
  presentada_at       timestamptz not null default now(),
  reabierta_por       uuid,
  reabierta_nombre    text,
  reabierta_at        timestamptz,
  motivo_reapertura   text,
  unique (periodo, version)
);
create unique index if not exists declaraciones_isv_una_presentada
  on public.declaraciones_isv (periodo) where estado = 'presentada';

-- Lo que formó cada declaración (ids como texto: no depende del tipo de id de cada tabla)
create table if not exists public.declaraciones_isv_ventas (
  declaracion_id uuid not null references public.declaraciones_isv(id) on delete cascade,
  venta_id text not null, primary key (declaracion_id, venta_id));
create table if not exists public.declaraciones_isv_compras (
  declaracion_id uuid not null references public.declaraciones_isv(id) on delete cascade,
  compra_id text not null, primary key (declaracion_id, compra_id));
create table if not exists public.declaraciones_isv_partidas (
  declaracion_id uuid not null references public.declaraciones_isv(id) on delete cascade,
  partida_id uuid not null, primary key (declaracion_id, partida_id));
create index if not exists declaraciones_isv_ventas_id   on public.declaraciones_isv_ventas (venta_id);
create index if not exists declaraciones_isv_compras_id  on public.declaraciones_isv_compras (compra_id);
create index if not exists declaraciones_isv_partidas_id on public.declaraciones_isv_partidas (partida_id);

alter table public.declaraciones_isv          enable row level security;
alter table public.declaraciones_isv_ventas   enable row level security;
alter table public.declaraciones_isv_compras  enable row level security;
alter table public.declaraciones_isv_partidas enable row level security;
drop policy if exists declaraciones_isv_select on public.declaraciones_isv;
create policy declaraciones_isv_select on public.declaraciones_isv for select to authenticated using (true);
drop policy if exists declaraciones_isv_ventas_select on public.declaraciones_isv_ventas;
create policy declaraciones_isv_ventas_select on public.declaraciones_isv_ventas for select to authenticated using (true);
drop policy if exists declaraciones_isv_compras_select on public.declaraciones_isv_compras;
create policy declaraciones_isv_compras_select on public.declaraciones_isv_compras for select to authenticated using (true);
drop policy if exists declaraciones_isv_partidas_select on public.declaraciones_isv_partidas;
create policy declaraciones_isv_partidas_select on public.declaraciones_isv_partidas for select to authenticated using (true);
-- sin políticas de escritura: solo por las funciones de abajo

-- ── Consultas del candado (devuelven el mes declarado, o null) ──
create or replace function public._fiscal_bypass() returns boolean
language sql stable as $$ select coalesce(current_setting('contamax.fiscal_bypass', true), '') = 'on' $$;

create or replace function public.fiscal_mes_cerrado(p_periodo text) returns boolean
language sql stable security definer set search_path = public as $$
  select not _fiscal_bypass()
     and exists (select 1 from declaraciones_isv where periodo = p_periodo and estado = 'presentada');
$$;

create or replace function public.fiscal_venta_declarada(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select d.periodo from declaraciones_isv_ventas x join declaraciones_isv d on d.id = x.declaracion_id
   where x.venta_id = p_id and d.estado = 'presentada' and not _fiscal_bypass() limit 1;
$$;
create or replace function public.fiscal_compra_declarada(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select d.periodo from declaraciones_isv_compras x join declaraciones_isv d on d.id = x.declaracion_id
   where x.compra_id = p_id and d.estado = 'presentada' and not _fiscal_bypass() limit 1;
$$;
create or replace function public.fiscal_partida_declarada(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select d.periodo from declaraciones_isv_partidas x join declaraciones_isv d on d.id = x.declaracion_id
   where x.partida_id = p_id and d.estado = 'presentada' and not _fiscal_bypass() limit 1;
$$;

create or replace function public._fiscal_error(p_periodo text, p_que text) returns void
language plpgsql as $$
begin
  raise exception 'DECLARACIÓN DE ISV PRESENTADA: % está en la declaración de % y no se puede cambiar. Para corregirlo hay que reabrir la declaración (rectificativa).',
    p_que, p_periodo using errcode = 'P0001';
end $$;

-- ── libro_ventas ──
create or replace function public._fiscal_candado_ventas() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v := fiscal_venta_declarada(old.id::text);
    if v is not null and (tg_op = 'DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
      perform _fiscal_error(v, 'La venta ' || coalesce(old.factura_electronica, old.factura_interna, ''));
    end if;
  end if;
  -- Venta nueva (o movida) a un mes ya declarado: las ventas no ruedan
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and to_char(new.fecha, 'YYYY-MM') is distinct from to_char(old.fecha, 'YYYY-MM')) then
    if fiscal_mes_cerrado(to_char(new.fecha, 'YYYY-MM')) then
      perform _fiscal_error(to_char(new.fecha, 'YYYY-MM'), 'Una venta nueva (' || coalesce(new.factura_electronica, new.factura_interna, '') || ') con fecha de un mes que');
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_fiscal_candado on public.libro_ventas;
create trigger trg_fiscal_candado
  before insert or update or delete on public.libro_ventas
  for each row execute function public._fiscal_candado_ventas();

-- ── libro_compras ──
create or replace function public._fiscal_candado_compras() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text; p text; n int := 0;
begin
  if tg_op = 'INSERT' then
    -- Compra que caería en un mes ya declarado (registrada tarde): pasa al siguiente mes
    -- abierto SIN incluir; la pantalla de ISV pregunta si se incluye (dentro del plazo).
    if new.periodo_fiscal is not null and fiscal_mes_cerrado(new.periodo_fiscal) then
      p := new.periodo_fiscal;
      while fiscal_mes_cerrado(p) and n < 24 loop
        p := to_char(to_date(p || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
        n := n + 1;
      end loop;
      new.periodo_fiscal := p;
      new.incluir_fiscal := false;
    end if;
    return new;
  end if;

  v := fiscal_compra_declarada(old.id::text);
  if v is not null and (tg_op = 'DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
    perform _fiscal_error(v, 'La compra ' || coalesce(old.numero_factura, '') || ' de ' || coalesce(old.proveedor, ''));
  end if;
  -- No declarada: libre, salvo meterla (o incluirla) en un mes ya declarado
  if tg_op = 'UPDATE' and new.periodo_fiscal is not null and fiscal_mes_cerrado(new.periodo_fiscal)
     and (new.periodo_fiscal is distinct from old.periodo_fiscal
          or (coalesce(new.incluir_fiscal, false) and not coalesce(old.incluir_fiscal, false))) then
    perform _fiscal_error(new.periodo_fiscal, 'Incluir la compra ' || coalesce(new.numero_factura, '') || ' en un mes que ya se declaró');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_fiscal_candado on public.libro_compras;
create trigger trg_fiscal_candado
  before insert or update or delete on public.libro_compras
  for each row execute function public._fiscal_candado_compras();

-- ── partidas_contables ──
create or replace function public._fiscal_candado_partidas() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if tg_op = 'UPDATE'
     and new.estado is not distinct from old.estado
     and new.fecha_partida is not distinct from old.fecha_partida
     and new.total is not distinct from old.total
     and new.centro_costo_id is not distinct from old.centro_costo_id then
    return new;          -- fotos, descripción, sensible, etc.: libres
  end if;
  v := fiscal_partida_declarada(old.id);
  if v is not null then
    perform _fiscal_error(v, 'La partida #' || coalesce(old.numero_partida::text, ''));
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_fiscal_candado on public.partidas_contables;
create trigger trg_fiscal_candado
  before update or delete on public.partidas_contables
  for each row execute function public._fiscal_candado_partidas();

-- ── lineas_partida ──
create or replace function public._fiscal_candado_lineas() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text; num text;
begin
  if tg_op = 'UPDATE' then
    -- Solo importa si la línea es (o pasa a ser) fiscal y cambia algo que se declara
    if not (coalesce(old.aplica_fiscal, false) or coalesce(new.aplica_fiscal, false)) then return new; end if;
    if new.aplica_fiscal is not distinct from old.aplica_fiscal
       and new.monto is not distinct from old.monto
       and new.tipo is not distinct from old.tipo
       and new.cuenta_id is not distinct from old.cuenta_id
       and new.cuenta_codigo is not distinct from old.cuenta_codigo
       and new.centro_costo_id is not distinct from old.centro_costo_id
       and new.partida_id is not distinct from old.partida_id then
      return new;        -- descripción, pagado, centralizado, recibos…: libres
    end if;
  elsif tg_op = 'INSERT' then
    if not coalesce(new.aplica_fiscal, false) then return new; end if;
  elsif not coalesce(old.aplica_fiscal, false) then
    return old;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v := fiscal_partida_declarada(old.partida_id);
    if v is not null then
      select numero_partida::text into num from partidas_contables where id = old.partida_id;
      perform _fiscal_error(v, 'La línea fiscal ' || coalesce(old.cuenta_codigo, '') || ' de la partida #' || coalesce(num, ''));
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and coalesce(new.aplica_fiscal, false) then
    v := fiscal_partida_declarada(new.partida_id);
    if v is not null then
      select numero_partida::text into num from partidas_contables where id = new.partida_id;
      perform _fiscal_error(v, 'Agregar una línea fiscal a la partida #' || coalesce(num, ''));
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_fiscal_candado on public.lineas_partida;
create trigger trg_fiscal_candado
  before insert or update or delete on public.lineas_partida
  for each row execute function public._fiscal_candado_lineas();

-- ── Presentar / reabrir ──
create or replace function public.fiscal_presentar(p_periodo text, p_acuse text, p_fecha date, p_totales jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_nombre text; v_rol text; v_ver int; v_id uuid; v_ini date; v_fin date;
        nv int; nc int; np int;
begin
  select id, nombre, rol into v_uid, v_nombre, v_rol from usuarios where auth_user_id = auth.uid();
  if v_rol is null or v_rol not in ('super_admin', 'contador', 'contador_fiscal') then
    return jsonb_build_object('ok', false, 'error', 'No tenés permiso para presentar la declaración');
  end if;
  if p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then return jsonb_build_object('ok', false, 'error', 'Mes inválido'); end if;
  if p_fecha is null then return jsonb_build_object('ok', false, 'error', 'Poné la fecha en que se presentó'); end if;
  if exists (select 1 from declaraciones_isv where periodo = p_periodo and estado = 'presentada') then
    return jsonb_build_object('ok', false, 'error', 'Ese mes ya está presentado');
  end if;
  v_ini := to_date(p_periodo || '-01', 'YYYY-MM-DD');
  v_fin := (v_ini + interval '1 month')::date;
  select coalesce(max(version), 0) + 1 into v_ver from declaraciones_isv where periodo = p_periodo;

  insert into declaraciones_isv (periodo, version, numero_acuse, fecha_presentacion, totales, presentada_por, presentada_nombre)
  values (p_periodo, v_ver, nullif(trim(p_acuse), ''), p_fecha, coalesce(p_totales, '{}'::jsonb), v_uid, v_nombre)
  returning id into v_id;

  insert into declaraciones_isv_ventas (declaracion_id, venta_id)
  select v_id, id::text from libro_ventas where fecha >= v_ini and fecha < v_fin;
  get diagnostics nv = row_count;

  insert into declaraciones_isv_compras (declaracion_id, compra_id)
  select v_id, id::text from libro_compras where periodo_fiscal = p_periodo and incluir_fiscal;
  get diagnostics nc = row_count;

  insert into declaraciones_isv_partidas (declaracion_id, partida_id)
  select v_id, pid from (
    select p.id as pid from partidas_contables p
     where p.estado = 'aprobada' and p.fecha_partida >= v_ini and p.fecha_partida < v_fin
       and exists (select 1 from lineas_partida l where l.partida_id = p.id and l.aplica_fiscal)
    union
    select partida_id from libro_ventas where fecha >= v_ini and fecha < v_fin and partida_id is not null
    union
    select partida_id from libro_compras where periodo_fiscal = p_periodo and incluir_fiscal and partida_id is not null
  ) x;
  get diagnostics np = row_count;

  update declaraciones_isv set n_ventas = nv, n_compras = nc, n_partidas = np where id = v_id;
  return jsonb_build_object('ok', true, 'version', v_ver, 'ventas', nv, 'compras', nc, 'partidas', np);
end $$;

create or replace function public.fiscal_reabrir(p_periodo text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_nombre text; v_rol text; n int;
begin
  select id, nombre, rol into v_uid, v_nombre, v_rol from usuarios where auth_user_id = auth.uid();
  if v_rol is distinct from 'super_admin' then
    return jsonb_build_object('ok', false, 'error', 'Solo el Super Admin puede reabrir una declaración');
  end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Escribí el motivo (rectificativa, error encontrado…)');
  end if;
  update declaraciones_isv set estado = 'reabierta', reabierta_por = v_uid, reabierta_nombre = v_nombre,
         reabierta_at = now(), motivo_reapertura = trim(p_motivo)
   where periodo = p_periodo and estado = 'presentada';
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'Ese mes no está presentado'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fiscal_presentar(text, text, date, jsonb) from public, anon;
revoke all on function public.fiscal_reabrir(text, text) from public, anon;
grant execute on function public.fiscal_presentar(text, text, date, jsonb) to authenticated;
grant execute on function public.fiscal_reabrir(text, text) to authenticated;
grant execute on function public.fiscal_mes_cerrado(text) to authenticated;

commit;

-- Verificación: los cuatro candados activos (tgenabled = 'O')
select c.relname as tabla, t.tgname, t.tgenabled
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgname = 'trg_fiscal_candado'
 order by 1;
