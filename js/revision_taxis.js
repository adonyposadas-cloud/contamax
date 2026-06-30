// ── CONTAMAX · Revisión de entregas de Taxis (Fase 2 · alcance A: solo revisión) ──
// Lista las entregas que entran por el formulario público (origen motorista/caja),
// muestra su comprobante y permite Aprobar / Rechazar. Rechazar revierte el saldo.
// Eliminar (duplicados) usa el PIN de 'super' del módulo taxis.
// Depende de: window._sb, window.toast
// NO toca la contabilidad — las partidas se siguen generando en "Partidas Taxis".

const rtxSb = () => window._sb
const rtxEsSuper = () => { try { return window._currentProfile?.()?.rol === 'super_admin' } catch (e) { return false } }
// Puede administrar motoristas (agregar/editar/desactivar/cajas) = super_admin o
// usuario con el permiso 'rtx-mot-admin' (p.ej. el encargado de Taxis con rol compras).
const rtxMotAdmin = () => { try { const p = window._currentProfile?.(); return p?.rol === 'super_admin' || (Array.isArray(p?.permisos_modulos) && p.permisos_modulos.includes('rtx-mot-admin')) } catch (e) { return false } }
const rtxFmt = n => (parseFloat(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Fecha + hora de subida en zona horaria de Honduras (created_at viene en UTC)
const rtxFechaHora = ts => {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
let rtxEntregas = []
// Fecha "hoy" en Honduras (no UTC). Evita que de noche salte al día siguiente.
const rtxHoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' })
let rtxTelIdent = {}   // identidad → teléfono (tx_motoristas)
let rtxTelUni = {}     // unidad → teléfono (tx_directorio)
let rtxFBusqueda = ''  // texto de búsqueda (unidad/nombre/identidad)
let rtxFEstado = 'todas'
let rtxFMedio = 'todas'
let rtxFechaSol = ''   // día seleccionado en Solicitudes (yyyy-mm-dd)

// Resuelve el teléfono de una entrega con prioridad: entrega → motorista → directorio
function rtxTelefono(e) {
  const t = (e.telefono || '').toString().trim()
  if (t) return t
  return rtxTelIdent[e.identidad] || rtxTelUni[e.unidad] || ''
}

window.initRevisionTaxis = async () => {
  rtx7dEnsure()   // inyecta estilos (botones WhatsApp + modal 7 días)
  rtxKmEnsureTab()      // crea la pestaña "KM recorridos" si no existe
  rtxHistEnsureTab()    // crea la pestaña "Historial" si no existe
  rtxAplicarPermisos()  // oculta pestañas según permisos del usuario
  if (!rtxFechaSol) rtxFechaSol = rtxHoy()
  const inp = document.getElementById('rtx-fecha'); if (inp) inp.value = rtxFechaSol
  if (rtxEntregas.length) rtxRender(); else rtxConsultar()
  rtxStartAuto()
}

// Controla qué pestañas ve el usuario. Super_admin ve todas.
// Para otros: Dashboard requiere 'rtx-tab-dash', Motoristas requiere 'rtx-tab-mot'
// en sus permisos_modulos. Si no los tiene, solo ve Solicitudes (para programar).
function rtxAplicarPermisos() {
  let permisos = []
  let esSuper = false
  try {
    const p = window._currentProfile?.()
    esSuper = p?.rol === 'super_admin'
    permisos = Array.isArray(p?.permisos_modulos) ? p.permisos_modulos : []
  } catch (e) { /* sin perfil */ }

  const verDash = esSuper || permisos.includes('rtx-tab-dash')
  const verMot = esSuper || permisos.includes('rtx-tab-mot')
  const verKm = esSuper || permisos.includes('rtx-tab-km')
  const verHist = esSuper || permisos.includes('rtx-tab-hist')

  const tbDash = document.getElementById('rtx-tab-dash')
  const tbMot = document.getElementById('rtx-tab-mot')
  const tbKm = document.getElementById('rtx-tab-km')
  const tbHist = document.getElementById('rtx-tab-hist')
  if (tbDash) tbDash.classList.toggle('hidden', !verDash)
  if (tbMot) tbMot.classList.toggle('hidden', !verMot)
  if (tbKm) tbKm.classList.toggle('hidden', !verKm)
  if (tbHist) tbHist.classList.toggle('hidden', !verHist)

  // Si la pestaña activa quedó oculta, volver a Solicitudes
  if ((!verDash && tbDash?.classList.contains('on')) ||
      (!verMot && tbMot?.classList.contains('on')) ||
      (!verKm && tbKm?.classList.contains('on')) ||
      (!verHist && tbHist?.classList.contains('on'))) {
    rtxTab('sol')
  }
}

window.rtxConsultar = async (silent = false) => {
  if (!rtxFechaSol) rtxFechaSol = rtxHoy()
  const inp = document.getElementById('rtx-fecha'); if (inp && !inp.value) inp.value = rtxFechaSol
  const fecha = rtxFechaSol

  try {
    let q = rtxSb().from('entregas_taxis').select('*')
      .eq('fecha_deposito', fecha)
      .in('origen', ['motorista', 'caja'])
      .order('created_at', { ascending: false })
    const { data, error } = await q
    if (error) throw error
    rtxEntregas = data || []
    await rtxCargarTelefonos()
    rtxRender()
  } catch (e) {
    if (!silent) window.toast?.('Error: ' + (e.message || e), 'error')
  }
}

window.rtxSolCambiarFecha = (dir) => {
  if (!rtxFechaSol) rtxFechaSol = rtxHoy()
  const d = new Date(rtxFechaSol + 'T12:00:00'); d.setDate(d.getDate() + dir)
  rtxFechaSol = d.toISOString().slice(0, 10)
  const inp = document.getElementById('rtx-fecha'); if (inp) inp.value = rtxFechaSol
  rtxConsultar()
}
window.rtxSolHoy = () => {
  rtxFechaSol = rtxHoy()
  const inp = document.getElementById('rtx-fecha'); if (inp) inp.value = rtxFechaSol
  rtxConsultar()
}
window.rtxSolSetFecha = (v) => { if (v) { rtxFechaSol = v; rtxConsultar() } }

// ── Auto-refresco cada 15s mientras el panel está visible ──
let rtxTimer = null
function rtxStopAuto() { if (rtxTimer) { clearInterval(rtxTimer); rtxTimer = null } }
function rtxStartAuto() {
  rtxStopAuto()
  rtxTimer = setInterval(() => {
    const vista = document.getElementById('view-revision-taxis')
    if (!vista || vista.offsetParent === null) { rtxStopAuto(); return }   // salió del panel
    if (document.hidden) return                                            // pestaña en segundo plano
    if (document.querySelector('#rtx-7d-overlay.show, #rtx-overlay.show')) return  // modal abierto
    const pd = document.getElementById('rtx-pane-dash')
    if (pd && !pd.classList.contains('hidden')) rtxRenderDashboard(true)  // pestaña Dashboard
    else rtxConsultar(true)                                               // pestaña Solicitudes
  }, 15000)
}

// Carga los teléfonos faltantes desde tx_motoristas (por identidad) y tx_directorio (por unidad)
async function rtxCargarTelefonos() {
  const idents = [...new Set(rtxEntregas.map(e => e.identidad).filter(Boolean))]
  const unis = [...new Set(rtxEntregas.map(e => e.unidad).filter(Boolean))]
  rtxTelIdent = {}; rtxTelUni = {}
  try {
    if (idents.length) {
      const { data } = await rtxSb().from('tx_motoristas').select('identidad, telefono').in('identidad', idents)
      ;(data || []).forEach(m => { if (m.telefono) rtxTelIdent[m.identidad] = m.telefono })
    }
    if (unis.length) {
      const { data } = await rtxSb().from('tx_directorio').select('unidad, telefono').in('unidad', unis)
      ;(data || []).forEach(d => { if (d.telefono) rtxTelUni[d.unidad] = d.telefono })
    }
  } catch (e) { /* si falla, los botones de WhatsApp simplemente no aparecen */ }
}

function rtxRender() {
  const cont = document.getElementById('rtx-resultado')
  if (!cont) return
  cont.classList.remove('hidden')
  if (!rtxEntregas.length) { cont.innerHTML = '<div class="rtx-empty">No hay entregas con esos filtros.</div>'; return }

  // preservar foco/cursor del buscador entre renders
  const oldS = document.getElementById('rtx-search')
  const hadFocus = oldS && document.activeElement === oldS
  const caret = oldS ? oldS.selectionStart : null

  // Resumen por estado
  const por = { Pendiente: { n: 0, t: 0 }, Aprobada: { n: 0, t: 0 }, Rechazada: { n: 0, t: 0 } }
  rtxEntregas.forEach(e => { const k = e.estado || 'Pendiente'; (por[k] = por[k] || { n: 0, t: 0 }); por[k].n++; por[k].t += parseFloat(e.monto) || 0 })
  const resumen = `
    <div class="rtx-stats">
      <div class="rtx-stat pend"><div class="rtx-stat-n">${por.Pendiente.n}</div><div class="rtx-stat-l">Pendientes</div></div>
      <div class="rtx-stat apr"><div class="rtx-stat-n">${por.Aprobada.n}</div><div class="rtx-stat-l">Aprobadas</div></div>
      <div class="rtx-stat rec"><div class="rtx-stat-n">${por.Rechazada.n}</div><div class="rtx-stat-l">Rechazadas</div></div>
    </div>`

  // Conteos para los chips (sobre todo lo cargado)
  const totalAll = rtxEntregas.length
  const ce = { Pendiente: 0, Aprobada: 0, Rechazada: 0 }
  const medios = {}
  rtxEntregas.forEach(e => {
    const s = e.estado || 'Pendiente'; if (ce[s] != null) ce[s]++
    const m = e.banco || '—'; medios[m] = (medios[m] || 0) + 1
  })
  const chipE = (val, label, n) => `<button class="rtx-chip ${rtxFEstado === val ? 'on' : ''}" onclick="rtxChipEstado('${val}')">${label} <b>${n}</b></button>`
  const chipsEstado = `<div class="rtx-chips">
    ${chipE('todas', 'Todas', totalAll)}${chipE('Pendiente', 'Pend', ce.Pendiente)}${chipE('Aprobada', 'Aprob', ce.Aprobada)}${chipE('Rechazada', 'Rech', ce.Rechazada)}
  </div>`
  const chipM = (val, label, n) => `<button class="rtx-chip ${rtxFMedio === val ? 'on' : ''}" onclick="rtxChipMedio('${String(val).replace(/'/g, '')}')">${label} <b>${n}</b></button>`
  const chipsMedio = `<div class="rtx-chips">
    ${chipM('todas', 'Todas', totalAll)}${Object.keys(medios).sort().map(m => chipM(m, m, medios[m])).join('')}
  </div>`
  const search = `<input id="rtx-search" class="rtx-search" type="text" placeholder="Buscar por unidad, nombre o identidad…" value="${rtxFBusqueda.replace(/"/g, '&quot;')}" oninput="rtxBuscar(this.value)" autocomplete="off">`

  // Aplicar filtros client-side
  const q = rtxFBusqueda.trim().toLowerCase()
  const filtradas = rtxEntregas.filter(e => {
    if (rtxFEstado !== 'todas' && (e.estado || 'Pendiente') !== rtxFEstado) return false
    if (rtxFMedio !== 'todas' && (e.banco || '—') !== rtxFMedio) return false
    if (q) {
      const hay = [e.unidad, e.nombre_conductor, e.identidad].some(x => String(x || '').toLowerCase().includes(q))
      if (!hay) return false
    }
    return true
  })

  // Pendientes siempre primero (para que se vean los que faltan procesar),
  // luego el resto. Dentro de cada grupo se mantiene el orden por fecha (created_at desc).
  const prioridad = e => ((e.estado || 'Pendiente') === 'Pendiente' ? 0 : 1)
  filtradas.sort((a, b) => prioridad(a) - prioridad(b))

  const badge = est => {
    const c = est === 'Aprobada' ? 'apr' : est === 'Rechazada' ? 'rec' : 'pend'
    return `<span class="rtx-badge ${c}">${est || 'Pendiente'}</span>`
  }
  const cards = filtradas.map(e => {
    const est = e.estado || 'Pendiente'
    const foto = e.imagen_url
      ? `<img class="rtx-thumb" src="${e.imagen_url}" onclick="rtxVerComprobante('${e.imagen_url}')" alt="comprobante">`
      : `<div class="rtx-thumb rtx-nofoto">sin foto</div>`
    const tel = rtxTelefono(e)
    const nombre = e.nombre_conductor || 'motorista'
    const uni = e.unidad || ''
    const msgConex = `Hola ${nombre}, el dispositivo de Unidad #${uni} *NO ESTÁ EN LÍNEA*.\n\nRevisá:\n1. Internet del celular\n2. Compartir datos al dispositivo\n3. Dispositivo encendido\n\nUna vez corregido se programará.`
    const msgAprob = `Hola ${nombre}, tu pago de Unidad #${uni} fue *APROBADO*. Ya podés trabajar.`
    const msgRech  = `Hola ${nombre}, tu solicitud de Unidad #${uni} fue *RECHAZADA*. Por favor comunicate con el encargado.`
    const waBtn = (msg, label, cls) => tel
      ? `<button class="rtx-b ${cls}" onclick="rtxWa('${tel.replace(/'/g, '')}','${encodeURIComponent(msg)}')">${label}</button>`
      : ''
    const acciones = est === 'Pendiente'
      ? `<button class="rtx-b apr" onclick="rtxAprobar('${e.id}')">✓ Aprobar</button>
         <button class="rtx-b rec" onclick="rtxRechazar('${e.id}')">✕ Rechazar</button>
         ${waBtn(msgConex, '📲 Conexión', 'conex')}`
      : est === 'Rechazada'
      ? `<button class="rtx-b ghost" onclick="rtxRechazar('${e.id}')" disabled>Rechazar</button>
         ${waBtn(msgRech, '💬 WhatsApp', 'wa')}`
      : `<button class="rtx-b ghost" onclick="rtxRechazar('${e.id}')">Rechazar</button>
         ${waBtn(msgAprob, '💬 WhatsApp', 'wa')}`
    return `
      <div class="rtx-card">
        ${foto}
        <div class="rtx-info">
          <div class="rtx-top">
            <div><span class="rtx-uni">Unidad ${e.unidad || '—'}</span> · ${e.nombre_conductor || ''}</div>
            ${badge(est)}
          </div>
          <div class="rtx-grid">
            <div><span>Monto</span><b>L. ${rtxFmt(e.monto)}</b></div>
            <div><span>Medio</span><b>${e.banco || '—'}</b></div>
            <div><span>Esperado</span><b>L. ${rtxFmt(e.monto_esperado)}</b></div>
            <div><span>Saldo</span><b>L. ${rtxFmt(e.saldo_deudor)}</b></div>
            <div><span>Fecha dep.</span><b>${e.fecha_deposito || '—'}</b></div>
            <div><span>Origen</span><b>${e.origen === 'caja' ? ('Caja' + (e.caja_nombre ? ' · ' + e.caja_nombre : '')) : 'Motorista'}</b></div>
            <div><span>Subido</span><b>${rtxFechaHora(e.created_at)}</b></div>
          </div>
          <div class="rtx-acts">
            <button class="rtx-b ghost" onclick="rtxVer7dias('${e.identidad}','${e.unidad}','${e.fecha_deposito}')">📅 7 días</button>
            ${acciones}
            ${rtxEsSuper() ? `<button class="rtx-b edit" onclick="rtxEditar('${e.id}')">✏️ Editar</button>` : ''}
            <button class="rtx-b del" onclick="rtxEliminar('${e.id}')">🗑 Eliminar</button>
          </div>
        </div>
      </div>`
  }).join('')

  const lista = filtradas.length
    ? `<div class="rtx-list">${cards}</div>`
    : '<div class="rtx-empty">Sin resultados para este filtro.</div>'
  cont.innerHTML = resumen + search + chipsEstado + chipsMedio + lista

  // restaurar foco/cursor del buscador
  if (hadFocus) {
    const ne = document.getElementById('rtx-search')
    if (ne) { ne.focus(); if (caret != null) { try { ne.setSelectionRange(caret, caret) } catch (e) {} } }
  }
}

window.rtxAprobar = async (id) => {
  try {
    const { data, error } = await rtxSb().rpc('tx_revisar_entrega', { p_entrega_id: id, p_aprobar: true })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo aprobar', 'error'); return }
    window.toast?.('Entrega aprobada', 'success')
    rtxActualizarLocal(id, 'Aprobada')
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}

window.rtxRechazar = async (id) => {
  if (!confirm('¿Rechazar esta entrega? Se revertirá su efecto en el saldo del motorista.')) return
  try {
    const { data, error } = await rtxSb().rpc('tx_revisar_entrega', { p_entrega_id: id, p_aprobar: false })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo rechazar', 'error'); return }
    window.toast?.('Entrega rechazada · saldo revertido', 'success')
    rtxActualizarLocal(id, 'Rechazada')
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}

window.rtxEliminar = async (id) => {
  const pin = prompt('Eliminar definitivamente esta entrega (revierte el saldo).\nIngresá el PIN de super:')
  if (!pin) return
  try {
    const { data, error } = await rtxSb().rpc('tx_eliminar_entrega', { p_pin: pin, p_entrega_id: id })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo eliminar', 'error'); return }
    window.toast?.('Entrega eliminada', 'success')
    rtxEntregas = rtxEntregas.filter(e => e.id !== id)
    rtxRender()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}

// ── Editar entrega (solo super_admin): corrige monto / banco ──
let rtxEditOv = null
window.rtxEditar = (id) => {
  if (!rtxEsSuper()) { window.toast?.('Solo super_admin puede editar', 'error'); return }
  const e = rtxEntregas.find(x => x.id === id)
  if (!e) return
  const bancos = ['BAC', 'Ficohsa', 'Caja Tecnimax', 'Caja Yonker', 'Caja Taxis']
  if (e.banco && !bancos.includes(e.banco)) bancos.unshift(e.banco)
  const opts = bancos.map(b => `<option value="${b}" ${e.banco === b ? 'selected' : ''}>${b}</option>`).join('')
  const ov = document.createElement('div')
  ov.className = 'rtx-edit-ov show'
  ov.innerHTML = `
    <div class="rtx-edit-modal">
      <h3>Editar entrega · Unidad ${e.unidad}</h3>
      <div class="rtx-edit-sub">${e.nombre_conductor || ''} · ${e.estado}</div>
      <label>Monto depositado (L.)</label>
      <input type="number" id="rtx-edit-monto" value="${e.monto}" step="0.01" min="0" inputmode="decimal">
      <label>Banco / medio</label>
      <select id="rtx-edit-banco">${opts}</select>
      ${e.estado === 'Aprobada' ? '<div class="rtx-edit-warn">⚠ Esta entrega ya está aprobada. Cambiar el monto recalculará el saldo del motorista automáticamente.</div>' : ''}
      <div class="rtx-edit-acts">
        <button class="rtx-b ghost" onclick="rtxEditarCerrar()">Cancelar</button>
        <button class="rtx-b ok" onclick="rtxEditarGuardar('${id}')">Guardar cambios</button>
      </div>
    </div>`
  ov.onclick = (ev) => { if (ev.target === ov) rtxEditarCerrar() }
  document.body.appendChild(ov)
  rtxEditOv = ov
}
window.rtxEditarCerrar = () => { if (rtxEditOv) { rtxEditOv.remove(); rtxEditOv = null } }
window.rtxEditarGuardar = async (id) => {
  const monto = parseFloat(document.getElementById('rtx-edit-monto').value)
  const banco = document.getElementById('rtx-edit-banco').value
  if (!monto || monto <= 0) { window.toast?.('El monto debe ser mayor a cero', 'error'); return }
  const btn = document.querySelector('.rtx-edit-acts .rtx-b.ok'); if (btn) { btn.disabled = true; btn.textContent = 'Guardando…' }
  try {
    const { data, error } = await rtxSb().rpc('tx_editar_entrega', { p_entrega_id: id, p_monto: monto, p_banco: banco })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo editar', 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios' } return }
    window.toast?.('Entrega actualizada' + (data.reajustado ? ' · saldo recalculado' : ''), 'success')
    rtxEditarCerrar()
    rtxConsultar(true)  // refresca para traer el saldo recalculado
  } catch (e) {
    window.toast?.('Error: ' + (e.message || e), 'error')
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios' }
  }
}

function rtxActualizarLocal(id, estado) {
  const e = rtxEntregas.find(x => x.id === id); if (e) e.estado = estado
  rtxRender()
}

window.rtxVerComprobante = (url) => {
  const ov = document.getElementById('rtx-overlay')
  document.getElementById('rtx-img').src = url
  ov.classList.add('show')
}
window.rtxCerrarComprobante = () => document.getElementById('rtx-overlay').classList.remove('show')

// ── Panel "Últimos 7 días" ──────────────────────────────────────────
const RTX_EST = {
  ok:      { ic: '✓', cl: 'e-ok',    t: 'Entregó ≥ sugerida' },
  menos:   { ic: '⚠', cl: 'e-menos', t: 'Entregó menos' },
  trabajo: { ic: '✗', cl: 'e-trab',  t: 'Trabajó sin entregar' },
  sin:     { ic: '■', cl: 'e-sin',   t: 'Sin actividad' },
}
const rtx7dFmt = n => 'L. ' + Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function rtx7dEnsure() {
  if (document.getElementById('rtx-7d-overlay')) return
  const st = document.createElement('style')
  st.textContent = `
    .rtx-7d-ov{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px}
    .rtx-7d-ov.show{display:flex}
    .rtx-7d-modal{background:#15171c;border:1px solid #2a2e37;border-radius:14px;max-width:560px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.5)}
    .rtx-lbl{display:block;font-size:12px;color:#9aa0aa;text-transform:uppercase;letter-spacing:.04em;margin:10px 0 4px}
    .rtx-inp{width:100%;padding:9px 11px;background:#1a1d24;border:1px solid #2a2e37;border-radius:9px;color:#e8eaed;font-size:14px;box-sizing:border-box}
    .rtx-inp:focus{outline:none;border-color:#4a90e2}
    .rtx-caja-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 11px;background:#1a1d24;border:1px solid #2a2e37;border-radius:9px;margin-bottom:7px}
    .rtx-caja-row.off{opacity:.55}
    .rtx-caja-acc{display:flex;gap:6px}
    .rtx-7d-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #2a2e37;position:sticky;top:0;background:#15171c}
    .rtx-7d-head h3{margin:0;font-size:14px;color:#f0a500;font-weight:700}
    .rtx-7d-head button{background:none;border:none;color:#9aa0aa;font-size:18px;cursor:pointer;line-height:1}
    .rtx-7d-load{padding:30px;text-align:center;color:#9aa0aa}
    .rtx-7d-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:16px 18px}
    .rtx-7d-cards>div{background:#1c1f26;border:1px solid #2a2e37;border-radius:10px;padding:10px 12px}
    .rtx-7d-cards span{display:block;font-size:10px;letter-spacing:.5px;color:#8b919b;text-transform:uppercase;margin-bottom:4px}
    .rtx-7d-cards b{font-size:14px;color:#e8eaed}
    .rtx-7d-tbl{width:100%;border-collapse:collapse}
    .rtx-7d-tbl th,.rtx-7d-tbl td{padding:9px 18px;font-size:13px;border-bottom:1px solid #23262e;text-align:left}
    .rtx-7d-tbl th{color:#8b919b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
    .rtx-7d-tbl td.r,.rtx-7d-tbl th.r{text-align:right}
    .rtx-7d-tbl td.c,.rtx-7d-tbl th.c{text-align:center}
    .rtx-7d-tbl td{color:#d4d7dc}
    .rtx-est{display:inline-flex;width:22px;height:22px;align-items:center;justify-content:center;border-radius:6px;font-size:12px;font-weight:700}
    .rtx-est.e-ok{background:rgba(46,160,67,.18);color:#3fb950}
    .rtx-est.e-menos{background:rgba(210,153,34,.18);color:#d29922}
    .rtx-est.e-trab{background:rgba(218,54,51,.18);color:#f85149}
    .rtx-est.e-sin{background:rgba(56,139,253,.18);color:#58a6ff}
    .rtx-7d-leg{display:flex;flex-wrap:wrap;gap:12px;padding:12px 18px 18px;font-size:11px;color:#8b919b}
    .rtx-7d-leg i{font-style:normal;font-weight:700;margin-right:3px}
    .rtx-7d-leg .e-ok{color:#3fb950}.rtx-7d-leg .e-menos{color:#d29922}
    .rtx-7d-leg .e-trab{color:#f85149}.rtx-7d-leg .e-sin{color:#58a6ff}
    .rtx-b.wa{background:rgba(22,163,74,.16)!important;color:#3fb950!important;border:1px solid rgba(22,163,74,.45)!important}
    .rtx-b.conex{background:rgba(210,153,34,.16)!important;color:#d29922!important;border:1px solid rgba(210,153,34,.45)!important}
    .rtx-search{width:100%;padding:10px 14px;margin:12px 0 10px;background:#15171c;border:1px solid #2a2e37;border-radius:10px;color:#e8eaed;font-size:14px;box-sizing:border-box}
    .rtx-search::placeholder{color:#6b7280}
    .rtx-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px}
    .rtx-chip{background:#15171c;border:1px solid #2a2e37;border-radius:20px;padding:5px 13px;font-size:12px;color:#9aa0aa;cursor:pointer}
    .rtx-chip b{color:#e8eaed;font-weight:700;margin-left:2px}
    .rtx-chip.on{background:rgba(240,165,0,.16);border-color:rgba(240,165,0,.5);color:#f0a500}
    .rtx-chip.on b{color:#f0a500}
    /* Pestañas */
    .rtx-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 16px}
    .rtx-tab{background:#15171c;border:1px solid #2a2e37;border-radius:10px;padding:9px 18px;font-size:14px;font-weight:600;color:#9aa0aa;cursor:pointer}
    .rtx-tab.on{background:#2563eb;border-color:#2563eb;color:#fff}
    /* Dashboard */
    .dash-fecha{display:flex;align-items:center;gap:8px;background:#15171c;border:1px solid #2a2e37;border-radius:10px;padding:8px 10px;margin-bottom:14px}
    .dash-nav{background:#1f232b;border:1px solid #2a2e37;border-radius:8px;color:#e8eaed;width:34px;height:34px;font-size:18px;cursor:pointer}
    .dash-date{flex:1;background:transparent;border:none;color:#e8eaed;font-size:14px;text-align:center}
    .dash-hoy{background:rgba(22,163,74,.18);border:1px solid rgba(22,163,74,.5);border-radius:8px;color:#3fb950;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer}
    .dash-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
    .dash-stat{background:#15171c;border:1px solid #2a2e37;border-radius:12px;padding:16px;text-align:center}
    .dash-n{font-size:22px;font-weight:800}
    .dash-n.green{color:#3fb950}.dash-n.blue{color:#4a90e2}.dash-n.amber{color:#f0a500}
    .dash-l{font-size:12px;color:#9aa0aa;margin-top:4px}
    .dash-card{background:#15171c;border:1px solid #2a2e37;border-radius:12px;padding:16px;margin-bottom:14px}
    .dash-card-t{font-size:14px;font-weight:700;color:#e8eaed;margin-bottom:12px}
    .dash-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #21242b;font-size:14px;color:#cfd3da}
    .dash-row:last-child{border-bottom:none}
    .dash-row b{color:#e8eaed}.dash-row small{color:#8b8f98;font-weight:400}
    .dash-pend{background:#1a1d24;border:1px solid #2a2e37;border-radius:10px;padding:12px;margin-bottom:10px}
    .dash-pend-top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
    .dash-pend-id{font-size:14px;color:#e8eaed}.dash-pend-id b{color:#f0a500}
    .dash-pend-dias{font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px}
    .dash-pend-dias.rojo{background:#7f1d1d;color:#fca5a5}
    .dash-pend-dias.amber{background:#78350f;color:#fcd34d}
    .dash-pend-dias.gris{background:rgba(120,128,140,.18);color:#9aa0aa}
    .dash-pend-sub{font-size:12px;color:#9aa0aa;margin:7px 0 10px}
    .dash-pend-acc{display:flex;flex-wrap:wrap;gap:7px}
    .dash-audit-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}
    .dash-audit-btn{background:#15171c;border:1px solid #2a2e37;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:600;color:#cfd3da;cursor:pointer}
    .dash-audit-btn:hover{border-color:#4a90e2}
    .dash-audit-btn.on{background:#b45309;border-color:#b45309;color:#fff}
    .dash-audit-hint{font-size:11px;color:#8b8f98}
    .dash-audit-sub{font-size:12px;color:#9aa0aa;margin-bottom:12px}
    .dash-audit-km{font-size:13px;font-weight:700;color:#f0a500;background:rgba(240,165,0,.14);border-radius:8px;padding:3px 10px;white-space:nowrap}
    .dash-audit-falta{color:#fca5a5}
    .dash-audit-volver{margin-bottom:12px}
    .dash-audit-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
    .dash-audit-actions .dash-audit-volver{margin-bottom:0}
    .dash-audit-export{border-color:rgba(63,185,80,.4);color:#3fb950}
    .rtx-b.call{background:rgba(74,144,226,.16)!important;color:#4a90e2!important;border:1px solid rgba(74,144,226,.45)!important;text-decoration:none;display:inline-flex;align-items:center}
    .rtx-b.edit{background:rgba(168,85,247,.16)!important;color:#c084fc!important;border:1px solid rgba(168,85,247,.45)!important}
    .rtx-b.ok{background:rgba(22,163,74,.2)!important;color:#3fb950!important;border:1px solid rgba(22,163,74,.5)!important}
    .rtx-edit-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
    .rtx-edit-modal{background:#1a1d24;border:1px solid #2a2e37;border-radius:14px;padding:22px;width:100%;max-width:380px}
    .rtx-edit-modal h3{margin:0 0 4px;font-size:17px;color:#e8eaed}
    .rtx-edit-sub{font-size:13px;color:#9aa0aa;margin-bottom:16px}
    .rtx-edit-modal label{display:block;font-size:12px;color:#9aa0aa;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.04em}
    .rtx-edit-modal input,.rtx-edit-modal select{width:100%;padding:11px 12px;background:#15171c;border:1px solid #2a2e37;border-radius:9px;color:#e8eaed;font-size:15px;box-sizing:border-box}
    .rtx-edit-warn{background:rgba(240,165,0,.12);border:1px solid rgba(240,165,0,.35);color:#f0a500;font-size:12px;padding:10px;border-radius:9px;margin-top:14px;line-height:1.4}
    .rtx-edit-acts{display:flex;gap:9px;margin-top:18px}
    .rtx-edit-acts .rtx-b{flex:1;justify-content:center;padding:11px}
    .dash-subtotal{text-align:right;color:#3fb950;font-weight:700;font-size:14px;margin:4px 0 12px}
    .dash-subtotal small{color:#8b8f98;font-weight:400}
    .dash-orden{background:#1f232b;border:1px solid #2a2e37;border-radius:8px;color:#9aa0aa;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer}
    .dash-orden.on{background:rgba(74,144,226,.16);border-color:rgba(74,144,226,.5);color:#4a90e2}
    .dash-dep{padding:9px 0;border-bottom:1px solid #21242b}
    .dash-dep:last-child{border-bottom:none}
    .dash-dep-top{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:14px;color:#e8eaed}
    .dash-dep-top b{color:#f0a500}
    .dash-dep-amt{color:#3fb950;font-weight:700;white-space:nowrap}
    .dash-dep-sub{font-size:12px;color:#8b8f98;margin-top:3px}
    .rtx-b.notas{background:rgba(120,113,108,.18)!important;color:#d6d3d1!important;border:1px solid rgba(120,113,108,.45)!important}
    .rtx-notas-modal{max-width:440px}
    .rtx-notas-lista{max-height:300px;overflow-y:auto;margin:14px 0}
    .rtx-nota{background:#12131a;border-radius:7px;padding:9px 11px;margin-bottom:8px}
    .rtx-nota-top{display:flex;align-items:center;gap:8px;margin-bottom:5px}
    .rtx-nota-autor{font-size:11px;font-weight:700;padding:2px 8px;border-radius:5px}
    .rtx-nota-fecha{font-size:11px;color:#8b8f98;flex:1}
    .rtx-nota-arch{background:none;border:none;color:#8b8f98;cursor:pointer;font-size:14px;padding:0 2px}
    .rtx-nota-txt{font-size:14px;color:#e5e7eb;line-height:1.45}
    .rtx-notas-input{width:100%;padding:11px;background:#15171c;border:1px solid #2a2e37;border-radius:9px;color:#e8eaed;font-size:14px;box-sizing:border-box;resize:vertical;font-family:inherit}
    .mot-lista{margin-top:4px}
    .mot-barra{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
    .mot-row{background:#15171c;border:1px solid #2a2e37;border-radius:10px;padding:13px;margin-bottom:9px}
    .mot-row.off{opacity:.6}
    .mot-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .mot-id{font-size:14px;color:#e8eaed}.mot-id b{color:#f0a500}
    .mot-estado{font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px}
    .mot-estado.on{background:rgba(22,163,74,.18);color:#3fb950}
    .mot-estado.off{background:rgba(120,128,140,.18);color:#9aa0aa}
    .mot-sub{font-size:12px;color:#9aa0aa;margin:7px 0}
    .mot-sub b{color:#cfd3da}.mot-sub b.mot-debe{color:#f0a500}
    .mot-acts{display:flex;gap:7px;margin-top:6px}
  `
  document.head.appendChild(st)
  const ov = document.createElement('div')
  ov.id = 'rtx-7d-overlay'; ov.className = 'rtx-7d-ov'
  ov.innerHTML = `<div class="rtx-7d-modal">
    <div class="rtx-7d-head"><h3 id="rtx-7d-title">Últimos 7 días</h3><button onclick="rtxCerrar7dias()">✕</button></div>
    <div id="rtx-7d-body"></div>
  </div>`
  ov.addEventListener('click', e => { if (e.target === ov) window.rtxCerrar7dias() })
  document.body.appendChild(ov)
}

function rtx7dRender(d) {
  document.getElementById('rtx-7d-title').textContent =
    `Últimos 7 días · Unidad ${d.unidad} · ${d.nombre || ''}`
  const filas = (d.dias || []).map(x => {
    const e = RTX_EST[x.estado] || RTX_EST.sin
    return `<tr>
      <td>${x.fecha}</td>
      <td class="r">${Number(x.entrega) > 0 ? rtx7dFmt(x.entrega) : '—'}</td>
      <td class="r">${x.suger == null ? '—' : rtx7dFmt(x.suger)}</td>
      <td class="r">${x.tiene_km ? Number(x.km).toFixed(1) : '—'}</td>
      <td class="c"><span class="rtx-est ${e.cl}" title="${e.t}">${e.ic}</span></td>
    </tr>`
  }).join('')
  document.getElementById('rtx-7d-body').innerHTML = `
    <div class="rtx-7d-cards">
      <div><span>Tarifa base</span><b>${rtx7dFmt(d.tarifa_base)}</b></div>
      <div><span>Saldo deudor</span><b>${rtx7dFmt(d.saldo)}</b></div>
      <div><span>Prom. entrega</span><b>${rtx7dFmt(d.prom_entrega)}</b></div>
    </div>
    <table class="rtx-7d-tbl">
      <thead><tr><th>Fecha</th><th class="r">Entrega</th><th class="r">T. suger</th><th class="r">KM</th><th class="c">Estado</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="rtx-7d-leg">
      <span><i class="e-ok">✓</i>Entregó ≥ sugerida</span>
      <span><i class="e-menos">⚠</i>Entregó menos</span>
      <span><i class="e-trab">✗</i>Trabajó sin entregar</span>
      <span><i class="e-sin">■</i>Sin actividad</span>
    </div>`
}

window.rtxVer7dias = async (identidad, unidad, fecha) => {
  rtx7dEnsure()
  const ov = document.getElementById('rtx-7d-overlay')
  document.getElementById('rtx-7d-body').innerHTML = '<div class="rtx-7d-load">Cargando…</div>'
  document.getElementById('rtx-7d-title').textContent = 'Últimos 7 días'
  ov.classList.add('show')
  try {
    const { data, error } = await rtxSb().rpc('tx_ultimos_7dias', {
      p_identidad: identidad, p_unidad: unidad, p_fecha: fecha
    })
    if (error) throw error
    if (!data?.ok) { document.getElementById('rtx-7d-body').innerHTML = `<div class="rtx-7d-load">${data?.error || 'Sin datos'}</div>`; return }
    rtx7dRender(data)
  } catch (e) {
    document.getElementById('rtx-7d-body').innerHTML = `<div class="rtx-7d-load">Error: ${e.message || e}</div>`
  }
}
window.rtxCerrar7dias = () => document.getElementById('rtx-7d-overlay')?.classList.remove('show')

// ── Filtros client-side (búsqueda + chips) ──
window.rtxBuscar = (v) => { rtxFBusqueda = v || ''; rtxRender() }
window.rtxChipEstado = (v) => { rtxFEstado = v; rtxRender() }
window.rtxChipMedio = (v) => { rtxFMedio = v; rtxRender() }

// ── Pestañas (Solicitudes / Dashboard) ──
let rtxDashFecha = ''  // yyyy-mm-dd
let rtxDashData = null // último resultado del dashboard (para filtrar pendientes sin re-consultar)
let rtxDashBusqueda = ''
let rtxDashCaja = 'todas'
let rtxDepBanco = 'todas'   // filtro de banco en Depósitos del día
let rtxDepOrden = 'hora'    // 'hora' | 'unidad'
// ── Auditoría KM vs entregas ──
let rtxDashAudit = ''         // '' | 'no_entrego' | 'no_cubrio'
let rtxDashAuditData = null   // { diaKM, lista }
let rtxDashAuditLoading = false
const RTX_KM_TRABAJO = 50     // km mínimos para considerar que la unidad "trabajó"

window.rtxTab = (tab) => {
  const tabs = ['sol', 'dash', 'mot', 'km', 'hist']
  tabs.forEach(t => {
    const tb = document.getElementById('rtx-tab-' + t)
    const pn = document.getElementById('rtx-pane-' + t)
    if (tb) tb.classList.toggle('on', t === tab)
    if (pn) pn.classList.toggle('hidden', t !== tab)
  })
  if (tab === 'dash') {
    if (!rtxDashFecha) rtxDashFecha = rtxHoy()
    rtxRenderDashboard()
  } else if (tab === 'mot') {
    rtxMotCargar()
  } else if (tab === 'km') {
    rtxKmAbrir()
  } else if (tab === 'hist') {
    rtxHistAbrir()
  }
}

window.rtxDashCambiarFecha = (dir) => {
  const d = new Date(rtxDashFecha + 'T12:00:00'); d.setDate(d.getDate() + dir)
  rtxDashFecha = d.toISOString().slice(0, 10); rtxDashAudit = ''; rtxDashAuditData = null; rtxRenderDashboard()
}
window.rtxDashHoy = () => { rtxDashFecha = rtxHoy(); rtxDashAudit = ''; rtxDashAuditData = null; rtxRenderDashboard() }
window.rtxDashSetFecha = (v) => { if (v) { rtxDashFecha = v; rtxDashAudit = ''; rtxDashAuditData = null; rtxRenderDashboard() } }

function rtxDashPendiente(p) {
  const tel = p.telefono || ''
  const sinHist = (p.dias_sin === null || p.dias_sin === undefined)
  const msg = encodeURIComponent(`Hola ${p.nombre || ''}, te escribimos de Tecnimax. ${sinHist ? 'No tenemos entregas recientes registradas' : `Tenés ${p.dias_sin} día(s) sin entregar (última: ${p.ultima_entrega})`}. Por favor comunicate para coordinar tu pago. Gracias.`)
  const waBtn = tel
    ? `<button class="rtx-b wa" onclick="rtxWa('${tel}','${msg}')">💬 WhatsApp</button>`
    : `<button class="rtx-b ghost" disabled>Sin teléfono</button>`
  const llamarBtn = tel ? `<a class="rtx-b call" href="tel:${tel}">📞 Llamar</a>` : ''
  const nc = p.notas_count || 0
  const notasBtn = `<button class="rtx-b notas" onclick="rtxNotasAbrir('${p.identidad}','${p.unidad}','${(p.nombre || '').replace(/'/g, '')}')">📝 Notas${nc ? ' (' + nc + ')' : ''}</button>`
  // Texto y color del badge según días sin entregar (idéntico al Sheets)
  let diasCls, diasLabel
  if (sinHist) { diasCls = 'gris'; diasLabel = 'Sin entregas registradas' }
  else if (p.dias_sin >= 4) { diasCls = 'rojo'; diasLabel = `${p.dias_sin} días sin entregar` }
  else if (p.dias_sin === 3) { diasCls = 'rojo'; diasLabel = 'Pendiente tres' }
  else if (p.dias_sin === 2) { diasCls = 'rojo'; diasLabel = 'Pendiente dos' }
  else { diasCls = 'amber'; diasLabel = 'Pendiente hoy' }
  return `
    <div class="dash-pend">
      <div class="dash-pend-top">
        <div class="dash-pend-id"><b>#${p.unidad}</b> · ${p.nombre || '—'}</div>
        <div class="dash-pend-dias ${diasCls}">${diasLabel}</div>
      </div>
      <div class="dash-pend-sub">
        Última: ${p.ultima_entrega} · Saldo: L. ${rtxFmt(p.saldo)}${p.caja ? ' · Caja: ' + p.caja : ''}${p.grupo ? ' · Grupo ' + p.grupo : ''}
      </div>
      <div class="dash-pend-acc">
        <button class="rtx-b ghost" onclick="rtxVer7dias('${p.identidad}','${p.unidad}','${rtxDashFecha}')">📅 7 días</button>
        ${notasBtn}${waBtn}${llamarBtn}
      </div>
    </div>`
}

window.rtxRenderDashboard = async (silent = false) => {
  const pane = document.getElementById('rtx-pane-dash')
  if (!pane) return
  if (!rtxDashFecha) rtxDashFecha = rtxHoy()
  if (!silent && !pane.innerHTML) pane.innerHTML = '<div class="rtx-empty">Cargando…</div>'
  let r
  try {
    const { data, error } = await rtxSb().rpc('tx_dashboard', { p_fecha: rtxDashFecha })
    if (error) throw error
    r = data
  } catch (e) {
    if (!silent) pane.innerHTML = '<div class="rtx-empty">Error: ' + (e.message || e) + '</div>'
    return
  }
  if (!r || !r.ok) { if (!silent) pane.innerHTML = '<div class="rtx-empty">Sin datos para esa fecha.</div>'; return }
  rtxDashData = r
  rtxDashPintar()
}

// Pinta el dashboard completo (lo fijo + los pendientes filtrados)
function rtxDashPintar() {
  const pane = document.getElementById('rtx-pane-dash')
  const r = rtxDashData
  if (!pane || !r) return

  // preservar foco del buscador de pendientes
  const oldS = document.getElementById('dash-search')
  const hadFocus = oldS && document.activeElement === oldS
  const caret = oldS ? oldS.selectionStart : null

  const barra = `
    <div class="dash-fecha">
      <button class="dash-nav" onclick="rtxDashCambiarFecha(-1)">‹</button>
      <input type="date" class="dash-date" value="${rtxDashFecha}" onchange="rtxDashSetFecha(this.value)">
      <button class="dash-nav" onclick="rtxDashCambiarFecha(1)">›</button>
      <button class="dash-hoy" onclick="rtxDashHoy()">Hoy</button>
    </div>`
  const resumen = `
    <div class="dash-stats">
      <div class="dash-stat"><div class="dash-n green">L. ${rtxFmt(r.recaudado)}</div><div class="dash-l">Recaudado</div></div>
      <div class="dash-stat"><div class="dash-n blue">${r.depositos}</div><div class="dash-l">Depósitos</div></div>
      <div class="dash-stat"><div class="dash-n amber">${r.faltan}</div><div class="dash-l">Faltan</div></div>
    </div>`
  const desg = (r.desglose || []).map(d =>
    `<div class="dash-row"><span>${d.banco}</span><b>L. ${rtxFmt(d.monto)} <small>(${d.cantidad})</small></b></div>`).join('')
  const desglose = `<div class="dash-card"><div class="dash-card-t">Desglose por forma de pago</div>${desg || '<div class="rtx-empty">Sin depósitos aprobados.</div>'}</div>`

  // ── Pendientes con buscador + chips por caja ──
  const todos = r.pendientes || []
  // conteos por caja
  const cajas = {}
  let sinCaja = 0
  todos.forEach(p => { const c = p.caja; if (c) cajas[c] = (cajas[c] || 0) + 1; else sinCaja++ })
  const chipC = (val, label, n) => `<button class="rtx-chip ${rtxDashCaja === val ? 'on' : ''}" onclick="rtxDashChipCaja('${String(val).replace(/'/g, '')}')">${label} <b>${n}</b></button>`
  let chips = chipC('todas', 'Todas', todos.length)
  Object.keys(cajas).sort().forEach(c => { chips += chipC(c, c, cajas[c]) })
  if (sinCaja) chips += chipC('__sin__', 'Sin caja', sinCaja)
  const chipsHtml = `<div class="rtx-chips">${chips}</div>`
  const search = `<input id="dash-search" class="rtx-search" type="text" placeholder="Buscar por unidad o nombre…" value="${rtxDashBusqueda.replace(/"/g, '&quot;')}" oninput="rtxDashBuscar(this.value)" autocomplete="off">`

  // filtrar
  const q = rtxDashBusqueda.trim().toLowerCase()
  const filtrados = todos.filter(p => {
    if (rtxDashCaja === '__sin__') { if (p.caja) return false }
    else if (rtxDashCaja !== 'todas' && p.caja !== rtxDashCaja) return false
    if (q) {
      const hay = [p.unidad, p.nombre].some(x => String(x || '').toLowerCase().includes(q))
      if (!hay) return false
    }
    return true
  })
  // ── Motoristas pendientes: SOLO cuando la fecha seleccionada es hoy ──
  // (para días pasados no aplica; el indicador "días sin entregar" ya acumula eso)
  const esHoy = (rtxDashFecha === rtxHoy())
  let pendientes = ''
  if (esHoy) {
    const pend = filtrados.map(rtxDashPendiente).join('')
    pendientes = `<div class="dash-card">
      <div class="dash-card-t">Motoristas pendientes (${r.faltan})</div>
      ${search}${chipsHtml}
      ${pend || '<div class="rtx-empty">Sin resultados para este filtro.</div>'}
    </div>`
  }

  // ── Depósitos del día (entregas aprobadas, con chips por banco y orden por unidad) ──
  const deps = r.depositos_lista || []
  const dcajas = {}
  deps.forEach(d => { const b = d.banco || '—'; dcajas[b] = (dcajas[b] || 0) + 1 })
  const dChip = (val, label, n) => `<button class="rtx-chip ${rtxDepBanco === val ? 'on' : ''}" onclick="rtxDepChip('${String(val).replace(/'/g, '')}')">${label} <b>${n}</b></button>`
  let dchips = dChip('todas', 'Todas', deps.length)
  Object.keys(dcajas).sort().forEach(b => { dchips += dChip(b, b, dcajas[b]) })
  // filtrar por banco
  let dfilt = rtxDepBanco === 'todas' ? deps.slice() : deps.filter(d => (d.banco || '—') === rtxDepBanco)
  // ordenar
  if (rtxDepOrden === 'unidad') dfilt.sort((a, b) => (parseInt(a.unidad, 10) || 0) - (parseInt(b.unidad, 10) || 0))
  // subtotal del filtro
  const subTot = dfilt.reduce((s, d) => s + (parseFloat(d.monto) || 0), 0)
  const depRows = dfilt.map(d =>
    `<div class="dash-dep">
       <div class="dash-dep-top"><span><b>#${d.unidad}</b> · ${d.nombre || '—'}</span><span class="dash-dep-amt">L. ${rtxFmt(d.monto)}</span></div>
       <div class="dash-dep-sub">${d.banco} · ${d.hora || ''}</div>
     </div>`).join('')
  const ordenBtn = `<button class="dash-orden ${rtxDepOrden === 'unidad' ? 'on' : ''}" onclick="rtxDepToggleOrden()">${rtxDepOrden === 'unidad' ? '↕ Por unidad' : '↕ Ordenar por unidad'}</button>`
  const depositos = `<div class="dash-card">
    <div class="dash-card-t" style="display:flex;justify-content:space-between;align-items:center">
      <span>Depósitos del día</span>${ordenBtn}
    </div>
    <div class="rtx-chips">${dchips}</div>
    <div class="dash-subtotal">Subtotal: L. ${rtxFmt(subTot)} <small>(${dfilt.length})</small></div>
    ${depRows || '<div class="rtx-empty">Sin depósitos aprobados para esta fecha.</div>'}
  </div>`

  // ── Barra de auditoría (solo cuando la fecha es hoy) ──
  const auditBar = esHoy ? `
    <div class="dash-audit-bar">
      <button class="dash-audit-btn ${rtxDashAudit === 'no_entrego' ? 'on' : ''}" onclick="rtxDashAuditar('no_entrego')">🔎 Trabajó y no entregó</button>
      <button class="dash-audit-btn ${rtxDashAudit === 'no_cubrio' ? 'on' : ''}" onclick="rtxDashAuditar('no_cubrio')">💰 Entregó pero no cubrió</button>
      <span class="dash-audit-hint">Trabajó = recorrió más de ${RTX_KM_TRABAJO} km</span>
    </div>` : ''

  if (esHoy && rtxDashAudit) {
    pane.innerHTML = barra + resumen + auditBar + rtxDashAuditCard()
  } else {
    pane.innerHTML = barra + resumen + auditBar + desglose + pendientes + depositos
  }

  if (hadFocus) {
    const ne = document.getElementById('dash-search')
    if (ne) { ne.focus(); if (caret != null) { try { ne.setSelectionRange(caret, caret) } catch (e) {} } }
  }
}

window.rtxDashBuscar = (v) => { rtxDashBusqueda = v || ''; rtxDashPintar() }
window.rtxDashChipCaja = (v) => { rtxDashCaja = v; rtxDashPintar() }
window.rtxDepChip = (v) => { rtxDepBanco = v; rtxDashPintar() }
window.rtxDepToggleOrden = () => { rtxDepOrden = (rtxDepOrden === 'unidad') ? 'hora' : 'unidad'; rtxDashPintar() }

// ── Auditoría: cruza KM del día anterior con entregas ──
// "Trabajó" = recorrió > RTX_KM_TRABAJO km. "Ayer" = día de KM más reciente
// anterior a la fecha del dashboard (resuelve fines de semana automáticamente).
async function rtxDashDiaKM(antesDe) {
  try {
    const { data } = await rtxSb().rpc('tx_km_fechas')
    const fechas = (Array.isArray(data) ? data : []).filter(f => f < antesDe)
    fechas.sort()
    return fechas.length ? fechas[fechas.length - 1] : null
  } catch (e) { return null }
}
async function rtxDashKmMap(dia) {
  if (!dia) return {}
  try {
    const { data } = await rtxSb().rpc('tx_km_listar', { p_fecha: dia })
    const m = {}; (Array.isArray(data) ? data : []).forEach(k => { m[String(k.unidad)] = parseFloat(k.km) || 0 })
    return m
  } catch (e) { return {} }
}
window.rtxDashAuditar = async (modo) => {
  if (rtxDashAudit === modo) { rtxDashAudit = ''; rtxDashAuditData = null; rtxDashPintar(); return }  rtxDashAudit = modo; rtxDashAuditLoading = true; rtxDashAuditData = null; rtxDashPintar()
  try {
    const diaKM = await rtxDashDiaKM(rtxDashFecha)
    const kmMap = await rtxDashKmMap(diaKM)
    let lista = []
    if (modo === 'no_entrego') {
      lista = (rtxDashData?.pendientes || [])
        .map(p => ({ ...p, km: kmMap[String(p.unidad)] || 0 }))
        .filter(p => p.km > RTX_KM_TRABAJO)
        .sort((a, b) => b.km - a.km)
    } else if (modo === 'no_cubrio') {
      const { data } = await rtxSb().from('entregas_taxis')
        .select('unidad,identidad,nombre_conductor,monto,monto_esperado,saldo_deudor')
        .eq('fecha_deposito', rtxDashFecha).eq('estado', 'Aprobada')
      const byU = {}
      ;(data || []).forEach(e => {
        const u = String(e.unidad)
        if (!byU[u]) byU[u] = { unidad: e.unidad, identidad: e.identidad || '', nombre: e.nombre_conductor, monto: 0, esperado: 0, saldo: 0 }
        byU[u].monto += parseFloat(e.monto) || 0
        byU[u].esperado = Math.max(byU[u].esperado, parseFloat(e.monto_esperado) || 0)
        byU[u].saldo = parseFloat(e.saldo_deudor) || 0
      })
      lista = Object.values(byU)
        .map(x => {
          const periodo = Math.max((x.esperado || 0) - (x.saldo || 0), 0)  // cuota del período (sin saldo histórico)
          const faltante = periodo - x.monto                               // lo que sube su saldo este período
          return { ...x, km: kmMap[String(x.unidad)] || 0, periodo, faltante, saldoNuevo: (x.saldo || 0) + Math.max(faltante, 0) }
        })
        .filter(x => x.km > RTX_KM_TRABAJO && x.periodo > 0 && x.faltante > 0)
        .sort((a, b) => b.faltante - a.faltante)
      // teléfonos (para los botones de WhatsApp/Llamar), por unidad e identidad
      try {
        const unis = [...new Set(lista.map(x => x.unidad).filter(Boolean))]
        const idents = [...new Set(lista.map(x => x.identidad).filter(Boolean))]
        const telUni = {}, telId = {}
        if (unis.length) {
          const { data: du } = await rtxSb().from('tx_directorio').select('unidad, telefono').in('unidad', unis)
          ;(du || []).forEach(d => { if (d.telefono) telUni[String(d.unidad)] = d.telefono })
        }
        if (idents.length) {
          const { data: dm } = await rtxSb().from('tx_motoristas').select('identidad, telefono').in('identidad', idents)
          ;(dm || []).forEach(m => { if (m.telefono) telId[String(m.identidad)] = m.telefono })
        }
        lista.forEach(x => { x.telefono = telUni[String(x.unidad)] || telId[String(x.identidad)] || '' })
      } catch (e) { /* sin teléfono, los botones de WhatsApp/Llamar no aparecen */ }
    }
    rtxDashAuditData = { diaKM, lista }
  } catch (e) {
    rtxDashAuditData = { diaKM: null, lista: [], error: e.message || String(e) }
  }
  rtxDashAuditLoading = false
  rtxDashPintar()
}
window.rtxDashAuditCerrar = () => { rtxDashAudit = ''; rtxDashAuditData = null; rtxDashPintar() }

// Exporta la lista de auditoría actual a Excel (registro fijo para llamados de atención)
window.rtxDashAuditExportar = () => {
  if (typeof XLSX === 'undefined') { window.toast?.('No se pudo exportar (XLSX no disponible)', 'error'); return }
  const d = rtxDashAuditData
  if (!d || !Array.isArray(d.lista) || !d.lista.length) { window.toast?.('No hay datos para exportar', 'error'); return }
  const modo = rtxDashAudit
  const titulo = modo === 'no_cubrio' ? 'Entregó pero no cubrió' : 'Trabajó y no entregó'
  const gen = new Date().toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa' })
  const aoa = [
    ['CONTAMAX · Auditoría Taxis · ' + titulo],
    ['Fecha auditada:', rtxDashFecha],
    ['KM tomado del día:', d.diaKM || '—'],
    ['Generado:', gen],
    ['Total unidades:', d.lista.length],
    []
  ]
  if (modo === 'no_cubrio') {
    aoa.push(['Unidad', 'Motorista', 'KM recorridos', 'Cuota período', 'Pagó', 'Faltó (sube saldo)', 'Saldo antes', 'Saldo nuevo', 'Teléfono'])
    d.lista.forEach(x => aoa.push([
      x.unidad || '', x.nombre || '', Number(x.km) || 0,
      Number(x.periodo) || 0, Number(x.monto) || 0, Number(x.faltante) || 0,
      Number(x.saldo) || 0, Number(x.saldoNuevo) || 0, x.telefono || ''
    ]))
  } else {
    aoa.push(['Unidad', 'Motorista', 'KM recorridos', 'Saldo', 'Última entrega', 'Días sin entregar', 'Caja', 'Grupo', 'Teléfono'])
    d.lista.forEach(x => aoa.push([
      x.unidad || '', x.nombre || '', Number(x.km) || 0,
      Number(x.saldo) || 0, x.ultima_entrega || '', (x.dias_sin != null ? x.dias_sin : ''),
      x.caja || '', x.grupo || '', x.telefono || ''
    ]))
  }
  try {
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoría')
    XLSX.writeFile(wb, `Auditoria_${modo}_${rtxDashFecha}.xlsx`)
    window.toast?.('Exportado ✓', 'success')
  } catch (e) { window.toast?.('Error al exportar: ' + (e.message || e), 'error') }
}

// Guarda el snapshot en la base (consultable luego, con responsable y hora)
window.rtxDashAuditGuardar = async () => {
  const d = rtxDashAuditData
  if (!d || !Array.isArray(d.lista) || !d.lista.length) { window.toast?.('No hay datos para guardar', 'error'); return }
  const modo = rtxDashAudit
  const detalle = d.lista.map(x => modo === 'no_cubrio'
    ? { unidad: x.unidad, nombre: x.nombre, km: Number(x.km) || 0, periodo: Number(x.periodo) || 0, monto: Number(x.monto) || 0, faltante: Number(x.faltante) || 0, saldo: Number(x.saldo) || 0, saldoNuevo: Number(x.saldoNuevo) || 0, telefono: x.telefono || '' }
    : { unidad: x.unidad, nombre: x.nombre, km: Number(x.km) || 0, saldo: Number(x.saldo) || 0, ultima_entrega: x.ultima_entrega || '', dias_sin: (x.dias_sin != null ? x.dias_sin : ''), caja: x.caja || '', grupo: x.grupo || '', telefono: x.telefono || '' })
  try {
    const { data, error } = await rtxSb().rpc('tx_auditoria_guardar', {
      p_tipo: modo, p_fecha: rtxDashFecha, p_dia_km: d.diaKM || null, p_total: d.lista.length, p_detalle: detalle
    })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo guardar', 'error'); return }
    window.toast?.('Auditoría guardada ✓ · ' + (data.generado_nombre || ''), 'success')
  } catch (e) { window.toast?.('Error al guardar: ' + (e.message || e), 'error') }
}

// ── Visor de auditorías guardadas ──
function rtxAudEnsure() {
  if (document.getElementById('rtx-aud-overlay')) return
  const st = document.createElement('style')
  st.textContent = `
    .rtx-aud-ov{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px}
    .rtx-aud-ov.show{display:flex}
    .rtx-aud-modal{background:#15171c;border:1px solid #262a32;border-radius:14px;max-width:820px;width:100%;max-height:88vh;overflow:auto}
    .rtx-aud-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #262a32;position:sticky;top:0;background:#15171c}
    .rtx-aud-head h3{margin:0;font-size:15px}
    .rtx-aud-head button{background:none;border:none;color:#9aa0aa;font-size:18px;cursor:pointer}
    .rtx-aud-body{padding:14px 16px}
    .rtx-aud-row{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#0f1115;border:1px solid #262a32;border-radius:9px;padding:10px 12px;margin-bottom:8px}
    .rtx-aud-row .t{font-size:13px}
    .rtx-aud-row .m{font-size:11px;color:#8a8f98;margin-top:2px}
    .rtx-aud-tbl{width:100%;border-collapse:collapse;font-size:12px}
    .rtx-aud-tbl th,.rtx-aud-tbl td{border-bottom:1px solid #23262d;padding:6px 8px;text-align:left}
    .rtx-aud-tbl td.r,.rtx-aud-tbl th.r{text-align:right}
    .rtx-aud-load{padding:24px;text-align:center;color:#8a8f98}
    .rtx-aud-back{background:none;border:1px solid #2a2e37;color:#9aa0aa;border-radius:7px;padding:4px 10px;font-size:12px;cursor:pointer;margin-bottom:10px}`
  document.head.appendChild(st)
  const ov = document.createElement('div')
  ov.id = 'rtx-aud-overlay'; ov.className = 'rtx-aud-ov'
  ov.innerHTML = `<div class="rtx-aud-modal">
    <div class="rtx-aud-head"><h3 id="rtx-aud-title">Auditorías guardadas</h3><button onclick="rtxAudCerrar()">✕</button></div>
    <div id="rtx-aud-body" class="rtx-aud-body"></div>
  </div>`
  ov.addEventListener('click', e => { if (e.target === ov) window.rtxAudCerrar() })
  document.body.appendChild(ov)
}
window.rtxAudCerrar = () => document.getElementById('rtx-aud-overlay')?.classList.remove('show')

window.rtxAudGuardadas = async () => {
  rtxAudEnsure()
  const ov = document.getElementById('rtx-aud-overlay')
  const body = document.getElementById('rtx-aud-body')
  document.getElementById('rtx-aud-title').textContent = `Auditorías guardadas · ${rtxDashFecha}`
  body.innerHTML = '<div class="rtx-aud-load">Cargando…</div>'
  ov.classList.add('show')
  try {
    const { data, error } = await rtxSb().rpc('tx_auditoria_listar', { p_fecha: rtxDashFecha, p_tipo: null })
    if (error) throw error
    const lista = Array.isArray(data) ? data : []
    if (!lista.length) { body.innerHTML = '<div class="rtx-aud-load">No hay auditorías guardadas para esta fecha.<br>Generá una y tocá «💾 Guardar snapshot».</div>'; return }
    body.innerHTML = lista.map(a => {
      const tipoTxt = a.tipo === 'no_cubrio' ? '💰 Entregó pero no cubrió' : '🔎 Trabajó y no entregó'
      const hora = rtxFechaHora(a.created_at)
      return `<div class="rtx-aud-row">
        <div><div class="t"><b>${tipoTxt}</b> · ${a.total} unidades</div>
        <div class="m">Guardado: ${hora} · por ${a.generado_nombre || '—'}</div></div>
        <button class="rtx-b" onclick="rtxAudVer('${a.id}')">Ver</button>
      </div>`
    }).join('')
  } catch (e) { body.innerHTML = `<div class="rtx-aud-load">Error: ${e.message || e}</div>` }
}

window.rtxAudVer = async (id) => {
  const body = document.getElementById('rtx-aud-body')
  body.innerHTML = '<div class="rtx-aud-load">Cargando…</div>'
  try {
    const { data, error } = await rtxSb().rpc('tx_auditoria_detalle', { p_id: id })
    if (error) throw error
    if (!data?.ok) { body.innerHTML = `<div class="rtx-aud-load">${data?.error || 'Sin datos'}</div>`; return }
    const det = Array.isArray(data.detalle) ? data.detalle : []
    let head, filas
    if (data.tipo === 'no_cubrio') {
      head = '<tr><th>Unidad</th><th>Motorista</th><th class="r">KM</th><th class="r">Cuota período</th><th class="r">Pagó</th><th class="r">Faltó</th><th class="r">Saldo nuevo</th></tr>'
      filas = det.map(x => `<tr><td>#${x.unidad || ''}</td><td>${x.nombre || ''}</td><td class="r">${rtxFmt(x.km)}</td><td class="r">${rtxFmt(x.periodo)}</td><td class="r">${rtxFmt(x.monto)}</td><td class="r">${rtxFmt(x.faltante)}</td><td class="r">${rtxFmt(x.saldoNuevo)}</td></tr>`).join('')
    } else {
      head = '<tr><th>Unidad</th><th>Motorista</th><th class="r">KM</th><th class="r">Saldo</th><th>Última</th><th class="r">Días</th></tr>'
      filas = det.map(x => `<tr><td>#${x.unidad || ''}</td><td>${x.nombre || ''}</td><td class="r">${rtxFmt(x.km)}</td><td class="r">${rtxFmt(x.saldo)}</td><td>${x.ultima_entrega || '—'}</td><td class="r">${x.dias_sin != null && x.dias_sin !== '' ? x.dias_sin : '—'}</td></tr>`).join('')
    }
    const tipoTxt = data.tipo === 'no_cubrio' ? 'Entregó pero no cubrió' : 'Trabajó y no entregó'
    body.innerHTML = `
      <button class="rtx-aud-back" onclick="rtxAudGuardadas()">← Volver a la lista</button>
      <div class="m" style="font-size:12px;color:#8a8f98;margin-bottom:10px">${tipoTxt} · auditado ${data.fecha_auditada} · KM del ${data.dia_km || '—'} · guardado ${rtxFechaHora(data.created_at)} por ${data.generado_nombre || '—'}</div>
      <table class="rtx-aud-tbl"><thead>${head}</thead><tbody>${filas || ''}</tbody></table>`
  } catch (e) { body.innerHTML = `<div class="rtx-aud-load">Error: ${e.message || e}</div>` }
}
function rtxDashAuditCard() {
  if (rtxDashAuditLoading) return `<div class="dash-card"><div class="rtx-empty">Cargando auditoría…</div></div>`
  const d = rtxDashAuditData
  if (!d) return ''
  if (d.error) return `<div class="dash-card"><div class="rtx-empty">Error: ${d.error}</div></div>`
  const diaTxt = d.diaKM || 'sin KM previo'
  const volver = '<button class="rtx-b ghost dash-audit-volver" onclick="rtxDashAuditCerrar()">← Volver al dashboard</button>'
  const exportar = '<button class="rtx-b dash-audit-export" onclick="rtxDashAuditExportar()">📥 Exportar a Excel</button>'
  const guardar = '<button class="rtx-b dash-audit-save" onclick="rtxDashAuditGuardar()">💾 Guardar snapshot</button>'
  const guardadas = '<button class="rtx-b" onclick="rtxAudGuardadas()">🗂 Guardadas</button>'
  const barraAcc = `<div class="dash-audit-actions">${volver}${guardar}${exportar}${guardadas}</div>`
  const accPend = (p) => {
    const wa = p.telefono
      ? `<button class="rtx-b wa" onclick="rtxWa('${p.telefono}','${encodeURIComponent('Hola ' + (p.nombre || '') + ', te escribimos de Tecnimax para coordinar tu entrega. Gracias.')}')">💬 WhatsApp</button><a class="rtx-b call" href="tel:${p.telefono}">📞 Llamar</a>`
      : ''
    return `<button class="rtx-b ghost" onclick="rtxVer7dias('${p.identidad}','${p.unidad}','${rtxDashFecha}')">📅 7 días</button>${wa}`
  }
  if (rtxDashAudit === 'no_entrego') {
    const rows = d.lista.map(p => `
      <div class="dash-pend">
        <div class="dash-pend-top">
          <div class="dash-pend-id"><b>#${p.unidad}</b> · ${p.nombre || '—'}</div>
          <div class="dash-audit-km">${rtxFmt(p.km)} km</div>
        </div>
        <div class="dash-pend-sub">Última: ${p.ultima_entrega || '—'} · Saldo: L. ${rtxFmt(p.saldo)}${p.caja ? ' · Caja: ' + p.caja : ''}${p.grupo ? ' · Grupo ' + p.grupo : ''}</div>
        <div class="dash-pend-acc">${accPend(p)}</div>
      </div>`).join('')
    return `<div class="dash-card">
      ${barraAcc}
      <div class="dash-card-t">🔎 Trabajó y no entregó (${d.lista.length})</div>
      <div class="dash-audit-sub">Unidades que recorrieron más de ${RTX_KM_TRABAJO} km el ${diaTxt} y no han entregado el ${rtxDashFecha}.</div>
      ${rows || `<div class="rtx-empty">Nadie cumple: o ya entregaron, o no superaron los ${RTX_KM_TRABAJO} km.</div>`}
    </div>`
  }
  if (rtxDashAudit === 'no_cubrio') {
    const rows = d.lista.map(x => `
      <div class="dash-pend">
        <div class="dash-pend-top">
          <div class="dash-pend-id"><b>#${x.unidad}</b> · ${x.nombre || '—'}</div>
          <div class="dash-audit-km">${rtxFmt(x.km)} km</div>
        </div>
        <div class="dash-pend-sub">Cuota del período: L. ${rtxFmt(x.periodo)} · Pagó: L. ${rtxFmt(x.monto)} · <b class="dash-audit-falta">Faltó: L. ${rtxFmt(x.faltante)}</b></div>
        <div class="dash-pend-sub" style="margin-top:2px">Su saldo sube de L. ${rtxFmt(x.saldo)} a <b class="dash-audit-falta">L. ${rtxFmt(x.saldoNuevo)}</b> — cobrar L. ${rtxFmt(x.faltante)} para que no caiga a CxC</div>
        <div class="dash-pend-acc">${accPend(x)}</div>
      </div>`).join('')
    return `<div class="dash-card">
      ${barraAcc}
      <div class="dash-card-t">💰 Entregó pero no cubrió (${d.lista.length})</div>
      <div class="dash-audit-sub">Unidades que recorrieron más de ${RTX_KM_TRABAJO} km el ${diaTxt} y entregaron el ${rtxDashFecha}, pero pagaron menos que la cuota del período (reconciliación por km desde su última entrega, sin contar el saldo histórico).</div>
      ${rows || '<div class="rtx-empty">Nadie cumple el criterio.</div>'}
    </div>`
  }
  return ''
}

// ── Notas por motorista (con color por autor) ──
let rtxNotasOv = null
let rtxNotasCtx = { identidad: '', unidad: '', nombre: '' }
// Paleta de colores; el color se asigna de forma determinística por nombre de autor
const RTX_NOTA_COLORES = ['#ef4444', '#6366f1', '#22c55e', '#f0a500', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']
function rtxColorAutor(nombre) {
  let h = 0; const s = String(nombre || '?')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return RTX_NOTA_COLORES[h % RTX_NOTA_COLORES.length]
}

window.rtxNotasAbrir = (identidad, unidad, nombre) => {
  rtxNotasCtx = { identidad, unidad, nombre }
  const ov = document.createElement('div')
  ov.className = 'rtx-edit-ov show'
  ov.innerHTML = `
    <div class="rtx-edit-modal rtx-notas-modal">
      <h3>Notas · Unidad ${unidad}</h3>
      <div class="rtx-edit-sub">${nombre || ''}</div>
      <div id="rtx-notas-lista" class="rtx-notas-lista"><div class="rtx-empty">Cargando…</div></div>
      <textarea id="rtx-notas-input" class="rtx-notas-input" rows="2" placeholder="Escribí una nota (llamada, acuerdo, aviso…)"></textarea>
      <div class="rtx-edit-acts">
        <button class="rtx-b ghost" onclick="rtxNotasCerrar()">Cerrar</button>
        <button class="rtx-b ok" onclick="rtxNotasGuardar()">Agregar nota</button>
      </div>
    </div>`
  ov.onclick = (ev) => { if (ev.target === ov) rtxNotasCerrar() }
  document.body.appendChild(ov)
  rtxNotasOv = ov
  rtxNotasCargar()
}
window.rtxNotasCerrar = () => {
  if (rtxNotasOv) { rtxNotasOv.remove(); rtxNotasOv = null }
  // refrescar el dashboard para actualizar el conteo del botón
  if (document.getElementById('rtx-pane-dash') && !document.getElementById('rtx-pane-dash').classList.contains('hidden')) rtxRenderDashboard(true)
}
async function rtxNotasCargar() {
  const cont = document.getElementById('rtx-notas-lista')
  if (!cont) return
  try {
    const { data, error } = await rtxSb().rpc('tx_notas_listar', { p_identidad: rtxNotasCtx.identidad })
    if (error) throw error
    const notas = data || []
    if (!notas.length) { cont.innerHTML = '<div class="rtx-empty">Sin notas — será la primera gestión.</div>'; return }
    const esSuper = rtxEsSuper()
    cont.innerHTML = notas.map(n => {
      const color = rtxColorAutor(n.autor)
      const arch = esSuper ? `<button class="rtx-nota-arch" title="Archivar nota" onclick="rtxNotaArchivar('${n.id}')">📦</button>` : ''
      return `<div class="rtx-nota" style="border-left:3px solid ${color}">
        <div class="rtx-nota-top">
          <span class="rtx-nota-autor" style="background:${color}22;color:${color}">${n.autor}</span>
          <span class="rtx-nota-fecha">${n.fecha} ${n.hora}</span>${arch}
        </div>
        <div class="rtx-nota-txt">${(n.nota || '').replace(/</g, '&lt;')}</div>
      </div>`
    }).join('')
  } catch (e) { cont.innerHTML = '<div class="rtx-empty">Error: ' + (e.message || e) + '</div>' }
}
window.rtxNotasGuardar = async () => {
  const inp = document.getElementById('rtx-notas-input')
  const txt = (inp?.value || '').trim()
  if (!txt) { window.toast?.('Escribí la nota', 'error'); return }
  const btn = document.querySelector('.rtx-notas-modal .rtx-b.ok'); if (btn) { btn.disabled = true; btn.textContent = 'Guardando…' }
  try {
    const { data, error } = await rtxSb().rpc('tx_nota_agregar', { p_identidad: rtxNotasCtx.identidad, p_unidad: rtxNotasCtx.unidad, p_nota: txt })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo guardar', 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Agregar nota' } return }
    if (inp) inp.value = ''
    await rtxNotasCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Agregar nota' } }
}
window.rtxNotaArchivar = async (id) => {
  if (!confirm('¿Archivar esta nota? Quedará en el historial para consulta.')) return
  try {
    const { data, error } = await rtxSb().rpc('tx_nota_archivar', { p_nota_id: id })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo archivar', 'error'); return }
    await rtxNotasCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}

// ── Pestaña Motoristas (maestro) ──
let rtxMotData = []
let rtxMotBusqueda = ''
let rtxMotFiltro = 'activos'  // 'activos' | 'inactivos' | 'todos'
let rtxMotOrden = 'nombre'    // 'nombre' | 'saldo'

async function rtxMotCargar() {
  const pane = document.getElementById('rtx-pane-mot')
  if (!pane) return
  if (!rtxMotData.length) pane.innerHTML = '<div class="rtx-empty">Cargando…</div>'
  try {
    const { data, error } = await rtxSb().rpc('tx_motoristas_listar')
    if (error) throw error
    rtxMotData = data || []
    rtxMotPintar()
  } catch (e) { pane.innerHTML = '<div class="rtx-empty">Error: ' + (e.message || e) + '</div>' }
}

function rtxMotPintar() {
  const pane = document.getElementById('rtx-pane-mot')
  if (!pane) return
  const oldS = document.getElementById('rtx-mot-search')
  const hadFocus = oldS && document.activeElement === oldS
  const caret = oldS ? oldS.selectionStart : null

  const total = rtxMotData.length
  const nAct = rtxMotData.filter(m => m.activo).length
  const nInact = total - nAct
  const puedeAdmin = rtxMotAdmin()
  const chip = (val, label, n) => `<button class="rtx-chip ${rtxMotFiltro === val ? 'on' : ''}" onclick="rtxMotChip('${val}')">${label} <b>${n}</b></button>`
  const chips = `<div class="rtx-chips">${chip('activos', 'Activos', nAct)}${chip('inactivos', 'Inactivos', nInact)}${chip('todos', 'Todos', total)}</div>`
  const search = `<input id="rtx-mot-search" class="rtx-search" type="text" placeholder="Buscar por unidad, nombre o identidad…" value="${rtxMotBusqueda.replace(/"/g, '&quot;')}" oninput="rtxMotBuscar(this.value)" autocomplete="off">`
  const ordenBtn = `<button class="dash-orden ${rtxMotOrden === 'saldo' ? 'on' : ''}" onclick="rtxMotToggleOrden()">${rtxMotOrden === 'saldo' ? '↓ Por saldo adeudado' : '↕ Ordenar por saldo'}</button>`
  const addBtn = puedeAdmin ? `<button class="rtx-b ok" onclick="rtxMotAgregar()">+ Agregar motorista</button>` : ''
  const salidasBtn = `<button class="rtx-b" onclick="rtxSalidasGlobal()">🚪 Historial de salidas</button>`
  const cajasBtn = puedeAdmin ? `<button class="rtx-b" onclick="rtxCajasAdmin()">🔐 Cajas y PINs</button>` : ''
  const barra = `<div class="mot-barra">${ordenBtn}${salidasBtn}${cajasBtn}${addBtn}</div>`

  const q = rtxMotBusqueda.trim().toLowerCase()
  const lista = rtxMotData.filter(m => {
    if (rtxMotFiltro === 'activos' && !m.activo) return false
    if (rtxMotFiltro === 'inactivos' && m.activo) return false
    if (q) { const hay = [m.unidad, m.nombre, m.identidad].some(x => String(x || '').toLowerCase().includes(q)); if (!hay) return false }
    return true
  })
  if (rtxMotOrden === 'saldo') lista.sort((a, b) => (parseFloat(b.saldo) || 0) - (parseFloat(a.saldo) || 0))

  const rows = lista.map(m => {
    const nEsc = (m.nombre || '').replace(/'/g, '\\\'')
    const acciones = puedeAdmin ? `
      <div class="mot-acts">
        <button class="rtx-b edit" onclick="rtxMotEditar('${m.identidad}')">✏️ Editar</button>
        <button class="rtx-b" onclick="rtxHistorial('${m.identidad}')">📋 Estado de cuenta</button>
        <button class="rtx-b ${m.activo ? 'rec' : 'ok'}" onclick="rtxMotToggle('${m.identidad}', ${!m.activo})">${m.activo ? '⏸ Desactivar' : '▶ Activar'}</button>
      </div>` : ''
    return `<div class="mot-row ${m.activo ? '' : 'off'}">
      <div class="mot-top">
        <div class="mot-id"><b>#${m.unidad}</b> · ${m.nombre}</div>
        <span class="mot-estado ${m.activo ? 'on' : 'off'}">${m.activo ? 'Activo' : 'Inactivo'}</span>
      </div>
      <div class="mot-sub">Cédula: ${m.identidad} · Tarifa: L. ${rtxFmt(m.tarifa)} · Grupo ${m.grupo}${m.telefono ? ' · 📱 ' + m.telefono : ' · <span style="color:#d29922">sin teléfono</span>'} · Saldo: <b class="${m.saldo > 0 ? 'mot-debe' : ''}">L. ${rtxFmt(m.saldo)}</b></div>
      ${acciones}
    </div>`
  }).join('')

  pane.innerHTML = `${search}${chips}${barra}<div class="mot-lista">${rows || '<div class="rtx-empty">Sin resultados.</div>'}</div>`

  if (hadFocus) { const ne = document.getElementById('rtx-mot-search'); if (ne) { ne.focus(); if (caret != null) { try { ne.setSelectionRange(caret, caret) } catch (e) {} } } }
}

window.rtxMotBuscar = (v) => { rtxMotBusqueda = v || ''; rtxMotPintar() }
window.rtxMotChip = (v) => { rtxMotFiltro = v; rtxMotPintar() }
window.rtxMotToggleOrden = () => { rtxMotOrden = (rtxMotOrden === 'saldo') ? 'nombre' : 'saldo'; rtxMotPintar() }

window.rtxMotToggle = async (identidad, nuevoEstado) => {
  const m = rtxMotData.find(x => x.identidad === identidad)
  if (!m) return
  // Activar: simple. Desactivar: pedir motivo de salida y registrarlo en el historial.
  if (nuevoEstado) {
    if (!confirm(`¿Activar a ${m.nombre}?`)) return
    try {
      const { data, error } = await rtxSb().rpc('tx_motorista_toggle', { p_identidad: identidad, p_activo: true })
      if (error) throw error
      if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); return }
      m.activo = true; window.toast?.('Motorista activado', 'success'); rtxMotPintar()
    } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
    return
  }
  rtxSalidaModal(m)
}

// Modal de salida (motivo) al desactivar un motorista
let rtxSalidaOv = null
const RTX_MOTIVOS = ['Cambio de unidad', 'Voluntario', 'Accidente', 'Problemas personales', 'Deuda pendiente', 'Otro']
function rtxSalidaModal(m) {
  if (rtxSalidaOv) { rtxSalidaOv.remove(); rtxSalidaOv = null }
  const hoy = new Date().toLocaleDateString('en-CA')
  const ov = document.createElement('div')
  ov.className = 'rtx-7d-ov show'
  ov.innerHTML = `<div class="rtx-7d-modal" style="max-width:440px">
    <div class="rtx-7d-head"><h3 style="margin:0;font-size:15px">⏸ Desactivar motorista</h3>
      <button onclick="rtxSalidaCerrar()">✕</button></div>
    <div style="padding:16px 18px">
      <div style="font-weight:700">${m.nombre}</div>
      <div style="color:#8b8f98;font-size:12px;margin-bottom:14px">Cédula: ${m.identidad} · Saldo: L. ${rtxFmt(m.saldo)}</div>
      <label class="rtx-lbl">Fecha de salida</label>
      <input type="date" id="rtx-sal-fecha" value="${hoy}" class="rtx-inp">
      <label class="rtx-lbl">Motivo</label>
      <select id="rtx-sal-cat" class="rtx-inp">${RTX_MOTIVOS.map(c => `<option>${c}</option>`).join('')}</select>
      <label class="rtx-lbl">Detalle (opcional)</label>
      <textarea id="rtx-sal-detalle" class="rtx-inp" rows="2" placeholder="Ej: pasó al 6248 / chocó el carro / no debe tarifas"></textarea>
      <label class="rtx-lbl">Monto pendiente (se sugiere el saldo actual)</label>
      <input type="number" id="rtx-sal-monto" value="${(m.saldo || 0)}" step="0.01" class="rtx-inp">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button class="rtx-b ghost" onclick="rtxSalidaCerrar()">Cancelar</button>
        <button class="rtx-b rec" onclick="rtxSalidaGuardar('${m.identidad}')">Desactivar y registrar</button>
      </div>
    </div></div>`
  ov.onclick = (e) => { if (e.target === ov) rtxSalidaCerrar() }
  document.body.appendChild(ov); rtxSalidaOv = ov
}
window.rtxSalidaCerrar = () => { if (rtxSalidaOv) { rtxSalidaOv.remove(); rtxSalidaOv = null } }

// ── Historial global de salidas (todas) ──
let rtxSalGlobOv = null
let rtxSalGlobBusq = ''
let rtxSalGlobTimer = null
window.rtxSalidasGlobal = async () => {
  if (rtxSalGlobOv) { rtxSalGlobOv.remove(); rtxSalGlobOv = null }
  rtxSalGlobBusq = ''
  const ov = document.createElement('div')
  ov.className = 'rtx-7d-ov show'
  ov.innerHTML = `<div class="rtx-7d-modal" style="max-width:760px">
    <div class="rtx-7d-head"><h3 style="margin:0;font-size:15px">🚪 Historial de salidas</h3>
      <button onclick="rtxSalGlobCerrar()">✕</button></div>
    <div style="padding:14px 18px">
      <input id="rtx-salglob-search" class="rtx-inp" type="text" placeholder="Buscar por nombre, cédula o unidad…" oninput="rtxSalGlobBuscar(this.value)" autocomplete="off" style="margin-bottom:12px">
      <div id="rtx-salglob-body"><div style="color:#9aa0aa">Cargando…</div></div>
    </div></div>`
  ov.onclick = (e) => { if (e.target === ov) rtxSalGlobCerrar() }
  document.body.appendChild(ov); rtxSalGlobOv = ov
  rtxSalGlobCargar()
}
window.rtxSalGlobCerrar = () => { if (rtxSalGlobOv) { rtxSalGlobOv.remove(); rtxSalGlobOv = null } }
window.rtxSalGlobBuscar = (v) => {
  rtxSalGlobBusq = v
  clearTimeout(rtxSalGlobTimer)
  rtxSalGlobTimer = setTimeout(rtxSalGlobCargar, 300)
}
async function rtxSalGlobCargar() {
  const body = document.getElementById('rtx-salglob-body')
  if (!body) return
  try {
    const { data, error } = await rtxSb().rpc('tx_salidas_listar', { p_busqueda: rtxSalGlobBusq || null })
    if (error) throw error
    const arr = Array.isArray(data) ? data : []
    if (!arr.length) { body.innerHTML = '<div style="color:#8b8f98;padding:8px">Sin salidas registradas.</div>'; return }
    const rows = arr.map(s => `<tr>
      <td style="white-space:nowrap">${s.fecha_salida}</td>
      <td>${s.nombre || '—'}<div style="color:#8b8f98;font-size:11px">${s.identidad}</div></td>
      <td>${s.unidad ? '#' + s.unidad : '—'}</td>
      <td>${s.motivo || '—'}</td>
      <td style="text-align:right;white-space:nowrap">${s.monto_pendiente > 0 ? 'L. ' + rtxFmt(s.monto_pendiente) : '—'}</td>
    </tr>`).join('')
    body.innerHTML = `
      <table class="rtx-7d-tbl" style="width:100%">
        <thead><tr><th>Fecha</th><th>Motorista</th><th>Unidad</th><th>Motivo</th><th style="text-align:right">Pendiente</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="color:#8b8f98;font-size:11px;margin-top:8px">${arr.length} salida(s).</div>`
  } catch (e) {
    body.innerHTML = `<div style="color:#f0a500">Error: ${e.message || e}</div>`
  }
}

// ── Administración de cajas y PINs ──
let rtxCajasOv = null
window.rtxCajasAdmin = async () => {
  if (rtxCajasOv) { rtxCajasOv.remove(); rtxCajasOv = null }
  const ov = document.createElement('div')
  ov.className = 'rtx-7d-ov show'
  ov.innerHTML = `<div class="rtx-7d-modal" style="max-width:560px">
    <div class="rtx-7d-head"><h3 style="margin:0;font-size:15px">🔐 Cajas y PINs</h3>
      <button onclick="rtxCajasCerrar()">✕</button></div>
    <div style="padding:14px 18px" id="rtx-cajas-body"><div style="color:#9aa0aa">Cargando…</div></div></div>`
  ov.onclick = (e) => { if (e.target === ov) rtxCajasCerrar() }
  document.body.appendChild(ov); rtxCajasOv = ov
  rtxCajasCargar()
}
window.rtxCajasCerrar = () => { if (rtxCajasOv) { rtxCajasOv.remove(); rtxCajasOv = null } }

async function rtxCajasCargar() {
  const body = document.getElementById('rtx-cajas-body')
  if (!body) return
  try {
    const { data, error } = await rtxSb().rpc('tx_cajas_listar')
    if (error) throw error
    const arr = Array.isArray(data) ? data : []
    const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const rows = arr.map(c => `
      <div class="rtx-caja-row ${c.activo ? '' : 'off'}">
        <div><b>${c.nombre}</b>${c.activo ? '' : ' <span style="color:#8b8f98;font-size:11px">(inactiva)</span>'}</div>
        <div class="rtx-caja-acc">
          <button class="rtx-b" onclick="rtxCajaEditar('${c.id}','${esc(c.nombre)}')">✏️</button>
          <button class="rtx-b" onclick="rtxCajaPin('${c.id}','${esc(c.nombre)}')">🔑 PIN</button>
          <button class="rtx-b ${c.activo ? 'rec' : 'ok'}" onclick="rtxCajaToggle('${c.id}', ${!c.activo})">${c.activo ? '⏸' : '▶'}</button>
        </div>
      </div>`).join('')
    body.innerHTML = `
      <div style="margin-bottom:12px">${rows || '<div style="color:#8b8f98">Sin cajas. Agregá la primera abajo.</div>'}</div>
      <div style="border-top:1px solid #2a2e37;padding-top:12px">
        <div style="font-weight:600;font-size:13px;margin-bottom:8px">Agregar caja nueva</div>
        <label class="rtx-lbl">Nombre</label>
        <input id="rtx-caja-nombre" class="rtx-inp" placeholder="Ej: Caja Tecnimax" autocomplete="off">
        <label class="rtx-lbl">PIN (mínimo 4 dígitos)</label>
        <input id="rtx-caja-pin" class="rtx-inp" type="text" inputmode="numeric" placeholder="••••" autocomplete="off">
        <button class="rtx-b ok" style="margin-top:10px;width:100%" onclick="rtxCajaAgregar()">+ Agregar caja</button>
      </div>
      <div id="rtx-puntos-sec" style="border-top:2px solid #2a2e37;margin-top:16px;padding-top:14px">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">📍 Puntos de recolección</div>
        <div style="color:#8b8f98;font-size:11px;margin-bottom:10px">Banco = aparece a los motoristas para subir comprobante. Efectivo = solo a las cajas-PIN.</div>
        <div id="rtx-puntos-body"><div style="color:#9aa0aa">Cargando…</div></div>
      </div>`
    rtxPuntosCargar()
  } catch (e) { body.innerHTML = `<div style="color:#f0a500">Error: ${e.message || e}</div>` }
}

window.rtxCajaAgregar = async () => {
  const nombre = (document.getElementById('rtx-caja-nombre')?.value || '').trim()
  const pin = (document.getElementById('rtx-caja-pin')?.value || '').trim()
  if (!nombre) { window.toast?.('El nombre es obligatorio', 'error'); return }
  if (pin.length < 4) { window.toast?.('El PIN debe tener al menos 4 dígitos', 'error'); return }
  try {
    const { data, error } = await rtxSb().rpc('tx_caja_agregar', { p_nombre: nombre, p_pin: pin })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); return }
    window.toast?.('Caja agregada', 'success'); rtxCajasCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}
window.rtxCajaEditar = async (id, nombreActual) => {
  const nombre = prompt('Nuevo nombre de la caja:', nombreActual)
  if (nombre == null || !nombre.trim()) return
  try {
    const { data, error } = await rtxSb().rpc('tx_caja_editar', { p_id: id, p_nombre: nombre.trim() })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); return }
    window.toast?.('Caja actualizada', 'success'); rtxCajasCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}
window.rtxCajaPin = async (id, nombre) => {
  const pin = prompt(`Nuevo PIN para "${nombre}" (mínimo 4 dígitos):`, '')
  if (pin == null) return
  if (pin.trim().length < 4) { window.toast?.('El PIN debe tener al menos 4 dígitos', 'error'); return }
  try {
    const { data, error } = await rtxSb().rpc('tx_caja_cambiar_pin', { p_id: id, p_pin: pin.trim() })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); return }
    window.toast?.('PIN actualizado', 'success')
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}
window.rtxCajaToggle = async (id, activo) => {
  try {
    const { data, error } = await rtxSb().rpc('tx_caja_toggle', { p_id: id, p_activo: activo })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); return }
    window.toast?.(activo ? 'Caja activada' : 'Caja desactivada', 'success'); rtxCajasCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}

// ── Puntos de recolección (banco / efectivo) dentro del modal de cajas ──
// Cuentas de DETALLE de Caja y Bancos (1101xx) para los selectores. Se cachea.
let rtxCuentasCache = null
async function rtxCuentasCargar() {
  if (rtxCuentasCache) return rtxCuentasCache
  const { data, error } = await rtxSb().from('catalogo_cuentas')
    .select('codigo,nombre').eq('es_detalle', true).like('codigo', '1101%').order('codigo')
  if (error) throw error
  rtxCuentasCache = data || []
  return rtxCuentasCache
}
// Formatos de banco que el parser de conciliación soporta HOY (taxis).
const RTX_FORMATOS = ['BAC', 'Ficohsa']

async function rtxPuntosCargar() {
  const body = document.getElementById('rtx-puntos-body')
  if (!body) return
  try {
    const [res, cuentas] = await Promise.all([
      rtxSb().rpc('tx_puntos_listar'),
      rtxCuentasCargar()
    ])
    if (res.error) throw res.error
    const arr = Array.isArray(res.data) ? res.data : []
    const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const optCuentas = (sel) => ['<option value="">— sin cuenta —</option>']
      .concat(cuentas.map(c => `<option value="${c.codigo}" ${c.codigo === sel ? 'selected' : ''}>${c.codigo} · ${esc(c.nombre)}</option>`))
      .join('')
    const optFormatos = (sel) => ['<option value="">— sin formato —</option>']
      .concat(RTX_FORMATOS.map(f => `<option value="${f}" ${f === sel ? 'selected' : ''}>${f}</option>`))
      .join('')

    const rows = arr.map(p => {
      const esBanco = p.tipo === 'banco'
      const badge = esBanco
        ? '<span style="background:rgba(37,99,235,.18);color:#6ea8ff;border-radius:5px;padding:1px 7px;font-size:11px">🏦 Banco</span>'
        : '<span style="background:rgba(22,163,74,.18);color:#7ee2a0;border-radius:5px;padding:1px 7px;font-size:11px">💵 Efectivo</span>'
      const avisos = []
      if (esBanco && !p.formato) avisos.push('falta formato')
      if (!p.cuenta_contable) avisos.push('falta cuenta')
      const aviso = avisos.length ? `<span style="color:#f0a500;font-size:11px"> ⚠ ${avisos.join(' · ')}</span>` : ''
      const formatoRow = esBanco ? `
        <div class="rtx-punto-fld">
          <label class="rtx-punto-lbl">Formato (lector)</label>
          <select class="rtx-inp rtx-punto-sel" onchange="rtxPuntoSetFormato('${p.id}', this.value)">${optFormatos(p.formato)}</select>
        </div>` : ''
      return `<div class="rtx-caja-row rtx-punto ${p.activo ? '' : 'off'}">
        <div class="rtx-punto-head">
          <div><b>${p.nombre}</b> ${badge}${p.activo ? '' : ' <span style="color:#8b8f98;font-size:11px">(inactivo)</span>'}${aviso}</div>
          <div class="rtx-caja-acc">
            <button class="rtx-b" onclick="rtxPuntoEditar('${p.id}','${esc(p.nombre)}','${p.tipo}')">✏️</button>
            <button class="rtx-b ${p.activo ? 'rec' : 'ok'}" onclick="rtxPuntoToggle('${p.id}', ${!p.activo})">${p.activo ? '⏸' : '▶'}</button>
          </div>
        </div>
        <div class="rtx-punto-grid">
          ${formatoRow}
          <div class="rtx-punto-fld">
            <label class="rtx-punto-lbl">Cuenta contable</label>
            <select class="rtx-inp rtx-punto-sel" onchange="rtxPuntoSetCuenta('${p.id}', this.value)">${optCuentas(p.cuenta_contable)}</select>
          </div>
        </div>
      </div>`
    }).join('')

    body.innerHTML = `
      <div style="margin-bottom:12px">${rows || '<div style="color:#8b8f98">Sin puntos.</div>'}</div>
      <div style="border-top:1px solid #2a2e37;padding-top:12px">
        <div style="font-weight:600;font-size:13px;margin-bottom:8px">Agregar punto nuevo</div>
        <label class="rtx-lbl">Nombre</label>
        <input id="rtx-punto-nombre" class="rtx-inp" placeholder="Ej: BAC 72XXXXX / Caja Centro" autocomplete="off">
        <label class="rtx-lbl">Tipo</label>
        <select id="rtx-punto-tipo" class="rtx-inp">
          <option value="banco">🏦 Banco (aparece a los motoristas)</option>
          <option value="efectivo">💵 Efectivo (solo cajas-PIN)</option>
        </select>
        <button class="rtx-b ok" style="margin-top:10px;width:100%" onclick="rtxPuntoAgregar()">+ Agregar punto</button>
        <div style="color:#8b8f98;font-size:11px;margin-top:8px">Tras agregar un banco, asignale su <b>formato</b> y <b>cuenta</b> en la fila.</div>
      </div>`
    rtxPuntosEnsureStyles()
  } catch (e) { body.innerHTML = `<div style="color:#f0a500">Error: ${e.message || e}</div>` }
}

function rtxPuntosEnsureStyles() {
  if (document.getElementById('rtx-puntos-styles')) return
  const s = document.createElement('style'); s.id = 'rtx-puntos-styles'
  s.textContent = `
    .rtx-caja-row.rtx-punto{flex-direction:column;align-items:stretch}
    .rtx-punto-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
    .rtx-punto-grid{display:flex;gap:10px;margin-top:9px;flex-wrap:wrap}
    .rtx-punto-fld{flex:1;min-width:150px;display:flex;flex-direction:column;gap:4px}
    .rtx-punto-lbl{font-size:11px;color:#9aa0aa;text-transform:uppercase;letter-spacing:.04em}
    .rtx-punto-sel{padding:7px 9px;font-size:13px}`
  document.head.appendChild(s)
}

window.rtxPuntoAgregar = async () => {
  const nombre = (document.getElementById('rtx-punto-nombre')?.value || '').trim()
  const tipo = document.getElementById('rtx-punto-tipo')?.value || 'banco'
  if (!nombre) { window.toast?.('El nombre es obligatorio', 'error'); return }
  try {
    const { data, error } = await rtxSb().rpc('tx_punto_agregar', { p_nombre: nombre, p_tipo: tipo })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); return }
    window.toast?.(tipo === 'banco' ? 'Banco agregado · asigná formato y cuenta abajo' : 'Punto agregado', 'success')
    rtxPuntosCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}
window.rtxPuntoEditar = async (id, nombreActual, tipoActual) => {
  const nombre = prompt('Nombre del punto:', nombreActual)
  if (nombre == null || !nombre.trim()) return
  const tipo = confirm('¿Es de tipo BANCO? (Aceptar = Banco, Cancelar = Efectivo)') ? 'banco' : 'efectivo'
  try {
    const { data, error } = await rtxSb().rpc('tx_punto_editar', { p_id: id, p_nombre: nombre.trim(), p_tipo: tipo })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); return }
    window.toast?.('Punto actualizado', 'success'); rtxPuntosCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}
window.rtxPuntoToggle = async (id, activo) => {
  try {
    const { data, error } = await rtxSb().rpc('tx_punto_toggle', { p_id: id, p_activo: activo })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); return }
    window.toast?.(activo ? 'Punto activado' : 'Punto desactivado', 'success'); rtxPuntosCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}
window.rtxPuntoSetCuenta = async (id, cuenta) => {
  try {
    const { data, error } = await rtxSb().rpc('tx_punto_cuenta', { p_id: id, p_cuenta: cuenta || '' })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); rtxPuntosCargar(); return }
    window.toast?.(cuenta ? 'Cuenta asignada' : 'Cuenta quitada', 'success'); rtxPuntosCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error'); rtxPuntosCargar() }
}
window.rtxPuntoSetFormato = async (id, formato) => {
  try {
    const { data, error } = await rtxSb().rpc('tx_punto_formato', { p_id: id, p_formato: formato || '' })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); rtxPuntosCargar(); return }
    window.toast?.(formato ? 'Formato asignado' : 'Formato quitado', 'success'); rtxPuntosCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error'); rtxPuntosCargar() }
}
window.rtxSalidaGuardar = async (identidad) => {
  const m = rtxMotData.find(x => x.identidad === identidad)
  const fecha = document.getElementById('rtx-sal-fecha')?.value
  const cat = document.getElementById('rtx-sal-cat')?.value || 'Otro'
  const det = (document.getElementById('rtx-sal-detalle')?.value || '').trim()
  const monto = parseFloat(document.getElementById('rtx-sal-monto')?.value) || 0
  const motivo = det ? `${cat} — ${det}` : cat
  try {
    // 1) registrar la salida en el historial
    const r1 = await rtxSb().rpc('tx_salida_registrar', {
      p_identidad: identidad, p_unidad: null, p_fecha: fecha, p_motivo: motivo,
      p_dias_pendientes: null, p_monto_pendiente: monto
    })
    if (r1.error) throw r1.error
    if (!r1.data?.ok) { window.toast?.(r1.data?.error || 'No se pudo registrar la salida', 'error'); return }
    // 2) desactivar al motorista
    const r2 = await rtxSb().rpc('tx_motorista_toggle', { p_identidad: identidad, p_activo: false })
    if (r2.error) throw r2.error
    if (m) m.activo = false
    window.toast?.('Motorista desactivado y salida registrada', 'success')
    rtxSalidaCerrar(); rtxMotPintar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}

// ── Historial / estado de cuenta del motorista ──
let rtxHistOv = null
window.rtxHistorial = async (identidad) => {
  if (rtxHistOv) { rtxHistOv.remove(); rtxHistOv = null }
  const ov = document.createElement('div')
  ov.className = 'rtx-7d-ov show'
  ov.id = 'rtx-hist-overlay'
  ov.innerHTML = `<div class="rtx-7d-modal"><div class="rtx-7d-head">
      <h3 style="margin:0;font-size:15px">📋 Estado de cuenta</h3>
      <button onclick="rtxHistCerrar()">✕</button></div>
      <div id="rtx-hist-body" style="padding:14px 18px"><div style="color:#9aa0aa">Cargando…</div></div></div>`
  ov.onclick = (e) => { if (e.target === ov) rtxHistCerrar() }
  document.body.appendChild(ov)
  rtxHistOv = ov
  try {
    const { data, error } = await rtxSb().rpc('tx_historial_saldo', { p_identidad: identidad })
    if (error) throw error
    if (!data?.ok) { document.getElementById('rtx-hist-body').innerHTML = `<div style="color:#f0a500">${data?.error || 'No se pudo cargar'}</div>`; return }
    rtxHistPintar(data)
  } catch (e) {
    const b = document.getElementById('rtx-hist-body')
    if (b) b.innerHTML = `<div style="color:#f0a500">Error: ${e.message || e}</div>`
  }
}
window.rtxHistCerrar = () => { if (rtxHistOv) { rtxHistOv.remove(); rtxHistOv = null } }

function rtxHistPintar(data) {
  const movs = data.movimientos || []
  const saldoCls = data.saldo_actual > 0.01 ? 'color:#f0a500' : 'color:#3fb950'
  const head = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <div><div style="font-weight:700;font-size:15px">${data.nombre}</div>
        <div style="color:#8b8f98;font-size:12px">Cédula: ${data.identidad}</div></div>
      <div style="text-align:right"><div style="color:#8b8f98;font-size:11px;text-transform:uppercase">Saldo actual</div>
        <div style="font-weight:800;font-size:20px;${saldoCls}">L. ${rtxFmt(data.saldo_actual)}</div></div>
    </div>
    <div style="font-size:12px;color:#8b8f98;margin-bottom:10px">Cómo se movió el saldo: <span style="color:#fca5a5">cargo</span> = día que no pagó lo esperado (subió) · <span style="color:#7ee2a0">abono</span> = día que pagó de más o reconcilió (bajó).</div>`

  if (!movs.length) {
    document.getElementById('rtx-hist-body').innerHTML = head + '<div style="color:#8b8f98;padding:8px">Sin movimientos de saldo registrados.</div>'
    return
  }
  const rows = movs.map(m => {
    const esCargo = m.tipo === 'cargo'
    const signo = esCargo ? '+' : (m.tipo === 'abono' ? '−' : '')
    const col = esCargo ? '#fca5a5' : (m.tipo === 'abono' ? '#7ee2a0' : '#9aa0aa')
    const etq = esCargo ? 'Cargo' : (m.tipo === 'abono' ? 'Abono' : 'Ajuste')
    const nota = rtxHistNota(m.nota)
    return `<tr>
      <td style="white-space:nowrap">${m.fecha}</td>
      <td><span style="color:${col};font-weight:600">${etq}</span><div style="color:#8b8f98;font-size:11px">${nota}</div></td>
      <td style="text-align:right;color:${col};font-weight:600;white-space:nowrap">${signo} L. ${rtxFmt(m.monto)}</td>
      <td style="text-align:right;white-space:nowrap;font-family:ui-monospace,monospace">L. ${rtxFmt(m.saldo)}</td>
    </tr>`
  }).join('')
  document.getElementById('rtx-hist-body').innerHTML = head + `
    <table class="rtx-7d-tbl" style="width:100%">
      <thead><tr>
        <th>Fecha</th><th>Movimiento</th>
        <th style="text-align:right">Monto</th><th style="text-align:right">Saldo</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="color:#8b8f98;font-size:11px;margin-top:8px">Mostrando ${movs.length} movimiento(s), del más reciente al más antiguo.</div>
    <div id="rtx-hist-salidas" style="margin-top:16px"></div>`
  rtxCargarSalidas(data.identidad)
}

// Carga el historial de salidas del motorista y lo pinta debajo del saldo
async function rtxCargarSalidas(identidad) {
  const cont = document.getElementById('rtx-hist-salidas')
  if (!cont) return
  try {
    const { data, error } = await rtxSb().rpc('tx_salidas_motorista', { p_identidad: identidad })
    if (error || !Array.isArray(data) || !data.length) return
    const rows = data.map(s => `<tr>
      <td style="white-space:nowrap">${s.fecha_salida}</td>
      <td>${s.unidad ? '#' + s.unidad : '—'}</td>
      <td>${s.motivo || '—'}</td>
      <td style="text-align:right;white-space:nowrap">${s.monto_pendiente > 0 ? 'L. ' + rtxFmt(s.monto_pendiente) : '—'}</td>
    </tr>`).join('')
    cont.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:8px;color:#fca5a5">🚪 Historial de salidas (${data.length})</div>
      <table class="rtx-7d-tbl" style="width:100%">
        <thead><tr><th>Fecha</th><th>Unidad</th><th>Motivo</th><th style="text-align:right">Pendiente</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
  } catch { /* sin salidas */ }
}

// Traduce la nota técnica a algo legible
function rtxHistNota(nota) {
  const n = String(nota || '')
  if (n.startsWith('DiaEntrega excedente')) return 'Excedente del día (pagó de más)'
  if (n.startsWith('DiaEntrega')) return 'Esperado por km del día'
  if (n.startsWith('Reconciliacion')) return 'Reconciliación por km'
  if (/2da|segunda/i.test(n)) return 'Segunda entrega del día'
  return n || '—'
}

window.rtxMotEditar = (identidad) => {
  const m = rtxMotData.find(x => x.identidad === identidad)
  if (!m) return
  rtxMotModal({
    titulo: 'Editar motorista', sub: `Cédula: ${m.identidad}`,
    nombre: m.nombre, tarifa: m.tarifa, grupo: m.grupo, telefono: m.telefono || '', identReadonly: true, ident: m.identidad,
    onGuardar: 'rtxMotGuardarEdicion'
  })
}
window.rtxMotAgregar = () => {
  rtxMotModal({
    titulo: 'Agregar motorista', sub: 'La unidad se asigna con su primera entrega.',
    nombre: '', tarifa: 500, grupo: '1', telefono: '', identReadonly: false, ident: '',
    onGuardar: 'rtxMotGuardarNuevo'
  })
}

let rtxMotOv = null
function rtxMotModal(o) {
  const ov = document.createElement('div')
  ov.className = 'rtx-edit-ov show'
  const identFld = o.identReadonly
    ? `<input type="text" id="rtx-mot-ident" value="${o.ident}" disabled>`
    : `<input type="text" id="rtx-mot-ident" placeholder="Cédula (13 dígitos)" inputmode="numeric">`
  ov.innerHTML = `
    <div class="rtx-edit-modal">
      <h3>${o.titulo}</h3>
      <div class="rtx-edit-sub">${o.sub}</div>
      ${!o.identReadonly ? '<label>Cédula</label>' + identFld : ''}
      <label>Nombre</label>
      <input type="text" id="rtx-mot-nombre" value="${(o.nombre || '').replace(/"/g, '&quot;')}">
      <label>Tarifa base (L.)</label>
      <input type="number" id="rtx-mot-tarifa" value="${o.tarifa}" step="0.01" min="0" inputmode="decimal">
      <label>Grupo de WhatsApp (1-10)</label>
      <input type="number" id="rtx-mot-grupo" value="${o.grupo}" min="1" max="10" inputmode="numeric">
      <label>Teléfono (WhatsApp)</label>
      <input type="tel" id="rtx-mot-telefono" value="${(o.telefono || '').replace(/"/g, '&quot;')}" placeholder="Ej: 9988-7766" inputmode="tel">
      <div class="rtx-edit-acts">
        <button class="rtx-b ghost" onclick="rtxMotCerrar()">Cancelar</button>
        <button class="rtx-b ok" onclick="${o.onGuardar}('${o.ident}')">Guardar</button>
      </div>
    </div>`
  ov.onclick = (ev) => { if (ev.target === ov) rtxMotCerrar() }
  document.body.appendChild(ov)
  rtxMotOv = ov
}
window.rtxMotCerrar = () => { if (rtxMotOv) { rtxMotOv.remove(); rtxMotOv = null } }

function rtxMotLeerModal() {
  return {
    ident: (document.getElementById('rtx-mot-ident')?.value || '').trim(),
    nombre: (document.getElementById('rtx-mot-nombre')?.value || '').trim(),
    tarifa: parseFloat(document.getElementById('rtx-mot-tarifa')?.value),
    grupo: (document.getElementById('rtx-mot-grupo')?.value || '1').trim(),
    telefono: (document.getElementById('rtx-mot-telefono')?.value || '').trim()
  }
}
window.rtxMotGuardarEdicion = async (identidad) => {
  const f = rtxMotLeerModal()
  if (!f.nombre) { window.toast?.('El nombre es obligatorio', 'error'); return }
  if (!f.tarifa || f.tarifa <= 0) { window.toast?.('Tarifa inválida', 'error'); return }
  try {
    const { data, error } = await rtxSb().rpc('tx_motorista_editar', { p_identidad: identidad, p_nombre: f.nombre, p_tarifa: f.tarifa, p_grupo: f.grupo, p_telefono: f.telefono })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo editar', 'error'); return }
    window.toast?.('Motorista actualizado', 'success')
    rtxMotCerrar(); rtxMotCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}
window.rtxMotGuardarNuevo = async () => {
  const f = rtxMotLeerModal()
  if (!f.ident) { window.toast?.('La cédula es obligatoria', 'error'); return }
  if (!f.nombre) { window.toast?.('El nombre es obligatorio', 'error'); return }
  try {
    const { data, error } = await rtxSb().rpc('tx_motorista_agregar', { p_identidad: f.ident, p_nombre: f.nombre, p_tarifa: f.tarifa || 500, p_grupo: f.grupo, p_telefono: f.telefono })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo agregar', 'error'); return }
    window.toast?.('Motorista agregado', 'success')
    rtxMotCerrar(); rtxMotCargar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}

// ── WhatsApp: abre chat con el motorista y mensaje prellenado ──
function rtxWaUrl(tel, msg) {
  let n = String(tel || '').replace(/\D/g, '')
  if (n.length <= 8) n = '504' + n   // Honduras
  return 'https://wa.me/' + n + '?text=' + encodeURIComponent(msg)
}
window.rtxWa = (tel, msgEnc) => {
  if (!tel) { window.toast?.('Sin teléfono registrado', 'error'); return }
  let msg = msgEnc
  try { msg = decodeURIComponent(msgEnc) } catch (e) {}
  window.open(rtxWaUrl(tel, msg), '_blank')
}

// ════════════════════════════════════════════════════════════
// ── KM RECORRIDOS (GPS) · tabla km_diarios_taxis ─────────────
// Pestaña dentro de Revisión Taxis. Importa el Excel del GPS
// (Fecha_procesado · Vehiculo · kilometraje · Usuario) hacia km_diarios_taxis,
// muestra el HISTORIAL de esa tabla, permite ordenar (km/unidad/usuario),
// filtrar por unidad, por usuario, por km mayor/menor que, y validar cada
// unidad con una nota (por qué corrió / por qué no marcó).
// ════════════════════════════════════════════════════════════
let rtxKmFecha = ''
let rtxKmData = []              // filas del día (tx_km_listar)
let rtxKmSortCampo = 'unidad'   // 'unidad' | 'km' | 'usuario'
let rtxKmSortDir = 'asc'        // 'asc' | 'desc'
let rtxKmFUnidad = ''           // filtro de texto por unidad
let rtxKmFUsuario = ''          // filtro por usuario de GPS (chip)
let rtxKmOp = ''                // '' | 'gt' | 'lt'
let rtxKmUmbral = ''            // número para el filtro mayor/menor que
let rtxKmEditUnidad = null      // unidad cuya validación se está editando
const RTX_KM_NOMARCO = 5        // km por debajo de esto = "posible no marcó"

const rtxKmLocalDate = (d) => (d || new Date()).toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' })

// Crea la pestaña "KM recorridos" y su panel si no existen (sin tocar index.html)
function rtxKmEnsureTab() {
  if (document.getElementById('rtx-tab-km')) return
  const barra = document.querySelector('.rtx-tabs')
  const paneRef = document.getElementById('rtx-pane-sol')
    || document.getElementById('rtx-pane-dash')
    || document.getElementById('rtx-pane-mot')
  if (!barra || !paneRef) return  // estructura no encontrada → no romper nada
  const btn = document.createElement('button')
  btn.id = 'rtx-tab-km'; btn.className = 'rtx-tab'
  btn.textContent = '🛣️ KM recorridos'
  btn.onclick = () => rtxTab('km')
  barra.appendChild(btn)
  const pane = document.createElement('div')
  pane.id = 'rtx-pane-km'; pane.className = 'hidden'
  pane.innerHTML = '<div id="rtx-km-root"></div>'
  paneRef.parentNode.appendChild(pane)
}

// ════════════════════════════════════════════════════════════
// PESTAÑA HISTORIAL — buscar entregas por unidad y rango de fechas
// (equivalente al "Historial" del sistema viejo, leyendo entregas_taxis)
// ════════════════════════════════════════════════════════════
let rtxHistUnidad = ''
let rtxHistDesde = ''
let rtxHistHasta = ''
let rtxHistData = null

function rtxHistEnsureTab() {
  if (document.getElementById('rtx-tab-hist')) return
  const barra = document.querySelector('.rtx-tabs')
  const paneRef = document.getElementById('rtx-pane-sol') || document.getElementById('rtx-pane-dash') || document.getElementById('rtx-pane-mot')
  if (!barra || !paneRef) return
  const btn = document.createElement('button')
  btn.id = 'rtx-tab-hist'; btn.className = 'rtx-tab'
  btn.textContent = '📜 Historial'
  btn.onclick = () => rtxTab('hist')
  barra.appendChild(btn)
  const pane = document.createElement('div')
  pane.id = 'rtx-pane-hist'; pane.className = 'hidden'
  pane.innerHTML = '<div id="rtx-hist-root"></div>'
  paneRef.parentNode.appendChild(pane)
}

window.rtxHistAbrir = () => {
  rtxHistEnsureStyles()
  if (!rtxHistDesde) { const d = new Date(); d.setDate(d.getDate() - 30); rtxHistDesde = rtxKmLocalDate(d) }
  if (!rtxHistHasta) rtxHistHasta = rtxKmLocalDate()
  rtxHistRenderShell()
  if (rtxHistData) rtxHistPintar()
}

window.rtxHistSet = (campo, val) => {
  if (campo === 'unidad') rtxHistUnidad = val
  else if (campo === 'desde') rtxHistDesde = val
  else if (campo === 'hasta') rtxHistHasta = val
}

window.rtxHistBuscar = async () => {
  const cont = document.getElementById('rtx-hist-result')
  if (cont) cont.innerHTML = '<div class="rtx-hist-info">Buscando…</div>'
  try {
    const build = () => {
      let q = rtxSb().from('entregas_taxis').select('*')
      if (rtxHistDesde) q = q.gte('fecha_deposito', rtxHistDesde)
      if (rtxHistHasta) q = q.lte('fecha_deposito', rtxHistHasta)
      const uni = (rtxHistUnidad || '').trim()
      if (uni) q = q.eq('unidad', uni)
      return q.order('fecha_deposito', { ascending: false }).order('id')
    }
    const data = window._fetchAllPag ? await window._fetchAllPag(build) : ((await build()).data || [])
    rtxHistData = Array.isArray(data) ? data : []
    rtxHistPintar()
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="rtx-hist-info" style="color:#f0a500">Error: ${e.message || e}</div>`
  }
}

function rtxHistRenderShell() {
  const root = document.getElementById('rtx-hist-root')
  if (!root) return
  const escA = s => String(s == null ? '' : s).replace(/"/g, '&quot;')
  root.innerHTML = `
    <div class="rtx-hist-form">
      <div class="rtx-hist-field" style="flex:1;min-width:160px">
        <label>Número de unidad</label>
        <input id="rtx-hist-uni" class="rtx-inp" placeholder="Ej: 5400 (vacío = todas)" value="${escA(rtxHistUnidad)}" autocomplete="off"
               oninput="rtxHistSet('unidad', this.value)" onkeydown="if(event.key==='Enter')rtxHistBuscar()">
      </div>
      <div class="rtx-hist-field">
        <label>Fecha desde</label>
        <input id="rtx-hist-desde" type="date" class="rtx-inp" value="${escA(rtxHistDesde)}" onchange="rtxHistSet('desde', this.value)">
      </div>
      <div class="rtx-hist-field">
        <label>Fecha hasta</label>
        <input id="rtx-hist-hasta" type="date" class="rtx-inp" value="${escA(rtxHistHasta)}" onchange="rtxHistSet('hasta', this.value)">
      </div>
      <button class="rtx-b ok rtx-hist-go" onclick="rtxHistBuscar()">🔎 Filtrar</button>
    </div>
    <div id="rtx-hist-result"><div class="rtx-hist-info">Elegí unidad y fechas, luego tocá Filtrar.</div></div>`
}

function rtxHistPintar() {
  const cont = document.getElementById('rtx-hist-result')
  if (!cont) return
  const data = rtxHistData || []
  if (!data.length) { cont.innerHTML = '<div class="rtx-hist-info">No hay entregas para esa unidad y rango de fechas.</div>'; return }
  const total = data.reduce((s, e) => s + (parseFloat(e.monto) || 0), 0)
  const uni = (rtxHistUnidad || '').trim()
  const estClass = e => e.estado === 'Aprobada' ? 'ok' : (e.estado === 'Rechazada' ? 'bad' : 'pend')
  const cards = data.map(e => {
    const id = String(e.id)
    const origen = e.origen === 'caja' ? ('Caja' + (e.caja_nombre ? ' · ' + e.caja_nombre : '')) : 'Motorista'
    const esperado = parseFloat(e.monto_esperado) || 0
    const saldo = parseFloat(e.saldo_deudor) || 0
    const periodo = Math.max(esperado - saldo, 0)
    return `<div class="rtx-hist-card">
      <div class="rtx-hist-ctop">
        <div class="rtx-hist-name">${e.nombre_conductor || 'Motorista'} <span class="rtx-hist-uni2">#${e.unidad || '—'}</span></div>
        <div class="rtx-hist-monto">L. ${rtxFmt(e.monto)}</div>
      </div>
      <div class="rtx-hist-meta">${e.banco || '—'} · ${origen} · ${e.fecha_deposito || '—'}${e.hora_envio ? ' ' + e.hora_envio : ''} · <span class="rtx-hist-est ${estClass(e)}">${e.estado || '—'}</span></div>
      <div class="rtx-hist-meta">Esperado: L. ${rtxFmt(esperado)}${saldo ? ' · Saldo al registrar: L. ' + rtxFmt(saldo) : ''}</div>
      <button class="rtx-hist-toggle" onclick="rtxHistToggle('${id}')">📋 Ver desglose de saldo</button>
      <div id="rtx-hist-desg-${id}" class="rtx-hist-desg hidden">
        <div><span>Tarifa del día</span><b>L. ${rtxFmt(e.tarifa_dia)}</b></div>
        <div><span>Monto esperado</span><b>L. ${rtxFmt(esperado)}</b></div>
        <div><span>Saldo al registrar</span><b>L. ${rtxFmt(saldo)}</b></div>
        <div><span>Cuota del período (esperado − saldo)</span><b>L. ${rtxFmt(periodo)}</b></div>
        <div><span>Pagó</span><b>L. ${rtxFmt(e.monto)}</b></div>
        <div><span>Medio</span><b>${e.banco || '—'}</b></div>
        <div><span>Origen</span><b>${origen}</b></div>
        <div><span>Registrado</span><b>${rtxFechaHora(e.created_at)}</b></div>
      </div>
    </div>`
  }).join('')
  cont.innerHTML = `
    <div class="rtx-hist-stats">
      <div><b style="color:#3fb950">L. ${rtxFmt(total)}</b><span>Total</span></div>
      <div><b>${data.length}</b><span>Entregas</span></div>
      <div><b>${uni ? '#' + uni : 'Todas'}</b><span>Unidad</span></div>
    </div>
    ${cards}`
}

window.rtxHistToggle = (id) => {
  const el = document.getElementById('rtx-hist-desg-' + id)
  if (el) el.classList.toggle('hidden')
}

function rtxHistEnsureStyles() {
  if (document.getElementById('rtx-hist-styles')) return
  const st = document.createElement('style')
  st.id = 'rtx-hist-styles'
  st.textContent = `
    #rtx-hist-root{padding:4px 0}
    .rtx-hist-form{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;background:#15171c;border:1px solid #262a32;border-radius:12px;padding:14px;margin-bottom:14px}
    .rtx-hist-field{display:flex;flex-direction:column;gap:5px}
    .rtx-hist-field label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#8a8f98}
    .rtx-hist-form .rtx-inp{background:#0f1115;border:1px solid #2a2e37;color:#e6e6e6;border-radius:8px;padding:9px 11px;font-size:14px;min-width:150px}
    .rtx-hist-go{align-self:flex-end}
    .rtx-hist-info{padding:26px;text-align:center;color:#8a8f98}
    .rtx-hist-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px}
    .rtx-hist-stats>div{background:#15171c;border:1px solid #262a32;border-radius:12px;padding:14px;text-align:center}
    .rtx-hist-stats b{display:block;font-size:20px}
    .rtx-hist-stats span{font-size:11px;color:#8a8f98;text-transform:uppercase;letter-spacing:.5px}
    .rtx-hist-card{background:#15171c;border:1px solid #262a32;border-radius:12px;padding:13px 15px;margin-bottom:10px}
    .rtx-hist-ctop{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
    .rtx-hist-name{font-weight:600;font-size:14px}
    .rtx-hist-uni2{color:#f0a500;font-weight:600;font-size:12px}
    .rtx-hist-monto{font-weight:700;color:#3fb950;font-size:15px;white-space:nowrap}
    .rtx-hist-meta{font-size:12px;color:#9aa0aa;margin-top:4px}
    .rtx-hist-est{padding:1px 7px;border-radius:5px;font-size:11px}
    .rtx-hist-est.ok{background:rgba(63,185,80,.15);color:#3fb950}
    .rtx-hist-est.pend{background:rgba(240,165,0,.15);color:#f0a500}
    .rtx-hist-est.bad{background:rgba(248,113,113,.15);color:#f87171}
    .rtx-hist-toggle{margin-top:9px;background:rgba(99,102,241,.12);color:#a5b4fc;border:1px solid rgba(99,102,241,.3);border-radius:7px;padding:5px 10px;font-size:12px;cursor:pointer}
    .rtx-hist-desg{margin-top:9px;border-top:1px solid #262a32;padding-top:9px;display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}
    .rtx-hist-desg.hidden{display:none}
    .rtx-hist-desg>div{display:flex;justify-content:space-between;gap:10px;font-size:12px}
    .rtx-hist-desg span{color:#8a8f98}
    @media(max-width:560px){.rtx-hist-desg{grid-template-columns:1fr}}`
  document.head.appendChild(st)
}

window.rtxKmAbrir = async () => {
  rtxKmEnsureStyles()
  // arrancar en la fecha más reciente con datos (evita ver un día vacío)
  if (!rtxKmFecha) {
    try {
      const { data } = await rtxSb().rpc('tx_km_fechas')
      const fechas = Array.isArray(data) ? data : []
      rtxKmFecha = fechas[0] || rtxKmLocalDate()
    } catch (e) { rtxKmFecha = rtxKmLocalDate() }
  }
  await rtxKmCargar()
}

async function rtxKmCargar() {
  const root = document.getElementById('rtx-km-root')
  if (!root) return
  rtxKmRenderShell(true)
  try {
    const { data, error } = await rtxSb().rpc('tx_km_listar', { p_fecha: rtxKmFecha })
    if (error) throw error
    rtxKmData = Array.isArray(data) ? data : []
    rtxKmEditUnidad = null
    rtxKmRenderShell(false)
  } catch (e) {
    root.innerHTML = `<div style="color:#f0a500;padding:20px">Error: ${e.message || e}</div>`
  }
}

function rtxKmRenderShell(cargando) {
  const root = document.getElementById('rtx-km-root')
  if (!root) return
  const escA = s => String(s == null ? '' : s).replace(/"/g, '&quot;')

  root.innerHTML = `
    <div class="rtx-km-bar">
      <div class="rtx-km-fecha">
        <button class="rtx-b" onclick="rtxKmFechaNav(-1)">◀</button>
        <input type="date" id="rtx-km-fecha" class="rtx-inp" value="${rtxKmFecha}" onchange="rtxKmSetFecha(this.value)">
        <button class="rtx-b" onclick="rtxKmFechaNav(1)">▶</button>
        <button class="rtx-b" onclick="rtxKmHoy()">Hoy</button>
      </div>
      <label class="rtx-b ok rtx-km-import">
        ⬆️ Importar Excel GPS
        <input type="file" accept=".xls,.xlsx,.csv" style="display:none" onchange="rtxKmImportar(this.files[0]); this.value=''">
      </label>
    </div>
    <div class="rtx-km-filtros">
      <input id="rtx-km-funidad" class="rtx-inp rtx-km-fmini" placeholder="Filtrar por unidad…" value="${escA(rtxKmFUnidad)}" oninput="rtxKmSetFUnidad(this.value)" autocomplete="off">
      <select id="rtx-km-op" class="rtx-inp rtx-km-fmini" onchange="rtxKmSetOp(this.value)">
        <option value="" ${rtxKmOp === '' ? 'selected' : ''}>KM: sin filtro</option>
        <option value="gt" ${rtxKmOp === 'gt' ? 'selected' : ''}>KM mayor que</option>
        <option value="lt" ${rtxKmOp === 'lt' ? 'selected' : ''}>KM menor que</option>
      </select>
      <input id="rtx-km-umbral" type="number" step="0.001" class="rtx-inp rtx-km-fmini" placeholder="km" value="${escA(rtxKmUmbral)}" oninput="rtxKmSetUmbral(this.value)" ${rtxKmOp ? '' : 'disabled'}>
      <button class="rtx-b ghost" onclick="rtxKmLimpiar()">Limpiar filtros</button>
    </div>
    <div id="rtx-km-resumen"></div>
    <div id="rtx-km-body">${cargando ? '<div style="color:#9aa0aa;padding:20px">Cargando…</div>' : ''}</div>`
  if (!cargando) rtxKmRenderTabla()
}

function rtxKmFiltradas() {
  let rows = rtxKmData.slice()
  const fu = rtxKmFUnidad.trim()
  if (fu) rows = rows.filter(r => String(r.unidad).includes(fu))
  if (rtxKmFUsuario) rows = rows.filter(r => (r.usuario_gps || '(sin usuario)') === rtxKmFUsuario)
  const um = parseFloat(rtxKmUmbral)
  if (rtxKmOp && !isNaN(um)) {
    rows = rows.filter(r => rtxKmOp === 'gt' ? (parseFloat(r.km) > um) : (parseFloat(r.km) < um))
  }
  const dir = rtxKmSortDir === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    let va, vb
    if (rtxKmSortCampo === 'km') { va = parseFloat(a.km) || 0; vb = parseFloat(b.km) || 0 }
    else if (rtxKmSortCampo === 'usuario') { va = (a.usuario_gps || '').toLowerCase(); vb = (b.usuario_gps || '').toLowerCase() }
    else { va = Number(a.unidad); vb = Number(b.unidad); if (isNaN(va) || isNaN(vb)) { va = String(a.unidad); vb = String(b.unidad) } }
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })
  return rows
}

function rtxKmRenderTabla() {
  const body = document.getElementById('rtx-km-body')
  const res = document.getElementById('rtx-km-resumen')
  if (!body) return
  const escTxt = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escJ = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

  // ── Resumen del día ──
  const totUnidades = rtxKmData.length
  const totKm = rtxKmData.reduce((s, r) => s + (parseFloat(r.km) || 0), 0)
  const noMarcaron = rtxKmData.filter(r => (parseFloat(r.km) || 0) < RTX_KM_NOMARCO).length
  const validados = rtxKmData.filter(r => r.validado).length
  const porUsuario = {}
  rtxKmData.forEach(r => {
    const u = r.usuario_gps || '(sin usuario)'
    if (!porUsuario[u]) porUsuario[u] = { unidades: 0, km: 0 }
    porUsuario[u].unidades++; porUsuario[u].km += parseFloat(r.km) || 0
  })
  const chips = Object.entries(porUsuario).sort((a, b) => b[1].km - a[1].km).map(([u, v]) => {
    const on = rtxKmFUsuario === u ? ' on' : ''
    return `<span class="rtx-km-chip${on}" onclick="rtxKmFiltrarUsuario('${escJ(u)}')">${escTxt(u)} · ${v.unidades}u · ${rtxFmt(v.km)} km</span>`
  }).join('')
  if (res) {
    res.innerHTML = totUnidades ? `
      <div class="rtx-km-tot">
        <span><b>${totUnidades}</b> unidades</span>
        <span><b>${rtxFmt(totKm)}</b> km totales</span>
        <span class="warn"><b>${noMarcaron}</b> posible no marcó (&lt;${RTX_KM_NOMARCO} km)</span>
        <span class="ok"><b>${validados}</b> validados</span>
      </div>
      <div class="rtx-km-chips">${chips}</div>` : ''
  }

  // ── Tabla ──
  if (!rtxKmData.length) {
    body.innerHTML = `<div class="rtx-km-empty">No hay KM cargados para el ${rtxKmFecha}. Importá el Excel del GPS con el botón de arriba, o elegí una fecha del historial.</div>`
    return
  }
  const rows = rtxKmFiltradas()
  const arrow = (c) => rtxKmSortCampo === c ? (rtxKmSortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const cuerpo = rows.map(r => {
    const km = parseFloat(r.km) || 0
    const noMarco = km < RTX_KM_NOMARCO
    if (String(rtxKmEditUnidad) === String(r.unidad)) {
      return `<tr class="rtx-km-editrow"><td colspan="5">
        <div class="rtx-km-edit">
          <div class="rtx-km-edit-h"><b>Unidad ${escTxt(r.unidad)}</b> · ${rtxFmt(km)} km · ${escTxt(r.usuario_gps || '(sin usuario)')}</div>
          <textarea id="rtx-km-nota" class="rtx-inp" rows="2" placeholder="Por qué corrió / por qué no marcó (ej: GPS sin señal, taxi en taller, día libre…)">${escTxt(r.nota || '')}</textarea>
          <label class="rtx-km-chk"><input type="checkbox" id="rtx-km-val" ${r.validado ? 'checked' : ''}> Marcar como revisado / validado</label>
          <div class="rtx-km-edit-btns">
            <button class="rtx-b ok" onclick="rtxKmValidarGuardar('${escJ(r.unidad)}')">Guardar</button>
            <button class="rtx-b ghost" onclick="rtxKmValidarCerrar()">Cancelar</button>
          </div>
        </div></td></tr>`
    }
    const estado = r.validado
      ? '<span class="rtx-km-bdg ok">✓ Validado</span>'
      : (noMarco ? '<span class="rtx-km-bdg warn">⚠ posible no marcó</span>' : '<span class="rtx-km-bdg">pendiente</span>')
    const notaTxt = r.nota ? `<span class="rtx-km-nota">${escTxt(r.nota)}</span> ` : ''
    return `<tr class="${noMarco ? 'rtx-km-low' : ''}">
      <td><b>${escTxt(r.unidad)}</b></td>
      <td class="rtx-km-kmcell">${rtxFmt(km)}</td>
      <td>${r.usuario_gps ? escTxt(r.usuario_gps) : '<span style="color:#8b8f98">—</span>'}</td>
      <td>${estado}</td>
      <td>${notaTxt}<button class="rtx-b" onclick="rtxKmValidarAbrir('${escJ(r.unidad)}')">✏️ ${(r.validado || r.nota) ? 'Editar' : 'Validar'}</button></td>
    </tr>`
  }).join('')
  body.innerHTML = `
    <div class="rtx-km-count">${rows.length} de ${rtxKmData.length} unidades${(rtxKmFUnidad || rtxKmFUsuario || rtxKmOp) ? ' (filtrado)' : ''}</div>
    <table class="rtx-km-tbl">
      <thead><tr>
        <th class="sortable" onclick="rtxKmOrdenar('unidad')">Unidad${arrow('unidad')}</th>
        <th class="sortable" onclick="rtxKmOrdenar('km')">KM${arrow('km')}</th>
        <th class="sortable" onclick="rtxKmOrdenar('usuario')">Usuario GPS${arrow('usuario')}</th>
        <th>Estado</th>
        <th>Nota / validación</th>
      </tr></thead>
      <tbody>${cuerpo || '<tr><td colspan="5" class="rtx-km-empty">Ninguna unidad cumple el filtro.</td></tr>'}</tbody>
    </table>`
}

// ── Navegación de fecha ──
window.rtxKmSetFecha = (v) => { if (v) { rtxKmFecha = v; rtxKmCargar() } }
window.rtxKmFechaNav = (dir) => {
  const d = new Date(rtxKmFecha + 'T12:00:00'); d.setDate(d.getDate() + dir)
  rtxKmFecha = rtxKmLocalDate(d); rtxKmCargar()
}
window.rtxKmHoy = () => { rtxKmFecha = rtxKmLocalDate(); rtxKmCargar() }

// ── Filtros / orden ──
window.rtxKmSetFUnidad = (v) => { rtxKmFUnidad = v || ''; rtxKmRenderTabla() }
window.rtxKmSetOp = (v) => {
  rtxKmOp = v || ''
  const um = document.getElementById('rtx-km-umbral'); if (um) um.disabled = !rtxKmOp
  rtxKmRenderTabla()
}
window.rtxKmSetUmbral = (v) => { rtxKmUmbral = v || ''; rtxKmRenderTabla() }
window.rtxKmFiltrarUsuario = (u) => { rtxKmFUsuario = (rtxKmFUsuario === u) ? '' : u; rtxKmRenderTabla() }
window.rtxKmOrdenar = (campo) => {
  if (rtxKmSortCampo === campo) rtxKmSortDir = (rtxKmSortDir === 'asc' ? 'desc' : 'asc')
  else { rtxKmSortCampo = campo; rtxKmSortDir = (campo === 'km' ? 'desc' : 'asc') }
  rtxKmRenderTabla()
}
window.rtxKmLimpiar = () => {
  rtxKmFUnidad = ''; rtxKmFUsuario = ''; rtxKmOp = ''; rtxKmUmbral = ''
  rtxKmRenderShell(false)
}

// ── Validación inline (clave: fecha actual + unidad) ──
window.rtxKmValidarAbrir = (unidad) => { rtxKmEditUnidad = unidad; rtxKmRenderTabla() }
window.rtxKmValidarCerrar = () => { rtxKmEditUnidad = null; rtxKmRenderTabla() }
window.rtxKmValidarGuardar = async (unidad) => {
  const nota = document.getElementById('rtx-km-nota')?.value || ''
  const validado = !!document.getElementById('rtx-km-val')?.checked
  try {
    const { data, error } = await rtxSb().rpc('tx_km_validar', {
      p_fecha: rtxKmFecha, p_unidad: String(unidad), p_nota: nota, p_validado: validado
    })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo', 'error'); return }
    const row = rtxKmData.find(r => String(r.unidad) === String(unidad))
    if (row) { row.nota = nota.trim() || null; row.validado = validado }
    rtxKmEditUnidad = null
    window.toast?.('Validación guardada', 'success')
    rtxKmRenderTabla()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}

// ── Importar Excel del GPS → km_diarios_taxis ──
function rtxKmNormFecha(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) {  // celda de fecha: getters UTC (Excel guarda medianoche naïve)
    const y = v.getUTCFullYear(), m = String(v.getUTCMonth() + 1).padStart(2, '0'), d = String(v.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (m) {  // ambiguo dd/mm vs mm/dd: asumir dd/mm (Honduras), salvo que el primero > 12
    let a = +m[1], b = +m[2], y = m[3], dd, mm
    if (a > 12) { dd = a; mm = b } else if (b > 12) { mm = a; dd = b } else { dd = a; mm = b }
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  }
  return null
}
window.rtxKmImportar = async (file) => {
  if (!file) return
  if (typeof XLSX === 'undefined') { window.toast?.('No se pudo leer el Excel (XLSX no disponible)', 'error'); return }
  try {
    const ab = await file.arrayBuffer()
    const wb = XLSX.read(ab, { type: 'array', cellDates: true })
    const sh = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sh, { raw: false, defval: '' })
    if (!rows.length) { window.toast?.('El archivo no tiene filas', 'error'); return }
    const pick = (obj, names) => {
      for (const k of Object.keys(obj)) {
        const kn = k.toString().trim().toLowerCase()
        if (names.includes(kn)) return obj[k]
      }
      return ''
    }
    const filas = []
    for (const r of rows) {
      const fecha = rtxKmNormFecha(pick(r, ['fecha_procesado', 'fecha']))
      const unidad = String(pick(r, ['vehiculo', 'vehículo', 'unidad'])).trim()
      const kmRaw = String(pick(r, ['kilometraje', 'km'])).replace(/,/g, '.').replace(/[^\d.\-]/g, '')
      const km = parseFloat(kmRaw) || 0
      const usuario = String(pick(r, ['usuario', 'usuario_gps'])).trim()
      if (!fecha || !unidad) continue
      filas.push({ fecha, unidad, km, usuario })
    }
    if (!filas.length) { window.toast?.('No se reconocieron filas válidas (revisá las columnas Fecha_procesado, Vehiculo, kilometraje, Usuario)', 'error'); return }
    const { data, error } = await rtxSb().rpc('tx_km_importar', { p_filas: filas })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'No se pudo importar', 'error'); return }
    window.toast?.(`Importadas ${data.insertadas} · actualizadas ${data.actualizadas}`, 'success')
    const fechaArchivo = filas[0].fecha
    if (fechaArchivo) rtxKmFecha = fechaArchivo
    rtxKmCargar()
  } catch (e) { window.toast?.('Error al importar: ' + (e.message || e), 'error') }
}

function rtxKmEnsureStyles() {
  if (document.getElementById('rtx-km-styles')) return
  const s = document.createElement('style'); s.id = 'rtx-km-styles'
  s.textContent = `
    .rtx-km-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:10px}
    .rtx-km-fecha{display:flex;gap:6px;align-items:center}
    .rtx-km-fecha .rtx-inp{width:auto}
    .rtx-km-import{cursor:pointer;display:inline-flex;align-items:center}
    .rtx-km-filtros{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
    .rtx-km-fmini{width:auto;min-width:120px}
    .rtx-km-tot{display:flex;flex-wrap:wrap;gap:16px;font-size:13px;color:#cfd3da;margin-bottom:8px}
    .rtx-km-tot .warn{color:#f0a500}.rtx-km-tot .ok{color:#7ee2a0}
    .rtx-km-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
    .rtx-km-chip{background:#1a1d24;border:1px solid #2a2e37;border-radius:20px;padding:3px 11px;font-size:12px;color:#cfd3da;cursor:pointer}
    .rtx-km-chip:hover{border-color:#4a90e2}
    .rtx-km-chip.on{background:#2563eb;border-color:#2563eb;color:#fff}
    .rtx-km-count{font-size:12px;color:#8b8f98;margin-bottom:6px}
    .rtx-km-tbl{width:100%;border-collapse:collapse;font-size:14px}
    .rtx-km-tbl th,.rtx-km-tbl td{padding:8px 10px;border-bottom:1px solid #23262e;text-align:left}
    .rtx-km-tbl th{color:#9aa0aa;font-size:12px;text-transform:uppercase;letter-spacing:.03em;font-weight:600}
    .rtx-km-tbl th.sortable{cursor:pointer;user-select:none}
    .rtx-km-tbl th.sortable:hover{color:#cfd3da}
    .rtx-km-tbl tr.rtx-km-low td{background:rgba(240,165,0,.06)}
    .rtx-km-kmcell{font-variant-numeric:tabular-nums}
    .rtx-km-bdg{font-size:11px;padding:2px 8px;border-radius:6px;background:#23262e;color:#9aa0aa}
    .rtx-km-bdg.ok{background:rgba(22,163,74,.18);color:#7ee2a0}
    .rtx-km-bdg.warn{background:rgba(240,165,0,.16);color:#f0a500}
    .rtx-km-nota{font-size:12px;color:#9aa0aa;font-style:italic}
    .rtx-km-empty{color:#8b8f98;padding:24px;text-align:center}
    .rtx-km-edit{background:#15171c;border:1px solid #2a2e37;border-radius:9px;padding:12px}
    .rtx-km-edit-h{margin-bottom:8px;font-size:13px}
    .rtx-km-chk{display:flex;gap:7px;align-items:center;font-size:13px;margin-top:8px;color:#cfd3da}
    .rtx-km-edit-btns{display:flex;gap:8px;margin-top:10px}`
  document.head.appendChild(s)
}