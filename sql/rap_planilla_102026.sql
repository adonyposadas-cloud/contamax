-- ═══════════════════════════════════════════════════════════════
--  Carga de la planilla RAP de octubre 2026 (N° 12161156)
--  Fuente: "Detalle de Planilla" del portal del RAP, 44 afiliados, APROBADA.
--
--  Esto no calcula nada: guarda lo que el RAP dice que se presentó, para que
--  RRHH → Aportes RAP pueda poner lado a lado lo presentado contra lo que
--  Contamax calculó en las quincenas. El mes que tiene planilla presentada
--  cuenta con lo presentado; los demás, con el cálculo. Por eso importa que
--  esté cargada: sin ella, octubre se suma dos veces.
--
--  Revisado antes de escribir esto: las 44 filas cuadran con
--    RL  = 4 % del sueldo
--    FEO = FIO = 1,5 % sobre el exceso del piso FOVIIF (L 11,903.13,
--                el mismo valor que config_planilla.foviif_piso_mensual)
--  y los 44 sueldos coinciden con empleados.sueldo_mensual.
--
--  OJO con José Oscar Gil Salazar: está DOS VECES en empleados, EMP-091
--  (inactivo) y EMP-1188 (activo), con la misma identidad. Por eso el enlace
--  usa distinct on y se queda con el activo; si no, el insert reventaría
--  contra el índice único (planilla_id, identidad_norm).
-- ═══════════════════════════════════════════════════════════════
begin;

-- 0) Freno de mano: si ya está cargada, se aborta todo en vez de duplicar.
do $$
begin
  if exists (select 1 from rap_planillas where numero_planilla = '12161156') then
    raise exception 'La planilla 12161156 ya está cargada. Si querés reemplazarla, borrala primero.';
  end if;
end $$;

-- 1) La cabecera
insert into rap_planillas
  (numero_planilla, numero_archivo, archivo, periodo,
   fecha_emision, fecha_limite, estado, n_afiliados,
   total_rl, total_feo, total_fio)
values
  ('12161156', '2026403435',
   '3455304-1-10-2026TECNIMAX_AFPOSADAS_3455304_1_20261104200002.txt',
   '2026-10', date '2026-10-01', date '2026-11-22', 'APROBADA', 44,
   26231.40, 1980.70, 1980.70);

-- 2) El detalle, tal como sale del PDF
with f(identidad, nombre, rl, feo, fio) as (values
    ('0801-1978-15670', 'ALEX GUSTAVO ESTRADA', 620.00, 53.95, 53.95),
    ('0801200407312', 'ANIBAL SADRAC PEREZ LOZANO', 548.57, 27.17, 27.17),
    ('0801200410186', 'ARLYN CAROLINA CALIX CARRASCO', 600.00, 46.45, 46.45),
    ('0801-2000-03881', 'AXEL DAVID CERRATO RODRIGUEZ', 548.57, 27.17, 27.17),
    ('0801-2003-05887', 'BAIRON JOSUE JUANEZ AMADOR', 600.00, 46.45, 46.45),
    ('1509-1996-00162', 'CARLOS AMILCAR ANTUNEZ ZELAYA', 560.00, 31.45, 31.45),
    ('0801-1980-10565', 'CARLOS ANTONIO VALLE RAUDALES', 880.00, 151.45, 151.45),
    ('0815-1994-00435', 'CESAR ANTONIO FERNANDEZ BUSTILLO', 548.57, 27.17, 27.17),
    ('0801-1978-06341', 'DAGOBERTO SALGADO FLORES', 580.00, 38.95, 38.95),
    ('0801-1988-18394', 'DENIS JAVIER RODRIGUEZ AVILEZ', 548.57, 27.17, 27.17),
    ('0801-1983-15920', 'EDDER NOE FORTIN BACA', 800.00, 121.45, 121.45),
    ('0801-1981-26844', 'EDGAR ALFREDO LOPEZ MARTINEZ', 620.00, 53.95, 53.95),
    ('1624-1980-00104', 'EDWHARDS WHIFFORD TROCHEZ PINEDA', 620.00, 53.95, 53.95),
    ('0801-2002-07416', 'EDWIN DAVID GARCIA RAMIREZ', 548.57, 27.17, 27.17),
    ('1701-1980-02911', 'ELY NOE GUTIERREZ GARCIA', 560.00, 31.45, 31.45),
    ('0801-1996-11894', 'EMERSON JOSUE FLORES MARADIAGA', 548.57, 27.17, 27.17),
    ('0801-1993-05056', 'ERIK ARIEL RIVERA ESPINOZA', 720.00, 91.45, 91.45),
    ('0705-1991-00015', 'FREDY ALEXANDER SANCHEZ FLORES', 680.00, 76.45, 76.45),
    ('0801-1982-08753', 'JAVIER ANTONIO ALVARADO ANDINO', 640.00, 61.45, 61.45),
    ('0801-1998-21353', 'JONATHAN ARIEL RECONCO MIDENCE', 548.57, 27.17, 27.17),
    ('0801200313412', 'JOSE OSCAR GIL SALAZAR', 548.57, 27.17, 27.17),
    ('0801-1994-02554', 'JOSUE ARIEL CERRATO HERNANDEZ', 548.57, 27.17, 27.17),
    ('0801-1997-19779', 'JOSUE FERNANDO PEREZ IRIAS', 560.00, 31.45, 31.45),
    ('0801200703269', 'JOSUE ISAAC RUIZ BONILLA', 560.00, 31.45, 31.45),
    ('0801-1984-19319', 'JUAN CARLOS VELASQUEZ SANTOS', 640.00, 61.45, 61.45),
    ('0801-2000-04839', 'KARLA VANNESA MARADIAGA', 600.00, 46.45, 46.45),
    ('0820-1996-00372', 'KELIN DINORA ALONZO HERNANDEZ', 548.57, 27.17, 27.17),
    ('0801200522104', 'KENNETH MIGUEL ALVARADO ARTEAGA', 548.57, 27.17, 27.17),
    ('0801-1982-06745', 'LUIS FERNANDO FERRERA CACERES', 640.00, 61.45, 61.45),
    ('0801-1992-01832', 'MADELINE IVETT RODRIGUEZ CRUZ', 548.57, 27.17, 27.17),
    ('0801200519713', 'MARLON MANRRIQUE ANDINO GARCIA', 548.57, 27.17, 27.17),
    ('0606-1990-00898', 'MELVIN ANTONIO MARTINEZ ESTRADA', 548.57, 27.17, 27.17),
    ('0611-1983-00341', 'MERLIN IVAN GARCIA', 548.57, 27.17, 27.17),
    ('0611-1996-00671', 'MIGUEL ANGEL HERNANDEZ RODRIGUEZ', 548.57, 27.17, 27.17),
    ('1503-1999-00733', 'NELSON NAUM CACERES BONILLA', 800.00, 121.45, 121.45),
    ('0801200421907', 'OMAR ALEXANDER MARTINEZ ACOSTA', 548.57, 27.17, 27.17),
    ('0801-1975-20847', 'OSCAR ORLANDO FLORES ZAVALA', 600.00, 46.45, 46.45),
    ('1501-2003-01109', 'OSCAR ORLANDO FLORES SANTOS', 560.00, 31.45, 31.45),
    ('0801-1979-10928', 'REDYN GEOVANNY BULNES LANZA', 640.00, 61.45, 61.45),
    ('0801200612011', 'ROGER ALEXANDER FONSECA ALVARADO', 548.57, 27.17, 27.17),
    ('0801200404565', 'SAMY ANTHONIEL ANDINO GARCIA', 548.57, 27.17, 27.17),
    ('0801-1987-18399', 'SANTOS GUADALUPE ORELLANA FLORES', 560.00, 31.45, 31.45),
    ('0801-1986-14558', 'SELVIN JAVIER CARBAJAL PAVON', 620.00, 53.95, 53.95),
    ('0606200500168', 'YORBIN ADONAY CADENAS GUNERA', 548.57, 27.17, 27.17)
),
-- Un solo empleado por identidad: primero el activo, y entre iguales el que
-- entró después. Esto es lo que desempata a José Oscar Gil Salazar.
emp as (
  select distinct on (ltrim(regexp_replace(identidad, '[^0-9]', '', 'g'), '0'))
         ltrim(regexp_replace(identidad, '[^0-9]', '', 'g'), '0') as norm,
         id
    from empleados
   order by 1, activo desc, fecha_ingreso desc nulls last
)
insert into rap_planilla_detalle
  (planilla_id, identidad, identidad_norm, nombre, empleado_id, rl, feo, fio, total)
select p.id,
       f.identidad,
       ltrim(regexp_replace(f.identidad, '[^0-9]', '', 'g'), '0'),
       f.nombre,
       emp.id,
       f.rl, f.feo, f.fio,
       f.rl + f.feo + f.fio
  from f
  cross join (select id from rap_planillas where numero_planilla = '12161156') p
  left join emp
    on emp.norm = ltrim(regexp_replace(f.identidad, '[^0-9]', '', 'g'), '0');

-- 3) Que lo cargado sea lo que dice el papel. Cualquier diferencia aborta.
do $$
declare
  v_filas int; v_rl numeric; v_feo numeric; v_fio numeric; v_sueltos int;
begin
  select count(*), sum(rl), sum(feo), sum(fio), count(*) filter (where empleado_id is null)
    into v_filas, v_rl, v_feo, v_fio, v_sueltos
    from rap_planilla_detalle d
    join rap_planillas p on p.id = d.planilla_id
   where p.numero_planilla = '12161156';

  if v_filas <> 44 then
    raise exception 'Se cargaron % filas y el papel dice 44', v_filas;
  end if;
  if v_rl <> 26231.40 or v_feo <> 1980.70 or v_fio <> 1980.70 then
    raise exception 'Los totales no cuadran: RL % (26231.40), FEO % (1980.70), FIO % (1980.70)',
                    v_rl, v_feo, v_fio;
  end if;
  if v_sueltos > 0 then
    raise exception '% afiliados no cazaron con ningún empleado', v_sueltos;
  end if;
end $$;

commit;

-- ─── Para mirar después de correrlo ────────────────────────────
-- Las dos planillas cargadas, una al lado de la otra:
select periodo, numero_planilla, estado, n_afiliados,
       total_rl, total_feo, total_fio,
       total_rl + total_feo + total_fio as total
  from rap_planillas
 order by periodo;

-- Quién entró y quién salió entre septiembre y octubre:
select coalesce(s.nombre, o.nombre) as afiliado,
       case when s.nombre is null then 'entró en octubre'
            when o.nombre is null then 'salió en octubre'
            else 'en ambas' end as estado,
       s.rl as rl_septiembre, o.rl as rl_octubre
  from (select d.identidad_norm, d.nombre, d.rl from rap_planilla_detalle d
         join rap_planillas p on p.id = d.planilla_id where p.periodo = '2026-09') s
  full join
       (select d.identidad_norm, d.nombre, d.rl from rap_planilla_detalle d
         join rap_planillas p on p.id = d.planilla_id where p.periodo = '2026-10') o
    on o.identidad_norm = s.identidad_norm
 where s.identidad_norm is null or o.identidad_norm is null
 order by 1;
