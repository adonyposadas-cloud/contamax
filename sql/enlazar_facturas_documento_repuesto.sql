-- Facturas de compra que quedaron sin partida porque el proveedor repuso el documento
-- ===================================================================================
-- Qué pasó
-- --------
-- El proveedor anula la factura y la vuelve a emitir con otro número. Contabilidad
-- le corrige el número a la partida, pero la factura se queda con el número viejo.
-- Como el ÚNICO hilo entre las dos es el texto del número de documento, el vínculo
-- se rompe y la factura aparece para siempre en "Facturas pendientes" sin partida,
-- aunque el gasto sí esté contabilizado. El riesgo es que alguien la vuelva a
-- registrar creyendo que falta.
--
-- Lo que hace este SQL
-- --------------------
-- Escribe partida_id en la factura, que es el vínculo bueno (no depende del texto).
-- NO le cambia el número a la factura: compras la registró con el número del papel
-- que recibió y ese dato es historia. La pantalla muestra los dos:
--     Partida #7818 · doc. reemplazado por 000-002-01-00099891
--
-- Cada UPDATE lleva el total como guarda: si la fila no es la que se espera, no
-- toca nada en vez de enlazar la factura equivocada.
--
-- Confirmado por ADONY el 21/11/2026: el documento bueno de la 99763 es la 99891.

-- 1) 000-002-01-00099763  →  partida #7818  (doc. repuesto: 000-002-01-00099891)
--    Confirmado contra el papel.
update facturas_compras
   set partida_id = 'cae7a504-4acb-4317-815e-2e3f70a1f436',
       updated_at = now()
 where id = '306fe2fc-eec6-47b9-a03e-122f0923531d'
   and total = 497.97
   and partida_id is null;

-- 2) 000-002-01-00099759  →  partida #7819  (doc. repuesto: 000-002-01-00099892)
--    La propia partida lo dice: su descripción termina en "REPOSION 99759".
update facturas_compras
   set partida_id = 'e8ec8ebd-bcdb-4aaa-9a6b-ba1c6636efeb',
       updated_at = now()
 where id = 'f8b95178-b377-4169-8501-5078f2b3fdc6'
   and total = 1763.19
   and partida_id is null;

-- 3) 000-002-01-00099734  →  partida #7848  (doc. repuesto: 000-002-01-00099893)
--    ⚠ ESTE NO ESTÁ DOCUMENTADO. Nadie dejó nota de reposición; lo deduje porque
--    coinciden el monto (3,960.14), el proveedor y el detalle palabra por palabra
--    ("ROTULA-COROLLA 2010, TERMINAL LARGO-CO..."). Si no lo querés dar por bueno,
--    borrá este bloque antes de correr el archivo: los otros dos no dependen de él.
update facturas_compras
   set partida_id = (select id from partidas_contables where numero_partida = 7848),
       updated_at = now()
 where id = 'ad5a0c3c-f307-4b2e-9bc3-f1722bbe61b2'
   and total = 3960.14
   and partida_id is null;

-- Verificación: las tres tienen que salir con su partida y su documento nuevo.
select f.numero_factura      as "doc. en la factura",
       p.numero_partida      as "partida",
       p.estado              as "estado partida",
       p.numero_documento    as "doc. en la partida",
       f.total,
       p.total               as "total partida"
  from facturas_compras f
  join partidas_contables p on p.id = f.partida_id
 where f.id in ('306fe2fc-eec6-47b9-a03e-122f0923531d',
                'f8b95178-b377-4169-8501-5078f2b3fdc6',
                'ad5a0c3c-f307-4b2e-9bc3-f1722bbe61b2')
 order by p.numero_partida;
