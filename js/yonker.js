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
      <button class="yk-tab" id="yk-tab-dev" onclick="ykTab('dev')">Devoluciones</button>
      <button class="yk-tab" id="yk-tab-exp" onclick="ykTab('exp')">Explorar</button>
    </div>
    <div id="yk-pane"></div>`
  ykTab('imp')
}

window.ykTab = (which) => {
  const ti = document.getElementById('yk-tab-imp'), tr = document.getElementById('yk-tab-rep'), td = document.getElementById('yk-tab-dev'), te = document.getElementById('yk-tab-exp')
  if (ti) ti.classList.toggle('active', which === 'imp')
  if (tr) tr.classList.toggle('active', which === 'rep')
  if (td) td.classList.toggle('active', which === 'dev')
  if (te) te.classList.toggle('active', which === 'exp')
  if (which === 'rep') ykRenderReportes()
  else if (which === 'dev') ykRenderDevoluciones()
  else if (which === 'exp') ykRenderExplorar()
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
    .yk-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:center;justify-content:center}
    .yk-modal{background:var(--bg2,#1c1c1c);border:1px solid var(--border,#3a3a3a);border-radius:12px;width:460px;max-width:92vw;max-height:90vh;overflow:auto}
    .yk-mhead{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border,#3a3a3a)}
    .yk-mhead button{background:none;border:none;color:var(--text3,#888);font-size:16px;cursor:pointer}
    .yk-link{background:none;border:none;color:var(--gold,#d4af37);cursor:pointer;text-decoration:underline;font:inherit;padding:0}
    .yk-link:hover{opacity:.8}
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
    if (!ykVRotacion) ykVRotacion = await ykFetchAll(() => ykSb().from('vw_yonker_rotacion').select('*').order('contenedor'))
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
      <div class="fld"><label>&nbsp;</label><button class="btn btn-ghost" onclick="ykExportReporte()">📥 Exportar Excel</button></div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-ghost" onclick="ykVResumen=null;ykVMargen=null;ykVRotacion=null;ykRenderReportes()">↻ Refrescar</button></div>
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
  const esRot = modo === 'rotacion'
  document.getElementById('yk-fld-anio').style.display = modo === 'ventas' ? '' : 'none'
  document.getElementById('yk-fld-marca').style.display = modo === 'ventas' ? '' : 'none'
  const dimFld = dimSel.closest('.fld'); if (dimFld) dimFld.style.display = esRot ? 'none' : ''
  if (esRot) { ykReporteRotacion(); return }
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
      <tbody>${rows.map(r => `<tr><td>${dim === 'contenedor' ? `<button class="yk-link" onclick="ykContenedorDetalle('${r.k}')">${r.k}</button>` : r.k}</td><td class="yk-num">${ykFmt0(r.lineas)}</td><td class="yk-num">${ykFmt(r.venta)}</td><td class="yk-num">${ykFmt(r.costo)}</td><td class="yk-num" style="color:${r.utilidad < 0 ? '#e06060' : 'inherit'}">${ykFmt(r.utilidad)}</td><td class="yk-num">${ykPct(r.pct)}</td></tr>`).join('')}
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
      <div class="yk-mhead"><b>📦 Contenedor ${contenedor} · ${unidades.length} unidades</b><button onclick="ykUniCerrar()">✕</button></div>
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
  try { ykUnidades = await ykFetchAll(() => ykSb().from('yonker_unidades').select('vehiculo_codigo,marca,modelo,anio_vehiculo').order('vehiculo_codigo')) }
  catch (e) { ykUnidades = [] }
  return ykUnidades
}
window.ykExpModelosDe = (marca) => {
  const us = ykUnidades || []
  const filt = marca ? us.filter(u => (u.marca || '') === marca) : us
  return [...new Set(filt.map(u => u.modelo).filter(Boolean))].sort()
}
window.ykExpMarcaChange = () => {
  const sel = document.getElementById('yk-exp-mod'); if (!sel) return
  const marca = document.getElementById('yk-exp-mar')?.value || ''
  const actual = sel.value
  const modelos = ykExpModelosDe(marca)
  sel.innerHTML = '<option value="">(todos)</option>' + modelos.map(m => `<option value="${String(m).replace(/"/g, '&quot;')}">${m}</option>`).join('')
  sel.value = modelos.includes(actual) ? actual : ''
}
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
  }
  const ad = document.getElementById('yk-exp-ad'); if (ad && !ad.value && u.anio_vehiculo) ad.value = u.anio_vehiculo
  const ah = document.getElementById('yk-exp-ah'); if (ah && !ah.value && u.anio_vehiculo) ah.value = u.anio_vehiculo
}
function ykRenderExplorar() {
  const pane = document.getElementById('yk-pane')
  if (!pane) return
  pane.innerHTML = `
    <div class="page-sub">Filtro 1: elegí unidades por <b>vehículo, marca, modelo y/o rango de años</b>. Filtro 2: dentro de eso, buscá un <b>producto</b> (ej. "motor"). Resultados por línea de venta.</div>
    <div class="yk-ctrl" style="margin:14px 0;align-items:flex-end">
      <div class="fld"><label>Vehículo (código)</label><input id="yk-exp-cod" type="text" style="width:120px" placeholder="ej. 126" onchange="ykExpAutofill()" onkeydown="if(event.key==='Enter')ykExplorar()"></div>
      <div class="fld"><label>Marca</label><select id="yk-exp-mar" style="width:150px" onchange="ykExpMarcaChange()"><option value="">(todas)</option></select></div>
      <div class="fld"><label>Modelo</label><select id="yk-exp-mod" style="width:160px"><option value="">(todos)</option></select></div>
      <div class="fld"><label>Año desde</label><input id="yk-exp-ad" type="number" style="width:95px" placeholder="2015"></div>
      <div class="fld"><label>Año hasta</label><input id="yk-exp-ah" type="number" style="width:95px" placeholder="2018"></div>
      <div class="fld"><label>Producto (filtro 2)</label><input id="yk-exp-prod" type="text" style="width:150px" placeholder="ej. motor" onkeydown="if(event.key==='Enter')ykExplorar()"></div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-gold" onclick="ykExplorar()">🔎 Buscar</button></div>
      <div class="fld"><label>&nbsp;</label><button class="btn btn-ghost" onclick="ykExplorarLimpiar()">Limpiar</button></div>
    </div>
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
  ['yk-exp-cod', 'yk-exp-mar', 'yk-exp-mod', 'yk-exp-ad', 'yk-exp-ah', 'yk-exp-prod'].forEach(id => { const e = document.getElementById(id); if (e) e.value = '' })
  if (window.ykExpMarcaChange) ykExpMarcaChange()
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
    if (cards) cards.innerHTML = `<div class="yk-cards">
      <div class="yk-card ok"><div class="v">${ykFmt(data.total_venta)}</div><div class="l">Venta filtrada (L.)</div></div>
      <div class="yk-card"><div class="v">${ykFmt0(data.total_lineas)}</div><div class="l">Líneas</div></div>
      <div class="yk-card" style="display:flex;align-items:center;justify-content:center"><button class="btn btn-ghost" onclick="ykExpExport()">📥 Exportar Excel</button></div></div>`
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
  if (!ykExpRows.length) { window.toast?.('Nada que exportar', 'info'); return }
  const ws = window.XLSX.utils.json_to_sheet(ykExpRows.map(l => ({
    Fecha: l.fecha, Vehiculo: l.vehiculo_codigo, Marca: l.marca, Modelo: l.modelo, Anio: l.anio_vehiculo,
    Producto: l.producto, Cantidad: l.cantidad, Venta: l.venta_hnl, Factura: l.factura, Cliente: l.cliente, Contenedor: l.contenedor
  })))
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Explorar')
  window.XLSX.writeFile(wb, `Yonker_Explorar_${new Date().toLocaleDateString('en-CA')}.xlsx`)
}