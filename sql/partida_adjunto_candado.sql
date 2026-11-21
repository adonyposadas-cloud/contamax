-- ═══════════════════════════════════════════════════════════════
--  Candado del respaldo de una partida
--
--  El adjunto es el comprobante del asiento. En la pantalla ya se limitó
--  (solo super admin, y nunca en partidas aprobadas o anuladas), pero en
--  la base NO hay candado:
--
--      partidas_contables_authenticated_all   ALL   {authenticated}   true
--
--  Cualquiera con sesión puede vaciar adjunto_url desde la consola del
--  navegador. Esto lo cierra sin quitarle permisos a nadie más: un trigger
--  que deja AGREGAR adjuntos libremente y solo frena cuando se QUITA uno.
--
--  Reglas, las mismas que la pantalla:
--    · Partida aprobada o anulada → no se le quita el respaldo, a nadie.
--    · Partida en borrador → solo super admin.
--    · Agregar adjuntos → libre, como hoy.
--
--  Correr en Supabase de CONTAMAX → SQL Editor, DESPUÉS de las consultas
--  de abajo. Es seguro correrlo dos veces.
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────
--  PRIMERO: las tres consultas que faltaban. Correlas y pasame el
--  resultado; no cambian nada, solo miran.
-- ───────────────────────────────────────────────────────────────

-- 1) ¿Quién puede borrar archivos del bucket de las facturas?
select policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by cmd, policyname;

-- 2) ¿El bucket es público? (si sale public = true, cualquiera con el
--    enlace ve las facturas sin entrar al sistema)
select id, name, public, file_size_limit
  from storage.buckets
 where id in ('facturas-compras', 'motoristas-fotos');

-- 3) ¿Qué es "super admin" para la base? El candado de abajo usa la misma
--    función que ya protege las partidas sensibles.
select pg_get_functiondef(oid) as puede_ver_sensibles
  from pg_proc
 where proname = 'puede_ver_sensibles';


-- ───────────────────────────────────────────────────────────────
--  DESPUÉS: el candado
-- ───────────────────────────────────────────────────────────────
begin;

create or replace function public.partida_protege_adjunto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quitados int;
begin
  -- No se tocó el respaldo: seguir de largo
  if new.adjunto_url is not distinct from old.adjunto_url then
    return new;
  end if;

  -- ¿Se quitó alguno de los que había? Agregar es libre.
  select count(*) into v_quitados
    from unnest(string_to_array(coalesce(old.adjunto_url, ''), ',')) as viejo
   where btrim(viejo) <> ''
     and btrim(viejo) not in (
       select btrim(nuevo)
         from unnest(string_to_array(coalesce(new.adjunto_url, ''), ',')) as nuevo
     );
  if v_quitados = 0 then
    return new;
  end if;

  -- Una partida cerrada no se queda sin comprobante, ni por super admin:
  -- si de verdad hay que corregirla, se anula y se hace de nuevo.
  if old.estado in ('aprobada', 'anulada') then
    raise exception 'La partida % está %: su respaldo ya no se puede quitar',
      coalesce(old.numero_partida::text, old.id::text), old.estado
      using errcode = 'check_violation';
  end if;

  if not puede_ver_sensibles() then
    raise exception 'Solo un super admin puede quitarle el respaldo a una partida'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists partida_protege_adjunto_tg on public.partidas_contables;
create trigger partida_protege_adjunto_tg
  before update on public.partidas_contables
  for each row execute function public.partida_protege_adjunto();

commit;


-- ───────────────────────────────────────────────────────────────
--  Comprobación: que el trigger quedó puesto
-- ───────────────────────────────────────────────────────────────
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'public.partidas_contables'::regclass
   and not tgisinternal;

-- Prueba sin romper nada: tomá una partida APROBADA que tenga adjunto y
-- probá vaciárselo. Tiene que dar error y no cambiar nada.
--   update public.partidas_contables set adjunto_url = null
--    where id = 'PEGAR-AQUI-EL-ID' and estado = 'aprobada';
