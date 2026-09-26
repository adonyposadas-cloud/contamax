-- ═══════════════════════════════════════════════════════════════
--  FOTOS DEL MOTORISTA (hasta 2 por ficha) · Revisión Taxis → Motoristas
--  Correr en Supabase de CONTAMAX. Va junto con el frontend de js/revision_taxis.js.
--
--  El bucket es PRIVADO a propósito: son fotos de personas junto a su número de
--  cédula. La app las muestra con URLs firmadas de 8 h, no con enlaces públicos.
-- ═══════════════════════════════════════════════════════════════
begin;

-- 1) Dónde se guarda la ruta de cada foto
alter table tx_motoristas add column if not exists foto1_path text;
alter table tx_motoristas add column if not exists foto2_path text;

-- 2) El bucket
insert into storage.buckets (id, name, public)
values ('motoristas-fotos', 'motoristas-fotos', false)
on conflict (id) do nothing;

-- 3) Permiso de lectura de tx_puede_motoristas() para el rol authenticated.
--    Las políticas de abajo la llaman, y una policy se evalúa con los privilegios
--    de quien consulta: sin este grant fallarían con "permission denied for
--    function". No expone datos: solo responde sí/no sobre el propio usuario.
grant execute on function public.tx_puede_motoristas() to authenticated;

-- 4) Políticas del bucket. Ver es para cualquier usuario con sesión (la pantalla
--    de motoristas la ven varios roles); subir, reemplazar y borrar solo para
--    quien administra motoristas, el mismo permiso que gobierna el botón Editar.
drop policy if exists motf_select on storage.objects;
create policy motf_select on storage.objects for select to authenticated
  using (bucket_id = 'motoristas-fotos');

drop policy if exists motf_insert on storage.objects;
create policy motf_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'motoristas-fotos' and tx_puede_motoristas());

drop policy if exists motf_update on storage.objects;
create policy motf_update on storage.objects for update to authenticated
  using (bucket_id = 'motoristas-fotos' and tx_puede_motoristas())
  with check (bucket_id = 'motoristas-fotos' and tx_puede_motoristas());

drop policy if exists motf_delete on storage.objects;
create policy motf_delete on storage.objects for delete to authenticated
  using (bucket_id = 'motoristas-fotos' and tx_puede_motoristas());

-- 5) Guardar las rutas. Mismo molde que tx_motorista_editar: mismo control de
--    permiso y misma forma de respuesta { ok, error }.
create or replace function public.tx_motorista_fotos(p_identidad text, p_foto1 text, p_foto2 text)
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
         foto2_path = nullif(trim(coalesce(p_foto2, '')), '')
   where identidad = trim(p_identidad);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Motorista no encontrado.');
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.tx_motorista_fotos(text, text, text) from public, anon;
grant execute on function public.tx_motorista_fotos(text, text, text) to authenticated;

-- 6) El listado arma el JSON campo por campo, así que las columnas nuevas hay que
--    agregarlas acá o no llegan a la pantalla. Es la misma función de antes con
--    'foto1' y 'foto2' al final; no se tocó nada más.
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
           'foto2', m.foto2_path
         ) order by m.activo desc, m.nombre), '[]'::jsonb)
  from tx_motoristas m
  left join ult u on u.identidad = m.identidad;
$function$;

commit;

notify pgrst, 'reload schema';

-- Verificación: 2 columnas, 1 bucket privado, 4 políticas, 2 funciones.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'tx_motoristas'
       and column_name in ('foto1_path', 'foto2_path'))                    as columnas_de_2,
  (select count(*) from storage.buckets
     where id = 'motoristas-fotos' and public = false)                     as bucket_privado_de_1,
  (select count(*) from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('motf_select','motf_insert','motf_update','motf_delete')) as politicas_de_4,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('tx_motorista_fotos','tx_motoristas_listar'))     as funciones_de_2;
