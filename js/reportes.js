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

  // Llenar centros de costo (sin privados para no-super_admin)
  const sel = document.getElementById('aux-centro')
  sel.innerHTML = '<option value="">Todos</option>' + getEmpresasReporte().map(e => `<option value="${e.id}">${e.nombre}</option>`).join('')
}

window.openAuxCuentaDD = () => {
  const dd = document.getElementById('aux-cuenta-dd')
  dd.style.display = 'block'
  filterAuxCuentas('')
}

window.filterAuxCuentas = (val) => {
  const dd = document.getElementById('aux-cuenta-dd')
  const term = (val || '').toLowerCase()
  const filtered = getCatalogo()
    .filter(c => c.es_detalle && c.activa)
    .filter(c => !term || c.codigo.toLowerCase().includes(term) || c.nombre.toLowerCase().includes(term))
    .slice(0, 30)

  dd.innerHTML = filtered.length ? filtered.map(c => `
    <div class="cuenta-opt" onclick="selectAuxCuenta('${c.id}','${c.codigo}','${c.nombre.replace(/'/g, '')}')">
      <span style="color:var(--gold);font-family:var(--mono)">${c.codigo}</span> ${c.nombre}
    </div>`).join('') : '<div style="padding:10px;color:var(--text3);font-size:12px">No se encontraron cuentas</div>'
}

window.selectAuxCuenta = (id, codigo, nombre) => {
  document.getElementById('aux-cuenta-input').value = `${codigo} ${nombre}`
  document.getElementById('aux-cuenta-id').value = id
  document.getElementById('aux-cuenta-dd').style.display = 'none'
}

// Cerrar dropdown al hacer click fuera
document.addEventListener('click', (e) => {
  if (!e.target.closest('#aux-cuenta-input') && !e.target.closest('#aux-cuenta-dd')) {
    const dd = document.getElementById('aux-cuenta-dd')
    if (dd) dd.style.display = 'none'
  }
})

window.generarAuxiliar = async () => {
  const fechaIni = document.getElementById('aux-fecha-ini').value
  const fechaFin = document.getElementById('aux-fecha-fin').value
  const cuentaId = document.getElementById('aux-cuenta-id').value
  const centroId = document.getElementById('aux-centro').value
  const libro = document.getElementById('aux-libro').value
  const estadoFiltro = document.getElementById('aux-estado').value

  if (!fechaIni || !fechaFin) { toast('Selecciona rango de fechas', 'error'); return }
  if (!cuentaId) { toast('Selecciona una cuenta contable', 'error'); return }

  // ── Privacidad: bloquear cuentas de caja/banco para no super_admin ──
  const cuentaInput = document.getElementById('aux-cuenta-input').value || ''
  const codigoCuenta = cuentaInput.split(' ')[0]
  if (esCuentaSensible(codigoCuenta) && !puedeVerSensibles()) {
    toast('Solo el Super Admin puede consultar saldos de caja y bancos', 'error')
    return
  }

  // ── Privacidad: bloquear auxiliar filtrado por centro privado si no es super_admin ──
  if (centroId && !esSuperAdmin()) {
    const idsPriv = getIdsPrivados()
    if (idsPriv.has(centroId)) {
      toast('No tienes acceso al detalle de este centro de costo', 'error')
      return
    }
  }

  const btn = document.getElementById('btn-auxiliar')
  btn.disabled = true; btn.textContent = 'Consultando...'

  // Consultar líneas de partida para la cuenta seleccionada
  let query = getSb().from('lineas_partida')
    .select('*, partida:partidas_contables(id, fecha_partida, numero_partida, descripcion, estado, tipo_origen)')
    .eq('cuenta_id', cuentaId)
    .gte('partida.fecha_partida', fechaIni)
    .lte('partida.fecha_partida', fechaFin)
    .order('id', { ascending: true })

  if (centroId) query = query.eq('centro_costo_id', centroId)
  if (libro === 'fiscal') query = query.eq('aplica_fiscal', true)
  if (libro === 'interno') query = query.eq('aplica_fiscal', false)

  const { data: lineas, error } = await query.limit(5000)
  if (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; btn.textContent = 'Consultar →'; return }

  // Filtrar por estado de partida y eliminar registros sin partida válida
  let filtered = (lineas || []).filter(l => l.partida && l.partida.fecha_partida)
  if (estadoFiltro !== 'todos') {
    filtered = filtered.filter(l => l.partida.estado === estadoFiltro)
  }

  // ── Privacidad: si consulta es "Todos" y no es super_admin, excluir líneas de centros privados ──
  if (!centroId && !esSuperAdmin()) {
    const idsPriv = getIdsPrivados()
    filtered = filtered.filter(l => !l.centro_costo_id || !idsPriv.has(l.centro_costo_id))
  }

  // Ordenar por fecha
  filtered.sort((a, b) => {
    const da = a.partida.fecha_partida
    const db = b.partida.fecha_partida
    if (da !== db) return da.localeCompare(db)
    return (a.partida.numero_partida || 0) - (b.partida.numero_partida || 0)
  })

  // Obtener info de la cuenta
  const cuenta = getCatalogo().find(c => c.id === cuentaId)
  const naturaleza = cuenta?.naturaleza || 'deudora'

  // Calcular saldo progresivo
  let saldo = 0
  const movimientos = filtered.map(l => {
    const debe = l.tipo === 'debito' ? parseFloat(l.monto) || 0 : 0
    const haber = l.tipo === 'credito' ? parseFloat(l.monto) || 0 : 0
    if (naturaleza === 'deudora') { saldo += debe - haber }
    else { saldo += haber - debe }
    return {
      fecha: l.partida.fecha_partida,
      partida: l.partida.numero_partida || '—',
      partidaId: l.partida.id,
      descripcion: l.descripcion || l.partida.descripcion || '',
      origen: l.partida.tipo_origen || '',
      documento: l.numero_documento || '',
      debe,
      haber,
      saldo: Math.round(saldo * 100) / 100,
      fiscal: l.aplica_fiscal,
      estado: l.partida.estado
    }
  })

  const totalDebe = movimientos.reduce((s, m) => s + m.debe, 0)
  const totalHaber = movimientos.reduce((s, m) => s + m.haber, 0)

  auxData = { movimientos, cuenta, fechaIni, fechaFin, totalDebe, totalHaber, saldoFinal: saldo }

  // Render resumen
  document.getElementById('aux-resumen').innerHTML = `
    <div style="padding:16px;border-radius:var(--radius);background:var(--bg3);border-left:3px solid var(--gold)">
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">${cuenta?.codigo} — ${cuenta?.nombre}</div>
      <div style="font-size:13px;color:var(--text3);margin-bottom:12px">Período: ${fechaIni} al ${fechaFin} · Naturaleza: ${naturaleza} · ${movimientos.length} movimientos</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <div class="stat-card"><div class="stat-num" style="color:var(--green)">L. ${fmtL(totalDebe)}</div><div class="stat-label">Total débitos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--red)">L. ${fmtL(totalHaber)}</div><div class="stat-label">Total créditos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--gold)">L. ${fmtL(Math.abs(saldo))}</div><div class="stat-label">Saldo ${saldo >= 0 ? (naturaleza === 'deudora' ? 'deudor' : 'acreedor') : (naturaleza === 'deudora' ? 'acreedor' : 'deudor')}</div></div>
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
      <tbody id="aux-tbody">${movimientos.map((m, i) => `
        <tr style="cursor:pointer" data-idx="${i}" data-desc="${(m.descripcion||'').toLowerCase()}" onclick="editarPartida('${m.partidaId}')">
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
  btn.disabled = false; btn.textContent = 'Consultar →'
}

window.exportarAuxiliarXLSX = () => {
  if (!auxData) return
  const { movimientos, cuenta, fechaIni, fechaFin, totalDebe, totalHaber, saldoFinal } = auxData
  const rows = [
    ['AUXILIAR DE CUENTAS — CONTAMAX'],
    [`Cuenta: ${cuenta.codigo} — ${cuenta.nombre}`],
    [`Período: ${fechaIni} al ${fechaFin}`],
    [],
    ['Fecha', 'N° Partida', 'Descripción', 'Origen', 'Debe', 'Haber', 'Saldo'],
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

  // Traer todas las líneas del período
  let query = getSb().from('lineas_partida')
    .select('cuenta_id, cuenta_codigo, cuenta_nombre, tipo, monto, aplica_fiscal, centro_costo_id, partida:partidas_contables(fecha_partida, estado)')
    .gte('partida.fecha_partida', fechaIni)
    .lte('partida.fecha_partida', fechaFin)

  if (centroId) query = query.eq('centro_costo_id', centroId)
  if (libro === 'fiscal') query = query.eq('aplica_fiscal', true)
  if (libro === 'interno') query = query.eq('aplica_fiscal', false)

  const { data: lineas, error } = await query.limit(50000)
  if (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; btn.textContent = 'Consultar →'; return }

  // Solo partidas aprobadas con fecha válida
  const validas = (lineas || []).filter(l => l.partida?.estado === 'aprobada' && l.partida?.fecha_partida)

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

  let query = getSb().from('lineas_partida')
    .select('cuenta_id, cuenta_codigo, cuenta_nombre, tipo, monto, aplica_fiscal, centro_costo_id, partida:partidas_contables(fecha_partida, estado)')
    .gte('partida.fecha_partida', fechaIni)
    .lte('partida.fecha_partida', fechaFin)

  if (centroId) query = query.eq('centro_costo_id', centroId)
  if (libro === 'fiscal') query = query.eq('aplica_fiscal', true)
  if (libro === 'interno') query = query.eq('aplica_fiscal', false)

  const { data: lineas, error } = await query.limit(50000)
  if (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; btn.textContent = 'Consultar →'; return }

  const validas = (lineas || []).filter(l => l.partida?.estado === 'aprobada' && l.partida?.fecha_partida)

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
  const totalCostos = costos.reduce((s, c) => s + Math.abs(c.saldo), 0)
  const totalGastos = gastos.reduce((s, c) => s + Math.abs(c.saldo), 0)
  const utilidadBruta = totalIngresos - totalCostos
  const utilidadNeta = utilidadBruta - totalGastos

  erData = { ingresos, costos, gastos, totalIngresos, totalCostos, totalGastos, utilidadBruta, utilidadNeta, fechaIni, fechaFin }

  const renderSeccion = (titulo, items, color, signo) => {
    if (items.length === 0) return ''
    const total = items.reduce((s, c) => s + Math.abs(c.saldo), 0)
    return `
      <tr style="background:var(--bg3)"><td colspan="4" style="font-weight:600;color:${color};padding:10px 14px">${titulo}</td></tr>
      ${items.map(c => `<tr${c._privado ? ' style="background:rgba(239,68,68,0.04)"' : ''}>
        <td style="font-family:var(--mono);color:var(--gold);font-size:12px;padding-left:24px">${c.codigo}</td>
        <td>${c.nombre}</td>
        <td style="text-align:right;font-family:var(--mono)">${fmtL(Math.abs(c.saldo))}</td>
        <td></td>
      </tr>`).join('')}
      <tr style="border-top:1px solid var(--border)">
        <td></td><td style="text-align:right;font-weight:500">Total ${titulo.toLowerCase()}</td>
        <td></td><td style="text-align:right;font-family:var(--mono);font-weight:600;color:${color}">L. ${fmtL(total)}</td>
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
        ${renderSeccion('COSTOS DE VENTA', costos, 'var(--red)', '-')}
        <tr style="background:rgba(59,130,246,0.08);font-weight:600">
          <td colspan="3" style="text-align:right;color:var(--blue)">UTILIDAD BRUTA</td>
          <td style="text-align:right;font-family:var(--mono);color:var(--blue)">L. ${fmtL(utilidadBruta)}</td>
        </tr>
        ${renderSeccion('GASTOS OPERATIVOS', gastos, 'var(--amber)', '-')}
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

window.exportarERXLSX = () => {
  if (!erData) return
  const { ingresos, costos, gastos, totalIngresos, totalCostos, totalGastos, utilidadBruta, utilidadNeta, fechaIni, fechaFin } = erData
  const rows = [
    ['ESTADO DE RESULTADOS — CONTAMAX'],
    [`Período: ${fechaIni} al ${fechaFin}`],
    [],
    ['Código', 'Cuenta', 'Monto'],
    ['', 'INGRESOS', ''],
    ...ingresos.map(c => [c._privado ? '🔒' : c.codigo, c.nombre, Math.abs(c.saldo)]),
    ['', 'Total ingresos', totalIngresos],
    [],
    ['', 'COSTOS DE VENTA', ''],
    ...costos.map(c => [c._privado ? '🔒' : c.codigo, c.nombre, Math.abs(c.saldo)]),
    ['', 'Total costos', totalCostos],
    [],
    ['', 'UTILIDAD BRUTA', utilidadBruta],
    [],
    ['', 'GASTOS OPERATIVOS', ''],
    ...gastos.map(c => [c._privado ? '🔒' : c.codigo, c.nombre, Math.abs(c.saldo)]),
    ['', 'Total gastos', totalGastos],
    [],
    ['', utilidadNeta >= 0 ? 'UTILIDAD NETA' : 'PÉRDIDA NETA', Math.abs(utilidadNeta)],
  ]
  const ws = window.XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 16 }, { wch: 45 }, { wch: 16 }]
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Estado Resultados')
  window.XLSX.writeFile(wb, `Estado_Resultados_${fechaIni}_${fechaFin}.xlsx`)
  toast('Excel exportado ✓', 'success')
}