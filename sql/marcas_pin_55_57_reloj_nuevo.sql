-- ═══════════════════════════════════════════════════════════════
--  MARCACIONES · reasignar los PIN 55 y 57 del reloj nuevo
--  YA SE CORRIÓ EN PRODUCCIÓN el 30-09-2026. Queda como registro de qué se
--  movió y por qué. Si se vuelve a correr, el freno lo aborta.
--
--  Qué pasó: hay dos relojes cargando a marcaciones_raw y la tabla NO guarda de
--  cuál vino cada marca, así que el mismo número es una persona distinta en cada
--  equipo. Los PIN 55 al 58 se crearon en el reloj nuevo el 25-09-2026 y
--  chocaron con números que ya existían en el viejo:
--
--    PIN 55 · reloj viejo (desde 19-02-2026, 642 marcas) → Josue Isaac Ruiz
--    PIN 55 · reloj nuevo (desde 25-09-2026,  16 marcas) → Redyn Bulnes, que en
--             el reloj viejo es el 53
--    PIN 57 · reloj nuevo (25-09-2026, 1 marca) → corresponde al PIN 5
--
--  Los PIN 56 y 58 solo existen en el reloj nuevo, así que no se tocaron: se
--  vinculan a su empleado desde la pantalla de Vincular PIN.
--
--  OJO con la regla usada para separar: acá funcionó user_sn >= 1000 porque esos
--  cuatro PIN nacieron el 25-09. NO es un identificador de reloj: el PIN 5 tiene
--  marcas con user_sn grande desde agosto de 2025. Para un caso nuevo hay que
--  volver a mirar los datos (user_sn + created_at) antes de mover nada.
--
--  La solución de fondo es que el proceso que carga las marcas grabe el equipo
--  de origen, y que el vínculo sea por (reloj, PIN) en vez de solo PIN.
-- ═══════════════════════════════════════════════════════════════
begin;

-- Freno: tienen que ser exactamente las 17 filas identificadas.
do $$
declare n int;
begin
  select count(*) into n from marcaciones_raw
   where pin::text in ('55', '57') and user_sn >= 1000;
  if n <> 17 then
    raise exception 'Se esperaban 17 filas y hay %. Parar y revisar: puede que ya se haya corrido o que hayan llegado marcas nuevas.', n;
  end if;
end $$;

update marcaciones_raw set pin = '53' where pin::text = '55' and user_sn >= 1000;
update marcaciones_raw set pin = '5'  where pin::text = '57' and user_sn >= 1000;

commit;

-- Verificación: el 55 y el 57 quedan solo con su grupo histórico, y el 53
-- recibe las 16 marcas del reloj nuevo.
select pin::text as pin,
       case when user_sn < 1000 then 'chico' else 'grande' end as grupo,
       count(*) as marcas, min(fecha)::text as desde, max(fecha)::text as hasta
  from marcaciones_raw
 where pin::text in ('5', '53', '55', '56', '57', '58')
 group by 1, 2
 order by 1, 2;

-- ═══════════════════════════════════════════════════════════════
--  CONTINUACIÓN · 30-09-2026 por la mañana
--
--  La sincronización de las 08:07 reinsertó las 17 marcas movidas, con el PIN
--  viejo: quedaron por duplicado, una en el empleado correcto y otra en el
--  equivocado. Primero se instaló el trigger anti-duplicados
--  (ver marcaciones_evitar_duplicados.sql) y después se borraron las copias.
--
--  El borrado exigía que la gemela existiera: nunca se borró una marca sola.
--
--  delete from marcaciones_raw m
--   where m.pin::text in ('55', '57') and m.user_sn >= 1000
--     and exists (select 1 from marcaciones_raw g
--                  where g.user_sn = m.user_sn and g.fecha = m.fecha
--                    and g.hora = m.hora and g.id <> m.id);
--
--  Estado final verificado: PIN 5 con 1 marca, PIN 53 con 20 (16 movidas + 4 de
--  la tarde del 29), PIN 55 y 57 sin filas del reloj nuevo.
-- ═══════════════════════════════════════════════════════════════
