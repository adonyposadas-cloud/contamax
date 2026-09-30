-- ═══════════════════════════════════════════════════════════════
--  PARTIDA · Planilla RAP 09/2026 (N° 12140336, pagada el 25/09/2026)
--  Total L. 30495.72 · 45 afiliados
--
--  Debitos:  RAP patronal (-044) y FOVIIF patronal (-045) por seccion y centro,
--            mas el FOVIIF del trabajador a la CxC de cada empleado.
--  Credito:  el banco de donde salio el pago.
--
--  Queda en BORRADOR para que la revises y la apruebes desde Partidas.
-- ═══════════════════════════════════════════════════════════════
begin;

with p as (
  select
    '110103-001'::text   as banco,     -- CHEQUERA BAC TECNIMAX 730262871
    '2026-09-30'::date   as fecha      -- el pago se hizo el 30/09/2026
),
datos (codigo, centro, tipo, monto, descripcion) as (values
    ('610101-044', 'Tecnicentro', 'debito', 11522.85, 'RAP Reserva Laboral 09/2026 · Taller'),
    ('610101-044', 'Yonker', 'debito', 6845.70, 'RAP Reserva Laboral 09/2026 · Yonker'),
    ('610101-045', 'Tecnicentro', 'debito', 928.65, 'FOVIIF patronal 09/2026 · Taller'),
    ('610101-045', 'Yonker', 'debito', 424.60, 'FOVIIF patronal 09/2026 · Yonker'),
    ('610102-044', 'Tecnicentro', 'debito', 1828.57, 'RAP Reserva Laboral 09/2026 · Taller'),
    ('610102-044', 'Yonker', 'debito', 1657.14, 'RAP Reserva Laboral 09/2026 · Yonker'),
    ('610102-045', 'Tecnicentro', 'debito', 150.07, 'FOVIIF patronal 09/2026 · Taller'),
    ('610102-045', 'Yonker', 'debito', 85.79, 'FOVIIF patronal 09/2026 · Yonker'),
    ('610103-044', 'Tecnicentro', 'debito', 4205.71, 'RAP Reserva Laboral 09/2026 · Taller'),
    ('610103-044', 'Yonker', 'debito', 548.57, 'RAP Reserva Laboral 09/2026 · Yonker'),
    ('610103-045', 'Tecnicentro', 'debito', 327.31, 'FOVIIF patronal 09/2026 · Taller'),
    ('610103-045', 'Yonker', 'debito', 27.17, 'FOVIIF patronal 09/2026 · Yonker'),
    ('110301-024', null, 'debito', 46.45, 'FOVIIF 09/2026 · Arlyn Carolina Calix Carrasco'),
    ('110301-002', null, 'debito', 53.95, 'FOVIIF 09/2026 · Alex Gustavo Estrada'),
    ('110301-050', null, 'debito', 27.17, 'FOVIIF 09/2026 · Anibal Sadrac Perez Lozano'),
    ('110301-037', null, 'debito', 27.17, 'FOVIIF 09/2026 · Axel David Cerrato Rodriguez'),
    ('110301-017', null, 'debito', 46.45, 'FOVIIF 09/2026 · Bairon Josue Juanez Amador'),
    ('110301-006', null, 'debito', 31.45, 'FOVIIF 09/2026 · Carlos Amilcar Antunez Zelaya'),
    ('110301-005', null, 'debito', 151.45, 'FOVIIF 09/2026 · Carlos Antonio Valle Raudales'),
    ('110301-064', null, 'debito', 27.17, 'FOVIIF 09/2026 · CESAR ANTONIO FERNANDEZ BUSTILLO'),
    ('110301-008', null, 'debito', 38.95, 'FOVIIF 09/2026 · Dagoberto Salgado Flores'),
    ('110301-061', null, 'debito', 27.17, 'FOVIIF 09/2026 · Denis Javier Rodriguez Avilez'),
    ('110301-012', null, 'debito', 53.95, 'FOVIIF 09/2026 · Edgar Alfredo Lopez Martinez'),
    ('110301-007', null, 'debito', 53.95, 'FOVIIF 09/2026 · Edwhards Whifford Trochez Pineda'),
    ('110301-011', null, 'debito', 27.17, 'FOVIIF 09/2026 · Edwin David Garcia Ramirez'),
    ('110301-014', null, 'debito', 76.45, 'FOVIIF 09/2026 · Edder Noe Fortin'),
    ('110301-047', null, 'debito', 91.45, 'FOVIIF 09/2026 · Erik Ariel Rivera Espinoza'),
    ('110301-053', null, 'debito', 27.17, 'FOVIIF 09/2026 · Emerson Josue Flores Maradiaga'),
    ('110301-057', null, 'debito', 31.45, 'FOVIIF 09/2026 · Ely Noe Gutierrez Garcia'),
    ('110301-026', null, 'debito', 76.45, 'FOVIIF 09/2026 · Fredy Alexander Sanchez'),
    ('110301-009', null, 'debito', 31.45, 'FOVIIF 09/2026 · Josue Fernando Perez Irias'),
    ('110301-039', null, 'debito', 31.45, 'FOVIIF 09/2026 · Josue Isaac Ruiz Bonilla'),
    ('110301-003', null, 'debito', 61.45, 'FOVIIF 09/2026 · Javier Antonio Alvarado Andino'),
    ('110301-059', null, 'debito', 61.45, 'FOVIIF 09/2026 · Juan Carlos Velasquez Santos'),
    ('110301-040', null, 'debito', 27.17, 'FOVIIF 09/2026 · Jonathan Ariel Reconco Midence'),
    ('110301-021', null, 'debito', 27.17, 'FOVIIF 09/2026 · Josue Ariel Cerrato Hernandez'),
    ('110301-034', null, 'debito', 46.45, 'FOVIIF 09/2026 · JOSE OSCAR GIL SALAZAR'),
    ('110301-060', null, 'debito', 27.17, 'FOVIIF 09/2026 · Karla Vannesa Maradiaga'),
    ('110301-042', null, 'debito', 27.17, 'FOVIIF 09/2026 · Kelin Dinora Alonzo Hernandez'),
    ('110301-043', null, 'debito', 61.45, 'FOVIIF 09/2026 · Kenneth Miguel Alvarado Arteaga'),
    ('110301-023', null, 'debito', 27.17, 'FOVIIF 09/2026 · Luis Fernando Ferrera'),
    ('110301-029', null, 'debito', 27.17, 'FOVIIF 09/2026 · Merlin Ivan Garcia'),
    ('110301-013', null, 'debito', 27.17, 'FOVIIF 09/2026 · Miguel Angel Hernandez Rodriguez'),
    ('110301-038', null, 'debito', 27.17, 'FOVIIF 09/2026 · Marlon Manrrique Andino Garcia'),
    ('110301-044', null, 'debito', 121.45, 'FOVIIF 09/2026 · MELVIN ANTONIO MARTINEZ ESTRADA'),
    ('110301-041', null, 'debito', 31.45, 'FOVIIF 09/2026 · Nelson Naum Caceres Bonilla'),
    ('110301-045', null, 'debito', 27.17, 'FOVIIF 09/2026 · Oscar Orlando Flores Santos'),
    ('110301-036', null, 'debito', 27.17, 'FOVIIF 09/2026 · Omar Alexander Martinez Acosta'),
    ('110301-046', null, 'debito', 61.45, 'FOVIIF 09/2026 · Oscar Orlando Flores  Zavala'),
    ('110301-052', null, 'debito', 27.17, 'FOVIIF 09/2026 · Redyn Geovanny Bulnes Lanza'),
    ('110301-035', null, 'debito', 27.17, 'FOVIIF 09/2026 · Roger Alexander Fonseca Alvarado'),
    ('110301-048', null, 'debito', 31.45, 'FOVIIF 09/2026 · Samy Anthoniel Andino Garcia'),
    ('110301-049', null, 'debito', 53.95, 'FOVIIF 09/2026 · Santos Guadalupe Orellana Flores'),
    ('110301-004', null, 'debito', 27.17, 'FOVIIF 09/2026 · Selvin Javier Carbajal'),
    ('110301-058', null, 'debito', 27.17, 'FOVIIF 09/2026 · Yorbin Adonay Cadenas Gunera'),
    ('110301-063', null, 'debito', 27.17, 'FOVIIF 09/2026 · YUNI GERARDO OYUELA LOPEZ'),
    ('110301-015', null, 'debito', 27.17, 'FOVIIF 09/2026 · MADELINE IVETT RODRIGUEZ CRUZ'),
    ('@BANCO@', null, 'credito', 30495.72, 'Pago planilla RAP 09/2026 · N° 12140336')
),
-- Freno 1: toda cuenta tiene que existir en el catalogo
chk_ctas as (
  select string_agg(distinct d.codigo, ', ') as malas
    from datos d left join catalogo_cuentas c
      on c.codigo = (case when d.codigo = '@BANCO@' then (select banco from p) else d.codigo end)
   where c.id is null
),
-- Freno 2: todo centro nombrado tiene que resolverse a uno solo
chk_centros as (
  select string_agg(distinct d.centro, ', ') as malos
    from datos d
   where d.centro is not null
     and (select count(*) from centros_costo cc where cc.nombre ilike '%' || d.centro || '%') <> 1
),
nueva as (
  insert into partidas_contables
    (numero_partida, fecha_partida, descripcion, tipo_origen, estado, total, centro_costo_id)
  select (select coalesce(max(numero_partida), 0) + 1 from partidas_contables),
         (select fecha from p),
         'PLANILLA RAP 09/2026 · N° 12140336 · 45 afiliados',
         'otro', 'borrador', 30495.72, null
   where (select malas from chk_ctas) is null
     and (select malos from chk_centros) is null
  returning id
)
insert into lineas_partida
  (partida_id, cuenta_id, cuenta_codigo, cuenta_nombre, centro_costo_id, tipo, monto, descripcion, aplica_fiscal)
select n.id, c.id, c.codigo, c.nombre,
       (select cc.id from centros_costo cc where d.centro is not null and cc.nombre ilike '%' || d.centro || '%' limit 1),
       d.tipo, d.monto, d.descripcion, false
  from nueva n
  cross join datos d
  join catalogo_cuentas c
    on c.codigo = (case when d.codigo = '@BANCO@' then (select banco from p) else d.codigo end);

-- Freno 3: si algo no cuadro, se aborta todo
do $$
declare v_deb numeric; v_cre numeric; v_n int; v_id uuid;
begin
  select id into v_id from partidas_contables
   where descripcion like 'PLANILLA RAP 09/2026%' order by created_at desc limit 1;
  if v_id is null then
    raise exception 'No se creo la partida: alguna cuenta o centro no se pudo resolver. Revisar los frenos.';
  end if;
  select count(*),
         sum(case when tipo = 'debito' then monto else 0 end),
         sum(case when tipo = 'credito' then monto else 0 end)
    into v_n, v_deb, v_cre
    from lineas_partida where partida_id = v_id;
  if v_n <> 58 then
    raise exception 'Se esperaban 58 lineas y hay %.', v_n;
  end if;
  if abs(v_deb - v_cre) > 0.005 then
    raise exception 'La partida no cuadra: debitos % contra creditos %.', v_deb, v_cre;
  end if;
end $$;

commit;

-- Verificacion
select p.numero_partida, p.fecha_partida, p.estado, p.total,
       count(l.id) as lineas,
       sum(case when l.tipo = 'debito' then l.monto else 0 end) as debitos,
       sum(case when l.tipo = 'credito' then l.monto else 0 end) as creditos
  from partidas_contables p join lineas_partida l on l.partida_id = p.id
 where p.descripcion like 'PLANILLA RAP 09/2026%'
 group by 1, 2, 3, 4;
