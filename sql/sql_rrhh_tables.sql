-- ══════════════════════════════════════════════
-- CONTAMAX · Módulo RRHH · Tablas Supabase
-- ══════════════════════════════════════════════

-- 1) EMPLEADOS - expediente digital
CREATE TABLE IF NOT EXISTS empleados (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo text UNIQUE NOT NULL,              -- Ej: EMP-001
  nombre text NOT NULL,
  nombre_upper text GENERATED ALWAYS AS (upper(nombre)) STORED,
  identidad text,                            -- DNI / identidad hondureña
  puesto text,
  centro_costo text NOT NULL,               -- 610101-001, 610102-001, etc.
  seccion text NOT NULL DEFAULT 'GO Taller', -- GO Taller, GV Taller, GA Taller, GO Yonker, GV Yonker, GA Yonker
  sueldo_mensual numeric(12,2) NOT NULL DEFAULT 0,
  fecha_ingreso date,
  edad integer,
  cuenta_bancaria text,
  banco text DEFAULT 'Bac Credomatic',
  forma_pago text DEFAULT 'BAC',            -- BAC o EFECTIVO
  cuenta_cxc text,                          -- 110301-XXX para anticipos/prestamos
  es_socio boolean DEFAULT false,           -- Maximino, Adony, Alyn
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2) PLANILLAS - encabezado de cada corrida quincenal
CREATE TABLE IF NOT EXISTS planillas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  periodo text NOT NULL,                    -- '2026-05-Q1' = 1-15 mayo 2026
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  estado text DEFAULT 'borrador',           -- borrador, aprobada, pagada
  total_bruto numeric(14,2) DEFAULT 0,
  total_deducciones numeric(14,2) DEFAULT 0,
  total_neto numeric(14,2) DEFAULT 0,
  total_ihss_patronal numeric(14,2) DEFAULT 0,
  notas text,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  aprobada_at timestamptz,
  UNIQUE(periodo)
);

-- 3) DETALLE_PLANILLA - una fila por empleado por quincena
CREATE TABLE IF NOT EXISTS detalle_planilla (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  planilla_id uuid REFERENCES planillas(id) ON DELETE CASCADE,
  empleado_id uuid REFERENCES empleados(id),
  -- Datos snapshot del empleado al momento
  nombre text,
  puesto text,
  centro_costo text,
  seccion text,
  sueldo_mensual numeric(12,2),
  cuenta_bancaria text,
  banco text,
  forma_pago text DEFAULT 'BAC',
  cuenta_cxc text,
  -- Cálculos
  dias_trabajados numeric(4,1) DEFAULT 15,
  sueldo_quincenal numeric(12,2) DEFAULT 0,
  -- Horas extra
  valor_hora_normal numeric(10,4) DEFAULT 0,
  valor_he_25 numeric(10,4) DEFAULT 0,      -- valor hora normal * 1.25
  horas_extra numeric(6,2) DEFAULT 0,
  monto_he numeric(12,2) DEFAULT 0,          -- valor_he_25 * horas_extra
  -- Otros ingresos
  ajuste_sueldo numeric(12,2) DEFAULT 0,
  vacaciones numeric(12,2) DEFAULT 0,
  incapacidad numeric(12,2) DEFAULT 0,
  bonificaciones numeric(12,2) DEFAULT 0,
  otros_ingresos numeric(12,2) DEFAULT 0,
  comisiones_venta numeric(12,2) DEFAULT 0,
  -- Total devengado
  total_devengado numeric(12,2) DEFAULT 0,
  -- Deducciones
  imp_vecinal numeric(10,2) DEFAULT 0,
  anticipos numeric(12,2) DEFAULT 0,
  cxc numeric(12,2) DEFAULT 0,
  trucha numeric(12,2) DEFAULT 0,
  otras_deducciones numeric(12,2) DEFAULT 0,
  ihss_laboral numeric(10,2) DEFAULT 0,      -- 2.5% con techo
  total_deducciones numeric(12,2) DEFAULT 0,
  -- Neto
  sueldo_neto numeric(12,2) DEFAULT 0,
  -- Patronal
  ihss_patronal numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 4) PRESTAMOS_EMPLEADOS
CREATE TABLE IF NOT EXISTS prestamos_empleados (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id uuid REFERENCES empleados(id),
  descripcion text,                          -- "Préstamo personal", "CXC bodega", etc.
  monto_original numeric(12,2) NOT NULL,
  saldo numeric(12,2) NOT NULL,
  cuota_quincenal numeric(12,2) DEFAULT 0,
  tipo text DEFAULT 'prestamo',              -- prestamo, cxc
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 5) TABLA IMPUESTO VECINAL (configurable por año)
CREATE TABLE IF NOT EXISTS tabla_imp_vecinal (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  anio integer NOT NULL DEFAULT 2026,
  rango_desde numeric(12,2) NOT NULL,
  rango_hasta numeric(12,2) NOT NULL,
  impuesto_anual numeric(12,2) NOT NULL,
  activo boolean DEFAULT true
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_empleados_activo ON empleados(activo);
CREATE INDEX IF NOT EXISTS idx_empleados_seccion ON empleados(seccion);
CREATE INDEX IF NOT EXISTS idx_detalle_planilla_pid ON detalle_planilla(planilla_id);
CREATE INDEX IF NOT EXISTS idx_detalle_planilla_eid ON detalle_planilla(empleado_id);
CREATE INDEX IF NOT EXISTS idx_prestamos_empleados_eid ON prestamos_empleados(empleado_id);

-- RLS policies (anon access para la app)
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE planillas ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_planilla ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestamos_empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabla_imp_vecinal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_empleados" ON empleados FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_planillas" ON planillas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_detalle" ON detalle_planilla FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_prestamos_emp" ON prestamos_empleados FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_imp_vecinal" ON tabla_imp_vecinal FOR ALL TO anon USING (true) WITH CHECK (true);
