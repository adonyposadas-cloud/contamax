-- ═══════════════════════════════════════════════════════════════
--  planilla_partidos_ocultos()  ·  correr en Supabase de CONTAMAX
--  Cuenta los empleados ACTIVOS con salario partido (planilla_confidencial
--  y sueldo_confidencial > sueldo_mensual) que el usuario actual NO puede ver.
--  La regla conf_restrict_empleados oculta todo empleado confidencial a quien
--  no tiene es_rol_confidencial(), pero la parte visible de un salario partido
--  va en la planilla GENERAL: si ese usuario la genera, quedan fuera sin pago.
--  La app usa este número para no dejarle generar ni aprobar la general.
--  Solo devuelve un conteo: no expone nombres ni montos.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.planilla_partidos_ocultos()
returns int
language sql stable security definer set search_path = public as $$
  select case when public.es_rol_confidencial() then 0 else (
    select count(*)::int from public.empleados
     where activo
       and coalesce(planilla_confidencial, false)
       and coalesce(sueldo_confidencial, 0) > coalesce(sueldo_mensual, 0)
  ) end
$$;

revoke all on function public.planilla_partidos_ocultos() from public, anon;
grant execute on function public.planilla_partidos_ocultos() to authenticated;
