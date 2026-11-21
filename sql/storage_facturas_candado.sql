-- ═══════════════════════════════════════════════════════════════
--  Candado de los ARCHIVOS de las facturas (storage)
--
--  El trigger de partidas protege el ENLACE; esto protege el ARCHIVO.
--  Hoy el bucket está así:
--
--    Allow authenticated delete   DELETE   {authenticated}   facturas-compras
--    Allow authenticated update   UPDATE   {authenticated}   facturas-compras
--
--  Sin comprobación de rol: cualquiera con sesión puede borrar o
--  REEMPLAZAR cualquier factura. Lo segundo es peor que lo primero — el
--  enlace sigue sirviendo, la partida se ve completa, y adentro hay otra
--  imagen. Los buckets hermanos sí tienen candado (checklist-fotos pide
--  super_admin o admin, motoristas-fotos pide tx_puede_motoristas);
--  facturas-compras y talleres-fotos se quedaron sin ninguno.
--
--  Queda en manos del super admin de verdad (usuarios.rol = 'super_admin'),
--  la misma función que ya cuida las partidas sensibles y el trigger del
--  adjunto. Subir sigue libre para todos: solo se cierran borrar y
--  reemplazar.
--
--  ⚠ ORDEN: esto va DESPUÉS de publicar el cambio de js/app.js que le pone
--  la hora al nombre del archivo. Hasta ahora los adjuntos se llamaban
--  partidaId_1, partidaId_2… y el contador arrancaba de nuevo en cada
--  guardado, así que agregar un segundo adjunto PISABA el primero (un
--  UPDATE). Con el nombre nuevo no se repite ninguno y ya nada necesita
--  reemplazar archivos.
--
--  Correr en Supabase de CONTAMAX → SQL Editor. Es seguro correrlo dos veces.
-- ═══════════════════════════════════════════════════════════════
begin;

-- ── facturas-compras: borrar y reemplazar, solo super admin ──
drop policy if exists "Allow authenticated delete" on storage.objects;
drop policy if exists "Allow authenticated update" on storage.objects;

create policy facturas_delete_super on storage.objects
  for delete to authenticated
  using (bucket_id = 'facturas-compras' and puede_ver_sensibles());

create policy facturas_update_super on storage.objects
  for update to authenticated
  using (bucket_id = 'facturas-compras' and puede_ver_sensibles());

-- ── talleres-fotos: mismo hueco, mismo candado ──
drop policy if exists talleres_fotos_delete on storage.objects;

create policy talleres_fotos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'talleres-fotos' and puede_ver_sensibles());

commit;

-- ───────────────────────────────────────────────────────────────
--  Comprobación: los DELETE y UPDATE del storage, con su candado
-- ───────────────────────────────────────────────────────────────
select policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and cmd in ('DELETE', 'UPDATE')
 order by cmd, policyname;

-- ───────────────────────────────────────────────────────────────
--  Queda por revisar aparte (no lo toca este archivo):
--
--  · tx_subir_comprobantes deja INSERTAR al rol anon. La condición de un
--    INSERT va en with_check, que no se ve en la consulta de antes. Si no
--    limita el bucket, alguien sin sesión podría subir archivos a
--    facturas-compras. Para verlo:
--
--      select policyname, with_check from pg_policies
--       where schemaname='storage' and tablename='objects' and cmd='INSERT';
--
--  · talleres-fotos se usa con getPublicUrl() en prospectos.js. Si el
--    bucket es privado, esas URLs no abren. Para verlo:
--
--      select id, public from storage.buckets;
-- ───────────────────────────────────────────────────────────────
