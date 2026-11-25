-- ═══════════════════════════════════════════════════════════════
--  Cuánto RAP se le ha acumulado a dos empleados que no están afiliados
--
--  EMP-276 y EMP-946 cotizan RAP en Contamax: cada quincena se les acumula aporte en
--  210303-003 (RL) y 210303-004 (FOVIIF). Pero NO están entre los 44 afiliados de la
--  planilla que el RAP cobra, así que ese pasivo nunca se paga y se queda creciendo.
--  En octubre 2026 eran L 2,085.84 al mes entre los dos.
--
--  Esto NO cambia nada: solo mide. Hay que saber el total y desde cuándo antes de
--  decidir si se reversa (no debían cotizar) o si se deja (hay que afiliarlos).
--
--  Se busca por código de empleado a propósito: la identidad y el sueldo no tienen
--  por qué quedar escritos en el repositorio.
-- ═══════════════════════════════════════════════════════════════

-- 1) Mes por mes, para ver desde cuándo viene.
select p.periodo,
       e.codigo,
       d.rap_patronal                                             as rl,
       d.foviif_patronal + d.foviif_laboral                       as foviif,
       d.rap_patronal + d.foviif_patronal + d.foviif_laboral      as total,
       p.estado
  from detalle_planilla d
  join planillas p  on p.id = d.planilla_id
  join empleados e  on e.id = d.empleado_id
 where e.codigo in ('EMP-276', 'EMP-946')
   and (d.rap_patronal > 0 or d.foviif_patronal > 0 or d.foviif_laboral > 0)
 order by p.periodo, e.codigo;

-- 2) El total de cada uno, que es lo que habría que reversar.
select e.codigo,
       e.activo,
       e.cotiza_rap,
       e.centro_costo,
       count(*)                                                   as quincenas,
       min(p.periodo)                                             as desde,
       max(p.periodo)                                             as hasta,
       sum(d.rap_patronal)                                        as rl_total,
       sum(d.foviif_patronal + d.foviif_laboral)                  as foviif_total,
       sum(d.rap_patronal + d.foviif_patronal + d.foviif_laboral) as total
  from detalle_planilla d
  join planillas p  on p.id = d.planilla_id
  join empleados e  on e.id = d.empleado_id
 where e.codigo in ('EMP-276', 'EMP-946')
   and (d.rap_patronal > 0 or d.foviif_patronal > 0 or d.foviif_laboral > 0)
 group by e.codigo, e.activo, e.cotiza_rap, e.centro_costo
 order by e.codigo;

-- 3) ¿Hay alguien MÁS en la misma situación?
--    Cotiza RAP en Contamax y no aparece en ninguna planilla presentada al RAP.
--    OJO: hoy rap_planilla_detalle solo tiene octubre 2026, así que en la práctica
--    esto pregunta "quién no vino en octubre". Van a salir también las dos bajas de
--    ese mes, que son otro caso: ellos sí estaban afiliados y el RAP los sacó al
--    causar baja. Los que importan son los que están ACTIVOS y con acumulado grande.
select e.codigo,
       e.activo,
       e.fecha_ingreso,
       sum(d.rap_patronal + d.foviif_patronal + d.foviif_laboral) as acumulado
  from empleados e
  join detalle_planilla d on d.empleado_id = e.id
  join planillas p        on p.id = d.planilla_id
 where coalesce(e.cotiza_rap, true)
   and not coalesce(e.es_socio, false)
   and (d.rap_patronal > 0 or d.foviif_patronal > 0 or d.foviif_laboral > 0)
   and not exists (
         select 1
           from rap_planilla_detalle rd
          where rd.empleado_id = e.id)
 group by e.codigo, e.activo, e.fecha_ingreso
 order by acumulado desc;
