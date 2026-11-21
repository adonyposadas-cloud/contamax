-- Caja General: quitar el conteo fantasma de L 3,500 y el sobrante que generó
-- ===========================================================================
-- Qué pasó (12 al 14 de noviembre de 2026)
-- ----------------------------------------
-- 12/11, partida #7685 — se pagan L 3,500 a LUIS ARMANDO PADILLA (seguridad y
-- vigilancia). El asiento acredita CAJA CHICA (110101-001), que es de donde
-- salió la plata. Correcto.
--
-- Pero la partida quedó con DOS conteos de billetes, los dos de 7 × L 500:
--     2:15 p.m.  ADONY POSADAS   contra 110102-001  CAJA GENERAL   ← este sobra
--     3:45 p.m.  ARLYN CAROLINA  contra 110101-001  CAJA CHICA     ← este es el bueno
--
-- El conteo de ADONY sacó L 3,500 del arqueo de Caja General sin que la
-- contabilidad los sacara de ahí. A partir de ese momento el sistema creía que
-- en la gaveta había L 3,500 menos de los que de verdad había.
--
-- 14/11, partida #7791 — se arquea Caja General, aparecen L 3,500 "de más" y se
-- registran como SOBRANTE DE EFECTIVO EN CAJA (410306), con su propio conteo de
-- ingreso de 7 × L 500. Ese sobrante nunca existió: era el reflejo del conteo
-- fantasma del día 12.
--
-- Resultado de hoy: los libros de Caja General dicen L 285,634.00 y lo que hay
-- es L 282,134.21. Diferencia L 3,499.79 (L 3,500.00 del error y L 0.21 del
-- redondeo del dólar, que es otro tema y no se toca acá).
--
-- Qué hace este SQL
-- -----------------
--   1. Borra el conteo fantasma del #7685   → el arqueo sube L 3,500
--   2. Anula la #7791 y borra su conteo     → el arqueo baja L 3,500 y los
--                                              libros bajan L 3,500
--
-- Los dos conteos se cancelan entre sí, así que el efectivo contado NO cambia:
-- sigue en L 232,117.00. Lo que baja es el saldo en libros, que es lo que estaba
-- inflado. Por eso los dos pasos van en el mismo archivo: si se corre uno solo,
-- la caja se descuadra L 3,500 para el otro lado.
--
-- Caja Chica no se toca. Hoy cuadra exacto (libros L 4,563.00 = contado
-- L 4,563.00) y ahí el asiento y el conteo sí van de la mano.
--
-- Anular la #7791 es lo mismo que hace el botón de la app para una partida que
-- toca caja: deja el correlativo vivo con estado "anulada" y borra su conteo.
-- Se revisó que la #7791 no tenga nada más colgando (ni libro de compras, ni
-- factura, ni facturas de taxis): solo su conteo.

-- ── ANTES: así tiene que verse ───────────────────────────────────────────────
-- Esperado:  libros 285634.00 · billetes 232117 · dolares 50017.21 · dif 3499.79
select (select sum(case when l.tipo='debito' then l.monto else -l.monto end)
          from lineas_partida l join partidas_contables p on p.id=l.partida_id
         where p.estado='aprobada'
           and (l.cuenta_codigo='110102' or l.cuenta_codigo like '110102-%'))      as libros,
       (select sum(case when cb.tipo='ingreso' then 1 else -1 end *
                   (coalesce(cb.den_1,0)*1+coalesce(cb.den_2,0)*2+coalesce(cb.den_5,0)*5
                   +coalesce(cb.den_10,0)*10+coalesce(cb.den_20,0)*20+coalesce(cb.den_50,0)*50
                   +coalesce(cb.den_100,0)*100+coalesce(cb.den_200,0)*200+coalesce(cb.den_500,0)*500))
          from conteo_billetes cb left join partidas_contables p on p.id=cb.partida_id
         where (cb.cuenta_codigo is null or cb.cuenta_codigo <> '110101-001')
           and (p.estado='aprobada' or cb.partida_id is null))                      as billetes,
       (select saldo_lps from caja_tc_promedio limit 1)                             as dolares;

-- ── 1. El conteo fantasma del 12/11 ──────────────────────────────────────────
-- Las guardas son para que no se lleve por delante el conteo bueno de caja chica
-- ni ningún otro: tiene que ser egreso, de caja general, de exactamente 3,500,
-- y de esa partida.
delete from conteo_billetes
 where id            = '5708ce87-32d7-4209-ae9c-67fffff4107d'
   and partida_id    = 'bfa509be-1e57-46eb-a39f-2a53701caf59'   -- #7685
   and tipo          = 'egreso'
   and cuenta_codigo = '110102-001'
   and total_monto   = 3500.00;

-- ── 2. El sobrante del 14/11 ─────────────────────────────────────────────────
update partidas_contables
   set estado              = 'anulada',
       modificada_por      = 'f2599c0e-6188-42d1-8a2e-7cbb6d8e0c67',   -- ADONY POSADAS
       modificada_at       = now(),
       motivo_modificacion = 'Sobrante inexistente: era el reflejo de un conteo de billetes duplicado en la partida #7685 (L 3,500 que salieron de caja chica y se contaron tambien en caja general). Se borro ese conteo y se anula este ajuste. Ver sql/corregir_arqueo_caja_general_3500.sql'
 where id     = '75e13e7d-ebe1-4aab-904c-5de7e1d6f060'           -- #7791
   and estado = 'aprobada'
   and total  = 3500.00;

-- Su conteo se va con ella, igual que cuando se anula desde la app.
delete from conteo_billetes
 where partida_id    = '75e13e7d-ebe1-4aab-904c-5de7e1d6f060'
   and tipo          = 'ingreso'
   and cuenta_codigo = '110102-001'
   and total_monto   = 3500.00;

-- ── 3. Que quede en la bitácora ──────────────────────────────────────────────
insert into actividad_log (usuario_id, usuario_nombre, usuario_rol, accion, modulo, detalle, referencia_id)
values
 ('f2599c0e-6188-42d1-8a2e-7cbb6d8e0c67', 'ADONY POSADAS', 'super_admin',
  'partida_anulada', 'partidas',
  'Partida #7791 anulada · sobrante de arqueo inexistente, reflejo del conteo duplicado de la #7685',
  '75e13e7d-ebe1-4aab-904c-5de7e1d6f060'),
 ('f2599c0e-6188-42d1-8a2e-7cbb6d8e0c67', 'ADONY POSADAS', 'super_admin',
  'arqueo_corregido', 'partidas',
  'Partida #7685: se borro el conteo de L 3,500 contra caja general (7 x L 500). El pago salio de caja chica y ya tenia su conteo correcto ahi.',
  'bfa509be-1e57-46eb-a39f-2a53701caf59');

-- ── DESPUÉS: así tiene que quedar ────────────────────────────────────────────
-- Esperado:  libros 282134.00 · billetes 232117 · dolares 50017.21 · dif 0.21
-- Los 21 centavos son el redondeo del tipo de cambio del dolar, acumulado desde
-- junio. No es plata faltante; va aparte.
select (select sum(case when l.tipo='debito' then l.monto else -l.monto end)
          from lineas_partida l join partidas_contables p on p.id=l.partida_id
         where p.estado='aprobada'
           and (l.cuenta_codigo='110102' or l.cuenta_codigo like '110102-%'))      as libros,
       (select sum(case when cb.tipo='ingreso' then 1 else -1 end *
                   (coalesce(cb.den_1,0)*1+coalesce(cb.den_2,0)*2+coalesce(cb.den_5,0)*5
                   +coalesce(cb.den_10,0)*10+coalesce(cb.den_20,0)*20+coalesce(cb.den_50,0)*50
                   +coalesce(cb.den_100,0)*100+coalesce(cb.den_200,0)*200+coalesce(cb.den_500,0)*500))
          from conteo_billetes cb left join partidas_contables p on p.id=cb.partida_id
         where (cb.cuenta_codigo is null or cb.cuenta_codigo <> '110101-001')
           and (p.estado='aprobada' or cb.partida_id is null))                      as billetes,
       (select saldo_lps from caja_tc_promedio limit 1)                             as dolares;
