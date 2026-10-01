-- ═══════════════════════════════════════════════════════════════
--  ARCHIVO MENSUAL DEL RAP · campos en la ficha del empleado
--  Correr en Supabase de CONTAMAX. Va junto con el generador del .txt.
--
--  El archivo que se le sube a empresas.rap.hn pide, por afiliado:
--    identidad,apellidos,nombres,patronal,local,0,0,0,0,sueldo,mm/aaaa
--
--  Hacen falta cuatro datos que la ficha no tenía:
--
--  · cotiza_rap  Si la persona entra en el archivo. Por defecto sí. Se usa para
--                los casos que a propósito no se reportan, y así la exclusión
--                queda registrada en la ficha en vez de depender de que quien
--                arma el archivo se acuerde todos los meses.
--
--  · sueldo_rap  Un sueldo distinto al de la planilla, cuando a propósito se
--                declara otro monto. Vacío = se reporta sueldo_mensual, que es
--                lo normal.
--
--  · apellidos   El archivo los pide separados y NO se pueden deducir del nombre
--  · nombres     completo: "Alex Gustavo Estrada" son 2 nombres y 1 apellido,
--                pero "Dagoberto Salgado Flores" es 1 nombre y 2 apellidos. No
--                hay regla. Se siembran abajo con los datos del archivo de
--                septiembre 2026, que ya los trae correctos para 45 personas.
-- ═══════════════════════════════════════════════════════════════
begin;

alter table empleados add column if not exists cotiza_rap boolean not null default true;
alter table empleados add column if not exists sueldo_rap numeric(14,2);
alter table empleados add column if not exists apellidos text;
alter table empleados add column if not exists nombres text;

-- Siembra desde el archivo 3455304-1-09-2026TECNIMAX.txt (45 afiliados).
-- Empareja por identidad normalizada a 13 dígitos; no pisa lo que ya esté escrito.
with datos (ident, apellidos, nombres) as (values
  ('0801200410186','CALIX CARRASCO','ARLYN CAROLINA'),
  ('0801197815670','ESTRADA','ALEX GUSTAVO'),
  ('0801200407312','PEREZ LOZANO','ANIBAL SADRAC'),
  ('0801200003881','CERRATO RODRIGUEZ','AXEL DAVID'),
  ('0801200305887','JUANEZ AMADOR','BAIRON JOSUE'),
  ('1509199600162','ANTUNEZ ZELAYA','CARLOS AMILCAR'),
  ('0801198010565','VALLE RAUDALES','CARLOS ANTONIO'),
  ('0815199400435','FERNANDEZ BUSTILLO','CESAR ANTONIO'),
  ('0801197806341','SALGADO FLORES','DAGOBERTO'),
  ('0801198818394','RODRIGUEZ AVILEZ','DENIS JAVIER'),
  ('0801198126844','LOPEZ MARTINEZ','EDGAR ALFREDO'),
  ('1624198000104','TROCHEZ PINEDA','EDWHARDS WHIFFORD'),
  ('0801200207416','GARCIA RAMIREZ','EDWIN DAVID'),
  ('0801198315920','FORTIN BACA','EDDER NOE'),
  ('0801199305056','RIVERA ESPINOZA','ERIK ARIEL'),
  ('0801199611894','FLORES MARADIAGA','EMERSON JOSUE'),
  ('1701198002911','GUTIERREZ GARCIA','ELY NOE'),
  ('0705199100015','SANCHEZ FLORES','FREDY ALEXANDER'),
  ('0801199719779','PEREZ IRIAS','JOSUE FERNANDO'),
  ('0801200703269','RUIZ BONILLA','JOSUE ISAAC'),
  ('0801198208753','ALVARADO ANDINO','JAVIER ANTONIO'),
  ('0801198419319','VELASQUEZ SANTOS','JUAN CARLOS'),
  ('0801199821353','RENCONCO MIDENCE','JONATHAN ARIEL'),
  ('0801199402554','CERRATO HERNANDEZ','JOSUE ARIEL'),
  ('0801200313412','GIL SALAZAR','JOSE OSCAR'),
  ('0801200004839','MARADIAGA','KARLA VANESSA'),
  ('0820199600372','ALONZO HERNANDEZ','KELIN DINORA'),
  ('0801200522104','ALVARADO ARTEAGA','KENNETH MIGUEL'),
  ('0801198206745','FERRERA CACERES','LUIS FERNANDO'),
  ('0611198300341','GARCIA','MERLIN IVAN'),
  ('0611199600671','HERNANDEZ RODRIGUEZ','MIGUEL ANGEL'),
  ('0801200519713','ANDINO GARCIA','MARLON MANRRIQUE'),
  ('0606199000898','MARTINEZ ESTRADA','MELVIN ANTONIO'),
  ('1503199900733','CACERES BONILLA','NELSON NAUM'),
  ('1501200301109','FLORES SANTOS','OSCAR ORLANDO'),
  ('0801200421907','MARTINEZ ACOSTA','OMAR ALEXANDER'),
  ('0801197520847','FLOREZ ZAVALA','OSCAR ORLANDO'),
  ('0801197910928','BULNES LANZA','REDYN GEOVANNY'),
  ('0801200612011','FONSECA ALVARADO','ROGER ALEXANDER'),
  ('0801200404565','ANDINO GARCIA','SAMY ANTHONIEL'),
  ('0801198718399','ORELLANA FLORES','SANTOS GUADALUPE'),
  ('0801198614558','CARBAJAL PAVON','SELVIN JAVIER'),
  ('0606200500168','CADENAS GUNERA','YORBIN ADONAY'),
  ('1217200000278','OYUELA LOPEZ','YUNI GERARDO'),
  ('0801199201832','RODRIGUEZCRUZ','MADELINE IVETT')
)
update empleados e
   set apellidos = coalesce(e.apellidos, d.apellidos),
       nombres   = coalesce(e.nombres,   d.nombres)
  from datos d
 where lpad(regexp_replace(coalesce(e.identidad, ''), '[^0-9]', '', 'g'), 13, '0') = d.ident;

commit;

notify pgrst, 'reload schema';

-- Verificación: cuántos activos no socios quedan listos para el archivo y
-- cuántos todavía necesitan que se les escriba apellidos y nombres.
select count(*) filter (where cotiza_rap)                                as cotizan,
       count(*) filter (where cotiza_rap and (apellidos is null or nombres is null)) as sin_nombre_partido,
       count(*) filter (where sueldo_rap is not null)                    as con_sueldo_propio
  from empleados
 where activo and not es_socio;
