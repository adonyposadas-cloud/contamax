// ══════════════════════════════════════════════
// ── MÓDULO PAGO DE COMISIONES · js/comisiones_pago.js
// ── Monto por empleado (los de la planilla) → recibos para firmar + partida del pago.
// ── Las comisiones son salario: van a "BONIFICACIONES Y/O COMISIONES" de su sección
// ── (GO 610101-007 · GV 610102-007 · GA 610103-031), con centro de costo por zona,
// ── igual que la planilla. El borrador queda en este navegador hasta limpiarlo.
// ══════════════════════════════════════════════
;(function () {
"use strict";

const getSb = () => window._sb
const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const r2 = (x) => Math.round(x * 100) / 100

const CAJA_GENERAL = '110102-001'
const BANCO = '110103-001'
const LS_KEY = 'contamax_comisiones_borrador'
const LS_NUM = 'contamax_comisiones_sig_num'

let comEmps = []
let borr = { desde: '', hasta: '', periodo: '', fecha: '', forma: 'Efectivo', montos: {}, conceptos: {} }

function cuentaComision(seccion) {
  const p = (seccion || '').trim().toUpperCase().split(/\s+/)[0]
  if (p === 'GV') return '610102-007'
  if (p === 'GA') return '610103-031'
  return '610101-007'
}
const zonaDe = (e) => e.planilla_confidencial
  ? (e.conf_centro === 'YONKER' ? 'Yonker' : 'Taller')
  : (/yonker/i.test(e.seccion || '') ? 'Yonker' : 'Taller')

function leerBorrador() {
  try { const b = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (b) borr = { ...borr, ...b } } catch (_) {}
}
function guardarBorrador() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(borr)) } catch (_) {}
}
function sigNumero() {
  try { return parseInt(localStorage.getItem(LS_NUM) || '1') || 1 } catch (_) { return 1 }
}

// Período por fechas: días sueltos (liquidación), quincena o mes
const iso = (d) => d.toLocaleDateString('en-CA')
function rangoDefecto() {   // la quincena anterior a hoy
  const h = new Date()
  if (h.getDate() <= 15) return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 16)), iso(new Date(h.getFullYear(), h.getMonth(), 0))]
  return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(new Date(h.getFullYear(), h.getMonth(), 15))]
}
function textoPeriodo(desde, hasta) {
  if (!desde || !hasta) return ''
  const a = new Date(desde + 'T12:00'), b = new Date(hasta + 'T12:00')
  const mes = (d) => d.toLocaleDateString('es-HN', { month: 'long' })
  if (desde === hasta) return `${a.getDate()} de ${mes(a)} ${a.getFullYear()}`
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()} al ${b.getDate()} de ${mes(b)} ${b.getFullYear()}`
  if (a.getFullYear() === b.getFullYear()) return `${a.getDate()} de ${mes(a)} al ${b.getDate()} de ${mes(b)} ${b.getFullYear()}`
  return `${a.getDate()} de ${mes(a)} ${a.getFullYear()} al ${b.getDate()} de ${mes(b)} ${b.getFullYear()}`
}
// Atajos: toman el mes de la fecha "desde"
window.comPagoRango = (tipo) => {
  const base = new Date((document.getElementById('com-desde').value || iso(new Date())) + 'T12:00')
  const y = base.getFullYear(), m = base.getMonth()
  const r = tipo === 'q1' ? [new Date(y, m, 1), new Date(y, m, 15)]
    : tipo === 'q2' ? [new Date(y, m, 16), new Date(y, m + 1, 0)]
    : [new Date(y, m, 1), new Date(y, m + 1, 0)]
  document.getElementById('com-desde').value = iso(r[0])
  document.getElementById('com-hasta').value = iso(r[1])
  document.getElementById('com-desde').dispatchEvent(new Event('change'))
}

window.loadComisionesPago = async () => {
  const root = document.getElementById('view-comisiones-pago')
  if (!root) return
  const rol = window._currentProfile?.()?.rol
  if (!['super_admin', 'contador'].includes(rol)) { root.innerHTML = '<div style="padding:24px;color:var(--red)">Sin permiso.</div>'; return }
  leerBorrador()
  if (!borr.desde || !borr.hasta) [borr.desde, borr.hasta] = rangoDefecto()
  borr.periodo = textoPeriodo(borr.desde, borr.hasta)
  if (!borr.fecha) borr.fecha = new Date().toLocaleDateString('en-CA')

  root.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">💰 Pago de comisiones</div>
        <div class="page-sub">Monto por empleado → recibos para firmar y partida del pago (cuenta Bonificaciones y/o Comisiones de su sección)</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="comPagoPartida()"><svg class=ico aria-hidden=true><use href=#i-notebook></use></svg> Armar partida</button>
        <button class="btn btn-gold" onclick="comPagoImprimir()"><svg class=ico aria-hidden=true><use href=#i-printer></use></svg> Imprimir recibos</button>
      </div>
    </div>
    <div class="form-card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;align-items:end">
      <div class="fld"><label>Período desde</label><input type="date" id="com-desde" value="${esc(borr.desde)}"></div>
      <div class="fld"><label>Período hasta</label><input type="date" id="com-hasta" value="${esc(borr.hasta)}"></div>
      <div class="fld"><label>Atajos (mes de "desde")</label><div style="display:flex;gap:4px">
        <button class="btn btn-ghost" style="padding:6px 8px;font-size:12px" onclick="comPagoRango('q1')">1ra Q</button>
        <button class="btn btn-ghost" style="padding:6px 8px;font-size:12px" onclick="comPagoRango('q2')">2da Q</button>
        <button class="btn btn-ghost" style="padding:6px 8px;font-size:12px" onclick="comPagoRango('mes')">Mes</button></div></div>
      <div class="fld"><label>Fecha de pago</label><input type="date" id="com-fecha" value="${esc(borr.fecha)}"></div>
      <div class="fld"><label>Forma de pago</label><select id="com-forma">
        ${['Efectivo', 'Transferencia', 'Cheque'].map(f => `<option ${borr.forma === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
      <div class="fld"><label>Primer No. de recibo</label><input type="number" id="com-num" min="1" value="${sigNumero()}"></div>
      <div class="fld"><label>Buscar empleado</label><input id="com-buscar" placeholder="Nombre o sección…"></div>
      <label style="display:flex;gap:6px;align-items:center;font-size:13px;padding-bottom:8px"><input type="checkbox" id="com-solo"> Solo con monto</label>
    </div>
    <div id="com-per-txt" style="font-size:13px;color:var(--gold);margin-top:8px">Período: ${esc(borr.periodo)}</div>
    <div class="table-wrap" style="margin-top:8px">
      <table>
        <thead><tr><th>Empleado</th><th>Sección</th><th>Cuenta</th><th style="text-align:right;width:150px">Comisión L.</th><th>Detalle (opcional)</th></tr></thead>
        <tbody id="com-tbody"><tr><td colspan="5" style="padding:20px;color:var(--text3)">Cargando empleados…</td></tr></tbody>
        <tfoot><tr><td colspan="3" style="text-align:right;font-weight:600" id="com-cuenta-n"></td>
          <td style="text-align:right;font-family:var(--mono);font-weight:700;color:var(--gold)" id="com-total">0.00</td>
          <td><button class="btn btn-ghost" style="font-size:12px;padding:3px 10px" onclick="comPagoLimpiar()">Limpiar montos</button></td></tr></tfoot>
      </table>
    </div>`

  const onCab = () => {
    borr.desde = document.getElementById('com-desde').value
    borr.hasta = document.getElementById('com-hasta').value
    if (borr.desde && borr.hasta && borr.hasta < borr.desde) {
      window.toast?.('La fecha "hasta" es anterior a "desde"', 'error')
    }
    borr.periodo = textoPeriodo(borr.desde, borr.hasta)
    const lbl = document.getElementById('com-per-txt'); if (lbl) lbl.textContent = borr.periodo ? 'Período: ' + borr.periodo : ''
    borr.fecha = document.getElementById('com-fecha').value
    borr.forma = document.getElementById('com-forma').value
    guardarBorrador()
  }
  ;['com-desde', 'com-hasta', 'com-fecha', 'com-forma'].forEach(id => document.getElementById(id).addEventListener('change', onCab))
  document.getElementById('com-buscar').addEventListener('input', pintar)
  document.getElementById('com-solo').addEventListener('change', pintar)

  const { data, error } = await getSb().from('empleados').select('id, nombre, seccion, identidad, planilla_confidencial, conf_centro, es_socio')
    .eq('activo', true).order('seccion').order('nombre')
  if (error) { document.getElementById('com-tbody').innerHTML = `<tr><td colspan="5" style="color:var(--red)">${esc(error.message)}</td></tr>`; return }
  comEmps = (data || []).filter(e => !e.es_socio)
  pintar()
}

function pintar() {
  const tb = document.getElementById('com-tbody')
  if (!tb) return
  const q = (document.getElementById('com-buscar')?.value || '').trim().toLowerCase()
  const solo = document.getElementById('com-solo')?.checked
  const lista = comEmps.filter(e => (!q || `${e.nombre} ${e.seccion}`.toLowerCase().includes(q)) && (!solo || (borr.montos[e.id] || 0) > 0))
  tb.innerHTML = lista.length ? lista.map(e => `<tr>
      <td><strong>${esc(e.nombre)}</strong>${e.planilla_confidencial ? ' <span style="color:var(--purple-fg,#a78bfa);font-size:11px">🔒 CONF</span>' : ''}</td>
      <td style="font-size:12px;color:var(--text2)">${esc(e.seccion || '')}</td>
      <td style="font-size:12px;font-family:var(--mono);color:var(--text3)">${cuentaComision(e.seccion)}</td>
      <td style="text-align:right"><input type="number" step="0.01" min="0" data-com="${e.id}" value="${borr.montos[e.id] || ''}" placeholder="0.00"
        style="width:130px;text-align:right;font-family:var(--mono)" onfocus="this.select()"></td>
      <td><input data-con="${e.id}" value="${esc(borr.conceptos[e.id] || '')}" placeholder="Ej: mano de obra órdenes 56300-56346" style="width:100%"></td>
    </tr>`).join('') : '<tr><td colspan="5" style="padding:16px;color:var(--text3)">Ningún empleado coincide.</td></tr>'
  tb.querySelectorAll('[data-com]').forEach(i => i.addEventListener('input', () => {
    const v = r2(parseFloat(i.value) || 0)
    if (v > 0) borr.montos[i.dataset.com] = v; else delete borr.montos[i.dataset.com]
    guardarBorrador(); totales()
  }))
  tb.querySelectorAll('[data-con]').forEach(i => i.addEventListener('input', () => {
    if (i.value.trim()) borr.conceptos[i.dataset.con] = i.value; else delete borr.conceptos[i.dataset.con]
    guardarBorrador()
  }))
  totales()
}

function conMonto() {
  return comEmps.filter(e => (borr.montos[e.id] || 0) > 0)
}
function totales() {
  const l = conMonto()
  const t = r2(l.reduce((s, e) => s + borr.montos[e.id], 0))
  const el = document.getElementById('com-total'); if (el) el.textContent = 'L. ' + fmt(t)
  const n = document.getElementById('com-cuenta-n'); if (n) n.textContent = `${l.length} empleado(s) con comisión · Total`
}

window.comPagoLimpiar = () => {
  if (!confirm('¿Borrar todos los montos y detalles cargados?')) return
  borr.montos = {}; borr.conceptos = {}; guardarBorrador(); pintar()
}

// ── Monto en letras (lempiras) ──
function letras(n) {
  const U = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
    'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUN', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO',
    'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']
  const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
  const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']
  const cien = x => {
    if (x === 100) return 'CIEN'
    const c = Math.floor(x / 100), r = x % 100
    const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : '')
    return [C[c], dec].filter(Boolean).join(' ')
  }
  const ent = Math.floor(n), cent = Math.round((n - ent) * 100)
  const mill = Math.floor(ent / 1e6), mil = Math.floor((ent % 1e6) / 1000), resto = ent % 1000
  const p = []
  if (mill) p.push(mill === 1 ? 'UN MILLON' : cien(mill) + ' MILLONES')
  if (mil) p.push(mil === 1 ? 'MIL' : cien(mil) + ' MIL')
  if (resto) p.push(cien(resto))
  return (p.join(' ') || 'CERO') + ` LEMPIRAS CON ${String(cent).padStart(2, '0')}/100`
}

function recibo(e, num, etiqueta) {
  const m = borr.montos[e.id]
  const fecha = borr.fecha ? new Date(borr.fecha + 'T12:00').toLocaleDateString('es-HN', { day: '2-digit', month: 'long', year: 'numeric' }) : ''
  const det = borr.conceptos[e.id] || ''
  return `<div class="v">
    <div class="v-head">
      <div><div class="v-emp">TECNIMAX</div><div>RTN 08019010278503</div></div>
      <div class="v-tit">RECIBO DE PAGO DE COMISIONES<small>No. ${esc(num)}</small><small>Fecha: ${esc(fecha)}</small></div>
    </div>
    <div class="v-dat">
      <div><b>Empleado:</b> ${esc(e.nombre)}</div><div><b>Identidad:</b> ${esc(e.identidad || '')}</div>
      <div><b>Sección:</b> ${esc(e.seccion || '')}</div><div><b>Período:</b> ${esc(borr.periodo)}</div>
      <div><b>Forma de pago:</b> ${esc(borr.forma)}</div>
    </div>
    <table><thead><tr><th>Concepto</th><th class="n">Monto L.</th></tr></thead>
      <tbody><tr><td>Comisiones del período ${esc(borr.periodo)}${det ? ' — ' + esc(det) : ''}</td><td class="n">${fmt(m)}</td></tr></tbody>
      <tfoot><tr><td><b>NETO RECIBIDO</b></td><td class="n"><b>L. ${fmt(m)}</b></td></tr></tfoot></table>
    <div class="v-rec">Recibí de <b>TECNIMAX</b> la cantidad de <b>${letras(m)}</b> (L. ${fmt(m)}) en concepto de comisiones correspondientes al
      período <b>${esc(borr.periodo)}</b>, calculadas según la política de comisiones vigente.</div>
    <div class="v-firmas"><div>Firma del empleado<br>Identidad: ${esc(e.identidad || '')}</div><div>Entregado / autorizado por</div></div>
    <div class="v-copia">${etiqueta}</div>
  </div>`
}

window.comPagoImprimir = () => {
  const l = conMonto()
  if (!l.length) { window.toast?.('Ningún empleado tiene monto de comisión', 'info'); return }
  if (!borr.desde || !borr.hasta || borr.hasta < borr.desde) { window.toast?.('Revisá las fechas del período', 'error'); return }
  const ini = parseInt(document.getElementById('com-num')?.value) || 1
  const anio = (borr.fecha || '').slice(0, 4) || new Date().getFullYear()
  const numDe = i => `COM-${anio}-${String(ini + i).padStart(3, '0')}`
  // Solo originales: dos empleados por hoja carta, con línea de corte
  const pares = []
  for (let i = 0; i < l.length; i += 2) pares.push([i, i + 1].filter(k => k < l.length))
  const paginas = pares.map(p => `<div class="pag">${p.map(k => recibo(l[k], numDe(k), 'ORIGINAL')).join('<div class="corte"></div>')}</div>`).join('')
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recibos de comisiones</title><style>
    @page { size: letter; margin: 10mm; }
    body { margin:0; font:12px/1.4 Arial, sans-serif; color:#000; }
    .pag { page-break-after: always; } .pag:last-child { page-break-after: auto; }
    .v { border:1.5px solid #000; padding:12px 16px; }
    .corte { border-top:1px dashed #777; margin:9mm 0; }
    .v-head { display:flex; justify-content:space-between; border-bottom:1.5px solid #000; padding-bottom:6px; margin-bottom:8px; }
    .v-emp { font-weight:800; font-size:16px; } .v-tit { text-align:right; font-weight:700; } .v-tit small { display:block; font-weight:400; }
    .v-dat { display:grid; grid-template-columns:1fr 1fr; gap:2px 16px; margin-bottom:8px; }
    table { width:100%; border-collapse:collapse; } th, td { border-bottom:1px solid #999; padding:4px; text-align:left; }
    th { font-size:10px; text-transform:uppercase; } .n { text-align:right; white-space:nowrap; }
    .v-rec { margin:10px 0 4px; text-align:justify; }
    .v-firmas { display:grid; grid-template-columns:1fr 1fr; gap:30px; margin-top:30px; text-align:center; }
    .v-firmas div { border-top:1px solid #000; padding-top:3px; }
    .v-copia { font-size:10px; text-align:right; margin-top:6px; }
  </style></head><body>${paginas}</body></html>`
  // Imprimir desde un iframe oculto (no lo frena el bloqueador de ventanas)
  let fr = document.getElementById('com-print-frame')
  if (fr) fr.remove()
  fr = document.createElement('iframe')
  fr.id = 'com-print-frame'
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(fr)
  fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close()
  setTimeout(() => {
    fr.contentWindow.focus(); fr.contentWindow.print()
    if (confirm(`¿Se imprimieron bien los ${l.length} recibo(s) (${numDe(0)} a ${numDe(l.length - 1)})?\nAsí el próximo pago sigue con el ${numDe(l.length)}.`)) {
      try { localStorage.setItem(LS_NUM, String(ini + l.length)) } catch (_) {}
      const n = document.getElementById('com-num'); if (n) n.value = ini + l.length
    }
  }, 300)
}

// ── Partida del pago: DEBE gasto por empleado (cuenta y centro de su sección) · HABER caja o banco ──
window.comPagoPartida = async () => {
  const l = conMonto()
  if (!l.length) { window.toast?.('Ningún empleado tiene monto de comisión', 'info'); return }
  if (!borr.desde || !borr.hasta || borr.hasta < borr.desde) { window.toast?.('Revisá las fechas del período', 'error'); return }
  const sb = getSb()
  const codigos = [...new Set([...l.map(e => cuentaComision(e.seccion)), CAJA_GENERAL, BANCO])]
  const [{ data: cuentas, error }, { data: centros }] = await Promise.all([
    sb.from('catalogo_cuentas').select('id, codigo, nombre').in('codigo', codigos),
    sb.from('centros_costo').select('id, nombre')
  ])
  if (error) { alert('No se pudo leer el catálogo: ' + error.message); return }
  const cat = Object.fromEntries((cuentas || []).map(c => [c.codigo, c]))
  const falta = codigos.filter(c => !cat[c])
  if (falta.length) { alert('Faltan cuentas en el catálogo: ' + falta.join(', ')); return }
  const centroZona = {
    Taller: (centros || []).find(c => /tecnicentro/i.test(c.nombre))?.id || '',
    Yonker: (centros || []).find(c => /yonker/i.test(c.nombre))?.id || ''
  }
  const per = (borr.periodo || '').toUpperCase()
  let id = 0, total = 0
  const lineas = l.map(e => {
    const c = cat[cuentaComision(e.seccion)], m = borr.montos[e.id]
    total += m
    return { id: ++id, cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre, tipo: 'debito', monto: m,
      centro_costo_id: centroZona[zonaDe(e)] || '', descripcion: `COMISIONES ${per} · ${e.nombre.toUpperCase()}`, aplica_fiscal: false }
  })
  total = r2(total)
  const haber = cat[borr.forma === 'Efectivo' ? CAJA_GENERAL : BANCO]
  lineas.push({ id: ++id, cuenta_id: haber.id, cuenta_codigo: haber.codigo, cuenta_nombre: haber.nombre, tipo: 'credito', monto: total,
    centro_costo_id: '', descripcion: `PAGO COMISIONES ${per}`, aplica_fiscal: false })
  window._prefillPartida = { lineas, fecha: borr.fecha, descripcion: `PAGO DE COMISIONES ${per} (${l.length} EMPLEADOS)` }
  window._origenPartida = { view: 'comisiones-pago', label: 'Pago de comisiones', init: 'loadComisionesPago' }
  if (typeof window.nuevaPartida === 'function') window.nuevaPartida()
}

})();
