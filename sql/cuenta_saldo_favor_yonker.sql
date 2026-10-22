-- ═══════════════════════════════════════════════════════════════
--  Cuenta de pasivo para el SALDO A FAVOR de clientes Yonker (notas de crédito).
--  Correr en Supabase de CONTAMAX.
--
--  Funciona igual que la cuenta puente de recibos (210101-031):
--    HABER  cuando una nota de crédito queda como "Saldo a favor" del cliente
--    DEBE   cuando el cliente lo gasta (forma de pago "Saldo a favor" en una factura)
--  Su saldo es lo que se le debe en mercadería a los clientes.
--  Tiene que coincidir con IMPORT_CUENTAS.saldo_favor_yonker en js/app.js.
-- ═══════════════════════════════════════════════════════════════
begin;

do $$
declare ocupado text;
begin
  select codigo || ' = ' || nombre into ocupado from catalogo_cuentas where codigo = '210101-032';
  if ocupado is not null then
    raise exception 'El codigo ya esta en uso, no se crea nada: %', ocupado;
  end if;
end $$;

insert into catalogo_cuentas (codigo, nombre, tipo, naturaleza, nivel, cuenta_padre, es_detalle, es_cuenta_puente, activa)
select '210101-032', 'SALDO A FAVOR CLIENTES YONKER (NOTAS DE CREDITO)', p.tipo, p.naturaleza,
       coalesce(p.nivel, 4) + 1, p.id, true, false, true
  from catalogo_cuentas p where p.codigo = '210101';

do $$
begin
  if not exists (select 1 from catalogo_cuentas where codigo = '210101-032') then
    raise exception 'No se creo la cuenta: revisar que exista la cuenta padre 210101.';
  end if;
end $$;

commit;

select codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa
  from catalogo_cuentas where codigo in ('210101-031', '210101-032') order by codigo;
