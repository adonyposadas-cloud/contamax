// ══════════════════════════════════════════════
// ── CIERRE DIARIO · js/cierre_diario.js
// ── Ventas del día (parte fiscal) y cómo se cobraron, con su cuadre.
//
// Ventas: libro_ventas de la fecha (lo fiscal). Las notas de crédito son las filas en
// negativo (serie 001-001-06-…). Ventas brutas sin ISV = total − ISV + descuento, así
// no depende de si Alpha da el gravado antes o después del descuento.
//
// Cobros: las líneas de las partidas de Ventas Alpha de la fecha, menos las de venta,
// ISV y devoluciones (que ya salen del libro). Regla para cuadrar:
//   · línea NO fiscal (desmarcada) → efectivo, sea cual sea su cuenta
//   · 110103-* bancos de la empresa · 1101* y 110104-* efectivo
//   · 620101-005 comisión POS (la retiene el banco) · 1102* crédito (CxC)
//   · 210101-032 saldo a favor: débito = factura pagada con saldo, crédito = NC a saldo
//   · lo demás, "otros" (sobrantes, etc.)
// Débito suma, crédito resta. Cuadre: facturado − devoluciones = total cobrado.
// ══════════════════════════════════════════════
;(function () {
  'use strict'
  const sb = () => window._sb
  const fmt = (v) => (Number(v) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  const $ = (id) => document.getElementById(id)
  let ultimo = null
  // Grupos que se muestran solo con su total, sin las cuentas que lo forman
  const SIN_DETALLE = new Set(['efectivo'])
  const abiertos = new Set()   // grupos de cobro desplegados

  const esNota = (v) => (+v.total || 0) < 0 || /^\d{3}-\d{3}-06-/.test(v.factura_electronica || '')
  // Lado de la venta: no son cobros (vienen del libro). Ventas 410101/410301, devoluciones
  // 410201 e ISV 2102. Otros ingresos (410305 sobrante, 410306…) sí entran al cuadre, en 'otros'.
  const esLadoVenta = (l) => /^(410101|410301|410201|2102)/.test(l.cuenta_codigo || '')

  function categoria (l) {
    const c = l.cuenta_codigo || ''
    if (!l.aplica_fiscal) return 'efectivo'
    if (c.startsWith('110103')) return 'bancos'
    if (c.startsWith('110104') || c.startsWith('1101')) return 'efectivo'
    if (c.startsWith('620101-005')) return 'comision'
    if (c.startsWith('1102')) return 'credito'
    if (c.startsWith('210101-032')) return 'saldo'
    return 'otros'
  }
  const ETIQ = {
    bancos: 'Bancos de la empresa (110103)', comision: 'Comisiones POS (las retiene el banco)',
    efectivo: 'Efectivo a depositar', credito: 'Crédito (cuentas por cobrar)',
    saldo: 'Saldo a favor de clientes', otros: 'Otros (sobrantes, ajustes)'
  }

  window.initCierreDiario = () => {
    if (!$('cd-fecha').value) {
      const ayer = new Date(); ayer.setDate(ayer.getDate() - 1)
      $('cd-fecha').value = ayer.toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' })
    }
  }

  window.cargarCierreDiario = async () => {
    const fecha = $('cd-fecha').value
    if (!fecha) { window.toast?.('Elegí la fecha', 'error'); return }
    const out = $('cd-resultado')
    out.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3)">Cargando…</div>'
    const [{ data: cc }, { data: ventas, error: ev }, { data: partidas, error: ep }] = await Promise.all([
      sb().from('centros_costo').select('id,nombre'),
      sb().from('libro_ventas').select('*').eq('fecha', fecha),
      sb().from('partidas_contables').select('id,numero_partida,estado,descripcion,total').eq('fecha_partida', fecha).eq('tipo_origen', 'venta_alpha').neq('estado', 'anulada')
    ])
    if (ev || ep) { out.innerHTML = `<div style="padding:20px;color:var(--red)">${esc((ev || ep).message)}</div>`; return }
    const nomCC = Object.fromEntries((cc || []).map(c => [c.id, c.nombre]))
    const ids = (partidas || []).map(p => p.id)
    let lineas = []
    if (ids.length) {
      const { data, error } = await sb().from('lineas_partida').select('partida_id,cuenta_codigo,cuenta_nombre,tipo,monto,descripcion,aplica_fiscal').in('partida_id', ids)
      if (error) { out.innerHTML = `<div style="padding:20px;color:var(--red)">${esc(error.message)}</div>`; return }
      lineas = data || []
    }

    // ── Ventas por centro ──
    const fiscales = (ventas || []).filter(v => v.incluir_fiscal !== false)
    const porCentro = {}
    const fila = (k) => porCentro[k] || (porCentro[k] = { centro: k, n: 0, bruto: 0, desc: 0, neto: 0, grav: 0, ex: 0, isv: 0, total: 0, nNC: 0, devol: 0, devolIsv: 0 })
    for (const v of fiscales) {
      const f = fila(nomCC[v.centro_costo_id] || 'Sin centro')
      const total = +v.total || 0, isv = +v.isv || 0, desc = +v.descuento || 0
      if (esNota(v)) { f.nNC++; f.devol += -(total - isv); f.devolIsv += -isv; continue }
      f.n++; f.bruto += total - isv + desc; f.desc += desc; f.neto += total - isv
      f.grav += +v.total_gravado || 0; f.ex += +v.total_exento || 0; f.isv += isv; f.total += total
    }
    const centros = Object.values(porCentro).sort((a, b) => a.centro.localeCompare(b.centro))
    const T = centros.reduce((a, f) => { for (const k of ['n', 'bruto', 'desc', 'neto', 'grav', 'ex', 'isv', 'total', 'nNC', 'devol', 'devolIsv']) a[k] += f[k]; return a },
      { n: 0, bruto: 0, desc: 0, neto: 0, grav: 0, ex: 0, isv: 0, total: 0, nNC: 0, devol: 0, devolIsv: 0 })

    // ── Cobros ──
    const cob = {}
    for (const l of lineas) {
      // Una línea no fiscal es efectivo aunque sea de venta (ej. venta Yonker interno 410301-002):
      // así lo cobrado por fuera del libro se compensa y el cuadre queda en lo fiscal.
      if (l.aplica_fiscal && esLadoVenta(l)) continue
      const k = categoria(l)
      const signo = l.tipo === 'debito' ? 1 : -1
      const g = cob[k] || (cob[k] = { total: 0, det: {} })
      const sub = k === 'saldo' ? (l.tipo === 'debito' ? 'Facturas pagadas con saldo a favor' : 'Notas de crédito a saldo a favor')
        : `${l.cuenta_codigo} ${l.cuenta_nombre || ''}${l.aplica_fiscal ? '' : ' · no fiscal'}`
      g.total += signo * (+l.monto || 0)
      g.det[sub] = (g.det[sub] || 0) + signo * (+l.monto || 0)
    }
    const orden = ['bancos', 'comision', 'credito', 'saldo', 'otros', 'efectivo'].filter(k => cob[k])
    const totalCobrado = orden.reduce((a, k) => a + cob[k].total, 0)
    const esperado = T.total - (T.devol + T.devolIsv)
    const dif = r2(esperado - totalCobrado)
    ultimo = { fecha, centros, T, cob, orden, totalCobrado, esperado, dif, partidas: partidas || [] }

    // ── Pintar ──
    const n = (v, neg) => `<td style="text-align:right;font-family:var(--mono)${neg && v ? ';color:var(--red)' : ''}">${neg && v ? '−' : ''}${fmt(Math.abs(v))}</td>`
    // Con signo: lo que resta sale con − y en rojo, como las devoluciones
    const sg = (v) => n(Math.abs(v), r2(v) < 0)
    const thC = centros.map(f => `<th style="text-align:right">${esc(f.centro)}</th>`).join('') + '<th style="text-align:right">Total</th>'
    const filaV = (lbl, k, neg, bold) => `<tr${bold ? ' style="font-weight:700;border-top:1px solid var(--border)"' : ''}><td>${lbl}</td>${centros.map(f => n(f[k], neg)).join('')}${n(T[k], neg)}</tr>`
    const netoNeto = (f) => f.neto - f.devol
    const sinPartida = !(partidas || []).length
    out.innerHTML = `
      <div class="form-card" style="margin-bottom:16px">
        <div class="form-card-title" style="justify-content:space-between"><span>Ventas del ${esc(fecha)} · parte fiscal</span>
          <span style="font-size:12px;color:var(--text3);font-weight:400">${T.n} factura(s) · ${T.nNC} nota(s) de crédito</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th></th>${thC}</tr></thead>
          <tbody>
            ${filaV('Ventas brutas sin ISV', 'bruto')}
            ${filaV('Descuentos', 'desc', true)}
            ${filaV('Devoluciones (notas de crédito, sin ISV)', 'devol', true)}
            <tr style="font-weight:700;border-top:1px solid var(--border)"><td>Ventas netas sin ISV</td>${centros.map(f => n(netoNeto(f))).join('')}${n(T.neto - T.devol)}</tr>
            <tr><td style="color:var(--text3);padding-left:18px">· gravado 15%</td>${centros.map(f => n(f.grav)).join('')}${n(T.grav)}</tr>
            <tr><td style="color:var(--text3);padding-left:18px">· exento</td>${centros.map(f => n(f.ex)).join('')}${n(T.ex)}</tr>
            ${filaV('ISV 15%', 'isv')}
            ${T.devolIsv ? filaV('ISV de devoluciones', 'devolIsv', true) : ''}
            <tr style="font-weight:700;border-top:2px solid var(--border)"><td>Total facturado neto (con ISV)</td>${centros.map(f => n(f.total - f.devol - f.devolIsv)).join('')}${n(esperado)}</tr>
          </tbody>
        </table></div>
      </div>
      <div class="form-card" style="margin-bottom:16px">
        <div class="form-card-title" style="justify-content:space-between"><span>Cómo se cobró</span>
          <span style="font-size:12px;color:var(--text3);font-weight:400">${sinPartida ? 'sin partida de Ventas Alpha en esta fecha' : 'partida(s) ' + (partidas || []).map(p => '#' + p.numero_partida + (p.estado !== 'aprobada' ? ' (' + p.estado + ')' : '')).join(', ')}</span></div>
        <div class="table-wrap"><table>
          <tbody>
            ${orden.map(k => SIN_DETALLE.has(k)
              ? `<tr class="cd-grupo" style="font-weight:600;background:rgba(200,162,74,.12)"><td>${ETIQ[k]}</td>${sg(cob[k].total)}</tr>`
              : `<tr class="cd-grupo" style="font-weight:600;cursor:pointer" onclick="cdToggle('${k}')" title="Clic para ver el detalle"><td><span class="cd-flecha" id="cd-fl-${k}">${abiertos.has(k) ? '▾' : '▸'}</span> ${ETIQ[k]}</td>${sg(cob[k].total)}</tr>` +
              Object.entries(cob[k].det).map(([d, v]) => `<tr class="cd-det cd-det-${k}" style="font-size:12px;color:var(--text2)${abiertos.has(k) ? '' : ';display:none'}"><td style="padding-left:26px">${esc(d)}</td>${sg(v)}</tr>`).join('')).join('')}
            <tr style="font-weight:700;border-top:2px solid var(--border)"><td>Total cobrado</td>${sg(totalCobrado)}</tr>
            <tr style="font-weight:700;color:${Math.abs(dif) < 0.01 ? 'var(--green)' : 'var(--red)'}"><td>${Math.abs(dif) < 0.01 ? '✓ Cuadra con lo facturado neto' : 'Diferencia contra lo facturado neto'}</td>${sg(dif)}</tr>
          </tbody>
        </table></div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">Bancos: cuentas 110103. Una diferencia suele ser un sobrante/faltante, una venta sin partida o una línea en otra partida.</div>
      </div>`
  }

  window.cdToggle = (k) => {
    abiertos.has(k) ? abiertos.delete(k) : abiertos.add(k)
    document.querySelectorAll('#cd-resultado .cd-det-' + k).forEach(tr => { tr.style.display = abiertos.has(k) ? '' : 'none' })
    const fl = $('cd-fl-' + k); if (fl) fl.textContent = abiertos.has(k) ? '▾' : '▸'
  }

  // Impresión en blanco (ahorra tinta): una ventana aparte con fondo blanco y letra negra,
  // con todos los grupos desplegados.
  window.imprimirCierreDiario = () => {
    if (!ultimo) { window.toast?.('Primero consultá el cierre', 'info'); return }
    const copia = $('cd-resultado').cloneNode(true)
    copia.querySelectorAll('.cd-det').forEach(tr => { tr.style.display = '' })
    copia.querySelectorAll('.cd-flecha').forEach(e => e.remove())
    const w = window.open('', '_blank')
    if (!w) { window.toast?.('El navegador bloqueó la ventana: permití ventanas emergentes', 'error'); return }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cierre diario ${esc(ultimo.fecha)}</title>
      <style>
        :root { --red:#b00000; --green:#006400; --text2:#333; --text3:#555; --border:#888; --mono:Consolas,monospace; --gold:#000 }
        body { background:#fff; color:#000; font-family:Arial,sans-serif; font-size:11pt; margin:1.5cm }
        h1 { font-size:15pt; margin:0 0 2px } .sub { color:#555; font-size:9pt; margin-bottom:14px }
        .form-card { margin-bottom:16px } .form-card-title { display:flex; justify-content:space-between; font-weight:700; margin-bottom:6px; border-bottom:1px solid #000; padding-bottom:3px }
        table { width:100%; border-collapse:collapse } th, td { padding:3px 6px; border-bottom:1px solid #ddd; text-align:left }
        th { font-size:9pt; color:#333 } tr { background:#fff !important }
        @page { size:letter; margin:1cm }
      </style></head><body>
      <h1>TECNIMAX · Cierre diario</h1><div class="sub">Fecha ${esc(ultimo.fecha)} · impreso ${new Date().toLocaleString('es-HN')}</div>
      ${copia.innerHTML}</body></html>`)
    w.document.close(); w.focus(); w.print()
  }

  window.exportarCierreDiario = () => {
    if (!ultimo) { window.toast?.('Primero consultá el cierre', 'info'); return }
    const u = ultimo
    const ventas = [...u.centros, { centro: 'TOTAL', ...u.T }].map(f => ({
      Centro: f.centro, Facturas: f.n, 'Ventas brutas sin ISV': r2(f.bruto), Descuentos: r2(f.desc), 'Devoluciones sin ISV': r2(f.devol),
      'Ventas netas sin ISV': r2(f.neto - f.devol), Gravado: r2(f.grav), Exento: r2(f.ex), ISV: r2(f.isv), 'ISV devoluciones': r2(f.devolIsv),
      'Total facturado neto': r2(f.total - f.devol - f.devolIsv)
    }))
    const cobros = u.orden.flatMap(k => [{ Concepto: ETIQ[k], Detalle: '', Monto: r2(u.cob[k].total) },
      ...(SIN_DETALLE.has(k) ? [] : Object.entries(u.cob[k].det)).map(([d, v]) => ({ Concepto: '', Detalle: d, Monto: r2(v) }))])
    cobros.push({ Concepto: 'Total cobrado', Detalle: '', Monto: r2(u.totalCobrado) }, { Concepto: 'Diferencia', Detalle: '', Monto: u.dif })
    const wb = window.XLSX.utils.book_new()
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(ventas), 'Ventas')
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(cobros), 'Cobros')
    window.XLSX.writeFile(wb, `Cierre_diario_${u.fecha}.xlsx`)
  }
})()
