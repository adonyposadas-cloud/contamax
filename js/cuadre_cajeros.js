// ══════════════════════════════════════════════
// ── CUADRE DE CAJEROS (Ventas Alpha)
// ══════════════════════════════════════════════
// Lo que cada cajero facturó (columna "Facturado Por" de los reportes Alpha) contra lo que
// entregó: lotes de cada POS, transferencias por banco, efectivo contado y movimientos de efectivo
// (salidas: gastos, devoluciones… · entradas: adelantos por trabajos y otros ingresos que no son venta).
// El cierre de Tecnimax se sube en Excel; los que no traen archivo (Yonker) se llenan a mano.
// Con el cuadre, la línea "FORMAS DE PAGO - ELEGIR CUENTA" de la partida se reparte en:
// bancos (lotes y transferencias), caja general (efectivo), movimientos (sin cuenta, se elige),
// faltante a la CxC del cajero (110301-*) y sobrante a otros ingresos (410306).
(function () {
  const BANCOS = ['BAC', 'LAFISE', 'BANRURAL']                       // POS en uso (Banpaís ya no)
  const NOMBRE_BANCO = { BAC: 'BAC Credomatic', LAFISE: 'Lafise', BANRURAL: 'Banrural', BANPAIS: 'Banpaís', OCC: 'Occidente', OTRO: 'Otro banco' }
  const BANCOS_TR = ['BAC', 'LAFISE', 'BANRURAL', 'BANPAIS', 'OCC', 'OTRO']   // transferencias: también Banpaís y Occidente
  // Comisión que cobra cada POS sobre la venta (hoja "ARQUEO PARA PARTIDA VENTAS ALPHA CONSOLIDADO").
  // Si el depósito del banco no da esta tasa, el depósito está mal o se pasó por otro POS.
  const TASA_POS = { BAC: 4, LAFISE: 3.45, BANRURAL: 3.43 }
  const CENTROS = ['Tecnicentro', 'Yonker']
  const LS_CFG = 'cuadreCajerosCfg'
  // Cuentas que ya se usan en las partidas de ventas (consulta del 28/10/2026)
  const CTA_FIJA = { pos_BAC: '110103-001', pos_LAFISE: '110103-012', pos_BANRURAL: '110103-007',
    tr_BAC: '110103-001', tr_LAFISE: '110103-012', tr_BANRURAL: '110103-007', tr_BANPAIS: '110103-005', tr_OCC: '110103-002', comision_pos: '620101-005' }
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
  const fmt = (v) => r2(v).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const norm = (t) => String(t || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = (t) => norm(t).split(' ').filter(x => x.length >= 3)
  const banco = (t) => { const n = norm(t); return /CREDOMATIC|\bBAC\b/.test(n) ? 'BAC' : /LAFISE/.test(n) ? 'LAFISE' : /BANRURAL/.test(n) ? 'BANRURAL' : /BANPAIS/.test(n) ? 'BANPAIS' : /OCCIDENTE|\bOCC\b/.test(n) ? 'OCC' : 'OTRO' }
  const lsGet = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def } catch (_) { return def } }
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (_) {} }

  let cajeros = {}        // clave (nombre normalizado) → { nombre, centro, sis, ent }
  let cuentas = []        // catálogo: bancos, CxC empleados, sobrante
  let cfg = lsGet(LS_CFG, { cta: {}, cxc: {} })
  let usar = false
  let ctx = null          // { data, totalCaja, caja, nc: resumen de notas de crédito por centro }
  let resumenNC = { cubierto: 0, trNC: 0, otros: 0 }   // lo calcula lineasPartida, lo muestra el resumen
  let depositos = {}      // 'Centro|BANCO' → lo que depositó el banco (opcional, para validar la tasa)
  const tasa = (b) => cfg.tasa?.[b] !== undefined ? cfg.tasa[b] : TASA_POS[b]

  // trs: una línea por transferencia { det, monto, cta } · salidas: movimientos de efectivo { tipo, det, monto, cta }
// tipo: 'sal' (salió de la caja) · 'ent' (entró sin ser venta, ej. adelanto) · '' (todavía no se eligió)
// medio (solo entradas): 'ef' (vino en el efectivo contado) · 'tr' (vino en una de las transferencias)
  const entVacio = () => ({ pos: {}, posSis: {}, ret: {}, trs: [], ef: '', salidas: [], archivo: '' })
  // Guardados de antes (transferencias sumadas por banco) → una línea por banco
  const migrarEnt = (e, centro) => {
    for (const s of e.salidas || []) { if (s.cta === undefined) s.cta = ctaSalida(s.det, centro); if (s.tipo === undefined) s.tipo = 'sal' }
    if (!e.trs) e.trs = Object.entries(e.tr || {}).filter(([, v]) => parseFloat(v)).map(([b, v]) => ({ det: 'TRANSFERENCIAS ' + (NOMBRE_BANCO[b] || b).toUpperCase(), monto: v, cta: ctaDefecto('tr_' + b) }))
    delete e.tr
    return e
  }
  const lsKeyDia = () => 'cuadreCajeros:' + (document.getElementById('imp-fecha')?.value || 'sin-fecha')
  const guardarDia = () => { const o = {}; for (const [k, c] of Object.entries(cajeros)) o[k] = { nombre: c.nombre, ent: c.ent }; lsSet(lsKeyDia(), { cajeros: o, usar, depositos }) }

  // ── Lo que dice el sistema, por cajero ──
  function calcularSistema(d) {
    const out = {}
    const get = (nombre, centro) => {
      const k = norm(nombre) || '(SIN CAJERO)'
      if (!out[k]) out[k] = { nombre: String(nombre || '').trim() || '(sin cajero)', centro, sis: { ef: 0, tj: 0, tr: 0, n: 0 } }
      if (!out[k].centro) out[k].centro = centro
      return out[k]
    }
    for (const r of [d.tecnimax_fiscal, d.tecnimax_interno, d.yonker_fiscal, d.yonker_interno]) {
      if (!r) continue
      for (const f of r.facturas || []) {
        const c = get(f.facturado_por, r.centro)
        c.sis.ef += f.monto_efectivo || 0; c.sis.tj += f.monto_tarjeta || 0; c.sis.tr += f.monto_transferencia || 0; c.sis.n++
      }
      // Anticipos recibidos o devueltos en caja (el aplicado no mueve dinero)
      for (const x of r.depositos || []) {
        if (x.mov === 'aplicado') continue
        const c = get(x.recibido_por, r.centro)
        const fo = norm(x.forma)
        if (/TARJ|POS/.test(fo)) c.sis.tj += x.monto
        else if (/TRANSF|DEPOS/.test(fo)) c.sis.tr += x.monto
        else c.sis.ef += x.monto
      }
    }
    for (const c of Object.values(out)) { c.sis.ef = r2(c.sis.ef); c.sis.tj = r2(c.sis.tj); c.sis.tr = r2(c.sis.tr) }
    return out
  }

  const totEnt = (e) => {
    const pos = r2(BANCOS.reduce((a, b) => a + (parseFloat(e.pos[b]) || 0), 0))
    const suma = (f) => r2(e.salidas.filter(f).reduce((a, s) => a + (parseFloat(s.monto) || 0), 0))
    const sal = suma(s => s.tipo === 'sal')
    const entTr = suma(s => s.tipo === 'ent' && s.medio === 'tr'), entEf = suma(s => s.tipo === 'ent' && s.medio !== 'tr'), ent = r2(entTr + entEf)
    // Lo entregado incluye las entradas (no son venta): se restan de donde llegaron para comparar con lo facturado
    const tr = r2(e.trs.reduce((a, x) => a + (parseFloat(x.monto) || 0), 0) - entTr)
    const ef = r2((parseFloat(e.ef) || 0) + sal - entEf)
    const lleno = pos || tr || ef || e.ef !== ''
    const sinTipo = e.salidas.filter(s => !s.tipo).length
    return { pos, tr, sal, ent, entTr, entEf, ef, total: r2(pos + tr + ef), lleno, sinTipo }
  }
  const totSis = (s) => r2(s.ef + s.tj + s.tr)

  // ── Cierre de caja en Excel (formato "CIERRE DE CAJA — Tecnimax") ──
  function parseCierre(wb) {
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null })
    const t0 = (r) => String((r || [])[0] ?? '').trim().toUpperCase()
    const num = (v) => parseFloat(v) || 0
    const res = { cajero: '', caja: '', pos: {}, posSis: {}, ret: {}, trs: [], ef: null, salidas: [] }
    const seccion = (titulo) => rows.findIndex(r => t0(r).startsWith(titulo))
    for (const r of rows) {
      if (t0(r) === 'CAJERO') res.cajero = String(r[1] || '').trim()
      if (t0(r) === 'CAJA' && r[1]) res.caja = String(r[1]).trim()
      if (t0(r) === 'TOTAL CONTADO') res.ef = num(r[1])
    }
    // TARJETA POR POS: POS | Sistema | Lote | Retenido | Diferencia
    let i = seccion('TARJETA POR POS')
    if (i >= 0) for (i += 2; i < rows.length && t0(rows[i]); i++) {
      // "(sin POS)" sin lote: cobros anteriores al selector de POS; el lote se digita a mano
      if (banco(rows[i][0]) === 'OTRO' && !num(rows[i][2])) continue
      const b = banco(rows[i][0]); res.pos[b] =r2((res.pos[b] || 0) + num(rows[i][2])); res.posSis[b] = r2((res.posSis[b] || 0) + num(rows[i][1])); res.ret[b] = r2((res.ret[b] || 0) + num(rows[i][3]))
    }
    // TRANSFERENCIAS: Hora | Factura | Cliente | Banco | Quién | Monto (termina en la fila "Total")
    i = seccion('TRANSFERENCIAS')
    if (i >= 0) for (i += 2; i < rows.length && t0(rows[i]); i++) {
      // Sin columna Banco (Yonker antes del selector), el banco viene en la referencia: "Ref BAC TM / ..."
      const b = rows[i][3] ? banco(rows[i][3]) : banco(rows[i][4])
      const det = [rows[i][2], rows[i][1], rows[i][4]].filter(Boolean).map(x => String(x).trim()).join(' · ')
      res.trs.push({ det, monto: num(rows[i][5]), cta: ctaDefecto('tr_' + b) })
    }
    // SALIDAS DE EFECTIVO: Tipo | Detalle | Referencia | Monto
    i = seccion('SALIDAS DE EFECTIVO')
    if (i >= 0) for (i += 2; i < rows.length && t0(rows[i]); i++) {
      res.salidas.push({ tipo: 'sal', det: [rows[i][0], rows[i][1]].filter(Boolean).join(' · '), monto: num(rows[i][3]) })
    }
    if (!res.cajero || res.ef == null) throw new Error('no parece un cierre de caja (falta Cajero o Total contado)')
    return res
  }

  function buscarCajero(nombre) {
    const tk = tokens(nombre)
    return Object.keys(cajeros).find(k => k === norm(nombre))
      || Object.keys(cajeros).find(k => { const kt = k.split(' '); return tk.length && (tk.every(t => kt.includes(t)) || kt.filter(x => x.length >= 3).every(t => tk.includes(t))) })
  }

  window.cuadreSubirCierres = async (input) => {
    const files = [...(input.files || [])]
    input.value = ''
    for (const f of files) {
      try {
        const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' })
        const c = parseCierre(wb)
        let k = buscarCajero(c.cajero)
        if (!k) { k = norm(c.cajero); cajeros[k] = { nombre: c.cajero, centro: '', sis: { ef: 0, tj: 0, tr: 0, n: 0 }, ent: entVacio() } }
        for (const x of c.salidas) x.cta = ctaSalida(x.det, cajeros[k].centro)
        cajeros[k].ent = { pos: c.pos, posSis: c.posSis, ret: c.ret, trs: c.trs, ef: c.ef, salidas: c.salidas, archivo: `${f.name}${c.caja ? ' · caja ' + c.caja : ''}` }
        usar = true   // con un cierre cargado, la partida se arma con el cuadre (se puede desmarcar)
        window.toast?.(`Cierre de ${c.cajero} cargado`, 'success')
      } catch (e) { window.toast?.(`${f.name}: ${e.message}`, 'error') }
    }
    guardarDia(); render()
  }

  // Lotes de todos los cajeros agrupados por centro y banco. El banco deposita el lote menos
  // su comisión (y lo retenido): con el depósito se calcula la tasa real; sin él, se usa la del POS.
  // POS por el que pasaron los lotes: el del centro de sus facturas, salvo que se elija otro
  // (ej. una cajera del Tecnicentro factura una venta del Yonker y la pasa por el POS del Tecnicentro)
  const centroPos = (c) => c.ent.posCentro || c.centro || 'Tecnicentro'

  function bancosPos() {
    const out = []
    for (const centro of CENTROS) for (const b of BANCOS) {
      let lote = 0, ret = 0
      const lotePor = {}   // centro de las facturas → lo que pasó por este POS
      for (const c of Object.values(cajeros)) {
        if (centroPos(c) !== centro) continue
        const v = parseFloat(c.ent.pos[b]) || 0, cf = c.centro || 'Tecnicentro'
        lote += v; ret += parseFloat(c.ent.ret?.[b]) || 0; if (v) lotePor[cf] = (lotePor[cf] || 0) + v
      }
      lote = r2(lote); ret = r2(ret)
      if (!lote) continue
      const k = centro + '|' + b, depTxt = depositos[k]
      const t = parseFloat(tasa(b))
      let dep, com, real = null, alerta = ''
      if (depTxt !== undefined && depTxt !== '') {
        dep = r2(parseFloat(depTxt) || 0); com = r2(lote - ret - dep); real = com / lote * 100
        if (!isNaN(t) && Math.abs(real - t) > 0.05) alerta = ` Debería dar ${t}%: revisá el depósito o si pasaron tarjetas por otro POS.`
      } else if (!isNaN(t)) { com = r2(lote * t / 100); dep = r2(lote - ret - com) }
      else { com = 0; dep = r2(lote - ret); alerta = ' Sin tasa ni depósito: poné la tasa de este POS o lo que depositó el banco.' }
      // La comisión es de quien vendió: se reparte según el centro de las facturas; el redondeo queda en el centro del POS
      const comPor = {}
      for (const [cf, v] of Object.entries(lotePor)) if (cf !== centro) comPor[cf] = r2(com * v / lote)
      comPor[centro] = r2(com - Object.values(comPor).reduce((a, v) => a + v, 0))
      out.push({ k, centro, b, lote, ret, dep, com, comPor, real, t, alerta })
    }
    return out
  }

  // Salidas que no son gasto y ya tienen cuenta conocida; el resto se elige en la partida.
  // NC aplicada: la factura se cobró con saldo a favor (pasivo de Yonker). Devolución: baja la venta.
  function ctaSalida(det, centro) {
    const n = norm(det), yonker = centro === 'Yonker'
    if (/\bN ?C\b.*APLICAD|NOTA DE CREDITO|SALDO A FAVOR/.test(n)) return yonker ? '210101-032' : ''
    if (/DEVOLUCION/.test(n)) return yonker ? '410201-002' : '410201-001'
    return ''
  }

  // ── Cuentas ──
  async function cargarCuentas() {
    if (cuentas.length) return
    // Catálogo completo (las salidas pueden ir a cualquier gasto); app.js ya lo cargó al iniciar
    let data = window.catalogoCuentas
    if (!data?.length) data = (await window._sb.from('catalogo_cuentas').select('id,codigo,nombre,es_detalle').order('codigo').range(0, 4999)).data
    cuentas = data || []
  }
  // Llevan centro de costo las cuentas de resultados: ingresos y devoluciones (4*), costos (5*) y gastos (6*)
  const esGasto = (codigo) => /^[456]/.test(codigo || '')
  // Centros de costo (los mismos de la partida); por defecto, el del cajero
  const centrosCC = () => window._empresas?.() || []
  const ccDe = (centro) => (centro === 'Yonker' ? centrosCC().find(e => /yonker/i.test(e.nombre))
    : centro ? centrosCC().find(e => /tecni/i.test(e.nombre) && !/yonker/i.test(e.nombre)) : null)?.id || ''
  const selCC = (k, campo, id) => `<select class="cq-cc" data-k="${esc(k)}" data-f="${campo}" style="width:100%;font-size:12px">
      <option value="">— sin centro —</option>
      ${centrosCC().map(e => `<option value="${esc(e.id)}" ${String(e.id) === String(id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
    </select>`
  // Buscador de cuentas para cada línea: se escribe código o nombre y se elige de la lista
  const datalistCuentas = () => `<datalist id="cq-cuentas">${cuentas.filter(c => c.es_detalle !== false)
    .map(c => `<option value="${esc(c.codigo)} · ${esc(c.nombre)}"></option>`).join('')}</datalist>`
  const inCta = (k, campo, codigo) => {
    const c = codigo ? cta(codigo) : null
    return `<input list="cq-cuentas" class="cq-cta" data-k="${esc(k)}" data-f="${campo}" value="${c ? esc(c.codigo + ' · ' + c.nombre) : esc(codigo || '')}"
      placeholder="Buscar cuenta…" style="width:100%;font-size:12px;${codigo ? '' : 'border-color:var(--red)'}">`
  }
  const cta = (codigo) => cuentas.find(c => c.codigo === codigo)
  function ctaDefecto(clave) {
    if (cfg.cta[clave] !== undefined) return cfg.cta[clave]
    if (clave === 'sobrante') return (cuentas.find(c => c.codigo.startsWith('410306') && /SOBRANTE/i.test(c.nombre)) || cuentas.find(c => c.codigo.startsWith('410306')))?.codigo || ''
    if (CTA_FIJA[clave] && (cta(CTA_FIJA[clave]) || !cuentas.length)) return CTA_FIJA[clave]
    const b = clave.split('_')[1]
    const re = { BAC: /CREDOMATIC|\bBAC\b/i, LAFISE: /LAFISE/i, BANRURAL: /BANRURAL/i, BANPAIS: /BANPA[IÍ]S/i }[b]
    const bancos = cuentas.filter(c => c.codigo.startsWith('1101') && !c.codigo.startsWith('110101') && !c.codigo.startsWith('110102'))
    return (re && bancos.find(c => re.test(c.nombre)))?.codigo || ''
  }
  function cxcDefecto(k) {
    if (cfg.cxc[k] !== undefined) return cfg.cxc[k]
    const tk = tokens(cajeros[k]?.nombre)
    const cands = cuentas.filter(c => c.codigo.startsWith('110301-')).map(c => ({ c, n: tokens(c.nombre).filter(t => tk.includes(t)).length }))
      .filter(x => x.n >= 1).sort((a, b) => b.n - a.n)
    // Karla Vanessa ↔ "Karla Vannesa Maradiaga": basta un nombre si nadie más lo comparte
    if (!cands.length || (cands[1] && cands[1].n === cands[0].n)) return ''
    return cands[0].c.codigo
  }
  const selCuenta = (attr, valor, filtro) => `<select class="cq-sel" ${attr} style="max-width:100%;font-size:12px">
      <option value="">— elegir en la partida —</option>
      ${cuentas.filter(filtro).map(c => `<option value="${esc(c.codigo)}" ${c.codigo === valor ? 'selected' : ''}>${esc(c.codigo)} · ${esc(c.nombre)}</option>`).join('')}
    </select>`

  // ── Pantalla ──
  const inp = (k, campo, v, extra = '') => `<input type="number" step="0.01" class="cq-in" data-k="${esc(k)}" data-f="${campo}" value="${v === '' || v == null ? '' : r2(v)}" placeholder="0.00" style="width:110px;text-align:right" ${extra}>`
  const dif = (v) => Math.abs(v) < 0.005 ? '<span style="color:var(--green)">✓</span>'
    : `<span style="color:${v < 0 ? 'var(--red)' : 'var(--blue)'}">${v < 0 ? '−' : '+'}${fmt(Math.abs(v))}</span>`

  // Entrada o salida: al agregar el movimiento queda sin elegir (en rojo) y no suma hasta que se elija
  // En las entradas se elige además por dónde llegó: en el efectivo contado o en una transferencia
  const selTipo = (k, i, x) => `<div style="display:flex;gap:4px">
      <select class="cq-tipo" data-k="${esc(k)}" data-i="${i}" data-f="tipo" style="flex:1;min-width:0;font-size:12px;${x.tipo ? '' : 'border-color:var(--red)'}">
        <option value="" ${x.tipo ? '' : 'selected'}>¿Entrada o salida?</option>
        <option value="ent" ${x.tipo === 'ent' ? 'selected' : ''}>Entrada</option>
        <option value="sal" ${x.tipo === 'sal' ? 'selected' : ''}>Salida</option>
      </select>
      ${x.tipo === 'ent' ? `<select class="cq-tipo" data-k="${esc(k)}" data-i="${i}" data-f="medio" title="Por dónde llegó el dinero" style="flex:1;min-width:0;font-size:12px">
        <option value="ef" ${x.medio !== 'tr' ? 'selected' : ''}>en efectivo</option>
        <option value="tr" ${x.medio === 'tr' ? 'selected' : ''}>por transf.</option>
      </select>` : ''}
    </div>`

  function tarjetaCajero(k, c) {
    const e = c.ent, s = c.sis, t = totEnt(e)
    const filaPos = (b) => `<tr><td style="padding-left:18px">POS ${NOMBRE_BANCO[b]}</td>
      <td class="mono" style="text-align:right;color:var(--text3)">${e.posSis[b] != null ? fmt(e.posSis[b]) : ''}</td>
      <td style="text-align:right">${inp(k, 'pos.' + b, e.pos[b])}</td><td></td></tr>`
    // Transferencias y salidas: una línea cada una, con su cuenta, tal cual pasan a la partida
    // pre: casilla antes del detalle (en los movimientos de efectivo, si es entrada o salida)
    const filaLinea = (lista, i, x, ph, quitar, titulo, pre = '') => `<tr><td colspan="2" style="padding-left:18px">
        <div style="display:grid;grid-template-columns:${pre ? (x.tipo === 'ent' ? '190px ' : '92px ') : ''}minmax(0,1fr) minmax(0,1.2fr) minmax(0,.6fr);gap:6px">
          ${pre}<input class="cq-in" data-k="${esc(k)}" data-f="${lista}.${i}.det" value="${esc(x.det)}" placeholder="${ph}" style="width:100%;font-size:12px">
          ${inCta(k, `${lista}.${i}.cta`, x.cta)}
          ${esGasto(x.cta) ? selCC(k, `${lista}.${i}.cc`, x.cc ?? ccDe(c.centro)) : '<span style="color:var(--text3);font-size:11px;align-self:center">sin centro de costo</span>'}
        </div></td>
      <td style="text-align:right">${inp(k, `${lista}.${i}.monto`, x.monto)}</td>
      <td style="text-align:right"><button class="btn btn-ghost" style="padding:2px 8px;font-size:11px" title="${titulo}" onclick="${quitar}('${esc(k)}',${i})">✕</button></td></tr>`
    const total = (lbl, sis, ent, calc) => `<tr style="background:var(--bg3)"><td><b>${lbl}</b></td>
      <td class="mono" style="text-align:right">${fmt(sis)}</td><td class="mono" style="text-align:right" data-calc="${calc}-ent">${fmt(ent)}</td>
      <td class="mono" style="text-align:right" data-calc="${calc}-dif">${t.lleno ? dif(ent - sis) : ''}</td></tr>`
    return `<div class="cq-card" data-cajero="${esc(k)}" style="border:0.5px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div><b>${esc(c.nombre)}</b> <span style="color:var(--text3);font-size:12px">· ${esc(c.centro || 'sin facturas')} · ${s.n} factura(s) de contado${e.archivo ? ' · 📄 ' + esc(e.archivo) : ' · llenado a mano'}</span></div>
        <div data-calc="estado" style="font-weight:600"></div>
      </div>
      <div class="table-wrap"><table style="font-size:13px">
        <thead><tr><th>Concepto</th><th style="text-align:right">Sistema</th><th style="text-align:right">Entregó</th><th style="text-align:right">Diferencia</th></tr></thead>
        <tbody>
          ${BANCOS.map(filaPos).join('')}
          ${total(`Tarjeta (lotes) <select class="cq-poscentro" data-k="${esc(k)}" title="POS por el que pasaron estos lotes" style="font-size:11px;margin-left:6px;padding:1px 4px">
            ${CENTROS.map(x => `<option value="${x}" ${centroPos(c) === x ? 'selected' : ''}>POS de ${x}</option>`).join('')}</select>`, s.tj, t.pos, 'tj')}
          ${e.trs.map((x, i) => filaLinea('trs', i, x, 'Transferencia (cliente, referencia)', 'cuadreQuitarTransf', 'Quitar transferencia')).join('')}
          <tr><td style="padding-left:18px"><button class="btn btn-ghost" style="padding:2px 10px;font-size:11px" onclick="cuadreAgregarTransf('${esc(k)}')">+ Transferencia</button></td><td></td><td></td><td></td></tr>
          ${total(t.entTr ? 'Transferencias (− entradas por transferencia)' : 'Transferencias', s.tr, t.tr, 'tr')}
          <tr><td style="padding-left:18px">Efectivo contado</td><td></td><td style="text-align:right">${inp(k, 'ef', e.ef)}</td><td></td></tr>
          ${e.salidas.map((x, i) => filaLinea('sal', i, x, x.tipo === 'ent' ? 'Entrada (ej. adelanto de trabajo, cliente)' : 'Movimiento de efectivo (detalle)', 'cuadreQuitarSalida',
            'Quitar: si el dinero no salió ni entró de verdad (ej. se cobró de más con tarjeta y se dio el vuelto en efectivo, ya está en el lote)', selTipo(k, i, x))).join('')}
          <tr><td style="padding-left:18px"><button class="btn btn-ghost" style="padding:2px 10px;font-size:11px" onclick="cuadreAgregarSalida('${esc(k)}')">+ Movimiento de efectivo</button></td><td></td><td></td><td></td></tr>
          ${total(t.entEf ? 'Efectivo (contado + salidas − entradas)' : 'Efectivo (contado + salidas)', s.ef, t.ef, 'ef')}
          <tr style="background:var(--bg3);border-top:1px solid var(--gold)"><td><b>TOTAL</b></td>
            <td class="mono" style="text-align:right"><b>${fmt(totSis(s))}</b></td><td class="mono" style="text-align:right" data-calc="tot-ent"><b>${fmt(t.total)}</b></td>
            <td class="mono" style="text-align:right" data-calc="tot-dif"></td></tr>
        </tbody></table></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:12px;flex-wrap:wrap">
        <span style="color:var(--text3)">CxC del cajero (faltante):</span>
        ${selCuenta(`data-cxc="${esc(k)}"`, cxcDefecto(k), c2 => c2.codigo.startsWith('110301-'))}
      </div>
    </div>`
  }

  // Solo los números calculados, para no perder el foco mientras se escribe
  function pintarCalculos() {
    for (const card of document.querySelectorAll('#cuadre-cajeros-body .cq-card')) {
      const c = cajeros[card.dataset.cajero]; if (!c) continue
      const t = totEnt(c.ent), s = c.sis
      const set = (n, html) => { const el = card.querySelector(`[data-calc="${n}"]`); if (el) el.innerHTML = html }
      set('tj-ent', fmt(t.pos)); set('tr-ent', fmt(t.tr)); set('ef-ent', fmt(t.ef)); set('tot-ent', `<b>${fmt(t.total)}</b>`)
      set('tj-dif', t.lleno ? dif(t.pos - s.tj) : ''); set('tr-dif', t.lleno ? dif(t.tr - s.tr) : ''); set('ef-dif', t.lleno ? dif(t.ef - s.ef) : '')
      const d = r2(t.total - totSis(s))
      set('tot-dif', t.lleno ? `<b>${dif(d)}</b>` : '')
      set('estado', t.sinTipo ? `<span style="color:var(--red)">Falta elegir entrada o salida (${t.sinTipo})</span>`
        : !t.lleno ? '<span style="color:var(--text3)">Sin datos de lo entregado</span>'
        : Math.abs(d) < 0.005 ? '<span style="color:var(--green)">✓ Cuadra</span>'
        : d < 0 ? `<span style="color:var(--red)">Faltan L ${fmt(-d)}</span>` : `<span style="color:var(--blue)">Sobran L ${fmt(d)}</span>`)
    }
    const bp = document.getElementById('cuadre-bancos-pos')
    if (bp) {
      const filas = bancosPos()
      const foco = document.activeElement?.dataset?.dep
      bp.innerHTML = !filas.length ? '' : `<div style="font-weight:600;margin:4px 0 6px">🏦 Ventas por POS · lo que deposita el banco</div>
        <div class="table-wrap"><table class="cq-card" style="font-size:13px">
        <thead><tr><th>Centro</th><th>POS</th><th style="text-align:right">Venta (lotes)</th><th style="text-align:right">Retenido</th>
          <th style="text-align:right">Depósito del banco</th><th style="text-align:right">Comisión</th><th style="text-align:right">Tasa</th></tr></thead>
        <tbody>${filas.map(x => `<tr>
          <td>${esc(x.centro)}</td><td>${esc(NOMBRE_BANCO[x.b])}</td>
          <td class="mono" style="text-align:right">${fmt(x.lote)}</td>
          <td class="mono" style="text-align:right">${x.ret ? fmt(x.ret) : ''}</td>
          <td style="text-align:right"><input type="number" step="0.01" data-dep="${esc(x.k)}" value="${esc(depositos[x.k] ?? '')}" placeholder="${fmt(x.dep)}" title="Vacío = se calcula con la tasa del POS" style="width:110px;text-align:right"></td>
          <td class="mono" style="text-align:right" title="${esc(Object.entries(x.comPor).map(([cf, v]) => cf + ': ' + fmt(v)).join(' · '))}">${fmt(x.com)}${Object.keys(x.comPor).length > 1 ? `<div style="font-size:11px;color:var(--text3)">${Object.entries(x.comPor).filter(([cf]) => cf !== x.centro).map(([cf, v]) => esc(cf) + ' ' + fmt(v)).join(' · ')}</div>` : ''}</td>
          <td class="mono" style="text-align:right;color:${x.alerta ? 'var(--red)' : 'var(--green)'}">${x.real != null ? x.real.toFixed(2) + '%' : (isNaN(x.t) ? '—' : x.t + '% (tasa)')}${x.alerta ? ' ⚠' : x.real != null ? ' ✓' : ''}</td>
        </tr>${x.alerta ? `<tr><td colspan="7" style="color:var(--red);font-size:12px">⚠ ${esc(x.centro)} · ${esc(NOMBRE_BANCO[x.b])}: tasa ${x.real != null ? x.real.toFixed(2) + '%' : '—'}.${esc(x.alerta)}</td></tr>` : ''}`).join('')}</tbody></table></div>`
      if (foco) { const el = bp.querySelector(`[data-dep="${CSS.escape(foco)}"]`); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v } }
    }
    const res = document.getElementById('cuadre-cajeros-resumen')
    if (res && ctx) {
      const sumSis = r2(Object.values(cajeros).reduce((a, c) => a + totSis(c.sis), 0))
      const lineas = lineasPartida()
      const { cubierto, trNC, otros } = resumenNC
      res.innerHTML = `Caja del día según la partida: <b class="mono">L ${fmt(ctx.totalCaja)}</b> · cobrado por los cajeros: <b class="mono">L ${fmt(sumSis)}</b>
        ${cubierto ? ` · devoluciones en efectivo ya registradas en las notas de crédito (no se duplican): <b class="mono">L ${fmt(cubierto)}</b>` : ''}
        ${trNC ? ` · reembolsos por transferencia (salen del banco, elegir cuenta): <b class="mono">L ${fmt(trNC)}</b>` : ''}
        ${Math.abs(otros) >= 0.005 ? ` · otros movimientos sin cajero (saldo a favor, depósitos…): <b class="mono">L ${fmt(otros)}</b>` : ''}
        <br><span style="color:var(--text3)">${lineas.length} línea(s) para la partida · las que digan "ELEGIR CUENTA" se completan en el formulario.</span>`
    }
  }

  function render() {
    const card = document.getElementById('import-step-cuadre')
    const body = document.getElementById('cuadre-cajeros-body')
    if (!card || !body || !ctx) return
    card.classList.remove('hidden')
    const lista = Object.entries(cajeros).sort((a, b) => (a[1].centro || 'z').localeCompare(b[1].centro || 'z') || a[1].nombre.localeCompare(b[1].nombre))
    const bancosFiltro = c => c.codigo.startsWith('1101') && !c.codigo.startsWith('110301')
    body.innerHTML = `
      <style>.cq-card td, .cq-card th { padding: 4px 10px !important } .cq-card input.cq-in { padding: 4px 6px }
        #cuadre-cajeros-body input[type=number] { -moz-appearance: textfield; appearance: textfield }
        #cuadre-cajeros-body input[type=number]::-webkit-inner-spin-button, #cuadre-cajeros-body input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0 }</style>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-ghost" onclick="document.getElementById('cq-files').click()">📂 Subir cierres de caja (Excel)</button>
        <input type="file" id="cq-files" accept=".xlsx,.xls" multiple class="hidden" onchange="cuadreSubirCierres(this)">
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer">
          <input type="checkbox" ${usar ? 'checked' : ''} onchange="cuadreUsar(this.checked)"> Usar este cuadre en la partida (reparte las formas de pago)
        </label>
      </div>
      ${datalistCuentas()}
      <details style="margin-bottom:12px;font-size:12px">
        <summary style="cursor:pointer;color:var(--text3)">Cuentas de cada POS y de las transferencias</summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;margin-top:8px">
          ${BANCOS.map(b => `<label>POS ${NOMBRE_BANCO[b]}<br>${selCuenta(`data-cta="pos_${b}"`, ctaDefecto('pos_' + b), bancosFiltro)}</label>`).join('')}
          ${BANCOS_TR.map(b => `<label>Transferencias ${NOMBRE_BANCO[b]}<br>${selCuenta(`data-cta="tr_${b}"`, ctaDefecto('tr_' + b), bancosFiltro)}</label>`).join('')}
          ${BANCOS.map(b => `<label>Tasa POS ${NOMBRE_BANCO[b]} (%)<br><input type="number" step="0.01" data-tasa="${b}" value="${esc(tasa(b))}" placeholder="sin tasa" style="width:110px"></label>`).join('')}
          <label>Comisión del POS<br>${selCuenta('data-cta="comision_pos"', ctaDefecto('comision_pos'), c => c.codigo.startsWith('6201'))}</label>
          <label>Sobrante de caja<br>${selCuenta('data-cta="sobrante"', ctaDefecto('sobrante'), c => c.codigo.startsWith('410306'))}</label>
        </div>
      </details>
      ${lista.map(([k, c]) => tarjetaCajero(k, c)).join('') || '<div style="color:var(--text3)">Los reportes no traen la columna "Facturado Por".</div>'}
      <div id="cuadre-bancos-pos" style="margin-bottom:12px"></div>
      <div id="cuadre-cajeros-resumen" style="font-size:13px;padding:10px;background:var(--bg3);border-radius:var(--radius)"></div>`
    pintarCalculos()
  }

  // Eventos (delegados: el contenido se vuelve a pintar)
  document.addEventListener('input', (ev) => {
    const el = ev.target
    if (el.dataset?.dep) { depositos[el.dataset.dep] = el.value; guardarDia(); pintarCalculos(); return }
    if (el.dataset?.tasa) { cfg.tasa = { ...(cfg.tasa || {}), [el.dataset.tasa]: el.value }; lsSet(LS_CFG, cfg); pintarCalculos(); return }
    if (!el.classList?.contains('cq-in')) return
    const c = cajeros[el.dataset.k]; if (!c) return
    const [a, b, campo] = el.dataset.f.split('.')
    if (a === 'ef') c.ent.ef = el.value
    else if (a === 'pos') c.ent.pos[b] = el.value
    else if (a === 'trs') c.ent.trs[+b][campo] = el.value
    else if (a === 'sal') c.ent.salidas[+b][campo] = el.value
    // Si se está llenando el cuadre, es para usarlo en la partida (se puede desmarcar)
    if (!usar) { usar = true; const chk = document.querySelector('#cuadre-cajeros-body input[onchange^="cuadreUsar"]'); if (chk) chk.checked = true }
    guardarDia(); pintarCalculos()
  })
  document.addEventListener('change', (ev) => {
    const el = ev.target
    if (el.classList?.contains('cq-cta')) {
      // "110103-001 · CHEQUERA BAC…" → 110103-001; si no existe en el catálogo queda en rojo
      const c = cajeros[el.dataset.k]; if (!c) return
      const [a, i] = el.dataset.f.split('.')
      const cod = el.value.split('·')[0].trim()
      const ok = cta(cod) || cuentas.find(x => norm(x.nombre) === norm(el.value))
      ;(a === 'trs' ? c.ent.trs : c.ent.salidas)[+i].cta = ok ? ok.codigo : ''
      el.value = ok ? `${ok.codigo} · ${ok.nombre}` : el.value
      el.style.borderColor = ok ? '' : 'var(--red)'
      // Al pasar a una cuenta de gasto (o dejar de serlo) aparece o se quita el centro de costo
      guardarDia(); render(); return
    }
    if (el.classList?.contains('cq-poscentro')) {
      const c = cajeros[el.dataset.k]; if (!c) return
      c.ent.posCentro = el.value === (c.centro || 'Tecnicentro') ? '' : el.value
      guardarDia(); pintarCalculos(); return
    }
    if (el.classList?.contains('cq-tipo')) {
      const x = cajeros[el.dataset.k]?.ent.salidas[+el.dataset.i]; if (!x) return
      x[el.dataset.f] = el.value; guardarDia(); render(); return
    }
    if (el.classList?.contains('cq-cc')) {
      const c = cajeros[el.dataset.k]; if (!c) return
      const [a, i] = el.dataset.f.split('.')
      ;(a === 'trs' ? c.ent.trs : c.ent.salidas)[+i].cc = el.value
      guardarDia(); return
    }
    if (el.dataset?.cta) { cfg.cta[el.dataset.cta] = el.value; lsSet(LS_CFG, cfg); pintarCalculos() }
    else if (el.dataset?.cxc) { cfg.cxc[el.dataset.cxc] = el.value; lsSet(LS_CFG, cfg); pintarCalculos() }
  })
  // Flechas ↑/↓ pasan a la casilla de arriba o de abajo en vez de sumar o restar 1
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return
    const body = document.getElementById('cuadre-cajeros-body')
    // El buscador de cuentas usa las flechas para moverse en su lista
    if (!body || ev.target.tagName !== 'INPUT' || !body.contains(ev.target) || ev.target.type === 'checkbox' || ev.target.list) return
    ev.preventDefault()
    const ins = [...body.querySelectorAll('input:not([type=checkbox]):not([type=file])')].filter(x => x.offsetParent)
    const sig = ins[ins.indexOf(ev.target) + (ev.key === 'ArrowDown' ? 1 : -1)]
    if (sig) { sig.focus(); sig.select?.() }
  })
  // La rueda del mouse tampoco cambia el monto
  document.addEventListener('wheel', (ev) => {
    if (ev.target.type === 'number' && ev.target === document.activeElement && ev.target.closest?.('#cuadre-cajeros-body')) ev.target.blur()
  }, { passive: true })
  window.cuadreAgregarSalida = (k) => { cajeros[k]?.ent.salidas.push({ tipo: '', det: '', monto: '', cta: '' }); guardarDia(); render() }
  window.cuadreAgregarTransf = (k) => { cajeros[k]?.ent.trs.push({ det: '', monto: '', cta: '' }); guardarDia(); render() }
  window.cuadreQuitarTransf = (k, i) => { cajeros[k]?.ent.trs.splice(i, 1); guardarDia(); render() }
  window.cuadreQuitarSalida = (k, i) => { cajeros[k]?.ent.salidas.splice(i, 1); guardarDia(); render() }
  window.cuadreUsar = (v) => { usar = !!v; guardarDia(); pintarCalculos() }

  // ── Líneas para la partida (suman exactamente la caja del día) ──
  function lineasPartida() {
    if (!ctx) return []
    const out = []
    // centroId: el centro elegido en la línea; si no viene, app.js lo saca del nombre del centro
    const L = (codigo, tipo, monto, centro, desc, centroId) => {
      if (Math.abs(r2(monto)) < 0.005) return
      if (monto < 0) { monto = -monto; tipo = tipo === 'debito' ? 'credito' : 'debito' }   // ej. el banco depositó de más
      const c = codigo ? cta(codigo) : null
      // Solo gastos llevan centro; sin cuenta todavía se deja el centro sugerido por si se elige un gasto
      if (codigo && !esGasto(codigo)) { centro = ''; centroId = '' }
      out.push({ cuenta_codigo: c?.codigo || codigo || '', cuenta_nombre: c?.nombre || '', tipo, monto: r2(monto), centro: centro || '', centro_id: centroId,
        descripcion: desc + (codigo ? '' : ' - ELEGIR CUENTA') })
    }
    let sumSis = 0
    // Reembolsos de las notas de crédito del reporte: ya van en las líneas de notas de crédito
    // (devolución contra la caja). Una devolución en efectivo que el cajero también puso como
    // salida no se vuelve a cargar; lo reembolsado por transferencia salió del banco, no de la caja.
    const ncEf = {}, ncTr = {}
    for (const n of ctx.nc || []) {
      ncEf[n.centro] = r2((ncEf[n.centro] || 0) + (+n.reembEfectivo || 0))
      ncTr[n.centro] = r2((ncTr[n.centro] || 0) + (+n.reembTransf || 0))
    }
    let cubierto = 0
    for (const [k, c] of Object.entries(cajeros)) {
      const s = c.sis, e = c.ent, t = totEnt(e), nom = norm(c.nombre)
      sumSis += totSis(s)
      if (!t.lleno) { L('', 'debito', totSis(s), c.centro, `FORMAS DE PAGO ${nom}`); continue }
      for (const x of e.trs) L(x.cta || '', 'debito', parseFloat(x.monto) || 0, '', `TRANSFERENCIA ${nom}: ${String(x.det || '').toUpperCase()}`, x.cc ?? ccDe(c.centro))
      L(ctx.caja.codigo, 'debito', parseFloat(e.ef) || 0, '', `EFECTIVO ENTREGADO ${nom}`)
      // Salida: el dinero se fue a la cuenta elegida (débito) · entrada: el efectivo contado la incluye, se acredita su origen (ej. anticipo de clientes)
      for (const x of e.salidas) if (x.tipo) {
        const codigo = x.cta ?? ctaSalida(x.det, c.centro)
        let monto = parseFloat(x.monto) || 0
        const esDevol = x.tipo !== 'ent' && (/^410201/.test(codigo || '') || (!codigo && /DEVOLUCION/.test(norm(x.det))))
        const ya = esDevol ? Math.min(monto, ncEf[c.centro] || 0) : 0
        if (ya > 0) { ncEf[c.centro] = r2(ncEf[c.centro] - ya); cubierto = r2(cubierto + ya); monto = r2(monto - ya) }
        L(codigo, x.tipo === 'ent' ? 'credito' : 'debito', monto, c.centro,
          `${x.tipo === 'ent' ? 'ENTRADA' : 'SALIDA'} DE EFECTIVO ${nom}: ${String(x.det || '').toUpperCase()}`, x.cc ?? ccDe(c.centro))
      }
      const d = r2(t.total - totSis(s))
      if (d < 0) L(cxcDefecto(k), 'debito', -d, '', `FALTANTE DE CAJA ${nom}`)
      if (d > 0) L(ctaDefecto('sobrante'), 'credito', d, c.centro, `SOBRANTE DE CAJA ${nom}`)
    }
    // Lotes POS por centro y banco (como el arqueo consolidado): depósito + comisión + retenido
    for (const x of bancosPos()) {
      L(ctaDefecto('pos_' + x.b), 'debito', x.dep, x.centro, `VENTA DE POS ${x.b} ${x.centro.toUpperCase()}`)
      for (const [cf, v] of Object.entries(x.comPor)) L(ctaDefecto('comision_pos'), 'debito', v, cf,
        cf === x.centro ? `COMISION POS ${x.b} ${x.centro.toUpperCase()}` : `COMISION POS ${x.b} ${x.centro.toUpperCase()} (VENTA ${cf.toUpperCase()})`)
      L('', 'debito', x.ret, x.centro, `IMPUESTO RETENIDO POS ${x.b} ${x.centro.toUpperCase()}`)
    }
    for (const [centro, v] of Object.entries(ncTr)) L('', 'credito', v, '', `REEMBOLSOS POR TRANSFERENCIA DE NOTAS DE CREDITO ${centro.toUpperCase()} (BANCO)`)
    const trNC = r2(Object.values(ncTr).reduce((a, v) => a + v, 0))
    // Lo que sobra (saldo a favor usado, depósitos aplicados, redondeo…) va a la caja
    const otros = r2(ctx.totalCaja - sumSis + cubierto + trNC)
    if (otros > 0) L(ctx.caja.codigo, 'debito', otros, '', 'OTROS MOVIMIENTOS DE CAJA SIN CAJERO')
    if (otros < 0) L(ctx.caja.codigo, 'credito', -otros, '', 'OTROS MOVIMIENTOS DE CAJA SIN CAJERO (REEMBOLSOS / SALDO A FAVOR)')
    resumenNC = { cubierto, trNC, otros }
    return out
  }
  // Lo usa guardarImportPartida: null = no se usa el cuadre (queda la línea única de formas de pago)
  window.cuadreCajerosLineas = () => (usar && ctx ? lineasPartida() : null)

  // Lo llama renderImportPartida cada vez que se procesan los reportes
  window.cuadreCajerosRender = async (data, totalCaja, caja, nc) => {
    ctx = { data, totalCaja: r2(totalCaja), caja, nc: nc || [] }
    cajeros = {}
    for (const [k, c] of Object.entries(calcularSistema(data))) cajeros[k] = { ...c, ent: entVacio() }
    const dia = lsGet(lsKeyDia(), null)
    if (dia?.cajeros) for (const [k, g] of Object.entries(dia.cajeros)) {
      const kk = cajeros[k] ? k : buscarCajero(g.nombre)
      if (kk) cajeros[kk].ent = { ...entVacio(), ...g.ent }
      else cajeros[k] = { nombre: g.nombre, centro: '', sis: { ef: 0, tj: 0, tr: 0, n: 0 }, ent: { ...entVacio(), ...g.ent } }
    }
    usar = !!dia?.usar
    depositos = dia?.depositos || {}
    try { await cargarCuentas() } catch (_) {}
    for (const c of Object.values(cajeros)) migrarEnt(c.ent, c.centro)
    render()
  }
  window.cuadreCajerosReset = () => { ctx = null; cajeros = {}; usar = false; depositos = {}; document.getElementById('import-step-cuadre')?.classList.add('hidden') }
})()
