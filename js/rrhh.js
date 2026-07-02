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
let currentSeccionFilter = ''    // filtro de sección activo (pestaña)
let currentNombreFilter = ''     // filtro de búsqueda por nombre (mayúsculas)
let editingDetalleIdx = null     // index in currentDetalle being edited
let editingDetalleSnapshot = null // valores mostrados al abrir el modal (para detectar qué cambió)
let allPrestamosEmp = []
let editandoPrestamoId = null   // id del préstamo en edición (null = creando uno nuevo)

// ── Configuración de cuentas contables por sección ──
const CUENTAS_SECCION = {
  'GO Taller': {
    sueldos: '610101-001', he: '610101-002', vacaciones: '610101-005',
    bonificaciones: '610101-007', incapacidades: '610101-036',
    otros: '610101-037', ihss_laboral: '210303-001', ihss_patronal_gasto: '610101-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301-001', trucha: '210404-001',
    chequera: '110103-001'
  },
  'GV Taller': {
    sueldos: '610102-001', he: '610102-002', vacaciones: '610102-005',
    bonificaciones: '610102-007', incapacidades: '610102-039',
    otros: '610102-040', ihss_laboral: '210303-001', ihss_patronal_gasto: '610102-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301-001', trucha: '210404-001',
    chequera: '110103-001'
  },
  'GA Taller': {
    sueldos: '610103-001', he: '610103-002', vacaciones: '610103-005',
    bonificaciones: '610103-031', incapacidades: '610103-029',
    otros: '610103-030', ihss_laboral: '210303-001', ihss_patronal_gasto: '610103-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301-001', trucha: '210404-001',
    chequera: '110103-001'
  },
  'GO Yonker': {
    sueldos: '610101-001', he: '610101-002', vacaciones: '610101-005',
    bonificaciones: '610101-007', incapacidades: '610101-036',
    otros: '610101-037', ihss_laboral: '210303-001', ihss_patronal_gasto: '610101-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301-002', trucha: '410305-002',
    chequera: '110103-001'
  },
  'GV Yonker': {
    sueldos: '610102-001', he: '610102-002', vacaciones: '610102-005',
    bonificaciones: '610102-007', incapacidades: '610102-039',
    otros: '610102-040', ihss_laboral: '210303-001', ihss_patronal_gasto: '610102-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301-002', trucha: '410305-002',
    chequera: '110103-001'
  },
  'GA Yonker': {
    sueldos: '610103-001', he: '610103-002', vacaciones: '610103-005',
    bonificaciones: '610103-031', incapacidades: '610103-029',
    otros: '610103-030', ihss_laboral: '210303-001', ihss_patronal_gasto: '610103-009',
    ihss_patronal_cxp: '210303-002', imp_vecinal: '210301-002', trucha: '410305-002',
    chequera: '110103-001'
  }
}

// ── PROVISIONES LABORALES (partida quincenal junto a la planilla) ──
// Porcentajes estándar Honduras: 13vo y 14vo = 1 mes/año (8.3333%);
// cesantía = 1 mes/año (8.3333%); vacaciones según antigüedad (días/360).
// Los socios (es_socio) NO acumulan provisiones.
// ⚠ CUENTAS PROPUESTAS: confírmalas o ajústalas aquí; si alguna no existe
// en el catálogo, la aprobación lo dirá con el código exacto faltante.
const PROVISIONES_CFG = {
  activo: true,
  pct_aguinaldo: 8.3333,
  pct_catorceavo: 8.3333,
  pct_cesantia: 8.3333,
  vacaciones_modo: 'antiguedad',   // 'antiguedad' (por fecha_ingreso) | 'fijo'
  pct_vacaciones_fijo: 5.5556,     // 20 días/360 — usado solo si modo='fijo' o falta fecha_ingreso
  // Gasto por CONCEPTO (cuentas existentes; mismas que la partida manual):
  cuentas_gasto: {
    aguinaldo: '610102-003',    // DECIMO TERCER MES
    catorceavo: '610102-004',   // DECIMO CUARTO MES
    vacaciones: '610102-005',   // VACACIONES
    cesantia: '610102-006'      // PRESTACIONES LABORALES
  },
  // Pasivo (grupo existente 210601 PROVISIONES LABORALES):
  cuentas_pasivo: {
    aguinaldo: '210601-002',    // DECIMO TERCER MES TECNIMAX
    catorceavo: '210601-001',   // DECIMO CUARTO MES TECNIMAX
    vacaciones: '210601-004',   // VACACIONES TECNIMAX
    cesantia: '210601-005'      // PRESTACIONES LABORES (PREAVISO, CESANTIA Y AUXILIO)
  }
}

// ── PLANILLA CONFIDENCIAL ──
// Empleados con planilla_confidencial=true salen de la planilla general e IHSS.
// Solo super_admin y contador ven la pestaña, los empleados y sus datos (RLS).
const CONF_CFG = {
  gasto_sueldos: '610103-001',   // SUELDOS GA (cargo, con centro por empleado)
  chequera: '110103-001',
  imp_vecinal: { TECNIMAX: '210301-001', YONKER: '210301-002' },
  trucha: { TECNIMAX: '210404-001', YONKER: '410305-002' }
}
let planillaModoConf = false

function _puedeVerConfidencial() {
  return ['super_admin', 'contador'].includes(window._currentProfile?.()?.rol)
}

function ensurePlanillaTabs() {
  if (!_puedeVerConfidencial()) return
  if (document.getElementById('pl-tabs-conf')) return
  const ref = document.getElementById('pl-anio')
  const host = ref?.parentElement?.parentElement || ref?.parentElement
  if (!host || !host.parentNode) return
  const bar = document.createElement('div')
  bar.id = 'pl-tabs-conf'
  bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin:0 0 12px'
  bar.innerHTML = `
    <button id="pl-tab-gen" class="btn" onclick="setModoPlanillaConf(false)">Planilla general</button>
    <button id="pl-tab-conf" class="btn btn-ghost" onclick="setModoPlanillaConf(true)">🔒 Confidencial</button>
    <span id="pl-conf-aviso" style="display:none;font-size:12px;color:var(--gold)">Modo confidencial — visible solo para super_admin y contador</span>`
  host.parentNode.insertBefore(bar, host)
}

window.setModoPlanillaConf = (conf) => {
  if (conf && !_puedeVerConfidencial()) return
  planillaModoConf = !!conf
  const bGen = document.getElementById('pl-tab-gen'), bConf = document.getElementById('pl-tab-conf')
  if (bGen && bConf) {
    bGen.className = conf ? 'btn btn-ghost' : 'btn'
    bConf.className = conf ? 'btn' : 'btn btn-ghost'
  }
  const aviso = document.getElementById('pl-conf-aviso')
  if (aviso) aviso.style.display = conf ? '' : 'none'
  document.getElementById('pl-existing')?.classList.add('hidden')
  window.toast?.(conf ? 'Modo CONFIDENCIAL: presioná Generar para cargar esa planilla' : 'Modo planilla general', 'info')
}

// Días de vacaciones por años de antigüedad (Código de Trabajo, Art. 346)
function _diasVacPorAntiguedad(fechaIngreso, fechaRef) {
  if (!fechaIngreso) return 20  // sin fecha: provisión conservadora (tope)
  const anios = Math.floor((new Date(fechaRef) - new Date(fechaIngreso + 'T12:00:00')) / (365.25 * 24 * 3600 * 1000))
  if (anios >= 4) return 20
  if (anios === 3) return 15
  if (anios === 2) return 12
  return 10
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
  allEmpleados = (data || []).filter(e => _puedeVerConfidencial() || !e.planilla_confidencial)
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

// Campos de planilla confidencial en el modal de empleado (solo roles autorizados)
function _syncConfUI(e) {
  const wrap = document.getElementById('emp-conf-wrap')
  if (!wrap) return
  wrap.style.display = _puedeVerConfidencial() ? '' : 'none'
  const chk = document.getElementById('emp-confidencial')
  const extra = document.getElementById('emp-conf-extra')
  const selC = document.getElementById('emp-conf-centro')
  const prov = document.getElementById('emp-conf-provisiona')
  if (chk) chk.checked = !!e?.planilla_confidencial
  if (selC) selC.value = e?.conf_centro || 'TECNIMAX'
  if (prov) prov.checked = !!e?.conf_provisiona
  const sc = document.getElementById('emp-sueldo-confidencial')
  if (sc) sc.value = e?.sueldo_confidencial || ''
  if (extra) extra.style.display = chk?.checked ? 'flex' : 'none'
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
      <td><strong>${e.nombre}</strong>${e.es_socio ? ' <span style="color:var(--gold);font-size:11px">★ SOCIO</span>' : ''}${e.planilla_confidencial ? ' <span style="color:#a78bfa;font-size:11px">🔒 CONF</span>' : ''}</td>
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
  _syncConfUI(null)
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
  _syncConfUI(e)
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
    planilla_confidencial: document.getElementById('emp-confidencial')?.checked || false,
    sueldo_confidencial: parseFloat(document.getElementById('emp-sueldo-confidencial')?.value) || 0,
    conf_centro: document.getElementById('emp-conf-centro')?.value || 'TECNIMAX',
    conf_provisiona: document.getElementById('emp-conf-provisiona')?.checked || false,
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
  // Auditoría
  if (editingEmpleadoId) {
    const _orig = allEmpleados.find(e => e.id === editingEmpleadoId) || {}
    const _campos = { nombre: 'nombre', seccion: 'sección', sueldo_mensual: 'sueldo', forma_pago: 'forma pago', banco: 'banco', cuenta_bancaria: 'cuenta', es_socio: 'es_socio', centro_costo: 'centro', identidad: 'identidad', puesto: 'puesto', cuenta_cxc: 'cuenta CxC' }
    const _cambios = Object.keys(_campos).filter(k => String(_orig[k] ?? '') !== String(payload[k] ?? '')).map(k => _campos[k])
    window.logActividad?.('empleado_editado', 'rrhh', `${nombre}${_cambios.length ? ' · cambió: ' + _cambios.join(', ') : ''}`)
  } else {
    window.logActividad?.('empleado_creado', 'rrhh', `${nombre}${payload.seccion ? ' · ' + payload.seccion : ''} · ${payload.codigo}`)
  }
  await loadEmpleados()
}

window.toggleEmpleadoActivo = async (id, activo) => {
  if (!confirm(activo ? '¿Desactivar este empleado?' : '¿Reactivar este empleado?')) return
  const { error } = await getSb().from('empleados').update({ activo: !activo, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  window.toast?.(activo ? 'Empleado desactivado' : 'Empleado reactivado', 'ok')
  const _empT = allEmpleados.find(e => e.id === id)
  window.logActividad?.(activo ? 'empleado_desactivado' : 'empleado_activado', 'rrhh', _empT?.nombre || String(id))
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
  
  ensurePlanillaTabs()

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
  ensureBonoLauncher()
  ensureBonoEduLauncher()
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
  const { data: existing } = await getSb().from('planillas').select('*').eq('periodo', periodo).eq('es_confidencial', planillaModoConf).maybeSingle()
  if (existing) {
    document.getElementById('pl-existing').classList.remove('hidden')
    document.getElementById('pl-existing-msg').textContent =
      `Ya existe una planilla para este período (estado: ${existing.estado}). Se cargará para edición.`
    currentPlanilla = existing
    // Load existing details
    const { data: det } = await getSb().from('detalle_planilla')
      .select('*').eq('planilla_id', existing.id).order('seccion').order('nombre')
    currentDetalle = det || []

    // ── Salvaguarda: un borrador NO se recalcula al cargar. Si desde que se generó cambió el
    // roster (ej. un empleado pasó a salario partido y ahora debe salir en esta planilla),
    // avisamos qué personas faltan para que el usuario regenere en vez de aprobar algo incompleto.
    try {
      if (allEmpleados.length === 0) {
        const { data: _emps } = await getSb().from('empleados').select('*').eq('activo', true).order('seccion').order('nombre')
        allEmpleados = _emps || []
      }
      const _split = e => (parseFloat(e.sueldo_confidencial) || 0) > (e.sueldo_mensual || 0)
      const _fullConf = e => !!e.planilla_confidencial && !_split(e)
      const _esperados = allEmpleados.filter(e => e.activo && (planillaModoConf ? (_fullConf(e) || _split(e)) : !_fullConf(e)))
      const _idsBorrador = new Set(currentDetalle.map(d => d.empleado_id))
      const _faltantes = _esperados.filter(e => !_idsBorrador.has(e.id))
      if (_faltantes.length) {
        const _nombres = _faltantes.map(e => e.nombre).join(', ')
        document.getElementById('pl-existing-msg').textContent =
          `⚠ Este borrador no incluye a ${_faltantes.length} empleado(s) que hoy deberían estar: ${_nombres}. Regenerá para actualizarlo.`
        window.toast?.(`El borrador no incluye a: ${_nombres}. Regenerá para actualizar.`, 'error')
      }
    } catch (e) { console.warn('chequeo roster borrador:', e) }

    renderPlanilla()
    return
  }

  document.getElementById('pl-existing').classList.add('hidden')

  // Load empleados activos (not socios)
  if (allEmpleados.length === 0) {
    const { data } = await getSb().from('empleados').select('*').eq('activo', true).order('seccion').order('nombre')
    allEmpleados = data || []
  }

  // Salario partido / confidencial. El campo sueldo_confidencial = sueldo REAL total.
  // Si supera al visible (sueldo_mensual), hay "complemento" = real − visible, que se paga en
  // la confidencial; el empleado sale en AMBAS planillas (visible en general, complemento en conf).
  // planilla_confidencial marcado SIN complemento = 100% confidencial (solo en la confidencial).
  const _esSplit = e => (parseFloat(e.sueldo_confidencial) || 0) > (e.sueldo_mensual || 0)
  const _esFullConf = e => !!e.planilla_confidencial && !_esSplit(e)
  const _complemento = e => Math.round(((parseFloat(e.sueldo_confidencial) || 0) - (e.sueldo_mensual || 0)) * 100) / 100

  // General: todos los que NO son 100% confidenciales (normales + partidos, con su sueldo visible).
  // Confidencial: los 100% confidenciales + los partidos (estos como complemento).
  const activos = planillaModoConf
    ? allEmpleados.filter(e => e.activo && (_esFullConf(e) || _esSplit(e)))
    : allEmpleados.filter(e => e.activo && !_esFullConf(e))
  if (planillaModoConf && !activos.length) { window.toast?.('No hay empleados confidenciales ni partidos', 'error'); return }

  // Ajustes MANUALES del período (ediciones que el usuario hizo al cuadrar). Se reaplican
  // sobre el cálculo automático para que NO se pierdan al regenerar. Solo contienen los
  // campos que el usuario realmente cambió (el resto se recalcula normal).
  const manualOverrides = {}
  try {
    const { data: ovs } = await getSb().from('planilla_overrides')
      .select('empleado_id, overrides').eq('periodo', periodo).eq('es_confidencial', planillaModoConf)
    for (const o of (ovs || [])) manualOverrides[o.empleado_id] = o.overrides || {}
  } catch (e) { console.warn('overrides manuales:', e) }

  // Create planilla header
  const { data: planilla, error: pErr } = await getSb().from('planillas').insert({
    periodo,
    fecha_inicio: fechaInicio.toISOString().slice(0, 10),
    fecha_fin: fechaFin.toISOString().slice(0, 10),
    estado: 'borrador',
    es_confidencial: planillaModoConf,
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

  // ── Cargar anticipos y trucha de cuentas 110301-XXX (NETEANDO cargos vs abonos) ──
  // Es un auxiliar: traemos débitos (cargos) Y créditos (abonos) del período y los neteamos
  // por rubro, para no cobrar dos veces algo que ya se saldó dentro de la misma quincena
  // (ej. un cargo de tarifas que luego se abona con un crédito).
  const { data: lineasCxC } = await getSb().from('lineas_partida')
    .select('monto, tipo, cuenta_codigo, descripcion, partida:partidas_contables(fecha_partida, estado)')
    .like('cuenta_codigo', '110301-%')

  const ini = fechaInicio.toISOString().slice(0, 10)
  const fin = fechaFin.toISOString().slice(0, 10)
  const cxcFiltradas = (lineasCxC || []).filter(l =>
    l.partida?.estado === 'aprobada' && l.partida.fecha_partida >= ini && l.partida.fecha_partida <= fin
  )

  const cxcPorCuenta = {}
  for (const l of cxcFiltradas) {
    const cc = l.cuenta_codigo
    const desc = (l.descripcion || '').toUpperCase()
    // Saltar SOLO los abonos (créditos) que genera la propia planilla (desc "PLANILLA {periodo}"),
    // para no restar su propia recuperación. Un CARGO (débito) de adelanto que mencione "planilla"
    // en su glosa (ej. "ADELANTO PENDIENTE DE PLANILLA DE MAYO") SÍ se recupera.
    if (l.tipo === 'credito' && desc.includes('PLANILLA')) continue
    if (!cxcPorCuenta[cc]) cxcPorCuenta[cc] = { anticipos: 0, trucha: 0 }
    const monto = parseFloat(l.monto) || 0
    const signo = l.tipo === 'credito' ? -1 : 1   // crédito (abono) resta; débito (cargo) suma
    if (desc.includes('PRESTAMO') || desc.includes('PRÉSTAMO')) {
      // Préstamos se deducen por cuota, no como anticipo
    } else if (desc.includes('TRUCHA')) {
      cxcPorCuenta[cc].trucha += signo * monto
    } else {
      cxcPorCuenta[cc].anticipos += signo * monto
    }
  }
  // No permitir netos negativos: si los abonos del período superan los cargos, no se deduce
  // nada de ese rubro (el saldo a favor no se suma al sueldo).
  for (const cc in cxcPorCuenta) {
    cxcPorCuenta[cc].anticipos = Math.max(0, Math.round(cxcPorCuenta[cc].anticipos * 100) / 100)
    cxcPorCuenta[cc].trucha = Math.max(0, Math.round(cxcPorCuenta[cc].trucha * 100) / 100)
  }

  // ── Validación: cuentas CXC con cargos que NINGÚN empleado tiene asignada en su ficha ──
  // Caza desajustes como el de Jonathan (cargos en 110301-040 pero la ficha apuntaba a otra
  // cuenta): esos anticipos/trucha no se descontarían a nadie. Avisa antes de continuar.
  try {
    const cuentasEmpleados = new Set((allEmpleados || []).filter(e => e.cuenta_cxc).map(e => String(e.cuenta_cxc)))
    const huerfanas = Object.entries(cxcPorCuenta)
      .filter(([cc, v]) => (v.anticipos + v.trucha) > 0.005 && !cuentasEmpleados.has(String(cc)))
      .map(([cc, v]) => ({ cc, monto: Math.round((v.anticipos + v.trucha) * 100) / 100 }))
    if (huerfanas.length) {
      const nombres = {}
      try {
        const { data: cat } = await getSb().from('catalogo_cuentas').select('codigo, nombre').in('codigo', huerfanas.map(h => h.cc))
        ;(cat || []).forEach(c => { nombres[c.codigo] = c.nombre })
      } catch (_) { /* sin nombres, se muestra solo el código */ }
      const detalle = huerfanas.map(h => `• ${h.cc}${nombres[h.cc] ? ' — ' + nombres[h.cc] : ''}: L. ${fmt(h.monto)}`).join('\n')
      console.warn('CXC con cargos sin empleado asignado (no se descontarán):', huerfanas)
      alert('⚠️ ATENCIÓN — Cuentas CXC con cargos que NINGÚN empleado tiene asignada en su ficha.\n' +
        'Esos anticipos/trucha NO se descontarán hasta corregir la cuenta CXC del empleado:\n\n' +
        detalle +
        '\n\nRevisá la cuenta CXC en la ficha de esos empleados y regenerá la planilla.')
    }
  } catch (e) { console.warn('validación CXC:', e) }

  // Cargar préstamos activos
  const { data: prestamosActivos, error: prestErr } = await getSb().from('prestamos_empleados')
    .select('empleado_id, cuota_quincenal, saldo, activo, fecha_primera_deduccion')
    .eq('activo', true).eq('tipo', 'prestamo')
  if (prestErr) { console.warn('Error leyendo préstamos:', prestErr.message); window.toast?.('Aviso: no se pudieron leer préstamos → ' + prestErr.message, 'error') }

  // Overrides SALARIALES (sin deducciones) derivados de la asistencia, a una base de sueldo dada.
  // Se usa en la general (base = sueldo visible) y en el complemento confidencial (base =
  // complemento), para que el complemento refleje días, vacaciones, incapacidad y HE a su tasa.
  const overridesSalariales = (e, ast, base) => {
    const ov = {}
    if (!ast) { ov.dias_trabajados = 15; return ov }
    ov.horas_extra = Math.round((ast.heNeto || 0) / 60 * 100) / 100
    const rate = (base || 0) / 30
    const diasPagados = ast.diasPagados ?? ast.diasTrabajados ?? 15
    if (e.es_socio) { ov.dias_trabajados = diasPagados; return ov }
    const vacTotal = ast.diasPermisoVac || 0
    const sinGoce = ast.diasPermisoSinGoce || 0
    const noTrabajados = (ast.minNoTrabajados || 0) / 60 / 8
    const incapDias = ast.diasIncapacidad || 0
    const incapEmpresa = ast.diasIncapEmpresa || 0
    // Día con entrada pero SIN salida y SIN permiso que lo justifique → penalidad fija de ½ día.
    const PENAL_SIN_SALIDA_DIAS = 0.5
    const penalSinSalida = (ast.diasSinSalidaPenal || 0) * PENAL_SIN_SALIDA_DIAS
    // "A cuenta de vacaciones" SIEMPRE paga el día y lo descuenta del saldo, aunque éste
    // quede negativo (adelanto contra vacaciones futuras: ej. empleado con pocos meses).
    // El saldo se compensa solo cuando se le acreditan los días ganados (Sumar días) y se
    // muestra en rojo en el módulo de vacaciones. La rebaja real ocurre al aprobar.
    const diasCubiertos = vacTotal
    ov.dias_trabajados = Math.max(0, Math.round((diasPagados - vacTotal - sinGoce - noTrabajados - incapDias - penalSinSalida) * 100) / 100)
    if (diasCubiertos > 0) ov.vacaciones = Math.round(diasCubiertos * rate * 100) / 100
    if (incapEmpresa > 0) ov.incapacidad = Math.round(incapEmpresa * rate * 100) / 100
    return ov
  }

  // Salario partido: el faltante de ANTICIPOS que la general no alcanzó a cobrar (por el piso
  // de L.1) se corre al complemento confidencial para cobrarlo contra el sueldo oculto. Solo
  // anticipos — la trucha y los préstamos se cobran completos en la general. Requiere que la
  // planilla GENERAL del período ya exista (se genera antes que la confidencial).
  const anticipoRecuperadoGeneral = {}
  let puedeCorrerFaltante = false   // solo true si confirmamos qué recuperó la general (evita cobro doble)
  if (planillaModoConf) {
    const { data: plGen } = await getSb().from('planillas')
      .select('id').eq('periodo', periodo).eq('es_confidencial', false).maybeSingle()
    if (!plGen) {
      window.toast?.('Aviso: no hay planilla GENERAL de este período. El faltante de anticipos NO se correrá al complemento confidencial (genera primero la general).', 'error')
    } else {
      const { data: detGen, error: dgErr } = await getSb().from('detalle_planilla')
        .select('empleado_id, anticipos').eq('planilla_id', plGen.id)
      if (dgErr) {
        window.toast?.('Aviso: no se pudo leer el detalle de la planilla general → ' + dgErr.message + '. El faltante de anticipos NO se correrá.', 'error')
      } else {
        for (const dg of (detGen || [])) anticipoRecuperadoGeneral[dg.empleado_id] = parseFloat(dg.anticipos) || 0
        puedeCorrerFaltante = true
      }
    }
  }

  const detalles = activos.map(e => {
    const overrides = {}
    // Complemento confidencial: empleado partido en la planilla confidencial. Paga solo la
    // porción oculta (real − visible), ESPEJANDO el cálculo salarial de la general (días,
    // vacaciones, incapacidad y HE) pero a la tasa del complemento. Sin IHSS, vecinal ni
    // deducciones (todo eso va en la general sobre el sueldo visible).
    if (planillaModoConf && _esSplit(e)) {
      const astC = asistencia.find(a => a.empleado_id === e.id)
      const empComp = { ...e, sueldo_mensual: _complemento(e), planilla_confidencial: true }
      // Faltante de anticipos no cobrado en la general = adelanto original (del auxiliar CXC)
      // − lo que la general efectivamente recuperó. Se carga aquí como anticipo y se cobra
      // contra el sueldo oculto; si ni el oculto alcanza, el piso de L.1 difiere el resto.
      const adelOriginal = (e.cuenta_cxc && cxcPorCuenta[e.cuenta_cxc]) ? (cxcPorCuenta[e.cuenta_cxc].anticipos || 0) : 0
      const recupGeneral = anticipoRecuperadoGeneral[e.id] || 0
      const faltanteAnt = puedeCorrerFaltante ? Math.max(0, Math.round((adelOriginal - recupGeneral) * 100) / 100) : 0
      const ovComp = { ...overridesSalariales(e, astC, _complemento(e)) }
      if (faltanteAnt > 0) ovComp.anticipos = faltanteAnt
      return calcularDetalleEmpleado(empComp, planilla.id, { ...ovComp, ...(manualOverrides[e.id] || {}) })
    }
    // Asistencia (general): salario sobre el sueldo visible + deducción por tardanza.
    const ast = asistencia.find(a => a.empleado_id === e.id)
    if (ast) {
      Object.assign(overrides, overridesSalariales(e, ast, e.sueldo_mensual))
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
    // Préstamos: sumar la cuota de TODOS los préstamos activos del empleado cuya 1ª
    // deducción ya cae dentro de este período (≤ fin). Un empleado puede tener varios.
    const prestamosEmp = (prestamosActivos || []).filter(p => p.empleado_id === e.id)
    let totalCuotaPrest = 0
    for (const prestamo of prestamosEmp) {
      const fpd = (prestamo.fecha_primera_deduccion || '').slice(0, 10)  // normaliza por si trae hora
      if (fpd && fpd > fin) continue
      const cuota = parseFloat(prestamo.cuota_quincenal) || 0
      const saldoPrest = parseFloat(prestamo.saldo) || 0
      totalCuotaPrest += Math.min(cuota, saldoPrest)
    }
    if (totalCuotaPrest > 0) overrides.cxc = Math.round(totalCuotaPrest * 100) / 100
    // En la planilla GENERAL, un empleado partido se trata como normal (IHSS/vecinal sobre el
    // sueldo visible), aunque tenga marcada la casilla confidencial (esa solo aplica a la conf).
    const eCalc = (!planillaModoConf && e.planilla_confidencial) ? { ...e, planilla_confidencial: false } : e
    // Reaplicar los ajustes manuales del usuario (solo los campos editados) sobre lo automático.
    Object.assign(overrides, manualOverrides[e.id] || {})
    return calcularDetalleEmpleado(eCalc, planilla.id, overrides)
  })

  // Insert all details (recuperando el id generado por la BD para poder editarlos luego)
  const { data: detInsertados, error: dErr } = await getSb().from('detalle_planilla').insert(detalles).select()
  if (dErr) { window.toast?.('Error generando detalle: ' + dErr.message, 'error'); return }

  currentDetalle = detInsertados || detalles
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

  // IHSS: no aplica a socios ni a planilla confidencial (fuera del seguro social)
  if (!emp.es_socio && !emp.planilla_confidencial) {
    const ihssCfg = getIHSSConfig()
    ihssLaboral = Math.round(ihssCfg.techo * ihssCfg.pctLaboral * 100) / 100
    ihssPatronal = Math.round(ihssCfg.techo * ihssCfg.pctPatronal * 100) / 100
  }
  // Impuesto vecinal: SÍ aplica a confidenciales (obligación municipal); socios no
  if (!emp.es_socio) {
    impVecinal = overrides.imp_vecinal ?? 0
  }

  let anticipos = overrides.anticipos ?? 0
  let cxc = overrides.cxc ?? 0
  let trucha = overrides.trucha ?? 0
  let otrasDeducciones = overrides.otras_deducciones ?? 0

  // Piso de neto: el neto NUNCA queda negativo. Si las deducciones superan lo que el devengado
  // puede cubrir, se DIFIEREN (no se deducen este período) en orden de prioridad:
  //   anticipos → préstamo (cxc) → trucha → otras → IHSS → impuesto vecinal.
  // Lo diferido queda como saldo pendiente del empleado, para cobrarse cuando tenga sueldo.
  // Objetivo: dejar el neto en L.1; si el devengado no alcanza ni para L.1 (ej. 0 días
  // trabajados, devengado 0), el neto queda en el devengado (0) — nunca negativo.
  const PISO_NETO = 1
  if (!emp.es_socio) {
    const objetivo = Math.min(PISO_NETO, Math.max(0, totalDevengado))
    const totalDed = ihssLaboral + impVecinal + trucha + otrasDeducciones + anticipos + cxc
    let exceso = Math.round((totalDed - (totalDevengado - objetivo)) * 100) / 100   // monto que NO se puede deducir
    if (exceso > 0.005) {
      const recortar = (m) => { const r = Math.min(m, exceso); exceso = Math.round((exceso - r) * 100) / 100; return Math.round((m - r) * 100) / 100 }
      anticipos = recortar(anticipos)
      cxc = recortar(cxc)
      trucha = recortar(trucha)
      otrasDeducciones = recortar(otrasDeducciones)
      ihssLaboral = recortar(ihssLaboral)
      impVecinal = recortar(impVecinal)
    }
  }

  const totalDeducciones = Math.round((ihssLaboral + impVecinal + trucha + otrasDeducciones + anticipos + cxc) * 100) / 100
  const sueldoNeto = Math.round((totalDevengado - totalDeducciones) * 100) / 100

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

  // Reset de filtros al cargar/regenerar una planilla
  currentSeccionFilter = ''
  currentNombreFilter = ''
  const plBuscar = document.getElementById('pl-buscar')
  if (plBuscar) plBuscar.value = ''

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

  renderPlanillaTable()

  // Disable approve button if already approved
  const btnAprobar = document.getElementById('btn-aprobar-planilla')
  const esAprobada = currentPlanilla?.estado === 'aprobada' || currentPlanilla?.estado === 'pagada'
  if (esAprobada) {
    btnAprobar.disabled = true
    btnAprobar.textContent = '✅ Planilla ya aprobada'
  } else {
    btnAprobar.disabled = false
    btnAprobar.textContent = '✅ Aprobar y generar partida'
  }
  // Botón Reabrir: solo super_admin y solo si está aprobada
  const btnReabrir = document.getElementById('btn-reabrir-planilla')
  if (btnReabrir) {
    const esSuper = window._currentProfile?.()?.rol === 'super_admin'
    btnReabrir.style.display = (esAprobada && esSuper) ? '' : 'none'
  }
}

window.filterPlanillaTab = (seccion) => {
  document.querySelectorAll('.pl-tab').forEach(t => t.classList.remove('active'))
  event.target.classList.add('active')
  currentSeccionFilter = seccion
  renderPlanillaTable()
}

window.filtrarPlanillaNombre = (q) => {
  currentNombreFilter = (q || '').trim().toUpperCase()
  renderPlanillaTable()
}

function renderPlanillaTable() {
  let data = currentSeccionFilter ? currentDetalle.filter(d => d.seccion === currentSeccionFilter) : currentDetalle
  if (currentNombreFilter) data = data.filter(d => (d.nombre || '').toUpperCase().includes(currentNombreFilter))
  const tbody = document.getElementById('tbody-planilla')
  const isEditable = currentPlanilla?.estado === 'borrador'

  tbody.innerHTML = data.map((d, i) => {
    const globalIdx = currentDetalle.indexOf(d)
    const otrosIng = (d.ajuste_sueldo || 0) + (d.vacaciones || 0) + (d.incapacidad || 0) +
                     (d.bonificaciones || 0) + (d.otros_ingresos || 0) + (d.comisiones_venta || 0)
    const topado = (d.sueldo_neto || 0) <= 1   // neto topado al piso de L.1 → resaltar en rojo
    return `
    <tr style="${topado ? 'background:#ff000012' : ''}">
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
      <td style="text-align:right">${(d.cxc || 0) > 0 ? fmt(d.cxc) : '—'}</td>
      <td style="text-align:right">${d.trucha > 0 ? fmt(d.trucha) : '—'}</td>
      <td style="text-align:right">${d.otras_deducciones > 0 ? fmt(d.otras_deducciones) : '—'}</td>
      <td style="text-align:right;color:var(--red)">${fmt(d.total_deducciones)}</td>
      <td style="text-align:right;font-weight:600;color:${topado ? 'var(--red)' : 'var(--green)'}">${fmt(d.sueldo_neto)}</td>
      <td style="text-align:center">${isEditable ? `<button class="btn btn-ghost" style="padding:2px 6px;font-size:11px" onclick="editarDetallePlanilla(${globalIdx})">✏️</button>` : ''}</td>
    </tr>`
  }).join('')

  // Footer totals
  const tfoot = document.getElementById('tfoot-planilla')
  const totals = data.reduce((acc, d) => {
    acc.quincenal += d.sueldo_quincenal || 0
    acc.he += d.monto_he || 0
    acc.otros_ing += (d.ajuste_sueldo || 0) + (d.vacaciones || 0) + (d.incapacidad || 0) +
                     (d.bonificaciones || 0) + (d.otros_ingresos || 0) + (d.comisiones_venta || 0)
    acc.devengado += d.total_devengado || 0
    acc.ihss += d.ihss_laboral || 0
    acc.vecinal += d.imp_vecinal || 0
    acc.anticipos += (d.anticipos || 0)
    acc.prestamo += (d.cxc || 0)
    acc.trucha += d.trucha || 0
    acc.otras_ded += d.otras_deducciones || 0
    acc.deducciones += d.total_deducciones || 0
    acc.neto += d.sueldo_neto || 0
    return acc
  }, { quincenal: 0, he: 0, otros_ing: 0, devengado: 0, ihss: 0, vecinal: 0, anticipos: 0, prestamo: 0, trucha: 0, otras_ded: 0, deducciones: 0, neto: 0 })

  tfoot.innerHTML = `
    <tr style="font-weight:600;border-top:2px solid var(--border)">
      <td colspan="4">TOTAL (${data.length} empleados)</td>
      <td style="text-align:right">${fmt(totals.quincenal)}</td>
      <td style="text-align:right">${fmt(totals.he)}</td>
      <td style="text-align:right">${totals.otros_ing > 0 ? fmt(totals.otros_ing) : '—'}</td>
      <td style="text-align:right">${fmt(totals.devengado)}</td>
      <td style="text-align:right">${fmt(totals.ihss)}</td>
      <td style="text-align:right">${fmt(totals.vecinal)}</td>
      <td style="text-align:right">${fmt(totals.anticipos)}</td>
      <td style="text-align:right">${fmt(totals.prestamo)}</td>
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
  // Snapshot de lo mostrado, para detectar al guardar QUÉ campos cambió el usuario.
  editingDetalleSnapshot = {
    dias_trabajados: +(d.dias_trabajados || 0), horas_extra: +(d.horas_extra || 0), ajuste_sueldo: +(d.ajuste_sueldo || 0),
    vacaciones: +(d.vacaciones || 0), incapacidad: +(d.incapacidad || 0), bonificaciones: +(d.bonificaciones || 0),
    otros_ingresos: +(d.otros_ingresos || 0), comisiones_venta: +(d.comisiones_venta || 0), anticipos: +(d.anticipos || 0),
    cxc: +(d.cxc || 0), trucha: +(d.trucha || 0), otras_deducciones: +(d.otras_deducciones || 0)
  }
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

  // Guardar como AJUSTE MANUAL del período solo los campos que el usuario cambió (vs lo
  // mostrado), merged con los ajustes previos. Así sobreviven a "Regenerar planilla".
  try {
    const campos = ['dias_trabajados', 'horas_extra', 'ajuste_sueldo', 'vacaciones', 'incapacidad', 'bonificaciones', 'otros_ingresos', 'comisiones_venta', 'anticipos', 'cxc', 'trucha', 'otras_deducciones']
    const snap = editingDetalleSnapshot || {}
    const cambios = {}
    for (const c of campos) {
      const nuevo = Math.round((overrides[c] || 0) * 100) / 100
      const viejo = Math.round((snap[c] || 0) * 100) / 100
      if (nuevo !== viejo) cambios[c] = nuevo
    }
    if (Object.keys(cambios).length && currentPlanilla?.periodo && d.empleado_id) {
      const { data: prev } = await getSb().from('planilla_overrides')
        .select('overrides').eq('periodo', currentPlanilla.periodo)
        .eq('es_confidencial', !!currentPlanilla.es_confidencial).eq('empleado_id', d.empleado_id).maybeSingle()
      const merged = { ...(prev?.overrides || {}), ...cambios }
      await getSb().from('planilla_overrides').upsert({
        periodo: currentPlanilla.periodo,
        es_confidencial: !!currentPlanilla.es_confidencial,
        empleado_id: d.empleado_id,
        overrides: merged,
        updated_at: new Date().toISOString()
      }, { onConflict: 'periodo,es_confidencial,empleado_id' })
    }
  } catch (e) { console.warn('guardar ajuste manual:', e) }

  currentDetalle[idx] = { ...d, ...recalc }
  closeModal('modal-detalle-pl')
  await actualizarTotalesPlanilla()
  renderPlanilla()
  window.toast?.('Detalle actualizado y recalculado', 'ok')
}

// Quitar los ajustes manuales guardados de un empleado (escape si te equivocaste). Al
// regenerar la planilla, ese empleado vuelve a calcularse 100% automático.
window.quitarAjusteManualDetalle = async () => {
  const idx = editingDetalleIdx
  if (idx === null) return
  const d = currentDetalle[idx]
  if (!currentPlanilla?.periodo || !d?.empleado_id) { window.toast?.('No hay ajustes que quitar', 'error'); return }
  if (!confirm('¿Quitar los ajustes manuales de ' + d.nombre + '? Volverá a calcularse automático cuando regenerés la planilla.')) return
  const { error } = await getSb().from('planilla_overrides').delete()
    .eq('periodo', currentPlanilla.periodo)
    .eq('es_confidencial', !!currentPlanilla.es_confidencial)
    .eq('empleado_id', d.empleado_id)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  closeModal('modal-detalle-pl')
  window.toast?.('Ajustes manuales quitados. Regenerá la planilla para recalcular este empleado.', 'ok')
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

// ── Genera la partida contable de la planilla (agrega por código de cuenta) ──
// Devuelve { ok, skipped, numero, error }. Valida TODO antes de escribir nada.
async function generarPartidaPlanilla(periodo, fechaPartida) {
  const sb = getSb()

  // Candado anti-duplicado: ¿ya hay partida de esta planilla?
  const { data: existe, error: exErr } = await sb.from('partidas_contables')
    .select('numero_partida').ilike('descripcion', `PLANILLA ${periodo}%`).limit(1)
  if (exErr) return { ok: false, error: 'No se pudo verificar partidas: ' + exErr.message }
  if ((existe || []).length) return { ok: true, skipped: true, numero: existe[0].numero_partida }

  // Acumular montos. Los gastos (débitos) se acumulan por código + zona (Taller/Yonker)
  // para asignarles el centro de costo correcto; los créditos solo por código.
  const deb = {}, cre = {}
  const addD = (cod, zona, m) => { if (cod && m) { const k = `${cod}|${zona || ''}`; deb[k] = (deb[k] || 0) + m } }
  const addC = (cod, m) => { if (cod && m) cre[cod] = (cre[cod] || 0) + m }
  const faltantes = new Set(), sinCxc = []

  for (const d of currentDetalle) {
    const C = CUENTAS_SECCION[d.seccion]
    if (!C) { faltantes.add(d.seccion || `(sin sección: ${d.nombre})`); continue }
    const zona = (d.seccion || '').includes('Yonker') ? 'Yonker' : ((d.seccion || '').includes('Taller') ? 'Taller' : '')
    // Débitos (gastos). "Otras deducciones" (tardanza) reduce el gasto de sueldo.
    addD(C.sueldos, zona, (d.sueldo_quincenal || 0) - (d.otras_deducciones || 0))
    addD(C.he, zona, d.monto_he || 0)
    addD(C.vacaciones, zona, d.vacaciones || 0)
    addD(C.incapacidades, zona, d.incapacidad || 0)
    addD(C.bonificaciones, zona, d.bonificaciones || 0)
    addD(C.otros, zona, (d.otros_ingresos || 0) + (d.ajuste_sueldo || 0) + (d.comisiones_venta || 0))
    addD(C.ihss_patronal_gasto, zona, d.ihss_patronal || 0)
    // Créditos (por pagar / banco)
    addC(C.ihss_laboral, d.ihss_laboral || 0)
    addC(C.ihss_patronal_cxp, d.ihss_patronal || 0)
    addC(C.imp_vecinal, d.imp_vecinal || 0)
    // La trucha es cuenta por cobrar del empleado (se carga a su CXC al consumir, contra el
    // ingreso 410305-002). En planilla se RECUPERA abonando a su CXC 110301-XXX — NO se abona
    // a 210404-001 (ese doble registro descuadraba). Por eso la trucha entra en antCxc.
    const antCxc = (d.anticipos || 0) + (d.cxc || 0) + (d.trucha || 0)
    if (antCxc > 0) {
      if (!d.cuenta_cxc) sinCxc.push(d.nombre)
      else addC(d.cuenta_cxc, antCxc)
    }
    addC(C.chequera, d.sueldo_neto || 0)
  }

  if (faltantes.size) return { ok: false, error: `Secciones sin cuentas mapeadas: ${[...faltantes].join(', ')}` }
  if (sinCxc.length) return { ok: false, error: `Empleados con anticipo/CXC sin cuenta_cxc: ${sinCxc.join(', ')}` }

  // Resolver centros de costo reales para los gastos (Taller → Tecnicentro)
  const { data: centrosCC } = await sb.from('centros_costo').select('id, nombre')
  const centroZona = {
    Taller: (centrosCC || []).find(c => /tecnicentro/i.test(c.nombre))?.id || null,
    Yonker: (centrosCC || []).find(c => /yonker/i.test(c.nombre))?.id || null
  }

  // Traer cuentas del catálogo (las claves de débito son `codigo|zona`)
  const codigos = [...new Set([...Object.keys(deb).map(k => k.split('|')[0]), ...Object.keys(cre)])]
  const { data: cuentas, error: cErr } = await sb.from('catalogo_cuentas')
    .select('id, codigo, nombre').in('codigo', codigos)
  if (cErr) return { ok: false, error: 'Error leyendo catálogo: ' + cErr.message }
  const mapC = {}; for (const c of (cuentas || [])) mapC[c.codigo] = c
  const noEnCatalogo = codigos.filter(c => !mapC[c])
  if (noEnCatalogo.length) return { ok: false, error: `Cuentas inexistentes en el catálogo: ${noEnCatalogo.join(', ')}` }

  // Construir líneas (redondeo a 2 decimales)
  const r2 = x => Math.round(x * 100) / 100
  const lineas = []
  let totalDeb = 0, totalCre = 0
  for (const [key, m] of Object.entries(deb)) {
    const monto = r2(m); if (monto <= 0) continue
    const [cod, zona] = key.split('|')
    const c = mapC[cod]
    lineas.push({ cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre, centro_costo_id: centroZona[zona] || null, tipo: 'debito', monto, descripcion: `PLANILLA ${periodo}${zona ? ' · ' + zona.toUpperCase() : ''}`, aplica_fiscal: false })
    totalDeb = r2(totalDeb + monto)
  }
  for (const [cod, m] of Object.entries(cre)) {
    const monto = r2(m); if (monto <= 0) continue
    const c = mapC[cod]
    lineas.push({ cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre, centro_costo_id: null, tipo: 'credito', monto, descripcion: `PLANILLA ${periodo}`, aplica_fiscal: false })
    totalCre = r2(totalCre + monto)
  }

  // Ajuste de centavos por redondeo: cuadrar contra la línea de banco (neto)
  const dif = r2(totalDeb - totalCre)
  if (dif !== 0) {
    const banco = lineas.find(l => l.tipo === 'credito' && l.cuenta_codigo === '110103-001')
    if (banco) { banco.monto = r2(banco.monto + dif); totalCre = r2(totalCre + dif) }
  }
  if (r2(totalDeb - totalCre) !== 0) {
    return { ok: false, error: `La partida no cuadra (D ${totalDeb} ≠ C ${totalCre}). No se generó.` }
  }

  // Insertar partida + líneas
  const numPartida = await window.siguienteNumeroPartida()
  const desc = `PLANILLA ${periodo} (NÓMINA ${currentDetalle.length} EMPLEADOS)`

  const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
    centro_costo_id: null, fecha_partida: fechaPartida, numero_partida: numPartida,
    descripcion: desc, tipo_origen: 'otro', estado: 'borrador', total: totalDeb,
    generada_por: window._currentProfile?.()?.id || null
  }).select().single()
  if (pErr || !partida) return { ok: false, error: 'Error creando partida: ' + (pErr?.message || '') }

  const filas = lineas.map(l => ({ partida_id: partida.id, ...l }))
  const { error: lErr } = await sb.from('lineas_partida').insert(filas)
  if (lErr) return { ok: false, error: 'Error en líneas: ' + lErr.message }

  return { ok: true, numero: numPartida, total: totalDeb }
}

// ── Genera la partida de PROVISIONES (13vo, 14vo, vacaciones, cesantía) ──
// Misma filosofía que la partida de planilla: valida todo antes de escribir,
// idempotente por período, cuadrada al centavo. Excluye socios.
async function generarPartidaProvisiones(periodo, fechaPartida, esConf = false) {
  const sb = getSb()
  const descBase = esConf ? `PROVISION PLANILLA CONFIDENCIAL ${periodo}` : `PROVISION PLANILLA ${periodo}`

  // Candado anti-duplicado propio
  const { data: existe, error: exErr } = await sb.from('partidas_contables')
    .select('numero_partida').ilike('descripcion', `${descBase}%`).limit(1)
  if (exErr) return { ok: false, error: 'No se pudo verificar partidas: ' + exErr.message }
  if ((existe || []).length) return { ok: true, skipped: true, numero: existe[0].numero_partida }

  // es_socio + fecha_ingreso por empleado
  const ids = [...new Set(currentDetalle.map(d => d.empleado_id).filter(Boolean))]
  const empMap = {}
  if (ids.length) {
    const { data: emps, error: eErr } = await sb.from('empleados').select('id, es_socio, fecha_ingreso, planilla_confidencial, conf_provisiona, conf_centro').in('id', ids)
    if (eErr) return { ok: false, error: 'Error leyendo empleados: ' + eErr.message }
    for (const e of (emps || [])) empMap[e.id] = e
  }

  const r2 = x => Math.round(x * 100) / 100
  const CONCEPTOS = ['aguinaldo', 'catorceavo', 'vacaciones', 'cesantia']
  const debGasto = {}   // `concepto|zona` (zona: Taller/Yonker) → monto

  for (const d of currentDetalle) {
    const emp = empMap[d.empleado_id]
    if (emp?.es_socio) continue  // socios no acumulan prestaciones
    if (esConf && !emp?.conf_provisiona) continue  // confidencial: provisiona solo si está marcado
    const zona = esConf
      ? (emp?.conf_centro === 'YONKER' ? 'Yonker' : 'Tecnimax')
      : (/yonker/i.test(d.seccion || '') ? 'Yonker' : 'Taller')
    // Base: salario ordinario devengado (excluye incapacidad, que no es salario)
    const base = (d.sueldo_quincenal || 0) - (d.otras_deducciones || 0) + (d.monto_he || 0)
      + (d.vacaciones || 0) + (d.bonificaciones || 0) + (d.otros_ingresos || 0)
      + (d.ajuste_sueldo || 0) + (d.comisiones_venta || 0)
    if (base <= 0) continue

    const pctVac = PROVISIONES_CFG.vacaciones_modo === 'antiguedad'
      ? _diasVacPorAntiguedad(emp?.fecha_ingreso, fechaPartida) * 100 / 360
      : PROVISIONES_CFG.pct_vacaciones_fijo
    const montos = {
      aguinaldo: base * PROVISIONES_CFG.pct_aguinaldo / 100,
      catorceavo: base * PROVISIONES_CFG.pct_catorceavo / 100,
      vacaciones: base * pctVac / 100,
      cesantia: base * PROVISIONES_CFG.pct_cesantia / 100
    }
    for (const c of CONCEPTOS) debGasto[`${c}|${zona}`] = (debGasto[`${c}|${zona}`] || 0) + montos[c]
  }

  // Redondear los buckets de gasto; el pasivo de cada concepto = suma de sus
  // gastos ya redondeados → la partida cuadra al centavo por construcción
  for (const k of Object.keys(debGasto)) debGasto[k] = r2(debGasto[k])
  const crePasivo = {}
  for (const c of CONCEPTOS) {
    crePasivo[c] = r2(['Taller', 'Yonker', 'Tecnimax'].reduce((s, z) => s + (debGasto[`${c}|${z}`] || 0), 0))
  }
  const totalDeb = r2(Object.values(debGasto).reduce((s, x) => s + x, 0))
  const totalCre = r2(Object.values(crePasivo).reduce((s, x) => s + x, 0))
  if (totalCre <= 0) return { ok: true, skipped: true, numero: null, vacia: true }

  // Centros de costo para las líneas de gasto (Taller → Tecnicentro)
  const { data: centrosCC } = await sb.from('centros_costo').select('id, nombre')
  const centroZona = {
    Taller: (centrosCC || []).find(c => /tecnicentro/i.test(c.nombre))?.id || null,
    Yonker: (centrosCC || []).find(c => /yonker/i.test(c.nombre))?.id || null,
    Tecnimax: (centrosCC || []).find(c => /tecnimax/i.test(c.nombre))?.id || null
  }

  // Validar cuentas en el catálogo
  const codGasto = Object.keys(debGasto).filter(k => debGasto[k] > 0).map(k => PROVISIONES_CFG.cuentas_gasto[k.split('|')[0]])
  const codPasivo = Object.entries(crePasivo).filter(([, m]) => m > 0).map(([k]) => PROVISIONES_CFG.cuentas_pasivo[k])
  const codigos = [...new Set([...codGasto, ...codPasivo])]
  const { data: cuentas, error: cErr } = await sb.from('catalogo_cuentas')
    .select('id, codigo, nombre').in('codigo', codigos)
  if (cErr) return { ok: false, error: 'Error leyendo catálogo: ' + cErr.message }
  const mapC = {}; for (const c of (cuentas || [])) mapC[c.codigo] = c
  const noCat = codigos.filter(c => !mapC[c])
  if (noCat.length) return { ok: false, error: `Cuentas de provisión inexistentes en el catálogo: ${noCat.join(', ')} — créalas en Catálogo de cuentas o ajusta PROVISIONES_CFG` }

  // Construir e insertar la partida
  const desc = `${descBase} (13vo, 14vo, vacaciones, cesantia)`
  const lineas = []
  for (const [key, m] of Object.entries(debGasto)) {
    if (m <= 0) continue
    const [concepto, zona] = key.split('|')
    const c = mapC[PROVISIONES_CFG.cuentas_gasto[concepto]]
    lineas.push({ cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre, tipo: 'debito', monto: m,
      centro_costo_id: centroZona[zona] || null, descripcion: `${desc} · ${zona.toUpperCase()}`, aplica_fiscal: false })
  }
  const etiqueta = { aguinaldo: 'AGUINALDO', catorceavo: 'CATORCEAVO', vacaciones: 'VACACIONES', cesantia: 'CESANTIA' }
  for (const [k, m] of Object.entries(crePasivo)) {
    if (m <= 0) continue
    const c = mapC[PROVISIONES_CFG.cuentas_pasivo[k]]
    lineas.push({ cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre, tipo: 'credito', monto: m,
      centro_costo_id: null, descripcion: `${desc} · ${etiqueta[k]}`, aplica_fiscal: false })
  }

  const quienId = window._currentProfile?.()?.id || null
  let numero
  try { numero = await window.siguienteNumeroPartida() } catch (e) { return { ok: false, error: 'No se pudo obtener número de partida: ' + e.message } }
  const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
    centro_costo_id: null, fecha_partida: fechaPartida, numero_partida: numero,
    descripcion: desc, tipo_origen: 'otro', estado: 'borrador', total: totalDeb, generada_por: quienId
  }).select().single()
  if (pErr) return { ok: false, error: 'Error creando partida de provisiones: ' + pErr.message }
  const { error: lErr } = await sb.from('lineas_partida').insert(lineas.map(l => ({ ...l, partida_id: partida.id })))
  if (lErr) {
    await sb.from('partidas_contables').delete().eq('id', partida.id)  // no dejar partida sin líneas
    return { ok: false, error: 'Error creando líneas de provisiones: ' + lErr.message }
  }
  return { ok: true, skipped: false, numero }
}

// ── Genera la partida de la PLANILLA CONFIDENCIAL ──
// Cargo: sueldos a gasto administrativo (CONF_CFG.gasto_sueldos) con el centro
// de costo de cada empleado (Tecnimax/Yonker). Sin IHSS. Vecinal y trucha sí.
async function generarPartidaConfidencial(periodo, fechaPartida) {
  const sb = getSb()
  const { data: existe, error: exErr } = await sb.from('partidas_contables')
    .select('numero_partida').ilike('descripcion', `PLANILLA CONFIDENCIAL ${periodo}%`).limit(1)
  if (exErr) return { ok: false, error: 'No se pudo verificar partidas: ' + exErr.message }
  if ((existe || []).length) return { ok: true, skipped: true, numero: existe[0].numero_partida }

  const ids = [...new Set(currentDetalle.map(d => d.empleado_id).filter(Boolean))]
  const empMap = {}
  if (ids.length) {
    const { data: emps, error: eErr } = await sb.from('empleados').select('id, conf_centro').in('id', ids)
    if (eErr) return { ok: false, error: 'Error leyendo empleados: ' + eErr.message }
    for (const e of (emps || [])) empMap[e.id] = e
  }
  const { data: centrosCC } = await sb.from('centros_costo').select('id, nombre')
  const centroIdConf = {
    TECNIMAX: (centrosCC || []).find(c => /tecnimax/i.test(c.nombre))?.id || null,
    YONKER: (centrosCC || []).find(c => /yonker/i.test(c.nombre))?.id || null
  }

  const r2 = x => Math.round(x * 100) / 100
  const debGasto = {}, cre = {}
  const addC = (cod, m) => { if (cod && m) cre[cod] = (cre[cod] || 0) + m }
  const sinCxc = []
  for (const d of currentDetalle) {
    const ck = (empMap[d.empleado_id]?.conf_centro === 'YONKER') ? 'YONKER' : 'TECNIMAX'
    const gasto = (d.total_devengado || 0) - (d.otras_deducciones || 0)
    if (gasto > 0) debGasto[ck] = (debGasto[ck] || 0) + gasto
    addC(CONF_CFG.imp_vecinal[ck], d.imp_vecinal || 0)
    // Trucha → se recupera por la CXC del empleado (no a la cuenta de trucha). Ver nota en
    // generarPartidaPlanilla: el ingreso ya se reconoció al consumir; aquí solo se cobra.
    const antCxc = (d.anticipos || 0) + (d.cxc || 0) + (d.trucha || 0)
    if (antCxc > 0) {
      if (!d.cuenta_cxc) sinCxc.push(d.nombre)
      else addC(d.cuenta_cxc, antCxc)
    }
    addC(CONF_CFG.chequera, d.sueldo_neto || 0)
  }
  if (sinCxc.length) return { ok: false, error: `Empleados con anticipo/CXC sin cuenta_cxc: ${sinCxc.join(', ')}` }

  for (const k of Object.keys(debGasto)) debGasto[k] = r2(debGasto[k])
  for (const k of Object.keys(cre)) cre[k] = r2(cre[k])
  const totalDeb = r2(Object.values(debGasto).reduce((s, x) => s + x, 0))
  const totalCre = r2(Object.values(cre).reduce((s, x) => s + x, 0))
  if (totalDeb <= 0) return { ok: true, skipped: true, numero: null, vacia: true }
  if (Math.abs(totalDeb - totalCre) > 0.02) return { ok: false, error: `Partida confidencial descuadrada: debe ${totalDeb} vs haber ${totalCre}` }

  const codigos = [...new Set([CONF_CFG.gasto_sueldos, ...Object.keys(cre)])]
  const { data: cuentas, error: cErr } = await sb.from('catalogo_cuentas')
    .select('id, codigo, nombre').in('codigo', codigos)
  if (cErr) return { ok: false, error: 'Error leyendo catálogo: ' + cErr.message }
  const mapC = {}; for (const c of (cuentas || [])) mapC[c.codigo] = c
  const noCat = codigos.filter(c => !mapC[c])
  if (noCat.length) return { ok: false, error: `Cuentas inexistentes en el catálogo: ${noCat.join(', ')} — ajusta CONF_CFG en rrhh.js` }

  const desc = `PLANILLA CONFIDENCIAL ${periodo}`
  const lineas = []
  const gc = mapC[CONF_CFG.gasto_sueldos]
  for (const [ck, m] of Object.entries(debGasto)) {
    if (m <= 0) continue
    lineas.push({ cuenta_id: gc.id, cuenta_codigo: gc.codigo, cuenta_nombre: gc.nombre, tipo: 'debito', monto: m,
      centro_costo_id: centroIdConf[ck] || null, descripcion: `${desc} · ${ck}`, aplica_fiscal: false })
  }
  for (const [cod, m] of Object.entries(cre)) {
    if (m <= 0) continue
    const c = mapC[cod]
    lineas.push({ cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre, tipo: 'credito', monto: m,
      centro_costo_id: null, descripcion: desc, aplica_fiscal: false })
  }

  const quienId = window._currentProfile?.()?.id || null
  let numero
  try { numero = await window.siguienteNumeroPartida() } catch (e) { return { ok: false, error: 'No se pudo obtener número de partida: ' + e.message } }
  const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
    centro_costo_id: null, fecha_partida: fechaPartida, numero_partida: numero,
    descripcion: desc, tipo_origen: 'otro', estado: 'borrador', total: totalDeb, generada_por: quienId
  }).select().single()
  if (pErr) return { ok: false, error: 'Error creando partida confidencial: ' + pErr.message }
  const { error: lErr } = await sb.from('lineas_partida').insert(lineas.map(l => ({ ...l, partida_id: partida.id })))
  if (lErr) {
    await sb.from('partidas_contables').delete().eq('id', partida.id)
    return { ok: false, error: 'Error creando líneas: ' + lErr.message }
  }
  return { ok: true, skipped: false, numero }
}

// ── Aprobar planilla: rebaja saldo de vacaciones usado + genera partida ──
window.aprobarPlanilla = async () => {
  if (!currentPlanilla || currentPlanilla.estado !== 'borrador') return
  if (!confirm('¿Aprobar esta planilla? Se rebajará del saldo de vacaciones los días cubiertos en esta quincena.')) return

  const sb = getSb()
  const periodo = currentPlanilla.periodo
  const fechaMov = currentPlanilla.fecha_fin || new Date().toISOString().slice(0, 10)
  const quienId = window._currentProfile?.()?.nombre || null

  // Candado anti doble-rebaja: ¿ya hay movimientos 'permiso' de esta planilla?
  const { data: yaAplicado, error: gErr } = await sb.from('vacaciones_movimientos')
    .select('id').eq('tipo', 'permiso').eq('periodo', periodo).limit(1)
  if (gErr) { window.toast?.('No se pudo verificar movimientos de vacaciones: ' + gErr.message, 'error'); return }
  const yaSeAplico = (yaAplicado || []).length > 0

  // Rebajar saldo de vacaciones por los días cubiertos (una sola vez por período).
  // IMPORTANTE: primero se inserta el movimiento (y se valida); SOLO si grabó, se rebaja
  // el saldo. Así nunca se rebaja sin dejar rastro ni se duplica al regenerar/reaprobar.
  let rebajados = 0
  const errores = []
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

      // 1) Movimiento primero (con verificación de error)
      const { error: mErr } = await sb.from('vacaciones_movimientos').insert({
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
        partida_numero: null,
        created_by: quienId
      })
      if (mErr) { errores.push(`${d.nombre}: ${mErr.message}`); continue }  // NO rebaja si no grabó

      // 2) Solo si el movimiento grabó, se rebaja el saldo
      await sb.from('empleados').update({ vacaciones_saldo_dias: saldoNuevo }).eq('id', d.empleado_id)
      rebajados++
    }
  }

  // Si hubo errores grabando movimientos, NO se aprueba (evita rebajas sin rastro).
  if (errores.length) {
    window.toast?.('No se aprobó: error grabando vacaciones → ' + errores[0], 'error')
    return
  }

  // Generar la partida contable (cuadrada; idempotente por período). Si falla, no aprueba.
  const esConf = !!currentPlanilla.es_confidencial
  const part = esConf
    ? await generarPartidaConfidencial(periodo, fechaMov)
    : await generarPartidaPlanilla(periodo, fechaMov)
  if (!part.ok) {
    window.toast?.('No se aprobó: ' + part.error, 'error')
    return
  }

  // Partida de PROVISIONES (13vo, 14vo, vacaciones, cesantía) — junto a la planilla
  let prov = { ok: true, skipped: true, numero: null }
  if (PROVISIONES_CFG.activo) {
    prov = await generarPartidaProvisiones(periodo, fechaMov, esConf)
    if (!prov.ok) {
      window.toast?.('No se aprobó: provisiones → ' + prov.error, 'error')
      return
    }
  }

  // Rebajar el saldo de los préstamos por la cuota deducida (abono primero, luego saldo).
  // Candado por préstamo+período (no rebaja dos veces); inactiva el préstamo al llegar a 0.
  let prestAbonados = 0
  const { data: prestActivos } = await sb.from('prestamos_empleados')
    .select('id, empleado_id, saldo, cuota_quincenal, fecha_primera_deduccion').eq('activo', true).eq('tipo', 'prestamo')
  const { data: abonosPrev, error: abErr } = await sb.from('abonos_prestamo_emp')
    .select('prestamo_id').eq('periodo', periodo)
  if (abErr) { window.toast?.('No se aprobó: no se pudo verificar abonos de préstamo → ' + abErr.message, 'error'); return }
  const yaAbonado = new Set((abonosPrev || []).map(a => a.prestamo_id))
  const errP = []
  for (const d of currentDetalle) {
    let restante = Math.round((d.cxc || 0) * 100) / 100   // total de préstamo deducido en planilla
    if (restante <= 0 || !d.empleado_id) continue
    // Préstamos del empleado, vigentes (1ª deducción ya llegó) y no abonados este período.
    // Se reparte 'restante' entre ellos (cada uno topado por su cuota y su saldo).
    const prestamosEmp = (prestActivos || [])
      .filter(p => p.empleado_id === d.empleado_id && !yaAbonado.has(p.id))
      .filter(p => { const fpd = (p.fecha_primera_deduccion || '').slice(0, 10); return !fpd || fpd <= fechaMov })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))   // orden estable
    for (const prest of prestamosEmp) {
      if (restante <= 0) break
      const saldoActual = parseFloat(prest.saldo) || 0
      const cuota = parseFloat(prest.cuota_quincenal) || 0
      const abono = Math.round(Math.min(cuota, saldoActual, restante) * 100) / 100
      if (abono <= 0) continue
      const saldoNuevo = Math.round((saldoActual - abono) * 100) / 100
      // 1) Abono primero (traza). 2) Solo si grabó, se rebaja el saldo.
      const { error: aErr } = await sb.from('abonos_prestamo_emp').insert({
        prestamo_id: prest.id, empleado_id: d.empleado_id, empleado_nombre: d.nombre,
        fecha: fechaMov, monto: abono, saldo_resultante: saldoNuevo,
        periodo, origen: 'planilla', created_by: quienId
      })
      if (aErr) { errP.push(`${d.nombre}: ${aErr.message}`); break }
      await sb.from('prestamos_empleados').update({ saldo: saldoNuevo, activo: saldoNuevo > 0 }).eq('id', prest.id)
      restante = Math.round((restante - abono) * 100) / 100
      prestAbonados++
    }
  }
  if (errP.length) { window.toast?.('No se aprobó: error abonando préstamos → ' + errP[0], 'error'); return }

  // Aprobar la planilla
  const { error } = await sb.from('planillas').update({
    estado: 'aprobada',
    aprobada_at: new Date().toISOString()
  }).eq('id', currentPlanilla.id)
  if (error) { window.toast?.('Error aprobando: ' + error.message, 'error'); return }

  currentPlanilla.estado = 'aprobada'
  renderPlanilla()
  let msg = '✅ Planilla aprobada.'
  if (part.skipped) msg += ` Partida #${part.numero} ya existía.`
  else msg += ` Partida #${part.numero} generada (borrador).`
  if (prov.numero) msg += prov.skipped ? ` Provisiones #${prov.numero} ya existía.` : ` Provisiones #${prov.numero} generada (borrador).`
  else if (prov.vacia) msg += ' Sin provisiones (solo socios o base 0).'
  if (yaSeAplico) msg += ' Vacaciones ya estaban aplicadas.'
  else if (rebajados > 0) msg += ` Vacaciones rebajadas a ${rebajados} empleado(s).`
  if (prestAbonados > 0) msg += ` Préstamos abonados: ${prestAbonados}.`
  window.toast?.(msg, 'ok')
  window.logActividad?.('planilla_aprobada', 'rrhh', `${periodo} · partida #${part.numero} · provisiones #${prov.numero || '—'} · vac: ${rebajados} · prest: ${prestAbonados}`)
}

// ── Reabrir planilla: revierte TODO lo de aprobar (super_admin) ──
window.reabrirPlanilla = async () => {
  if (!currentPlanilla) return
  if (window._currentProfile?.()?.rol !== 'super_admin') {
    window.toast?.('Solo un Super Admin puede reabrir una planilla', 'error'); return
  }
  if (currentPlanilla.estado !== 'aprobada' && currentPlanilla.estado !== 'pagada') {
    window.toast?.('La planilla no está aprobada', 'error'); return
  }
  const resp = prompt('Esto REVERTIRÁ la partida, repondrá el saldo de vacaciones y de préstamos, y dejará la planilla en borrador.\n\nEscribí REABRIR para confirmar:')
  if ((resp || '').trim().toUpperCase() !== 'REABRIR') { window.toast?.('Cancelado', 'info'); return }

  const sb = getSb()
  const periodo = currentPlanilla.periodo
  const hoy = new Date().toLocaleDateString('en-CA')
  const quienId = window._currentProfile?.()?.id || null

  try {
    // 1) PARTIDA: borrar si está en borrador; contra-asiento si ya estaba aprobada
    const esConfR = !!currentPlanilla.es_confidencial
    const basePat = esConfR ? `PLANILLA CONFIDENCIAL ${periodo}` : `PLANILLA ${periodo}`
    const provPat = esConfR ? `PROVISION PLANILLA CONFIDENCIAL ${periodo}` : `PROVISION PLANILLA ${periodo}`
    const { data: partidas } = await sb.from('partidas_contables')
      .select('id, numero_partida, estado, total')
      .or(`descripcion.ilike.${basePat}%,descripcion.ilike.${provPat}%`)
    for (const p of (partidas || [])) {
      if (p.estado === 'borrador') {
        await sb.from('lineas_partida').delete().eq('partida_id', p.id)
        await sb.from('partidas_contables').delete().eq('id', p.id)
      } else {
        // Contra-asiento: mismas líneas con débito/crédito invertidos
        const { data: lineas } = await sb.from('lineas_partida').select('*').eq('partida_id', p.id)
        const numRev = await window.siguienteNumeroPartida()
        const descRev = `REVERSION PLANILLA ${periodo} (ANULA PARTIDA #${p.numero_partida})`
        const { data: partidaRev } = await sb.from('partidas_contables').insert({
          centro_costo_id: null, fecha_partida: hoy, numero_partida: numRev, descripcion: descRev,
          tipo_origen: 'otro', estado: 'borrador', total: p.total, generada_por: quienId
        }).select().single()
        if (partidaRev && lineas?.length) {
          await sb.from('lineas_partida').insert(lineas.map(l => ({
            partida_id: partidaRev.id, cuenta_id: l.cuenta_id, cuenta_codigo: l.cuenta_codigo,
            cuenta_nombre: l.cuenta_nombre, tipo: l.tipo === 'debito' ? 'credito' : 'debito',
            monto: l.monto, descripcion: descRev, aplica_fiscal: l.aplica_fiscal
          })))
        }
      }
    }

    // 2) VACACIONES: reponer saldo y borrar movimientos del período
    const { data: movVac } = await sb.from('vacaciones_movimientos')
      .select('id, empleado_id, dias').eq('tipo', 'permiso').eq('periodo', periodo)
    for (const m of (movVac || [])) {
      const { data: emp } = await sb.from('empleados')
        .select('vacaciones_saldo_dias').eq('id', m.empleado_id).maybeSingle()
      const saldo = parseFloat(emp?.vacaciones_saldo_dias) || 0
      const repuesto = Math.round((saldo + Math.abs(parseFloat(m.dias) || 0)) * 1000) / 1000  // dias venían negativos
      await sb.from('empleados').update({ vacaciones_saldo_dias: repuesto }).eq('id', m.empleado_id)
      await sb.from('vacaciones_movimientos').delete().eq('id', m.id)
    }

    // 3) PRÉSTAMOS: reponer saldo, reactivar y borrar abonos del período
    const { data: abonos } = await sb.from('abonos_prestamo_emp')
      .select('id, prestamo_id, monto').eq('periodo', periodo).eq('origen', 'planilla')
    for (const a of (abonos || [])) {
      const { data: prest } = await sb.from('prestamos_empleados')
        .select('saldo').eq('id', a.prestamo_id).maybeSingle()
      const saldo = parseFloat(prest?.saldo) || 0
      const repuesto = Math.round((saldo + (parseFloat(a.monto) || 0)) * 100) / 100
      await sb.from('prestamos_empleados').update({ saldo: repuesto, activo: true }).eq('id', a.prestamo_id)
      await sb.from('abonos_prestamo_emp').delete().eq('id', a.id)
    }

    // 4) PLANILLA: de vuelta a borrador
    await sb.from('planillas').update({ estado: 'borrador', aprobada_at: null }).eq('id', currentPlanilla.id)
    currentPlanilla.estado = 'borrador'
    renderPlanilla()
    window.toast?.('↩️ Planilla reabierta: partida revertida, vacaciones y préstamos repuestos.', 'ok')
    window.logActividad?.('planilla_reabierta', 'rrhh', `${periodo} · vac repuestas: ${(movVac||[]).length} · prest repuestos: ${(abonos||[]).length}`)
  } catch (e) {
    console.error('Error reabriendo planilla:', e)
    window.toast?.('Error al reabrir: ' + e.message, 'error')
  }
}

// ── Exportar a Excel ──
// ── Vouchers de pago: 6 por página (A4) para recortar y entregar ──
window.imprimirVouchersPlanilla = async () => {
  if (!currentDetalle.length) { window.toast?.('No hay planilla para imprimir', 'error'); return }
  // Respeta el filtro visible (sección + nombre): permite imprimir por sección o un empleado.
  let data = currentSeccionFilter ? currentDetalle.filter(d => d.seccion === currentSeccionFilter) : currentDetalle
  if (currentNombreFilter) data = data.filter(d => (d.nombre || '').toUpperCase().includes(currentNombreFilter))
  if (!data.length) { window.toast?.('No hay empleados en el filtro actual', 'error'); return }

  const fechaTxt = s => { if (!s) return ''; const [y, m, dd] = String(s).slice(0, 10).split('-'); return `${dd}/${m}/${y}` }
  const ini = fechaTxt(currentPlanilla?.fecha_inicio)
  const finP = fechaTxt(currentPlanilla?.fecha_fin)
  const periodoTxt = (ini && finP) ? `${ini} al ${finP}` : (currentPlanilla?.periodo || '')

  // ── Desglose de préstamos por empleado (descripción + monto) ───────────────
  // Para que el voucher liste cada préstamo con su descripción. Tras aprobar se usan
  // los abonos reales del período (suman exacto a d.cxc); en borrador se proyecta
  // repartiendo d.cxc entre los préstamos activos vigentes (mismo reparto que la
  // aprobación, sorteado por id), así la suma siempre cuadra con el total deducido.
  const periodo = currentPlanilla?.periodo || ''
  const finP10 = String(currentPlanilla?.fecha_fin || '').slice(0, 10)
  const empIds = [...new Set(data.map(d => d.empleado_id).filter(Boolean))]
  const prestBreakdown = {}   // empleado_id → [{desc, monto}]
  if (empIds.length) {
    const sb = getSb()
    const [{ data: loans }, { data: abonos }] = await Promise.all([
      sb.from('prestamos_empleados')
        .select('id, empleado_id, descripcion, cuota_quincenal, saldo, fecha_primera_deduccion, tipo')
        .in('empleado_id', empIds),
      sb.from('abonos_prestamo_emp')
        .select('prestamo_id, empleado_id, monto').eq('periodo', periodo)
    ])
    const descById = {}
    ;(loans || []).forEach(l => { descById[l.id] = l.descripcion || '' })
    const abonosByEmp = {}
    ;(abonos || []).forEach(a => { (abonosByEmp[a.empleado_id] ||= []).push(a) })
    for (const d of data) {
      const eid = d.empleado_id
      if (!eid) continue
      const cxc = Math.round((d.cxc || 0) * 100) / 100
      if (cxc <= 0) continue
      const lista = []
      if (abonosByEmp[eid]?.length) {
        // Planilla aprobada: montos reales por préstamo.
        for (const a of abonosByEmp[eid]) {
          const m = Math.round((a.monto || 0) * 100) / 100
          if (m > 0) lista.push({ desc: descById[a.prestamo_id] || '', monto: m })
        }
      } else {
        // Borrador: proyección repartiendo cxc entre préstamos activos vigentes.
        const activos = (loans || [])
          .filter(l => l.empleado_id === eid && (l.tipo || 'prestamo') === 'prestamo')
          .filter(l => { const fpd = String(l.fecha_primera_deduccion || '').slice(0, 10); return !fpd || !finP10 || fpd <= finP10 })
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        let restante = cxc
        for (const l of activos) {
          if (restante <= 0.005) break
          const cuota = parseFloat(l.cuota_quincenal) || 0
          const saldo = parseFloat(l.saldo) || 0
          const m = Math.round(Math.min(cuota, saldo, restante) * 100) / 100
          if (m > 0) { lista.push({ desc: l.descripcion || '', monto: m }); restante = Math.round((restante - m) * 100) / 100 }
        }
        if (restante > 0.005) lista.push({ desc: '', monto: restante })   // remanente sin info de préstamo
      }
      prestBreakdown[eid] = lista
    }
  }

  const filas = arr => arr.map(([label, val, always]) => {
    const n = Number(val) || 0
    if (!always && Math.abs(n) < 0.005) return ''
    return `<tr><td>${label}</td><td class="num">${fmt(n)}</td></tr>`
  }).join('')

  const voucher = d => {
    const ingresos = filas([
      ['Sueldo quincenal', d.sueldo_quincenal, true],
      [`Horas extra${d.horas_extra ? ` (${d.horas_extra} h)` : ''}`, d.monto_he],
      ['Vacaciones', d.vacaciones],
      ['Incapacidad', d.incapacidad],
      ['Bonificaciones', d.bonificaciones],
      ['Ajuste de sueldo', d.ajuste_sueldo],
      ['Otros ingresos', d.otros_ingresos],
      ['Comisiones', d.comisiones_venta]
    ])
    const prestLineas = prestBreakdown[d.empleado_id] || []
    const dedArr = [
      ['IHSS', d.ihss_laboral],
      ['Impuesto vecinal', d.imp_vecinal],
      ['Anticipos', d.anticipos]
    ]
    if (prestLineas.length) {
      prestLineas.forEach(p => {
        // Un préstamo cuya descripción es de impuesto vecinal se muestra como "Impuesto vecinal"
        // (no como "Préstamo · …"), para que en el voucher se lea igual que la deducción de vecinal.
        const _esVecinal = /impuesto\s*vecinal/i.test(p.desc || '')
        const _label = _esVecinal ? 'Impuesto vecinal' : `Préstamo${p.desc ? ' · ' + p.desc : ''}`
        dedArr.push([_label, p.monto])
      })
    } else if ((d.cxc || 0) > 0.005) {
      dedArr.push(['Préstamo', d.cxc])
    }
    dedArr.push(['Trucha', d.trucha])
    dedArr.push(['Otras deducciones', d.otras_deducciones])
    const deducciones = filas(dedArr) || '<tr><td colspan="2" class="muted">Sin deducciones</td></tr>'
    return `
      <div class="voucher">
        <div class="vh">
          <div class="vh-co">TECNIMAX</div>
          <div class="vh-sub">Comprobante de pago de planilla</div>
          <div class="vh-per">Quincena: ${periodoTxt}</div>
        </div>
        <div class="vemp">
          <div class="vname">${d.nombre || ''}</div>
          <div class="vmeta">${d.seccion || ''} · Días: ${d.dias_trabajados ?? ''} · Pago: ${d.forma_pago || ''}</div>
        </div>
        <table class="vt">
          <tr class="sec"><td colspan="2">INGRESOS</td></tr>
          ${ingresos}
          <tr class="tot"><td>Total devengado</td><td class="num">${fmt(d.total_devengado)}</td></tr>
          <tr class="sec"><td colspan="2">DEDUCCIONES</td></tr>
          ${deducciones}
          <tr class="tot"><td>Total deducciones</td><td class="num">${fmt(d.total_deducciones)}</td></tr>
        </table>
        <div class="vneto"><span>NETO A PAGAR</span><span>L.&nbsp;${fmt(d.sueldo_neto)}</span></div>
        <div class="vfirma">Recibí conforme: ____________________</div>
      </div>`
  }

  const cuerpo = data.map(voucher).join('')

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Vouchers ${currentPlanilla?.periodo || ''}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#111}
    .sheet{columns:2;column-gap:6mm}
    .voucher{border:1px dashed #888;border-radius:4px;padding:5mm;margin:0 0 6mm;display:block;font-size:11px;line-height:1.45;break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid}
    .vh{text-align:center;border-bottom:1px solid #000;padding-bottom:2mm;margin-bottom:2mm}
    .vh-co{font-size:16px;font-weight:700;letter-spacing:1px}
    .vh-sub,.vh-per{font-size:10px;color:#444}
    .vemp{margin-bottom:2.5mm}
    .vname{font-weight:700;font-size:12.5px}
    .vmeta{font-size:10px;color:#555}
    .vt{width:100%;border-collapse:collapse}
    .vt td{padding:.8mm 0}
    .vt td.num{text-align:right;font-variant-numeric:tabular-nums}
    .vt tr.sec td{font-weight:700;font-size:10px;color:#fff;background:#333;padding:1mm 1.5mm;letter-spacing:.5px}
    .vt tr.tot td{font-weight:700;border-top:1px solid #000}
    .vt td.muted{color:#888;font-style:italic}
    .vneto{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:13.5px;background:#f0a500;color:#000;padding:2mm 2.5mm;border-radius:3px;margin-top:3mm}
    .vfirma{font-size:9px;color:#555;margin-top:3mm}
    @page{size:A4 portrait;margin:8mm}
    @media print{.noprint{display:none}}
  </style></head>
  <body>
    <div class="noprint" style="padding:10px;text-align:center">
      <button onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer">🖨️ Imprimir</button>
      <span style="color:#666;margin-left:10px">${data.length} voucher(s)</span>
    </div>
    <div class="sheet">${cuerpo}</div>
  </body></html>`

  const win = window.open('', '_blank')
  if (!win) { window.toast?.('Permití las ventanas emergentes para imprimir los vouchers', 'error'); return }
  win.document.write(html)
  win.document.close()
}

window.exportarPlanillaExcel = () => {
  if (!currentDetalle.length) return
  const XLSX = window.XLSX

  const headers = [
    '#', 'Nombre', 'Puesto', 'Sección', 'Centro Costo', 'Sueldo Mensual',
    'Días', 'Sueldo Quincenal', 'Horas Extra', 'Monto H/E',
    'Ajuste Sueldo', 'Vacaciones', 'Incapacidad', 'Bonificaciones',
    'Otros Ingresos', 'Comisiones', 'Total Devengado',
    'Imp. Vecinal', 'Anticipos', 'Préstamo', 'Trucha', 'Otras Ded.',
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
  renderPrestamosEmpTable(allPrestamosEmp)

  // Populate employee select in modal
  const sel = document.getElementById('pe-empleado')
  sel.innerHTML = '<option value="">Seleccionar empleado...</option>' +
    allEmpleados.filter(e => e.activo).map(e => `<option value="${e.id}">${e.nombre}</option>`).join('')
}

function renderPrestamosEmpTable(lista) {
  const tbody = document.getElementById('tbody-prestamos-emp')
  if (!tbody) return
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text3)">Sin préstamos</td></tr>'
    return
  }
  const tipoLabel = (t) => t === 'prestaciones' ? 'Cargo a prestaciones'
    : t === 'adelanto_aguinaldo' ? 'Adelanto aguinaldo'
    : t === 'adelanto_catorceavo' ? 'Adelanto catorceavo' : t
  const sinCuota = (t) => t === 'prestaciones' || t === 'adelanto_aguinaldo' || t === 'adelanto_catorceavo'
  const esSuper = window._currentProfile?.()?.rol === 'super_admin'
  tbody.innerHTML = lista.map(p => `
    <tr style="${!p.activo ? 'opacity:0.5' : ''}">
      <td><strong>${p.empleado?.nombre || '—'}</strong></td>
      <td>${p.descripcion || '—'}</td>
      <td><span style="font-size:11px;padding:2px 8px;background:${p.tipo === 'prestaciones' ? 'rgba(245,158,11,0.15)' : 'var(--bg1)'};border-radius:4px">${tipoLabel(p.tipo)}</span></td>
      <td style="text-align:right">L. ${fmt(p.monto_original)}</td>
      <td style="text-align:right;font-weight:600;color:${p.saldo > 0 ? 'var(--gold)' : 'var(--green)'}">L. ${fmt(p.saldo)}</td>
      <td style="text-align:right">${sinCuota(p.tipo) ? '—' : 'L. ' + fmt(p.cuota_quincenal)}</td>
      <td style="font-size:12px;color:var(--text3)">${p.fecha_prestamo || '—'}</td>
      <td style="font-size:12px;color:var(--text3)">${sinCuota(p.tipo) ? '— (en planilla bono)' : (p.fecha_primera_deduccion || '—')}</td>
      <td>${p.activo ? '<span style="color:var(--gold)">● Activo</span>' : '<span style="color:var(--green)">● Pagado</span>'}</td>
      <td style="white-space:nowrap">
        ${esSuper ? `<button class="btn btn-ghost" style="padding:4px 8px;font-size:12px" onclick="editarPrestamoEmp('${p.id}')">✏️ Editar</button>` : ''}
        ${p.activo ? `<button class="btn btn-ghost" style="padding:4px 8px;font-size:12px" onclick="liquidarPrestamoEmp('${p.id}')">💰 Liquidar</button>` : ''}
      </td>
    </tr>
  `).join('')
}

window.filtrarPrestamosEmp = () => {
  const q = (document.getElementById('pe-buscar')?.value || '').trim().toUpperCase()
  const lista = !q ? allPrestamosEmp : allPrestamosEmp.filter(p => (p.empleado?.nombre || '').toUpperCase().includes(q))
  renderPrestamosEmpTable(lista)
}

// Mostrar/ocultar cuota y fecha de deducción según el tipo
window.onPrestamoTipoChange = () => {
  const tipo = document.getElementById('pe-tipo').value
  const esPrestaciones = (tipo === 'prestaciones' || tipo === 'adelanto_aguinaldo' || tipo === 'adelanto_catorceavo')
  const cuotaWrap = document.getElementById('pe-cuota-wrap')
  const fechaWrap = document.getElementById('pe-fecha-deduccion-wrap')
  if (cuotaWrap) cuotaWrap.style.display = esPrestaciones ? 'none' : ''
  if (fechaWrap) fechaWrap.style.display = esPrestaciones ? 'none' : ''
  if (esPrestaciones) {
    const c = document.getElementById('pe-cuota'); if (c) c.value = ''
    const f = document.getElementById('pe-fecha-deduccion'); if (f) f.value = ''
  }
}

// Cuenta de gasto PRESTACIONES LABORALES según sección del empleado (GO/GV/GA)
function cuentaPrestaciones(seccion) {
  const p = (seccion || '').trim().toUpperCase().split(/\s+/)[0]
  if (p === 'GV') return '610102-006'
  if (p === 'GA') return '610103-006'
  return '610101-006' // GO (default)
}

window.openModalPrestamoEmp = () => {
  editandoPrestamoId = null
  document.getElementById('pe-monto').value = ''
  document.getElementById('pe-cuota').value = ''
  document.getElementById('pe-descripcion').value = ''
  document.getElementById('pe-tipo').value = 'prestamo'
  document.getElementById('pe-forma-entrega').value = 'efectivo'
  document.getElementById('pe-empleado').value = ''
  document.getElementById('pe-fecha-prestamo').value = new Date().toLocaleDateString('en-CA')
  document.getElementById('pe-fecha-deduccion').value = ''
  const ga = document.getElementById('pe-generar-asiento'); if (ga) ga.checked = (window._peGenerarAsiento !== false)
  // Restaurar campos/título por si venía de una edición
  ;['pe-empleado', 'pe-tipo', 'pe-monto', 'pe-forma-entrega'].forEach(qid => { const el = document.getElementById(qid); if (el) el.disabled = false })
  const aw = document.getElementById('pe-asiento-wrap'); if (aw) aw.style.display = ''
  const tt = document.getElementById('pe-modal-title'); if (tt) tt.textContent = 'Nuevo préstamo / anticipo'
  ensureAdelantoOptions()
  onPrestamoTipoChange()
  openModal('modal-prestamo-emp')
}

// Editar préstamo (solo super_admin): corrige cuota quincenal, descripción y fecha de 1ª
// deducción. No toca empleado/tipo/monto ni re-genera el asiento contable, para no
// descuadrar la partida ya posteada (si el monto está mal, liquidar y recrear).
window.editarPrestamoEmp = (id) => {
  if (window._currentProfile?.()?.rol !== 'super_admin') { window.toast?.('Solo super_admin puede editar préstamos', 'error'); return }
  const p = (allPrestamosEmp || []).find(x => String(x.id) === String(id))
  if (!p) { window.toast?.('Préstamo no encontrado', 'error'); return }
  editandoPrestamoId = id
  ensureAdelantoOptions()
  document.getElementById('pe-empleado').value = p.empleado_id || ''
  document.getElementById('pe-tipo').value = p.tipo || 'prestamo'
  document.getElementById('pe-monto').value = p.monto_original ?? ''
  document.getElementById('pe-cuota').value = p.cuota_quincenal ?? ''
  document.getElementById('pe-descripcion').value = p.descripcion || ''
  document.getElementById('pe-fecha-prestamo').value = (p.fecha_prestamo || '').slice(0, 10)
  document.getElementById('pe-fecha-deduccion').value = (p.fecha_primera_deduccion || '').slice(0, 10)
  onPrestamoTipoChange()
  // Bloquear lo que no debe cambiarse en edición y ocultar el asiento
  ;['pe-empleado', 'pe-tipo', 'pe-monto', 'pe-forma-entrega'].forEach(qid => { const el = document.getElementById(qid); if (el) el.disabled = true })
  const aw = document.getElementById('pe-asiento-wrap'); if (aw) aw.style.display = 'none'
  const tt = document.getElementById('pe-modal-title'); if (tt) tt.textContent = '✏️ Editar préstamo (cuota / descripción / fecha)'
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
  const formaEntrega = document.getElementById('pe-forma-entrega').value  // efectivo | banco
  const generarAsiento = document.getElementById('pe-generar-asiento')?.checked !== false
  window._peGenerarAsiento = generarAsiento  // recordar la última elección

  if (!empleadoId) { window.toast?.('Seleccioná un empleado', 'error'); return }
  if (monto <= 0) { window.toast?.('Ingresá un monto válido', 'error'); return }
  if (!fechaPrestamo) { window.toast?.('Ingresá la fecha del préstamo', 'error'); return }

  // ── Modo EDICIÓN (solo super_admin): actualiza cuota, descripción y fecha 1ª deducción.
  // No re-postea asiento ni cambia empleado/tipo/monto (evita descuadrar la partida).
  if (editandoPrestamoId) {
    if (window._currentProfile?.()?.rol !== 'super_admin') { window.toast?.('Solo super_admin puede editar préstamos', 'error'); return }
    const { error: errUpd } = await getSb().from('prestamos_empleados').update({
      cuota_quincenal: cuota,
      descripcion,
      fecha_primera_deduccion: fechaDeduccion || null
    }).eq('id', editandoPrestamoId)
    if (errUpd) { window.toast?.('Error: ' + errUpd.message, 'error'); return }
    editandoPrestamoId = null
    closeModal('modal-prestamo-emp')
    window.toast?.('Préstamo actualizado ✓', 'success')
    if (typeof window.loadPrestamosEmp === 'function') window.loadPrestamosEmp()
    return
  }

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

  // Generar partida contable automática (cuadrada: Débito CXC / Crédito Caja o Banco)
  const emp = allEmpleados.find(e => e.id === empleadoId)
  if (!generarAsiento) {
    window.toast?.('Préstamo registrado sin asiento contable ✓', 'success')
  } else if (emp?.cuenta_cxc && tipo === 'prestamo') {
    try {
      const sb = getSb()
      const codCredito = formaEntrega === 'banco' ? '110103-001' : '110102-001'
      const nombreOrigen = formaEntrega === 'banco' ? 'BANCO/CHEQUERA' : 'EFECTIVO/CAJA GENERAL'
      // Buscar cuenta CXC del empleado y la cuenta de origen (caja/banco)
      const { data: cuentas } = await sb.from('catalogo_cuentas')
        .select('id, codigo, nombre').in('codigo', [emp.cuenta_cxc, codCredito])
      const cuentaCxC = (cuentas || []).find(c => c.codigo === emp.cuenta_cxc)
      const cuentaOrigen = (cuentas || []).find(c => c.codigo === codCredito)

      if (cuentaCxC && cuentaOrigen) {
        // Obtener siguiente número de partida (atómico)
        const numPartida = await window.siguienteNumeroPartida()

        const descPartida = `PRESTAMO ${emp.nombre} - ${descripcion || nombreOrigen}`.toUpperCase()

        // Crear partida borrador
        const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
          centro_costo_id: null,
          fecha_partida: fechaPrestamo,
          numero_partida: numPartida,
          descripcion: descPartida,
          tipo_origen: 'otro',
          estado: 'borrador',
          total: monto,
          generada_por: window._currentProfile?.()?.id || null
        }).select().single()
        if (pErr || !partida) throw new Error(pErr?.message || 'No se creó la partida')

        // Líneas: Débito CXC empleado / Crédito Caja o Banco (CUADRADA)
        const { error: lErr } = await sb.from('lineas_partida').insert([
          {
            partida_id: partida.id,
            cuenta_id: cuentaCxC.id, cuenta_codigo: cuentaCxC.codigo, cuenta_nombre: cuentaCxC.nombre,
            tipo: 'debito', monto, descripcion: descPartida, aplica_fiscal: false
          },
          {
            partida_id: partida.id,
            cuenta_id: cuentaOrigen.id, cuenta_codigo: cuentaOrigen.codigo, cuenta_nombre: cuentaOrigen.nombre,
            tipo: 'credito', monto, descripcion: descPartida, aplica_fiscal: false
          }
        ])
        if (lErr) throw new Error(lErr.message)
        window.toast?.(`Préstamo guardado + Partida #${numPartida} (borrador) — entrega por ${nombreOrigen}`, 'success')
      } else {
        window.toast?.('Préstamo guardado. No se encontró la cuenta CXC o la de origen para la partida.', 'info')
      }
    } catch(e) {
      console.error('Error generando partida:', e)
      window.toast?.('Préstamo guardado, pero hubo error al generar la partida: ' + e.message, 'error')
    }
  } else if (tipo === 'prestaciones') {
    // Cargo a prestaciones: Débito 610x01-006 PRESTACIONES LABORALES (por sección) / Crédito forma de entrega
    try {
      const sb = getSb()
      const codGasto = cuentaPrestaciones(emp?.seccion)
      const codCredito = formaEntrega === 'banco' ? '110103-001' : '110102-001'
      const nombreOrigen = formaEntrega === 'banco' ? 'BANCO/CHEQUERA' : 'EFECTIVO/CAJA GENERAL'
      const { data: cuentas } = await sb.from('catalogo_cuentas')
        .select('id, codigo, nombre').in('codigo', [codGasto, codCredito])
      const cuentaGasto = (cuentas || []).find(c => c.codigo === codGasto)
      const cuentaOrigen = (cuentas || []).find(c => c.codigo === codCredito)
      if (cuentaGasto && cuentaOrigen) {
        const numPartida = await window.siguienteNumeroPartida()
        const descPartida = `CARGO A PRESTACIONES ${emp?.nombre || ''} - ${descripcion || nombreOrigen}`.toUpperCase()
        const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
          centro_costo_id: null, fecha_partida: fechaPrestamo, numero_partida: numPartida,
          descripcion: descPartida, tipo_origen: 'otro', estado: 'borrador', total: monto,
          generada_por: window._currentProfile?.()?.id || null
        }).select().single()
        if (pErr || !partida) throw new Error(pErr?.message || 'No se creó la partida')
        const { error: lErr } = await sb.from('lineas_partida').insert([
          { partida_id: partida.id, cuenta_id: cuentaGasto.id, cuenta_codigo: cuentaGasto.codigo, cuenta_nombre: cuentaGasto.nombre, tipo: 'debito', monto, descripcion: descPartida, aplica_fiscal: false },
          { partida_id: partida.id, cuenta_id: cuentaOrigen.id, cuenta_codigo: cuentaOrigen.codigo, cuenta_nombre: cuentaOrigen.nombre, tipo: 'credito', monto, descripcion: descPartida, aplica_fiscal: false }
        ])
        if (lErr) throw new Error(lErr.message)
        window.toast?.(`Cargo a prestaciones guardado + Partida #${numPartida} (borrador) — entrega por ${nombreOrigen}`, 'success')
      } else {
        window.toast?.(`Guardado, pero no se encontró la cuenta ${codGasto} o ${codCredito} para la partida.`, 'info')
      }
    } catch(e) {
      console.error('Error generando partida prestaciones:', e)
      window.toast?.('Guardado, pero hubo error al generar la partida: ' + e.message, 'error')
    }
  } else if (tipo === 'adelanto_aguinaldo' || tipo === 'adelanto_catorceavo') {
    // Adelanto de bono: Débito gasto décimo tercer/cuarto (por sección) / Crédito caja o banco
    // (mismo patrón que 'prestaciones'; el gasto del bono se reconoce al pagar el adelanto).
    try {
      const sb = getSb()
      const tipoBono = tipo === 'adelanto_aguinaldo' ? 'aguinaldo' : 'catorceavo'
      const codGasto = cuentaBono(emp?.seccion, tipoBono)
      const codCredito = formaEntrega === 'banco' ? '110103-001' : '110102-001'
      const nombreOrigen = formaEntrega === 'banco' ? 'BANCO/CHEQUERA' : 'EFECTIVO/CAJA GENERAL'
      const { data: cuentas } = await sb.from('catalogo_cuentas')
        .select('id, codigo, nombre').in('codigo', [codGasto, codCredito])
      const cuentaGasto = (cuentas || []).find(c => c.codigo === codGasto)
      const cuentaOrigen = (cuentas || []).find(c => c.codigo === codCredito)
      if (cuentaGasto && cuentaOrigen) {
        const numPartida = await window.siguienteNumeroPartida()
        const etiqueta = tipoBono === 'aguinaldo' ? 'ADELANTO AGUINALDO' : 'ADELANTO CATORCEAVO'
        const descPartida = `${etiqueta} ${emp?.nombre || ''} - ${descripcion || nombreOrigen}`.toUpperCase()
        const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
          centro_costo_id: null, fecha_partida: fechaPrestamo, numero_partida: numPartida,
          descripcion: descPartida, tipo_origen: 'otro', estado: 'borrador', total: monto,
          generada_por: window._currentProfile?.()?.id || null
        }).select().single()
        if (pErr || !partida) throw new Error(pErr?.message || 'No se creó la partida')
        const { error: lErr } = await sb.from('lineas_partida').insert([
          { partida_id: partida.id, cuenta_id: cuentaGasto.id, cuenta_codigo: cuentaGasto.codigo, cuenta_nombre: cuentaGasto.nombre, tipo: 'debito', monto, descripcion: descPartida, aplica_fiscal: false },
          { partida_id: partida.id, cuenta_id: cuentaOrigen.id, cuenta_codigo: cuentaOrigen.codigo, cuenta_nombre: cuentaOrigen.nombre, tipo: 'credito', monto, descripcion: descPartida, aplica_fiscal: false }
        ])
        if (lErr) throw new Error(lErr.message)
        window.toast?.(`${etiqueta} guardado + Partida #${numPartida} (borrador) — entrega por ${nombreOrigen}`, 'success')
      } else {
        window.toast?.(`Guardado, pero no se encontró la cuenta ${codGasto} o ${codCredito} en el catálogo.`, 'info')
      }
    } catch(e) {
      console.error('Error generando partida adelanto bono:', e)
      window.toast?.('Guardado, pero hubo error al generar la partida: ' + e.message, 'error')
    }
  } else {
    window.toast?.('Préstamo registrado ✓', 'ok')
  }

  closeModal('modal-prestamo-emp')
  window.logActividad?.('prestamo_emp_creado', 'rrhh', `${emp?.nombre || ''} · L.${monto} · ${tipo}`)
  await loadPrestamosEmp()
}

let _liqCtx = null  // contexto de la liquidación en curso

window.onLiqFormaChange = () => {
  const f = document.getElementById('liq-forma').value
  document.getElementById('liq-fld-condon').style.display = f === 'condonado' ? '' : 'none'
}

window.liquidarPrestamoEmp = async (id) => {
  const sb = getSb()
  const { data: prest } = await sb.from('prestamos_empleados')
    .select('id, empleado_id, saldo, empleado:empleados(nombre, cuenta_cxc)').eq('id', id).maybeSingle()
  if (!prest) { window.toast?.('No se encontró el préstamo', 'error'); return }
  _liqCtx = {
    id, empleado_id: prest.empleado_id,
    nombre: prest.empleado?.nombre || '',
    cuenta_cxc: prest.empleado?.cuenta_cxc || null,
    saldo: parseFloat(prest.saldo) || 0
  }
  document.getElementById('liq-nombre').textContent = _liqCtx.nombre
  document.getElementById('liq-saldo').textContent = 'L. ' + _liqCtx.saldo.toFixed(2)
  document.getElementById('liq-forma').value = 'efectivo'
  document.getElementById('liq-cuenta-gasto').value = ''
  document.getElementById('liq-fld-condon').style.display = 'none'
  openModal('modal-liquidar-prestamo')
}

window.confirmarLiquidacion = async () => {
  if (!_liqCtx) return
  const sb = getSb()
  const { id, empleado_id, nombre, cuenta_cxc, saldo } = _liqCtx
  const forma = document.getElementById('liq-forma').value
  const hoy = new Date().toLocaleDateString('en-CA')  // YYYY-MM-DD local
  const quienNombre = window._currentProfile?.()?.nombre || null

  // Candado anti-duplicado: ¿ya hay abono de liquidación para este préstamo?
  const { data: yaLiq } = await sb.from('abonos_prestamo_emp')
    .select('id').eq('prestamo_id', id).eq('origen', 'liquidacion').limit(1)
  const yaLiquidado = (yaLiq || []).length > 0

  // Cuenta de débito (contrapartida) según forma de pago
  let codDebito = null, etiqueta = ''
  if (forma === 'efectivo') { codDebito = '110102-001'; etiqueta = 'EFECTIVO/CAJA' }
  else if (forma === 'banco') { codDebito = '110103-001'; etiqueta = 'BANCO/CHEQUERA' }
  else if (forma === 'condonado') {
    codDebito = (document.getElementById('liq-cuenta-gasto').value || '').trim()
    if (!codDebito) { window.toast?.('Ingresá la cuenta de gasto para la condonación', 'error'); return }
    etiqueta = 'CONDONADO'
  }

  // Partida (Débito caja/banco/gasto / Crédito CXC empleado) — solo si aplica y no se hizo antes
  if (!yaLiquidado && forma !== 'ninguna' && saldo > 0) {
    if (!cuenta_cxc) { window.toast?.('El empleado no tiene cuenta CXC; no se puede contabilizar', 'error'); return }
    const { data: cuentas } = await sb.from('catalogo_cuentas').select('id, codigo, nombre').in('codigo', [cuenta_cxc, codDebito])
    const cCxc = (cuentas || []).find(c => c.codigo === cuenta_cxc)
    const cDeb = (cuentas || []).find(c => c.codigo === codDebito)
    if (!cCxc || !cDeb) { window.toast?.(`No se encontró la cuenta ${!cCxc ? cuenta_cxc : codDebito} en el catálogo`, 'error'); return }
    const numPartida = await window.siguienteNumeroPartida()
    const desc = `LIQUIDACION PRESTAMO ${nombre} - ${etiqueta}`.toUpperCase()
    const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
      centro_costo_id: null, fecha_partida: hoy, numero_partida: numPartida, descripcion: desc,
      tipo_origen: 'otro', estado: 'borrador', total: saldo, generada_por: window._currentProfile?.()?.id || null
    }).select().single()
    if (pErr || !partida) { window.toast?.('Error creando partida: ' + (pErr?.message || ''), 'error'); return }
    const { error: lErr } = await sb.from('lineas_partida').insert([
      { partida_id: partida.id, cuenta_id: cDeb.id, cuenta_codigo: cDeb.codigo, cuenta_nombre: cDeb.nombre, tipo: 'debito', monto: saldo, descripcion: desc, aplica_fiscal: false },
      { partida_id: partida.id, cuenta_id: cCxc.id, cuenta_codigo: cCxc.codigo, cuenta_nombre: cCxc.nombre, tipo: 'credito', monto: saldo, descripcion: desc, aplica_fiscal: false }
    ])
    if (lErr) { window.toast?.('Error en líneas de partida: ' + lErr.message, 'error'); return }
  }

  // Abono (traza) — solo si no se hizo antes
  if (!yaLiquidado && saldo > 0) {
    const { error: aErr } = await sb.from('abonos_prestamo_emp').insert({
      prestamo_id: id, empleado_id, empleado_nombre: nombre, fecha: hoy, monto: saldo,
      saldo_resultante: 0, periodo: null, origen: 'liquidacion', created_by: quienNombre
    })
    if (aErr) { window.toast?.('Error grabando el abono: ' + aErr.message, 'error'); return }
  }

  // Cerrar el préstamo
  const { error } = await sb.from('prestamos_empleados').update({ saldo: 0, activo: false }).eq('id', id)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }

  closeModal('modal-liquidar-prestamo')
  const conPartida = !yaLiquidado && forma !== 'ninguna' && saldo > 0
  window.toast?.('Préstamo liquidado ✓' + (conPartida ? ' + partida (borrador)' : ''), 'ok')
  window.logActividad?.('prestamo_liquidado', 'rrhh', `${nombre} · L.${saldo.toFixed(2)} · ${forma}`)
  _liqCtx = null
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

// ══════════════════════════════════════════════
// ═══  PLANILLA DE BONO (AGUINALDO / CATORCEAVO)  ═══
//  Proporcional por fecha_ingreso (base 30/360). Exenta de IHSS/ISR/vecinal.
//  Deduce solo adelantos del MISMO concepto. Autoinyecta su vista y modal.
// ══════════════════════════════════════════════

// Cuenta de gasto del bono por sección: GO=610101, GV=610102, GA=610103; 003=aguinaldo, 004=catorceavo
function cuentaBono(seccion, tipoBono) {
  const p = (seccion || '').trim().toUpperCase().split(/\s+/)[0]
  const suf = tipoBono === 'aguinaldo' ? '003' : '004'
  if (p === 'GV') return `610102-${suf}`
  if (p === 'GA') return `610103-${suf}`
  return `610101-${suf}` // GO (default)
}

// Diferencia de días en base 30/360 (método US/NASD), como en los ejemplos de la ley
function dias360(d1, d2) {
  let y1 = d1.getFullYear(), m1 = d1.getMonth() + 1, dd1 = d1.getDate()
  let y2 = d2.getFullYear(), m2 = d2.getMonth() + 1, dd2 = d2.getDate()
  if (dd1 === 31) dd1 = 30
  if (dd2 === 31 && dd1 >= 30) dd2 = 30
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (dd2 - dd1)
}

// Días trabajados dentro del período del bono (360 = completó el año → 100%)
function diasBono(fechaIngreso, desde, hasta) {
  const dDesde = new Date(desde + 'T00:00:00'), dHasta = new Date(hasta + 'T00:00:00')
  if (!fechaIngreso) return 360
  const ing = new Date(String(fechaIngreso).slice(0, 10) + 'T00:00:00')
  if (isNaN(ing)) return 360
  if (ing <= dDesde) return 360       // trabajó todo el período
  if (ing > dHasta) return 0          // ingresó después del período
  return Math.min(360, Math.max(0, dias360(ing, dHasta)))
}

function periodoBono(tipoBono, anio) {
  if (tipoBono === 'catorceavo') return { desde: `${anio - 1}-07-01`, hasta: `${anio}-06-30`, label: `CATORCEAVO ${anio}` }
  return { desde: `${anio}-01-01`, hasta: `${anio}-12-31`, label: `AGUINALDO ${anio}` }
}

let _bonoCtx = null  // { tipo, anio, desde, hasta, label, filas, existe }

// Agrega las opciones de adelanto al <select id="pe-tipo"> del modal de préstamos (sin tocar index.html)
function ensureAdelantoOptions() {
  const sel = document.getElementById('pe-tipo')
  if (!sel) return
  const vals = [...sel.options].map(o => o.value)
  if (!vals.includes('adelanto_aguinaldo')) sel.insertAdjacentHTML('beforeend', '<option value="adelanto_aguinaldo">Adelanto de aguinaldo</option>')
  if (!vals.includes('adelanto_catorceavo')) sel.insertAdjacentHTML('beforeend', '<option value="adelanto_catorceavo">Adelanto de catorceavo</option>')
}

// Botón lanzador dentro de la vista de planilla quincenal
function ensureBonoLauncher() {
  if (document.getElementById('btn-planilla-bono')) return
  const anchor = document.getElementById('planilla-resultado')
  if (!anchor || !anchor.parentNode) return
  const btn = document.createElement('button')
  btn.id = 'btn-planilla-bono'; btn.type = 'button'
  btn.className = 'btn btn-ghost'; btn.style.margin = '0 0 12px'
  btn.textContent = '🎁 Planilla de aguinaldo / catorceavo'
  btn.onclick = () => window.abrirPlanillaBono()
  anchor.parentNode.insertBefore(btn, anchor)
}

function ensureBonoModal() {
  if (document.getElementById('modal-planilla-bono')) return
  const div = document.createElement('div')
  div.className = 'modal-backdrop'; div.id = 'modal-planilla-bono'
  const now = new Date()
  let opts = ''
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) opts += `<option value="${y}" ${y === now.getFullYear() ? 'selected' : ''}>${y}</option>`
  div.innerHTML = `
    <div class="modal" style="width:min(960px,94vw);max-width:960px;max-height:88vh;display:flex;flex-direction:column">
      <div class="modal-header"><h3>🎁 Planilla de aguinaldo / catorceavo</h3><button class="modal-close" onclick="closeModalBono()">✕</button></div>
      <div class="modal-body" style="flex:1;min-height:0;overflow-y:auto">
        <div style="display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin-bottom:12px">
          <div class="fld"><label>Tipo</label><select id="pb-tipo">
            <option value="catorceavo">Catorceavo (14.º · jul–jun · pago junio)</option>
            <option value="aguinaldo">Aguinaldo (13.º · ene–dic · pago diciembre)</option>
          </select></div>
          <div class="fld"><label>Año de pago</label><select id="pb-anio">${opts}</select></div>
          <div class="fld"><label>Fecha de pago</label><input type="date" id="pb-fecha-pago" value="${now.toLocaleDateString('en-CA')}"></div>
          <button class="btn btn-gold" type="button" onclick="window.calcularPlanillaBono()">Calcular →</button>
        </div>
        <div id="pb-periodo" style="font-size:12px;color:var(--text3);margin-bottom:8px"></div>
        <div id="pb-resultado"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" onclick="closeModalBono()">Cerrar</button>
        <button class="btn btn-gold" id="pb-btn-partida" type="button" onclick="window.generarPartidaBono()" style="display:none">Generar partida (borrador) + liquidar adelantos</button>
      </div>
    </div>`
  document.body.appendChild(div)
}

window.closeModalBono = () => { const m = document.getElementById('modal-planilla-bono'); if (m) m.classList.remove('open') }

window.abrirPlanillaBono = () => {
  ensureBonoModal()
  _bonoCtx = null
  document.getElementById('pb-resultado').innerHTML = ''
  document.getElementById('pb-periodo').textContent = ''
  document.getElementById('pb-btn-partida').style.display = 'none'
  document.getElementById('modal-planilla-bono').classList.add('open')
}

window.calcularPlanillaBono = async () => {
  const tipo = document.getElementById('pb-tipo').value
  const anio = parseInt(document.getElementById('pb-anio').value, 10)
  const { desde, hasta, label } = periodoBono(tipo, anio)
  document.getElementById('pb-periodo').textContent = `Período: ${desde} a ${hasta} · ${label} · (base 30/360, exento de IHSS/ISR)`

  const r2 = x => Math.round(x * 100) / 100
  const sb = getSb()

  // ¿Ya existe esta planilla de bono?
  const { data: yaExiste } = await sb.from('planillas_bono')
    .select('id, estado, partida_numero').eq('tipo', tipo).eq('periodo', label).maybeSingle()

  // Empleados activos
  const { data: emps } = await sb.from('empleados').select('*').eq('activo', true).order('seccion').order('nombre')
  const activos = emps || []

  // Adelantos del MISMO concepto, activos
  const tipoAdel = tipo === 'catorceavo' ? 'adelanto_catorceavo' : 'adelanto_aguinaldo'
  const { data: adelantos } = await sb.from('prestamos_empleados')
    .select('id, empleado_id, saldo, activo, tipo').eq('activo', true).eq('tipo', tipoAdel)
  const adelPorEmp = {}
  for (const a of (adelantos || [])) {
    if (!adelPorEmp[a.empleado_id]) adelPorEmp[a.empleado_id] = { total: 0, prestamos: [] }
    const s = parseFloat(a.saldo) || 0
    adelPorEmp[a.empleado_id].total += s
    adelPorEmp[a.empleado_id].prestamos.push({ id: a.id, saldo: s })
  }

  const filas = activos.map(e => {
    const dias = diasBono(e.fecha_ingreso, desde, hasta)
    const bono = r2((e.sueldo_mensual || 0) / 360 * dias)
    const ad = adelPorEmp[e.id] || { total: 0, prestamos: [] }
    const adel = r2(ad.total)
    return {
      empleado_id: e.id, nombre: e.nombre, seccion: e.seccion, cuenta_cxc: e.cuenta_cxc,
      sueldo_mensual: e.sueldo_mensual || 0, fecha_ingreso: e.fecha_ingreso || null,
      dias, bono_bruto: bono, adelantos: adel, neto: r2(bono - adel), prestamos: ad.prestamos
    }
  }).filter(f => f.bono_bruto > 0 || f.adelantos > 0)

  _bonoCtx = { tipo, anio, desde, hasta, label, filas, existe: yaExiste || null }

  const totBono = r2(filas.reduce((s, f) => s + f.bono_bruto, 0))
  const totAdel = r2(filas.reduce((s, f) => s + f.adelantos, 0))
  const totNeto = r2(filas.reduce((s, f) => s + f.neto, 0))
  const negativos = filas.filter(f => f.neto < 0)

  document.getElementById('pb-resultado').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px">
      <div class="stat-card"><div class="stat-num" style="font-size:16px">${filas.length}</div><div class="stat-label">Empleados</div></div>
      <div class="stat-card"><div class="stat-num" style="font-size:15px">L. ${fmt(totBono)}</div><div class="stat-label">Bono bruto</div></div>
      <div class="stat-card"><div class="stat-num" style="font-size:15px;color:var(--gold)">L. ${fmt(totAdel)}</div><div class="stat-label">Adelantos</div></div>
      <div class="stat-card"><div class="stat-num" style="font-size:15px;color:var(--green)">L. ${fmt(totNeto)}</div><div class="stat-label">Neto a pagar</div></div>
    </div>
    ${yaExiste ? `<div style="padding:8px 12px;background:rgba(245,158,11,0.12);border-radius:8px;color:var(--gold);font-size:12px;margin-bottom:10px">⚠️ Ya existe la planilla ${label}${yaExiste.partida_numero ? ` (partida #${yaExiste.partida_numero})` : ''}. <button class="btn btn-ghost" style="padding:2px 8px;font-size:11px;margin-left:8px" onclick="window.regenerarBono()">🗑️ Borrar y regenerar</button></div>` : ''}
    ${negativos.length ? `<div style="padding:8px 12px;background:rgba(239,68,68,0.12);border-radius:8px;color:var(--red);font-size:12px;margin-bottom:10px">⚠️ ${negativos.length} empleado(s) con adelanto mayor al bono (${negativos.map(f => f.nombre).join(', ')}). Corregí antes de generar.</div>` : ''}
    <div class="table-wrap" style="overflow-x:auto"><table style="width:100%;min-width:600px"><thead><tr>
      <th>Empleado</th><th>Sección</th><th>Ingreso</th><th style="text-align:center">Días</th>
      <th style="text-align:right">Bono</th><th style="text-align:right">Adelanto</th><th style="text-align:right">Neto</th>
    </tr></thead><tbody>
    ${filas.map(f => `<tr>
      <td>${f.nombre}</td>
      <td style="font-size:12px">${f.seccion || '—'}</td>
      <td style="font-size:12px;color:var(--text3)">${f.fecha_ingreso || '—'}</td>
      <td style="text-align:center">${f.dias}${f.dias >= 360 ? ' <span style="color:var(--green);font-size:10px">100%</span>' : ''}</td>
      <td style="text-align:right;font-family:var(--mono)">L. ${fmt(f.bono_bruto)}</td>
      <td style="text-align:right;font-family:var(--mono);color:${f.adelantos > 0 ? 'var(--gold)' : 'inherit'}">${f.adelantos > 0 ? 'L. ' + fmt(f.adelantos) : '—'}</td>
      <td style="text-align:right;font-family:var(--mono);font-weight:600;color:${f.neto < 0 ? 'var(--red)' : 'var(--green)'}">L. ${fmt(f.neto)}</td>
    </tr>`).join('')}
    </tbody></table></div>`

  document.getElementById('pb-btn-partida').style.display = (negativos.length || yaExiste) ? 'none' : ''
}

window.regenerarBono = async () => {
  if (!_bonoCtx || !_bonoCtx.existe) return
  if (!confirm(`¿Borrar la planilla ${_bonoCtx.label} y regenerar? Se restaurarán los adelantos liquidados (la partida borrador, si existe, deberás anularla manualmente).`)) return
  await borrarPlanillaBono(_bonoCtx.tipo, _bonoCtx.label)
  await window.calcularPlanillaBono()
}

async function borrarPlanillaBono(tipo, label) {
  const sb = getSb()
  const { data: cab } = await sb.from('planillas_bono')
    .select('id, adelantos_liquidados').eq('tipo', tipo).eq('periodo', label).maybeSingle()
  if (!cab) return
  // Restaurar adelantos liquidados (reactivar préstamos con su saldo)
  const liq = Array.isArray(cab.adelantos_liquidados) ? cab.adelantos_liquidados : []
  for (const x of liq) {
    if (x && x.id) await sb.from('prestamos_empleados').update({ saldo: x.saldo, activo: true }).eq('id', x.id)
  }
  await sb.from('detalle_planilla_bono').delete().eq('planilla_bono_id', cab.id)
  await sb.from('planillas_bono').delete().eq('id', cab.id)
}

window.generarPartidaBono = async () => {
  if (!_bonoCtx || !_bonoCtx.filas.length) return
  const { tipo, anio, desde, hasta, label, filas, existe } = _bonoCtx
  if (existe) { window.toast?.(`Ya existe la planilla ${label}. Borrala primero para regenerar.`, 'error'); return }
  if (filas.some(f => f.neto < 0)) { window.toast?.('Hay netos negativos. Corregí los adelantos primero.', 'error'); return }
  const sb = getSb()
  const r2 = x => Math.round(x * 100) / 100

  const btn = document.getElementById('pb-btn-partida'); btn.disabled = true; btn.textContent = 'Procesando...'
  try {
    // Re-chequear idempotencia (por si dos pestañas)
    const { data: dup } = await sb.from('planillas_bono').select('id').eq('tipo', tipo).eq('periodo', label).limit(1)
    if ((dup || []).length) throw new Error(`Ya existe la planilla ${label}.`)

    // Validar cuentas de gasto presentes + chequera
    const codigosGasto = [...new Set(filas.filter(f => f.neto > 0).map(f => cuentaBono(f.seccion, tipo)))]
    const codChequera = '110103-001'
    const { data: cuentas } = await sb.from('catalogo_cuentas').select('id, codigo, nombre').in('codigo', [...codigosGasto, codChequera])
    const mapC = {}; for (const c of (cuentas || [])) mapC[c.codigo] = c
    const faltan = [...codigosGasto, codChequera].filter(c => !mapC[c])
    if (faltan.length) throw new Error('Faltan cuentas en el catálogo: ' + faltan.join(', '))

    // Cabecera
    const fechaPago = document.getElementById('pb-fecha-pago').value || hasta
    const adelantosLiquidados = filas.flatMap(f => (f.prestamos || []).map(p => ({ id: p.id, saldo: p.saldo })))
    const { data: cab, error: cErr } = await sb.from('planillas_bono').insert({
      tipo, periodo: label, fecha_desde: desde, fecha_hasta: hasta, fecha_pago: fechaPago,
      estado: 'borrador', adelantos_liquidados: adelantosLiquidados,
      created_by: window._currentProfile?.()?.id || null
    }).select().single()
    if (cErr || !cab) throw new Error(cErr?.message || 'No se creó la planilla de bono')

    // Detalle
    const det = filas.map(f => ({
      planilla_bono_id: cab.id, empleado_id: f.empleado_id, nombre: f.nombre, seccion: f.seccion,
      cuenta_cxc: f.cuenta_cxc, sueldo_mensual: f.sueldo_mensual, fecha_ingreso: f.fecha_ingreso,
      dias_trabajados: f.dias, bono_bruto: f.bono_bruto, adelantos: f.adelantos, neto: f.neto
    }))
    const { error: dErr } = await sb.from('detalle_planilla_bono').insert(det)
    if (dErr) throw new Error('Detalle: ' + dErr.message)

    // Partida: Débito gasto bono por sección (NETO) / Crédito chequera (NETO). El adelanto ya se gastó.
    const deb = {}
    for (const f of filas) {
      if (f.neto <= 0) continue
      const cod = cuentaBono(f.seccion, tipo)
      deb[cod] = r2((deb[cod] || 0) + f.neto)
    }
    const totalNeto = r2(Object.values(deb).reduce((s, m) => s + m, 0))
    let numPartida = null
    if (totalNeto > 0) {
      const desc = `PLANILLA ${label}`
      numPartida = await window.siguienteNumeroPartida()
      const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
        centro_costo_id: null, fecha_partida: fechaPago, numero_partida: numPartida,
        descripcion: `${desc} (${filas.length} EMPLEADOS)`, tipo_origen: 'otro', estado: 'borrador',
        total: totalNeto, generada_por: window._currentProfile?.()?.id || null
      }).select().single()
      if (pErr || !partida) throw new Error('Partida: ' + (pErr?.message || ''))
      const lineas = []
      for (const [cod, m] of Object.entries(deb)) {
        const c = mapC[cod]
        lineas.push({ partida_id: partida.id, cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre, tipo: 'debito', monto: r2(m), descripcion: desc, aplica_fiscal: false })
      }
      const ch = mapC[codChequera]
      lineas.push({ partida_id: partida.id, cuenta_id: ch.id, cuenta_codigo: ch.codigo, cuenta_nombre: ch.nombre, tipo: 'credito', monto: totalNeto, descripcion: desc, aplica_fiscal: false })
      const { error: lErr } = await sb.from('lineas_partida').insert(lineas)
      if (lErr) throw new Error('Líneas: ' + lErr.message)
      await sb.from('planillas_bono').update({ partida_numero: numPartida }).eq('id', cab.id)
    }

    // Liquidar adelantos consumidos (saldo→0, inactivo). Se pueden restaurar al borrar la planilla.
    const idsAdel = adelantosLiquidados.map(x => x.id)
    if (idsAdel.length) await sb.from('prestamos_empleados').update({ saldo: 0, activo: false }).in('id', idsAdel)

    window.toast?.(`Planilla ${label} generada ✓${numPartida ? ` · Partida #${numPartida} (borrador)` : ''} · ${idsAdel.length} adelanto(s) liquidados`, 'success')
    window.logActividad?.('planilla_bono_generada', 'rrhh', `${label} · ${filas.length} empleados · neto L.${totalNeto}`)
    closeModalBono()
    await window.loadPrestamosEmp?.()
  } catch (e) {
    console.error('generarPartidaBono:', e)
    window.toast?.('Error: ' + e.message, 'error')
  } finally {
    btn.disabled = false; btn.textContent = 'Generar partida (borrador) + liquidar adelantos'
  }
}

// ══════════════════════════════════════════════
// ═══  PLANILLA DE BONO EDUCATIVO  ═══
// ══════════════════════════════════════════════
// Beneficio anual (Ley del Bono Educativo, Decreto 43-97). El monto es fijo de la tabla
// STSS según rama + tamaño de empresa (parametrizado en config_planilla); NO depende del
// sueldo. Elegibles: aplica_bono_educativo ✔ + sueldo ≤ tope (2 sal. mín.) + activo + !socio.
// Prorrateo base 30/360 por tiempo laborado en el año. Modelo A: gasto directo (6101xx-008).

function getBonoEduCfg() {
  const cfg = window._configPlanilla || {}
  return {
    monto: parseFloat(cfg.bono_educativo_monto) || 2068.58,
    tope:  parseFloat(cfg.bono_educativo_tope)  || 27970.32,
    anio:  parseInt(cfg.bono_educativo_anio, 10) || new Date().getFullYear()
  }
}

// Cuenta de gasto del bono educativo por sección (sufijo 008): GO=610101, GV=610102, GA=610103
function cuentaBonoEdu(seccion) {
  const p = (seccion || '').trim().toUpperCase().split(/\s+/)[0]
  if (p === 'GV') return '610102-008'
  if (p === 'GA') return '610103-008'
  return '610101-008' // GO (default)
}

let _bonoEduCtx = null  // { anio, desde, hasta, label, monto, tope, filas, existe }

function ensureBonoEduLauncher() {
  if (document.getElementById('btn-bono-educativo')) return
  const anchor = document.getElementById('planilla-resultado')
  if (!anchor || !anchor.parentNode) return
  const btn = document.createElement('button')
  btn.id = 'btn-bono-educativo'; btn.type = 'button'
  btn.className = 'btn btn-ghost'; btn.style.margin = '0 0 12px 8px'
  btn.textContent = '🎒 Planilla de bono educativo'
  btn.onclick = () => window.abrirBonoEducativo()
  const bonoBtn = document.getElementById('btn-planilla-bono')
  if (bonoBtn && bonoBtn.parentNode) bonoBtn.parentNode.insertBefore(btn, bonoBtn.nextSibling)
  else anchor.parentNode.insertBefore(btn, anchor)
}

function ensureBonoEduModal() {
  if (document.getElementById('modal-bono-edu')) return
  const div = document.createElement('div')
  div.className = 'modal-backdrop'; div.id = 'modal-bono-edu'
  const now = new Date()
  const cfg = getBonoEduCfg()
  let opts = ''
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) opts += `<option value="${y}" ${y === cfg.anio ? 'selected' : ''}>${y}</option>`
  div.innerHTML = `
    <div class="modal" style="width:min(1000px,95vw);max-width:1000px;max-height:88vh;display:flex;flex-direction:column">
      <div class="modal-header"><h3>🎒 Planilla de bono educativo</h3><button class="modal-close" onclick="closeModalBonoEdu()">✕</button></div>
      <div class="modal-body" style="flex:1;min-height:0;overflow-y:auto">
        <div style="display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin-bottom:12px">
          <div class="fld"><label>Año</label><select id="be-anio">${opts}</select></div>
          <div class="fld"><label>Fecha de pago</label><input type="date" id="be-fecha-pago" value="${now.toLocaleDateString('en-CA')}"></div>
          <button class="btn btn-gold" type="button" onclick="window.calcularBonoEducativo()">Calcular →</button>
        </div>
        <div id="be-periodo" style="font-size:12px;color:var(--text3);margin-bottom:8px"></div>
        <div id="be-resultado"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" onclick="closeModalBonoEdu()">Cerrar</button>
        <button class="btn btn-gold" id="be-btn-partida" type="button" onclick="window.generarBonoEducativo()" style="display:none">Generar partida (borrador)</button>
      </div>
    </div>`
  document.body.appendChild(div)
}

window.closeModalBonoEdu = () => { const m = document.getElementById('modal-bono-edu'); if (m) m.classList.remove('open') }

window.abrirBonoEducativo = () => {
  ensureBonoEduModal()
  _bonoEduCtx = null
  document.getElementById('be-resultado').innerHTML = ''
  document.getElementById('be-periodo').textContent = ''
  document.getElementById('be-btn-partida').style.display = 'none'
  document.getElementById('modal-bono-edu').classList.add('open')
}

// Marca/desmarca quién aplica (persiste empleados.aplica_bono_educativo) y recalcula
window.toggleAplicaBonoEdu = async (empleadoId, checked) => {
  const sb = getSb()
  const { error } = await sb.from('empleados').update({ aplica_bono_educativo: checked }).eq('id', empleadoId)
  if (error) { window.toast?.('No se pudo guardar: ' + error.message, 'error'); return }
  const emp = allEmpleados.find(e => e.id === empleadoId); if (emp) emp.aplica_bono_educativo = checked
  await window.calcularBonoEducativo()
}

window.calcularBonoEducativo = async () => {
  const sb = getSb()
  const r2 = x => Math.round(x * 100) / 100
  const cfg = getBonoEduCfg()
  const anio = parseInt(document.getElementById('be-anio').value, 10)
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`
  const label = `BONO EDUCATIVO ${anio}`
  document.getElementById('be-periodo').textContent = `Período: ${desde} a ${hasta} · monto base L. ${fmt(cfg.monto)} · tope L. ${fmt(cfg.tope)} · base 30/360 (exento de IHSS/ISR, no integra prestaciones/13.º/14.º)`

  const { data: yaExiste } = await sb.from('planillas_bono_educativo')
    .select('id, estado, partida_numero').eq('periodo', label).maybeSingle()

  const { data: emps } = await sb.from('empleados').select('*').eq('activo', true).order('seccion').order('nombre')
  const candidatos = (emps || []).filter(e => !e.es_socio && (e.sueldo_mensual || 0) <= cfg.tope)

  const filas = candidatos.map(e => {
    const dias = diasBono(e.fecha_ingreso, desde, hasta)
    const aplica = !!e.aplica_bono_educativo
    const monto = aplica ? r2(cfg.monto / 360 * dias) : 0
    return {
      empleado_id: e.id, nombre: e.nombre, seccion: e.seccion, centro_costo: e.centro_costo,
      sueldo_mensual: e.sueldo_mensual || 0, fecha_ingreso: e.fecha_ingreso || null,
      dias, aplica, monto
    }
  })

  _bonoEduCtx = { anio, desde, hasta, label, monto: cfg.monto, tope: cfg.tope, filas, existe: yaExiste || null }

  const aplicables = filas.filter(f => f.aplica)
  const total = r2(aplicables.reduce((s, f) => s + f.monto, 0))

  document.getElementById('be-resultado').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px">
      <div class="stat-card"><div class="stat-num" style="font-size:16px">${aplicables.length}</div><div class="stat-label">Aplican</div></div>
      <div class="stat-card"><div class="stat-num" style="font-size:16px">${filas.length}</div><div class="stat-label">Elegibles (≤ tope)</div></div>
      <div class="stat-card"><div class="stat-num" style="font-size:15px;color:var(--green)">L. ${fmt(total)}</div><div class="stat-label">Total a pagar</div></div>
    </div>
    ${yaExiste ? `<div style="padding:8px 12px;background:rgba(245,158,11,0.12);border-radius:8px;color:var(--gold);font-size:12px;margin-bottom:10px">⚠️ Ya existe la planilla ${label}${yaExiste.partida_numero ? ` (partida #${yaExiste.partida_numero})` : ''}. <button class="btn btn-ghost" style="padding:2px 8px;font-size:11px;margin-left:8px" onclick="window.regenerarBonoEdu()">🗑️ Borrar y regenerar</button></div>` : ''}
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Marca quién presentó constancia de matrícula (se guarda al instante). Solo aparecen empleados activos, no socios y con sueldo ≤ tope.</div>
    <div class="table-wrap" style="overflow-x:auto"><table style="width:100%;min-width:660px"><thead><tr>
      <th style="text-align:center">Aplica</th><th>Empleado</th><th>Sección</th><th>Ingreso</th>
      <th style="text-align:center">Días</th><th style="text-align:right">Sueldo</th><th style="text-align:right">Bono</th>
    </tr></thead><tbody>
    ${filas.map(f => `<tr style="${f.aplica ? '' : 'opacity:0.55'}">
      <td style="text-align:center"><input type="checkbox" ${f.aplica ? 'checked' : ''} onchange="window.toggleAplicaBonoEdu('${f.empleado_id}', this.checked)"></td>
      <td>${f.nombre}</td>
      <td style="font-size:12px">${f.seccion || '—'}</td>
      <td style="font-size:12px;color:var(--text3)">${f.fecha_ingreso || '—'}</td>
      <td style="text-align:center">${f.dias}${f.dias >= 360 ? ' <span style="color:var(--green);font-size:10px">100%</span>' : ''}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px">L. ${fmt(f.sueldo_mensual)}</td>
      <td style="text-align:right;font-family:var(--mono);font-weight:600;color:${f.aplica ? 'var(--green)' : 'var(--text3)'}">${f.aplica ? 'L. ' + fmt(f.monto) : '—'}</td>
    </tr>`).join('')}
    </tbody></table></div>`

  document.getElementById('be-btn-partida').style.display = (yaExiste || aplicables.length === 0) ? 'none' : ''
}

window.regenerarBonoEdu = async () => {
  if (!_bonoEduCtx || !_bonoEduCtx.existe) return
  if (!confirm(`¿Borrar la planilla ${_bonoEduCtx.label} y regenerar? La partida borrador, si existe, deberás anularla manualmente.`)) return
  const sb = getSb()
  const { data: cab } = await sb.from('planillas_bono_educativo').select('id').eq('periodo', _bonoEduCtx.label).maybeSingle()
  if (cab) {
    await sb.from('detalle_bono_educativo').delete().eq('planilla_id', cab.id)
    await sb.from('planillas_bono_educativo').delete().eq('id', cab.id)
  }
  await window.calcularBonoEducativo()
}

window.generarBonoEducativo = async () => {
  if (!_bonoEduCtx) return
  const { anio, desde, hasta, label, monto, tope, filas, existe } = _bonoEduCtx
  if (existe) { window.toast?.(`Ya existe la planilla ${label}. Bórrala primero para regenerar.`, 'error'); return }
  const aplicables = filas.filter(f => f.aplica && f.monto > 0)
  if (!aplicables.length) { window.toast?.('No hay empleados marcados que apliquen.', 'error'); return }
  const sb = getSb()
  const r2 = x => Math.round(x * 100) / 100

  const btn = document.getElementById('be-btn-partida'); btn.disabled = true; btn.textContent = 'Procesando...'
  try {
    const { data: dup } = await sb.from('planillas_bono_educativo').select('id').eq('periodo', label).limit(1)
    if ((dup || []).length) throw new Error(`Ya existe la planilla ${label}.`)

    const codigosGasto = [...new Set(aplicables.map(f => cuentaBonoEdu(f.seccion)))]
    const codChequera = '110103-001'
    const { data: cuentas } = await sb.from('catalogo_cuentas').select('id, codigo, nombre').in('codigo', [...codigosGasto, codChequera])
    const mapC = {}; for (const c of (cuentas || [])) mapC[c.codigo] = c
    const faltan = [...codigosGasto, codChequera].filter(c => !mapC[c])
    if (faltan.length) throw new Error('Faltan cuentas en el catálogo: ' + faltan.join(', '))

    const fechaPago = document.getElementById('be-fecha-pago').value || hasta
    const total = r2(aplicables.reduce((s, f) => s + f.monto, 0))

    const { data: cab, error: cErr } = await sb.from('planillas_bono_educativo').insert({
      anio, periodo: label, fecha_desde: desde, fecha_hasta: hasta, fecha_pago: fechaPago,
      monto_unitario: monto, tope_salario: tope, estado: 'borrador',
      created_by: window._currentProfile?.()?.id || null
    }).select().single()
    if (cErr || !cab) throw new Error(cErr?.message || 'No se creó la planilla de bono educativo')

    const det = aplicables.map(f => ({
      planilla_id: cab.id, empleado_id: f.empleado_id, nombre: f.nombre, seccion: f.seccion,
      centro_costo: f.centro_costo, sueldo_mensual: f.sueldo_mensual, fecha_ingreso: f.fecha_ingreso,
      dias_trabajados: f.dias, monto: f.monto
    }))
    const { error: dErr } = await sb.from('detalle_bono_educativo').insert(det)
    if (dErr) throw new Error('Detalle: ' + dErr.message)

    // Partida borrador: Débito gasto bono educativo (6101xx-008) por sección / Crédito chequera
    const deb = {}
    for (const f of aplicables) {
      const cod = cuentaBonoEdu(f.seccion)
      deb[cod] = r2((deb[cod] || 0) + f.monto)
    }
    const desc = `PLANILLA ${label}`
    const numPartida = await window.siguienteNumeroPartida()
    const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
      centro_costo_id: null, fecha_partida: fechaPago, numero_partida: numPartida,
      descripcion: `${desc} (${aplicables.length} EMPLEADOS)`, tipo_origen: 'nomina', estado: 'borrador',
      total, generada_por: window._currentProfile?.()?.id || null
    }).select().single()
    if (pErr || !partida) throw new Error('Partida: ' + (pErr?.message || ''))

    const lineas = []
    for (const [cod, m] of Object.entries(deb)) {
      const c = mapC[cod]
      lineas.push({ partida_id: partida.id, cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre, tipo: 'debito', monto: r2(m), descripcion: desc, aplica_fiscal: false })
    }
    const ch = mapC[codChequera]
    lineas.push({ partida_id: partida.id, cuenta_id: ch.id, cuenta_codigo: ch.codigo, cuenta_nombre: ch.nombre, tipo: 'credito', monto: total, descripcion: desc, aplica_fiscal: false })
    const { error: lErr } = await sb.from('lineas_partida').insert(lineas)
    if (lErr) throw new Error('Líneas: ' + lErr.message)

    await sb.from('planillas_bono_educativo').update({ partida_numero: numPartida }).eq('id', cab.id)

    window.toast?.(`Planilla ${label} generada ✓ · Partida #${numPartida} (borrador) · ${aplicables.length} empleados · L. ${fmt(total)}`, 'success')
    window.logActividad?.('bono_educativo_generado', 'rrhh', `${label} · ${aplicables.length} empleados · L.${total}`)
    closeModalBonoEdu()
  } catch (e) {
    console.error('generarBonoEducativo:', e)
    window.toast?.('Error: ' + e.message, 'error')
  } finally {
    btn.disabled = false; btn.textContent = 'Generar partida (borrador)'
  }
}

})(); // end IIFE