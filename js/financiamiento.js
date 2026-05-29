// ══════════════════════════════════════════════
// ── MÓDULO FINANCIAMIENTO · js/financiamiento.js
// ── Sistema de préstamos, recibos y liquidación de motoristas
// ══════════════════════════════════════════════

const getSb = () => window._sb
const getFmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let allPrestamos = []
let filteredPrestamos = []
let selectedPrestamo = null
let editingPrestamoCode = null
let currentDetalleCodigo = null
let liquidacionData = null // Datos de la liquidación actual para generar recibo

// ══════════════════════════════════════════════
// ── CARGAR PRÉSTAMOS ──
// ══════════════════════════════════════════════

window.loadFinanciamiento = async () => {
  const tbody = document.getElementById('tbody-financiamiento')
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'

  const { data, error } = await getSb().from('prestamos_taxis').select('*').order('categoria').order('codigo')
  if (error) { if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--red);padding:30px">${error.message}</td></tr>`; return }

  allPrestamos = data || []
  const activos = allPrestamos.filter(p => p.activo !== false)
  const totalSaldo = activos.reduce((s, p) => s + (parseFloat(p.saldo_actual) || 0), 0)
  const morosos = activos.filter(p => p.dias_sin_pago > 30).length
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v }
  el('fin-stat-total', activos.length)
  el('fin-stat-saldo', 'L. ' + getFmt(totalSaldo))
  el('fin-stat-cats', [...new Set(activos.map(p => p.categoria))].length)
  el('fin-stat-morosos', morosos)

  const catSelect = document.getElementById('fin-filtro-cat')
  if (catSelect) {
    const cats = [...new Set(activos.map(p => p.categoria))].sort()
    const inactivos = allPrestamos.filter(p => p.activo === false).length
    catSelect.innerHTML = '<option value="">Todas</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('') + (inactivos ? `<option value="_INACTIVOS">📦 Dados de baja (${inactivos})</option>` : '')
  }
  filtrarPrestamos()
}

window.filtrarPrestamos = () => {
  const term = (document.getElementById('fin-buscar')?.value || '').toLowerCase().trim()
  const catFilter = document.getElementById('fin-filtro-cat')?.value || ''
  filteredPrestamos = allPrestamos.filter(p => {
    if (catFilter === '_INACTIVOS') return p.activo === false
    if (catFilter && p.categoria !== catFilter) return false
    if (!catFilter && p.activo === false) return false // hide inactive by default
    if (term) return `${p.codigo} ${p.motorista} ${p.categoria}`.toLowerCase().includes(term)
    return true
  })
  renderPrestamosTable()
}

function renderPrestamosTable() {
  const tbody = document.getElementById('tbody-financiamiento')
  if (!tbody) return
  if (!filteredPrestamos.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text3)">No se encontraron préstamos</td></tr>'; return }
  const profile = window._currentProfile ? window._currentProfile() : null
  const esSA = profile?.rol === 'super_admin'

  tbody.innerHTML = filteredPrestamos.map(p => {
    const saldo = parseFloat(p.saldo_actual) || 0
    const diasColor = p.dias_sin_pago > 30 ? 'var(--red)' : p.dias_sin_pago > 15 ? 'var(--amber)' : 'var(--green)'
    const fechaUlt = p.fecha_ultimo_pago ? new Date(p.fecha_ultimo_pago + 'T12:00:00').toLocaleDateString('es-HN') : '—'
    return `<tr style="cursor:pointer" onclick="verDetallePrestamo('${p.codigo}')">
      <td style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--gold)">${p.codigo}</td>
      <td style="font-weight:500">${p.motorista || '—'}</td>
      <td><span class="badge badge-blue" style="font-size:10px">${p.categoria}</span></td>
      <td style="text-align:right;font-family:var(--mono);font-weight:600;color:${saldo > 0 ? 'var(--red)' : 'var(--green)'}">L. ${getFmt(saldo)}</td>
      <td style="font-family:var(--mono);text-align:center">${p.num_recibos || 0}</td>
      <td style="font-size:12px;color:var(--text3)">${fechaUlt}</td>
      <td style="text-align:center;font-family:var(--mono);font-weight:500;color:${diasColor}">${p.dias_sin_pago || 0}d</td>
      <td style="text-align:center" onclick="event.stopPropagation()">
        ${esSA ? `<button onclick="abrirLiquidacion('${p.codigo}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="Generar recibo">🧾</button>
          <button onclick="editarPrestamo('${p.codigo}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="Editar">✏️</button>` : '👁'}
      </td></tr>`
  }).join('')
}

// ══════════════════════════════════════════════
// ── DETALLE DE PRÉSTAMO (historial) ──
// ══════════════════════════════════════════════

window.verDetallePrestamo = async (codigo) => {
  const p = allPrestamos.find(x => x.codigo === codigo)
  if (!p) return
  currentDetalleCodigo = codigo
  document.getElementById('modal-detalle-prestamo-title').textContent = `🧾 Préstamo #${codigo} · ${p.motorista || p.categoria}`
  document.getElementById('modal-detalle-prestamo').classList.add('open')

  document.getElementById('dp-info').innerHTML = `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:14px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      <div><span style="color:var(--text3);font-size:11px">Código</span><div style="font-family:var(--mono);font-weight:600;color:var(--gold)">${p.codigo}</div></div>
      <div><span style="color:var(--text3);font-size:11px">Motorista</span><div>${p.motorista || '—'}</div></div>
      <div><span style="color:var(--text3);font-size:11px">Categoría</span><div><span class="badge badge-blue">${p.categoria}</span></div></div>
      <div><span style="color:var(--text3);font-size:11px">Saldo actual</span><div style="font-family:var(--mono);font-weight:700;font-size:18px;color:var(--red)">L. ${getFmt(p.saldo_actual)}</div></div>
    </div>`

  const contenido = document.getElementById('dp-contenido')
  contenido.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>'

  const { data: recibos } = await getSb().from('recibos_prestamos').select('*').eq('registro', codigo).order('fecha', { ascending: false })

  if (!recibos?.length) { contenido.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3)">No hay recibos emitidos</div>'; return }

  contenido.innerHTML = `
    <div class="table-wrap" style="overflow-x:auto">
      <div class="table-header"><span class="table-title">Historial de recibos (${recibos.length})</span></div>
      <table><thead><tr>
        <th>#</th><th>Fecha</th><th style="text-align:right">Monto</th>
        <th style="text-align:right">Capital</th><th style="text-align:right">Intereses</th>
        <th style="text-align:right">Facturas</th><th style="text-align:right">Alq/Seg</th><th style="text-align:right">GPS</th>
        <th style="text-align:right">Saldo ini</th><th style="text-align:right">Saldo fin</th><th>Concepto</th><th style="width:40px"></th>
      </tr></thead>
      <tbody>${recibos.map((r, idx) => `<tr>
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
        <td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text3)" title="${r.concepto || ''}">${r.concepto || '—'}</td>
        <td style="text-align:center;white-space:nowrap">
          <button onclick="reimprimirRecibo('${r.id}')" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--blue)" title="Reimprimir recibo">🖨️</button>
          ${idx === 0 ? `<button onclick="eliminarRecibo('${r.id}','${codigo}',${r.numero_recibo})" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--red)" title="Eliminar y reversar recibo">🗑️</button>` : ''}
        </td>
      </tr>`).join('')}</tbody></table>
    </div>`
}

// ══════════════════════════════════════════════
// ── LIQUIDACIÓN Y GENERACIÓN DE RECIBO ──
// ══════════════════════════════════════════════

window.abrirLiquidacion = async (codigo) => {
  const p = allPrestamos.find(x => x.codigo === codigo)
  if (!p) return
  selectedPrestamo = p
  liquidacionData = null

  const registro = parseInt(p.codigo) || 0

  document.getElementById('modal-liquidacion-title').textContent = `🧾 Liquidación · #${codigo} · ${p.motorista || ''}`

  // Determinar si es TAXI o VIP consultando la tabla de unidades
  const { data: unidadData } = await getSb().from('unidades_taxis')
    .select('modalidad').eq('registro', registro).eq('activo', true).limit(1)
  const esTaxi = unidadData?.[0]?.modalidad === 'TAXI' || (p.categoria || '').toUpperCase().includes('TAXI')

  // Obtener último recibo para saldo del mes anterior y cuota_mes
  const { data: lastRec } = await getSb().from('recibos_prestamos')
    .select('saldo_del_mes, gps, numero_alquiler, numero_recibo, cuota_mes, fecha')
    .eq('registro', codigo).order('fecha', { ascending: false }).limit(1)

  const saldoMesAnterior = parseFloat(lastRec?.[0]?.saldo_del_mes) || 0
  const prevGps = parseFloat(lastRec?.[0]?.gps) || p.cuota_gps || 0
  const prevAlquiler = parseFloat(lastRec?.[0]?.numero_alquiler) || p.cuota_seguro || 0
  const cuotaMes = parseFloat(lastRec?.[0]?.cuota_mes) || 0
  const numReciboSig = (lastRec?.[0]?.numero_recibo || p.num_recibos || 0) + 1
  const fechaUltimoPago = lastRec?.[0]?.fecha || p.fecha_inicio || p.created_at?.split('T')[0] || new Date().toISOString().split('T')[0]

  // Cargar entregas NO usadas en recibo anterior
  const { data: entregas } = await getSb().from('entregas_taxis')
    .select('*').eq('unidad', registro)
    .or('usado_en_recibo.eq.false,usado_en_recibo.is.null')
    .order('fecha_deposito')

  // ── Buscar abonos vía partidas contables (créditos que mencionan el código de unidad) ──
  const codigoStr = String(codigo).trim()
  const codigoSinCero = codigoStr.replace(/^0+/, '') // "03989" → "3989"
  // Usar prefijos exactos para evitar falsos positivos (ej: "25" matcheando fechas/montos)
  const prefijosAbono = [
    `descripcion.ilike.%TAXI ${codigoSinCero}%`,
    `descripcion.ilike.%TAXI_${codigoSinCero}%`,
    `descripcion.ilike.%TAXI  ${codigoSinCero}%`,
    `descripcion.ilike.%VIP ${codigoSinCero}%`,
    `descripcion.ilike.%VIP_${codigoSinCero}%`,
    `descripcion.ilike.%VIP  ${codigoSinCero}%`,
    `descripcion.ilike.%T_${codigoSinCero}%`,
    `descripcion.ilike.%TAXI VIP ${codigoSinCero}%`,
    `descripcion.ilike.%TAXI VIP  ${codigoSinCero}%`,
  ]
  // Also search with leading zeros if codigo has them
  if (codigoStr !== codigoSinCero) {
    prefijosAbono.push(
      `descripcion.ilike.%TAXI ${codigoStr}%`,
      `descripcion.ilike.%VIP ${codigoStr}%`,
      `descripcion.ilike.%T_${codigoStr}%`,
    )
  }
  let abonosValidos = []
  try {
    const { data: abonosPartida, error: apErr } = await getSb().from('lineas_partida')
      .select('id, monto, descripcion, tipo, cuenta_codigo, cuenta_nombre, usado_en_recibo, partida:partidas_contables(id, fecha_partida, estado, descripcion)')
      .eq('tipo', 'credito')
      .or(prefijosAbono.join(','))

    if (!apErr && abonosPartida?.length) {
      abonosValidos = abonosPartida.filter(a => 
        a.partida?.estado === 'aprobada' && a.monto > 0 && !a.usado_en_recibo
      )
    }
  } catch(e) { console.log('Abonos partida no disponible:', e) }

  const totalAbonosPartida = abonosValidos.reduce((s, a) => s + (parseFloat(a.monto) || 0), 0)

  // Cargar facturas NO usadas
  const { data: facturas } = await getSb().from('facturas_taxis')
    .select('*').eq('registro', registro)
    .or('usado_en_recibo.eq.false,usado_en_recibo.is.null')
    .order('fecha')

  const totalEntregas = (entregas || []).reduce((s, e) => s + (parseFloat(e.monto) || 0), 0) + totalAbonosPartida
  const totalFacturas = (facturas || []).reduce((s, f) => s + (parseFloat(f.monto) || 0), 0)

  const saldo = parseFloat(p.saldo_actual) || 0
  const tasa = parseFloat(p.tasa_interes) || 0.03 // tasa mensual (3% = 0.03)
  
  // Calcular días desde último pago hasta hoy (se recalculará al cambiar fecha)
  const hoy = new Date()
  const fechaUlt = new Date(fechaUltimoPago + 'T12:00:00')
  const diasTranscurridos = Math.max(0, Math.round((hoy - fechaUlt) / (1000 * 60 * 60 * 24)))
  const tasaDiaria = tasa / 30 // tasa mensual / 30 días
  const intereses = Math.round(saldo * tasaDiaria * diasTranscurridos * 100) / 100
  
  const gps = Math.abs(parseFloat(prevGps)) || 0
  const alquiler = Math.abs(parseFloat(prevAlquiler)) || 0
  const saldoAnt = parseFloat(saldoMesAnterior) || 0

  // Cálculo de liquidación:
  // Saldo del mes = entregas - (intereses + facturas + alquiler + GPS + |saldo mes anterior negativo|)
  const cargoSaldoAnt = saldoAnt < 0 ? Math.abs(saldoAnt) : 0
  const abonoSaldoAnt = saldoAnt > 0 ? saldoAnt : 0
  const totalCargos = intereses + totalFacturas + alquiler + gps + cargoSaldoAnt
  const saldoDelMes = totalEntregas + abonoSaldoAnt - totalCargos

  // Si el saldo del mes es positivo y cubre la cuota pactada:
  //   - Se abona el capital de la cuota (cuota - intereses)
  //   - El excedente queda como saldo a favor para el próximo mes
  // Si el saldo del mes es positivo pero NO cubre la cuota:
  //   - Todo va a cubrir intereses, no abona capital
  //   - El saldo del mes (positivo o negativo) se arrastra
  // Si el saldo es negativo: no abona capital, arrastra deuda

  let abonoCapital = 0
  let nuevoSaldoMes = saldoDelMes

  if (saldoDelMes > 0 && cuotaMes > 0) {
    // La cuota ya incluye intereses, entonces capital = cuota - intereses
    const capitalPactado = cuotaMes - intereses
    if (saldoDelMes >= capitalPactado && capitalPactado > 0) {
      // Cubre la cuota de capital completa: abona capital pactado, el resto es saldo a favor
      abonoCapital = Math.round(capitalPactado * 100) / 100
      nuevoSaldoMes = Math.round((saldoDelMes - capitalPactado) * 100) / 100
    } else if (saldoDelMes > 0) {
      // No cubre toda la cuota de capital: todo el saldo va a capital
      abonoCapital = Math.round(saldoDelMes * 100) / 100
      nuevoSaldoMes = 0
    }
    // Si saldoDelMes <= 0: no abona capital, arrastra deuda
  } else if (saldoDelMes > 0 && cuotaMes === 0) {
    // Sin cuota pactada: todo el saldo va a capital
    abonoCapital = Math.round(saldoDelMes * 100) / 100
    nuevoSaldoMes = 0
  }

  const nuevoSaldoPrestamo = Math.round((saldo - abonoCapital) * 100) / 100
  const montoRecibo = Math.round((intereses + abonoCapital) * 100) / 100

  liquidacionData = {
    codigo, registro, motorista: p.motorista,
    entregas: entregas || [], facturas: facturas || [],
    abonosPartida: abonosValidos,
    totalEntregas, totalAbonosPartida, totalFacturas,
    saldoInicial: saldo, tasa, tasaDiaria, intereses, gps, alquiler,
    fechaUltimoPago, diasTranscurridos,
    saldoMesAnterior: saldoAnt, cargoSaldoAnt, abonoSaldoAnt, totalCargos,
    cuotaMes,
    saldoDelMes, abonoCapital, nuevoSaldoMes,
    nuevoSaldoPrestamo, montoRecibo, numRecibo: numReciboSig,
    esTaxi, concepto: `CANCELACION DE CUOTA NUMERO ${numReciboSig} EN LA COMPRA DEL ${esTaxi ? 'TAXI' : 'VIP'} ${codigo}`
  }

  renderLiquidacion()
  document.getElementById('modal-liquidacion').classList.add('open')
}

function renderLiquidacion() {
  const d = liquidacionData
  if (!d) return

  const html = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <!-- IZQUIERDA: Cuadro de liquidación -->
      <div style="background:var(--bg3);border-radius:var(--radius);padding:16px">
        <div style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;font-weight:500">Cuadro de liquidación</div>
        <table style="width:100%">
          <tr><td style="padding:4px 0;color:var(--green)">Total entregas (${d.entregas.length}${d.abonosPartida.length ? ' + ' + d.abonosPartida.length + ' partidas' : ''})</td><td style="text-align:right;font-family:var(--mono);color:var(--green);font-weight:500">L. ${getFmt(d.totalEntregas)}</td></tr>
          ${d.abonoSaldoAnt > 0 ? `<tr><td style="padding:4px 0;color:var(--green)">+ Saldo a favor mes ant.</td><td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${getFmt(d.abonoSaldoAnt)}</td></tr>` : ''}
          <tr style="border-top:1px solid var(--border)"><td style="padding:4px 0" colspan="2"><b style="font-size:11px;color:var(--text3)">CARGOS:</b></td></tr>
          <tr><td style="padding:2px 0;padding-left:12px;font-size:13px">Intereses (${(d.tasa * 100).toFixed(0)}%)</td><td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${getFmt(d.intereses)}</td></tr>
          <tr><td style="padding:2px 0;padding-left:12px;font-size:13px">Facturas taller (${d.facturas.length})</td><td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${getFmt(d.totalFacturas)}</td></tr>
          <tr><td style="padding:2px 0;padding-left:12px;font-size:13px">${d.esTaxi ? 'Alquiler de número' : 'Seguro'}</td><td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${getFmt(d.alquiler)}</td></tr>
          <tr><td style="padding:2px 0;padding-left:12px;font-size:13px">GPS</td><td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${getFmt(d.gps)}</td></tr>
          ${d.cargoSaldoAnt > 0 ? `<tr><td style="padding:2px 0;padding-left:12px;font-size:13px">Saldo mes anterior (deuda)</td><td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${getFmt(d.cargoSaldoAnt)}</td></tr>` : ''}
          <tr style="border-top:2px solid var(--border);font-weight:600"><td style="padding:6px 0">Saldo del mes</td><td style="text-align:right;font-family:var(--mono);font-size:16px;color:${d.saldoDelMes >= 0 ? 'var(--green)' : 'var(--red)'}">L. ${getFmt(d.saldoDelMes)}</td></tr>
          ${d.cuotaMes > 0 ? `<tr><td style="padding:4px 0;font-size:12px;color:var(--text3)">Cuota pactada (cap+int)</td><td style="text-align:right;font-family:var(--mono);font-size:12px;color:var(--text3)">L. ${getFmt(d.cuotaMes)}</td></tr>` : ''}
          ${d.abonoCapital > 0 ? `<tr style="background:rgba(16,185,129,0.08)"><td style="padding:6px 0;color:var(--green);font-weight:500">→ Abono a capital</td><td style="text-align:right;font-family:var(--mono);color:var(--green);font-weight:700">L. ${getFmt(d.abonoCapital)}</td></tr>` : ''}
          ${d.nuevoSaldoMes > 0 ? `<tr style="background:rgba(59,130,246,0.08)"><td style="padding:6px 0;color:var(--blue);font-weight:500">→ Saldo a favor</td><td style="text-align:right;font-family:var(--mono);color:var(--blue);font-weight:700">L. ${getFmt(d.nuevoSaldoMes)}</td></tr>` : ''}
          ${d.nuevoSaldoMes < 0 ? `<tr style="background:rgba(239,68,68,0.08)"><td style="padding:6px 0;color:var(--red);font-weight:500">→ Arrastra deuda</td><td style="text-align:right;font-family:var(--mono);color:var(--red);font-weight:700">L. ${getFmt(d.nuevoSaldoMes)}</td></tr>` : ''}
        </table>
      </div>
      <!-- DERECHA: Resumen del recibo -->
      <div style="background:var(--bg3);border-radius:var(--radius);padding:16px">
        <div style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;font-weight:500">Recibo #${d.numRecibo}</div>
        <table style="width:100%">
          <tr><td style="padding:4px 0">Saldo inicial</td><td style="text-align:right;font-family:var(--mono)">L. ${getFmt(d.saldoInicial)}</td></tr>
          <tr><td style="padding:4px 0">Capital</td><td style="text-align:right;font-family:var(--mono);color:var(--green)">${d.abonoCapital > 0 ? 'L. ' + getFmt(d.abonoCapital) : '—'}</td></tr>
          <tr><td style="padding:4px 0">Intereses <span style="font-size:10px;color:var(--text3)">(${d.diasTranscurridos}d desde ${d.fechaUltimoPago})</span></td><td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${getFmt(d.intereses)}</td></tr>
          <tr style="border-top:1px solid var(--border);font-weight:600"><td style="padding:6px 0">Total recibo</td><td style="text-align:right;font-family:var(--mono);font-size:16px;color:var(--gold)">L. ${getFmt(d.montoRecibo)}</td></tr>
          <tr style="border-top:2px solid var(--border)"><td style="padding:6px 0;font-weight:600">Nuevo saldo préstamo</td><td style="text-align:right;font-family:var(--mono);font-size:18px;font-weight:700;color:${d.nuevoSaldoPrestamo > 0 ? 'var(--red)' : 'var(--green)'}">L. ${getFmt(d.nuevoSaldoPrestamo)}</td></tr>
        </table>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
          <label style="font-size:11px;color:var(--text3);white-space:nowrap">Fecha recibo:</label>
          <input type="date" id="liq-fecha" value="${d.fechaRecibo || new Date().toLocaleDateString('en-CA')}" onchange="recalcularIntereses()" style="font-size:12px;padding:4px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--mono)">
        </div>
        <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
          <div id="liq-concepto-display" style="font-size:12px;color:var(--text3);flex:1">${d.concepto}</div>
          <input type="text" id="liq-concepto-input" value="${d.concepto}" oninput="liquidacionData.concepto=this.value" style="display:none;flex:1;font-size:12px;padding:6px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--text);text-transform:uppercase">
          <button onclick="toggleEditConcepto()" id="btn-edit-concepto" style="background:none;border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:11px;color:var(--text3);cursor:pointer;white-space:nowrap">✏️ Editar</button>
        </div>
      </div>
    </div>
    <!-- Detalle de entregas -->
    <details style="margin-bottom:8px">
      <summary style="cursor:pointer;color:var(--text2);font-size:13px;padding:8px 0">📥 Entregas incluidas (${d.entregas.length + d.abonosPartida.length}) — L. ${getFmt(d.totalEntregas)}</summary>
      <div style="max-height:200px;overflow-y:auto;margin-top:8px">
        <table style="width:100%"><thead><tr><th>Fecha</th><th>Origen</th><th>Detalle</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>${d.entregas.map(e => `<tr><td style="font-family:var(--mono);font-size:12px">${e.fecha_deposito}</td><td style="font-size:11px"><span class="badge badge-green">Entrega</span></td><td style="font-size:12px">${e.banco || '—'}</td><td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${getFmt(e.monto)}</td></tr>`).join('')}
        ${d.abonosPartida.map(a => `<tr style="background:rgba(59,130,246,0.05)"><td style="font-family:var(--mono);font-size:12px">${a.partida?.fecha_partida || '—'}</td><td style="font-size:11px"><span class="badge badge-blue">Partida</span></td><td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${a.descripcion}">${a.descripcion || a.partida?.descripcion || '—'}</td><td style="text-align:right;font-family:var(--mono);color:var(--blue)">L. ${getFmt(a.monto)}</td></tr>`).join('')}
        </tbody></table>
      </div>
    </details>
    <details>
      <summary style="cursor:pointer;color:var(--text2);font-size:13px;padding:8px 0">🔧 Facturas incluidas (${d.facturas.length}) — L. ${getFmt(d.totalFacturas)}</summary>
      <div style="max-height:200px;overflow-y:auto;margin-top:8px">
        <table style="width:100%"><thead><tr><th>Fecha</th><th>Descripción</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>${d.facturas.map(f => `<tr><td style="font-family:var(--mono);font-size:12px">${f.fecha}</td><td style="font-size:12px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.descripcion}</td><td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${getFmt(f.monto)}</td></tr>`).join('')}</tbody></table>
      </div>
    </details>`

  document.getElementById('liq-contenido').innerHTML = html
}

window.reimprimirRecibo = async (reciboId) => {
  const { data: r, error } = await getSb().from('recibos_prestamos').select('*').eq('id', reciboId).single()
  if (error || !r) { window.toast('Error cargando recibo: ' + (error?.message || 'no encontrado'), 'error'); return }

  // Cargar entregas y facturas vinculadas a este recibo
  const { data: entregas } = await getSb().from('entregas_taxis').select('*').eq('recibo_prestamo_id', reciboId).order('fecha_deposito')
  
  const { data: facturas } = await getSb().from('facturas_taxis').select('*').eq('recibo_prestamo_id', reciboId).order('fecha')

  // Buscar abonos de partida vinculados
  let abonosPartida = []
  try {
    const codigoSinCero = String(r.registro).replace(/^0+/, '')
    const codigoStr = String(r.registro).trim()
    const prefijos = [
      `descripcion.ilike.%TAXI ${codigoSinCero}%`,
      `descripcion.ilike.%TAXI_${codigoSinCero}%`,
      `descripcion.ilike.%VIP ${codigoSinCero}%`,
      `descripcion.ilike.%VIP_${codigoSinCero}%`,
      `descripcion.ilike.%T_${codigoSinCero}%`,
      `descripcion.ilike.%VIP  ${codigoSinCero}%`,
      `descripcion.ilike.%TAXI  ${codigoSinCero}%`,
    ]
    if (codigoStr !== codigoSinCero) {
      prefijos.push(`descripcion.ilike.%TAXI ${codigoStr}%`, `descripcion.ilike.%VIP ${codigoStr}%`, `descripcion.ilike.%T_${codigoStr}%`)
    }
    const { data: lineas } = await getSb().from('lineas_partida')
      .select('id, monto, descripcion, tipo, cuenta_codigo, cuenta_nombre, partida:partidas_contables(id, fecha_partida, estado, descripcion)')
      .eq('tipo', 'credito')
      .eq('usado_en_recibo', true)
      .or(prefijos.join(','))
    abonosPartida = lineas || []
  } catch(e) {}

  // Determinar si es taxi
  const { data: prestamo } = await getSb().from('prestamos_taxis').select('categoria').eq('codigo', r.registro).single()
  const esTaxi = prestamo?.categoria?.toLowerCase().includes('taxi')

  // Reconstruir datos para impresión
  const totalEntregas = (entregas || []).reduce((s, e) => s + (parseFloat(e.monto) || 0), 0) + abonosPartida.reduce((s, a) => s + (parseFloat(a.monto) || 0), 0)
  const totalFacturas = parseFloat(r.facturas) || 0

  const d = {
    codigo: r.registro,
    numRecibo: r.numero_recibo,
    motorista: r.nombre,
    montoRecibo: parseFloat(r.monto_recibo) || 0,
    abonoCapital: parseFloat(r.capital) || 0,
    intereses: parseFloat(r.intereses) || 0,
    saldoInicial: parseFloat(r.saldo_inicial) || 0,
    nuevoSaldoPrestamo: parseFloat(r.saldo_actual) || 0,
    totalEntregas,
    totalFacturas,
    totalAbonosPartida: abonosPartida.reduce((s, a) => s + (parseFloat(a.monto) || 0), 0),
    gps: Math.abs(parseFloat(r.gps) || 0),
    alquiler: Math.abs(parseFloat(r.numero_alquiler) || 0),
    saldoMesAnterior: parseFloat(r.saldo_anterior) || 0,
    nuevoSaldoMes: parseFloat(r.saldo_del_mes) || 0,
    saldoDelMes: parseFloat(r.saldo_del_mes) || 0,
    concepto: r.concepto || '',
    diasTranscurridos: '',
    esTaxi,
    entregas: entregas || [],
    facturas: facturas || [],
    abonosPartida,
    fechaRecibo: r.fecha,
  }

  imprimirRecibo(d)
}

window.eliminarRecibo = async (reciboId, codigo, numRecibo) => {
  if (!confirm(`⚠️ ¿Eliminar recibo #${numRecibo} del préstamo ${codigo}?\n\nEsto va a:\n• Reversar el saldo del préstamo al anterior\n• Liberar las entregas para volver a usarlas\n• Liberar las facturas para volver a usarlas\n• Liberar los abonos de partida\n• Eliminar el recibo permanentemente\n\n¿Continuar?`)) return

  try {
    // 1. Obtener datos del recibo
    const { data: recibo } = await getSb().from('recibos_prestamos').select('*').eq('id', reciboId).single()
    if (!recibo) { window.toast('Recibo no encontrado', 'error'); return }

    // 2. Liberar entregas vinculadas a este recibo
    const { data: entregasUsadas } = await getSb().from('entregas_taxis')
      .select('id').eq('recibo_prestamo_id', reciboId)
    if (entregasUsadas?.length) {
      for (const e of entregasUsadas) {
        await getSb().from('entregas_taxis').update({ usado_en_recibo: false, recibo_prestamo_id: null }).eq('id', e.id)
      }
    }

    // 3. Liberar facturas vinculadas a este recibo
    const { data: facturasUsadas } = await getSb().from('facturas_taxis')
      .select('id').eq('recibo_prestamo_id', reciboId)
    if (facturasUsadas?.length) {
      for (const f of facturasUsadas) {
        await getSb().from('facturas_taxis').update({ usado_en_recibo: false, recibo_prestamo_id: null }).eq('id', f.id)
      }
    }

    // 4. Liberar abonos de partidas contables (buscar por usado_en_recibo = true y descripción con código)
    const codigoSinCero = String(codigo).replace(/^0+/, '')
    try {
      const { data: lineasUsadas } = await getSb().from('lineas_partida')
        .select('id')
        .eq('tipo', 'credito')
        .eq('usado_en_recibo', true)
        .ilike('descripcion', `%${codigoSinCero}%`)
      if (lineasUsadas?.length) {
        for (const l of lineasUsadas) {
          await getSb().from('lineas_partida').update({ usado_en_recibo: false }).eq('id', l.id)
        }
      }
    } catch(e) { console.log('No se pudieron liberar abonos de partida:', e) }

    // 5. Reversar saldo del préstamo (volver al saldo_inicial del recibo)
    const saldoAnterior = parseFloat(recibo.saldo_inicial) || 0
    const prevRecibo = numRecibo - 1
    await getSb().from('prestamos_taxis').update({
      saldo_actual: saldoAnterior,
      num_recibos: prevRecibo > 0 ? prevRecibo : 0,
    }).eq('codigo', codigo)

    // 6. Eliminar el recibo
    const { error: delErr } = await getSb().from('recibos_prestamos').delete().eq('id', reciboId)
    if (delErr) { window.toast('Error eliminando recibo: ' + delErr.message, 'error'); return }

    window.toast(`Recibo #${numRecibo} eliminado y reversado ✓`, 'success')
    
    // Recargar vista
    window.closeModal('modal-detalle-prestamo')
    loadFinanciamiento()
  } catch(err) {
    window.toast('Error: ' + err.message, 'error')
  }
}

window.recalcularIntereses = () => {
  const d = liquidacionData
  if (!d) return
  const fechaRecibo = document.getElementById('liq-fecha')?.value
  if (!fechaRecibo) return

  // Guardar fecha seleccionada para que persista al re-renderizar
  d.fechaRecibo = fechaRecibo

  const fechaUlt = new Date(d.fechaUltimoPago + 'T12:00:00')
  const fechaRec = new Date(fechaRecibo + 'T12:00:00')
  const dias = Math.max(0, Math.round((fechaRec - fechaUlt) / (1000 * 60 * 60 * 24)))
  
  d.diasTranscurridos = dias
  d.intereses = Math.round(d.saldoInicial * d.tasaDiaria * dias * 100) / 100

  // Recalcular todo
  const totalCargos = d.intereses + d.totalFacturas + d.alquiler + d.gps + d.cargoSaldoAnt
  d.saldoDelMes = d.totalEntregas + d.abonoSaldoAnt - totalCargos
  d.totalCargos = totalCargos

  let abonoCapital = 0
  let nuevoSaldoMes = d.saldoDelMes
  const capitalPactado = d.cuotaMes > 0 ? d.cuotaMes - d.intereses : 0

  if (d.saldoDelMes > 0 && d.cuotaMes > 0) {
    if (d.saldoDelMes >= capitalPactado && capitalPactado > 0) {
      abonoCapital = Math.round(capitalPactado * 100) / 100
      nuevoSaldoMes = Math.round((d.saldoDelMes - capitalPactado) * 100) / 100
    } else if (d.saldoDelMes > 0) {
      abonoCapital = Math.round(d.saldoDelMes * 100) / 100
      nuevoSaldoMes = 0
    }
  } else if (d.saldoDelMes > 0 && d.cuotaMes === 0) {
    abonoCapital = Math.round(d.saldoDelMes * 100) / 100
    nuevoSaldoMes = 0
  }

  d.abonoCapital = abonoCapital
  d.nuevoSaldoMes = nuevoSaldoMes
  d.nuevoSaldoPrestamo = Math.round((d.saldoInicial - abonoCapital) * 100) / 100
  d.montoRecibo = Math.round((d.intereses + abonoCapital) * 100) / 100

  renderLiquidacion()
}

window.toggleEditConcepto = () => {
  const display = document.getElementById('liq-concepto-display')
  const input = document.getElementById('liq-concepto-input')
  const btn = document.getElementById('btn-edit-concepto')
  if (input.style.display === 'none') {
    // Entrar en modo edición
    input.style.display = ''
    display.style.display = 'none'
    input.focus()
    btn.textContent = '✓ Listo'
    btn.style.color = 'var(--green)'
  } else {
    // Salir de modo edición
    liquidacionData.concepto = input.value.toUpperCase()
    display.textContent = liquidacionData.concepto
    input.style.display = 'none'
    display.style.display = ''
    btn.textContent = '✏️ Editar'
    btn.style.color = 'var(--text3)'
  }
}

window.confirmarRecibo = async () => {
  const d = liquidacionData
  if (!d || !selectedPrestamo) return

  const fecha = document.getElementById('liq-fecha')?.value || new Date().toISOString().split('T')[0]
  if (!confirm(`¿Generar recibo #${d.numRecibo} para ${d.codigo}?\n\nCapital: L.${getFmt(d.abonoCapital)}\nIntereses: L.${getFmt(d.intereses)}\nNuevo saldo: L.${getFmt(d.nuevoSaldoPrestamo)}\nSaldo del mes: L.${getFmt(d.nuevoSaldoMes)}`)) return

  const btn = document.getElementById('btn-confirmar-recibo')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'

  // 1. Insertar recibo en recibos_prestamos
  const { data: recibo, error: recErr } = await getSb().from('recibos_prestamos').insert({
    concatenar: d.codigo + d.numRecibo,
    registro: d.codigo,
    fecha,
    numero_recibo: d.numRecibo,
    nombre: d.motorista,
    monto_recibo: d.montoRecibo,
    capital: d.abonoCapital,
    intereses: d.intereses,
    saldo_inicial: d.saldoInicial,
    saldo_actual: d.nuevoSaldoPrestamo,
    total_del_mes: d.totalEntregas,
    facturas: d.totalFacturas,
    numero_alquiler: -Math.abs(d.alquiler),
    gps: -Math.abs(d.gps),
    saldo_anterior: d.saldoMesAnterior,
    saldo_del_mes: d.nuevoSaldoMes,
    tasa_interes: d.tasa,
    cuotas: selectedPrestamo.cuotas_pactadas || 24,
    cuota_mes: d.montoRecibo,
    concepto: d.concepto,
    propietario: '', dni: ''
  }).select().single()

  if (recErr) { btn.disabled = false; btn.textContent = 'Confirmar y generar recibo →'; window.toast('Error: ' + recErr.message, 'error'); return }

  // 2. Marcar entregas como usadas
  for (const e of d.entregas) {
    await getSb().from('entregas_taxis').update({ usado_en_recibo: true, recibo_prestamo_id: recibo.id }).eq('id', e.id)
  }

  // 3. Marcar facturas como usadas
  for (const f of d.facturas) {
    await getSb().from('facturas_taxis').update({ usado_en_recibo: true, recibo_prestamo_id: recibo.id }).eq('id', f.id)
  }

  // 3b. Marcar abonos de partidas contables como usados
  if (d.abonosPartida?.length) {
    for (const a of d.abonosPartida) {
      await getSb().from('lineas_partida').update({ usado_en_recibo: true }).eq('id', a.id)
    }
  }

  // 4. Actualizar préstamo
  await getSb().from('prestamos_taxis').update({
    saldo_actual: d.nuevoSaldoPrestamo,
    num_recibos: d.numRecibo,
    fecha_ultimo_pago: fecha,
    dias_sin_pago: 0
  }).eq('codigo', d.codigo)

  btn.disabled = false; btn.textContent = 'Confirmar y generar recibo →'
  window.toast(`Recibo #${d.numRecibo} generado · Capital: L.${getFmt(d.abonoCapital)} · Saldo: L.${getFmt(d.nuevoSaldoPrestamo)}`, 'success')

  // 5. Abrir recibo para imprimir
  imprimirRecibo(d, recibo.id)

  window.closeModal('modal-liquidacion')
  selectedPrestamo = null
  liquidacionData = null
  loadFinanciamiento()
}

// ══════════════════════════════════════════════
// ── IMPRIMIR RECIBO (dos caras) ──
// ══════════════════════════════════════════════

function imprimirRecibo(d) {
  const fechaRecibo = d.fechaRecibo || new Date().toLocaleDateString('en-CA')
  const fechaFmt = new Date(fechaRecibo + 'T12:00:00').toLocaleDateString('es-HN', { year: 'numeric', month: 'long', day: 'numeric' })
  const getFmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const entregasRows = d.entregas.map(e => `<tr><td style="padding:4px 8px;font-size:11px">${e.fecha_deposito}</td><td style="padding:4px 8px"><span style="background:#e6f1fb;color:#0c447c;font-size:10px;padding:2px 6px;border-radius:3px">Depósito</span></td><td style="padding:4px 8px;font-size:11px">${e.banco || '—'}</td><td style="padding:4px 8px;text-align:right;font-family:monospace;color:#0f6e56">${getFmt(e.monto)}</td></tr>`).join('')
  const abonosPartidaRows = (d.abonosPartida || []).map(a => `<tr><td style="padding:4px 8px;font-size:11px">${a.partida?.fecha_partida || '—'}</td><td style="padding:4px 8px"><span style="background:#eeedfe;color:#3c3489;font-size:10px;padding:2px 6px;border-radius:3px">Partida</span></td><td style="padding:4px 8px;font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.descripcion || '—'}</td><td style="padding:4px 8px;text-align:right;font-family:monospace;color:#0f6e56">${getFmt(a.monto)}</td></tr>`).join('')
  const facturasRows = d.facturas.map(f => `<tr><td style="padding:4px 8px;font-size:11px">${f.fecha}</td><td style="padding:4px 8px"><span style="background:#faece7;color:#712b13;font-size:10px;padding:2px 6px;border-radius:3px">Factura</span></td><td style="padding:4px 8px;font-size:11px">${(f.descripcion || '').substring(0, 40)}</td><td style="padding:4px 8px;text-align:right;font-family:monospace;color:#993c1d">${getFmt(f.monto)}</td></tr>`).join('')

  const printWindow = window.open('', '_blank')
  printWindow.document.write(`<!DOCTYPE html><html><head><title>Recibo #${d.numRecibo} - ${d.codigo}</title>
<style>
  @page { size: letter; margin: 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1a1a1a; }
  .page { page-break-after: always; padding: 10px; }
  .page:last-child { page-break-after: auto; }
  .mono { font-family: 'Courier New', monospace; }
  .grid2 { display: flex; gap: 16px; }
  .grid2 > div { flex: 1; }
  .grid3 { display: flex; gap: 8px; }
  .grid3 > div { flex: 1; }
  .card { border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; }
  .bordered td, .bordered th { border: 1px solid #ddd; padding: 4px 8px; font-size: 11px; }
  .bordered th { background: #f5f5f5; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>

<div class="page">
  <!-- ENCABEZADO -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
    <div>
      <div style="font-size:20px;font-weight:700;letter-spacing:2px">AUTOLOTE TECNIMAX</div>
      <div style="font-size:10px;color:#666;margin-top:2px">RTN: 08019010278503 | Tel: +504 97045242 | Blvd. FF.AA, Tegucigalpa</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:10px;color:#999;letter-spacing:1px">RECIBO</div>
      <div style="font-size:32px;font-weight:700">#${d.numRecibo}</div>
    </div>
  </div>

  <!-- DATOS MOTORISTA + FECHA -->
  <div class="grid2" style="margin-bottom:16px">
    <div style="background:#f5f5f5;border-radius:6px;padding:10px 12px">
      <div style="font-size:10px;color:#999;letter-spacing:1px;margin-bottom:3px">MOTORISTA</div>
      <div style="font-size:13px;font-weight:600">${d.motorista || '—'}</div>
      <div style="font-size:11px;color:#666;margin-top:2px">Registro: ${d.codigo} | ${d.esTaxi ? 'TAXI' : 'VIP'}</div>
    </div>
    <div style="background:#f5f5f5;border-radius:6px;padding:10px 12px">
      <div style="font-size:10px;color:#999;letter-spacing:1px;margin-bottom:3px">FECHA</div>
      <div style="font-size:13px;font-weight:600">${fechaFmt}</div>
      <div style="font-size:11px;color:#666;margin-top:2px">Recibo anterior: #${d.numRecibo - 1}</div>
    </div>
  </div>

  <!-- LIQUIDACIÓN + DESGLOSE -->
  <div class="grid2" style="margin-bottom:16px">
    <div class="card">
      <div style="font-size:10px;color:#999;letter-spacing:1px;margin-bottom:8px;font-weight:600">LIQUIDACIÓN</div>
      <table>
        <tr><td style="padding:3px 0;color:#0f6e56">▼ Entregas (${d.entregas.length}${d.abonosPartida?.length ? ' + ' + d.abonosPartida.length + ' partidas' : ''})</td><td style="text-align:right" class="mono" style="color:#0f6e56">${getFmt(d.totalEntregas)}</td></tr>
        <tr><td style="padding:3px 0;color:#993c1d">— Intereses ${d.diasTranscurridos || 30}d</td><td style="text-align:right;color:#993c1d" class="mono">(${getFmt(d.intereses)})</td></tr>
        ${d.totalFacturas ? `<tr><td style="padding:3px 0;color:#666">— Facturas</td><td style="text-align:right" class="mono">(${getFmt(d.totalFacturas)})</td></tr>` : `<tr><td style="padding:3px 0;color:#999">— Facturas</td><td style="text-align:right;color:#999" class="mono">—</td></tr>`}
        ${d.gps ? `<tr><td style="padding:3px 0;color:#666">— GPS</td><td style="text-align:right" class="mono">(${getFmt(d.gps)})</td></tr>` : ''}
        ${d.alquiler ? `<tr><td style="padding:3px 0;color:#666">— ${d.esTaxi ? 'Alquiler' : 'Seguro'}</td><td style="text-align:right" class="mono">(${getFmt(d.alquiler)})</td></tr>` : ''}
        <tr style="border-top:1px solid #ddd"><td style="padding:6px 0;font-weight:600">Saldo del mes</td><td style="text-align:right;font-weight:600;color:${d.saldoDelMes >= 0 ? '#0f6e56' : '#993c1d'}" class="mono">${getFmt(d.saldoDelMes)}</td></tr>
      </table>
    </div>
    <div class="card">
      <div style="font-size:10px;color:#999;letter-spacing:1px;margin-bottom:8px;font-weight:600">DESGLOSE DEL RECIBO</div>
      <table>
        <tr><td style="padding:3px 0">Capital</td><td style="text-align:right;color:#0f6e56" class="mono">${d.abonoCapital > 0 ? getFmt(d.abonoCapital) : '—'}</td></tr>
        <tr><td style="padding:3px 0">Intereses</td><td style="text-align:right;color:#993c1d" class="mono">${getFmt(d.intereses)}</td></tr>
        <tr style="border-top:2px solid #1a1a1a"><td style="padding:8px 0;font-weight:700;font-size:14px">Total recibo</td><td style="text-align:right;font-weight:700;font-size:18px" class="mono">L. ${getFmt(d.montoRecibo)}</td></tr>
      </table>
    </div>
  </div>

  <!-- SALDOS -->
  <div class="grid3" style="margin-bottom:16px">
    <div style="text-align:center;padding:10px;border:1px solid #ddd;border-radius:6px">
      <div style="font-size:9px;color:#999;letter-spacing:1px">SALDO INICIAL</div>
      <div style="font-size:15px;font-weight:600;margin-top:3px" class="mono">${getFmt(d.saldoInicial)}</div>
    </div>
    <div style="text-align:center;padding:10px;background:#eaf3de;border-radius:6px">
      <div style="font-size:9px;color:#3b6d11;letter-spacing:1px">ABONO CAPITAL</div>
      <div style="font-size:15px;font-weight:600;margin-top:3px;color:#3b6d11" class="mono">-${getFmt(d.abonoCapital)}</div>
    </div>
    <div style="text-align:center;padding:10px;background:#fcebeb;border-radius:6px">
      <div style="font-size:9px;color:#a32d2d;letter-spacing:1px">NUEVO SALDO</div>
      <div style="font-size:15px;font-weight:600;margin-top:3px;color:#a32d2d" class="mono">${getFmt(d.nuevoSaldoPrestamo)}</div>
    </div>
  </div>

  <!-- CONCEPTO -->
  <div style="text-align:center;font-size:11px;color:#666;margin-bottom:20px">${d.concepto}</div>

  <!-- FIRMAS -->
  <div class="grid2" style="margin-top:40px">
    <div style="text-align:center">
      <div style="border-top:1px solid #1a1a1a;width:70%;margin:0 auto"></div>
      <div style="font-size:11px;font-weight:600;margin-top:4px">ADONY FABRICIO POSADAS AGUILAR</div>
      <div style="font-size:10px;color:#999">El arrendador — DNI: 1701-1981-03404</div>
    </div>
    <div style="text-align:center">
      <div style="border-top:1px solid #1a1a1a;width:70%;margin:0 auto"></div>
      <div style="font-size:11px;font-weight:600;margin-top:4px">${d.motorista || 'MOTORISTA'}</div>
      <div style="font-size:10px;color:#999">Recibe conforme</div>
    </div>
  </div>

  <!-- CUADRO RESUMEN (pie) -->
  <div style="border:1px solid #ddd;border-radius:6px;padding:8px 12px;margin-top:20px">
    <div style="font-size:9px;color:#999;letter-spacing:1px;margin-bottom:4px">RESUMEN MENSUAL</div>
    <table style="font-size:11px">
      <tr><td style="padding:2px 0">${getFmt(d.totalEntregas)}</td><td style="padding:2px 8px">Total del mes</td><td style="padding:2px 0">${getFmt(d.nuevoSaldoMes)}</td><td style="padding:2px 8px">Saldo del mes</td></tr>
      <tr><td style="padding:2px 0">(${getFmt(d.montoRecibo)})</td><td style="padding:2px 8px">Letra de carro</td><td style="padding:2px 0">${d.saldoMesAnterior ? getFmt(d.saldoMesAnterior) : '—'}</td><td style="padding:2px 8px">Saldo mes ant.</td></tr>
    </table>
  </div>
</div>

<!-- CARA 2: DETALLE DE ENTREGAS -->
<div class="page">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
    <div>
      <div style="font-size:18px;font-weight:700">DETALLE DE ENTREGAS Y GASTOS</div>
      <div style="font-size:11px;color:#666;margin-top:2px">${d.motorista || '—'} | Registro: ${d.codigo} | Recibo #${d.numRecibo}</div>
    </div>
    <div style="font-size:11px;color:#999">${fechaFmt}</div>
  </div>

  <div style="font-size:11px;font-weight:600;color:#999;letter-spacing:1px;margin-bottom:6px">ENTREGAS (${d.entregas.length + (d.abonosPartida?.length || 0)})</div>
  <table class="bordered" style="margin-bottom:16px">
    <thead><tr><th>Fecha</th><th>Origen</th><th>Detalle</th><th style="text-align:right">Monto</th></tr></thead>
    <tbody>${entregasRows}${abonosPartidaRows || ''}</tbody>
    <tfoot><tr style="font-weight:600;background:#f5f5f5"><td colspan="3">TOTAL ENTREGAS</td><td style="text-align:right" class="mono">${getFmt(d.totalEntregas)}</td></tr></tfoot>
  </table>

  ${d.facturas.length ? `
  <div style="font-size:11px;font-weight:600;color:#999;letter-spacing:1px;margin-bottom:6px">FACTURAS / GASTOS (${d.facturas.length})</div>
  <table class="bordered">
    <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th style="text-align:right">Monto</th></tr></thead>
    <tbody>${facturasRows}</tbody>
    <tfoot><tr style="font-weight:600;background:#f5f5f5"><td colspan="3">TOTAL FACTURAS</td><td style="text-align:right" class="mono">${getFmt(d.totalFacturas)}</td></tr></tfoot>
  </table>` : '<div style="color:#999;font-size:11px;text-align:center;padding:20px">Sin facturas en este período</div>'}
</div>

</body></html>`)
  printWindow.document.close()
  setTimeout(() => printWindow.print(), 500)
}

// ══════════════════════════════════════════════
// ── EDITAR / NUEVO PRÉSTAMO ──
// ══════════════════════════════════════════════

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
  document.getElementById('ep-fecha-inicio').value = new Date().toISOString().split('T')[0]
  document.getElementById('modal-edit-prestamo-error').classList.add('hidden')
  document.getElementById('modal-edit-prestamo').classList.add('open')
}

window.editarPrestamo = (codigo) => {
  const p = allPrestamos.find(x => x.codigo === codigo)
  if (!p) return
  editingPrestamoCode = codigo
  document.getElementById('modal-edit-prestamo-title').textContent = `✏️ Editar #${codigo}`
  document.getElementById('btn-guardar-prestamo').textContent = 'Actualizar'
  document.getElementById('ep-codigo').value = p.codigo; document.getElementById('ep-codigo').disabled = true
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
  document.getElementById('ep-fecha-inicio').value = p.fecha_inicio || ''
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
  const fecha_inicio = document.getElementById('ep-fecha-inicio').value || null
  const err = document.getElementById('modal-edit-prestamo-error')
  if (!codigo) { showError(err, 'Código obligatorio'); return }

  const btn = document.getElementById('btn-guardar-prestamo')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'
  const payload = { codigo, motorista, categoria, monto_prestamo: monto || saldo, saldo_actual: saldo, tasa_interes: tasa, cuotas_pactadas: cuotas, cuota_gps: gps, cuota_seguro: seguro, cuota_admin: admin, notas, fecha_inicio, activo: true }

  let error
  if (editingPrestamoCode) { const { error: e } = await getSb().from('prestamos_taxis').update(payload).eq('codigo', editingPrestamoCode); error = e }
  else { const { error: e } = await getSb().from('prestamos_taxis').insert(payload); error = e }

  btn.disabled = false; btn.textContent = editingPrestamoCode ? 'Actualizar' : 'Crear préstamo'
  if (error) { showError(err, error.message); return }
  window.closeModal('modal-edit-prestamo')
  window.toast(editingPrestamoCode ? `#${codigo} actualizado ✓` : `#${codigo} creado ✓`, 'success')
  editingPrestamoCode = null; loadFinanciamiento()
}

window.inactivarPrestamo = async () => {
  if (!currentDetalleCodigo) return
  const p = allPrestamos.find(x => x.codigo === currentDetalleCodigo)
  if (!p) return
  if (!confirm(`¿Dar de baja el préstamo #${currentDetalleCodigo} de ${p.motorista}?\n\nEl préstamo quedará inactivo y se podrá reasignar la unidad a otro motorista.`)) return
  const { error } = await getSb().from('prestamos_taxis').update({ activo: false, fecha_baja: new Date().toISOString().split('T')[0] }).eq('codigo', currentDetalleCodigo)
  if (error) { window.toast(error.message, 'error'); return }
  window.closeModal('modal-detalle-prestamo')
  window.toast(`Préstamo #${currentDetalleCodigo} dado de baja ✓`, 'success')
  currentDetalleCodigo = null
  loadFinanciamiento()
}

function showError(el, msg) { if (el) { el.textContent = msg; el.classList.remove('hidden') } }