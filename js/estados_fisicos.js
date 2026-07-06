/* ══════════════════════════════════════════════════════════════════════
 * CONTAMAX · Estados Físicos (EFTM/IHTT) — ingesta y conciliación
 *  1) Ingerís el Excel de estados físicos -> upsert por 'revision' (fecha_subida).
 *  2) Conciliás subiendo el "Reporte de productos vendidos" (fecha+factura+placa):
 *     marca facturado por placa ±3 días de la fecha de subida.
 *  3) Las líneas facturadas SIN placa se concilian a mano (asignando el número).
 * ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict'
  const $ = (id) => document.getElementById(id)
  const sb = () => window._sb
  const toast = (m, t) => (window.toast ? window.toast(m, t) : console.log(m))
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n }
  const fmt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const cleanPlate = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '').trim()
  const findPlates = (s) => (String(s).toUpperCase().match(/[A-Z]{3}[\s\-]?[0-9]{4}/g) || []).map(p => p.replace(/[^A-Z0-9]/g, ''))
  const PLATE1 = /^[A-Z]{3}[0-9]{4}$/
  const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' })
  const fechaISO = (s) => { const m = String(s).trim().match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null }
  const daysDiff = (a, b) => { if (!a || !b) return 999; return Math.abs((new Date(a) - new Date(b)) / 86400000) }
  const CORTE_KEY = 'ef_fecha_corte'
  const getFechaCorte = () => { try { return localStorage.getItem(CORTE_KEY) || '2026-03-17' } catch (e) { return '2026-03-17' } }

  let ESTADO = null   // {total, facturados, pendientes, cerrados}
  let ALL = []        // todos los estados físicos
  let PEND = []       // pendientes (no facturado, no cerrado)
  let HUERFANAS = []  // repotenciaciones sin estado físico (EF borrado)
  let ULTIMA = null   // resultado de la última conciliación (para el panel)
  let ES_SUPER = false
  let _manualLinea = null

  function viewHTML () {
    return `
    <style>
      #view-estados-fisicos .ef-wrap{max-width:1080px;margin:0 auto}
      #view-estados-fisicos .ef-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:11px;margin:0 0 16px}
      #view-estados-fisicos .ef-stat{background:var(--bg2,#161b22);border:1px solid var(--border,#2a3340);border-radius:10px;padding:12px;text-align:center}
      #view-estados-fisicos .ef-stat .n{font-size:20px;font-weight:800}
      #view-estados-fisicos .ef-stat .l{font-size:11px;color:var(--text3,#8b949e);margin-top:2px}
      #view-estados-fisicos .ef-cards{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
      #view-estados-fisicos .form-card{background:var(--bg2,#161b22);border:1px solid var(--border,#2a3340);border-radius:12px;padding:16px}
      #view-estados-fisicos .form-card-title{font-weight:700;color:var(--gold,#c8a24a);margin-bottom:10px;text-transform:uppercase;font-size:12px;letter-spacing:.5px}
      #view-estados-fisicos input[type=file]{width:100%;font-size:13px;color:var(--text2,#c9d1d9);margin-bottom:8px}
      #view-estados-fisicos .btn{padding:8px 16px;border-radius:8px;border:1px solid var(--border,#2a3340);cursor:pointer;font-weight:600;background:var(--bg3,#1c2333);color:var(--text2,#c9d1d9)}
      #view-estados-fisicos .btn-gold{background:var(--gold,#c8a24a);color:#1a1a1a;border-color:var(--gold,#c8a24a)}
      #view-estados-fisicos .btn:disabled{opacity:.5;cursor:not-allowed}
      #view-estados-fisicos .ef-in{background:var(--bg3,#1c2333);border:1px solid var(--border,#2a3340);border-radius:6px;padding:6px 10px;color:var(--text1,#e6edf3);font-size:13px}
      #view-estados-fisicos .ef-info{font-size:12px;color:var(--text3,#8b949e);margin-top:6px;min-height:14px}
      #view-estados-fisicos .ef-grp{background:var(--bg2,#161b22);border:1px solid var(--border,#2a3340);border-radius:12px;padding:14px;margin-bottom:14px}
      #view-estados-fisicos .ef-grp-t{font-weight:700;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
      #view-estados-fisicos .ef-row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border,#2a3340);font-size:13px;align-items:center}
      #view-estados-fisicos .ef-plate{font-weight:700;font-family:monospace;letter-spacing:1px}
      @media (max-width:680px){#view-estados-fisicos .ef-cards{grid-template-columns:1fr}#view-estados-fisicos .ef-stats{grid-template-columns:repeat(2,1fr)}}
    </style>
    <div class="ef-wrap">
      <div id="ef-stats" class="ef-stats"></div>
      <div class="ef-cards">
        <div class="form-card">
          <div class="form-card-title">1 · Ingerir estados físicos (EFTM/IHTT)</div>
          <input type="file" id="ef-file-ef" accept=".xlsx,.xls">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label style="font-size:12px;color:var(--text3,#8b949e)">Fecha de subida:</label>
            <input type="date" id="ef-fecha" class="ef-in" value="${hoy()}">
            <button class="btn btn-gold" id="ef-subir" disabled>Subir →</button>
          </div>
          <div id="ef-info-ef" class="ef-info"></div>
        </div>
        <div class="form-card">
          <div class="form-card-title">2 · Subir ventas y conciliar (productos vendidos)</div>
          <input type="file" id="ef-file-ve" accept=".xlsx,.xls">
          <button class="btn btn-gold" id="ef-conciliar" disabled>Conciliar →</button>
          <div id="ef-info-ve" class="ef-info"></div>
        </div>
      </div>
      <div class="form-card" style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:12px;color:var(--text3,#8b949e)">Corte — Estados físicos N° &lt;</span>
          <input type="number" id="ef-cerrar-num" class="ef-in" placeholder="1951" style="width:90px">
          <span style="font-size:12px;color:var(--text3,#8b949e)">· Repotenciación N° &lt;</span>
          <input type="number" id="ef-cerrar-repot" class="ef-in" placeholder="542" style="width:90px">
          <button class="btn" id="ef-cerrar-btn">Marcar cerrados →</button>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--text3,#8b949e)">Sugerir corte repot. desde CSV (formulario):</span>
          <input type="file" id="ef-csv" accept=".csv" style="max-width:220px">
          <span id="ef-csv-info" style="font-size:12px;color:var(--gold,#c8a24a)"></span>
          <span style="font-size:12px;color:var(--text3,#8b949e);margin-left:12px">Fecha de corte ventas s/placa:</span>
          <input type="date" id="ef-fecha-corte" class="ef-in" style="width:150px">
        </div>
      </div>
      <div style="text-align:center;margin:0 0 14px"><button class="btn btn-gold" id="ef-conc-guardado">🔄 Conciliar pendientes con datos guardados</button> <button class="btn" id="ef-export">⬇ Exportar Excel</button></div>
      <div id="ef-result"></div>
    </div>

    <!-- Modal conciliación manual (sin placa) -->
    <div class="modal-backdrop" id="ef-modal">
      <div class="modal" style="width:520px;max-width:94vw">
        <div class="modal-title">Conciliar venta con un estado físico</div>
        <div style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:8px">Esta venta se facturó sin placa clara. Elegí a qué estado físico pendiente corresponde:</div>
        <div id="ef-modal-linea" style="font-size:13px;margin-bottom:10px;padding:8px 10px;background:var(--bg3,#1c2333);border-radius:6px"></div>
        <div id="ef-modal-yacon" style="margin-bottom:8px"></div>
        <div id="ef-modal-sug" style="margin-bottom:8px"></div>
        <div class="fld"><label>…o escribí el N° de estado físico</label>
          <input id="ef-modal-num" class="ef-in" type="number" placeholder="ej. 2480" style="width:100%"></div>
        <div id="ef-modal-hint" style="font-size:12px;margin-top:8px;min-height:16px"></div>
        <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
          <button class="btn" id="ef-modal-cancel">Cancelar</button>
          <button class="btn btn-gold" id="ef-modal-ok">Marcar facturado</button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="ef-pmodal">
      <div class="modal" style="width:480px;max-width:94vw">
        <div class="modal-title">Conciliar pendiente con una factura</div>
        <div id="ef-pmodal-info" style="font-size:13px;margin-bottom:10px;padding:8px 10px;background:var(--bg3,#1c2333);border-radius:6px"></div>
        <div class="fld"><label>N° de factura donde se cobró (aunque la placa esté mal escrita)</label>
          <input id="ef-pmodal-fact" class="ef-in" placeholder="ej. 84858" style="width:100%"></div>
        <div id="ef-pmodal-hint" style="font-size:12px;margin-top:8px;min-height:16px"></div>
        <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
          <button class="btn" id="ef-pmodal-cancel">Cancelar</button>
          <div style="display:flex;gap:8px">
            <button class="btn" id="ef-pmodal-anular" style="display:none;color:var(--red,#f85149);border-color:var(--red,#f85149)">Anular sin factura</button>
            <button class="btn btn-gold" id="ef-pmodal-ok">Marcar facturado</button>
          </div>
        </div>
      </div>
    </div>`
  }

  window.initEstadosFisicos = function () {
    const v = $('view-estados-fisicos')
    if (!v) return
    if (!v.dataset.built) { v.innerHTML = viewHTML(); v.dataset.built = '1'; wire() }
    const prof = window._currentProfile ? window._currentProfile() : null
    ES_SUPER = !!(prof && (prof.rol === 'super_admin' || prof.rol === 'superadmin'))
    cargarEstado()
  }

  function wire () {
    $('ef-file-ef').addEventListener('change', e => { $('ef-subir').disabled = !e.target.files[0] })
    $('ef-subir').addEventListener('click', subirEstados)
    $('ef-file-ve').addEventListener('change', e => { $('ef-conciliar').disabled = !e.target.files[0] })
    $('ef-conciliar').addEventListener('click', conciliarVentas)
    $('ef-conc-guardado').addEventListener('click', conciliarGuardado)
    $('ef-cerrar-btn').addEventListener('click', cerrarHasta)
    $('ef-pmodal-cancel').addEventListener('click', () => $('ef-pmodal').classList.remove('open'))
    $('ef-pmodal-ok').addEventListener('click', aplicarConciliarPlaca)
    $('ef-pmodal-anular').addEventListener('click', anularPendiente)
    let dpf; $('ef-pmodal-fact').addEventListener('input', () => { clearTimeout(dpf); dpf = setTimeout(hintConciliarPlaca, 300) })
    $('view-estados-fisicos').addEventListener('click', (e) => { const p = e.target.closest('[data-pconc]'); if (p) abrirConciliarPlaca(p.dataset.pconc) })
    $('ef-export').addEventListener('click', exportarExcel)
    $('ef-csv').addEventListener('change', e => { if (e.target.files[0]) sugerirCorte(e.target.files[0]) })
    const fc = $('ef-fecha-corte')
    if (fc) { fc.value = getFechaCorte(); fc.addEventListener('change', e => { try { localStorage.setItem(CORTE_KEY, e.target.value) } catch (x) {} }) }
    $('ef-modal-cancel').addEventListener('click', () => $('ef-modal').classList.remove('open'))
    $('ef-modal-ok').addEventListener('click', aplicarManual)
    $('ef-modal-num').addEventListener('input', hintManual)
  }

  function leerXlsx (file, cb) {
    if (!window.XLSX) { toast('Falta la librería XLSX', 'error'); return }
    const r = new FileReader()
    r.onload = (e) => { try { cb(window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' })) } catch (err) { console.error('[EF xlsx]', err); toast('No se pudo leer el archivo', 'error') } }
    r.readAsArrayBuffer(file)
  }

  async function fetchAll (query) {
    const out = []; let from = 0; const step = 1000
    for (let i = 0; i < 30; i++) {
      const { data, error } = await query.range(from, from + step - 1)
      if (error) throw error
      out.push(...(data || []))
      if (!data || data.length < step) break
      from += step
    }
    return out
  }

  async function cargarEstado () {
    const st = $('ef-stats')
    try {
      const rows = await fetchAll(sb().from('estados_fisicos').select('id,numero,revision,placa_norm,propietario,tipo,servicio,categoria,fecha_subida,facturado,cerrado,descartado,conciliado_manual,fecha_factura,factura_ref,monto').order('numero', { ascending: true }))
      ALL = rows
      const fact = rows.filter(r => r.facturado)
      const cerr = rows.filter(r => r.cerrado && !r.facturado)
      const desc = rows.filter(r => r.descartado && !r.facturado)
      PEND = rows.filter(r => !r.facturado && !r.cerrado && !r.descartado)
      const factEF = fact.filter(r => r.categoria === 'estado_fisico')
      const suma = factEF.reduce((a, r) => a + (Number(r.monto) || 0), 0)
      const prom = factEF.length ? suma / factEF.length : 0
      ESTADO = { total: rows.length, facturados: fact.length, pendientes: PEND.length, cerrados: cerr.length, descartados: desc.length }
      const card = (n, l, color, sub) => `<div class="ef-stat"><div class="n" style="color:${color}">${n}</div><div class="l">${l}</div>${sub ? `<div class="l" style="color:${color};margin-top:2px">${sub}</div>` : ''}</div>`
      st.innerHTML =
        card(rows.length, 'Estados físicos', 'var(--text1,#e6edf3)') +
        card(fact.length, 'Facturados', 'var(--green,#16a34a)', `L. ${fmt(suma)} · prom L. ${fmt(prom)}`) +
        card(PEND.length, 'Pendientes de facturar', 'var(--amber,#f59e0b)') +
        card(PEND.filter(r => r.categoria === 'repotenciacion').length, 'Repotenciación pend.', 'var(--text3,#8b949e)') +
        card(cerr.length, 'Cerrados', 'var(--text3,#8b949e)') +
        card(desc.length, 'Descartados (sin cobro)', 'var(--red,#f85149)')
      if (!ULTIMA) renderPendientes()
    } catch (e) { console.error('[EF estado]', e); st.innerHTML = `<div style="color:var(--red,#f85149)">Error: ${esc(e.message || e)}</div>` }
  }

  // ── 1) INGESTA de estados físicos ──
  function subirEstados () {
    const file = $('ef-file-ef').files[0]; if (!file) return
    const fsub = $('ef-fecha').value || hoy()
    $('ef-subir').disabled = true; $('ef-info-ef').textContent = 'Leyendo…'
    leerXlsx(file, async (wb) => {
      const rows = []; const vistas = new Set()
      wb.SheetNames.forEach(sh => {
        const U = sh.toUpperCase()
        const categoria = U.includes('REPOT') ? 'repotenciacion' : (U.includes('FISIC') ? 'estado_fisico' : 'estado_fisico')
        const data = window.XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, defval: '' })
        data.forEach(row => {
          const pl = cleanPlate(row[4])
          if (!PLATE1.test(pl)) return
          const rev = String(row[1] || '').trim() || null
          const key = rev || (pl + '|' + String(row[0] || ''))
          if (vistas.has(key)) return; vistas.add(key)
          rows.push({
            numero: parseInt(String(row[0]).replace(/[^0-9]/g, ''), 10) || null,
            revision: rev, placa: String(row[4] || '').trim().toUpperCase(), placa_norm: pl,
            servicio: String(row[2] || '').trim(), tipo: String(row[3] || '').trim(),
            propietario: String(row[5] || '').trim(), resultado: String(row[6] || '').trim(),
            categoria, fecha_subida: fsub, origen: 'excel_eftm'
          })
        })
      })
      if (!rows.length) { $('ef-info-ef').textContent = 'No se encontraron placas válidas.'; $('ef-subir').disabled = false; return }
      try {
        let nuevos = 0
        for (let i = 0; i < rows.length; i += 500) {
          const lote = rows.slice(i, i + 500)
          const { data, error } = await sb().from('estados_fisicos').upsert(lote, { onConflict: 'revision', ignoreDuplicates: true }).select('id')
          if (error) throw error
          nuevos += (data ? data.length : 0)
        }
        $('ef-info-ef').textContent = `✓ ${rows.length} leídos · ${nuevos} nuevos ingresados (fecha ${fsub}) · ${rows.length - nuevos} ya existían`
        toast(`${nuevos} estados físicos nuevos`, 'success')
        ULTIMA = null; await cargarEstado()
      } catch (e) { console.error('[EF subir]', e); $('ef-info-ef').textContent = 'Error: ' + (e.message || e); toast('Error al subir', 'error') }
      $('ef-subir').disabled = false
    })
  }

  // ── 2) CONCILIACIÓN con productos vendidos ──
  function conciliarVentas () {
    const file = $('ef-file-ve').files[0]; if (!file) return
    $('ef-conciliar').disabled = true; $('ef-info-ve').textContent = 'Leyendo…'
    leerXlsx(file, async (wb) => {
      // parsear TODAS las líneas del reporte (para guardarlas) + las de estado físico (para conciliar)
      const pvRows = []; const lineas = []
      const data = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
      data.forEach(row => {
        const fecha = fechaISO(row[0]); if (!fecha) return   // saltea encabezado/títulos
        const codp = String(row[6] || '').toUpperCase(); const prod = String(row[8] || '').toUpperCase()
        const esEF = codp.includes('ESTADO F') || prod.includes('ESTADO F') || codp.includes('REPOTENCIA') || prod.includes('REPOTENCIA')
        const placas = esEF ? findPlates(prod) : []
        const rec = {
          fecha, no_factura: String(row[1] || '').trim(), no_consecutivo: String(row[2] || '').trim(),
          cajero: String(row[3] || '').trim(), ced_cliente: String(row[4] || '').trim(), cliente: String(row[5] || '').trim(),
          cod_producto: String(row[6] || '').trim(), cod_cabys: String(row[7] || '').trim(), producto: String(row[8] || '').trim(),
          moneda: String(row[9] || '').trim(), costo: num(row[10]), cantidad: num(row[11]), precio_sin_iva: num(row[12]),
          iva_pct: String(row[13] || '').trim(), precio_con_iva: num(row[14]), total: num(row[15]),
          marca: String(row[16] || '').trim(), categoria: String(row[17] || '').trim(), sub_categoria: String(row[18] || '').trim(),
          proveedor: String(row[19] || '').trim(), es_estado_fisico: esEF, placa_norm: placas[0] || null, origen: 'excel_prod_vendidos'
        }
        pvRows.push(rec)
        if (esEF) lineas.push({ fecha, factura: rec.no_factura, producto: rec.producto, placas, monto: rec.total || rec.precio_con_iva })
      })
      if (!pvRows.length) { $('ef-info-ve').textContent = 'No se encontraron líneas en el reporte.'; $('ef-conciliar').disabled = false; return }

      try {
        // 1) Guardar TODAS las líneas en el histórico (dedup por linea_hash)
        let guardados = 0
        for (let i = 0; i < pvRows.length; i += 500) {
          const { data: d, error } = await sb().from('productos_vendidos').upsert(pvRows.slice(i, i + 500), { onConflict: 'linea_hash', ignoreDuplicates: true }).select('id')
          if (error) throw error
          guardados += (d ? d.length : 0)
        }
        // 2) Conciliar las líneas de estado físico contra los pendientes
        const R = await conciliarLineas(lineas)
        $('ef-info-ve').textContent = `✓ ${guardados} líneas nuevas guardadas · ${R.conciliados.length} conciliados · ${R.sinMatch.length} sin estado físico · ${R.sinPlaca.length} sin placa`
        toast(`${R.conciliados.length} conciliados`, 'success')
      } catch (e) { console.error('[EF conciliar]', e); $('ef-info-ve').textContent = 'Error: ' + (e.message || e); toast('Error al conciliar', 'error') }
      $('ef-conciliar').disabled = false
    })
  }

  // Núcleo de conciliación: por cada línea con placa marca UN estado físico Y
  // UNA repotenciación de esa placa (misma factura — la repot. se deriva del EF).
  async function conciliarLineas (lineas) {
    await cargarEstado()
    const byActivo = {}; const byCerrado = {}
    ALL.filter(e => !e.descartado).forEach(e => { const m = e.cerrado ? byCerrado : byActivo; (m[e.placa_norm] = m[e.placa_norm] || []).push(e) })
    Object.values(byActivo).forEach(a => a.sort((x, y) => (x.numero || 0) - (y.numero || 0)))
    Object.values(byCerrado).forEach(a => a.sort((x, y) => (x.numero || 0) - (y.numero || 0)))
    // E.Físico conciliados a mano por factura (placas mal escritas que no están en la descripción): suman al total
    const manualCount = {}
    ALL.filter(e => e.conciliado_manual && e.categoria === 'estado_fisico' && e.factura_ref)
      .forEach(e => { manualCount[e.factura_ref] = (manualCount[e.factura_ref] || 0) + 1 })
    const usados = new Set(); const updates = []; const conciliados = []; const sinMatch = []; const sinPlaca = []
    const fCorte = getFechaCorte()
    const preCorte = (l) => fCorte && l.fecha && l.fecha < fCorte
    lineas.forEach(l => {
      if (!l.placas.length) {
        if (preCorte(l)) return
        if (/CANCELAC|ABONO|PAGO PENDIENTE|CUENTA PENDIENTE/.test(String(l.producto).toUpperCase())) return
        sinPlaca.push(l); return
      }
      const N = l.placas.length + (manualCount[l.factura] || 0)   // placas de la descripción + conciliadas a mano
      const prorat = N ? Math.round((l.monto / N) * 100) / 100 : l.monto
      let algo = false
      l.placas.forEach(pl => {
        let reabrir = false
        let cands = (byActivo[pl] || []).filter(e => !usados.has(e.id) && !e.conciliado_manual)
        if (!cands.length && preCorte(l)) { cands = (byCerrado[pl] || []).filter(e => !usados.has(e.id) && !e.conciliado_manual); reabrir = true }
        if (!cands.length) return
        ;['estado_fisico', 'repotenciacion'].forEach(cat => {
          const cc = cands.filter(e => e.categoria === cat && !usados.has(e.id))
          if (!cc.length) return
          const pick = cc.find(e => daysDiff(l.fecha, e.fecha_subida) <= 3) || cc[0]
          usados.add(pick.id); algo = true
          const upd = { id: pick.id, facturado: true, fecha_factura: l.fecha, factura_ref: l.factura, monto: prorat, factura_compartida: N > 1, placas_linea: N, monto_linea: l.monto }
          if (reabrir) upd.cerrado = false
          updates.push(upd)
          conciliados.push({ numero: pick.numero, placa: pl, categoria: pick.categoria, propietario: pick.propietario, fecha: l.fecha, factura: l.factura, monto: prorat, compartida: N > 1, placas_linea: N, monto_linea: l.monto })
        })
      })
      if (!algo) sinMatch.push(l)
    })
    for (let i = 0; i < updates.length; i += 500) {
      const { error } = await sb().from('estados_fisicos').upsert(updates.slice(i, i + 500))
      if (error) throw error
    }
    // incluir los conciliados a mano (facturados que no matchean ninguna línea, ej. placa mal escrita)
    const yaEnLista = new Set(conciliados.map(c => c.numero + '|' + c.placa))
    ALL.filter(e => e.facturado && e.conciliado_manual && !e.descartado).forEach(e => {
      const k = e.numero + '|' + e.placa_norm
      if (!yaEnLista.has(k)) { yaEnLista.add(k); conciliados.push({ numero: e.numero, placa: e.placa_norm, categoria: e.categoria, propietario: e.propietario, fecha: e.fecha_factura, factura: e.factura_ref, monto: e.monto, compartida: (e.placas_linea || 1) > 1, placas_linea: e.placas_linea || 1, monto_linea: e.monto_linea || e.monto }) }
    })
    ULTIMA = { conciliados, sinMatch, sinPlaca }
    await cargarEstado(); renderResultado()
    return ULTIMA
  }

  // Conciliar usando lo YA guardado en productos_vendidos (sin resubir)
  async function conciliarGuardado () {
    const btn = $('ef-conc-guardado'); if (btn) { btn.disabled = true; btn.textContent = 'Conciliando…' }
    try {
      const pv = await fetchAll(sb().from('productos_vendidos').select('fecha,no_factura,producto,total,precio_con_iva').eq('es_estado_fisico', true).order('fecha', { ascending: true }))
      const lineas = pv.map(r => ({ fecha: r.fecha, factura: r.no_factura, producto: r.producto, placas: findPlates(String(r.producto).toUpperCase()), monto: r.total || r.precio_con_iva }))
      const R = await conciliarLineas(lineas)
      toast(`${R.conciliados.length} conciliados`, 'success')
    } catch (e) { console.error('[EF conc guardado]', e); toast('Error: ' + (e.message || e), 'error') }
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Conciliar pendientes con datos guardados' }
  }

  // Sugerir el N° de corte de repotenciación: toma las primeras 50 placas del CSV
  // (las más viejas, del 17/03/2026) y busca el menor N° donde aparecen en repotenciación.
  function cortePorGap (nums) {
    if (!nums.length) return ''
    if (nums.length < 4) return nums[0]
    let maxGap = -1; let corte = nums[0]
    for (let i = 1; i < nums.length; i++) { const g = nums[i] - nums[i - 1]; if (g > maxGap) { maxGap = g; corte = nums[i] } }
    return corte
  }

  function sugerirCorte (file) {
    const info = $('ef-csv-info'); info.textContent = 'Leyendo…'
    const r = new FileReader()
    r.onload = async (e) => {
      try {
        const lineas = String(e.target.result).split(/\r?\n/)
        const ref = []
        for (let i = 1; i < lineas.length && ref.length < 50; i++) {
          const cols = lineas[i].split(','); const pl = cleanPlate(cols[2] || '')
          if (PLATE1.test(pl)) ref.push(pl)
        }
        const refSet = new Set(ref)
        const rows = await fetchAll(sb().from('estados_fisicos').select('numero,placa_norm,categoria').in('categoria', ['repotenciacion', 'estado_fisico']))
        const numsRe = rows.filter(x => x.categoria === 'repotenciacion' && refSet.has(x.placa_norm) && x.numero).map(x => x.numero).sort((a, b) => a - b)
        const numsEF = rows.filter(x => x.categoria === 'estado_fisico' && refSet.has(x.placa_norm) && x.numero).map(x => x.numero).sort((a, b) => a - b)
        const corteRe = cortePorGap(numsRe)                       // cluster denso (salto más grande)
        const corteEF = numsEF.length ? numsEF[0] : ''            // estados físicos: consecutivos -> el mínimo
        if (corteRe) $('ef-cerrar-repot').value = corteRe
        if (corteEF) $('ef-cerrar-num').value = corteEF
        info.textContent = `${ref.length} placas ref · EF corte N° ${corteEF || '—'} · Repot corte N° ${corteRe || '—'} (${numsRe.length} coincid.)`
      } catch (err) { console.error('[EF csv]', err); info.textContent = 'Error al leer el CSV' }
    }
    r.readAsText(file)
  }

  // Cierre administrativo por N°: EF < numEF y repotenciación < numRepot se cierran.
  // Las repotenciaciones que quedan (>= corte) sin estado físico son HUÉRFANAS (a justificar).
  async function cerrarHasta () {
    const numEF = parseInt($('ef-cerrar-num').value, 10)
    const numRepot = parseInt($('ef-cerrar-repot').value, 10)
    if (!numEF && !numRepot) { toast('Ingresá al menos un N° de corte', 'error'); return }
    if (!confirm(`¿Marcar como CERRADOS los estados físicos con N° < ${numEF || '—'} y las repotenciaciones con N° < ${numRepot || '—'}? No se podrán conciliar.`)) return
    const btn = $('ef-cerrar-btn'); btn.disabled = true; btn.textContent = 'Cerrando…'
    try {
      if (numEF) {
        const { error } = await sb().from('estados_fisicos').update({ cerrado: true }).eq('categoria', 'estado_fisico').lt('numero', numEF).eq('facturado', false).eq('cerrado', false)
        if (error) throw error
      }
      if (numRepot) {
        const { error } = await sb().from('estados_fisicos').update({ cerrado: true }).eq('categoria', 'repotenciacion').lt('numero', numRepot).eq('facturado', false).eq('cerrado', false)
        if (error) throw error
      }
      // recalcular huérfanas: repotenciaciones pendientes (>= corte) cuya placa no tiene estado físico
      const all = await fetchAll(sb().from('estados_fisicos').select('id,numero,placa_norm,propietario,categoria,facturado,cerrado'))
      const efPlate = new Set(all.filter(e => e.categoria === 'estado_fisico').map(e => e.placa_norm))
      HUERFANAS = all.filter(e => e.categoria === 'repotenciacion' && !e.facturado && !e.cerrado && !efPlate.has(e.placa_norm))
      toast(`Cerrado hasta EF #${numEF || '—'} / Repot #${numRepot || '—'} · ${HUERFANAS.length} huérfanas`, 'success')
      await cargarEstado(); renderResultado()
    } catch (e) { console.error('[EF cerrar]', e); toast('Error: ' + (e.message || e), 'error') }
    btn.disabled = false; btn.textContent = 'Marcar cerrados →'
  }

  function huerfanasHTML () {
    if (!HUERFANAS || !HUERFANAS.length) return ''
    return `<div class="ef-grp" style="border-color:var(--red,#f85149)">
      <div class="ef-grp-t" style="color:var(--red,#f85149)">⚠ Repotenciaciones huérfanas (${HUERFANAS.length}) — su estado físico fue borrado <input class="ef-filter ef-in" data-target="ef-list-huerf" placeholder="🔍 placa/N°…" style="width:180px;text-transform:uppercase"></div>
      <div id="ef-list-huerf" style="max-height:220px;overflow:auto">${HUERFANAS.map(r => `<div class="ef-row"><span>#${r.numero || '—'} · <span class="ef-plate">${esc(r.placa_norm)}</span></span><span style="color:var(--text3,#8b949e)">${esc(r.propietario || '')}</span></div>`).join('')}</div></div>`
  }

  let _pconcPlaca = null
  function abrirConciliarPlaca (placa) {
    _pconcPlaca = placa
    const items = PEND.filter(e => e.placa_norm === placa)
    const cats = items.map(x => x.categoria)
    const label = (cats.includes('estado_fisico') && cats.includes('repotenciacion')) ? 'E.Físico + Repot.' : (cats.includes('repotenciacion') ? 'Repot.' : 'E.Físico')
    const nums = items.map(x => x.numero).filter(n => n).sort((a, b) => a - b)
    const tipo = (items.find(x => x.tipo) || {}).tipo || ''
    $('ef-pmodal-info').innerHTML = `<span class="ef-plate">${esc(placa)}</span> · ${esc(label)}${tipo ? ` · <span style="color:var(--gold,#c8a24a)">${esc(tipo)}</span>` : ''}${nums.length ? ' · #' + nums.join('/') : ''} · ${esc(items[0] && items[0].propietario || '')}`
    $('ef-pmodal-fact').value = ''; $('ef-pmodal-hint').textContent = ''
    const btnA = $('ef-pmodal-anular'); if (btnA) btnA.style.display = ES_SUPER ? '' : 'none'
    $('ef-pmodal').classList.add('open')
    setTimeout(() => $('ef-pmodal-fact').focus(), 120)
  }

  // Solo super_admin: saca un pendiente de la lista SIN factura (no se cobró: repetido/error/baja).
  async function anularPendiente () {
    if (!ES_SUPER) { toast('Solo super_admin puede anular sin factura', 'error'); return }
    const items = PEND.filter(e => e.placa_norm === _pconcPlaca)
    if (!items.length) { toast('Esta placa ya no está pendiente', 'error'); return }
    const motivo = prompt('Motivo por el que NO se facturó (ej. repetido por error, no se cobró, unidad de baja):')
    if (motivo === null) return
    if (!String(motivo).trim()) { toast('Ingresá un motivo', 'error'); return }
    try {
      const prof = window._currentProfile ? window._currentProfile() : null
      const por = prof ? (prof.nombre || prof.email || '') : ''
      const { error } = await sb().from('estados_fisicos').update({ descartado: true, motivo_descarte: String(motivo).trim(), descartado_por: por, fecha_descarte: new Date().toISOString(), monto: 0 }).in('id', items.map(e => e.id))
      if (error) throw error
      $('ef-pmodal').classList.remove('open')
      toast(`Descartado (${items.length}) · ${String(motivo).trim().slice(0, 40)}`, 'success')
      await cargarEstado(); renderResultado()
    } catch (e) { console.error('[EF anular]', e); toast('Error: ' + (e.message || e), 'error') }
  }

  async function facturaResumen (factura, incluirNuevo) {
    const { data } = await sb().from('productos_vendidos').select('producto,fecha,total,precio_con_iva').eq('no_factura', factura).eq('es_estado_fisico', true)
    if (!data || !data.length) return null
    let descPlacas = 0; let montoTotal = 0; let fecha = null
    data.forEach(r => { descPlacas += (findPlates(String(r.producto).toUpperCase()).length || 1); montoTotal += (Number(r.total) || Number(r.precio_con_iva) || 0); if (!fecha) fecha = r.fecha })
    const manualYa = ALL.filter(e => e.conciliado_manual && e.categoria === 'estado_fisico' && String(e.factura_ref) === String(factura)).length
    const totPlacas = descPlacas + manualYa + (incluirNuevo ? 1 : 0)
    const prorat = totPlacas ? Math.round(montoTotal / totPlacas * 100) / 100 : montoTotal
    return { descPlacas, manualYa, totPlacas, montoTotal, fecha, prorat }
  }

  async function hintConciliarPlaca () {
    const factura = $('ef-pmodal-fact').value.trim()
    const h = $('ef-pmodal-hint')
    if (!factura) { h.textContent = ''; return }
    try {
      const r = await facturaResumen(factura, true)
      if (!r) { h.style.color = 'var(--red,#f85149)'; h.textContent = 'No se encontró esa factura con estados físicos.'; return }
      h.style.color = 'var(--green,#16a34a)'
      h.textContent = `Factura ${factura}: quedará en ${r.totPlacas} estados físicos · total L. ${fmt(r.montoTotal)} · ${r.fecha} → L. ${fmt(r.prorat)} c/u`
    } catch (e) { h.textContent = '' }
  }

  async function aplicarConciliarPlaca () {
    const factura = $('ef-pmodal-fact').value.trim()
    if (!factura) { toast('Ingresá el N° de factura', 'error'); return }
    try {
      const r = await facturaResumen(factura, true)
      if (!r) { toast('No se encontró esa factura con estados físicos', 'error'); return }
      const items = PEND.filter(e => e.placa_norm === _pconcPlaca)
      if (!items.length) { toast('Esta placa ya no está pendiente', 'error'); return }
      const ids = items.map(e => e.id)
      // 1) marcar los pendientes de esta placa como facturados a mano
      let resp = await sb().from('estados_fisicos').update({ facturado: true, fecha_factura: r.fecha, factura_ref: factura, conciliado_manual: true }).in('id', ids)
      if (resp.error) throw resp.error
      // 2) re-prorratear TODA la factura con el nuevo total de placas → todos a L. prorat
      resp = await sb().from('estados_fisicos').update({ monto: r.prorat, placas_linea: r.totPlacas, monto_linea: r.montoTotal, factura_compartida: r.totPlacas > 1 }).eq('factura_ref', factura)
      if (resp.error) throw resp.error
      // 3) reflejarlo en la vista de Conciliados sin re-conciliar
      if (ULTIMA && Array.isArray(ULTIMA.conciliados)) {
        ULTIMA.conciliados.forEach(c => { if (String(c.factura) === String(factura)) { c.monto = r.prorat; c.placas_linea = r.totPlacas; c.monto_linea = r.montoTotal; c.compartida = r.totPlacas > 1 } })
        items.forEach(e => ULTIMA.conciliados.push({ numero: e.numero, placa: e.placa_norm, categoria: e.categoria, propietario: e.propietario, fecha: r.fecha, factura, monto: r.prorat, compartida: r.totPlacas > 1, placas_linea: r.totPlacas, monto_linea: r.montoTotal }))
      }
      // sacar esa factura de "con placa que NO está entre los pendientes" (ya quedó conciliada a mano)
      if (ULTIMA && Array.isArray(ULTIMA.sinMatch)) ULTIMA.sinMatch = ULTIMA.sinMatch.filter(l => String(l.factura) !== String(factura))
      $('ef-pmodal').classList.remove('open')
      toast(`Conciliado · factura ${factura} ahora ${r.totPlacas} estados físicos · L. ${fmt(r.prorat)} c/u`, 'success')
      await cargarEstado(); renderResultado()
    } catch (e) { console.error('[EF conc placa]', e); toast('Error: ' + (e.message || e), 'error') }
  }

  function exportarExcel () {
    if (!window.XLSX) { toast('Falta la librería XLSX', 'error'); return }
    const wb = window.XLSX.utils.book_new()
    const add = (name, rows) => { const ws = window.XLSX.utils.json_to_sheet(rows.length ? rows : [{ vacio: '' }]); window.XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)) }
    const fC = getFechaCorte()
    add('Pendientes', pendAgrupados().map(g => ({ Placa: g.placa, Categoria: g.label, Tipo: g.tipo, Numeros: g.nums.join('/'), Propietario: g.propietario })))
    if (ULTIMA) {
      add('Sin placa', ULTIMA.sinPlaca.map(l => ({ Producto: l.producto, Factura: l.factura, Fecha: l.fecha, Monto: l.monto })))
      add('Revisar (no pendiente)', ULTIMA.sinMatch.map(l => ({ Producto: l.producto, Placa: (l.placas || []).join(','), Factura: l.factura, Fecha: l.fecha, Monto: l.monto, Revisar: (fC && l.fecha && l.fecha >= fC) ? 'SI' : '' })))
      add('Conciliados', ULTIMA.conciliados.map(c => ({ Numero: c.numero, Placa: c.placa, Tipo: c.categoria === 'repotenciacion' ? 'Repot.' : 'E.Fisico', Propietario: c.propietario, Factura: c.factura, Fecha: c.fecha, Monto: c.monto, Total_linea: c.monto_linea, Compartida: c.compartida ? 'SI' : '' })))
    }
    add('Huerfanas', HUERFANAS.map(r => ({ Numero: r.numero, Placa: r.placa_norm, Propietario: r.propietario })))
    window.XLSX.writeFile(wb, `estados_fisicos_${hoy()}.xlsx`)
    toast('Excel exportado', 'success')
  }

  function wireFilters () {
    document.querySelectorAll('#view-estados-fisicos .ef-filter').forEach(inp => {
      inp.oninput = () => {
        const t = inp.value.trim().toUpperCase()
        const list = document.getElementById(inp.dataset.target); if (!list) return
        Array.from(list.children).forEach(row => { row.style.display = (!t || row.textContent.toUpperCase().includes(t)) ? '' : 'none' })
      }
    })
  }

  function renderResultado () {
    if (!ULTIMA) { renderPendientes(); return }
    const R = ULTIMA
    const fCorte = getFechaCorte()
    const filtro = (target) => `<input class="ef-filter ef-in" data-target="${target}" placeholder="🔍 placa/N°/factura…" style="width:200px;text-transform:uppercase">`
    const gSinPlaca = R.sinPlaca.length ? `<div class="ef-grp" style="border-color:var(--red,#f85149)">
      <div class="ef-grp-t" style="color:var(--red,#f85149)">⚠ Facturados SIN placa (${R.sinPlaca.length}) — asignales el N° a mano ${filtro('ef-list-sinplaca')}</div>
      <div id="ef-list-sinplaca" style="max-height:300px;overflow:auto">${R.sinPlaca.map((l, i) => `<div class="ef-row"><span>${esc(l.producto)} · <span style="color:var(--text3,#8b949e)">F${esc(l.factura)} · ${esc(l.fecha || '')}</span></span>
        <span style="display:flex;gap:10px;align-items:center;flex-shrink:0"><b style="color:var(--gold,#c8a24a)">L. ${fmt(l.monto)}</b><button class="btn" data-manual="${i}" style="font-size:11px;padding:3px 10px">Conciliar</button></span></div>`).join('')}</div>
    </div>` : ''
    const grupos = {}
    R.conciliados.forEach(c => { const k = `${c.factura}|${c.monto_linea}`; (grupos[k] = grupos[k] || []).push(c) })
    const grpArr = Object.values(grupos)
    const gConc = `<div class="ef-grp"><div class="ef-grp-t" style="color:var(--green,#16a34a)">✓ Conciliados (${R.conciliados.length}) · ${grpArr.length} facturas ${filtro('ef-list-conc')}</div>
      <div id="ef-list-conc" style="max-height:360px;overflow:auto">${grpArr.slice(0, 400).map(items => {
        const c0 = items[0]
        const efCount = c0.placas_linea || items.filter(x => x.categoria !== 'repotenciacion').length
        const head = c0.compartida ? `<div style="font-size:11px;color:var(--amber,#f59e0b);margin-bottom:3px">🔗 Línea compartida · ${efCount} estados físicos · total L. ${fmt(c0.monto_linea)} (prorrateado)</div>` : ''
        return `<div style="border:1px solid var(--border,#2a3340);border-radius:8px;padding:8px 10px;margin-bottom:8px">${head}
          ${items.map(c => `<div class="ef-row" style="border:none;padding:3px 0"><span>#${c.numero || '—'} · <span class="ef-plate">${esc(c.placa)}</span> · ${c.categoria === 'repotenciacion' ? 'Repot.' : 'E.Físico'} · <span style="color:var(--text3,#8b949e)">${esc(c.propietario || '')}</span></span><span style="color:var(--text3,#8b949e)">L. ${fmt(c.monto)}</span></div>`).join('')}
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border,#2a3340);margin-top:4px;padding-top:4px;font-size:12px"><span style="color:var(--text3,#8b949e)">Factura ${esc(c0.factura)} · ${esc(c0.fecha)}</span><b style="color:var(--gold,#c8a24a)">Total L. ${fmt(c0.monto_linea)}</b></div>
        </div>`
      }).join('') || '—'}${grpArr.length > 400 ? `<div style="font-size:12px;color:var(--text3,#8b949e)">… y ${grpArr.length - 400} facturas más</div>` : ''}</div></div>`
    const gNo = R.sinMatch.length ? `<div class="ef-grp"><div class="ef-grp-t" style="color:var(--text3,#8b949e)">Facturados con placa que NO está entre los pendientes (${R.sinMatch.length}) — <span style="color:var(--red,#f85149)">rojo = posterior al corte, revisar (placa mal escrita)</span> ${filtro('ef-list-nomatch')}</div>
      <div id="ef-list-nomatch" style="max-height:260px;overflow:auto">${R.sinMatch.map((l, i) => { const rev = fCorte && l.fecha && l.fecha >= fCorte; return `<div class="ef-row"${rev ? ' style="background:rgba(248,81,73,.06)"' : ''}><span>${rev ? '⚠ ' : ''}${esc(l.producto)} · <span class="ef-plate">${(l.placas || []).join(', ')}</span></span><span style="display:flex;gap:10px;align-items:center;flex-shrink:0;color:var(--text3,#8b949e)">F${esc(l.factura)} · ${esc(l.fecha || '')} · <b style="color:var(--gold,#c8a24a)">L. ${fmt(l.monto)}</b><button class="btn" data-nomatch="${i}" style="font-size:11px;padding:3px 10px">Conciliar</button></span></div>` }).join('')}</div></div>` : ''
    $('ef-result').innerHTML = gSinPlaca + huerfanasHTML() + pendientesHTML() + gNo + gConc
    $('ef-result').querySelectorAll('[data-manual]').forEach(b => b.addEventListener('click', () => abrirManual(R.sinPlaca[parseInt(b.dataset.manual, 10)])))
    $('ef-result').querySelectorAll('[data-nomatch]').forEach(b => b.addEventListener('click', () => abrirManual(R.sinMatch[parseInt(b.dataset.nomatch, 10)])))
    bindPendBuscador(); wireFilters()
  }

  function pendAgrupados () {
    const byPlate = {}
    PEND.forEach(e => { (byPlate[e.placa_norm] = byPlate[e.placa_norm] || []).push(e) })
    return Object.keys(byPlate).map(placa => {
      const items = byPlate[placa]
      const cats = items.map(x => x.categoria)
      const label = (cats.includes('estado_fisico') && cats.includes('repotenciacion')) ? 'E.Físico + Repot.' : (cats.includes('repotenciacion') ? 'Repot.' : 'E.Físico')
      const nums = items.map(x => x.numero).filter(n => n).sort((a, b) => a - b)
      const tipo = (items.find(x => x.tipo) || {}).tipo || ''
      return { placa, label, nums, tipo, propietario: items[0].propietario || '' }
    }).sort((a, b) => (a.nums[0] || 0) - (b.nums[0] || 0))
  }
  function pendientesHTML () {
    const grupos = pendAgrupados()
    const filtr = grupos.slice(0, 500)
    return `<div class="ef-grp"><div class="ef-grp-t"><span style="color:var(--amber,#f59e0b)">Pendientes de facturar (${grupos.length} placas · ${PEND.length} estados físicos)</span>
      <input id="ef-pq" class="ef-in" placeholder="🔍 placa, N° o propietario…" style="width:240px;text-transform:uppercase"></div>
      <div id="ef-pend-list" style="max-height:340px;overflow:auto">${filtr.map(filaPend).join('')}${grupos.length > 500 ? `<div style="font-size:12px;color:var(--text3,#8b949e);padding-top:6px">… y ${grupos.length - 500} más (usá el buscador)</div>` : ''}</div></div>`
  }
  function filaPend (g) {
    return `<div class="ef-row"><span>${g.nums.length ? '#' + g.nums.join('/') + ' · ' : ''}<span class="ef-plate">${esc(g.placa)}</span> · ${esc(g.label)}${g.tipo ? ` · <span style="color:var(--gold,#c8a24a)">${esc(g.tipo)}</span>` : ''}</span><span style="display:flex;gap:10px;align-items:center;flex-shrink:0"><span style="color:var(--text3,#8b949e)">${esc(g.propietario)}</span><button class="btn" data-pconc="${esc(g.placa)}" style="font-size:11px;padding:3px 10px">Conciliar</button></span></div>`
  }
  function renderPendientes () { $('ef-result').innerHTML = huerfanasHTML() + pendientesHTML(); bindPendBuscador() }
  function bindPendBuscador () {
    const q = $('ef-pq'); if (!q) return
    q.addEventListener('input', () => {
      const t = q.value.trim().toUpperCase()
      const f = pendAgrupados().filter(g => !t || (g.placa || '').includes(t) || g.nums.some(n => String(n).includes(t)) || (g.propietario || '').toUpperCase().includes(t) || (g.tipo || '').toUpperCase().includes(t)).slice(0, 500)
      $('ef-pend-list').innerHTML = f.map(filaPend).join('') || '<div style="color:var(--text3,#8b949e);padding:8px">Sin resultados</div>'
    })
  }

  // ── 3) CONCILIACIÓN MANUAL (sin placa) ──
  function abrirManual (linea) {
    _manualLinea = linea
    $('ef-modal-linea').innerHTML = `<b>${esc(linea.producto)}</b><br><span style="color:var(--text3,#8b949e)">Factura ${esc(linea.factura)} · ${esc(linea.fecha || '')}</span> · <b style="color:var(--gold,#c8a24a)">L. ${fmt(linea.monto)}</b>`
    // sugerencias por placa parcial (3 letras + dígitos) que traiga la descripción
    const m = String(linea.producto).toUpperCase().match(/[A-Z]{3}[\s\-]?[0-9]{2,4}/)
    const partial = m ? m[0].replace(/[^A-Z0-9]/g, '') : ''
    let sug = []
    if (partial) {
      const letters = partial.slice(0, 3); const digits = partial.slice(3)
      sug = pendAgrupados().filter(g => g.placa.startsWith(letters) && g.placa.slice(3).startsWith(digits)).slice(0, 6)
    }
    $('ef-modal-sug').innerHTML = sug.length
      ? `<div style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:4px">Sugerencias (placa parece "${esc(partial)}"):</div>` + sug.map(g => `<button class="btn" data-sugn="${g.nums[0]}" style="display:block;width:100%;text-align:left;margin-bottom:4px;font-size:12px">#${g.nums.join('/')} · ${esc(g.placa)} · ${esc(g.label)} · ${esc(g.propietario)}</button>`).join('')
      : '<div style="font-size:12px;color:var(--text3,#8b949e)">Sin sugerencias por placa — buscá el N° en la lista de pendientes.</div>'
    $('ef-modal-num').value = ''; $('ef-modal-hint').textContent = ''
    // ¿la factura ya tiene estados físicos conciliados? -> ofrecer ocultar
    const yaFact = ALL.filter(e => e.facturado && String(e.factura_ref) === String(linea.factura))
    $('ef-modal-yacon').innerHTML = yaFact.length
      ? `<div style="padding:8px 10px;border-radius:6px;background:rgba(22,163,74,.12);border:1px solid var(--green,#16a34a);font-size:12px">✓ La factura ${esc(linea.factura)} ya tiene ${yaFact.length} estado(s) físico(s) conciliado(s) (la placa está mal escrita en la factura). <button class="btn" id="ef-modal-ocultar" style="font-size:11px;padding:3px 10px;margin-top:6px;display:block">Ya está conciliada — ocultar de la lista</button></div>`
      : ''
    $('ef-modal').classList.add('open')
    const bo = $('ef-modal-ocultar'); if (bo) bo.addEventListener('click', ocultarSinMatch)
    $('ef-modal-sug').querySelectorAll('[data-sugn]').forEach(b => b.addEventListener('click', () => { $('ef-modal-num').value = b.dataset.sugn; hintManual() }))
    setTimeout(() => $('ef-modal-num').focus(), 120)
  }

  function ocultarSinMatch () {
    if (ULTIMA && Array.isArray(ULTIMA.sinMatch)) ULTIMA.sinMatch = ULTIMA.sinMatch.filter(l => l !== _manualLinea)
    $('ef-modal').classList.remove('open')
    renderResultado()
    toast('Oculta de la lista', 'success')
  }
  function hintManual () {
    const n = parseInt($('ef-modal-num').value, 10)
    const ef = PEND.find(e => e.numero === n)
    const h = $('ef-modal-hint')
    if (!n) { h.textContent = ''; return }
    if (!ef) { h.style.color = 'var(--red,#f85149)'; h.textContent = 'No hay un estado físico pendiente con ese número.'; return }
    h.style.color = 'var(--green,#16a34a)'; h.textContent = `→ ${ef.placa_norm} · ${ef.propietario || ''} (${ef.categoria === 'repotenciacion' ? 'Repot.' : 'E.Físico'})`
  }
  async function aplicarManual () {
    const n = parseInt($('ef-modal-num').value, 10)
    const ef = PEND.find(e => e.numero === n)
    if (!ef) { toast('Número no encontrado entre pendientes', 'error'); return }
    try {
      // marcar el estado físico elegido Y su repotenciación de la misma placa (misma factura)
      const items = PEND.filter(e => e.placa_norm === ef.placa_norm)
      const lista = items.length ? items : [ef]
      const ids = lista.map(e => e.id)
      const { error } = await sb().from('estados_fisicos').update({ facturado: true, fecha_factura: _manualLinea.fecha, factura_ref: _manualLinea.factura, monto: _manualLinea.monto, conciliado_manual: true }).in('id', ids)
      if (error) throw error
      if (ULTIMA) {
        if (Array.isArray(ULTIMA.conciliados)) lista.forEach(e => ULTIMA.conciliados.push({ numero: e.numero, placa: e.placa_norm, categoria: e.categoria, propietario: e.propietario, fecha: _manualLinea.fecha, factura: _manualLinea.factura, monto: _manualLinea.monto, compartida: false, placas_linea: 1, monto_linea: _manualLinea.monto }))
        if (Array.isArray(ULTIMA.sinPlaca)) ULTIMA.sinPlaca = ULTIMA.sinPlaca.filter(l => l !== _manualLinea)
        if (Array.isArray(ULTIMA.sinMatch)) ULTIMA.sinMatch = ULTIMA.sinMatch.filter(l => l !== _manualLinea)
      }
      $('ef-modal').classList.remove('open')
      toast(`${ef.placa_norm} marcado facturado (${ids.length})`, 'success')
      await cargarEstado(); renderResultado()
    } catch (e) { console.error('[EF manual]', e); toast('Error: ' + (e.message || e), 'error') }
  }
})()