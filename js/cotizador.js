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
  let PF = { id: null, correlativo: null, estado: 'pendiente', vendedor: '', cliente: '', placa: '', km: '', numero_orden: '', marca: '', modelo: '', anio: '', descuento: 0, notas: '', items: [] }
  let modalTipo = 'p'        // 'p' productos | 's' servicios
  let searchResults = []     // resultados actuales del modal
  let ordenActual = null     // { ord, items } de la orden abierta en el paso 2
  let _editIdx = null        // índice del ítem manual en edición (null = agregar nuevo)
  const costCache = {}       // nombre_norm -> [{proveedor,costo,fecha}]
  let VEH = null             // { marcas:[], byMarca:{ MARCA:{ MODELO:{label,anios:Set} } } }
  let HIST_FILTRO = ''       // '' | 'pendiente' | 'autorizada'
  let TAB = 'inicio'         // pestaña activa (abre en el dashboard)
  let ES_SUPER = false       // super_admin: puede corregir descripciones en la base
  let _fixIdx = null         // ítem en corrección de descripción
  let SEG_CAT = ''           // filtro de seguimiento
  let SEG_DATA = []          // cotizaciones clasificadas para seguimiento
  let PEDPF = null           // proforma abierta en el modal de pedidos
  let _pedIdx = null         // índice del ítem que se está pidiendo
  let PROVS = null           // cache de proveedores

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
    garantia: 'Todo trabajo tiene un mes de garantía en repuesto y mano de obra, excepto repuestos usados.'
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
    loadConfig()
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
      <div class="form-grid">
        <div class="fld"><label>Vendedor</label><input id="cot-vend" class="cot-in" placeholder="Nombre del vendedor"></div>
        <div class="fld"><label>Cliente</label><input id="cot-cli" class="cot-in" placeholder="Nombre del cliente"></div>
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
        <div class="fld"><label>Año</label>
          <div class="cot-ac-wrap">
            <input id="cot-anio" class="cot-in" placeholder="Escribí o elegí…" autocomplete="off">
            <div class="ac-list" id="cot-anio-ac" style="display:none"></div>
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
      <div id="cot-items">
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text3,#8b949e);margin-bottom:6px;flex-wrap:wrap">
          <span>⚙ Ganancia default (productos manuales):</span>
          <input id="cot-gan-def" class="cot-in" type="number" style="width:74px" value="30" min="0" step="0.5"><span>%</span>
          <span style="color:var(--text3,#8b949e)">— se aplica al agregar; siempre editable por producto.</span>
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
          <input id="cot-seg-q" class="cot-in" placeholder="🔍 Cliente o placa…" style="flex:1;min-width:180px;text-transform:uppercase">
          <button class="btn btn-ghost" id="cot-seg-export" style="font-size:12px;padding:6px 12px">⬇ Exportar CSV</button>
        </div>
        <div id="cot-seg-list"><div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Cargando…</div></div>
      </div>
    </div>

    <!-- PANEL CONFIG -->
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
        <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-gold" id="cfg-guardar">💾 Guardar configuración</button></div>
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
        <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
          <button class="btn btn-ghost" id="cm-cancel">Cancelar</button>
          <button class="btn btn-gold" id="cm-add">Agregar</button>
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
        <div class="modal-actions" style="justify-content:flex-end;margin-top:12px">
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
        <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
          <button class="btn btn-ghost" id="prov-cancel">Cancelar</button>
          <button class="btn btn-gold" id="prov-ok">Confirmar pedido</button>
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

  function itemsMarca (term) {
    if (!VEH) return []
    return VEH.marcas.filter(m => m.toLowerCase().includes(term)).slice(0, 80)
  }
  function itemsModelo (term) {
    const maKey = String(PF.marca || '').trim().toUpperCase()
    const mods = VEH && VEH.byMarca[maKey] ? VEH.byMarca[maKey] : null
    if (!mods) return []
    return Object.keys(mods).map(k => mods[k].label)
      .filter(l => l.toLowerCase().includes(term))
      .sort((a, b) => a.localeCompare(b)).slice(0, 80)
  }
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

  // ══════════════════════════════════════════════════════════
  //  WIRING
  // ══════════════════════════════════════════════════════════
  function wire () {
    $('cot-vend').addEventListener('input', e => PF.vendedor = e.target.value.toUpperCase())
    $('cot-cli').addEventListener('input', e => PF.cliente = e.target.value.toUpperCase())
    $('cot-km').addEventListener('input', e => PF.km = e.target.value)
    $('cot-orden').addEventListener('input', e => PF.numero_orden = e.target.value.trim())
    $('cot-desc').addEventListener('input', e => { PF.descuento = num(e.target.value); recalcTotales() })
    $('cot-notas').addEventListener('input', e => PF.notas = e.target.value)
    $('cfg-guardar').addEventListener('click', saveConfig)
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
    acSetup('cot-ma', 'cot-ma-ac', itemsMarca, v => { PF.marca = v.toUpperCase(); updVehHint() })
    acSetup('cot-mo', 'cot-mo-ac', itemsModelo, v => { PF.modelo = v.toUpperCase(); updVehHint() })
    acSetup('cot-anio', 'cot-anio-ac', itemsAnio, v => { PF.anio = v.toUpperCase(); updVehHint() })

    $('cot-buscar-prod').addEventListener('click', () => abrirBusq('p'))
    $('cot-buscar-serv').addEventListener('click', () => abrirBusq('s'))
    $('cot-manual').addEventListener('click', abrirManual)
    $('cot-btn-pdf').addEventListener('click', generarPDF)
    $('cot-btn-ot').addEventListener('click', generarOrdenTrabajo)
    $('cot-modal-close').addEventListener('click', () => $('cot-modal').classList.remove('open'))
    $('cm-cancel').addEventListener('click', () => $('cot-modal-man').classList.remove('open'))
    $('cm-add').addEventListener('click', addManual)
    $('cf-cancel').addEventListener('click', () => $('cot-modal-fix').classList.remove('open'))
    $('cf-guardar').addEventListener('click', aplicarCorreccion)
    // Pedidos rápidos
    $('ped-close').addEventListener('click', () => { $('cot-modal-ped').classList.remove('open'); loadDashboard() })
    $('ped-body').addEventListener('click', e => {
      const b = e.target.closest('[data-pedact]'); if (!b) return
      const i = parseInt(b.dataset.i, 10); const a = b.dataset.pedact
      if (a === 'pedir') iniciarPedido(i)
      else if (a === 'bodega') marcarBodega(i)
      else if (a === 'llego') marcarLlegado(i)
      else if (a === 'revertir') revertirPedido(i)
    })
    $('prov-cancel').addEventListener('click', () => $('cot-modal-prov').classList.remove('open'))
    $('prov-ok').addEventListener('click', confirmarPedido)
    acSetup('prov-input', 'prov-ac', (term) => term ? (PROVS || []).filter(p => p.toLowerCase().includes(term)).slice(0, 40) : [], () => {}, true)
    // Cálculo ganancia: costo/utilidad → precio ; precio → utilidad (bidireccional)
    $('cm-costo').addEventListener('input', calcVentaManual)
    $('cm-gan').addEventListener('input', calcVentaManual)
    $('cm-precio').addEventListener('input', () => { recalcGanManual(); updConISV() })
    $('cm-isv').addEventListener('input', updConISV)
    $('cm-tipo').addEventListener('change', toggleTipoManual)
    const gd = $('cot-gan-def')
    if (gd) { gd.value = getGanDefault(); gd.addEventListener('input', e => setGanDefault(num(e.target.value))) }

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
    })

    // ── Pestañas ──
    document.querySelector('#view-cotizador .cot-tabs').addEventListener('click', e => {
      const t = e.target.closest('[data-tab]'); if (t) switchTab(t.dataset.tab)
    })
    // Dashboard
    $('cot-dash-nueva').addEventListener('click', () => { nuevaProforma(); switchTab('nueva') })
    $('cot-dash-list').addEventListener('click', dashClick)
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
  }

  function updVehHint () {
    const t = [PF.marca, PF.modelo, PF.anio].filter(Boolean).join(' ')
    $('cot-veh-hint').textContent = t ? `🚗 Filtrando búsquedas para: ${t}` : ''
  }

  // ══════════════════════════════════════════════════════════
  //  BÚSQUEDA en histórico de órdenes
  // ══════════════════════════════════════════════════════════
  function abrirBusq (tipo) {
    modalTipo = tipo
    $('cot-modal-title').textContent = tipo === 'p' ? 'Buscar producto en órdenes' : 'Buscar servicio en órdenes'
    const veh = [PF.marca, PF.modelo, PF.anio].filter(Boolean).join(' ')
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
    const useVeh = PF.marca || PF.modelo || PF.anio
    try {
      let query = sb().from('cotizador_orden_items')
        .select('descripcion,cantidad,precio_unitario,tipo,cotizador_ordenes' + (useVeh ? '!inner' : '') + '(id,numero_orden,marca,modelo,anio,fecha_creacion,cliente)')
        .eq('tipo', modalTipo)
        .ilike('descripcion', '%' + term + '%')
        .limit(60)
      if (PF.marca) query = query.ilike('cotizador_ordenes.marca', '%' + escLike(PF.marca) + '%')
      if (PF.modelo) query = query.ilike('cotizador_ordenes.modelo', '%' + escLike(PF.modelo) + '%')
      if (PF.anio) query = query.eq('cotizador_ordenes.anio', PF.anio)
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
    $('cm-tipo').value = 'p'
    $('cm-cant').value = '1'
    $('cm-desc').value = ''
    $('cm-costo').value = '0'
    $('cm-gan').value = String(getGanDefault())   // default configurable
    $('cm-precio').value = '0'
    $('cm-isv').value = '15'
    $('cot-modal-man').querySelector('.modal-title').textContent = 'Agregar ítem manual'
    $('cm-add').textContent = 'Agregar'
    toggleTipoManual()
    updConISV()
    $('cot-modal-man').classList.add('open')
    setTimeout(() => $('cm-desc').focus(), 120)
  }

  function editarManual (i) {
    const it = PF.items[i]; if (!it || it.deOrden) return   // solo manuales
    _editIdx = i
    $('cm-tipo').value = it.tipo
    $('cm-cant').value = it.cantidad
    $('cm-desc').value = it.desc
    $('cm-costo').value = it.costo || 0
    $('cm-gan').value = it.ganancia || getGanDefault()
    $('cm-precio').value = it.precio
    $('cm-isv').value = it.isv
    $('cot-modal-man').querySelector('.modal-title').textContent = 'Editar ítem'
    $('cm-add').textContent = 'Guardar cambios'
    toggleTipoManual()
    updConISV()
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

  function addManual () {
    const desc = $('cm-desc').value.trim().toUpperCase()
    if (!desc) { toast('Escribí una descripción', 'error'); return }
    const precio = num($('cm-precio').value)
    if (!precio) { toast('Ingresá el precio', 'error'); return }
    const tipo = $('cm-tipo').value
    const item = {
      tipo, desc, cantidad: num($('cm-cant').value) || 1,
      precio, isv: num($('cm-isv').value),
      costo: tipo === 'p' ? num($('cm-costo').value) : 0,
      ganancia: tipo === 'p' ? num($('cm-gan').value) : 0,
      deOrden: '', ajuste: ''
    }
    if (_editIdx != null && PF.items[_editIdx]) {
      PF.items[_editIdx] = item; _editIdx = null
      $('cot-modal-man').classList.remove('open'); renderItems(); toast('Cambios guardados', 'success')
    } else {
      PF.items.push(item)
      $('cot-modal-man').classList.remove('open'); renderItems()
      toast((tipo === 'p' ? 'Producto' : 'Servicio') + ' agregado', 'success')
    }
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
  function renderItems () {
    const body = $('cot-items-body')
    if (!PF.items.length) {
      body.innerHTML = '<div style="text-align:center;color:var(--text3,#8b949e);padding:24px">Sin ítems. Buscá en órdenes o agregá manual.</div>'
      recalcTotales(); return
    }
    const prods = []; const servs = []
    PF.items.forEach((it, i) => { (it.tipo === 's' ? servs : prods).push({ it, i }) })
    const headRow = '<div class="cot-row head"><span>Descripción</span><span style="text-align:center">Cant</span><span style="text-align:right">P. Unit</span><span style="text-align:center">ISV%</span><span style="text-align:right">Total</span><span></span></div>'
    const grpTitle = (t) => `<div style="font-size:12px;font-weight:700;color:var(--gold,#c8a24a);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 2px">${t}</div>`
    const rowHTML = ({ it, i }) => {
      const total = it.precio * it.cantidad * (1 + (it.isv || 0) / 100)
      const esManual = !it.deOrden
      const p = getPrioridad(it)
      return `<div class="cot-row">
        <div>
          <div style="font-size:13px">${it.deOrden ? `<span class="cot-badge">#${esc(it.deOrden)}</span>` : ''}${esc(String(it.desc).toUpperCase())}${esManual ? ` <button data-edit="${i}" title="Editar descripción/precio" style="background:none;border:0;color:var(--gold,#c8a24a);cursor:pointer;font-size:12px;padding:0 4px">✏</button>` : (ES_SUPER ? ` <button data-fixdesc="${i}" title="Corregir esta descripción en la base (todas las órdenes)" style="background:none;border:0;color:var(--text3,#8b949e);cursor:pointer;font-size:12px;padding:0 4px">✏</button>` : '')}</div>
          ${it.ajuste ? `<div class="cot-adj">Ajustado ${esc(it.ajuste)}</div>` : ''}
          <div class="cot-cost" data-cost="${i}"></div>
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
    PF.items.forEach((it, i) => { if (it.tipo === 'p') cargarCosto(it.desc, i) })
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
    let pct = 0
    if (meses > 12) pct = 15; else if (meses > 6) pct = 10; else if (meses > 3) pct = 5
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
      marca: PF.marca || '', modelo: PF.modelo || '', anio: PF.anio || '', kilometraje: PF.km || '',
      numero_orden: orden,
      items: PF.items, subtotal: t.subtotal, isv: t.isv, total: t.total,
      descuento: t.descPct, notas: PF.notas || '',
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
        vendedor: data.vendedor || '', cliente: data.cliente || '', placa: data.placa || '',
        km: data.kilometraje || '', numero_orden: data.numero_orden || '', marca: data.marca || '', modelo: data.modelo || '', anio: data.anio || '',
        descuento: Number(data.descuento) || 0, notas: data.notas || '',
        items: Array.isArray(data.items) ? data.items : []
      }
      $('cot-vend').value = PF.vendedor; $('cot-cli').value = PF.cliente; $('cot-placa').value = PF.placa
      $('cot-km').value = PF.km; $('cot-ma').value = PF.marca; $('cot-mo').value = PF.modelo; $('cot-anio').value = PF.anio
      $('cot-orden').value = PF.numero_orden
      $('cot-desc').value = PF.descuento; $('cot-notas').value = PF.notas
      $('cot-placa-ac').style.display = 'none'
      $('cot-recmsg').textContent = `📂 Recuperada N° ${numeroProforma()} — ${PF.placa} ${PF.marca} ${PF.modelo}`
      $('cot-recban').style.display = 'flex'
      setNumLabel(); updVehHint(); renderItems()
      toast('Cotización recuperada', 'success')
    } catch (e) {
      console.error('[cotizador recuperar]', e); toast('No se pudo recuperar', 'error')
    }
  }

  function nuevaProforma () {
    if (PF.items.length && !PF.id && !confirm('¿Descartar la cotización actual sin guardar?')) return
    const prof = window._currentProfile ? window._currentProfile() : null
    PF = { id: null, correlativo: null, estado: 'pendiente', vendedor: prof ? (prof.nombre || '').toUpperCase() : '', cliente: '', placa: '', km: '', numero_orden: '', marca: '', modelo: '', anio: '', descuento: 0, notas: '', items: [] }
    ;['cot-cli', 'cot-placa', 'cot-km', 'cot-orden', 'cot-ma', 'cot-mo', 'cot-anio', 'cot-notas'].forEach(id => { const el = $(id); if (el) el.value = '' })
    $('cot-desc').value = '0'
    $('cot-vend').value = PF.vendedor
    $('cot-recban').style.display = 'none'
    setNumLabel(); updVehHint(); renderItems()
  }

  // ══════════════════════════════════════════════════════════
  //  PESTAÑAS · DASHBOARD · HISTORIAL
  // ══════════════════════════════════════════════════════════
  function switchTab (name) {
    TAB = name
    document.querySelectorAll('#view-cotizador .cot-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name))
    ;['inicio', 'nueva', 'cotizacion'].forEach(p => {
      const el = $('cot-panel-' + p); if (el) el.style.display = (p === name) ? '' : 'none'
    })
    if (name === 'inicio') loadDashboard()
    else if (name === 'cotizacion') loadHistorial()
    else if (name === 'seguimiento') loadSeguimiento()
    else if (name === 'config') fillConfigForm()
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
        P().select('id,correlativo,vendedor,cliente,placa,marca,modelo,anio,total,estado,created_at,items').in('estado', ['pendiente', 'autorizada']).order('created_at', { ascending: false }).limit(60)
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
    const badge = (esAut && pr.total > 0)
      ? ` <span style="font-size:12px;font-weight:800;color:${pr.color}">${pr.llegados}/${pr.total}</span>${pr.estado ? ` <span style="font-size:11px;color:${pr.color};font-weight:600">${pr.estado}</span>` : ''}`
      : ''
    const accion = esAut
      ? `<button class="btn btn-ghost" data-dashact="finalizar" data-pf="${p.id}" style="font-size:11px;padding:4px 10px;color:var(--green,#16a34a)">Finalizar</button>`
      : `<button class="btn btn-ghost" data-dashact="autorizar" data-pf="${p.id}" style="font-size:11px;padding:4px 10px;color:var(--green,#16a34a)">✓ Autorizar</button>`
    const openAttr = esAut ? `data-ped="${p.id}"` : `data-dashopen="${p.id}"`
    return `<div class="cot-hrow" ${openAttr} style="cursor:pointer">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:600">${esc(num)} · ${esc(p.placa || 's/placa')} <span class="cot-estado ${esc(p.estado)}">${esc(p.estado)}</span>${badge}</div>
        <div style="font-size:11px;color:var(--text3,#8b949e)">${esc(veh || 's/vehículo')} · ${esc(p.cliente || 's/n')} · L. ${fmt(p.total)}</div>
      </div>
      <div data-stop>${accion}</div>
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
    if (act === 'autorizar') {
      if (!confirm('¿Autorizar esta cotización?')) return
      const { error } = await sb().from('cotizador_proformas').update({ estado: 'autorizada' }).eq('id', id)
      if (error) { toast('Error al autorizar', 'error'); return }
      toast('Cotización autorizada', 'success'); loadDashboard()
    } else if (act === 'finalizar') {
      if (!confirm('¿Finalizar? Se quita del Inicio pero queda en Cotización.')) return
      const { error } = await sb().from('cotizador_proformas').update({ estado: 'finalizada' }).eq('id', id)
      if (error) { toast('Error al finalizar', 'error'); return }
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
    } catch (e) { console.error('[cotizador pedidos]', e); toast('No se pudo abrir', 'error') }
  }

  function renderPedidos () {
    if (!PEDPF) return
    const items = Array.isArray(PEDPF.items) ? PEDPF.items : []
    const pr = progresoPedidos(items)
    const pct = pr.total ? Math.round(pr.llegados / pr.total * 100) : 0
    $('ped-prog').innerHTML = `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="color:var(--text3,#8b949e)">Productos llegados</span><span style="font-weight:700;color:${pr.color}">${pr.llegados}/${pr.total} (${pct}%)${pr.estado ? ' · ' + pr.estado : ''}</span></div><div style="height:7px;background:var(--bg3,#1c2333);border-radius:5px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${pr.color}"></div></div>`
    const prods = []; const servs = []
    items.forEach((it, i) => { (it.tipo === 's' ? servs : prods).push({ it, i }) })
    const rowP = ({ it, i }) => {
      const seg = it.seguimiento || ''
      let estadoTxt = ''
      if (seg === 'llegado') estadoTxt = `<span class="ped-badge" style="background:rgba(22,163,74,.15);color:var(--green,#16a34a)">✓ ${it.seg_proveedor === 'BODEGA' ? 'Bodega' : 'Llegó'}</span>`
      else if (seg === 'pedido') estadoTxt = `<span class="ped-badge" style="background:rgba(59,130,246,.15);color:#3b82f6">📦 Pedido a ${esc(it.seg_proveedor || '')}</span>`
      else estadoTxt = '<span style="font-size:11px;color:var(--text3,#8b949e)">Sin pedir</span>'
      let botones = ''
      if (seg === 'llegado') botones = `<button class="ped-btn" data-pedact="revertir" data-i="${i}">↩ Revertir</button>`
      else if (seg === 'pedido') botones = `<button class="ped-btn ped-llego" data-pedact="llego" data-i="${i}">✓ Llegó</button> <button class="ped-btn" data-pedact="revertir" data-i="${i}">↩</button>`
      else botones = `<button class="ped-btn ped-pedir" data-pedact="pedir" data-i="${i}">Pedir</button> <button class="ped-btn ped-bodega" data-pedact="bodega" data-i="${i}">Bodega</button>`
      return `<div class="ped-row">
        <div style="min-width:0"><div style="font-size:13px">${esc(String(it.desc).toUpperCase())}</div><div style="font-size:11px;color:var(--text3,#8b949e)">Cant: ${fmt(it.cantidad)} · ${estadoTxt}</div><div class="cot-cost" data-pcost="${i}" style="margin-top:3px"></div></div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:flex-start">${botones}</div>
      </div>`
    }
    let html = ''
    if (prods.length) html += `<div style="font-size:12px;font-weight:700;color:var(--gold,#c8a24a);margin:10px 0 2px">PRODUCTOS</div>` + prods.map(rowP).join('')
    if (servs.length) html += `<div style="font-size:12px;font-weight:700;color:var(--gold,#c8a24a);margin:14px 0 2px">SERVICIOS</div>` + servs.map(({ it }) => `<div class="ped-row"><div style="font-size:13px">${esc(String(it.desc).toUpperCase())}<div style="font-size:11px;color:var(--text3,#8b949e)">Cant: ${fmt(it.cantidad)}</div></div><span style="font-size:11px;color:var(--text3,#8b949e)">Servicio</span></div>`).join('')
    $('ped-body').innerHTML = html
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

  async function iniciarPedido (i) {
    const it = pedItem(i); if (!it) return
    _pedIdx = i
    $('prov-item').textContent = String(it.desc).toUpperCase()
    $('prov-input').value = it.seg_proveedor || ''
    $('prov-ac').style.display = 'none'
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
    it.seguimiento = 'pedido'; it.seg_proveedor = prov; it.seg_fecha_pedido = new Date().toISOString()
    await guardarPedidos()
    $('cot-modal-prov').classList.remove('open'); renderPedidos()
    toast('📦 Pedido a ' + prov, 'success')
  }

  async function marcarLlegado (i) {
    const it = pedItem(i); if (!it) return
    it.seguimiento = 'llegado'; it.seg_fecha_llegada = new Date().toISOString()
    await guardarPedidos(); renderPedidos(); toast('✓ Llegó', 'success')
  }
  async function marcarBodega (i) {
    const it = pedItem(i); if (!it) return
    it.seguimiento = 'llegado'; it.seg_proveedor = 'BODEGA'; it.seg_fecha_pedido = new Date().toISOString(); it.seg_fecha_llegada = new Date().toISOString()
    await guardarPedidos(); renderPedidos(); toast('📦 Tomado de bodega', 'success')
  }
  async function revertirPedido (i) {
    const it = pedItem(i); if (!it) return
    if (!confirm('¿Revertir a "Sin pedir"?')) return
    delete it.seguimiento; delete it.seg_proveedor; delete it.seg_fecha_pedido; delete it.seg_fecha_llegada
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
        .select('id,correlativo,vendedor,cliente,placa,marca,modelo,anio,total,estado,created_at,numero_orden')
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

  // ── SEGUIMIENTO COMERCIAL ──
  function clasificar (p, ord) {
    const cotizado = Number(p.total) || 0
    if (!p.numero_orden) return { cat: 'sin_orden', facturado: 0, pendiente: cotizado, factura: '' }
    if (!ord || !ord.numero_factura) return { cat: 'sin_factura', facturado: 0, pendiente: cotizado, factura: '' }
    const facturado = Number(ord.total) || 0
    if (facturado < cotizado - 0.5) return { cat: 'facturo_menos', facturado, pendiente: Math.max(0, cotizado - facturado), factura: ord.numero_factura }
    return { cat: 'cerrada', facturado, pendiente: 0, factura: ord.numero_factura }
  }
  const CAT_LBL = { sin_orden: 'Sin orden', sin_factura: 'Sin factura', facturo_menos: 'Facturó menos', cerrada: 'Cerrada' }

  async function loadSeguimiento () {
    const list = $('cot-seg-list')
    list.innerHTML = '<div style="text-align:center;color:var(--text3,#8b949e);padding:20px">Cargando…</div>'
    try {
      const { data, error } = await sb().from('cotizador_proformas')
        .select('id,correlativo,vendedor,cliente,placa,marca,modelo,anio,total,estado,created_at,numero_orden')
        .order('created_at', { ascending: false }).limit(400)
      if (error) throw error
      const ordMap = await mapaOrdenes(data || [])
      SEG_DATA = (data || []).map(p => {
        const cl = clasificar(p, ordMap[String(p.numero_orden || '').trim()])
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
      .filter(p => !q || String(p.cliente || '').toUpperCase().includes(q) || String(p.placa || '').toUpperCase().includes(q))
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
          <div style="color:var(--gold,#c8a24a);font-weight:700;white-space:nowrap">Cotizado L. ${fmt(p.total)}</div>
          <div style="font-size:11px;color:${col}">Pendiente L. ${fmt(p.pendiente)}${p.facturado ? ` · facturado L. ${fmt(p.facturado)}` : ''}</div>
        </div>
      </div>`
    }).join('')
    list.querySelectorAll('[data-seg]').forEach(el => el.addEventListener('click', () => {
      recuperarProforma(el.dataset.seg).then(() => switchTab('nueva'))
    }))
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
      const { error } = await sb().from('cotizador_proformas').update({ estado: 'autorizada' }).eq('id', id)
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

  const CFG_MAP = { 'cfg-nombre': 'nombre_comercial', 'cfg-rtn': 'rtn', 'cfg-tel': 'telefono', 'cfg-email': 'email', 'cfg-dir': 'direccion', 'cfg-cai': 'cai', 'cfg-rdesde': 'rango_desde', 'cfg-rhasta': 'rango_hasta', 'cfg-flimite': 'fecha_limite', 'cfg-vig': 'vigencia_dias', 'cfg-terminos': 'terminos', 'cfg-garantia': 'garantia' }

  async function fillConfigForm () {
    await loadConfig()
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

  async function generarPDF () {
    if (!PF.items.length) { toast('Agregá al menos un ítem', 'error'); return }
    ordenarPF(); renderItems()
    const btn = $('cot-btn-pdf'); const prev = btn.textContent; btn.disabled = true; btn.textContent = 'Guardando…'
    try {
      const ok = await guardarProforma({ silencioso: true })   // guarda y asigna el número
      if (!ok) { btn.disabled = false; btn.textContent = prev; return }  // faltó orden/cliente/ítems
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