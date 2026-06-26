// ── CONTAMAX · Revisión de entregas de Taxis (Fase 2 · alcance A: solo revisión) ──
// Lista las entregas que entran por el formulario público (origen motorista/caja),
// muestra su comprobante y permite Aprobar / Rechazar. Rechazar revierte el saldo.
// Eliminar (duplicados) usa el PIN de 'super' del módulo taxis.
// Depende de: window._sb, window.toast
// NO toca la contabilidad — las partidas se siguen generando en "Partidas Taxis".

const rtxSb = () => window._sb
const rtxFmt = n => (parseFloat(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
let rtxEntregas = []

window.initRevisionTaxis = async () => {
  const hoy = new Date()
  const hace7 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 7)
  const fi = document.getElementById('rtx-desde'); if (fi && !fi.value) fi.value = hace7.toISOString().split('T')[0]
  const ff = document.getElementById('rtx-hasta'); if (ff && !ff.value) ff.value = hoy.toISOString().split('T')[0]
  if (rtxEntregas.length) rtxRender(); else rtxConsultar()
}

window.rtxConsultar = async () => {
  const desde = document.getElementById('rtx-desde').value
  const hasta = document.getElementById('rtx-hasta').value
  const estado = document.getElementById('rtx-estado').value
  const origen = document.getElementById('rtx-origen').value
  const unidad = (document.getElementById('rtx-unidad').value || '').trim()
  if (!desde || !hasta) { window.toast?.('Seleccioná el rango de fechas', 'error'); return }

  const btn = document.getElementById('rtx-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Consultando…' }
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
    rtxRender()
  } catch (e) {
    window.toast?.('Error: ' + (e.message || e), 'error')
  } finally { if (btn) { btn.disabled = false; btn.innerHTML = 'Consultar &rarr;' } }
}

function rtxRender() {
  const cont = document.getElementById('rtx-resultado')
  if (!cont) return
  cont.classList.remove('hidden')
  if (!rtxEntregas.length) { cont.innerHTML = '<div class="rtx-empty">No hay entregas con esos filtros.</div>'; return }

  // Resumen por estado
  const por = { Pendiente: { n: 0, t: 0 }, Aprobada: { n: 0, t: 0 }, Rechazada: { n: 0, t: 0 } }
  rtxEntregas.forEach(e => { const k = e.estado || 'Pendiente'; (por[k] = por[k] || { n: 0, t: 0 }); por[k].n++; por[k].t += parseFloat(e.monto) || 0 })
  const resumen = `
    <div class="rtx-stats">
      <div class="rtx-stat pend"><div class="rtx-stat-n">${por.Pendiente.n}</div><div class="rtx-stat-l">Pendientes · L. ${rtxFmt(por.Pendiente.t)}</div></div>
      <div class="rtx-stat apr"><div class="rtx-stat-n">${por.Aprobada.n}</div><div class="rtx-stat-l">Aprobadas · L. ${rtxFmt(por.Aprobada.t)}</div></div>
      <div class="rtx-stat rec"><div class="rtx-stat-n">${por.Rechazada.n}</div><div class="rtx-stat-l">Rechazadas · L. ${rtxFmt(por.Rechazada.t)}</div></div>
    </div>`

  const badge = est => {
    const c = est === 'Aprobada' ? 'apr' : est === 'Rechazada' ? 'rec' : 'pend'
    return `<span class="rtx-badge ${c}">${est || 'Pendiente'}</span>`
  }
  const cards = rtxEntregas.map(e => {
    const est = e.estado || 'Pendiente'
    const foto = e.imagen_url
      ? `<img class="rtx-thumb" src="${e.imagen_url}" onclick="rtxVerComprobante('${e.imagen_url}')" alt="comprobante">`
      : `<div class="rtx-thumb rtx-nofoto">sin foto</div>`
    const acciones = est === 'Pendiente'
      ? `<button class="rtx-b apr" onclick="rtxAprobar('${e.id}')">✓ Aprobar</button>
         <button class="rtx-b rec" onclick="rtxRechazar('${e.id}')">✕ Rechazar</button>`
      : `<button class="rtx-b ghost" onclick="rtxRechazar('${e.id}')" ${est === 'Rechazada' ? 'disabled' : ''}>Rechazar</button>`
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
            ${acciones}
            <button class="rtx-b del" onclick="rtxEliminar('${e.id}')">🗑 Eliminar</button>
          </div>
        </div>
      </div>`
  }).join('')

  cont.innerHTML = resumen + `<div class="rtx-list">${cards}</div>`
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