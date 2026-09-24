-- ══════════════════════════════════════════════
-- CONTAMAX · Archivo de cierres mensuales por socio
-- Guarda la "foto" del cálculo al generar la partida de cierre, para poder
-- reimprimir exactamente el mismo PDF que se le envió al socio, aunque después
-- cambien entregas, facturas o recibos. Mismo criterio que detalle_snapshot
-- en recibos_prestamos.
-- Ejecutar en el SQL Editor de Supabase.
-- ══════════════════════════════════════════════

create table if not exists public.cierres_socio (
  id              uuid primary key default gen_random_uuid(),
  socio           text not null,
  desde           date not null,
  hasta           date not null,
  unidades        integer not null default 0,
  ingreso         numeric(14,2) not null default 0,
  gps_seg         numeric(14,2) not null default 0,
  facturas        numeric(14,2) not null default 0,
  admin           numeric(14,2) not null default 0,
  neto            numeric(14,2) not null default 0,
  -- detalle = { fila: {...unidades...}, detFact: { registro: [líneas de factura] } }
  detalle         jsonb not null,
  partida_id      uuid references public.partidas_contables(id) on delete set null,
  numero_partida  integer,
  generado_por    uuid references public.usuarios(id),
  created_at      timestamptz not null default now()
);

create index if not exists cierres_socio_busqueda_idx on public.cierres_socio (desde desc, socio);
create index if not exists cierres_socio_partida_idx  on public.cierres_socio (partida_id);

-- ── Permisos ──
-- Supabase concede por defecto a anon en las tablas nuevas: acá se le quita.
-- Solo usuarios con sesión (authenticated) pueden leer y archivar.
alter table public.cierres_socio enable row level security;
revoke all on public.cierres_socio from anon, public;
grant select, insert on public.cierres_socio to authenticated;
grant all    on public.cierres_socio to service_role;

drop policy if exists cierres_socio_select on public.cierres_socio;
drop policy if exists cierres_socio_insert on public.cierres_socio;
create policy cierres_socio_select on public.cierres_socio
  for select to authenticated using (true);
create policy cierres_socio_insert on public.cierres_socio
  for insert to authenticated with check (true);

-- Un cierre archivado no se edita ni se borra: es la constancia de lo enviado.
-- (No se crean políticas de update/delete a propósito.)

notify pgrst, 'reload schema';
