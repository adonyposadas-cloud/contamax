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
  'JAVIER CARBAJAL': { codigo: '210404-005' },
  'ADONIS FRANCISCO': { codigo: '210501-005' }
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

    const { data: existe } = await sb.from('partidas_contables').select('id')
      .ilike('descripcion', `%[CIERRE-TAXI] ${g.prop}%`).eq('fecha_partida', hasta).limit(1)
    if (existe?.length) { logs.push(`⏭️ ${g.prop}: ya existe partida de cierre para ${hasta} — omitido`); continue }

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
    logs.push(`✓ ${g.prop}: partida #${numero} · neto L. ${_fmtL(g.neto)} · admin L. ${_fmtL(g.admin)}`)
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Generar partida de cierre →' }
  const logCard = document.getElementById('cierre-log-card'), logDiv = document.getElementById('cierre-log')
  if (logDiv) logDiv.innerHTML = logs.map(l => `<div style="font-size:13px;padding:3px 0">${l}</div>`).join('')
  logCard?.classList.remove('hidden')
  window.toast?.(`${creadas} partida(s) de cierre generada(s) en borrador`, creadas ? 'success' : 'info')
  if (window.logActividad) window.logActividad('cierre_taxis', 'taxis', `Cierre ${periodo}: ${creadas} partida(s)`, '')
}