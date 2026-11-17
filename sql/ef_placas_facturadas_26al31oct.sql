-- ¿Por qué solo 1 factura aparece conciliada entre el 26 y el 31 de octubre?
--
-- En esos 6 días se facturaron 7 líneas de ESTADO FISICO con 14 placas en
-- total. Una línea concilia únicamente si su placa ya está en estados_fisicos
-- (lo que entra por el recuadro 1, del IHTT/EFTM). Esto dice, placa por placa,
-- cuáles están y en qué estado, y cuáles no están del todo.
WITH facturadas (placa_norm, factura, fecha) AS (
  VALUES
    ('HBA3668', '90833', DATE '2026-10-31'),
    ('HBA0486', '90743', DATE '2026-10-28'),
    ('JAH3129', '90707', DATE '2026-10-26'),
    ('TCJ6654', '90707', DATE '2026-10-26'),
    ('JDE0858', '90707', DATE '2026-10-26'),
    ('JDU0153', '90695', DATE '2026-10-26'),
    ('JBG6744', '90694', DATE '2026-10-26'),
    ('HDA5796', '90694', DATE '2026-10-26'),
    ('HCH2059', '90694', DATE '2026-10-26'),
    ('HBA3650', '90694', DATE '2026-10-26'),
    ('HAT8711', '90694', DATE '2026-10-26'),
    ('HAU8919', '90694', DATE '2026-10-26'),
    ('HAB1714', '90691', DATE '2026-10-26'),
    ('HDI6963', '90690', DATE '2026-10-26')
)
SELECT
  f.placa_norm,
  f.factura,
  f.fecha                                   AS fecha_factura,
  COALESCE(e.categoria, '— NO ESTÁ EN estados_fisicos —') AS categoria,
  e.numero,
  e.fecha_subida,
  e.facturado,
  e.cerrado,
  e.descartado,
  e.conciliado_manual,
  e.factura_ref
FROM facturadas f
LEFT JOIN estados_fisicos e ON e.placa_norm = f.placa_norm
ORDER BY f.fecha DESC, f.placa_norm, e.categoria;
