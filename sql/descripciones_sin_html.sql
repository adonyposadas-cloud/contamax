-- ═══════════════════════════════════════════════════════════════
--  Descripciones: quitar < y > al guardar
--  Correr en Supabase de CONTAMAX. No necesita cambio de frontend.
--
--  El problema: las descripciones se pintan con innerHTML en ~270 lugares. Una
--  descripción con <img src=x onerror="..."> ejecuta código en el navegador de
--  quien la vea, con su sesión abierta. Se comprobó: el payload corre.
--
--  El camino realista no es alguien tecleando: es el Excel de Facturas Taxis,
--  que lo arma gente fuera de la oficina y cuyo texto entra sin tocarse.
--
--  Por qué en la base y no en el frontend: hay 21 caminos distintos que escriben
--  partidas, repartidos en seis archivos. Limpiar en cada uno significa tocar
--  los 21 y confiar en que nadie agregue un camino 22 — que es justo lo que pasó
--  con los importadores este mes. Acá es un solo lugar y cubre todo.
--
--  OJO con las comillas: NO se tocan. Las descripciones de repuestos las usan
--  como símbolo de pulgadas ("HC32210JR BALINERA 9\"A1"), y hay 16 filas así en
--  la base. Quitarlas destruiría datos reales. El riesgo de la comilla es otro
--  --rompe los atributos HTML-- y se resolvió escapándola al pintar (escAttr).
--
--  Estado antes de correr esto: 0 filas con < o > en toda la base. O sea que no
--  limpia nada hoy; evita lo que entre mañana.
-- ═══════════════════════════════════════════════════════════════
begin;

create or replace function public.descripcion_sin_html()
returns trigger
language plpgsql
as $function$
begin
  if new.descripcion is not null and new.descripcion ~ '[<>]' then
    new.descripcion := regexp_replace(new.descripcion, '[<>]', '', 'g');
  end if;
  return new;
end;
$function$;

drop trigger if exists tg_descripcion_sin_html on partidas_contables;
create trigger tg_descripcion_sin_html
  before insert or update on partidas_contables
  for each row execute function public.descripcion_sin_html();

drop trigger if exists tg_descripcion_sin_html on lineas_partida;
create trigger tg_descripcion_sin_html
  before insert or update on lineas_partida
  for each row execute function public.descripcion_sin_html();

drop trigger if exists tg_descripcion_sin_html on facturas_taxis;
create trigger tg_descripcion_sin_html
  before insert or update on facturas_taxis
  for each row execute function public.descripcion_sin_html();

commit;

-- Verificación: los tres triggers activos (tgenabled = 'O'), y que las comillas
-- de pulgadas siguen intactas.
select c.relname as tabla, t.tgname, t.tgenabled
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgname = 'tg_descripcion_sin_html'
 order by 1;

select count(*) filter (where descripcion ~ '"') as con_comillas_de_pulgadas,
       count(*) filter (where descripcion ~ '[<>]') as con_html
  from lineas_partida;
