-- ═══════════════════════════════════════════════════════════════
--  Limpiar las facturas que la importación de compras metió repetidas
--  Correr en Supabase de CONTAMAX. Leer el encabezado completo antes.
--
--  QUÉ PASÓ
--  La importación de Taller Alpha volvió a insertar las mismas compras en
--  cada corrida. 42 montones, 92 facturas, 50 copias de sobra. El caso más
--  visible: una compra de EBAY del 21/09 entró 8 veces, una por cada día
--  hábil entre el 23/09 y el 5/10.
--
--  POR QUÉ NO LAS DETECTÓ
--  El control de duplicados de js/app.js (dos consultas, una para crédito y
--  otra para contado) tiene tres fallas que se suman:
--    1. excluye a propósito las compras sin número ('S/F'), que son las que
--       más se repiten;
--    2. busca 'S/F' pero guarda 'SF-<consecutivo>', así que aunque las
--       buscara nunca coincidirían;
--    3. no revisa el error de la consulta. Si falla —y manda todos los
--       números del reporte en una sola URL, que con cientos de facturas se
--       pasa de largo—, la lista de duplicados sale vacía y la importación
--       sigue como si todo fuera nuevo, sin avisar.
--  Esto se arregla en el código aparte. Este archivo solo limpia lo que ya
--  entró.
--
--  QUÉ HACE ESTE ARCHIVO
--  1. Copia a una tabla de respaldo todo lo que va a tocar.
--  2. De cada montón deja UNA factura y borra las demás. Se queda la que ya
--     tiene partida vinculada; si ninguna la tiene, la más vieja.
--  3. Devuelve a 'pendiente' nueve facturas que quedaron marcadas como
--     procesadas sin tener partida viva detrás (L.12,469.58 de compras que
--     hoy no están en ningún lado y que nadie reclama porque el sistema las
--     da por hechas).
--
--  QUÉ **NO** HACE, A PROPÓSITO
--  No anula la partida 1770 (IMPRESSA, L.2,293.39, idéntica a la 1769, el
--  único gasto que sí quedó contabilizado dos veces). Esa se anula DESDE LA
--  APLICACIÓN, porque al anular el sistema también limpia libro de compras,
--  conteos y demás tablas ligadas. Anularla por SQL dejaría esa basura viva.
-- ═══════════════════════════════════════════════════════════════

-- ── PASO 1 · Respaldo. Correr esto solo y revisarlo antes de seguir. ──
create table if not exists bak_facturas_dup_oct2026 as
with grupos as (
  select *,
         row_number() over (
           partition by numero_factura, fecha_factura, total
           order by (partida_id is null), created_at
         ) as n
    from facturas_compras
   where observaciones like '[IMP-COMPRA]%'
)
select * from grupos where n > 1;

-- Debe decir 50.
select count(*) as copias_respaldadas from bak_facturas_dup_oct2026;

-- Qué se va a borrar, para leerlo antes de borrarlo.
select numero_factura, fecha_factura, total, estado, created_at
  from bak_facturas_dup_oct2026
 order by total desc, numero_factura;


-- ── PASO 2 · Borrar las copias. Solo después de revisar el paso 1. ──
begin;

do $$
declare n int;
begin
  select count(*) into n from bak_facturas_dup_oct2026;
  if n <> 50 then
    raise exception 'El respaldo tiene % filas y se esperaban 50. No se borra nada.', n;
  end if;
end $$;

delete from facturas_compras
 where id in (select id from bak_facturas_dup_oct2026);

commit;

-- Verificación: no debe quedar ningún montón con más de una copia.
select numero_factura, fecha_factura, total, count(*) as copias
  from facturas_compras
 where observaciones like '[IMP-COMPRA]%'
 group by numero_factura, fecha_factura, total
having count(*) > 1;


-- ── PASO 3 · Devolver a la cola las compras que nunca se contabilizaron ──
-- Cinco no tienen ninguna partida; cuatro tienen la partida anulada. En las
-- nueve la factura quedó en 'procesada', que es lo que las esconde. Al pasar
-- a 'pendiente' vuelven a la pantalla de Facturas pendientes para que alguien
-- les haga la partida.
begin;

update facturas_compras
   set estado = 'pendiente'
 where numero_factura in (
         '003-001-01-006793',      -- 4,022.09  sin partida
         '009-002-01-0013198',     -- 2,439.15  sin partida
         '003-001-01-0061122',     -- 1,698.14  sin partida
         '003-001-1-0059844',      --   594.80  sin partida
         '003-001-0100614094',     --   428.24  sin partida
         '89144',                  -- 1,890.91  partida 4361 anulada
         '89159',                  -- 1,087.44  partida 4363 anulada
         '89165',                  --   162.77  partida 4362 anulada
         '0036-001-01-00609400'    --   146.04  partida 3897 anulada
       )
   and estado = 'procesada'
   and partida_id is null;

commit;

-- Verificación: nueve facturas de vuelta en la cola, L.12,469.58 en total.
select numero_factura, fecha_factura, total, estado
  from facturas_compras
 where numero_factura in (
         '003-001-01-006793','009-002-01-0013198','003-001-01-0061122',
         '003-001-1-0059844','003-001-0100614094',
         '89144','89159','89165','0036-001-01-00609400')
 order by total desc;


-- ── Si algo salió mal, así se devuelve todo ──
-- insert into facturas_compras
--   select id, <columnas...> from bak_facturas_dup_oct2026;
-- El respaldo guarda la fila completa más la columna n; al reinsertar hay que
-- nombrar las columnas, no usar select *. La tabla de respaldo NO se borra
-- hasta que el cierre del mes esté hecho y revisado.
