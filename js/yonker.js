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
let ykVMargen = null    // cache vista margen

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

window.initYonker = async () => {
  const vista = document.getElementById('view-yonker')
  if (!vista) return
  if (!ykEsSuper()) { vista.innerHTML = '<div class="page-title">Yonker</div><div class="page-sub">Acceso solo para Super Admin.</div>'; return }
  ykEnsureStyles()
  vista.innerHTML = `
    <div class="page-title">📦 Yonker</div>
    <div class="yk-tabbar">
      <button class="yk-tab active" id="yk-tab-imp" onclick="ykTab('imp')">Importar ventas</button>
      <button class="yk-tab" id="yk-tab-rep" onclick="ykTab('rep')">Reportes</button>
    </div>
    <div id="yk-pane"></div>`
  ykTab('imp')
}

window.ykTab = (which) => {
  const ti = document.getElementById('yk-tab-imp'), tr = document.getElementById('yk-tab-rep')
  if (ti) ti.classList.toggle('active', which === 'imp')
  if (tr) tr.classList.toggle('active', which === 'rep')
  if (which === 'rep') ykRenderReportes()
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
    .yk-tbl td{padding:5px 8px;border-bottom:1px solid var(--border,#2a2a2a)}
    .yk-tbl tr.sinuni td{background:rgba(224,168,0,.08)}
    .yk-tbl tr.tot td{font-weight:700;border-top:2px solid var(--border,#3a3a3a);background:var(--bg2,#1c1c1c)}
    .yk-ctrl{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:8px}
    .yk-ctrl .fld{display:flex;flex-direction:column;gap:3px}
    .yk-ctrl label{font-size:11px;color:var(--text3,#888)}
    .yk-ctrl select{padding:6px 8px;background:var(--bg2,#1c1c1c);border:1px solid var(--border,#3a3a3a);border-radius:6px;color:inherit;font-size:13px}
    .yk-num{text-align:right;font-family:var(--mono,monospace)}
  `
  document.head.appendChild(st)
}

// ═══════════════════════════════ IMPORTAR ═══════════════════════════════
function ykRenderImport() {
  ykFile = null; ykPrev = null
  const pane = document.getElementById('yk-pane')
  pane.innerHTML = `
    <div class="page-sub">Sube el reporte de productos vendidos que bajas de Taller Alpha. El sistema extrae el número de vehículo de la columna Producto, trae marca/modelo/año de las unidades y de-duplica por consecutivo. Solo se insertan los tickets que aún no estén cargados.</div>
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
    filas.push({
      fecha: ykFecha(row[col.fecha]),
      factura: row[col.factura] == null ? null : String(row[col.factura]).trim(),
      consecutivo: cons == null ? null : String(cons).trim(),
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

    const ex = await ykFetchAll(() => ykSb().from('yonker_ventas')
      .select('consecutivo').not('consecutivo', 'is', null).order('consecutivo'))
    const consExist = new Set(ex.map(v => String(v.consecutivo).trim()))

    const nuevas = [], yaCargadas = [], sinUnidad = [], sinFecha = []
    for (const f of filas) {
      if (f.consecutivo && consExist.has(f.consecutivo)) { yaCargadas.push(f); continue }
      if (!f.fecha) { sinFecha.push(f); continue }
      const u = f.vehiculo_codigo ? umap[f.vehiculo_codigo] : null
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
    ykPrev = { nuevas, yaCargadas, sinUnidad, sinFecha, totalFilas: filas.length }
    ykRenderPreview()
  } catch (e) {
    window.toast?.('Error: ' + (e.message || e), 'error')
    btn.disabled = false; btn.innerHTML = 'Procesar →'
  }
}

function ykRenderPreview() {
  const { nuevas, yaCargadas, sinUnidad, sinFecha } = ykPrev
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
      ${sinFecha && sinFecha.length ? `<div class="yk-card warn"><div class="v">${sinFecha.length}</div><div class="l">Sin fecha (omitidas)</div></div>` : ''}
    </div>
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
  } catch (e) {
    pane.innerHTML = `<div class="page-sub" style="color:#e06060">Error cargando reportes: ${e.message || e}</div><button class="btn btn-ghost" onclick="ykRenderReportes()">Reintentar</button>`
    return
  }
  const anios = [...new Set(ykVResumen.map(r => r.anio).filter(x => x != null))].sort()
  const marcas = [...new Set(ykVResumen.map(r => r.marca).filter(x => x))].sort()
  pane.innerHTML = `
    <div class="page-sub">Reportes en vivo. Modo <b>Ventas</b>: total por dimensión y mes. Modo <b>Margen</b>: venta vs costo por unidad (incluye el #126 al 70%).</div>
    <div class="yk-ctrl">
      <div class="fld"><label>Modo</label>
        <select id="yk-rep-modo" onchange="ykAplicarReporte()">
          <option value="ventas">Ventas</option><option value="margen">Margen (venta vs costo)</option>
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
      <div class="fld"><label>&nbsp;</label><button class="btn btn-ghost" onclick="ykExportReporte()">📥 Exportar Excel</button></div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-ghost" onclick="ykVResumen=null;ykVMargen=null;ykRenderReportes()">↻ Refrescar</button></div>
    </div>
    <div id="yk-rep-cards"></div>
    <div id="yk-rep-tabla"></div>`
  ykSetDimOptions()
  ykAplicarReporte()
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

window.ykAplicarReporte = () => {
  const modo = document.getElementById('yk-rep-modo').value
  // reconstruir opciones de dimensión si cambió el modo
  const dimSel = document.getElementById('yk-rep-dim')
  const dimValido = [...dimSel.options].some(o => o.value === dimSel.value)
  document.getElementById('yk-fld-anio').style.display = modo === 'ventas' ? '' : 'none'
  document.getElementById('yk-fld-marca').style.display = modo === 'ventas' ? '' : 'none'
  if (!dimValido || dimSel.dataset.modo !== modo) { ykSetDimOptions(); dimSel.dataset.modo = modo }
  modo === 'ventas' ? ykReporteVentas() : ykReporteMargen()
}

function ykReporteVentas() {
  const dim = document.getElementById('yk-rep-dim').value
  const fAnio = document.getElementById('yk-rep-anio').value
  const fMarca = document.getElementById('yk-rep-marca').value
  let datos = ykVResumen
  if (fAnio) datos = datos.filter(r => String(r.anio) === fAnio)
  if (fMarca) datos = datos.filter(r => r.marca === fMarca)

  const keyOf = r => dim === 'mes' ? (r.anio_mes || '—')
    : dim === 'marca' ? (r.marca || '(sin marca)')
    : dim === 'modelo' ? `${r.marca || '(sin marca)'} ${r.modelo || ''}`.trim()
    : dim === 'anio_veh' ? (r.anio_vehiculo ?? '—')
    : (r.contenedor ?? '—')
  const g = {}
  datos.forEach(r => { const k = keyOf(r); (g[k] = g[k] || { k, venta: 0, lineas: 0 }); g[k].venta += +r.venta || 0; g[k].lineas += +r.lineas || 0 })
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
      <tbody>${rows.map(r => `<tr><td>${r.k}</td><td class="yk-num">${ykFmt0(r.lineas)}</td><td class="yk-num">${ykFmt(r.venta)}</td><td class="yk-num">${totV ? (r.venta / totV * 100).toFixed(1) : 0}%</td></tr>`).join('')}
        <tr class="tot"><td>TOTAL</td><td class="yk-num">${ykFmt0(totL)}</td><td class="yk-num">${ykFmt(totV)}</td><td class="yk-num">100%</td></tr>
      </tbody></table></div>`
  ykRepActual = { tipo: 'ventas', dimLabel, rows: rows.map(r => ({ [dimLabel]: r.k, Lineas: r.lineas, Venta: r.venta })) }
}

function ykReporteMargen() {
  const dim = document.getElementById('yk-rep-dim').value
  const keyOf = r => dim === 'unidad' ? `${r.vehiculo_codigo} · ${r.marca || ''} ${r.modelo || ''} ${r.anio_vehiculo || ''}`.trim()
    : dim === 'contenedor' ? (r.contenedor ?? '—')
    : dim === 'marca' ? (r.marca || '(sin marca)')
    : `${r.marca || '(sin marca)'} ${r.modelo || ''}`.trim()
  const g = {}
  ykVMargen.forEach(r => {
    const k = keyOf(r); (g[k] = g[k] || { k, venta: 0, costo: 0, lineas: 0, n: 0 })
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
      <tbody>${rows.map(r => `<tr><td>${r.k}</td><td class="yk-num">${ykFmt0(r.lineas)}</td><td class="yk-num">${ykFmt(r.venta)}</td><td class="yk-num">${ykFmt(r.costo)}</td><td class="yk-num" style="color:${r.utilidad < 0 ? '#e06060' : 'inherit'}">${ykFmt(r.utilidad)}</td><td class="yk-num">${ykPct(r.pct)}</td></tr>`).join('')}
        <tr class="tot"><td>TOTAL</td><td class="yk-num"></td><td class="yk-num">${ykFmt(tV)}</td><td class="yk-num">${ykFmt(tC)}</td><td class="yk-num">${ykFmt(tU)}</td><td class="yk-num">${tC ? ykPct(tV / tC) : '—'}</td></tr>
      </tbody></table></div>`
  ykRepActual = { tipo: 'margen', dimLabel, rows: rows.map(r => ({ [dimLabel]: r.k, Items: r.lineas, Venta: r.venta, Costo: r.costo, Utilidad: r.utilidad, Pct_recuperado: r.pct })) }
}

window.ykExportReporte = () => {
  if (!ykRepActual || !ykRepActual.rows.length) { window.toast?.('Nada que exportar', 'info'); return }
  const ws = window.XLSX.utils.json_to_sheet(ykRepActual.rows)
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Reporte')
  const hoy = new Date().toLocaleDateString('en-CA')
  window.XLSX.writeFile(wb, `Yonker_${ykRepActual.tipo}_${ykRepActual.dimLabel}_${hoy}.xlsx`)
}