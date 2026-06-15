// ── CONTAMAX · Verificación masiva de compras (SAR) ──
// Bandeja para regularizar facturas viejas: lista las no verificadas, valida su
// número contra los rangos/CAI del proveedor, sugiere proveedor desde la
// descripción, y permite verificar en lote las válidas. Prioriza las con ISV.
// Depende de: window._sb, window._currentProfile, window.toast, window.logActividad

const vcSb = () => window._sb
const vcFmt = n => (parseFloat(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let vcFacturas = []        // facturas a verificar (ya cruzadas)
let vcProveedores = []     // catálogo de proveedores
let vcCaiPorProv = {}      // proveedor_id -> [cai]
let vcSoloIsv = true
let vcFiltroTexto = ''
let vcBuscarFocus = false

window.initVerifCompras = async () => {
  vcSoloIsv = true
  vcFiltroTexto = ''
  const hoy = new Date()
  const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 3, 1)
  const fi = document.getElementById('vc-fecha-ini'); if (fi && !fi.value) fi.value = ini.toISOString().split('T')[0]
  const ff = document.getElementById('vc-fecha-fin'); if (ff && !ff.value) ff.value = hoy.toISOString().split('T')[0]
  document.getElementById('vc-resultado')?.classList.add('hidden')
}

function vcCorrelativo(num) {
  if (!num) return null
  const m = String(num).match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : null
}

// Valida una factura contra los CAI de su proveedor. Devuelve {clase, txt, caiId, credito}
function vcValidar(f) {
  if (!f.proveedor_id) return { clase: 'sin_prov', txt: 'Sin proveedor asignado', caiId: null, credito: false }
  const cais = (vcCaiPorProv[f.proveedor_id] || []).filter(c => c.activo !== false)
  if (!cais.length) return { clase: 'sin_cai', txt: 'Proveedor sin rangos CAI', caiId: null, credito: false }
  const correlativo = vcCorrelativo(f.numero_factura)
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  let match = null, vencidoEnRango = null
  for (const c of cais) {
    const desde = vcCorrelativo(c.rango_desde), hasta = vcCorrelativo(c.rango_hasta)
    const enRango = correlativo != null && desde != null && hasta != null && correlativo >= desde && correlativo <= hasta
    const prefijoOk = !c.prefijo || String(f.numero_factura || '').startsWith(c.prefijo)
    const vencido = c.fecha_limite && (new Date(c.fecha_limite + 'T00:00:00') < hoy)
    if (enRango && prefijoOk && !vencido) { match = c; break }
    if (enRango && prefijoOk && vencido) vencidoEnRango = c
  }
  if (match) return { clase: 'valido', txt: '✓ Válida · con crédito fiscal', caiId: match.id, credito: true }
  if (vencidoEnRango) return { clase: 'vencido', txt: '✗ CAI vencido', caiId: vencidoEnRango.id, credito: false }
  return { clase: 'fuera', txt: '✗ Fuera de rango', caiId: null, credito: false }
}

// Sugiere un proveedor buscando su nombre dentro de la descripción/proveedor texto
function vcSugerirProveedor(f) {
  const texto = `${f.descripcion_compra || ''} ${f.proveedor_texto || ''}`.toUpperCase()
  if (!texto.trim()) return null
  for (const p of vcProveedores) {
    const n = (p.nombre || '').toUpperCase().trim()
    if (n.length >= 4 && texto.includes(n)) return p
  }
  return null
}

window.vcConsultar = async () => {
  const desde = document.getElementById('vc-fecha-ini').value
  const hasta = document.getElementById('vc-fecha-fin').value
  const btn = document.getElementById('vc-btn-consultar')
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando…' }

  // Catálogo de proveedores + CAI
  const { data: provs } = await vcSb().from('proveedores').select('id, nombre, rtn').order('nombre').limit(5000)
  vcProveedores = provs || []
  const { data: cais } = await vcSb().from('proveedor_cai').select('*').limit(20000)
  vcCaiPorProv = {}
  for (const c of (cais || [])) (vcCaiPorProv[c.proveedor_id] = vcCaiPorProv[c.proveedor_id] || []).push(c)

  // Facturas sin verificar en el rango
  const { data: facs, error } = await vcSb().from('facturas_compras')
    .select('id, numero_factura, fecha_factura, total, tiene_isv, isv, proveedor_id, descripcion_compra, proveedor_verificado, proveedor:proveedores(nombre)')
    .or('proveedor_verificado.eq.false,proveedor_verificado.is.null')
    .gte('fecha_factura', desde).lte('fecha_factura', hasta)
    .order('fecha_factura', { ascending: false }).limit(5000)
  if (btn) { btn.disabled = false; btn.textContent = 'Consultar →' }
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }

  vcFacturas = (facs || []).map(f => ({ ...f, _val: null, _sug: null }))
  for (const f of vcFacturas) {
    f._val = vcValidar(f)
    if (!f.proveedor_id) f._sug = vcSugerirProveedor(f)
  }
  vcRender()
  document.getElementById('vc-resultado')?.classList.remove('hidden')
}

window.vcToggleIsv = (v) => { vcBuscarFocus = false; vcSoloIsv = v; vcRender() }
window.vcFiltrar = (txt) => { vcBuscarFocus = true; vcFiltroTexto = txt || ''; vcRender() }

function vcRender() {
  const cont = document.getElementById('vc-resultado')
  if (!cont) return
  let lista = vcFacturas
  if (vcSoloIsv) lista = lista.filter(f => f.tiene_isv)
  const q = vcFiltroTexto.trim().toLowerCase()
  if (q) lista = lista.filter(f => (f.numero_factura || '').toLowerCase().includes(q) || (f.proveedor?.nombre || '').toLowerCase().includes(q) || (f.descripcion_compra || '').toLowerCase().includes(q))

  const nValidas = lista.filter(f => f._val?.clase === 'valido').length
  const totalIsv = vcFacturas.filter(f => f.tiene_isv).length

  const filas = lista.map(f => {
    const v = f._val || {}
    const color = v.clase === 'valido' ? 'var(--green)' : (v.clase === 'sin_prov' || v.clase === 'sin_cai' ? 'var(--amber)' : 'var(--red)')
    const provCell = f.proveedor_id
      ? (f.proveedor?.nombre || '—')
      : `<div style="display:flex;align-items:center;gap:6px">
           <span style="color:var(--amber)">— sin proveedor —</span>
           ${f._sug ? `<button class="btn btn-ghost" onclick="vcAsignarSugerido('${f.id}','${f._sug.id}')" style="font-size:10px;padding:2px 6px;border-color:var(--gold);color:var(--gold)" title="Asignar ${f._sug.nombre}">≈ ${f._sug.nombre.substring(0,18)}</button>` : ''}
           <button class="btn btn-ghost" onclick="vcAbrirAsignar('${f.id}')" style="font-size:10px;padding:2px 6px">buscar</button>
         </div>`
    const accion = v.clase === 'valido'
      ? `<button class="btn btn-ghost" onclick="vcVerificarUna('${f.id}','con')" style="font-size:11px;padding:3px 10px;border-color:var(--green);color:var(--green)">Verificar ✓</button>`
      : (f.proveedor_id
          ? `<div style="display:flex;gap:4px;justify-content:flex-end">
               <button class="btn btn-ghost" onclick="vcVerificarUna('${f.id}','sin')" style="font-size:10px;padding:3px 8px;border-color:var(--red);color:var(--red)">Sin créd.</button>
             </div>`
          : '<span style="font-size:11px;color:var(--text3)">asigná proveedor</span>')
    return `<tr>
      <td style="font-family:var(--mono);font-size:11px">${f.fecha_factura || '—'}</td>
      <td style="font-family:var(--mono);font-size:11px">${f.numero_factura || '—'}</td>
      <td style="font-size:12px">${provCell}</td>
      <td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(f.descripcion_compra || '').replace(/"/g, '&quot;')}">${f.descripcion_compra || '—'}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px">L. ${vcFmt(f.total)}${f.tiene_isv ? ' <span style="font-size:9px;color:var(--gold)">ISV</span>' : ''}</td>
      <td style="font-size:11px;color:${color}">${v.txt || ''}</td>
      <td style="text-align:right">${accion}</td>
    </tr>`
  }).join('') || `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">Sin facturas${q ? ' para "' + q + '"' : ''}</td></tr>`

  cont.innerHTML = `
    <div class="form-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-weight:600;color:var(--gold)">Facturas por verificar</div>
          <div style="font-size:12px;color:var(--text3)">${lista.length} mostradas · ${totalIsv} con ISV en total · ${nValidas} listas para verificar</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
            <input type="checkbox" ${vcSoloIsv ? 'checked' : ''} onchange="vcToggleIsv(this.checked)" style="width:auto;accent-color:var(--gold)"> Solo con ISV
          </label>
          <input type="text" id="vc-buscar" placeholder="🔎 Buscar..." value="${vcFiltroTexto.replace(/"/g,'&quot;')}" oninput="vcFiltrar(this.value)" style="font-size:12px;padding:5px 10px">
          ${nValidas ? `<button class="btn btn-gold" onclick="vcVerificarTodasValidas()" style="font-size:12px;padding:6px 12px">Verificar ${nValidas} válida(s)</button>` : ''}
        </div>
      </div>
      <div style="max-height:540px;overflow-y:auto">
        <table style="width:100%">
          <thead><tr><th>Fecha</th><th>N° Factura</th><th>Proveedor</th><th>Descripción</th><th style="text-align:right">Monto</th><th>Validación</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>`
  // Restaurar el foco en el buscador (se pierde al recrear el HTML)
  if (vcBuscarFocus) {
    const inp = document.getElementById('vc-buscar')
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) }
  }
}

// Asignar el proveedor sugerido
window.vcAsignarSugerido = async (facturaId, provId) => {
  const { error } = await vcSb().from('facturas_compras').update({ proveedor_id: provId }).eq('id', facturaId)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  const f = vcFacturas.find(x => x.id === facturaId)
  if (f) {
    f.proveedor_id = provId
    f.proveedor = { nombre: vcProveedores.find(p => p.id === provId)?.nombre }
    f._val = vcValidar(f); f._sug = null
  }
  window.toast?.('Proveedor asignado', 'success')
  vcRender()
}

// Modal simple de búsqueda para asignar proveedor manualmente
window.vcAbrirAsignar = (facturaId) => {
  vcFacturaAsignar = facturaId
  document.getElementById('vc-asignar-buscar').value = ''
  vcRenderAsignarLista('')
  document.getElementById('modal-vc-asignar').classList.add('open')
}
let vcFacturaAsignar = null
window.vcAsignarFiltrar = (txt) => vcRenderAsignarLista(txt)
function vcRenderAsignarLista(filtro) {
  const q = (filtro || '').trim().toLowerCase()
  const cont = document.getElementById('vc-asignar-lista')
  if (!cont) return
  const cand = vcProveedores.filter(p => !q || (p.nombre || '').toLowerCase().includes(q) || (p.rtn || '').toLowerCase().includes(q)).slice(0, 50)
  cont.innerHTML = cand.map(p => `
    <div onclick="vcAsignarManual('${p.id}')" style="padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <div style="font-weight:500">${p.nombre}</div>
      <div style="font-size:11px;color:var(--text3)">RTN: ${p.rtn || '—'}</div>
    </div>`).join('') || `<div style="padding:16px;text-align:center;color:var(--text3)">Sin coincidencias</div>`
}
window.vcAsignarManual = async (provId) => {
  if (!vcFacturaAsignar) return
  await vcAsignarSugerido(vcFacturaAsignar, provId)
  document.getElementById('modal-vc-asignar').classList.remove('open')
  vcFacturaAsignar = null
}

// Verificar una factura (con o sin crédito)
window.vcVerificarUna = async (facturaId, modo) => {
  const f = vcFacturas.find(x => x.id === facturaId)
  if (!f) return
  const prof = window._currentProfile?.()
  const payload = {
    proveedor_verificado: true,
    verificado_por: prof?.id || null, verificado_fecha: new Date().toISOString()
  }
  if (modo === 'con') {
    payload.credito_fiscal_valido = true
    payload.cai_usado_id = f._val?.caiId || null
    payload.nota_verificacion = 'Verificada (masivo) con crédito fiscal'
    if (f._val?.caiId) await vcSb().from('proveedor_cai').update({ ultimo_usado: f.numero_factura }).eq('id', f._val.caiId)
  } else {
    payload.credito_fiscal_valido = false
    payload.nota_verificacion = 'Verificada (masivo) SIN crédito fiscal · ' + (f._val?.clase || '')
  }
  const { error } = await vcSb().from('facturas_compras').update(payload).eq('id', facturaId)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  vcFacturas = vcFacturas.filter(x => x.id !== facturaId)   // sale de la lista
  window.toast?.(modo === 'con' ? 'Verificada con crédito ✓' : 'Verificada sin crédito', 'success')
  window.logActividad?.('factura_verificada', 'compras', `${f.numero_factura} · masivo ${modo}`)
  vcRender()
}

// Verificar TODAS las válidas (verdes) de un golpe
window.vcVerificarTodasValidas = async () => {
  let lista = vcFacturas.filter(f => f._val?.clase === 'valido')
  if (vcSoloIsv) lista = lista.filter(f => f.tiene_isv)
  if (!lista.length) return
  if (!confirm(`¿Verificar ${lista.length} factura(s) válida(s) con crédito fiscal? Podés revisarlas individualmente si preferís.`)) return
  const prof = window._currentProfile?.()
  let ok = 0
  for (const f of lista) {
    const payload = {
      proveedor_verificado: true, credito_fiscal_valido: true,
      cai_usado_id: f._val?.caiId || null,
      verificado_por: prof?.id || null, verificado_fecha: new Date().toISOString(),
      nota_verificacion: 'Verificada (masivo lote) con crédito fiscal'
    }
    const { error } = await vcSb().from('facturas_compras').update(payload).eq('id', f.id)
    if (!error) { ok++; if (f._val?.caiId) await vcSb().from('proveedor_cai').update({ ultimo_usado: f.numero_factura }).eq('id', f._val.caiId) }
  }
  const ids = new Set(lista.map(f => f.id))
  vcFacturas = vcFacturas.filter(f => !ids.has(f.id))
  window.toast?.(`${ok} factura(s) verificadas con crédito fiscal ✓`, 'success')
  window.logActividad?.('factura_verificada', 'compras', `lote masivo · ${ok} facturas`)
  vcRender()
}