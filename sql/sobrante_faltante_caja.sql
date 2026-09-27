-- ═══════════════════════════════════════════════════════════════
--  SOBRANTES Y FALTANTES DE CAJA · cuenta propia para los ajustes de arqueo
--  Correr en Supabase de CONTAMAX. Va junto con el cambio de js/app.js
--  (generarAjusteArqueo prellena la contracuenta).
--
--  Por qué: los ajustes de arqueo se venían acreditando a Venta Cafetería y
--  Venta Trucha porque la contracuenta salía vacía y el usuario elegía. Entre
--  julio y septiembre 2026 eso metió L. 9,410 netos de "ventas" que no fueron
--  ventas. Un sobrante de caja es dinero sin origen conocido, no una venta.
--
--  El faltante YA tiene cuenta: 620201-002 · OG - FALTANTE DE EFECTIVO EN CAJA.
--  Falta solo su espejo del lado de ingresos.
-- ═══════════════════════════════════════════════════════════════
begin;

-- 0) Frenos: que exista el padre y la cuenta de faltante, y que el código esté libre.
do $$
declare v_nombre text;
begin
  if not exists (select 1 from catalogo_cuentas where codigo = '4103') then
    raise exception 'No existe el grupo 4103 OTROS INGRESOS: revisar el catalogo antes de seguir.';
  end if;
  if not exists (select 1 from catalogo_cuentas where codigo = '620201-002' and activa) then
    raise exception 'No existe (o esta inactiva) la cuenta 620201-002 de faltante de efectivo.';
  end if;
  select nombre into v_nombre from catalogo_cuentas where codigo = '410306';
  if v_nombre is not null then
    raise exception 'El codigo 410306 ya esta en uso por: %. Elegir otro y cambiarlo tambien en js/app.js (CTA_SOBRANTE).', v_nombre;
  end if;
end $$;

-- 1) La cuenta de sobrante, hermana de 410304 (ajuste de inventario por sobrantes)
--    y colgada del mismo padre 4103.
insert into catalogo_cuentas (codigo, nombre, tipo, naturaleza, nivel, cuenta_padre, es_detalle, es_cuenta_puente, activa)
select '410306', 'SOBRANTE DE EFECTIVO EN CAJA',
       p.tipo, p.naturaleza, coalesce(p.nivel, 3) + 1, p.id, true, false, true
  from catalogo_cuentas p
 where p.codigo = '4103';

commit;

notify pgrst, 'reload schema';

-- Verificación: las dos cuentas del par, listas para usarse.
select codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa
  from catalogo_cuentas
 where codigo in ('410306', '620201-002')
 order by codigo;
