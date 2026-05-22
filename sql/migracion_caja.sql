-- ══════════════════════════════════════════
-- CONTAMAX · Migración: Control de Caja General
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════

-- 1. Agregar estado 'pendiente_caja' a partidas_contables
ALTER TABLE partidas_contables 
  DROP CONSTRAINT IF EXISTS partidas_contables_estado_check;

ALTER TABLE partidas_contables 
  ADD CONSTRAINT partidas_contables_estado_check 
  CHECK (estado IN ('borrador', 'aprobada', 'rechazada', 'pendiente_caja'));

-- 2. Reload PostgREST schema
NOTIFY pgrst, 'reload schema';
