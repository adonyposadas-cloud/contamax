-- ═══════════════════════════════════════════════════════════════
--  planilla_roster_general()  ·  correr en Supabase de CONTAMAX
--
--  El problema: los empleados con salario partido están marcados
--  planilla_confidencial, y la regla conf_restrict_empleados se los oculta a
--  quien no tiene es_rol_confidencial(). Pero su parte VISIBLE va en la planilla
--  general, así que quien no los ve la generaba sin ellos: quedaban sin pago.
--  Por eso la app bloqueaba la generación (planilla_partidos_ocultos).
--
--  La solución: que el dato llegue ya recortado. El RLS es por FILA, no puede
--  ocultar una columna, así que esto lo resuelve una función: devuelve el
--  personal de la planilla general y, a quien no es super_admin ni contador, le
--  quita el campo sueldo_confidencial. Ve al empleado y su sueldo visible —el
--  que se le paga en la general— y nunca el total real.
--
--  OJO con es_split: la app decide si alguien tiene salario partido comparando
--  sueldo_confidencial contra sueldo_mensual. Si se quita el monto y nada más,
--  esa comparación da falso y la app concluye que es 100% confidencial, o sea
--  que lo SACA de la general: justo lo contrario de lo que se busca. Por eso la
--  clasificación viaja aparte, en un booleano, sin revelar el monto.
--
--  Se conserva planilla_confidencial tal cual porque el cálculo lo usa para
--  otras cosas (por ejemplo excluir a esa persona del RAP). Si se quitara, la
--  misma planilla daría distinto según quién la genere.
--
--  Quedan fuera los 100% confidenciales (marcados y sin complemento): esos no
--  van en la general para nadie.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.planilla_roster_general()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(t.emp order by t.seccion, t.nombre), '[]'::jsonb)
    from (
      select (case when public.es_rol_confidencial()
                   then to_jsonb(e)
                   else to_jsonb(e) - 'sueldo_confidencial'
              end)
             || jsonb_build_object('es_split',
                  coalesce(e.sueldo_confidencial, 0) > coalesce(e.sueldo_mensual, 0)) as emp,
             e.seccion, e.nombre
        from public.empleados e
       where e.activo
         -- excluye solo a los 100% confidenciales; los partidos SÍ van
         and not (coalesce(e.planilla_confidencial, false)
                  and coalesce(e.sueldo_confidencial, 0) <= coalesce(e.sueldo_mensual, 0))
    ) t
$$;

revoke all on function public.planilla_roster_general() from public, anon;
grant execute on function public.planilla_roster_general() to authenticated;

notify pgrst, 'reload schema';

-- Verificación. Corriéndola desde el editor SQL (rol privilegiado) debe decir
-- trae_confidencial = true. Lo que importa es que 'empleados' incluya a los de
-- salario partido y que 'partidos' sea mayor que cero si los hay.
select jsonb_array_length(public.planilla_roster_general()) as empleados,
       (public.planilla_roster_general() -> 0 ? 'sueldo_confidencial') as trae_confidencial,
       (select count(*) from jsonb_array_elements(public.planilla_roster_general()) x
         where (x->>'es_split')::boolean) as partidos;
