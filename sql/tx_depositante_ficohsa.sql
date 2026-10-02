-- ═══════════════════════════════════════════════════════════════
--  tx_motoristas_por_depositante · que también lea los depósitos de Ficohsa
--  Correr en Supabase de CONTAMAX. No necesita cambio de frontend.
--
--  El problema: la función filtraba el histórico con
--      where rc.deposito_desc ~* 'TEF\s+DE'
--  y los depósitos de Ficohsa no dicen "TEF DE" en ninguna parte; vienen como
--      Transferencia entre Cuentas-QUIEN DEPOSITA-QUIEN RECIBE
--  Así que el botón "¿a quién le deposita?" contestaba "no hay historial" para
--  TODO depósito de Ficohsa, aunque la persona llevara meses depositando.
--
--  Se vio con ANDREA ISABEL ANDREWS MAYORQUIN: 8 depósitos a la unidad 7656
--  entre el 28-08 y el 27-09-2026, y la pantalla decía que no tenía historial.
--  En tx_refs_conciliadas hay 32 filas de ese formato, todas invisibles.
--
--  La corrección: sacar el depositante de los DOS formatos, igual que ya lo hace
--  la pantalla (ctxNombreTef en js/conciliacion_taxis.js):
--    · "TEF DE: NOMBRE"                       → lo que sigue
--    · "Transferencia entre Cuentas-A-B"      → el tramo del medio (A), porque
--      el último es siempre el titular de la cuenta de Tecnimax y no es pista.
--
--  El resto de la función queda igual.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.tx_motoristas_por_depositante(p_nombre text)
returns table(conductor text, telefono text, unidad text, unidades text,
              veces bigint, ultimo date, depositante text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with obj as (
    select public.tx_nombre_tokens(
             regexp_replace(coalesce(p_nombre, ''), '^\s*TEF\s+DE:?\s*', '', 'i')
           ) as t
  ),
  refs as (
    select rc.unidad,
           rc.fecha_entregas,
           btrim(dep.txt) as dep_txt,
           public.tx_nombre_tokens(dep.txt) as t
    from tx_refs_conciliadas rc
    cross join lateral (
      select case
               when rc.deposito_desc ~* 'TEF\s+DE'
                 then substring(rc.deposito_desc from 'TEF\s+DE:?\s*(.+)$')
               when rc.deposito_desc ~* 'Transferencia\s+entre\s+Cuentas'
                 then split_part(
                        substring(rc.deposito_desc from 'Transferencia\s+entre\s+Cuentas\s*-\s*(.+)$'),
                        '-', 1)
             end as txt
    ) dep
    where dep.txt is not null
      and btrim(dep.txt) <> ''
      and rc.unidad is not null
      and rc.unidad <> ''
  ),
  cal as (
    select r.*
    from refs r
    cross join obj o
    where public.tx_tokens_compat(r.t, o.t)
  ),
  -- quien manejaba esa unidad en esa fecha
  conresuelto as (
    select c.unidad,
           c.fecha_entregas,
           c.dep_txt,
           et.nombre_conductor,
           et.telefono
    from cal c
    left join lateral (
      select e.nombre_conductor, e.telefono
      from entregas_taxis e
      where e.unidad = c.unidad
        and e.nombre_conductor is not null
      order by (e.fecha_deposito::date <= c.fecha_entregas::date) desc,
               abs(e.fecha_deposito::date - c.fecha_entregas::date)
      limit 1
    ) et on true
  ),
  -- clave estable del conductor (sin tildes, tokens normalizados);
  -- si no se pudo resolver, cae a la unidad para no perder la fila
  agrupado as (
    select coalesce(
             nullif(array_to_string(public.tx_nombre_tokens(cr.nombre_conductor), ' '), ''),
             'UNIDAD ' || cr.unidad
           ) as clave,
           cr.*
    from conresuelto cr
  )
  select max(a.nombre_conductor)                       as conductor,
         max(a.telefono)                               as telefono,
         (array_agg(a.unidad order by a.fecha_entregas desc))[1] as unidad,
         string_agg(distinct a.unidad, ', ')           as unidades,
         count(*)                                      as veces,
         max(a.fecha_entregas)                         as ultimo,
         max(a.dep_txt)                                as depositante
  from agrupado a
  group by a.clave
  order by veces desc, ultimo desc;
$function$;

notify pgrst, 'reload schema';

-- Verificación: Andrea tiene que devolver la unidad 7656 con 8 veces.
select * from public.tx_motoristas_por_depositante('ANDREA ISABEL ANDREWS MAYORQUIN');
