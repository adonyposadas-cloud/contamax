-- ══════════════════════════════════════════════
-- MIGRACIÓN: Asistencia, Permisos, Config Planilla
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════

-- 1. Asistencia procesada del reloj marcador
CREATE TABLE IF NOT EXISTS asistencia_reloj (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id uuid REFERENCES empleados(id),
  empleado_nombre text NOT NULL,
  fecha date NOT NULL,
  dia_semana smallint, -- 0=Lun, 5=Sab, 6=Dom
  hora_entrada time,
  hora_salida time,
  minutos_tarde integer DEFAULT 0,
  minutos_he integer DEFAULT 0,          -- horas extra en minutos
  minutos_negativos integer DEFAULT 0,   -- salida anticipada sin permiso
  sin_salida boolean DEFAULT false,
  falta boolean DEFAULT false,
  tiene_permiso boolean DEFAULT false,
  permiso_id uuid,
  periodo text,                          -- "2026-05-Q1"
  lote text,                             -- ID de importación
  notas text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(empleado_id, fecha, periodo)
);

-- 2. Permisos de empleados
CREATE TABLE IF NOT EXISTS permisos_empleados (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id uuid REFERENCES empleados(id),
  empleado_nombre text NOT NULL,
  fecha date NOT NULL,
  hora_salida time,
  motivo text,
  tipo text DEFAULT 'salida_anticipada',  -- salida_anticipada, falta_justificada, permiso_dia
  aprobado_por text,
  created_at timestamptz DEFAULT now()
);

-- 3. Configuración de planilla (IHSS techo, etc.)
CREATE TABLE IF NOT EXISTS config_planilla (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  clave text UNIQUE NOT NULL,
  valor numeric(14,4) NOT NULL,
  descripcion text,
  updated_at timestamptz DEFAULT now()
);

-- Valores iniciales
INSERT INTO config_planilla (clave, valor, descripcion) VALUES
  ('ihss_techo_mensual', 11903.16, 'Techo de cotización IHSS mensual'),
  ('ihss_pct_laboral', 0.025, 'Porcentaje IHSS laboral (2.5%)'),
  ('ihss_pct_patronal', 0.05, 'Porcentaje IHSS patronal (5%)'),
  ('gracia_tarde_min', 30, 'Minutos de gracia acumulados por quincena para llegadas tardes'),
  ('he_gracia_lv_min', 30, 'Minutos después de las 5PM para iniciar HE (L-V)'),
  ('he_bloque_min', 30, 'Tamaño de bloque de HE en minutos')
ON CONFLICT (clave) DO NOTHING;

-- 4. Agregar campos al empleado para impuesto vecinal
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS imp_vecinal_anual numeric(10,2) DEFAULT 0;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS imp_vecinal_cuotas_restantes integer DEFAULT 0;

-- 5. Agregar campo fecha_prestamo y fecha_primera_deduccion a prestamos_empleados
-- (si existe la tabla)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'prestamos_empleados') THEN
    EXECUTE 'ALTER TABLE prestamos_empleados ADD COLUMN IF NOT EXISTS fecha_prestamo date';
    EXECUTE 'ALTER TABLE prestamos_empleados ADD COLUMN IF NOT EXISTS fecha_primera_deduccion date';
    EXECUTE 'ALTER TABLE prestamos_empleados ADD COLUMN IF NOT EXISTS genera_partida boolean DEFAULT true';
  END IF;
END $$;

-- RLS
ALTER TABLE asistencia_reloj ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON asistencia_reloj FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON asistencia_reloj TO anon;
GRANT ALL ON asistencia_reloj TO authenticated;

ALTER TABLE permisos_empleados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON permisos_empleados FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON permisos_empleados TO anon;
GRANT ALL ON permisos_empleados TO authenticated;

ALTER TABLE config_planilla ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON config_planilla FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON config_planilla TO anon;
GRANT ALL ON config_planilla TO authenticated;

-- Índices
CREATE INDEX IF NOT EXISTS idx_asistencia_periodo ON asistencia_reloj (periodo);
CREATE INDEX IF NOT EXISTS idx_asistencia_empleado ON asistencia_reloj (empleado_id, fecha);
CREATE INDEX IF NOT EXISTS idx_permisos_fecha ON permisos_empleados (fecha);
CREATE INDEX IF NOT EXISTS idx_permisos_empleado ON permisos_empleados (empleado_id);
