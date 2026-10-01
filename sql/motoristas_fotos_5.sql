-- ═══════════════════════════════════════════════════════════════
--  FOTOS DEL MOTORISTA: de 2 a 5 por ficha (todas opcionales)
--  Correr en Supabase de CONTAMAX DESPUÉS de sql/motoristas_fotos.sql.
--  Va junto con js/revision_taxis.js (5 ranuras en Editar motorista).
-- ═══════════════════════════════════════════════════════════════
begin;

-- 1) Columnas de las fotos 3 a 5
alter table tx_motoristas add column if not exists foto3_path text;
alter table tx_motoristas add column if not exists foto4_path text;
alter table tx_motoristas add column if not exists foto5_path text;

-- 2) Guardar las 5 rutas. Es una función NUEVA (6 parámetros); la de 3 parámetros
--    se deja como estaba, así una pestaña abierta con la versión anterior sigue andando.
create or replace function public.tx_motorista_fotos(
  p_identidad text, p_foto1 text, p_foto2 text, p_foto3 text, p_foto4 text, p_foto5 text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not tx_puede_motoristas() then
    return jsonb_build_object('ok', false, 'error', 'No tenés permiso para editar motoristas.');
  end if;
  update tx_motoristas
     set foto1_path = nullif(trim(coalesce(p_foto1, '')), ''),
         foto2_path = nullif(trim(coalesce(p_foto2, '')), ''),
         foto3_path = nullif(trim(coalesce(p_foto3, '')), ''),
         foto4_path = nullif(trim(coalesce(p_foto4, '')), ''),
         foto5_path = nullif(trim(coalesce(p_foto5, '')), '')
   where identidad = trim(p_identidad);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Motorista no encontrado.');
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.tx_motorista_fotos(text, text, text, text, text, text) from public, anon;
grant execute on function public.tx_motorista_fotos(text, text, text, text, text, text) to authenticated;

-- 3) El listado: la misma función de sql/motoristas_fotos.sql con foto3..foto5 al final.
create or replace function public.tx_motoristas_listar()
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with ult as (   -- última unidad por entrega aprobada
    select distinct on (identidad) identidad, unidad
    from entregas_taxis
    where estado = 'Aprobada' and identidad is not null
    order by identidad,
      coalesce(case when fecha_deposito <= current_date then fecha_deposito else fecha_envio end, fecha_deposito) desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'identidad', m.identidad,
           'nombre', m.nombre,
           'unidad', coalesce(u.unidad, m.unidad, '—'),
           'grupo', coalesce(nullif(trim(m.grupo), ''), '1'),
           'tarifa', coalesce(m.tarifa_base, 500),
           'telefono', m.telefono,
           'saldo', round(coalesce(m.saldo_actual, 0), 2),
           'activo', m.activo,
           'foto1', m.foto1_path,
           'foto2', m.foto2_path,
           'foto3', m.foto3_path,
           'foto4', m.foto4_path,
           'foto5', m.foto5_path
         ) order by m.activo desc, m.nombre), '[]'::jsonb)
  from tx_motoristas m
  left join ult u on u.identidad = m.identidad;
$function$;

commit;

notify pgrst, 'reload schema';

-- Verificación: 5 columnas de foto y la función de 6 parámetros.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'tx_motoristas'
       and column_name in ('foto1_path','foto2_path','foto3_path','foto4_path','foto5_path')) as columnas_de_5,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'tx_motorista_fotos' and p.pronargs = 6)   as funcion_6_params_de_1;
