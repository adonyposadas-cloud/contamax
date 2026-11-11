// ══════════════════════════════════════════════
// ── BOLETAS DE COMPRA · js/boletas_compra.js
// ── Emisión como autoimpresor (SAR-927). Acuerdo 481-2017:
//    art. 20 formato · art. 21 datos al emitir · art. 22 uso y límites.
//
// La boleta respalda compras de bienes o mano de obra no calificada a personas
// naturales hondureñas que no dan factura. NO da crédito fiscal de ISV, el total
// del año no puede pasar del 5% de los gastos operativos deducibles, y a una misma
// persona no se le puede comprar con boleta más de la base exenta del ISR del
// período (si pasa, el proveedor debe dar factura).
//
// El número sale de la base (emitir_boleta_compra) bajo candado: nunca se repite y
// una boleta mal hecha se anula, no se borra.
// ══════════════════════════════════════════════
;(function () {
  'use strict'
  const sb = () => window._sb
  const $ = (id) => document.getElementById(id)
  const fmt = (v) => (Number(v) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))

  // Datos del emisor (art. 20.1), como están en el registro del SAR
  const EMISOR = {
    razon: 'TECNIMAX S. DE R.L.', comercial: 'TECNIMAX', rtn: '08019010278503',
    direccion: 'Col. La Soledad, Boulevard Fuerzas Armadas, 400 metros de Gasolinera UNO Centroamérica, Distrito Central, Francisco Morazán',
    telefono: '2227-4005 / 9450-6951', correo: 'adonyposadas@yahoo.es'
  }

  let _rango = null, _lista = [], _desdeCompra = false

  // ── Número a letras (lempiras) ──
  const U = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
    'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO',
    'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']
  const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
  const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']
  function menorMil (n) {
    if (n === 0) return ''
    if (n === 100) return 'CIEN'
    const c = Math.floor(n / 100), r = n % 100
    let t = C[c]
    if (r) t += (t ? ' ' : '') + (r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : ''))
    return t
  }
  function enteroALetras (n) {
    if (n === 0) return 'CERO'
    const millones = Math.floor(n / 1e6), miles = Math.floor((n % 1e6) / 1000), resto = n % 1000
    const partes = []
    if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : menorMil(millones).replace(/UNO$/, 'UN') + ' MILLONES')
    if (miles) partes.push(miles === 1 ? 'MIL' : menorMil(miles).replace(/UNO$/, 'UN') + ' MIL')
    if (resto) partes.push(menorMil(resto))
    return partes.join(' ')
  }
  const aLetras = (v) => {
    const total = r2(v), ent = Math.floor(total), cent = Math.round((total - ent) * 100)
    // "UN lempira", "veintiÚN lempiras", "un millón DE lempiras"
    let txt = enteroALetras(ent).replace(/UNO$/, 'UN').replace(/VEINTIUNO$/, 'VEINTIÚN')
    if (/MILL(ÓN|ONES)$/.test(txt)) txt += ' DE'
    return `${txt} ${ent === 1 ? 'LEMPIRA' : 'LEMPIRAS'} CON ${String(cent).padStart(2, '0')}/100`
  }
  window._boletaALetras = aLetras

  async function cargarRango () {
    const { data } = await sb().from('boleta_compra_rangos').select('*').eq('activo', true).order('fecha_limite').limit(5)
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' })
    _rango = (data || []).find(r => r.fecha_limite >= hoy && r.siguiente <= r.hasta) || (data || [])[0] || null
    return _rango
  }
  const numeroDe = (r, n) => `${r.establecimiento}-${r.punto_emision}-${r.tipo_documento}-${String(n).padStart(8, '0')}`

  // ── Pantalla: Contabilidad → Boletas de compra ──
  window.initBoletasCompra = async () => {
    const out = $('bc-contenido')
    out.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3)">Cargando…</div>'
    const r = await cargarRango()
    const { data, error } = await sb().from('boletas_compra').select('*').order('correlativo', { ascending: false }).limit(500)
    if (error) { out.innerHTML = `<div style="padding:20px;color:var(--red)">${esc(error.message)}<br>¿Ya corriste sql/boletas_compra.sql?</div>`; return }
    _lista = data || []
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' })
    const quedan = r ? r.hasta - r.siguiente + 1 : 0
    const diasLim = r ? Math.round((new Date(r.fecha_limite) - new Date(hoy)) / 86400000) : 0
    const aviso = !r ? '<span style="color:var(--red)">No hay rango autorizado cargado</span>'
      : r.fecha_limite < hoy ? '<span style="color:var(--red)">El CAI venció: solicitá otro al SAR</span>'
        : quedan <= 50 ? `<span style="color:var(--amber)">Quedan ${quedan} boletas: pedí otro rango al SAR</span>`
          : diasLim <= 30 ? `<span style="color:var(--amber)">El CAI vence en ${diasLim} días</span>` : '<span style="color:var(--green)">Vigente</span>'
    out.innerHTML = `
      <div class="form-card" style="margin-bottom:16px">
        <div class="form-card-title" style="justify-content:space-between"><span>Rango autorizado (autoimpresor)</span>${aviso}</div>
        ${r ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;font-size:13px">
          <div><div style="color:var(--text3);font-size:11px">CAI</div><b style="font-family:var(--mono)">${esc(r.cai)}</b></div>
          <div><div style="color:var(--text3);font-size:11px">Rango</div><span style="font-family:var(--mono)">${numeroDe(r, r.desde)} / ${numeroDe(r, r.hasta)}</span></div>
          <div><div style="color:var(--text3);font-size:11px">Siguiente número</div><b style="font-family:var(--mono)">${r.siguiente <= r.hasta ? numeroDe(r, r.siguiente) : '— agotado —'}</b> · quedan ${quedan}</div>
          <div><div style="color:var(--text3);font-size:11px">Fecha límite de emisión</div>${esc(r.fecha_limite)}</div>
        </div>` : ''}
      </div>
      <div class="form-card">
        <div class="form-card-title" style="justify-content:space-between"><span>Boletas emitidas (${_lista.length})</span>
          <button class="btn btn-gold" onclick="nuevaBoletaCompra()">+ Emitir boleta</button></div>
        <input placeholder="🔍 Buscar número, proveedor o identidad…" oninput="bcFiltrar(this.value)" style="margin-bottom:8px;width:280px">
        <div class="table-wrap"><table>
          <thead><tr><th>Número</th><th>Fecha</th><th>Proveedor</th><th>RTN / Identidad</th><th style="text-align:right">Total</th><th>Estado</th><th></th></tr></thead>
          <tbody id="bc-filas">${_lista.map(b => `<tr data-b="${esc((b.numero + ' ' + b.proveedor_nombre + ' ' + b.proveedor_rtn).toUpperCase())}" style="${b.estado === 'anulada' ? 'opacity:.5' : ''}">
            <td style="font-family:var(--mono)">${esc(b.numero)}</td><td>${esc(b.fecha)}</td><td>${esc(b.proveedor_nombre)}</td>
            <td style="font-family:var(--mono)">${esc(b.proveedor_rtn)}</td><td style="text-align:right;font-family:var(--mono)">${fmt(b.total)}</td>
            <td>${b.estado === 'anulada' ? `<span style="color:var(--red)" title="${esc(b.motivo_anulacion || '')}">Anulada</span>` : 'Emitida'}</td>
            <td style="white-space:nowrap"><button class="btn btn-ghost" style="padding:2px 8px;font-size:11px" onclick="imprimirBoletaCompra('${b.id}')">🖨 Imprimir</button>
              ${b.estado === 'emitida' ? `<button class="btn btn-ghost" style="padding:2px 8px;font-size:11px;color:var(--red)" onclick="anularBoletaCompra('${b.id}')">Anular</button>` : ''}</td>
          </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:18px">Todavía no se ha emitido ninguna</td></tr>'}</tbody>
        </table></div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">La boleta de compra respalda costos y gastos por compras a personas naturales hondureñas que no emiten factura (bienes o mano de obra no calificada). No da crédito fiscal de ISV (art. 22).</div>
      </div>`
  }

  window.bcFiltrar = (q) => {
    const t = String(q || '').trim().toUpperCase()
    document.querySelectorAll('#bc-filas tr[data-b]').forEach(tr => { tr.style.display = !t || tr.dataset.b.includes(t) ? '' : 'none' })
  }

  // ── Formulario de emisión ──
  // pre: { proveedor, rtn, descripcion, monto, fecha } (desde Registrar compra)
  window.nuevaBoletaCompra = async (pre) => {
    _desdeCompra = !!pre
    pre = pre || {}
    const r = await cargarRango()
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' })
    if (!r || r.fecha_limite < hoy || r.siguiente > r.hasta) { window.toast?.('No hay rango de boletas vigente con números disponibles', 'error'); return }
    $('modal-boleta')?.remove()
    const ov = document.createElement('div')
    ov.id = 'modal-boleta'; ov.className = 'modal-backdrop open'; ov.style.zIndex = 1100
    const campo = (id, lbl, val, extra) => `<div class="fld" style="margin:0"><label>${lbl}</label><input id="${id}" value="${esc(val || '')}" ${extra || ''}></div>`
    ov.innerHTML = `
      <div class="modal" style="width:min(820px,96vw);max-height:92vh;display:flex;flex-direction:column">
        <div class="modal-header"><h3>Emitir boleta de compra · ${numeroDe(r, r.siguiente)}</h3><button class="modal-close" onclick="document.getElementById('modal-boleta').remove()">✕</button></div>
        <div class="modal-body" style="flex:1;min-height:0;overflow:auto">
          <div style="font-size:12px;color:var(--text3);margin-bottom:10px">Solo para compras a <b>personas naturales hondureñas</b> que no dan factura (bienes o mano de obra no calificada). No da crédito de ISV.</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${campo('bc-nombre', 'Nombre del proveedor *', pre.proveedor, 'style="text-transform:uppercase" onblur="bcAcumulado()"')}
            ${campo('bc-rtn', 'RTN o identidad del proveedor *', pre.rtn, 'placeholder="0801-1990-12345" onblur="bcAcumulado()"')}
            ${campo('bc-dir', 'Domicilio del proveedor *', '')}
            ${campo('bc-tel', 'Teléfono *', '')}
            ${campo('bc-correo', 'Correo electrónico', '')}
            ${campo('bc-fecha', 'Fecha de emisión *', pre.fecha || hoy, 'type="date"')}
          </div>
          <details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--text3)">Solo si el adquirente es exonerado (orden de compra exenta, constancia, SAG)</summary>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:8px">
              ${campo('bc-oce', 'N.º orden de compra exenta', '')}${campo('bc-exo', 'N.º constancia registro exonerados', '')}${campo('bc-sag', 'N.º registro SAG', '')}
            </div></details>
          <div id="bc-acum" style="font-size:12px;margin-top:8px"></div>
          <div style="font-weight:600;margin:14px 0 6px">Detalle</div>
          <table style="font-size:13px"><thead><tr><th style="width:90px">Cantidad</th><th>Descripción del producto o servicio</th><th style="width:130px">Precio unitario</th><th style="width:120px;text-align:right">Valor total</th><th></th></tr></thead>
            <tbody id="bc-lineas"></tbody></table>
          <button class="btn btn-ghost" style="margin-top:6px;padding:3px 10px;font-size:12px" onclick="bcLinea()">+ Línea</button>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:8px;border-top:1px solid var(--border)">
            <div id="bc-letras" style="font-size:12px;color:var(--text2)"></div><b id="bc-total" style="font-family:var(--mono);font-size:16px">L. 0.00</b></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick="document.getElementById('modal-boleta').remove()">Cancelar</button>
          <button class="btn btn-gold" id="bc-emitir" onclick="emitirBoletaCompra()">Emitir e imprimir</button>
        </div>
      </div>`
    document.body.appendChild(ov)
    window.bcLinea(pre.descripcion ? { cantidad: 1, descripcion: pre.descripcion, precio: pre.monto } : null)
    window.bcAcumulado()
  }

  window.bcLinea = (l) => {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td><input class="bc-cant" type="number" step="0.01" value="${l?.cantidad ?? 1}" oninput="bcCalc()"></td>
      <td><input class="bc-desc" value="${esc(l?.descripcion || '')}" style="text-transform:uppercase"></td>
      <td><input class="bc-precio" type="number" step="0.01" value="${l?.precio ?? ''}" oninput="bcCalc()"></td>
      <td class="bc-sub" style="text-align:right;font-family:var(--mono)">0.00</td>
      <td><button class="btn btn-ghost" style="padding:1px 7px" onclick="this.closest('tr').remove();bcCalc()">✕</button></td>`
    $('bc-lineas').appendChild(tr)
    window.bcCalc()
  }

  function bcLeerLineas () {
    return [...document.querySelectorAll('#bc-lineas tr')].map(tr => {
      const cantidad = r2(tr.querySelector('.bc-cant').value), precio = r2(tr.querySelector('.bc-precio').value)
      return { cantidad, descripcion: tr.querySelector('.bc-desc').value.trim().toUpperCase(), precio, total: r2(cantidad * precio) }
    }).filter(l => l.descripcion || l.total)
  }

  window.bcCalc = () => {
    document.querySelectorAll('#bc-lineas tr').forEach(tr => {
      tr.querySelector('.bc-sub').textContent = fmt(r2(tr.querySelector('.bc-cant').value) * r2(tr.querySelector('.bc-precio').value))
    })
    const t = bcLeerLineas().reduce((a, l) => a + l.total, 0)
    $('bc-total').textContent = 'L. ' + fmt(t)
    $('bc-letras').textContent = t > 0 ? aLetras(t) : ''
  }

  // Art. 22.3: lo comprado con boleta a la misma persona en el año, para no pasar la base exenta del ISR
  window.bcAcumulado = async () => {
    const rtn = ($('bc-rtn')?.value || '').trim()
    const box = $('bc-acum'); if (!box) return
    if (!rtn) { box.innerHTML = ''; return }
    const anio = ($('bc-fecha')?.value || '').slice(0, 4) || String(new Date().getFullYear())
    const { data } = await sb().from('boletas_compra').select('total').eq('proveedor_rtn', rtn).eq('estado', 'emitida')
      .gte('fecha', anio + '-01-01').lte('fecha', anio + '-12-31')
    const tot = (data || []).reduce((a, b) => a + (+b.total || 0), 0)
    box.innerHTML = tot ? `<span style="color:var(--amber)">A este proveedor ya se le compró con boleta L. ${fmt(tot)} en ${anio}. Si con esta compra pasa la base exenta del ISR del año, debe darte factura (art. 22).</span>` : ''
  }

  window.emitirBoletaCompra = async () => {
    const lineas = bcLeerLineas()
    const total = r2(lineas.reduce((a, l) => a + l.total, 0))
    const p = {
      proveedor_nombre: $('bc-nombre').value, proveedor_rtn: $('bc-rtn').value, proveedor_direccion: $('bc-dir').value,
      proveedor_telefono: $('bc-tel').value, proveedor_correo: $('bc-correo').value, fecha: $('bc-fecha').value,
      orden_compra_exenta: $('bc-oce').value, constancia_exonerado: $('bc-exo').value, registro_sag: $('bc-sag').value,
      lineas, total, total_letras: aLetras(total)
    }
    if (lineas.some(l => !l.descripcion || !(l.cantidad > 0) || !(l.precio > 0))) { window.toast?.('Cada línea necesita cantidad, descripción y precio', 'error'); return }
    if (!confirm(`¿Emitir la boleta de compra por L. ${fmt(total)} a ${String(p.proveedor_nombre).toUpperCase()}?\n\nEl número queda usado: si sale mal, se anula (no se borra).`)) return
    const btn = $('bc-emitir'); btn.disabled = true; btn.textContent = 'Emitiendo…'
    const { data, error } = await sb().rpc('emitir_boleta_compra', { p })
    if (error) { window.toast?.('No se emitió: ' + error.message, 'error'); btn.disabled = false; btn.textContent = 'Emitir e imprimir'; return }
    $('modal-boleta').remove()
    window.logActividad?.('boleta_compra_emitida', 'contabilidad', `Boleta ${data.numero} · ${data.proveedor_nombre} · L. ${fmt(data.total)}`, data.id)
    window.toast?.(`Boleta ${data.numero} emitida`, 'success')
    // Desde Registrar compra: la boleta es el documento de esa compra
    if (_desdeCompra) {
      if ($('fc-numero')) $('fc-numero').value = data.numero
      if ($('fc-rtn') && !$('fc-rtn').value) $('fc-rtn').value = data.proveedor_rtn
      if ($('fc-monto')) $('fc-monto').value = data.total
      if ($('fc-proveedor-nombre')) $('fc-proveedor-nombre').value = data.proveedor_nombre
      if ($('fc-obs')) $('fc-obs').value = `Boleta de compra ${data.numero} (sin ISV)` + ($('fc-obs').value ? '\n' + $('fc-obs').value : '')
    }
    imprimir(data)
    if (document.getElementById('view-boletas-compra')?.classList.contains('active')) window.initBoletasCompra()
  }

  window.anularBoletaCompra = async (id) => {
    const motivo = prompt('Motivo de la anulación (el número queda usado):')
    if (motivo === null) return
    const { error } = await sb().rpc('anular_boleta_compra', { p_id: id, p_motivo: motivo })
    if (error) { window.toast?.(error.message, 'error'); return }
    window.toast?.('Boleta anulada', 'success')
    window.initBoletasCompra()
  }

  window.imprimirBoletaCompra = (id) => { const b = _lista.find(x => x.id === id); if (b) imprimir(b) }

  // ── Impresión: original (contribuyente adquirente) y copia (proveedor) en una hoja carta ──
  async function imprimir (b) {
    const { data: r } = await sb().from('boleta_compra_rangos').select('*').eq('id', b.rango_id).single()
    const rango = r ? `${numeroDe(r, r.desde)} / ${numeroDe(r, r.hasta)}` : ''
    const fechaLim = r ? r.fecha_limite.split('-').reverse().join('/') : ''
    const filas = (b.lineas || []).map(l => `<tr><td class="c">${fmt(l.cantidad).replace(/\.00$/, '')}</td><td>${esc(l.descripcion)}</td><td class="n">${fmt(l.precio)}</td><td class="n">${fmt(l.total)}</td></tr>`).join('')
    const vacias = Math.max(0, 6 - (b.lineas || []).length)
    const ejemplar = (destino) => `
      <div class="bol">
        <div class="head"><div><div class="razon">${EMISOR.razon}</div><div class="peq">${EMISOR.comercial} · R.T.N. ${EMISOR.rtn}</div>
          <div class="peq">${EMISOR.direccion}</div><div class="peq">Tel. ${EMISOR.telefono} · ${EMISOR.correo}</div></div>
          <div class="num"><div class="tit">BOLETA DE COMPRA</div><div>No. ${esc(b.numero)}</div><div class="peq">CAI: ${esc(r?.cai || '')}</div></div></div>
        <table class="datos">
          <tr><td colspan="2">Nombre del proveedor: <b>${esc(b.proveedor_nombre)}</b></td></tr>
          <tr><td>R.T.N. o identidad del proveedor: <b>${esc(b.proveedor_rtn)}</b></td><td>Fecha de emisión: <b>${esc(b.fecha.split('-').reverse().join('/'))}</b></td></tr>
          <tr><td colspan="2">Domicilio fiscal del proveedor: ${esc(b.proveedor_direccion)}</td></tr>
          <tr><td colspan="2">Teléfono y correo del proveedor: ${esc(b.proveedor_telefono)}${b.proveedor_correo ? ' · ' + esc(b.proveedor_correo) : ''}</td></tr>
          <tr><td colspan="2">No. correlativo de orden de compra exenta: ${esc(b.orden_compra_exenta || '')}</td></tr>
          <tr><td colspan="2">No. correlativo de constancia del registro de exonerados: ${esc(b.constancia_exonerado || '')}</td></tr>
          <tr><td colspan="2">No. identificativo del registro de la SAG: ${esc(b.registro_sag || '')}</td></tr>
        </table>
        <table class="det"><thead><tr><th style="width:12%">Cantidad</th><th>Descripción del producto comprado</th><th style="width:16%">Precio unitario</th><th style="width:16%">Valor total</th></tr></thead>
          <tbody>${filas}${'<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>'.repeat(vacias)}</tbody>
          <tfoot><tr><td colspan="2">Cantidad en letras: <b>${esc(b.total_letras)}</b></td><td class="n">L</td><td class="n"><b>L ${fmt(b.total)}</b></td></tr></tfoot></table>
        <div class="pie"><div class="peq">Fecha límite de emisión: ${fechaLim}<br>Rango autorizado: ${rango}<br><b>ORIGINAL - CONTRIBUYENTE ADQUIRIENTE · COPIA - PROVEEDOR</b>
          <br><span class="dest">Ejemplar: ${destino}</span>${b.estado === 'anulada' ? '<br><b style="color:#b00000">ANULADA</b>' : ''}</div>
          <div class="firma">Firma y huella del proveedor</div></div>
      </div>`
    const w = window.open('', '_blank')
    if (!w) { window.toast?.('El navegador bloqueó la ventana: permití ventanas emergentes', 'error'); return }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Boleta de compra ${esc(b.numero)}</title><style>
      @page { size: letter; margin: 0.8cm }
      body { font-family: Arial, sans-serif; font-size: 9.5pt; color:#000; background:#fff; margin:0 }
      .bol { border:1px solid #000; border-radius:8px; padding:8px 10px; height:12.4cm; box-sizing:border-box; display:flex; flex-direction:column; margin-bottom:0.6cm }
      .head { display:flex; justify-content:space-between; gap:12px; border-bottom:1px solid #000; padding-bottom:5px }
      .razon { font-weight:700; font-size:12pt } .peq { font-size:8pt } .num { text-align:right; font-weight:700; font-size:11pt; white-space:nowrap }
      .num .tit { font-size:14pt } table { width:100%; border-collapse:collapse } .datos td { border-bottom:1px solid #999; padding:2px 4px; font-size:8.8pt }
      .det { margin-top:5px } .det th, .det td { border:1px solid #000; padding:2px 5px } .det th { background:#fff; font-size:8.8pt } .c { text-align:center } .n { text-align:right }
      .pie { margin-top:auto; display:flex; justify-content:space-between; align-items:flex-end } .firma { border-top:1px solid #000; width:42%; text-align:center; padding-top:3px }
      .dest { font-weight:700 }
    </style></head><body>${ejemplar('ORIGINAL · CONTRIBUYENTE ADQUIRIENTE')}${ejemplar('COPIA · PROVEEDOR')}</body></html>`)
    w.document.close(); w.focus(); w.print()
  }
})()
