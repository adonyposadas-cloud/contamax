// ══════════════════════════════════════════════
// ── REPORTES FINANCIEROS · js/reportes.js
// ── Depende de: window._sb, window._empresas(), window.catalogoCuentas, 
// ── window.XLSX, window.toast, window.editarPartida (de app.js)
// ── window._todosLosCentros(), window._currentProfile()
// ══════════════════════════════════════════════

const fmtL = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const getSb = () => window._sb
const getEmpresas = () => window._empresas ? window._empresas() : []
const getCatalogo = () => window.catalogoCuentas || []

// ── PRIVACIDAD: Helpers ──
const esSuperAdmin = () => {
  const p = window._currentProfile ? window._currentProfile() : null
  return p?.rol === 'super_admin'
}

const getCentrosPrivados = () => {
  const todos = window._todosLosCentros ? window._todosLosCentros() : []
  return todos.filter(c => c.privado)
}

const getIdsPrivados = () => new Set(getCentrosPrivados().map(c => c.id))

const getNombreCentro = (id) => {
  const todos = window._todosLosCentros ? window._todosLosCentros() : []
  const c = todos.find(x => x.id === id)
  return c ? c.nombre : id
}

// Centros visibles para selects de reportes (sin privados para no-super_admin)
const getEmpresasReporte = () => {
  if (esSuperAdmin()) return getEmpresas()
  const idsPriv = getIdsPrivados()
  return getEmpresas().filter(e => !idsPriv.has(e.id))
}


// ── AUXILIAR DE CUENTAS ──

let auxData = null

window.initAuxiliar = function() {
  const hoy = new Date()
  const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0]
  const ultimoDia = hoy.toISOString().split('T')[0]
  document.getElementById('aux-fecha-ini').value = primerDia
  document.getElementById('aux-fecha-fin').value = ultimoDia
  document.getElementById('aux-resultado').classList.add('hidden')
  document.getElementById('btn-auxiliar-xlsx').style.display = 'none'
  auxData = null

  // Limpiar drill-down desde Estado de Resultados (si venía de ahí)
  erDrillState = null
  document.getElementById('btn-volver-er')?.remove()

  // Llenar centros de costo (sin privados para no-super_admin)
  const sel = document.getElementById('aux-centro')
  sel.innerHTML = '<option value="">Todos</option>' + getEmpresasReporte().map(e => `<option value="${e.id}">${e.nombre}</option>`).join('')
}

window.openAuxCuentaDD = () => {
  const dd = document.getElementById('aux-cuenta-dd')
  dd.style.display = 'block'
  const inputVal = document.getElementById('aux-cuenta-input').value.trim()
  const codigoActual = inputVal.split(' ')[0]
  if (codigoActual.length === 6 && !codigoActual.includes('-')) {
    const catalogo = getCatalogo()
    const grupo = catalogo.find(c => c.codigo === codigoActual && c.activa)
    if (grupo && catalogo.some(h => h.activa && h.codigo.startsWith(codigoActual + '-'))) {
      selectAuxCuenta(grupo.id, grupo.codigo, grupo.nombre, true)
    }
  }
  filterAuxCuentas(inputVal)
}

window.filterAuxCuentas = (val) => {
  auxCuentaDDIndex = -1
  const dd = document.getElementById('aux-cuenta-dd')
  dd.style.display = 'block'
  const term = (val || '').toLowerCase().trim()
  const catalogo = getCatalogo()

  // Helper: is this code a group? (has children with codigo + '-XXX')
  const tieneHijas = (codigo) => catalogo.some(h => h.activa && h.codigo.startsWith(codigo + '-'))
  const esGrupo = (c) => c.codigo.length === 6 && !c.codigo.includes('-') && tieneHijas(c.codigo)

  const filtered = catalogo
    .filter(c => c.activa)
    .filter(c => {
      // Show accounts with dash (detail subcuentas)
      if (c.codigo.includes('-')) return true
      // Show level 4 groups that have children
      if (esGrupo(c)) return true
      return false
    })
    .filter(c => !term || c.codigo.toLowerCase().includes(term) || c.nombre.toLowerCase().includes(term))
    .slice(0, 40)

  dd.innerHTML = filtered.length ? filtered.map(c => {
    const isGrp = esGrupo(c)
    return `<div class="cuenta-opt" onclick="selectAuxCuenta('${c.id}','${c.codigo}','${c.nombre.replace(/'/g, '')}',${isGrp})" style="${isGrp ? 'background:var(--bg3);font-weight:600' : ''}">
      <span style="color:var(--gold);font-family:var(--mono)">${c.codigo}</span> ${c.nombre} ${isGrp ? '<span style="font-size:10px;color:var(--text3)">(grupo)</span>' : ''}
    </div>`
  }).join('') : '<div style="padding:10px;color:var(--text3);font-size:12px">No se encontraron cuentas</div>'

  // Auto-detect group from typed value
  const codigoTyped = term.split(' ')[0]
  const rangoDiv = document.getElementById('aux-rango-sub')
  if (codigoTyped.length === 6 && !codigoTyped.includes('-')) {
    const grupo = filtered.find(c => c.codigo.toLowerCase() === codigoTyped && esGrupo(c))
    if (grupo) {
      document.getElementById('aux-cuenta-id').value = grupo.id
      document.getElementById('aux-cuenta-es-grupo').value = grupo.codigo
      const hijas = catalogo.filter(c => c.activa && c.codigo.startsWith(grupo.codigo + '-'))
      const sufijos = hijas.map(c => c.codigo.split('-').pop()).sort()
      document.getElementById('aux-sub-desde').value = sufijos[0] || '001'
      document.getElementById('aux-sub-hasta').value = sufijos[sufijos.length - 1] || '999'
      document.getElementById('aux-rango-info').textContent = `${hijas.length} subcuentas (${sufijos[0] || '?'} a ${sufijos[sufijos.length - 1] || '?'})`
      rangoDiv.style.display = 'grid'
      return
    }
  }
  if (codigoTyped.includes('-') || codigoTyped.length > 6 || codigoTyped.length < 6) {
    rangoDiv.style.display = 'none'
    document.getElementById('aux-cuenta-es-grupo').value = ''
  }
}

window.selectAuxCuenta = (id, codigo, nombre, isGroup) => {
  document.getElementById('aux-cuenta-input').value = `${codigo} ${nombre}`
  document.getElementById('aux-cuenta-id').value = id
  document.getElementById('aux-cuenta-dd').style.display = 'none'
  document.getElementById('aux-cuenta-es-grupo').value = isGroup ? codigo : ''
  auxCuentaDDIndex = -1

  const rangoDiv = document.getElementById('aux-rango-sub')
  if (isGroup) {
    rangoDiv.style.display = 'grid'
    const hijas = getCatalogo().filter(c => c.activa && c.codigo.includes('-') && c.codigo.startsWith(codigo + '-'))
    const sufijos = hijas.map(c => c.codigo.split('-').pop()).sort()
    document.getElementById('aux-sub-desde').value = sufijos[0] || '001'
    document.getElementById('aux-sub-hasta').value = sufijos[sufijos.length - 1] || '999'
    document.getElementById('aux-rango-info').textContent = `${hijas.length} subcuentas disponibles (${sufijos[0] || '?'} a ${sufijos[sufijos.length - 1] || '?'})`
  } else {
    rangoDiv.style.display = 'none'
  }
}

let auxCuentaDDIndex = -1

window.navAuxCuentaDD = (e) => {
  const dd = document.getElementById('aux-cuenta-dd')
  if (!dd || dd.style.display === 'none') return
  const opts = dd.querySelectorAll('.cuenta-opt')
  if (!opts.length) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    auxCuentaDDIndex = Math.min(auxCuentaDDIndex + 1, opts.length - 1)
    opts.forEach((o, i) => o.style.background = i === auxCuentaDDIndex ? 'var(--bg3)' : '')
    opts[auxCuentaDDIndex].scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    auxCuentaDDIndex = Math.max(auxCuentaDDIndex - 1, 0)
    opts.forEach((o, i) => o.style.background = i === auxCuentaDDIndex ? 'var(--bg3)' : '')
    opts[auxCuentaDDIndex].scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (auxCuentaDDIndex >= 0 && opts[auxCuentaDDIndex]) {
      opts[auxCuentaDDIndex].click()
    }
  } else if (e.key === 'Escape') {
    dd.style.display = 'none'
    auxCuentaDDIndex = -1
  } else {
    auxCuentaDDIndex = -1
  }
}

// Cerrar dropdown al hacer click fuera
document.addEventListener('click', (e) => {
  if (!e.target.closest('#aux-cuenta-input') && !e.target.closest('#aux-cuenta-dd')) {
    const dd = document.getElementById('aux-cuenta-dd')
    if (dd) dd.style.display = 'none'
  }
})

// PostgREST corta cada respuesta a ~1000 filas y .limit() NO sube ese tope. Para reportes
// que agregan muchas líneas (balanza, estado de resultados, saldo anterior del auxiliar) hay
// que paginar o se pierden filas en silencio (descuadra el reporte). buildQuery() debe
// construir una consulta NUEVA en cada llamada y traer un .order estable (ej. .order('id')).
async function _fetchAllPaginado(buildQuery, pageSize = 1000) {
  const all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || !data.length) break
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}

// Saldo acumulado de la cuenta ANTES de fechaIni (el "vienen")
async function _auxSaldoAnterior(cuenta, fechaIni, centroId, libro, estadoFiltro) {
  const lineas = await _fetchAllPaginado(() => {
    let q = getSb().from('lineas_partida')
      .select('tipo, monto, centro_costo_id, partida:partidas_contables(fecha_partida, estado)')
      .eq('cuenta_id', cuenta.id)
      .lt('partida.fecha_partida', fechaIni)
      .order('id', { ascending: true })
    if (centroId) q = q.eq('centro_costo_id', centroId)
    if (libro === 'fiscal') q = q.eq('aplica_fiscal', true)
    if (libro === 'interno') q = q.eq('aplica_fiscal', false)
    return q
  })
  let filtered = (lineas || []).filter(l => l.partida && l.partida.fecha_partida)
  if (estadoFiltro !== 'todos') filtered = filtered.filter(l => l.partida.estado === estadoFiltro)
  if (!centroId && !esSuperAdmin()) {
    const idsPriv = getIdsPrivados()
    filtered = filtered.filter(l => !l.centro_costo_id || !idsPriv.has(l.centro_costo_id))
  }
  const naturaleza = cuenta.naturaleza || 'deudora'
  let saldo = 0
  for (const l of filtered) {
    const debe = l.tipo === 'debito' ? parseFloat(l.monto) || 0 : 0
    const haber = l.tipo === 'credito' ? parseFloat(l.monto) || 0 : 0
    saldo += naturaleza === 'deudora' ? (debe - haber) : (haber - debe)
  }
  return Math.round(saldo * 100) / 100
}

window.generarAuxiliar = async () => {
  const fechaIni = document.getElementById('aux-fecha-ini').value
  const fechaFin = document.getElementById('aux-fecha-fin').value
  const cuentaId = document.getElementById('aux-cuenta-id').value
  const centroId = document.getElementById('aux-centro').value
  const libro = document.getElementById('aux-libro').value
  const estadoFiltro = document.getElementById('aux-estado').value
  const grupoCodigo = document.getElementById('aux-cuenta-es-grupo').value

  if (!fechaIni || !fechaFin) { toast('Selecciona rango de fechas', 'error'); return }
  if (!cuentaId && !grupoCodigo) { toast('Selecciona una cuenta contable', 'error'); return }

  const cuentaInput = document.getElementById('aux-cuenta-input').value || ''
  const codigoCuenta = cuentaInput.split(' ')[0]
  if (esCuentaSensible(codigoCuenta) && !puedeVerSensibles()) {
    toast('Solo el Super Admin puede consultar saldos de caja y bancos', 'error'); return
  }
  if (centroId && !esSuperAdmin()) {
    const idsPriv = getIdsPrivados()
    if (idsPriv.has(centroId)) { toast('No tienes acceso al detalle de este centro de costo', 'error'); return }
  }

  const btn = document.getElementById('btn-auxiliar')
  btn.disabled = true; btn.textContent = 'Consultando...'

  // Determinar cuentas a consultar
  let cuentasConsultar = []
  if (grupoCodigo) {
    const subDesde = document.getElementById('aux-sub-desde').value.trim()
    const subHasta = document.getElementById('aux-sub-hasta').value.trim()
    cuentasConsultar = getCatalogo()
      .filter(c => c.activa && c.codigo.includes('-') && c.codigo.startsWith(grupoCodigo + '-'))
      .filter(c => {
        const sufijo = c.codigo.split('-').pop()
        return (!subDesde || sufijo >= subDesde) && (!subHasta || sufijo <= subHasta)
      })
      .sort((a, b) => a.codigo.localeCompare(b.codigo))
    if (!cuentasConsultar.length) { toast('No hay subcuentas en ese rango', 'error'); btn.disabled = false; btn.textContent = 'Consultar →'; return }
  } else {
    const cuenta = getCatalogo().find(c => c.id === cuentaId)
    if (cuenta) cuentasConsultar = [cuenta]
  }

  // Consultar cada cuenta
  const bloques = []
  let grandTotalDebe = 0, grandTotalHaber = 0

  for (const cuenta of cuentasConsultar) {
    if (esCuentaSensible(cuenta.codigo) && !puedeVerSensibles()) continue

    const lineas = await _fetchAllPaginado(() => {
      let q = getSb().from('lineas_partida')
        .select('*, partida:partidas_contables(id, fecha_partida, numero_partida, descripcion, estado, tipo_origen)')
        .eq('cuenta_id', cuenta.id)
        .gte('partida.fecha_partida', fechaIni)
        .lte('partida.fecha_partida', fechaFin)
        .order('id', { ascending: true })
      if (centroId) q = q.eq('centro_costo_id', centroId)
      if (libro === 'fiscal') q = q.eq('aplica_fiscal', true)
      if (libro === 'interno') q = q.eq('aplica_fiscal', false)
      return q
    })
    let filtered = (lineas || []).filter(l => l.partida && l.partida.fecha_partida)
    if (estadoFiltro !== 'todos') filtered = filtered.filter(l => l.partida.estado === estadoFiltro)
    if (!centroId && !esSuperAdmin()) {
      const idsPriv = getIdsPrivados()
      filtered = filtered.filter(l => !l.centro_costo_id || !idsPriv.has(l.centro_costo_id))
    }
    filtered.sort((a, b) => {
      const da = a.partida.fecha_partida, db = b.partida.fecha_partida
      if (da !== db) return da.localeCompare(db)
      return (a.partida.numero_partida || 0) - (b.partida.numero_partida || 0)
    })

    const naturaleza = cuenta.naturaleza || 'deudora'
    const saldoAnterior = await _auxSaldoAnterior(cuenta, fechaIni, centroId, libro, estadoFiltro)
    let saldo = saldoAnterior
    const movimientos = filtered.map(l => {
      const debe = l.tipo === 'debito' ? parseFloat(l.monto) || 0 : 0
      const haber = l.tipo === 'credito' ? parseFloat(l.monto) || 0 : 0
      if (naturaleza === 'deudora') saldo += debe - haber
      else saldo += haber - debe
      return { fecha: l.partida.fecha_partida, partida: l.partida.numero_partida || '—', partidaId: l.partida.id, descripcion: l.descripcion || l.partida.descripcion || '', origen: l.partida.tipo_origen || '', debe, haber, saldo: Math.round(saldo * 100) / 100, fiscal: l.aplica_fiscal, estado: l.partida.estado }
    })
    const totalDebe = movimientos.reduce((s, m) => s + m.debe, 0)
    const totalHaber = movimientos.reduce((s, m) => s + m.haber, 0)
    grandTotalDebe += totalDebe
    grandTotalHaber += totalHaber
    bloques.push({ cuenta, movimientos, totalDebe, totalHaber, saldoFinal: saldo, saldoAnterior, naturaleza })
  }

  // Para compatibilidad con exportar Excel (cuenta única)
  if (bloques.length === 1) {
    const b = bloques[0]
    auxData = { movimientos: b.movimientos, cuenta: b.cuenta, fechaIni, fechaFin, totalDebe: b.totalDebe, totalHaber: b.totalHaber, saldoFinal: b.saldoFinal, saldoAnterior: b.saldoAnterior }
  } else {
    auxData = { bloques, fechaIni, fechaFin, grandTotalDebe, grandTotalHaber, grupoCodigo }
  }

  // Render
  if (bloques.length === 1) {
    // Render single account (unchanged)
    const b = bloques[0]
    renderAuxiliarSingle(b, fechaIni, fechaFin)
  } else {
    // Render multi-account
    renderAuxiliarMulti(bloques, fechaIni, fechaFin, grandTotalDebe, grandTotalHaber, grupoCodigo)
  }

  btn.disabled = false; btn.textContent = 'Consultar →'
  document.getElementById('btn-auxiliar-xlsx').style.display = 'inline-flex'

  // Si venimos de drill-down del Estado de Resultados, mostrar botón de regreso
  injectAuxBackBtn()
}

function renderAuxiliarSingle(b, fechaIni, fechaFin) {
  const { cuenta, movimientos, totalDebe, totalHaber, saldoFinal, naturaleza } = b
  const saldo = saldoFinal
  const saldoAnterior = b.saldoAnterior || 0
  const tieneVienen = Math.abs(saldoAnterior) >= 0.005
  const labelNat = (v) => v >= 0 ? (naturaleza === 'deudora' ? 'deudor' : 'acreedor') : (naturaleza === 'deudora' ? 'acreedor' : 'deudor')

  // Render resumen
  document.getElementById('aux-resumen').innerHTML = `
    <div style="padding:16px;border-radius:var(--radius);background:var(--bg3);border-left:3px solid var(--gold)">
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">${cuenta?.codigo} — ${cuenta?.nombre}</div>
      <div style="font-size:13px;color:var(--text3);margin-bottom:12px">Período: ${fechaIni} al ${fechaFin} · Naturaleza: ${naturaleza} · ${movimientos.length} movimientos</div>
      <div style="display:grid;grid-template-columns:repeat(${tieneVienen ? 4 : 3},1fr);gap:12px">
        ${tieneVienen ? `<div class="stat-card"><div class="stat-num" style="color:var(--text2)">L. ${fmtL(Math.abs(saldoAnterior))}</div><div class="stat-label">Saldo anterior (vienen)</div></div>` : ''}
        <div class="stat-card"><div class="stat-num" style="color:var(--green)">L. ${fmtL(totalDebe)}</div><div class="stat-label">Total débitos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--red)">L. ${fmtL(totalHaber)}</div><div class="stat-label">Total créditos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--gold)">L. ${fmtL(Math.abs(saldo))}</div><div class="stat-label">Saldo ${tieneVienen ? 'final ' : ''}${labelNat(saldo)}</div></div>
      </div>
    </div>`

  // Render tabla
  const searchId = 'aux-buscar-desc'
  document.getElementById('aux-tabla').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <input type="text" id="${searchId}" placeholder="🔍 Buscar en descripción..." style="flex:1;max-width:400px;padding:8px 12px;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:13px">
      <span id="aux-buscar-count" style="font-size:12px;color:var(--text3)"></span>
    </div>
    <table>
      <thead><tr>
        <th>Fecha</th><th>N° Part.</th><th>Descripción</th><th>Origen</th>
        <th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th style="text-align:right">Saldo</th>
      </tr></thead>
      <tbody id="aux-tbody">${tieneVienen ? `
        <tr style="background:var(--bg2);font-style:italic;color:var(--text2)">
          <td colspan="6" style="text-align:right">Saldo anterior (vienen) al ${fechaIni}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:600">${fmtL(saldoAnterior)}</td>
        </tr>` : ''}${movimientos.map((m, i) => `
        <tr style="cursor:pointer" data-idx="${i}" data-desc="${(m.descripcion||'').toLowerCase()}" onclick="verPartida('${m.partidaId}')">
          <td style="font-family:var(--mono);font-size:12px;white-space:nowrap">${m.fecha}</td>
          <td style="font-family:var(--mono);color:var(--gold)">${m.partida}</td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${m.descripcion}">${m.descripcion}</td>
          <td><span class="badge" style="font-size:10px">${m.origen}</span></td>
          <td style="text-align:right;font-family:var(--mono);color:${m.debe ? 'var(--green)' : 'var(--text3)'}">${m.debe ? fmtL(m.debe) : '—'}</td>
          <td style="text-align:right;font-family:var(--mono);color:${m.haber ? 'var(--red)' : 'var(--text3)'}">${m.haber ? fmtL(m.haber) : '—'}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:500">${fmtL(m.saldo)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr style="background:var(--bg3);font-weight:600">
        <td colspan="4" style="text-align:right">TOTALES</td>
        <td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${fmtL(totalDebe)}</td>
        <td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${fmtL(totalHaber)}</td>
        <td style="text-align:right;font-family:var(--mono);color:var(--gold)">L. ${fmtL(Math.abs(saldo))}</td>
      </tr></tfoot>
    </table>`

  // ── Filtro de búsqueda por descripción (client-side) ──
  document.getElementById(searchId).addEventListener('input', function() {
    const term = this.value.toLowerCase().trim()
    const rows = document.querySelectorAll('#aux-tbody tr')
    let shown = 0
    rows.forEach(tr => {
      const desc = tr.getAttribute('data-desc') || ''
      const match = !term || desc.includes(term)
      tr.style.display = match ? '' : 'none'
      if (match) shown++
    })
    const countEl = document.getElementById('aux-buscar-count')
    if (countEl) countEl.textContent = term ? `${shown} de ${rows.length} registros` : ''
  })

  document.getElementById('aux-resultado').classList.remove('hidden')
  document.getElementById('btn-auxiliar-xlsx').style.display = ''
}

function renderAuxiliarMulti(bloques, fechaIni, fechaFin, grandTotalDebe, grandTotalHaber, grupoCodigo) {
  const totalMovs = bloques.reduce((s, b) => s + b.movimientos.length, 0)
  document.getElementById('aux-resumen').innerHTML = `
    <div style="padding:16px;border-radius:var(--radius);background:var(--bg3);border-left:3px solid var(--gold)">
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">${grupoCodigo} — Reporte de ${bloques.length} subcuentas</div>
      <div style="font-size:13px;color:var(--text3);margin-bottom:12px">Período: ${fechaIni} al ${fechaFin} · ${totalMovs} movimientos totales</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <div class="stat-card"><div class="stat-num" style="color:var(--green)">L. ${fmtL(grandTotalDebe)}</div><div class="stat-label">Total débitos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--red)">L. ${fmtL(grandTotalHaber)}</div><div class="stat-label">Total créditos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--gold)">${bloques.length}</div><div class="stat-label">Subcuentas</div></div>
      </div>
    </div>`

  let tablaHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
    <input type="text" id="aux-multi-buscar" placeholder="🔍 Buscar en descripción..." oninput="filtrarAuxMulti(this.value)" style="flex:1;max-width:400px;padding:8px 12px;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:13px">
    <span id="aux-multi-count" style="font-size:12px;color:var(--text3)"></span>
  </div>`
  for (const b of bloques) {
    const { cuenta, movimientos, totalDebe, totalHaber, saldoFinal, naturaleza } = b
    if (!movimientos.length) continue
    const saldoAntB = b.saldoAnterior || 0
    const vienenB = Math.abs(saldoAntB) >= 0.005
    tablaHTML += `
    <div class="aux-multi-bloque" style="margin-bottom:24px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <div style="padding:10px 14px;background:var(--bg3);font-weight:600;font-size:13px;display:flex;justify-content:space-between;align-items:center">
        <span><span style="color:var(--gold);font-family:var(--mono)">${cuenta.codigo}</span> ${cuenta.nombre}</span>
        <span style="font-size:12px;color:var(--text3)">${movimientos.length} mov. · Saldo: <span style="color:var(--gold)">L. ${fmtL(Math.abs(saldoFinal))}</span></span>
      </div>
      <table>
        <thead><tr>
          <th>Fecha</th><th>N° Part.</th><th>Descripción</th><th>Origen</th>
          <th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th style="text-align:right">Saldo</th>
        </tr></thead>
        <tbody>${vienenB ? `
          <tr style="background:var(--bg2);font-style:italic;color:var(--text2)">
            <td colspan="6" style="text-align:right">Saldo anterior (vienen) al ${fechaIni}</td>
            <td style="text-align:right;font-family:var(--mono);font-weight:600">${fmtL(saldoAntB)}</td>
          </tr>` : ''}${movimientos.map(m => `
          <tr class="aux-multi-row" data-desc="${(m.descripcion||'').toLowerCase()}" style="cursor:pointer" onclick="verPartida('${m.partidaId}')">
            <td style="font-family:var(--mono);font-size:12px;white-space:nowrap">${m.fecha}</td>
            <td style="font-family:var(--mono);color:var(--gold)">${m.partida}</td>
            <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${m.descripcion}">${m.descripcion}</td>
            <td><span class="badge" style="font-size:10px">${m.origen}</span></td>
            <td style="text-align:right;font-family:var(--mono);color:${m.debe ? 'var(--green)' : 'var(--text3)'}">${m.debe ? fmtL(m.debe) : '—'}</td>
            <td style="text-align:right;font-family:var(--mono);color:${m.haber ? 'var(--red)' : 'var(--text3)'}">${m.haber ? fmtL(m.haber) : '—'}</td>
            <td style="text-align:right;font-family:var(--mono);font-weight:500">${fmtL(m.saldo)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:var(--bg3);font-weight:600">
          <td colspan="4" style="text-align:right">TOTALES ${cuenta.codigo}</td>
          <td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${fmtL(totalDebe)}</td>
          <td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${fmtL(totalHaber)}</td>
          <td style="text-align:right;font-family:var(--mono);color:var(--gold)">L. ${fmtL(Math.abs(saldoFinal))}</td>
        </tr></tfoot>
      </table>
    </div>`
  }

  document.getElementById('aux-tabla').innerHTML = tablaHTML
  document.getElementById('aux-resultado').classList.remove('hidden')
  document.getElementById('btn-auxiliar-xlsx').style.display = ''
}

window.filtrarAuxMulti = (val) => {
  const term = val.toLowerCase().trim()
  const rows = document.querySelectorAll('.aux-multi-row')
  let shown = 0
  rows.forEach(tr => {
    const match = !term || (tr.getAttribute('data-desc') || '').includes(term)
    tr.style.display = match ? '' : 'none'
    if (match) shown++
  })
  // Hide empty blocks
  document.querySelectorAll('.aux-multi-bloque').forEach(bloque => {
    const visibleRows = bloque.querySelectorAll('.aux-multi-row:not([style*="display: none"])')
    bloque.style.display = visibleRows.length || !term ? '' : 'none'
  })
  const countEl = document.getElementById('aux-multi-count')
  if (countEl) countEl.textContent = term ? `${shown} de ${rows.length} registros` : ''
}

window.exportarAuxiliarXLSX = () => {
  if (!auxData) return

  if (auxData.bloques) {
    // Multi-account export
    const { bloques, fechaIni, fechaFin, grandTotalDebe, grandTotalHaber, grupoCodigo } = auxData
    const rows = [
      ['AUXILIAR DE CUENTAS — CONTAMAX'],
      [`Grupo: ${grupoCodigo} — ${bloques.length} subcuentas`],
      [`Período: ${fechaIni} al ${fechaFin}`],
      []
    ]
    for (const b of bloques) {
      if (!b.movimientos.length) continue
      rows.push([`${b.cuenta.codigo} — ${b.cuenta.nombre}`])
      rows.push(['Fecha', 'N° Partida', 'Descripción', 'Origen', 'Debe', 'Haber', 'Saldo'])
      if (Math.abs(b.saldoAnterior || 0) >= 0.005) rows.push(['', '', `Saldo anterior (vienen) al ${fechaIni}`, '', '', '', b.saldoAnterior])
      for (const m of b.movimientos) {
        rows.push([m.fecha, m.partida, m.descripcion, m.origen, m.debe || '', m.haber || '', m.saldo])
      }
      rows.push(['', '', '', `TOTALES ${b.cuenta.codigo}`, b.totalDebe, b.totalHaber, Math.abs(b.saldoFinal)])
      rows.push([])
    }
    rows.push(['', '', '', 'GRAN TOTAL', grandTotalDebe, grandTotalHaber, Math.abs(grandTotalDebe - grandTotalHaber)])
    const ws = window.XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 45 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
    const wb = window.XLSX.utils.book_new()
    window.XLSX.utils.book_append_sheet(wb, ws, 'Auxiliar')
    window.XLSX.writeFile(wb, `Auxiliar_${grupoCodigo}_${fechaIni}_${fechaFin}.xlsx`)
    toast(`Excel con ${bloques.length} cuentas exportado ✓`, 'success')
  } else {
    // Single account export
    const { movimientos, cuenta, fechaIni, fechaFin, totalDebe, totalHaber, saldoFinal, saldoAnterior } = auxData
    const vienen = Math.abs(saldoAnterior || 0) >= 0.005
    const rows = [
      ['AUXILIAR DE CUENTAS — CONTAMAX'],
      [`Cuenta: ${cuenta.codigo} — ${cuenta.nombre}`],
      [`Período: ${fechaIni} al ${fechaFin}`],
      [],
      ['Fecha', 'N° Partida', 'Descripción', 'Origen', 'Debe', 'Haber', 'Saldo'],
      ...(vienen ? [['', '', `Saldo anterior (vienen) al ${fechaIni}`, '', '', '', saldoAnterior]] : []),
      ...movimientos.map(m => [m.fecha, m.partida, m.descripcion, m.origen, m.debe || '', m.haber || '', m.saldo]),
      [],
      ['', '', '', 'TOTALES', totalDebe, totalHaber, Math.abs(saldoFinal)]
    ]
    const ws = window.XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 45 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
    const wb = window.XLSX.utils.book_new()
    window.XLSX.utils.book_append_sheet(wb, ws, 'Auxiliar')
    window.XLSX.writeFile(wb, `Auxiliar_${cuenta.codigo}_${fechaIni}_${fechaFin}.xlsx`)
    toast('Excel exportado ✓', 'success')
  }
}

// ── BALANCE DE COMPROBACIÓN ──

let bcData = null

window.initBalance = function() {
  const hoy = new Date()
  document.getElementById('bc-fecha-ini').value = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0]
  document.getElementById('bc-fecha-fin').value = hoy.toISOString().split('T')[0]
  document.getElementById('bc-resultado').classList.add('hidden')
  document.getElementById('btn-balance-xlsx').style.display = 'none'
  bcData = null
  // Centros de reporte (sin privados para no-super_admin)
  const sel = document.getElementById('bc-centro')
  sel.innerHTML = '<option value="">Todos</option>' + getEmpresasReporte().map(e => `<option value="${e.id}">${e.nombre}</option>`).join('')
}

window.generarBalance = async () => {
  const fechaIni = document.getElementById('bc-fecha-ini').value
  const fechaFin = document.getElementById('bc-fecha-fin').value
  const centroId = document.getElementById('bc-centro').value
  const libro = document.getElementById('bc-libro').value
  const mostrar = document.getElementById('bc-mostrar').value

  if (!fechaIni || !fechaFin) { toast('Selecciona rango de fechas', 'error'); return }

  const btn = document.getElementById('btn-balance')
  btn.disabled = true; btn.textContent = 'Consultando...'

  // Traer todas las líneas del período (paginado: PostgREST corta a ~1000 por respuesta)
  let lineas
  try {
    lineas = await _fetchAllPaginado(() => {
      let q = getSb().from('lineas_partida')
        .select('cuenta_id, cuenta_codigo, cuenta_nombre, tipo, monto, aplica_fiscal, centro_costo_id, partida:partidas_contables(fecha_partida, estado)')
        .gte('partida.fecha_partida', fechaIni)
        .lte('partida.fecha_partida', fechaFin)
        .order('id', { ascending: true })
      if (centroId) q = q.eq('centro_costo_id', centroId)
      if (libro === 'fiscal') q = q.eq('aplica_fiscal', true)
      if (libro === 'interno') q = q.eq('aplica_fiscal', false)
      return q
    })
  } catch (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; btn.textContent = 'Consultar →'; return }

  // Solo partidas aprobadas, revalidando el rango en JS (defensa por si el filtro embebido falla)
  const validas = (lineas || []).filter(l => {
    const f = (l.partida?.fecha_partida || '').slice(0, 10)
    return l.partida?.estado === 'aprobada' && f >= fechaIni && f <= fechaFin
  })

  // ── Privacidad: separar líneas de centros privados ──
  const idsPriv = getIdsPrivados()
  const esAdmin = esSuperAdmin()
  const necesitaConsolidar = !esAdmin && !centroId // consolidar solo en vista "Todos"

  let lineasNormales = validas
  let lineasPrivadas = []

  if (necesitaConsolidar) {
    lineasNormales = validas.filter(l => !l.centro_costo_id || !idsPriv.has(l.centro_costo_id))
    lineasPrivadas = validas.filter(l => l.centro_costo_id && idsPriv.has(l.centro_costo_id))
  }

  // Agrupar líneas normales por cuenta
  const cuentaMap = {}
  lineasNormales.forEach(l => {
    const key = l.cuenta_codigo || l.cuenta_id
    if (!cuentaMap[key]) {
      cuentaMap[key] = { codigo: l.cuenta_codigo, nombre: l.cuenta_nombre, debe: 0, haber: 0 }
    }
    if (l.tipo === 'debito') cuentaMap[key].debe += parseFloat(l.monto) || 0
    else cuentaMap[key].haber += parseFloat(l.monto) || 0
  })

  // Enriquecer con naturaleza del catálogo
  const cuentas = Object.values(cuentaMap).map(c => {
    const cat = getCatalogo().find(x => x.codigo === c.codigo)
    const naturaleza = cat?.naturaleza || 'deudora'
    const sensible = esCuentaSensible(c.codigo) && !puedeVerSensibles()
    const neto = c.debe - c.haber
    return {
      ...c,
      naturaleza,
      nivel: cat?.nivel || 1,
      tipo: cat?.tipo || '',
      saldoDeudor: neto > 0 ? Math.round(neto * 100) / 100 : 0,
      saldoAcreedor: neto < 0 ? Math.round(Math.abs(neto) * 100) / 100 : 0,
      _sensible: sensible,
    }
  })

  // ── Agregar líneas consolidadas de centros privados ──
  if (necesitaConsolidar && lineasPrivadas.length) {
    // Agrupar por centro de costo privado
    const porCentro = {}
    lineasPrivadas.forEach(l => {
      const ccId = l.centro_costo_id
      if (!porCentro[ccId]) porCentro[ccId] = { debe: 0, haber: 0 }
      if (l.tipo === 'debito') porCentro[ccId].debe += parseFloat(l.monto) || 0
      else porCentro[ccId].haber += parseFloat(l.monto) || 0
    })

    Object.entries(porCentro).forEach(([ccId, totals]) => {
      const nombre = getNombreCentro(ccId)
      const neto = totals.debe - totals.haber
      cuentas.push({
        codigo: '🔒',
        nombre: `${nombre} (consolidado)`,
        debe: Math.round(totals.debe * 100) / 100,
        haber: Math.round(totals.haber * 100) / 100,
        naturaleza: '—',
        nivel: 1,
        tipo: '',
        saldoDeudor: neto > 0 ? Math.round(neto * 100) / 100 : 0,
        saldoAcreedor: neto < 0 ? Math.round(Math.abs(neto) * 100) / 100 : 0,
        _privado: true,
      })
    })
  }

  // Filtrar cuentas sin movimiento si aplica
  const filtradas = mostrar === 'con-movimiento' ? cuentas.filter(c => c.debe > 0 || c.haber > 0) : cuentas
  // Ordenar: cuentas normales por código, privadas al final
  filtradas.sort((a, b) => {
    if (a._privado && !b._privado) return 1
    if (!a._privado && b._privado) return -1
    return a.codigo.localeCompare(b.codigo)
  })

  const totDebe = filtradas.reduce((s, c) => s + c.debe, 0)
  const totHaber = filtradas.reduce((s, c) => s + c.haber, 0)
  const totSaldoD = filtradas.reduce((s, c) => s + c.saldoDeudor, 0)
  const totSaldoA = filtradas.reduce((s, c) => s + c.saldoAcreedor, 0)

  bcData = { cuentas: filtradas, fechaIni, fechaFin, totDebe, totHaber, totSaldoD, totSaldoA }

  document.getElementById('bc-resumen').innerHTML = `
    <div style="padding:16px;border-radius:var(--radius);background:var(--bg3);border-left:3px solid var(--gold)">
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">Balance de comprobación</div>
      <div style="font-size:13px;color:var(--text3);margin-bottom:12px">Período: ${fechaIni} al ${fechaFin} · ${filtradas.length} cuentas${necesitaConsolidar && lineasPrivadas.length ? ' (incluye centros consolidados)' : ''}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
        <div class="stat-card"><div class="stat-num" style="color:var(--green);font-size:16px">L. ${fmtL(totDebe)}</div><div class="stat-label">Débitos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--red);font-size:16px">L. ${fmtL(totHaber)}</div><div class="stat-label">Créditos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--green);font-size:16px">L. ${fmtL(totSaldoD)}</div><div class="stat-label">Saldo deudor</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--red);font-size:16px">L. ${fmtL(totSaldoA)}</div><div class="stat-label">Saldo acreedor</div></div>
      </div>
    </div>`

  document.getElementById('bc-tabla').innerHTML = `
    <table>
      <thead><tr>
        <th>Código</th><th>Cuenta</th><th>Nat.</th>
        <th style="text-align:right">Debe</th><th style="text-align:right">Haber</th>
        <th style="text-align:right">Saldo deudor</th><th style="text-align:right">Saldo acreedor</th>
      </tr></thead>
      <tbody>${filtradas.map(c => {
        const masked = c._sensible
        const mDebe = masked ? '🔒' : (c.debe ? fmtL(c.debe) : '—')
        const mHaber = masked ? '🔒' : (c.haber ? fmtL(c.haber) : '—')
        const mSD = masked ? '🔒' : (c.saldoDeudor ? fmtL(c.saldoDeudor) : '—')
        const mSA = masked ? '🔒' : (c.saldoAcreedor ? fmtL(c.saldoAcreedor) : '—')
        const rowStyle = c._privado ? ' style="background:rgba(239,68,68,0.04);border-left:3px solid var(--red)"' : (masked ? ' style="background:rgba(239,68,68,0.03)"' : '')
        return `<tr${rowStyle}>
          <td style="font-family:var(--mono);color:var(--gold);font-size:12px">${c.codigo}</td>
          <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.nombre}${masked ? ' <span style="font-size:10px;color:var(--text3)">(restringido)</span>' : ''}</td>
          <td style="font-size:11px;color:var(--text3)">${c.naturaleza === 'deudora' ? 'D' : c.naturaleza === 'acreedora' ? 'A' : c.naturaleza}</td>
          <td style="text-align:right;font-family:var(--mono)">${mDebe}</td>
          <td style="text-align:right;font-family:var(--mono)">${mHaber}</td>
          <td style="text-align:right;font-family:var(--mono);color:var(--green)">${mSD}</td>
          <td style="text-align:right;font-family:var(--mono);color:var(--red)">${mSA}</td>
        </tr>`}).join('')}
      </tbody>
      <tfoot><tr style="background:var(--bg3);font-weight:600">
        <td colspan="3" style="text-align:right">TOTALES</td>
        <td style="text-align:right;font-family:var(--mono)">L. ${fmtL(totDebe)}</td>
        <td style="text-align:right;font-family:var(--mono)">L. ${fmtL(totHaber)}</td>
        <td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${fmtL(totSaldoD)}</td>
        <td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${fmtL(totSaldoA)}</td>
      </tr></tfoot>
    </table>`

  document.getElementById('bc-resultado').classList.remove('hidden')
  document.getElementById('btn-balance-xlsx').style.display = ''
  btn.disabled = false; btn.textContent = 'Consultar →'
}

window.exportarBalanceXLSX = () => {
  if (!bcData) return
  const { cuentas, fechaIni, fechaFin, totDebe, totHaber, totSaldoD, totSaldoA } = bcData
  const rows = [
    ['BALANCE DE COMPROBACIÓN — CONTAMAX'],
    [`Período: ${fechaIni} al ${fechaFin}`],
    [],
    ['Código', 'Cuenta', 'Naturaleza', 'Debe', 'Haber', 'Saldo Deudor', 'Saldo Acreedor'],
    ...cuentas.map(c => [c._privado ? '🔒' : c.codigo, c.nombre, c.naturaleza, c.debe || '', c.haber || '', c.saldoDeudor || '', c.saldoAcreedor || '']),
    [],
    ['', '', 'TOTALES', totDebe, totHaber, totSaldoD, totSaldoA]
  ]
  const ws = window.XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Balance')
  window.XLSX.writeFile(wb, `Balance_Comprobacion_${fechaIni}_${fechaFin}.xlsx`)
  toast('Excel exportado ✓', 'success')
}

// ── ESTADO DE RESULTADOS ──

let erData = null

window.initEstadoResultados = function() {
  const hoy = new Date()
  document.getElementById('er-fecha-ini').value = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0]
  document.getElementById('er-fecha-fin').value = hoy.toISOString().split('T')[0]
  document.getElementById('er-resultado').classList.add('hidden')
  document.getElementById('btn-er-xlsx').style.display = 'none'
  erData = null
  // Centros de reporte (sin privados para no-super_admin)
  const sel = document.getElementById('er-centro')
  sel.innerHTML = '<option value="">Todos (consolidado)</option>' + getEmpresasReporte().map(e => `<option value="${e.id}">${e.nombre}</option>`).join('')
}

window.generarEstadoResultados = async () => {
  const fechaIni = document.getElementById('er-fecha-ini').value
  const fechaFin = document.getElementById('er-fecha-fin').value
  const centroId = document.getElementById('er-centro').value
  const libro = document.getElementById('er-libro').value

  if (!fechaIni || !fechaFin) { toast('Selecciona rango de fechas', 'error'); return }

  const btn = document.getElementById('btn-er')
  btn.disabled = true; btn.textContent = 'Consultando...'

  let lineas
  try {
    lineas = await _fetchAllPaginado(() => {
      let q = getSb().from('lineas_partida')
        .select('cuenta_id, cuenta_codigo, cuenta_nombre, tipo, monto, aplica_fiscal, centro_costo_id, partida:partidas_contables(fecha_partida, estado)')
        .gte('partida.fecha_partida', fechaIni)
        .lte('partida.fecha_partida', fechaFin)
        .order('id', { ascending: true })
      if (centroId) q = q.eq('centro_costo_id', centroId)
      if (libro === 'fiscal') q = q.eq('aplica_fiscal', true)
      if (libro === 'interno') q = q.eq('aplica_fiscal', false)
      return q
    })
  } catch (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; btn.textContent = 'Consultar →'; return }

  const validas = (lineas || []).filter(l => {
    const f = (l.partida?.fecha_partida || '').slice(0, 10)
    return l.partida?.estado === 'aprobada' && f >= fechaIni && f <= fechaFin
  })

  // ── Privacidad ──
  const idsPriv = getIdsPrivados()
  const esAdmin = esSuperAdmin()
  const necesitaConsolidar = !esAdmin && !centroId

  let lineasNormales = validas
  let lineasPrivadas = []

  if (necesitaConsolidar) {
    lineasNormales = validas.filter(l => !l.centro_costo_id || !idsPriv.has(l.centro_costo_id))
    lineasPrivadas = validas.filter(l => l.centro_costo_id && idsPriv.has(l.centro_costo_id))
  }

  // Agrupar por cuenta (líneas normales)
  const cuentaMap = {}
  lineasNormales.forEach(l => {
    const key = l.cuenta_codigo
    if (!cuentaMap[key]) {
      cuentaMap[key] = { codigo: l.cuenta_codigo, nombre: l.cuenta_nombre, debe: 0, haber: 0 }
    }
    if (l.tipo === 'debito') cuentaMap[key].debe += parseFloat(l.monto) || 0
    else cuentaMap[key].haber += parseFloat(l.monto) || 0
  })

  // Clasificar por tipo de cuenta (4=Ingresos, 5=Costos, 6=Gastos)
  const ingresos = []
  const costos = []
  const gastos = []

  Object.values(cuentaMap).forEach(c => {
    const cat = getCatalogo().find(x => x.codigo === c.codigo)
    const tipo = cat?.tipo || ''
    const saldo = c.haber - c.debe
    const item = { ...c, saldo: Math.round(saldo * 100) / 100, tipoCuenta: tipo }

    if (c.codigo.startsWith('4')) ingresos.push(item)
    else if (c.codigo.startsWith('5')) costos.push(item)
    else if (c.codigo.startsWith('6')) gastos.push(item)
  })

  // ── Agregar líneas consolidadas de centros privados al ER ──
  if (necesitaConsolidar && lineasPrivadas.length) {
    const porCentro = {}
    lineasPrivadas.forEach(l => {
      const ccId = l.centro_costo_id
      const prefix = l.cuenta_codigo?.charAt(0) || ''
      const key = `${ccId}_${prefix}`
      if (!porCentro[key]) porCentro[key] = { ccId, prefix, debe: 0, haber: 0 }
      if (l.tipo === 'debito') porCentro[key].debe += parseFloat(l.monto) || 0
      else porCentro[key].haber += parseFloat(l.monto) || 0
    })

    Object.values(porCentro).forEach(({ ccId, prefix, debe, haber }) => {
      const nombre = getNombreCentro(ccId)
      const saldo = haber - debe
      const item = {
        codigo: '🔒',
        nombre: `${nombre} (consolidado)`,
        debe, haber,
        saldo: Math.round(saldo * 100) / 100,
        tipoCuenta: '',
        _privado: true
      }
      if (prefix === '4') ingresos.push(item)
      else if (prefix === '5') costos.push(item)
      else if (prefix === '6') gastos.push(item)
    })
  }

  ingresos.sort((a, b) => { if (a._privado && !b._privado) return 1; if (!a._privado && b._privado) return -1; return (a.codigo||'').localeCompare(b.codigo||'') })
  costos.sort((a, b) => { if (a._privado && !b._privado) return 1; if (!a._privado && b._privado) return -1; return (a.codigo||'').localeCompare(b.codigo||'') })
  gastos.sort((a, b) => { if (a._privado && !b._privado) return 1; if (!a._privado && b._privado) return -1; return (a.codigo||'').localeCompare(b.codigo||'') })

  const totalIngresos = ingresos.reduce((s, c) => s + c.saldo, 0)
  const totalCostos = costos.reduce((s, c) => s + (-c.saldo), 0)   // costos: debe-haber = -(haber-debe)
  const totalGastos = gastos.reduce((s, c) => s + (-c.saldo), 0)   // gastos: idem
  const utilidadBruta = totalIngresos - totalCostos
  const utilidadNeta = utilidadBruta - totalGastos

  erData = { ingresos, costos, gastos, totalIngresos, totalCostos, totalGastos, utilidadBruta, utilidadNeta, fechaIni, fechaFin }

  // Para costos y gastos, mostramos debe-haber (positivo en cuentas de gasto normales)
  const invertir = (arr) => arr.map(c => ({ ...c, saldo: -c.saldo }))

  const renderSeccion = (titulo, items, color, signo) => {
    if (items.length === 0) return ''
    const total = items.reduce((s, c) => s + c.saldo, 0)
    const fmtSigned = (v) => (v < 0 ? '(' + fmtL(Math.abs(v)) + ')' : fmtL(v))
    return `
      <tr style="background:var(--bg3)"><td colspan="4" style="font-weight:600;color:${color};padding:10px 14px">${titulo}</td></tr>
      ${items.map(c => `<tr${c._privado ? ' style="background:rgba(239,68,68,0.04)"' : ` class="er-row-dd" style="cursor:pointer" onclick="erDrillDown('${c.codigo}')" title="Click para ver las transacciones que componen este monto"`}>
        <td style="font-family:var(--mono);color:var(--gold);font-size:12px;padding-left:24px">${c.codigo}</td>
        <td>${c.nombre}${c._privado ? '' : ' <span style="font-size:10px;color:var(--text3)">🔍</span>'}</td>
        <td style="text-align:right;font-family:var(--mono);${c.saldo < 0 ? 'color:var(--red)' : ''}">${fmtSigned(c.saldo)}</td>
        <td></td>
      </tr>`).join('')}
      <tr style="border-top:1px solid var(--border)">
        <td></td><td style="text-align:right;font-weight:500">Total ${titulo.toLowerCase()}</td>
        <td></td><td style="text-align:right;font-family:var(--mono);font-weight:600;color:${color}">L. ${fmtSigned(total)}</td>
      </tr>`
  }

  document.getElementById('er-resumen').innerHTML = `
    <div style="padding:16px;border-radius:var(--radius);background:var(--bg3);border-left:3px solid ${utilidadNeta >= 0 ? 'var(--green)' : 'var(--red)'}">
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">Estado de resultados</div>
      <div style="font-size:13px;color:var(--text3);margin-bottom:12px">Período: ${fechaIni} al ${fechaFin}</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">
        <div class="stat-card"><div class="stat-num" style="color:var(--green);font-size:14px">L. ${fmtL(totalIngresos)}</div><div class="stat-label">Ingresos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--red);font-size:14px">L. ${fmtL(totalCostos)}</div><div class="stat-label">Costos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--blue);font-size:14px">L. ${fmtL(utilidadBruta)}</div><div class="stat-label">Utilidad bruta</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--amber);font-size:14px">L. ${fmtL(totalGastos)}</div><div class="stat-label">Gastos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:${utilidadNeta >= 0 ? 'var(--green)' : 'var(--red)'};font-size:14px">L. ${fmtL(utilidadNeta)}</div><div class="stat-label">${utilidadNeta >= 0 ? 'Utilidad' : 'Pérdida'} neta</div></div>
      </div>
    </div>`

  document.getElementById('er-tabla').innerHTML = `
    <table>
      <thead><tr><th>Código</th><th>Cuenta</th><th style="text-align:right">Monto</th><th style="text-align:right">Subtotal</th></tr></thead>
      <tbody>
        ${renderSeccion('INGRESOS', ingresos, 'var(--green)', '+')}
        ${renderSeccion('COSTOS DE VENTA', invertir(costos), 'var(--red)', '-')}
        <tr style="background:rgba(59,130,246,0.08);font-weight:600">
          <td colspan="3" style="text-align:right;color:var(--blue)">UTILIDAD BRUTA</td>
          <td style="text-align:right;font-family:var(--mono);color:var(--blue)">L. ${fmtL(utilidadBruta)}</td>
        </tr>
        ${renderSeccion('GASTOS OPERATIVOS', invertir(gastos), 'var(--amber)', '-')}
        <tr style="background:${utilidadNeta >= 0 ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'};font-weight:700">
          <td colspan="3" style="text-align:right;color:${utilidadNeta >= 0 ? 'var(--green)' : 'var(--red)'}">${utilidadNeta >= 0 ? 'UTILIDAD NETA' : 'PÉRDIDA NETA'}</td>
          <td style="text-align:right;font-family:var(--mono);font-size:16px;color:${utilidadNeta >= 0 ? 'var(--green)' : 'var(--red)'}">L. ${fmtL(Math.abs(utilidadNeta))}</td>
        </tr>
      </tbody>
    </table>`

  document.getElementById('er-resultado').classList.remove('hidden')
  document.getElementById('btn-er-xlsx').style.display = ''
  btn.disabled = false; btn.textContent = 'Consultar →'
}

// ── DRILL-DOWN: Estado de Resultados → Auxiliar → Estado de Resultados ──

let erDrillState = null

window.erDrillDown = async (codigo) => {
  if (!codigo || codigo === '🔒') return

  const cuenta = getCatalogo().find(c => c.codigo === codigo)
  if (!cuenta) { toast('Cuenta no encontrada en el catálogo: ' + codigo, 'error'); return }

  // Guardar el estado completo del ER (filtros + render + datos) para restaurarlo al regresar
  const savedState = {
    fechaIni: document.getElementById('er-fecha-ini').value,
    fechaFin: document.getElementById('er-fecha-fin').value,
    centroId: document.getElementById('er-centro').value,
    libro: document.getElementById('er-libro').value,
    resumenHTML: document.getElementById('er-resumen').innerHTML,
    tablaHTML: document.getElementById('er-tabla').innerHTML,
    scroll: document.getElementById('er-tabla').scrollTop,
    erDataSnapshot: erData
  }

  // Navegar al auxiliar (initAuxiliar resetea campos y limpia erDrillState)
  showView('auxiliar', 'Auxiliar de cuentas')
  erDrillState = savedState

  // Heredar los mismos filtros del ER
  document.getElementById('aux-fecha-ini').value = savedState.fechaIni
  document.getElementById('aux-fecha-fin').value = savedState.fechaFin
  document.getElementById('aux-libro').value = savedState.libro || 'todos'
  document.getElementById('aux-estado').value = 'aprobada' // el ER solo suma partidas aprobadas
  const selCentro = document.getElementById('aux-centro')
  selCentro.value = savedState.centroId || ''
  if (selCentro.value !== (savedState.centroId || '')) selCentro.value = '' // centro no disponible en el select

  // Seleccionar la cuenta (siempre como cuenta única: el ER agrupa por código exacto de línea)
  selectAuxCuenta(cuenta.id, cuenta.codigo, cuenta.nombre, false)

  // Consultar automáticamente
  await generarAuxiliar()
}

function injectAuxBackBtn() {
  if (!erDrillState) return
  if (document.getElementById('btn-volver-er')) return
  const resumen = document.getElementById('aux-resumen')
  if (!resumen) return
  const div = document.createElement('div')
  div.id = 'btn-volver-er'
  div.style.cssText = 'margin-bottom:12px'
  div.innerHTML = `<button class="btn btn-ghost" onclick="volverAEstadoResultados()" style="border:1px solid var(--gold);color:var(--gold)">← Regresar al Estado de Resultados</button>
    <span style="font-size:12px;color:var(--text3);margin-left:10px">Se conservan los filtros y resultados del reporte anterior</span>`
  resumen.parentNode.insertBefore(div, resumen)
}

window.volverAEstadoResultados = () => {
  const st = erDrillState
  erDrillState = null
  document.getElementById('btn-volver-er')?.remove()

  showView('estado-resultados', 'Estado de resultados') // initEstadoResultados resetea la vista

  if (!st) return // no había estado guardado: queda la vista limpia

  // Restaurar filtros
  document.getElementById('er-fecha-ini').value = st.fechaIni
  document.getElementById('er-fecha-fin').value = st.fechaFin
  document.getElementById('er-centro').value = st.centroId || ''
  document.getElementById('er-libro').value = st.libro || 'todos'

  // Restaurar render y datos sin re-consultar
  document.getElementById('er-resumen').innerHTML = st.resumenHTML
  document.getElementById('er-tabla').innerHTML = st.tablaHTML
  document.getElementById('er-resultado').classList.remove('hidden')
  document.getElementById('btn-er-xlsx').style.display = ''
  erData = st.erDataSnapshot
  requestAnimationFrame(() => { const t = document.getElementById('er-tabla'); if (t) t.scrollTop = st.scroll || 0 })
}

window.exportarERXLSX = () => {
  if (!erData) return
  const { ingresos, costos, gastos, totalIngresos, totalCostos, totalGastos, utilidadBruta, utilidadNeta, fechaIni, fechaFin } = erData
  const rows = [
    ['ESTADO DE RESULTADOS — CONTAMAX'],
    [`Período: ${fechaIni} al ${fechaFin}`],
    [],
    ['Código', 'Cuenta', 'Monto'],
    ['', 'INGRESOS', ''],
    ...ingresos.map(c => [c._privado ? '🔒' : c.codigo, c.nombre, Math.round(c.saldo * 100) / 100]),
    ['', 'Total ingresos', totalIngresos],
    [],
    ['', 'COSTOS DE VENTA', ''],
    ...costos.map(c => [c._privado ? '🔒' : c.codigo, c.nombre, Math.round(-c.saldo * 100) / 100]),
    ['', 'Total costos', totalCostos],
    [],
    ['', 'UTILIDAD BRUTA', utilidadBruta],
    [],
    ['', 'GASTOS OPERATIVOS', ''],
    ...gastos.map(c => [c._privado ? '🔒' : c.codigo, c.nombre, Math.round(-c.saldo * 100) / 100]),
    ['', 'Total gastos', totalGastos],
    [],
    ['', utilidadNeta >= 0 ? 'UTILIDAD NETA' : 'PÉRDIDA NETA', Math.round(utilidadNeta * 100) / 100],
  ]
  const ws = window.XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 16 }, { wch: 45 }, { wch: 16 }]
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Estado Resultados')
  window.XLSX.writeFile(wb, `Estado_Resultados_${fechaIni}_${fechaFin}.xlsx`)
  toast('Excel exportado ✓', 'success')
}

// ══════════════════════════════════════════════
// ── REPORTE: RENTABILIDAD POR UNIDAD (TAXIS) · vista autoinyectada
// ══════════════════════════════════════════════
let rentUnidades = []
let rentSort = { col: 'neto', dir: 'desc' }

window.ordenarRentabilidad = (col) => {
  if (rentSort.col === col) {
    rentSort.dir = rentSort.dir === 'asc' ? 'desc' : 'asc'
  } else {
    rentSort.col = col
    // por defecto: texto asc, números desc
    rentSort.dir = (col === 'registro' || col === 'modalidad') ? 'asc' : 'desc'
  }
  renderRentabilidad()
}

function ensureRentabilidadView() {
  if (document.getElementById('view-rentabilidad-taxis')) return
  const anyView = document.querySelector('.view')
  if (!anyView || !anyView.parentNode) return
  const v = document.createElement('div')
  v.className = 'view'
  v.id = 'view-rentabilidad-taxis'
  anyView.parentNode.appendChild(v)
}

window.initRentabilidadTaxis = async function () {
  ensureRentabilidadView()
  const view = document.getElementById('view-rentabilidad-taxis')
  if (view && !view.classList.contains('active')) {
    document.querySelectorAll('.view').forEach(x => x.classList.remove('active'))
    view.classList.add('active')
  }
  const hoy = new Date()
  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toLocaleDateString('en-CA')
  const fin = hoy.toLocaleDateString('en-CA')

  // Cargar lista de propietarios para el filtro
  const { data: unidades } = await getSb().from('unidades_taxis').select('propietario').eq('activo', true)
  const props = [...new Set((unidades || []).map(u => u.propietario).filter(Boolean))].sort()

  view.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">📊 Rentabilidad por unidad</div>
        <div class="page-sub">Ingresos y egresos por taxi en un rango de fechas</div>
      </div>
      <button class="btn btn-ghost" id="btn-rent-xlsx" style="display:none" onclick="exportRentabilidadXlsx()">📊 Exportar Excel</button>
    </div>

    <div class="form-card" style="margin-bottom:16px">
      <div style="display:flex;gap:14px;align-items:end;flex-wrap:wrap">
        <div class="fld"><label>Fecha inicio</label><input type="date" id="rent-desde" value="${ini}"></div>
        <div class="fld"><label>Fecha fin</label><input type="date" id="rent-hasta" value="${fin}"></div>
        <div class="fld" style="min-width:200px">
          <label>Propietario</label>
          <select id="rent-prop">
            <option value="">Todos los propietarios</option>
            ${props.map(p => `<option value="${p}">${p}</option>`).join('')}
          </select>
        </div>
        <div class="fld" style="min-width:140px">
          <label>Modalidad</label>
          <select id="rent-mod">
            <option value="">Todas</option>
            <option value="TAXI">TAXI</option>
            <option value="VIP">VIP</option>
            <option value="BUS">BUS</option>
            <option value="PARTICULAR">PARTICULAR</option>
          </select>
        </div>
        <button class="btn btn-gold" id="btn-rent-consultar" onclick="consultarRentabilidad()">Consultar →</button>
      </div>
    </div>

    <div id="rent-resumen" style="margin-bottom:16px"></div>
    <div class="table-wrap" id="rent-tabla"></div>`
}

window.consultarRentabilidad = async function () {
  const desde = document.getElementById('rent-desde').value
  const hasta = document.getElementById('rent-hasta').value
  const propFilter = document.getElementById('rent-prop').value
  const modFilter = document.getElementById('rent-mod').value
  if (!desde || !hasta) { window.toast?.('Seleccioná el rango de fechas', 'error'); return }

  const btn = document.getElementById('btn-rent-consultar')
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando...' }
  const tabla = document.getElementById('rent-tabla')
  tabla.innerHTML = '<div style="text-align:center;padding:24px"><div class="spinner"></div></div>'

  try {
    const sb = getSb()
    // 1) Unidades filtradas
    let q = sb.from('unidades_taxis').select('registro, modalidad, propietario, motorista').eq('activo', true)
    if (propFilter) q = q.eq('propietario', propFilter)
    if (modFilter) q = q.eq('modalidad', modFilter)
    const { data: unidades } = await q.order('registro')
    const regs = new Set((unidades || []).map(u => u.registro))

    // Helper: traer TODAS las filas paginando (Supabase corta en 1000 por defecto)
    const fetchAll = async (build) => {
      let all = [], from = 0, size = 1000
      while (true) {
        const { data, error } = await build().range(from, from + size - 1)
        if (error || !data || !data.length) break
        all.push(...data)
        if (data.length < size) break
        from += size
      }
      return all
    }

    // 2) TODAS las entregas del rango (paginado)
    const entregas = await fetchAll(() => sb.from('entregas_taxis')
      .select('unidad, monto').gte('fecha_deposito', desde).lte('fecha_deposito', hasta))

    // 3) TODAS las facturas (gasto) del rango (paginado)
    const facturas = await fetchAll(() => sb.from('facturas_taxis')
      .select('registro, monto').gte('fecha', desde).lte('fecha', hasta))

    // 4) TODAS las líneas de partidas aprobadas del rango que tengan centro de costo
    const partidasRango = await fetchAll(() => sb.from('partidas_contables')
      .select('id, descripcion').eq('estado', 'aprobada')
      .gte('fecha_partida', desde).lte('fecha_partida', hasta))
    const partidaMap = Object.fromEntries((partidasRango || []).map(p => [p.id, p]))
    const pIds = (partidasRango || []).map(p => p.id)
    let lineas = []
    // Traer en lotes de 200 ids para no exceder límites de URL
    for (let i = 0; i < pIds.length; i += 200) {
      const chunk = pIds.slice(i, i + 200)
      const data = await fetchAll(() => sb.from('lineas_partida')
        .select('descripcion, monto, tipo, cuenta_codigo, centro_costo_id, partida_id')
        .in('partida_id', chunk))
      if (data?.length) lineas.push(...data)
    }
    // Solo líneas con centro de costo (excluye bancos/caja)
    lineas = lineas.filter(l => l.centro_costo_id)

    // ── Acumular por unidad ──
    // Normalizamos la clave a solo dígitos para que coincida sin importar
    // si viene como número, texto, con espacios o ceros (ej. 7036, "7036", " 7036").
    const keyOf = (v) => String(v ?? '').replace(/\D/g, '')
    const acc = {}
    for (const u of (unidades || [])) acc[keyOf(u.registro)] = { ingresos: 0, egresos: 0 }

    for (const e of (entregas || [])) {
      const k = keyOf(e.unidad)
      if (acc[k]) acc[k].ingresos += parseFloat(e.monto) || 0
    }
    for (const f of (facturas || [])) {
      const k = keyOf(f.registro)
      if (acc[k]) acc[k].egresos += parseFloat(f.monto) || 0
    }
    // Líneas de partida: emparejar la unidad por su número en la descripción
    const esIngreso = (l) => l.tipo === 'credito' && String(l.cuenta_codigo || '').startsWith('4')
    for (const l of lineas) {
      const texto = ((l.descripcion || '') + ' ' + (partidaMap[l.partida_id]?.descripcion || '')).toUpperCase()
      // Detectar registro: "TAXI 1234", "VIP 1234", "T_1234", etc.
      const m = texto.match(/(?:TAXI|VIP|T_)\s*[_ ]?\s*(\d{3,5})/)
      if (!m) continue
      const k = keyOf(m[1])
      if (!acc[k]) continue
      const monto = parseFloat(l.monto) || 0
      if (esIngreso(l)) acc[k].ingresos += monto
      else acc[k].egresos += monto
    }

    rentUnidades = (unidades || []).map(u => {
      const a = acc[keyOf(u.registro)] || { ingresos: 0, egresos: 0 }
      return { ...u, totalIngresos: a.ingresos, totalEgresos: a.egresos, neto: a.ingresos - a.egresos }
    }).sort((x, y) => y.neto - x.neto)

    renderRentabilidad()
  } catch (e) {
    console.error('consultarRentabilidad:', e)
    tabla.innerHTML = '<div style="text-align:center;padding:24px;color:var(--red)">Error al consultar</div>'
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Consultar →' }
  }
}

function renderRentabilidad() {
  const tabla = document.getElementById('rent-tabla')
  const totI = rentUnidades.reduce((s, u) => s + u.totalIngresos, 0)
  const totE = rentUnidades.reduce((s, u) => s + u.totalEgresos, 0)
  const totN = totI - totE

  document.getElementById('rent-resumen').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      <div class="stat-card"><div class="stat-num" style="font-size:18px">${rentUnidades.length}</div><div class="stat-label">Unidades</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green);font-size:18px">L. ${fmtL(totI)}</div><div class="stat-label">Ingresos</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);font-size:18px">L. ${fmtL(totE)}</div><div class="stat-label">Egresos</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${totN >= 0 ? 'var(--green)' : 'var(--red)'};font-size:18px">L. ${fmtL(totN)}</div><div class="stat-label">${totN >= 0 ? 'Utilidad' : 'Pérdida'}</div></div>
    </div>`

  if (!rentUnidades.length) {
    tabla.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3)">Sin unidades para los filtros seleccionados</div>'
    document.getElementById('btn-rent-xlsx').style.display = 'none'
    return
  }
  document.getElementById('btn-rent-xlsx').style.display = ''

  // Ordenar según la columna/dirección seleccionada
  const { col, dir } = rentSort
  const mult = dir === 'asc' ? 1 : -1
  const ordenadas = [...rentUnidades].sort((a, b) => {
    let va, vb
    if (col === 'registro') { va = a.registro; vb = b.registro }
    else if (col === 'modalidad') { va = a.modalidad || ''; vb = b.modalidad || '' }
    else if (col === 'ingresos') { va = a.totalIngresos; vb = b.totalIngresos }
    else if (col === 'egresos') { va = a.totalEgresos; vb = b.totalEgresos }
    else { va = a.neto; vb = b.neto }
    if (typeof va === 'string') return va.localeCompare(vb) * mult
    return (va - vb) * mult
  })

  const flecha = (c) => rentSort.col === c ? (rentSort.dir === 'asc' ? ' ▲' : ' ▼') : ''
  const th = (c, label, align) => `<th style="cursor:pointer;user-select:none;${align ? 'text-align:' + align : ''}" onclick="ordenarRentabilidad('${c}')">${label}${flecha(c)}</th>`

  tabla.innerHTML = `
    <table style="width:100%">
      <thead><tr>
        ${th('registro', 'Unidad')}
        ${th('modalidad', 'Modalidad')}
        <th>Propietario</th><th>Motorista</th>
        ${th('ingresos', 'Ingresos', 'right')}
        ${th('egresos', 'Egresos', 'right')}
        ${th('neto', 'Total', 'right')}
      </tr></thead>
      <tbody>
        ${ordenadas.map(u => `
          <tr style="cursor:pointer" onclick="verDetalleUnidad(${u.registro}, document.getElementById('rent-desde').value, document.getElementById('rent-hasta').value)">
            <td style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--gold)">${u.registro}</td>
            <td><span class="badge ${u.modalidad === 'VIP' ? 'badge-blue' : u.modalidad === 'BUS' ? 'badge-green' : u.modalidad === 'PARTICULAR' ? 'badge-red' : 'badge-amber'}">${u.modalidad}</span></td>
            <td style="font-size:13px">${u.propietario || '—'}</td>
            <td style="font-size:13px;color:var(--text3)">${u.motorista || '—'}</td>
            <td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${fmtL(u.totalIngresos)}</td>
            <td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${fmtL(u.totalEgresos)}</td>
            <td style="text-align:right;font-family:var(--mono);font-weight:600;color:${u.neto >= 0 ? 'var(--green)' : 'var(--red)'}">L. ${fmtL(u.neto)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:var(--bg3);font-weight:700">
          <td colspan="4" style="text-align:right">TOTALES</td>
          <td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${fmtL(totI)}</td>
          <td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${fmtL(totE)}</td>
          <td style="text-align:right;font-family:var(--mono);color:${totN >= 0 ? 'var(--green)' : 'var(--red)'}">L. ${fmtL(totN)}</td>
        </tr>
      </tfoot>
    </table>
    <div style="font-size:11px;color:var(--text3);padding:8px 4px">Hacé clic en un encabezado para ordenar · clic en una unidad para ver el detalle.</div>`
}

window.exportRentabilidadXlsx = function () {
  if (!rentUnidades.length || !window.XLSX) return
  const desde = document.getElementById('rent-desde').value
  const hasta = document.getElementById('rent-hasta').value
  const rows = [
    ['RENTABILIDAD POR UNIDAD'],
    [`Período: ${desde} a ${hasta}`],
    [],
    ['Unidad', 'Modalidad', 'Propietario', 'Motorista', 'Ingresos', 'Egresos', 'Total'],
    ...rentUnidades.map(u => [u.registro, u.modalidad, u.propietario || '', u.motorista || '',
      Math.round(u.totalIngresos * 100) / 100, Math.round(u.totalEgresos * 100) / 100, Math.round(u.neto * 100) / 100]),
    [],
    ['', '', '', 'TOTALES',
      Math.round(rentUnidades.reduce((s, u) => s + u.totalIngresos, 0) * 100) / 100,
      Math.round(rentUnidades.reduce((s, u) => s + u.totalEgresos, 0) * 100) / 100,
      Math.round(rentUnidades.reduce((s, u) => s + u.neto, 0) * 100) / 100]
  ]
  const ws = window.XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Rentabilidad')
  window.XLSX.writeFile(wb, `Rentabilidad_Unidades_${desde}_${hasta}.xlsx`)
  window.toast?.('Excel exportado ✓', 'success')
}