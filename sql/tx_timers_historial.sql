-- ═══════════════════════════════════════════════════════════════
--  Timers Taxis · historial de programaciones de una unidad
--
--  En el panel, la columna "Última programación del bot" dice cuántas
--  veces programó el bot esa unidad en los últimos 30 días ("12 en 30
--  días"), pero no se podía ver CUÁLES. Esto lo abre: las últimas N, de
--  la más reciente hacia atrás, con la fecha en que el bot la programó y
--  el corte que le dejó.
--
--  Lee tx_bot_timer_log, que no se consulta directo desde la pantalla
--  (no tiene política de lectura): va por aquí, como tx_timers_ultima_prog.
--
--  Mismo filtro que el contador del panel —solo 'programado' y
--  'aprobado'— para que el número que se toca y la lista que se abre
--  digan lo mismo.
--
--  Correr en Supabase de CONTAMAX → SQL Editor. Es seguro correrlo
--  dos veces.
-- ═══════════════════════════════════════════════════════════════
begin;

-- El historial se pide por dispositivo y ordenado por fecha: sin esto, cada
-- vez que se abre el panel se recorre el log entero.
create index if not exists tx_bot_timer_log_dev_fecha
  on public.tx_bot_timer_log (device_id, updated_at desc);

create or replace function public.tx_timers_historial(
  p_device_id text,
  p_desde     int default 0,     -- cuántas saltar (para "ver 10 más")
  p_limite    int default 10
)
returns table (updated_at timestamptz, at_nuevo text, resultado text, total bigint)
language sql security definer set search_path = public as $$
  select l.updated_at, l.at_nuevo, l.resultado, count(*) over()::bigint
    from tx_bot_timer_log l
   where l.device_id = p_device_id
     and l.resultado in ('programado', 'aprobado')
     and l.at_nuevo is not null
   order by l.updated_at desc
  offset greatest(coalesce(p_desde, 0), 0)
   limit least(greatest(coalesce(p_limite, 10), 1), 100)
$$;

revoke all on function public.tx_timers_historial(text, int, int) from public, anon;
grant execute on function public.tx_timers_historial(text, int, int) to authenticated;

commit;

-- Comprobación: el historial de una unidad cualquiera (poné el device_id
-- que quieras, o dejá este select que toma el primero que haya).
-- select * from public.tx_timers_historial(
--   (select device_id from public.tx_timers_estado order by unidad limit 1), 0, 10);
