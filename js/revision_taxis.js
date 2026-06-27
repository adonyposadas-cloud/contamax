// ── CONTAMAX · Revisión de entregas de Taxis (Fase 2 · alcance A: solo revisión) ──
// Lista las entregas que entran por el formulario público (origen motorista/caja),
// muestra su comprobante y permite Aprobar / Rechazar. Rechazar revierte el saldo.
// Eliminar (duplicados) usa el PIN de 'super' del módulo taxis.
// Depende de: window._sb, window.toast
// NO toca la contabilidad — las partidas se siguen generando en "Partidas Taxis".

const rtxSb = () => window._sb
const rtxFmt = n => (parseFloat(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
let rtxEntregas = []
let rtxTelIdent = {}   // identidad → teléfono (tx_motoristas)
let rtxTelUni = {}     // unidad → teléfono (tx_directorio)
let rtxFBusqueda = ''  // texto de búsqueda (unidad/nombre/identidad)
let rtxFEstado = 'todas'
let rtxFMedio = 'todas'

// Resuelve el teléfono de una entrega con prioridad: entrega → motorista → directorio
function rtxTelefono(e) {
  const t = (e.telefono || '').toString().trim()
  if (t) return t
  return rtxTelIdent[e.identidad] || rtxTelUni[e.unidad] || ''
}

window.initRevisionTaxis = async () => {
  rtx7dEnsure()   // inyecta estilos (botones WhatsApp + modal 7 días)
  const hoy = new Date()
  const hace7 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 7)
  const fi = document.getElementById('rtx-desde'); if (fi && !fi.value) fi.value = hace7.toISOString().split('T')[0]
  const ff = document.getElementById('rtx-hasta'); if (ff && !ff.value) ff.value = hoy.toISOString().split('T')[0]
  if (rtxEntregas.length) rtxRender(); else rtxConsultar()
  rtxStartAuto()
}

window.rtxConsultar = async (silent = false) => {
  const desde = document.getElementById('rtx-desde').value
  const hasta = document.getElementById('rtx-hasta').value
  const estado = document.getElementById('rtx-estado').value
  const origen = document.getElementById('rtx-origen').value
  const unidad = (document.getElementById('rtx-unidad').value || '').trim()
  if (!desde || !hasta) { if (!silent) window.toast?.('Seleccioná el rango de fechas', 'error'); return }

  const btn = document.getElementById('rtx-btn'); if (btn && !silent) { btn.disabled = true; btn.textContent = 'Consultando…' }
  try {
    let q = rtxSb().from('entregas_taxis').select('*')
      .gte('fecha_deposito', desde).lte('fecha_deposito', hasta)
      .in('origen', ['motorista', 'caja'])
      .order('created_at', { ascending: false })
    if (estado) q = q.eq('estado', estado)
    if (origen) q = q.eq('origen', origen)
    if (unidad) q = q.eq('unidad', unidad)
    const { data, error } = await q
    if (error) throw error
    rtxEntregas = data || []
    await rtxCargarTelefonos()
    rtxRender()
  } catch (e) {
    if (!silent) window.toast?.('Error: ' + (e.message || e), 'error')
  } finally { if (btn && !silent) { btn.disabled = false; btn.innerHTML = 'Consultar &rarr;' } }
}

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
    rtxConsultar(true)                                                     // refresco silencioso
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
      <div class="rtx-stat pend"><div class="rtx-stat-n">${por.Pendiente.n}</div><div class="rtx-stat-l">Pendientes · L. ${rtxFmt(por.Pendiente.t)}</div></div>
      <div class="rtx-stat apr"><div class="rtx-stat-n">${por.Aprobada.n}</div><div class="rtx-stat-l">Aprobadas · L. ${rtxFmt(por.Aprobada.t)}</div></div>
      <div class="rtx-stat rec"><div class="rtx-stat-n">${por.Rechazada.n}</div><div class="rtx-stat-l">Rechazadas · L. ${rtxFmt(por.Rechazada.t)}</div></div>
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
            <div><span>Origen</span><b>${e.origen || '—'}</b></div>
          </div>
          <div class="rtx-acts">
            <button class="rtx-b ghost" onclick="rtxVer7dias('${e.identidad}','${e.unidad}','${e.fecha_deposito}')">📅 7 días</button>
            ${acciones}
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