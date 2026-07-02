// ══════════════════════════════════════════════
// ── MÓDULO CUENTAS POR COBRAR · js/cuentas-cobrar.js
// ── Listado mensual de CxC (alquileres, etc). Asiento opcional al crear,
// ── partida de cobro al pagar, recurrencia mensual por botón "Generar mes".
// ══════════════════════════════════════════════
;(function () {
"use strict";

const getSb = () => window._sb
const fmtL  = (v) => (parseFloat(v) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const localDateStr = (d) => (d || new Date()).toLocaleDateString('en-CA')   // YYYY-MM-DD local

// Cuenta contable de "Cuentas por cobrar" (clientes). Si el código exacto en tu
// catálogo es otro (p.ej. 110201-001), cambialo aquí.
const CUENTA_CXC = '110201-CLIENTES'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

let cxcMes = new Date()              // primer día del mes que se está viendo
cxcMes.setDate(1)
let cxcVerDesactivadas = false
let cxcCobroId = null
let cxcRowsMes = []                         // filas del mes ya cargadas (sin filtrar)
let cxcHoyStr = ''                          // fecha de hoy (para marcar vencidas)
let cxcFiltro = { q: '', estado: 'todas' }  // estado del filtro de la tabla

// ── Utilidades de catálogo / centros ──
const getCuenta = (codigo) => (window.catalogoCuentas || []).find(c => c.codigo === codigo)
const cuentasIngreso = () => (window.catalogoCuentas || []).filter(c => /^4/.test(c.codigo) && c.codigo.includes('-'))
const cuentasFormaPago = () => (window.catalogoCuentas || []).filter(c => /^1101(01|02|04)-/.test(c.codigo))
const centros = () => (window._empresas?.() || [])

// ── Utilidades de mes ──
function mesStr(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
function mesInicio(d) { return `${mesStr(d)}-01` }
function mesFin(d) {
  const ld = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return `${mesStr(d)}-${String(ld).padStart(2, '0')}`
}
function mesLabel(d) { return `${MESES[d.getMonth()]} ${d.getFullYear()}` }
function fechaEnMes(d, dia) {
  const ld = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const day = Math.min(dia, ld)
  return `${mesStr(d)}-${String(day).padStart(2, '0')}`
}

// ── Inyección de UI (vista + modales), idempotente ──
function ensureCxCUI() {
  // 0) Estilos propios para evitar desbordes (independiente de css/styles.css)
  if (!document.getElementById('cxc-styles')) {
    const st = document.createElement('style')
    st.id = 'cxc-styles'
    st.textContent = `
      #modal-cxc-nueva .form-grid, #modal-cxc-cobrar .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
      #modal-cxc-nueva .fld, #modal-cxc-cobrar .fld { min-width:0; }
      #modal-cxc-nueva input, #modal-cxc-nueva select,
      #modal-cxc-cobrar input, #modal-cxc-cobrar select { width:100%; max-width:100%; box-sizing:border-box; }
      #view-cuentas-cobrar .table-wrap { overflow-x:auto; }
      #view-cuentas-cobrar table { width:100%; }
    `
    document.head.appendChild(st)
  }
  // 1) Vista
  if (!document.getElementById('view-cuentas-cobrar')) {
    const anyView = document.querySelector('.view')
    if (anyView && anyView.parentNode) {
      const v = document.createElement('div')
      v.className = 'view'
      v.id = 'view-cuentas-cobrar'
      anyView.parentNode.appendChild(v)
    }
  }
  // 2) Modal Nueva cuenta
  if (!document.getElementById('modal-cxc-nueva')) {
    const html = `
    <div class="modal-backdrop" id="modal-cxc-nueva">
      <div class="modal" style="width:560px">
        <div class="modal-title">➕ Nueva cuenta por cobrar</div>
        <div class="form-grid" style="gap:14px">
          <div class="fld" style="grid-column:1/-1">
            <label>Concepto</label>
            <input type="text" id="cxc-concepto" placeholder="Ej: Alquiler local centro">
          </div>
          <div class="fld">
            <label>Nombre del deudor</label>
            <input type="text" id="cxc-deudor" placeholder="Nombre completo">
          </div>
          <div class="fld">
            <label>Teléfono</label>
            <input type="text" id="cxc-telefono" placeholder="Opcional">
          </div>
          <div class="fld">
            <label>Monto (L.)</label>
            <input type="number" id="cxc-monto" min="0" step="0.01" placeholder="0.00">
          </div>
          <div class="fld">
            <label>Fecha de pago (vencimiento)</label>
            <input type="date" id="cxc-fecha">
          </div>
          <div class="fld">
            <label>Cuenta de ingreso</label>
            <select id="cxc-cuenta-ingreso"></select>
          </div>
          <div class="fld">
            <label>Centro de costo</label>
            <select id="cxc-centro"></select>
          </div>
          <div class="fld" style="grid-column:1/-1;display:flex;gap:24px;align-items:center;margin-top:4px">
            <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;text-transform:none">
              <input type="checkbox" id="cxc-recurrente" style="width:auto;margin:0"> Recurrente (mensual)
            </label>
            <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;text-transform:none">
              <input type="checkbox" id="cxc-asiento" style="width:auto;margin:0"> ¿Crear asiento contable ahora?
            </label>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">
          Si marcás el asiento, se genera una partida en borrador (Débito ${CUENTA_CXC} / Crédito ingreso). Si no, el ingreso se registra recién al cobrar.
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
          <button class="btn btn-ghost" onclick="closeModal('modal-cxc-nueva')">Cancelar</button>
          <button class="btn btn-gold" id="btn-guardar-cxc" onclick="guardarCxC()">Guardar</button>
        </div>
      </div>
    </div>`
    const w = document.createElement('div'); w.innerHTML = html.trim()
    document.body.appendChild(w.firstElementChild)
  }
  // 3) Modal Cobrar
  if (!document.getElementById('modal-cxc-cobrar')) {
    const html = `
    <div class="modal-backdrop" id="modal-cxc-cobrar">
      <div class="modal" style="width:480px">
        <div class="modal-title">💵 Registrar cobro</div>
        <div id="cxc-cobro-info" style="font-size:13px;color:var(--text2);margin-bottom:14px"></div>
        <div class="form-grid" style="gap:14px">
          <div class="fld">
            <label>Fecha de cobro</label>
            <input type="date" id="cxc-cobro-fecha">
          </div>
          <div class="fld">
            <label>Forma de pago (cuenta)</label>
            <input type="text" id="cxc-cobro-forma" list="cxc-forma-list" placeholder="Escribí código o nombre…" autocomplete="off">
            <datalist id="cxc-forma-list"></datalist>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
          <button class="btn btn-ghost" onclick="closeModal('modal-cxc-cobrar')">Cancelar</button>
          <button class="btn btn-gold" id="btn-confirmar-cobro-cxc" onclick="confirmarCobroCxC()">Cobrar y generar partida</button>
        </div>
      </div>
    </div>`
    const w = document.createElement('div'); w.innerHTML = html.trim()
    document.body.appendChild(w.firstElementChild)
  }
}

// ── Carga principal ──
window.loadCuentasCobrar = async () => {
  ensureCxCUI()
  const view = document.getElementById('view-cuentas-cobrar')
  if (view && !view.classList.contains('active')) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
    view.classList.add('active')
  }
  renderCxCShell()
  await cargarCxCMes()
}

function renderCxCShell() {
  const view = document.getElementById('view-cuentas-cobrar')
  if (!view) return
  cxcFiltro = { q: '', estado: 'todas' }   // el shell se redibuja con los chips en "Todas"; sincronizamos el estado
  view.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">💰 Cuentas por Cobrar</div>
        <div class="page-sub">Alquileres y otras cuentas por cobrar · vista mensual</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" onclick="generarMesCxC()" id="btn-generar-mes-cxc">🔁 Generar mes</button>
        <button class="btn btn-gold" onclick="openNuevaCxC()">+ Nueva cuenta</button>
      </div>
    </div>

    <div class="form-card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn btn-ghost" style="padding:4px 12px" onclick="cxcMesAnterior()">◄</button>
          <span id="cxc-mes-label" style="font-weight:600;min-width:140px;text-align:center"></span>
          <button class="btn btn-ghost" style="padding:4px 12px" onclick="cxcMesSiguiente()">►</button>
        </div>
        <div style="display:flex;gap:18px;align-items:center">
          <div style="text-align:right"><div style="font-size:11px;color:var(--text3)">POR COBRAR</div><div id="cxc-stat-pendiente" style="font-family:var(--mono);color:var(--amber);font-weight:600">L. 0.00</div></div>
          <div style="text-align:right"><div style="font-size:11px;color:var(--text3)">VENCIDO</div><div id="cxc-stat-vencido" style="font-family:var(--mono);color:var(--red);font-weight:600">L. 0.00</div></div>
          <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;text-transform:none;font-size:12px">
            <input type="checkbox" id="cxc-ver-desactivadas" style="width:auto;margin:0" onchange="toggleCxCDesactivadas(this.checked)"> Ver desactivadas
          </label>
        </div>
      </div>
    </div>

    <div class="cxc-filtros" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <input type="text" id="cxc-buscar" placeholder="🔎 Buscar por concepto, deudor o teléfono…" oninput="cxcSetBusqueda(this.value)" style="flex:1;min-width:200px">
      <div class="cat-filters" style="margin:0">
        <button class="cat-filter active" onclick="cxcSetEstado(this,'todas')">Todas</button>
        <button class="cat-filter" onclick="cxcSetEstado(this,'porvencer')">Por vencer</button>
        <button class="cat-filter" onclick="cxcSetEstado(this,'vencidas')">Vencidas</button>
        <button class="cat-filter" onclick="cxcSetEstado(this,'pagadas')">Pagadas</button>
      </div>
      <span id="cxc-filtro-info" style="font-size:11px;color:var(--text3);margin-left:auto"></span>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Vence</th><th>Concepto</th><th>Deudor</th><th>Teléfono</th>
          <th style="text-align:right">Monto</th><th>Estado</th><th style="text-align:right">Acciones</th>
        </tr></thead>
        <tbody id="cxc-tbody"></tbody>
      </table>
    </div>`
  document.getElementById('cxc-mes-label').textContent = mesLabel(cxcMes)
}

window.cxcMesAnterior = () => { cxcMes = new Date(cxcMes.getFullYear(), cxcMes.getMonth() - 1, 1); refrescarMes() }
window.cxcMesSiguiente = () => { cxcMes = new Date(cxcMes.getFullYear(), cxcMes.getMonth() + 1, 1); refrescarMes() }
window.toggleCxCDesactivadas = (v) => { cxcVerDesactivadas = !!v; cargarCxCMes() }

function refrescarMes() {
  const lbl = document.getElementById('cxc-mes-label'); if (lbl) lbl.textContent = mesLabel(cxcMes)
  cargarCxCMes()
}

// ── Consulta del mes ──
window.cargarCxCMes = async () => {
  const tbody = document.getElementById('cxc-tbody')
  if (!tbody) return
  const sb = getSb()
  const hoy = localDateStr()

  let rows = []
  if (cxcVerDesactivadas) {
    const { data } = await sb.from('cuentas_por_cobrar').select('*')
      .eq('activo', false).order('fecha_pago', { ascending: false })
    rows = data || []
  } else {
    const ini = mesInicio(cxcMes), fin = mesFin(cxcMes)
    // Del mes (cobradas y pendientes) + pendientes arrastradas de meses anteriores
    const { data } = await sb.from('cuentas_por_cobrar').select('*')
      .eq('activo', true)
      .or(`and(fecha_pago.gte.${ini},fecha_pago.lte.${fin}),and(fecha_pago.lt.${ini},estado.eq.pendiente)`)
      .order('fecha_pago', { ascending: true })
    rows = data || []
  }

  // Stats
  const pendientes = rows.filter(r => r.estado === 'pendiente')
  const totalPend = pendientes.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0)
  const totalVenc = pendientes.filter(r => r.fecha_pago < hoy).reduce((s, r) => s + (parseFloat(r.monto) || 0), 0)
  const sP = document.getElementById('cxc-stat-pendiente'); if (sP) sP.textContent = 'L. ' + fmtL(totalPend)
  const sV = document.getElementById('cxc-stat-vencido'); if (sV) sV.textContent = 'L. ' + fmtL(totalVenc)

  // Guardar filas del mes y renderizar aplicando el filtro activo
  cxcRowsMes = rows
  cxcHoyStr = hoy
  cxcRenderTabla()
}

// ── Filtro de la tabla (buscador + chips de estado) ──
window.cxcSetBusqueda = (v) => { cxcFiltro.q = (v || '').toLowerCase().trim(); cxcRenderTabla() }
window.cxcSetEstado = (btn, est) => {
  cxcFiltro.estado = est
  document.querySelectorAll('.cxc-filtros .cat-filter').forEach(b => b.classList.toggle('active', b === btn))
  cxcRenderTabla()
}
function cxcEsVencida(r) { return r.estado === 'pendiente' && r.fecha_pago < cxcHoyStr }
function cxcPasaFiltro(r) {
  const q = cxcFiltro.q
  if (q) {
    const txt = `${r.concepto || ''} ${r.deudor_nombre || ''} ${r.deudor_telefono || ''}`.toLowerCase()
    if (!txt.includes(q)) return false
  }
  const e = cxcFiltro.estado
  if (e === 'pagadas')   return r.estado === 'pagado'
  if (e === 'vencidas')  return cxcEsVencida(r)
  if (e === 'porvencer') return r.estado === 'pendiente' && !cxcEsVencida(r)
  return true
}
function cxcRenderTabla() {
  const tbody = document.getElementById('cxc-tbody'); if (!tbody) return
  const hoy = cxcHoyStr
  const rows = (cxcRowsMes || []).filter(cxcPasaFiltro)

  const info = document.getElementById('cxc-filtro-info')
  if (info) {
    const tot = rows.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0)
    info.textContent = `Mostrando ${rows.length} de ${(cxcRowsMes || []).length} · L. ${fmtL(tot)}`
  }

  if (!rows.length) {
    const vacio = (cxcRowsMes || []).length
      ? 'Sin resultados con este filtro'
      : (cxcVerDesactivadas ? 'No hay cuentas desactivadas' : 'Sin cuentas por cobrar en este mes')
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3)">${vacio}</td></tr>`
    return
  }

  tbody.innerHTML = rows.map(r => {
    const vencida = r.estado === 'pendiente' && r.fecha_pago < hoy
    const rec = r.recurrente_mensual ? '<span title="Recurrente mensual" style="margin-left:6px">🔁</span>' : ''
    let estadoBadge, rowStyle = ''
    if (r.estado === 'pagado') {
      estadoBadge = `<span class="badge badge-on" style="font-size:10px">Pagado${r.partida_cobro_numero ? ' · #' + r.partida_cobro_numero : ''}</span>`
    } else if (vencida) {
      estadoBadge = `<span class="badge" style="font-size:10px;background:var(--red);color:#fff">Vencida</span>`
      rowStyle = 'background:rgba(220,60,60,0.08)'
    } else {
      estadoBadge = `<span class="badge badge-amber" style="font-size:10px">Pendiente</span>`
    }

    let acciones = ''
    if (cxcVerDesactivadas) {
      acciones = `<button class="btn btn-ghost" style="padding:2px 10px;font-size:11px" onclick="reactivarCxC('${r.id}')">Reactivar</button>
                  <button class="btn btn-ghost" style="padding:2px 10px;font-size:11px;border-color:var(--red);color:var(--red)" onclick="eliminarCxC('${r.id}')">Eliminar</button>`
    } else if (r.estado === 'pendiente') {
      acciones = `<button class="btn btn-gold" style="padding:2px 10px;font-size:11px" onclick="openCobrarCxC('${r.id}')">💵 Cobrar</button>
                  <button class="btn btn-ghost" style="padding:2px 10px;font-size:11px" onclick="desactivarCxC('${r.id}')">Desactivar</button>`
    } else {
      acciones = `<span style="font-size:11px;color:var(--text3)">${r.forma_pago_codigo || ''}</span>`
    }

    return `<tr style="${rowStyle}">
      <td style="font-family:var(--mono);font-size:12px;${vencida ? 'color:var(--red);font-weight:600' : ''}">${r.fecha_pago}</td>
      <td>${r.concepto || ''}${rec}${r.asiento_creacion ? '<span title="Con asiento de creación" style="margin-left:6px;font-size:10px;color:var(--text3)">📒</span>' : ''}</td>
      <td>${r.deudor_nombre || ''}</td>
      <td style="font-size:12px;color:var(--text3)">${r.deudor_telefono || '—'}</td>
      <td style="text-align:right;font-family:var(--mono)">L. ${fmtL(r.monto)}</td>
      <td>${estadoBadge}</td>
      <td style="text-align:right;white-space:nowrap">${acciones}</td>
    </tr>`
  }).join('')
}

// ── Nueva cuenta ──
window.openNuevaCxC = () => {
  ensureCxCUI()
  const selI = document.getElementById('cxc-cuenta-ingreso')
  selI.innerHTML = '<option value="">— Seleccionar —</option>' +
    cuentasIngreso().map(c => `<option value="${c.codigo}">${c.codigo} · ${c.nombre}</option>`).join('')
  const selC = document.getElementById('cxc-centro')
  selC.innerHTML = '<option value="">— Seleccionar —</option>' +
    centros().map(e => `<option value="${e.id}">${e.nombre}</option>`).join('')
  document.getElementById('cxc-concepto').value = ''
  document.getElementById('cxc-deudor').value = ''
  document.getElementById('cxc-telefono').value = ''
  document.getElementById('cxc-monto').value = ''
  document.getElementById('cxc-fecha').value = ''
  document.getElementById('cxc-recurrente').checked = false
  document.getElementById('cxc-asiento').checked = false
  document.getElementById('modal-cxc-nueva').classList.add('open')
}

window.guardarCxC = async () => {
  const concepto = document.getElementById('cxc-concepto').value.trim()
  const deudor = document.getElementById('cxc-deudor').value.trim()
  const telefono = document.getElementById('cxc-telefono').value.trim()
  const monto = parseFloat(document.getElementById('cxc-monto').value) || 0
  const fecha = document.getElementById('cxc-fecha').value
  const cuentaIngreso = document.getElementById('cxc-cuenta-ingreso').value
  const centroId = document.getElementById('cxc-centro').value
  const recurrente = document.getElementById('cxc-recurrente').checked
  const conAsiento = document.getElementById('cxc-asiento').checked

  if (!concepto) { window.toast?.('Escribí el concepto', 'error'); return }
  if (!deudor) { window.toast?.('Escribí el nombre del deudor', 'error'); return }
  if (monto <= 0) { window.toast?.('Ingresá un monto válido', 'error'); return }
  if (!fecha) { window.toast?.('Seleccioná la fecha de pago', 'error'); return }
  if (!cuentaIngreso) { window.toast?.('Seleccioná la cuenta de ingreso', 'error'); return }
  if (!centroId) { window.toast?.('Seleccioná el centro de costo', 'error'); return }

  const sb = getSb()
  const btn = document.getElementById('btn-guardar-cxc')
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...' }

  try {
    const { data: row, error } = await sb.from('cuentas_por_cobrar').insert({
      concepto, deudor_nombre: deudor, deudor_telefono: telefono || null,
      monto, fecha_pago: fecha, cuenta_ingreso_codigo: cuentaIngreso,
      centro_costo_id: centroId, recurrente_mensual: recurrente,
      asiento_creacion: conAsiento, estado: 'pendiente', activo: true,
      created_by: window._currentProfile?.()?.nombre || null
    }).select().single()
    if (error || !row) { window.toast?.('Error al guardar: ' + (error?.message || ''), 'error'); throw new Error('insert') }

    let msg = 'Cuenta por cobrar creada'
    if (conAsiento) {
      const num = await generarPartidaCreacion(row)
      await sb.from('cuentas_por_cobrar').update({ partida_creacion_numero: num }).eq('id', row.id)
      msg += ` · Partida #${num} (borrador)`
    }
    window.logActividad?.('cxc_crear', 'cuentas_cobrar', `${concepto} · ${deudor} · L.${fmtL(monto)}${conAsiento ? ' · con asiento' : ''}`)
    window.toast?.(msg, 'success')
    window.closeModal('modal-cxc-nueva')
    await cargarCxCMes()
  } catch (e) {
    console.error('guardarCxC:', e)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar' }
  }
}

// Partida de creación (devengo): Débito CxC / Crédito Ingreso
async function generarPartidaCreacion(row) {
  const cxc = getCuenta(CUENTA_CXC)
  const ing = getCuenta(row.cuenta_ingreso_codigo)
  if (!cxc) throw new Error(`No se encontró la cuenta ${CUENTA_CXC} en el catálogo`)
  if (!ing) throw new Error(`No se encontró la cuenta de ingreso ${row.cuenta_ingreso_codigo}`)
  const desc = `CXC ${row.concepto} - ${row.deudor_nombre}`.toUpperCase()
  return generarPartidaBorrador({
    fecha: localDateStr(), descripcion: desc, total: row.monto,
    centro_costo_id: row.centro_costo_id,
    lineas: [
      { cuenta_id: cxc.id, cuenta_codigo: cxc.codigo, cuenta_nombre: cxc.nombre, tipo: 'debito',  monto: row.monto, descripcion: desc, aplica_fiscal: true, centro_costo_id: null },
      { cuenta_id: ing.id, cuenta_codigo: ing.codigo, cuenta_nombre: ing.nombre, tipo: 'credito', monto: row.monto, descripcion: desc, aplica_fiscal: true, centro_costo_id: row.centro_costo_id }
    ]
  })
}

// ── Cobrar ──
// Resuelve lo que el usuario escribió/eligió en el campo Cuenta ("código · nombre",
// solo código, o solo nombre) al código de cuenta válido; '' si no coincide con ninguna.
function cxcResolverForma(str) {
  if (!str) return ''
  const s = String(str).trim()
  const cod = s.split('·')[0].trim()
  const lista = cuentasFormaPago()
  const hit = lista.find(c => c.codigo === cod)
           || lista.find(c => `${c.codigo} · ${c.nombre}`.toLowerCase() === s.toLowerCase())
           || lista.find(c => (c.nombre || '').toLowerCase() === s.toLowerCase())
  return hit ? hit.codigo : ''
}

window.openCobrarCxC = async (id) => {
  ensureCxCUI()
  const sb = getSb()
  const { data: row } = await sb.from('cuentas_por_cobrar').select('*').eq('id', id).single()
  if (!row) { window.toast?.('Cuenta no encontrada', 'error'); return }
  cxcCobroId = id
  document.getElementById('cxc-cobro-info').innerHTML =
    `<strong>${row.concepto}</strong> · ${row.deudor_nombre}<br>Monto: <strong>L. ${fmtL(row.monto)}</strong>`
  document.getElementById('cxc-cobro-fecha').value = localDateStr()
  const dl = document.getElementById('cxc-forma-list')
  if (dl) dl.innerHTML = cuentasFormaPago().map(c => `<option value="${c.codigo} · ${c.nombre}"></option>`).join('')
  const inpForma = document.getElementById('cxc-cobro-forma')
  if (inpForma) inpForma.value = ''
  document.getElementById('modal-cxc-cobrar').classList.add('open')
}

window.confirmarCobroCxC = async () => {
  if (!cxcCobroId) return
  const fecha = document.getElementById('cxc-cobro-fecha').value
  const formaCod = cxcResolverForma(document.getElementById('cxc-cobro-forma').value)
  if (!fecha) { window.toast?.('Seleccioná la fecha de cobro', 'error'); return }
  if (!formaCod) { window.toast?.('Elegí una cuenta de forma de pago válida de la lista', 'error'); return }

  const sb = getSb()
  const btn = document.getElementById('btn-confirmar-cobro-cxc')
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando...' }

  try {
    const { data: row } = await sb.from('cuentas_por_cobrar').select('*').eq('id', cxcCobroId).single()
    if (!row) { window.toast?.('Cuenta no encontrada', 'error'); throw new Error('row') }

    const forma = getCuenta(formaCod)
    if (!forma) { window.toast?.('No se encontró la cuenta de forma de pago', 'error'); throw new Error('forma') }

    // La línea de crédito depende de si hubo asiento de creación:
    //  - con asiento: se canceló contra CxC  → crédito a CUENTA_CXC
    //  - sin asiento: ingreso al cobrar       → crédito a la cuenta de ingreso (+ centro de costo)
    let credito
    if (row.asiento_creacion) {
      const cxc = getCuenta(CUENTA_CXC)
      if (!cxc) { window.toast?.(`No se encontró la cuenta ${CUENTA_CXC}`, 'error'); throw new Error('cxc') }
      credito = { cuenta_id: cxc.id, cuenta_codigo: cxc.codigo, cuenta_nombre: cxc.nombre, tipo: 'credito', monto: row.monto, aplica_fiscal: true, centro_costo_id: null }
    } else {
      const ing = getCuenta(row.cuenta_ingreso_codigo)
      if (!ing) { window.toast?.(`No se encontró la cuenta de ingreso ${row.cuenta_ingreso_codigo}`, 'error'); throw new Error('ing') }
      credito = { cuenta_id: ing.id, cuenta_codigo: ing.codigo, cuenta_nombre: ing.nombre, tipo: 'credito', monto: row.monto, aplica_fiscal: true, centro_costo_id: row.centro_costo_id }
    }

    const desc = `COBRO CXC ${row.concepto} - ${row.deudor_nombre}`.toUpperCase()
    const num = await generarPartidaBorrador({
      fecha, descripcion: desc, total: row.monto, centro_costo_id: row.centro_costo_id,
      lineas: [
        { cuenta_id: forma.id, cuenta_codigo: forma.codigo, cuenta_nombre: forma.nombre, tipo: 'debito', monto: row.monto, descripcion: desc, aplica_fiscal: true, centro_costo_id: null },
        { ...credito, descripcion: desc }
      ]
    })

    await sb.from('cuentas_por_cobrar').update({
      estado: 'pagado', fecha_pagado: fecha, forma_pago_codigo: formaCod, partida_cobro_numero: num
    }).eq('id', cxcCobroId)

    window.logActividad?.('cxc_cobro', 'cuentas_cobrar', `${row.concepto} · ${row.deudor_nombre} · L.${fmtL(row.monto)} · Partida #${num}`)
    window.toast?.(`Cobro registrado · Partida #${num} (borrador)`, 'success')
    window.closeModal('modal-cxc-cobrar')
    cxcCobroId = null
    await cargarCxCMes()
  } catch (e) {
    console.error('confirmarCobroCxC:', e)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Cobrar y generar partida' }
  }
}

// ── Generar mes (recurrentes) ──
window.generarMesCxC = async () => {
  const sb = getSb()
  const btn = document.getElementById('btn-generar-mes-cxc')
  if (btn) { btn.disabled = true; btn.textContent = 'Generando...' }
  try {
    const { data: recs } = await sb.from('cuentas_por_cobrar').select('*').eq('recurrente_mensual', true)
    const series = {}
    for (const r of (recs || [])) { (series[r.serie_id] = series[r.serie_id] || []).push(r) }

    const target = cxcMes
    const inserts = []
    for (const sid in series) {
      const rows = series[sid].slice().sort((a, b) => (a.fecha_pago < b.fecha_pago ? 1 : -1)) // desc
      const latest = rows[0]
      if (!latest.activo) continue                                   // serie detenida (desactivada)
      if (rows.some(r => r.fecha_pago.slice(0, 7) === mesStr(target))) continue  // ya existe ese mes
      const dia = parseInt(latest.fecha_pago.split('-')[2], 10) || 1
      inserts.push({
        serie_id: sid, concepto: latest.concepto, deudor_nombre: latest.deudor_nombre,
        deudor_telefono: latest.deudor_telefono, monto: latest.monto,
        fecha_pago: fechaEnMes(target, dia), cuenta_ingreso_codigo: latest.cuenta_ingreso_codigo,
        centro_costo_id: latest.centro_costo_id, recurrente_mensual: true,
        asiento_creacion: false, estado: 'pendiente', activo: true,
        created_by: window._currentProfile?.()?.nombre || null
      })
    }
    if (inserts.length) {
      const { error } = await sb.from('cuentas_por_cobrar').insert(inserts)
      if (error) { window.toast?.('Error al generar: ' + error.message, 'error'); throw new Error('gen') }
    }
    window.logActividad?.('cxc_generar_mes', 'cuentas_cobrar', `${inserts.length} recurrente(s) · ${mesLabel(target)}`)
    window.toast?.(inserts.length ? `${inserts.length} cuenta(s) generada(s) para ${mesLabel(target)}` : `No había recurrentes pendientes de generar para ${mesLabel(target)}`, inserts.length ? 'success' : 'info')
    await cargarCxCMes()
  } catch (e) {
    console.error('generarMesCxC:', e)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔁 Generar mes' }
  }
}

// ── Desactivar / Reactivar / Eliminar ──
window.desactivarCxC = async (id) => {
  if (!confirm('¿Desactivar esta cuenta por cobrar?\n\nDejará de aparecer en el listado y, si es recurrente, no se generará en meses futuros.')) return
  await getSb().from('cuentas_por_cobrar').update({ activo: false }).eq('id', id)
  window.logActividad?.('cxc_desactivar', 'cuentas_cobrar', id)
  window.toast?.('Cuenta desactivada', 'success')
  await cargarCxCMes()
}

window.reactivarCxC = async (id) => {
  await getSb().from('cuentas_por_cobrar').update({ activo: true }).eq('id', id)
  window.logActividad?.('cxc_reactivar', 'cuentas_cobrar', id)
  window.toast?.('Cuenta reactivada', 'success')
  await cargarCxCMes()
}

window.eliminarCxC = async (id) => {
  if (!confirm('¿Eliminar definitivamente esta cuenta por cobrar?\n\nLas partidas contables que ya se hayan generado NO se borran; quedan en los libros.')) return
  const { error } = await getSb().from('cuentas_por_cobrar').delete().eq('id', id)
  if (error) { window.toast?.('Error al eliminar: ' + error.message, 'error'); return }
  window.logActividad?.('cxc_eliminar', 'cuentas_cobrar', id)
  window.toast?.('Cuenta eliminada', 'success')
  await cargarCxCMes()
}

// ── Helper genérico: partida borrador con líneas ──
async function generarPartidaBorrador({ fecha, descripcion, total, lineas, tipo_origen = 'ingreso', centro_costo_id = null }) {
  const sb = getSb()
  const num = await window.siguienteNumeroPartida()
  const { data: partida, error } = await sb.from('partidas_contables').insert({
    centro_costo_id, fecha_partida: fecha, numero_partida: num, descripcion,
    tipo_origen, estado: 'borrador', total,
    generada_por: window._currentProfile?.()?.id || null
  }).select().single()
  if (error || !partida) throw new Error('partida: ' + (error?.message || ''))
  const lineasIns = lineas.map(l => ({ partida_id: partida.id, ...l }))
  const { error: lErr } = await sb.from('lineas_partida').insert(lineasIns)
  if (lErr) throw new Error('lineas: ' + lErr.message)
  return num
}

// Inyectar la vista temprano (defer → DOM listo) para que showView la encuentre
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureCxCUI)
} else {
  ensureCxCUI()
}

})(); // end IIFE