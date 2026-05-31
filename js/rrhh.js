// ══════════════════════════════════════════════
// ── MÓDULO RRHH · js/rrhh.js
// ── Expediente de empleados, planilla quincenal, préstamos
// ══════════════════════════════════════════════
;(function(){
"use strict";

const getSb = () => window._sb
const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── STATE ──
let allEmpleados = []
let filteredEmpleados = []
let editingEmpleadoId = null
let currentPlanilla = null       // planilla header
let currentDetalle = []          // detalle rows
let editingDetalleIdx = null     // index in currentDetalle being edited
let allPrestamosEmp = []

// ── Configuración de cuentas contables por sección ──
const CUENTAS_SECCION = {
  'GO Taller': {
    sueldos: '610101-001', he: '610101-002', vacaciones: '610101-005',
    bonificaciones: '610101-007', incapacidades: '610101-036',
    otros: '610101-037', ihss_laboral: '210303-001', ihss_patronal_gasto: '610101-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301', trucha: '210404-001',
    chequera: '110103-001'
  },
  'GV Taller': {
    sueldos: '610102-001', he: '610102-002', vacaciones: '610102-005',
    bonificaciones: '610102-007', incapacidades: '610102-039',
    otros: '610102-040', ihss_laboral: '210303-001', ihss_patronal_gasto: '610102-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301', trucha: '210404-001',
    chequera: '110103-001'
  },
  'GA Taller': {
    sueldos: '610103-001', he: '610103-002', vacaciones: '610103-005',
    bonificaciones: '610103-031', incapacidades: '610103-029',
    otros: '610103-030', ihss_laboral: '210303-001', ihss_patronal_gasto: '610103-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301', trucha: '210404-001',
    chequera: '110103-001'
  },
  'GO Yonker': {
    sueldos: '610101-001', he: '610101-002', vacaciones: '610101-005',
    bonificaciones: '610101-007', incapacidades: '610101-036',
    otros: '610101-037', ihss_laboral: '210303-001', ihss_patronal_gasto: '610101-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301', trucha: '410305-002',
    chequera: '110103-001'
  },
  'GV Yonker': {
    sueldos: '610102-001', he: '610102-002', vacaciones: '610102-005',
    bonificaciones: '610102-007', incapacidades: '610102-039',
    otros: '610102-040', ihss_laboral: '210303-001', ihss_patronal_gasto: '610102-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301', trucha: '410305-002',
    chequera: '110103-001'
  },
  'GA Yonker': {
    sueldos: '610103-001', he: '610103-002', vacaciones: '610103-005',
    bonificaciones: '610103-031', incapacidades: '610103-029',
    otros: '610103-030', ihss_laboral: '210303-001', ihss_patronal_gasto: '610103-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301', trucha: '410305-002',
    chequera: '110103-001'
  }
}

// IHSS constants (Honduras 2026)
const IHSS_TECHO_MENSUAL = 11903.16  // default, overridden by config_planilla
const IHSS_PCT_LABORAL = 0.025       // default 2.5%
const IHSS_PCT_PATRONAL = 0.05       // default ~5%

function getIHSSConfig() {
  // Try to get from config_planilla (loaded by asistencia module)
  const cfg = window._configPlanilla || {}
  return {
    techo: cfg.ihss_techo_mensual || IHSS_TECHO_MENSUAL,
    pctLaboral: cfg.ihss_pct_laboral || IHSS_PCT_LABORAL,
    pctPatronal: cfg.ihss_pct_patronal || IHSS_PCT_PATRONAL
  }
}

// ══════════════════════════════════════════════
// ═══  1. EXPEDIENTE DE EMPLEADOS  ═══
// ══════════════════════════════════════════════

window.loadEmpleados = async () => {
  const { data, error } = await getSb().from('empleados').select('*').order('seccion').order('nombre')
  if (error) { window.toast?.('Error cargando empleados: ' + error.message, 'error'); return }
  allEmpleados = data || []
  filtrarEmpleados()
  // Stats
  const activos = allEmpleados.filter(e => e.activo)
  const socios = allEmpleados.filter(e => e.es_socio)
  const totalPlanilla = activos.reduce((s, e) => s + (e.sueldo_mensual || 0), 0)
  document.getElementById('stat-emp-total').textContent = allEmpleados.length
  document.getElementById('stat-emp-activos').textContent = activos.length
  document.getElementById('stat-emp-socios').textContent = socios.length
  document.getElementById('stat-emp-planilla').textContent = 'L. ' + fmt(totalPlanilla)
}

window.filtrarEmpleados = () => {
  const q = (document.getElementById('emp-buscar')?.value || '').toLowerCase()
  const sec = document.getElementById('emp-filtro-seccion')?.value || ''
  const est = document.getElementById('emp-filtro-estado')?.value || ''

  filteredEmpleados = allEmpleados.filter(e => {
    if (q && !e.nombre.toLowerCase().includes(q) && !(e.identidad || '').toLowerCase().includes(q)) return false
    if (sec && e.seccion !== sec) return false
    if (est === 'activo' && !e.activo) return false
    if (est === 'inactivo' && e.activo) return false
    return true
  })

  const tbody = document.getElementById('tbody-empleados')
  if (!tbody) return
  tbody.innerHTML = filteredEmpleados.map((e, i) => `
    <tr style="${!e.activo ? 'opacity:0.5' : ''}">
      <td>${i + 1}</td>
      <td><strong>${e.nombre}</strong>${e.es_socio ? ' <span style="color:var(--gold);font-size:11px">★ SOCIO</span>' : ''}</td>
      <td>${e.puesto || '—'}</td>
      <td><span style="font-size:11px;padding:2px 8px;background:var(--bg1);border-radius:4px">${e.seccion}</span></td>
      <td style="text-align:right">L. ${fmt(e.sueldo_mensual)}</td>
      <td>${e.fecha_ingreso || '—'}</td>
      <td>${e.banco || '—'}</td>
      <td>${e.activo ? '<span style="color:var(--green)">●</span> Activo' : '<span style="color:var(--red)">●</span> Inactivo'}</td>
      <td>
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:12px" onclick="editarEmpleado('${e.id}')">✏️</button>
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:12px" onclick="toggleEmpleadoActivo('${e.id}', ${e.activo})">${e.activo ? '🚫' : '✅'}</button>
      </td>
    </tr>
  `).join('')
}

window.openModalEmpleado = () => {
  editingEmpleadoId = null
  document.getElementById('modal-emp-title').textContent = 'Nuevo empleado'
  ;['emp-nombre','emp-identidad','emp-puesto','emp-centro','emp-sueldo','emp-fecha-ingreso','emp-edad','emp-cta-banco','emp-cxc'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = ''
  })
  document.getElementById('emp-seccion').value = 'GO Taller'
  document.getElementById('emp-banco').value = 'Bac Credomatic'
  document.getElementById('emp-forma-pago').value = 'BAC'
  document.getElementById('emp-es-socio').checked = false
  openModal('modal-empleado')
}

window.editarEmpleado = (id) => {
  const e = allEmpleados.find(x => x.id === id)
  if (!e) return
  editingEmpleadoId = id
  document.getElementById('modal-emp-title').textContent = 'Editar empleado'
  document.getElementById('emp-nombre').value = e.nombre || ''
  document.getElementById('emp-identidad').value = e.identidad || ''
  document.getElementById('emp-puesto').value = e.puesto || ''
  document.getElementById('emp-seccion').value = e.seccion || 'GO Taller'
  document.getElementById('emp-centro').value = e.centro_costo || ''
  document.getElementById('emp-sueldo').value = e.sueldo_mensual || ''
  document.getElementById('emp-fecha-ingreso').value = e.fecha_ingreso || ''
  document.getElementById('emp-edad').value = e.edad || ''
  document.getElementById('emp-cta-banco').value = e.cuenta_bancaria || ''
  document.getElementById('emp-banco').value = e.banco || 'Bac Credomatic'
  document.getElementById('emp-cxc').value = e.cuenta_cxc || ''
  document.getElementById('emp-forma-pago').value = e.forma_pago || 'BAC'
  document.getElementById('emp-es-socio').checked = !!e.es_socio
  openModal('modal-empleado')
}

window.guardarEmpleado = async () => {
  const nombre = document.getElementById('emp-nombre').value.trim()
  if (!nombre) { window.toast?.('El nombre es obligatorio', 'error'); return }
  const payload = {
    nombre,
    identidad: document.getElementById('emp-identidad').value.trim() || null,
    puesto: document.getElementById('emp-puesto').value.trim() || null,
    seccion: document.getElementById('emp-seccion').value,
    centro_costo: document.getElementById('emp-centro').value.trim() || null,
    sueldo_mensual: parseFloat(document.getElementById('emp-sueldo').value) || 0,
    fecha_ingreso: document.getElementById('emp-fecha-ingreso').value || null,
    edad: parseInt(document.getElementById('emp-edad').value) || null,
    cuenta_bancaria: document.getElementById('emp-cta-banco').value.trim() || null,
    banco: document.getElementById('emp-banco').value,
    cuenta_cxc: document.getElementById('emp-cxc').value.trim() || null,
    forma_pago: document.getElementById('emp-forma-pago').value,
    es_socio: document.getElementById('emp-es-socio').checked,
    updated_at: new Date().toISOString()
  }

  let error
  if (editingEmpleadoId) {
    ;({ error } = await getSb().from('empleados').update(payload).eq('id', editingEmpleadoId))
  } else {
    // Generate codigo
    const maxCode = allEmpleados.reduce((m, e) => {
      const n = parseInt((e.codigo || '').replace('EMP-', ''))
      return isNaN(n) ? m : Math.max(m, n)
    }, 0)
    payload.codigo = 'EMP-' + String(maxCode + 1).padStart(3, '0')
    ;({ error } = await getSb().from('empleados').insert(payload))
  }

  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  closeModal('modal-empleado')
  window.toast?.(editingEmpleadoId ? 'Empleado actualizado' : 'Empleado creado', 'ok')
  await loadEmpleados()
}

window.toggleEmpleadoActivo = async (id, activo) => {
  if (!confirm(activo ? '¿Desactivar este empleado?' : '¿Reactivar este empleado?')) return
  const { error } = await getSb().from('empleados').update({ activo: !activo, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  window.toast?.(activo ? 'Empleado desactivado' : 'Empleado reactivado', 'ok')
  await loadEmpleados()
}

// ── Importar empleados desde Excel ──
window.importarEmpleadosExcel = async () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.xlsx,.xls'
  input.onchange = async (ev) => {
    const file = ev.target.files[0]
    if (!file) return
    const XLSX = window.XLSX
    const data = await file.arrayBuffer()
    const wb = XLSX.read(data, { type: 'array', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

    // Parse the Tecnimax format: find employee rows by looking for numeric values in col 0 (index)
    const empleadosToImport = []
    let currentSeccion = 'GO Taller'
    let currentCentro = '610101-001'

    const seccionMap = {
      'GASTOS OPERATIVOS TALLER': { seccion: 'GO Taller', centro: '610101-001' },
      'GASTOS VENTAS TALLER': { seccion: 'GV Taller', centro: '610102-001' },
      'GASTO DE ADMINISTRACION TALLER': { seccion: 'GA Taller', centro: '610103-001' },
      'GASTO OPERATIVOS YONKER': { seccion: 'GO Yonker', centro: 'GO Yonker' },
      'GASTO VENTAS YONKER': { seccion: 'GV Yonker', centro: 'GV Yonker' },
      'GASTO ADMINISTRATIVOS  YONKER': { seccion: 'GA Yonker', centro: 'GA Yonker' },
    }

    for (const row of rows) {
      // Detect section headers
      const c2 = String(row[2] || '').trim()
      for (const [key, val] of Object.entries(seccionMap)) {
        if (c2.toUpperCase().includes(key.toUpperCase())) {
          currentSeccion = val.seccion
          currentCentro = val.centro
          break
        }
      }
      // Detect employee rows (col 0 is numeric index)
      const idx = row[0]
      if (typeof idx === 'number' && idx > 0 && row[2]) {
        const nombre = String(row[2]).trim()
        if (nombre.toUpperCase().includes('TOTAL')) continue
        empleadosToImport.push({
          nombre,
          puesto: String(row[3] || '').trim() || null,
          centro_costo: String(row[4] || currentCentro).trim(),
          seccion: currentSeccion,
          identidad: String(row[5] || '').trim() || null,
          edad: row[6] || null,
          cuenta_bancaria: String(row[7] || '').trim() || null,
          banco: String(row[8] || 'Bac Credomatic').trim(),
          fecha_ingreso: row[9] ? (row[9] instanceof Date ? row[9].toISOString().slice(0, 10) : String(row[9]).slice(0, 10)) : null,
          sueldo_mensual: row[10] || 0,
          cuenta_cxc: String(row[27] || '').trim() || null,
          forma_pago: String(row[36] || '').toUpperCase() === 'EFECTIVO' ? 'EFECTIVO' : 'BAC',
          activo: true,
          es_socio: false,
        })
      }
    }

    if (empleadosToImport.length === 0) {
      window.toast?.('No se encontraron empleados en el archivo', 'error')
      return
    }

    if (!confirm(`Se encontraron ${empleadosToImport.length} empleados.\n¿Importar al sistema? (se omitirán duplicados por identidad)`)) return

    let imported = 0, skipped = 0
    for (const emp of empleadosToImport) {
      // Check if already exists by identidad
      if (emp.identidad) {
        const existing = allEmpleados.find(e => e.identidad === emp.identidad)
        if (existing) { skipped++; continue }
      }
      // Generate code
      const maxCode = allEmpleados.reduce((m, e) => {
        const n = parseInt((e.codigo || '').replace('EMP-', ''))
        return isNaN(n) ? m : Math.max(m, n)
      }, imported)
      emp.codigo = 'EMP-' + String(maxCode + imported + 1).padStart(3, '0')

      const { error } = await getSb().from('empleados').insert(emp)
      if (!error) {
        imported++
        allEmpleados.push({ ...emp, id: 'temp' })
      }
    }

    window.toast?.(`Importados: ${imported} | Omitidos (duplicados): ${skipped}`, 'ok')
    await loadEmpleados()
  }
  input.click()
}


// ══════════════════════════════════════════════
// ═══  2. PLANILLA QUINCENAL  ═══
// ══════════════════════════════════════════════

window.initPlanilla = async () => {
  // Load IHSS config from DB
  try {
    const { data } = await getSb().from('config_planilla').select('*')
    if (data) {
      const cfg = {}
      for (const c of data) cfg[c.clave] = parseFloat(c.valor)
      window._configPlanilla = cfg
    }
  } catch(e) {}
  
  // Set default year/month
  const now = new Date()
  const selAnio = document.getElementById('pl-anio')
  selAnio.innerHTML = ''
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
    selAnio.innerHTML += `<option value="${y}" ${y === now.getFullYear() ? 'selected' : ''}>${y}</option>`
  }
  document.getElementById('pl-mes').value = now.getMonth() + 1
  document.getElementById('pl-quincena').value = now.getDate() <= 15 ? 'Q1' : 'Q2'

  // Load employees if not loaded
  if (allEmpleados.length === 0) loadEmpleados()
}

window.regenerarPlanilla = async () => {
  if (!confirm('¿Regenerar la planilla? Se borrarán los datos actuales y se recalculará todo.')) return
  if (!currentPlanilla) return
  
  // Delete existing details and header
  await getSb().from('detalle_planilla').delete().eq('planilla_id', currentPlanilla.id)
  await getSb().from('planillas').delete().eq('id', currentPlanilla.id)
  currentPlanilla = null
  currentDetalle = []
  document.getElementById('pl-existing').classList.add('hidden')
  document.getElementById('planilla-resultado').classList.add('hidden')
  
  // Re-generate
  await generarPlanilla()
}

window.generarPlanilla = async () => {
  const anio = parseInt(document.getElementById('pl-anio').value)
  const mes = parseInt(document.getElementById('pl-mes').value)
  const quincena = document.getElementById('pl-quincena').value
  const periodo = `${anio}-${String(mes).padStart(2, '0')}-${quincena}`

  const fechaInicio = new Date(anio, mes - 1, quincena === 'Q1' ? 1 : 16)
  const fechaFin = quincena === 'Q1'
    ? new Date(anio, mes - 1, 15)
    : new Date(anio, mes, 0) // last day of month

  // Check if planilla already exists
  const { data: existing } = await getSb().from('planillas').select('*').eq('periodo', periodo).single()
  if (existing) {
    document.getElementById('pl-existing').classList.remove('hidden')
    document.getElementById('pl-existing-msg').textContent =
      `Ya existe una planilla para este período (estado: ${existing.estado}). Se cargará para edición.`
    currentPlanilla = existing
    // Load existing details
    const { data: det } = await getSb().from('detalle_planilla')
      .select('*').eq('planilla_id', existing.id).order('seccion').order('nombre')
    currentDetalle = det || []
    renderPlanilla()
    return
  }

  document.getElementById('pl-existing').classList.add('hidden')

  // Load empleados activos (not socios)
  if (allEmpleados.length === 0) {
    const { data } = await getSb().from('empleados').select('*').eq('activo', true).order('seccion').order('nombre')
    allEmpleados = data || []
  }

  const activos = allEmpleados.filter(e => e.activo)

  // Create planilla header
  const { data: planilla, error: pErr } = await getSb().from('planillas').insert({
    periodo,
    fecha_inicio: fechaInicio.toISOString().slice(0, 10),
    fecha_fin: fechaFin.toISOString().slice(0, 10),
    estado: 'borrador',
    created_by: window._currentProfile?.()?.auth_user_id || null
  }).select().single()

  if (pErr) { window.toast?.('Error creando planilla: ' + pErr.message, 'error'); return }
  currentPlanilla = planilla

  // Generate detail for each employee
  // Check for attendance data
  // Asistencia: preferir la base de datos (independiente de pestaña/refresh),
  // con respaldo a la variable en memoria si no hay datos guardados para el período.
  let asistencia = []
  try {
    if (window.resumenAsistenciaDesdeDB) {
      asistencia = await window.resumenAsistenciaDesdeDB(anio, mes, quincena) || []
    }
  } catch (e) { console.error('resumenAsistenciaDesdeDB:', e) }
  if (!asistencia.length) asistencia = window._asistenciaResumen || []

  // ── Cargar anticipos y trucha de cuentas 110301-XXX ──
  const { data: lineasCxC } = await getSb().from('lineas_partida')
    .select('monto, tipo, cuenta_codigo, descripcion, partida:partidas_contables(fecha_partida, estado)')
    .like('cuenta_codigo', '110301-%')
    .eq('tipo', 'debito')

  const ini = fechaInicio.toISOString().slice(0, 10)
  const fin = fechaFin.toISOString().slice(0, 10)
  const cxcFiltradas = (lineasCxC || []).filter(l =>
    l.partida?.estado === 'aprobada' && l.partida.fecha_partida >= ini && l.partida.fecha_partida <= fin
  )

  const cxcPorCuenta = {}
  for (const l of cxcFiltradas) {
    const cc = l.cuenta_codigo
    if (!cxcPorCuenta[cc]) cxcPorCuenta[cc] = { anticipos: 0, trucha: 0 }
    const desc = (l.descripcion || '').toUpperCase()
    if (desc.includes('TRUCHA')) {
      cxcPorCuenta[cc].trucha += parseFloat(l.monto) || 0
    } else if (desc.includes('PRESTAMO') || desc.includes('PRÉSTAMO')) {
      // Préstamos se deducen por cuota, no como anticipo
    } else {
      cxcPorCuenta[cc].anticipos += parseFloat(l.monto) || 0
    }
  }

  // Cargar préstamos activos
  const { data: prestamosActivos } = await getSb().from('prestamos_empleados')
    .select('empleado_id, cuota_quincenal, saldo, activo, fecha_primera_deduccion')
    .eq('activo', true).eq('tipo', 'prestamo')

  const detalles = activos.map(e => {
    const overrides = {}
    // Asistencia
    const ast = asistencia.find(a => a.empleado_id === e.id)
    if (ast) {
      overrides.horas_extra = Math.round(ast.heNeto / 60 * 100) / 100
      const rate = (e.sueldo_mensual || 0) / 30
      const diasPagados = ast.diasPagados ?? ast.diasTrabajados ?? 15
      if (e.es_socio) {
        overrides.dias_trabajados = diasPagados
      } else {
        const vacTotal = ast.diasPermisoVac || 0                 // días de permiso a cuenta de vacaciones
        const noTrabajados = (ast.minNoTrabajados || 0) / 60 / 8 // salidas tempranas sin permiso
        const incapDias = ast.diasIncapacidad || 0               // días calendario de incapacidad en el período
        const incapEmpresa = ast.diasIncapEmpresa || 0           // días-equivalentes que paga la empresa (100%/34%)
        const saldoVac = parseFloat(e.vacaciones_saldo_dias) || 0
        const diasCubiertos = Math.min(vacTotal, saldoVac)       // lo que alcanza a pagar vacaciones
        // Días trabajados (base) = pagados − permiso vacaciones − no trabajados − incapacidad.
        // La parte de vacaciones cubierta vuelve como ingreso Vacaciones (neutro); la incapacidad
        // vuelve (total o parcial) en la columna Incapacidad; lo no cubierto reduce el neto.
        overrides.dias_trabajados = Math.max(0, Math.round((diasPagados - vacTotal - noTrabajados - incapDias) * 100) / 100)
        if (diasCubiertos > 0) overrides.vacaciones = Math.round(diasCubiertos * rate * 100) / 100
        if (incapEmpresa > 0) overrides.incapacidad = Math.round(incapEmpresa * rate * 100) / 100
      }
      if (ast.tardeDeducir > 0) {
        const valorMinuto = (e.sueldo_mensual || 0) / 30 / 8 / 60
        overrides.otras_deducciones = Math.round(ast.tardeDeducir * valorMinuto * 100) / 100
      }
    }
    // Anticipos y trucha desde CXC
    if (e.cuenta_cxc && cxcPorCuenta[e.cuenta_cxc]) {
      const cxc = cxcPorCuenta[e.cuenta_cxc]
      overrides.anticipos = Math.round(cxc.anticipos * 100) / 100
      overrides.trucha = Math.round(cxc.trucha * 100) / 100
    }
    // Préstamos: deducir cuota
    const prestamo = (prestamosActivos || []).find(p => p.empleado_id === e.id)
    if (prestamo) {
      if (!prestamo.fecha_primera_deduccion || prestamo.fecha_primera_deduccion <= ini) {
        overrides.cxc = Math.round(Math.min(prestamo.cuota_quincenal || 0, prestamo.saldo || 0) * 100) / 100
      }
    }
    return calcularDetalleEmpleado(e, planilla.id, overrides)
  })

  // Insert all details
  const { error: dErr } = await getSb().from('detalle_planilla').insert(detalles)
  if (dErr) { window.toast?.('Error generando detalle: ' + dErr.message, 'error'); return }

  currentDetalle = detalles
  // Update planilla totals
  await actualizarTotalesPlanilla()
  renderPlanilla()
  window.toast?.(`Planilla ${periodo} generada con ${detalles.length} empleados`, 'ok')
}

function calcularDetalleEmpleado(emp, planillaId, overrides = {}) {
  const dias = overrides.dias_trabajados ?? 15
  const sueldoMensual = emp.sueldo_mensual || 0
  const sueldoQuincenal = emp.es_socio ? (sueldoMensual / 2) : (sueldoMensual / 30 * dias)

  // Horas extra
  const valorHoraNormal = sueldoMensual / 240  // 30 días * 8 horas
  const valorHE25 = valorHoraNormal * 1.25
  const horasExtra = overrides.horas_extra ?? 0
  const montoHE = valorHE25 * horasExtra

  // Otros ingresos
  const ajuste = overrides.ajuste_sueldo ?? 0
  const vacaciones = overrides.vacaciones ?? 0
  const incapacidad = overrides.incapacidad ?? 0
  const bonificaciones = overrides.bonificaciones ?? 0
  const otrosIngresos = overrides.otros_ingresos ?? 0
  const comisionesVenta = overrides.comisiones_venta ?? 0

  // Total devengado
  const totalDevengado = sueldoQuincenal + montoHE + ajuste + vacaciones + incapacidad + bonificaciones + otrosIngresos + comisionesVenta

  // Deducciones (socios no tienen)
  let ihssLaboral = 0
  let ihssPatronal = 0
  let impVecinal = 0

  if (!emp.es_socio) {
    // IHSS laboral: 2.5% del sueldo, techo L.11,000 mensual → techo quincenal 5,500
    // IHSS laboral: quincenal = techo × porcentaje (ya es quincenal, no dividir por 2)
    const ihssCfg = getIHSSConfig()
    ihssLaboral = Math.round(ihssCfg.techo * ihssCfg.pctLaboral * 100) / 100
    // IHSS patronal
    ihssPatronal = Math.round(ihssCfg.techo * ihssCfg.pctPatronal * 100) / 100
    // Impuesto vecinal (placeholder - se calcula con tabla cuando esté disponible)
    // Por ahora usar proporción del sueldo similar al Excel
    impVecinal = overrides.imp_vecinal ?? 0
  }

  const anticipos = overrides.anticipos ?? 0
  const cxc = overrides.cxc ?? 0
  const trucha = overrides.trucha ?? 0
  const otrasDeducciones = overrides.otras_deducciones ?? 0

  const totalDeducciones = ihssLaboral + impVecinal + anticipos + cxc + trucha + otrasDeducciones
  const sueldoNeto = totalDevengado - totalDeducciones

  return {
    planilla_id: planillaId,
    empleado_id: emp.id,
    nombre: emp.nombre,
    puesto: emp.puesto,
    centro_costo: emp.centro_costo,
    seccion: emp.seccion,
    sueldo_mensual: sueldoMensual,
    cuenta_bancaria: emp.cuenta_bancaria,
    banco: emp.banco,
    forma_pago: emp.forma_pago || 'BAC',
    cuenta_cxc: emp.cuenta_cxc,
    dias_trabajados: dias,
    sueldo_quincenal: Math.round(sueldoQuincenal * 100) / 100,
    valor_hora_normal: Math.round(valorHoraNormal * 10000) / 10000,
    valor_he_25: Math.round(valorHE25 * 10000) / 10000,
    horas_extra: horasExtra,
    monto_he: Math.round(montoHE * 100) / 100,
    ajuste_sueldo: ajuste,
    vacaciones,
    incapacidad,
    bonificaciones,
    otros_ingresos: otrosIngresos,
    comisiones_venta: comisionesVenta,
    total_devengado: Math.round(totalDevengado * 100) / 100,
    imp_vecinal: impVecinal,
    anticipos,
    cxc,
    trucha,
    otras_deducciones: otrasDeducciones,
    ihss_laboral: ihssLaboral,
    total_deducciones: Math.round(totalDeducciones * 100) / 100,
    sueldo_neto: Math.round(sueldoNeto * 100) / 100,
    ihss_patronal: ihssPatronal,
  }
}

function renderPlanilla() {
  document.getElementById('planilla-resultado').classList.remove('hidden')

  // Stats
  const totalBruto = currentDetalle.reduce((s, d) => s + (d.total_devengado || 0), 0)
  const totalDeduc = currentDetalle.reduce((s, d) => s + (d.total_deducciones || 0), 0)
  const totalNeto = currentDetalle.reduce((s, d) => s + (d.sueldo_neto || 0), 0)
  const totalPatronal = currentDetalle.reduce((s, d) => s + (d.ihss_patronal || 0), 0)

  document.getElementById('pl-stat-emp').textContent = currentDetalle.length
  document.getElementById('pl-stat-bruto').textContent = 'L. ' + fmt(totalBruto)
  document.getElementById('pl-stat-deduc').textContent = 'L. ' + fmt(totalDeduc)
  document.getElementById('pl-stat-neto').textContent = 'L. ' + fmt(totalNeto)
  document.getElementById('pl-stat-patronal').textContent = 'L. ' + fmt(totalPatronal)

  // Tabs by section
  const secciones = [...new Set(currentDetalle.map(d => d.seccion))]
  const tabsDiv = document.getElementById('pl-tabs')
  tabsDiv.innerHTML = `<button class="btn btn-ghost pl-tab active" onclick="filterPlanillaTab('')" style="font-size:12px;padding:4px 12px">Todas</button>` +
    secciones.map(s => `<button class="btn btn-ghost pl-tab" onclick="filterPlanillaTab('${s}')" style="font-size:12px;padding:4px 12px">${s}</button>`).join('')

  renderPlanillaTable('')

  // Disable approve button if already approved
  const btnAprobar = document.getElementById('btn-aprobar-planilla')
  if (currentPlanilla?.estado === 'aprobada' || currentPlanilla?.estado === 'pagada') {
    btnAprobar.disabled = true
    btnAprobar.textContent = '✅ Planilla ya aprobada'
  } else {
    btnAprobar.disabled = false
    btnAprobar.textContent = '✅ Aprobar y generar partida'
  }
}

window.filterPlanillaTab = (seccion) => {
  document.querySelectorAll('.pl-tab').forEach(t => t.classList.remove('active'))
  event.target.classList.add('active')
  renderPlanillaTable(seccion)
}

function renderPlanillaTable(seccionFilter) {
  const data = seccionFilter ? currentDetalle.filter(d => d.seccion === seccionFilter) : currentDetalle
  const tbody = document.getElementById('tbody-planilla')
  const isEditable = currentPlanilla?.estado === 'borrador'

  tbody.innerHTML = data.map((d, i) => {
    const globalIdx = currentDetalle.indexOf(d)
    const otrosIng = (d.ajuste_sueldo || 0) + (d.vacaciones || 0) + (d.incapacidad || 0) +
                     (d.bonificaciones || 0) + (d.otros_ingresos || 0) + (d.comisiones_venta || 0)
    return `
    <tr>
      <td>${i + 1}</td>
      <td style="white-space:nowrap;font-size:12px">${d.nombre}</td>
      <td style="text-align:right">${fmt(d.sueldo_mensual)}</td>
      <td style="text-align:center">${d.dias_trabajados}</td>
      <td style="text-align:right">${fmt(d.sueldo_quincenal)}</td>
      <td style="text-align:right">${d.monto_he > 0 ? fmt(d.monto_he) : '—'}</td>
      <td style="text-align:right">${otrosIng > 0 ? fmt(otrosIng) : '—'}</td>
      <td style="text-align:right;font-weight:500">${fmt(d.total_devengado)}</td>
      <td style="text-align:right">${fmt(d.ihss_laboral)}</td>
      <td style="text-align:right">${d.imp_vecinal > 0 ? fmt(d.imp_vecinal) : '—'}</td>
      <td style="text-align:right">${d.anticipos > 0 ? fmt(d.anticipos) : '—'}</td>
      <td style="text-align:right">${d.trucha > 0 ? fmt(d.trucha) : '—'}</td>
      <td style="text-align:right">${d.otras_deducciones > 0 ? fmt(d.otras_deducciones) : '—'}</td>
      <td style="text-align:right;color:var(--red)">${fmt(d.total_deducciones)}</td>
      <td style="text-align:right;font-weight:600;color:var(--green)">${fmt(d.sueldo_neto)}</td>
      <td style="text-align:center">${isEditable ? `<button class="btn btn-ghost" style="padding:2px 6px;font-size:11px" onclick="editarDetallePlanilla(${globalIdx})">✏️</button>` : ''}</td>
    </tr>`
  }).join('')

  // Footer totals
  const tfoot = document.getElementById('tfoot-planilla')
  const totals = data.reduce((acc, d) => {
    acc.quincenal += d.sueldo_quincenal || 0
    acc.he += d.monto_he || 0
    acc.devengado += d.total_devengado || 0
    acc.ihss += d.ihss_laboral || 0
    acc.vecinal += d.imp_vecinal || 0
    acc.anticipos += d.anticipos || 0
    acc.trucha += d.trucha || 0
    acc.otras_ded += d.otras_deducciones || 0
    acc.deducciones += d.total_deducciones || 0
    acc.neto += d.sueldo_neto || 0
    return acc
  }, { quincenal: 0, he: 0, devengado: 0, ihss: 0, vecinal: 0, anticipos: 0, trucha: 0, otras_ded: 0, deducciones: 0, neto: 0 })

  tfoot.innerHTML = `
    <tr style="font-weight:600;border-top:2px solid var(--border)">
      <td colspan="4">TOTAL (${data.length} empleados)</td>
      <td style="text-align:right">${fmt(totals.quincenal)}</td>
      <td style="text-align:right">${fmt(totals.he)}</td>
      <td style="text-align:right">—</td>
      <td style="text-align:right">${fmt(totals.devengado)}</td>
      <td style="text-align:right">${fmt(totals.ihss)}</td>
      <td style="text-align:right">${fmt(totals.vecinal)}</td>
      <td style="text-align:right">${fmt(totals.anticipos)}</td>
      <td style="text-align:right">${fmt(totals.trucha)}</td>
      <td style="text-align:right">${fmt(totals.otras_ded)}</td>
      <td style="text-align:right;color:var(--red)">${fmt(totals.deducciones)}</td>
      <td style="text-align:right;color:var(--green)">${fmt(totals.neto)}</td>
      <td></td>
    </tr>`
}

// ── Editar detalle de un empleado en la planilla ──
window.editarDetallePlanilla = (idx) => {
  editingDetalleIdx = idx
  const d = currentDetalle[idx]
  if (!d) return
  document.getElementById('modal-dpl-nombre').textContent = d.nombre + ' — ' + d.seccion
  document.getElementById('dpl-dias').value = d.dias_trabajados
  document.getElementById('dpl-horas').value = d.horas_extra || 0
  document.getElementById('dpl-ajuste').value = d.ajuste_sueldo || 0
  document.getElementById('dpl-vacaciones').value = d.vacaciones || 0
  document.getElementById('dpl-incapacidad').value = d.incapacidad || 0
  document.getElementById('dpl-bonificaciones').value = d.bonificaciones || 0
  document.getElementById('dpl-otros').value = d.otros_ingresos || 0
  document.getElementById('dpl-comisiones').value = d.comisiones_venta || 0
  document.getElementById('dpl-anticipos').value = d.anticipos || 0
  document.getElementById('dpl-cxc').value = d.cxc || 0
  document.getElementById('dpl-trucha').value = d.trucha || 0
  document.getElementById('dpl-otras-ded').value = d.otras_deducciones || 0
  openModal('modal-detalle-pl')
}

window.guardarDetallePlanilla = async () => {
  const idx = editingDetalleIdx
  if (idx === null) return
  const d = currentDetalle[idx]

  // Get employee data
  const emp = allEmpleados.find(e => e.id === d.empleado_id) || {
    sueldo_mensual: d.sueldo_mensual,
    es_socio: false,
    id: d.empleado_id,
    nombre: d.nombre,
    puesto: d.puesto,
    centro_costo: d.centro_costo,
    seccion: d.seccion,
    cuenta_bancaria: d.cuenta_bancaria,
    banco: d.banco,
    forma_pago: d.forma_pago,
    cuenta_cxc: d.cuenta_cxc
  }

  const overrides = {
    dias_trabajados: parseFloat(document.getElementById('dpl-dias').value) || 0,
    horas_extra: parseFloat(document.getElementById('dpl-horas').value) || 0,
    ajuste_sueldo: parseFloat(document.getElementById('dpl-ajuste').value) || 0,
    vacaciones: parseFloat(document.getElementById('dpl-vacaciones').value) || 0,
    incapacidad: parseFloat(document.getElementById('dpl-incapacidad').value) || 0,
    bonificaciones: parseFloat(document.getElementById('dpl-bonificaciones').value) || 0,
    otros_ingresos: parseFloat(document.getElementById('dpl-otros').value) || 0,
    comisiones_venta: parseFloat(document.getElementById('dpl-comisiones').value) || 0,
    anticipos: parseFloat(document.getElementById('dpl-anticipos').value) || 0,
    cxc: parseFloat(document.getElementById('dpl-cxc').value) || 0,
    trucha: parseFloat(document.getElementById('dpl-trucha').value) || 0,
    otras_deducciones: parseFloat(document.getElementById('dpl-otras-ded').value) || 0,
    imp_vecinal: d.imp_vecinal || 0
  }

  const recalc = calcularDetalleEmpleado(emp, currentPlanilla.id, overrides)
  recalc.id = d.id  // preserve the existing ID

  // Update in DB
  const { error } = await getSb().from('detalle_planilla').update(recalc).eq('id', d.id)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }

  currentDetalle[idx] = { ...d, ...recalc }
  closeModal('modal-detalle-pl')
  await actualizarTotalesPlanilla()
  renderPlanilla()
  window.toast?.('Detalle actualizado y recalculado', 'ok')
}

async function actualizarTotalesPlanilla() {
  if (!currentPlanilla) return
  const totalBruto = currentDetalle.reduce((s, d) => s + (d.total_devengado || 0), 0)
  const totalDeduc = currentDetalle.reduce((s, d) => s + (d.total_deducciones || 0), 0)
  const totalNeto = currentDetalle.reduce((s, d) => s + (d.sueldo_neto || 0), 0)
  const totalPatronal = currentDetalle.reduce((s, d) => s + (d.ihss_patronal || 0), 0)

  await getSb().from('planillas').update({
    total_bruto: Math.round(totalBruto * 100) / 100,
    total_deducciones: Math.round(totalDeduc * 100) / 100,
    total_neto: Math.round(totalNeto * 100) / 100,
    total_ihss_patronal: Math.round(totalPatronal * 100) / 100
  }).eq('id', currentPlanilla.id)
}

// ── Aprobar planilla: rebaja saldo de vacaciones usado + (futuro) partida ──
window.aprobarPlanilla = async () => {
  if (!currentPlanilla || currentPlanilla.estado !== 'borrador') return
  if (!confirm('¿Aprobar esta planilla? Se rebajará del saldo de vacaciones los días cubiertos en esta quincena.')) return

  const sb = getSb()
  const periodo = currentPlanilla.periodo
  const fechaMov = currentPlanilla.fecha_fin || new Date().toISOString().slice(0, 10)
  const quienId = window._currentProfile?.()?.nombre || null

  // Candado anti doble-rebaja: ¿ya hay movimientos 'permiso' de esta planilla?
  const { data: yaAplicado } = await sb.from('vacaciones_movimientos')
    .select('id').eq('tipo', 'permiso').eq('periodo', periodo).limit(1)
  const yaSeAplico = (yaAplicado || []).length > 0

  // Update status
  const { error } = await sb.from('planillas').update({
    estado: 'aprobada',
    aprobada_at: new Date().toISOString()
  }).eq('id', currentPlanilla.id)

  if (error) { window.toast?.('Error aprobando: ' + error.message, 'error'); return }

  // Rebajar saldo de vacaciones por los días cubiertos (una sola vez por período)
  let rebajados = 0
  if (!yaSeAplico) {
    const conVac = currentDetalle.filter(d => (d.vacaciones || 0) > 0 && d.empleado_id)
    for (const d of conVac) {
      const rate = (d.sueldo_mensual || 0) / 30
      if (rate <= 0) continue
      const diasCubiertos = Math.round((d.vacaciones / rate) * 1000) / 1000  // se recupera del monto guardado
      if (diasCubiertos <= 0) continue
      const { data: emp } = await sb.from('empleados')
        .select('vacaciones_saldo_dias').eq('id', d.empleado_id).maybeSingle()
      const saldoActual = parseFloat(emp?.vacaciones_saldo_dias) || 0
      const saldoNuevo = Math.round((saldoActual - diasCubiertos) * 1000) / 1000
      await sb.from('empleados').update({ vacaciones_saldo_dias: saldoNuevo }).eq('id', d.empleado_id)
      await sb.from('vacaciones_movimientos').insert({
        empleado_id: d.empleado_id,
        empleado_nombre: d.nombre,
        fecha: fechaMov,
        tipo: 'permiso',
        dias: -diasCubiertos,
        monto: d.vacaciones,
        saldo_resultante: saldoNuevo,
        referencia: `PLANILLA ${periodo}`,
        motivo: 'Permiso a cuenta de vacaciones (planilla)',
        periodo,
        created_by: quienId
      })
      rebajados++
    }
  }

  currentPlanilla.estado = 'aprobada'
  renderPlanilla()
  let msg = '✅ Planilla aprobada.'
  if (yaSeAplico) msg += ' Las vacaciones de este período ya estaban aplicadas (no se rebajó de nuevo).'
  else if (rebajados > 0) msg += ` Saldo de vacaciones rebajado a ${rebajados} empleado(s).`
  window.toast?.(msg, 'ok')
  window.logActividad?.('planilla_aprobada', 'rrhh', `${periodo} · vac rebajada: ${rebajados}`)
}

// ── Exportar a Excel ──
window.exportarPlanillaExcel = () => {
  if (!currentDetalle.length) return
  const XLSX = window.XLSX

  const headers = [
    '#', 'Nombre', 'Puesto', 'Sección', 'Centro Costo', 'Sueldo Mensual',
    'Días', 'Sueldo Quincenal', 'Horas Extra', 'Monto H/E',
    'Ajuste Sueldo', 'Vacaciones', 'Incapacidad', 'Bonificaciones',
    'Otros Ingresos', 'Comisiones', 'Total Devengado',
    'Imp. Vecinal', 'Anticipos', 'CXC', 'Trucha', 'Otras Ded.',
    'IHSS Laboral', 'Total Deducciones', 'Sueldo Neto', 'IHSS Patronal',
    'Banco', 'Cuenta', 'Forma Pago'
  ]

  const rows = currentDetalle.map((d, i) => [
    i + 1, d.nombre, d.puesto, d.seccion, d.centro_costo, d.sueldo_mensual,
    d.dias_trabajados, d.sueldo_quincenal, d.horas_extra, d.monto_he,
    d.ajuste_sueldo, d.vacaciones, d.incapacidad, d.bonificaciones,
    d.otros_ingresos, d.comisiones_venta, d.total_devengado,
    d.imp_vecinal, d.anticipos, d.cxc, d.trucha, d.otras_deducciones,
    d.ihss_laboral, d.total_deducciones, d.sueldo_neto, d.ihss_patronal,
    d.banco, d.cuenta_bancaria, d.forma_pago
  ])

  const ws = XLSX.utils.aoa_to_sheet([
    [`TECNIMAX S. DE R.L.`],
    [`PLANILLA SUELDOS Y SALARIOS`],
    [`${currentPlanilla.periodo}`],
    [],
    headers,
    ...rows
  ])

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Planilla')
  XLSX.writeFile(wb, `Planilla_${currentPlanilla.periodo}.xlsx`)
  window.toast?.('Excel exportado', 'ok')
}


// ══════════════════════════════════════════════
// ═══  3. PRÉSTAMOS A EMPLEADOS  ═══
// ══════════════════════════════════════════════

window.loadPrestamosEmp = async () => {
  // Load employees if needed
  if (allEmpleados.length === 0) {
    const { data } = await getSb().from('empleados').select('*').eq('activo', true).order('nombre')
    allEmpleados = data || []
  }

  const { data, error } = await getSb().from('prestamos_empleados')
    .select('*, empleado:empleados(nombre,cuenta_cxc)')
    .order('created_at', { ascending: false })

  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  allPrestamosEmp = data || []

  // Stats
  const activos = allPrestamosEmp.filter(p => p.activo)
  const totalSaldo = activos.reduce((s, p) => s + (p.saldo || 0), 0)
  document.getElementById('stat-pe-activos').textContent = activos.length
  document.getElementById('stat-pe-monto').textContent = 'L. ' + fmt(totalSaldo)

  // Table
  const tbody = document.getElementById('tbody-prestamos-emp')
  tbody.innerHTML = allPrestamosEmp.map(p => `
    <tr style="${!p.activo ? 'opacity:0.5' : ''}">
      <td><strong>${p.empleado?.nombre || '—'}</strong></td>
      <td>${p.descripcion || '—'}</td>
      <td><span style="font-size:11px;padding:2px 8px;background:var(--bg1);border-radius:4px">${p.tipo}</span></td>
      <td style="text-align:right">L. ${fmt(p.monto_original)}</td>
      <td style="text-align:right;font-weight:600;color:${p.saldo > 0 ? 'var(--gold)' : 'var(--green)'}">L. ${fmt(p.saldo)}</td>
      <td style="text-align:right">L. ${fmt(p.cuota_quincenal)}</td>
      <td style="font-size:12px;color:var(--text3)">${p.fecha_prestamo || '—'}</td>
      <td style="font-size:12px;color:var(--text3)">${p.fecha_primera_deduccion || '—'}</td>
      <td>${p.activo ? '<span style="color:var(--gold)">● Activo</span>' : '<span style="color:var(--green)">● Pagado</span>'}</td>
      <td>
        ${p.activo ? `<button class="btn btn-ghost" style="padding:4px 8px;font-size:12px" onclick="liquidarPrestamoEmp('${p.id}')">💰 Liquidar</button>` : ''}
      </td>
    </tr>
  `).join('')

  // Populate employee select in modal
  const sel = document.getElementById('pe-empleado')
  sel.innerHTML = '<option value="">Seleccionar empleado...</option>' +
    allEmpleados.filter(e => e.activo).map(e => `<option value="${e.id}">${e.nombre}</option>`).join('')
}

window.openModalPrestamoEmp = () => {
  document.getElementById('pe-monto').value = ''
  document.getElementById('pe-cuota').value = ''
  document.getElementById('pe-descripcion').value = ''
  document.getElementById('pe-tipo').value = 'prestamo'
  document.getElementById('pe-empleado').value = ''
  document.getElementById('pe-fecha-prestamo').value = new Date().toISOString().split('T')[0]
  document.getElementById('pe-fecha-deduccion').value = ''
  openModal('modal-prestamo-emp')
}

window.guardarPrestamoEmp = async () => {
  const empleadoId = document.getElementById('pe-empleado').value
  const monto = parseFloat(document.getElementById('pe-monto').value) || 0
  const cuota = parseFloat(document.getElementById('pe-cuota').value) || 0
  const fechaPrestamo = document.getElementById('pe-fecha-prestamo').value
  const fechaDeduccion = document.getElementById('pe-fecha-deduccion').value
  const descripcion = document.getElementById('pe-descripcion').value.trim() || null
  const tipo = document.getElementById('pe-tipo').value

  if (!empleadoId) { window.toast?.('Seleccioná un empleado', 'error'); return }
  if (monto <= 0) { window.toast?.('Ingresá un monto válido', 'error'); return }
  if (!fechaPrestamo) { window.toast?.('Ingresá la fecha del préstamo', 'error'); return }

  const { data: prestamo, error } = await getSb().from('prestamos_empleados').insert({
    empleado_id: empleadoId,
    descripcion,
    tipo,
    monto_original: monto,
    saldo: monto,
    cuota_quincenal: cuota,
    fecha_prestamo: fechaPrestamo,
    fecha_primera_deduccion: fechaDeduccion || null,
    activo: true
  }).select().single()

  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }

  // Generar partida contable automática
  const emp = allEmpleados.find(e => e.id === empleadoId)
  if (emp?.cuenta_cxc && tipo === 'prestamo') {
    try {
      const sb = getSb()
      // Buscar cuenta CXC del empleado
      const { data: cuentaCxC } = await sb.from('catalogo_cuentas')
        .select('id, codigo, nombre').eq('codigo', emp.cuenta_cxc).single()

      if (cuentaCxC) {
        // Obtener siguiente número de partida
        const { data: lastP } = await sb.from('partidas_contables')
          .select('numero_partida').order('numero_partida', { ascending: false }).limit(1)
        const numPartida = (lastP?.[0]?.numero_partida || 0) + 1

        const descPartida = `PRESTAMO ${emp.nombre} - ${descripcion || 'EFVO'}`.toUpperCase()

        // Crear partida borrador
        const { data: partida } = await sb.from('partidas_contables').insert({
          fecha_partida: fechaPrestamo,
          numero_partida: numPartida,
          descripcion: descPartida,
          tipo_origen: 'otro',
          estado: 'borrador',
          total: monto
        }).select().single()

        if (partida) {
          // Línea débito: CXC empleado
          // Línea crédito: pendiente (forma de pago)
          await sb.from('lineas_partida').insert([
            {
              partida_id: partida.id,
              cuenta_id: cuentaCxC.id,
              cuenta_codigo: cuentaCxC.codigo,
              cuenta_nombre: cuentaCxC.nombre,
              tipo: 'debito',
              monto,
              descripcion: descPartida,
              aplica_fiscal: false
            }
          ])
          window.toast?.(`Préstamo guardado + Partida #${numPartida} creada como borrador (falta forma de pago)`, 'success')
        }
      } else {
        window.toast?.('Préstamo guardado. No se encontró cuenta CXC para generar partida.', 'info')
      }
    } catch(e) {
      console.error('Error generando partida:', e)
      window.toast?.('Préstamo guardado pero hubo error al generar partida', 'error')
    }
  } else {
    window.toast?.('Préstamo registrado ✓', 'ok')
  }

  closeModal('modal-prestamo-emp')
  window.logActividad?.('prestamo_emp_creado', 'rrhh', `${emp?.nombre || ''} · L.${monto} · ${tipo}`)
  await loadPrestamosEmp()
}

window.liquidarPrestamoEmp = async (id) => {
  if (!confirm('¿Marcar este préstamo como liquidado (saldo = 0)?')) return
  const { error } = await getSb().from('prestamos_empleados').update({ saldo: 0, activo: false }).eq('id', id)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  window.toast?.('Préstamo liquidado', 'ok')
  await loadPrestamosEmp()
}

// ── Helper: open/close modals (match app.js pattern) ──
function openModal(id) {
  const m = document.getElementById(id)
  if (m) m.classList.add('open')
}
function closeModal(id) {
  const m = document.getElementById(id)
  if (m) m.classList.remove('open')
}

})(); // end IIFE