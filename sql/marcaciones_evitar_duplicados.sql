-- ═══════════════════════════════════════════════════════════════
--  MARCACIONES · evitar que la sincronización reinserte la misma marca
--
--  Qué pasó (30-09-2026): la carga de las 08:07 volvió a mandar los registros
--  del 25 al 29 y los insertó de nuevo. Se ve claro en los pares: misma fecha,
--  misma hora y el MISMO user_sn, cargados en momentos distintos. Como entre
--  medio se había corregido el PIN a mano (55 → 53, 57 → 5), la copia volvió
--  con el PIN viejo y la marca quedó en dos empleados a la vez.
--
--  El cargador SÍ desduplica por PIN: en toda la tabla (38.014 filas) los únicos
--  repetidos son esos 17, y los 17 tienen PIN distinto. O sea que esto se rompe
--  únicamente cuando se corrige un PIN a mano, que es justo lo que vamos a
--  seguir necesitando mientras la tabla no guarde de qué reloj vino cada marca.
--
--  Por qué un trigger y no un índice único: el proceso que carga las marcas vive
--  en otro repo y no sabemos si usa INSERT simple. Con un índice único, la
--  primera fila repetida abortaría el lote entero y dejarían de llegar marcas,
--  que es peor que el problema. El trigger descarta la fila repetida en
--  silencio: el cargador no falla y el duplicado no entra.
--
--  La clave es user_sn + fecha + hora, SIN el PIN: los duplicados observados
--  difieren justamente en el PIN, así que incluirlo no atraparía nada.
--
--  Chequeo previo hecho el 30-09-2026: 17 grupos repetidos, 17 filas de más,
--  los 17 con PIN distinto, todos entre el 25 y el 29 de septiembre. Ninguna
--  repetición legítima en el resto del histórico.
-- ═══════════════════════════════════════════════════════════════
begin;

-- Índice para que la comprobación del trigger no cueste en cada insert
create index if not exists ix_marcaciones_raw_dedupe
  on marcaciones_raw (user_sn, fecha, hora);

create or replace function public.marcaciones_raw_evitar_duplicado()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Sin user_sn no hay con qué comparar: pasa como siempre.
  if new.user_sn is null then
    return new;
  end if;
  if exists (
    select 1 from marcaciones_raw m
     where m.user_sn = new.user_sn
       and m.fecha   = new.fecha
       and m.hora    = new.hora
  ) then
    return null;   -- ya estaba: se descarta y el cargador sigue sin error
  end if;
  return new;
end;
$function$;

drop trigger if exists tg_marcaciones_raw_evitar_duplicado on marcaciones_raw;
create trigger tg_marcaciones_raw_evitar_duplicado
  before insert on marcaciones_raw
  for each row execute function public.marcaciones_raw_evitar_duplicado();

commit;

-- Verificación: el trigger tiene que quedar activo (tgenabled = 'O').
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'public.marcaciones_raw'::regclass
   and not tgisinternal;
