/* ════════════════════════════════════════════════════════════════════
 *  CONTAMAX · MÓDULO COTIZADOR (Proformas)  v1
 *  Lee de: cotizador_ordenes, cotizador_orden_items, cotizador_compras
 *  Funciones:
 *   · Buscar productos/servicios en el histórico de órdenes (filtro por vehículo)
 *   · Autocompletar marca/modelo/año (tema CONTAMAX, .ac-list/.ac-item)
 *   · Historial de costo por producto (desde cotizador_compras)
 *   · Constructor de proforma con ajuste de precio por antigüedad
 *   · Generar  PDF (jsPDF + autotable, carga diferida desde CDN)
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

  // ── Estado de la proforma en curso ──
  let PF = { id: null, correlativo: null, estado: 'pendiente', vendedor: '', cliente: '', placa: '', km: '', marca: '', modelo: '', anio: '', items: [] }
  let modalTipo = 'p'        // 'p' productos | 's' servicios
  let searchResults = []     // resultados actuales del modal
  let ordenActual = null     // { ord, items } de la orden abierta en el paso 2
  let _editIdx = null        // índice del ítem manual en edición (null = agregar nuevo)
  const costCache = {}       // nombre_norm -> [{proveedor,costo,fecha}]
  let VEH = null             // { marcas:[], byMarca:{ MARCA:{ MODELO:{label,anios:Set} } } }

  const GAN_KEY = 'cot_gan_default'
  const getGanDefault = () => { let v = 30; try { const s = parseFloat(localStorage.getItem(GAN_KEY)); if (!isNaN(s)) v = s } catch (e) {} return v }
  const setGanDefault = (v) => { try { localStorage.setItem(GAN_KEY, String(v)) } catch (e) {} }

  // ══════════════════════════════════════════════════════════
  //  INIT + RENDER DE LA VISTA
  // ══════════════════════════════════════════════════════════
  window.initCotizador = function () {
    const v = $('view-cotizador')
    if (!v) return
    if (!v.dataset.built) { v.innerHTML = viewHTML(); v.dataset.built = '1'; wire() }
    const prof = window._currentProfile ? window._currentProfile() : null
    if (prof && !PF.vendedor) { PF.vendedor = prof.nombre || ''; const el = $('cot-vend'); if (el) el.value = PF.vendedor }
    cargarVehiculos()
    setNumLabel()
    renderItems()
  }

  function viewHTML () {
    return `
    <style>
      #view-cotizador .cot-hint{font-size:11px;color:var(--green,#16a34a);font-weight:600;margin-top:3px}
      #view-cotizador .cot-hint2{font-size:10px;color:var(--text3,#8b949e);margin-top:1px}
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
    </style>

    <div class="page-header">
      <div>
        <div class="page-title">🧾 Cotizador · Proformas</div>
        <div class="page-sub" id="cot-num-label">Nueva cotización</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" id="cot-btn-nueva">＋ Nueva</button>
        <button class="btn btn-ghost" id="cot-btn-guardar">💾 Guardar</button>
        <button class="btn btn-gold" id="cot-btn-pdf">📄 Generar PDF</button>
      </div>
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
      <div class="form-grid" style="margin-top:10px">
        <div class="fld"><label>Placa <span style="font-weight:400;color:var(--text3,#8b949e);font-size:10px;text-transform:none">(recupera cotización pendiente)</span></label>
          <div class="cot-ac-wrap">
            <input id="cot-placa" class="cot-in" placeholder="Ej: HBL3999" autocomplete="off" style="text-transform:uppercase">
            <div class="ac-list" id="cot-placa-ac" style="display:none"></div>
          </div>
        </div>
        <div class="fld"><label>Kilometraje <span style="font-weight:400;color:var(--text3,#8b949e);font-size:10px;text-transform:none">(opcional)</span></label><input id="cot-km" class="cot-in" placeholder="Km"></div>
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
      <div style="max-width:340px;margin-left:auto;margin-top:14px">
        <div class="cot-tot"><span style="color:var(--text3,#8b949e)">Subtotal</span><span id="cot-sub">L. 0.00</span></div>
        <div class="cot-tot"><span style="color:var(--text3,#8b949e)">ISV</span><span id="cot-isv">L. 0.00</span></div>
        <div class="cot-tot big"><span>Total</span><span id="cot-total">L. 0.00</span></div>
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
    </div>`
  }

  // ══════════════════════════════════════════════════════════
  //  AUTOCOMPLETAR (tema CONTAMAX)
  // ══════════════════════════════════════════════════════════
  function acSetup (inputId, listId, getItems, onChange) {
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
    inp.addEventListener('focus', () => { active = -1; render() })
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
    $('cot-vend').addEventListener('input', e => PF.vendedor = e.target.value)
    $('cot-cli').addEventListener('input', e => PF.cliente = e.target.value)
    $('cot-km').addEventListener('input', e => PF.km = e.target.value)
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
    acSetup('cot-ma', 'cot-ma-ac', itemsMarca, v => { PF.marca = v; updVehHint() })
    acSetup('cot-mo', 'cot-mo-ac', itemsModelo, v => { PF.modelo = v; updVehHint() })
    acSetup('cot-anio', 'cot-anio-ac', itemsAnio, v => { PF.anio = v; updVehHint() })

    $('cot-buscar-prod').addEventListener('click', () => abrirBusq('p'))
    $('cot-buscar-serv').addEventListener('click', () => abrirBusq('s'))
    $('cot-manual').addEventListener('click', abrirManual)
    $('cot-btn-pdf').addEventListener('click', generarPDF)
    $('cot-modal-close').addEventListener('click', () => $('cot-modal').classList.remove('open'))
    $('cm-cancel').addEventListener('click', () => $('cot-modal-man').classList.remove('open'))
    $('cm-add').addEventListener('click', addManual)
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
      if (ed) editarManual(parseInt(ed.dataset.edit, 10))
    })
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
      return `<div class="cot-row">
        <div>
          <div style="font-size:13px">${it.deOrden ? `<span class="cot-badge">#${esc(it.deOrden)}</span>` : ''}${esc(String(it.desc).toUpperCase())}${esManual ? ` <button data-edit="${i}" title="Editar descripción/precio" style="background:none;border:0;color:var(--gold,#c8a24a);cursor:pointer;font-size:12px;padding:0 4px">✏</button>` : ''}</div>
          ${it.ajuste ? `<div class="cot-adj">Ajustado ${esc(it.ajuste)}</div>` : ''}
          <div class="cot-cost" data-cost="${i}"></div>
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

  function recalcTotales () {
    let sub = 0, isv = 0
    PF.items.forEach(it => { const b = it.precio * it.cantidad; sub += b; isv += b * (it.isv || 0) / 100 })
    $('cot-sub').textContent = 'L. ' + fmt(sub)
    $('cot-isv').textContent = 'L. ' + fmt(isv)
    $('cot-total').textContent = 'L. ' + fmt(sub + isv)
  }

  async function cargarCosto (desc, i) {
    const cont = document.querySelector(`[data-cost="${i}"]`)
    if (!cont) return
    const key = String(desc || '').toUpperCase().trim()
    if (!key) return
    try {
      let entradas = costCache[key]
      if (!entradas) {
        const term = key.replace(/[%,]/g, ' ').trim()
        const { data } = await sb().from('cotizador_compras')
          .select('proveedor,costo_unitario,fecha_compra')
          .ilike('nombre_norm', '%' + term + '%')
          .order('fecha_compra', { ascending: false })
          .limit(4)
        entradas = data || []
        costCache[key] = entradas
      }
      if (!entradas.length) return
      const a = entradas[0]
      let html = `<div class="cot-hint">🏪 ${esc(a.proveedor || '')} · L. ${fmt(a.costo_unitario)} · ${esc(fFecha(a.fecha_compra))}</div>`
      if (entradas[1]) html += `<div class="cot-hint2">🏪 ${esc(entradas[1].proveedor || '')} · L. ${fmt(entradas[1].costo_unitario)} · ${esc(fFecha(entradas[1].fecha_compra))}</div>`
      cont.innerHTML = html
    } catch (e) { /* costo informativo */ }
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
  function numeroProforma () {
    if (!PF.correlativo) return '—'
    const ini = iniciales(PF.vendedor)
    return (ini ? ini + '-' : '') + PF.correlativo
  }
  function setNumLabel () {
    $('cot-num-label').textContent = PF.correlativo ? ('Cotización N° ' + numeroProforma() + (PF.estado ? ' · ' + PF.estado : '')) : 'Nueva cotización'
  }

  function totales () {
    let sub = 0, isv = 0
    PF.items.forEach(it => { const b = it.precio * it.cantidad; sub += b; isv += b * (it.isv || 0) / 100 })
    return { subtotal: Math.round(sub * 100) / 100, isv: Math.round(isv * 100) / 100, total: Math.round((sub + isv) * 100) / 100 }
  }

  async function guardarProforma () {
    if (!PF.cliente && !PF.placa) { toast('Ingresá al menos cliente o placa', 'error'); return }
    if (!PF.items.length) { toast('Agregá al menos un ítem', 'error'); return }
    const btn = $('cot-btn-guardar'); const prev = btn.textContent; btn.disabled = true; btn.textContent = 'Guardando...'
    const prof = window._currentProfile ? window._currentProfile() : null
    const t = totales()
    const payload = {
      vendedor: PF.vendedor || '', vendedor_id: prof ? prof.id : null,
      cliente: PF.cliente || '', placa: (PF.placa || '').toUpperCase(),
      marca: PF.marca || '', modelo: PF.modelo || '', anio: PF.anio || '', kilometraje: PF.km || '',
      items: PF.items, subtotal: t.subtotal, isv: t.isv, total: t.total,
      ganancia_default: getGanDefault(), estado: PF.estado || 'pendiente'
    }
    try {
      if (PF.id) {
        const { error } = await sb().from('cotizador_proformas').update(payload).eq('id', PF.id)
        if (error) throw error
        toast('Cotización N° ' + numeroProforma() + ' actualizada', 'success')
      } else {
        const { data, error } = await sb().from('cotizador_proformas').insert(payload).select('id,correlativo,estado').single()
        if (error) throw error
        PF.id = data.id; PF.correlativo = data.correlativo; PF.estado = data.estado
        toast('Cotización N° ' + numeroProforma() + ' guardada', 'success')
      }
      setNumLabel()
    } catch (e) {
      console.error('[cotizador guardar]', e)
      toast('Error al guardar: ' + (e.message || e), 'error')
    } finally {
      btn.disabled = false; btn.textContent = prev
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
        km: data.kilometraje || '', marca: data.marca || '', modelo: data.modelo || '', anio: data.anio || '',
        items: Array.isArray(data.items) ? data.items : []
      }
      $('cot-vend').value = PF.vendedor; $('cot-cli').value = PF.cliente; $('cot-placa').value = PF.placa
      $('cot-km').value = PF.km; $('cot-ma').value = PF.marca; $('cot-mo').value = PF.modelo; $('cot-anio').value = PF.anio
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
    PF = { id: null, correlativo: null, estado: 'pendiente', vendedor: prof ? (prof.nombre || '') : '', cliente: '', placa: '', km: '', marca: '', modelo: '', anio: '', items: [] }
    ;['cot-cli', 'cot-placa', 'cot-km', 'cot-ma', 'cot-mo', 'cot-anio'].forEach(id => { const el = $(id); if (el) el.value = '' })
    $('cot-vend').value = PF.vendedor
    $('cot-recban').style.display = 'none'
    setNumLabel(); updVehHint(); renderItems()
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

  async function generarPDF () {
    if (!PF.items.length) { toast('Agregá al menos un ítem', 'error'); return }
    const btn = $('cot-btn-pdf'); const prev = btn.textContent; btn.disabled = true; btn.textContent = 'Generando...'
    try {
      await ensureJsPDF()
      const { jsPDF } = window.jspdf
      const doc = new jsPDF()
      const W = doc.internal.pageSize.getWidth()

      doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.setTextColor(200, 16, 46)
      doc.text('TECNIMAX', 14, 18)
      doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90)
      doc.text('S. de R.L. · Tegucigalpa, Honduras', 14, 24)
      doc.setFontSize(13); doc.setFont(undefined, 'bold'); doc.setTextColor(30)
      doc.text('PROFORMA', W - 14, 18, { align: 'right' })
      doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90)
      doc.text(new Date().toLocaleDateString('es-HN', { day: '2-digit', month: 'long', year: 'numeric' }), W - 14, 24, { align: 'right' })
      if (PF.correlativo) doc.text('N° ' + numeroProforma(), W - 14, 29, { align: 'right' })

      doc.setDrawColor(220); doc.line(14, 32, W - 14, 32)
      doc.setFontSize(10); doc.setTextColor(30)
      const veh = [PF.marca, PF.modelo, PF.anio].filter(Boolean).join(' ')
      doc.text(`Cliente: ${PF.cliente || '—'}`, 14, 40)
      doc.text(`Vendedor: ${PF.vendedor || '—'}`, 14, 46)
      if (veh) doc.text(`Vehículo: ${veh}`, W - 14, 40, { align: 'right' })
      if (PF.placa) doc.text(`Placa: ${PF.placa}`, W - 14, 46, { align: 'right' })

      let sub = 0, isvT = 0
      const bodyRows = PF.items.map(it => {
        const base = it.precio * it.cantidad
        const isv = base * (it.isv || 0) / 100
        sub += base; isvT += isv
        return [(it.tipo === 's' ? '[Serv] ' : '') + it.desc, fmt(it.cantidad), 'L. ' + fmt(it.precio), 'L. ' + fmt(base + isv)]
      })
      doc.autoTable({
        startY: 50,
        head: [['Descripción', 'Cant', 'P. Unit', 'Total']],
        body: bodyRows,
        theme: 'striped',
        headStyles: { fillColor: [26, 26, 46], textColor: 255, fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'center', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 28 }, 3: { halign: 'right', cellWidth: 30 } },
        margin: { left: 14, right: 14 }
      })

      let y = doc.lastAutoTable.finalY + 8
      const tot = (label, val, bold) => {
        doc.setFont(undefined, bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 12 : 10)
        doc.setTextColor(bold ? 200 : 90, bold ? 16 : 90, bold ? 46 : 90)
        doc.text(label, W - 70, y); doc.text('L. ' + fmt(val), W - 14, y, { align: 'right' }); y += bold ? 8 : 6
      }
      tot('Subtotal', sub); tot('ISV', isvT); tot('TOTAL', sub + isvT, true)

      doc.setFont(undefined, 'italic'); doc.setFontSize(8); doc.setTextColor(150)
      doc.text('Proforma sin valor fiscal. Precios sujetos a cambio y disponibilidad.', 14, y + 6)

      const nombre = `Proforma_${(PF.cliente || 'cliente').replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`
      doc.save(nombre)
      toast('PDF generado', 'success')
    } catch (e) {
      console.error('[cotizador PDF]', e)
      toast('Error al generar PDF: ' + (e.message || e), 'error')
    } finally {
      btn.disabled = false; btn.textContent = prev
    }
  }
})()