-- ═══════════════════════════════════════════════════════════════
--  Guardar CUÁL partida se creó de cada factura
--  Correr en Supabase de CONTAMAX. Va junto con el cambio de js/app.js
--  que muestra el vínculo en el cintillo de "Facturas pendientes".
--
--  El problema: cuando una factura se convierte en partida, el sistema solo
--  la marcaba 'procesada' y no anotaba qué partida fue, aunque tenía el id en
--  la mano. Después la pantalla reconstruía el vínculo cruzando texto:
--  partidas_contables.numero_documento = facturas_compras.numero_factura.
--  Eso funciona mientras el documento sea un número de factura de verdad, pero
--  hay partidas guardadas con frases genéricas en ese campo:
--
--     COMPROBANTE DE EGRESO ... 128 partidas
--     COMPROBANTE EGRESO ......  50
--     COMPROBANTE .............  16
--     TRANSFERENCIA ...........   6
--     30052026 ................   6
--
--  Una factura cuyo "número" es "Comprobante de egreso" engancha las 128 y el
--  cintillo listaba partidas desde la #15 hasta la #6852, ninguna relacionada.
--
--  Esto agrega la columna, la llena hacia atrás SOLO donde el cruce por texto
--  es inequívoco (una sola partida), y deja en paz lo ambiguo: de ahora en
--  adelante el vínculo se guarda al crear la partida, no se adivina.
-- ═══════════════════════════════════════════════════════════════
begin;

alter table facturas_compras
  add column if not exists partida_id uuid references partidas_contables(id) on delete set null;

create index if not exists idx_facturas_compras_partida_id
  on facturas_compras(partida_id);

-- Relleno hacia atrás: solo las facturas procesadas cuyo número de documento
-- identifica UNA sola partida viva. Si engancha dos o más, no se toca: no hay
-- forma de saber cuál es y poner la equivocada es peor que no poner ninguna.
with cruce as (
  select f.id as factura_id,
         (array_agg(p.id))[1] as partida_id,
         count(*) as cuantas
    from facturas_compras f
    join partidas_contables p
      on upper(btrim(p.numero_documento)) = upper(btrim(f.numero_factura))
   where f.estado = 'procesada'
     and f.partida_id is null
     and coalesce(btrim(f.numero_factura), '') <> ''
     and coalesce(p.estado, '') <> 'anulada'
   group by f.id
)
update facturas_compras f
   set partida_id = c.partida_id
  from cruce c
 where f.id = c.factura_id
   and c.cuantas = 1;

commit;

notify pgrst, 'reload schema';

-- ── Verificación ──
-- Cuántas facturas procesadas quedaron con vínculo y cuántas sin él.
select count(*) filter (where partida_id is not null) as con_vinculo,
       count(*) filter (where partida_id is null)     as sin_vinculo
  from facturas_compras
 where estado = 'procesada';

-- ── Las que quedaron sin vínculo por documento ambiguo ──
-- Estas son las que hay que amarrar a mano (o dejar así: el cintillo ya no
-- miente, simplemente no muestra partida). Si alguna importa, se corrige con:
--   update facturas_compras set partida_id = (select id from partidas_contables
--     where numero_partida = '6852') where id = '<id de la factura>';
select f.id,
       f.numero_factura,
       f.fecha_factura,
       f.total,
       count(p.id) as partidas_que_enganchan
  from facturas_compras f
  join partidas_contables p
    on upper(btrim(p.numero_documento)) = upper(btrim(f.numero_factura))
 where f.estado = 'procesada'
   and f.partida_id is null
   and coalesce(btrim(f.numero_factura), '') <> ''
 group by f.id, f.numero_factura, f.fecha_factura, f.total
having count(p.id) > 1
 order by count(p.id) desc, f.fecha_factura desc;
