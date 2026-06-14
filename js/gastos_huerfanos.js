// ── CONTAMAX · Gastos huérfanos de taxis FINANCIADOS ──
// Líneas de gasto (débito) en centro Taxis, con prefijo de unidad, en partidas
// aprobadas, NO cobradas en recibo (usado_en_recibo falso), cuyo número SÍ está
// en financiamiento (prestamos_taxis). Se excluyen los no financiados (taxis
// propios → su gasto es costo de la empresa).
// Drill-down: resumen por unidad → líneas → click lleva a la partida.
// Depende de: window._sb, window.toast, window.editarPartida

const ghSb = () => window._sb
const ghFmt = n => (parseFloat(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let ghHuerfanos = []   // líneas huérfanas ya cruzadas con financiamiento
let ghResumen = []     // [{codigo, motorista, categoria, n, total, lineas:[]}]
let ghUnidadAbierta = null
let ghFiltroTexto = ''
let ghFiltroFocus = false

window.initGastosHuerfanos = async () => {
  const hoy = new Date()
  const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1)
  const fi = document.getElementById('gh-fecha-ini'); if (fi && !fi.value) fi.value = ini.toISOString().split('T')[0]
  const ff = document.getElementById('gh-fecha-fin'); if (ff && !ff.value) ff.value = hoy.toISOString().split('T')[0]
  // Si ya hay una consulta cargada (p.ej. al volver desde una partida), re-mostrarla
  if (ghResumen.length) {
    ghRender()
    document.getElementById('gh-resultado')?.classList.remove('hidden')
  } else {
    document.getElementById('gh-resultado')?.classList.add('hidden')
  }
}

// Extrae el número de unidad de una descripción (T_, TAXI, VIP, con/sin ceros)
function ghExtraerUnidad(desc) {
  const m = String(desc || '').toUpperCase().match(/(?:TAXI[ _]VIP[ _]|TAXI[ _]|VIP[ _]|T_)0*(\d+)/)
  return m ? m[1] : null
}
const ghSinCeros = s => String(s || '').replace(/^0+/, '')

window.ghConsultar = async () => {
  const desde = document.getElementById('gh-fecha-ini').value
  const hasta = document.getElementById('gh-fecha-fin').value
  const btn = document.getElementById('gh-btn-consultar')
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando…' }

  // 1) Préstamos activos (financiados) → set de números sin ceros
  const { data: prestamos, error: pErr } = await ghSb().from('prestamos_taxis')
    .select('codigo, motorista, categoria').eq('activo', true)
  if (pErr) { if (btn) { btn.disabled = false; btn.textContent = 'Consultar →' } ; window.toast?.('Error préstamos: ' + pErr.message, 'error'); return }
  const mapPrestamo = {}
  for (const p of (prestamos || [])) mapPrestamo[ghSinCeros(p.codigo)] = p

  // 2) Líneas de gasto con prefijo de taxi, no cobradas (buscar por patrón → barato)
  const patrones = ['%T\\_%', '%TAXI %', '%TAXI\\_%', '%VIP %', '%VIP\\_%']
  let crudas = []
  for (const pat of patrones) {
    const { data } = await ghSb().from('lineas_partida')
      .select('id, descripcion, monto, tipo, cuenta_codigo, centro_costo_id, usado_en_recibo, partida_id, centro:centros_costo(nombre), partida:partidas_contables(id, numero_partida, fecha_partida, estado)')
      .eq('tipo', 'debito')
      .ilike('descripcion', pat).limit(20000)
    if (data?.length) crudas.push(...data)
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Consultar →' }

  // 3) Filtrar: aprobada, en rango, centro Taxis, no cobrada, y unidad financiada
  const vistos = new Set()
  ghHuerfanos = []
  for (const l of crudas) {
    if (vistos.has(l.id)) continue
    vistos.add(l.id)
    const p = l.partida
    if (!p || p.estado !== 'aprobada') continue
    if (p.fecha_partida < desde || p.fecha_partida > hasta) continue
    if ((parseFloat(l.monto) || 0) <= 0) continue
    if (l.usado_en_recibo) continue
    if (!/taxi/i.test(l.centro?.nombre || '')) continue
    const unidad = ghExtraerUnidad(l.descripcion)
    if (!unidad) continue
    const prest = mapPrestamo[ghSinCeros(unidad)]
    if (!prest) continue   // no financiado → es costo de la empresa, se excluye
    ghHuerfanos.push({
      lineaId: l.id, partidaId: p.id, numPartida: p.numero_partida || '—',
      fecha: p.fecha_partida, descripcion: l.descripcion, monto: Math.round((parseFloat(l.monto) || 0) * 100) / 100,
      cuenta: l.cuenta_codigo, unidad, codigo: prest.codigo, motorista: prest.motorista, categoria: prest.categoria
    })
  }

  // 4) Agrupar por unidad
  const g = {}
  for (const h of ghHuerfanos) {
    const k = h.codigo
    if (!g[k]) g[k] = { codigo: h.codigo, motorista: h.motorista, categoria: h.categoria, n: 0, total: 0, lineas: [] }
    g[k].n++; g[k].total += h.monto; g[k].lineas.push(h)
  }
  ghResumen = Object.values(g).sort((a, b) => b.total - a.total)
  ghUnidadAbierta = null
  ghFiltroTexto = ''
  ghFiltroFocus = false
  ghRender()
  document.getElementById('gh-resultado')?.classList.remove('hidden')
}

function ghRender() {
  const cont = document.getElementById('gh-resultado')
  if (!cont) return
  const totalGeneral = ghHuerfanos.reduce((s, h) => s + h.monto, 0)

  if (!ghResumen.length) {
    cont.innerHTML = '<div class="form-card"><div style="text-align:center;padding:24px;color:var(--green)">✓ No hay gastos huérfanos de unidades financiadas en este período. Todo cobrado.</div></div>'
    return
  }

  // Filtro por unidad/motorista (sobre lo ya consultado)
  const q = (ghFiltroTexto || '').trim().toLowerCase()
  const resumenFiltrado = q
    ? ghResumen.filter(u => String(u.codigo).toLowerCase().includes(q) || String(u.motorista || '').toLowerCase().includes(q))
    : ghResumen
  const totalFiltrado = resumenFiltrado.reduce((s, u) => s + u.total, 0)

  const filasUnidad = resumenFiltrado.map(u => `
    <tr class="gh-row" style="cursor:pointer" onclick="ghToggleUnidad('${u.codigo}')" title="Click para ver las líneas que componen este total">
      <td style="font-family:var(--mono);color:var(--gold)">${ghUnidadAbierta === u.codigo ? '▼' : '▶'} ${u.codigo}</td>
      <td>${u.motorista || '—'}</td>
      <td><span class="badge">${u.categoria || '—'}</span></td>
      <td style="text-align:center">${u.n}</td>
      <td style="text-align:right;font-family:var(--mono);font-weight:600;color:var(--red)">L. ${ghFmt(u.total)}</td>
    </tr>
    ${ghUnidadAbierta === u.codigo ? ghFilasDetalle(u) : ''}
  `).join('') || `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text3)">Sin coincidencias para "${q}"</td></tr>`

  cont.innerHTML = `
    <div class="form-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-weight:600;color:var(--gold)">Gastos huérfanos de unidades financiadas</div>
          <div style="font-size:12px;color:var(--text3)">No cobrados en recibo · ${ghResumen.length} unidad(es) · total L. ${ghFmt(totalGeneral)}</div>
        </div>
        <button class="btn btn-ghost" onclick="ghExportar()" style="padding:6px 12px;font-size:12px">📊 Exportar Excel</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <input type="text" id="gh-filtro" placeholder="🔎 Buscar por unidad o motorista..." value="${(ghFiltroTexto || '').replace(/"/g, '&quot;')}"
          oninput="ghFiltrar(this.value)" style="flex:1;max-width:360px;font-size:12px;padding:6px 10px">
        ${q ? `<span style="font-size:11px;color:var(--text3)">${resumenFiltrado.length} de ${ghResumen.length} · L. ${ghFmt(totalFiltrado)}</span>
        <button class="btn btn-ghost" onclick="ghFiltrar('')" style="padding:5px 10px;font-size:11px">Limpiar</button>` : ''}
      </div>
      <table style="width:100%">
        <thead><tr><th>Unidad</th><th>Motorista</th><th>Categoría</th><th style="text-align:center">Líneas</th><th style="text-align:right">Total no cobrado</th></tr></thead>
        <tbody>${filasUnidad}</tbody>
      </table>
    </div>`
  // Mantener el foco en el input al re-renderizar mientras se escribe
  const inp = document.getElementById('gh-filtro')
  if (inp && ghFiltroFocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) }
}

function ghFilasDetalle(u) {
  return `<tr><td colspan="5" style="padding:0">
    <div style="background:var(--bg3);border-radius:6px;margin:4px 0;padding:8px">
      <table style="width:100%">
        <thead><tr><th style="font-size:11px">Fecha</th><th style="font-size:11px">Partida</th><th style="font-size:11px">Descripción</th><th style="font-size:11px;text-align:right">Monto</th><th></th></tr></thead>
        <tbody>${u.lineas.map(l => `
          <tr class="gh-linea" style="cursor:pointer" onclick="ghIrAPartida('${l.partidaId}')" title="Ir a la partida #${l.numPartida}">
            <td style="font-family:var(--mono);font-size:11px">${l.fecha}</td>
            <td style="font-family:var(--mono);font-size:11px;color:var(--gold)">#${l.numPartida}</td>
            <td style="font-size:12px">${l.descripcion || '—'}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">L. ${ghFmt(l.monto)}</td>
            <td style="text-align:center;font-size:11px;color:var(--gold)">ver →</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
  </td></tr>`
}

window.ghToggleUnidad = (codigo) => {
  ghFiltroFocus = false
  ghUnidadAbierta = (ghUnidadAbierta === codigo) ? null : codigo
  ghRender()
}

window.ghFiltrar = (txt) => {
  ghFiltroTexto = txt || ''
  ghFiltroFocus = true
  ghRender()
}

window.ghIrAPartida = (partidaId) => {
  // Recordar de dónde venimos para volver aquí tras ver/aprobar/cancelar la partida
  window._origenPartida = { view: 'gastos-huerfanos', label: 'Gastos huérfanos de taxis', init: 'initGastosHuerfanos' }
  if (window.editarPartida) window.editarPartida(partidaId)
  else window.toast?.('No se pudo abrir la partida', 'error')
}

window.ghExportar = () => {
  if (!window.XLSX) { window.toast?.('Exportador no disponible', 'error'); return }
  const filas = ghHuerfanos.map(h => ({
    Unidad: h.codigo, Motorista: h.motorista, Categoria: h.categoria,
    Fecha: h.fecha, Partida: h.numPartida, Cuenta: h.cuenta,
    Descripcion: h.descripcion, Monto: h.monto
  }))
  const ws = window.XLSX.utils.json_to_sheet(filas)
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Gastos huérfanos')
  window.XLSX.writeFile(wb, `gastos_huerfanos_taxis_${new Date().toISOString().split('T')[0]}.xlsx`)
}