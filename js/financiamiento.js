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
let liquidacionData = null // Datos de la liquidación actual para generar recibo

// ══════════════════════════════════════════════
// ── CARGAR PRÉSTAMOS ──
// ══════════════════════════════════════════════

window.loadFinanciamiento = async () => {
  const tbody = document.getElementById('tbody-financiamiento')
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'

  const { data, error } = await getSb().from('prestamos_taxis').select('*').eq('activo', true).order('categoria').order('codigo')
  if (error) { if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--red);padding:30px">${error.message}</td></tr>`; return }

  allPrestamos = data || []
  const totalSaldo = allPrestamos.reduce((s, p) => s + (parseFloat(p.saldo_actual) || 0), 0)
  const morosos = allPrestamos.filter(p => p.dias_sin_pago > 30).length
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v }
  el('fin-stat-total', allPrestamos.length)
  el('fin-stat-saldo', 'L. ' + getFmt(totalSaldo))
  el('fin-stat-cats', [...new Set(allPrestamos.map(p => p.categoria))].length)
  el('fin-stat-morosos', morosos)

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
        <th style="text-align:right">Saldo ini</th><th style="text-align:right">Saldo fin</th><th>Concepto</th>
      </tr></thead>
      <tbody>${recibos.map(r => `<tr>
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
    .select('saldo_del_mes, gps, numero_alquiler, numero_recibo, cuota_mes')
    .eq('registro', codigo).order('fecha', { ascending: false }).limit(1)

  const saldoMesAnterior = parseFloat(lastRec?.[0]?.saldo_del_mes) || 0
  const prevGps = parseFloat(lastRec?.[0]?.gps) || p.cuota_gps || 0
  const prevAlquiler = parseFloat(lastRec?.[0]?.numero_alquiler) || p.cuota_seguro || 0
  const cuotaMes = parseFloat(lastRec?.[0]?.cuota_mes) || 0
  const numReciboSig = (lastRec?.[0]?.numero_recibo || p.num_recibos || 0) + 1

  // Cargar entregas NO usadas en recibo anterior
  const { data: entregas } = await getSb().from('entregas_taxis')
    .select('*').eq('unidad', registro)
    .or('usado_en_recibo.eq.false,usado_en_recibo.is.null')
    .order('fecha_deposito')

  // ── Buscar abonos vía partidas contables (créditos que mencionan el código de unidad) ──
  const codigoStr = String(codigo).trim()
  const codigoSinCero = codigoStr.replace(/^0+/, '') // "03989" → "3989"
  let abonosValidos = []
  try {
    // Buscar por código con y sin ceros iniciales
    const { data: abonosPartida, error: apErr } = await getSb().from('lineas_partida')
      .select('id, monto, descripcion, tipo, cuenta_codigo, cuenta_nombre, usado_en_recibo, partida:partidas_contables(id, fecha_partida, estado, descripcion)')
      .eq('tipo', 'credito')
      .ilike('descripcion', `%${codigoSinCero}%`)

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
  const tasa = parseFloat(p.tasa_interes) || 0.03
  const intereses = Math.round(saldo * tasa * 100) / 100
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
    saldoInicial: saldo, tasa, intereses, gps, alquiler,
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
          <tr><td style="padding:4px 0">Intereses</td><td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${getFmt(d.intereses)}</td></tr>
          <tr style="border-top:1px solid var(--border);font-weight:600"><td style="padding:6px 0">Total recibo</td><td style="text-align:right;font-family:var(--mono);font-size:16px;color:var(--gold)">L. ${getFmt(d.montoRecibo)}</td></tr>
          <tr style="border-top:2px solid var(--border)"><td style="padding:6px 0;font-weight:600">Nuevo saldo préstamo</td><td style="text-align:right;font-family:var(--mono);font-size:18px;font-weight:700;color:${d.nuevoSaldoPrestamo > 0 ? 'var(--red)' : 'var(--green)'}">L. ${getFmt(d.nuevoSaldoPrestamo)}</td></tr>
        </table>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
          <label style="font-size:11px;color:var(--text3);white-space:nowrap">Fecha recibo:</label>
          <input type="date" id="liq-fecha" value="${new Date().toLocaleDateString('en-CA')}" style="font-size:12px;padding:4px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--mono)">
        </div>
        <div style="margin-top:6px"><input type="text" id="liq-concepto" value="${d.concepto}" oninput="liquidacionData.concepto=this.value" style="width:100%;font-size:12px;padding:6px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--text);text-transform:uppercase"></div>
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
  const fechaHoy = new Date().toLocaleDateString('es-HN', { year: 'numeric', month: 'long', day: 'numeric' })

  // Generar entregas por día para la cara trasera
  const entregasHTML = d.entregas.map(e => `<tr><td>${e.fecha_deposito}</td><td style="text-align:right">${getFmt(e.monto)}</td></tr>`).join('')
  const facturasHTML = d.facturas.map(f => `<tr><td>${f.fecha} - ${f.descripcion?.substring(0, 40) || ''}</td><td style="text-align:right">${getFmt(f.monto)}</td></tr>`).join('')

  const printWindow = window.open('', '_blank')
  printWindow.document.write(`<!DOCTYPE html><html><head><title>Recibo #${d.numRecibo} - ${d.codigo}</title>
<style>
  @page { size: letter; margin: 15mm; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #000; }
  .page { page-break-after: always; padding: 20px; }
  .page:last-child { page-break-after: auto; }
  h2 { text-align: center; margin: 0 0 20px 0; font-size: 24px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 4px 8px; }
  .bordered td, .bordered th { border: 1px solid #ccc; }
  .label { font-weight: bold; width: 180px; }
  .right { text-align: right; }
  .bold { font-weight: bold; }
  .line { border-top: 2px solid #000; margin: 30px 80px 5px 80px; }
  .center { text-align: center; }
  .cuadro { border: 1px solid #000; padding: 8px; margin-top: 20px; }
  .cuadro td { padding: 3px 6px; font-size: 11px; }
</style></head><body>

<!-- CARA 1: RECIBO -->
<div class="page">
  <h2>RECIBO</h2>
  <table>
    <tr><td class="label">REGISTRO</td><td>${d.codigo}</td><td></td><td class="bold">NUMERO: ${d.numRecibo}</td></tr>
    <tr><td class="label">RECIBO ANT.</td><td>${d.numRecibo - 1}</td><td></td><td></td></tr>
    <tr><td class="label">POR Lps.</td><td colspan="3" class="bold" style="font-size:14px">${getFmt(d.montoRecibo)}</td></tr>
  </table>
  <br>
  <table>
    <tr><td class="label">FECHA:</td><td>${fechaHoy}</td></tr>
    <tr><td class="label">RECIBI DE:</td><td class="bold">${d.motorista || '—'}</td></tr>
    <tr><td class="label">POR CONCEPTO DE:</td><td>${d.concepto}</td></tr>
  </table>
  <br>
  <table>
    <tr><td class="label">CAPITAL=</td><td class="right bold">${getFmt(d.abonoCapital)}</td></tr>
    <tr><td class="label">INTERESES=</td><td class="right bold">${getFmt(d.intereses)}</td></tr>
    <tr><td class="label">TOTAL=</td><td class="right bold" style="font-size:14px;border-top:1px solid #000">${getFmt(d.montoRecibo)}</td></tr>
  </table>
  <br>
  <table>
    <tr><td class="label">SALDO INICIAL</td><td class="right">${getFmt(d.saldoInicial)}</td></tr>
    <tr><td class="label">ABONO A CAPITAL</td><td class="right">${d.abonoCapital > 0 ? getFmt(d.abonoCapital) : '—'}</td></tr>
    <tr><td class="label bold">NUEVO SALDO</td><td class="right bold" style="font-size:14px">${getFmt(d.nuevoSaldoPrestamo)}</td></tr>
  </table>

  <div class="line"></div>
  <p class="center bold">ADONY FABRICIO POSADAS AGUILAR<br>EL ARENDADOR<br>DNI. 1701-1981-03404</p>

  <div class="cuadro">
    <table>
      <tr><td>${getFmt(d.totalEntregas)}</td><td>TOTAL DEL MES</td></tr>
      <tr><td>(${getFmt(d.montoRecibo)})</td><td>LETRA DE CARRO</td></tr>
      <tr><td>${d.totalFacturas ? '(' + getFmt(d.totalFacturas) + ')' : '—'}</td><td>FACTURAS</td></tr>
      <tr><td>(${getFmt(d.alquiler)})</td><td>${d.esTaxi ? 'ALQUILER DE NUMERO' : 'SEGURO'}</td></tr>
      <tr><td>(${getFmt(d.gps)})</td><td>GPS</td></tr>
      <tr><td>${getFmt(d.saldoMesAnterior)}</td><td>SALDO MES ANT.</td></tr>
      <tr><td class="bold">${getFmt(d.nuevoSaldoMes)}</td><td class="bold">SALDO DEL MES</td></tr>
    </table>
  </div>
</div>

<!-- CARA 2: DETALLE DE ENTREGAS -->
<div class="page">
  <h2>DETALLE DE ENTREGAS Y GASTOS</h2>
  <p><strong>REGISTRO:</strong> ${d.codigo} &nbsp;&nbsp; <strong>MOTORISTA:</strong> ${d.motorista || '—'} &nbsp;&nbsp; <strong>RECIBO:</strong> #${d.numRecibo}</p>

  <h3>ENTREGAS (${d.entregas.length})</h3>
  <table class="bordered">
    <thead><tr><th>FECHA</th><th class="right">INGRESO</th></tr></thead>
    <tbody>${entregasHTML || '<tr><td colspan="2" style="text-align:center">Sin entregas</td></tr>'}</tbody>
    <tfoot><tr class="bold"><td>TOTAL</td><td class="right">${getFmt(d.totalEntregas)}</td></tr></tfoot>
  </table>

  ${d.facturas.length ? `<h3 style="margin-top:20px">FACTURAS / GASTOS (${d.facturas.length})</h3>
  <table class="bordered">
    <thead><tr><th>DETALLE</th><th class="right">MONTO</th></tr></thead>
    <tbody>${facturasHTML}</tbody>
    <tfoot><tr class="bold"><td>TOTAL FACTURAS</td><td class="right">${getFmt(d.totalFacturas)}</td></tr></tfoot>
  </table>` : ''}
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
  if (!codigo) { showError(err, 'Código obligatorio'); return }

  const btn = document.getElementById('btn-guardar-prestamo')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'
  const payload = { codigo, motorista, categoria, monto_prestamo: monto || saldo, saldo_actual: saldo, tasa_interes: tasa, cuotas_pactadas: cuotas, cuota_gps: gps, cuota_seguro: seguro, cuota_admin: admin, notas, activo: true }

  let error
  if (editingPrestamoCode) { const { error: e } = await getSb().from('prestamos_taxis').update(payload).eq('codigo', editingPrestamoCode); error = e }
  else { const { error: e } = await getSb().from('prestamos_taxis').insert(payload); error = e }

  btn.disabled = false; btn.textContent = editingPrestamoCode ? 'Actualizar' : 'Crear préstamo'
  if (error) { showError(err, error.message); return }
  window.closeModal('modal-edit-prestamo')
  window.toast(editingPrestamoCode ? `#${codigo} actualizado ✓` : `#${codigo} creado ✓`, 'success')
  editingPrestamoCode = null; loadFinanciamiento()
}

function showError(el, msg) { if (el) { el.textContent = msg; el.classList.remove('hidden') } }