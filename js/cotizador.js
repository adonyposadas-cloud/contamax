/* ════════════════════════════════════════════════════════════════════
 *  CONTAMAX · MÓDULO COTIZADOR (Proformas)  v1
 *  Lee de: cotizador_ordenes, cotizador_orden_items, cotizador_compras
 *  Funciones:
 *   · Buscar productos/servicios en el histórico de órdenes (filtro por vehículo)
 *   · Autocompletar marca/modelo/año (tema CONTAMAX, .ac-list/.ac-item)
 *   · Historial de costo por producto (desde cotizador_compras)
 *   · Constructor de proforma con ajuste de precio por antigüedad
 *   · Generar PDF (jsPDF + autotable, carga diferida desde CDN)
 * ════════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'
  try { window.__cotBuild = '20260707-segord23' } catch (e) {}

  const sb = () => window._sb
  const $ = (id) => document.getElementById(id)
  const toast = (m, t) => (window.toast ? window.toast(m, t) : console.log(m))
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const fmt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
  const escLike = (s) => String(s == null ? '' : s).replace(/([%_\\])/g, '\\$1')
  const getPrioridad = (it) => {
    const p = String((it && it.prioridad) || '').toLowerCase()
    if (p === 'crit' || p === 'critico' || p === 'crítico') return 'crit'
    if (p === 'prev' || p === 'preventivo') return 'prev'
    return 'rec'
  }
  const PRIO_ORD = { crit: 0, rec: 1, prev: 2 }

  // ── Estado de la proforma en curso ──
  let PF = { id: null, correlativo: null, estado: 'pendiente', vendedor: '', cliente: '', placa: '', km: '', numero_orden: '', marca: '', modelo: '', anioVeh: '', anioDesde: '', anioHasta: '', traccion: '', combustible: '', motor: '', grupo: '', descuento: 0, notas: '', jefe_pista: '', items: [] }
  let modalTipo = 'p'        // 'p' productos | 's' servicios
  let searchResults = []     // resultados actuales del modal
  let ordenActual = null     // { ord, items } de la orden abierta en el paso 2
  let _editIdx = null        // índice del ítem manual en edición (null = agregar nuevo)
  let _editOrigDesc = null    // descripción original al abrir el editor (para corregir en base)
  const costCache = {}       // nombre_norm -> [{proveedor,costo,fecha}]
  let VEH = null             // { marcas:[], byMarca:{ MARCA:{ MODELO:{label,anios:Set} } } }
  let CATV = null            // catálogo maestro: { marcas:[{marca,marca_norm,activo,orden}], modelos:{ MARCA_NORM:[{modelo,modelo_norm,activo}] } }
  const _catExp = new Set()  // marcas expandidas en el panel Config
  let HIST_FILTRO = ''       // '' | 'pendiente' | 'autorizada'
  let TAB = 'inicio'         // pestaña activa (abre en el dashboard)
  let ES_SUPER = false       // super_admin: puede corregir descripciones en la base
  let _fixIdx = null         // ítem en corrección de descripción
  let SEG_CAT = ''           // filtro de seguimiento
  let SEG_DATA = []          // cotizaciones clasificadas para seguimiento
  let PEDPF = null           // proforma abierta en el modal de pedidos
  let _pedIdx = null         // índice del ítem que se está pidiendo
  let _pedModo = 'envia'     // modo de entrega en el modal: 'envia' | 'recoge'
  let _pedTimer = null       // intervalo para refrescar el tiempo transcurrido
  let PROVS = null           // cache de proveedores
  let verTodosCostos = false // privacidad: costos/proveedores ocultos por defecto

  const GAN_KEY = 'cot_gan_default'
  const getGanDefault = () => { let v = 30; try { const s = parseFloat(localStorage.getItem(GAN_KEY)); if (!isNaN(s)) v = s } catch (e) {} return v }
  const setGanDefault = (v) => { try { localStorage.setItem(GAN_KEY, String(v)) } catch (e) {} }
  const DEFAULT_CFG = {
    nombre_comercial: 'Tecnimax S. DE. R.L',
    rtn: '08019010278503',
    telefono: '+504 97045242',
    email: 'tecnimaxhn@gmail.com',
    direccion: 'BOULEVARD FF.AA 300 MTS DESPUES DE GASOLINERA UNO C.A',
    cai: '32ED13-9A0B4F-7DA5E0-63BE03-0909AA-C7',
    rango_desde: '000-002-01-00082001',
    rango_hasta: '000-002-01-00092000',
    fecha_limite: '2026-04-16',
    vigencia_dias: 30,
    terminos: 'Si el cliente suministra los repuestos, el precio de mano de obra puede variar. La garantía cubre exclusivamente la instalación, no las piezas externas.',
    garantia: 'Todo trabajo tiene un mes de garantía en repuesto y mano de obra, excepto repuestos usados.',
    aj_3: 5, aj_6: 10, aj_12: 15
  }
  let CFG = null
  const cfg = (k) => (CFG && CFG[k] != null && CFG[k] !== '') ? CFG[k] : DEFAULT_CFG[k]
  async function loadConfig () {
    if (CFG) return CFG
    try {
      const { data } = await sb().from('cotizador_config').select('data').eq('id', 1).single()
      CFG = Object.assign({}, DEFAULT_CFG, (data && data.data) || {})
    } catch (e) { console.error('[cotizador config]', e); CFG = Object.assign({}, DEFAULT_CFG) }
    await aplicarRangoSAR()
    return CFG
  }

  // Inyecta CAI / rango / fecha límite desde "Control de rango de ventas"
  // (tabla rangos_propios). Se elige el rango activo cuyo prefijo coincide con
  // el del cotizador. Si no se encuentra, se usan los valores manuales de config.
  async function aplicarRangoSAR () {
    if (!CFG) return
    CFG._sar = false
    try {
      const { data } = await sb().from('rangos_propios').select('*').eq('activo', true)
      if (!data || !data.length) return
      const prefCfg = String(CFG.rango_desde || '').replace(/-\d+$/, '')
      let r = data.find(x => x.prefijo && prefCfg && prefCfg.startsWith(String(x.prefijo)))
      if (!r) r = data.find(x => String(x.rango_desde || '').replace(/-\d+$/, '') === prefCfg)
      if (!r && data.length === 1) r = data[0]
      if (!r) return
      const cai = r.cai || r.codigo_cai || r.CAI
      if (cai) CFG.cai = cai
      if (r.rango_desde) CFG.rango_desde = r.rango_desde
      if (r.rango_hasta) CFG.rango_hasta = r.rango_hasta
      if (r.fecha_limite) CFG.fecha_limite = r.fecha_limite
      CFG._sar = true
    } catch (e) { console.error('[cotizador rango SAR]', e) }
  }
  const getTerminos = () => cfg('terminos')

  // ══════════════════════════════════════════════════════════
  //  INIT + RENDER DE LA VISTA
  // ══════════════════════════════════════════════════════════
  window.initCotizador = function () {
    const v = $('view-cotizador')
    if (!v) return
    if (!v.dataset.built) { v.innerHTML = viewHTML(); v.dataset.built = '1'; wire() }
    const prof = window._currentProfile ? window._currentProfile() : null
    if (prof && !PF.vendedor) { PF.vendedor = (prof.nombre || '').toUpperCase(); const el = $('cot-vend'); if (el) el.value = PF.vendedor }
    const esSuper = prof && (prof.rol === 'super_admin' || prof.rol === 'superadmin')
    ES_SUPER = !!esSuper
    const tabCfg = $('cot-tab-config'); if (tabCfg) tabCfg.style.display = esSuper ? '' : 'none'
    cargarVehiculos()
    cargarCatalogoVeh()
    loadConfig()
    loadGeneraciones()
    loadCompat()
    setNumLabel()
    renderItems()
    switchTab(TAB)
  }

  function viewHTML () {
    return `
    <style>
      #view-cotizador .cot-hint{font-size:11px;color:var(--green,#16a34a);font-weight:600;margin-top:3px}
      #view-cotizador .cot-hint2{font-size:10px;color:var(--text3,#8b949e);margin-top:1px}
      #view-cotizador input[type=number]::-webkit-outer-spin-button,#view-cotizador input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
      #view-cotizador input[type=number]{-moz-appearance:textfield;appearance:textfield}
      #view-cotizador .prio-btns{display:inline-flex;gap:3px;margin-top:5px}
      #view-cotizador .prio-btn{padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700;border:1px solid var(--border,#2a3340);cursor:pointer;background:transparent;color:var(--text3,#8b949e)}
      #view-cotizador .prio-btn.on.crit{background:rgba(220,38,38,.15);color:#f87171;border-color:#dc2626}
      #view-cotizador .prio-btn.on.rec{background:rgba(245,158,11,.15);color:var(--amber,#f59e0b);border-color:#f59e0b}
      #view-cotizador .prio-btn.on.prev{background:rgba(16,185,129,.15);color:#34d399;border-color:#10b981}
      #view-cotizador .cot-row{display:grid;grid-template-columns:1fr 78px 110px 70px 96px 34px;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border,#2a3340)}
      #view-cotizador .cot-row.head{border-bottom:1px solid var(--border,#2a3340);color:var(--text3,#8b949e);font-size:11px;text-transform:uppercase;letter-spacing:.5px;padding:6px 0}
      #view-cotizador .cot-badge{display:inline-block;background:var(--gold,#c8a24a);color:#000;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;margin-right:5px}
      #view-cotizador .cot-adj{font-size:10px;color:var(--gold,#c8a24a);font-weight:600;margin-top:2px}
      #view-cotizador .cot-in{width:100%;padding:6px 8px;background:var(--bg2,#161b22);border:1px solid var(--border,#2a3340);border-radius:6px;color:var(--text,#e6edf3);font-size:13px}
      #view-cotizador .cot-si{padding:10px 12px;border-bottom:1px solid var(--border,#2a3340);cursor:pointer}
      #view-cotizador .cot-si:hover{background:var(--bg3,#1c2333)}
      #view-cotizador .cot-tot{display:flex;justify-content:space-between;padding:5px 0;font-size:14px}
      #view-cotizador .cot-tot.big{font-size:18px;font-weight:700;color:var(--gold,#c8a24a);border-top:1px solid var(--border,#2a3340);margin-top:6px;padding-top:10px}
      #view-cotizador .cot-ac-wrap{position:relative}
      #view-cotizador .ac-list{position:absolute;top:100%;left:0;right:0;z-index:100;background:var(--bg2,#161b22);border:1px solid var(--border,#2a3340);border-radius:0 0 6px 6px;max-height:200px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.4)}
      #view-cotizador .ac-item{padding:8px 12px;font-size:13px;cursor:pointer;color:var(--text,#e6edf3);border-bottom:0.5px solid var(--border,#2a3340)}
      #view-cotizador .ac-item:hover,#view-cotizador .ac-item.active{background:var(--gold,#c8a24a);color:#000}
      #view-cotizador .cot-oi{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border,#2a3340);border-radius:8px;margin-bottom:8px;cursor:pointer}
      #view-cotizador .cot-oi.dest{border-color:var(--gold,#c8a24a);background:rgba(200,162,74,.08)}
      #view-cotizador .cot-oi input{width:auto;flex-shrink:0}
      #view-cotizador .cot-tabs{display:flex;gap:4px}
      #view-cotizador .cot-tab{padding:7px 14px;border-radius:8px;border:1px solid var(--border,#2a3340);background:var(--bg2,#161b22);color:var(--text3,#8b949e);cursor:pointer;font-size:13px;font-weight:500}
      #view-cotizador .cot-tab.on{background:var(--gold,#c8a24a);color:#000;border-color:var(--gold,#c8a24a)}
      #view-cotizador .cot-stat{background:var(--bg2,#161b22);border:1px solid var(--border,#2a3340);border-radius:10px;padding:14px 16px}
      #view-cotizador .cot-stat .n{font-size:22px;font-weight:800;color:var(--gold,#c8a24a)}
      #view-cotizador .cot-stat .l{font-size:11px;color:var(--text3,#8b949e);margin-top:2px}
      #view-cotizador .cot-chip{padding:5px 12px;border-radius:14px;border:1px solid var(--border,#2a3340);background:transparent;color:var(--text3,#8b949e);cursor:pointer;font-size:12px}
      #view-cotizador .cot-chip.on{background:var(--gold,#c8a24a);color:#000;border-color:var(--gold,#c8a24a)}
      #view-cotizador .cot-hrow{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border,#2a3340);border-radius:8px;margin-bottom:8px}
      #view-cotizador .cot-estado{font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;text-transform:uppercase}
      #view-cotizador .cot-estado.pendiente{background:rgba(245,158,11,.15);color:var(--amber,#f59e0b)}
      #view-cotizador .cot-estado.autorizada{background:rgba(22,163,74,.15);color:var(--green,#16a34a)}
      #view-cotizador .cot-estado.finalizada{background:rgba(139,148,158,.15);color:var(--text3,#8b949e)}
      #view-cotizador .ped-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border,#2a3340)}
      #view-cotizador .ped-btn{font-size:11px;font-weight:700;padding:4px 10px;border-radius:8px;border:1px solid var(--border,#2a3340);cursor:pointer;background:transparent}
      #view-cotizador .ped-pedir{color:var(--red,#f85149);border-color:var(--red,#f85149)}
      #view-cotizador .ped-bodega{color:#a855f7;border-color:#a855f7}
      #view-cotizador .ped-llego{color:var(--green,#16a34a);border-color:var(--green,#16a34a)}
      #view-cotizador .ped-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px}
      #view-cotizador #cot-vend,#view-cotizador #cot-cli,#view-cotizador #cot-ma,#view-cotizador #cot-mo,#view-cotizador #cot-anio{text-transform:uppercase}
      @media (max-width: 680px) {
        #view-cotizador .page-header{flex-wrap:wrap;gap:8px}
        #view-cotizador .cot-tabs{flex-wrap:wrap}
        #view-cotizador .cot-tab{padding:6px 11px;font-size:12px}
        #view-cotizador .form-card{padding:12px}
        #view-cotizador .form-card-title{flex-wrap:wrap;gap:6px}
        #view-cotizador .form-grid{grid-template-columns:1fr !important}
        #view-cotizador #cot-dash-stats,#view-cotizador #cot-seg-stats{grid-template-columns:repeat(2,1fr) !important}
        #view-cotizador [style*="justify-content:flex-end"]{flex-wrap:wrap}
        #view-cotizador [style*="justify-content:space-between"]{flex-wrap:wrap}
        #view-cotizador .cot-row{grid-template-columns:52px 84px 46px 1fr 30px;column-gap:6px;row-gap:2px}
        #view-cotizador .cot-row > div:first-child{grid-column:1 / -1;margin-bottom:4px}
        #view-cotizador .cot-row.head{display:none}
        #view-cotizador .cot-hrow{flex-wrap:wrap}
        #view-cotizador .cot-in{font-size:16px}
        #view-cotizador .cot-stat{padding:11px 12px}
        #view-cotizador .cot-stat .n{font-size:18px}
        #view-cotizador .cot-tot{font-size:13px}
        #view-cotizador .modal{width:96vw !important;max-height:90vh;overflow-y:auto}
      }
    </style>

    <div class="page-header">
      <div>
        <div class="page-title">🧾 Cotizador · Proformas</div>
        <div class="page-sub" id="cot-num-label">Nueva cotización</div>
      </div>
      <div class="cot-tabs">
        <button class="cot-tab" data-tab="inicio">Inicio</button>
        <button class="cot-tab on" data-tab="nueva">Nueva</button>
        <button class="cot-tab" data-tab="cotizacion">Cotización</button>
        <button class="cot-tab" data-tab="seguimiento">Seguimiento</button>
        <button class="cot-tab" data-tab="proveedores">📇 Proveedores</button>
        <button class="cot-tab" data-tab="generaciones">🚗 Generaciones</button>
        <button class="cot-tab" data-tab="estadisticas">📊 Estadísticas</button>
        <button class="cot-tab" data-tab="config" id="cot-tab-config" style="display:none">⚙ Config</button>
      </div>
    </div>

    <!-- PANEL INICIO (Dashboard) -->
    <div id="cot-panel-inicio" class="cot-panel" style="display:none">
      <div id="cot-dash-stats" style="display:grid;grid-template-columns:repeat(5,1fr);gap:11px;margin-bottom:16px"></div>
      <div class="form-card">
        <div class="form-card-title" style="justify-content:space-between"><span>Cotizaciones pendientes</span><button class="btn btn-ghost" id="cot-dash-nueva" style="font-size:12px;padding:6px 12px">＋ Nueva cotización</button></div>
        <div id="cot-dash-list"><div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Cargando…</div></div>
      </div>
      <div class="form-card" style="margin-top:14px">
        <div class="form-card-title" style="justify-content:space-between"><span>⚡ Pedidos rápidos</span><button class="btn btn-ghost" id="cot-pr-hist" style="font-size:11px;padding:4px 10px">📋 Ver historial</button></div>
        <div style="font-size:12px;color:var(--text3,#8b949e);margin:-4px 0 10px">Repuestos sueltos que te piden (fuera de cotización). Anotalos para no olvidarlos; el contador corre desde que los creás hasta que llegan.</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
          <div class="fld" style="flex:2;min-width:150px"><label>Repuesto</label><input id="cot-pr-rep" class="cot-in" placeholder="Ej: SOPORTE DE MOTOR" style="text-transform:uppercase"></div>
          <div class="fld" style="flex:0 0 70px"><label>Cant.</label><input id="cot-pr-cant" class="cot-in" type="number" value="1" min="1"></div>
          <div class="fld"><label>Vehículo</label><input id="cot-pr-veh" class="cot-in" placeholder="Toyota Corolla 2015"></div>
          <div class="fld"><label>Pedido por</label><input id="cot-pr-por" class="cot-in" placeholder="Cliente, mecánico"></div>
          <button class="btn btn-gold" id="cot-pr-add" style="font-size:12px;padding:8px 14px">✓ Agregar</button>
        </div>
        <div id="cot-pr-list"></div>
      </div>
    </div>

    <!-- PANEL NUEVA (constructor) -->
    <div id="cot-panel-nueva" class="cot-panel">
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px">
        <button class="btn btn-ghost" id="cot-btn-nueva">＋ Nueva</button>
        <button class="btn btn-ghost" id="cot-btn-guardar">💾 Guardar</button>
        <button class="btn btn-ghost" id="cot-btn-ot">🔧 Orden Trabajo</button>
        <button class="btn btn-gold" id="cot-btn-pdf">📄 Generar PDF</button>
      </div>

    <div id="cot-recban" style="display:none;background:rgba(200,162,74,.1);border:1px solid var(--gold,#c8a24a);border-radius:8px;padding:8px 14px;margin-bottom:12px;font-size:13px;color:var(--gold,#c8a24a);display:none;align-items:center;justify-content:space-between">
      <span id="cot-recmsg"></span>
      <button class="btn btn-ghost" id="cot-recnew" style="padding:3px 10px;font-size:12px">✕ Nueva</button>
    </div>

    <div class="form-card">
      <div class="form-card-title">Información general</div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
        <div class="fld"><label>Vendedor</label><input id="cot-vend" class="cot-in" placeholder="Nombre del vendedor"></div>
        <div class="fld"><label>Cliente</label><input id="cot-cli" class="cot-in" placeholder="Nombre del cliente"></div>
        <div class="fld"><label>Jefe de pista <span style="font-weight:400;color:var(--text3,#8b949e);font-size:10px;text-transform:none">(autoriza)</span></label><input id="cot-jefe" class="cot-in" placeholder="Responsable de autorizar" style="text-transform:uppercase"></div>
      </div>
      <div class="form-grid" style="margin-top:10px;grid-template-columns:1fr 1fr 1fr">
        <div class="fld"><label>Placa <span style="font-weight:400;color:var(--text3,#8b949e);font-size:10px;text-transform:none">(recupera cotización pendiente)</span></label>
          <div class="cot-ac-wrap">
            <input id="cot-placa" class="cot-in" placeholder="Ej: HBL3999" autocomplete="off" style="text-transform:uppercase">
            <div class="ac-list" id="cot-placa-ac" style="display:none"></div>
          </div>
        </div>
        <div class="fld"><label>Kilometraje <span style="font-weight:400;color:var(--text3,#8b949e);font-size:10px;text-transform:none">(opcional)</span></label><input id="cot-km" class="cot-in" placeholder="Km"></div>
        <div class="fld"><label>N° Orden Taller <span style="color:var(--red,#f85149)">*</span> <span style="font-weight:400;color:var(--text3,#8b949e);font-size:10px;text-transform:none">(Alpha — obligatorio, único)</span></label><input id="cot-orden" class="cot-in" placeholder="Ej: 53704" autocomplete="off"></div>
      </div>
      <div class="form-grid" style="margin-top:10px;grid-template-columns:1fr 1fr 1fr">
        <div class="fld"><label>Marca</label>
          <div class="cot-ac-wrap">
            <input id="cot-ma" class="cot-in" placeholder="Escribí o elegí…" autocomplete="off">
            <div class="ac-list" id="cot-ma-ac" style="display:none"></div>
          </div>
        </div>
        <div class="fld"><label>Modelo</label>
          <div class="cot-ac-wrap">
            <input id="cot-mo" class="cot-in" placeholder="Escribí o elegí…" autocomplete="off">
            <div class="ac-list" id="cot-mo-ac" style="display:none"></div>
          </div>
        </div>
        <div class="fld"><label>Año del vehículo → generación (filtra repuestos)</label>
          <div style="display:flex;gap:8px">
            <input id="cot-anio-veh" class="cot-in" placeholder="Año" inputmode="numeric" maxlength="4" style="width:34%">
            <input id="cot-anio-desde" class="cot-in" placeholder="Desde" inputmode="numeric" maxlength="4" style="width:33%">
            <input id="cot-anio-hasta" class="cot-in" placeholder="Hasta" inputmode="numeric" maxlength="4" style="width:33%">
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
            <button type="button" class="btn btn-ghost" id="cot-detalle-btn" style="font-size:11px;padding:4px 10px">➕ Detalle (tracción/combustible/grupo)</button>
            <span id="cot-detalle-resumen" style="font-size:11px;color:var(--gold,#c8a24a)"></span>
          </div>
        </div>
      </div>
      <div id="cot-veh-hint" style="font-size:11px;color:var(--text3,#8b949e);margin-top:8px"></div>
    </div>

    <div class="form-card">
      <div class="form-card-title" style="justify-content:space-between">
        <span>Agregar ítems</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" id="cot-buscar-prod" style="font-size:12px;padding:6px 12px">🔎 Buscar producto</button>
          <button class="btn btn-ghost" id="cot-buscar-serv" style="font-size:12px;padding:6px 12px">🔧 Buscar servicio</button>
          <button class="btn btn-ghost" id="cot-manual" style="font-size:12px;padding:6px 12px">➕ Manual</button>
        </div>
      </div>
      <div id="cot-solic-panel" style="display:none;background:rgba(240,165,0,.06);border:1px solid rgba(240,165,0,.25);border-radius:8px;padding:10px;margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:var(--gold,#c8a24a);margin-bottom:2px">📋 Solicitados por el jefe de pista</div>
        <div style="font-size:11px;color:var(--text3,#8b949e);margin-bottom:8px">Agregá cada uno a la cotización con ➕ y quedará marcado. Los que no correspondan, dejalos sin agregar.</div>
        <div id="cot-solic-list"></div>
      </div>
      <div id="cot-items">
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text3,#8b949e);margin-bottom:6px;flex-wrap:wrap">
          <span>⚙ Ganancia default (productos manuales):</span>
          <input id="cot-gan-def" class="cot-in" type="number" style="width:74px" value="30" min="0" step="0.5"><span>%</span>
          <span style="color:var(--text3,#8b949e)">— se aplica al agregar; siempre editable por producto.</span>
          <label style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;color:var(--gold,#c8a24a);font-weight:600" title="Ver/ocultar"><input type="checkbox" id="cot-ver-costos" style="cursor:pointer"> 👁</label>
        </div>
        <div id="cot-items-body"><div style="text-align:center;color:var(--text3,#8b949e);padding:24px">Sin ítems. Buscá en órdenes o agregá manual.</div></div>
      </div>
      <div style="max-width:360px;margin-left:auto;margin-top:14px">
        <div class="cot-tot"><span style="color:var(--text3,#8b949e)">Descuento global %</span><input id="cot-desc" class="cot-in" type="number" min="0" max="100" step="0.5" value="0" style="width:80px;text-align:right"></div>
        <div class="cot-tot"><span style="color:var(--text3,#8b949e)">Subtotal</span><span id="cot-sub">L. 0.00</span></div>
        <div class="cot-tot" id="cot-desc-row" style="display:none;color:var(--amber,#f59e0b)"><span id="cot-desc-lbl">Descuento</span><span id="cot-desc-monto">-L. 0.00</span></div>
        <div class="cot-tot"><span style="color:var(--text3,#8b949e)">ISV</span><span id="cot-isv">L. 0.00</span></div>
        <div class="cot-tot big"><span>Total</span><span id="cot-total">L. 0.00</span></div>
      </div>
    </div>

    <div class="form-card">
      <div class="form-card-title">Observaciones</div>
      <div class="fld"><label>Observaciones para el cliente <span style="font-weight:400;color:var(--text3,#8b949e);font-size:10px;text-transform:none">(salen en el PDF)</span></label>
        <textarea id="cot-notas" class="cot-in" rows="2" placeholder="Ej: Repuestos con garantía de 3 meses. Mano de obra incluida."></textarea>
      </div>
    </div>
    <div class="form-card" id="cot-ctx-card" style="display:none;border-color:rgba(240,165,0,.25)">
      <div class="form-card-title"><span>🩺 Contexto de la revisión</span> <span style="font-weight:400;color:var(--text3,#8b949e);font-size:10px;text-transform:none">(no sale en el PDF)</span></div>
      <div id="cot-ctx-motivo" style="margin-bottom:8px;display:none">
        <div style="font-size:11px;font-weight:700;color:var(--gold,#c8a24a);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Lo que se le reportó al técnico</div>
        <div id="cot-ctx-motivo-txt" style="font-size:13px;white-space:pre-wrap;color:var(--text,#e6edf3)"></div>
      </div>
      <div id="cot-ctx-diag" style="display:none">
        <div style="font-size:11px;font-weight:700;color:var(--gold,#c8a24a);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Diagnóstico del técnico (recomendaciones)</div>
        <div id="cot-ctx-diag-txt" style="font-size:13px;white-space:pre-wrap;color:var(--text,#e6edf3)"></div>
      </div>
    </div>
    </div><!-- /cot-panel-nueva -->

    <!-- PANEL COTIZACIÓN (Historial) -->
    <div id="cot-panel-cotizacion" class="cot-panel" style="display:none">
      <div class="form-card">
        <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
          <input id="cot-hist-q" class="cot-in" placeholder="🔍 Buscar por placa, cliente o N°..." style="flex:1;min-width:220px;text-transform:uppercase">
          <div style="display:flex;gap:6px" id="cot-hist-filtros">
            <button class="cot-chip on" data-estado="">Todas</button>
            <button class="cot-chip" data-estado="pendiente">Pendientes</button>
            <button class="cot-chip" data-estado="autorizada">Autorizadas</button>
          </div>
        </div>
        <div id="cot-hist-list"><div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Cargando…</div></div>
      </div>
    </div>

    <!-- PANEL SEGUIMIENTO (comercial) -->
    <div id="cot-panel-seguimiento" class="cot-panel" style="display:none">
      <div id="cot-seg-stats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin-bottom:16px"></div>
      <div class="form-card">
        <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
          <div style="display:flex;gap:6px;flex-wrap:wrap" id="cot-seg-filtros">
            <button class="cot-chip on" data-cat="">Todas sin cerrar</button>
            <button class="cot-chip" data-cat="sin_orden">Sin orden</button>
            <button class="cot-chip" data-cat="sin_factura">Sin factura</button>
            <button class="cot-chip" data-cat="facturo_menos">Facturó menos</button>
          </div>
          <input id="cot-seg-q" class="cot-in" placeholder="🔍 Cliente, placa, N° o orden…" style="flex:1;min-width:180px;text-transform:uppercase">
          <button class="btn btn-ghost" id="cot-seg-export" style="font-size:12px;padding:6px 12px">⬇ Exportar CSV</button>
        </div>
        <div id="cot-seg-list"><div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Cargando…</div></div>
      </div>
    </div>

    <!-- PANEL PROVEEDORES (contactos) -->
    <div id="cot-panel-proveedores" class="cot-panel" style="display:none">
      <div class="form-card">
        <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
          <div style="font-weight:700;color:var(--gold,#c8a24a)">📇 Contactos de proveedores</div>
          <input id="cot-prov-q" class="cot-in" placeholder="🔍 Buscar proveedor…" style="flex:1;min-width:180px;text-transform:uppercase">
          <button class="btn btn-ghost" id="cot-prov-sync" style="font-size:12px;padding:6px 12px" title="Traer proveedores nuevos desde las compras">⟳ Sincronizar</button>
        </div>
        <div style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:10px">Tocá 📞/💬 para llamar o mandar WhatsApp. Editá el teléfono y el contacto de cada proveedor.</div>
        <div id="cot-prov-list"><div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Cargando…</div></div>
      </div>
    </div>

    <!-- PANEL GENERACIONES (rangos de años por modelo) -->
    <div id="cot-panel-generaciones" class="cot-panel" style="display:none">
      <div class="form-card">
        <div style="font-weight:700;color:var(--gold,#c8a24a);margin-bottom:10px">🚗 Generaciones de modelos (rangos de años)</div>
        <div style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:12px">Al cotizar, poné el año del vehículo y el sistema detecta la generación (ej. CR-V 2014 → 2012–2016) y filtra los repuestos de toda la generación.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border,#2a3340)">
          <div class="cot-ac-wrap"><input id="cot-gen-ma" class="cot-in" placeholder="Marca" autocomplete="off" style="width:120px;text-transform:uppercase"><div class="ac-list" id="cot-gen-ma-ac" style="display:none"></div></div>
          <div class="cot-ac-wrap"><input id="cot-gen-mo" class="cot-in" placeholder="Modelo" autocomplete="off" style="width:120px;text-transform:uppercase"><div class="ac-list" id="cot-gen-mo-ac" style="display:none"></div></div>
          <input id="cot-gen-d" class="cot-in" placeholder="Desde" inputmode="numeric" maxlength="4" style="width:72px">
          <input id="cot-gen-h" class="cot-in" placeholder="Hasta" inputmode="numeric" maxlength="4" style="width:72px">
          <select id="cot-gen-tr" class="cot-in" style="width:100px" title="Tracción"></select>
          <select id="cot-gen-co" class="cot-in" style="width:110px" title="Combustible"></select>
          <select id="cot-gen-gr" class="cot-in" style="width:120px" title="Grupo de repuesto"></select>
          <select id="cot-gen-mt" class="cot-in" style="width:90px" title="Motor"></select>
          <button class="btn btn-gold" id="cot-gen-add" style="font-size:12px;padding:7px 14px">+ Agregar</button>
        </div>
        <input id="cot-gen-q" class="cot-in" placeholder="🔍 Buscar marca o modelo…" style="width:100%;text-transform:uppercase;margin-bottom:10px">
        <div id="cot-gen-list"><div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Cargando…</div></div>
      </div>

      <div class="form-card" style="margin-top:14px">
        <div style="font-weight:700;color:var(--gold,#c8a24a);margin-bottom:8px">🔧 Listas (opciones de los desplegables)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <select id="cot-lista-tipo" class="cot-in" style="width:130px"><option value="traccion">Tracción</option><option value="combustible">Combustible</option><option value="motor">Motor</option><option value="grupo">Grupo</option></select>
          <input id="cot-lista-val" class="cot-in" placeholder="Nuevo valor" style="width:160px;text-transform:uppercase">
          <button class="btn btn-gold" id="cot-lista-add" style="font-size:12px;padding:7px 14px">+ Agregar</button>
        </div>
        <div id="cot-lista-list" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      </div>

      <div class="form-card" style="margin-top:14px">
        <div style="font-weight:700;color:var(--gold,#c8a24a);margin-bottom:8px">📖 Diccionario pieza → grupo</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <input id="cot-pal-palabra" class="cot-in" placeholder="Pieza (ej. CALIPER)" style="width:160px;text-transform:uppercase">
          <select id="cot-pal-grupo" class="cot-in" style="width:140px"></select>
          <button class="btn btn-gold" id="cot-pal-add" style="font-size:12px;padding:7px 14px">+ Agregar</button>
          <input id="cot-pal-q" class="cot-in" placeholder="🔍 buscar…" style="width:140px;text-transform:uppercase">
        </div>
        <div id="cot-pal-list" style="max-height:220px;overflow:auto"></div>
      </div>

      <div class="form-card" style="margin-top:14px">
        <div style="font-weight:700;color:var(--gold,#c8a24a);margin-bottom:8px">✏️ Autocorrector (mal → bien)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <input id="cot-cor-mal" class="cot-in" placeholder="Mal escrito (FRICSION)" style="width:160px;text-transform:uppercase">
          <span style="color:var(--text3,#8b949e)">→</span>
          <input id="cot-cor-bien" class="cot-in" placeholder="Correcto (FRICCION)" style="width:160px;text-transform:uppercase">
          <button class="btn btn-gold" id="cot-cor-add" style="font-size:12px;padding:7px 14px">+ Agregar</button>
        </div>
        <div id="cot-cor-list" style="max-height:200px;overflow:auto"></div>
      </div>
    </div>

    <!-- PANEL CONFIG -->
    <div id="cot-panel-estadisticas" class="cot-panel" style="display:none">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <button class="btn btn-ghost" id="est-prev" title="Día anterior">◀</button>
        <input type="date" id="est-dia" class="cot-in" value="${EST_DIA}" style="width:auto">
        <button class="btn btn-ghost" id="est-next" title="Día siguiente">▶</button>
        <button class="btn btn-ghost" id="est-hoy">Hoy</button>
        <span style="color:var(--text3,#8b949e);margin:0 2px">·</span>
        <span style="color:var(--text3,#8b949e);font-size:12px">Rango:</span>
        <input type="date" id="est-desde" class="cot-in" value="${EST_DESDE}" style="width:auto">
        <span style="color:var(--text3,#8b949e)">a</span>
        <input type="date" id="est-hasta" class="cot-in" value="${EST_HASTA}" style="width:auto">
        <button class="btn btn-gold" id="est-verrango">Ver rango</button>
      </div>
      <div id="est-kpis" style="display:grid;grid-template-columns:repeat(5,1fr);gap:11px;margin-bottom:16px"></div>
      <div class="form-card" style="margin-bottom:16px">
        <div class="form-card-title">⏱ Procesos en curso — tiempo real</div>
        <div id="est-tablero"><div style="text-align:center;color:var(--text3,#8b949e);padding:16px">Cargando…</div></div>
      </div>
      <div class="form-card" style="margin-bottom:16px">
        <div class="form-card-title">🏁 Tiempos de proceso — histórico</div>
        <div id="est-hist"></div>
      </div>
      <div class="form-card">
        <div class="form-card-title" id="est-tabla-tit">Hoy</div>
        <div id="est-tabla"></div>
      </div>
    </div>

    <div id="cot-panel-config" class="cot-panel" style="display:none">
      <div class="form-card">
        <div class="form-card-title">Datos de la empresa (encabezado del PDF)</div>
        <div class="form-grid">
          <div class="fld"><label>Nombre comercial</label><input id="cfg-nombre" class="cot-in"></div>
          <div class="fld"><label>RTN</label><input id="cfg-rtn" class="cot-in"></div>
        </div>
        <div class="form-grid" style="margin-top:10px">
          <div class="fld"><label>Teléfono</label><input id="cfg-tel" class="cot-in"></div>
          <div class="fld"><label>Email</label><input id="cfg-email" class="cot-in"></div>
        </div>
        <div class="fld" style="margin-top:10px"><label>Dirección</label><input id="cfg-dir" class="cot-in"></div>
      </div>
      <div class="form-card">
        <div class="form-card-title">Datos fiscales (CAI)</div>
        <div id="cfg-sar-nota" style="font-size:12px;margin-bottom:10px;padding:8px 12px;border-radius:8px;background:var(--bg3,#1c2333);color:var(--text3,#8b949e)"></div>
        <div class="fld"><label>CAI</label><input id="cfg-cai" class="cot-in"></div>
        <div class="form-grid" style="margin-top:10px">
          <div class="fld"><label>Rango autorizado — desde</label><input id="cfg-rdesde" class="cot-in"></div>
          <div class="fld"><label>Rango autorizado — hasta</label><input id="cfg-rhasta" class="cot-in"></div>
        </div>
        <div class="form-grid" style="margin-top:10px">
          <div class="fld"><label>Fecha límite de emisión</label><input id="cfg-flimite" class="cot-in" type="date"></div>
          <div class="fld"><label>Vigencia de la proforma (días)</label><input id="cfg-vig" class="cot-in" type="number" min="1" step="1"></div>
        </div>
      </div>
      <div class="form-card">
        <div class="form-card-title">Textos del PDF</div>
        <div class="fld"><label>Términos y condiciones</label><textarea id="cfg-terminos" class="cot-in" rows="3"></textarea></div>
        <div class="fld" style="margin-top:10px"><label>Garantía de trabajo</label><textarea id="cfg-garantia" class="cot-in" rows="2"></textarea></div>
      </div>
      <div class="form-card">
        <div class="form-card-title">Ajuste de precio por antigüedad</div>
        <div style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:10px">Cuánto se suma a un precio traído de una orden vieja, según cuántos meses tenga.</div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
          <div class="fld"><label>Más de 3 meses (%)</label><input id="cfg-aj3" class="cot-in" type="number" min="0" step="0.5"></div>
          <div class="fld"><label>Más de 6 meses (%)</label><input id="cfg-aj6" class="cot-in" type="number" min="0" step="0.5"></div>
          <div class="fld"><label>Más de 12 meses (%)</label><input id="cfg-aj12" class="cot-in" type="number" min="0" step="0.5"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-gold" id="cfg-guardar">💾 Guardar configuración</button></div>
      </div>

      <!-- CATÁLOGO DE MARCAS Y MODELOS -->
      <div class="form-card">
        <div class="form-card-title">🚗 Marcas y modelos de vehículos</div>
        <div style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:10px">Apagá las marcas o modelos que no atendés en el taller: dejan de sugerirse al cotizar y en Generaciones. No se borra ningún dato ni generación. Se comparte con Yonker.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <input id="cfg-cat-nueva-ma" class="cot-in" placeholder="Nueva marca" style="width:170px;text-transform:uppercase">
          <button class="btn btn-ghost" id="cfg-cat-addma" style="font-size:12px;padding:7px 12px">+ Marca</button>
          <input id="cfg-cat-q" class="cot-in" placeholder="🔍 Buscar marca o modelo…" style="flex:1;min-width:160px;text-transform:uppercase">
        </div>
        <div id="cfg-cat-list" style="max-height:380px;overflow:auto"><div style="text-align:center;color:var(--text3,#8b949e);padding:16px">Cargando…</div></div>
      </div>
    </div>

    <!-- MODAL BÚSQUEDA -->
    <div class="modal-backdrop" id="cot-modal">
      <div class="modal" style="width:640px;max-width:94vw">
        <div class="modal-title" id="cot-modal-title">Buscar</div>
        <div id="cot-modal-hint" style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:8px"></div>
        <input id="cot-q" class="cot-in" placeholder="Escribí al menos 2 letras..." autocomplete="off">
        <div id="cot-res" style="margin-top:10px;max-height:52vh;overflow-y:auto;border:1px solid var(--border,#2a3340);border-radius:8px">
          <div style="text-align:center;color:var(--text3,#8b949e);padding:24px">Escribí para buscar...</div>
        </div>
        <div class="modal-actions" style="justify-content:flex-end;margin-top:12px">
          <button class="btn btn-ghost" id="cot-modal-close">Cerrar</button>
        </div>
      </div>
    </div>

    <!-- MODAL SELECCIONAR DE LA ORDEN -->
    <div class="modal-backdrop" id="cot-modal-ord">
      <div class="modal" style="width:600px;max-width:94vw">
        <div class="modal-title">Seleccionar de la orden</div>
        <div id="cot-mo-info" style="font-size:13px;margin-bottom:10px"></div>
        <div id="cot-mo-items" style="max-height:52vh;overflow-y:auto"></div>
        <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
          <button class="btn btn-ghost" id="cot-mo-cancel">Cancelar</button>
          <button class="btn btn-gold" id="cot-mo-add">Agregar seleccionados</button>
        </div>
      </div>
    </div>

    <!-- MODAL MANUAL -->
    <div class="modal-backdrop" id="cot-modal-man">
      <div class="modal" style="width:480px;max-width:94vw">
        <div class="modal-title">Agregar ítem manual</div>
        <div class="form-grid" style="margin-top:4px">
          <div class="fld"><label>Tipo</label><select id="cm-tipo" class="cot-in"><option value="p">Producto</option><option value="s">Servicio</option></select></div>
          <div class="fld"><label>Cantidad</label><input id="cm-cant" class="cot-in" type="number" value="1" min="0.01" step="0.01"></div>
        </div>
        <div class="fld" style="margin-top:10px"><label>Descripción</label><input id="cm-desc" class="cot-in" style="text-transform:uppercase"></div>
        <div class="fld" style="margin-top:10px"><label>Código (opcional)</label><input id="cm-codigo" class="cot-in" placeholder="Ej: AAA, 10, 20…" style="text-transform:uppercase"></div>
        <div id="cm-prod-fields">
          <div class="form-grid" style="margin-top:10px">
            <div class="fld"><label>Costo (precio de compra)</label><input id="cm-costo" class="cot-in" type="number" value="0" min="0" step="0.01"></div>
            <div class="fld"><label>% Utilidad s/costo</label><input id="cm-gan" class="cot-in" type="number" value="30" min="0" step="0.5"></div>
          </div>
        </div>
        <div class="form-grid" style="margin-top:10px">
          <div class="fld"><label>Precio unit. (sin ISV)</label><input id="cm-precio" class="cot-in" type="number" value="0" min="0" step="0.01"></div>
          <div class="fld"><label>ISV %</label><input id="cm-isv" class="cot-in" type="number" value="15" min="0" step="1"></div>
        </div>
        <div id="cm-conisv" style="font-size:11px;color:var(--text3,#8b949e);margin-top:6px"></div>
        <div id="cm-fixbase-wrap" style="display:none;margin-top:10px;padding:8px 10px;border-radius:6px;background:var(--bg3,#1c2333);border:1px solid var(--border,#2a3340)">
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;color:var(--text,#e6edf3)"><input type="checkbox" id="cm-fixbase"> Corregir esta descripción en toda la base (todas las órdenes)</label>
          <div id="cm-fixbase-count" style="font-size:11px;color:var(--text3,#8b949e);margin-top:4px"></div>
        </div>
        <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
          <button class="btn btn-ghost" id="cm-cancel">Cancelar</button>
          <button class="btn btn-gold" id="cm-add">Agregar</button>
        </div>
      </div>
    </div>

    <!-- MODAL DETALLE DE COMPATIBILIDAD (tracción/combustible/grupo/pieza) -->
    <div class="modal-backdrop" id="cot-modal-detalle">
      <div class="modal" style="width:480px;max-width:94vw">
        <div class="modal-title">Detalle de compatibilidad</div>
        <div style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:10px">Cuantos más datos, más específico el rango de repuestos compatibles.</div>
        <div class="fld"><label>Tracción</label><select id="cot-det-tr" class="cot-in" style="width:100%"></select></div>
        <div class="fld"><label>Combustible</label><select id="cot-det-co" class="cot-in" style="width:100%"></select></div>
        <div class="fld"><label>Grupo de repuesto</label><select id="cot-det-gr" class="cot-in" style="width:100%"></select></div>
        <div class="fld"><label>Motor</label><select id="cot-det-mt" class="cot-in" style="width:100%"></select></div>
        <div class="fld"><label>… o escribí la pieza que buscás (asigna el grupo solo)</label><input id="cot-det-pieza" class="cot-in" style="width:100%;text-transform:uppercase" placeholder="ej. CALIPER" autocomplete="off"></div>
        <div id="cot-det-piezahint" style="font-size:12px;margin-top:6px;min-height:18px"></div>
        <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
          <button class="btn btn-ghost" id="cot-det-cancel">Cancelar</button>
          <button class="btn btn-gold" id="cot-det-ok">Aplicar</button>
        </div>
      </div>
    </div>

    <!-- MODAL CORREGIR DESCRIPCIÓN (super_admin) -->
    <div class="modal-backdrop" id="cot-modal-fix">
      <div class="modal" style="width:520px;max-width:94vw">
        <div class="modal-title">Corregir descripción en la base</div>
        <div style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:8px">Descripción actual:</div>
        <div id="cf-old" style="font-size:13px;font-weight:600;background:var(--bg3,#1c2333);border:1px solid var(--border,#2a3340);border-radius:6px;padding:8px 10px;margin-bottom:10px"></div>
        <div class="fld"><label>Descripción corregida</label><input id="cf-new" class="cot-in" style="text-transform:uppercase" autocomplete="off"></div>
        <div id="cf-count" style="font-size:12px;color:var(--amber,#f59e0b);margin-top:8px"></div>
        <div style="font-size:11px;color:var(--text3,#8b949e);margin-top:6px">Se corregirá en <b>todas</b> las órdenes que tengan exactamente esta descripción. No afecta precios ni la contabilidad.</div>
        <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
          <button class="btn btn-ghost" id="cf-cancel">Cancelar</button>
          <button class="btn btn-gold" id="cf-guardar">Corregir en la base</button>
        </div>
      </div>
    </div>

    <!-- MODAL PEDIDOS (seguimiento de compra) -->
    <div class="modal-backdrop" id="cot-modal-ped">
      <div class="modal" style="width:700px;max-width:96vw;max-height:88vh;overflow-y:auto">
        <div class="modal-title" id="ped-title">Pedidos</div>
        <div id="ped-prog" style="margin:6px 0 12px"></div>
        <div id="ped-body"></div>
        <div class="modal-actions" style="justify-content:space-between;margin-top:12px">
          <button class="btn btn-ghost" id="ped-finproc" style="color:var(--green,#16a34a)">🏁 Finalizar proceso</button>
          <button class="btn btn-ghost" id="ped-close">Cerrar</button>
        </div>
      </div>
    </div>

    <!-- MODAL PROVEEDOR (marcar como pedido) -->
    <div class="modal-backdrop" id="cot-modal-prov">
      <div class="modal" style="width:420px;max-width:94vw">
        <div class="modal-title">Marcar como pedido</div>
        <div id="prov-item" style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:8px"></div>
        <div class="fld"><label>Proveedor</label>
          <div class="cot-ac-wrap">
            <input id="prov-input" class="cot-in" style="text-transform:uppercase" autocomplete="off" placeholder="Proveedor…">
            <div class="ac-list" id="prov-ac" style="display:none"></div>
          </div>
        </div>
        <div class="fld" style="margin-top:12px"><label>¿Cómo llega?</label>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn btn-ghost prov-modo-btn" data-modo="envia" style="flex:1">🚚 Proveedor envía</button>
            <button type="button" class="btn btn-ghost prov-modo-btn" data-modo="recoge" style="flex:1">🚶 Conserje recoge</button>
          </div>
        </div>
        <div class="fld" id="prov-conserje-wrap" style="margin-top:10px;display:none"><label>Nombre del conserje</label>
          <input id="prov-conserje" class="cot-in" style="text-transform:uppercase" autocomplete="off" placeholder="¿Quién lo recoge?">
        </div>
        <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
          <button class="btn btn-ghost" id="prov-cancel">Cancelar</button>
          <button class="btn btn-gold" id="prov-ok">Confirmar pedido</button>
        </div>
      </div>
    </div>

    <!-- MODAL DETALLE SEGUIMIENTO (cotizado vs facturado) -->
    <div class="modal-backdrop" id="cot-modal-det">
      <div class="modal" style="width:720px;max-width:96vw;max-height:88vh;overflow-y:auto">
        <div class="modal-title" id="det-title">Cotizado vs Facturado</div>
        <div id="det-sub" style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:10px"></div>
        <div id="det-body"></div>
        <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
          <button class="btn btn-ghost" id="det-editar">✏ Abrir cotización</button>
          <button class="btn btn-gold" id="det-close">Cerrar</button>
        </div>
      </div>
    </div>`
  }

  // ══════════════════════════════════════════════════════════
  //  AUTOCOMPLETAR (tema CONTAMAX)
  // ══════════════════════════════════════════════════════════
  function acSetup (inputId, listId, getItems, onChange, noFocusOpen) {
    const inp = $(inputId); const list = $(listId)
    if (!inp || !list) return
    let active = -1; let items = []
    const render = () => {
      const term = inp.value.trim().toLowerCase()
      items = getItems(term)
      if (!items.length) { list.style.display = 'none'; return }
      list.innerHTML = items.map((it, i) => `<div class="ac-item${i === active ? ' active' : ''}" data-i="${i}">${esc(it)}</div>`).join('')
      list.style.display = 'block'
    }
    const choose = (val) => { inp.value = val; list.style.display = 'none'; onChange(val) }
    inp.addEventListener('input', () => { active = -1; onChange(inp.value); render() })
    inp.addEventListener('focus', () => { if (noFocusOpen) return; active = -1; render() })
    inp.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none' }, 150))
    inp.addEventListener('keydown', e => {
      if (list.style.display === 'none') return
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); render(); e.preventDefault() }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault() }
      else if (e.key === 'Enter' && active >= 0) { choose(items[active]); e.preventDefault() }
      else if (e.key === 'Escape') { list.style.display = 'none' }
    })
    list.addEventListener('mousedown', e => {   // mousedown: se dispara antes del blur
      const el = e.target.closest('[data-i]'); if (!el) return
      choose(items[parseInt(el.dataset.i, 10)]); e.preventDefault()
    })
  }

  // Marcas sugeridas = catálogo maestro (solo activo) + las del historial de
  // órdenes que no estén deshabilitadas en el catálogo. Deduplicado por norma.
  function itemsMarca (term) {
    const desactivadas = new Set((CATV ? CATV.marcas : []).filter(m => !m.activo).map(m => m.marca_norm))
    const out = new Map()   // norm -> etiqueta a mostrar
    if (CATV) CATV.marcas.filter(m => m.activo).forEach(m => out.set(m.marca_norm, m.marca))
    if (VEH) VEH.marcas.forEach(m => { const n = provNorm(m); if (!desactivadas.has(n) && !out.has(n)) out.set(n, m) })
    return [...out.values()].filter(m => m.toLowerCase().includes(term)).sort((a, b) => a.localeCompare(b)).slice(0, 120)
  }
  function itemsModelo (term) {
    const maNorm = provNorm(PF.marca || '')
    if (!maNorm) return []
    const catMods = (CATV && CATV.modelos[maNorm]) ? CATV.modelos[maNorm] : []
    const desactivados = new Set(catMods.filter(m => !m.activo).map(m => m.modelo_norm))
    const out = new Map()   // norm -> etiqueta
    catMods.filter(m => m.activo).forEach(m => out.set(m.modelo_norm, m.modelo))
    const maKey = String(PF.marca || '').trim().toUpperCase()
    const mods = VEH && VEH.byMarca[maKey] ? VEH.byMarca[maKey] : null
    if (mods) Object.keys(mods).forEach(k => { const n = provNorm(mods[k].label); if (!desactivados.has(n) && !out.has(n)) out.set(n, mods[k].label) })
    return [...out.values()].filter(l => l.toLowerCase().includes(term)).sort((a, b) => a.localeCompare(b)).slice(0, 120)
  }
  // Helpers del catálogo maestro (activos), usados por los datalist de Generaciones
  function catMarcasActivas () { return CATV ? CATV.marcas.filter(m => m.activo).map(m => m.marca).sort((a, b) => a.localeCompare(b)) : [] }
  function catModelosActivos (marcaNorm) { const l = CATV && CATV.modelos[marcaNorm] ? CATV.modelos[marcaNorm] : []; return l.filter(m => m.activo).map(m => m.modelo).sort((a, b) => a.localeCompare(b)) }
  function itemsAnio (term) {
    const maKey = String(PF.marca || '').trim().toUpperCase()
    const moKey = String(PF.modelo || '').trim().toUpperCase()
    const mods = VEH && VEH.byMarca[maKey] ? VEH.byMarca[maKey] : null
    const info = mods ? mods[moKey] : null
    if (!info) return []
    return [...info.anios].filter(a => a.includes(term)).sort((a, b) => b.localeCompare(a)).slice(0, 80)
  }

  async function cargarVehiculos () {
    if (VEH) return
    try {
      const rows = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb().from('cotizador_ordenes').select('marca,modelo,anio').range(from, from + 999)
        if (error) throw error
        if (!data || !data.length) break
        rows.push(...data)
        if (data.length < 1000) break
      }
      const byMarca = {}
      rows.forEach(r => {
        const ma = String(r.marca || '').trim().toUpperCase()
        if (!ma) return
        const moU = String(r.modelo || '').trim().toUpperCase()
        const an = String(r.anio || '').trim()
        byMarca[ma] = byMarca[ma] || {}
        if (moU) {
          if (!byMarca[ma][moU]) byMarca[ma][moU] = { label: String(r.modelo).trim(), anios: new Set() }
          if (an && an !== '0') byMarca[ma][moU].anios.add(an)
        }
      })
      VEH = { marcas: Object.keys(byMarca).sort(), byMarca }
    } catch (e) {
      console.error('[cotizador vehiculos]', e) // sin catálogo: campos siguen como texto libre
    }
  }

  // Catálogo maestro de marcas/modelos (compartido con Yonker). Se administra
  // en Config (super_admin). Deshabilitar solo deja de sugerir; no borra nada.
  async function cargarCatalogoVeh (force) {
    if (CATV && !force) return CATV
    try {
      const [ma, mo] = await Promise.all([
        sb().from('cotizador_marcas').select('marca,marca_norm,activo,orden').order('orden').order('marca'),
        sb().from('cotizador_modelos').select('marca,marca_norm,modelo,modelo_norm,activo').order('modelo')
      ])
      const modelos = {}
      ;(mo.data || []).forEach(r => { (modelos[r.marca_norm] = modelos[r.marca_norm] || []).push(r) })
      CATV = { marcas: ma.data || [], modelos }
    } catch (e) { console.error('[cotizador catalogo]', e); CATV = CATV || { marcas: [], modelos: {} } }
    return CATV
  }
  function genItemsMarca (term) { return catMarcasActivas().filter(m => m.toLowerCase().includes(term)).slice(0, 120) }
  function genItemsModelo (term) { const ma = $('cot-gen-ma') ? $('cot-gen-ma').value : ''; return catModelosActivos(provNorm(ma)).filter(m => m.toLowerCase().includes(term)).slice(0, 120) }

  // ══════════════════════════════════════════════════════════
  //  WIRING
  // ══════════════════════════════════════════════════════════
  function wire () {
    $('cot-vend').addEventListener('input', e => PF.vendedor = e.target.value.toUpperCase())
    if ($('cot-jefe')) $('cot-jefe').addEventListener('input', e => PF.jefe_pista = e.target.value.toUpperCase())
    $('cot-cli').addEventListener('input', e => PF.cliente = e.target.value.toUpperCase())
    $('cot-km').addEventListener('input', e => PF.km = e.target.value)
    $('cot-orden').addEventListener('input', e => PF.numero_orden = e.target.value.trim())
    $('cot-desc').addEventListener('input', e => { PF.descuento = num(e.target.value); recalcTotales() })
    $('cot-notas').addEventListener('input', e => PF.notas = e.target.value)
    $('cfg-guardar').addEventListener('click', saveConfig)
    if ($('cfg-cat-addma')) $('cfg-cat-addma').addEventListener('click', addCatMarca)
    if ($('cfg-cat-nueva-ma')) $('cfg-cat-nueva-ma').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCatMarca() } })
    let debCat; if ($('cfg-cat-q')) $('cfg-cat-q').addEventListener('input', () => { clearTimeout(debCat); debCat = setTimeout(renderCatalogoCfg, 200) })
    const catList = $('cfg-cat-list')
    if (catList) {
      catList.addEventListener('change', e => {
        const t = e.target
        if (t.classList && t.classList.contains('cfg-cat-ma-tg')) setMarcaActivo(t.dataset.mn, t.checked)
        else if (t.classList && t.classList.contains('cfg-cat-mo-tg')) setModeloActivo(t.dataset.mn, t.dataset.on, t.checked)
      })
      catList.addEventListener('click', e => {
        const exp = e.target.closest('.cfg-cat-ma-exp')
        if (exp) { const mn = exp.dataset.mn; if (_catExp.has(mn)) _catExp.delete(mn); else _catExp.add(mn); renderCatalogoCfg(); return }
        const addmo = e.target.closest('.cfg-cat-addmo')
        if (addmo) { const box = addmo.parentElement ? addmo.parentElement.querySelector('.cfg-cat-nuevo-mo') : null; addCatModelo(addmo.dataset.mn, addmo.dataset.ma, box) }
      })
      catList.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('cfg-cat-nuevo-mo')) { e.preventDefault(); addCatModelo(e.target.dataset.mn, e.target.dataset.ma, e.target) }
      })
    }
    let debPl
    $('cot-placa').addEventListener('input', e => {
      PF.placa = e.target.value.toUpperCase()
      clearTimeout(debPl); debPl = setTimeout(() => sugerirPlaca(PF.placa), 260)
    })
    $('cot-placa').addEventListener('blur', () => setTimeout(() => { $('cot-placa-ac').style.display = 'none' }, 180))
    $('cot-placa-ac').addEventListener('mousedown', e => {
      const el = e.target.closest('[data-pf]'); if (!el) return
      recuperarProforma(el.dataset.pf); e.preventDefault()
    })
    $('cot-btn-guardar').addEventListener('click', guardarProforma)
    $('cot-btn-nueva').addEventListener('click', nuevaProforma)
    $('cot-recnew').addEventListener('click', nuevaProforma)
    acSetup('cot-ma', 'cot-ma-ac', itemsMarca, v => { PF.marca = v.toUpperCase(); PF.modelo = ''; if ($('cot-mo')) $('cot-mo').value = ''; updVehHint() })
    acSetup('cot-mo', 'cot-mo-ac', itemsModelo, v => { PF.modelo = v.toUpperCase(); onAnioVeh(); updVehHint() })
    const av = $('cot-anio-veh'); if (av) av.addEventListener('input', () => { av.value = av.value.replace(/\D/g, ''); onAnioVeh() })
    if ($('cot-detalle-btn')) $('cot-detalle-btn').addEventListener('click', abrirDetalle)
    if ($('cot-det-cancel')) $('cot-det-cancel').addEventListener('click', () => $('cot-modal-detalle').classList.remove('open'))
    if ($('cot-det-ok')) $('cot-det-ok').addEventListener('click', aplicarDetalle)
    let debPz; if ($('cot-det-pieza')) $('cot-det-pieza').addEventListener('input', () => { clearTimeout(debPz); debPz = setTimeout(hintPieza, 350) })
    const dsd = $('cot-anio-desde'); if (dsd) dsd.addEventListener('input', () => { PF.anioDesde = dsd.value.replace(/\D/g, ''); updVehHint() })
    const hst = $('cot-anio-hasta'); if (hst) hst.addEventListener('input', () => { PF.anioHasta = hst.value.replace(/\D/g, ''); updVehHint() })

    $('cot-buscar-prod').addEventListener('click', () => abrirBusq('p'))
    $('cot-buscar-serv').addEventListener('click', () => abrirBusq('s'))
    $('cot-manual').addEventListener('click', abrirManual)
    if ($('cot-solic-list')) $('cot-solic-list').addEventListener('click', e => { const b = e.target.closest('[data-solic-copy]'); if (b) copiarSolicitado(parseInt(b.getAttribute('data-solic-copy'), 10)) })
    $('cot-btn-pdf').addEventListener('click', generarPDF)
    $('cot-btn-ot').addEventListener('click', generarOrdenTrabajo)
    $('cot-modal-close').addEventListener('click', () => $('cot-modal').classList.remove('open'))
    $('cm-cancel').addEventListener('click', () => $('cot-modal-man').classList.remove('open'))
    $('cm-add').addEventListener('click', addManual)
    $('cf-cancel').addEventListener('click', () => $('cot-modal-fix').classList.remove('open'))
    $('cf-guardar').addEventListener('click', aplicarCorreccion)
    // Pedidos rápidos
    $('ped-close').addEventListener('click', () => { $('cot-modal-ped').classList.remove('open'); loadDashboard() })
    if ($('ped-finproc')) $('ped-finproc').addEventListener('click', finalizarProcesoManual)
    if ($('est-prev')) $('est-prev').addEventListener('click', () => { EST_MODO = 'dia'; EST_DIA = _estSumaDia(EST_DIA, -1); if ($('est-dia')) $('est-dia').value = EST_DIA; loadEstadisticas() })
    if ($('est-next')) $('est-next').addEventListener('click', () => { EST_MODO = 'dia'; EST_DIA = _estSumaDia(EST_DIA, 1); if ($('est-dia')) $('est-dia').value = EST_DIA; loadEstadisticas() })
    if ($('est-hoy')) $('est-hoy').addEventListener('click', () => { EST_MODO = 'dia'; EST_DIA = _estHoy(); if ($('est-dia')) $('est-dia').value = EST_DIA; loadEstadisticas() })
    if ($('est-dia')) $('est-dia').addEventListener('change', () => { EST_MODO = 'dia'; EST_DIA = $('est-dia').value || _estHoy(); loadEstadisticas() })
    if ($('est-verrango')) $('est-verrango').addEventListener('click', () => { EST_MODO = 'rango'; EST_DESDE = ($('est-desde') && $('est-desde').value) || EST_DESDE; EST_HASTA = ($('est-hasta') && $('est-hasta').value) || EST_HASTA; loadEstadisticas() })
    if ($('est-hist')) $('est-hist').addEventListener('click', e => { const b = e.target.closest('[data-descartar]'); if (b) descartarProceso(b.getAttribute('data-descartar')) })
    $('ped-body').addEventListener('click', e => {
      const b = e.target.closest('[data-pedact]'); if (!b) return
      const i = parseInt(b.dataset.i, 10); const a = b.dataset.pedact
      if (a === 'pedir') iniciarPedido(i)
      else if (a === 'bodega') marcarBodega(i)
      else if (a === 'llego') marcarLlegado(i)
      else if (a === 'revertir') revertirPedido(i)
      else if (a === 'facturar') togglePFfacturado(i)
    })
    $('prov-cancel').addEventListener('click', () => $('cot-modal-prov').classList.remove('open'))
    $('prov-ok').addEventListener('click', confirmarPedido)
    document.querySelectorAll('.prov-modo-btn').forEach(b => b.addEventListener('click', () => setPedModo(b.dataset.modo)))
    acSetup('prov-input', 'prov-ac', (term) => term ? (PROVS || []).filter(p => p.toLowerCase().includes(term)).slice(0, 40) : [], () => {}, true)
    // Cálculo ganancia: costo/utilidad → precio ; precio → utilidad (bidireccional)
    $('cm-costo').addEventListener('input', calcVentaManual)
    $('cm-gan').addEventListener('input', calcVentaManual)
    $('cm-precio').addEventListener('input', () => { recalcGanManual(); updConISV() })
    $('cm-isv').addEventListener('input', updConISV)
    $('cm-tipo').addEventListener('change', toggleTipoManual)
    // Al enfocar/tocar un campo del modal, seleccionar su contenido para editar directo
    const _modalMan = $('cot-modal-man')
    if (_modalMan) _modalMan.addEventListener('focusin', e => {
      const t = e.target
      if (t && t.tagName === 'INPUT' && t.type !== 'checkbox') setTimeout(() => { try { t.select() } catch (_) {} }, 0)
    })
    const gd = $('cot-gan-def')
    if (gd) {
      gd.value = getGanDefault()
      let dGan
      gd.addEventListener('input', e => {
        setGanDefault(num(e.target.value))
        clearTimeout(dGan)
        dGan = setTimeout(renderItems, 250)
      })
    }
    const vc = $('cot-ver-costos')
    if (vc) {
      vc.checked = verTodosCostos
      vc.addEventListener('change', e => {
        verTodosCostos = e.target.checked
        document.querySelectorAll('#cot-items-body .cot-cost').forEach(el => { el.style.display = verTodosCostos ? 'block' : 'none' })
      })
    }

    let deb
    $('cot-q').addEventListener('input', e => { clearTimeout(deb); deb = setTimeout(() => buscar(e.target.value.trim()), 250) })
    $('cot-res').addEventListener('click', e => {
      const el = e.target.closest('[data-idx]'); if (!el) return
      const r = searchResults[parseInt(el.dataset.idx, 10)]
      if (r && r.ord && r.ord.id) abrirOrden(r.ord.id, r.ord, r.desc)
    })
    $('cot-mo-cancel').addEventListener('click', () => $('cot-modal-ord').classList.remove('open'))
    $('cot-mo-add').addEventListener('click', agregarSeleccionados)
    $('cot-items-body').addEventListener('input', e => {
      const el = e.target.closest('[data-field]'); if (!el) return
      const i = parseInt(el.dataset.i, 10)
      PF.items[i][el.dataset.field] = num(el.value)
      const it = PF.items[i]
      const cell = document.querySelector(`[data-total="${i}"]`)
      if (cell) cell.textContent = 'L. ' + fmt(it.precio * it.cantidad * (1 + (it.isv || 0) / 100))
      recalcTotales()
    })
    $('cot-items-body').addEventListener('click', e => {
      const del = e.target.closest('[data-del]')
      if (del) { PF.items.splice(parseInt(del.dataset.del, 10), 1); renderItems(); return }
      const ed = e.target.closest('[data-edit]')
      if (ed) { editarManual(parseInt(ed.dataset.edit, 10)); return }
      const fx = e.target.closest('[data-fixdesc]')
      if (fx) { corregirDescripcion(parseInt(fx.dataset.fixdesc, 10)); return }
      const pr = e.target.closest('[data-prio]')
      if (pr) { PF.items[parseInt(pr.dataset.i, 10)].prioridad = pr.dataset.prio; renderItems() }
      const eye = e.target.closest('[data-eye]')
      if (eye) { const el = document.querySelector(`[data-cost="${eye.dataset.eye}"]`); if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none' }
    })

    // ── Pestañas ──
    document.querySelector('#view-cotizador .cot-tabs').addEventListener('click', e => {
      const t = e.target.closest('[data-tab]'); if (t) switchTab(t.dataset.tab)
    })
    // Dashboard
    $('cot-dash-nueva').addEventListener('click', () => { nuevaProforma(); switchTab('nueva') })
    $('cot-dash-list').addEventListener('click', dashClick)
    if ($('cot-pr-add')) $('cot-pr-add').addEventListener('click', prAddRapido)
    if ($('cot-pr-hist')) $('cot-pr-hist').addEventListener('click', () => {
      _prVerHist = !_prVerHist
      $('cot-pr-hist').textContent = _prVerHist ? '⚡ Ver activos' : '📋 Ver historial'
      loadPedidosRapidos()
    })
    if ($('cot-pr-rep')) $('cot-pr-rep').addEventListener('keydown', e => { if (e.key === 'Enter') prAddRapido() })
    if ($('cot-pr-list')) $('cot-pr-list').addEventListener('click', e => {
      const bp = e.target.closest('[data-pr-pedir]'); if (bp) return prPedir(bp.getAttribute('data-pr-pedir'))
      const bl = e.target.closest('[data-pr-llego]'); if (bl) return prLlego(bl.getAttribute('data-pr-llego'))
      const be = e.target.closest('[data-pr-entregar]'); if (be) return prEntregar(be.getAttribute('data-pr-entregar'))
      const bd = e.target.closest('[data-pr-del]'); if (bd) return prDel(bd.getAttribute('data-pr-del'))
    })
    // Historial
    let debH
    $('cot-hist-q').addEventListener('input', () => { clearTimeout(debH); debH = setTimeout(loadHistorial, 250) })
    $('cot-hist-filtros').addEventListener('click', e => {
      const c = e.target.closest('[data-estado]'); if (!c) return
      HIST_FILTRO = c.dataset.estado
      $('cot-hist-filtros').querySelectorAll('.cot-chip').forEach(x => x.classList.toggle('on', x === c))
      loadHistorial()
    })
    $('cot-hist-list').addEventListener('click', histClick)
    // Seguimiento
    let debS
    $('cot-seg-q').addEventListener('input', () => { clearTimeout(debS); debS = setTimeout(renderSeg, 200) })
    $('cot-seg-filtros').addEventListener('click', e => {
      const c = e.target.closest('[data-cat]'); if (!c) return
      SEG_CAT = c.dataset.cat
      $('cot-seg-filtros').querySelectorAll('.cot-chip').forEach(x => x.classList.toggle('on', x === c))
      renderSeg()
    })
    $('cot-seg-export').addEventListener('click', exportSeguimiento)
    // Proveedores
    let debP
    if ($('cot-prov-q')) $('cot-prov-q').addEventListener('input', () => { clearTimeout(debP); debP = setTimeout(() => renderProveedores($('cot-prov-q').value), 200) })
    if ($('cot-prov-sync')) $('cot-prov-sync').addEventListener('click', loadProveedores)
    if ($('cot-prov-list')) $('cot-prov-list').addEventListener('click', e => { const b = e.target.closest('.prov-save'); if (b) guardarProveedorRow(parseInt(b.dataset.i, 10)) })
    // Generaciones
    let debG
    acSetup('cot-gen-ma', 'cot-gen-ma-ac', genItemsMarca, () => { const mo = $('cot-gen-mo'); if (mo) mo.value = '' })
    acSetup('cot-gen-mo', 'cot-gen-mo-ac', genItemsModelo, () => {})
    if ($('cot-gen-add')) $('cot-gen-add').addEventListener('click', addGeneracion)
    if ($('cot-gen-q')) $('cot-gen-q').addEventListener('input', () => { clearTimeout(debG); debG = setTimeout(() => renderGeneraciones($('cot-gen-q').value), 200) })
    if ($('cot-gen-list')) $('cot-gen-list').addEventListener('click', e => { const b = e.target.closest('.cot-gen-del'); if (b) deleteGeneracion(b) })
    if ($('cot-lista-add')) $('cot-lista-add').addEventListener('click', addLista)
    if ($('cot-lista-list')) $('cot-lista-list').addEventListener('click', e => { const b = e.target.closest('.cot-lista-del'); if (b) deleteLista(b.dataset.id) })
    if ($('cot-pal-add')) $('cot-pal-add').addEventListener('click', addPalabraManual)
    if ($('cot-pal-q')) $('cot-pal-q').addEventListener('input', () => renderPalabras($('cot-pal-q').value))
    if ($('cot-pal-list')) $('cot-pal-list').addEventListener('click', e => { const b = e.target.closest('.cot-pal-del'); if (b) deletePalabra(b.dataset.id) })
    if ($('cot-cor-add')) $('cot-cor-add').addEventListener('click', addCorreccion)
    if ($('cot-cor-list')) $('cot-cor-list').addEventListener('click', e => { const b = e.target.closest('.cot-cor-del'); if (b) deleteCorreccion(b.dataset.id) })
    $('det-close').addEventListener('click', () => $('cot-modal-det').classList.remove('open'))
    $('det-editar').addEventListener('click', () => {
      $('cot-modal-det').classList.remove('open')
      if (_detId) recuperarProforma(_detId).then(() => switchTab('nueva'))
    })
  }

  function rangoTxt () { const d = PF.anioDesde || ''; const h = PF.anioHasta || ''; return (d || h) ? (d && h ? `${d}–${h}` : (d ? `${d}→` : `→${h}`)) : '' }

  // ── Generaciones de modelos (rangos de años) ──
  let GEN = {}          // "MARCA|MODELO" -> [{desde,hasta,marca,modelo}]
  let _genExiste = false
  async function loadGeneraciones () {
    try {
      const { data } = await sb().from('modelo_generaciones').select('marca,modelo,marca_norm,modelo_norm,anio_desde,anio_hasta,traccion,combustible,motor,grupo_repuesto')
      GEN = {}
      ;(data || []).forEach(r => { const k = r.marca_norm + '|' + r.modelo_norm; (GEN[k] = GEN[k] || []).push({ desde: r.anio_desde, hasta: r.anio_hasta, marca: r.marca, modelo: r.modelo, traccion: r.traccion || '', combustible: r.combustible || '', motor: r.motor || '', grupo: r.grupo_repuesto || '' }) })
    } catch (e) { console.error('[gen load]', e) }
  }

  // Listas configurables + diccionarios (pieza→grupo, autocorrector)
  let LISTAS = { traccion: [], combustible: [], motor: [], grupo: [] }
  let PALABRAS = {}   // palabra_norm -> grupo
  let CORREC = {}     // mal_norm -> bien
  async function loadCompat () {
    try {
      const [l, p, c] = await Promise.all([
        sb().from('cotizador_listas').select('tipo,valor,orden').order('orden', { ascending: true }),
        sb().from('grupo_palabras').select('palabra_norm,grupo'),
        sb().from('correcciones_texto').select('mal_norm,bien')
      ])
      LISTAS = { traccion: [], combustible: [], motor: [], grupo: [] }
      ;(l.data || []).forEach(r => { if (LISTAS[r.tipo]) LISTAS[r.tipo].push(r.valor) })
      PALABRAS = {}; (p.data || []).forEach(r => { PALABRAS[r.palabra_norm] = r.grupo })
      CORREC = {}; (c.data || []).forEach(r => { CORREC[r.mal_norm] = r.bien })
    } catch (e) { console.error('[compat load]', e) }
  }
  // aplica el autocorrector palabra por palabra
  function autocorregir (txt) {
    return String(txt || '').split(/(\s+)/).map(w => { const k = provNorm(w); return CORREC[k] ? CORREC[k] : w }).join('')
  }
  function detectarGeneracion (marca, modelo, anio) {
    const a = parseInt(anio, 10); if (!a) return null
    const list = GEN[provNorm(marca) + '|' + provNorm(modelo)] || []
    const tr = PF.traccion || ''; const co = PF.combustible || ''; const mt = PF.motor || ''; const gr = PF.grupo || ''
    const aplican = list.filter(g =>
      a >= g.desde && a <= g.hasta &&
      (!g.traccion || g.traccion === tr) &&
      (!g.combustible || g.combustible === co) &&
      (!g.motor || g.motor === mt) &&
      (!g.grupo || g.grupo === gr))
    if (!aplican.length) return null
    // la más específica (más campos que aplican); desempate: rango más amplio
    aplican.sort((x, y) => {
      const sx = (x.traccion ? 1 : 0) + (x.combustible ? 1 : 0) + (x.motor ? 1 : 0) + (x.grupo ? 1 : 0)
      const sy = (y.traccion ? 1 : 0) + (y.combustible ? 1 : 0) + (y.motor ? 1 : 0) + (y.grupo ? 1 : 0)
      if (sy !== sx) return sy - sx
      return (y.hasta - y.desde) - (x.hasta - x.desde)
    })
    return aplican[0]
  }
  function onAnioVeh () {
    const av = $('cot-anio-veh'); const anio = (av ? av.value : '').replace(/\D/g, ''); PF.anioVeh = anio
    if (!anio || !PF.marca || !PF.modelo) { _genExiste = false; updVehHint(); return }
    const gen = detectarGeneracion(PF.marca, PF.modelo, anio)
    const dsd = $('cot-anio-desde'); const hst = $('cot-anio-hasta')
    if (gen) {
      _genExiste = true
      if (dsd) { dsd.value = String(gen.desde); PF.anioDesde = String(gen.desde) }
      if (hst) { hst.value = String(gen.hasta); PF.anioHasta = String(gen.hasta) }
    } else {
      _genExiste = false   // no hay generación → pre-llena con el año para que el usuario abra el rango
      if (dsd && !dsd.value) { dsd.value = anio; PF.anioDesde = anio }
      if (hst && !hst.value) { hst.value = anio; PF.anioHasta = anio }
    }
    updVehHint()
  }

  function updVehHint () {
    const hint = $('cot-veh-hint'); if (!hint) return
    if (PF.anioVeh && !_genExiste && PF.marca && PF.modelo) {
      hint.innerHTML = `⚠ No hay generación para ${esc(PF.marca)} ${esc(PF.modelo)} ${esc(PF.anioVeh)} — poné el rango (desde/hasta) y se guardará al buscar.`
      hint.style.color = 'var(--amber,#f59e0b)'; return
    }
    hint.style.color = ''
    const t = [PF.marca, PF.modelo, rangoTxt() ? 'gen. ' + rangoTxt() : '', PF.anioVeh ? '(año ' + PF.anioVeh + ')' : ''].filter(Boolean).join(' ')
    hint.textContent = t ? `🚗 Filtrando búsquedas para: ${t}` : ''
  }

  // Guarda una generación nueva SOLO si el año del vehículo no cae en ninguna existente
  async function guardarGeneracionSiFalta () {
    if (!PF.marca || !PF.modelo || !PF.anioVeh) return
    if (detectarGeneracion(PF.marca, PF.modelo, PF.anioVeh)) return   // ya cae en una generación → no guardar (sub-rango manual)
    const d = parseInt(PF.anioDesde, 10); const h = parseInt(PF.anioHasta, 10)
    if (!d || !h || h < d) return
    try {
      const prof = window._currentProfile ? window._currentProfile() : null
      const { error } = await sb().from('modelo_generaciones').upsert({ marca: PF.marca, modelo: PF.modelo, marca_norm: provNorm(PF.marca), modelo_norm: provNorm(PF.modelo), anio_desde: d, anio_hasta: h, traccion: PF.traccion || '', combustible: PF.combustible || '', motor: PF.motor || '', grupo_repuesto: PF.grupo || '', creado_por: prof ? (prof.nombre || prof.email || '') : '' }, { onConflict: 'marca_norm,modelo_norm,traccion,combustible,motor,grupo_repuesto,anio_desde,anio_hasta', ignoreDuplicates: true })
      if (error) throw error
      await loadGeneraciones(); _genExiste = true; updVehHint()
      toast(`🚗 Generación ${d}–${h} guardada para ${PF.marca} ${PF.modelo}`, 'success')
    } catch (e) { console.error('[gen save]', e); toast('No se pudo guardar la generación: ' + (e.message || e), 'error') }
  }

  // ── Modal "Detalle" (tracción / combustible / grupo / pieza) ──
  function optsSelect (arr, sel) {
    return '<option value="">(cualquiera)</option>' + (arr || []).map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('')
  }
  function abrirDetalle () {
    $('cot-det-tr').innerHTML = optsSelect(LISTAS.traccion, PF.traccion)
    $('cot-det-co').innerHTML = optsSelect(LISTAS.combustible, PF.combustible)
    $('cot-det-gr').innerHTML = optsSelect(LISTAS.grupo, PF.grupo)
    $('cot-det-mt').innerHTML = optsSelect(LISTAS.motor, PF.motor)
    $('cot-det-pieza').value = ''; $('cot-det-piezahint').textContent = ''
    $('cot-modal-detalle').classList.add('open')
  }
  let _piezaAdd = null
  function hintPieza () {
    const inp = $('cot-det-pieza'); let val = inp.value
    const corr = autocorregir(val)
    if (corr !== val) { inp.value = corr; val = corr; toast('Corregido: ' + corr, 'success') }
    const h = $('cot-det-piezahint'); _piezaAdd = null
    const palabra = provNorm(val).split(/\s+/).filter(w => w.length >= 3)[0]
    if (!palabra) { h.textContent = ''; return }
    const grupo = PALABRAS[palabra]
    if (grupo) {
      $('cot-det-gr').value = grupo; PF.grupo = grupo
      h.style.color = 'var(--green,#16a34a)'; h.textContent = `→ "${palabra}" es del grupo ${grupo}`
    } else {
      _piezaAdd = palabra
      h.style.color = 'var(--amber,#f59e0b)'
      h.innerHTML = `"${esc(palabra)}" no está en el diccionario. Elegí grupo arriba y tocá <button type="button" class="btn btn-ghost" id="cot-det-addpal" style="font-size:11px;padding:2px 8px">➕ Agregar</button>`
      const b = $('cot-det-addpal'); if (b) b.addEventListener('click', agregarPalabra)
    }
  }
  async function agregarPalabra () {
    const grupo = $('cot-det-gr').value
    if (!_piezaAdd) return
    if (!grupo) { toast('Elegí un grupo arriba primero', 'error'); return }
    try {
      const prof = window._currentProfile ? window._currentProfile() : null
      const { error } = await sb().from('grupo_palabras').upsert({ palabra: _piezaAdd, palabra_norm: _piezaAdd, grupo, creado_por: prof ? (prof.nombre || prof.email || '') : '' }, { onConflict: 'palabra_norm', ignoreDuplicates: true })
      if (error) throw error
      PALABRAS[_piezaAdd] = grupo
      toast(`"${_piezaAdd}" → ${grupo} guardado`, 'success')
      hintPieza()
    } catch (e) { console.error('[palabra add]', e); toast('Error: ' + (e.message || e), 'error') }
  }
  function aplicarDetalle () {
    PF.traccion = $('cot-det-tr').value || ''
    PF.combustible = $('cot-det-co').value || ''
    PF.grupo = $('cot-det-gr').value || ''
    PF.motor = $('cot-det-mt').value || ''
    $('cot-modal-detalle').classList.remove('open')
    updDetalleResumen()
    onAnioVeh()   // recalcula la generación con el detalle nuevo
  }
  function updDetalleResumen () {
    const parts = [PF.traccion, PF.combustible, PF.motor, PF.grupo].filter(Boolean)
    const el = $('cot-detalle-resumen'); if (el) el.textContent = parts.length ? '· ' + parts.join(' · ') : ''
  }

  // ── Pestaña de administración de Generaciones ──
  async function loadGeneracionesTab () {
    await Promise.all([loadGeneraciones(), loadCompat(), cargarCatalogoVeh()])
    if ($('cot-gen-tr')) $('cot-gen-tr').innerHTML = optsSelect(LISTAS.traccion, '')
    if ($('cot-gen-co')) $('cot-gen-co').innerHTML = optsSelect(LISTAS.combustible, '')
    if ($('cot-gen-gr')) $('cot-gen-gr').innerHTML = optsSelect(LISTAS.grupo, '')
    if ($('cot-gen-mt')) $('cot-gen-mt').innerHTML = optsSelect(LISTAS.motor, '')
    if ($('cot-pal-grupo')) $('cot-pal-grupo').innerHTML = LISTAS.grupo.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')
    renderGeneraciones('')
    renderListas(); renderPalabras(''); renderCorrec()
  }

  // ── Listas (opciones de desplegables) ──
  async function renderListas () {
    const cont = $('cot-lista-list'); if (!cont) return
    try {
      const { data } = await sb().from('cotizador_listas').select('id,tipo,valor,orden').order('tipo').order('orden')
      cont.innerHTML = (data || []).map(r => `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg3,#1c2333);border:1px solid var(--border,#2a3340);border-radius:12px;padding:3px 10px;font-size:12px"><b style="color:var(--text3,#8b949e);text-transform:uppercase;font-size:10px">${esc(r.tipo)}</b> ${esc(r.valor)}${ES_SUPER ? ` <span class="cot-lista-del" data-id="${r.id}" style="cursor:pointer;color:var(--red,#f85149)">✕</span>` : ''}</span>`).join('') || '<span style="color:var(--text3,#8b949e)">Sin valores</span>'
    } catch (e) { cont.innerHTML = '<span style="color:var(--red,#f85149)">Error</span>' }
  }
  async function addLista () {
    const tipo = $('cot-lista-tipo').value; const valor = ($('cot-lista-val').value || '').trim().toUpperCase()
    if (!valor) { toast('Escribí un valor', 'error'); return }
    try {
      const { error } = await sb().from('cotizador_listas').upsert({ tipo, valor, orden: 100 }, { onConflict: 'tipo,valor', ignoreDuplicates: true })
      if (error) throw error
      $('cot-lista-val').value = ''; toast('Agregado', 'success')
      await loadCompat(); renderListas()
      if ($('cot-pal-grupo')) $('cot-pal-grupo').innerHTML = LISTAS.grupo.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')
    } catch (e) { console.error('[lista add]', e); toast('Error: ' + (e.message || e), 'error') }
  }
  async function deleteLista (id) {
    if (!ES_SUPER) { toast('Solo super_admin', 'error'); return }
    try { const { error } = await sb().from('cotizador_listas').delete().eq('id', id); if (error) throw error; await loadCompat(); renderListas() } catch (e) { toast('Error: ' + (e.message || e), 'error') }
  }

  // ── Catálogo de marcas/modelos (Config · super_admin) ──
  async function renderCatalogoCfg () {
    const cont = $('cfg-cat-list'); if (!cont) return
    await cargarCatalogoVeh()
    const t = ($('cfg-cat-q') ? $('cfg-cat-q').value : '').trim().toUpperCase()
    const marcas = CATV.marcas.slice().sort((a, b) => (a.orden - b.orden) || a.marca.localeCompare(b.marca))
    const html = marcas.map(m => {
      const mods = CATV.modelos[m.marca_norm] || []
      const maMatch = !t || m.marca.toUpperCase().includes(t)
      const modMatch = t ? mods.filter(x => x.modelo.toUpperCase().includes(t)) : mods
      if (t && !maMatch && !modMatch.length) return ''
      const exp = _catExp.has(m.marca_norm) || (t && !maMatch && modMatch.length > 0)
      const act = mods.filter(x => x.activo).length
      const lista = (t && !maMatch) ? modMatch : mods
      const modelosHtml = exp ? `<div style="padding:6px 0 8px 26px">
          <div style="display:flex;gap:6px;margin-bottom:6px">
            <input class="cot-in cfg-cat-nuevo-mo" data-mn="${esc(m.marca_norm)}" data-ma="${esc(m.marca)}" placeholder="Nuevo modelo" style="width:150px;text-transform:uppercase">
            <button class="btn btn-ghost cfg-cat-addmo" data-mn="${esc(m.marca_norm)}" data-ma="${esc(m.marca)}" style="font-size:12px;padding:5px 10px">+ Modelo</button>
          </div>
          ${lista.length ? lista.map(x => `<label style="display:inline-flex;align-items:center;gap:5px;margin:2px 12px 2px 0;font-size:12px;${x.activo ? '' : 'opacity:.45'}"><input type="checkbox" class="cfg-cat-mo-tg" data-mn="${esc(m.marca_norm)}" data-on="${esc(x.modelo_norm)}" ${x.activo ? 'checked' : ''}> ${esc(x.modelo)}</label>`).join('') : '<span style="font-size:12px;color:var(--text3,#8b949e)">Sin modelos.</span>'}
        </div>` : ''
      return `<div style="border-bottom:1px solid var(--border,#2a3340);padding:7px 0">
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" class="cfg-cat-ma-tg" data-mn="${esc(m.marca_norm)}" ${m.activo ? 'checked' : ''} title="Activar / desactivar marca">
          <b class="cfg-cat-ma-exp" data-mn="${esc(m.marca_norm)}" style="flex:1;cursor:pointer;${m.activo ? '' : 'opacity:.45;text-decoration:line-through'}">${exp ? '▾' : '▸'} ${esc(m.marca)}</b>
          <span style="font-size:11px;color:var(--text3,#8b949e)">${act}/${mods.length} modelos</span>
        </div>${modelosHtml}
      </div>`
    }).filter(Boolean).join('')
    cont.innerHTML = html || '<div style="color:var(--text3,#8b949e);padding:10px">Sin coincidencias.</div>'
  }
  async function setMarcaActivo (mn, activo) {
    if (!ES_SUPER) { toast('Solo super_admin', 'error'); return }
    try {
      const { error } = await sb().from('cotizador_marcas').update({ activo }).eq('marca_norm', mn)
      if (error) throw error
      const m = CATV.marcas.find(x => x.marca_norm === mn); if (m) m.activo = activo
      renderCatalogoCfg()
    } catch (e) { console.error('[cat marca tg]', e); toast('Error: ' + (e.message || e), 'error'); renderCatalogoCfg() }
  }
  async function setModeloActivo (mn, on, activo) {
    if (!ES_SUPER) { toast('Solo super_admin', 'error'); return }
    try {
      const { error } = await sb().from('cotizador_modelos').update({ activo }).eq('marca_norm', mn).eq('modelo_norm', on)
      if (error) throw error
      const l = CATV.modelos[mn] || []; const x = l.find(r => r.modelo_norm === on); if (x) x.activo = activo
      renderCatalogoCfg()
    } catch (e) { console.error('[cat modelo tg]', e); toast('Error: ' + (e.message || e), 'error'); renderCatalogoCfg() }
  }
  async function addCatMarca () {
    if (!ES_SUPER) { toast('Solo super_admin', 'error'); return }
    const el = $('cfg-cat-nueva-ma'); const marca = (el ? el.value : '').trim().toUpperCase().replace(/\s+/g, ' ')
    if (!marca) { toast('Escribí una marca', 'error'); return }
    try {
      const { error } = await sb().from('cotizador_marcas').upsert({ marca_norm: marca, marca, activo: true, orden: 100 }, { onConflict: 'marca_norm', ignoreDuplicates: true })
      if (error) throw error
      if (el) el.value = ''; _catExp.add(marca)
      await cargarCatalogoVeh(true); renderCatalogoCfg(); toast('Marca agregada', 'success')
    } catch (e) { console.error('[cat add marca]', e); toast('Error: ' + (e.message || e), 'error') }
  }
  async function addCatModelo (mn, marca, inputEl) {
    if (!ES_SUPER) { toast('Solo super_admin', 'error'); return }
    const modelo = (inputEl ? inputEl.value : '').trim().toUpperCase().replace(/\s+/g, ' ')
    if (!modelo) { toast('Escribí un modelo', 'error'); return }
    try {
      const { error } = await sb().from('cotizador_modelos').upsert({ marca_norm: mn, modelo_norm: modelo, marca, modelo, activo: true }, { onConflict: 'marca_norm,modelo_norm', ignoreDuplicates: true })
      if (error) throw error
      _catExp.add(mn)
      await cargarCatalogoVeh(true); renderCatalogoCfg(); toast('Modelo agregado', 'success')
    } catch (e) { console.error('[cat add modelo]', e); toast('Error: ' + (e.message || e), 'error') }
  }

  // ── Diccionario pieza → grupo ──
  async function renderPalabras (filtro) {
    const cont = $('cot-pal-list'); if (!cont) return
    const t = (filtro || '').toUpperCase()
    try {
      const { data } = await sb().from('grupo_palabras').select('id,palabra,palabra_norm,grupo').order('palabra')
      const list = (data || []).filter(r => !t || r.palabra_norm.includes(t) || (r.grupo || '').toUpperCase().includes(t))
      cont.innerHTML = list.map(r => `<div style="display:flex;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border,#2a3340);font-size:13px"><div style="flex:1"><b>${esc(r.palabra)}</b> → <span style="color:#3b82f6">${esc(r.grupo)}</span></div>${ES_SUPER ? `<span class="cot-pal-del" data-id="${r.id}" style="cursor:pointer;color:var(--red,#f85149)">🗑</span>` : ''}</div>`).join('') || '<div style="color:var(--text3,#8b949e);padding:8px">Sin palabras</div>'
    } catch (e) { cont.innerHTML = '<div style="color:var(--red,#f85149)">Error</div>' }
  }
  async function addPalabraManual () {
    const palabra = provNorm($('cot-pal-palabra').value); const grupo = $('cot-pal-grupo').value
    if (!palabra) { toast('Escribí la pieza', 'error'); return }
    if (!grupo) { toast('Elegí el grupo', 'error'); return }
    try {
      const { error } = await sb().from('grupo_palabras').upsert({ palabra: palabra, palabra_norm: palabra, grupo }, { onConflict: 'palabra_norm', ignoreDuplicates: false })
      if (error) throw error
      $('cot-pal-palabra').value = ''; PALABRAS[palabra] = grupo; toast('Agregada', 'success')
      renderPalabras($('cot-pal-q') ? $('cot-pal-q').value : '')
    } catch (e) { console.error('[pal add]', e); toast('Error: ' + (e.message || e), 'error') }
  }
  async function deletePalabra (id) {
    if (!ES_SUPER) { toast('Solo super_admin', 'error'); return }
    try { const { error } = await sb().from('grupo_palabras').delete().eq('id', id); if (error) throw error; await loadCompat(); renderPalabras($('cot-pal-q') ? $('cot-pal-q').value : '') } catch (e) { toast('Error: ' + (e.message || e), 'error') }
  }

  // ── Autocorrector ──
  async function renderCorrec () {
    const cont = $('cot-cor-list'); if (!cont) return
    try {
      const { data } = await sb().from('correcciones_texto').select('id,mal,bien').order('mal')
      cont.innerHTML = (data || []).map(r => `<div style="display:flex;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border,#2a3340);font-size:13px"><div style="flex:1"><span style="color:var(--red,#f85149)">${esc(r.mal)}</span> → <b style="color:var(--green,#16a34a)">${esc(r.bien)}</b></div>${ES_SUPER ? `<span class="cot-cor-del" data-id="${r.id}" style="cursor:pointer;color:var(--red,#f85149)">🗑</span>` : ''}</div>`).join('') || '<div style="color:var(--text3,#8b949e);padding:8px">Sin correcciones</div>'
    } catch (e) { cont.innerHTML = '<div style="color:var(--red,#f85149)">Error</div>' }
  }
  async function addCorreccion () {
    const mal = provNorm($('cot-cor-mal').value); const bien = ($('cot-cor-bien').value || '').trim().toUpperCase()
    if (!mal || !bien) { toast('Completá mal y bien', 'error'); return }
    try {
      const { error } = await sb().from('correcciones_texto').upsert({ mal, mal_norm: mal, bien }, { onConflict: 'mal_norm', ignoreDuplicates: false })
      if (error) throw error
      $('cot-cor-mal').value = ''; $('cot-cor-bien').value = ''; CORREC[mal] = bien; toast('Agregada', 'success'); renderCorrec()
    } catch (e) { console.error('[cor add]', e); toast('Error: ' + (e.message || e), 'error') }
  }
  async function deleteCorreccion (id) {
    if (!ES_SUPER) { toast('Solo super_admin', 'error'); return }
    try { const { error } = await sb().from('correcciones_texto').delete().eq('id', id); if (error) throw error; await loadCompat(); renderCorrec() } catch (e) { toast('Error: ' + (e.message || e), 'error') }
  }
  function renderGeneraciones (filtro) {
    const cont = $('cot-gen-list'); if (!cont) return
    const t = (filtro || '').toUpperCase()
    const rows = []
    Object.keys(GEN).forEach(k => GEN[k].forEach(g => rows.push({ ...g, key: k })))
    rows.sort((a, b) => (a.marca + a.modelo).localeCompare(b.marca + b.modelo) || a.desde - b.desde)
    const list = rows.filter(g => !t || (g.marca + ' ' + g.modelo + ' ' + (g.traccion || '') + ' ' + (g.motor || '') + ' ' + (g.grupo || '')).toUpperCase().includes(t))
    if (!list.length) { cont.innerHTML = '<div style="color:var(--text3,#8b949e);padding:10px">Sin reglas. Agregá una arriba.</div>'; return }
    cont.innerHTML = list.map(g => {
      const specs = [g.traccion, g.combustible, g.motor ? g.motor + 'L' : '', g.grupo].filter(Boolean)
      const badge = specs.length ? `<span style="font-size:11px;color:#3b82f6;background:rgba(59,130,246,.12);padding:2px 8px;border-radius:10px">${specs.map(esc).join(' · ')}</span>` : '<span style="font-size:11px;color:var(--text3,#8b949e)">general</span>'
      const del = ES_SUPER ? `<button class="btn btn-ghost cot-gen-del" data-ma="${esc(g.marca)}" data-mo="${esc(g.modelo)}" data-d="${g.desde}" data-h="${g.hasta}" data-tr="${esc(g.traccion || '')}" data-co="${esc(g.combustible || '')}" data-mt="${esc(g.motor || '')}" data-gr="${esc(g.grupo || '')}" style="font-size:12px;padding:4px 10px;color:var(--red,#f85149)">🗑</button>` : ''
      return `<div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border,#2a3340)">
        <div style="flex:1;font-size:13px"><b>${esc(g.marca)} ${esc(g.modelo)}</b> ${badge}</div>
        <div style="font-family:monospace;color:var(--gold,#c8a24a);font-weight:700">${g.desde}–${g.hasta}</div>
        ${del}
      </div>`
    }).join('')
  }
  async function addGeneracion () {
    const ma = ($('cot-gen-ma').value || '').trim().toUpperCase()
    const mo = ($('cot-gen-mo').value || '').trim().toUpperCase()
    const d = parseInt(($('cot-gen-d').value || '').replace(/\D/g, ''), 10)
    const h = parseInt(($('cot-gen-h').value || '').replace(/\D/g, ''), 10)
    const tr = $('cot-gen-tr') ? $('cot-gen-tr').value : ''
    const co = $('cot-gen-co') ? $('cot-gen-co').value : ''
    const gr = $('cot-gen-gr') ? $('cot-gen-gr').value : ''
    const mt = $('cot-gen-mt') ? $('cot-gen-mt').value : ''
    if (!ma || !mo || !d || !h) { toast('Completá marca, modelo, desde y hasta', 'error'); return }
    if (h < d) { toast('El "hasta" no puede ser menor que el "desde"', 'error'); return }
    try {
      const prof = window._currentProfile ? window._currentProfile() : null
      const { error } = await sb().from('modelo_generaciones').upsert({ marca: ma, modelo: mo, marca_norm: provNorm(ma), modelo_norm: provNorm(mo), anio_desde: d, anio_hasta: h, traccion: tr, combustible: co, motor: mt, grupo_repuesto: gr, creado_por: prof ? (prof.nombre || prof.email || '') : '' }, { onConflict: 'marca_norm,modelo_norm,traccion,combustible,motor,grupo_repuesto,anio_desde,anio_hasta', ignoreDuplicates: true })
      if (error) throw error
      ;['cot-gen-ma', 'cot-gen-mo', 'cot-gen-d', 'cot-gen-h'].forEach(id => { const el = $(id); if (el) el.value = '' })
      ;['cot-gen-tr', 'cot-gen-co', 'cot-gen-mt', 'cot-gen-gr'].forEach(id => { const el = $(id); if (el) el.value = '' })
      toast('Regla agregada', 'success')
      await loadGeneraciones(); renderGeneraciones($('cot-gen-q') ? $('cot-gen-q').value : '')
    } catch (e) { console.error('[gen add]', e); toast('Error: ' + (e.message || e), 'error') }
  }
  async function deleteGeneracion (b) {
    if (!ES_SUPER) { toast('Solo super_admin puede borrar', 'error'); return }
    const specs = [b.dataset.tr, b.dataset.co, b.dataset.gr].filter(Boolean).join(' ')
    if (!confirm(`¿Borrar la regla ${b.dataset.ma} ${b.dataset.mo}${specs ? ' ' + specs : ''} ${b.dataset.d}–${b.dataset.h}?`)) return
    try {
      const { error } = await sb().from('modelo_generaciones').delete()
        .eq('marca_norm', provNorm(b.dataset.ma)).eq('modelo_norm', provNorm(b.dataset.mo))
        .eq('anio_desde', parseInt(b.dataset.d, 10)).eq('anio_hasta', parseInt(b.dataset.h, 10))
        .eq('traccion', b.dataset.tr || '').eq('combustible', b.dataset.co || '').eq('motor', b.dataset.mt || '').eq('grupo_repuesto', b.dataset.gr || '')
      if (error) throw error
      toast('Borrada', 'success')
      await loadGeneraciones(); renderGeneraciones($('cot-gen-q') ? $('cot-gen-q').value : '')
    } catch (e) { console.error('[gen del]', e); toast('Error: ' + (e.message || e), 'error') }
  }

  // ══════════════════════════════════════════════════════════
  //  BÚSQUEDA en histórico de órdenes
  // ══════════════════════════════════════════════════════════
  function abrirBusq (tipo) {
    modalTipo = tipo
    guardarGeneracionSiFalta()   // si el año no cae en ninguna generación, guarda el rango puesto
    $('cot-modal-title').textContent = tipo === 'p' ? 'Buscar producto en órdenes' : 'Buscar servicio en órdenes'
    const veh = [PF.marca, PF.modelo, rangoTxt()].filter(Boolean).join(' ')
    $('cot-modal-hint').textContent = veh ? `Filtrando para: ${veh}` : 'Sin filtro de vehículo — se busca en todo el histórico'
    $('cot-q').value = ''
    $('cot-res').innerHTML = '<div style="text-align:center;color:var(--text3,#8b949e);padding:24px">Escribí para buscar...</div>'
    $('cot-modal').classList.add('open')
    setTimeout(() => $('cot-q').focus(), 120)
  }

  async function buscar (q) {
    const res = $('cot-res')
    if (!q || q.length < 2) { res.innerHTML = '<div style="text-align:center;color:var(--text3,#8b949e);padding:24px">Escribí al menos 2 letras...</div>'; return }
    res.innerHTML = '<div style="text-align:center;color:var(--text3,#8b949e);padding:24px">Buscando...</div>'
    const term = q.replace(/[%,]/g, ' ').trim()
    const useVeh = PF.marca || PF.modelo || PF.anioDesde || PF.anioHasta
    try {
      let query = sb().from('cotizador_orden_items')
        .select('descripcion,cantidad,precio_unitario,tipo,cotizador_ordenes' + (useVeh ? '!inner' : '') + '(id,numero_orden,marca,modelo,anio,fecha_creacion,cliente)')
        .eq('tipo', modalTipo)
        .ilike('descripcion', '%' + term + '%')
        .limit(60)
      if (PF.marca) query = query.ilike('cotizador_ordenes.marca', '%' + escLike(PF.marca) + '%')
      if (PF.modelo) query = query.ilike('cotizador_ordenes.modelo', '%' + escLike(PF.modelo) + '%')
      if (PF.anioDesde) query = query.gte('cotizador_ordenes.anio', PF.anioDesde)
      if (PF.anioHasta) query = query.lte('cotizador_ordenes.anio', PF.anioHasta)
      const { data, error } = await query
      if (error) throw error
      const rows = (data || []).map(r => ({
        desc: r.descripcion, cantidad: num(r.cantidad), precio: num(r.precio_unitario), tipo: r.tipo,
        ord: r.cotizador_ordenes || {}
      })).sort((a, b) => String(b.ord.fecha_creacion || '').localeCompare(String(a.ord.fecha_creacion || '')))
      searchResults = rows
      if (!rows.length) { res.innerHTML = `<div style="text-align:center;color:var(--text3,#8b949e);padding:24px">Sin resultados para "<b>${esc(q)}</b>"${useVeh ? ' en ese vehículo' : ''}.</div>`; return }
      res.innerHTML = rows.slice(0, 50).map((r, i) => {
        const o = r.ord
        const adj = adjPct(o.fecha_creacion)
        return `<div class="cot-si" data-idx="${i}">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
            <div style="min-width:0">
              <div><span class="cot-badge">#${esc(o.numero_orden || '—')}</span><b style="font-size:13px">${esc(r.desc)}</b></div>
              <div style="font-size:11px;color:var(--text3,#8b949e);margin-top:3px">${esc([o.marca, o.modelo, o.anio].filter(Boolean).join(' '))} · ${esc(fFecha(o.fecha_creacion))} · ${esc(o.cliente || 's/n')}</div>
              ${adj ? `<div class="cot-adj">⚠ Precio de hace ${adj.meses} meses — se ajustará +${adj.pct}%</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="color:var(--gold,#c8a24a);font-weight:700">L. ${fmt(r.precio)}</div>
              <div style="font-size:11px;color:var(--text3,#8b949e)">${fmt(r.cantidad)} unid · sin ISV</div>
            </div>
          </div>
        </div>`
      }).join('')
    } catch (e) {
      console.error('[cotizador buscar]', e)
      res.innerHTML = `<div style="text-align:center;color:var(--red,#f85149);padding:24px">Error al buscar: ${esc(e.message || e)}</div>`
    }
  }

  // Paso 2: al tocar un resultado, abre la orden con TODOS sus ítems del mismo
  // tipo (el tocado viene marcado) para elegir cuáles agregar. Igual que el Sheets.
  async function abrirOrden (ordenId, ord, descDestacado) {
    let items = []
    try {
      const { data, error } = await sb().from('cotizador_orden_items')
        .select('descripcion,cantidad,precio_unitario,tipo')
        .eq('orden_id', ordenId).eq('tipo', modalTipo).order('descripcion')
      if (error) throw error
      items = (data || []).map(it => ({ desc: it.descripcion, cantidad: num(it.cantidad), precio: num(it.precio_unitario), tipo: it.tipo }))
    } catch (e) {
      console.error('[cotizador abrirOrden]', e); toast('No se pudo abrir la orden', 'error'); return
    }
    ordenActual = { ord, items }
    const adj = adjPct(ord.fecha_creacion)
    $('cot-mo-info').innerHTML =
      `<b style="color:var(--text,#e6edf3)">Orden #${esc(ord.numero_orden || '—')}</b> · ${esc([ord.marca, ord.modelo, ord.anio].filter(Boolean).join(' '))} · ${esc(fFecha(ord.fecha_creacion))}` +
      `<br><span style="color:var(--text3,#8b949e)">Marcá los ítems que querés agregar a la proforma.</span>` +
      (adj ? `<br><span class="cot-adj">⚠ Precios de hace ${adj.meses} meses — se ajustarán +${adj.pct}% automáticamente</span>` : '')
    const dest = String(descDestacado || '').toUpperCase()
    $('cot-mo-items').innerHTML = items.length ? items.map((it, i) => {
      const chk = it.desc.toUpperCase() === dest
      return `<label class="cot-oi${chk ? ' dest' : ''}">
        <input type="checkbox" data-oi="${i}" ${chk ? 'checked' : ''}>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px">${esc(it.desc)}</div>
          <div style="font-size:11px;color:var(--text3,#8b949e)">L. ${fmt(it.precio)} sin ISV · con ISV 15%: L. ${fmt(it.precio * 1.15)}</div>
        </div>
        <div style="color:var(--gold,#c8a24a);font-weight:700;white-space:nowrap">${fmt(it.cantidad)} unid</div>
      </label>`
    }).join('') : `<div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Esta orden no tiene ${modalTipo === 'p' ? 'productos' : 'servicios'}.</div>`
    $('cot-modal').classList.remove('open')
    $('cot-modal-ord').classList.add('open')
  }

  function agregarSeleccionados () {
    if (!ordenActual) { $('cot-modal-ord').classList.remove('open'); return }
    const adj = adjPct(ordenActual.ord.fecha_creacion)
    let count = 0
    $('cot-mo-items').querySelectorAll('input[data-oi]').forEach(cb => {
      if (!cb.checked) return
      const it = ordenActual.items[parseInt(cb.dataset.oi, 10)]
      if (!it) return
      let precio = it.precio
      if (adj) precio = Math.round(precio * (1 + adj.pct / 100) * 100) / 100
      PF.items.push({
        tipo: it.tipo, desc: String(it.desc).toUpperCase(), cantidad: it.cantidad || 1, precio, isv: 15,
        deOrden: ordenActual.ord.numero_orden || '', ajuste: adj ? `+${adj.pct}% (${adj.meses} meses)` : ''
      })
      count++
    })
    $('cot-modal-ord').classList.remove('open')
    if (count) { renderItems(); toast(`${count} ítem(s) agregado(s)`, 'success') }
    else toast('No marcaste ningún ítem', 'error')
  }

  // ── Manual con % de utilidad (réplica de calcVenta/recalcGan del Sheets) ──
  function abrirManual () {
    _editIdx = null
    _editOrigDesc = null
    $('cm-tipo').value = 'p'
    $('cm-cant').value = '1'
    $('cm-desc').value = ''
    $('cm-codigo').value = ''
    $('cm-costo').value = '0'
    $('cm-gan').value = String(getGanDefault())   // default configurable
    $('cm-precio').value = '0'
    $('cm-isv').value = '15'
    if ($('cm-fixbase-wrap')) $('cm-fixbase-wrap').style.display = 'none'
    if ($('cm-fixbase')) $('cm-fixbase').checked = false
    $('cot-modal-man').querySelector('.modal-title').textContent = 'Agregar ítem manual'
    $('cm-add').textContent = 'Agregar'
    toggleTipoManual()
    updConISV()
    $('cot-modal-man').classList.add('open')
    setTimeout(() => $('cm-desc').focus(), 120)
  }

  async function editarManual (i) {
    const it = PF.items[i]; if (!it) return   // ahora edita cualquier línea (manual o de historial)
    _editIdx = i
    _editOrigDesc = it.desc
    $('cm-tipo').value = it.tipo
    $('cm-cant').value = it.cantidad
    $('cm-desc').value = it.desc
    $('cm-codigo').value = it.codigo || ''
    $('cm-costo').value = it.costo || 0
    $('cm-gan').value = it.ganancia || getGanDefault()
    $('cm-precio').value = it.precio
    $('cm-isv').value = it.isv
    $('cot-modal-man').querySelector('.modal-title').textContent = 'Editar ítem'
    $('cm-add').textContent = 'Guardar cambios'
    toggleTipoManual()
    updConISV()
    // Corrección en base: solo super_admin y solo para ítems que vienen del historial
    const wrap = $('cm-fixbase-wrap'); const esHist = !!it.deOrden
    if (wrap) {
      if (ES_SUPER && esHist) {
        wrap.style.display = ''
        if ($('cm-fixbase')) $('cm-fixbase').checked = false
        $('cm-fixbase-count').textContent = 'Contando ocurrencias…'
        sb().from('cotizador_orden_items').select('*', { count: 'exact', head: true }).ilike('descripcion', escLike(it.desc))
          .then(({ count }) => { $('cm-fixbase-count').textContent = count != null ? `Aparece en ${count} línea(s) de órdenes.` : '' })
          .catch(() => { $('cm-fixbase-count').textContent = '' })
      } else {
        wrap.style.display = 'none'
        if ($('cm-fixbase')) $('cm-fixbase').checked = false
      }
    }
    $('cot-modal-man').classList.add('open')
    setTimeout(() => $('cm-desc').focus(), 120)
  }

  function toggleTipoManual () {
    const esProd = $('cm-tipo').value === 'p'
    $('cm-prod-fields').style.display = esProd ? '' : 'none'
  }
  function calcVentaManual () {            // costo + % → precio
    const c = num($('cm-costo').value); const g = num($('cm-gan').value)
    if (c > 0) { $('cm-precio').value = (Math.round(c * (1 + g / 100) * 100) / 100).toFixed(2) }
    updConISV()
  }
  function recalcGanManual () {            // precio → % (inverso)
    const c = num($('cm-costo').value); const v = num($('cm-precio').value)
    if (c > 0 && v > 0) $('cm-gan').value = ((v - c) / c * 100).toFixed(1)
  }
  function updConISV () {
    const v = num($('cm-precio').value); const isv = num($('cm-isv').value)
    $('cm-conisv').textContent = v > 0 ? `Con ISV ${isv}%: L. ${fmt(v * (1 + isv / 100))}` : ''
  }

  async function addManual () {
    const desc = $('cm-desc').value.trim().toUpperCase()
    if (!desc) { toast('Escribí una descripción', 'error'); return }
    const precio = num($('cm-precio').value)
    if (!precio) { toast('Ingresá el precio', 'error'); return }
    const tipo = $('cm-tipo').value
    const editando = _editIdx != null && PF.items[_editIdx]
    const orig = editando ? PF.items[_editIdx] : null
    const patch = {
      tipo, desc, codigo: ($('cm-codigo').value || '').trim().toUpperCase(),
      cantidad: num($('cm-cant').value) || 1,
      precio, isv: num($('cm-isv').value),
      costo: tipo === 'p' ? num($('cm-costo').value) : 0,
      ganancia: tipo === 'p' ? num($('cm-gan').value) : 0
    }
    // Al editar preservamos deOrden/ajuste/prioridad y demás campos del ítem original
    const item = editando ? Object.assign({}, orig, patch) : Object.assign({ deOrden: '', ajuste: '' }, patch)
    // ¿Corregir también en toda la base? (super_admin · ítem de historial · descripción cambiada)
    const quiereFix = $('cm-fixbase') && $('cm-fixbase').checked && ES_SUPER && orig && orig.deOrden
    const descCambio = orig && String(_editOrigDesc || orig.desc).toUpperCase() !== desc
    if (editando) {
      const idx = _editIdx; _editIdx = null
      PF.items[idx] = item
      $('cot-modal-man').classList.remove('open'); renderItems(); toast('Cambios guardados', 'success')
      if (quiereFix && descCambio) await corregirEnBase(_editOrigDesc || (orig && orig.desc), desc)
    } else {
      PF.items.push(item)
      $('cot-modal-man').classList.remove('open'); renderItems()
      toast((tipo === 'p' ? 'Producto' : 'Servicio') + ' agregado', 'success')
    }
    _editOrigDesc = null
  }

  // Corrige la descripción en toda la base (cotizador_orden_items) y la refleja
  // en la cotización actual. Misma lógica que la corrección super_admin previa.
  async function corregirEnBase (vieja, nueva) {
    if (!vieja || !nueva) return
    try {
      const { data, error } = await sb().from('cotizador_orden_items')
        .update({ descripcion: nueva }).ilike('descripcion', escLike(vieja)).select('id')
      if (error) throw error
      if (!data || !data.length) { toast('No se actualizó la base (revisá permisos)', 'error'); return }
      const vU = String(vieja).toUpperCase()
      PF.items.forEach(x => { if (String(x.desc).toUpperCase() === vU) x.desc = nueva })
      renderItems()
      toast(`Descripción corregida en ${data.length} línea(s) de la base`, 'success')
    } catch (e) { console.error('[cotizador corregir base]', e); toast('Error al corregir en base: ' + (e.message || e), 'error') }
  }

  // ── Corregir descripción en la base (super_admin) ──
  async function corregirDescripcion (idx) {
    const it = PF.items[idx]; if (!it || !ES_SUPER) return
    _fixIdx = idx
    $('cf-old').textContent = String(it.desc).toUpperCase()
    $('cf-new').value = String(it.desc).toUpperCase()
    $('cf-count').textContent = 'Contando ocurrencias…'
    $('cot-modal-fix').classList.add('open')
    setTimeout(() => $('cf-new').select(), 120)
    try {
      const { count } = await sb().from('cotizador_orden_items')
        .select('*', { count: 'exact', head: true }).ilike('descripcion', escLike(it.desc))
      $('cf-count').textContent = count != null ? `Aparece en ${count} línea(s) de órdenes — se corregirán todas.` : ''
    } catch (e) { $('cf-count').textContent = '' }
  }

  async function aplicarCorreccion () {
    const it = PF.items[_fixIdx]; if (!it) { $('cot-modal-fix').classList.remove('open'); return }
    const nueva = $('cf-new').value.trim().toUpperCase()
    const vieja = it.desc
    if (!nueva) { toast('Escribí la descripción corregida', 'error'); return }
    if (nueva === String(vieja).toUpperCase()) { $('cot-modal-fix').classList.remove('open'); return }
    const btn = $('cf-guardar'); const prev = btn.textContent; btn.disabled = true; btn.textContent = 'Corrigiendo…'
    try {
      const { data, error } = await sb().from('cotizador_orden_items')
        .update({ descripcion: nueva }).ilike('descripcion', escLike(vieja)).select('id')
      if (error) throw error
      if (!data || !data.length) { toast('No se actualizó ninguna línea (revisá permisos)', 'error'); btn.disabled = false; btn.textContent = prev; return }
      const n = data.length
      // Reflejar en la cotización actual (todas las líneas con esa descripción) y limpiar cache de costo
      const vU = String(vieja).toUpperCase()
      PF.items.forEach(x => { if (String(x.desc).toUpperCase() === vU) x.desc = nueva })
      $('cot-modal-fix').classList.remove('open'); renderItems()
      toast(`Descripción corregida en ${n} línea(s)`, 'success')
    } catch (e) {
      console.error('[cotizador corregir]', e); toast('Error al corregir: ' + (e.message || e), 'error')
    } finally { btn.disabled = false; btn.textContent = prev }
  }

  // ══════════════════════════════════════════════════════════
  //  TABLA DE ÍTEMS + TOTALES + HINT DE COSTO
  // ══════════════════════════════════════════════════════════
  function renderContexto () {
    const card = $('cot-ctx-card'); if (!card) return
    const mot = (PF.motivo || '').trim(); const diag = (PF.diagnostico || '').trim()
    const mBox = $('cot-ctx-motivo'); if (mBox) { mBox.style.display = mot ? 'block' : 'none'; const t = $('cot-ctx-motivo-txt'); if (t) t.textContent = mot }
    const dBox = $('cot-ctx-diag'); if (dBox) { dBox.style.display = diag ? 'block' : 'none'; const t = $('cot-ctx-diag-txt'); if (t) t.textContent = diag }
    card.style.display = (mot || diag) ? 'block' : 'none'
  }
  function renderSolicitados () {
    const panel = $('cot-solic-panel'); const list = $('cot-solic-list')
    if (!panel || !list) return
    const solic = Array.isArray(PF.solicitados) ? PF.solicitados : []
    if (!solic.length) { panel.style.display = 'none'; return }
    panel.style.display = 'block'
    list.innerHTML = solic.map((s, i) => {
      const done = !!s.agregado
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;${done ? 'opacity:.55' : ''}">
        <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;background:${s.tipo === 's' ? 'rgba(139,92,246,.18)' : 'rgba(59,130,246,.18)'};color:${s.tipo === 's' ? '#8b5cf6' : '#3b82f6'}">${s.tipo === 's' ? 'SERV' : 'PROD'}</span>
        <span style="flex:1;font-size:13px;${done ? 'text-decoration:line-through' : ''}">${esc(s.desc)} <span style="color:var(--text3,#8b949e)">x${fmt(s.cantidad || 1)}</span>${s.nuevo ? ' <span style="color:#f0a500;font-size:10px;font-weight:700">NUEVO</span>' : ''}</span>
        ${done ? '<span style="color:var(--green,#16a34a);font-size:12px;font-weight:700">✓</span>' : ''}
        <button class="btn btn-ghost" style="font-size:11px;padding:4px 9px" data-solic-copy="${i}" title="Copiar y buscarlo con Buscar producto">📋 Copiar</button>
      </div>`
    }).join('')
  }
  async function copiarSolicitado (i) {
    const solic = Array.isArray(PF.solicitados) ? PF.solicitados : []
    const s = solic[i]; if (!s) return
    const txt = String(s.desc || '')
    let ok = false
    try { await navigator.clipboard.writeText(txt); ok = true } catch (e) {
      try { const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); document.body.removeChild(ta) } catch (e2) {}
    }
    if (!s.agregado) { s.agregado = true; renderSolicitados(); guardarProforma({ silencioso: true }) } else renderSolicitados()
    toast(ok ? '📋 Copiado — pegalo en "Buscar producto"' : ('Copialo manual: ' + txt), ok ? 'success' : 'error')
  }

  function renderItems () {
    const body = $('cot-items-body')
    if (!PF.items.length) {
      body.innerHTML = '<div style="text-align:center;color:var(--text3,#8b949e);padding:24px">Sin ítems. Buscá en órdenes o agregá manual.</div>'
      recalcTotales(); renderSolicitados(); return
    }
    const prods = []; const servs = []
    PF.items.forEach((it, i) => { (it.tipo === 's' ? servs : prods).push({ it, i }) })
    const headRow = '<div class="cot-row head"><span>Descripción</span><span style="text-align:center">Cant</span><span style="text-align:right">P. Unit</span><span style="text-align:center">ISV%</span><span style="text-align:right">Total</span><span></span></div>'
    const grpTitle = (t) => `<div style="font-size:12px;font-weight:700;color:var(--gold,#c8a24a);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 2px">${t}</div>`
    const rowHTML = ({ it, i }) => {
      const total = it.precio * it.cantidad * (1 + (it.isv || 0) / 100)
      const p = getPrioridad(it)
      return `<div class="cot-row">
        <div>
          <div style="font-size:13px">${it.deOrden ? `<span class="cot-badge">#${esc(it.deOrden)}</span>` : ''}${it.nuevo ? '<span style="font-size:9px;font-weight:800;color:#1a1a1a;background:#f0a500;padding:1px 5px;border-radius:6px;margin-right:4px">NUEVO</span>' : ''}${esc(String(it.desc).toUpperCase())} <button data-edit="${i}" title="Editar costo, margen y precio" style="background:none;border:0;color:var(--gold,#c8a24a);cursor:pointer;font-size:12px;padding:0 4px">✏</button> <button data-eye="${i}" title="Ver/ocultar costos y proveedores" style="background:none;border:0;color:var(--text3,#8b949e);cursor:pointer;font-size:12px;padding:0 4px">👁</button></div>
          ${it.ajuste ? `<div class="cot-adj">Ajustado ${esc(it.ajuste)}</div>` : ''}
          <div class="cot-cost" data-cost="${i}" style="display:${verTodosCostos ? 'block' : 'none'}"></div>
          <div class="prio-btns" title="Prioridad para el cliente">
            <button class="prio-btn crit ${p === 'crit' ? 'on' : ''}" data-prio="crit" data-i="${i}" title="Crítico — debe hacerse ya">🔴 Crít</button>
            <button class="prio-btn rec ${p === 'rec' ? 'on' : ''}" data-prio="rec" data-i="${i}" title="Recomendado — pronto">🟡 Rec</button>
            <button class="prio-btn prev ${p === 'prev' ? 'on' : ''}" data-prio="prev" data-i="${i}" title="Preventivo — puede esperar">🟢 Prev</button>
          </div>
        </div>
        <input class="cot-in" style="text-align:center" data-field="cantidad" data-i="${i}" type="number" min="0.01" step="0.01" value="${it.cantidad}">
        <input class="cot-in" style="text-align:right;color:var(--gold,#c8a24a);font-weight:700" data-field="precio" data-i="${i}" type="number" min="0" step="0.01" value="${it.precio}">
        <input class="cot-in" style="text-align:center" data-field="isv" data-i="${i}" type="number" min="0" step="1" value="${it.isv}">
        <div style="text-align:right;font-weight:600" data-total="${i}">L. ${fmt(total)}</div>
        <button class="btn btn-ghost" data-del="${i}" style="padding:4px 8px;color:var(--red,#f85149)" title="Quitar">✕</button>
      </div>`
    }
    let html = ''
    if (prods.length) html += grpTitle('Productos') + headRow + prods.map(rowHTML).join('')
    if (servs.length) html += grpTitle('Servicios') + headRow + servs.map(rowHTML).join('')
    body.innerHTML = html
    recalcTotales()
    PF.items.forEach((it, i) => { if (it.tipo === 'p' && it.deOrden) cargarCosto(it.desc, i) })   // manuales NO auto-asocian proveedor (se asigna al pedir)
    renderSolicitados()
  }

  function calcTot () {
    const d = Math.max(0, Math.min(100, Number(PF.descuento) || 0))
    const f = 1 - d / 100
    let sub = 0, isv = 0
    PF.items.forEach(it => { const b = it.precio * it.cantidad; sub += b; isv += b * f * (it.isv || 0) / 100 })
    const descMonto = sub * d / 100
    return {
      descPct: d,
      subtotal: Math.round(sub * 100) / 100,
      descMonto: Math.round(descMonto * 100) / 100,
      isv: Math.round(isv * 100) / 100,
      total: Math.round((sub - descMonto + isv) * 100) / 100
    }
  }

  function recalcTotales () {
    const t = calcTot()
    $('cot-sub').textContent = 'L. ' + fmt(t.subtotal)
    const row = $('cot-desc-row')
    if (t.descPct > 0) { row.style.display = 'flex'; $('cot-desc-lbl').textContent = `Descuento (${fmt(t.descPct)}%)`; $('cot-desc-monto').textContent = '-L. ' + fmt(t.descMonto) } else row.style.display = 'none'
    $('cot-isv').textContent = 'L. ' + fmt(t.isv)
    $('cot-total').textContent = 'L. ' + fmt(t.total)
  }

  async function fetchCosto (desc) {
    const key = String(desc || '').toUpperCase().trim()
    if (!key) return []
    if (costCache[key]) return costCache[key]
    try {
      const term = key.replace(/[%,]/g, ' ').trim()
      const { data } = await sb().from('cotizador_compras')
        .select('codigo,proveedor,costo_unitario,fecha_compra')
        .ilike('nombre_norm', '%' + term + '%')
        .order('fecha_compra', { ascending: false }).limit(4)
      costCache[key] = data || []
    } catch (e) { costCache[key] = [] }
    return costCache[key]
  }

  function costoHTML (entradas, conSug) {
    if (!entradas || !entradas.length) return ''
    const g = getGanDefault()
    const sug = (c) => fmt((Number(c) || 0) * (1 + g / 100))
    const codPrin = entradas[0].codigo || ''
    const linea = (a, cls) => {
      const codExtra = (a.codigo && a.codigo !== codPrin) ? ` · cód: ${esc(a.codigo)}` : ''
      const s = conSug ? (cls === 'cot-hint' ? ` · <span style="color:var(--gold,#c8a24a)">Sug. L. ${sug(a.costo_unitario)}</span>` : ` · Sug. L. ${sug(a.costo_unitario)}`) : ''
      return `<div class="${cls}">🏪 ${esc(a.proveedor || '')} · L. ${fmt(a.costo_unitario)} · ${esc(fFecha(a.fecha_compra))}${codExtra}${s}</div>`
    }
    let html = ''
    if (codPrin) html += `<div style="font-size:12px;font-weight:800;color:var(--gold,#c8a24a);margin-bottom:1px">🔖 Código: ${esc(codPrin)}</div>`
    html += linea(entradas[0], 'cot-hint')
    if (entradas[1]) html += linea(entradas[1], 'cot-hint2')
    if (entradas[2]) html += linea(entradas[2], 'cot-hint2')
    return html
  }

  async function cargarCosto (desc, i) {
    const cont = document.querySelector(`[data-cost="${i}"]`)
    if (!cont) return
    const entradas = await fetchCosto(desc)
    cont.innerHTML = costoHTML(entradas, true)
  }

  // ══════════════════════════════════════════════════════════
  //  UTILIDADES
  // ══════════════════════════════════════════════════════════
  function adjPct (fechaISO) {
    if (!fechaISO) return null
    const d = new Date(fechaISO); if (isNaN(d)) return null
    const meses = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44))
    const a3 = Number(cfg('aj_3')); const a6 = Number(cfg('aj_6')); const a12 = Number(cfg('aj_12'))
    let pct = 0
    if (meses > 12) pct = a12; else if (meses > 6) pct = a6; else if (meses > 3) pct = a3
    return pct > 0 ? { pct, meses } : null
  }
  function fFecha (iso) {
    if (!iso) return 's/f'
    const d = new Date(iso); if (isNaN(d)) return String(iso)
    return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  // ══════════════════════════════════════════════════════════
  //  GUARDAR / RECUPERAR PROFORMAS (persistencia por placa)
  // ══════════════════════════════════════════════════════════
  function iniciales (nombre) {
    return String(nombre || '').trim().split(/\s+/).map(w => w.charAt(0).toUpperCase()).join('').slice(0, 4)
  }
  function numeroDe (vendedor, correlativo) {
    if (!correlativo) return '—'
    const ini = iniciales(vendedor)
    return (ini ? ini + '-' : '') + correlativo
  }
  function numeroProforma () { return numeroDe(PF.vendedor, PF.correlativo) }
  function setNumLabel () {
    $('cot-num-label').textContent = PF.correlativo ? ('Cotización N° ' + numeroProforma() + (PF.estado ? ' · ' + PF.estado : '')) : 'Nueva cotización'
  }

  function totales () { return calcTot() }

  async function guardarProforma (opts) {
    opts = opts || {}
    if (!PF.cliente && !PF.placa) { toast('Ingresá al menos cliente o placa', 'error'); return false }
    if (!PF.items.length) { toast('Agregá al menos un ítem', 'error'); return false }
    const orden = (PF.numero_orden || '').trim()
    if (!orden) { toast('El N° de Orden Taller es obligatorio', 'error'); $('cot-orden').focus(); return false }
    const btn = $('cot-btn-guardar'); const prev = btn.textContent
    if (!opts.silencioso) { btn.disabled = true; btn.textContent = 'Guardando...' }
    const restore = () => { if (!opts.silencioso) { btn.disabled = false; btn.textContent = prev } }
    const prof = window._currentProfile ? window._currentProfile() : null
    const t = totales()
    // Validar que la orden no esté ya usada en otra cotización
    try {
      let chk = sb().from('cotizador_proformas').select('id,correlativo,vendedor').eq('numero_orden', orden)
      if (PF.id) chk = chk.neq('id', PF.id)
      const { data: dup, error: chkErr } = await chk.limit(1)
      if (chkErr) throw chkErr
      if (dup && dup.length) {
        toast(`La orden #${orden} ya está en la cotización ${numeroDe(dup[0].vendedor, dup[0].correlativo)}`, 'error')
        restore(); return false
      }
    } catch (e) {
      console.error('[cotizador chk orden]', e); toast('No se pudo validar la orden', 'error')
      restore(); return false
    }
    const payload = {
      vendedor: PF.vendedor || '', vendedor_id: prof ? prof.id : null,
      cliente: PF.cliente || '', placa: (PF.placa || '').toUpperCase(),
      marca: PF.marca || '', modelo: PF.modelo || '', anio: [PF.anioDesde, PF.anioHasta].filter(Boolean).join('-'), anio_vehiculo: PF.anioVeh || '', kilometraje: PF.km || '',
      numero_orden: orden,
      items: PF.items, solicitados: PF.solicitados || [], subtotal: t.subtotal, isv: t.isv, total: t.total,
      descuento: t.descPct, notas: PF.notas || '', jefe_pista: PF.jefe_pista || '',
      ganancia_default: getGanDefault(), estado: PF.estado || 'pendiente'
    }
    try {
      if (PF.id) {
        const { error } = await sb().from('cotizador_proformas').update(payload).eq('id', PF.id)
        if (error) throw error
        if (!opts.silencioso) toast('Cotización N° ' + numeroProforma() + ' actualizada', 'success')
      } else {
        const { data, error } = await sb().from('cotizador_proformas').insert(payload).select('id,correlativo,estado').single()
        if (error) throw error
        PF.id = data.id; PF.correlativo = data.correlativo; PF.estado = data.estado
        if (!opts.silencioso) toast('Cotización N° ' + numeroProforma() + ' guardada', 'success')
      }
      setNumLabel()
      restore(); return true
    } catch (e) {
      console.error('[cotizador guardar]', e)
      if (e && (e.code === '23505' || /duplicate|unique|numero_orden/i.test(e.message || ''))) {
        toast(`La orden #${orden} ya está usada en otra cotización`, 'error')
      } else {
        toast('Error al guardar: ' + (e.message || e), 'error')
      }
      restore(); return false
    }
  }

  async function sugerirPlaca (placa) {
    const list = $('cot-placa-ac')
    if (!placa || placa.length < 2) { list.style.display = 'none'; return }
    try {
      const { data } = await sb().from('cotizador_proformas')
        .select('id,correlativo,vendedor,cliente,placa,marca,modelo,anio,total')
        .ilike('placa', '%' + escLike(placa) + '%').eq('estado', 'pendiente')
        .order('created_at', { ascending: false }).limit(8)
      if (!data || !data.length) { list.style.display = 'none'; return }
      list.innerHTML = data.map(p => `<div class="ac-item" data-pf="${p.id}">
        <b>${esc(p.placa || '')}</b> · ${esc([p.marca, p.modelo, p.anio].filter(Boolean).join(' '))}
        <span style="color:var(--text3,#8b949e);font-size:11px"> — ${esc(p.cliente || 's/n')} · L. ${fmt(p.total)}</span>
      </div>`).join('')
      list.style.display = 'block'
    } catch (e) { console.error('[cotizador sugerirPlaca]', e); list.style.display = 'none' }
  }

  async function recuperarProforma (id) {
    try {
      const { data, error } = await sb().from('cotizador_proformas').select('*').eq('id', id).single()
      if (error) throw error
      PF = {
        id: data.id, correlativo: data.correlativo, estado: data.estado || 'pendiente',
        vendedor: data.vendedor || (window._currentProfile ? (window._currentProfile().nombre || '').toUpperCase() : ''), cliente: data.cliente || '', placa: data.placa || '', jefe_pista: data.jefe_pista || '',
        km: data.kilometraje || '', numero_orden: data.numero_orden || '', marca: data.marca || '', modelo: data.modelo || '', anioVeh: data.anio_vehiculo || '', anioDesde: (String(data.anio || '').split('-')[0] || '').trim(), anioHasta: (String(data.anio || '').split('-')[1] || '').trim(),
        descuento: Number(data.descuento) || 0, notas: data.notas || '',
        motivo: data.motivo || '', diagnostico: data.diagnostico || '',
        proc_inicio: data.proc_inicio || null, proc_aprobada: data.proc_aprobada || null, proc_completada: data.proc_completada || null,
        proc_solicitada: data.proc_solicitada || null,
        procesos_previos: Array.isArray(data.procesos_previos) ? data.procesos_previos : [],
        solicitados: Array.isArray(data.solicitados) ? data.solicitados : [],
        items: Array.isArray(data.items) ? data.items : []
      }
      $('cot-vend').value = PF.vendedor; $('cot-cli').value = PF.cliente; $('cot-placa').value = PF.placa; $('cot-jefe') && ($('cot-jefe').value = PF.jefe_pista || '')
      $('cot-km').value = PF.km; $('cot-ma').value = PF.marca; $('cot-mo').value = PF.modelo
      $('cot-anio-veh').value = PF.anioVeh || ''; $('cot-anio-desde').value = PF.anioDesde; $('cot-anio-hasta').value = PF.anioHasta
      if (PF.anioVeh) { try { onAnioVeh() } catch (e) {} }   // año del vehículo → auto-detecta la generación
      $('cot-orden').value = PF.numero_orden
      $('cot-desc').value = PF.descuento; $('cot-notas').value = PF.notas
      $('cot-placa-ac').style.display = 'none'
      $('cot-recmsg').textContent = `📂 Recuperada N° ${numeroProforma()} — ${PF.placa} ${PF.marca} ${PF.modelo}`
      $('cot-recban').style.display = 'flex'
      setNumLabel(); updVehHint(); renderItems()
      renderContexto()
      renderProcClock(); startClock()
      toast('Cotización recuperada', 'success')
    } catch (e) {
      console.error('[cotizador recuperar]', e); toast('No se pudo recuperar', 'error')
    }
  }

  function nuevaProforma () {
    if (PF.items.length && !PF.id && !confirm('¿Descartar la cotización actual sin guardar?')) return
    const prof = window._currentProfile ? window._currentProfile() : null
    PF = { id: null, correlativo: null, estado: 'pendiente', vendedor: prof ? (prof.nombre || '').toUpperCase() : '', cliente: '', placa: '', km: '', numero_orden: '', marca: '', modelo: '', anioVeh: '', anioDesde: '', anioHasta: '', traccion: '', combustible: '', motor: '', grupo: '', descuento: 0, notas: '', motivo: '', diagnostico: '', proc_inicio: null, proc_aprobada: null, proc_completada: null, procesos_previos: [], jefe_pista: '', solicitados: [], items: [] }
    if ($('cot-proc-clock')) renderProcClock()
    renderContexto()
    ;['cot-cli', 'cot-placa', 'cot-km', 'cot-orden', 'cot-ma', 'cot-mo', 'cot-anio-veh', 'cot-anio-desde', 'cot-anio-hasta', 'cot-notas'].forEach(id => { const el = $(id); if (el) el.value = '' })
    $('cot-desc').value = '0'
    $('cot-vend').value = PF.vendedor
    if ($('cot-jefe')) $('cot-jefe').value = PF.jefe_pista || ''
    $('cot-recban').style.display = 'none'
    setNumLabel(); updVehHint(); updDetalleResumen(); renderItems()
  }

  // ══════════════════════════════════════════════════════════
  //  PESTAÑAS · DASHBOARD · HISTORIAL
  // ══════════════════════════════════════════════════════════
  function switchTab (name) {
    TAB = name
    document.querySelectorAll('#view-cotizador .cot-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name))
    ;['inicio', 'nueva', 'cotizacion', 'seguimiento', 'proveedores', 'generaciones', 'estadisticas', 'config'].forEach(p => {
      const el = $('cot-panel-' + p); if (el) el.style.display = (p === name) ? '' : 'none'
    })
    if (name === 'inicio') loadDashboard()
    else if (name === 'cotizacion') loadHistorial()
    else if (name === 'seguimiento') loadSeguimiento()
    else if (name === 'proveedores') loadProveedores()
    else if (name === 'generaciones') loadGeneracionesTab()
    else if (name === 'config') fillConfigForm()
    else if (name === 'estadisticas') loadEstadisticas()
    const _clk = $('cot-proc-clock'); if (_clk) { if (name === 'nueva') renderProcClock(); else _clk.style.display = 'none' }
  }

  // ══════════════════════════════════════════════════════════
  //  TIEMPOS DE PROCESO (2 fases) · reloj en vivo · Estadísticas
  // ══════════════════════════════════════════════════════════
  let _clockTimer = null
  let EST_MODO = 'dia'          // 'dia' | 'rango'
  let EST_DIA = _estHoy()       // yyyy-mm-dd (hoy por defecto)
  let EST_DESDE = _estHoy()
  let EST_HASTA = _estHoy()
  function _estHoy () { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) } catch (e) { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` } }
  function _estBoundISO (fecha, addDays) { const [y, m, d] = String(fecha).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + (addDays || 0), 6, 0, 0)).toISOString() }  // 00:00 hora Honduras (-06:00)
  function _estSumaDia (fecha, n) { const [y, m, d] = String(fecha).split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d + n)); return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}` }
  function _estFechaCorta (fecha) { const [y, m, d] = String(fecha).split('-'); return `${d}/${m}/${y.slice(2)}` }

  function _fmtCrono (ms) {
    if (ms == null || ms < 0) ms = 0
    const s = Math.floor(ms / 1000)
    const hh = String(Math.floor(s / 3600)).padStart(2, '0')
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  function _fmtDur2 (ms) {
    if (ms == null || ms < 0) return '—'
    const s = Math.floor(ms / 1000)
    if (s < 60) return s + 's'
    const m = Math.floor(s / 60)
    if (m < 60) return m + 'm'
    const h = Math.floor(m / 60)
    return h + 'h' + ((m % 60) ? ' ' + (m % 60) + 'm' : '')
  }
  function _procFase (p) {
    if (!p) return { fase: 'sin_iniciar' }
    if (p.proc_solicitada && !p.proc_inicio) return { fase: 'cotizacion', desde: p.proc_solicitada }
    if (!p.proc_inicio) return { fase: 'sin_iniciar' }
    if (!p.proc_aprobada) return { fase: 'autorizacion', desde: p.proc_inicio }
    if (!p.proc_completada) return { fase: 'compra', desde: p.proc_aprobada }
    return { fase: 'completado', desde: p.proc_inicio, hasta: p.proc_completada }
  }
  function _colorFaseMs (ms, fase) {
    const h = ms / 3600000
    const lim = fase === 'cotizacion' ? [0.5, 2] : (fase === 'autorizacion' ? [2, 8] : [24, 72])
    if (h <= lim[0]) return 'var(--green,#16a34a)'
    if (h <= lim[1]) return 'var(--amber,#f59e0b)'
    return 'var(--red,#f85149)'
  }

  function renderProcClock () {
    const el = $('cot-proc-clock'); if (!el) return
    const f = _procFase(PF)
    if (!f.fase || f.fase === 'sin_iniciar') { el.style.display = 'none'; return }
    el.style.display = ''
    if (f.fase === 'completado') {
      const t1 = new Date(PF.proc_aprobada || PF.proc_inicio).getTime() - new Date(PF.proc_inicio).getTime()
      const t2 = new Date(PF.proc_completada).getTime() - new Date(PF.proc_aprobada || PF.proc_inicio).getTime()
      el.innerHTML = `<span style="color:var(--green,#16a34a);font-weight:700">✅ Proceso completado</span> <span style="color:var(--text3,#8b949e)">· Autorización ${_fmtDur2(t1)} · Compra ${_fmtDur2(t2)}</span>`
      return
    }
    const ms = Date.now() - new Date(f.desde).getTime()
    const lbl = f.fase === 'autorizacion' ? '⏱ Esperando autorización' : '⏱ Compra y entrega'
    el.innerHTML = `<span style="color:${_colorFaseMs(ms, f.fase)};font-weight:700;font-variant-numeric:tabular-nums">${lbl}: ${_fmtCrono(ms)}</span>`
  }
  function startClock () {
    if (_clockTimer) return
    _clockTimer = setInterval(() => { renderProcClock(); tickTablero() }, 1000)
  }
  function tickTablero () {
    document.querySelectorAll('[data-crono-desde]').forEach(el => {
      const acum = parseInt(el.getAttribute('data-crono-acum') || '0', 10) || 0
      const ms = acum + (Date.now() - new Date(el.getAttribute('data-crono-desde')).getTime())
      el.textContent = _fmtCrono(ms)
      el.style.color = _colorFaseMs(ms, el.getAttribute('data-crono-fase'))
    })
  }
  // Reloj compacto para las tarjetas de lista (Inicio/Cotización)
  function clockCardHTML (p) {
    if (p.estado === 'finalizada' || p.estado === 'anulada') return ''   // proceso cerrado → sin reloj
    const f = _procFase(p)
    if (!f.fase || f.fase === 'sin_iniciar' || f.fase === 'completado') return ''
    const acumMs = f.fase === 'cotizacion' ? (p.proc_cotiz_ms || 0) : (f.fase === 'autorizacion' ? (p.proc_autor_ms || 0) : (p.proc_compra_ms || 0))
    const ms = acumMs + (Date.now() - new Date(f.desde).getTime())
    const lbl = f.fase === 'cotizacion' ? '📝 Cotización' : (f.fase === 'autorizacion' ? '⏱ Autoriz.' : '📦 Pedido')
    return `<span style="font-size:11px;color:var(--text3,#8b949e)">${lbl}</span> <span data-crono-desde="${esc(f.desde)}" data-crono-fase="${f.fase}" data-crono-acum="${acumMs}" style="font-weight:700;font-variant-numeric:tabular-nums;color:${_colorFaseMs(ms, f.fase)}">${_fmtCrono(ms)}</span>`
  }

  async function marcarProcInicio () {
    if (!PF.id) return
    if (PF.estado === 'finalizada' || PF.proc_completada) {
      // El proceso anterior ya terminó → ofrecer reabrir como NUEVO proceso
      const ok = confirm('Esta cotización ya estaba finalizada.\n\n¿Iniciar un NUEVO proceso para los repuestos agregados?\n\n• Se archivan los tiempos del proceso anterior (no se pierden).\n• Arranca un cronómetro nuevo de autorización.\n• Los repuestos ya entregados se conservan; el nuevo queda "Sin pedir".')
      if (ok) await nuevoCicloProceso()
      return
    }
    if (PF.proc_inicio) return
    const ts = new Date().toISOString()
    try {
      const { error } = await sb().rpc('cot_marcar_pdf', { p_id: PF.id })
      if (!error) { PF.proc_inicio = ts; if (PF.estado === 'solicitada') PF.estado = 'pendiente'; renderProcClock(); startClock() }
    } catch (e) { console.error('[proc inicio]', e) }
  }
  async function nuevoCicloProceso () {
    const previos = Array.isArray(PF.procesos_previos) ? PF.procesos_previos.slice() : []
    previos.push({
      ciclo: previos.length + 1,
      proc_inicio: PF.proc_inicio, proc_aprobada: PF.proc_aprobada,
      proc_completada: PF.proc_completada, proc_aprobada_por: PF.proc_aprobada_por,
      cerrado: new Date().toISOString()
    })
    const now = new Date().toISOString()
    const upd = { procesos_previos: previos, proc_inicio: now, proc_aprobada: null, proc_completada: null, proc_aprobada_por: null, estado: 'pendiente' }
    try {
      const { error } = await sb().from('cotizador_proformas').update(upd).eq('id', PF.id)
      if (error) throw error
      Object.assign(PF, upd)
      setNumLabel(); startClock()
      toast(`🔄 Nuevo proceso iniciado (ciclo ${previos.length + 1}). Volvió a Inicio; gestioná el repuesto agregado.`, 'success')
    } catch (e) { console.error('[nuevo ciclo]', e); toast('Error al iniciar el nuevo proceso: ' + (e.message || e), 'error') }
  }
  async function checkProcCompletada () {
    if (!PEDPF || !PEDPF.id) return
    const prods = (PEDPF.items || []).filter(it => it.tipo === 'p')
    // Pendiente = ítem pedido a proveedor y aún NO llegó, o sin decidir.
    // Los de bodega y los ya llegados NO cuentan (no están en el proceso de compra).
    const pendientes = prods.filter(it => it.seguimiento === 'pedido' || !it.seguimiento)
    const completo = prods.length > 0 && pendientes.length === 0
    const now = new Date().toISOString()
    try {
      if (completo && !PEDPF.proc_completada) {
        // llegó el último que estaba en proceso de pedido → detener el reloj de compra
        const { error } = await sb().from('cotizador_proformas').update({ proc_completada: now }).eq('id', PEDPF.id).is('proc_completada', null)
        if (!error) { PEDPF.proc_completada = now; toast('✅ Repuestos completos — reloj de compra detenido. Falta que finalices la cotización.', 'success') }
      } else if (!completo && PEDPF.proc_completada) {
        // todavía falta un repuesto por llegar → el reloj de compra debe seguir corriendo
        const upd = { proc_completada: null }
        if (PEDPF.estado === 'finalizada') upd.estado = 'autorizada'   // se cerró mal: reactivar
        const { error } = await sb().from('cotizador_proformas').update(upd).eq('id', PEDPF.id)
        if (!error) { PEDPF.proc_completada = null; if (upd.estado) PEDPF.estado = upd.estado; toast(`⏱ Falta ${pendientes.length} repuesto(s) por llegar — reloj de compra reactivado.`, 'success') }
      }
    } catch (e) { console.error('[proc reconciliar]', e) }
  }
  async function finalizarProcesoManual () {
    if (!PEDPF || !PEDPF.id) return
    if (PEDPF.proc_completada) { toast('El proceso ya estaba completado', 'success'); return }
    if (!confirm('¿Finalizar el proceso ahora? Se detiene el cronómetro de compra.')) return
    const ts = new Date().toISOString()
    try {
      const { error } = await sb().from('cotizador_proformas').update({ proc_completada: ts }).eq('id', PEDPF.id).is('proc_completada', null)
      if (error) throw error
      PEDPF.proc_completada = ts; toast('🏁 Proceso finalizado', 'success'); renderPedidos()
    } catch (e) { console.error('[proc fin manual]', e); toast('Error al finalizar', 'error') }
  }

  function _esAutorizada (p) { return p.estado === 'autorizada' || p.estado === 'finalizada' || !!p.proc_aprobada }

  async function descartarProceso (id) {
    if (!ES_SUPER) { toast('Solo super_admin', 'error'); return }
    if (!confirm('¿Cerrar el seguimiento de tiempos de este proceso?\n\nSe quita de "Procesos en curso" y del histórico. No afecta la cotización ni sus pedidos.')) return
    try {
      const { error } = await sb().from('cotizador_proformas').update({ proc_inicio: null, proc_aprobada: null, proc_completada: null }).eq('id', id)
      if (error) throw error
      toast('Proceso cerrado', 'success'); loadEstadisticas()
    } catch (e) { console.error('[descartar proc]', e); toast('Error: ' + (e.message || e), 'error') }
  }

  async function loadEstadisticas () {
    const body = $('est-kpis'); if (body) body.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text3,#8b949e);padding:16px">Cargando…</div>'
    if (EST_MODO === 'rango' && EST_DESDE > EST_HASTA) { const t = EST_DESDE; EST_DESDE = EST_HASTA; EST_HASTA = t }
    const start = EST_MODO === 'rango' ? _estBoundISO(EST_DESDE, 0) : _estBoundISO(EST_DIA, 0)
    const end = EST_MODO === 'rango' ? _estBoundISO(EST_HASTA, 1) : _estBoundISO(EST_DIA, 1)
    const cols = 'id,correlativo,vendedor,cliente,placa,marca,modelo,total,estado,created_at,proc_inicio,proc_aprobada,proc_completada,proc_aprobada_por,procesos_previos,jefe_pista,proc_solicitada,proc_cotiz_ms,proc_autor_ms,proc_compra_ms'
    const tit = $('est-tabla-tit')
    if (tit) tit.textContent = EST_MODO === 'rango' ? `${_estFechaCorta(EST_DESDE)} a ${_estFechaCorta(EST_HASTA)}` : (EST_DIA === _estHoy() ? 'Hoy' : _estFechaCorta(EST_DIA))
    try {
      const [rango, curso, hist] = await Promise.all([
        sb().from('cotizador_proformas').select(cols).gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).limit(3000),
        sb().from('cotizador_proformas').select(cols).or('proc_inicio.not.is.null,proc_solicitada.not.is.null').is('proc_completada', null).neq('estado', 'finalizada').order('proc_inicio', { ascending: true }).limit(200),
        sb().from('cotizador_proformas').select(cols).or('proc_inicio.not.is.null,proc_solicitada.not.is.null').or(`proc_completada.gte.${start},proc_completada.is.null`).order('proc_inicio', { ascending: false }).limit(1000)
      ])
      if (rango.error) throw rango.error
      renderEstadisticas(rango.data || [], curso.data || [], hist.data || [], new Date(start).getTime(), new Date(end).getTime())
    } catch (e) { console.error('[estadisticas]', e); if (body) body.innerHTML = '<div style="grid-column:1/-1;color:var(--red,#f85149);padding:12px">Error al cargar</div>' }
  }
  function renderEstadisticas (rows, enCursoRows, histSrc, startMs, endMs) {
    const nCot = rows.length
    const aut = rows.filter(_esAutorizada)
    const tasa = nCot ? Math.round(aut.length / nCot * 100) : 0
    const totCot = rows.reduce((a, p) => a + (Number(p.total) || 0), 0)
    const totAut = aut.reduce((a, p) => a + (Number(p.total) || 0), 0)
    const card = (val, lbl, color) => `<div class="form-card" style="padding:14px 16px"><div style="font-size:25px;font-weight:800;color:${color || 'var(--text,#e6edf3)'}">${val}</div><div style="font-size:12px;color:var(--text3,#8b949e)">${lbl}</div></div>`
    $('est-kpis').innerHTML =
      card(nCot, 'Cotizaciones') +
      card(aut.length, 'Autorizadas', 'var(--green,#16a34a)') +
      card(tasa + '%', 'Tasa autorización', 'var(--gold,#c8a24a)') +
      card('L ' + fmt(totCot), 'Total cotizado') +
      card('L ' + fmt(totAut), 'Total autorizado', 'var(--green,#16a34a)')

    const porMes = EST_MODO === 'rango' && (new Date(_estBoundISO(EST_HASTA, 1)) - new Date(_estBoundISO(EST_DESDE, 0))) > 62 * 864e5
    const grupos = {}
    rows.forEach(p => {
      const d = new Date(p.created_at)
      const key = porMes ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const lbl = porMes ? d.toLocaleDateString('es', { month: 'short', year: '2-digit' }) : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
      const g = (grupos[key] = grupos[key] || { key, lbl, cot: 0, aut: 0, mc: 0, ma: 0 })
      g.cot++; g.mc += Number(p.total) || 0
      if (_esAutorizada(p)) { g.aut++; g.ma += Number(p.total) || 0 }
    })
    const pctColor = pct => pct >= 40 ? 'var(--green,#16a34a)' : (pct >= 15 ? 'var(--amber,#f59e0b)' : 'var(--red,#f85149)')
    const filasHtml = Object.values(grupos).sort((a, b) => b.key.localeCompare(a.key)).map(g => {
      const pct = g.cot ? Math.round(g.aut / g.cot * 100) : 0
      return `<tr style="border-top:1px solid var(--border,#2a3340)">
        <td style="padding:8px 10px;font-weight:600">${g.lbl}</td>
        <td style="padding:8px 10px;text-align:center">${g.cot}</td>
        <td style="padding:8px 10px"><div style="display:flex;align-items:center;gap:8px"><span style="min-width:14px">${g.aut}</span><div style="flex:1;height:6px;background:var(--bg3,#1c2333);border-radius:4px;overflow:hidden;max-width:110px"><div style="height:100%;width:${pct}%;background:${pctColor(pct)}"></div></div></div></td>
        <td style="padding:8px 10px;text-align:right;color:var(--text2,#9aa4b2)">L ${fmt(g.mc)}</td>
        <td style="padding:8px 10px;text-align:right;color:var(--green,#16a34a)">L ${fmt(g.ma)}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;color:${pctColor(pct)}">${pct}%</td>
      </tr>`
    }).join('')
    $('est-tabla').innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:var(--text3,#8b949e);font-size:11px;text-transform:uppercase">
        <th style="padding:6px 10px;text-align:left">Período</th><th style="padding:6px 10px;text-align:center">Cotizadas</th><th style="padding:6px 10px;text-align:left">Autorizadas</th><th style="padding:6px 10px;text-align:right">Monto cotizado</th><th style="padding:6px 10px;text-align:right">Monto autorizado</th><th style="padding:6px 10px;text-align:right">% éxito</th>
      </tr></thead><tbody>${filasHtml || '<tr><td colspan="6" style="padding:14px;text-align:center;color:var(--text3,#8b949e)">Sin datos en el período</td></tr>'}</tbody></table></div>`

    const enCurso = (enCursoRows || []).slice().sort((a, b) => new Date(a.proc_inicio) - new Date(b.proc_inicio))
    $('est-tablero').innerHTML = enCurso.length ? enCurso.map(p => {
      const f = _procFase(p)
      const faseLbl = f.fase === 'cotizacion' ? '📝 Esperando cotización' : (f.fase === 'autorizacion' ? '⏳ Esperando autorización' : '📦 Compra y entrega')
      const faseBg = f.fase === 'cotizacion' ? 'rgba(139,92,246,.12)' : (f.fase === 'autorizacion' ? 'rgba(245,158,11,.12)' : 'rgba(59,130,246,.12)')
      const resp = f.fase === 'cotizacion' ? (p.vendedor || 'Cotizador') : (f.fase === 'autorizacion' ? (p.jefe_pista || p.vendedor || '—') : (p.proc_aprobada_por || p.jefe_pista || p.vendedor || '—'))
      const respLbl = f.fase === 'cotizacion' ? 'Cotizador' : (f.fase === 'autorizacion' ? 'Jefe de pista' : 'Resp')
      const acumMs = f.fase === 'cotizacion' ? (p.proc_cotiz_ms || 0) : (f.fase === 'autorizacion' ? (p.proc_autor_ms || 0) : (p.proc_compra_ms || 0))
      const ms = acumMs + (Date.now() - new Date(f.desde).getTime())
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;background:${faseBg};margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${esc([p.marca, p.modelo].filter(Boolean).join(' ') || 'Cotización')} · ${esc(p.placa || '')}</div>
          <div style="font-size:11px;color:var(--text3,#8b949e)">${faseLbl} · ${respLbl}: ${esc(resp)}${p.cliente ? ' · ' + esc(p.cliente) : ''}</div>
        </div>
        <div data-crono-desde="${esc(f.desde)}" data-crono-fase="${f.fase}" data-crono-acum="${acumMs}" style="font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;color:${_colorFaseMs(ms, f.fase)}">${_fmtCrono(ms)}</div>
      </div>`
    }).join('') : '<div style="text-align:center;color:var(--text3,#8b949e);padding:16px">No hay procesos en curso ahora mismo.</div>'

    // Histórico de tiempos por fase — ubica cada ciclo por la FECHA DEL PROCESO:
    // un ciclo completado cuenta el día que se completó; los en curso siempre se muestran.
    const fase1s = [], fase2s = []
    const procsAll = []
    ;(histSrc || []).forEach(p => {
      const prev = Array.isArray(p.procesos_previos) ? p.procesos_previos : []
      prev.forEach(c => procsAll.push({ p, ciclo: c.ciclo, ini: c.proc_inicio, apr: c.proc_aprobada, com: c.proc_completada, por: c.proc_aprobada_por }))
      if (p.proc_inicio || p.proc_solicitada) procsAll.push({ p, ciclo: prev.length + 1, sol: p.proc_solicitada, ini: p.proc_inicio, apr: p.proc_aprobada, com: p.proc_completada, por: p.proc_aprobada_por, actual: true, cotizMs: p.proc_cotiz_ms, autorMs: p.proc_autor_ms, compraMs: p.proc_compra_ms })
    })
    const _ahora = Date.now()
    const procs = procsAll.filter(x => {
      if (x.com) { const t = new Date(x.com).getTime(); return t >= startMs && t < endMs }   // completado → día en que se completó
      return _ahora >= startMs && _ahora < endMs   // en curso → visible cuando el período incluye "ahora" (hoy)
    })
    const fase0s = []
    const histRows = procs.map(x => {
      const ts = x.sol ? new Date(x.sol).getTime() : null
      const t0 = x.ini ? new Date(x.ini).getTime() : null
      const t1 = x.apr ? new Date(x.apr).getTime() : null
      const t2 = x.com ? new Date(x.com).getTime() : null
      let f0, f1, f2
      if (x.actual) {
        const enCot = x.ini == null && x.sol != null       // fase cotización en curso
        const enAut = x.ini != null && x.apr == null        // fase autorización en curso
        const enComp = x.apr != null && x.com == null       // fase compra en curso
        f0 = ((x.cotizMs || 0) === 0 && !enCot) ? null : ((x.cotizMs || 0) + (enCot ? (Date.now() - ts) : 0))
        f1 = ((x.autorMs || 0) === 0 && !enAut) ? null : ((x.autorMs || 0) + (enAut ? (Date.now() - t0) : 0))
        const compStint = x.com ? (t2 - t1) : (enComp ? (Date.now() - t1) : 0)
        f2 = ((x.compraMs || 0) === 0 && x.apr == null && !x.com) ? null : ((x.compraMs || 0) + compStint)
      } else {
        f0 = (t0 != null && ts != null) ? t0 - ts : null    // ciclos previos: por timestamps
        f1 = (t1 != null && t0 != null) ? t1 - t0 : null
        f2 = (t2 != null && t1 != null) ? t2 - t1 : null
      }
      if (f0 != null) fase0s.push(f0)
      if (f1 != null) fase1s.push(f1)
      if (f2 != null) fase2s.push(f2)
      const estadoTxt = x.com ? '<span style="color:var(--green,#16a34a)">Completado</span>' : (x.apr ? '<span style="color:#3b82f6">En compra</span>' : (x.ini ? '<span style="color:var(--amber,#f59e0b)">Esperando aut.</span>' : '<span style="color:#8b5cf6">Esperando cotización</span>'))
      return { p: x.p, ciclo: x.ciclo, por: x.por, com: x.com, f0, f1, f2, estadoTxt, orden: t2 || t1 || t0 || ts || 0 }
    }).sort((a, b) => b.orden - a.orden)
    const prom = arr => arr.length ? Math.round(arr.reduce((a, x) => a + x, 0) / arr.length) : null
    const resumen = `<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:10px;font-size:12px">
      <div>Promedio cotización: <b style="color:var(--gold,#c8a24a)">${_fmtDur2(prom(fase0s))}</b> <span style="color:var(--text3,#8b949e)">(${fase0s.length})</span></div>
      <div>Promedio autorización: <b style="color:var(--gold,#c8a24a)">${_fmtDur2(prom(fase1s))}</b> <span style="color:var(--text3,#8b949e)">(${fase1s.length})</span></div>
      <div>Promedio compra/entrega: <b style="color:var(--gold,#c8a24a)">${_fmtDur2(prom(fase2s))}</b> <span style="color:var(--text3,#8b949e)">(${fase2s.length})</span></div>
    </div>`
    const histHtml = histRows.map(h => {
      const p = h.p
      return `<tr style="border-top:1px solid var(--border,#2a3340)">
        <td style="padding:7px 10px">${esc([p.marca, p.modelo].filter(Boolean).join(' ') || 'Cotización')} · ${esc(p.placa || '')}${h.ciclo > 1 ? ` <span style="color:var(--gold,#c8a24a);font-size:11px">· ciclo ${h.ciclo}</span>` : ''}</td>
        <td style="padding:7px 10px">${esc(p.vendedor || '—')}</td>
        <td style="padding:7px 10px;text-align:right;color:${h.f0 != null ? _colorFaseMs(h.f0, 'cotizacion') : 'var(--text3,#8b949e)'}">${h.f0 != null ? _fmtDur2(h.f0) : '—'}</td>
        <td style="padding:7px 10px;text-align:right;color:${h.f1 != null ? _colorFaseMs(h.f1, 'autorizacion') : 'var(--text3,#8b949e)'}">${h.f1 != null ? _fmtDur2(h.f1) : '—'}</td>
        <td style="padding:7px 10px">${esc(h.por || '—')}</td>
        <td style="padding:7px 10px;text-align:right;color:${h.f2 != null ? _colorFaseMs(h.f2, 'compra') : 'var(--text3,#8b949e)'}">${h.f2 != null ? _fmtDur2(h.f2) : '—'}</td>
        <td style="padding:7px 10px">${h.estadoTxt}${ES_SUPER && !h.com && h.f1 == null && h.f0 == null && !h.p.proc_solicitada ? ` <button data-descartar="${h.p.id}" title="Cerrar / descartar este proceso trabado" style="background:none;border:0;color:var(--text3,#8b949e);cursor:pointer;font-size:13px;padding:0 4px">✕</button>` : ''}</td>
      </tr>`
    }).join('')
    $('est-hist').innerHTML = procs.length ? resumen + `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:var(--text3,#8b949e);font-size:11px;text-transform:uppercase">
        <th style="padding:6px 10px;text-align:left">Vehículo</th><th style="padding:6px 10px;text-align:left">Vendedor</th><th style="padding:6px 10px;text-align:right">Cotización</th><th style="padding:6px 10px;text-align:right">Autorización</th><th style="padding:6px 10px;text-align:left">Autorizó</th><th style="padding:6px 10px;text-align:right">Compra/entrega</th><th style="padding:6px 10px;text-align:left">Estado</th>
      </tr></thead><tbody>${histHtml}</tbody></table></div>`
      : '<div style="text-align:center;color:var(--text3,#8b949e);padding:16px">Aún no hay procesos con tiempos en este período.</div>'
    startClock()
  }

  // ══════════════════════════════════════════════════════════
  //  PROVEEDORES · contactos (WhatsApp / Llamar)
  // ══════════════════════════════════════════════════════════
  let PROV_CONT = []
  const provNorm = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim()
  const normTel = (t) => { let n = String(t || '').replace(/\D/g, ''); if (n && n.length <= 8) n = '504' + n; return n }
  const waHref = (tel, msg) => 'https://wa.me/' + normTel(tel) + '?text=' + encodeURIComponent(msg)
  const telHref = (tel) => 'tel:+' + normTel(tel)

  async function fetchProveedoresCompras () {
    const set = new Set(); let from = 0; const step = 1000
    for (let i = 0; i < 12; i++) {
      const { data, error } = await sb().from('cotizador_compras').select('proveedor').range(from, from + step - 1)
      if (error || !data) break
      data.forEach(r => { const p = (r.proveedor || '').trim(); if (p) set.add(p) })
      if (data.length < step) break
      from += step
    }
    return [...set]
  }

  async function loadProveedores () {
    const cont = $('cot-prov-list'); if (cont) cont.innerHTML = '<div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Cargando…</div>'
    try {
      const { data: contactos } = await sb().from('proveedores_contacto').select('*')
      const compras = await fetchProveedoresCompras()
      const map = {}
      ;(contactos || []).forEach(c => { map[c.nombre_norm] = { nombre: c.nombre, nombre_norm: c.nombre_norm, telefono: c.telefono || '', contacto: c.contacto || '' } })
      compras.forEach(nom => { const k = provNorm(nom); if (k && !map[k]) map[k] = { nombre: nom, nombre_norm: k, telefono: '', contacto: '' } })
      PROV_CONT = Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre))
      renderProveedores('')
    } catch (e) { console.error('[cot proveedores]', e); if (cont) cont.innerHTML = '<div style="color:var(--red,#f85149)">Error al cargar</div>' }
  }

  function renderProveedores (filtro) {
    const cont = $('cot-prov-list'); if (!cont) return
    const t = (filtro || '').toUpperCase()
    const list = PROV_CONT.filter(p => !t || p.nombre.toUpperCase().includes(t) || (p.contacto || '').toUpperCase().includes(t))
    cont._list = list
    if (!list.length) { cont.innerHTML = '<div style="color:var(--text3,#8b949e);padding:10px">Sin proveedores</div>'; return }
    cont.innerHTML = list.map((p, i) => {
      const msg = `Buen día${p.contacto ? ' ' + p.contacto : ''}, le consulto por el estado del envío de los repuestos que solicitamos. Gracias.`
      const wa = p.telefono ? `<a class="btn" href="${waHref(p.telefono, msg)}" target="_blank" rel="noopener" style="color:#25d366;font-size:12px;padding:5px 10px;text-decoration:none">💬 WhatsApp</a>` : ''
      const call = p.telefono ? `<a class="btn" href="${telHref(p.telefono)}" style="font-size:12px;padding:5px 10px;text-decoration:none">📞 Llamar</a>` : ''
      return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--border,#2a3340)">
        <div style="min-width:180px;flex:1;font-weight:600;font-size:13px">${esc(p.nombre)}</div>
        <input class="cot-in prov-cont" data-i="${i}" placeholder="Contacto" value="${esc(p.contacto || '')}" style="width:150px">
        <input class="cot-in prov-tel" data-i="${i}" placeholder="Teléfono" value="${esc(p.telefono || '')}" style="width:130px">
        <button class="btn btn-ghost prov-save" data-i="${i}" style="font-size:12px;padding:5px 10px">💾 Guardar</button>
        ${wa} ${call}
      </div>`
    }).join('')
  }

  async function guardarProveedorRow (i) {
    const cont = $('cot-prov-list'); const list = cont._list || PROV_CONT
    const p = list[i]; if (!p) return
    const tel = normTel((cont.querySelector(`.prov-tel[data-i="${i}"]`) || {}).value || '')
    const contacto = ((cont.querySelector(`.prov-cont[data-i="${i}"]`) || {}).value || '').trim()
    try {
      const { error } = await sb().from('proveedores_contacto').upsert({ nombre: p.nombre, nombre_norm: p.nombre_norm, telefono: tel, contacto }, { onConflict: 'nombre_norm' })
      if (error) throw error
      p.telefono = tel; p.contacto = contacto
      // reflejar en el cache global por si el modal de pedidos lo usa
      toast('Proveedor guardado', 'success')
      renderProveedores($('cot-prov-q') ? $('cot-prov-q').value : '')
    } catch (e) { console.error('[cot prov save]', e); toast('Error: ' + (e.message || e), 'error') }
  }

  // Devuelve el contacto guardado de un proveedor (para el modal de Pedidos)
  function contactoDe (nombre) {
    const k = provNorm(nombre)
    return PROV_CONT.find(p => p.nombre_norm === k) || null
  }

  // ── Pedidos rápidos (Inicio del cotizador) ──
  let _prTimer = null
  let _prVerHist = false
  function colorPrMin (min) { const h = (min || 0) / 60; return h <= 8 ? 'var(--green,#16a34a)' : (h <= 48 ? 'var(--amber,#f59e0b)' : 'var(--red,#f85149)') }
  function tickPrRapidos () {
    document.querySelectorAll('#cot-pr-list [data-pr-desde]').forEach(el => {
      const min = difMin(el.getAttribute('data-pr-desde'), null)
      el.textContent = fmtDur(min); el.style.color = colorPrMin(min)
    })
  }
  async function loadPedidosRapidos () {
    const cont = $('cot-pr-list'); if (!cont) return
    try {
      let q = sb().from('pedidos_rapidos').select('*')
      if (_prVerHist) q = q.eq('estado', 'entregado').order('fecha_entrega', { ascending: false }).limit(100)
      else q = q.neq('estado', 'entregado').order('creado_en', { ascending: true }).limit(200)
      const { data, error } = await q
      if (error) throw error
      renderPrRapidos(data || [])
      if (!_prTimer) _prTimer = setInterval(tickPrRapidos, 30000)
    } catch (e) { console.error('[pr rapidos]', e); cont.innerHTML = `<div style="color:var(--red,#f85149);font-size:12px;padding:8px">Error: ${esc(e.message || e)}</div>` }
  }
  function renderPrRapidos (list) {
    const cont = $('cot-pr-list'); if (!cont) return
    if (!list.length) { cont.innerHTML = `<div style="text-align:center;color:var(--text3,#8b949e);padding:12px;font-size:13px">${_prVerHist ? 'Sin pedidos entregados aún.' : 'Sin pedidos rápidos.'}</div>`; return }
    cont.innerHTML = list.map(p => {
      const pend = p.estado === 'pendiente', pedido = p.estado === 'pedido'
      let reloj, estadoTxt, botones
      if (p.estado === 'entregado') {
        const min = difMin(p.creado_en, p.fecha_entrega || p.fecha_llegada)
        reloj = `<span style="color:var(--text3,#8b949e);font-size:12px">entregado ${(p.fecha_entrega || '').slice(0, 10)} · tardó ${fmtDur(min)}</span>`
        estadoTxt = '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(139,92,246,.18);color:#8b5cf6;font-weight:700">ENTREGADO</span>'
        botones = ''
      } else if (p.estado === 'llegado') {
        const min = difMin(p.creado_en, p.fecha_llegada)
        reloj = `<span style="font-weight:700;color:${colorPrMin(min)}">✓ tardó ${fmtDur(min)}</span>`
        estadoTxt = '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(22,163,74,.18);color:#16a34a;font-weight:700">LLEGÓ</span>'
        botones = `<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px" data-pr-entregar="${p.id}">📦 Entregado</button>`
      } else {
        const min = difMin(p.creado_en, null)
        reloj = `<span data-pr-desde="${esc(p.creado_en)}" style="font-weight:700;font-variant-numeric:tabular-nums;color:${colorPrMin(min)}">${fmtDur(min)}</span>`
        estadoTxt = pedido
          ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(59,130,246,.18);color:#3b82f6;font-weight:700">PEDIDO${p.proveedor ? ' · ' + esc(p.proveedor) : ''}</span>`
          : '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(139,92,246,.18);color:#8b5cf6;font-weight:700">POR PEDIR</span>'
        botones = (pend ? `<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px" data-pr-pedir="${p.id}">🚚 Pedir</button>` : '')
          + `<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px" data-pr-llego="${p.id}">✓ Llegó</button>`
      }
      return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 4px;border-top:1px solid var(--border,#2a3340)">
        <span style="flex:1;min-width:150px;font-size:13px"><b>${esc(p.repuesto)}</b> <span style="color:var(--text3,#8b949e)">x${fmt(p.cantidad)}</span>${p.vehiculo ? ` · <span style="color:var(--text3,#8b949e)">${esc(p.vehiculo)}</span>` : ''}${p.pedido_por ? ` · <span style="color:var(--text3,#8b949e)">👤 ${esc(p.pedido_por)}</span>` : ''}</span>
        ${estadoTxt} ${reloj} ${botones}
        <button class="btn btn-ghost" style="font-size:11px;padding:4px 8px;color:var(--red,#f85149)" data-pr-del="${p.id}">🗑</button>
      </div>`
    }).join('')
  }
  async function prAddRapido () {
    const rep = ($('cot-pr-rep')?.value || '').trim().toUpperCase()
    if (!rep) { toast('Escribí el repuesto', 'error'); return }
    const cant = parseFloat($('cot-pr-cant')?.value) || 1
    const veh = ($('cot-pr-veh')?.value || '').trim().toUpperCase()
    const por = ($('cot-pr-por')?.value || '').trim()
    try {
      const prof = window._currentProfile ? window._currentProfile() : null
      const { error } = await sb().from('pedidos_rapidos').insert({ repuesto: rep, cantidad: cant, vehiculo: veh || null, pedido_por: por || null, creado_por: prof ? (prof.nombre || '') : '' })
      if (error) throw error
      toast('⚡ Pedido rápido agregado', 'success')
      ;['cot-pr-rep', 'cot-pr-veh', 'cot-pr-por'].forEach(id => { const el = $(id); if (el) el.value = '' })
      const c = $('cot-pr-cant'); if (c) c.value = '1'
      const r = $('cot-pr-rep'); if (r) r.focus()
      loadPedidosRapidos()
    } catch (e) { console.error('[pr add]', e); toast('Error: ' + (e.message || e), 'error') }
  }
  async function prPedir (id) {
    const prov = prompt('¿A qué proveedor se lo pedís? (opcional)')
    if (prov === null) return
    try {
      const { error } = await sb().from('pedidos_rapidos').update({ estado: 'pedido', proveedor: (prov || '').trim() || null, fecha_pedido: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      toast('🚚 Pedido', 'success'); loadPedidosRapidos()
    } catch (e) { toast('Error: ' + (e.message || e), 'error') }
  }
  async function prLlego (id) {
    try {
      const { error } = await sb().from('pedidos_rapidos').update({ estado: 'llegado', fecha_llegada: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      toast('✓ Llegó', 'success'); loadPedidosRapidos()
    } catch (e) { toast('Error: ' + (e.message || e), 'error') }
  }
  async function prEntregar (id) {
    try {
      const { error } = await sb().from('pedidos_rapidos').update({ estado: 'entregado', fecha_entrega: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      toast('📦 Entregado', 'success'); loadPedidosRapidos()
    } catch (e) { toast('Error: ' + (e.message || e), 'error') }
  }
  async function prDel (id) {
    if (!confirm('¿Eliminar este pedido rápido?')) return
    try { const { error } = await sb().from('pedidos_rapidos').delete().eq('id', id); if (error) throw error; loadPedidosRapidos() } catch (e) { toast('Error: ' + (e.message || e), 'error') }
  }

  async function loadDashboard () {
    const stats = $('cot-dash-stats'); const list = $('cot-dash-list')
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0); const desdeHoy = hoy.toISOString()
    try {
      const P = () => sb().from('cotizador_proformas')
      const [cTot, cPend, cAut, hoyCot, hoyAut, pend] = await Promise.all([
        P().select('*', { count: 'exact', head: true }),
        P().select('*', { count: 'exact', head: true }).eq('estado', 'pendiente'),
        P().select('*', { count: 'exact', head: true }).eq('estado', 'autorizada'),
        P().select('total').gte('created_at', desdeHoy),
        P().select('total').eq('estado', 'autorizada').gte('updated_at', desdeHoy),
        P().select('id,correlativo,vendedor,cliente,placa,marca,modelo,anio,total,estado,created_at,items,proc_inicio,proc_aprobada,proc_completada,proc_solicitada,jefe_pista,proc_cotiz_ms,proc_autor_ms,proc_compra_ms,solicitados').in('estado', ['solicitada', 'pendiente', 'autorizada']).order('created_at', { ascending: false }).limit(60)
      ])
      const sum = (r) => (r.data || []).reduce((a, x) => a + (Number(x.total) || 0), 0)
      const st = [
        ['L. ' + fmt(sum(hoyCot)), 'Cotizado hoy'],
        ['L. ' + fmt(sum(hoyAut)), 'Autorizado hoy'],
        [cTot.count || 0, 'Cotizaciones totales'],
        [cPend.count || 0, 'Pendientes'],
        [cAut.count || 0, 'Autorizadas']
      ]
      stats.innerHTML = st.map(s => `<div class="cot-stat"><div class="n">${s[0]}</div><div class="l">${s[1]}</div></div>`).join('')
      const rows = pend.data || []
      list.innerHTML = rows.length ? rows.map(filaDash).join('')
        : '<div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Sin cotizaciones activas</div>'
      startClock()
      loadPedidosRapidos()
    } catch (e) {
      console.error('[cotizador dashboard]', e)
      stats.innerHTML = ''; list.innerHTML = `<div style="text-align:center;color:var(--red,#f85149);padding:20px">Error al cargar: ${esc(e.message || e)}</div>`
    }
  }

  function progresoPedidos (items) {
    const prods = (items || []).filter(it => it.tipo !== 's')
    const total = prods.length
    const pedidos = prods.filter(it => it.seguimiento === 'pedido' || it.seguimiento === 'llegado').length
    const llegados = prods.filter(it => it.seguimiento === 'llegado').length
    let estado = '', color = 'var(--text3,#8b949e)'
    if (total > 0) {
      if (llegados === total) { estado = 'Listo'; color = 'var(--green,#16a34a)' }
      else if (pedidos === total) { estado = 'En camino'; color = '#3b82f6' }
      else if (pedidos > 0) { estado = 'Parcial'; color = 'var(--amber,#f59e0b)' }
    }
    return { total, pedidos, llegados, estado, color }
  }

  function filaDash (p) {
    const num = numeroDe(p.vendedor, p.correlativo)
    const veh = [p.marca, p.modelo, p.anio].filter(Boolean).join(' ')
    const esAut = p.estado === 'autorizada'
    const pr = progresoPedidos(p.items)
    const pendSolic = (p.solicitados || []).filter(s => s && !s.agregado).length
    const badgeNuevo = pendSolic > 0 ? ` <span style="font-size:10px;font-weight:800;color:#1a1a1a;background:#f0a500;padding:2px 6px;border-radius:8px">📋 ${pendSolic} solicitado${pendSolic > 1 ? 's' : ''}</span>` : ''
    const badge = (esAut && pr.total > 0)
      ? ` <span style="font-size:12px;font-weight:800;color:${pr.color}">${pr.llegados}/${pr.total}</span>${pr.estado ? ` <span style="font-size:11px;color:${pr.color};font-weight:600">${pr.estado}</span>` : ''}`
      : ''
    const editar = `<button class="btn btn-ghost" data-dashact="editar" data-pf="${p.id}" style="font-size:11px;padding:4px 10px">✏ Editar</button>`
    let accion
    if (esAut) {
      const completo = pr.total === 0 || pr.llegados === pr.total
      accion = editar + ` <button class="btn btn-ghost" data-dashact="finalizar" data-pf="${p.id}" style="font-size:11px;padding:4px 10px;color:${completo ? 'var(--green,#16a34a)' : 'var(--text3,#8b949e)'}${completo ? '' : ';opacity:.45;cursor:not-allowed'}"${completo ? '' : ` disabled title="Faltan productos por llegar (${pr.llegados}/${pr.total})"`}>Finalizar</button>`
    } else {
      accion = editar + ` <button class="btn btn-ghost" data-dashact="autorizar" data-pf="${p.id}" style="font-size:11px;padding:4px 10px;color:var(--green,#16a34a)">✓ Autorizar</button>`
    }
    const openAttr = esAut ? `data-ped="${p.id}"` : `data-dashopen="${p.id}"`
    return `<div class="cot-hrow" ${openAttr} style="cursor:pointer">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:600">${esc(num)} · ${esc(p.placa || 's/placa')} <span class="cot-estado ${esc(p.estado)}">${esc(p.estado)}</span>${badge}${badgeNuevo}</div>
        <div style="font-size:11px;color:var(--text3,#8b949e)">${esc(veh || 's/vehículo')} · ${esc(p.cliente || 's/n')} · L. ${fmt(p.total)}${clockCardHTML(p) ? ' · ' + clockCardHTML(p) : ''}</div>
      </div>
      <div data-stop style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${accion}</div>
    </div>`
  }

  async function dashClick (e) {
    const act = e.target.closest('[data-dashact]')
    if (act) { e.stopPropagation(); return dashAccion(act.dataset.dashact, act.dataset.pf) }
    if (e.target.closest('[data-stop]')) return
    const ped = e.target.closest('[data-ped]')
    if (ped) return abrirPedidos(ped.dataset.ped)
    const op = e.target.closest('[data-dashopen]')
    if (op) return recuperarProforma(op.dataset.dashopen).then(() => switchTab('nueva'))
  }

  async function dashAccion (act, id) {
    if (act === 'editar') { await recuperarProforma(id); switchTab('nueva'); return }
    if (act === 'autorizar') {
      if (!confirm('¿Autorizar esta cotización?')) return
      const { error } = await sb().rpc('cot_autorizar', { p_id: id, p_por: ((window._currentProfile() || {}).nombre || '') })
      if (error) { toast('Error al autorizar', 'error'); return }
      toast('Cotización autorizada', 'success'); loadDashboard()
    } else if (act === 'finalizar') {
      try {
        const { data } = await sb().from('cotizador_proformas').select('items').eq('id', id).single()
        const pr = progresoPedidos(data ? data.items : [])
        if (pr.total > 0 && pr.llegados < pr.total) {
          toast(`No podés finalizar: faltan productos por llegar (${pr.llegados}/${pr.total})`, 'error'); return
        }
      } catch (e) { console.error('[cotizador finalizar chk]', e) }
      if (!confirm('¿Finalizar? Se quita del Inicio pero queda en Cotización.')) return
      const { error } = await sb().from('cotizador_proformas').update({ estado: 'finalizada' }).eq('id', id)
      if (error) { toast('Error al finalizar', 'error'); return }
      await sb().from('cotizador_proformas').update({ proc_completada: new Date().toISOString() }).eq('id', id).is('proc_completada', null)  // detiene el reloj si aún corría
      toast('Cotización finalizada', 'success'); loadDashboard()
    }
  }

  // ── PEDIDOS RÁPIDOS (seguimiento de compra por producto) ──
  async function abrirPedidos (id) {
    try {
      const { data, error } = await sb().from('cotizador_proformas').select('*').eq('id', id).single()
      if (error) throw error
      PEDPF = data
      $('ped-title').textContent = `${numeroDe(data.vendedor, data.correlativo)} — ${[data.marca, data.modelo].filter(Boolean).join(' ')} · ${data.placa || 's/placa'}`
      renderPedidos()
      $('cot-modal-ped').classList.add('open')
      cargarProveedores()
      checkProcCompletada()   // corrige si quedó "completado" con repuestos aún pendientes
      ensureProvContacts().then(() => renderPedidos())   // recarga con botones de WhatsApp/Llamar
    } catch (e) { console.error('[cotizador pedidos]', e); toast('No se pudo abrir', 'error') }
  }

  async function ensureProvContacts () {
    if (PROV_CONT.length) return
    try { const { data } = await sb().from('proveedores_contacto').select('*'); PROV_CONT = (data || []).map(c => ({ nombre: c.nombre, nombre_norm: c.nombre_norm, telefono: c.telefono || '', contacto: c.contacto || '' })) } catch (e) { /* sin contactos */ }
  }

  function renderPedidos () {
    if (!PEDPF) return
    const items = Array.isArray(PEDPF.items) ? PEDPF.items : []
    const pr = progresoPedidos(items)
    const pct = pr.total ? Math.round(pr.llegados / pr.total * 100) : 0
    const totalItems = items.length
    const facturados = items.filter(it => it.facturado).length
    const fpct = totalItems ? Math.round(facturados / totalItems * 100) : 0
    const fcolor = (totalItems && facturados === totalItems) ? 'var(--green,#16a34a)' : (facturados > 0 ? 'var(--amber,#f59e0b)' : 'var(--text3,#8b949e)')
    const barra = (lbl, a, b, p, color) => `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="color:var(--text3,#8b949e)">${lbl}</span><span style="font-weight:700;color:${color}">${a}/${b} (${p}%)</span></div><div style="height:7px;background:var(--bg3,#1c2333);border-radius:5px;overflow:hidden"><div style="height:100%;width:${p}%;background:${color}"></div></div></div>`
    $('ped-prog').innerHTML = barra('Productos llegados' + (pr.estado ? ' · ' + pr.estado : ''), pr.llegados, pr.total, pct, pr.color) + barra('📋 Facturados', facturados, totalItems, fpct, fcolor)
    const facBtn = (it, i) => it.facturado
      ? `<button class="ped-btn" data-pedact="facturar" data-i="${i}" title="Desmarcar facturado" style="color:var(--text3,#8b949e)">↩</button>`
      : `<button class="ped-btn" data-pedact="facturar" data-i="${i}" title="Copiar descripción y marcar facturado" style="color:var(--green,#16a34a);border-color:var(--green,#16a34a)">📋</button>`
    const facBadge = (it) => it.facturado ? ` <span class="ped-badge" style="background:rgba(22,163,74,.15);color:var(--green,#16a34a)">📋 Facturado</span>` : ''
    const dimF = (it) => it.facturado ? 'opacity:.6' : ''
    const prods = []; const servs = []
    items.forEach((it, i) => { (it.tipo === 's' ? servs : prods).push({ it, i }) })
    const rowP = ({ it, i }) => {
      const seg = it.seguimiento || ''
      let estadoTxt = ''
      if (seg === 'llegado') {
        estadoTxt = `<span class="ped-badge" style="background:rgba(22,163,74,.15);color:var(--green,#16a34a)">✓ ${it.seg_proveedor === 'BODEGA' ? 'Bodega' : 'Llegó'}</span>`
        if (it.seg_fecha_pedido && it.seg_fecha_llegada && it.seg_proveedor !== 'BODEGA') {
          const min = difMin(it.seg_fecha_pedido, it.seg_fecha_llegada)
          estadoTxt += ` <span style="font-size:11px;color:${colorDur(min)}">Tardó ${fmtDur(min)}${it.seg_modo === 'recoge' ? ' · recogido' : ''}</span>`
        }
      }
      else if (seg === 'pedido') {
        const modo = it.seg_modo || 'envia'; const prov = esc(it.seg_proveedor || '')
        if (modo === 'recoge') {
          estadoTxt = `<span class="ped-badge" style="background:rgba(245,158,11,.15);color:var(--amber,#f59e0b)">🚶 A recoger${it.seg_conserje ? ' — ' + esc(it.seg_conserje) : ''}</span>${prov ? ` <span style="font-size:11px;color:var(--text3,#8b949e)">en ${prov}</span>` : ''}`
        } else {
          estadoTxt = `<span class="ped-badge" style="background:rgba(59,130,246,.15);color:#3b82f6">🚚 Pedido a ${prov}</span>`
          const c = contactoDe(it.seg_proveedor)
          if (c && c.telefono) {
            const _min = it.seg_fecha_pedido ? difMin(it.seg_fecha_pedido) : null
            const _hace = _min != null ? ` (pedido hace ${fmtDur(_min)})` : ''
            const msg = `Buen día${c.contacto ? ' ' + c.contacto : ''}, de TECNIMAX consultamos por el estado del envío de: ${String(it.desc).toUpperCase()} (cantidad ${fmt(it.cantidad)})${_hace} que solicitamos. Gracias.`
            estadoTxt += ` <a href="${waHref(c.telefono, msg)}" target="_blank" rel="noopener" title="Seguimiento por WhatsApp" style="color:#25d366;text-decoration:none">💬</a> <a href="${telHref(c.telefono)}" title="Llamar" style="text-decoration:none">📞</a>`
          }
        }
        if (it.seg_fecha_pedido) {
          const min = difMin(it.seg_fecha_pedido, null)
          estadoTxt += ` <span data-elapsed-desde="${esc(it.seg_fecha_pedido)}" style="font-size:11px;color:${colorDur(min)}">hace ${fmtDur(min)}</span>`
        }
      }
      else estadoTxt = '<span style="font-size:11px;color:var(--text3,#8b949e)">Sin pedir</span>'
      let botones = ''
      if (seg === 'llegado') botones = `<button class="ped-btn" data-pedact="revertir" data-i="${i}">↩ Revertir</button>`
      else if (seg === 'pedido') botones = `<button class="ped-btn ped-llego" data-pedact="llego" data-i="${i}">✓ Llegó</button> <button class="ped-btn" data-pedact="revertir" data-i="${i}">↩</button>`
      else botones = `<button class="ped-btn ped-pedir" data-pedact="pedir" data-i="${i}">Pedir</button> <button class="ped-btn ped-bodega" data-pedact="bodega" data-i="${i}">Bodega</button>`
      return `<div class="ped-row" style="${dimF(it)}">
        <div style="min-width:0"><div style="font-size:13px">${esc(String(it.desc).toUpperCase())}${facBadge(it)}</div><div style="font-size:11px;color:var(--text3,#8b949e)">Cant: ${fmt(it.cantidad)} · ${estadoTxt}</div><div class="cot-cost" data-pcost="${i}" style="margin-top:3px"></div></div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:flex-start">${botones} ${facBtn(it, i)}</div>
      </div>`
    }
    let html = ''
    if (prods.length) html += `<div style="font-size:12px;font-weight:700;color:var(--gold,#c8a24a);margin:10px 0 2px">PRODUCTOS</div>` + prods.map(rowP).join('')
    if (servs.length) html += `<div style="font-size:12px;font-weight:700;color:var(--gold,#c8a24a);margin:14px 0 2px">SERVICIOS</div>` + servs.map(({ it, i }) => `<div class="ped-row" style="${dimF(it)}"><div style="min-width:0"><div style="font-size:13px">${esc(String(it.desc).toUpperCase())}${facBadge(it)}</div><div style="font-size:11px;color:var(--text3,#8b949e)">Cant: ${fmt(it.cantidad)} · Servicio</div></div><div style="flex-shrink:0">${facBtn(it, i)}</div></div>`).join('')
    $('ped-body').innerHTML = html
    if (!_pedTimer) _pedTimer = setInterval(tickPedidos, 60000)   // refresca "hace Xh Ym" en vivo
    // Cargar historial de compras (proveedor · costo · fecha) de cada producto
    prods.forEach(({ it, i }) => {
      fetchCosto(it.desc).then(entradas => {
        const el = document.querySelector(`[data-pcost="${i}"]`)
        if (el) el.innerHTML = costoHTML(entradas, false)
      })
    })
  }

  async function guardarPedidos () {
    if (!PEDPF) return
    try {
      const { error } = await sb().from('cotizador_proformas').update({ items: PEDPF.items }).eq('id', PEDPF.id)
      if (error) throw error
    } catch (e) { console.error('[cotizador guardarPedidos]', e); toast('Error al guardar el pedido', 'error') }
  }

  function pedItem (i) { return PEDPF && PEDPF.items ? PEDPF.items[i] : null }

  // ── Modo de entrega + cronómetro de pedidos ──
  function setPedModo (m) {
    _pedModo = (m === 'recoge') ? 'recoge' : 'envia'
    document.querySelectorAll('.prov-modo-btn').forEach(b => {
      const sel = b.dataset.modo === _pedModo
      b.classList.toggle('btn-gold', sel)
      b.classList.toggle('btn-ghost', !sel)
    })
    const w = $('prov-conserje-wrap'); if (w) w.style.display = _pedModo === 'recoge' ? '' : 'none'
    if (_pedModo === 'recoge') setTimeout(() => { const c = $('prov-conserje'); if (c) c.focus() }, 60)
  }
  function difMin (a, b) {
    if (!a) return null
    const t0 = new Date(a).getTime(); const t1 = b ? new Date(b).getTime() : Date.now()
    if (isNaN(t0) || isNaN(t1)) return null
    return Math.max(0, Math.round((t1 - t0) / 60000))
  }
  function fmtDur (min) {
    if (min == null) return ''
    if (min < 60) return min + 'min'
    const h = Math.floor(min / 60); const m = min % 60
    return h + 'h' + (m ? ' ' + m + 'min' : '')
  }
  function colorDur (min) { // verde rápido · ámbar medio · rojo lento
    if (min == null) return 'var(--text3,#8b949e)'
    if (min <= 60) return 'var(--green,#16a34a)'
    if (min <= 180) return 'var(--amber,#f59e0b)'
    return 'var(--red,#f85149)'
  }
  function tickPedidos () {
    const cont = $('ped-body')
    if (!cont || cont.offsetParent === null) { if (_pedTimer) { clearInterval(_pedTimer); _pedTimer = null } return }
    cont.querySelectorAll('[data-elapsed-desde]').forEach(el => {
      const min = difMin(el.getAttribute('data-elapsed-desde'), null)
      el.textContent = 'hace ' + fmtDur(min)
      el.style.color = colorDur(min)
    })
  }

  async function iniciarPedido (i) {
    const it = pedItem(i); if (!it) return
    _pedIdx = i
    $('prov-item').textContent = String(it.desc).toUpperCase()
    $('prov-input').value = it.seg_proveedor || ''
    $('prov-ac').style.display = 'none'
    setPedModo(it.seg_modo || 'envia')
    $('prov-conserje').value = it.seg_conserje || ''
    $('cot-modal-prov').classList.add('open')
    setTimeout(() => $('prov-input').focus(), 120)
    // Pre-llenar con el último proveedor al que se le compró este producto
    if (!$('prov-input').value) {
      try {
        const term = String(it.desc || '').toUpperCase().replace(/[%,]/g, ' ').trim()
        const { data } = await sb().from('cotizador_compras')
          .select('proveedor,fecha_compra').ilike('nombre_norm', '%' + term + '%')
          .order('fecha_compra', { ascending: false }).limit(1)
        if (data && data[0] && data[0].proveedor && !$('prov-input').value) {
          $('prov-input').value = String(data[0].proveedor).toUpperCase()
        }
      } catch (e) { /* sin prefill */ }
    }
  }

  async function confirmarPedido () {
    const it = pedItem(_pedIdx); if (!it) return
    const prov = $('prov-input').value.trim().toUpperCase()
    if (!prov) { toast('Escribí el proveedor', 'error'); return }
    const conserje = ($('prov-conserje').value || '').trim().toUpperCase()
    if (_pedModo === 'recoge' && !conserje) { toast('Escribí el nombre del conserje', 'error'); return }
    it.seguimiento = 'pedido'; it.seg_proveedor = prov; it.seg_modo = _pedModo
    if (_pedModo === 'recoge') it.seg_conserje = conserje; else delete it.seg_conserje
    it.seg_fecha_pedido = new Date().toISOString(); delete it.seg_fecha_llegada
    await guardarPedidos()
    $('cot-modal-prov').classList.remove('open'); renderPedidos()
    toast(_pedModo === 'recoge' ? ('🚶 A recoger — ' + conserje) : ('🚚 Pedido a ' + prov), 'success')
    await checkProcCompletada()
  }

  async function marcarLlegado (i) {
    const it = pedItem(i); if (!it) return
    it.seguimiento = 'llegado'; it.seg_fecha_llegada = new Date().toISOString()
    await guardarPedidos(); renderPedidos(); toast('✓ Llegó', 'success')
    await checkProcCompletada()
  }
  async function marcarBodega (i) {
    const it = pedItem(i); if (!it) return
    it.seguimiento = 'llegado'; it.seg_proveedor = 'BODEGA'; it.seg_modo = 'bodega'; delete it.seg_conserje
    it.seg_fecha_pedido = new Date().toISOString(); it.seg_fecha_llegada = new Date().toISOString()
    await guardarPedidos(); renderPedidos(); toast('📦 Tomado de bodega', 'success')
    await checkProcCompletada()
  }
  async function revertirPedido (i) {
    const it = pedItem(i); if (!it) return
    if (!confirm('¿Revertir a "Sin pedir"?')) return
    delete it.seguimiento; delete it.seg_proveedor; delete it.seg_modo; delete it.seg_conserje; delete it.seg_fecha_pedido; delete it.seg_fecha_llegada
    await guardarPedidos(); renderPedidos()
    await checkProcCompletada()
  }

  // Marca/desmarca un ítem como facturado. Al marcar, copia la descripción al
  // portapapeles para pegarla en el facturador.
  async function togglePFfacturado (i) {
    const it = pedItem(i); if (!it) return
    if (it.facturado) {
      delete it.facturado; delete it.fecha_facturado
    } else {
      it.facturado = true; it.fecha_facturado = new Date().toISOString()
      try {
        await navigator.clipboard.writeText(String(it.desc).toUpperCase())
        toast('📋 Copiado: ' + String(it.desc).toUpperCase().slice(0, 32), 'success')
      } catch (e) { toast('Marcado como facturado', 'success') }
    }
    await guardarPedidos(); renderPedidos()
  }

  async function cargarProveedores () {
    if (PROVS) return
    try {
      const set = {}
      for (let from = 0; from < 4000; from += 1000) {
        const { data } = await sb().from('cotizador_compras').select('proveedor').range(from, from + 999)
        if (!data || !data.length) break
        data.forEach(x => { if (x.proveedor) set[String(x.proveedor).trim().toUpperCase()] = true })
        if (data.length < 1000) break
      }
      PROVS = Object.keys(set).sort()
    } catch (e) { PROVS = [] }
  }

  async function loadHistorial () {
    const list = $('cot-hist-list')
    const q = ($('cot-hist-q').value || '').trim()
    try {
      let query = sb().from('cotizador_proformas')
        .select('id,correlativo,vendedor,cliente,placa,marca,modelo,anio,total,estado,created_at,numero_orden,proc_inicio,proc_aprobada,proc_completada')
        .order('created_at', { ascending: false }).limit(100)
      if (HIST_FILTRO) query = query.eq('estado', HIST_FILTRO)
      if (q) {
        const s = escLike(q).replace(/[,()]/g, ' ')
        query = query.or(`placa.ilike.%${s}%,cliente.ilike.%${s}%,correlativo.eq.${/^\d+$/.test(q) ? q : 0}`)
      }
      const { data, error } = await query
      if (error) throw error
      // Cruce con órdenes del taller para traer factura y monto facturado
      const ordMap = await mapaOrdenes(data || [])
      list.innerHTML = (data && data.length) ? data.map(p => filaHist(p, false, ordMap[String(p.numero_orden || '').trim()])).join('')
        : '<div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Sin cotizaciones</div>'
      startClock()
    } catch (e) {
      console.error('[cotizador historial]', e)
      list.innerHTML = `<div style="text-align:center;color:var(--red,#f85149);padding:20px">Error: ${esc(e.message || e)}</div>`
    }
  }

  // Cruza las órdenes vinculadas: numero_orden -> {numero_factura, total}
  async function mapaOrdenes (rows) {
    const nums = [...new Set(rows.map(p => String(p.numero_orden || '').trim()).filter(Boolean))]
    if (!nums.length) return {}
    try {
      const { data } = await sb().from('cotizador_ordenes')
        .select('numero_orden,numero_factura,total').in('numero_orden', nums)
      const m = {}
      ;(data || []).forEach(o => { m[String(o.numero_orden).trim()] = o })
      return m
    } catch (e) { console.error('[cotizador mapaOrdenes]', e); return {} }
  }

  // Foto de lo presentado por proforma (para usar como base del seguimiento)
  async function mapaPresentaciones (rows) {
    const ids = [...new Set((rows || []).map(p => p.id).filter(Boolean))]
    if (!ids.length) return {}
    const m = {}
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await sb().from('cotizador_presentaciones')
          .select('proforma_id,total_presentado,items,veces,primera_presentacion,ultima_presentacion')
          .in('proforma_id', ids.slice(i, i + 200))
        ;(data || []).forEach(s => { m[s.proforma_id] = s })
      }
    } catch (e) { console.error('[cotizador presentaciones map]', e) }
    return m
  }

  // ── SEGUIMIENTO COMERCIAL ──
  function clasificar (p, ord, snap) {
    const cotizado = (snap && snap.total_presentado != null) ? Number(snap.total_presentado) : (Number(p.total) || 0)
    if (!p.numero_orden) return { cat: 'sin_orden', cotizado, facturado: 0, pendiente: cotizado, factura: '' }
    if (!ord || !ord.numero_factura) return { cat: 'sin_factura', cotizado, facturado: 0, pendiente: cotizado, factura: '' }
    const facturado = Number(ord.total) || 0
    if (facturado < cotizado - 0.5) return { cat: 'facturo_menos', cotizado, facturado, pendiente: Math.max(0, cotizado - facturado), factura: ord.numero_factura }
    return { cat: 'cerrada', cotizado, facturado, pendiente: 0, factura: ord.numero_factura }
  }
  const CAT_LBL = { sin_orden: 'Sin orden', sin_factura: 'Sin factura', facturo_menos: 'Facturó menos', cerrada: 'Cerrada' }

  async function loadSeguimiento () {
    const list = $('cot-seg-list')
    list.innerHTML = '<div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Cargando…</div>'
    try {
      const { data, error } = await sb().from('cotizador_proformas')
        .select('id,correlativo,vendedor,cliente,placa,marca,modelo,anio,total,estado,created_at,numero_orden,proc_inicio,proc_aprobada,proc_completada')
        .order('created_at', { ascending: false }).limit(400)
      if (error) throw error
      const ordMap = await mapaOrdenes(data || [])
      const snapMap = await mapaPresentaciones(data || [])
      SEG_DATA = (data || []).map(p => {
        const cl = clasificar(p, ordMap[String(p.numero_orden || '').trim()], snapMap[p.id])
        return Object.assign({}, p, cl)
      })
      renderSeg()
    } catch (e) {
      console.error('[cotizador seguimiento]', e)
      list.innerHTML = `<div style="text-align:center;color:var(--red,#f85149);padding:20px">Error: ${esc(e.message || e)}</div>`
    }
  }

  function segFiltradas () {
    const q = ($('cot-seg-q').value || '').trim().toUpperCase()
    return SEG_DATA.filter(p => p.cat !== 'cerrada')
      .filter(p => !SEG_CAT || p.cat === SEG_CAT)
      .filter(p => !q || String(p.cliente || '').toUpperCase().includes(q) || String(p.placa || '').toUpperCase().includes(q) || String(p.numero_orden || '').toUpperCase().includes(q) || String(p.correlativo || '').toUpperCase().includes(q) || String(numeroDe(p.vendedor, p.correlativo) || '').toUpperCase().includes(q))
  }

  function renderSeg () {
    const list = $('cot-seg-list')
    // Stats sobre TODO el set cargado
    const noCerradas = SEG_DATA.filter(p => p.cat !== 'cerrada')
    const pendienteTot = noCerradas.reduce((a, p) => a + (p.pendiente || 0), 0)
    const st = [
      [noCerradas.length, 'Sin cerrar'],
      [SEG_DATA.filter(p => p.cat === 'sin_factura' || p.cat === 'sin_orden').length, 'Sin facturar'],
      [SEG_DATA.filter(p => p.cat === 'facturo_menos').length, 'Facturó menos'],
      ['L. ' + fmt(pendienteTot), 'Monto pendiente']
    ]
    const stats = $('cot-seg-stats')
    if (stats) stats.innerHTML = st.map(s => `<div class="cot-stat"><div class="n">${s[0]}</div><div class="l">${s[1]}</div></div>`).join('')

    const rows = segFiltradas()
    if (!rows.length) { list.innerHTML = '<div style="text-align:center;color:var(--green,#16a34a);padding:20px">✓ Nada pendiente en este filtro</div>'; return }
    list.innerHTML = rows.map(p => {
      const num = numeroDe(p.vendedor, p.correlativo)
      const veh = [p.marca, p.modelo, p.anio].filter(Boolean).join(' ')
      const col = p.cat === 'facturo_menos' ? 'var(--amber,#f59e0b)' : p.cat === 'sin_factura' ? 'var(--text3,#8b949e)' : 'var(--red,#f85149)'
      return `<div class="cot-hrow" data-seg="${p.id}" style="cursor:pointer">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:600">${esc(num)} · ${esc(p.placa || 's/placa')} <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:${col}22;color:${col}">${esc(CAT_LBL[p.cat])}</span></div>
          <div style="font-size:11px;color:var(--text3,#8b949e)">${esc(veh || 's/vehículo')} · ${esc(p.cliente || 's/n')} · ${esc(fFecha(p.created_at))}${p.factura ? ' · Fact #' + esc(p.factura) : ''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="color:var(--gold,#c8a24a);font-weight:700;white-space:nowrap">Cotizado L. ${fmt(p.cotizado != null ? p.cotizado : p.total)}</div>
          <div style="font-size:11px;color:${col}">Pendiente L. ${fmt(p.pendiente)}${p.facturado ? ` · facturado L. ${fmt(p.facturado)}` : ''}</div>
        </div>
      </div>`
    }).join('')
    list.querySelectorAll('[data-seg]').forEach(el => el.addEventListener('click', () => verDetalleSeguimiento(el.dataset.seg)))
  }

  let _detId = null
  async function verDetalleSeguimiento (id) {
    _detId = id
    const p = SEG_DATA.find(x => x.id === id); if (!p) return
    $('det-title').textContent = numeroDe(p.vendedor, p.correlativo) + ' · Cotizado vs Facturado'
    $('det-sub').textContent = `${p.cliente || 's/n'} · ${p.placa || 's/placa'} · ${CAT_LBL[p.cat]}`
    $('det-body').innerHTML = '<div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Cargando…</div>'
    $('cot-modal-det').classList.add('open')
    try {
      const { data: prof } = await sb().from('cotizador_proformas').select('*').eq('id', id).single()
      const { data: snap } = await sb().from('cotizador_presentaciones')
        .select('items,total_presentado,veces,primera_presentacion,ultima_presentacion').eq('proforma_id', id).maybeSingle()
      const cot = (snap && Array.isArray(snap.items) && snap.items.length) ? snap.items : (Array.isArray(prof.items) ? prof.items : [])
      const baseTotal = (snap && snap.total_presentado != null) ? Number(snap.total_presentado) : (Number(prof.total) || 0)
      let fact = []; let factNum = ''
      if (prof.numero_orden) {
        const { data: ord } = await sb().from('cotizador_ordenes').select('id,numero_factura,total').eq('numero_orden', String(prof.numero_orden).trim()).limit(1).maybeSingle()
        if (ord) {
          factNum = ord.numero_factura || ''
          const { data: its } = await sb().from('cotizador_orden_items').select('tipo,descripcion,cantidad,precio_unitario,monto_total').eq('orden_id', ord.id)
          fact = its || []
        }
      }
      renderDetalleSeg(prof, cot, fact, factNum, baseTotal, snap)
    } catch (e) { console.error('[cotizador detalle seg]', e); $('det-body').innerHTML = '<div style="color:var(--red,#f85149);text-align:center;padding:20px">Error al cargar</div>' }
  }

  function renderDetalleSeg (prof, cot, fact, factNum, baseTotal, snap) {
    const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim()
    const factSet = fact.map(f => norm(f.descripcion))
    const estaFacturado = (desc) => { const d = norm(desc); return factSet.some(f => f === d || f.includes(d) || d.includes(f)) }
    const totCot = (baseTotal != null) ? baseTotal : (Number(prof.total) || cot.reduce((a, it) => a + it.precio * it.cantidad * (1 + (it.isv || 0) / 100), 0))
    const baseLbl = snap ? 'PRESENTADO AL CLIENTE' : 'COTIZADO'
    const snapNota = snap ? `<div style="font-size:11px;color:var(--text3,#8b949e);margin-bottom:6px">Presentado ${num(snap.veces) || 1} vez(es)${snap.ultima_presentacion ? ' · última ' + fFecha(snap.ultima_presentacion) : ''}</div>` : ''
    const totFact = fact.reduce((a, f) => a + (Number(f.monto_total) || 0), 0)
    const noFactCount = cot.filter(it => !estaFacturado(it.desc)).length
    const cotRows = cot.map(it => {
      const ok = estaFacturado(it.desc)
      return `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--border,#2a3340);${ok ? '' : 'background:rgba(248,81,73,.06)'}">
        <div style="font-size:12px;min-width:0">${esc(String(it.desc).toUpperCase())}${ok ? '' : ' <span class="ped-badge" style="background:rgba(248,81,73,.15);color:var(--red,#f85149)">no facturado</span>'}</div>
        <div style="font-size:12px;white-space:nowrap;color:var(--text3,#8b949e)">${fmt(it.cantidad)} × L.${fmt(it.precio)}</div></div>`
    }).join('')
    const factRows = fact.length ? fact.map(f => `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--border,#2a3340)">
        <div style="font-size:12px;min-width:0">${esc(String(f.descripcion).toUpperCase())}</div>
        <div style="font-size:12px;white-space:nowrap;color:var(--text3,#8b949e)">${fmt(f.cantidad)} · L.${fmt(f.monto_total)}</div></div>`).join('')
      : '<div style="color:var(--text3,#8b949e);padding:10px;text-align:center">Sin factura vinculada todavía.</div>'
    const pend = totCot - totFact
    $('det-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <div style="font-weight:700;color:var(--gold,#c8a24a);margin-bottom:4px">${baseLbl} · L. ${fmt(totCot)}</div>
          ${snapNota}
          ${cotRows || '<div style="color:var(--text3,#8b949e)">—</div>'}
        </div>
        <div>
          <div style="font-weight:700;color:var(--green,#16a34a);margin-bottom:4px">FACTURADO${factNum ? ' · Fact #' + esc(factNum) : ''} · L. ${fmt(totFact)}</div>
          ${factRows}
        </div>
      </div>
      <div style="margin-top:14px;padding:10px 14px;border-radius:8px;background:var(--bg3,#1c2333);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span style="color:var(--red,#f85149);font-weight:700">${noFactCount} ítem(s) cotizados no aparecen en la factura</span>
        <span style="font-weight:700">Pendiente: L. ${fmt(pend)}</span>
      </div>`
  }

  function exportSeguimiento () {
    const rows = segFiltradas()
    if (!rows.length) { toast('No hay filas para exportar', 'error'); return }
    const head = ['N°', 'Estado', 'Categoria', 'Cliente', 'Placa', 'Vehiculo', 'Fecha', 'Orden', 'Factura', 'Cotizado', 'Facturado', 'Pendiente']
    const esc2 = (v) => { const s = String(v == null ? '' : v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    const lines = [head.join(',')]
    rows.forEach(p => {
      lines.push([numeroDe(p.vendedor, p.correlativo), p.estado || '', CAT_LBL[p.cat], p.cliente || '', p.placa || '',
        [p.marca, p.modelo, p.anio].filter(Boolean).join(' '), fFecha(p.created_at), p.numero_orden || '', p.factura || '',
        (Number(p.total) || 0).toFixed(2), (p.facturado || 0).toFixed(2), (p.pendiente || 0).toFixed(2)].map(esc2).join(','))
    })
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `Seguimiento_cotizaciones_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(a.href)
    toast('CSV exportado', 'success')
  }

  function filaHist (p, compacto, ord) {
    const num = numeroDe(p.vendedor, p.correlativo)
    const veh = [p.marca, p.modelo, p.anio].filter(Boolean).join(' ')
    const est = p.estado || 'pendiente'
    // Línea de vínculo con la orden / factura
    let vinculo = ''
    if (p.numero_orden) {
      if (ord && ord.numero_factura) {
        const fact = Number(ord.total) || 0; const cot = Number(p.total) || 0
        const menos = fact < cot - 0.01
        vinculo = `<div style="font-size:11px;margin-top:2px;color:${menos ? 'var(--amber,#f59e0b)' : 'var(--green,#16a34a)'}">🧾 Orden #${esc(p.numero_orden)} · Fact #${esc(ord.numero_factura)} · facturado L. ${fmt(fact)}${menos ? ` (cotizado L. ${fmt(cot)})` : ''}</div>`
      } else {
        vinculo = `<div style="font-size:11px;margin-top:2px;color:var(--text3,#8b949e)">🔗 Orden #${esc(p.numero_orden)} · sin factura aún</div>`
      }
    }
    const acciones = compacto
      ? `<button class="btn btn-ghost" data-act="editar" data-pf="${p.id}" style="font-size:11px;padding:4px 10px">Abrir</button>`
      : `<button class="btn btn-ghost" data-act="editar" data-pf="${p.id}" style="font-size:11px;padding:4px 8px">✏ Editar</button>` +
        (est === 'pendiente' ? `<button class="btn btn-ghost" data-act="autorizar" data-pf="${p.id}" style="font-size:11px;padding:4px 8px;color:var(--green,#16a34a)">✓ Autorizar</button>` : '') +
        `<button class="btn btn-ghost" data-act="pdf" data-pf="${p.id}" style="font-size:11px;padding:4px 8px">📄 PDF</button>` +
        `<button class="btn btn-ghost" data-act="ot" data-pf="${p.id}" style="font-size:11px;padding:4px 8px">🔧 OT</button>` +
        `<button class="btn btn-ghost" data-act="duplicar" data-pf="${p.id}" style="font-size:11px;padding:4px 8px">⧉ Duplicar</button>` +
        `<button class="btn btn-ghost" data-act="eliminar" data-pf="${p.id}" style="font-size:11px;padding:4px 8px;color:var(--red,#f85149)">🗑</button>`
    return `<div class="cot-hrow">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:600">${esc(num)} · ${esc(p.placa || 's/placa')} ${p.estado ? `<span class="cot-estado ${esc(est)}">${esc(est)}</span>` : ''}</div>
        <div style="font-size:11px;color:var(--text3,#8b949e)">${esc(veh || 's/vehículo')} · ${esc(p.cliente || 's/n')} · ${esc(fFecha(p.created_at))}</div>
        ${vinculo}
        ${clockCardHTML(p) ? `<div style="font-size:11px;margin-top:2px">${clockCardHTML(p)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <div style="color:var(--gold,#c8a24a);font-weight:700;white-space:nowrap">L. ${fmt(p.total)}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${acciones}</div>
      </div>
    </div>`
  }

  async function histClick (e) {
    const btn = e.target.closest('[data-act]'); if (!btn) return
    const id = btn.dataset.pf; const act = btn.dataset.act
    if (act === 'editar') { await recuperarProforma(id); switchTab('nueva'); return }
    if (act === 'duplicar') {
      await recuperarProforma(id)
      PF.id = null; PF.correlativo = null; PF.estado = 'pendiente'
      $('cot-recban').style.display = 'none'; setNumLabel(); switchTab('nueva')
      toast('Copia lista — guardá para crear una nueva', 'success'); return
    }
    if (act === 'autorizar') {
      if (!confirm('¿Autorizar esta cotización?')) return
      const { error } = await sb().rpc('cot_autorizar', { p_id: id, p_por: ((window._currentProfile() || {}).nombre || '') })
      if (error) { toast('Error al autorizar', 'error'); return }
      toast('Cotización autorizada', 'success'); loadHistorial(); return
    }
    if (act === 'eliminar') {
      if (!confirm('¿Eliminar esta cotización? No se puede deshacer.')) return
      const { error } = await sb().from('cotizador_proformas').delete().eq('id', id)
      if (error) { toast('Error al eliminar', 'error'); return }
      toast('Cotización eliminada', 'success'); loadHistorial(); return
    }
    if (act === 'pdf' || act === 'ot') {
      try {
        const { data, error } = await sb().from('cotizador_proformas').select('*').eq('id', id).single()
        if (error) throw error
        if (act === 'ot') await ordenTrabajoPDF(data)
        else await pdfDeProforma(data)
      } catch (err) { console.error('[cotizador pdf/ot hist]', err); toast('Error al generar el PDF', 'error') }
    }
  }

  const CFG_MAP = { 'cfg-nombre': 'nombre_comercial', 'cfg-rtn': 'rtn', 'cfg-tel': 'telefono', 'cfg-email': 'email', 'cfg-dir': 'direccion', 'cfg-cai': 'cai', 'cfg-rdesde': 'rango_desde', 'cfg-rhasta': 'rango_hasta', 'cfg-flimite': 'fecha_limite', 'cfg-vig': 'vigencia_dias', 'cfg-terminos': 'terminos', 'cfg-garantia': 'garantia', 'cfg-aj3': 'aj_3', 'cfg-aj6': 'aj_6', 'cfg-aj12': 'aj_12' }

  async function fillConfigForm () {
    await loadConfig()
    renderCatalogoCfg()
    Object.keys(CFG_MAP).forEach(id => { const el = $(id); if (el) el.value = cfg(CFG_MAP[id]) })
    const sarFields = ['cfg-cai', 'cfg-rdesde', 'cfg-rhasta', 'cfg-flimite']
    sarFields.forEach(id => { const el = $(id); if (el) { el.disabled = !!(CFG && CFG._sar); el.style.opacity = (CFG && CFG._sar) ? '0.7' : '1' } })
    const nota = $('cfg-sar-nota')
    if (nota) {
      nota.innerHTML = (CFG && CFG._sar)
        ? '🔗 El CAI, el rango y la fecha límite se toman automáticamente de <b style="color:var(--gold,#c8a24a)">Control de rango de ventas</b>. Si cambian allá, cambian solos acá y en el PDF.'
        : '⚠ No se encontró un rango activo en Control de rango de ventas — se usan los valores que cargues acá.'
    }
  }

  async function saveConfig () {
    const data = {}
    Object.keys(CFG_MAP).forEach(id => { const el = $(id); if (el) data[CFG_MAP[id]] = el.value })
    data.vigencia_dias = num($('cfg-vig').value) || 30
    data.aj_3 = num($('cfg-aj3').value); data.aj_6 = num($('cfg-aj6').value); data.aj_12 = num($('cfg-aj12').value)
    const btn = $('cfg-guardar'); const prev = btn.textContent; btn.disabled = true; btn.textContent = 'Guardando...'
    try {
      const { data: upd, error } = await sb().from('cotizador_config').update({ data, updated_at: new Date().toISOString() }).eq('id', 1).select('id')
      if (error) throw error
      if (!upd || !upd.length) { toast('No tenés permiso para guardar la configuración', 'error'); return }
      CFG = Object.assign({}, DEFAULT_CFG, data)
      toast('Configuración guardada', 'success')
    } catch (e) { console.error('[cotizador saveConfig]', e); toast('Error al guardar la configuración', 'error') }
    finally { btn.disabled = false; btn.textContent = prev }
  }

  // ══════════════════════════════════════════════════════════
  //  PDF (jsPDF + autotable, carga diferida desde CDN)
  // ══════════════════════════════════════════════════════════
  function loadScript (src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src
      s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar ' + src))
      document.head.appendChild(s)
    })
  }
  async function ensureJsPDF () {
    if (window.jspdf && window.jspdf.jsPDF) return
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js')
  }

  // Ordena la cotización por tipo (productos→servicios) y prioridad (crít→rec→prev).
  // Se llama al generar el PDF/OT, no al cambiar prioridad, para no perder el orden en pantalla.
  function ordenarPF () {
    PF.items.sort((a, b) => {
      const ta = a.tipo === 's' ? 1 : 0, tb = b.tipo === 's' ? 1 : 0
      if (ta !== tb) return ta - tb
      return PRIO_ORD[getPrioridad(a)] - PRIO_ORD[getPrioridad(b)]
    })
  }

  // Captura la foto de "lo presentado al cliente" al generar el PDF.
  // Une los ítems actuales con los ya presentados: crece al agregar, no encoge
  // al quitar. Seguimiento mide contra esta foto, no contra la proforma viva.
  async function capturarPresentacion () {
    if (!PF.id) return
    try {
      const actuales = (PF.items || []).map(it => ({
        tipo: it.tipo,
        desc: String(it.desc || '').toUpperCase(),
        desc_norm: provNorm(autocorregir(it.desc || '')),
        cantidad: num(it.cantidad) || 1,
        precio: num(it.precio) || 0,
        isv: (it.isv != null ? num(it.isv) : 15)
      }))
      const { data: prev } = await sb().from('cotizador_presentaciones')
        .select('items,veces,primera_presentacion').eq('proforma_id', PF.id).maybeSingle()
      const union = {}
      if (prev && Array.isArray(prev.items)) prev.items.forEach(it => { union[it.desc_norm || provNorm(it.desc)] = it })
      // re-presentar un ítem actualiza precio/cantidad al último presentado; los
      // que ya no aparecen NO se borran (quedan como oportunidad de seguimiento)
      actuales.forEach(it => { union[it.desc_norm] = it })
      const items = Object.values(union)
      const total = items.reduce((a, it) => a + it.precio * it.cantidad * (1 + (it.isv || 0) / 100), 0)
      const now = new Date().toISOString()
      const row = {
        proforma_id: PF.id,
        correlativo: PF.correlativo, vendedor: PF.vendedor, cliente: PF.cliente, placa: PF.placa,
        marca: PF.marca, modelo: PF.modelo, anio: [PF.anioDesde, PF.anioHasta].filter(Boolean).join('-'),
        numero_orden: PF.numero_orden || '',
        total_presentado: Math.round(total * 100) / 100,
        veces: prev ? (num(prev.veces) || 1) + 1 : 1,
        primera_presentacion: (prev && prev.primera_presentacion) ? prev.primera_presentacion : now,
        ultima_presentacion: now,
        items, updated_at: now
      }
      const { error } = await sb().from('cotizador_presentaciones').upsert(row, { onConflict: 'proforma_id' })
      if (error) throw error
    } catch (e) { console.error('[cotizador presentacion]', e) }  // nunca bloquea el PDF
  }

  async function generarPDF () {
    if (!PF.items.length) { toast('Agregá al menos un ítem', 'error'); return }
    ;(PF.items || []).forEach(it => { if (it && it.nuevo) delete it.nuevo })   // se incluyen en el PDF → dejan de ser "nuevos"
    ordenarPF(); renderItems()
    const btn = $('cot-btn-pdf'); const prev = btn.textContent; btn.disabled = true; btn.textContent = 'Guardando…'
    try {
      const ok = await guardarProforma({ silencioso: true })   // guarda y asigna el número
      if (!ok) { btn.disabled = false; btn.textContent = prev; return }  // faltó orden/cliente/ítems
      await capturarPresentacion()   // foto de lo presentado al cliente (para Seguimiento)
      await marcarProcInicio()       // arranca Fase 1 (autorización) en el primer PDF
      btn.textContent = 'Generando…'
      await pdfDeProforma(PF)
      toast('Cotización N° ' + numeroProforma() + ' guardada e impresa', 'success')
    } catch (e) {
      console.error('[cotizador PDF]', e); toast('Error al generar PDF: ' + (e.message || e), 'error')
    } finally { btn.disabled = false; btn.textContent = prev }
  }

  async function generarOrdenTrabajo () {
    if (!PF.items.length) { toast('Agregá al menos un ítem', 'error'); return }
    ordenarPF(); renderItems()
    const btn = $('cot-btn-ot'); const prev = btn.textContent; btn.disabled = true; btn.textContent = 'Generando...'
    try { await ordenTrabajoPDF(PF); toast('Orden de trabajo generada', 'success') } catch (e) {
      console.error('[cotizador OT]', e); toast('Error al generar la orden: ' + (e.message || e), 'error')
    } finally { btn.disabled = false; btn.textContent = prev }
  }

  // Orden de trabajo: PDF interno del taller, SIN precios, con prioridad,
  // casillas para tildar y firma. Se arma desde la misma cotización.
  async function ordenTrabajoPDF (p) {
    const items = Array.isArray(p.items) ? p.items : []
    if (!items.length) { toast('La cotización no tiene ítems', 'error'); return }
    await ensureJsPDF()
    await loadConfig()
    const { jsPDF } = window.jspdf
    const doc = new jsPDF()
    const W = doc.internal.pageSize.getWidth()
    const now = new Date()
    const dmy = (dt) => `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(-2)}`
    const km = p.kilometraje || p.km || '—'

    // Encabezado
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(30)
    doc.text('ORDEN DE TRABAJO', 14, 16)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110)
    doc.text(`${cfg('nombre_comercial')} — uso interno del taller (sin precios)`, 14, 21)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(200, 16, 46)
    doc.text(`N° ${numeroDe(p.vendedor, p.correlativo)}`, W - 14, 16, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80)
    doc.text(dmy(now), W - 14, 21, { align: 'right' })
    if (p.numero_orden) { doc.setFont('helvetica', 'bold'); doc.text(`Orden Taller: ${p.numero_orden}`, W - 14, 26, { align: 'right' }) }

    doc.setDrawColor(190); doc.line(14, 30, W - 14, 30)
    doc.setFontSize(10); doc.setTextColor(30)
    const veh = [p.marca, p.modelo, p.anio].filter(Boolean).join(' ')
    const campo = (lbl, val, x, y) => { doc.setFont('helvetica', 'bold'); doc.text(lbl, x, y); doc.setFont('helvetica', 'normal'); doc.text(String(val || '—'), x + doc.getTextWidth(lbl) + 2, y) }
    campo('Vehículo:', veh, 14, 38); campo('Cliente:', p.cliente, W / 2, 38)
    campo('Placa:', p.placa, 14, 44); campo('Km:', km, W / 2, 44)

    let startY = 52
    const head = [['✓', 'CANT', 'Código', 'DESCRIPCIÓN', 'PRIORIDAD']]
    const colStyles = { 0: { halign: 'center', cellWidth: 9 }, 1: { halign: 'center', cellWidth: 16 }, 2: { cellWidth: 20 }, 3: { cellWidth: 'auto' }, 4: { halign: 'center', cellWidth: 28 } }
    const prioLbl = { crit: 'CRÍTICO', rec: 'Recomendado', prev: 'Preventivo' }
    const seccion = (titulo, esServ) => {
      const arr = items.filter(it => esServ ? it.tipo === 's' : it.tipo !== 's')
        .sort((a, b) => PRIO_ORD[getPrioridad(a)] - PRIO_ORD[getPrioridad(b)])
      if (!arr.length) return
      const prios = []
      const body = arr.map(it => { const pr = getPrioridad(it); prios.push(pr); return ['', Number(it.cantidad).toFixed(2), it.cod || '-', String(it.desc).toUpperCase(), prioLbl[pr]] })
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(200, 16, 46)
      doc.text(titulo, 14, startY); startY += 1.5
      doc.autoTable({
        startY, head, body, theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 2, textColor: [40, 40, 40] },
        headStyles: { fillColor: [45, 45, 60], textColor: 255, halign: 'center' },
        columnStyles: colStyles, margin: { left: 14, right: 14 },
        didParseCell: (dc) => {
          if (dc.section === 'body') {
            const pr = prios[dc.row.index]
            if (pr === 'crit') dc.cell.styles.fillColor = [254, 226, 226]
            else if (pr === 'prev') dc.cell.styles.fillColor = [220, 252, 231]
          }
        },
        didDrawCell: (dc) => {
          if (dc.section === 'body' && dc.column.index === 0) {
            const s = 3.4; const cx = dc.cell.x + dc.cell.width / 2 - s / 2; const cy = dc.cell.y + dc.cell.height / 2 - s / 2
            doc.setDrawColor(120); doc.rect(cx, cy, s, s)
          }
        }
      })
      startY = doc.lastAutoTable.finalY + 8
    }
    seccion('Productos', false)
    seccion('Servicios', true)

    if (p.notas && String(p.notas).trim()) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(60); doc.text('Observaciones:', 14, startY); startY += 5
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90)
      const ow = doc.splitTextToSize(String(p.notas).trim(), W - 28); doc.text(ow, 14, startY); startY += ow.length * 4 + 4
    }

    // Notas del mecánico + firmas
    startY = Math.max(startY, 210)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(60); doc.text('Notas del taller / repuestos usados:', 14, startY); startY += 3
    doc.setDrawColor(210); for (let i = 0; i < 3; i++) { doc.line(14, startY + 6 + i * 7, W - 14, startY + 6 + i * 7) }
    startY += 30
    doc.setDrawColor(130)
    doc.line(20, startY, 90, startY); doc.line(W - 90, startY, W - 20, startY)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90)
    doc.text('Mecánico', 45, startY + 5); doc.text('Jefe de Pista', W - 68, startY + 5)

    doc.save(`OT_${numeroDe(p.vendedor, p.correlativo).replace(/[^a-z0-9]/gi, '_')}_${(p.placa || 'taller').replace(/[^a-z0-9]/gi, '_')}.pdf`)
  }

  async function pdfDeProforma (p) {
    const items = Array.isArray(p.items) ? p.items : []
    if (!items.length) { toast('La cotización no tiene ítems', 'error'); return }
    await ensureJsPDF()
    await loadConfig()
    const { jsPDF } = window.jspdf
    const doc = new jsPDF()
    const W = doc.internal.pageSize.getWidth()
    const d = Math.max(0, Math.min(100, Number(p.descuento) || 0))
    const now = new Date()
    const vig = num(cfg('vigencia_dias')) || 30
    const vence = new Date(now.getTime() + vig * 86400000)
    const dmy = (dt) => `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(-2)}`
    const fISO = (s) => { const m = String(s || '').split('-'); return m.length === 3 ? `${+m[2]}/${+m[1]}/${m[0]}` : String(s || '') }

    // ── Encabezado empresa (izquierda) ──
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(200, 16, 46)
    doc.text('TECNIMAX', 14, 16)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.3); doc.setTextColor(70)
    let hy = 21.5
    doc.text(`RTN: ${cfg('rtn')}`, 14, hy); hy += 3.5
    doc.text(`Teléfono: ${cfg('telefono')} | ${cfg('email')}`, 14, hy); hy += 3.5
    doc.text(doc.splitTextToSize(`Dirección: ${cfg('direccion')}`, W / 2 - 4), 14, hy); hy += 3.5
    doc.text(`Nombre comercial: ${cfg('nombre_comercial')}`, 14, hy); hy += 3.5
    doc.text(`CAI: ${cfg('cai')}`, 14, hy)

    // ── Bloque proforma (derecha) ──
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(30)
    doc.text(`PROFORMA N° ${numeroDe(p.vendedor, p.correlativo)}`, W - 14, 16, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(70)
    let ry = 22
    doc.text(`Fecha: ${dmy(now)} ${now.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' })}`, W - 14, ry, { align: 'right' }); ry += 4
    doc.text(`Fecha Vencimiento: ${dmy(vence)}`, W - 14, ry, { align: 'right' }); ry += 4
    doc.text(`Vendedor: ${p.vendedor || '—'}`, W - 14, ry, { align: 'right' }); ry += 4
    doc.text(`Cliente: ${p.cliente || '—'}`, W - 14, ry, { align: 'right' })

    doc.setDrawColor(200); doc.line(14, 41, W - 14, 41)
    const veh = [p.marca, p.modelo, p.anio].filter(Boolean).join(' ')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(30)
    doc.text(`${veh || 'Vehículo n/d'}${p.placa ? '   |   Placa: ' + p.placa : ''}`, 14, 47)

    // ── Tablas por tipo (Productos / Servicios) ──
    const head = [['CANTIDAD', 'Código', 'DESCRIPCIÓN', 'IMP', 'Desc.', 'UNITARIO', 'TOTAL']]
    const colStyles = { 0: { halign: 'center', cellWidth: 19 }, 1: { cellWidth: 15 }, 2: { cellWidth: 'auto' }, 3: { halign: 'center', cellWidth: 11 }, 4: { halign: 'center', cellWidth: 13 }, 5: { halign: 'right', cellWidth: 23 }, 6: { halign: 'right', cellWidth: 24 } }
    let startY = 52
    const seccion = (titulo, esServ) => {
      const arr = items.filter(it => esServ ? it.tipo === 's' : it.tipo !== 's')
        .sort((a, b) => PRIO_ORD[getPrioridad(a)] - PRIO_ORD[getPrioridad(b)])
      if (!arr.length) return
      let secTot = 0
      const prios = []
      const body = arr.map(it => {
        const base = it.precio * it.cantidad; secTot += base
        prios.push(getPrioridad(it))
        return [it.cantidad.toFixed(2) + ' Unid', it.cod || 'Unid', String(it.desc).toUpperCase(), (it.isv || 0) + '%', fmt(d) + '%', fmt(it.precio), fmt(base)]
      })
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(200, 16, 46)
      doc.text(titulo, 14, startY); startY += 1.5
      doc.autoTable({
        startY, head, body, theme: 'grid',
        styles: { fontSize: 7.4, cellPadding: 1.3, textColor: [40, 40, 40] },
        headStyles: { fillColor: [45, 45, 60], textColor: 255, fontSize: 7.4, halign: 'center' },
        columnStyles: colStyles, margin: { left: 14, right: 14 },
        didParseCell: (dc) => {
          if (dc.section === 'body') {
            const pr = prios[dc.row.index]
            if (pr === 'crit') dc.cell.styles.fillColor = [254, 226, 226]
            else if (pr === 'prev') dc.cell.styles.fillColor = [220, 252, 231]
          }
        }
      })
      startY = doc.lastAutoTable.finalY
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(30)
      doc.text(`TOTAL ${titulo.toUpperCase()} : L ${fmt(secTot)}`, W - 14, startY + 4.5, { align: 'right' })
      startY += 10
    }
    seccion('Productos', false)
    seccion('Servicios', true)
    // Leyenda de prioridad (si hay ítems marcados crítico/preventivo)
    if (items.some(it => getPrioridad(it) !== 'rec')) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(120)
      doc.text('Prioridad — fondo rojo: CRÍTICO (hacer ya)  ·  sin color: RECOMENDADO  ·  fondo verde: PREVENTIVO (puede esperar).', 14, startY)
      startY += 5
    }

    // ── Totales fiscales (gravado / ISV / exento / total) ──
    let grossGrav = 0, grossEx = 0, isvT = 0
    items.forEach(it => {
      const base = it.precio * it.cantidad; const bd = base * (1 - d / 100)
      if ((it.isv || 0) > 0) { grossGrav += base; isvT += bd * (it.isv || 0) / 100 } else grossEx += base
    })
    const descMonto = (grossGrav + grossEx) * d / 100
    const gravNeto = grossGrav * (1 - d / 100)
    const exNeto = grossEx * (1 - d / 100)
    const total = gravNeto + exNeto + isvT

    let ty = startY + 2
    const totLine = (label, val, bold, neg) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 10.5 : 8.5)
      doc.setTextColor(bold ? 200 : 60, bold ? 16 : 60, bold ? 46 : 60)
      doc.text(label, W - 74, ty); doc.text((neg ? '-L ' : 'L ') + fmt(val), W - 14, ty, { align: 'right' }); ty += bold ? 6.5 : 4.8
    }
    totLine('Importe Gravado 15% L:', gravNeto)
    totLine('ISV 15% L:', isvT)
    totLine('Importe Exento L:', exNeto)
    if (d > 0) totLine(`Descuento (${fmt(d)}%):`, descMonto, false, true)
    totLine('Total:', total, true)

    // ── Términos, observaciones y firma (izquierda) ──
    let ly = startY + 2
    const leftW = W - 90
    const terms = cfg('terminos')
    if (terms) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(60); doc.text('Términos y Condiciones:', 14, ly); ly += 4
      doc.setFont('helvetica', 'italic'); doc.setFontSize(7.4); doc.setTextColor(90)
      const tw = doc.splitTextToSize('"' + terms + '"', leftW); doc.text(tw, 14, ly); ly += tw.length * 3.4 + 1
    }
    if (p.notas && String(p.notas).trim()) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(60); doc.text('Observaciones:', 14, ly); ly += 4
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4); doc.setTextColor(90)
      const ow = doc.splitTextToSize(String(p.notas).trim(), leftW); doc.text(ow, 14, ly); ly += ow.length * 3.4 + 1
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60); doc.text('Firmado por ' + cfg('nombre_comercial'), 14, ly + 3)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(30); doc.text('*** GRACIAS POR SU PREFERENCIA ***', 14, ly + 8)

    // ── Pie: garantía + rango CAI ──
    let fy = Math.max(ly + 8, ty) + 7
    doc.setDrawColor(200); doc.line(14, fy - 3, W - 14, fy - 3)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(30); doc.text('GARANTÍA DE TRABAJO', 14, fy); fy += 4
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(90)
    const gw = doc.splitTextToSize(cfg('garantia') + '   Recibe conforme (Cliente)', W - 28); doc.text(gw, 14, fy); fy += gw.length * 3 + 2
    doc.setFontSize(6.5); doc.setTextColor(120)
    doc.text(`Rango: ${cfg('rango_desde')} al ${cfg('rango_hasta')} | Fecha límite: ${fISO(cfg('fecha_limite'))}`, 14, fy)

    const nombre = `Proforma_${numeroDe(p.vendedor, p.correlativo).replace(/[^a-z0-9]/gi, '_')}_${(p.placa || 'proforma').replace(/[^a-z0-9]/gi, '_')}.pdf`
    doc.save(nombre)
  }
})()