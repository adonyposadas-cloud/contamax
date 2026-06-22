// ════════════════════════════════════════════════════════════════════
// CIERRE MENSUAL DE RECIBOS (TAXIS) — LIQUIDACIÓN POR PROPIETARIO
// El cierre saca de 410101-003 (renta de taxis, CC Taxis) el ingreso real
// depositado y liquida a cada socio su neto. NO toca intereses ni capital.
//
// Por unidad CON ingresos en el mes:
//   ingreso (suma de entregas_taxis.monto en el rango)
//   − GPS + seguro    solo si la unidad NO es TAXI (VIP/Bus/Particular; los paga Tecnimax)
//   − facturas        todas las de facturas_taxis en el rango
//   − administración  (unidades_taxis.cuota_administracion, default 1,000) si registró ingresos
//
// Partida por socio:
//   Débito  410101-003 (CC Taxis)      = ingreso − gps/seguro(no-taxi) − facturas
//   Crédito cuenta del socio           = neto
//   Crédito 410301-003 (Bono x venta)  = administración
// ════════════════════════════════════════════════════════════════════
let _cierreData = null

const _SOCIO_CUENTA = {
  'ADONY': { codigo: '410101-003', centroAdony: true },
  'ADONY POSADAS': { codigo: '410101-003', centroAdony: true },
  'ALYN': { codigo: '110202-002' },
  'MAXIMINO HIJO': { codigo: '110202-003' },
  'MAXIMINO PADRE': { codigo: '110202-004' },
  'AUTOLOTE': { codigo: '110202-007' },
  'TRANSPORTES ADONIS': { codigo: '110202-005' },
  'JAVIER CARBAJAL': { codigo: '110202-011' },
  'ADONIS FRANCISCO': { codigo: '110202-010' }
}
const _CUENTA_RENTA = '410101-003'
const _CUENTA_ADMIN = '410301-003'
const _ADMIN_DEFAULT = 1000

function _normReg(v) {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^0+/, '')
  return d || String(v ?? '').toUpperCase().trim()
}
function _normProp(s) {
  return String(s ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['´`]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
function _r2(x) { return Math.round((parseFloat(x) || 0) * 100) / 100 }
function _fmtL(n) { return (n || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

// Paginado: PostgREST corta en ~1000 filas; traemos todo en lotes con orden estable.
async function _fetchAllPag(buildQuery, pageSize = 1000) {
  let from = 0, all = []
  for (let i = 0; i < 50; i++) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || !data.length) break
    all = all.concat(data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

window.initCierreMensual = async function () {
  const sb = window._sb
  const hoy = new Date()
  const pad = n => String(n).padStart(2, '0')
  const y = hoy.getFullYear(), m = hoy.getMonth() + 1
  const ultimoDia = new Date(y, m, 0).getDate()
  const di = document.getElementById('cierre-desde'); if (di && !di.value) di.value = `${y}-${pad(m)}-01`
  const dh = document.getElementById('cierre-hasta'); if (dh && !dh.value) dh.value = `${y}-${pad(m)}-${pad(ultimoDia)}`

  const sel = document.getElementById('cierre-propietario')
  if (sel) {
    try {
      const { data } = await sb.from('unidades_taxis').select('propietario')
      const props = [...new Set((data || []).map(u => u.propietario).filter(Boolean))].sort()
      sel.innerHTML = '<option value="">Todos</option>' + props.map(p => `<option value="${p}">${p}</option>`).join('')
    } catch (e) { sel.innerHTML = '<option value="">Todos</option>' }
  }

  // Botón para abrir el panel de Centralización (inyectado una sola vez, estilizado)
  if (sel && sel.parentNode && !document.getElementById('btn-centralizacion')) {
    const b = document.createElement('button')
    b.id = 'btn-centralizacion'
    b.type = 'button'
    b.textContent = '⚖️ Centralización (pool)'
    b.style.cssText = _CENT_BTN_SEC + ';margin-left:8px'
    b.onclick = () => window.abrirCentralizacion()
    sel.parentNode.insertBefore(b, sel.nextSibling)
  }
}

window.consultarCierreMensual = async function () {
  const sb = window._sb
  const desde = document.getElementById('cierre-desde').value
  const hasta = document.getElementById('cierre-hasta').value
  const propSel = document.getElementById('cierre-propietario')?.value || ''
  if (!desde || !hasta) { window.toast?.('Selecciona el rango de fechas', 'error'); return }
  document.getElementById('cierre-log-card')?.classList.add('hidden')

  // Unidades (propietario, modalidad, cuotas) por registro normalizado
  const { data: unidades } = await sb.from('unidades_taxis')
    .select('registro, propietario, modalidad, cuota_administracion')
  const uPorReg = {}
  for (const u of (unidades || [])) { const k = _normReg(u.registro); if (k && !uPorReg[k]) uPorReg[k] = u }

  let entregas, facturas, recibos
  try {
    entregas = await _fetchAllPag(() => sb.from('entregas_taxis')
      .select('unidad, monto, fecha_deposito')
      .gte('fecha_deposito', desde).lte('fecha_deposito', hasta).order('id'))
    facturas = await _fetchAllPag(() => sb.from('facturas_taxis')
      .select('registro, monto, fecha')
      .gte('fecha', desde).lte('fecha', hasta).order('id'))
    // GPS y seguro salen del recibo mensual de cada unidad (gps + numero_alquiler)
    recibos = await _fetchAllPag(() => sb.from('recibos_prestamos')
      .select('registro, gps, numero_alquiler, fecha')
      .gte('fecha', desde).lte('fecha', hasta).order('id'))
  } catch (e) { window.toast?.('Error leyendo entregas/facturas/recibos: ' + e.message, 'error'); return }

  const ingresoPorReg = {}
  for (const e of entregas) { const k = _normReg(e.unidad); ingresoPorReg[k] = (ingresoPorReg[k] || 0) + (parseFloat(e.monto) || 0) }
  const facturaPorReg = {}
  for (const f of facturas) { const k = _normReg(f.registro); facturaPorReg[k] = (facturaPorReg[k] || 0) + (parseFloat(f.monto) || 0) }
  const gpsSegPorReg = {}
  for (const r of recibos) {
    const k = _normReg(r.registro)
    gpsSegPorReg[k] = (gpsSegPorReg[k] || 0) + Math.abs(parseFloat(r.gps) || 0) + Math.abs(parseFloat(r.numero_alquiler) || 0)
  }

  const grupos = {}
  for (const k of Object.keys(ingresoPorReg)) {
    const ingreso = _r2(ingresoPorReg[k])
    if (ingreso <= 0) continue
    const u = uPorReg[k] || null
    const prop = (u && u.propietario) || '(sin propietario)'
    if (propSel && prop !== propSel) continue
    const esTaxi = u && String(u.modalidad || '').toUpperCase() === 'TAXI'
    const gpsSeg = esTaxi ? 0 : _r2(gpsSegPorReg[k] || 0)
    const fact = _r2(facturaPorReg[k] || 0)
    const admin = _r2(u && u.cuota_administracion != null && u.cuota_administracion !== '' ? u.cuota_administracion : _ADMIN_DEFAULT)
    const neto = _r2(ingreso - gpsSeg - fact - admin)
    const debito = _r2(ingreso - gpsSeg - fact)

    if (!grupos[prop]) grupos[prop] = { prop, n: 0, ingreso: 0, gpsSeg: 0, facturas: 0, admin: 0, neto: 0, debito: 0, unidades: [] }
    const g = grupos[prop]
    g.n++; g.ingreso += ingreso; g.gpsSeg += gpsSeg; g.facturas += fact; g.admin += admin; g.neto += neto; g.debito += debito
    g.unidades.push({ registro: (u && u.registro) || k, modalidad: (u && u.modalidad) || '?', esTaxi, ingreso, gpsSeg, facturas: fact, admin, neto })
  }
  const filas = Object.values(grupos).sort((a, b) => b.neto - a.neto)
  filas.forEach(g => { ['ingreso', 'gpsSeg', 'facturas', 'admin', 'neto', 'debito'].forEach(kk => g[kk] = _r2(g[kk])) })

  const T = { n: filas.reduce((s, g) => s + g.n, 0) }
  ;['ingreso', 'gpsSeg', 'facturas', 'admin', 'neto', 'debito'].forEach(kk => T[kk] = _r2(filas.reduce((s, g) => s + g[kk], 0)))
  _cierreData = { desde, hasta, propSel, filas, T }

  if (!filas.length) { window.toast?.('No hay unidades con ingresos en ese rango', 'info'); document.getElementById('cierre-resultado').classList.add('hidden'); return }

  const cel = (v, color) => `<td style="text-align:right;font-family:var(--mono)${color ? ';color:' + color : ''}">${_fmtL(v)}</td>`
  const filaHtml = (g, i) => {
    const mapeado = !!_SOCIO_CUENTA[_normProp(g.prop)]
    const det = g.unidades.sort((a, b) => b.ingreso - a.ingreso).map(x => `<tr style="background:var(--bg3)">
        <td style="padding-left:24px;font-size:12px">${x.registro} · ${x.modalidad}${x.esTaxi ? ' ✓' : ''}</td>
        ${cel(x.ingreso)}${cel(x.gpsSeg)}${cel(x.facturas)}${cel(x.admin)}${cel(x.neto)}
      </tr>`).join('')
    return `<tr style="cursor:pointer" onclick="toggleCierreProp(${i})">
        <td>▸ <strong>${g.prop}</strong> <span style="color:var(--text3);font-size:11px">(${g.n} und)</span>${mapeado ? '' : ' <span style="color:var(--red);font-size:11px">(sin cuenta)</span>'}</td>
        ${cel(g.ingreso)}${cel(g.gpsSeg, 'var(--blue)')}${cel(g.facturas, 'var(--red)')}${cel(g.admin, 'var(--gold)')}${cel(g.neto, 'var(--green)')}
      </tr><tbody id="cierre-det-${i}" class="hidden">${det}</tbody>`
  }

  document.getElementById('cierre-resumen').innerHTML = `
    <div style="font-size:13px;color:var(--text3);margin-bottom:12px">Período: ${desde} al ${hasta} · ${T.n} unidades con ingresos · ${filas.length} propietario(s) · clic para ver unidades · ✓ = TAXI (no se le rebaja GPS/seguro)</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      <div class="stat-card"><div class="stat-num" style="font-size:16px">L. ${_fmtL(T.ingreso)}</div><div class="stat-label">Ingreso (entregas)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);font-size:16px">L. ${_fmtL(T.facturas)}</div><div class="stat-label">Facturas</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--gold);font-size:16px">L. ${_fmtL(T.admin)}</div><div class="stat-label">Administración</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green);font-size:16px">L. ${_fmtL(T.neto)}</div><div class="stat-label">Neto a socios</div></div>
    </div>
    <div class="table-wrap" style="max-height:460px;overflow-y:auto">
      <table>
        <thead><tr>
          <th>Propietario / unidad</th>
          <th style="text-align:right">Ingreso</th><th style="text-align:right">−GPS/Seg</th>
          <th style="text-align:right">−Facturas</th><th style="text-align:right">−Admin</th><th style="text-align:right">Neto</th>
        </tr></thead>
        <tbody>${filas.map((g, i) => filaHtml(g, i)).join('')}</tbody>
        <tbody><tr style="border-top:1px solid var(--border);font-weight:700">
          <td>TOTAL</td>${cel(T.ingreso)}${cel(T.gpsSeg)}${cel(T.facturas)}${cel(T.admin)}${cel(T.neto)}
        </tr></tbody>
      </table>
    </div>
    <div style="margin-top:12px;font-size:12px;color:var(--text3)">
      Débito a 410101-003 (CC Taxis): ingreso − GPS/seguro(no-taxi) − facturas. Crédito al socio: el neto. Crédito 410301-003 (administración). Estado <b>borrador</b>.
    </div>`
  document.getElementById('cierre-resultado').classList.remove('hidden')
}

window.toggleCierreProp = function (i) {
  document.getElementById('cierre-det-' + i)?.classList.toggle('hidden')
}

window.generarPartidaCierre = async function () {
  const sb = window._sb
  if (!_cierreData || !_cierreData.filas?.length) { window.toast?.('Primero consulta el período', 'error'); return }
  const { desde, hasta, filas } = _cierreData
  const btn = document.getElementById('btn-generar-cierre'); if (btn) { btn.disabled = true; btn.textContent = 'Generando…' }

  const { data: centros } = await sb.from('centros_costo').select('id, nombre')
  const ccTaxis = (centros || []).find(c => /^taxis$/i.test((c.nombre || '').trim())) ||
                  (centros || []).find(c => /taxi/i.test(c.nombre || '') && !/vip/i.test(c.nombre || ''))
  const ccAdony = (centros || []).find(c => /adony/i.test(c.nombre || ''))
  if (!ccTaxis) { window.toast?.('No encontré el centro de costo "Taxis"', 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Generar partida de cierre →' } return }

  const codigos = [...new Set([_CUENTA_RENTA, _CUENTA_ADMIN, ...Object.values(_SOCIO_CUENTA).map(s => s.codigo)])]
  const { data: cuentas } = await sb.from('catalogo_cuentas').select('id, codigo, nombre').in('codigo', codigos)
  const mapC = {}; for (const c of (cuentas || [])) mapC[c.codigo] = c
  if (!mapC[_CUENTA_RENTA] || !mapC[_CUENTA_ADMIN]) { window.toast?.(`Faltan cuentas: ${_CUENTA_RENTA} / ${_CUENTA_ADMIN}`, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Generar partida de cierre →' } return }

  const quienId = window._currentProfile?.()?.id || null
  const periodo = `${desde} a ${hasta}`
  const logs = []; let creadas = 0

  for (const g of filas) {
    const map = _SOCIO_CUENTA[_normProp(g.prop)]
    if (!map) { logs.push(`⏭️ ${g.prop}: sin cuenta asignada — omitido`); continue }
    if (!mapC[map.codigo]) { logs.push(`⚠️ ${g.prop}: cuenta ${map.codigo} no existe en el catálogo — omitido`); continue }
    if (g.neto <= 0 || g.debito <= 0) { logs.push(`⏭️ ${g.prop}: neto/débito ≤ 0 (${_fmtL(g.neto)}) — omitido, revisar`); continue }
    if (map.centroAdony && !ccAdony) { logs.push(`⚠️ ${g.prop}: no encontré el centro "Adony Posadas" — omitido`); continue }

    let regenerado = false
    const { data: existe } = await sb.from('partidas_contables').select('id, estado, numero_partida')
      .ilike('descripcion', `%[CIERRE-TAXI] ${g.prop}%`).eq('fecha_partida', hasta)
    if (existe?.length) {
      const aprobadas = existe.filter(p => p.estado !== 'borrador')
      if (aprobadas.length) { logs.push(`⏭️ ${g.prop}: ya existe partida APROBADA (#${aprobadas[0].numero_partida}) para ${hasta} — no se toca`); continue }
      // Solo hay borrador(es): se eliminan para regenerar con datos actuales
      const ids = existe.map(p => p.id)
      await sb.from('lineas_partida').delete().in('partida_id', ids)
      const { error: delErr } = await sb.from('partidas_contables').delete().in('id', ids)
      if (delErr) { logs.push(`⚠️ ${g.prop}: no se pudo borrar el borrador anterior — ${delErr.message}`); continue }
      regenerado = true
    }

    const cRenta = mapC[_CUENTA_RENTA], cAdmin = mapC[_CUENTA_ADMIN], cSocio = mapC[map.codigo]
    const desc = `[CIERRE-TAXI] ${g.prop} · ${periodo}`
    const lineas = [
      { cuenta_id: cRenta.id, cuenta_codigo: cRenta.codigo, cuenta_nombre: cRenta.nombre, tipo: 'debito', monto: g.debito, centro_costo_id: ccTaxis.id, descripcion: desc, aplica_fiscal: false },
      { cuenta_id: cSocio.id, cuenta_codigo: cSocio.codigo, cuenta_nombre: cSocio.nombre, tipo: 'credito', monto: g.neto, centro_costo_id: map.centroAdony ? ccAdony.id : null, descripcion: `NETO ${g.prop} · ${periodo}`, aplica_fiscal: false }
    ]
    if (g.admin > 0) lineas.push({ cuenta_id: cAdmin.id, cuenta_codigo: cAdmin.codigo, cuenta_nombre: cAdmin.nombre, tipo: 'credito', monto: g.admin, centro_costo_id: ccTaxis.id, descripcion: `ADMINISTRACION TAXIS ${g.prop} · ${periodo}`, aplica_fiscal: false })

    let numero
    try { numero = await window.siguienteNumeroPartida() } catch (e) { logs.push(`⚠️ ${g.prop}: no se pudo obtener número`); continue }

    const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
      centro_costo_id: null, fecha_partida: hasta, numero_partida: numero,
      descripcion: desc, tipo_origen: 'otro', estado: 'borrador', total: g.debito, generada_por: quienId
    }).select('id').single()
    if (pErr) { logs.push(`❌ ${g.prop}: error partida — ${pErr.message}`); continue }

    const { error: lErr } = await sb.from('lineas_partida').insert(lineas.map(l => ({ ...l, partida_id: partida.id })))
    if (lErr) { await sb.from('partidas_contables').delete().eq('id', partida.id); logs.push(`❌ ${g.prop}: error líneas — ${lErr.message}`); continue }
    creadas++
    logs.push(`${regenerado ? '♻️' : '✓'} ${g.prop}: partida #${numero} · neto L. ${_fmtL(g.neto)} · admin L. ${_fmtL(g.admin)}${regenerado ? ' (regenerada)' : ''}`)
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Generar partida de cierre →' }
  const logCard = document.getElementById('cierre-log-card'), logDiv = document.getElementById('cierre-log')
  if (logDiv) logDiv.innerHTML = logs.map(l => `<div style="font-size:13px;padding:3px 0">${l}</div>`).join('')
  logCard?.classList.remove('hidden')
  window.toast?.(`${creadas} partida(s) de cierre generada(s) en borrador`, creadas ? 'success' : 'info')
  if (window.logActividad) window.logActividad('cierre_taxis', 'taxis', `Cierre ${periodo}: ${creadas} partida(s)`, '')
}
// ════════════════════════════════════════════════════════════════════
// CENTRALIZACIÓN DE TAXIS (POOL propietario "TAXIS")
// Reparte la producción del pool: cuota fija por unidad a cada socio
// (tabla centralizacion_socios) + residual al fondo 110501-001.
// Adony reusa _SOCIO_CUENTA (410101-003 con su centro).
// ════════════════════════════════════════════════════════════════════
const _CUENTA_FONDO = '110501-001'
const _CENT_SOCIOS_DEFAULT = ['ALYN', 'MAXIMINO HIJO', 'MAXIMINO PADRE', 'AUTOLOTE', 'TRANSPORTES ADONIS', 'ADONY']
const _CENT_BTN_PRIM = 'background:var(--gold,#d4a017);color:#000;font-weight:600;padding:8px 16px;border:none;border-radius:8px;cursor:pointer'
const _CENT_BTN_SEC = 'background:transparent;color:var(--gold,#d4a017);font-weight:600;padding:7px 14px;border:1px solid var(--gold,#d4a017);border-radius:8px;cursor:pointer;font-size:13px'
let _centDistrib = []
let _centCalc = null

// Estado de resultados: ingreso = 41xxxx ; gasto = 5xxxx / 6xxxx
function _esIngreso(cod) { return /^41/.test(String(cod || '')) }
function _esGasto(cod) { return /^[56]/.test(String(cod || '')) }
function _partidaDeLinea(l) { const p = l.partidas_contables; return Array.isArray(p) ? p[0] : p }

// Vista de flota: cuántas unidades del pool tuvieron ingreso vs no, por modalidad
function _computeFlota(poolUnits, ingresoRegs) {
  const F = { VIP: { con: 0, sin: 0, total: 0 }, TAXI: { con: 0, sin: 0, total: 0 } }
  for (const u of poolUnits) {
    const esTaxi = String(u.modalidad || '').toUpperCase() === 'TAXI'
    const b = esTaxi ? F.TAXI : F.VIP
    b.total++
    if (ingresoRegs.has(_normReg(u.registro))) b.con++; else b.sin++
  }
  return F
}

// Resultado real del CC Taxis leído del mayor (líneas pendientes de centralizar)
function _computeResultadoGL(glLines) {
  let ingresos = 0, gastos = 0
  for (const l of glLines) {
    const monto = parseFloat(l.monto) || 0
    const signo = l.tipo === 'credito' ? 1 : -1
    if (_esIngreso(l.cuenta_codigo)) ingresos += signo * monto        // ingreso: crédito suma, débito resta
    else if (_esGasto(l.cuenta_codigo)) gastos += -signo * monto      // gasto: débito suma, crédito resta
  }
  ingresos = _r2(ingresos); gastos = _r2(gastos)
  return { ingresos, gastos, neto: _r2(ingresos - gastos), nLineas: glLines.length, lineIds: glLines.map(l => l.id) }
}

// Distribución: cuotas fijas por unidad (de la tabla) + residual al fondo. SIN administración.
function _computeDistribucion(neto, distrib, params) {
  const totVip = distrib.reduce((s, d) => s + (parseFloat(d.unidades_vip) || 0), 0)
  const totTaxi = distrib.reduce((s, d) => s + (parseFloat(d.unidades_taxi) || 0), 0)
  const cuotasVip = _r2(params.cuotaVip * totVip)
  const cuotasTaxi = _r2(params.cuotaTaxi * totTaxi)
  const totalCuotas = _r2(cuotasVip + cuotasTaxi)
  const residual = _r2(neto - totalCuotas)
  const totU = totVip + totTaxi
  const sugUnidad = totU > 0 ? _r2(neto / totU) : 0
  const socios = distrib.map(d => ({ ...d, cuota: _r2(params.cuotaVip * (parseFloat(d.unidades_vip) || 0) + params.cuotaTaxi * (parseFloat(d.unidades_taxi) || 0)) }))
  return { totVip: _r2(totVip), totTaxi: _r2(totTaxi), cuotasVip, cuotasTaxi, totalCuotas, residual, sugUnidad, socios, debito: neto }
}

// Carga: flota (unidades + quién reportó ingreso en el período) y líneas pendientes del mayor del CC Taxis
async function _loadDatosPool(sb, desde, hasta, ccTaxisId) {
  const { data: unidades } = await sb.from('unidades_taxis').select('registro, propietario, modalidad')
  const poolUnits = (unidades || []).filter(u => _normProp(u.propietario) === 'TAXIS')
  const entregas = await _fetchAllPag(() => sb.from('entregas_taxis').select('unidad, fecha_deposito').gte('fecha_deposito', desde).lte('fecha_deposito', hasta).order('id'))
  const ingresoRegs = new Set((entregas || []).map(e => _normReg(e.unidad)))
  // Líneas del mayor del CC Taxis pendientes de centralizar (con su partida para fecha/estado).
  // Toma TODO lo pendiente hasta 'hasta' (sin piso de fecha) para arrastrar lo que entró tarde.
  const lineas = await _fetchAllPag(() => sb.from('lineas_partida')
    .select('id, cuenta_codigo, tipo, monto, partidas_contables(fecha_partida, estado)')
    .eq('centro_costo_id', ccTaxisId).eq('centralizado', false).order('id'))
  const glLines = (lineas || [])
    .filter(l => _esIngreso(l.cuenta_codigo) || _esGasto(l.cuenta_codigo))
    .filter(l => { const p = _partidaDeLinea(l); return p && p.fecha_partida <= hasta && p.estado !== 'anulada' })
  return { poolUnits, ingresoRegs, glLines }
}

function _resolverCuentaSocio(d) {
  const m = _SOCIO_CUENTA[_normProp(d.nombre)] || null
  return { codigo: d.cuenta_codigo || (m && m.codigo) || null, centroAdony: !!(m && m.centroAdony) }
}

window.abrirCentralizacion = async function () {
  let modal = document.getElementById('modal-centralizacion')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'modal-centralizacion'
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:none;align-items:flex-start;justify-content:center;overflow:auto;padding:24px'
    modal.innerHTML = `
      <div style="background:var(--bg2,#1a1a1a);border-radius:12px;max-width:920px;width:100%;padding:22px;color:var(--text,#eee);box-shadow:0 10px 40px rgba(0,0,0,.5)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-size:18px;font-weight:700">⚖️ Centralización de taxis (pool)</div>
          <button onclick="window.cerrarCentralizacion()" style="background:none;border:none;color:var(--text3,#999);font-size:22px;cursor:pointer">×</button>
        </div>
        <div style="font-size:12px;color:var(--text3,#999);margin-bottom:16px">Reparte la producción de las unidades con propietario "TAXIS". Las que tienen cierre por propietario no entran aquí.</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
          <div><label style="font-size:11px;color:var(--text3,#999)">Desde</label><input type="date" id="cent-desde" style="width:100%"></div>
          <div><label style="font-size:11px;color:var(--text3,#999)">Hasta</label><input type="date" id="cent-hasta" style="width:100%"></div>
          <div><label style="font-size:11px;color:var(--text3,#999)">Cuota VIP/u</label><input type="number" id="cent-cuota-vip" value="3500" style="width:100%"></div>
          <div><label style="font-size:11px;color:var(--text3,#999)">Cuota Taxi/u</label><input type="number" id="cent-cuota-taxi" value="4940" style="width:100%"></div>
        </div>
        <div style="font-weight:600;font-size:13px;margin:6px 0">Tabla de distribución (unidades por socio)</div>
        <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:10px">
          <div><label style="font-size:11px;color:var(--text3,#666)">Total VIP a repartir</label><input type="number" id="cent-tot-vip" value="0" disabled title="VIP se ingresa a mano" style="width:100px;opacity:.4;cursor:not-allowed"></div>
          <div><label style="font-size:11px;color:var(--text3,#999)">Total Taxi a repartir</label><input type="number" step="0.01" id="cent-tot-taxi" value="0" style="width:100px"></div>
          <button onclick="window.distribuirPorPct()" style="${_CENT_BTN_SEC}">⚖️ Distribuir por %</button>
        </div>
        <div id="cent-tabla" style="margin-bottom:10px"></div>
        <button onclick="window.guardarDistribucionCent()" style="${_CENT_BTN_SEC};margin-bottom:16px">💾 Guardar tabla</button>
        <div style="display:flex;gap:10px;margin-bottom:16px">
          <button onclick="window.calcularCentralizacion()" style="${_CENT_BTN_PRIM}">Calcular →</button>
          <button id="cent-btn-generar" onclick="window.generarPartidaCentralizacion()" style="display:none;background:var(--green,#2e7d32);color:#fff;font-weight:600;padding:8px 16px;border:none;border-radius:8px;cursor:pointer">Generar partida (borrador)</button>
        </div>
        <div id="cent-resultado"></div>
      </div>`
    document.body.appendChild(modal)
  }
  const cd = document.getElementById('cierre-desde')?.value, ch = document.getElementById('cierre-hasta')?.value
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth() + 1, pad = n => String(n).padStart(2, '0'), ult = new Date(y, mo, 0).getDate()
  document.getElementById('cent-desde').value = cd || `${y}-${pad(mo)}-01`
  document.getElementById('cent-hasta').value = ch || `${y}-${pad(mo)}-${pad(ult)}`
  document.getElementById('cent-resultado').innerHTML = ''
  document.getElementById('cent-btn-generar').style.display = 'none'
  await _cargarDistribucionCent()
  modal.style.display = 'flex'
}
window.cerrarCentralizacion = () => { const m = document.getElementById('modal-centralizacion'); if (m) m.style.display = 'none' }

async function _cargarDistribucionCent() {
  const sb = window._sb
  let dbRows = []
  try { const { data } = await sb.from('centralizacion_socios').select('*').eq('activo', true).order('nombre'); dbRows = data || [] }
  catch (e) { dbRows = [] }
  const byName = {}; dbRows.forEach(r => { byName[_normProp(r.nombre)] = r })
  // Siempre mostrar los socios conocidos (aunque la base esté vacía); agregar los extra que estén en la base
  const names = [..._CENT_SOCIOS_DEFAULT]
  dbRows.forEach(r => { if (!names.some(n => _normProp(n) === _normProp(r.nombre))) names.push(r.nombre) })
  _centDistrib = names.map(nombre => {
    const r = byName[_normProp(nombre)]
    return { id: r ? r.id : null, nombre, cuenta_codigo: (r && r.cuenta_codigo) || _resolverCuentaSocio({ nombre }).codigo || '', unidades_vip: r ? (r.unidades_vip || 0) : 0, unidades_taxi: r ? (r.unidades_taxi || 0) : 0, pct_vip: r ? (r.pct_vip || 0) : 0, pct_taxi: r ? (r.pct_taxi || 0) : 0 }
  })
  _renderTablaCent()
}

function _renderTablaCent() {
  const cont = document.getElementById('cent-tabla')
  if (!cont) return
  const esc = s => String(s || '').replace(/"/g, '&quot;')
  const sum = k => _centDistrib.reduce((s, d) => s + (parseFloat(d[k]) || 0), 0)
  const totPtaxi = _r2(sum('pct_taxi'))
  const totUvip = _r2(sum('unidades_vip')), totUtaxi = _r2(sum('unidades_taxi'))
  const colPct = (tot) => (tot === 0 || Math.abs(tot - 100) < 0.01) ? 'inherit' : 'var(--gold,#d4a017)'
  cont.innerHTML = `
    <table style="width:100%;font-size:13px">
      <thead><tr>
        <th style="text-align:left">Socio</th><th style="text-align:left">Cuenta</th>
        <th style="text-align:right">Unid. VIP <span style="font-weight:400;color:var(--text3,#666)">(manual)</span></th>
        <th style="text-align:right">% Taxi</th><th style="text-align:right">Unid. Taxi</th><th></th>
      </tr></thead>
      <tbody>${_centDistrib.map((d, i) => `
        <tr>
          <td><input type="text" id="cent-nom-${i}" value="${esc(d.nombre)}" placeholder="NOMBRE" style="width:135px"></td>
          <td><input type="text" id="cent-cta-${i}" value="${esc(d.cuenta_codigo)}" placeholder="110202-00X" style="width:98px;font-family:var(--mono);font-size:11px"></td>
          <td style="text-align:right"><input type="number" step="0.01" id="cent-uvip-${i}" value="${d.unidades_vip || 0}" style="width:68px;text-align:right"></td>
          <td style="text-align:right"><input type="number" step="0.0001" id="cent-ptaxi-${i}" value="${d.pct_taxi || 0}" style="width:62px;text-align:right"></td>
          <td style="text-align:right"><input type="number" step="0.01" id="cent-utaxi-${i}" value="${d.unidades_taxi || 0}" style="width:68px;text-align:right"></td>
          <td style="text-align:center"><button onclick="window.eliminarSocioCent(${i})" title="Eliminar socio" style="background:none;border:none;color:var(--red,#c62828);cursor:pointer;font-size:15px">✕</button></td>
        </tr>`).join('')}
        <tr style="font-weight:700;border-top:1px solid var(--bg2,#333)">
          <td colspan="2" style="text-align:right">Totales</td>
          <td style="text-align:right">${totUvip}</td>
          <td style="text-align:right;color:${colPct(totPtaxi)}">${totPtaxi}%</td>
          <td style="text-align:right">${totUtaxi}</td><td></td>
        </tr>
      </tbody>
    </table>
    <button onclick="window.agregarSocioCent()" style="${_CENT_BTN_SEC};margin-top:8px">➕ Agregar socio</button>`
}

function _leerTablaCent() {
  for (let i = 0; i < _centDistrib.length; i++) {
    const nom = document.getElementById(`cent-nom-${i}`); if (nom) _centDistrib[i].nombre = nom.value.trim().toUpperCase()
    const cta = document.getElementById(`cent-cta-${i}`); if (cta) _centDistrib[i].cuenta_codigo = cta.value.trim()
    _centDistrib[i].pct_taxi = parseFloat(document.getElementById(`cent-ptaxi-${i}`)?.value) || 0
    _centDistrib[i].unidades_vip = parseFloat(document.getElementById(`cent-uvip-${i}`)?.value) || 0
    _centDistrib[i].unidades_taxi = parseFloat(document.getElementById(`cent-utaxi-${i}`)?.value) || 0
  }
}

// Reparte un total de unidades entre los socios según su % — SOLO TAXIS. VIP queda manual.
window.distribuirPorPct = () => {
  _leerTablaCent()
  const totTaxi = parseFloat(document.getElementById('cent-tot-taxi')?.value) || 0
  for (const d of _centDistrib) {
    d.unidades_taxi = _r2((parseFloat(d.pct_taxi) || 0) / 100 * totTaxi)
  }
  _renderTablaCent()
  window.toast?.(`Repartido por %: ${totTaxi} unidades Taxi (VIP queda manual)`, 'success')
}

window.agregarSocioCent = () => {
  _leerTablaCent()
  _centDistrib.push({ id: null, nombre: '', cuenta_codigo: '', unidades_vip: 0, unidades_taxi: 0, pct_vip: 0, pct_taxi: 0 })
  _renderTablaCent()
}

window.eliminarSocioCent = async (i) => {
  _leerTablaCent()
  const d = _centDistrib[i]
  if (!d) return
  if (d.id) {
    if (!confirm(`¿Eliminar a "${d.nombre}" de la distribución?`)) return
    const { error } = await window._sb.from('centralizacion_socios').delete().eq('id', d.id)
    if (error) { window.toast?.('No se pudo eliminar: ' + error.message, 'error'); return }
  }
  _centDistrib.splice(i, 1)
  _renderTablaCent()
  window.toast?.('Socio eliminado', 'success')
}

window.guardarDistribucionCent = async function () {
  const sb = window._sb
  _leerTablaCent()
  let ok = 0, err = null
  for (const d of _centDistrib) {
    if (!d.nombre) continue   // saltar filas en blanco
    try {
      if (d.id) {
        const { error } = await sb.from('centralizacion_socios').update({ nombre: d.nombre, cuenta_codigo: d.cuenta_codigo || null, unidades_vip: d.unidades_vip, unidades_taxi: d.unidades_taxi, pct_vip: d.pct_vip || 0, pct_taxi: d.pct_taxi || 0, updated_at: new Date().toISOString() }).eq('id', d.id)
        if (error) throw error
      } else {
        const { data, error } = await sb.from('centralizacion_socios').insert({ nombre: d.nombre, cuenta_codigo: d.cuenta_codigo || null, unidades_vip: d.unidades_vip, unidades_taxi: d.unidades_taxi, pct_vip: d.pct_vip || 0, pct_taxi: d.pct_taxi || 0 }).select('id').single()
        if (error) throw error
        d.id = data.id
      }
      ok++
    } catch (e) { err = e.message }
  }
  if (err) window.toast?.('No se pudo guardar (¿corriste la migración SQL de centralizacion_socios?): ' + err, 'error')
  else window.toast?.(`Tabla guardada (${ok} socios)`, 'success')
}

window.calcularCentralizacion = async function () {
  const sb = window._sb
  const desde = document.getElementById('cent-desde').value, hasta = document.getElementById('cent-hasta').value
  if (!desde || !hasta) { window.toast?.('Selecciona el rango de fechas', 'error'); return }
  _leerTablaCent()
  const params = { cuotaVip: parseFloat(document.getElementById('cent-cuota-vip').value) || 0, cuotaTaxi: parseFloat(document.getElementById('cent-cuota-taxi').value) || 0 }
  const centros = await _fetchAllPag(() => sb.from('centros_costo').select('id, nombre').order('nombre'))
  const ccTaxis = (centros || []).find(c => /tax/i.test(c.nombre || ''))
  if (!ccTaxis) { window.toast?.('No encontré el centro "Taxis"', 'error'); return }
  let datos
  try { datos = await _loadDatosPool(sb, desde, hasta, ccTaxis.id) } catch (e) { window.toast?.('Error leyendo el mayor: ' + e.message, 'error'); return }
  const F = _computeFlota(datos.poolUnits, datos.ingresoRegs)
  const R = _computeResultadoGL(datos.glLines)
  const D = _computeDistribucion(R.neto, _centDistrib, params)
  _centCalc = { desde, hasta, F, R, D, params, ccTaxis, lineIds: R.lineIds }
  const f = _fmtL
  // Cuadre: débito = neto ; créditos = cuotas + residual (residual con signo)
  const credTot = _r2(D.socios.reduce((s, x) => s + x.cuota, 0) + D.residual)
  const cuadra = Math.abs(credTot - D.debito) < 0.01
  const totU = D.totVip + D.totTaxi
  const fondoEsDebito = D.residual < -0.005
  document.getElementById('cent-resultado').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      <div style="background:var(--bg3,#222);border-radius:8px;padding:12px">
        <div style="font-weight:600;margin-bottom:6px">Flota VIP <span style="font-weight:400;font-size:11px;color:var(--text3,#999)">(${desde} a ${hasta})</span></div>
        <div style="font-size:13px">Con ingreso: <b>${F.VIP.con}</b> · Sin ingreso: <b>${F.VIP.sin}</b> · Total mapeadas: <b>${F.VIP.total}</b></div>
      </div>
      <div style="background:var(--bg3,#222);border-radius:8px;padding:12px">
        <div style="font-weight:600;margin-bottom:6px">Flota Taxi</div>
        <div style="font-size:13px">Con ingreso: <b>${F.TAXI.con}</b> · Sin ingreso: <b>${F.TAXI.sin}</b> · Total mapeadas: <b>${F.TAXI.total}</b></div>
      </div>
    </div>
    <div style="background:var(--bg3,#222);border-radius:8px;padding:12px;margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:6px">Resultado del CC Taxis · del mayor · ${R.nLineas} líneas pendientes hasta ${hasta}</div>
      <div style="font-size:13px">Ingresos (41xxxx): L. ${f(R.ingresos)} &nbsp;−&nbsp; Gastos (5xxxx/6xxxx): L. ${f(R.gastos)}</div>
      <div style="font-size:15px;font-weight:700;margin-top:4px">Neto a repartir: L. ${f(R.neto)}</div>
      <div style="font-size:11px;color:var(--text3,#999)">Sugerido/unidad: L. ${f(D.sugUnidad)} · cuotas ${f(D.totalCuotas)} (${D.totVip} VIP + ${D.totTaxi} Taxi) · residual al fondo ${f(D.residual)}</div>
    </div>
    ${totU === 0 ? `<div style="background:rgba(212,160,23,.15);border:1px solid var(--gold,#d4a017);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px">⚠️ La tabla de distribución tiene 0 unidades — todo el neto se iría al fondo sin pagar cuotas.</div>` : ''}
    ${R.nLineas === 0 ? `<div style="background:rgba(212,160,23,.15);border:1px solid var(--gold,#d4a017);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px">⚠️ No hay líneas pendientes del CC Taxis en este rango. ¿Corriste el sellado del histórico y los cierres por propietario del mes?</div>` : ''}
    <div style="font-weight:600;font-size:13px;margin-bottom:6px">Partida a generar</div>
    <table style="width:100%;font-size:13px">
      <thead><tr><th style="text-align:left">Cuenta</th><th style="text-align:right">Débito</th><th style="text-align:right">Crédito</th></tr></thead>
      <tbody>
        <tr><td>410101-003 Ingreso taxis (CC Taxis)</td><td style="text-align:right;font-family:var(--mono)">${f(D.debito)}</td><td></td></tr>
        ${D.socios.filter(s => s.cuota > 0).map(s => `<tr><td>${_resolverCuentaSocio(s).codigo || '?'} ${s.nombre}${_resolverCuentaSocio(s).centroAdony ? ' (CC Adony)' : ''}</td><td></td><td style="text-align:right;font-family:var(--mono)">${f(s.cuota)}</td></tr>`).join('')}
        <tr><td>110501-001 Fondo / Inventario (CC Taxis)${fondoEsDebito ? ' — déficit cubierto' : ''}</td>${fondoEsDebito ? `<td style="text-align:right;font-family:var(--mono)">${f(-D.residual)}</td><td></td>` : `<td></td><td style="text-align:right;font-family:var(--mono)">${f(D.residual)}</td>`}</tr>
        <tr style="font-weight:700;border-top:1px solid var(--bg2,#333)"><td>Totales</td><td style="text-align:right;font-family:var(--mono)">${f(_r2(D.debito + (fondoEsDebito ? -D.residual : 0)))}</td><td style="text-align:right;font-family:var(--mono)">${f(_r2(D.socios.reduce((s, x) => s + x.cuota, 0) + (fondoEsDebito ? 0 : D.residual)))}</td></tr>
      </tbody>
    </table>
    <div style="margin-top:8px;font-weight:600;color:${cuadra ? 'var(--green,#2e7d32)' : 'var(--red,#c62828)'}">${cuadra ? 'Cuadrada ✓' : 'NO cuadra — revisar'}</div>
    ${fondoEsDebito ? `<div style="margin-top:6px;font-size:12px;color:var(--gold,#d4a017)">⚠️ Las cuotas superan el neto del mes (déficit L. ${f(-D.residual)}). El fondo lo cubre — revisá cuotas/unidades antes de generar.</div>` : ''}`
  document.getElementById('cent-btn-generar').style.display = cuadra && Math.abs(D.debito) > 0.005 ? 'inline-block' : 'none'
}

window.generarPartidaCentralizacion = async function () {
  const sb = window._sb
  if (!_centCalc) { window.toast?.('Primero calcula', 'error'); return }
  const btn = document.getElementById('cent-btn-generar'); if (btn) { btn.disabled = true; btn.textContent = 'Generando…' }
  const reset = () => { if (btn) { btn.disabled = false; btn.textContent = 'Generar partida (borrador)' } }
  const { desde, hasta, D, ccTaxis, lineIds } = _centCalc
  const periodo = `${desde} a ${hasta}`
  const centros = await _fetchAllPag(() => sb.from('centros_costo').select('id, nombre').order('nombre'))
  const ccAdony = (centros || []).find(c => /adony/i.test(c.nombre || ''))
  const codigos = [...new Set([_CUENTA_RENTA, _CUENTA_FONDO, ...D.socios.map(s => _resolverCuentaSocio(s).codigo).filter(Boolean)])]
  const { data: cuentas } = await sb.from('catalogo_cuentas').select('id, codigo, nombre').in('codigo', codigos)
  const mapC = {}; for (const c of (cuentas || [])) mapC[c.codigo] = c
  const faltan = codigos.filter(c => !mapC[c])
  if (faltan.length) { window.toast?.('Faltan cuentas en el catálogo: ' + faltan.join(', '), 'error'); reset(); return }
  const desc = `[CENTRALIZACION] Pool · ${periodo}`
  const lineas = []
  const cRenta = mapC[_CUENTA_RENTA]
  lineas.push({ cuenta_id: cRenta.id, cuenta_codigo: cRenta.codigo, cuenta_nombre: cRenta.nombre, tipo: 'debito', monto: D.debito, centro_costo_id: ccTaxis.id, descripcion: desc, aplica_fiscal: false })
  for (const s of D.socios) {
    if (s.cuota <= 0) continue
    const r = _resolverCuentaSocio(s), c = mapC[r.codigo]
    lineas.push({ cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre, tipo: 'credito', monto: s.cuota, centro_costo_id: r.centroAdony ? (ccAdony && ccAdony.id) : null, descripcion: `CUOTA ${s.nombre} · ${periodo}`, aplica_fiscal: false })
  }
  // Residual al fondo: crédito si sobra; débito (el fondo cubre) si las cuotas superan el neto
  const cFondo = mapC[_CUENTA_FONDO]
  if (D.residual > 0.005) lineas.push({ cuenta_id: cFondo.id, cuenta_codigo: cFondo.codigo, cuenta_nombre: cFondo.nombre, tipo: 'credito', monto: D.residual, centro_costo_id: ccTaxis.id, descripcion: `REINVERSION POOL · ${periodo}`, aplica_fiscal: false })
  else if (D.residual < -0.005) lineas.push({ cuenta_id: cFondo.id, cuenta_codigo: cFondo.codigo, cuenta_nombre: cFondo.nombre, tipo: 'debito', monto: _r2(-D.residual), centro_costo_id: ccTaxis.id, descripcion: `DEFICIT CUBIERTO POR FONDO · ${periodo}`, aplica_fiscal: false })
  const totalDebe = _r2(D.debito + (D.residual < -0.005 ? -D.residual : 0))
  let numero
  try { numero = await window.siguienteNumeroPartida() } catch (e) { window.toast?.('No se pudo obtener número de partida', 'error'); reset(); return }
  const quienId = window._currentProfile?.()?.id || null
  const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({ centro_costo_id: null, fecha_partida: hasta, numero_partida: numero, descripcion: desc, tipo_origen: 'otro', estado: 'borrador', total: totalDebe, generada_por: quienId, es_sensible: true }).select('id').single()
  if (pErr) { window.toast?.('Error creando partida: ' + pErr.message, 'error'); reset(); return }
  const { data: lineasIns, error: lErr } = await sb.from('lineas_partida').insert(lineas.map(l => ({ ...l, partida_id: partida.id }))).select('id')
  if (lErr) { await sb.from('partidas_contables').delete().eq('id', partida.id); window.toast?.('Error en líneas: ' + lErr.message, 'error'); reset(); return }
  // Marcar como centralizadas: las líneas del mayor consumidas + las propias de este cierre (para no morderse la cola)
  const marcar = [...new Set([...(lineIds || []), ...((lineasIns || []).map(l => l.id))])]
  let marcadas = 0
  for (let i = 0; i < marcar.length; i += 100) {
    const chunk = marcar.slice(i, i + 100)
    const { error: mErr } = await sb.from('lineas_partida').update({ centralizado: true, centralizado_at: new Date().toISOString(), centralizado_en: partida.id }).in('id', chunk)
    if (!mErr) marcadas += chunk.length
  }
  if (window.logActividad) window.logActividad('centralizacion_generada', 'taxis', `Centralización ${periodo}: partida #${numero} · neto L. ${_fmtL(D.debito)} · ${marcadas} líneas marcadas`, partida.id)
  window.toast?.(`Partida de centralización #${numero} generada en borrador · ${marcadas} líneas marcadas`, 'success')
  reset(); document.getElementById('cent-btn-generar').style.display = 'none'
}