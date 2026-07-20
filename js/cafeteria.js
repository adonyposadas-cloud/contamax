/* ============================================================================
 * CONTAMAX · cafeteria.js   ·   Etapa 1
 *
 * INVENTARIO DE CAFETERÍA — insumos, recetas, compras, merma y conteo.
 *
 * Dos mundos que nunca se mezclan:
 *   INSUMOS  = lo que se compra (arroz, jamón). Esto SÍ tiene existencia.
 *   RECETAS  = lo que se vende (almuerzo, sándwich). Esto NO tiene existencia:
 *              se "arma" y gasta insumos según su receta.
 *
 * La regla de oro: la existencia NUNCA se escribe a mano. Es la suma de los
 * movimientos (entrada / salida / merma / ajuste). Por eso todo pasa por RPC
 * y la pantalla lee de la vista v_caf_existencias, nunca de una columna.
 *
 * El costo tampoco se edita: sale del promedio ponderado de las compras.
 * Si se pudiera escribir a mano, el costo de los platos mentiría.
 * ========================================================================== */
window.__cafBuild = '20260720b'

;(function () {
  const sb = () => window._sb
  const esc = t => String(t ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
  const fmt = v => v == null ? '—' : Number(v).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null }
  const toast = (m, t) => window.toast?.(m, t)

  let TAB = 'insumos'
  let INSUMOS = []      // desde v_caf_existencias
  let RECETAS = []      // desde v_caf_recetas_costo
  let INGR = {}         // receta_id → [ingredientes]
  let MOVS = []
  let ABIERTA = null    // receta desplegada
  let PLAN = {}         // receta_id → cantidad planeada
  let REQ = null        // resultado de caf_requerimientos
  let VENTA = {}        // receta_id → cantidad a vender
  let VENTAS = []       // últimas ventas
  let VLINEAS = {}      // venta_id → líneas
  let DIA = null        // resumen del día de hoy
  let UBIC = []         // ubicaciones (Central + puntos)
  let USEL = null       // ubicación seleccionada (null = consolidado)
  let CENTRAL = null    // id de la bodega central
  let TRAS = []         // traslados recientes
  let TLIN = {}         // traslado_id → líneas
  let ENVIO = {}        // insumo_id → cantidad a enviar
  // Filtros de cada pestaña. Con 25+ productos las listas se hacen largas y
  // encontrar uno a ojo cuesta más que buscarlo.
  let FI = { q: '', grupo: '', bajo: false }   // inventario
  let FP = { q: '', clase: '', cat: '' }       // productos
  let FV = { q: '' }                           // ventas
  let PEND = []         // v_caf_corte_pendiente (lo que falta cortar)
  let CORTES = []       // historial de cortes

  const GRUPOS = [
    ['A', 'A · Caro (se porciona)', '#b4472f'],
    ['B', 'B · Mediano (porción estándar)', '#b8860b'],
    ['C', 'C · Barato (se estima)', '#4e7a51']
  ]
  const TIPOS_MOV = {
    entrada: ['Compra', '#4e7a51'],
    salida: ['Venta', '#3b82f6'],
    merma: ['Merma', '#b4472f'],
    ajuste: ['Conteo', '#b8860b']
  }

  const puede = () => {
    const p = (window._currentProfile ? window._currentProfile() : null) || {}
    return ['super_admin', 'admin', 'gerencia', 'cafeteria', 'cafeteria_punto'].includes(p._rolReal || p.rol)
  }
  // ¿Ve todas las ubicaciones o solo la suya? La RLS manda igual del lado del
  // servidor; esto es solo para no mostrar botones que van a rebotar.
  const veTodo = () => {
    const p = (window._currentProfile ? window._currentProfile() : null) || {}
    return ['super_admin', 'admin', 'gerencia', 'cafeteria'].includes(p._rolReal || p.rol)
  }

  // ── Carga ────────────────────────────────────────────────────────────────
  window.initCafeteria = async function () {
    const root = document.getElementById('view-cafeteria')
    if (!root) return
    if (!puede()) { root.innerHTML = '<div style="padding:24px;color:#f85149">No tenés permiso sobre el módulo de cafetería.</div>'; return }
    root.innerHTML = '<div style="padding:24px;color:#8b949e">Cargando…</div>'
    try {
      await cargar()
      render()
    } catch (e) {
      root.innerHTML = `<div style="padding:24px;color:#f85149">Error: ${esc(e.message || e)}</div>`
    }
  }

  async function cargar () {
    // Ubicaciones primero: definen qué inventario se pide
    if (!UBIC.length) {
      const { data: ru } = await sb().from('caf_ubicaciones').select('*').eq('activo', true).order('orden')
      UBIC = ru || []
      const c = UBIC.find(u => u.tipo === 'central')
      CENTRAL = c ? c.id : null
      // Admin arranca en Central; el encargado, en su punto (la RLS solo le
      // devuelve el suyo, así que se toma el primero que ve).
      if (USEL === null) USEL = veTodo() ? CENTRAL : (UBIC[0] ? UBIC[0].id : null)
    }

    const [ri, rr, rg, rm, rv, rd, rt, rp, rc] = await Promise.all([
      sb().from('v_caf_existencias_ubic').select('*').eq('ubicacion_id', USEL).order('nombre'),
      sb().from('v_caf_recetas_costo').select('*').order('nombre'),
      sb().from('caf_receta_ingredientes').select('*'),
      sb().from('caf_inventario_mov').select('*').eq('ubicacion_id', USEL).order('fecha', { ascending: false }).limit(120),
      sb().from('caf_ventas').select('*').eq('ubicacion_id', USEL).order('fecha', { ascending: false }).limit(40),
      sb().from('v_caf_ventas_dia').select('*').order('dia', { ascending: false }).limit(30),
      sb().from('caf_traslados').select('*').order('fecha', { ascending: false }).limit(30),
      sb().from('v_caf_corte_pendiente').select('*'),
      sb().from('v_caf_cortes').select('*').order('fecha', { ascending: false }).limit(30)
    ])
    if (ri.error) throw ri.error
    if (rr.error) throw rr.error
    INSUMOS = ri.data || []
    RECETAS = rr.data || []
    MOVS = rm.data || []
    VENTAS = rv.error ? [] : (rv.data || [])
    TRAS = rt.error ? [] : (rt.data || [])
    PEND = rp.error ? [] : (rp.data || [])
    CORTES = rc.error ? [] : (rc.data || [])
    INGR = {}
    for (const g of (rg.data || [])) (INGR[g.receta_id] = INGR[g.receta_id] || []).push(g)

    // Resumen del día para LA ubicación seleccionada
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' })
    DIA = rd.error ? null : (rd.data || []).find(d => d.dia === hoy && d.ubicacion_id === USEL) || null

    VLINEAS = {}
    if (VENTAS.length) {
      const { data: rl } = await sb().from('caf_venta_lineas').select('*').in('venta_id', VENTAS.map(v => v.id))
      for (const l of (rl || [])) (VLINEAS[l.venta_id] = VLINEAS[l.venta_id] || []).push(l)
    }
    TLIN = {}
    if (TRAS.length) {
      const { data: tl } = await sb().from('caf_traslado_lineas').select('*').in('traslado_id', TRAS.map(t => t.id))
      for (const l of (tl || [])) (TLIN[l.traslado_id] = TLIN[l.traslado_id] || []).push(l)
    }
  }

  const ubicNombre = id => { const u = UBIC.find(x => x.id === id); return u ? u.nombre : '—' }
  const enCentral = () => USEL === CENTRAL

  const insumoPorId = id => INSUMOS.find(i => i.id === id)
  const unidad = i => i ? (i.unidad_base || '') : ''

  // ── Render principal ─────────────────────────────────────────────────────
  function render () {
    const root = document.getElementById('view-cafeteria')
    if (!root) return
    const tab = (k, ico, txt) => `<button onclick="cafTab('${k}')" style="background:${TAB === k ? '#c0632f' : 'transparent'};color:${TAB === k ? '#fff' : '#8b949e'};border:1px solid ${TAB === k ? '#c0632f' : '#2a2e37'};border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600">${ico} ${txt}</button>`

    const bajos = INSUMOS.filter(i => i.activo && i.bajo_minimo)
    const alerta = bajos.length
      ? `<div style="background:#3a1d1d;border-left:4px solid #b4472f;border-radius:0 8px 8px 0;padding:11px 15px;margin-bottom:14px;color:#f0c8c0;font-size:13px">
           <b>⚠ ${bajos.length} insumo${bajos.length > 1 ? 's' : ''} bajo el mínimo:</b> ${bajos.map(i => esc(i.nombre)).join(' · ')}
         </div>` : ''

    const selUbic = UBIC.length > 1
      ? `<select onchange="cafUbicSel(this.value)" style="background:#0d1117;border:1px solid #c0632f;border-radius:8px;color:#e6edf3;padding:7px 11px;font-size:13px;font-weight:600">
           ${UBIC.map(u => `<option value="${u.id}"${u.id === USEL ? ' selected' : ''}>${u.tipo === 'central' ? '🏬' : '🏪'} ${esc(u.nombre)}</option>`).join('')}
         </select>`
      : `<span style="color:#8b949e;font-size:13px">🏪 ${esc(ubicNombre(USEL))}</span>`

    root.innerHTML = `
      <div style="padding:18px 20px;max-width:1180px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;flex-wrap:wrap">
          <h2 style="margin:0;font-size:19px;color:#e6edf3">☕ Cafetería</h2>
          ${selUbic}
          ${veTodo() ? '<button onclick="cafAdmin()" title="Puntos y encargados" style="background:#1c2027;border:1px solid #2a2e37;border-radius:8px;color:#8b949e;padding:7px 10px;cursor:pointer;font-size:13px">⚙</button>' : ''}
          <div style="flex:1"></div>
          ${tab('insumos', '📦', 'Inventario')}
          ${tab('recetas', '🍽️', 'Productos')}
          ${tab('ventas', '💵', 'Ventas')}
          ${veTodo() ? tab('envios', '🚚', 'Envíos') : ''}
          ${tab('cortes', '💰', 'Corte de caja')}
          ${veTodo() ? tab('compras', '🛒', 'Lista de compras') : ''}
          ${tab('movs', '📋', 'Movimientos')}
        </div>
        <div style="color:#6e7681;font-size:11.5px;margin-bottom:12px">
          Estás viendo <b style="color:#c0632f">${esc(ubicNombre(USEL))}</b>${enCentral() ? ' · las compras entran acá' : ' · lo que se venda o se pierda baja de este punto'}
        </div>
        ${alerta}
        <div id="caf-body"></div>
      </div>`
    pintarBody()
  }

  window.cafUbicSel = async function (id) {
    USEL = Number(id)
    REQ = null; VENTA = {}; ENVIO = {}
    const root = document.getElementById('view-cafeteria')
    if (root) root.innerHTML = '<div style="padding:24px;color:#8b949e">Cargando…</div>'
    try { await cargar(); render() } catch (e) {
      if (root) root.innerHTML = `<div style="padding:24px;color:#f85149">Error: ${esc(e.message || e)}</div>`
    }
  }

  function pintarBody () {
    const b = document.getElementById('caf-body')
    if (!b) return
    b.innerHTML = TAB === 'insumos' ? vistaInsumos()
      : TAB === 'recetas' ? vistaRecetas()
        : TAB === 'ventas' ? vistaVentas()
          : TAB === 'cortes' ? vistaCortes()
            : TAB === 'envios' ? vistaEnvios()
              : TAB === 'compras' ? vistaCompras()
                : vistaMovs()
  }

  window.cafTab = function (k) { TAB = k; render() }

  // Repinta el cuerpo y devuelve el cursor al buscador: sin esto, cada letra
  // tecleada haría perder el foco y habría que volver a tocar el campo.
  function repintarConFoco (idCampo) {
    const val = document.getElementById(idCampo)?.value ?? ''
    pintarBody()
    const el = document.getElementById(idCampo)
    if (el) { el.focus(); el.setSelectionRange(val.length, val.length) }
  }

  // Buscador reutilizable
  function buscador (id, valor, fn, ph) {
    return `<input id="${id}" value="${esc(valor)}" oninput="${fn}(this.value)" placeholder="${esc(ph)}"
      style="width:100%;background:#0d1117;border:1px solid #2a2e37;border-radius:9px;color:#e6edf3;padding:9px 12px;font-size:13.5px;margin-bottom:8px">`
  }

  // Chip de filtro reutilizable
  function chipF (activo, txt, onclick) {
    return `<button onclick="${onclick}" style="background:${activo ? '#c0632f22' : 'transparent'};border:1px solid ${activo ? '#c0632f' : '#2a2e37'};color:${activo ? '#c0632f' : '#8b949e'};border-radius:14px;padding:4px 11px;cursor:pointer;font-size:11.5px;white-space:nowrap">${txt}</button>`
  }

  window.cafFI = function (k, v) {
    if (k === 'q') { FI.q = v; repintarConFoco('caf-q-ins'); return }
    if (k === 'reset') { FI = { q: FI.q, grupo: '', bajo: false } }
    else if (k === 'bajo') FI.bajo = !FI.bajo
    else FI[k] = FI[k] === v ? '' : v
    pintarBody()
  }
  window.cafFP = function (k, v) {
    if (k === 'q') { FP.q = v; repintarConFoco('caf-q-prod'); return }
    if (k === 'reset') { FP = { q: FP.q, clase: '', cat: '' } }
    else FP[k] = FP[k] === v ? '' : v
    pintarBody()
  }
  window.cafFV = function (v) { FV.q = v; repintarConFoco('caf-q-venta') }
  window.cafFIq = v => window.cafFI('q', v)
  window.cafFPq = v => window.cafFP('q', v)

  // ── TAB INSUMOS ──────────────────────────────────────────────────────────
  function vistaInsumos () {
    const q = FI.q.trim().toUpperCase()
    const vis = INSUMOS.filter(i => {
      if (FI.grupo && i.grupo !== FI.grupo) return false
      if (FI.bajo && !(i.bajo_minimo && i.activo)) return false
      if (!q) return true
      return [i.nombre, i.codigo, i.unidad_base, i.unidad_compra].some(v => String(v || '').toUpperCase().includes(q))
    })
    const valor = vis.reduce((a, i) => a + Number(i.valor || 0), 0)
    const nBajos = INSUMOS.filter(i => i.bajo_minimo && i.activo).length
    const filas = vis.map(i => {
      const g = GRUPOS.find(x => x[0] === i.grupo) || GRUPOS[1]
      const bajo = i.bajo_minimo && i.activo
      return `
      <tr style="border-bottom:1px solid #21262d;${i.activo ? '' : 'opacity:.45'}">
        <td style="padding:9px 8px">
          <div style="color:#e6edf3;font-weight:600">${esc(i.nombre)}</div>
          <div style="color:#6e7681;font-size:11px">${esc(i.codigo)}</div>
        </td>
        <td style="padding:9px 8px;text-align:center">
          <span title="${esc(g[1])}" style="background:${g[2]}22;color:${g[2]};border:1px solid ${g[2]}66;border-radius:5px;padding:2px 8px;font-size:12px;font-weight:700">${i.grupo}</span>
        </td>
        <td style="padding:9px 8px;text-align:right;color:${bajo ? '#f85149' : '#e6edf3'};font-weight:600">
          ${fmt(i.existencia)} <span style="color:#6e7681;font-weight:400;font-size:11px">${esc(i.unidad_base)}</span>
          ${bajo ? ' <span title="Bajo el mínimo">⚠</span>' : ''}
        </td>
        <td style="padding:9px 8px;text-align:right;color:#8b949e">L. ${fmt(i.costo_unitario)}</td>
        <td style="padding:9px 8px;text-align:right;color:#8b949e">L. ${fmt(i.valor)}</td>
        <td style="padding:9px 8px;text-align:right;color:#6e7681;font-size:12px">${fmt(i.stock_minimo)}</td>
        <td style="padding:9px 8px;text-align:right;white-space:nowrap">
          ${veTodo() ? `<button onclick="cafComprar(${i.id})" title="Registrar compra" style="background:none;border:0;cursor:pointer;font-size:15px">🛒</button>` : ''}
          <button onclick="cafConteo(${i.id})" title="Conteo físico" style="background:none;border:0;cursor:pointer;font-size:15px">📋</button>
          <button onclick="cafMerma(${i.id})" title="Registrar merma" style="background:none;border:0;cursor:pointer;font-size:15px">🗑️</button>
          ${veTodo() ? `<button onclick="cafInsumoEditar(${i.id})" title="Editar" style="background:none;border:0;cursor:pointer;font-size:14px">✏️</button>` : ''}
        </td>
      </tr>`
    }).join('')

    return `
      ${buscador('caf-q-ins', FI.q, 'cafFIq', '🔍 Buscar insumo por nombre o código…')}
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:6px">
        ${chipF(!FI.grupo && !FI.bajo, 'Todos', "cafFI('reset','')")}
        ${nBajos ? chipF(FI.bajo, `⚠ Bajo mínimo (${nBajos})`, "cafFI('bajo','')") : ''}
        ${GRUPOS.map(g => chipF(FI.grupo === g[0], `${g[0]} · ${g[1].split('·')[1] ? g[1].split('·')[1].trim() : g[0]}`, `cafFI('grupo','${g[0]}')`)).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div style="color:#8b949e;font-size:13px">
          ${vis.length !== INSUMOS.length ? `<b style="color:#c0632f">${vis.length}</b> de ${INSUMOS.length} · ` : ''}Valor: <b style="color:#e6edf3">L. ${fmt(valor)}</b>
        </div>
        ${veTodo() ? '<button onclick="cafInsumoNuevo()" style="background:#c0632f;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:600">+ Nuevo insumo</button>' : ''}
      </div>
      <div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#1c2027;color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:.5px">
            <th style="padding:9px 8px;text-align:left">Insumo</th>
            <th style="padding:9px 8px">Grupo</th>
            <th style="padding:9px 8px;text-align:right">Existencia</th>
            <th style="padding:9px 8px;text-align:right">Costo unit.</th>
            <th style="padding:9px 8px;text-align:right">Valor</th>
            <th style="padding:9px 8px;text-align:right">Mínimo</th>
            <th style="padding:9px 8px;text-align:right">Acciones</th>
          </tr></thead>
          <tbody>${filas || `<tr><td colspan="7" style="padding:26px;text-align:center;color:#6e7681">${INSUMOS.length ? 'Ningún insumo coincide con la búsqueda.' : 'Todavía no hay insumos. Empezá con “+ Nuevo insumo”.'}</td></tr>`}</tbody>
        </table>
      </div>
      <div style="color:#6e7681;font-size:11.5px;margin-top:8px">
        El costo unitario no se edita a mano: sale del promedio ponderado de las compras.
      </div>`
  }

  // ── TAB RECETAS ──────────────────────────────────────────────────────────
  function colorFC (p) { return p == null ? '#6e7681' : p <= 35 ? '#4e7a51' : p <= 45 ? '#b8860b' : '#b4472f' }

  function vistaRecetas () {
    const q = FP.q.trim().toUpperCase()
    const vis = RECETAS.filter(r => {
      if (FP.clase === 'reventa' && !r.es_reventa) return false
      if (FP.clase === 'cocina' && r.es_reventa) return false
      if (FP.clase === 'caro' && !(r.food_cost_pct != null && r.food_cost_pct > 45)) return false
      if (FP.clase === 'sinreceta' && !(!r.es_reventa && r.ingredientes === 0)) return false
      if (FP.cat && (r.categoria || '') !== FP.cat) return false
      if (!q) return true
      return [r.nombre, r.categoria, r.codigo].some(v => String(v || '').toUpperCase().includes(q))
    })
    const cats = [...new Set(RECETAS.map(r => r.categoria).filter(Boolean))].sort()
    const nCaros = RECETAS.filter(r => r.food_cost_pct != null && r.food_cost_pct > 45).length
    const nSinRec = RECETAS.filter(r => !r.es_reventa && r.ingredientes === 0).length
    const cards = vis.map(r => {
      const abierta = ABIERTA === r.id
      const c = colorFC(r.food_cost_pct)
      const ings = (INGR[r.id] || []).map(g => {
        const i = insumoPorId(g.insumo_id)
        const sub = i ? Number(g.cantidad) * Number(i.costo_unitario) : 0
        return `<tr style="border-bottom:1px solid #21262d">
          <td style="padding:6px 8px;color:#e6edf3">${esc(i ? i.nombre : '(insumo #' + g.insumo_id + ')')}</td>
          <td style="padding:6px 8px;text-align:right;color:#8b949e">${fmt(g.cantidad)} ${esc(unidad(i))}</td>
          <td style="padding:6px 8px;text-align:right;color:#8b949e">L. ${fmt(sub)}</td>
          <td style="padding:6px 8px;text-align:right">
            ${!veTodo() ? '' : `<button onclick="cafIngrEditar(${r.id},${g.insumo_id},${g.cantidad})" title="Cambiar cantidad" style="background:none;border:0;cursor:pointer;font-size:13px">✏️</button>
            <button onclick="cafIngrQuitar(${g.id},${r.id})" title="Quitar" style="background:none;border:0;color:#f85149;cursor:pointer;font-size:14px">✕</button>`}
          </td></tr>`
      }).join('')

      return `
      <div style="background:#15171c;border:1px solid #2a2e37;border-left:3px solid ${c};border-radius:10px;padding:13px 15px;margin-bottom:10px;${r.activo ? '' : 'opacity:.5'}">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;cursor:pointer" onclick="cafReceta(${r.id})">
          <div style="flex:1;min-width:170px">
            <div style="color:#e6edf3;font-weight:600;font-size:14px">${esc(r.nombre)}
              ${r.es_reventa ? '<span style="background:#3b82f622;color:#3b82f6;border:1px solid #3b82f655;border-radius:5px;padding:1px 7px;font-size:10.5px;font-weight:600;margin-left:6px">reventa</span>' : ''}
            </div>
            <div style="color:#6e7681;font-size:11px">${esc(r.categoria || 'sin categoría')}${r.es_reventa ? '' : ` · ${r.ingredientes} ingrediente${r.ingredientes === 1 ? '' : 's'}`}</div>
          </div>
          <div style="text-align:right"><div style="color:#6e7681;font-size:10.5px">PRECIO</div><div style="color:#e6edf3;font-weight:600">L. ${fmt(r.precio_venta)}</div></div>
          <div style="text-align:right"><div style="color:#6e7681;font-size:10.5px">COSTO</div><div style="color:#8b949e">L. ${fmt(r.costo)}</div></div>
          <div style="text-align:right"><div style="color:#6e7681;font-size:10.5px">GANA</div><div style="color:#4e7a51;font-weight:600">L. ${fmt(r.ganancia)}</div></div>
          <div style="text-align:right;min-width:64px">
            <div style="color:#6e7681;font-size:10.5px">FOOD COST</div>
            <div style="color:${c};font-weight:700">${r.food_cost_pct == null ? '—' : r.food_cost_pct + '%'}</div>
          </div>
          <span style="color:#6e7681">${abierta ? '▾' : '▸'}</span>
        </div>
        ${abierta ? `
        <div style="margin-top:11px;border-top:1px solid #21262d;padding-top:10px">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px">
            <thead><tr style="color:#6e7681;font-size:10.5px;text-transform:uppercase">
              <th style="padding:5px 8px;text-align:left">Ingrediente</th>
              <th style="padding:5px 8px;text-align:right">Cantidad</th>
              <th style="padding:5px 8px;text-align:right">Costo</th>
              <th></th></tr></thead>
            <tbody>${ings || '<tr><td colspan="4" style="padding:12px;color:#6e7681;text-align:center">Sin ingredientes todavía.</td></tr>'}</tbody>
          </table>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            ${!veTodo() ? '' : `<button onclick="cafIngrAgregar(${r.id})" style="background:#1c2027;color:#c0632f;border:1px solid #2a2e37;border-radius:7px;padding:6px 12px;cursor:pointer;font-size:12px">+ Agregar ingrediente</button>
            <button onclick="cafRecetaEditar(${r.id})" style="background:#1c2027;color:#8b949e;border:1px solid #2a2e37;border-radius:7px;padding:6px 12px;cursor:pointer;font-size:12px">✏️ Editar receta</button>`}
          </div>
          ${r.food_cost_pct != null && r.food_cost_pct > 45 ? '<div style="margin-top:9px;color:#f0a868;font-size:11.5px">⚠ El costo pasa del 45% del precio. Conviene revisar la porción o el precio.</div>' : ''}
        </div>` : ''}
      </div>`
    }).join('')

    return `
      ${buscador('caf-q-prod', FP.q, 'cafFPq', '🔍 Buscar producto por nombre o categoría…')}
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:6px">
        ${chipF(!FP.clase && !FP.cat, 'Todos', "cafFP('reset','')")}
        ${chipF(FP.clase === 'reventa', 'Reventa', "cafFP('clase','reventa')")}
        ${chipF(FP.clase === 'cocina', 'Cocina', "cafFP('clase','cocina')")}
        ${nCaros ? chipF(FP.clase === 'caro', `⚠ Food cost alto (${nCaros})`, "cafFP('clase','caro')") : ''}
        ${nSinRec ? chipF(FP.clase === 'sinreceta', `Sin receta (${nSinRec})`, "cafFP('clase','sinreceta')") : ''}
        ${cats.map(c => chipF(FP.cat === c, esc(c), `cafFP('cat','${esc(c).replace(/'/g, "\\'")}')`)).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div style="color:#8b949e;font-size:12.5px">
          ${vis.length !== RECETAS.length ? `<b style="color:#c0632f">${vis.length}</b> de ${RECETAS.length} · ` : ''}Lo sano es un food cost entre <b style="color:#4e7a51">28% y 35%</b>.
        </div>
        <div style="display:flex;gap:8px">
          ${!veTodo() ? '' : `<button onclick="cafReventaNueva()" title="Se compra hecho y se vende tal cual: sodas, galletas, snacks" style="background:#1c2027;color:#c0632f;border:1px solid #2a2e37;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:600">+ Producto de reventa</button>
          <button onclick="cafRecetaNueva()" style="background:#c0632f;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:600">+ Receta de cocina</button>`}
        </div>
      </div>
      ${cards || `<div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;padding:26px;text-align:center;color:#6e7681">${RECETAS.length ? 'Ningún producto coincide con la búsqueda.' : 'Todavía no hay productos. Creá el que más se vende.'}</div>`}`
  }

  // ── TAB MOVIMIENTOS ──────────────────────────────────────────────────────
  function vistaMovs () {
    const admin = veTodo()
    const filas = MOVS.map(m => {
      const i = insumoPorId(m.insumo_id)
      const t = TIPOS_MOV[m.tipo] || [m.tipo, '#8b949e']
      const q = Number(m.cantidad)
      const ligado = m.venta_id || m.traslado_id     // tiene su propia anulación
      return `<tr style="border-bottom:1px solid #21262d">
        <td style="padding:8px;color:#6e7681;font-size:11.5px;white-space:nowrap">${new Date(m.fecha).toLocaleString('es-HN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
        <td style="padding:8px"><span style="background:${t[1]}22;color:${t[1]};border:1px solid ${t[1]}55;border-radius:5px;padding:2px 8px;font-size:11px;font-weight:600">${t[0]}</span></td>
        <td style="padding:8px;color:#e6edf3">${esc(i ? i.nombre : '#' + m.insumo_id)}</td>
        <td style="padding:8px;text-align:right;color:${q >= 0 ? '#4e7a51' : '#f85149'};font-weight:600">${q >= 0 ? '+' : ''}${fmt(q)} <span style="color:#6e7681;font-weight:400;font-size:11px">${esc(unidad(i))}</span></td>
        <td style="padding:8px;text-align:right;color:#8b949e">L. ${fmt(Math.abs(q) * Number(m.costo_unitario || 0))}</td>
        <td style="padding:8px;color:#6e7681;font-size:11.5px">${esc(m.referencia || m.nota || '')}</td>
        <td style="padding:8px;text-align:right;white-space:nowrap">
          ${(!admin || ligado) ? '' : `
            ${m.tipo === 'entrada' ? `<button onclick="cafCompraCorregir(${m.id},${m.insumo_id},${q},${Number(m.costo_unitario || 0)})" title="Corregir cantidad o costo" style="background:none;border:0;cursor:pointer;font-size:13px">✏️</button>` : ''}
            <button onclick="cafMovEliminar(${m.id})" title="Borrar este movimiento" style="background:none;border:0;color:#f85149;cursor:pointer;font-size:13px">🗑️</button>`}
        </td>
      </tr>`
    }).join('')

    return `
      <div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#1c2027;color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:.5px">
            <th style="padding:9px 8px;text-align:left">Fecha</th>
            <th style="padding:9px 8px;text-align:left">Tipo</th>
            <th style="padding:9px 8px;text-align:left">Insumo</th>
            <th style="padding:9px 8px;text-align:right">Cantidad</th>
            <th style="padding:9px 8px;text-align:right">Valor</th>
            <th style="padding:9px 8px;text-align:left">Detalle</th>
            <th></th>
          </tr></thead>
          <tbody>${filas || '<tr><td colspan="7" style="padding:26px;text-align:center;color:#6e7681">Sin movimientos todavía.</td></tr>'}</tbody>
        </table>
      </div>
      <div style="color:#6e7681;font-size:11.5px;margin-top:8px">
        Últimos 120 movimientos de ${esc(ubicNombre(USEL))}. La existencia es la suma de todo esto.
        ${admin ? '<br>Al corregir o borrar una compra, el costo promedio se recalcula solo. Las ventas y envíos se anulan desde su pestaña.' : ''}
      </div>`
  }

  window.cafCompraCorregir = function (movId, insumoId, cantBase, costoUnit) {
    const i = insumoPorId(insumoId)
    const factor = i ? Number(i.factor_compra) : 1
    const uc = i ? (i.unidad_compra || i.unidad_base) : ''
    modal('✏️ Corregir compra', [
      { k: 'cant', label: `Cantidad (en ${uc})`, tipo: 'num', valor: +(cantBase / factor).toFixed(4), hint: `1 ${uc} = ${fmt(factor)} ${i ? i.unidad_base : ''}` },
      { k: 'costo', label: 'Costo total pagado (L.)', tipo: 'num', valor: +(cantBase * costoUnit).toFixed(2) }
    ], async v => {
      if (!v.cant || v.cant <= 0) throw new Error('Poné la cantidad')
      if (v.costo == null || v.costo < 0) throw new Error('Poné el costo total')
      const d = await rpc('caf_compra_corregir', { p_mov_id: movId, p_cantidad_compra: v.cant, p_costo_total: v.costo })
      await refrescar(`Corregido · costo promedio ahora L. ${fmt(d.costo_recalculado)}`)
    }, i ? i.nombre : '')
  }

  window.cafMovEliminar = async function (id, forzar) {
    if (!forzar && !confirm('¿Borrar este movimiento?\n\nSe usa para errores de tecleo. El costo promedio se recalcula solo y queda registro de qué se borró.')) return
    const motivo = forzar ? 'Forzado' : (prompt('¿Por qué se borra?', 'Costo mal tecleado') || null)
    if (motivo === null) return
    try {
      const { data, error } = await sb().rpc('caf_mov_eliminar', { p_mov_id: id, p_motivo: motivo, p_forzar: !!forzar })
      if (error) throw new Error(error.message)
      if (data && data.ok === false && data.motivo === 'quedaria_negativo') {
        if (confirm(`Si borrás este movimiento, la existencia queda en ${fmt(data.queda)}.\n\nEso pasa cuando ya se vendió o se envió producto que entró con este movimiento.\n\n¿Borrarlo igual?`)) {
          return window.cafMovEliminar(id, true)
        }
        return
      }
      await refrescar(`Movimiento borrado · costo promedio ahora L. ${fmt(data.costo_recalculado)}`)
    } catch (e) { toast(e.message, 'error') }
  }

  // ── TAB VENTAS ───────────────────────────────────────────────────────────
  //  Se registra lo que se vendió y el sistema descuenta los ingredientes solo
  //  (back-flush). Si no alcanza el stock, avisa y pide confirmar: la venta ya
  //  ocurrió, así que se puede registrar igual — la existencia queda negativa y
  //  eso es una señal honesta de que algo no cuadra.
  function vistaVentas () {
    const activas = RECETAS.filter(r => r.activo)
    if (!activas.length) {
      return '<div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;padding:26px;text-align:center;color:#6e7681">Primero creá recetas con sus ingredientes.</div>'
    }

    const totalVenta = Object.keys(VENTA).reduce((a, id) => {
      const r = RECETAS.find(x => x.id === Number(id))
      return a + (r ? Number(r.precio_venta) * VENTA[id] : 0)
    }, 0)

    const qv = FV.q.trim().toUpperCase()
    // Lo elegido se muestra siempre, aunque no coincida con la búsqueda: si no,
    // se perdería de vista lo que ya se cargó al filtrar por otra cosa.
    const visV = activas.filter(r => VENTA[r.id] || !qv ||
      [r.nombre, r.categoria].some(v => String(v || '').toUpperCase().includes(qv)))
    const filas = visV.map(r => `
      <tr style="border-bottom:1px solid #21262d;${VENTA[r.id] ? 'background:#1a2e1c33' : ''}">
        <td style="padding:8px">
          <div style="color:#e6edf3;font-weight:600">${esc(r.nombre)}</div>
          <div style="color:#6e7681;font-size:11px">L. ${fmt(r.precio_venta)}${r.ingredientes === 0 ? ' · ⚠ sin ingredientes' : ''}</div>
        </td>
        <td style="padding:8px;width:118px">
          <input id="caf-venta-${r.id}" type="number" min="0" step="1" value="${VENTA[r.id] || ''}" placeholder="0"
                 oninput="cafVentaSet(${r.id}, this.value)"
                 style="width:100%;background:#0d1117;border:1px solid #2a2e37;border-radius:7px;color:#e6edf3;padding:7px 10px;font-size:14px;text-align:center">
        </td>
      </tr>`).join('')

    const hoy = DIA
      ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
           ${[['Ventas', DIA.ventas, '#e6edf3'], ['Vendido', 'L. ' + fmt(DIA.total), '#4e7a51'],
             ['Costo', 'L. ' + fmt(DIA.costo), '#8b949e'], ['Ganancia', 'L. ' + fmt(DIA.ganancia), '#c0632f']]
             .map(([t, v, c]) => `<div style="background:#15171c;border:1px solid #2a2e37;border-radius:9px;padding:9px 11px">
               <div style="color:#6e7681;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px">${t}</div>
               <div style="color:${c};font-weight:700;font-size:15px;margin-top:2px">${v}</div></div>`).join('')}
         </div>
         ${DIA.food_cost_pct != null ? `<div style="color:#6e7681;font-size:11.5px;margin:-6px 0 12px 2px">Food cost de hoy: <b style="color:${colorFC(DIA.food_cost_pct)}">${DIA.food_cost_pct}%</b></div>` : ''}`
      : '<div style="background:#15171c;border:1px dashed #2a2e37;border-radius:9px;padding:14px;text-align:center;color:#6e7681;font-size:12.5px;margin-bottom:12px">Todavía no hay ventas registradas hoy.</div>'

    const listaVentas = VENTAS.length ? VENTAS.map(v => {
      const ls = (VLINEAS[v.id] || []).map(l => {
        const r = RECETAS.find(x => x.id === l.receta_id)
        return `${fmt(l.cantidad).replace(/\.00$/, '')} ${r ? r.nombre : '#' + l.receta_id}`
      }).join(' · ')
      return `<tr style="border-bottom:1px solid #21262d;${v.anulada ? 'opacity:.45' : ''}">
        <td style="padding:7px 8px;color:#6e7681;font-size:11.5px;white-space:nowrap">
          #${v.id} · ${new Date(v.fecha).toLocaleString('es-HN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </td>
        <td style="padding:7px 8px;color:#e6edf3;font-size:12.5px">
          ${esc(ls || '—')}${v.anulada ? ' <span style="color:#f85149;font-size:11px">ANULADA</span>' : ''}
        </td>
        <td style="padding:7px 8px;text-align:right;color:#4e7a51;font-weight:600">L. ${fmt(v.total)}</td>
        <td style="padding:7px 8px;text-align:right">
          ${v.anulada ? '' : `<button onclick="cafVentaAnular(${v.id})" title="Anular venta" style="background:none;border:0;color:#f85149;cursor:pointer;font-size:13px">✕</button>`}
        </td>
      </tr>`
    }).join('') : '<tr><td colspan="4" style="padding:22px;text-align:center;color:#6e7681">Sin ventas todavía.</td></tr>'

    return `
      ${hoy}
      <div style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(340px,1.4fr);gap:14px;align-items:start">
        <div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;overflow:hidden">
          <div style="padding:11px 14px;border-bottom:1px solid #21262d">
            <b style="font-size:13.5px;color:#e6edf3">¿Qué se vendió?</b>
            <div style="color:#6e7681;font-size:11.5px;margin-top:2px">Al registrar, los ingredientes bajan solos.</div>
          </div>
          <div style="padding:9px 12px 4px">
            ${buscador('caf-q-venta', FV.q, 'cafFV', '🔍 Buscar producto…')}
            ${qv ? `<div style="color:#6e7681;font-size:11px;margin:-4px 0 6px">${visV.length} de ${activas.length}${Object.keys(VENTA).length ? ' · lo ya elegido se sigue mostrando' : ''}</div>` : ''}
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>${filas || '<tr><td style="padding:20px;text-align:center;color:#6e7681;font-size:12.5px">Ningún producto coincide.</td></tr>'}</tbody></table>
          <div style="padding:11px 14px;border-top:1px solid #21262d">
            ${totalVenta > 0 ? `<div style="color:#8b949e;font-size:12.5px;margin-bottom:8px">Total: <b style="color:#4e7a51;font-size:15px">L. ${fmt(totalVenta)}</b></div>` : ''}
            <div style="display:flex;gap:8px">
              <button onclick="cafVentaLimpiar()" style="background:#1c2027;color:#8b949e;border:1px solid #2a2e37;border-radius:7px;padding:8px 12px;cursor:pointer;font-size:12.5px">Limpiar</button>
              <button onclick="cafVentaRegistrar()" style="flex:1;background:#4e7a51;color:#fff;border:0;border-radius:7px;padding:9px;cursor:pointer;font-size:13px;font-weight:600">Registrar venta</button>
            </div>
          </div>
        </div>
        <div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;overflow:hidden">
          <div style="padding:11px 14px;border-bottom:1px solid #21262d"><b style="font-size:13.5px;color:#e6edf3">Últimas ventas</b></div>
          <table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>${listaVentas}</tbody></table>
        </div>
      </div>`
  }

  window.cafVentaSet = function (id, v) {
    const n = Math.max(0, Math.floor(Number(v) || 0))
    if (n > 0) VENTA[id] = n; else delete VENTA[id]
    // Repintar solo el total, para no perder el foco del input
    const cont = document.getElementById('caf-body')
    const tot = cont && cont.querySelector('b[style*="4e7a51"][style*="15px"]')
    if (tot) {
      const t = Object.keys(VENTA).reduce((a, k) => {
        const r = RECETAS.find(x => x.id === Number(k))
        return a + (r ? Number(r.precio_venta) * VENTA[k] : 0)
      }, 0)
      tot.textContent = 'L. ' + fmt(t)
    }
  }

  window.cafVentaLimpiar = function () { VENTA = {}; pintarBody() }

  window.cafVentaRegistrar = async function (forzar) {
    const lineas = Object.keys(VENTA).map(id => ({ receta_id: Number(id), cantidad: VENTA[id] }))
    if (!lineas.length) { toast('Poné qué se vendió', 'error'); return }
    try {
      const { data, error } = await sb().rpc('caf_venta_registrar', {
        p_lineas: lineas, p_nota: null, p_forzar: !!forzar, p_ubicacion_id: USEL
      })
      if (error) throw new Error(error.message)

      // No alcanza el stock: mostrar qué falta y dejar decidir
      if (data && data.ok === false && data.motivo === 'sin_stock') {
        const det = (data.faltan || []).map(f => `• ${f.insumo}: hay ${fmt(f.hay)} ${f.unidad}, se necesitan ${fmt(f.necesita)}`).join('\n')
        if (confirm(`No alcanza el inventario:\n\n${det}\n\n¿Registrar la venta igual?\nLa existencia va a quedar en negativo, lo que avisa que algo no cuadra (receta mal cargada o compra sin registrar).`)) {
          return window.cafVentaRegistrar(true)
        }
        return
      }

      VENTA = {}
      await refrescar(`Venta #${data.venta_id} · L. ${fmt(data.total)} (gana L. ${fmt(data.ganancia)})`)
      if (data.negativos && data.negativos.length) {
        toast(`⚠ Quedaron en negativo: ${data.negativos.map(n => n.insumo).join(', ')}`, 'error')
      }
    } catch (e) { toast(e.message, 'error') }
  }

  window.cafVentaAnular = async function (id) {
    const motivo = prompt('¿Por qué se anula esta venta?', 'Error al registrar')
    if (motivo === null) return
    try {
      await rpc('caf_venta_anular', { p_venta_id: id, p_motivo: motivo || null })
      await refrescar('Venta anulada · los insumos volvieron al inventario')
    } catch (e) { toast(e.message, 'error') }
  }

  // ── TAB CORTE DE CAJA ────────────────────────────────────────────────────
  //  El sistema sabe cuánto vendió cada punto → sabe cuánto efectivo debe
  //  entregar el encargado. Se registra lo que entregó de verdad y la
  //  diferencia queda a la vista.
  //  El encargado VE lo suyo pero NO cierra su corte: si pudiera, el control
  //  no serviría de nada. Lo cierra la administración.
  function vistaCortes () {
    const admin = veTodo()
    const visibles = admin ? PEND.filter(p => p.ubicacion_tipo !== 'central' || Number(p.ventas) > 0)
      : PEND.filter(p => p.ubicacion_id === USEL)

    const tarjetas = visibles.map(p => {
      const hay = Number(p.ventas) > 0
      return `
      <div style="background:#15171c;border:1px solid ${hay ? '#c0632f55' : '#2a2e37'};border-radius:10px;padding:13px 15px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:150px">
            <div style="color:#e6edf3;font-weight:600;font-size:14px">${p.ubicacion_tipo === 'central' ? '🏬' : '🏪'} ${esc(p.ubicacion)}</div>
            <div style="color:#6e7681;font-size:11px">${p.ventas} venta${p.ventas === 1 ? '' : 's'} sin cortar</div>
          </div>
          <div style="text-align:right">
            <div style="color:#6e7681;font-size:10.5px">DEBE ENTREGAR</div>
            <div style="color:${hay ? '#4e7a51' : '#6e7681'};font-weight:700;font-size:18px">L. ${fmt(p.esperado)}</div>
          </div>
          ${admin && hay ? `<button onclick="cafCorteCerrar(${p.ubicacion_id})" style="background:#c0632f;color:#fff;border:0;border-radius:8px;padding:9px 15px;cursor:pointer;font-size:13px;font-weight:600">Cerrar corte</button>` : ''}
        </div>
        ${hay ? `<div style="color:#6e7681;font-size:11px;margin-top:7px;border-top:1px solid #21262d;padding-top:7px">
          Desde ${new Date(p.desde).toLocaleString('es-HN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          · costo L. ${fmt(p.costo)} · ganancia <b style="color:#4e7a51">L. ${fmt(p.ganancia)}</b>
        </div>` : ''}
      </div>`
    }).join('')

    const hist = CORTES.length ? CORTES.map(c => {
      const dif = Number(c.diferencia)
      const col = c.anulado ? '#6e7681' : dif === 0 ? '#4e7a51' : dif < 0 ? '#f85149' : '#b8860b'
      const et = c.anulado ? 'ANULADO' : dif === 0 ? 'Cuadró' : dif < 0 ? 'Faltante' : 'Sobrante'
      return `<tr style="border-bottom:1px solid #21262d;${c.anulado ? 'opacity:.45' : ''}">
        <td style="padding:7px 8px;color:#6e7681;font-size:11px;white-space:nowrap">
          #${c.id}<br>${new Date(c.fecha).toLocaleDateString('es-HN', { day: '2-digit', month: 'short' })}
        </td>
        <td style="padding:7px 8px;font-size:12px">
          <div style="color:#e6edf3">${esc(c.ubicacion)}</div>
          <div style="color:#6e7681;font-size:10.5px">${c.ventas} venta${c.ventas === 1 ? '' : 's'}${Number(c.merma_valor) > 0 ? ` · merma L. ${fmt(c.merma_valor)}` : ''}</div>
        </td>
        <td style="padding:7px 8px;text-align:right;color:#8b949e;font-size:12px">L. ${fmt(c.esperado)}</td>
        <td style="padding:7px 8px;text-align:right;color:#e6edf3;font-size:12px">L. ${fmt(c.entregado)}</td>
        <td style="padding:7px 8px;text-align:right;white-space:nowrap">
          <span style="color:${col};font-weight:700;font-size:12.5px">${dif > 0 ? '+' : ''}${fmt(dif)}</span>
          <div style="color:${col};font-size:10px">${et}</div>
        </td>
        <td style="padding:7px 8px;text-align:right">
          ${(c.anulado || !admin) ? '' : `<button onclick="cafCorteAnular(${c.id})" title="Anular corte" style="background:none;border:0;color:#f85149;cursor:pointer;font-size:13px">✕</button>`}
        </td>
      </tr>`
    }).join('') : '<tr><td colspan="6" style="padding:22px;text-align:center;color:#6e7681">Sin cortes todavía.</td></tr>'

    const faltantes = CORTES.filter(c => !c.anulado && Number(c.diferencia) < 0)
    const totalFalt = faltantes.reduce((a, c) => a + Number(c.diferencia), 0)

    return `
      <div style="color:#8b949e;font-size:12.5px;margin-bottom:10px">
        ${admin
          ? 'El sistema calcula cuánto efectivo debe entregar cada punto según lo que vendió. Registrá lo que entregó de verdad.'
          : 'Esto es lo que llevás vendido. El corte lo cierra la administración cuando entregues el efectivo.'}
      </div>
      ${tarjetas || '<div style="background:#15171c;border:1px dashed #2a2e37;border-radius:10px;padding:26px;text-align:center;color:#6e7681">No hay ventas pendientes de cortar.</div>'}
      ${admin && faltantes.length ? `<div style="background:#3a1d1d;border-left:4px solid #b4472f;border-radius:0 8px 8px 0;padding:11px 15px;margin:14px 0;color:#f0c8c0;font-size:13px">
        <b>${faltantes.length} corte${faltantes.length > 1 ? 's' : ''} con faltante</b> · acumulado <b>L. ${fmt(Math.abs(totalFalt))}</b>
      </div>` : ''}
      <div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;overflow:hidden;margin-top:14px">
        <div style="padding:11px 14px;border-bottom:1px solid #21262d"><b style="font-size:13.5px;color:#e6edf3">Historial de cortes</b></div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#1c2027;color:#8b949e;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px">
            <th style="padding:8px;text-align:left">Corte</th>
            <th style="padding:8px;text-align:left">Punto</th>
            <th style="padding:8px;text-align:right">Esperado</th>
            <th style="padding:8px;text-align:right">Entregado</th>
            <th style="padding:8px;text-align:right">Diferencia</th>
            <th></th>
          </tr></thead>
          <tbody>${hist}</tbody>
        </table>
      </div>`
  }

  window.cafCorteCerrar = async function (ubicId) {
    let previo
    try {
      previo = await rpc('caf_corte_previo', { p_ubicacion_id: ubicId })
    } catch (e) { toast(e.message, 'error'); return }

    const esperado = Number(previo.esperado || 0)
    modal('💰 Cerrar corte de caja', [
      { k: 'entregado', label: 'Efectivo que entregó (L.)', tipo: 'num', valor: esperado,
        hint: `Debe entregar L. ${fmt(esperado)} por ${previo.ventas} venta(s).` },
      { k: 'nota', label: 'Nota', ph: 'Turno de la tarde, quién entregó…' }
    ], async (v, msg) => {
      if (v.entregado == null || v.entregado < 0) throw new Error('Poné cuánto entregó')
      const dif = Number(v.entregado) - esperado
      if (dif !== 0) {
        const txt = dif < 0
          ? `Falta L. ${fmt(Math.abs(dif))}.`
          : `Sobra L. ${fmt(dif)}.`
        if (!confirm(`${txt}\n\nEsperado: L. ${fmt(esperado)}\nEntregado: L. ${fmt(v.entregado)}\n\n¿Cerrar el corte así?`)) return false
      }
      const d = await rpc('caf_corte_registrar', {
        p_ubicacion_id: ubicId, p_entregado: v.entregado, p_nota: (v.nota || '').trim() || null
      })
      await refrescar(d.estado === 'cuadro'
        ? `Corte #${d.corte_id} · cuadró exacto ✓`
        : `Corte #${d.corte_id} · ${d.estado} de L. ${fmt(Math.abs(d.diferencia))}`)
    }, `${previo.ubicacion} · ${Number(previo.merma_valor) > 0 ? `merma reportada L. ${fmt(previo.merma_valor)}` : 'sin merma reportada'}`)
  }

  window.cafCorteAnular = async function (id) {
    const motivo = prompt('¿Por qué se anula este corte?\n\nLas ventas vuelven a quedar pendientes de cortar.', 'Se contó mal')
    if (motivo === null) return
    try {
      const d = await rpc('caf_corte_anular', { p_id: id, p_motivo: motivo || null })
      await refrescar(`Corte anulado · ${d.ventas_liberadas} venta(s) vuelven a pendiente`)
    } catch (e) { toast(e.message, 'error') }
  }

  // ── TAB ENVÍOS (traslados) ───────────────────────────────────────────────
  //  "Le mandé 5 cajas de refrescos al Punto 1". Son DOS movimientos atómicos:
  //  sale de Central, entra al punto. Nunca uno sin el otro — así el total no
  //  se infla ni se pierde producto en el camino.
  function vistaEnvios () {
    const puntos = UBIC.filter(u => u.tipo !== 'central')
    if (!enCentral()) {
      return `<div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;padding:22px;color:#8b949e;font-size:13px">
        Los envíos salen desde la <b style="color:#c0632f">Bodega Central</b>. Cambiá la ubicación de arriba a Central para despachar.
        <div style="margin-top:14px">${listaEnvios()}</div></div>`
    }

    const conStock = INSUMOS.filter(i => i.activo && Number(i.existencia) > 0)
    const filas = conStock.map(i => `
      <tr style="border-bottom:1px solid #21262d">
        <td style="padding:7px 8px">
          <div style="color:#e6edf3;font-size:12.5px">${esc(i.nombre)}</div>
          <div style="color:#6e7681;font-size:10.5px">hay ${fmt(i.existencia)} ${esc(i.unidad_base)}</div>
        </td>
        <td style="padding:7px 8px;width:110px">
          <input id="caf-env-${i.id}" type="number" min="0" step="any" value="${ENVIO[i.id] || ''}" placeholder="0"
                 oninput="cafEnvioSet(${i.id}, this.value, ${Number(i.existencia)})"
                 style="width:100%;background:#0d1117;border:1px solid #2a2e37;border-radius:7px;color:#e6edf3;padding:6px 9px;font-size:13px;text-align:center">
        </td>
      </tr>`).join('')

    const n = Object.keys(ENVIO).length
    return `
      <div style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(340px,1.3fr);gap:14px;align-items:start">
        <div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;overflow:hidden">
          <div style="padding:11px 14px;border-bottom:1px solid #21262d">
            <b style="font-size:13.5px;color:#e6edf3">Preparar envío</b>
            <div style="color:#6e7681;font-size:11.5px;margin-top:2px">Cuánto sale de Central hacia el punto.</div>
          </div>
          <div style="padding:11px 14px;border-bottom:1px solid #21262d">
            <label style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.4px">Enviar a</label>
            <select id="caf-env-destino" style="width:100%;margin-top:4px;background:#0d1117;border:1px solid #2a2e37;border-radius:7px;color:#e6edf3;padding:8px 10px;font-size:13px">
              ${puntos.map(u => `<option value="${u.id}">🏪 ${esc(u.nombre)}</option>`).join('')}
            </select>
          </div>
          <div style="max-height:400px;overflow:auto">
            <table style="width:100%;border-collapse:collapse"><tbody>
              ${filas || '<tr><td style="padding:22px;text-align:center;color:#6e7681;font-size:12.5px">No hay existencia en Central para enviar.</td></tr>'}
            </tbody></table>
          </div>
          <div style="padding:11px 14px;border-top:1px solid #21262d;display:flex;gap:8px">
            <button onclick="cafEnvioLimpiar()" style="background:#1c2027;color:#8b949e;border:1px solid #2a2e37;border-radius:7px;padding:8px 12px;cursor:pointer;font-size:12.5px">Limpiar</button>
            <button onclick="cafEnvioRegistrar()" style="flex:1;background:#c0632f;color:#fff;border:0;border-radius:7px;padding:9px;cursor:pointer;font-size:13px;font-weight:600">Despachar${n ? ` (${n})` : ''}</button>
          </div>
        </div>
        <div>${listaEnvios()}</div>
      </div>`
  }

  function listaEnvios () {
    const filas = TRAS.length ? TRAS.map(t => {
      const ls = (TLIN[t.id] || []).map(l => {
        const i = INSUMOS.find(x => x.id === l.insumo_id)
        return `${fmt(l.cantidad).replace(/\.00$/, '')} ${i ? i.nombre : '#' + l.insumo_id}`
      }).join(' · ')
      return `<tr style="border-bottom:1px solid #21262d;${t.anulado ? 'opacity:.45' : ''}">
        <td style="padding:7px 8px;color:#6e7681;font-size:11px;white-space:nowrap">
          #${t.id}<br>${new Date(t.fecha).toLocaleDateString('es-HN', { day: '2-digit', month: 'short' })}
        </td>
        <td style="padding:7px 8px;font-size:12px">
          <div style="color:#c0632f;font-weight:600">→ ${esc(ubicNombre(t.destino_id))}</div>
          <div style="color:#8b949e">${esc(ls || '—')}${t.anulado ? ' <span style="color:#f85149">ANULADO</span>' : ''}</div>
        </td>
        <td style="padding:7px 8px;text-align:right;color:#8b949e;font-size:12px;white-space:nowrap">L. ${fmt(t.valor)}</td>
        <td style="padding:7px 8px;text-align:right">
          ${(t.anulado || !veTodo()) ? '' : `<button onclick="cafEnvioAnular(${t.id})" title="Anular envío" style="background:none;border:0;color:#f85149;cursor:pointer;font-size:13px">✕</button>`}
        </td>
      </tr>`
    }).join('') : '<tr><td colspan="4" style="padding:22px;text-align:center;color:#6e7681">Sin envíos todavía.</td></tr>'

    return `<div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;overflow:hidden">
        <div style="padding:11px 14px;border-bottom:1px solid #21262d"><b style="font-size:13.5px;color:#e6edf3">Envíos recientes</b></div>
        <table style="width:100%;border-collapse:collapse"><tbody>${filas}</tbody></table>
      </div>`
  }

  window.cafEnvioSet = function (id, v, hay) {
    const n = Math.max(0, Number(v) || 0)
    if (n > 0) ENVIO[id] = n; else delete ENVIO[id]
    const el = document.getElementById('caf-env-' + id)
    if (el) el.style.borderColor = n > hay ? '#f85149' : '#2a2e37'
  }

  window.cafEnvioLimpiar = function () { ENVIO = {}; pintarBody() }

  window.cafEnvioRegistrar = async function (forzar) {
    const destino = Number(document.getElementById('caf-env-destino')?.value)
    const lineas = Object.keys(ENVIO).map(id => ({ insumo_id: Number(id), cantidad: ENVIO[id] }))
    if (!destino) { toast('Elegí a qué punto enviar', 'error'); return }
    if (!lineas.length) { toast('Poné qué vas a enviar', 'error'); return }
    try {
      const { data, error } = await sb().rpc('caf_traslado_registrar', {
        p_destino_id: destino, p_lineas: lineas, p_origen_id: null, p_nota: null, p_forzar: !!forzar
      })
      if (error) throw new Error(error.message)
      if (data && data.ok === false && data.motivo === 'sin_stock') {
        const det = (data.faltan || []).map(f => `• ${f.insumo}: hay ${fmt(f.hay)} ${f.unidad}, querés enviar ${fmt(f.envia)}`).join('\n')
        if (confirm(`No alcanza en Central:\n\n${det}\n\n¿Despachar igual?\nCentral va a quedar en negativo.`)) {
          return window.cafEnvioRegistrar(true)
        }
        return
      }
      ENVIO = {}
      await refrescar(`Envío #${data.traslado_id} despachado · L. ${fmt(data.valor)}`)
    } catch (e) { toast(e.message, 'error') }
  }

  window.cafEnvioAnular = async function (id) {
    const motivo = prompt('¿Por qué se anula este envío?', 'Error de despacho')
    if (motivo === null) return
    try {
      await rpc('caf_traslado_anular', { p_id: id, p_motivo: motivo || null })
      await refrescar('Envío anulado · el producto volvió a Central')
    } catch (e) { toast(e.message, 'error') }
  }

  // ── TAB LISTA DE COMPRAS ─────────────────────────────────────────────────
  //  "Voy a hacer 40 almuerzos y 25 sándwiches" → qué falta comprar.
  //  El cálculo lo hace el servidor (caf_requerimientos): explota las recetas,
  //  suma los insumos compartidos, resta la existencia y convierte a unidad
  //  de compra. Aquí solo se arma el plan y se muestra el resultado.
  function vistaCompras () {
    const activas = RECETAS.filter(r => r.activo)
    if (!activas.length) {
      return '<div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;padding:26px;text-align:center;color:#6e7681">Primero creá recetas con sus ingredientes. Después esta pantalla te dice qué comprar.</div>'
    }
    const filas = activas.map(r => `
      <tr style="border-bottom:1px solid #21262d">
        <td style="padding:8px">
          <div style="color:#e6edf3;font-weight:600">${esc(r.nombre)}</div>
          <div style="color:#6e7681;font-size:11px">${r.ingredientes} ingrediente${r.ingredientes === 1 ? '' : 's'}${r.ingredientes === 0 ? ' ⚠ sin receta' : ''}</div>
        </td>
        <td style="padding:8px;width:130px">
          <input id="caf-plan-${r.id}" type="number" min="0" step="1" value="${PLAN[r.id] || ''}" placeholder="0"
                 oninput="cafPlanSet(${r.id}, this.value)"
                 style="width:100%;background:#0d1117;border:1px solid #2a2e37;border-radius:7px;color:#e6edf3;padding:7px 10px;font-size:14px;text-align:center">
        </td>
      </tr>`).join('')

    return `
      <div style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(340px,1.5fr);gap:14px;align-items:start">
        <div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;overflow:hidden">
          <div style="padding:11px 14px;border-bottom:1px solid #21262d">
            <b style="font-size:13.5px;color:#e6edf3">¿Qué se va a preparar?</b>
            <div style="color:#6e7681;font-size:11.5px;margin-top:2px">Poné cuántos platos de cada uno.</div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>${filas}</tbody></table>
          <div style="padding:11px 14px;display:flex;gap:8px;border-top:1px solid #21262d">
            <button onclick="cafPlanLimpiar()" style="background:#1c2027;color:#8b949e;border:1px solid #2a2e37;border-radius:7px;padding:8px 12px;cursor:pointer;font-size:12.5px">Limpiar</button>
            <button onclick="cafCalcular()" style="flex:1;background:#c0632f;color:#fff;border:0;border-radius:7px;padding:9px;cursor:pointer;font-size:13px;font-weight:600">Calcular qué falta</button>
          </div>
        </div>
        <div id="caf-resultado">${REQ === null
          ? '<div style="background:#15171c;border:1px dashed #2a2e37;border-radius:10px;padding:34px 20px;text-align:center;color:#6e7681;font-size:13px">Poné las cantidades y tocá <b style="color:#c0632f">Calcular qué falta</b>.</div>'
          : tablaReq()}</div>
      </div>`
  }

  function tablaReq () {
    if (!REQ || !REQ.length) {
      return '<div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;padding:26px;text-align:center;color:#6e7681">Esas recetas no tienen ingredientes cargados todavía.</div>'
    }
    const faltan = REQ.filter(r => Number(r.falta) > 0)
    const total = faltan.reduce((a, r) => a + Number(r.costo_estimado || 0), 0)

    const filas = REQ.map(r => {
      const f = Number(r.falta)
      const alcanza = f <= 0
      return `<tr style="border-bottom:1px solid #21262d;${alcanza ? 'opacity:.55' : ''}">
        <td style="padding:8px">
          <span style="color:#e6edf3;font-weight:${alcanza ? '400' : '600'}">${esc(r.nombre)}</span>
          ${alcanza ? ' <span style="color:#4e7a51" title="Alcanza con lo que hay">✓</span>' : ''}
        </td>
        <td style="padding:8px;text-align:right;color:#8b949e;font-size:12.5px">${fmt(r.necesita)}</td>
        <td style="padding:8px;text-align:right;color:#8b949e;font-size:12.5px">${fmt(r.hay)}</td>
        <td style="padding:8px;text-align:right;color:${alcanza ? '#4e7a51' : '#f0a868'};font-weight:600">
          ${alcanza ? '—' : `${fmt(r.comprar)} <span style="color:#6e7681;font-weight:400;font-size:11px">${esc(r.unidad_compra)}</span>`}
        </td>
        <td style="padding:8px;text-align:right;color:#8b949e">${alcanza ? '—' : 'L. ' + fmt(r.costo_estimado)}</td>
        <td style="padding:8px;text-align:right">
          ${alcanza ? '' : `<button onclick="cafComprar(${r.insumo_id})" title="Registrar esta compra" style="background:none;border:0;cursor:pointer;font-size:15px">🛒</button>`}
        </td>
      </tr>`
    }).join('')

    const resumen = faltan.length
      ? `<div style="background:#2d2416;border-left:4px solid #b8860b;border-radius:0 8px 8px 0;padding:11px 15px;margin-bottom:12px;color:#f0dcb0;font-size:13px">
           Faltan <b>${faltan.length}</b> insumo${faltan.length > 1 ? 's' : ''}. Estimado: <b>L. ${fmt(total)}</b>
         </div>`
      : `<div style="background:#1a2e1c;border-left:4px solid #4e7a51;border-radius:0 8px 8px 0;padding:11px 15px;margin-bottom:12px;color:#c0e0c4;font-size:13px">
           ✓ Alcanza con lo que hay en existencia. No hay que comprar nada.
         </div>`

    return `
      ${resumen}
      <div style="background:#15171c;border:1px solid #2a2e37;border-radius:10px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#1c2027;color:#8b949e;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px">
            <th style="padding:9px 8px;text-align:left">Insumo</th>
            <th style="padding:9px 8px;text-align:right">Necesita</th>
            <th style="padding:9px 8px;text-align:right">Hay</th>
            <th style="padding:9px 8px;text-align:right">Comprar</th>
            <th style="padding:9px 8px;text-align:right">Costo</th>
            <th></th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      ${faltan.length ? `<div style="display:flex;gap:8px;margin-top:10px">
        <button onclick="cafCopiarLista()" style="background:#1c2027;color:#c0632f;border:1px solid #2a2e37;border-radius:7px;padding:8px 14px;cursor:pointer;font-size:12.5px">📋 Copiar lista para el mercado</button>
      </div>` : ''}
      <div style="color:#6e7681;font-size:11px;margin-top:8px">
        El costo es estimado, al último precio conocido. Al registrar la compra real se corrige solo.
      </div>`
  }

  window.cafPlanSet = function (id, v) {
    const n = Math.max(0, Math.floor(Number(v) || 0))
    if (n > 0) PLAN[id] = n; else delete PLAN[id]
  }

  window.cafPlanLimpiar = function () { PLAN = {}; REQ = null; pintarBody() }

  window.cafCalcular = async function () {
    const plan = Object.keys(PLAN).map(id => ({ receta_id: Number(id), cantidad: PLAN[id] }))
    if (!plan.length) { toast('Poné cuántos platos vas a hacer', 'error'); return }
    const cont = document.getElementById('caf-resultado')
    if (cont) cont.innerHTML = '<div style="padding:24px;color:#8b949e;text-align:center">Calculando…</div>'
    try {
      const { data, error } = await sb().rpc('caf_requerimientos', { p_plan: plan, p_ubicacion_id: USEL })
      if (error) throw new Error(error.message)
      REQ = data || []
      if (cont) cont.innerHTML = tablaReq()
    } catch (e) {
      REQ = null
      if (cont) cont.innerHTML = `<div style="padding:20px;color:#f85149">Error: ${esc(e.message)}</div>`
    }
  }

  window.cafCopiarLista = function () {
    if (!REQ) return
    const faltan = REQ.filter(r => Number(r.falta) > 0)
    if (!faltan.length) return
    const platos = Object.keys(PLAN).map(id => {
      const r = RECETAS.find(x => x.id === Number(id))
      return `${PLAN[id]} ${r ? r.nombre : ''}`
    }).join(', ')
    const total = faltan.reduce((a, r) => a + Number(r.costo_estimado || 0), 0)
    const txt = `LISTA DE COMPRAS\nPara: ${platos}\n\n` +
      faltan.map(r => `• ${r.nombre}: ${fmt(r.comprar)} ${r.unidad_compra}`).join('\n') +
      `\n\nEstimado: L. ${fmt(total)}`
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(() => toast('Lista copiada', 'success'), () => toast('No se pudo copiar', 'error'))
    } else {
      const ta = document.createElement('textarea')
      ta.value = txt; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy'); toast('Lista copiada', 'success') } catch (e) { toast('No se pudo copiar', 'error') }
      ta.remove()
    }
  }

  // ── PANEL DE ADMINISTRACIÓN: puntos y encargados ─────────────────────────
  window.cafAdmin = async function () {
    document.getElementById('caf-modal')?.remove()
    const ov = document.createElement('div')
    ov.id = 'caf-modal'
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10040;display:flex;align-items:center;justify-content:center;padding:20px'
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove() })
    ov.innerHTML = `<div style="background:#15171c;border:1px solid #2a2e37;border-radius:12px;max-width:560px;width:100%;padding:18px;color:#e6edf3;max-height:88vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <b style="font-size:15px">⚙ Puntos y encargados</b>
        <button onclick="document.getElementById('caf-modal').remove()" style="background:none;border:0;color:#8b8f98;font-size:22px;cursor:pointer;line-height:1">×</button>
      </div>
      <div id="caf-admin-body" style="color:#8b949e;font-size:13px">Cargando…</div>
    </div>`
    document.body.appendChild(ov)
    await pintarAdmin()
  }

  async function pintarAdmin () {
    const cont = document.getElementById('caf-admin-body')
    if (!cont) return
    let enc = []
    try {
      const { data, error } = await sb().rpc('caf_encargados_listar')
      if (error) throw new Error(error.message)
      enc = data || []
    } catch (e) {
      cont.innerHTML = `<div style="color:#f85149">No se pudo leer los encargados: ${esc(e.message)}</div>`
      return
    }

    const puntos = UBIC.map(u => `
      <tr style="border-bottom:1px solid #21262d">
        <td style="padding:7px 4px">
          <span style="color:#e6edf3;font-size:13px">${u.tipo === 'central' ? '🏬' : '🏪'} ${esc(u.nombre)}</span>
          <div style="color:#6e7681;font-size:10.5px">${esc(u.codigo)}</div>
        </td>
        <td style="padding:7px 4px;text-align:right;white-space:nowrap">
          <button onclick="cafUbicRenombrar(${u.id})" title="Cambiar nombre" style="background:none;border:0;cursor:pointer;font-size:13px">✏️</button>
          ${u.tipo === 'central' ? '' : `<button onclick="cafUbicDesactivar(${u.id})" title="Desactivar punto" style="background:none;border:0;color:#f85149;cursor:pointer;font-size:13px">✕</button>`}
        </td>
      </tr>`).join('')

    const opciones = UBIC.filter(u => u.tipo !== 'central')
      .map(u => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')

    const encargados = enc.length ? enc.map(e => `
      <tr style="border-bottom:1px solid #21262d">
        <td style="padding:7px 4px">
          <span style="color:#e6edf3;font-size:13px">${esc(e.nombre)}</span>
          <div style="color:#6e7681;font-size:10.5px">${esc(e.rol)}</div>
        </td>
        <td style="padding:7px 4px;text-align:right">
          ${e.rol === 'cafeteria'
            ? '<span style="color:#4e7a51;font-size:11.5px">ve todos los puntos</span>'
            : `<select onchange="cafAsignar('${e.usuario_id}', this.value)" style="background:#0d1117;border:1px solid ${e.ubicacion_id ? '#2a2e37' : '#b4472f'};border-radius:6px;color:#e6edf3;padding:5px 8px;font-size:12px">
                 <option value="">— sin asignar —</option>${opciones}
               </select>`}
        </td>
      </tr>`).join('') : '<tr><td colspan="2" style="padding:16px;text-align:center;color:#6e7681;font-size:12.5px">No hay usuarios con rol de cafetería todavía.</td></tr>'

    cont.innerHTML = `
      <div style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Puntos de venta</div>
      <table style="width:100%;border-collapse:collapse"><tbody>${puntos}</tbody></table>
      <button onclick="cafUbicNueva()" style="background:#1c2027;color:#c0632f;border:1px solid #2a2e37;border-radius:7px;padding:6px 12px;cursor:pointer;font-size:12px;margin-top:9px">+ Nuevo punto</button>

      <div style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin:18px 0 4px">Encargados</div>
      <table style="width:100%;border-collapse:collapse"><tbody>${encargados}</tbody></table>
      <div style="color:#6e7681;font-size:11px;margin-top:9px">
        Los usuarios con rol <b>cafeteria_punto</b> ven solo el punto que se les asigne. Se crean en Gestión de usuarios.
      </div>`
    // Marcar la asignación actual de cada encargado
    for (const e of enc) {
      if (e.rol === 'cafeteria' || !e.ubicacion_id) continue
      const sel = cont.querySelector(`select[onchange*="${e.usuario_id}"]`)
      if (sel) sel.value = String(e.ubicacion_id)
    }
  }

  window.cafAsignar = async function (usuarioId, ubicId) {
    try {
      await rpc('caf_usuario_asignar', {
        p_usuario_id: usuarioId,
        p_ubicacion_id: ubicId ? Number(ubicId) : null
      })
      toast(ubicId ? 'Encargado asignado' : 'Asignación quitada', 'success')
      await pintarAdmin()
    } catch (e) { toast(e.message, 'error'); await pintarAdmin() }
  }

  window.cafUbicNueva = async function () {
    const n = prompt('Nombre del punto de venta:', '')
    if (!n || !n.trim()) return
    try {
      await rpc('caf_ubicacion_crear', { p_nombre: n.trim() })
      UBIC = []                       // forzar recarga de ubicaciones
      await cargar(); render(); toast('Punto creado', 'success')
      await window.cafAdmin()
    } catch (e) { toast(e.message, 'error') }
  }

  window.cafUbicRenombrar = async function (id) {
    const u = UBIC.find(x => x.id === id); if (!u) return
    const n = prompt('Nombre:', u.nombre)
    if (n === null || !n.trim()) return
    try {
      await rpc('caf_ubicacion_editar', { p_id: id, p_campo: 'nombre', p_valor: n.trim() })
      UBIC = []
      await cargar(); render(); toast('Guardado', 'success')
      await window.cafAdmin()
    } catch (e) { toast(e.message, 'error') }
  }

  window.cafUbicDesactivar = async function (id) {
    if (!confirm('¿Desactivar este punto?\n\nSolo se puede si ya no tiene existencia.')) return
    try {
      await rpc('caf_ubicacion_editar', { p_id: id, p_campo: 'activo', p_valor: 'false' })
      UBIC = []; USEL = null
      await cargar(); render(); toast('Punto desactivado', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  // ── PANEL DE ADMINISTRACIÓN (fin) ────────────────────────────────────────

  // ── Modal genérico ───────────────────────────────────────────────────────
  // campos: [{k,label,tipo,valor,hint,opciones}]  ·  onOk(vals) → true para cerrar
  function modal (titulo, campos, onOk, subtitulo) {
    document.getElementById('caf-modal')?.remove()
    const ov = document.createElement('div')
    ov.id = 'caf-modal'
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10040;display:flex;align-items:center;justify-content:center;padding:20px'
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove() })
    const inputs = campos.map(c => {
      const id = 'cafm-' + c.k
      const base = 'width:100%;background:#0d1117;border:1px solid #2a2e37;border-radius:8px;color:#e6edf3;padding:9px 11px;font-size:13px;margin-top:4px'
      const ctrl = c.tipo === 'select'
        ? `<select id="${id}" style="${base}">${(c.opciones || []).map(o => `<option value="${esc(o[0])}"${String(c.valor) === String(o[0]) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`
        : `<input id="${id}" type="${c.tipo === 'num' ? 'number' : 'text'}" step="any" value="${esc(c.valor ?? '')}" placeholder="${esc(c.ph || '')}" style="${base}">`
      return `<div style="margin-bottom:11px">
        <label style="font-size:11.5px;color:#8b949e;text-transform:uppercase;letter-spacing:.4px">${esc(c.label)}</label>
        ${ctrl}
        ${c.hint ? `<div style="font-size:11px;color:#6e7681;margin-top:3px">${esc(c.hint)}</div>` : ''}
      </div>`
    }).join('')

    ov.innerHTML = `
      <div style="background:#15171c;border:1px solid #2a2e37;border-radius:12px;max-width:430px;width:100%;padding:18px;color:#e6edf3;max-height:86vh;overflow:auto">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px">
          <b style="font-size:15px">${esc(titulo)}</b>
          <button onclick="document.getElementById('caf-modal').remove()" style="background:none;border:0;color:#8b8f98;font-size:22px;cursor:pointer;line-height:1">×</button>
        </div>
        ${subtitulo ? `<div style="color:#8b949e;font-size:12px;margin-bottom:12px">${esc(subtitulo)}</div>` : '<div style="height:8px"></div>'}
        ${inputs}
        <div id="cafm-msg" style="font-size:12px;min-height:16px;margin-bottom:4px"></div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button onclick="document.getElementById('caf-modal').remove()" style="flex:1;background:#1c2027;color:#8b949e;border:1px solid #2a2e37;border-radius:8px;padding:10px;cursor:pointer;font-size:13px">Cancelar</button>
          <button id="cafm-ok" style="flex:1;background:#c0632f;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-size:13px;font-weight:600">Guardar</button>
        </div>
      </div>`
    document.body.appendChild(ov)

    const leer = () => {
      const v = {}
      for (const c of campos) {
        const el = document.getElementById('cafm-' + c.k)
        v[c.k] = c.tipo === 'num' ? num(el.value) : el.value
      }
      return v
    }
    const okBtn = ov.querySelector('#cafm-ok')
    okBtn.onclick = async () => {
      okBtn.disabled = true; okBtn.textContent = 'Guardando…'
      try {
        const cerrar = await onOk(leer(), ov.querySelector('#cafm-msg'))
        if (cerrar !== false) ov.remove()
      } catch (e) {
        const m = ov.querySelector('#cafm-msg')
        if (m) { m.style.color = '#f85149'; m.textContent = e.message || String(e) }
      }
      okBtn.disabled = false; okBtn.textContent = 'Guardar'
    }
    const first = ov.querySelector('input,select'); if (first) first.focus()
  }

  async function rpc (fn, args) {
    const { data, error } = await sb().rpc(fn, args)
    if (error) throw new Error(error.message)
    if (data && data.ok === false) throw new Error(data.mensaje || 'No se pudo guardar')
    return data
  }

  async function refrescar (msg) {
    await cargar()
    pintarBody()
    // repinta la alerta de mínimos
    render()
    // Si la lista de compras estaba calculada, la existencia cambió: recalcular
    // para que no quede mostrando un faltante que ya se compró.
    if (TAB === 'compras' && REQ) await window.cafCalcular()
    if (msg) toast(msg, 'success')
  }

  // ── Acciones: INSUMOS ────────────────────────────────────────────────────
  window.cafInsumoNuevo = function () {
    modal('Nuevo insumo', [
      { k: 'nombre', label: 'Nombre', ph: 'Ej: Jamón' },
      { k: 'grupo', label: 'Grupo ABC', tipo: 'select', valor: 'B', opciones: GRUPOS.map(g => [g[0], g[1]]), hint: 'A = caro, se porciona con cuidado. C = barato, se estima.' },
      { k: 'unidad_base', label: 'Unidad de stock', ph: 'oz, g, ml, unidad', hint: 'En qué se guarda la existencia. Es la que se usa en las recetas.' },
      { k: 'unidad_compra', label: 'Unidad de compra', ph: 'libra, bolsa, caja' },
      { k: 'factor', label: 'Cuántas unidades de stock trae 1 de compra', tipo: 'num', valor: 1, hint: 'Ej: 1 libra = 16 oz → poner 16' },
      { k: 'frac', label: '¿Se puede comprar en fracción?', tipo: 'select', valor: 'true', opciones: [['true', 'Sí (libra, kilo: se compra 2.5)'], ['false', 'No (bolsa, caja: solo entera)']], hint: 'La lista de compras redondea hacia arriba lo que no es fraccionable.' },
      { k: 'minimo', label: 'Stock mínimo (alerta)', tipo: 'num', valor: 0 }
    ], async v => {
      if (!v.nombre || v.nombre.trim().length < 2) throw new Error('Poné el nombre')
      if (!v.unidad_base || !v.unidad_base.trim()) throw new Error('Poné la unidad de stock')
      if (!v.factor || v.factor <= 0) throw new Error('El factor debe ser mayor que cero')
      await rpc('caf_insumo_crear', {
        p_nombre: v.nombre.trim(), p_unidad_base: v.unidad_base.trim(), p_grupo: v.grupo,
        p_unidad_compra: (v.unidad_compra || '').trim() || null, p_factor_compra: v.factor,
        p_costo_unitario: 0, p_stock_minimo: v.minimo || 0, p_fraccionable: v.frac === 'true'
      })
      await refrescar('Insumo creado')
    }, 'El costo se llena solo con la primera compra.')
  }

  window.cafInsumoEditar = function (id) {
    const i = insumoPorId(id); if (!i) return
    modal('Editar insumo', [
      { k: 'nombre', label: 'Nombre', valor: i.nombre },
      { k: 'grupo', label: 'Grupo ABC', tipo: 'select', valor: i.grupo, opciones: GRUPOS.map(g => [g[0], g[1]]) },
      { k: 'unidad_compra', label: 'Unidad de compra', valor: i.unidad_compra || '' },
      { k: 'factor', label: 'Factor de compra', tipo: 'num', valor: i.factor_compra },
      { k: 'frac', label: '¿Se puede comprar en fracción?', tipo: 'select', valor: String(i.fraccionable !== false), opciones: [['true', 'Sí (libra, kilo)'], ['false', 'No (bolsa, caja: solo entera)']] },
      { k: 'minimo', label: 'Stock mínimo', tipo: 'num', valor: i.stock_minimo },
      { k: 'activo', label: 'Estado', tipo: 'select', valor: String(i.activo), opciones: [['true', 'Activo'], ['false', 'Inactivo']] }
    ], async v => {
      const cambios = [
        ['nombre', v.nombre], ['grupo', v.grupo], ['unidad_compra', v.unidad_compra],
        ['factor_compra', v.factor], ['fraccionable', v.frac], ['stock_minimo', v.minimo], ['activo', v.activo]
      ]
      for (const [campo, val] of cambios) await rpc('caf_insumo_editar', { p_id: id, p_campo: campo, p_valor: String(val ?? '') })
      await refrescar('Guardado')
    }, `Unidad de stock: ${i.unidad_base}. El costo (L. ${fmt(i.costo_unitario)}) sale de las compras.`)
  }

  window.cafComprar = function (id) {
    const i = insumoPorId(id); if (!i) return
    const uc = i.unidad_compra || i.unidad_base
    modal('🛒 Registrar compra', [
      { k: 'cant', label: `Cantidad (en ${uc})`, tipo: 'num', ph: '5', hint: `1 ${uc} = ${fmt(i.factor_compra)} ${i.unidad_base}` },
      { k: 'costo', label: 'Costo total pagado (L.)', tipo: 'num', ph: '100' },
      { k: 'ref', label: 'Referencia', ph: 'Mercado, factura #…' }
    ], async (v, msg) => {
      if (!v.cant || v.cant <= 0) throw new Error('Poné la cantidad')
      if (v.costo == null || v.costo < 0) throw new Error('Poné el costo total')
      const d = await rpc('caf_compra_registrar', {
        p_insumo_id: id, p_cantidad_compra: v.cant, p_costo_total: v.costo,
        p_referencia: (v.ref || '').trim() || null, p_ubicacion_id: USEL
      })
      await refrescar(`Entraron ${fmt(d.entro_base)} ${d.unidad}`)
    }, i.nombre)
  }

  window.cafMerma = function (id) {
    const i = insumoPorId(id); if (!i) return
    modal('🗑️ Registrar merma', [
      { k: 'cant', label: `Cantidad perdida (en ${i.unidad_base})`, tipo: 'num', hint: `Hay ${fmt(i.existencia)} ${i.unidad_base} en existencia.` },
      { k: 'nota', label: 'Qué pasó', ph: 'Se pasaron, se quemó, se cayó…' }
    ], async v => {
      if (!v.cant || v.cant <= 0) throw new Error('Poné la cantidad')
      const d = await rpc('caf_merma_registrar', { p_insumo_id: id, p_cantidad: v.cant, p_nota: (v.nota || '').trim() || null, p_ubicacion_id: USEL })
      await refrescar(`Merma registrada: L. ${fmt(d.perdida)}`)
    }, i.nombre)
  }

  window.cafConteo = function (id) {
    const i = insumoPorId(id); if (!i) return
    modal('📋 Conteo físico', [
      { k: 'fisico', label: `Cuánto contaste (en ${i.unidad_base})`, tipo: 'num', hint: `El sistema dice que debería haber ${fmt(i.existencia)} ${i.unidad_base}.` },
      { k: 'nota', label: 'Nota', valor: 'Conteo semanal' }
    ], async v => {
      if (v.fisico == null || v.fisico < 0) throw new Error('Poné lo que contaste')
      const d = await rpc('caf_conteo_aplicar', { p_insumo_id: id, p_cantidad_fisica: v.fisico, p_nota: (v.nota || '').trim() || null, p_ubicacion_id: USEL })
      const dif = Number(d.diferencia || 0)
      await refrescar(dif === 0 ? 'Cuadró exacto ✓' : `Diferencia: ${fmt(dif)} ${i.unidad_base} (L. ${fmt(d.valor_diferencia)})`)
    }, i.nombre)
  }

  // ── Acciones: RECETAS ────────────────────────────────────────────────────
  window.cafReceta = function (id) { ABIERTA = ABIERTA === id ? null : id; pintarBody() }

  window.cafReventaNueva = function () {
    modal('+ Producto de reventa', [
      { k: 'nombre', label: 'Nombre del producto', ph: 'Ej: Coca Cola 500ml' },
      { k: 'precio', label: 'Precio de venta al cliente (L.)', tipo: 'num', ph: '25' },
      { k: 'ucompra', label: '¿Cómo lo comprás?', valor: 'caja', ph: 'caja, bolsa, paquete, unidad' },
      { k: 'factor', label: '¿Cuántas unidades trae?', tipo: 'num', valor: 1, hint: 'Ej: una caja de 24 sodas → 24. Si lo comprás suelto → 1.' },
      { k: 'categoria', label: 'Categoría', ph: 'bebidas, snacks, repostería' },
      { k: 'minimo', label: 'Avisame cuando queden menos de', tipo: 'num', valor: 0 },
      { k: 'cant', label: 'Primera compra: ¿cuántos compraste?', tipo: 'num', ph: 'opcional', hint: 'En unidades de compra (ej: 2 cajas). Podés dejarlo vacío.' },
      { k: 'costo', label: 'Primera compra: ¿cuánto pagaste en total? (L.)', tipo: 'num', ph: 'opcional' }
    ], async v => {
      if (!v.nombre || v.nombre.trim().length < 2) throw new Error('Poné el nombre')
      if (v.precio == null || v.precio < 0) throw new Error('Poné el precio de venta')
      if (!v.factor || v.factor <= 0) throw new Error('¿Cuántas unidades trae? Debe ser mayor que cero')
      const conCompra = v.cant != null && v.cant > 0 && v.costo != null && v.costo >= 0
      const d = await rpc('caf_reventa_crear', {
        p_nombre: v.nombre.trim(),
        p_precio_venta: v.precio,
        p_unidad_compra: (v.ucompra || '').trim() || 'unidad',
        p_factor_compra: v.factor,
        p_categoria: (v.categoria || '').trim() || null,
        p_stock_minimo: v.minimo || 0,
        p_grupo: 'B',
        p_cantidad_compra: conCompra ? v.cant : null,
        p_costo_compra: conCompra ? v.costo : null
      })
      ABIERTA = d.receta_id
      await refrescar(conCompra
        ? `Listo · entraron ${fmt(v.cant * v.factor)} unidades`
        : 'Producto creado · registrá la compra con 🛒 en Insumos')
    }, 'Se compra hecho y se vende tal cual. El sistema crea el insumo, su receta y el enlace de un solo paso.')
  }

  window.cafRecetaNueva = function () {
    modal('Nueva receta', [
      { k: 'nombre', label: 'Nombre del plato', ph: 'Ej: Sándwich de jamón' },
      { k: 'precio', label: 'Precio de venta (L.)', tipo: 'num', valor: 0 },
      { k: 'categoria', label: 'Categoría', ph: 'almuerzo, sándwich, bebida' }
    ], async v => {
      if (!v.nombre || v.nombre.trim().length < 2) throw new Error('Poné el nombre')
      const d = await rpc('caf_receta_crear', {
        p_nombre: v.nombre.trim(), p_precio_venta: v.precio || 0,
        p_categoria: (v.categoria || '').trim() || null
      })
      ABIERTA = d.id
      await refrescar('Receta creada — ahora agregale los ingredientes')
    })
  }

  window.cafRecetaEditar = function (id) {
    const r = RECETAS.find(x => x.id === id); if (!r) return
    modal('Editar receta', [
      { k: 'nombre', label: 'Nombre', valor: r.nombre },
      { k: 'precio', label: 'Precio de venta (L.)', tipo: 'num', valor: r.precio_venta },
      { k: 'categoria', label: 'Categoría', valor: r.categoria || '' },
      { k: 'activo', label: 'Estado', tipo: 'select', valor: String(r.activo), opciones: [['true', 'Activo'], ['false', 'Inactivo']] }
    ], async v => {
      for (const [campo, val] of [['nombre', v.nombre], ['precio_venta', v.precio], ['categoria', v.categoria], ['activo', v.activo]]) {
        await rpc('caf_receta_editar', { p_id: id, p_campo: campo, p_valor: String(val ?? '') })
      }
      await refrescar('Guardado')
    })
  }

  window.cafIngrAgregar = function (recetaId) {
    const usados = (INGR[recetaId] || []).map(g => g.insumo_id)
    const libres = INSUMOS.filter(i => i.activo && !usados.includes(i.id))
    if (!libres.length) { toast('No hay insumos disponibles para agregar', 'error'); return }
    modal('Agregar ingrediente', [
      { k: 'insumo', label: 'Insumo', tipo: 'select', opciones: libres.map(i => [i.id, `${i.nombre} (${i.unidad_base})`]) },
      { k: 'cant', label: 'Cantidad por porción', tipo: 'num', hint: 'En la unidad de stock del insumo. Ej: 6 (oz de arroz), 0.25 (de tomate).' }
    ], async v => {
      if (!v.cant || v.cant <= 0) throw new Error('Poné la cantidad')
      await rpc('caf_receta_ingrediente', { p_receta_id: recetaId, p_insumo_id: Number(v.insumo), p_cantidad: v.cant })
      await refrescar('Ingrediente agregado')
    })
  }

  window.cafIngrEditar = function (recetaId, insumoId, actual) {
    const i = insumoPorId(insumoId)
    modal('Cambiar cantidad', [
      { k: 'cant', label: `Cantidad (en ${unidad(i)})`, tipo: 'num', valor: actual }
    ], async v => {
      if (!v.cant || v.cant <= 0) throw new Error('La cantidad debe ser mayor que cero')
      await rpc('caf_receta_ingrediente', { p_receta_id: recetaId, p_insumo_id: insumoId, p_cantidad: v.cant })
      await refrescar('Guardado')
    }, i ? i.nombre : '')
  }

  window.cafIngrQuitar = async function (id, recetaId) {
    if (!confirm('¿Quitar este ingrediente de la receta?')) return
    try {
      await rpc('caf_receta_ingrediente_quitar', { p_id: id })
      ABIERTA = recetaId
      await refrescar('Ingrediente quitado')
    } catch (e) { toast(e.message, 'error') }
  }
})()