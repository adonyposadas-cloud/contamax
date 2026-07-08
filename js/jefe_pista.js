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
      <div class="jp-row" style="align-items:flex-end">
        <div class="jp-fld" style="flex:0 0 180px"><label>N° Orden Taller *</label><input id="jp-orden" class="jp-inp" placeholder="Ej: 54700"></div>
        <div class="jp-fld" style="position:relative"><label>Técnico *</label><input id="jp-tecnico" class="jp-inp" placeholder="Nombre del técnico" autocomplete="off" oninput="jpTecInput()" onkeydown="if(event.key==='Escape')jpTecHide()"><div id="jp-tec-drop" style="display:none;position:absolute;z-index:60;top:100%;left:0;right:0;max-height:220px;overflow-y:auto;background:#0f1114;border:1px solid #2a2e37;border-radius:8px;margin-top:2px;box-shadow:0 8px 24px rgba(0,0,0,.5)"></div></div>
        <button class="jp-b ok" id="jp-enviar-btn" onclick="jpEnviar()">📤 Enviar a cotizar</button>
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
    const { data } = await jpSb().from('tecnicos_cat').select('nombre').order('usos', { ascending: false }).limit(500)
    jpTecnicos = (data || []).map(t => t.nombre).filter(Boolean)
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
  const matches = jpTecnicos.filter(t => t.includes(q)).slice(0, 25)
  let html = matches.map(t => `<div data-tec="${jpEsc(t)}" style="padding:8px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #1c1f26" onmouseover="this.style.background='#1a1d24'" onmouseout="this.style.background='transparent'">${jpEsc(t)}</div>`).join('')
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

window.jpEnviar = async () => {
  const v = id => (document.getElementById(id)?.value || '').trim()
  const orden = v('jp-orden').toUpperCase()
  const tecnico = v('jp-tecnico').toUpperCase()
  if (!orden) { window.toast?.('El N° de Orden Taller es obligatorio', 'error'); return }
  if (!tecnico) { window.toast?.('El técnico es obligatorio', 'error'); return }
  const btn = document.getElementById('jp-enviar-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Enviando…' }
  try {
    const { data: dup } = await jpSb().from('cotizador_proformas').select('id,estado').eq('numero_orden', orden).limit(1)
    if (dup && dup.length) { window.toast?.(`La orden #${orden} ya está cargada (${dup[0].estado}).`, 'error'); if (btn) { btn.disabled = false; btn.textContent = '📤 Enviar a cotizar' } return }
    const { error } = await jpSb().from('cotizador_proformas').insert({
      estado: 'solicitada', proc_solicitada: new Date().toISOString(),
      jefe_pista: jpNombre(), mecanico: tecnico, vendedor: '', numero_orden: orden,
      motivo: v('jp-motivo') || null, diagnostico: v('jp-diagnostico') || null,
      solicitados: jpItems.map(it => ({ tipo: it.tipo, desc: it.desc, cantidad: it.cantidad, agregado: false })), items: [], subtotal: 0, isv: 0, total: 0
    })
    if (error) throw error
    jpSb().rpc('tecnico_agregar', { p_nombre: tecnico }).then(() => { if (!jpTecnicos.includes(tecnico)) jpTecnicos.unshift(tecnico) }).catch(() => {})
    window.toast?.('📤 Enviado a cotizar. El cotizador ya la recibió.', 'success')
    jpItems = []; jpRenderItems()
    ;['jp-orden', 'jp-tecnico', 'jp-motivo', 'jp-diagnostico'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })
    jpCargar()
  } catch (e) { console.error('[jp enviar]', e); window.toast?.('Error al enviar: ' + (e.message || e), 'error') } finally { if (btn) { btn.disabled = false; btn.textContent = '📤 Enviar a cotizar' } }
}

async function jpCargar() {
  const cont = document.getElementById('jp-ordenes'); if (cont) cont.innerHTML = '<div class="jp-empty">Cargando…</div>'
  try {
    let q = jpSb().from('cotizador_proformas')
      .select('id,correlativo,vendedor,cliente,placa,marca,modelo,estado,jefe_pista,numero_orden,proc_solicitada,proc_inicio,proc_aprobada,proc_completada,solicitados')
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
  cont.innerHTML = jpData.map(p => {
    const f = jpFase(p)
    const veh = [p.marca, p.modelo].filter(Boolean).join(' ') || 'Vehículo'
    const nProd = (p.solicitados || []).length
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
    return `<div class="jp-ordcard">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600">${jpEsc(veh)} · ${jpEsc(p.placa || 's/placa')} <span style="color:#8b8f98;font-weight:400;font-size:12px">${jpEsc(corre)} · ${nProd} ítem(s)</span></div>
        <div style="font-size:12px;color:${f.color};margin-top:2px">${f.lbl}${p.cliente ? ' · ' + jpEsc(p.cliente) : ''}</div>
      </div>
      ${reloj}
      ${btnPdf}
      ${btnAdd}
      ${btnAut}
    </div>`
  }).join('')
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
window.jpAbrirAgregar = (id) => {
  const p = jpData.find(x => x.id === id); if (!p) return
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