// ══════════════════════════════════════════════
// ── MÓDULO FINANCIAMIENTO · js/financiamiento.js
// ── Sistema de préstamos a motoristas
// ── Depende de: window._sb, window._currentProfile, window.toast, window.closeModal
// ══════════════════════════════════════════════

const getSb = () => window._sb
const getFmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── STATE ──
let allPrestamos = []
let filteredPrestamos = []
let selectedPrestamo = null

// ══════════════════════════════════════════════
// ── CARGAR PRÉSTAMOS ──
// ══════════════════════════════════════════════

window.loadFinanciamiento = async () => {
  const tbody = document.getElementById('tbody-financiamiento')
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'

  const { data, error } = await getSb().from('prestamos_taxis')
    .select('*')
    .eq('activo', true)
    .order('categoria')
    .order('codigo')

  if (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--red);padding:30px">${error.message}</td></tr>`
    return
  }

  allPrestamos = data || []

  // Stats
  const totalSaldo = allPrestamos.reduce((s, p) => s + (parseFloat(p.saldo_actual) || 0), 0)
  const totalPrestamos = allPrestamos.length
  const categorias = [...new Set(allPrestamos.map(p => p.categoria))].length
  const morosos = allPrestamos.filter(p => p.dias_sin_pago > 30).length

  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v }
  el('fin-stat-total', totalPrestamos)
  el('fin-stat-saldo', 'L. ' + getFmt(totalSaldo))
  el('fin-stat-cats', categorias)
  el('fin-stat-morosos', morosos)

  // Poblar filtros
  const catSelect = document.getElementById('fin-filtro-cat')
  if (catSelect) {
    const cats = [...new Set(allPrestamos.map(p => p.categoria))].sort()
    catSelect.innerHTML = '<option value="">Todas</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('')
  }

  filtrarPrestamos()
}

window.filtrarPrestamos = () => {
  const term = (document.getElementById('fin-buscar')?.value || '').toLowerCase().trim()
  const catFilter = document.getElementById('fin-filtro-cat')?.value || ''

  filteredPrestamos = allPrestamos.filter(p => {
    if (catFilter && p.categoria !== catFilter) return false
    if (term) {
      const searchable = `${p.codigo} ${p.motorista} ${p.categoria} ${p.notas || ''}`.toLowerCase()
      return searchable.includes(term)
    }
    return true
  })

  renderPrestamosTable()
}

function renderPrestamosTable() {
  const tbody = document.getElementById('tbody-financiamiento')
  if (!tbody) return
  if (!filteredPrestamos.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text3)">No se encontraron préstamos</td></tr>'
    return
  }

  const profile = window._currentProfile ? window._currentProfile() : null
  const esSA = profile?.rol === 'super_admin'

  tbody.innerHTML = filteredPrestamos.map(p => {
    const saldo = parseFloat(p.saldo_actual) || 0
    const diasColor = p.dias_sin_pago > 30 ? 'var(--red)' : p.dias_sin_pago > 15 ? 'var(--amber)' : 'var(--green)'
    const fechaUlt = p.fecha_ultimo_pago ? new Date(p.fecha_ultimo_pago + 'T12:00:00').toLocaleDateString('es-HN') : '—'
    return `
    <tr style="cursor:pointer" onclick="verDetallePrestamo('${p.codigo}')">
      <td style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--gold)">${p.codigo}</td>
      <td style="font-weight:500">${p.motorista || '—'}</td>
      <td><span class="badge badge-blue" style="font-size:10px">${p.categoria}</span></td>
      <td style="text-align:right;font-family:var(--mono);font-weight:600;color:${saldo > 0 ? 'var(--red)' : 'var(--green)'}">L. ${getFmt(saldo)}</td>
      <td style="font-family:var(--mono);text-align:center">${p.num_recibos || 0}</td>
      <td style="font-size:12px;color:var(--text3)">${fechaUlt}</td>
      <td style="text-align:center;font-family:var(--mono);font-weight:500;color:${diasColor}">${p.dias_sin_pago || 0}d</td>
      <td style="text-align:center" onclick="event.stopPropagation()">
        ${esSA ? `
          <button onclick="abrirRecibo('${p.codigo}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="Generar recibo">🧾</button>
          <button onclick="editarPrestamo('${p.codigo}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="Editar">✏️</button>
        ` : `<button onclick="verDetallePrestamo('${p.codigo}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="Ver detalle">👁</button>`}
      </td>
    </tr>`
  }).join('')
}

// ══════════════════════════════════════════════
// ── DETALLE DE PRÉSTAMO ──
// ══════════════════════════════════════════════

window.verDetallePrestamo = async (codigo) => {
  const p = allPrestamos.find(x => x.codigo === codigo)
  if (!p) return

  document.getElementById('modal-detalle-prestamo-title').textContent = `🧾 Préstamo #${codigo} · ${p.motorista || p.categoria}`
  document.getElementById('modal-detalle-prestamo').classList.add('open')

  const info = document.getElementById('dp-info')
  info.innerHTML = `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:14px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      <div><span style="color:var(--text3);font-size:11px">Código</span><div style="font-family:var(--mono);font-weight:600;color:var(--gold)">${p.codigo}</div></div>
      <div><span style="color:var(--text3);font-size:11px">Motorista</span><div>${p.motorista || '—'}</div></div>
      <div><span style="color:var(--text3);font-size:11px">Categoría</span><div><span class="badge badge-blue">${p.categoria}</span></div></div>
      <div><span style="color:var(--text3);font-size:11px">Saldo actual</span><div style="font-family:var(--mono);font-weight:700;font-size:18px;color:var(--red)">L. ${getFmt(p.saldo_actual)}</div></div>
    </div>`

  // Cargar historial de recibos
  const contenido = document.getElementById('dp-contenido')
  contenido.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>'

  const { data: recibos } = await getSb().from('recibos_prestamos')
    .select('*')
    .eq('registro', codigo)
    .order('fecha', { ascending: false })

  if (!recibos?.length) {
    contenido.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3)">No hay recibos emitidos para este préstamo</div>'
    return
  }

  contenido.innerHTML = `
    <div class="table-wrap" style="overflow-x:auto">
      <div class="table-header"><span class="table-title">Historial de recibos (${recibos.length})</span></div>
      <table>
        <thead><tr>
          <th>#</th><th>Fecha</th><th style="text-align:right">Monto</th>
          <th style="text-align:right">Capital</th><th style="text-align:right">Intereses</th>
          <th style="text-align:right">Facturas</th><th style="text-align:right">Alq/Seguro</th>
          <th style="text-align:right">GPS</th>
          <th style="text-align:right">Saldo inicial</th><th style="text-align:right">Saldo final</th>
          <th>Concepto</th>
        </tr></thead>
        <tbody>${recibos.map(r => `
          <tr>
            <td style="font-family:var(--mono);color:var(--gold)">${r.numero_recibo}</td>
            <td style="font-family:var(--mono);font-size:12px">${r.fecha || '—'}</td>
            <td style="text-align:right;font-family:var(--mono);font-weight:500">L. ${getFmt(r.monto_recibo)}</td>
            <td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${getFmt(r.capital)}</td>
            <td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${getFmt(r.intereses)}</td>
            <td style="text-align:right;font-family:var(--mono);color:var(--amber)">${r.facturas ? 'L. ' + getFmt(r.facturas) : '—'}</td>
            <td style="text-align:right;font-family:var(--mono)">${r.numero_alquiler ? 'L. ' + getFmt(Math.abs(r.numero_alquiler)) : '—'}</td>
            <td style="text-align:right;font-family:var(--mono)">${r.gps ? 'L. ' + getFmt(Math.abs(r.gps)) : '—'}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">L. ${getFmt(r.saldo_inicial)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">L. ${getFmt(r.saldo_actual)}</td>
            <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text3)" title="${r.concepto || ''}">${r.concepto || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`
}

// ══════════════════════════════════════════════
// ── GENERAR RECIBO ──
// ══════════════════════════════════════════════

window.abrirRecibo = async (codigo) => {
  const p = allPrestamos.find(x => x.codigo === codigo)
  if (!p) return
  selectedPrestamo = p

  const saldo = parseFloat(p.saldo_actual) || 0
  const tasa = parseFloat(p.tasa_interes) || 0.03
  const intereses = Math.round(saldo * tasa * 100) / 100

  // Determine if TAXI or VIP for label
  const esTaxi = (p.categoria || '').toUpperCase().includes('TAXI')

  document.getElementById('modal-recibo-title').textContent = `🧾 Generar recibo · #${codigo}`
  document.getElementById('rec-codigo').textContent = codigo
  document.getElementById('rec-motorista').textContent = p.motorista || '—'
  document.getElementById('rec-saldo').textContent = 'L. ' + getFmt(saldo)
  document.getElementById('rec-tasa').textContent = (tasa * 100).toFixed(2) + '%'
  document.getElementById('rec-intereses-calc').textContent = 'L. ' + getFmt(intereses)

  // Update labels based on category
  document.getElementById('rec-label-seguro').textContent = esTaxi ? 'Alquiler de número' : 'Cuota seguro'

  document.getElementById('rec-fecha').value = new Date().toISOString().split('T')[0]
  document.getElementById('rec-intereses').value = intereses.toFixed(2)

  // Load values from last receipt or from prestamo defaults
  const { data: lastRecibo } = await getSb().from('recibos_prestamos')
    .select('gps, numero_alquiler, cuota_mes')
    .eq('registro', codigo)
    .order('fecha', { ascending: false })
    .limit(1)

  const prevGps = lastRecibo?.[0]?.gps ?? p.cuota_gps ?? 0
  const prevSeguro = lastRecibo?.[0]?.numero_alquiler ?? p.cuota_seguro ?? 0
  const prevAdmin = p.cuota_admin ?? 0

  document.getElementById('rec-capital').value = ''
  document.getElementById('rec-gps').value = parseFloat(prevGps).toFixed(2)
  document.getElementById('rec-seguro').value = parseFloat(prevSeguro).toFixed(2)
  document.getElementById('rec-admin').value = parseFloat(prevAdmin).toFixed(2)
  document.getElementById('rec-notas').value = ''
  document.getElementById('modal-recibo-error').classList.add('hidden')

  calcRecibo()
  document.getElementById('modal-recibo').classList.add('open')
}

window.calcRecibo = () => {
  const capital = parseFloat(document.getElementById('rec-capital').value) || 0
  const intereses = parseFloat(document.getElementById('rec-intereses').value) || 0
  const gps = parseFloat(document.getElementById('rec-gps').value) || 0
  const seguro = parseFloat(document.getElementById('rec-seguro').value) || 0
  const admin = parseFloat(document.getElementById('rec-admin').value) || 0
  const total = capital + intereses + gps + seguro + admin
  document.getElementById('rec-total').textContent = 'L. ' + getFmt(total)

  if (selectedPrestamo) {
    const nuevoSaldo = (parseFloat(selectedPrestamo.saldo_actual) || 0) - capital
    document.getElementById('rec-nuevo-saldo').textContent = 'L. ' + getFmt(nuevoSaldo)
    document.getElementById('rec-nuevo-saldo').style.color = nuevoSaldo > 0 ? 'var(--red)' : 'var(--green)'
  }
}

window.guardarRecibo = async () => {
  if (!selectedPrestamo) return
  const p = selectedPrestamo
  const err = document.getElementById('modal-recibo-error')

  const fecha = document.getElementById('rec-fecha').value
  const capital = parseFloat(document.getElementById('rec-capital').value) || 0
  const intereses = parseFloat(document.getElementById('rec-intereses').value) || 0
  const gps = parseFloat(document.getElementById('rec-gps').value) || 0
  const seguro = parseFloat(document.getElementById('rec-seguro').value) || 0
  const admin = parseFloat(document.getElementById('rec-admin').value) || 0
  const notas = document.getElementById('rec-notas').value.trim()
  const montoRecibo = capital + intereses + gps + seguro + admin

  if (!fecha) { showError(err, 'Selecciona la fecha'); return }
  if (montoRecibo <= 0) { showError(err, 'El monto del recibo debe ser mayor a 0'); return }

  const btn = document.getElementById('btn-guardar-recibo')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'

  const saldoInicial = parseFloat(p.saldo_actual) || 0
  const saldoFinal = Math.round((saldoInicial - capital) * 100) / 100
  const numRecibo = (p.num_recibos || 0) + 1

  // 1. Insertar recibo
  const { error: recErr } = await getSb().from('recibos_prestamos').insert({
    concatenar: p.codigo + numRecibo,
    registro: p.codigo,
    fecha,
    numero_recibo: numRecibo,
    nombre: p.motorista,
    monto_recibo: montoRecibo,
    capital,
    intereses,
    gps,
    numero_alquiler: seguro,
    saldo_inicial: saldoInicial,
    saldo_actual: saldoFinal,
    cuota_mes: montoRecibo,
    tasa_interes: parseFloat(p.tasa_interes) || 0.03,
    cuotas: p.cuotas_pactadas || 24,
    concepto: notas || `Cancelación de cuota número ${numRecibo}`,
    propietario: '',
    dni: ''
  })

  if (recErr) {
    btn.disabled = false; btn.textContent = 'Guardar recibo'
    showError(err, recErr.message); return
  }

  // 2. Actualizar saldo del préstamo
  await getSb().from('prestamos_taxis').update({
    saldo_actual: saldoFinal,
    num_recibos: numRecibo,
    fecha_ultimo_pago: fecha,
    dias_sin_pago: 0
  }).eq('codigo', p.codigo)

  btn.disabled = false; btn.textContent = 'Guardar recibo'
  window.closeModal('modal-recibo')
  window.toast(`Recibo #${numRecibo} generado · Capital: L.${getFmt(capital)} · Nuevo saldo: L.${getFmt(saldoFinal)}`, 'success')
  selectedPrestamo = null
  loadFinanciamiento()
}

function showError(el, msg) {
  if (el) { el.textContent = msg; el.classList.remove('hidden') }
}

// ══════════════════════════════════════════════
// ── EDITAR / NUEVO PRÉSTAMO ──
// ══════════════════════════════════════════════

let editingPrestamoCode = null

window.openModalNuevoPrestamo = () => {
  editingPrestamoCode = null
  document.getElementById('modal-edit-prestamo-title').textContent = '🆕 Nuevo préstamo'
  document.getElementById('btn-guardar-prestamo').textContent = 'Crear préstamo'
  ;['ep-codigo','ep-motorista','ep-monto','ep-saldo','ep-tasa','ep-cuotas','ep-gps','ep-seguro','ep-admin','ep-notas'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = ''
  })
  document.getElementById('ep-codigo').disabled = false
  document.getElementById('ep-tasa').value = '3'
  document.getElementById('ep-cuotas').value = '24'
  document.getElementById('ep-categoria').value = 'TAXIS'
  document.getElementById('modal-edit-prestamo-error').classList.add('hidden')
  document.getElementById('modal-edit-prestamo').classList.add('open')
}

window.editarPrestamo = (codigo) => {
  const p = allPrestamos.find(x => x.codigo === codigo)
  if (!p) return
  editingPrestamoCode = codigo

  document.getElementById('modal-edit-prestamo-title').textContent = `✏️ Editar préstamo #${codigo}`
  document.getElementById('btn-guardar-prestamo').textContent = 'Actualizar'
  document.getElementById('ep-codigo').value = p.codigo
  document.getElementById('ep-codigo').disabled = true
  document.getElementById('ep-motorista').value = p.motorista || ''
  document.getElementById('ep-categoria').value = p.categoria || 'TAXIS'
  document.getElementById('ep-monto').value = p.monto_prestamo || ''
  document.getElementById('ep-saldo').value = p.saldo_actual || ''
  document.getElementById('ep-tasa').value = ((parseFloat(p.tasa_interes) || 0.03) * 100).toFixed(2)
  document.getElementById('ep-cuotas').value = p.cuotas_pactadas || 24
  document.getElementById('ep-gps').value = p.cuota_gps || ''
  document.getElementById('ep-seguro').value = p.cuota_seguro || ''
  document.getElementById('ep-admin').value = p.cuota_admin || ''
  document.getElementById('ep-notas').value = p.notas || ''
  document.getElementById('modal-edit-prestamo-error').classList.add('hidden')
  document.getElementById('modal-edit-prestamo').classList.add('open')
}

window.guardarPrestamo = async () => {
  const codigo = document.getElementById('ep-codigo').value.trim()
  const motorista = document.getElementById('ep-motorista').value.trim()
  const categoria = document.getElementById('ep-categoria').value
  const monto = parseFloat(document.getElementById('ep-monto').value) || 0
  const saldo = parseFloat(document.getElementById('ep-saldo').value) || 0
  const tasa = (parseFloat(document.getElementById('ep-tasa').value) || 3) / 100
  const cuotas = parseInt(document.getElementById('ep-cuotas').value) || 24
  const gps = parseFloat(document.getElementById('ep-gps').value) || 0
  const seguro = parseFloat(document.getElementById('ep-seguro').value) || 0
  const admin = parseFloat(document.getElementById('ep-admin').value) || 0
  const notas = document.getElementById('ep-notas').value.trim()
  const err = document.getElementById('modal-edit-prestamo-error')

  if (!codigo) { showError(err, 'El código es obligatorio'); return }

  const btn = document.getElementById('btn-guardar-prestamo')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'

  const payload = {
    codigo, motorista, categoria,
    monto_prestamo: monto || saldo,
    saldo_actual: saldo,
    tasa_interes: tasa,
    cuotas_pactadas: cuotas,
    cuota_gps: gps, cuota_seguro: seguro, cuota_admin: admin,
    notas, activo: true
  }

  let error
  if (editingPrestamoCode) {
    const { error: e } = await getSb().from('prestamos_taxis').update(payload).eq('codigo', editingPrestamoCode)
    error = e
  } else {
    const { error: e } = await getSb().from('prestamos_taxis').insert(payload)
    error = e
  }

  btn.disabled = false
  btn.textContent = editingPrestamoCode ? 'Actualizar' : 'Crear préstamo'

  if (error) {
    showError(err, error.message); return
  }

  window.closeModal('modal-edit-prestamo')
  window.toast(editingPrestamoCode ? `Préstamo #${codigo} actualizado ✓` : `Préstamo #${codigo} creado ✓`, 'success')
  editingPrestamoCode = null
  loadFinanciamiento()
}