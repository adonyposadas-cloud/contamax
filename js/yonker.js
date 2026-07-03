// ── CONTAMAX · Yonker — Importación de ventas + Reportes ──
// Pestaña 1 (Importar): lee el .xlsx de Taller Alpha, extrae el número de
//   vehículo de la columna "Producto" (número antes del primer "-"), trae
//   marca/modelo/año/contenedor de yonker_unidades, de-duplica por consecutivo
//   e inserta solo lo nuevo en yonker_ventas. Recalcula el costo del #126 (70%).
// Pestaña 2 (Reportes): ventas por mes/marca/modelo/año/contenedor y margen
//   venta vs costo por unidad/contenedor/marca/modelo. Exportable a Excel.
//   Lee de las vistas vw_yonker_ventas_resumen y vw_yonker_margen_unidad.
// Solo super_admin. Depende de: window._sb, window.toast, window.XLSX, window._currentProfile

const ykSb = () => window._sb
const ykEsSuper = () => { try { return window._currentProfile?.()?.rol === 'super_admin' } catch (e) { return false } }
const ykFmt = n => (parseFloat(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ykFmt0 = n => (parseFloat(n) || 0).toLocaleString('es-HN', { maximumFractionDigits: 0 })
const ykPct = n => (n == null ? '—' : (parseFloat(n) * 100).toLocaleString('es-HN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + '%')

let ykFile = null
let ykPrev = null
let ykVResumen = null   // cache vista ventas
let ykVDetalle = null   // cache detalle día a día (yonker_ventas) para el filtro por fecha
let ykVMargen = null    // cache vista margen
let ykVRotacion = null  // cache vista rotación (antigüedad + recuperación)

// Paginador propio (PostgREST corta a 1000).
async function ykFetchAll(buildQuery, pageSize = 1000) {
  const all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || !data.length) break
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}

// Código de vehículo = número (con posible letra final, ej. 209C) antes del primer "-".
function ykCodigo(prod) {
  if (prod == null) return null
  const left = String(prod).trim().split('-')[0].trim()
  const m = left.match(/^(\d{1,4}[A-Za-z]?)$/)
  return m ? m[1] : null
}

// Fecha DD/MM/YYYY | Date | ISO  →  'YYYY-MM-DD'
function ykFecha(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return v.toLocaleDateString('en-CA')
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

const ykR2 = v => Math.round((parseFloat(v) || 0) * 100) / 100

const YK_TABS = [['imp', 'yk-tab-imp'], ['rep', 'yk-tab-rep'], ['dev', 'yk-tab-dev'], ['exp', 'yk-tab-exp'], ['cot', 'yk-tab-cot']]
function ykPerms() {
  let esSuper = false, permisos = []
  try { const p = window._currentProfile?.(); esSuper = p?.rol === 'super_admin'; permisos = Array.isArray(p?.permisos_modulos) ? p.permisos_modulos : [] } catch (e) { /* sin perfil */ }
  return { esSuper, permisos }
}
// Oculta las pestañas que el usuario no tiene autorizadas; devuelve la primera visible.
function ykAplicarPermisos() {
  const { esSuper, permisos } = ykPerms()
  let primera = null
  YK_TABS.forEach(([key, id]) => {
    const ver = esSuper || permisos.includes(id)
    const tb = document.getElementById(id)
    if (tb) tb.classList.toggle('hidden', !ver)
    if (ver && !primera) primera = key
  })
  return primera
}
window.initYonker = async () => {
  const vista = document.getElementById('view-yonker')
  if (!vista) return
  const { esSuper, permisos } = ykPerms()
  const algunaTab = YK_TABS.some(([k, id]) => permisos.includes(id))
  if (!esSuper && !algunaTab) { vista.innerHTML = '<div class="page-title">📦 Yonker</div><div class="page-sub">No tenés pestañas de Yonker autorizadas. Pedí acceso al administrador.</div>'; return }
  ykEnsureStyles()
  vista.innerHTML = `
    <div class="page-title">📦 Yonker</div>
    <div class="yk-tabbar">
      <button class="yk-tab active" id="yk-tab-imp" onclick="ykTab('imp')">Importar ventas</button>
      <button class="yk-tab" id="yk-tab-rep" onclick="ykTab('rep')">Reportes</button>
      <button class="yk-tab" id="yk-tab-dev" onclick="ykTab('dev')">Devoluciones</button>
      <button class="yk-tab" id="yk-tab-exp" onclick="ykTab('exp')">Explorar</button>
      <button class="yk-tab" id="yk-tab-cot" onclick="ykTab('cot')">Cotización</button>
    </div>
    <div id="yk-pane"></div>`
  const primera = ykAplicarPermisos() || 'imp'
  ykTab(primera)
}

window.ykTab = (which) => {
  const ti = document.getElementById('yk-tab-imp'), tr = document.getElementById('yk-tab-rep'), td = document.getElementById('yk-tab-dev'), te = document.getElementById('yk-tab-exp'), tc = document.getElementById('yk-tab-cot')
  if (ti) ti.classList.toggle('active', which === 'imp')
  if (tr) tr.classList.toggle('active', which === 'rep')
  if (td) td.classList.toggle('active', which === 'dev')
  if (te) te.classList.toggle('active', which === 'exp')
  if (tc) tc.classList.toggle('active', which === 'cot')
  if (which === 'rep') ykRenderReportes()
  else if (which === 'dev') ykRenderDevoluciones()
  else if (which === 'exp') ykRenderExplorar()
  else if (which === 'cot') ykRenderCotizar()
  else ykRenderImport()
}

function ykEnsureStyles() {
  if (document.getElementById('yk-styles')) return
  const st = document.createElement('style'); st.id = 'yk-styles'
  st.textContent = `
    .yk-tabbar{display:flex;gap:6px;margin:10px 0 16px;border-bottom:1px solid var(--border,#3a3a3a)}
    .yk-tab{background:none;border:none;color:var(--text3,#888);padding:8px 14px;cursor:pointer;font-size:13px;border-bottom:2px solid transparent;margin-bottom:-1px}
    .yk-tab.active{color:var(--gold,#d4af37);border-bottom-color:var(--gold,#d4af37);font-weight:600}
    .yk-zone{border:2px dashed var(--border,#3a3a3a);border-radius:12px;padding:28px;text-align:center;cursor:pointer;transition:.15s;background:var(--bg2,#1c1c1c)}
    .yk-zone:hover{border-color:var(--gold,#d4af37)}
    .yk-zone.has-file{border-color:var(--gold,#d4af37);border-style:solid}
    .yk-file{display:flex;align-items:center;gap:8px;justify-content:center;font-size:13px;margin-top:8px}
    .yk-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
    .yk-card{background:var(--bg2,#1c1c1c);border:1px solid var(--border,#3a3a3a);border-radius:10px;padding:12px 14px}
    .yk-card .v{font-size:22px;font-weight:700;font-family:var(--mono,monospace)}
    .yk-card .l{font-size:11px;color:var(--text3,#888);text-transform:uppercase;letter-spacing:.5px}
    .yk-card.warn .v{color:#e0a800}.yk-card.ok .v{color:var(--gold,#d4af37)}.yk-card.bad .v{color:#e06060}
    .yk-tbl{width:100%;border-collapse:collapse;font-size:12px}
    .yk-tbl th{position:sticky;top:0;background:var(--bg2,#1c1c1c);text-align:left;padding:6px 8px;border-bottom:1px solid var(--border,#3a3a3a);font-size:11px;color:var(--text3,#888);cursor:pointer}
    .yk-tbl th.yk-num{text-align:right}
    .yk-tbl td{padding:5px 8px;border-bottom:1px solid var(--border,#2a2a2a)}
    .yk-tbl tr.sinuni td{background:rgba(224,168,0,.08)}
    .yk-tbl tr.tot td{font-weight:700;border-top:2px solid var(--border,#3a3a3a);background:var(--bg2,#1c1c1c)}
    .yk-ctrl{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:8px}
    .yk-ctrl .fld{display:flex;flex-direction:column;gap:3px}
    .yk-ctrl label{font-size:11px;color:var(--text3,#888)}
    .yk-ctrl select{padding:6px 8px;background:var(--bg2,#1c1c1c);border:1px solid var(--border,#3a3a3a);border-radius:6px;color:inherit;font-size:13px}
    .yk-num{text-align:right;font-family:var(--mono,monospace)}
    .yk-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;max-height:130px;overflow:auto;padding:2px}
    .yk-chip{display:inline-block;padding:3px 10px;border-radius:14px;background:var(--bg3,#222);border:1px solid var(--border,#3a3a3a);color:var(--gold,#d4af37);font-size:12px;font-family:var(--mono,monospace);cursor:pointer;transition:all .12s}
    .yk-chip:hover{background:var(--gold,#d4af37);color:#1a1a1a}
    .yk-chip-static{cursor:default;color:var(--text,#ddd)}
    .yk-chip-static:hover{background:var(--bg3,#222);color:var(--text,#ddd)}
    .yk-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:center;justify-content:center}
    .yk-modal{background:var(--bg2,#1c1c1c);border:1px solid var(--border,#3a3a3a);border-radius:12px;width:460px;max-width:92vw;max-height:90vh;overflow:auto}
    .yk-mhead{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border,#3a3a3a)}
    .yk-mhead button{background:none;border:none;color:var(--text3,#888);font-size:16px;cursor:pointer}
    .yk-link{background:none;border:none;color:var(--gold,#d4af37);cursor:pointer;text-decoration:underline;font:inherit;padding:0}
    .yk-link:hover{opacity:.8}
    .yk-drill{cursor:pointer;color:var(--gold,#d4af37);border-bottom:1px dotted var(--gold,#d4af37)}
    .yk-drill:hover{opacity:.8}
  `
  document.head.appendChild(st)
}

// ═══════════════════════════════ IMPORTAR ═══════════════════════════════
function ykRenderImport() {
  ykFile = null; ykPrev = null
  const pane = document.getElementById('yk-pane')
  pane.innerHTML = `
    <div class="page-sub">Sube el reporte de productos vendidos que bajas de Taller Alpha. El sistema extrae el número de vehículo de la columna Producto, trae marca/modelo/año de las unidades, usa el <b>No. Consecutivo como número de factura real</b> y de-duplica por <b>fecha + descripción</b>. Solo inserta las líneas que aún no estén cargadas.</div>
    <div id="yk-step1">
      <div class="yk-zone" id="yk-zone" onclick="document.getElementById('yk-input').click()">
        <div style="font-size:30px">📊</div>
        <div style="font-weight:600;margin-top:6px">Haz clic para elegir el .xlsx de Taller Alpha</div>
        <div style="font-size:12px;color:var(--text3,#888);margin-top:2px">Reporte_productos_vendidos_…xlsx</div>
        <div id="yk-file-list"></div>
      </div>
      <input type="file" id="yk-input" accept=".xlsx,.xls" class="hidden" onchange="ykOnFile(this)">
      <div class="form-actions" style="margin-top:14px">
        <button class="btn btn-gold" id="yk-btn-proc" onclick="ykProcesar()" disabled>Procesar →</button>
      </div>
    </div>
    <div id="yk-step2" class="hidden"></div>
    <div id="yk-step3" class="hidden"></div>`
}

window.ykOnFile = (input) => {
  ykFile = (input.files || [])[0] || null
  const list = document.getElementById('yk-file-list')
  const btn = document.getElementById('yk-btn-proc')
  if (!ykFile) { list.innerHTML = ''; btn.disabled = true; document.getElementById('yk-zone').classList.remove('has-file'); return }
  list.innerHTML = `<div class="yk-file">📄 ${ykFile.name} <span style="color:var(--text3,#888)">(${(ykFile.size / 1024).toFixed(0)} KB)</span></div>`
  document.getElementById('yk-zone').classList.add('has-file')
  btn.disabled = false
}

function ykParseSheet(arrayBuffer) {
  const wb = window.XLSX.read(arrayBuffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  let hr = -1, col = {}
  for (let r = 0; r < Math.min(15, data.length); r++) {
    const row = data[r]; if (!row) continue
    const lower = row.map(c => String(c == null ? '' : c).trim().toLowerCase())
    if (lower.includes('producto') && lower.some(h => h.includes('consecutivo'))) {
      hr = r
      lower.forEach((h, c) => {
        if (h === 'fecha') col.fecha = c
        else if (h.includes('factura')) col.factura = c
        else if (h.includes('consecutivo')) col.consecutivo = c
        else if (h === 'cliente') col.cliente = c
        else if (h === 'producto') col.producto = c
        else if (h === 'cantidad') col.cantidad = c
        else if (h === 'total') col.total = c
      })
      break
    }
  }
  if (hr < 0) throw new Error('No se encontró el encabezado del reporte (Fecha / Consecutivo / Producto).')
  const filas = []
  for (let i = hr + 1; i < data.length; i++) {
    const row = data[i]; if (!row) continue
    const prod = row[col.producto]
    const total = row[col.total]
    if (prod == null || String(prod).trim() === '') continue
    if (typeof total === 'string' && total.toLowerCase().includes('total')) continue
    const cons = row[col.consecutivo]
    const consStr = cons == null ? null : String(cons).trim()
    filas.push({
      fecha: ykFecha(row[col.fecha]),
      factura: consStr,          // el "No. Consecutivo" del Excel es el número de factura REAL
      consecutivo: consStr,      // (el "No. Factura" del Excel es un correlativo interno que no se usa)
      cliente: row[col.cliente] == null ? null : String(row[col.cliente]).trim(),
      producto: String(prod).trim(),
      cantidad: row[col.cantidad] == null ? null : (parseFloat(row[col.cantidad]) || null),
      venta_hnl: ykR2(total),
      vehiculo_codigo: ykCodigo(prod),
    })
  }
  return filas
}

window.ykProcesar = async () => {
  if (!ykFile) return
  const btn = document.getElementById('yk-btn-proc')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Procesando...'
  try {
    const buf = await ykFile.arrayBuffer()
    const filas = ykParseSheet(buf)
    if (!filas.length) throw new Error('El archivo no contiene líneas de venta.')

    const uni = await ykFetchAll(() => ykSb().from('yonker_unidades')
      .select('vehiculo_codigo,marca,modelo,anio_vehiculo,contenedor').order('vehiculo_codigo'))
    const umap = {}; uni.forEach(u => { umap[String(u.vehiculo_codigo)] = u })

    // "Ya cargada" = misma FECHA + misma DESCRIPCIÓN (producto). Se consultan solo
    // las fechas presentes en el archivo, no toda la tabla.
    const fechasArch = [...new Set(filas.map(f => f.fecha).filter(Boolean))]
    const dupSet = new Set()
    if (fechasArch.length) {
      const ex = await ykFetchAll(() => ykSb().from('yonker_ventas')
        .select('fecha,producto').in('fecha', fechasArch).order('id'))
      ex.forEach(v => { if (v.fecha && v.producto != null) dupSet.add(v.fecha + '||' + String(v.producto).trim()) })
    }
    const dupKey = f => (f.fecha || '') + '||' + (f.producto || '').trim()

    const nuevas = [], yaCargadas = [], sinUnidad = [], sinFecha = [], sinVehiculo = []
    for (const f of filas) {
      if (!f.fecha) { sinFecha.push(f); continue }
      if (dupSet.has(dupKey(f))) { yaCargadas.push(f); continue }
      if (!f.vehiculo_codigo) { sinVehiculo.push(f); continue }   // sin N° de vehículo → NO se inserta, se alerta
      const u = umap[f.vehiculo_codigo] || null
      if (!u) sinUnidad.push(f)
      const d = f.fecha
      nuevas.push({
        fecha: d, anio: +d.slice(0, 4), mes: +d.slice(5, 7), anio_mes: d.slice(0, 7),
        vehiculo_codigo: f.vehiculo_codigo,
        marca: u?.marca ?? null, modelo: u?.modelo ?? null, anio_vehiculo: u?.anio_vehiculo ?? null,
        producto: f.producto, cantidad: f.cantidad, venta_hnl: f.venta_hnl,
        cliente: f.cliente, factura: f.factura, consecutivo: f.consecutivo, contenedor: u?.contenedor ?? null,
      })
    }
    nuevas.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (+(b.consecutivo) || 0) - (+(a.consecutivo) || 0))
    ykPrev = { nuevas, yaCargadas, sinUnidad, sinFecha, sinVehiculo, totalFilas: filas.length }
    ykRenderPreview()
  } catch (e) {
    window.toast?.('Error: ' + (e.message || e), 'error')
    btn.disabled = false; btn.innerHTML = 'Procesar →'
  }
}

function ykRenderPreview() {
  const { nuevas, yaCargadas, sinUnidad, sinFecha, sinVehiculo } = ykPrev
  const totNuevo = nuevas.reduce((s, r) => s + (r.venta_hnl || 0), 0)
  const ticketsNuevos = new Set(nuevas.map(r => r.consecutivo)).size
  document.getElementById('yk-step1').classList.add('hidden')
  const s2 = document.getElementById('yk-step2'); s2.classList.remove('hidden')
  const filasHtml = nuevas.slice(0, 500).map(r => `
    <tr class="${r.marca ? '' : 'sinuni'}">
      <td>${r.fecha || '—'}</td><td>${r.consecutivo || '—'}</td><td>${r.vehiculo_codigo || '—'}</td>
      <td>${r.marca || '<span style="color:#e0a800">sin unidad</span>'}</td><td>${r.modelo || '—'}</td><td>${r.anio_vehiculo || '—'}</td>
      <td>${(r.producto || '').slice(0, 40)}</td><td class="yk-num">${ykFmt(r.venta_hnl)}</td><td>${r.contenedor ?? '—'}</td>
    </tr>`).join('')
  s2.innerHTML = `
    <div class="page-title" style="font-size:18px">Vista previa</div>
    <div class="yk-cards">
      <div class="yk-card ok"><div class="v">${ticketsNuevos}</div><div class="l">Tickets nuevos</div></div>
      <div class="yk-card ok"><div class="v">${nuevas.length}</div><div class="l">Líneas a insertar</div></div>
      <div class="yk-card ok"><div class="v">${ykFmt(totNuevo)}</div><div class="l">Venta nueva (L.)</div></div>
      <div class="yk-card"><div class="v">${yaCargadas.length}</div><div class="l">Líneas ya cargadas (saltadas)</div></div>
      <div class="yk-card ${sinUnidad.length ? 'warn' : ''}"><div class="v">${sinUnidad.length}</div><div class="l">Líneas sin unidad</div></div>
      ${(sinVehiculo && sinVehiculo.length) ? `<div class="yk-card warn"><div class="v">${sinVehiculo.length}</div><div class="l">Sin N° de vehículo</div></div>` : ''}
      ${sinFecha && sinFecha.length ? `<div class="yk-card warn"><div class="v">${sinFecha.length}</div><div class="l">Sin fecha (omitidas)</div></div>` : ''}
    </div>
    ${(sinVehiculo && sinVehiculo.length) ? `<div style="margin:8px 0;padding:10px 14px;border-radius:10px;background:rgba(220,60,60,.12);border:1px solid rgba(220,60,60,.5);color:#ff9b9b">
      <b>⚠️ ${sinVehiculo.length} línea(s) SIN número de vehículo — no se importan.</b> Revisá y corregí el archivo: la descripción del <i>Producto</i> debe empezar con el código del vehículo (ej. «551-C25 …»). Corregí y volvé a subirlo.
      <div style="max-height:150px;overflow:auto;margin-top:8px;font-size:12px;line-height:1.6">
        ${sinVehiculo.slice(0, 60).map(f => `<div>• ${f.fecha || '—'} · Fact. ${f.consecutivo || '—'} · ${((f.producto || '') + '').slice(0, 70)}</div>`).join('')}
        ${sinVehiculo.length > 60 ? `<div>… y ${sinVehiculo.length - 60} más</div>` : ''}
      </div>
    </div>` : ''}
    ${sinUnidad.length ? `<div class="page-sub" style="color:#e0a800">⚠️ ${sinUnidad.length} línea(s) tienen un código que aún no existe en yonker_unidades (contenedor recién llegado sin dar de alta). Se insertarán con marca/modelo/año en blanco; podrás completarlos al registrar la unidad.</div>` : ''}
    ${nuevas.length === 0 ? '<div class="page-sub">No hay tickets nuevos: todo lo del archivo ya está cargado.</div>' : `
    <div class="table-wrap" style="max-height:420px;overflow:auto;margin-top:8px">
      <table class="yk-tbl"><thead><tr><th>Fecha</th><th>Consec.</th><th>Veh.</th><th>Marca</th><th>Modelo</th><th>Año</th><th>Producto</th><th class="yk-num">Venta</th><th>Cont.</th></tr></thead>
      <tbody>${filasHtml}</tbody></table>
      ${nuevas.length > 500 ? `<div style="padding:8px;color:var(--text3,#888);font-size:12px">… mostrando 500 de ${nuevas.length} líneas.</div>` : ''}
    </div>`}
    <div class="form-actions" style="margin-top:14px">
      <button class="btn btn-ghost" onclick="ykRenderImport()">Cancelar</button>
      ${nuevas.length ? `<button class="btn btn-gold" id="yk-btn-conf" onclick="ykConfirmar()">Confirmar importación (${nuevas.length} líneas) →</button>` : ''}
    </div>`
}

window.ykConfirmar = async () => {
  if (!ykPrev || !ykPrev.nuevas.length) return
  const btn = document.getElementById('yk-btn-conf')
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Insertando...' }
  try {
    const rows = ykPrev.nuevas
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await ykSb().from('yonker_ventas').insert(rows.slice(i, i + 500))
      if (error) throw error
    }
    let nota126 = ''
    const v126 = await ykFetchAll(() => ykSb().from('yonker_ventas')
      .select('venta_hnl').eq('vehiculo_codigo', '126').order('id'))
    if (v126.length) {
      const venta126 = v126.reduce((s, r) => s + (parseFloat(r.venta_hnl) || 0), 0)
      const costo126 = ykR2(venta126 * 0.7)
      const { error: e126 } = await ykSb().from('yonker_unidades')
        .update({ costo_hnl: costo126 }).eq('vehiculo_codigo', '126')
      if (!e126) nota126 = `Costo del #126 (YONKER VIRGINIA) recalculado a L. ${ykFmt(costo126)} (70% de su venta).`
    }
    // EBAY: mismo trato que el #126 — costo = 70% de sus ventas (por cada unidad EBAY)
    let notaEbay = ''
    const ebayUnidades = await ykFetchAll(() => ykSb().from('yonker_unidades')
      .select('vehiculo_codigo').ilike('marca', 'EBAY').order('vehiculo_codigo'))
    for (const eu of ebayUnidades) {
      const ve = await ykFetchAll(() => ykSb().from('yonker_ventas')
        .select('venta_hnl').eq('vehiculo_codigo', eu.vehiculo_codigo).order('id'))
      if (!ve.length) continue
      const ventaE = ve.reduce((s, r) => s + (parseFloat(r.venta_hnl) || 0), 0)
      const costoE = ykR2(ventaE * 0.7)
      await ykSb().from('yonker_unidades').update({ costo_hnl: costoE }).eq('vehiculo_codigo', eu.vehiculo_codigo)
    }
    if (ebayUnidades.length) notaEbay = `Costo de EBAY recalculado al 70% de su venta.`
    if (window.logActividad) window.logActividad('import_yonker', 'importar', `Importó ${rows.length} líneas de venta yonker`)
    document.getElementById('yk-step2').classList.add('hidden')
    const s3 = document.getElementById('yk-step3'); s3.classList.remove('hidden')
    s3.innerHTML = `
      <div class="page-title" style="font-size:18px">✓ Importación completada</div>
      <div class="yk-cards">
        <div class="yk-card ok"><div class="v">${rows.length}</div><div class="l">Líneas insertadas</div></div>
        <div class="yk-card ok"><div class="v">${new Set(rows.map(r => r.consecutivo)).size}</div><div class="l">Tickets nuevos</div></div>
      </div>
      ${nota126 ? `<div class="page-sub">${nota126}</div>` : ''}
      ${notaEbay ? `<div class="page-sub">${notaEbay}</div>` : ''}
      <div class="form-actions" style="margin-top:14px"><button class="btn btn-gold" onclick="ykRenderImport()">Importar otro archivo →</button></div>`
    window.toast?.(`${rows.length} líneas importadas`, 'success')
  } catch (e) {
    window.toast?.('Error al insertar: ' + (e.message || e), 'error')
    if (btn) { btn.disabled = false; btn.innerHTML = 'Confirmar importación →' }
  }
}

// ═══════════════════════════════ REPORTES ═══════════════════════════════
async function ykRenderReportes() {
  const pane = document.getElementById('yk-pane')
  pane.innerHTML = '<div class="page-sub">Cargando datos…</div><div style="text-align:center;padding:30px"><div class="spinner"></div></div>'
  try {
    if (!ykVResumen) ykVResumen = await ykFetchAll(() => ykSb().from('vw_yonker_ventas_resumen').select('*').order('anio_mes'))
    if (!ykVMargen) ykVMargen = await ykFetchAll(() => ykSb().from('vw_yonker_margen_unidad').select('*').order('vehiculo_codigo'))
    if (!ykVRotacion) ykVRotacion = await ykFetchAll(() => ykSb().from('vw_yonker_rotacion').select('*').order('contenedor'))
  } catch (e) {
    pane.innerHTML = `<div class="page-sub" style="color:#e06060">Error cargando reportes: ${e.message || e}</div><button class="btn btn-ghost" onclick="ykRenderReportes()">Reintentar</button>`
    return
  }
  const anios = [...new Set(ykVResumen.map(r => r.anio).filter(x => x != null))].sort()
  const marcas = [...new Set(ykVResumen.map(r => r.marca).filter(x => x))].sort()
  const mMarcas = [...new Set((ykVMargen || []).map(r => r.marca).filter(x => x))].sort()
  const mAnios = [...new Set((ykVMargen || []).map(r => r.anio_vehiculo).filter(x => x != null))].sort((a, b) => a - b)
  const esc = s => String(s).replace(/"/g, '&quot;')
  pane.innerHTML = `
    <div class="page-sub">Reportes en vivo. Modo <b>Ventas</b>: total por dimensión y mes. Modo <b>Margen</b>: venta vs costo por unidad (incluye el #126 al 70%).</div>
    <div class="yk-ctrl">
      <div class="fld"><label>Modo</label>
        <select id="yk-rep-modo" onchange="ykAplicarReporte()">
          <option value="ventas">Ventas</option><option value="margen">Margen (venta vs costo)</option><option value="rotacion">Rotación (antigüedad y recuperación)</option>
        </select></div>
      <div class="fld"><label>Agrupar por</label><select id="yk-rep-dim" onchange="ykAplicarReporte()"></select></div>
      <div class="fld" id="yk-fld-anio"><label>Año</label>
        <select id="yk-rep-anio" onchange="ykAplicarReporte()">
          <option value="">Todos</option>${anios.map(a => `<option value="${a}">${a}</option>`).join('')}
        </select></div>
      <div class="fld" id="yk-fld-marca"><label>Marca</label>
        <select id="yk-rep-marca" onchange="ykAplicarReporte()">
          <option value="">Todas</option>${marcas.map(m => `<option value="${m}">${m}</option>`).join('')}
        </select></div>
      <div class="fld yk-fld-fecha"><label>Desde (día)</label>
        <input id="yk-rep-desde" type="date" onchange="ykAplicarReporte()"
          style="padding:5px 8px;background:var(--bg2,#1c1c1c);border:1px solid var(--border,#3a3a3a);border-radius:6px;color:inherit;font-size:13px"></div>
      <div class="fld yk-fld-fecha"><label>Hasta (día)</label>
        <input id="yk-rep-hasta" type="date" onchange="ykAplicarReporte()"
          style="padding:5px 8px;background:var(--bg2,#1c1c1c);border:1px solid var(--border,#3a3a3a);border-radius:6px;color:inherit;font-size:13px"></div>
      <div class="fld yk-fld-fecha"><label>&nbsp;</label><button class="btn btn-ghost" onclick="document.getElementById('yk-rep-desde').value='';document.getElementById('yk-rep-hasta').value='';ykAplicarReporte()" style="padding:6px 10px;font-size:12px" title="Limpiar rango de fechas">✕ Rango</button></div>
      <div class="fld yk-fld-margen"><label>Vehículo (código)</label>
        <input id="yk-mar-codigo" type="text" placeholder="ej. 126" autocomplete="off" oninput="ykAplicarReporte()"
          style="padding:6px 8px;background:var(--bg2,#1c1c1c);border:1px solid var(--border,#3a3a3a);border-radius:6px;color:inherit;font-size:13px;width:100px"></div>
      <div class="fld yk-fld-margen"><label>Marca</label>
        <select id="yk-mar-marca" onchange="ykMarModeloOpts();ykAplicarReporte()"><option value="">(todas)</option>${mMarcas.map(m => `<option value="${esc(m)}">${m}</option>`).join('')}</select></div>
      <div class="fld yk-fld-margen"><label>Modelo</label>
        <select id="yk-mar-modelo" onchange="ykAplicarReporte()"><option value="">(todos)</option></select></div>
      <div class="fld yk-fld-margen"><label>Año desde</label>
        <select id="yk-mar-adesde" onchange="ykAplicarReporte()"><option value="">—</option>${mAnios.map(a => `<option value="${a}">${a}</option>`).join('')}</select></div>
      <div class="fld yk-fld-margen"><label>Año hasta</label>
        <select id="yk-mar-ahasta" onchange="ykAplicarReporte()"><option value="">—</option>${mAnios.map(a => `<option value="${a}">${a}</option>`).join('')}</select></div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-ghost" onclick="ykExportReporte()">📥 Exportar Excel</button></div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-ghost" onclick="ykVResumen=null;ykVMargen=null;ykVRotacion=null;ykVDetalle=null;ykRenderReportes()">↻ Refrescar</button></div>
    </div>
    <div id="yk-rep-cards"></div>
    <div id="yk-rep-tabla"></div>`
  ykSetDimOptions()
  ykMarModeloOpts()
  ykAplicarReporte()
}

// Rebuild modelo options (dependientes de la marca elegida) para el filtro de Margen
window.ykMarModeloOpts = () => {
  const marca = document.getElementById('yk-mar-marca')?.value || ''
  const modelos = [...new Set((ykVMargen || []).filter(r => !marca || r.marca === marca).map(r => r.modelo).filter(Boolean))].sort()
  const sel = document.getElementById('yk-mar-modelo')
  if (!sel) return
  const prev = sel.value
  sel.innerHTML = '<option value="">(todos)</option>' + modelos.map(m => `<option value="${String(m).replace(/"/g, '&quot;')}">${m}</option>`).join('')
  if (modelos.includes(prev)) sel.value = prev
}
function ykSetDimOptions() {
  const modo = document.getElementById('yk-rep-modo').value
  const dim = document.getElementById('yk-rep-dim')
  const opts = modo === 'ventas'
    ? [['mes', 'Mes'], ['marca', 'Marca'], ['modelo', 'Marca + Modelo'], ['anio_veh', 'Año del vehículo'], ['contenedor', 'Contenedor']]
    : [['unidad', 'Unidad'], ['contenedor', 'Contenedor'], ['marca', 'Marca'], ['modelo', 'Marca + Modelo']]
  dim.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')
}

let ykRepActual = null   // { cols, rows, tot } para exportar

window.ykAplicarReporte = async () => {
  const modo = document.getElementById('yk-rep-modo').value
  // reconstruir opciones de dimensión si cambió el modo
  const dimSel = document.getElementById('yk-rep-dim')
  const dimValido = [...dimSel.options].some(o => o.value === dimSel.value)
  const esRot = modo === 'rotacion'
  document.getElementById('yk-fld-anio').style.display = modo === 'ventas' ? '' : 'none'
  document.getElementById('yk-fld-marca').style.display = modo === 'ventas' ? '' : 'none'
  document.querySelectorAll('.yk-fld-fecha').forEach(el => { el.style.display = (modo === 'ventas') ? '' : 'none' })
  document.querySelectorAll('.yk-fld-margen').forEach(el => { el.style.display = (modo === 'margen') ? '' : 'none' })
  const dimFld = dimSel.closest('.fld'); if (dimFld) dimFld.style.display = esRot ? 'none' : ''
  if (esRot) { ykReporteRotacion(); return }
  if (!dimValido || dimSel.dataset.modo !== modo) { ykSetDimOptions(); dimSel.dataset.modo = modo }
  // Filtro por rango de fechas (modo Ventas): la primera vez cargamos el detalle día a día
  if (modo === 'ventas' && ykFechaRangoActivo() && !ykVDetalle) {
    const tbl = document.getElementById('yk-rep-tabla'); if (tbl) tbl.innerHTML = '<div class="yk-empty">Cargando detalle por día…</div>'
    try {
      ykVDetalle = await ykFetchAll(() => ykSb().from('yonker_ventas')
        .select('fecha,anio,anio_mes,marca,modelo,anio_vehiculo,contenedor,venta_hnl').order('fecha'))
    } catch (e) { ykVDetalle = [] }
  }
  modo === 'ventas' ? ykReporteVentas() : ykReporteMargen()
}
function ykFechaRangoActivo() {
  return !!(document.getElementById('yk-rep-desde')?.value || document.getElementById('yk-rep-hasta')?.value)
}
// Fuente de datos de Ventas: con rango de fechas usa el detalle día a día (yonker_ventas);
// sin rango, la vista mensual. Aplica año (solo sin rango) y marca. Reusada por tabla y drill.
function ykDatosVentas() {
  const fAnio = document.getElementById('yk-rep-anio')?.value || ''
  const fMarca = document.getElementById('yk-rep-marca')?.value || ''
  const fDesde = document.getElementById('yk-rep-desde')?.value || ''
  const fHasta = document.getElementById('yk-rep-hasta')?.value || ''
  let datos
  if ((fDesde || fHasta) && ykVDetalle) {
    datos = ykVDetalle.map(r => ({ ...r, venta: +r.venta_hnl || 0, lineas: 1 }))
    if (fDesde) datos = datos.filter(r => (r.fecha || '') >= fDesde)
    if (fHasta) datos = datos.filter(r => (r.fecha || '') <= fHasta)
  } else {
    datos = ykVResumen || []
    if (fAnio) datos = datos.filter(r => String(r.anio) === fAnio)
  }
  if (fMarca) datos = datos.filter(r => r.marca === fMarca)
  return datos
}

// ═══════════════ Drill-down de reportes (click en fila → desglose) ═══════════════
// Datos ya en memoria (ykVResumen): re-agrupamos al vuelo y abrimos un modal.
// Jerarquía: Marca → Modelo → Año | Contenedor/Mes/Año-veh → Marca+Modelo → Año.
let ykDrillReg = {}, ykDrillSeq = 0
function ykDrillCell(filtros, sub, titulo, texto, modo) {
  const id = 'yd' + (++ykDrillSeq)
  ykDrillReg[id] = { filtros, sub, titulo, modo: modo || 'V' }
  return `<span class="yk-drill" onclick="ykDrillById('${id}')" title="Ver desglose">${texto} <span style="opacity:.45;font-size:10px">▸</span></span>`
}
window.ykDrillById = (id) => { const d = ykDrillReg[id]; if (!d) return; (d.modo === 'M' ? window.ykDrillM : window.ykDrill)(d.filtros, d.sub, d.titulo) }

// Drill inicial según la dimensión de la tabla principal
function ykDimDrill(dim, raw) {
  if (dim === 'marca')      return { filtros: [['marca', raw.marca]], sub: 'modelosolo' }
  if (dim === 'modelo')     return { filtros: [['marca', raw.marca], ['modelo', raw.modelo]], sub: 'anio' }
  if (dim === 'anio_veh')   return { filtros: [['anio_vehiculo', raw.anio_vehiculo]], sub: 'modelo' }
  if (dim === 'contenedor') return { filtros: [['contenedor', raw.contenedor]], sub: 'modelo' }
  if (dim === 'mes')        return { filtros: [['anio_mes', raw.anio_mes]], sub: 'modelo' }
  return null
}
function ykDrillGroup(datos, sub) {
  const g = {}
  datos.forEach(r => {
    let k, raw
    if (sub === 'anio') { k = r.anio_vehiculo ?? '—'; raw = { anio_vehiculo: r.anio_vehiculo } }
    else if (sub === 'modelosolo') { k = r.modelo || '(sin modelo)'; raw = { modelo: r.modelo } }
    else { k = `${r.marca || '(sin marca)'} ${r.modelo || ''}`.trim(); raw = { marca: r.marca, modelo: r.modelo } }
    ;(g[k] = g[k] || { k, raw, venta: 0, lineas: 0 })
    g[k].venta += +r.venta || 0; g[k].lineas += +r.lineas || 0
  })
  return Object.values(g).sort((a, b) => b.venta - a.venta)
}
window.ykDrill = (filtros, sub, titulo) => {
  let datos = ykDatosVentas()
  filtros.forEach(([campo, val]) => { datos = datos.filter(r => String(r[campo] ?? '') === String(val)) })

  const rows = ykDrillGroup(datos, sub)
  const totV = rows.reduce((s, r) => s + r.venta, 0), totL = rows.reduce((s, r) => s + r.lineas, 0)
  const subLabel = sub === 'anio' ? 'Año del vehículo' : sub === 'modelosolo' ? 'Modelo' : 'Marca + Modelo'
  // El año es hoja; y un modelo dentro de un año ya fijado no se drillea (sería trivial)
  const puedeDrill = sub !== 'anio' && !filtros.some(f => f[0] === 'anio_vehiculo')

  const body = rows.map(r => {
    let cell = r.k
    if (puedeDrill) {
      const nf = filtros.concat(sub === 'modelosolo' ? [['modelo', r.raw.modelo]] : [['marca', r.raw.marca], ['modelo', r.raw.modelo]])
      cell = ykDrillCell(nf, 'anio', `${titulo} · ${r.k}`, r.k)
    }
    return `<tr><td>${cell}</td><td class="yk-num">${ykFmt0(r.lineas)}</td><td class="yk-num">${ykFmt(r.venta)}</td><td class="yk-num">${totV ? (r.venta / totV * 100).toFixed(1) : 0}%</td></tr>`
  }).join('')

  const contFil = (filtros.find(f => f[0] === 'contenedor') || [])[1]
  const fIngreso = contFil != null ? ykFechaContenedor(contFil) : null
  const infoIngreso = fIngreso ? `<div style="font-size:12px;color:var(--gold,#d4af37);margin:2px 0 6px">📦 Ingreso del contenedor ${contFil}: <b>${fIngreso}</b></div>` : ''
  ykOpenModal(`${titulo} · por ${subLabel.toLowerCase()}`, `
    ${infoIngreso}<div style="font-size:11px;color:var(--text3,#888);margin:2px 0 8px">${rows.length} ${subLabel.toLowerCase()}(s) · toca una fila para bajar otro nivel</div>
    <table class="yk-tbl"><thead><tr><th>${subLabel}</th><th class="yk-num">Líneas</th><th class="yk-num">Venta (L.)</th><th class="yk-num">% del grupo</th></tr></thead>
    <tbody>${body}<tr class="tot"><td>TOTAL</td><td class="yk-num">${ykFmt0(totL)}</td><td class="yk-num">${ykFmt(totV)}</td><td class="yk-num">100%</td></tr></tbody></table>`)
}
function ykFechaContenedor(cont) {
  const r = (ykVRotacion || []).find(x => String(x.contenedor) === String(cont))
  return r && r.fecha_entrada ? r.fecha_entrada : null
}
function ykOpenModal(titulo, html, ancho) {
  const ov = document.createElement('div')
  ov.className = 'yk-ov'
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove() })
  const w = ancho ? ` style="width:${ancho}"` : ''
  ov.innerHTML = `<div class="yk-modal"${w}><div class="yk-mhead"><b>${titulo}</b><button onclick="this.closest('.yk-ov').remove()">✕</button></div><div style="padding:6px 12px 14px">${html}</div></div>`
  document.body.appendChild(ov)
}

// Drill de MODO MARGEN (venta vs costo). Misma jerarquía marca→modelo→año.
function ykDimDrillM(dim, raw) {
  if (dim === 'marca')  return { filtros: [['marca', raw.marca]], sub: 'modelosolo' }
  if (dim === 'modelo') return { filtros: [['marca', raw.marca], ['modelo', raw.modelo]], sub: 'anio' }
  return null   // contenedor → ykContenedorDetalle ; unidad es el nivel más fino
}
window.ykDrillM = (filtros, sub, titulo) => {
  let datos = ykVMargen || []
  filtros.forEach(([campo, val]) => { datos = datos.filter(r => String(r[campo] ?? '') === String(val)) })
  const g = {}
  datos.forEach(r => {
    let k, raw
    if (sub === 'anio') { k = r.anio_vehiculo ?? '—'; raw = { anio_vehiculo: r.anio_vehiculo } }
    else if (sub === 'modelosolo') { k = r.modelo || '(sin modelo)'; raw = { modelo: r.modelo } }
    else { k = `${r.marca || '(sin marca)'} ${r.modelo || ''}`.trim(); raw = { marca: r.marca, modelo: r.modelo } }
    ;(g[k] = g[k] || { k, raw, venta: 0, costo: 0, lineas: 0, vehs: new Set() })
    g[k].venta += +r.venta || 0; g[k].costo += +r.costo_hnl || 0; g[k].lineas += +r.lineas || 0
    if (r.vehiculo_codigo != null && r.vehiculo_codigo !== '') g[k].vehs.add(String(r.vehiculo_codigo))
  })
  let rows = Object.values(g).map(r => ({ ...r, veh: r.vehs.size, utilidad: r.venta - r.costo, pct: r.costo > 0 ? r.venta / r.costo : null }))
  rows.sort((a, b) => b.utilidad - a.utilidad)
  const tV = rows.reduce((s, r) => s + r.venta, 0), tC = rows.reduce((s, r) => s + r.costo, 0), tU = tV - tC, tL = rows.reduce((s, r) => s + r.lineas, 0), tVeh = rows.reduce((s, r) => s + r.veh, 0)
  const subLabel = sub === 'anio' ? 'Año del vehículo' : sub === 'modelosolo' ? 'Modelo' : 'Marca + Modelo'
  const puedeDrill = sub !== 'anio' && !filtros.some(f => f[0] === 'anio_vehiculo')

  const body = rows.map(r => {
    let cell = r.k
    if (puedeDrill) {
      const nf = filtros.concat(sub === 'modelosolo' ? [['modelo', r.raw.modelo]] : [['marca', r.raw.marca], ['modelo', r.raw.modelo]])
      cell = ykDrillCell(nf, 'anio', `${titulo} · ${r.k}`, r.k, 'M')
    }
    return `<tr><td>${cell}</td><td class="yk-num">${ykFmt0(r.veh)}</td><td class="yk-num">${ykFmt0(r.lineas)}</td><td class="yk-num">${ykFmt(r.venta)}</td><td class="yk-num">${ykFmt(r.costo)}</td><td class="yk-num" style="color:${r.utilidad < 0 ? '#e06060' : 'inherit'}">${ykFmt(r.utilidad)}</td><td class="yk-num">${ykPct(r.pct)}</td></tr>`
  }).join('')

  ykOpenModal(`${titulo} · por ${subLabel.toLowerCase()}`, `
    <div style="font-size:11px;color:var(--text3,#888);margin:2px 0 8px">${rows.length} ${subLabel.toLowerCase()}(s) · toca una fila para bajar otro nivel</div>
    <table class="yk-tbl"><thead><tr><th>${subLabel}</th><th class="yk-num">Vehículos</th><th class="yk-num">Items</th><th class="yk-num">Venta</th><th class="yk-num">Costo</th><th class="yk-num">Utilidad</th><th class="yk-num">% recup.</th></tr></thead>
    <tbody>${body}<tr class="tot"><td>TOTAL</td><td class="yk-num">${ykFmt0(tVeh)}</td><td class="yk-num">${ykFmt0(tL)}</td><td class="yk-num">${ykFmt(tV)}</td><td class="yk-num">${ykFmt(tC)}</td><td class="yk-num">${ykFmt(tU)}</td><td class="yk-num">${tC ? ykPct(tV / tC) : '—'}</td></tr></tbody></table>`, 'min(900px, 94vw)')
}

function ykReporteVentas() {
  const dim = document.getElementById('yk-rep-dim').value
  let datos = ykDatosVentas()

  const keyOf = r => dim === 'mes' ? (r.anio_mes || '—')
    : dim === 'marca' ? (r.marca || '(sin marca)')
    : dim === 'modelo' ? `${r.marca || '(sin marca)'} ${r.modelo || ''}`.trim()
    : dim === 'anio_veh' ? (r.anio_vehiculo ?? '—')
    : (r.contenedor ?? '—')
  ykDrillReg = {}
  const g = {}
  datos.forEach(r => { const k = keyOf(r); (g[k] = g[k] || { k, venta: 0, lineas: 0, raw: { marca: r.marca, modelo: r.modelo, anio_vehiculo: r.anio_vehiculo, contenedor: r.contenedor, anio_mes: r.anio_mes } }); g[k].venta += +r.venta || 0; g[k].lineas += +r.lineas || 0 })
  let rows = Object.values(g)
  if (dim === 'mes' || dim === 'anio_veh' || dim === 'contenedor') rows.sort((a, b) => String(a.k).localeCompare(String(b.k), undefined, { numeric: true }))
  else rows.sort((a, b) => b.venta - a.venta)
  const totV = rows.reduce((s, r) => s + r.venta, 0), totL = rows.reduce((s, r) => s + r.lineas, 0)

  const dimLabel = { mes: 'Mes', marca: 'Marca', modelo: 'Marca + Modelo', anio_veh: 'Año vehículo', contenedor: 'Contenedor' }[dim]
  document.getElementById('yk-rep-cards').innerHTML = `<div class="yk-cards">
    <div class="yk-card ok"><div class="v">${ykFmt(totV)}</div><div class="l">Venta total (L.)</div></div>
    <div class="yk-card"><div class="v">${ykFmt0(totL)}</div><div class="l">Líneas</div></div>
    <div class="yk-card"><div class="v">${rows.length}</div><div class="l">${dimLabel}s</div></div></div>`
  document.getElementById('yk-rep-tabla').innerHTML = `
    <div class="table-wrap" style="max-height:520px;overflow:auto">
      <table class="yk-tbl"><thead><tr><th>${dimLabel}</th><th class="yk-num">Líneas</th><th class="yk-num">Venta (L.)</th><th class="yk-num">% del total</th></tr></thead>
      <tbody>${rows.map(r => { const _sp = ykDimDrill(dim, r.raw); const _c = _sp ? ykDrillCell(_sp.filtros, _sp.sub, r.k, r.k) : r.k; return `<tr><td>${_c}</td><td class="yk-num">${ykFmt0(r.lineas)}</td><td class="yk-num">${ykFmt(r.venta)}</td><td class="yk-num">${totV ? (r.venta / totV * 100).toFixed(1) : 0}%</td></tr>` }).join('')}
        <tr class="tot"><td>TOTAL</td><td class="yk-num">${ykFmt0(totL)}</td><td class="yk-num">${ykFmt(totV)}</td><td class="yk-num">100%</td></tr>
      </tbody></table></div>`
  ykRepActual = { tipo: 'ventas', dimLabel, rows: rows.map(r => ({ [dimLabel]: r.k, Lineas: r.lineas, Venta: r.venta })) }
}

function ykReporteMargen() {
  const dim = document.getElementById('yk-rep-dim').value
  const fCodigo = (document.getElementById('yk-mar-codigo')?.value || '').trim()
  const fMarca  = document.getElementById('yk-mar-marca')?.value || ''
  const fModelo = document.getElementById('yk-mar-modelo')?.value || ''
  const fDesde  = parseInt(document.getElementById('yk-mar-adesde')?.value, 10)
  const fHasta  = parseInt(document.getElementById('yk-mar-ahasta')?.value, 10)
  let datos = ykVMargen || []
  if (fCodigo) datos = datos.filter(r => String(r.vehiculo_codigo) === fCodigo)   // código exacto
  if (fMarca)  datos = datos.filter(r => r.marca === fMarca)
  if (fModelo) datos = datos.filter(r => r.modelo === fModelo)
  if (!isNaN(fDesde)) datos = datos.filter(r => r.anio_vehiculo != null && +r.anio_vehiculo >= fDesde)
  if (!isNaN(fHasta)) datos = datos.filter(r => r.anio_vehiculo != null && +r.anio_vehiculo <= fHasta)
  const keyOf = r => dim === 'unidad' ? `${r.vehiculo_codigo} · ${r.marca || ''} ${r.modelo || ''} ${r.anio_vehiculo || ''}`.trim()
    : dim === 'contenedor' ? (r.contenedor ?? '—')
    : dim === 'marca' ? (r.marca || '(sin marca)')
    : `${r.marca || '(sin marca)'} ${r.modelo || ''}`.trim()
  ykDrillReg = {}
  const g = {}
  datos.forEach(r => {
    const k = keyOf(r); (g[k] = g[k] || { k, venta: 0, costo: 0, lineas: 0, n: 0, raw: { marca: r.marca, modelo: r.modelo, anio_vehiculo: r.anio_vehiculo, contenedor: r.contenedor } })
    g[k].venta += +r.venta || 0; g[k].costo += +r.costo_hnl || 0; g[k].lineas += +r.lineas || 0; g[k].n += 1
  })
  let rows = Object.values(g).map(r => ({ ...r, utilidad: r.venta - r.costo, pct: r.costo > 0 ? r.venta / r.costo : null }))
  if (dim === 'contenedor') rows.sort((a, b) => String(a.k).localeCompare(String(b.k), undefined, { numeric: true }))
  else rows.sort((a, b) => b.utilidad - a.utilidad)
  const tV = rows.reduce((s, r) => s + r.venta, 0), tC = rows.reduce((s, r) => s + r.costo, 0), tU = tV - tC

  const dimLabel = { unidad: 'Unidad', contenedor: 'Contenedor', marca: 'Marca', modelo: 'Marca + Modelo' }[dim]
  document.getElementById('yk-rep-cards').innerHTML = `<div class="yk-cards">
    <div class="yk-card ok"><div class="v">${ykFmt(tV)}</div><div class="l">Venta (L.)</div></div>
    <div class="yk-card"><div class="v">${ykFmt(tC)}</div><div class="l">Costo (L.)</div></div>
    <div class="yk-card ${tU < 0 ? 'bad' : 'ok'}"><div class="v">${ykFmt(tU)}</div><div class="l">Utilidad (L.)</div></div>
    <div class="yk-card"><div class="v">${tV ? (tU / tV * 100).toFixed(0) : 0}%</div><div class="l">Margen</div></div></div>`
  document.getElementById('yk-rep-tabla').innerHTML = `
    <div class="table-wrap" style="max-height:520px;overflow:auto">
      <table class="yk-tbl"><thead><tr><th>${dimLabel}</th><th class="yk-num">Items</th><th class="yk-num">Venta</th><th class="yk-num">Costo</th><th class="yk-num">Utilidad</th><th class="yk-num">% recup.</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${(() => { if (dim === 'contenedor') return `<button class="yk-link" onclick="ykContenedorDetalle('${r.k}')">${r.k}</button>`; const _s = ykDimDrillM(dim, r.raw); return _s ? ykDrillCell(_s.filtros, _s.sub, r.k, r.k, 'M') : r.k })()}</td><td class="yk-num">${ykFmt0(r.lineas)}</td><td class="yk-num">${ykFmt(r.venta)}</td><td class="yk-num">${ykFmt(r.costo)}</td><td class="yk-num" style="color:${r.utilidad < 0 ? '#e06060' : 'inherit'}">${ykFmt(r.utilidad)}</td><td class="yk-num">${ykPct(r.pct)}</td></tr>`).join('')}
        <tr class="tot"><td>TOTAL</td><td class="yk-num"></td><td class="yk-num">${ykFmt(tV)}</td><td class="yk-num">${ykFmt(tC)}</td><td class="yk-num">${ykFmt(tU)}</td><td class="yk-num">${tC ? ykPct(tV / tC) : '—'}</td></tr>
      </tbody></table></div>`
  ykRepActual = { tipo: 'margen', dimLabel, rows: rows.map(r => ({ [dimLabel]: r.k, Items: r.lineas, Venta: r.venta, Costo: r.costo, Utilidad: r.utilidad, Pct_recuperado: r.pct })) }
}

// Diferencia en años/meses/días cumplidos entre dos fechas ISO (YYYY-MM-DD)
function ykAntiguedad(desde, hasta) {
  if (!desde || !hasta) return '—'
  const a = new Date(desde + 'T00:00:00'), b = new Date(hasta + 'T00:00:00')
  if (isNaN(a) || isNaN(b) || b < a) return '—'
  let y = b.getFullYear() - a.getFullYear()
  let m = b.getMonth() - a.getMonth()
  let d = b.getDate() - a.getDate()
  if (d < 0) { m--; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate() }
  if (m < 0) { y--; m += 12 }
  const parts = []
  if (y) parts.push(y + 'a')
  if (m) parts.push(m + 'm')
  parts.push(d + 'd')
  return parts.join(' ')
}

function ykReporteRotacion() {
  const hoy = new Date().toLocaleDateString('en-CA')   // YYYY-MM-DD local (America/Tegucigalpa)
  const data = (ykVRotacion || []).slice()
    .sort((a, b) => String(a.contenedor).localeCompare(String(b.contenedor), undefined, { numeric: true }))
  const nRec = data.filter(r => r.recuperado).length
  const nPend = data.length - nRec
  document.getElementById('yk-rep-cards').innerHTML = `<div class="yk-cards">
    <div class="yk-card"><div class="v">${data.length}</div><div class="l">Contenedores</div></div>
    <div class="yk-card ok"><div class="v">${nRec}</div><div class="l">Recuperaron costo</div></div>
    <div class="yk-card ${nPend ? 'warn' : ''}"><div class="v">${nPend}</div><div class="l">Aún no recuperan</div></div></div>`
  const rows = data.map(r => {
    const antig = ykAntiguedad(r.fecha_entrada, hoy)
    const recup = r.recuperado ? ykAntiguedad(r.fecha_entrada, r.fecha_recuperado) : '—'
    const estado = r.recuperado ? '<span style="color:#4ade80">✓ recuperado</span>' : '<span style="color:#e0a800">pendiente</span>'
    const pct = r.pct_recuperado != null ? +r.pct_recuperado : null
    return `<tr>
      <td><button class="yk-link" onclick="ykContenedorDetalle('${r.contenedor}')">${r.contenedor}</button></td>
      <td>${r.fecha_entrada || '—'}</td>
      <td>${antig}</td>
      <td class="yk-num">${ykFmt(r.costo_total)}</td>
      <td class="yk-num">${ykFmt(r.venta_total)}</td>
      <td class="yk-num" style="${pct != null && pct < 100 ? 'color:#e0a800' : ''}">${pct != null ? pct.toFixed(0) + '%' : '—'}</td>
      <td>${r.fecha_recuperado || '—'}</td>
      <td>${recup}</td>
      <td>${estado}</td>
    </tr>`
  }).join('')
  document.getElementById('yk-rep-tabla').innerHTML = `
    <div class="page-sub" style="margin:4px 0 8px">Antigüedad = desde la entrada del contenedor hasta hoy. Recuperación = el día en que las ventas acumuladas igualaron el costo.</div>
    <div class="table-wrap" style="max-height:520px;overflow:auto">
      <table class="yk-tbl"><thead><tr>
        <th>Contenedor</th><th>Entrada</th><th>Antigüedad</th>
        <th class="yk-num">Costo (L.)</th><th class="yk-num">Venta (L.)</th><th class="yk-num">% recup.</th>
        <th>Recuperó el</th><th>Tiempo p/ recuperar</th><th>Estado</th>
      </tr></thead>
      <tbody>${rows}</tbody></table></div>`
  ykRepActual = { tipo: 'rotacion', dimLabel: 'Contenedor', rows: data.map(r => ({
    Contenedor: r.contenedor,
    Fecha_entrada: r.fecha_entrada,
    Antiguedad: ykAntiguedad(r.fecha_entrada, hoy),
    Dias_antiguedad: r.dias_antiguedad,
    Costo: r.costo_total,
    Venta: r.venta_total,
    Pct_recuperado: r.pct_recuperado,
    Fecha_recuperado: r.fecha_recuperado || '',
    Tiempo_recuperar: r.recuperado ? ykAntiguedad(r.fecha_entrada, r.fecha_recuperado) : 'Aún no',
    Dias_recuperar: r.dias_recuperar,
    Estado: r.recuperado ? 'Recuperado' : 'Pendiente'
  })) }
}

window.ykExportReporte = () => {
  if (!ykRepActual || !ykRepActual.rows.length) { window.toast?.('Nada que exportar', 'info'); return }
  const ws = window.XLSX.utils.json_to_sheet(ykRepActual.rows)
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Reporte')
  const hoy = new Date().toLocaleDateString('en-CA')
  window.XLSX.writeFile(wb, `Yonker_${ykRepActual.tipo}_${ykRepActual.dimLabel}_${hoy}.xlsx`)
}

// ── CONTAMAX · Yonker — Devoluciones de líneas (sin borrar) ──
// Busca la línea original (factura/vehículo/producto) y registra una línea
// en negativo vía RPC yonker_devolver_linea. Solo super_admin, motivo obligatorio.
let ykDevData = {}
let ykDevOv = null

function ykRenderDevoluciones() {
  const pane = document.getElementById('yk-pane')
  if (!pane) return
  pane.innerHTML = `
    <div class="page-sub">Buscá la línea original por <b>factura</b>, <b>código de vehículo</b> o <b>producto</b>, y registrá su devolución. No se borra nada: se crea una línea en negativo que baja la venta y deja el rastro completo.</div>
    <div class="yk-ctrl" style="margin:14px 0">
      <div class="fld" style="flex:1;min-width:240px">
        <label>Buscar (factura / vehículo / producto)</label>
        <input id="yk-dev-q" type="text" placeholder="Ej: 1542  ·  126  ·  motor" onkeydown="if(event.key==='Enter')ykBuscarDev()">
      </div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-gold" onclick="ykBuscarDev()">🔎 Buscar</button></div>
    </div>
    <div id="yk-dev-result"></div>`
  setTimeout(() => { const i = document.getElementById('yk-dev-q'); if (i) i.focus() }, 50)
}

window.ykBuscarDev = async () => {
  const cont = document.getElementById('yk-dev-result')
  const q = (document.getElementById('yk-dev-q')?.value || '').trim()
  if (q.length < 2) { if (cont) cont.innerHTML = '<div class="page-sub" style="color:#e0a800">Escribí al menos 2 caracteres.</div>'; return }
  if (cont) cont.innerHTML = '<div class="page-sub">Buscando…</div>'
  try {
    const { data, error } = await ykSb().rpc('yonker_buscar_lineas', { p_texto: q })
    if (error) throw error
    if (!data?.ok) { cont.innerHTML = `<div class="page-sub" style="color:#e06060">${data?.error || 'Error'}</div>`; return }
    const lineas = data.lineas || []
    if (!lineas.length) { cont.innerHTML = '<div class="page-sub">Sin resultados para esa búsqueda.</div>'; return }
    ykDevData = {}
    const rows = lineas.map(l => {
      ykDevData[l.id] = l
      const dev = l.es_devolucion
      const accion = dev
        ? '<span style="color:#e06060;font-size:11px">devolución</span>'
        : `<button class="btn btn-ghost" style="padding:4px 10px" onclick="ykDevolver('${l.id}')">↩ Devolver</button>`
      return `<tr${dev ? ' style="opacity:.7"' : ''}>
        <td>${l.fecha || ''}</td>
        <td>${l.factura || '—'}</td>
        <td>${l.vehiculo_codigo || '—'}${l.marca ? ' · ' + l.marca : ''}</td>
        <td>${(l.producto || '').slice(0, 50)}</td>
        <td class="yk-num">${ykFmt(l.cantidad)}</td>
        <td class="yk-num" style="${(l.venta_hnl < 0) ? 'color:#e06060' : ''}">${ykFmt(l.venta_hnl)}</td>
        <td>${accion}</td>
      </tr>`
    }).join('')
    cont.innerHTML = `
      <div style="max-height:60vh;overflow:auto">
      <table class="yk-tbl">
        <thead><tr><th>Fecha</th><th>Factura</th><th>Vehículo</th><th>Producto</th><th class="yk-num">Cant.</th><th class="yk-num">Venta (L.)</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="page-sub" style="margin-top:8px">${lineas.length} línea(s). Las marcadas como "devolución" no se pueden volver a devolver.</div>`
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="page-sub" style="color:#e06060">Error: ${e.message || e}</div>`
  }
}

window.ykDevCerrar = () => { if (ykDevOv) { ykDevOv.remove(); ykDevOv = null } }

window.ykDevolver = (id) => {
  const l = ykDevData[id]
  if (!l) return
  ykDevCerrar()
  const ov = document.createElement('div')
  ov.className = 'yk-ov'; ov.id = 'yk-dev-overlay'
  ov.innerHTML = `<div class="yk-modal">
      <div class="yk-mhead"><b>↩ Registrar devolución</b><button onclick="ykDevCerrar()">✕</button></div>
      <div style="padding:14px 16px">
        <div style="font-size:13px;margin-bottom:6px"><b>${l.vehiculo_codigo || '—'}</b> · Factura ${l.factura || '—'}</div>
        <div style="font-size:12px;color:var(--text3,#888);margin-bottom:4px">${(l.producto || '').slice(0, 80)}</div>
        <div style="font-size:13px;margin-bottom:14px">Venta a devolver: <b style="color:#e06060">L. ${ykFmt(l.venta_hnl)}</b> <span style="color:var(--text3,#888);font-size:12px">(se registrará en negativo)</span></div>
        <label style="display:block;font-size:11px;color:var(--text3,#888);text-transform:uppercase;margin-bottom:6px">Motivo de la devolución (obligatorio)</label>
        <textarea id="yk-dev-motivo" rows="3" placeholder="Ej: Cliente devolvió el motor por defecto de fábrica." style="width:100%;resize:vertical"></textarea>
        <div id="yk-dev-msg" style="color:#e0a800;font-size:12px;margin-top:8px;min-height:16px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
          <button class="btn btn-ghost" onclick="ykDevCerrar()">Cancelar</button>
          <button class="btn btn-gold" id="yk-dev-ok" onclick="ykDevConfirmar('${id}')">Confirmar devolución</button>
        </div>
      </div></div>`
  ov.onclick = (e) => { if (e.target === ov) ykDevCerrar() }
  document.body.appendChild(ov)
  ykDevOv = ov
  setTimeout(() => { const m = document.getElementById('yk-dev-motivo'); if (m) m.focus() }, 50)
}

window.ykDevConfirmar = async (id) => {
  const msg = document.getElementById('yk-dev-msg'); const btn = document.getElementById('yk-dev-ok')
  const setMsg = t => { if (msg) msg.textContent = t }
  const motivo = (document.getElementById('yk-dev-motivo')?.value || '').trim()
  if (motivo.length < 5) { setMsg('El motivo es obligatorio (mínimo 5 caracteres).'); return }
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando…' }
  try {
    const { data, error } = await ykSb().rpc('yonker_devolver_linea', { p_id: id, p_motivo: motivo })
    if (error) throw error
    if (!data?.ok) { setMsg(data?.error || 'No se pudo.'); if (btn) { btn.disabled = false; btn.textContent = 'Confirmar devolución' } return }
    window.toast?.(`Devolución registrada · L. ${ykFmt(data.devuelto)}${data.costo126_nuevo != null ? ' · costo #126 recalculado' : ''}`, 'success')
    ykDevCerrar()
    ykVResumen = null; ykVMargen = null; ykVRotacion = null   // invalidar cache de reportes
    if (window.logActividad) window.logActividad('yonker_devolucion', 'devolver', `Devolución de línea ${id}: ${motivo}`)
    ykBuscarDev()                          // refrescar la búsqueda
  } catch (e) {
    setMsg('Error: ' + (e.message || e)); if (btn) { btn.disabled = false; btn.textContent = 'Confirmar devolución' }
  }
}

// ── CONTAMAX · Yonker — Drill-down de contenedor (unidades con % recuperado) ──
let ykUniOv = null
window.ykUniCerrar = () => { if (ykUniOv) { ykUniOv.remove(); ykUniOv = null } }
window.ykContenedorDetalle = (contenedor) => {
  const unidades = (ykVMargen || [])
    .filter(u => String(u.contenedor) === String(contenedor))
    .sort((a, b) => (+a.pct_recuperado || 0) - (+b.pct_recuperado || 0))   // menos recuperado primero
  if (!unidades.length) { window.toast?.('Sin unidades para ese contenedor', 'info'); return }
  ykUniCerrar()
  const totC = unidades.reduce((s, u) => s + (+u.costo_hnl || 0), 0)
  const totV = unidades.reduce((s, u) => s + (+u.venta || 0), 0)
  const rows = unidades.map(u => {
    const pct = u.pct_recuperado != null ? (+u.pct_recuperado * 100) : null   // la vista guarda ratio (venta/costo)
    const rec = pct != null && pct >= 100
    return `<tr>
      <td>${u.vehiculo_codigo}</td>
      <td>${(u.marca || '')} ${(u.modelo || '')} ${(u.anio_vehiculo || '')}</td>
      <td class="yk-num">${ykFmt(u.costo_hnl)}</td>
      <td class="yk-num">${ykFmt(u.venta)}</td>
      <td class="yk-num" style="color:${rec ? '#4ade80' : '#e0a800'}">${pct != null ? pct.toFixed(0) + '%' : '—'}</td>
      <td>${rec ? '<span style="color:#4ade80">✓</span>' : '<span style="color:#e0a800">pendiente</span>'}</td>
    </tr>`
  }).join('')
  const ov = document.createElement('div')
  ov.className = 'yk-ov'; ov.id = 'yk-uni-overlay'
  ov.innerHTML = `<div class="yk-modal" style="width:680px">
      <div class="yk-mhead"><b>📦 Contenedor ${contenedor} · ${unidades.length} unidades${ykFechaContenedor(contenedor) ? ' · Ingreso: ' + ykFechaContenedor(contenedor) : ''}</b><button onclick="ykUniCerrar()">✕</button></div>
      <div style="padding:12px 16px">
        <div class="page-sub" style="margin-bottom:8px">Ordenadas de <b>menor a mayor recuperación</b>. Las primeras son las que aún no venden lo suficiente — útil para ir a auditar el físico.</div>
        <div style="max-height:60vh;overflow:auto">
        <table class="yk-tbl"><thead><tr><th>Vehículo</th><th>Marca / Modelo / Año</th><th class="yk-num">Costo</th><th class="yk-num">Venta</th><th class="yk-num">% recup.</th><th>Estado</th></tr></thead>
        <tbody>${rows}
          <tr class="tot"><td>TOTAL</td><td></td><td class="yk-num">${ykFmt(totC)}</td><td class="yk-num">${ykFmt(totV)}</td><td class="yk-num">${totC ? (totV / totC * 100).toFixed(0) + '%' : '—'}</td><td></td></tr>
        </tbody></table></div>
      </div></div>`
  ov.onclick = (e) => { if (e.target === ov) ykUniCerrar() }
  document.body.appendChild(ov)
  ykUniOv = ov
}

// ── CONTAMAX · Yonker — Explorar (buscador de dos niveles, línea por línea) ──
let ykExpRows = []
let ykUnidades = null   // cache de unidades para autocompletar (marca/modelo/código/año)
async function ykCargarUnidades() {
  if (ykUnidades) return ykUnidades
  try {
    const { data, error } = await ykSb().rpc('yonker_filtros')
    if (error) throw error
    ykUnidades = (data?.ok && Array.isArray(data.unidades)) ? data.unidades : []
  } catch (e) { ykUnidades = [] }
  return ykUnidades
}
window.ykExpModelosDe = (marca) => {
  const us = ykUnidades || []
  const filt = marca ? us.filter(u => (u.marca || '') === marca) : us
  return [...new Set(filt.map(u => u.modelo).filter(Boolean))].sort()
}
window.ykExpUnidadesFiltradas = () => {
  const us = ykUnidades || []
  const marca = document.getElementById('yk-exp-mar')?.value || ''
  const modelo = document.getElementById('yk-exp-mod')?.value || ''
  return us.filter(u => (!marca || (u.marca || '') === marca) && (!modelo || (u.modelo || '') === modelo))
}
window.ykExpYearsUpdate = (autofill) => {
  const ad = document.getElementById('yk-exp-ad'), ah = document.getElementById('yk-exp-ah')
  if (!ad || !ah) return
  const years = [...new Set(ykExpUnidadesFiltradas().map(u => u.anio_vehiculo).filter(Boolean))].sort((a, b) => a - b)
  const prevD = ad.value, prevH = ah.value
  const opts = '<option value="">—</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('')
  ad.innerHTML = opts; ah.innerHTML = opts
  if (years.length) {
    ad.value = (autofill || !years.includes(+prevD)) ? String(years[0]) : prevD
    ah.value = (autofill || !years.includes(+prevH)) ? String(years[years.length - 1]) : prevH
  } else { ad.value = ''; ah.value = '' }
}
window.ykExpAnioGuard = (which) => {
  const ad = document.getElementById('yk-exp-ad'), ah = document.getElementById('yk-exp-ah')
  if (ad && ah && ad.value && ah.value && +ad.value > +ah.value) { if (which === 'ad') ah.value = ad.value; else ad.value = ah.value }
  if (window.ykUnidadesPanel) ykUnidadesPanel('yk-exp')
}
window.ykExpMarcaChange = () => {
  const sel = document.getElementById('yk-exp-mod'); if (!sel) return
  const marca = document.getElementById('yk-exp-mar')?.value || ''
  const actual = sel.value
  const modelos = ykExpModelosDe(marca)
  sel.innerHTML = '<option value="">(todos)</option>' + modelos.map(m => `<option value="${String(m).replace(/"/g, '&quot;')}">${m}</option>`).join('')
  sel.value = modelos.includes(actual) ? actual : ''
  ykExpYearsUpdate(true)   // ajusta el rango de años a la marca/modelo
  if (window.ykUnidadesPanel) ykUnidadesPanel('yk-exp')
}
window.ykExpModeloChange = () => { ykExpYearsUpdate(true); if (window.ykUnidadesPanel) ykUnidadesPanel('yk-exp') }
window.ykExpAutofill = () => {
  const cod = (document.getElementById('yk-exp-cod')?.value || '').trim()
  if (!cod || !ykUnidades) return
  const u = ykUnidades.find(x => String(x.vehiculo_codigo) === cod)
  if (!u) return
  const mar = document.getElementById('yk-exp-mar')
  if (mar && !mar.value && u.marca) { mar.value = u.marca; ykExpMarcaChange() }
  const mod = document.getElementById('yk-exp-mod')
  if (mod && !mod.value && u.modelo) {
    if (![...mod.options].some(o => o.value === u.modelo)) { const o = document.createElement('option'); o.value = u.modelo; o.textContent = u.modelo; mod.appendChild(o) }
    mod.value = u.modelo
    ykExpYearsUpdate(true)
  }
  // fijar el año exacto del vehículo
  if (u.anio_vehiculo) {
    const ad = document.getElementById('yk-exp-ad'), ah = document.getElementById('yk-exp-ah')
    const ensure = sel => { if (sel && ![...sel.options].some(o => +o.value === +u.anio_vehiculo)) { const o = document.createElement('option'); o.value = u.anio_vehiculo; o.textContent = u.anio_vehiculo; sel.appendChild(o) } }
    ensure(ad); ensure(ah)
    if (ad) ad.value = u.anio_vehiculo
    if (ah) ah.value = u.anio_vehiculo
  }
  if (window.ykUnidadesPanel) ykUnidadesPanel('yk-exp')
}
function ykRenderExplorar() {
  const pane = document.getElementById('yk-pane')
  if (!pane) return
  pane.innerHTML = `
    <div class="page-sub">Filtro 1: elegí unidades por <b>vehículo, marca, modelo y/o rango de años</b>. Filtro 2: dentro de eso, buscá un <b>producto</b> (ej. "motor"). Resultados por línea de venta.</div>
    <div class="yk-ctrl" style="margin:14px 0;align-items:flex-end">
      <div class="fld"><label>Vehículo (código)</label><input id="yk-exp-cod" type="text" style="width:120px" placeholder="ej. 126" onchange="ykExpAutofill()" onkeydown="if(event.key==='Enter')ykExplorar()"></div>
      <div class="fld"><label>Marca</label><select id="yk-exp-mar" style="width:150px" onchange="ykExpMarcaChange()"><option value="">(todas)</option></select></div>
      <div class="fld"><label>Modelo</label><select id="yk-exp-mod" style="width:160px" onchange="ykExpModeloChange()"><option value="">(todos)</option></select></div>
      <div class="fld"><label>Año desde</label><select id="yk-exp-ad" style="width:95px" onchange="ykExpAnioGuard('ad')"><option value="">—</option></select></div>
      <div class="fld"><label>Año hasta</label><select id="yk-exp-ah" style="width:95px" onchange="ykExpAnioGuard('ah')"><option value="">—</option></select></div>
      <div class="fld"><label>Producto (filtro 2)</label><input id="yk-exp-prod" type="text" style="width:150px" placeholder="ej. motor" onkeydown="if(event.key==='Enter')ykExplorar()"></div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-gold" onclick="ykExplorar()">🔎 Buscar</button></div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-ghost" onclick="ykExplorarLimpiar()">Limpiar</button></div>
    </div>
    <div id="yk-exp-unidades"></div>
    <div id="yk-exp-cards"></div>
    <div id="yk-exp-result"><div class="page-sub">Indicá al menos un filtro de vehículo/marca/modelo/año y tocá Buscar.</div></div>`
  ykCargarUnidades().then(us => {
    const marcas = [...new Set(us.map(u => u.marca).filter(Boolean))].sort()
    const mar = document.getElementById('yk-exp-mar')
    if (mar) mar.innerHTML = '<option value="">(todas)</option>' + marcas.map(m => `<option value="${String(m).replace(/"/g, '&quot;')}">${m}</option>`).join('')
    ykExpMarcaChange()
  })
}
window.ykExplorarLimpiar = () => {
  ['yk-exp-cod', 'yk-exp-prod'].forEach(id => { const e = document.getElementById(id); if (e) e.value = '' })
  const mar = document.getElementById('yk-exp-mar'); if (mar) mar.value = ''
  const mod = document.getElementById('yk-exp-mod'); if (mod) mod.value = ''
  if (window.ykExpMarcaChange) ykExpMarcaChange()
  const ad = document.getElementById('yk-exp-ad'); if (ad) ad.value = ''
  const ah = document.getElementById('yk-exp-ah'); if (ah) ah.value = ''
  const c = document.getElementById('yk-exp-cards'); if (c) c.innerHTML = ''
  const r = document.getElementById('yk-exp-result'); if (r) r.innerHTML = '<div class="page-sub">Indicá al menos un filtro y tocá Buscar.</div>'
}
window.ykExplorar = async () => {
  const cont = document.getElementById('yk-exp-result')
  const cards = document.getElementById('yk-exp-cards')
  ykExpAutofill()   // si hay código, llena marca/modelo/año vacíos antes de buscar
  const val = id => (document.getElementById(id)?.value || '').trim()
  const num = id => { const v = parseInt(val(id), 10); return isNaN(v) ? null : v }
  const params = {
    p_codigo: val('yk-exp-cod') || null,
    p_marca: val('yk-exp-mar') || null,
    p_modelo: val('yk-exp-mod') || null,
    p_anio_desde: num('yk-exp-ad'),
    p_anio_hasta: num('yk-exp-ah'),
    p_producto: val('yk-exp-prod') || null
  }
  if (cont) cont.innerHTML = '<div class="page-sub">Buscando…</div>'
  try {
    const { data, error } = await ykSb().rpc('yonker_explorar', params)
    if (error) throw error
    if (!data?.ok) { if (cards) cards.innerHTML = ''; cont.innerHTML = `<div class="page-sub" style="color:#e0a800">${data?.error || 'Error'}</div>`; return }
    const lineas = data.lineas || []
    ykExpRows = lineas
    const esSuper = ykEsSuper()
    if (cards) cards.innerHTML = `<div class="yk-cards">
      ${esSuper ? `<div class="yk-card ok"><div class="v">${ykFmt(data.total_venta)}</div><div class="l">Venta filtrada (L.)</div></div>` : ''}
      <div class="yk-card"><div class="v">${ykFmt0(data.total_lineas)}</div><div class="l">Líneas</div></div>
      ${esSuper ? `<div class="yk-card" style="display:flex;align-items:center;justify-content:center"><button class="btn btn-ghost" onclick="ykExpExport()">📥 Exportar Excel</button></div>` : ''}</div>`
    if (!lineas.length) { cont.innerHTML = '<div class="page-sub">Sin resultados para esos filtros.</div>'; return }
    const rows = lineas.map(l => `<tr>
      <td>${l.fecha || ''}</td>
      <td>${l.vehiculo_codigo || '—'}</td>
      <td>${(l.marca || '')} ${(l.modelo || '')} ${(l.anio_vehiculo || '')}</td>
      <td>${(l.producto || '').slice(0, 60)}</td>
      <td class="yk-num">${ykFmt(l.cantidad)}</td>
      <td class="yk-num" style="${l.venta_hnl < 0 ? 'color:#e06060' : ''}">${ykFmt(l.venta_hnl)}</td>
      <td>${l.factura || '—'}</td>
      <td>${l.cliente || '—'}</td>
    </tr>`).join('')
    cont.innerHTML = `
      <div class="table-wrap" style="max-height:520px;overflow:auto">
      <table class="yk-tbl"><thead><tr><th>Fecha</th><th>Veh.</th><th>Marca/Modelo/Año</th><th>Producto</th><th class="yk-num">Cant.</th><th class="yk-num">Venta</th><th>Factura</th><th>Cliente</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="page-sub" style="margin-top:8px">Mostrando ${data.mostradas} de ${data.total_lineas} línea(s)${data.truncado ? ' · resultado limitado, afiná los filtros para ver todo' : ''}.</div>`
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="page-sub" style="color:#e06060">Error: ${e.message || e}</div>`
  }
}
window.ykExpExport = () => {
  if (!ykEsSuper()) return
  if (!ykExpRows.length) { window.toast?.('Nada que exportar', 'info'); return }
  const ws = window.XLSX.utils.json_to_sheet(ykExpRows.map(l => ({
    Fecha: l.fecha, Vehiculo: l.vehiculo_codigo, Marca: l.marca, Modelo: l.modelo, Anio: l.anio_vehiculo,
    Producto: l.producto, Cantidad: l.cantidad, Venta: l.venta_hnl, Factura: l.factura, Cliente: l.cliente, Contenedor: l.contenedor
  })))
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Explorar')
  window.XLSX.writeFile(wb, `Yonker_Explorar_${new Date().toLocaleDateString('en-CA')}.xlsx`)
}

// ── CONTAMAX · Yonker — Cotización (consulta de precios de piezas) ──
let ykCotRows = []
let ykCotParams = null    // filtros de la última cotización (para el ratio de costo)
let ykCotRatio = null     // { ratio_mediana, ratio_p25, ratio_p75, n }
let ykCotCosto = null     // costo de la unidad elegida para sugerir precio
let ykCotUniTimer = null
function ykRenderCotizar() {
  const pane = document.getElementById('yk-pane')
  if (!pane) return
  pane.innerHTML = `
    <div class="page-sub">Consultá a qué precio se ha vendido una pieza. Elegí marca/modelo/año, escribí la pieza (ej. "tijera", "amortiguador") y, si querés, refiná con una sub-palabra. La búsqueda tolera errores de tipeo.</div>
    <div class="yk-ctrl" style="margin:14px 0;align-items:flex-end">
      <div class="fld"><label>Marca</label><select id="yk-cot-mar" style="width:150px" onchange="ykCotMarcaChange()"><option value="">(todas)</option></select></div>
      <div class="fld"><label>Modelo</label><select id="yk-cot-mod" style="width:160px" onchange="ykCotYearsUpdate(false)"><option value="">(todos)</option></select></div>
      <div class="fld"><label>Año desde</label><select id="yk-cot-ad" style="width:95px" onchange="ykUnidadesPanel('yk-cot')"><option value="">—</option></select></div>
      <div class="fld"><label>Año hasta</label><select id="yk-cot-ah" style="width:95px" onchange="ykUnidadesPanel('yk-cot')"><option value="">—</option></select></div>
      <div class="fld"><label>Pieza</label><input id="yk-cot-pza" type="text" style="width:160px" placeholder="ej. tijera" onkeydown="if(event.key==='Enter')ykCotizar()"></div>
      <div class="fld"><label>Sub-pieza (refinar)</label><input id="yk-cot-sub" type="text" style="width:140px" placeholder="ej. delantera" onkeydown="if(event.key==='Enter')ykCotizar()"></div>
      <div class="fld"><label>Precio desde</label><input id="yk-cot-pmin" type="number" style="width:110px" placeholder="ej. 500" onkeydown="if(event.key==='Enter')ykCotizar()"></div>
      <div class="fld"><label>Precio hasta</label><input id="yk-cot-pmax" type="number" style="width:110px" placeholder="ej. 5000" onkeydown="if(event.key==='Enter')ykCotizar()"></div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-gold" onclick="ykCotizar()">💵 Cotizar</button></div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-ghost" onclick="ykCotLimpiar()">Limpiar</button></div>
    </div>
    ${ykPuedeCotizaciones() ? `<div style="margin:-4px 0 10px;display:flex;gap:8px">
      <button class="btn btn-ghost" onclick="ykCotAgregar()">➕ Agregar cotización histórica</button>
      <button class="btn btn-ghost" onclick="ykCotGestionar()">📋 Cotizaciones guardadas</button>
    </div>` : ''}
    <div id="yk-cot-unidades"></div>
    <div id="yk-cot-cards"></div>
    <div id="yk-cot-sugerir"></div>
    <div id="yk-cot-result"><div class="page-sub">Indicá marca/modelo/año o una pieza, y tocá Cotizar.</div></div>`
  ykCargarUnidades().then(us => {
    const marcas = [...new Set(us.map(u => u.marca).filter(Boolean))].sort()
    const mar = document.getElementById('yk-cot-mar')
    if (mar) mar.innerHTML = '<option value="">(todas)</option>' + marcas.map(m => `<option value="${String(m).replace(/"/g, '&quot;')}">${m}</option>`).join('')
    ykCotMarcaChange()
  })
}
window.ykCotUnidadesFiltradas = () => {
  const us = ykUnidades || []
  const marca = document.getElementById('yk-cot-mar')?.value || ''
  const modelo = document.getElementById('yk-cot-mod')?.value || ''
  return us.filter(u => (!marca || (u.marca || '') === marca) && (!modelo || (u.modelo || '') === modelo))
}
window.ykCotYearsUpdate = () => {
  const ad = document.getElementById('yk-cot-ad'), ah = document.getElementById('yk-cot-ah')
  if (!ad || !ah) return
  const years = [...new Set(ykCotUnidadesFiltradas().map(u => u.anio_vehiculo).filter(Boolean))].sort((a, b) => a - b)
  const opts = '<option value="">—</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('')
  ad.innerHTML = opts; ah.innerHTML = opts   // en cotización el rango queda abierto por defecto
  if (window.ykUnidadesPanel) ykUnidadesPanel('yk-cot')
}
window.ykCotMarcaChange = () => {
  const sel = document.getElementById('yk-cot-mod'); if (!sel) return
  const marca = document.getElementById('yk-cot-mar')?.value || ''
  const actual = sel.value
  const modelos = ykExpModelosDe(marca)
  sel.innerHTML = '<option value="">(todos)</option>' + modelos.map(m => `<option value="${String(m).replace(/"/g, '&quot;')}">${m}</option>`).join('')
  sel.value = modelos.includes(actual) ? actual : ''
  ykCotYearsUpdate()
  if (window.ykUnidadesPanel) ykUnidadesPanel('yk-cot')
}
window.ykCotLimpiar = () => {
  const mar = document.getElementById('yk-cot-mar'); if (mar) mar.value = ''
  const mod = document.getElementById('yk-cot-mod'); if (mod) mod.value = ''
  ;['yk-cot-pza', 'yk-cot-sub', 'yk-cot-pmin', 'yk-cot-pmax'].forEach(id => { const e = document.getElementById(id); if (e) e.value = '' })
  if (window.ykCotMarcaChange) ykCotMarcaChange()
  const c = document.getElementById('yk-cot-cards'); if (c) c.innerHTML = ''
  const r = document.getElementById('yk-cot-result'); if (r) r.innerHTML = '<div class="page-sub">Indicá marca/modelo/año o una pieza, y tocá Cotizar.</div>'
}
window.ykCotizar = async () => {
  const cont = document.getElementById('yk-cot-result'), cards = document.getElementById('yk-cot-cards')
  const val = id => (document.getElementById(id)?.value || '').trim()
  const num = id => { const v = parseInt(val(id), 10); return isNaN(v) ? null : v }
  const fnum = id => { const v = parseFloat(val(id)); return isNaN(v) ? null : v }
  const params = {
    p_marca: val('yk-cot-mar') || null,
    p_modelo: val('yk-cot-mod') || null,
    p_anio_desde: num('yk-cot-ad'),
    p_anio_hasta: num('yk-cot-ah'),
    p_pieza: val('yk-cot-pza') || null,
    p_subpieza: val('yk-cot-sub') || null,
    p_precio_min: fnum('yk-cot-pmin'),
    p_precio_max: fnum('yk-cot-pmax')
  }
  ykCotParams = params
  ykCotRatio = null; ykCotCosto = null
  const sug = document.getElementById('yk-cot-sugerir'); if (sug) sug.innerHTML = ''
  if (cont) cont.innerHTML = '<div class="page-sub">Buscando…</div>'
  try {
    const { data, error } = await ykSb().rpc('yonker_cotizar', params)
    if (error) throw error
    if (!data?.ok) { if (cards) cards.innerHTML = ''; cont.innerHTML = `<div class="page-sub" style="color:#e0a800">${data?.error || 'Error'}</div>`; return }
    const piezas = data.piezas || []
    ykCotRows = piezas
    if (!piezas.length) { if (cards) cards.innerHTML = ''; cont.innerHTML = '<div class="page-sub">Sin ventas registradas para esos filtros.</div>'; return }
    const allMin = Math.min(...piezas.map(p => +p.precio_min))
    const allMax = Math.max(...piezas.map(p => +p.precio_max))
    const allProm = piezas.reduce((s, p) => s + (+p.precio_prom || 0), 0) / piezas.length
    const ultima = piezas.reduce((m, p) => (p.ultima_fecha > m ? p.ultima_fecha : m), '')
    if (cards) cards.innerHTML = `<div class="yk-cards">
      <div class="yk-card ok"><div class="v">L. ${ykFmt(allMin)}</div><div class="l">Precio mínimo</div></div>
      <div class="yk-card"><div class="v">L. ${ykFmt(allProm)}</div><div class="l">Precio promedio</div></div>
      <div class="yk-card warn"><div class="v">L. ${ykFmt(allMax)}</div><div class="l">Precio máximo</div></div>
      <div class="yk-card"><div class="v">${piezas.length}</div><div class="l">Piezas · últ. ${ultima || '—'}</div></div></div>`
    if (ykEsSuper()) ykCargarRatio()
    const rows = piezas.map(p => {
      const soloCot = (+p.ventas || 0) === 0 && (+p.cotizaciones || 0) > 0
      const tag = soloCot ? '<span style="display:inline-block;background:#3a3320;color:#e0b020;border:1px solid #6a5a20;border-radius:8px;padding:0 6px;font-size:10px;margin-right:6px">COTIZACIÓN</span>' : ''
      const cot = (+p.cotizaciones || 0) > 0 ? `<span style="color:#e0b020">${p.cotizaciones}</span>` : '0'
      const trStyle = soloCot ? ' style="background:rgba(224,176,32,.10)"' : ''
      return `<tr${trStyle}>
      <td>${tag}${(p.producto || '').slice(0, 70)}</td>
      <td class="yk-num">${p.ventas}</td>
      <td class="yk-num">${cot}</td>
      <td class="yk-num">${ykFmt(p.precio_min)}</td>
      <td class="yk-num" style="color:#f0a500;font-weight:600">${ykFmt(p.precio_prom)}</td>
      <td class="yk-num">${ykFmt(p.precio_max)}</td>
      <td>${p.ultima_fecha || '—'}</td>
      <td>${p.ultimo_cliente || '—'}</td>
    </tr>`
    }).join('')
    cont.innerHTML = `
      ${ykEsSuper() ? '<div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button class="btn btn-ghost" onclick="ykCotExport()">📥 Exportar Excel</button></div>' : ''}
      <div class="table-wrap" style="max-height:520px;overflow:auto">
      <table class="yk-tbl"><thead><tr><th>Pieza (producto)</th><th class="yk-num">Ventas</th><th class="yk-num">Cot.</th><th class="yk-num">Mín</th><th class="yk-num">Prom</th><th class="yk-num">Máx</th><th>Última</th><th>Último cliente</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="page-sub" style="margin-top:8px">${piezas.length} pieza(s) distinta(s). <b>Ventas</b> = ventas reales · <b>Cot.</b> = cotizaciones históricas (precio cotizado, no vendido). Las filas <span style="background:rgba(224,176,32,.18);padding:0 6px;border-radius:4px">resaltadas</span> provienen de la tabla de cotizaciones (sin venta real).</div>`
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="page-sub" style="color:#e06060">Error: ${e.message || e}</div>`
  }
}

// ── Precio sugerido por costo (solo super/admin) ──
async function ykCargarRatio() {
  const el = document.getElementById('yk-cot-sugerir')
  if (!el || !ykCotParams) return
  try {
    const { data, error } = await ykSb().rpc('yonker_ratio_costo', ykCotParams)
    if (error) throw error
    if (!data?.ok || !data.n) { ykCotRatio = null; el.innerHTML = ''; return }
    ykCotRatio = data
    ykRenderSugerir()
  } catch (e) { el.innerHTML = '' }
}
function ykRenderSugerir() {
  const el = document.getElementById('yk-cot-sugerir'); if (!el || !ykCotRatio) return
  const pct = v => ((+v || 0) * 100).toFixed(2) + '%'
  el.innerHTML = `
    <div style="margin:12px 0;padding:14px 16px;border-radius:12px;background:rgba(240,165,0,.06);border:1px solid rgba(240,165,0,.35)">
      <div style="font-weight:700;color:#f0a500;margin-bottom:10px">💡 Sugerir precio por costo <span style="font-weight:400;color:#8b8f98;font-size:12px">(solo super/admin)</span></div>
      <div class="yk-cards" style="margin-bottom:10px">
        <div class="yk-card"><div class="v">${pct(ykCotRatio.ratio_mediana)}</div><div class="l">% del costo (mediana)</div></div>
        <div class="yk-card"><div class="v" style="font-size:15px">${pct(ykCotRatio.ratio_p25)} – ${pct(ykCotRatio.ratio_p75)}</div><div class="l">Rango p25–p75</div></div>
        <div class="yk-card"><div class="v">${ykCotRatio.n}</div><div class="l">Ventas con costo</div></div>
      </div>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="fld" style="position:relative">
          <label>Vehículo nuevo (buscá por código / marca / modelo)</label>
          <input id="yk-cot-uni-q" type="text" style="width:300px" placeholder="ej. CR-V, 133, HONDA…" autocomplete="off" oninput="ykCotBuscarUnidad(this.value)">
          <div id="yk-cot-uni-list" style="position:absolute;z-index:20;top:100%;left:0;right:0;background:#12151b;border:1px solid #2a2f3a;border-radius:8px;max-height:220px;overflow:auto;display:none"></div>
        </div>
      </div>
      <div id="yk-cot-sugerido" style="margin-top:12px"></div>
    </div>`
  ykCotSugerirPintar()
}
window.ykCotBuscarUnidad = (q) => {
  clearTimeout(ykCotUniTimer)
  const list = document.getElementById('yk-cot-uni-list')
  if (!q || !q.trim()) { if (list) { list.style.display = 'none'; list.innerHTML = '' } return }
  ykCotUniTimer = setTimeout(async () => {
    try {
      const { data } = await ykSb().rpc('yonker_unidad_buscar', { p_q: q.trim() })
      const rows = (data?.ok && data.rows) ? data.rows : []
      if (!list) return
      if (!rows.length) { list.innerHTML = '<div style="padding:8px;color:#8b8f98;font-size:12px">Sin unidades.</div>'; list.style.display = 'block'; return }
      list.innerHTML = rows.map(u => {
        const lbl = `#${u.vehiculo_codigo} · ${u.marca || ''} ${u.modelo || ''} ${u.anio_vehiculo || ''}`.replace(/'/g, '').trim()
        return `<div style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #21252e;font-size:13px" onmouseover="this.style.background='#1b1f27'" onmouseout="this.style.background=''" onclick="ykCotUsarUnidad('${lbl.replace(/"/g, '')}',${(+u.costo_hnl || 0)})">${lbl} <span style="color:#f0a500">· L. ${ykFmt(u.costo_hnl)}</span></div>`
      }).join('')
      list.style.display = 'block'
    } catch (e) { if (list) list.style.display = 'none' }
  }, 250)
}
window.ykCotUsarUnidad = (lbl, costo) => {
  ykCotCosto = { label: lbl, costo: +costo || 0 }
  const inp = document.getElementById('yk-cot-uni-q'); if (inp) inp.value = lbl
  const list = document.getElementById('yk-cot-uni-list'); if (list) { list.style.display = 'none'; list.innerHTML = '' }
  ykCotSugerirPintar()
}
function ykCotSugerirPintar() {
  const el = document.getElementById('yk-cot-sugerido'); if (!el) return
  if (!ykCotRatio || !ykCotCosto || !ykCotCosto.costo) {
    el.innerHTML = '<div class="page-sub" style="margin:0">Elegí un vehículo para ver el precio sugerido.</div>'; return
  }
  const c = ykCotCosto.costo
  const sug = (+ykCotRatio.ratio_mediana || 0) * c
  const lo = (+ykCotRatio.ratio_p25 || 0) * c
  const hi = (+ykCotRatio.ratio_p75 || 0) * c
  el.innerHTML = `
    <div style="padding:10px 14px;border-radius:10px;background:rgba(126,226,160,.08);border:1px solid rgba(126,226,160,.4)">
      <div style="font-size:12px;color:#8b8f98">${ykCotCosto.label} · costo L. ${ykFmt(c)}</div>
      <div style="font-size:22px;font-weight:800;color:#7ee2a0;margin-top:2px">Precio sugerido: L. ${ykFmt(sug)}</div>
      <div style="font-size:12px;color:#8b8f98;margin-top:2px">Banda razonable (p25–p75): L. ${ykFmt(lo)} – L. ${ykFmt(hi)}</div>
    </div>`
}
window.ykCotExport = () => {
  if (!ykEsSuper()) return
  if (!ykCotRows.length) { window.toast?.('Nada que exportar', 'info'); return }
  const ws = window.XLSX.utils.json_to_sheet(ykCotRows.map(p => ({
    Producto: p.producto, Marca: p.marca, Modelo: p.modelo, Anio: p.anio_vehiculo,
    Ventas: p.ventas, Cotizaciones: p.cotizaciones, Precio_min: p.precio_min, Precio_prom: p.precio_prom, Precio_max: p.precio_max,
    Ultima: p.ultima_fecha, Ultimo_cliente: p.ultimo_cliente
  })))
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Cotizacion')
  window.XLSX.writeFile(wb, `Yonker_Cotizacion_${new Date().toLocaleDateString('en-CA')}.xlsx`)
}

// ── Panel de unidades del catálogo que cumplen los filtros (estilo slicer de Excel) ──
// prefix = 'yk-exp' (chips clickeables → filtran por ese vehículo) o 'yk-cot' (informativo)
window.ykUnidadesPanel = (prefix) => {
  const cont = document.getElementById(prefix + '-unidades')
  if (!cont) return
  const marca = document.getElementById(prefix + '-mar')?.value || ''
  const modelo = document.getElementById(prefix + '-mod')?.value || ''
  const ad = parseInt(document.getElementById(prefix + '-ad')?.value, 10)
  const ah = parseInt(document.getElementById(prefix + '-ah')?.value, 10)
  // Sin ningún filtro no listamos las 556 unidades; esperamos a que elija marca/modelo/año
  if (!marca && !modelo && isNaN(ad) && isNaN(ah)) { cont.innerHTML = ''; return }
  const us = ykUnidades || []
  const list = us.filter(u =>
    (!marca || (u.marca || '') === marca) &&
    (!modelo || (u.modelo || '') === modelo) &&
    (isNaN(ad) || (u.anio_vehiculo != null && u.anio_vehiculo >= ad)) &&
    (isNaN(ah) || (u.anio_vehiculo != null && u.anio_vehiculo <= ah))
  )
  const codes = [...new Set(list.map(u => u.vehiculo_codigo).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
  if (!codes.length) { cont.innerHTML = '<div class="page-sub" style="margin:6px 0">No tenés unidades en el catálogo con esos filtros.</div>'; return }
  const esExp = prefix === 'yk-exp'
  const chips = codes.map(c => {
    const cc = String(c).replace(/'/g, "\\'").replace(/"/g, '&quot;')
    return esExp
      ? `<span class="yk-chip" title="Filtrar por vehículo ${c}" onclick="ykChipVeh('${cc}')">${c}</span>`
      : `<span class="yk-chip yk-chip-static">${c}</span>`
  }).join('')
  cont.innerHTML = `<div class="page-sub" style="margin:8px 0 4px"><b>${codes.length}</b> unidad(es) en catálogo que cumplen${esExp ? ' · tocá un número para filtrar por ese vehículo' : ''}:</div><div class="yk-chips">${chips}</div>`
}
window.ykChipVeh = (cod) => {
  const inp = document.getElementById('yk-exp-cod'); if (inp) inp.value = cod
  if (window.ykExplorar) ykExplorar()
}

// ── Cotizaciones históricas: alta y gestión ──
// Pueden gestionar: super_admin/admin, o usuarios con la casilla 'yk-cot-gestionar'.
function ykPuedeCotizaciones() {
  if (ykEsSuper()) return true
  try { const p = window._currentProfile?.(); return Array.isArray(p?.permisos_modulos) && p.permisos_modulos.includes('yk-cot-gestionar') } catch (e) { return false }
}
function ykCotCerrarOv(id) { const o = document.getElementById(id); if (o) o.remove() }
window.ykCotAgregar = () => {
  if (!ykPuedeCotizaciones()) return
  const ov = document.createElement('div')
  ov.className = 'yk-ov'; ov.id = 'yk-cotm-ov'
  const marcas = [...new Set((ykUnidades || []).map(u => u.marca).filter(Boolean))].sort()
  ov.innerHTML = `<div class="yk-modal" style="width:500px">
    <div class="yk-mhead" style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border,#3a3a3a)">
      <b>➕ Agregar cotización histórica</b>
      <button class="btn btn-ghost" onclick="ykCotCerrarOv('yk-cotm-ov')">✕</button>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <div class="page-sub">Precio cotizado de una pieza (aún no vendida). Aparecerá en las búsquedas junto a las ventas reales.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="fld"><label>Marca *</label><select id="yk-cotm-mar" style="width:160px" onchange="ykCotMarcaModalChange()"><option value="">— elegí —</option>${marcas.map(m => `<option value="${String(m).replace(/"/g, '&quot;')}">${m}</option>`).join('')}</select></div>
        <div class="fld"><label>Modelo</label><select id="yk-cotm-mod" style="width:170px"><option value="">(opcional)</option></select></div>
        <div class="fld"><label>Año</label><input id="yk-cotm-anio" type="number" style="width:90px" placeholder="2014"></div>
      </div>
      <div class="fld"><label>Descripción de la pieza *</label><input id="yk-cotm-prod" type="text" style="width:100%" placeholder="ej. MOTOR K24 4X4"></div>
      <div style="display:flex;gap:10px">
        <div class="fld"><label>Precio (L.) *</label><input id="yk-cotm-precio" type="number" style="width:140px" placeholder="ej. 25000"></div>
        <div class="fld" style="flex:1"><label>Nota (opcional)</label><input id="yk-cotm-nota" type="text" style="width:100%" placeholder="ej. cotizado por taller X"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
        <button class="btn btn-ghost" onclick="ykCotCerrarOv('yk-cotm-ov')">Cancelar</button>
        <button class="btn btn-gold" onclick="ykCotGuardar()">Guardar</button>
      </div>
    </div></div>`
  document.body.appendChild(ov)
}
window.ykCotMarcaModalChange = () => {
  const sel = document.getElementById('yk-cotm-mod'); if (!sel) return
  const marca = document.getElementById('yk-cotm-mar')?.value || ''
  const modelos = ykExpModelosDe(marca)
  sel.innerHTML = '<option value="">(opcional)</option>' + modelos.map(m => `<option value="${String(m).replace(/"/g, '&quot;')}">${m}</option>`).join('')
}
window.ykCotGuardar = async () => {
  const v = id => (document.getElementById(id)?.value || '').trim()
  const marca = v('yk-cotm-mar'), prod = v('yk-cotm-prod')
  const precio = parseFloat(v('yk-cotm-precio'))
  const anio = parseInt(v('yk-cotm-anio'), 10)
  if (!marca || !prod) { window.toast?.('Marca y descripción son obligatorias', 'error'); return }
  if (isNaN(precio) || precio <= 0) { window.toast?.('Precio inválido', 'error'); return }
  try {
    const { data, error } = await ykSb().rpc('yonker_cotizacion_guardar', {
      p_marca: marca, p_modelo: v('yk-cotm-mod') || null, p_anio: isNaN(anio) ? null : anio,
      p_producto: prod, p_precio: precio, p_nota: v('yk-cotm-nota') || null
    })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'Error', 'error'); return }
    window.toast?.('Cotización guardada', 'success')
    if (window.logActividad) window.logActividad('cotizacion_guardar', 'yonker', `Cotización: ${marca} ${v('yk-cotm-mod') || ''} ${prod} · L. ${precio}`, data.id)
    ykCotCerrarOv('yk-cotm-ov')
    // si hay una búsqueda activa, refrescar
    if (document.getElementById('yk-cot-result') && ykCotRows.length) ykCotizar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}
window.ykCotGestionar = async () => {
  if (!ykPuedeCotizaciones()) return
  const ov = document.createElement('div')
  ov.className = 'yk-ov'; ov.id = 'yk-cotg-ov'
  ov.innerHTML = `<div class="yk-modal" style="width:760px">
    <div class="yk-mhead" style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border,#3a3a3a)">
      <b>📋 Cotizaciones guardadas</b>
      <button class="btn btn-ghost" onclick="ykCotCerrarOv('yk-cotg-ov')">✕</button>
    </div>
    <div id="yk-cotg-body" style="padding:16px"><div class="page-sub">Cargando…</div></div></div>`
  document.body.appendChild(ov)
  try {
    const { data, error } = await ykSb().rpc('yonker_cotizaciones_listar', { p_limite: 300 })
    if (error) throw error
    const body = document.getElementById('yk-cotg-body')
    const cots = data?.cotizaciones || []
    if (!cots.length) { body.innerHTML = '<div class="page-sub">No hay cotizaciones guardadas todavía.</div>'; return }
    const rows = cots.map(c => `<tr>
      <td>${c.marca || ''} ${c.modelo || ''} ${c.anio_vehiculo || ''}</td>
      <td>${(c.producto || '').slice(0, 50)}</td>
      <td class="yk-num">${ykFmt(c.precio)}</td>
      <td>${(c.creado_en || '').slice(0, 10)}</td>
      <td>${c.creado_por || ''}</td>
      <td>${ykEsSuper() ? `<button class="btn btn-ghost" style="padding:1px 8px" onclick="ykCotEliminar('${c.id}')">🗑️</button>` : ''}</td>
    </tr>`).join('')
    body.innerHTML = `<div class="table-wrap" style="max-height:460px;overflow:auto">
      <table class="yk-tbl"><thead><tr><th>Vehículo</th><th>Pieza</th><th class="yk-num">Precio</th><th>Fecha</th><th>Por</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="page-sub" style="margin-top:8px">${cots.length} cotización(es).</div>`
  } catch (e) {
    const body = document.getElementById('yk-cotg-body'); if (body) body.innerHTML = `<div class="page-sub" style="color:#e06060">Error: ${e.message || e}</div>`
  }
}
window.ykCotEliminar = async (id) => {
  if (!confirm('¿Eliminar esta cotización guardada?')) return
  try {
    const { data, error } = await ykSb().rpc('yonker_cotizacion_eliminar', { p_id: id })
    if (error) throw error
    if (!data?.ok) { window.toast?.(data?.error || 'Error', 'error'); return }
    window.toast?.('Cotización eliminada', 'success')
    ykCotCerrarOv('yk-cotg-ov'); ykCotGestionar()
  } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}