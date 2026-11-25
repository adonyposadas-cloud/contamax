-- ═══════════════════════════════════════════════════════════════
--  Quitarle "cotiza RAP" a EMP-276 y EMP-946
--
--  Decidido el 25/11/2026: estos dos NO deben estar afiliados al RAP. O sea que el
--  aporte que se les viene acumulando no es una deuda con nadie — es gasto de planilla
--  inflado contra un pasivo inventado, y hay que cortarlo y reversarlo.
--
--  Qué hace: deja de acumularles aporte de ahí en adelante. Las quincenas que se
--  generen después de esto ya no les cargan RL ni FOVIIF.
--
--  Qué NO hace: no toca ni un centavo de lo ya acumulado en 210303-003 y 210303-004.
--  Eso se reversa con una partida aparte, después de ver los números de
--  rap_no_afiliados_acumulado.sql.
--
--  Lo mismo se puede hacer sin SQL, desde RRHH → el expediente de cada uno,
--  destildando "Cotiza RAP". Este archivo sirve para dejar constancia de cuándo y
--  por qué se cambió, y para no equivocarse de empleado.
--
--  Se busca por código: la identidad y el sueldo no tienen por qué quedar escritos
--  en el repositorio.
-- ═══════════════════════════════════════════════════════════════

-- 1) Cómo están AHORA. Mirá esto antes de seguir.
select codigo, activo, cotiza_rap, es_socio
  from empleados
 where codigo in ('EMP-276', 'EMP-946')
 order by codigo;

-- 2) El cambio.
begin;

do $$
declare
  n int;
begin
  -- Tienen que ser exactamente 2. Si son más o menos, algún código cambió y es mejor
  -- parar que tocarle el RAP a quien no era.
  select count(*) into n
    from empleados
   where codigo in ('EMP-276', 'EMP-946');
  if n <> 2 then
    raise exception 'Esperaba 2 empleados con esos códigos y encontré %. Revisá antes de seguir.', n;
  end if;

  update empleados
     set cotiza_rap = false
   where codigo in ('EMP-276', 'EMP-946');

  raise notice 'Listo: a esos 2 ya no se les acumula RAP en las quincenas nuevas.';
end $$;

commit;

-- 3) Cómo quedaron.
select codigo, activo, cotiza_rap, es_socio
  from empleados
 where codigo in ('EMP-276', 'EMP-946')
 order by codigo;

-- 4) Lo que queda pendiente después de esto:
--    · Reversar lo ya acumulado con una partida (debitar 210303-003 y 210303-004,
--      acreditar las cuentas de gasto donde entró: 6101xx-044 el RL y 6101xx-045 el
--      FOVIIF, según el centro de costo de cada uno).
--    · Volver a generar las quincenas de noviembre 2026 si ya estaban hechas con el
--      aporte adentro, o corregirlas a mano.
