-- ═══════════════════════════════════════════════════════════════
--  Soltar el depósito que la pantalla escondía por "ya visto"
--  Correr en Supabase de CONTAMAX. Va junto con el cambio de
--  js/conciliacion_taxis.js que quita esa regla.
--
--  Qué pasó: el 21/10/2026 BAC acreditó un depósito de L.500 descrito
--  "TEF A : 758824341" —la cuenta de destino, no el remitente—, así que no se
--  supo de quién era y quedó sin conciliar. Al día siguiente el banco lo
--  reenvió con la misma referencia (412822905) y ya con el nombre:
--  "TEF DE:ERNESTO JOSUE OSORTO SI", unidad 5840. La pantalla lo descartó por
--  repetido, y como los omitidos salen del cruce tampoco se podía emparejar a
--  mano: el depósito desaparecía.
--
--  Ya no vuelve a ocurrir —ahora solo se omite lo que YA SE CONCILIÓ—, pero la
--  fila del 21 sigue en el historial y el frontend nuevo ya no la mira. Se borra
--  igual porque no corresponde a ese día: el banco terminó fechando ese
--  movimiento el 22, que es donde está su entrega.
--
--  No hay riesgo de doble conteo: se verificó que la referencia no existe en
--  tx_refs_conciliadas, o sea que ese dinero nunca se cruzó contra ninguna
--  entrega. (Distinto del caso de los L.505 ref 412859816 del 15 y 16 de
--  octubre: ese SÍ está conciliado el 15, era un reenvío legítimo y se queda.)
-- ═══════════════════════════════════════════════════════════════
begin;

-- Guardia: si alguien ya la concilió, esto aborta y no borra nada.
do $$
begin
  if exists (select 1 from tx_refs_conciliadas where referencia = '412822905') then
    raise exception 'La referencia 412822905 YA está conciliada: no se borra nada.';
  end if;
end $$;

delete from tx_extracto_refs
 where banco = 'BAC 2'
   and fecha = '2026-10-21'
   and referencia = '412822905'
   and monto = 500.00;

commit;

-- Verificación: debe quedar solo la fila del 22, la que trae el nombre.
select fecha, referencia, monto, descripcion
  from tx_extracto_refs
 where referencia = '412822905'
 order by fecha;

-- ── Auditoría: ¿hay más depósitos perdidos por la misma puerta? ──
-- Referencias que el banco mandó en dos fechas distintas dentro de la ventana
-- de 3 días y que NUNCA se conciliaron. Cada una es un depósito que entró al
-- banco y que la pantalla pudo haber escondido. Revisar uno por uno: algunos
-- serán reenvíos de plata que no es de taxis, pero los que tengan nombre de
-- motorista hay que conciliarlos a mano.
select e.banco, e.referencia, e.monto,
       min(e.fecha) as primera, max(e.fecha) as ultima,
       string_agg(distinct e.descripcion, ' · ') as descripciones
  from tx_extracto_refs e
 where not exists (select 1 from tx_refs_conciliadas c
                    where c.referencia = e.referencia and c.monto = e.monto)
 group by e.banco, e.referencia, e.monto
having count(distinct e.fecha) > 1
   and max(e.fecha) - min(e.fecha) <= 3
 order by max(e.fecha) desc;
