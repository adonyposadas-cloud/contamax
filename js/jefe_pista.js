// ── CONTAMAX · Jefe de pista — solicitar cotización, ver tiempos y autorizar ──
// Crea "solicitudes de cotización" (info general + nombres de productos/servicios,
// sin precios) que arrancan la fase de cotización y le tiran la bola al cotizador.
// Depende de: window._sb, window._currentProfile, window.toast
const jpSb = () => window._sb
const jpProfile = () => { try { return window._currentProfile?.() || {} } catch (e) { return {} } }
const jpEsSuper = () => { const p = jpProfile(); return (p._rolReal || p.rol) === 'super_admin' }
const jpEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const jpNombre = () => (jpProfile().nombre || '').toUpperCase()
const jpCrono = ms => { if (ms == null || ms < 0) ms = 0; const s = Math.floor(ms / 1000); const hh = String(Math.floor(s / 3600)).padStart(2, '0'); const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return `${hh}:${mm}:${ss}` }
const jpColor = (ms, fase) => { const h = ms / 3600000; const lim = fase === 'cotizacion' ? [0.5, 2] : (fase === 'autorizacion' ? [2, 8] : [24, 72]); return h <= lim[0] ? '#16a34a' : (h <= lim[1] ? '#f59e0b' : '#f85149') }

let jpItems = []
let jpTimer = null
let jpData = []
let jpTipo = 'solicitado'   // 'solicitado' | 'recomendado'
let jpPrefill = null        // cliente/placa/km heredados de la Solicitado (para la Recomendado)
let jpMarcas = []
let jpModelos = []
let jpDescripciones = []
let jpTecnicos = []
let jpAgId = null
let jpAgItems = []

function jpFase(p) {
  if (p.estado === 'finalizada') return { fase: 'completado', lbl: '✅ Completado', color: '#16a34a' }
  if (p.proc_solicitada && !p.proc_inicio) return { fase: 'cotizacion', desde: p.proc_solicitada, lbl: '📝 Esperando cotización', color: '#8b5cf6' }
  if (p.proc_inicio && !p.proc_aprobada) return { fase: 'autorizacion', desde: p.proc_inicio, lbl: '⏳ Esperando tu autorización', color: '#f59e0b' }
  if (p.proc_aprobada && !p.proc_completada) return { fase: 'compra', desde: p.proc_aprobada, lbl: '📦 En compra de repuestos', color: '#3b82f6' }
  if (p.proc_completada) return { fase: 'completado', lbl: '✅ Completado', color: '#16a34a' }
  return { fase: '', lbl: p.estado || '', color: '#8b8f98' }
}

function jpStyles() {
  if (document.getElementById('jp-styles')) return
  const s = document.createElement('style'); s.id = 'jp-styles'
  s.textContent = `
    #view-jefe-pista .jp-card{background:#15171c;border:1px solid #2a2e37;border-radius:12px;padding:16px;margin-bottom:14px;max-width:960px}
    #view-jefe-pista .jp-h{font-weight:700;font-size:15px;margin-bottom:4px;color:#e6e6e6}
    #view-jefe-pista .jp-sub{font-size:12px;color:#8b8f98;margin-bottom:12px}
    #view-jefe-pista .jp-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
    #view-jefe-pista .jp-fld{display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px}
    #view-jefe-pista .jp-fld label{font-size:11px;color:#8b8f98;text-transform:uppercase;letter-spacing:.5px}
    #view-jefe-pista .jp-inp{background:#0f1114;border:1px solid #2a2e37;border-radius:8px;padding:8px 10px;color:#e6e6e6;font-size:13px;width:100%;text-transform:uppercase}
    #view-jefe-pista .jp-inp.lc{text-transform:none}
    #view-jefe-pista .jp-b{background:#0f1114;border:1px solid #2a2e37;border-radius:8px;padding:8px 14px;color:#e6e6e6;font-size:13px;cursor:pointer}
    #view-jefe-pista .jp-b:hover{border-color:#3a3f4a}
    #view-jefe-pista .jp-b.ok{background:#f0a500;border-color:#f0a500;color:#1a1a1a;font-weight:700}
    #view-jefe-pista .jp-b.green{background:#16a34a;border-color:#16a34a;color:#fff;font-weight:700}
    #view-jefe-pista .jp-b.del{color:#f85149;padding:6px 9px}
    #view-jefe-pista .jp-itrow{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#0f1114;border:1px solid #2a2e37;border-radius:8px;margin-bottom:6px;font-size:13px}
    #view-jefe-pista .jp-tag{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700}
    #view-jefe-pista .jp-tag.p{background:rgba(59,130,246,.18);color:#3b82f6}
    #view-jefe-pista .jp-tag.s{background:rgba(139,92,246,.18);color:#8b5cf6}
    #view-jefe-pista .jp-ordcard{display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;background:#15171c;border:1px solid #2a2e37;margin-bottom:8px}
    #view-jefe-pista .jp-empty{text-align:center;color:#8b8f98;padding:20px}
    #view-jefe-pista .jp-clock{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}`
  document.head.appendChild(s)
}

window.initJefePista = async () => {
  jpStyles(); jpItems = []
  const root = document.getElementById('view-jefe-pista'); if (!root) return
  root.innerHTML = `
    <div class="jp-card">
      <div class="jp-h">🧰 Nueva solicitud de cotización</div>
      <div class="jp-sub">Colocá el N° de orden del taller y el técnico asignado. El técnico carga el detalle en Taller Alpha y el cotizador completa la cotización. Arranca el tiempo de cotización.</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:2px 0 12px">
        <span style="font-size:12px;color:#8b8f98">Tipo de cotización:</span>
        <button type="button" id="jp-tipo-sol" onclick="jpSetTipo('solicitado')" style="cursor:pointer;border-radius:16px;padding:5px 14px;font-size:12px;font-weight:600;border:1px solid #3b82f6;background:#3b82f622;color:#3b82f6">🔧 Solicitado</button>
        <button type="button" id="jp-tipo-rec" onclick="jpSetTipo('recomendado')" style="cursor:pointer;border-radius:16px;padding:5px 14px;font-size:12px;font-weight:600;border:1px solid #3a3f4a;background:transparent;color:#8b8f98">💡 Recomendado</button>
        <span id="jp-tipo-hint" style="font-size:11px;color:#f59e0b"></span>
      </div>
      <div class="jp-row" style="align-items:flex-end">
        <div class="jp-fld" style="flex:0 0 180px"><label>N° Orden Taller *</label><input id="jp-orden" class="jp-inp" placeholder="Ej: 54700" onblur="jpCheckOrden()"></div>
        <div class="jp-fld" style="position:relative"><label>Técnico *</label><input id="jp-tecnico" class="jp-inp" placeholder="Nombre del técnico" autocomplete="off" oninput="jpTecInput()" onkeydown="if(event.key==='Escape')jpTecHide()"><div id="jp-tec-drop" style="display:none;position:absolute;z-index:60;top:100%;left:0;right:0;max-height:220px;overflow-y:auto;background:#0f1114;border:1px solid #2a2e37;border-radius:8px;margin-top:2px;box-shadow:0 8px 24px rgba(0,0,0,.5)"></div></div>
        <button class="jp-b ok" id="jp-enviar-btn" onclick="jpEnviar()">📤 Enviar a cotizar</button>
      </div>
      <div class="jp-row" style="align-items:flex-end;margin-top:10px">
        <div class="jp-fld"><label>Marca</label><input id="jp-marca" class="jp-inp" list="jp-marca-dl" placeholder="Ej: HONDA" autocomplete="off" style="text-transform:uppercase"><datalist id="jp-marca-dl"></datalist></div>
        <div class="jp-fld"><label>Modelo</label><input id="jp-modelo" class="jp-inp" list="jp-modelo-dl" placeholder="Ej: CR-V" autocomplete="off" style="text-transform:uppercase"><datalist id="jp-modelo-dl"></datalist></div>
        <div class="jp-fld" style="flex:0 0 110px"><label>Año</label><input id="jp-anio" class="jp-inp lc" type="number" inputmode="numeric" placeholder="Ej: 2016" min="1950" max="2100"></div>
      </div>
      <div class="jp-fld" style="margin-top:10px"><label>Lo que se le reportó al técnico</label><textarea id="jp-motivo" class="jp-inp lc" rows="2" placeholder="Ej: El cliente reporta ruido al frenar y pérdida de líquido…" style="resize:vertical"></textarea></div>
      <div class="jp-fld" style="margin-top:8px"><label>Diagnóstico del técnico (recomendaciones)</label><textarea id="jp-diagnostico" class="jp-inp lc" rows="2" placeholder="Ej: Se recomienda cambio de pastillas y discos delanteros; revisar retenedores…" style="resize:vertical"></textarea></div>
      <div style="border-top:1px solid #2a2e37;margin:10px 0;padding-top:10px">
        <div class="jp-h" style="font-size:13px">Repuestos y servicios a cotizar <span style="font-weight:400;color:#8b8f98;font-size:11px">(opcional)</span></div>
        <div class="jp-row" style="align-items:flex-end">
          <div class="jp-fld" style="flex:2;position:relative"><label>Nombre</label><input id="jp-it-desc" class="jp-inp" placeholder="Ej: RETENEDOR DE FLECHA" autocomplete="off" oninput="jpDescInput()" onkeydown="if(event.key==='Enter'){jpDescHide();jpAddItem('p')}else if(event.key==='Escape')jpDescHide()"><div id="jp-desc-drop" style="display:none;position:absolute;z-index:60;top:100%;left:0;right:0;max-height:280px;overflow-y:auto;background:#0f1114;border:1px solid #2a2e37;border-radius:8px;margin-top:2px;box-shadow:0 8px 24px rgba(0,0,0,.5)"></div></div>
          <div class="jp-fld" style="flex:0 0 90px"><label>Cantidad</label><input id="jp-it-cant" class="jp-inp lc" type="number" value="1" min="1"></div>
          <button class="jp-b" onclick="jpAddItem('p')" title="Agregar producto">➕ Producto</button>
          <button class="jp-b" onclick="jpAddItem('s')" title="Agregar servicio">🔧 Servicio</button>
        </div>
        <div id="jp-items"></div>
      </div>
    </div>
    <div class="jp-card">
      <div class="jp-h">📋 Mis órdenes en proceso</div>
      <div class="jp-sub">Acá ves en qué fase está cada orden y cuánto lleva. Si algo se atrasa, ya sabés a quién exigirle. Podés agregar ítems a una orden ya enviada.</div>
      <div id="jp-switch"></div>
      <div id="jp-ordenes"><div class="jp-empty">Cargando…</div></div>
    </div>
    <div id="jp-ag-ov" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:center;justify-content:center;padding:12px">
      <div style="background:#15171c;border:1px solid #2a2e37;border-radius:12px;padding:20px;max-width:560px;width:100%;max-height:88vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div class="jp-h" id="jp-ag-title">Agregar ítems</div>
          <button class="jp-b" onclick="jpAgCerrar()">✕</button>
        </div>
        <div class="jp-sub">Agregá los repuestos/servicios que faltaron. El cotizador los verá marcados como <b style="color:#f0a500">NUEVOS</b> para cotizarlos.</div>
        <div id="jp-ag-existentes" style="margin-bottom:10px"></div>
        <div class="jp-row" style="align-items:flex-end">
          <div class="jp-fld" style="flex:2"><label>Nombre</label><input id="jp-ag-desc" class="jp-inp" placeholder="Ej: FILTRO DE AIRE" onkeydown="if(event.key==='Enter')jpAgAdd('p')"></div>
          <div class="jp-fld" style="flex:0 0 80px"><label>Cantidad</label><input id="jp-ag-cant" class="jp-inp lc" type="number" value="1" min="1"></div>
          <button class="jp-b" onclick="jpAgAdd('p')">➕ Producto</button>
          <button class="jp-b" onclick="jpAgAdd('s')">🔧 Servicio</button>
        </div>
        <div id="jp-ag-nuevos"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="jp-b ok" id="jp-ag-guardar" onclick="jpAgGuardar()">💾 Guardar ítems nuevos</button></div>
      </div>
    </div>`
  jpRenderItems()
  await jpCargar()
  jpLoadTecnicos()
  jpLoadCatalogo()
  jpStart()
}

async function jpLoadTecnicos() {
  try {
    const { data } = await jpSb().from('tecnicos_cat').select('id,nombre').order('usos', { ascending: false }).limit(500)
    // Se guardan id + nombre. El id es lo que se persiste (enlace duro); el nombre es
    // solo lo que se escribe. Antes se guardaba el texto y el mecánico filtraba por él:
    // un espacio de más y no veía su orden.
    jpTecnicos = (data || []).filter(t => t.nombre)
    window._jpTecMap = {}
    jpTecnicos.forEach(t => { window._jpTecMap[t.nombre.trim().toUpperCase()] = t.id })
    const inp = document.getElementById('jp-tecnico')
    if (inp && !inp._jpBound) { inp._jpBound = true; inp.addEventListener('blur', () => setTimeout(jpTecHide, 150)) }
    const drop = document.getElementById('jp-tec-drop')
    if (drop && !drop._jpBound) {
      drop._jpBound = true
      drop.addEventListener('click', e => {
        const add = e.target.closest('[data-tec-add]'); if (add) return jpTecAgregarNuevo(add.getAttribute('data-tec-add'))
        const op = e.target.closest('[data-tec]'); if (op) jpTecPick(op.getAttribute('data-tec'))
      })
    }
  } catch (e) { console.error('[jp tecnicos]', e) }
}
window.jpTecInput = () => {
  const inp = document.getElementById('jp-tecnico'); const drop = document.getElementById('jp-tec-drop')
  if (!inp || !drop) return
  const q = (inp.value || '').trim().toUpperCase()
  if (q.length < 2) { drop.style.display = 'none'; drop.innerHTML = ''; return }
  const matches = jpTecnicos.filter(t => t.nombre.toUpperCase().includes(q.toUpperCase())).slice(0, 25)
  let html = matches.map(t => `<div data-tec="${jpEsc(t.nombre)}" style="padding:8px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #1c1f26" onmouseover="this.style.background='#1a1d24'" onmouseout="this.style.background='transparent'">${jpEsc(t.nombre)}</div>`).join('')
  if (!jpTecnicos.includes(q)) html += `<div data-tec-add="${jpEsc(q)}" style="padding:9px 10px;cursor:pointer;font-size:13px;color:#f0a500;font-weight:600" onmouseover="this.style.background='#1a1d24'" onmouseout="this.style.background='transparent'">➕ Agregar «${jpEsc(q)}»</div>`
  drop.innerHTML = html
  drop.style.display = html ? 'block' : 'none'
}
window.jpTecPick = (t) => { const inp = document.getElementById('jp-tecnico'); if (inp) inp.value = t; jpTecHide() }
window.jpTecAgregarNuevo = async (t) => {
  const inp = document.getElementById('jp-tecnico'); if (inp) inp.value = t; jpTecHide()
  try { await jpSb().rpc('tecnico_agregar', { p_nombre: t }); if (!jpTecnicos.includes(t)) jpTecnicos.unshift(t) } catch (e) {}
}
window.jpTecHide = () => { const drop = document.getElementById('jp-tec-drop'); if (drop) drop.style.display = 'none' }

async function jpLoadCatalogo() {
  try {
    const [ma, mo] = await Promise.all([
      jpSb().from('cotizador_marcas').select('marca,activo').order('marca'),
      jpSb().from('cotizador_modelos').select('marca,modelo,activo').order('modelo')
    ])
    jpMarcas = (ma.data || []).filter(m => m.activo !== false)
    jpModelos = (mo.data || []).filter(m => m.activo !== false)
    const dlM = document.getElementById('jp-marca-dl')
    if (dlM) dlM.innerHTML = jpMarcas.map(m => `<option value="${jpEsc(m.marca)}">`).join('')
    jpFillModelos('')
    const inM = document.getElementById('jp-marca')
    if (inM && !inM._jpBound) { inM._jpBound = true; inM.addEventListener('input', () => jpFillModelos(inM.value)) }
    // Catálogo curado de descripciones (crece con el uso)
    try {
      const dsc = await jpSb().from('cotizador_desc_cat').select('descripcion').order('usos', { ascending: false }).limit(5000)
      jpDescripciones = (dsc.data || []).map(d => d.descripcion).filter(Boolean)
      const inD = document.getElementById('jp-it-desc')
      if (inD && !inD._jpDescBound) { inD._jpDescBound = true; inD.addEventListener('blur', () => setTimeout(jpDescHide, 150)) }
      const drop = document.getElementById('jp-desc-drop')
      if (drop && !drop._jpBound) { drop._jpBound = true; drop.addEventListener('click', e => {
        const add = e.target.closest('[data-add]'); if (add) return jpDescAgregarNuevo(add.getAttribute('data-add'))
        const op = e.target.closest('[data-d]'); if (op) jpDescPick(op.getAttribute('data-d'))
      }) }
    } catch (e) { console.error('[jp descripciones]', e) }
  } catch (e) { console.error('[jp catalogo]', e) }
}
function jpFillModelos(marca) {
  const dl = document.getElementById('jp-modelo-dl'); if (!dl) return
  const mn = (marca || '').trim().toUpperCase()
  const list = mn ? jpModelos.filter(m => (m.marca || '').toUpperCase() === mn) : jpModelos
  dl.innerHTML = list.map(m => `<option value="${jpEsc(m.modelo)}">`).join('')
}
window.jpDescInput = () => {
  const inp = document.getElementById('jp-it-desc'); const drop = document.getElementById('jp-desc-drop')
  if (!inp || !drop) return
  const q = (inp.value || '').trim().toUpperCase()
  if (q.length < 2) { drop.style.display = 'none'; drop.innerHTML = ''; return }
  const matches = jpDescripciones.filter(d => d.includes(q)).slice(0, 40)
  let html = matches.map(d => `<div data-d="${jpEsc(d)}" style="padding:8px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #1c1f26" onmouseover="this.style.background='#1a1d24'" onmouseout="this.style.background='transparent'">${jpEsc(d)}</div>`).join('')
  if (!jpDescripciones.includes(q)) {
    html += `<div data-add="${jpEsc(q)}" style="padding:9px 10px;cursor:pointer;font-size:13px;color:#f0a500;font-weight:600" onmouseover="this.style.background='#1a1d24'" onmouseout="this.style.background='transparent'">➕ Agregar «${jpEsc(q)}» al catálogo</div>`
  }
  drop.innerHTML = html
  drop.style.display = html ? 'block' : 'none'
}
window.jpDescPick = (d) => {
  const inp = document.getElementById('jp-it-desc'); if (inp) inp.value = d
  jpDescHide()
  const c = document.getElementById('jp-it-cant'); if (c) c.focus()
}
window.jpDescAgregarNuevo = async (q) => {
  const inp = document.getElementById('jp-it-desc'); if (inp) inp.value = q
  jpDescHide()
  try { await jpSb().rpc('desc_cat_agregar', { p_desc: q, p_tipo: 'p' }); if (!jpDescripciones.includes(q)) jpDescripciones.unshift(q); window.toast?.('Agregado al catálogo', 'success') } catch (e) { console.error('[desc cat add]', e) }
  const c = document.getElementById('jp-it-cant'); if (c) c.focus()
}
window.jpDescHide = () => { const drop = document.getElementById('jp-desc-drop'); if (drop) drop.style.display = 'none' }

window.jpAddItem = (tipo) => {
  const d = document.getElementById('jp-it-desc'); const c = document.getElementById('jp-it-cant')
  const desc = (d?.value || '').trim().toUpperCase()
  const cant = parseFloat(c?.value) || 1
  if (!desc) { window.toast?.('Escribí el nombre del repuesto/servicio', 'error'); return }
  jpItems.push({ tipo, desc, cantidad: cant })
  jpSb().rpc('desc_cat_agregar', { p_desc: desc, p_tipo: tipo }).then(() => { if (!jpDescripciones.includes(desc)) jpDescripciones.unshift(desc) }).catch(() => {})
  if (d) d.value = ''; if (c) c.value = '1'
  if (d) d.focus()
  jpRenderItems()
}
window.jpDelItem = (i) => { jpItems.splice(i, 1); jpRenderItems() }
function jpRenderItems() {
  const c = document.getElementById('jp-items'); if (!c) return
  if (!jpItems.length) { c.innerHTML = '<div class="jp-sub" style="margin:6px 0">Todavía no agregaste ítems.</div>'; return }
  c.innerHTML = jpItems.map((it, i) => `<div class="jp-itrow">
    <span class="jp-tag ${it.tipo}">${it.tipo === 'p' ? 'PRODUCTO' : 'SERVICIO'}</span>
    <span style="flex:1">${jpEsc(it.desc)}</span>
    <span style="color:#8b8f98">x${it.cantidad}</span>
    <button class="jp-b del" onclick="jpDelItem(${i})">✕</button>
  </div>`).join('')
}

window.jpSetTipo = (t) => {
  jpTipo = (t === 'recomendado') ? 'recomendado' : 'solicitado'
  const sol = document.getElementById('jp-tipo-sol'); const rec = document.getElementById('jp-tipo-rec')
  const on = (el, color) => { if (el) el.style.cssText = `cursor:pointer;border-radius:16px;padding:5px 14px;font-size:12px;font-weight:600;border:1px solid ${color};background:${color}22;color:${color}` }
  const off = (el) => { if (el) el.style.cssText = 'cursor:pointer;border-radius:16px;padding:5px 14px;font-size:12px;font-weight:600;border:1px solid #3a3f4a;background:transparent;color:#8b8f98' }
  if (jpTipo === 'recomendado') { on(rec, '#f59e0b'); off(sol) } else { on(sol, '#3b82f6'); off(rec) }
}

// Al salir del N° de orden: si ya existe una cotización de esa orden, avisa,
// cambia a "Recomendado" y prellena el vehículo para que la 2da salga natural.
window.jpCheckOrden = async () => {
  const orden = (document.getElementById('jp-orden')?.value || '').trim().toUpperCase()
  const hint = document.getElementById('jp-tipo-hint')
  if (hint) hint.textContent = ''
  jpPrefill = null
  if (!orden) return
  try {
    const { data } = await jpSb().from('cotizador_proformas')
      .select('tipo_solicitud, marca, modelo, anio_vehiculo, mecanico, cliente, placa, kilometraje,proc_cotizada').eq('numero_orden', orden)
    if (!data || !data.length) return
    const tieneSol = data.some(d => (d.tipo_solicitud || 'solicitado') === 'solicitado')
    const tieneRec = data.some(d => d.tipo_solicitud === 'recomendado')
    if (tieneSol && tieneRec) {
      if (hint) { hint.style.color = '#f85149'; hint.textContent = `⚠ La orden #${orden} ya tiene Solicitado y Recomendado.` }
      return
    }
    if (tieneSol && !tieneRec) {
      jpSetTipo('recomendado')
      if (hint) { hint.style.color = '#f59e0b'; hint.textContent = `Ya existe la Solicitado de #${orden} — esta se enviará como Recomendado.` }
      const base = data.find(d => (d.tipo_solicitud || 'solicitado') === 'solicitado') || data[0]
      // Guardar cliente/placa/km para que la Recomendado nazca con ellos
      jpPrefill = { cliente: base.cliente || null, placa: base.placa || null, kilometraje: base.kilometraje || null }
      const setIf = (id, val) => { const el = document.getElementById(id); if (el && !el.value && val) el.value = val }
      setIf('jp-marca', base.marca); setIf('jp-modelo', base.modelo)
      setIf('jp-anio', base.anio_vehiculo); setIf('jp-tecnico', base.mecanico)
    } else if (tieneRec && !tieneSol) {
      jpSetTipo('solicitado')
      if (hint) { hint.style.color = '#f59e0b'; hint.textContent = `La orden #${orden} ya tiene Recomendado; esta será la Solicitado.` }
    }
  } catch (e) { /* silencioso */ }
}

window.jpEnviar = async () => {
  const v = id => (document.getElementById(id)?.value || '').trim()
  const orden = v('jp-orden').toUpperCase()
  const tecnico = v('jp-tecnico').toUpperCase()
  if (!orden) { window.toast?.('El N° de Orden Taller es obligatorio', 'error'); return }
  if (!tecnico) { window.toast?.('El técnico es obligatorio', 'error'); return }
  const anioN = parseInt(v('jp-anio'), 10)
  const btn = document.getElementById('jp-enviar-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Enviando…' }
  const tipoLbl = jpTipo === 'recomendado' ? 'Recomendado' : 'Solicitado'
  try {
    // Solo se bloquea si ya existe una del MISMO tipo para esa orden.
    const { data: dup } = await jpSb().from('cotizador_proformas').select('id,estado').eq('numero_orden', orden).eq('tipo_solicitud', jpTipo).limit(1)
    if (dup && dup.length) { window.toast?.(`La orden #${orden} ya tiene una cotización ${tipoLbl} (${dup[0].estado}).`, 'error'); if (btn) { btn.disabled = false; btn.textContent = '📤 Enviar a cotizar' } return }
    // El nombre escrito se resuelve a un id real. Si no matchea un técnico del catálogo,
    // tecnico_id queda null y la orden cae en "SIN ASIGNAR" — visible, no perdida.
    const tecnicoId = window._jpTecMap?.[(tecnico || '').trim().toUpperCase()] || null
    const { error } = await jpSb().from('cotizador_proformas').insert({
      estado: 'solicitada', proc_solicitada: new Date().toISOString(), tipo_solicitud: jpTipo,
      jefe_pista: jpNombre(), mecanico: tecnico, tecnico_id: tecnicoId, vendedor: '', numero_orden: orden,
      marca: v('jp-marca').toUpperCase() || null, modelo: v('jp-modelo').toUpperCase() || null,
      anio_vehiculo: Number.isFinite(anioN) ? anioN : null,
      cliente: (jpPrefill && jpPrefill.cliente) || null,
      placa: (jpPrefill && jpPrefill.placa) || null,
      kilometraje: (jpPrefill && jpPrefill.kilometraje) || null,
      motivo: v('jp-motivo') || null, diagnostico: v('jp-diagnostico') || null,
      solicitados: jpItems.map(it => ({ tipo: it.tipo, desc: it.desc, cantidad: it.cantidad, agregado: false })), items: [], subtotal: 0, isv: 0, total: 0
    })
    if (error) throw error
    jpSb().rpc('tecnico_agregar', { p_nombre: tecnico }).then(() => { if (!jpTecnicos.includes(tecnico)) jpTecnicos.unshift(tecnico) }).catch(() => {})
    window.toast?.(`📤 Enviado a cotizar (${tipoLbl}). El cotizador ya la recibió.`, 'success')
    jpItems = []; jpRenderItems(); jpPrefill = null
    ;['jp-orden', 'jp-tecnico', 'jp-marca', 'jp-modelo', 'jp-anio', 'jp-motivo', 'jp-diagnostico'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })
    const _h = document.getElementById('jp-tipo-hint'); if (_h) _h.textContent = ''
    jpSetTipo('solicitado')
    jpCargar()
  } catch (e) { console.error('[jp enviar]', e); window.toast?.('Error al enviar: ' + (e.message || e), 'error') } finally { if (btn) { btn.disabled = false; btn.textContent = '📤 Enviar a cotizar' } }
}

async function jpCargar() {
  jpRenderSwitch()
  const cont = document.getElementById('jp-ordenes'); if (cont) cont.innerHTML = '<div class="jp-empty">Cargando…</div>'
  try {
    let q = jpSb().from('cotizador_proformas')
      .select('id,correlativo,vendedor,cliente,placa,marca,modelo,anio_vehiculo,estado,jefe_pista,numero_orden,tipo_solicitud,mecanico,tecnico_id,proc_solicitada,proc_inicio,proc_cotizada,proc_aprobada,proc_completada,solicitados,items')
      .in('estado', ['solicitada', 'pendiente', 'autorizada']).order('created_at', { ascending: false }).limit(100)
    if (!jpEsSuper()) q = q.eq('jefe_pista', jpNombre())
    const { data, error } = await q
    if (error) throw error
    jpData = data || []
    jpRenderOrdenes()
  } catch (e) { console.error('[jp cargar]', e); const cont2 = document.getElementById('jp-ordenes'); if (cont2) cont2.innerHTML = `<div class="jp-empty" style="color:#f85149">Error: ${jpEsc(e.message || e)}</div>` }
}

function jpRenderOrdenes() {
  const cont = document.getElementById('jp-ordenes'); if (!cont) return
  if (!jpData.length) { cont.innerHTML = '<div class="jp-empty">No tenés órdenes en proceso. Creá una solicitud arriba.</div>'; return }
  // Grupos por fase del proceso (como en "Cotizaciones pendientes").
  // Primero lo que necesita TU acción (autorización), luego el resto del flujo.
  const GRUPOS = [
    { fase: 'autorizacion', titulo: '⏳ Esperando tu autorización', color: '#f59e0b' },
    { fase: 'cotizacion', titulo: '📝 Esperando cotización', color: '#8b5cf6' },
    { fase: 'compra', titulo: '📦 En compra de repuestos', color: '#3b82f6' },
    { fase: 'completado', titulo: '✅ Completadas', color: '#16a34a' }
  ]
  const byFase = {}
  jpData.forEach(p => { const fx = jpFase(p).fase || 'otro'; (byFase[fx] = byFase[fx] || []).push(p) })
  let html = ''

  // ── SIN ASIGNAR ──
  // Una orden 'solicitado' sin técnico es una que el mecánico NO ve (filtra por
  // tecnico_id). Si no se muestra acá, se queda sin inspeccionar en silencio: una fuga
  // invisible. Va arriba de todo porque necesita acción del jefe de pista AHORA.
  const sinAsignar = jpData.filter(p => p.tipo_solicitud === 'solicitado' && !p.tecnico_id)
  if (sinAsignar.length) {
    html += `<div style="margin:0 0 6px;font-size:12px;font-weight:700;color:#f85149;text-transform:uppercase;letter-spacing:.03em">
      🚩 Sin técnico asignado <span style="opacity:.55;margin-left:2px">${sinAsignar.length}</span></div>
      <div style="font-size:11px;color:#8b8f98;margin-bottom:6px">Nadie las ve en el checklist hasta que les asignes técnico.</div>`
    html += sinAsignar.map(jpCardAsignar).join('')
  }
  GRUPOS.forEach(g => {
    const lista = byFase[g.fase] || []
    html += `<div style="margin:16px 0 6px;font-size:12px;font-weight:700;color:${g.color};text-transform:uppercase;letter-spacing:.03em">${g.titulo} <span style="opacity:.55;margin-left:2px">${lista.length}</span></div>`
    html += lista.length ? lista.map(jpOrdenCard).join('') : '<div class="jp-empty" style="padding:4px 0;font-size:12px;color:#8b8f98">— ninguna —</div>'
  })
  // Cualquier fase no contemplada (por si acaso), al final
  const otras = byFase['otro'] || []
  if (otras.length) { html += `<div style="margin:16px 0 6px;font-size:12px;font-weight:700;color:#8b8f98;text-transform:uppercase">• Otras <span style="opacity:.55">${otras.length}</span></div>` + otras.map(jpOrdenCard).join('') }
  cont.innerHTML = html
}

// Tarjeta de una orden sin técnico: un desplegable para asignárselo.
function jpCardAsignar(p) {
  const veh = [p.marca, p.modelo].filter(Boolean).join(' ') || 'Vehículo'
  const corre = p.correlativo ? ('#' + (p.vendedor ? (p.vendedor.trim().slice(0, 2).toUpperCase() + '-') : '') + p.correlativo) : ('Orden ' + (p.numero_orden || ''))
  const opts = (jpTecnicos || []).map(t => `<option value="${jpEsc(t.id)}">${jpEsc(t.nombre)}</option>`).join('')
  return `<div class="jp-card" style="border-left:3px solid #f85149">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-weight:700">${jpEsc(veh)} · ${jpEsc(p.placa || 's/placa')}</div>
        <div style="font-size:11px;color:#8b8f98">${jpEsc(corre)} · orden ${jpEsc(p.numero_orden || '')}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="asig-${p.id}" class="jp-inp" style="min-width:180px">
          <option value="">— Elegí técnico —</option>${opts}
        </select>
        <button class="jp-b ok" onclick="jpAsignarTecnico('${p.id}')">Asignar</button>
      </div>
    </div>
  </div>`
}

// Asignar (o reasignar) el técnico de una orden.
// CANDADO: no se puede reasignar una orden con inspección ABIERTA. Si Yorbin llenó 15
// de 21 puntos y se la pasan a Alex, Alex cobraría los hallazgos de Yorbin. El jefe de
// pista tiene que cancelar esa inspección explícitamente primero — y eso deja rastro.
window.jpAsignarTecnico = async function (proformaId) {
  const sel = document.getElementById('asig-' + proformaId)
  const tecId = sel?.value
  if (!tecId) { window.toast?.('Elegí un técnico', 'error'); return }
  const nombre = (jpTecnicos.find(t => t.id === tecId) || {}).nombre || ''

  const p = (jpData || []).find(x => x.id === proformaId)

  // ¿Hay una inspección abierta para esta orden?
  const { data: insp } = await jpSb().from('checklist_inspecciones')
    .select('id,estado,mecanico_id').eq('numero_orden', p.numero_orden).eq('estado', 'en_proceso').limit(1)
  if (insp && insp.length) {
    window.toast?.('No se puede reasignar: hay una inspección en proceso. Cancelala primero para no transferir el trabajo de un técnico a otro.', 'error')
    return
  }

  const { error } = await jpSb().from('cotizador_proformas')
    .update({ tecnico_id: tecId, mecanico: nombre }).eq('id', proformaId)
  if (error) { window.toast?.(error.message, 'error'); return }
  window.toast?.(`Asignada a ${nombre}`, 'success')
  jpCargar()
}

function jpOrdenCard(p) {
  const f = jpFase(p)
  const veh = [p.marca, p.modelo].filter(Boolean).join(' ') || 'Vehículo'
  // El contador decía "0 ítem(s)" en una proforma con 3 ítems por L.19,189: contaba
  // SOLICITADOS (lo que se pidió cotizar) e ignoraba ITEMS (lo que el vendedor cotizó).
  // Son dos cosas distintas y las dos importan:
  //   solicitados → lo que hay que cotizar   ·   items → lo ya cotizado
  const nSol = (p.solicitados || []).length
  const nIt  = Array.isArray(p.items) ? p.items.length : 0
  const nProd = nSol || nIt
  const corre = p.correlativo ? ('#' + (p.vendedor ? (p.vendedor.trim().slice(0, 2).toUpperCase() + '-') : '') + p.correlativo) : ('Orden ' + (p.numero_orden || ''))
  const running = f.desde ? true : false
  const ms = running ? (Date.now() - new Date(f.desde).getTime()) : 0
  const reloj = running
    ? `<div class="jp-clock" data-jp-desde="${jpEsc(f.desde)}" data-jp-fase="${f.fase}" style="color:${jpColor(ms, f.fase)}">${jpCrono(ms)}</div>`
    : `<div class="jp-clock" style="color:#16a34a">✓</div>`
  const btnAut = f.fase === 'autorizacion'
    ? `<button class="jp-b green" onclick="jpAutorizar('${p.id}')" title="El cliente autorizó — pasar al cotizador para pedir repuestos">✓ Autorizado</button>` : ''
  const btnAdd = f.fase !== 'completado'
    ? `<button class="jp-b" onclick="jpAbrirAgregar('${p.id}')" title="Agregar más ítems a esta orden">➕ Ítems</button>` : ''
  // PDF disponible una vez que el cotizador emitió la cotización (proc_inicio
  // se setea al generar el PDF, que es lo que pasa la orden a autorización).
  const btnPdf = p.proc_inicio
    ? `<button class="jp-b" onclick="jpPdf('${p.id}')" title="Abrir la cotización en PDF para enviarla al cliente">📄 PDF</button>` : ''
  const esRec = p.tipo_solicitud === 'recomendado'
  // El guion de venta. Solo aparece en la 'recomendado' del checklist y solo cuando el
  // vendedor ya le puso precio a los hallazgos: sin precio no hay nada que ofrecer.
  // El que se entera de que el cliente dijo que no es el jefe de pista: él hizo la llamada.
  // NO es una anulación — la proforma sigue viva y entra en la lista de recontacto.
  //
  // SOLO aparece donde hay algo que el cliente PUDO rechazar:
  //   · 'recomendado'  → el checklist encontró trabajo que el cliente NO pidió.
  //                      Un 'solicitado' no se "no-vende": el cliente vino a hacerlo.
  //   · proc_cotizada  → ya tiene precio. Sin precio no hubo nada que ofrecer,
  //                      y un rechazo antes de cotizar no significa nada.
  //   · no autorizada  → si ya dijo que sí, no hay rechazo que registrar.
  const btnNV = (esRec && p.proc_cotizada && !['autorizada', 'no_vendida', 'finalizada', 'anulada'].includes(p.estado))
    ? `<button class="jp-b" style="border-color:#f85149;color:#f85149" onclick="jpNoVendida('${p.id}')" title="El cliente dijo que no — registrar el motivo">❌ No se vendió</button>` : ''
  const btnWA = (esRec && Array.isArray(p.items) && p.items.some(it => it.hallazgo_linea_id))
    ? `<button class="jp-b" style="border-color:#25D366;color:#25D366" onclick="jpEnviarHallazgos('${p.id}')" title="Armar el mensaje de WhatsApp con fotos, mediciones y precios">📲 Enviar hallazgos</button>` : ''
  const tipoBadge = `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;margin-left:6px;border:1px solid ${esRec ? '#f59e0b' : '#3b82f6'};color:${esRec ? '#f59e0b' : '#3b82f6'}">${esRec ? '💡 Recomendado' : '🔧 Solicitado'}</span>`
  // Borde izquierdo por fase (mismos colores del cotizador): rojo=cotización, amarillo=autorización, verde=pedido/completado
  const bCol = f.fase === 'cotizacion' ? '#f85149' : f.fase === 'autorizacion' ? '#f59e0b' : (f.fase === 'compra' || f.fase === 'completado') ? '#16a34a' : '#2a2e37'
  return `<div class="jp-ordcard" style="border-left:4px solid ${bCol}">
    <div style="flex:1;min-width:0">
      <div style="font-size:14px;font-weight:600">${jpEsc(veh)} · ${jpEsc(p.placa || 's/placa')} <span style="color:#8b8f98;font-weight:400;font-size:12px">${jpEsc(corre)} · ${nSol && nIt ? `${nSol} por cotizar · ${nIt} cotizado(s)` : (nIt && !nSol ? `${nIt} cotizado(s)` : `${nProd} ítem(s)`)}</span>${tipoBadge}</div>
      <div style="font-size:12px;color:${f.color};margin-top:2px">${f.lbl}${p.cliente ? ' · ' + jpEsc(p.cliente) : ''}</div>
    </div>
    ${reloj}
    ${btnWA}
    ${btnNV}
    ${btnPdf}
    ${btnAdd}
    ${btnAut}
  </div>`
}

window.jpAutorizar = async (id) => {
  if (!confirm('¿El cliente autorizó esta orden?\n\nSe pasa al cotizador para que pida los repuestos y se detiene tu reloj de autorización.')) return
  try {
    const { error } = await jpSb().rpc('cot_autorizar', { p_id: id, p_por: jpNombre() })
    if (error) throw error
    window.toast?.('✓ Autorizada — pasó al cotizador para pedir repuestos', 'success')
    jpCargar()
  } catch (e) { console.error('[jp autorizar]', e); window.toast?.('Error: ' + (e.message || e), 'error') }
}

// ── Abrir el PDF de la cotización (mismo que ve el cliente) ──
// Reutiliza el generador del cotizador (window.cotAbrirPdfProforma).
window.jpPdf = (id) => {
  if (typeof window.cotAbrirPdfProforma !== 'function') {
    window.toast?.('El generador de PDF no cargó. Recargá con Ctrl+Shift+R e intentá de nuevo.', 'error')
    return
  }
  window.cotAbrirPdfProforma(id, 'descargar')
}

// ── Agregar ítems a una orden ya enviada ──
window.jpAbrirAgregar = async (id) => {
  const p = jpData.find(x => x.id === id); if (!p) return

  // El bloqueo REAL lo hace el trigger en la base. Esto solo adelanta el mensaje: hacer
  // que escriba 5 ítems para después rebotarlo sería una crueldad innecesaria.
  try {
    const { data: est } = await jpSb().rpc('checklist_estado_orden', { p_proforma_id: id })
    if (est && !est.ok) {
      const pr = (window._currentProfile ? window._currentProfile() : null) || {}
      const esSuper = (pr._rolReal || pr.rol) === 'super_admin'
      if (!esSuper) { window.toast?.('🔒 ' + est.motivo, 'error'); return }
      const motivo = prompt(`🔒 ${est.motivo}\n\nSolo un super_admin puede saltarlo. Escribí el motivo (queda registrado):`)
      if (!motivo || !motivo.trim()) { window.toast?.('Cancelado', 'error'); return }
      const { error } = await jpSb().rpc('checklist_saltar', { p_proforma_id: id, p_motivo: motivo.trim() })
      if (error) { window.toast?.(error.message, 'error'); return }
      window.toast?.('Excepción registrada', 'success')
    }
  } catch (e) { /* si el RPC no existe todavía, el trigger igual protege */ }

  jpAgId = id; jpAgItems = []
  document.getElementById('jp-ag-title').textContent = `Agregar ítems — ${[p.marca, p.modelo].filter(Boolean).join(' ')} · ${p.placa || ''}`
  const ex = document.getElementById('jp-ag-existentes')
  const items = Array.isArray(p.solicitados) ? p.solicitados : []
  ex.innerHTML = items.length
    ? '<div class="jp-sub" style="margin-bottom:4px">Ya solicitado:</div>' + items.map(it => `<div style="font-size:12px;color:#8b8f98;padding:2px 0">• ${jpEsc(it.desc)} x${it.cantidad || 1}${it.agregado ? ' <span style="color:#16a34a">(agregado)</span>' : ''}${it.nuevo ? ' <span style="color:#f0a500">(nuevo)</span>' : ''}</div>`).join('')
    : '<div class="jp-sub">Esta orden aún no tiene ítems solicitados.</div>'
  jpAgRender()
  const d = document.getElementById('jp-ag-desc'); if (d) d.value = ''
  const c = document.getElementById('jp-ag-cant'); if (c) c.value = '1'
  document.getElementById('jp-ag-ov').style.display = 'flex'
  if (d) d.focus()
}
window.jpAgAdd = (tipo) => {
  const d = document.getElementById('jp-ag-desc'); const c = document.getElementById('jp-ag-cant')
  const desc = (d?.value || '').trim().toUpperCase(); const cant = parseFloat(c?.value) || 1
  if (!desc) { window.toast?.('Escribí el nombre', 'error'); return }
  jpAgItems.push({ tipo, desc, cantidad: cant })
  jpSb().rpc('desc_cat_agregar', { p_desc: desc, p_tipo: tipo }).then(() => { if (!jpDescripciones.includes(desc)) jpDescripciones.unshift(desc) }).catch(() => {})
  if (d) d.value = ''; if (c) c.value = '1'; if (d) d.focus()
  jpAgRender()
}
window.jpAgDel = (i) => { jpAgItems.splice(i, 1); jpAgRender() }
function jpAgRender() {
  const c = document.getElementById('jp-ag-nuevos'); if (!c) return
  if (!jpAgItems.length) { c.innerHTML = ''; return }
  c.innerHTML = '<div class="jp-sub" style="margin:6px 0 4px">Nuevos a agregar:</div>' + jpAgItems.map((it, i) => `<div class="jp-itrow"><span class="jp-tag ${it.tipo}">${it.tipo === 'p' ? 'PRODUCTO' : 'SERVICIO'}</span><span style="flex:1">${jpEsc(it.desc)}</span><span style="color:#8b8f98">x${it.cantidad}</span><button class="jp-b del" onclick="jpAgDel(${i})">✕</button></div>`).join('')
}
window.jpAgGuardar = async () => {
  if (!jpAgId || !jpAgItems.length) { window.toast?.('Agregá al menos un ítem', 'error'); return }
  const btn = document.getElementById('jp-ag-guardar'); if (btn) { btn.disabled = true; btn.textContent = 'Guardando…' }
  try {
    const { data, error } = await jpSb().from('cotizador_proformas').select('solicitados,proc_inicio,estado').eq('id', jpAgId).single()
    if (error) throw error
    const solic = Array.isArray(data.solicitados) ? data.solicitados.slice() : []
    jpAgItems.forEach(it => solic.push({ tipo: it.tipo, desc: it.desc, cantidad: it.cantidad, agregado: false, nuevo: true }))
    const { error: e2 } = await jpSb().from('cotizador_proformas').update({ solicitados: solic }).eq('id', jpAgId)
    if (e2) throw e2
    let msg = `✓ ${jpAgItems.length} ítem(s) agregado(s). El cotizador los verá como nuevos.`
    // Si ya pasó de cotización (está en autorización o compra) → volver a cotización y pausar tu tiempo
    if (data.proc_inicio && data.estado !== 'finalizada') {
      const { error: e3 } = await jpSb().rpc('cot_reabrir_cotizacion', { p_id: jpAgId })
      if (!e3) msg = `✓ ${jpAgItems.length} ítem(s) agregado(s). Volvió a cotización — se pausó tu tiempo de autorización mientras el cotizador re-cotiza.`
    }
    window.toast?.(msg, 'success')
    jpAgCerrar(); jpCargar()
  } catch (e) { console.error('[jp ag]', e); window.toast?.('Error: ' + (e.message || e), 'error') } finally { if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar ítems nuevos' } }
}
window.jpAgCerrar = () => { const ov = document.getElementById('jp-ag-ov'); if (ov) ov.style.display = 'none'; jpAgId = null; jpAgItems = [] }

function jpStart() {
  if (jpTimer) return
  jpTimer = setInterval(() => {
    const view = document.getElementById('view-jefe-pista')
    if (!view || !view.classList.contains('active')) return
    document.querySelectorAll('#jp-ordenes [data-jp-desde]').forEach(el => {
      const ms = Date.now() - new Date(el.getAttribute('data-jp-desde')).getTime()
      el.textContent = jpCrono(ms); el.style.color = jpColor(ms, el.getAttribute('data-jp-fase'))
    })
  }, 1000)
}
/* ============================================================================
 * 📲 ENVIAR HALLAZGOS AL CLIENTE
 *
 * No es un botón de "mandar fotos": es el GUION DE VENTA del proceso, armado solo.
 * La diferencia entre "el técnico dice que sus frenos están malos" y una foto del
 * disco DE SU CARRO, con el milímetro medido y el precio al lado.
 *
 * Fuentes (todas por ID, cero matching por texto):
 *   · precios y cantidades → items[] de la proforma (lo que el cliente va a pagar)
 *   · severidad y medición → checklist_hallazgos, vía item.hallazgo_id
 *   · fotos                → URL firmada de 7 días (el bucket es privado)
 *   · umbrales             → checklist_config
 * ========================================================================== */
window.jpEnviarHallazgos = async function (proformaId) {
  const sb = jpSb()
  try {
    window.toast?.('Armando el mensaje…')
    const { data: pf, error: e0 } = await sb.from('cotizador_proformas')
      .select('id,cliente,placa,marca,modelo,anio_vehiculo,items,numero_orden,descuento').eq('id', proformaId).single()
    if (e0) throw e0

    const items = (pf.items || []).filter(it => it.hallazgo_linea_id)
    if (!items.length) { window.toast?.('Esta proforma no tiene hallazgos cotizados', 'error'); return }

    const { data: insp } = await sb.from('checklist_inspecciones')
      .select('id,foto_desmontaje_del,foto_desmontaje_tra').eq('proforma_id', proformaId).single()

    const hIds = [...new Set(items.map(it => it.hallazgo_id).filter(Boolean))]
    const [rH, rP, rC] = await Promise.all([
      sb.from('checklist_hallazgos').select('id,punto_id,severidad,medicion,foto_url,medicion_estimada').in('id', hIds),
      sb.from('checklist_puntos').select('id,nombre,unidad_medicion,rueda_requerida,medicion_siempre'),
      sb.from('checklist_config').select('*').eq('id', 1).single()
    ])
    const H = {}; for (const h of (rH.data || [])) H[h.id] = h
    const P = {}; for (const p of (rP.data || [])) P[p.id] = p
    const CFG = rC.data || {}

    const firmar = async (path) => {
      if (!path) return ''
      const { data } = await sb.storage.from('checklist-fotos').createSignedUrl(path, 7 * 24 * 3600)
      return data?.signedUrl || ''
    }

    // Umbral que aplica a cada punto, para poder decir "(mínimo 3mm)"
    const umbral = (pt) => {
      if (!pt) return null
      if (pt.rueda_requerida) return CFG.mm_fric_rojo          // frenos
      if (pt.nombre && /labrado/i.test(pt.nombre)) return CFG.mm_llanta_rojo
      return null
    }

    // Agrupar por HALLAZGO (no por ítem): el cliente entiende "fricciones delanteras",
    // no "FRICCION DELANTERA" + "INSTALACION DE FRICCION DE DISCO DELANTERAS" por separado.
    const grupos = {}
    for (const it of items) {
      const g = grupos[it.hallazgo_id] || (grupos[it.hallazgo_id] = {
        hallazgo: H[it.hallazgo_id], punto: P[it.punto_id], severidad: it.severidad, lineas: [], total: 0
      })
      const isv = 1 + (Number(it.isv) || 0) / 100
      const sub = (Number(it.precio) || 0) * (Number(it.cantidad) || 0) * isv
      g.lineas.push(it.desc)
      g.total += sub
    }

    const fmt = v => Number(v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const veh = [pf.marca, pf.modelo, pf.anio_vehiculo].filter(Boolean).join(' ')
    const nombre = (pf.cliente || '').trim()

    let msg = `${nombre ? nombre + ' — s' : 'S'}u ${veh || 'vehículo'}${pf.placa ? ' ' + pf.placa : ''}\n`
    msg += `Revisión completa de su carro (orden #${pf.numero_orden || '—'}):\n`

    let total = 0
    for (const sev of ['rojo', 'amarillo']) {
      const gs = Object.values(grupos).filter(g => g.severidad === sev)
      if (!gs.length) continue
      msg += `\n${sev === 'rojo' ? '🔴 URGENTE' : '🟡 RECOMENDADO'}\n`
      for (const g of gs) {
        const pt = g.punto
        const h = g.hallazgo
        msg += `\n▪️ ${pt ? pt.nombre : (g.lineas[0] || '')}`
        // La medición SOLO si es real. Un valor estimado no se le muestra al cliente
        // como si fuera medido: es lo mismo que no pagarle comisión por él.
        if (h && h.medicion != null && !h.medicion_estimada) {
          const u = umbral(pt)
          msg += ` — ${h.medicion}${pt?.unidad_medicion || ''}${u ? ` (mínimo ${u}${pt.unidad_medicion || ''})` : ''}`
        }
        msg += '\n'
        const link = await firmar(h && h.foto_url)
        if (link) msg += `📷 ${link}\n`
        msg += `${g.lineas.join(' + ')}: L. ${fmt(g.total)}\n`
        total += g.total
      }
    }

    // Foto del freno desmontado: es la que sostiene todo el argumento de frenos
    const fd = await firmar(insp?.foto_desmontaje_del)
    const ft = await firmar(insp?.foto_desmontaje_tra)
    if (fd || ft) {
      msg += `\nDesmontamos las ruedas para medir sus frenos de verdad:\n`
      if (fd) msg += `📷 Delantera: ${fd}\n`
      if (ft) msg += `📷 Trasera: ${ft}\n`
    }

    msg += `\nTOTAL: L. ${fmt(total)}\n`
    msg += `\nSu carro está en el elevador. Si autoriza, se lo entregamos hoy.`
    msg += `\n(Los links de las fotos vencen en 7 días.)`

    jpModalWA(msg)
  } catch (e) {
    console.error('[jpEnviarHallazgos]', e)
    window.toast?.('Error: ' + (e.message || e), 'error')
  }
}

function jpModalWA (msg) {
  let ov = document.getElementById('jp-wa-modal')
  if (ov) ov.remove()
  ov = document.createElement('div')
  ov.id = 'jp-wa-modal'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:10002;display:flex;align-items:center;justify-content:center;padding:20px'
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove() })
  ov.innerHTML = `
    <div style="background:#15171c;border:1px solid #2a2e37;border-radius:12px;max-width:560px;width:100%;padding:18px;color:#e6edf3">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <b style="font-size:15px">📲 Mensaje para el cliente</b>
        <button onclick="document.getElementById('jp-wa-modal').remove()" style="background:none;border:0;color:#8b8f98;font-size:22px;cursor:pointer">×</button>
      </div>
      <textarea id="jp-wa-txt" style="width:100%;height:300px;background:#0d1117;border:1px solid #2a2e37;border-radius:8px;color:#e6edf3;padding:11px;font-size:13px;font-family:inherit;line-height:1.5">${jpEsc(msg)}</textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="jp-b" style="flex:1;padding:11px" onclick="jpCopiarWA()">📋 Copiar</button>
        <button class="jp-b green" style="flex:1;padding:11px" onclick="jpAbrirWA()">💬 Abrir WhatsApp</button>
      </div>
      <div style="font-size:11px;color:#8b8f98;margin-top:8px">Podés editarlo antes de enviarlo. Los links de las fotos vencen en 7 días.</div>
    </div>`
  document.body.appendChild(ov)
}

window.jpCopiarWA = async function () {
  const t = document.getElementById('jp-wa-txt'); if (!t) return
  try { await navigator.clipboard.writeText(t.value); window.toast?.('Copiado', 'success') }
  catch (e) { t.select(); document.execCommand('copy'); window.toast?.('Copiado', 'success') }
}

window.jpAbrirWA = function () {
  const t = document.getElementById('jp-wa-txt'); if (!t) return
  window.open('https://wa.me/?text=' + encodeURIComponent(t.value), '_blank')
}


/* ============================================================================
 * INTERRUPTOR DEL CHECKLIST OBLIGATORIO
 *
 * Va acá, en la pantalla del jefe de pista, y no enterrado en una configuración:
 * si el día 1 de la línea base el taller se traba con 25 carros adentro, hay que
 * poder apagarlo EN SEGUNDOS, parado justo donde se ve el problema.
 * Solo lo ve gerencia. El bloqueo real lo hace un trigger en la base — apagar esto
 * NO es apagar una validación de pantalla, es cambiar la regla del negocio.
 * ========================================================================== */
window.jpCfgChecklist = null

async function jpRenderSwitch () {
  const box = document.getElementById('jp-switch'); if (!box) return
  const prof = (window._currentProfile ? window._currentProfile() : null) || {}
  const rol = prof._rolReal || prof.rol || ''
  if (!['super_admin', 'admin', 'gerencia'].includes(rol)) { box.innerHTML = ''; return }
  try {
    const { data } = await jpSb().from('checklist_config').select('checklist_obligatorio').eq('id', 1).single()
    jpCfgChecklist = data
    const on = !!data?.checklist_obligatorio
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;margin-bottom:12px;border-radius:10px;
                  background:${on ? 'rgba(22,163,74,.10)' : 'rgba(240,165,0,.10)'};
                  border:1px solid ${on ? '#16a34a' : '#f0a500'}">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:${on ? '#16a34a' : '#f0a500'}">
            ${on ? '🔒 Checklist OBLIGATORIO' : '🔓 Checklist opcional (piloto)'}
          </div>
          <div style="font-size:11px;color:#8b8f98;margin-top:1px">
            ${on
              ? 'No se pueden agregar ítems a una orden sin checklist cerrado. Si el taller se traba, apagalo acá.'
              : 'Se pueden agregar ítems sin checklist. Prendelo el día 1 de la línea base.'}
          </div>
        </div>
        <button class="jp-b ${on ? '' : 'green'}" style="white-space:nowrap"
                onclick="jpToggleChecklist(${on ? 'false' : 'true'})">
          ${on ? '🔓 Apagar' : '🔒 Prender'}
        </button>
      </div>`
  } catch (e) { box.innerHTML = '' }
}

window.jpToggleChecklist = async function (prender) {
  const msg = prender
    ? '¿Prender el checklist obligatorio?\n\nA partir de ahora NO se van a poder agregar ítems a una orden sin checklist cerrado. Asegurate de que los 13 técnicos estén enrolados.'
    : '¿Apagar el checklist obligatorio?\n\nSe van a poder agregar ítems sin checklist. Usalo solo si el taller está trabado.'
  if (!confirm(msg)) return
  const { error } = await jpSb().from('checklist_config').update({ checklist_obligatorio: prender }).eq('id', 1)
  if (error) { window.toast?.('No se pudo cambiar: ' + error.message, 'error'); return }
  window.toast?.(prender ? '🔒 Checklist obligatorio PRENDIDO' : '🔓 Checklist obligatorio APAGADO', 'success')
  jpRenderSwitch()
}


/* ============================================================================
 * ❌ NO SE VENDIÓ
 *
 * NO es una anulación. La proforma no se borra ni se cancela: EL RECHAZO ES UN DATO.
 * De ahí sale la lista de recontacto a 15 y 30 días — la venta más barata que hay:
 * ya diagnosticamos, ya cotizamos, ya tenemos las fotos. Solo falta la llamada.
 * ========================================================================== */
window.jpNoVendida = async function (id) {
  const p = jpData.find(x => x.id === id)
  const { data: motivos, error } = await jpSb().from('motivos_no_venta')
    .select('codigo,nombre').order('orden')
  if (error) { window.toast?.('No se pudieron cargar los motivos: ' + error.message, 'error'); return }

  let ov = document.getElementById('jp-nv-modal'); if (ov) ov.remove()
  ov = document.createElement('div')
  ov.id = 'jp-nv-modal'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:10002;display:flex;align-items:center;justify-content:center;padding:20px'
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove() })
  ov.innerHTML = `
    <div style="background:#15171c;border:1px solid #2a2e37;border-radius:12px;max-width:440px;width:100%;padding:18px;color:#e6edf3">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <b style="font-size:15px">❌ El cliente no compró</b>
        <button onclick="document.getElementById('jp-nv-modal').remove()" style="background:none;border:0;color:#8b8f98;font-size:22px;cursor:pointer">×</button>
      </div>
      <div style="font-size:12px;color:#8b8f98;margin-bottom:12px">
        ${p ? jpEsc([p.marca, p.modelo].filter(Boolean).join(' ') + ' · ' + (p.placa || '')) : ''}
        <br>No se anula nada: queda para volver a llamarlo a los 15 y 30 días.
      </div>
      <div style="display:grid;gap:6px" id="jp-nv-lista">
        ${(motivos || []).map(m => `
          <label style="display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid #2a2e37;border-radius:8px;cursor:pointer;font-size:13px">
            <input type="radio" name="jp-nv-m" value="${jpEsc(m.codigo)}"> ${jpEsc(m.nombre)}
          </label>`).join('')}
      </div>
      <input id="jp-nv-nota" class="jp-inp" style="margin-top:9px" placeholder="Detalle (obligatorio si elegís «Otro»)">
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="jp-b" style="flex:1;padding:11px" onclick="document.getElementById('jp-nv-modal').remove()">Cancelar</button>
        <button class="jp-b" style="flex:1;padding:11px;border-color:#f85149;color:#f85149" onclick="jpNoVendidaOk('${id}')">Registrar</button>
      </div>
    </div>`
  document.body.appendChild(ov)
}

window.jpNoVendidaOk = async function (id) {
  const sel = document.querySelector('input[name="jp-nv-m"]:checked')
  if (!sel) { window.toast?.('Elegí el motivo', 'error'); return }
  const nota = (document.getElementById('jp-nv-nota')?.value || '').trim()
  const { error } = await jpSb().rpc('proforma_no_vendida',
    { p_id: id, p_motivo: sel.value, p_nota: nota || null })
  if (error) { window.toast?.(error.message, 'error'); return }
  document.getElementById('jp-nv-modal')?.remove()
  window.toast?.('Registrado — entra en la lista de recontacto', 'success')
  jpCargar()
}