// ── CONTAMAX · Jefe de pista — solicitar cotización, ver tiempos y autorizar ──
// Crea "solicitudes de cotización" (info general + nombres de productos/servicios,
// sin precios) que arrancan la fase de cotización y le tiran la bola al cotizador.
// Depende de: window._sb, window._currentProfile, window.toast
const jpSb = () => window._sb
const jpProfile = () => { try { return window._currentProfile?.() || {} } catch (e) { return {} } }
const jpEsSuper = () => { const p = jpProfile(); return (p._rolReal || p.rol) === 'super_admin' }
const jpEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// Teléfono → formato wa.me (solo dígitos; 8 dígitos = celular HN, se antepone 504).
// Misma lógica que normTel() del cotizador, para que ambos armen el mismo número.
const jpNormTel = t => { let n = String(t || '').replace(/\D/g, ''); if (n && n.length <= 8) n = '504' + n; return n }
// Normalización de nombre/placa idéntica a provNorm() del cotizador (así casa la clave
// cliente_norm/placa_norm con la que el cotizador guardó el teléfono en clientes_contacto).
const jpProvNorm = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim()
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
    /* SIEMPRE en dos filas: descripción arriba, botones abajo.
       Antes era adaptativo (los botones subían si cabían) y eso hacía saltar la
       tarjeta cada segundo: el reloj cambia de ancho al pasar de "1" a "8", y
       ese pixel de más bastaba para que la fila dejara de caber y todo se
       reacomodara. Un layout que depende de si entra por poco es un layout que
       tiembla. Con filas fijas, la tarjeta no se mueve nunca. */
    #view-jefe-pista .jp-ordcard{display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;padding:12px;border-radius:10px;background:#15171c;border:1px solid #2a2e37;margin-bottom:8px}
    #view-jefe-pista .jp-ordinfo{flex:1 1 100%;min-width:0}
    #view-jefe-pista .jp-ordacts{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;justify-content:flex-end}
    /* Sin esto, "Editar con cliente" se parte letra por letra al angostarse */
    #view-jefe-pista .jp-b{white-space:nowrap}
    @media(max-width:760px){
      #view-jefe-pista .jp-ordacts{justify-content:stretch}
      #view-jefe-pista .jp-b{flex:1 1 auto;justify-content:center}
      #view-jefe-pista .jp-clock{width:100%;margin-right:0;text-align:center}
    }
    #view-jefe-pista .jp-empty{text-align:center;color:#8b8f98;padding:20px}
    /* margin-right:auto empuja los botones a la derecha y deja el reloj a la
       izquierda de su fila. tabular-nums ya estaba: los dígitos no cambian de ancho. */
    #view-jefe-pista .jp-clock{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums;margin-right:auto}`
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
  // Los técnicos van ANTES de pintar: jpCargar() dibuja los desplegables de
  // "Sin técnico asignado", y si la lista todavía no llegó, salen vacíos y ya
  // no se vuelven a pintar. Era eso, no la base: la consulta y los permisos
  // estaban bien todo el tiempo.
  await jpLoadTecnicos()
  await jpCargar()
  jpLoadCatalogo()
  jpStart()
}

async function jpLoadTecnicos() {
  try {
    const { data, error } = await jpSb().from('tecnicos_cat').select('id,nombre').order('usos', { ascending: false }).limit(500)
    // El error se capturaba en el catch de abajo pero nunca se mostraba, y una
    // lista vacía por RLS no da error: en los dos casos el desplegable quedaba
    // con solo "— ELEGÍ TÉCNICO —" y nadie sabía por qué no podía asignar.
    if (error) { window.toast?.('No se pudieron cargar los técnicos: ' + error.message, 'error'); return }
    if (!data || !data.length) {
      window.toast?.('No hay técnicos en el catálogo, o la tabla tecnicos_cat no tiene permiso de lectura. Avisale a gerencia.', 'error')
    }
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
  // El técnico se ELIGE de la lista, no se crea al vuelo. Crear técnicos desde acá
  // ensuciaba el catálogo con nombres cortos y duplicados ("DAG", "CAR") — y ahora que
  // la comisión depende de tecnico_id, un duplicado paga al técnico equivocado.
  if (!matches.length) html = `<div style="padding:9px 10px;font-size:12px;color:#8b8f98">Sin coincidencias. Los técnicos se crean en la pantalla de técnicos, no acá.</div>`
  drop.innerHTML = html
  drop.style.display = html ? 'block' : 'none'
}
window.jpTecPick = (t) => { const inp = document.getElementById('jp-tecnico'); if (inp) inp.value = t; jpTecHide() }
window.jpTecAgregarNuevo = async (t) => {
  // Desactivado: los técnicos ya no se crean desde el autocomplete (ensuciaba el catálogo).
  window.toast?.('Ese técnico no existe. Pedile a gerencia que lo dé de alta en el catálogo.', 'error')
  jpTecHide()
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
  // El técnico tiene que existir en el catálogo. Antes se creaba al vuelo cualquier texto
  // ("DAG"), lo que ensuciaba la tabla y, con la comisión, pagaba al técnico equivocado.
  if (!window._jpTecMap?.[tecnico.trim()]) {
    window.toast?.(`«${tecnico}» no está en el catálogo de técnicos. Elegilo de la lista, o pedí que lo den de alta.`, 'error')
    return
  }
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
    // (Ya no se crea el técnico al vuelo: se eligió de la lista o la validación lo bloqueó.)
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
  const opts = (jpTecnicos || []).length
    ? (jpTecnicos || []).map(t => `<option value="${jpEsc(t.id)}">${jpEsc(t.nombre)}</option>`).join('')
    : '<option value="" disabled>— no hay técnicos cargados —</option>'
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
window.jpCambiarTecnico = function (proformaId) {
  const p = (jpData || []).find(x => x.id === proformaId); if (!p) return
  const opts = (jpTecnicos || []).map(t =>
    `<option value="${jpEsc(t.id)}" ${t.id === p.tecnico_id ? 'selected' : ''}>${jpEsc(t.nombre)}</option>`).join('')

  let modal = document.getElementById('jp-cambtec-modal')
  if (!modal) { modal = document.createElement('div'); modal.id = 'jp-cambtec-modal'
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px'
    document.body.appendChild(modal) }
  modal.innerHTML = `
    <div style="background:#0d1117;border:1px solid #2a2e37;border-radius:14px;max-width:420px;width:100%;padding:20px">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">Cambiar técnico de inspección</div>
      <div style="font-size:12px;color:#8b949e;margin-bottom:14px">${jpEsc([p.marca,p.modelo].filter(Boolean).join(' '))} · orden #${jpEsc(p.numero_orden||'')}<br>Actual: <b>${jpEsc(p.mecanico||'—')}</b></div>
      <select id="asig-${p.id}" class="jp-inp" style="width:100%;margin-bottom:14px">${opts}</select>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button onclick="document.getElementById('jp-cambtec-modal').remove()" style="background:none;border:1px solid #3a3f4a;color:#8b949e;border-radius:8px;padding:8px 16px;cursor:pointer">Cancelar</button>
        <button onclick="jpAsignarTecnico('${p.id}').then(()=>document.getElementById('jp-cambtec-modal')?.remove())" style="background:#8b5cf6;border:0;color:#fff;border-radius:8px;padding:8px 18px;font-weight:600;cursor:pointer">Reasignar</button>
      </div>
    </div>`
}

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
    // Hay inspección a medias. Reasignar significa DESCARTAR lo que hizo el primero
    // (el segundo empieza limpio). Confirmar explícitamente — deja rastro y evita
    // transferir por error el trabajo (y la comisión) de un técnico a otro.
    const ok = confirm(
      `Esta orden ya tiene una inspección en proceso.\n\n` +
      `Reasignar a ${nombre} va a DESCARTAR lo que el técnico anterior haya inspeccionado, ` +
      `y ${nombre} empezará de cero.\n\n¿Continuar?`)
    if (!ok) return
    const { data, error } = await jpSb().rpc('checklist_reasignar_inspeccion', {
      p_proforma_id: proformaId, p_tecnico_id: tecId, p_nombre: nombre
    })
    if (error) { window.toast?.(error.message, 'error'); return }
    window.toast?.(`Reasignada a ${nombre} (inspección anterior descartada)`, 'success')
    jpCargar()
    return
  }

  // Sin inspección abierta: reasignación simple
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
  // Habilitar técnicos en la orden (Fase 2). Aparece cuando ya hay trabajo autorizado:
  // sin trabajo que ejecutar, no hay a quién asignar. La comisión de ejecución (80%)
  // sale de acá.
  // Editar con el cliente: el jefe de pista poda la cotización cara a cara. Aparece cuando
  // hay items cotizados y AÚN NO se autorizó (después ya no se toca). Solo QUITA (esconde),
  // agregar sigue siendo del cotizador.
  // Solo en la fase de AUTORIZACIÓN: ya hay cotización con precios (proc_inicio) y aún no
  // se autorizó. En 'Esperando cotización' no hay precios finales que presentar al cliente.
  const btnEdit = (f.fase === 'autorizacion' && Array.isArray(p.items) && p.items.length)
    ? `<button class="jp-b" style="border-color:#c8a24a;color:#c8a24a" onclick="jpEditarCliente('${p.id}')" title="Quitar ítems con el cliente al lado, antes de autorizar">✏️ Editar con cliente</button>` : ''
  // Cambiar el técnico que INSPECCIONA. Solo mientras se está cotizando (antes de que la
  // orden pase a autorización): si el asignado no vino, se le pasa a otro. Si ya empezó a
  // inspeccionar, reasignar descarta lo hecho (el segundo empieza limpio).
  const btnCambiarTec = (esRec && p.tecnico_id && f.fase === 'cotizacion')
    ? `<button class="jp-b" style="border-color:#8b5cf6;color:#8b5cf6" onclick="jpCambiarTecnico('${p.id}')" title="Pasar la inspección a otro técnico">👤 Cambiar técnico</button>` : ''
  const btnTec = (esRec && p.proc_aprobada)
    ? `<button class="jp-b" style="border-color:#8b5cf6;color:#8b5cf6" onclick="jpAbrirTecnicos('${jpEsc(p.numero_orden)}')" title="Habilitar los técnicos que trabajan esta orden">👷 Técnicos</button>` : ''
  const tipoBadge = `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;margin-left:6px;border:1px solid ${esRec ? '#f59e0b' : '#3b82f6'};color:${esRec ? '#f59e0b' : '#3b82f6'}">${esRec ? '💡 Recomendado' : '🔧 Solicitado'}</span>`
  // Borde izquierdo por fase (mismos colores del cotizador): rojo=cotización, amarillo=autorización, verde=pedido/completado
  const bCol = f.fase === 'cotizacion' ? '#f85149' : f.fase === 'autorizacion' ? '#f59e0b' : (f.fase === 'compra' || f.fase === 'completado') ? '#16a34a' : '#2a2e37'
  return `<div class="jp-ordcard" style="border-left:4px solid ${bCol}">
    <div class="jp-ordinfo">
      <div style="font-size:14px;font-weight:600">${jpEsc(veh)} · ${jpEsc(p.placa || 's/placa')} <span style="color:#8b8f98;font-weight:400;font-size:12px">${jpEsc(corre)} · ${nSol && nIt ? `${nSol} por cotizar · ${nIt} cotizado(s)` : (nIt && !nSol ? `${nIt} cotizado(s)` : `${nProd} ítem(s)`)}</span>${tipoBadge}</div>
      <div style="font-size:12px;color:${f.color};margin-top:2px">${f.lbl}${p.cliente ? ' · ' + jpEsc(p.cliente) : ''}</div>
    </div>
    <div class="jp-ordacts">
      ${reloj}
      ${btnCambiarTec}
      ${btnTec}
      ${btnEdit}
      ${btnWA}
      ${btnNV}
      ${btnPdf}
      ${btnAdd}
      ${btnAut}
    </div>
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

    const items = (pf.items || []).filter(it => it.hallazgo_linea_id && !it.oculto)
    if (!items.length) { window.toast?.('Esta proforma no tiene hallazgos cotizados', 'error'); return }

    const { data: insp } = await sb.from('checklist_inspecciones')
      .select('id,foto_desmontaje_del,foto_desmontaje_tra').eq('proforma_id', proformaId).single()

    const hIds = [...new Set(items.map(it => it.hallazgo_id).filter(Boolean))]
    const [rH, rP, rC] = await Promise.all([
      sb.from('checklist_hallazgos').select('id,punto_id,severidad,medicion,foto_url,medicion_estimada,nota').in('id', hIds),
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

    window.toast?.('Generando el PDF con fotos…')

    // Preparar cada grupo con su miniatura + textos, para el PDF
    let total = 0
    const gruposPDF = []
    for (const g of Object.values(grupos)) {
      const h = g.hallazgo, pt = g.punto
      let medicionTexto = ''
      if (h && h.medicion != null && !h.medicion_estimada) {
        const u = umbral(pt)
        medicionTexto = `Medición: ${h.medicion}${pt?.unidad_medicion || ''}${u ? ` (mínimo ${u}${pt.unidad_medicion || ''})` : ''}`
      }
      const fotoUrl = await firmar(h && h.foto_url)
      const mini = fotoUrl ? await jpImgAMiniatura(fotoUrl) : null
      gruposPDF.push({
        severidad: g.severidad, punto: pt, lineas: g.lineas, total: g.total,
        medicionTexto, nota: (h && h.nota && String(h.nota).trim()) || '', miniatura: mini
      })
      total += g.total
    }

    // Miniaturas de desmontaje
    const fdUrl = await firmar(insp?.foto_desmontaje_del)
    const ftUrl = await firmar(insp?.foto_desmontaje_tra)
    const desmontaje = {
      del: fdUrl ? await jpImgAMiniatura(fdUrl, 320) : null,
      tra: ftUrl ? await jpImgAMiniatura(ftUrl, 320) : null
    }

    // Construir y subir el PDF
    const blob = await jpConstruirPDF({
      nombre, veh, placa: pf.placa, numero_orden: pf.numero_orden,
      grupos: gruposPDF, desmontaje, total
    })
    const nombreArch = `orden-${pf.numero_orden || pf.id}-${Date.now()}.pdf`
    // Sin upsert: el nombre ya es único (Date.now), así que siempre es INSERT. El upsert
    // forzaba un UPDATE que la policy del bucket rechazaba (le falta with_check).
    const { error: eUp } = await sb.storage.from('cotizaciones-pdf').upload(nombreArch, blob, {
      contentType: 'application/pdf'
    })
    if (eUp) { window.toast?.('No se pudo subir el PDF: ' + eUp.message, 'error'); return }
    const { data: pub } = sb.storage.from('cotizaciones-pdf').getPublicUrl(nombreArch)
    const linkPDF = pub?.publicUrl || ''

    // Mensaje CORTO para WhatsApp: solo el link al PDF
    let msg = `${nombre ? nombre + ', a' : 'A'}quí está la revisión de su ${veh || 'vehículo'}${pf.placa ? ' ' + pf.placa : ''} (orden #${pf.numero_orden || '—'}).\n\n`
    msg += `Vea el detalle con fotos y precios aquí:\n${linkPDF}\n\n`
    msg += `TOTAL: L. ${fmt(total)}\n`
    msg += `Su carro está en el taller. Si autoriza, se lo entregamos hoy.`

    // Teléfono del cliente: lo capturó el cotizador y vive en clientes_contacto
    // (clave nombre+placa). Lo traemos para abrir el chat directo; si no está,
    // el modal deja escribirlo. Defensivo: si la tabla falta, seguimos sin número.
    let telCli = ''
    try {
      const nom = jpProvNorm(pf.cliente), pla = jpProvNorm(pf.placa)
      if (nom) {
        const { data: cc } = await sb.from('clientes_contacto')
          .select('telefono,placa_norm').eq('cliente_norm', nom)
        const filas = cc || []
        const exacta = filas.find(r => (r.placa_norm || '') === pla)
        if (exacta && exacta.telefono) telCli = exacta.telefono
        else { const conTel = filas.filter(r => r.telefono); if (conTel.length === 1) telCli = conTel[0].telefono }
      }
    } catch (e) { /* sin tabla o sin permiso: se abre el modal sin número */ }

    jpModalWA(msg, telCli)
  } catch (e) {
    console.error('[jpEnviarHallazgos]', e)
    window.toast?.('Error: ' + (e.message || e), 'error')
  }
}

function jpModalWA (msg, tel) {
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
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <label style="font-size:12px;color:#8b8f98;white-space:nowrap">📞 Teléfono</label>
        <input id="jp-wa-tel" placeholder="Ej: 9704 5242" value="${jpEsc(tel || '')}" autocomplete="off" style="flex:1;min-width:0;background:#0d1117;border:1px solid #2a2e37;border-radius:8px;color:#e6edf3;padding:8px 10px;font-size:13px">
      </div>
      <div id="jp-wa-telhint" style="font-size:11px;margin-bottom:8px;min-height:14px"></div>
      <textarea id="jp-wa-txt" style="width:100%;height:280px;background:#0d1117;border:1px solid #2a2e37;border-radius:8px;color:#e6edf3;padding:11px;font-size:13px;font-family:inherit;line-height:1.5">${jpEsc(msg)}</textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="jp-b" style="flex:1;padding:11px" onclick="jpCopiarWA()">📋 Copiar</button>
        <button class="jp-b green" style="flex:1;padding:11px" onclick="jpAbrirWA()">💬 Abrir WhatsApp</button>
      </div>
      <div style="font-size:11px;color:#8b8f98;margin-top:8px">Podés editar el mensaje y el teléfono antes de enviarlo. El PDF queda guardado y el link no vence.</div>
    </div>`
  document.body.appendChild(ov)
  // Pista viva: confirma a qué número abrirá, o avisa que se elegirá el contacto a mano.
  const inp = ov.querySelector('#jp-wa-tel'), hint = ov.querySelector('#jp-wa-telhint')
  const pintar = () => {
    const n = jpNormTel(inp.value)
    if (n.length >= 11) { hint.style.color = 'var(--green,#16a34a)'; hint.textContent = '✓ Abrirá el chat de +' + n }
    else if (inp.value.trim()) { hint.style.color = 'var(--amber,#f59e0b)'; hint.textContent = '⚠ Número incompleto — se abrirá WhatsApp para elegir el contacto' }
    else { hint.style.color = 'var(--text3,#8b949e)'; hint.textContent = 'Sin número: se abrirá WhatsApp para que elijas el contacto' }
  }
  inp.addEventListener('input', pintar); pintar()
}

window.jpCopiarWA = async function () {
  const t = document.getElementById('jp-wa-txt'); if (!t) return
  try { await navigator.clipboard.writeText(t.value); window.toast?.('Copiado', 'success') }
  catch (e) { t.select(); document.execCommand('copy'); window.toast?.('Copiado', 'success') }
}

window.jpAbrirWA = function () {
  const t = document.getElementById('jp-wa-txt'); if (!t) return
  const telInp = document.getElementById('jp-wa-tel')
  const num = telInp ? jpNormTel(telInp.value) : ''
  // Con número completo abre el chat directo; sin él, WhatsApp pide elegir contacto.
  const base = num.length >= 11 ? 'https://wa.me/' + num : 'https://wa.me/'
  window.open(base + '?text=' + encodeURIComponent(t.value), '_blank')
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
    .select('codigo,nombre').eq('activo', true).order('orden')
  if (error) { window.toast?.('No se pudieron cargar los motivos: ' + error.message, 'error'); return }
  // Lista vacía SIN error = RLS activo sin política de lectura. Supabase no
  // avisa nada: simplemente devuelve cero filas. Sin este chequeo, el modal se
  // abre mudo (solo Cancelar y Registrar) y el usuario no sabe qué pasó.
  if (!motivos || !motivos.length) {
    window.toast?.('No hay motivos configurados, o la tabla motivos_no_venta no tiene permiso de lectura. Avisale a gerencia.', 'error')
    return
  }

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
          <label style="display:flex;align-items:flex-start;gap:10px;padding:11px;border:1px solid #2a2e37;border-radius:8px;cursor:pointer;font-size:13px;line-height:1.35">
            <input type="radio" name="jp-nv-m" value="${jpEsc(m.codigo)}" style="width:18px;height:18px;flex:0 0 auto;margin-top:1px">
            <span style="flex:1;min-width:0;white-space:normal;word-break:break-word">${jpEsc(m.nombre)}</span>
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
/* ============================================================================
 * 👷 TÉCNICOS DE LA ORDEN — Fase 2, Etapa B
 *
 * El jefe de pista habilita los técnicos que trabajan la orden (Modelo B-acotado).
 * No reparte trabajo por trabajo: pone la lista, y cada técnico entra y toma lo que
 * hizo. Acá el jefe de pista ve quién tomó qué y puede corregir (el caso Alex→Josué).
 * ========================================================================== */
window.jpAbrirTecnicos = async function (numeroOrden) {
  const sb = jpSb()
  try {
    // Trabajos de la orden (líneas de hallazgo) + quién los tomó
    const { data: pf } = await sb.from('cotizador_proformas')
      .select('id').eq('numero_orden', numeroOrden).eq('tipo_solicitud', 'recomendado')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    let trabajos = []
    let tecnicoQueRevisó = null
    if (pf) {
      const { data: insp } = await sb.from('checklist_inspecciones')
        .select('id,mecanico_id').eq('proforma_id', pf.id).maybeSingle()
      if (insp) {
        // El que REVISÓ (encontró) es el mecanico_id de la inspección. Es un usuarios.id;
        // su tecnico_id es lo que se habilita. Se pone por default: casi siempre también
        // ejecuta algo, y si no aparece solo, hay que agregarlo a mano cada vez (y olvidarlo
        // significa que NO puede tomar los trabajos que sí hizo).
        if (insp.mecanico_id) {
          const { data: u } = await sb.from('usuarios').select('tecnico_id').eq('id', insp.mecanico_id).maybeSingle()
          tecnicoQueRevisó = u?.tecnico_id || null
        }
        const { data: halls } = await sb.from('checklist_hallazgos').select('id').eq('inspeccion_id', insp.id)
        const hIds = (halls || []).map(h => h.id)
        if (hIds.length) {
          const { data: lineas } = await sb.from('checklist_hallazgo_lineas')
            .select('id,descripcion,tipo,hallazgo_id').in('hallazgo_id', hIds)
          trabajos = lineas || []
        }
      }
    }

    // Estado actual: técnicos habilitados y trabajos tomados
    let { data: ot } = await sb.from('orden_tecnicos').select('*').eq('numero_orden', numeroOrden)

    // Auto-habilitar al que revisó — SOLO la primera vez (cuando no hay nadie habilitado
    // aún). Así aparece por default sin que lo agreguen, pero si el jefe de pista ya
    // trabajó esta orden y lo quitó a propósito, no reaparece: se respeta su decisión.
    const habCount = (ot || []).filter(x => x.hallazgo_linea_id === null && x.rol === 'ejecuta').length
    if (tecnicoQueRevisó && habCount === 0) {
      const { error: eHab } = await sb.rpc('orden_tecnico_habilitar', { p_numero_orden: numeroOrden, p_tecnico_id: tecnicoQueRevisó })
      if (!eHab) {
        const { data: ot2 } = await sb.from('orden_tecnicos').select('*').eq('numero_orden', numeroOrden)
        ot = ot2 || ot
      }
    }
    const habilitados = (ot || []).filter(x => x.hallazgo_linea_id === null && x.rol === 'ejecuta')
    const tomados = {}; for (const x of (ot || [])) if (x.hallazgo_linea_id) tomados[x.hallazgo_linea_id] = x

    jpModalTecnicos(numeroOrden, trabajos, habilitados, tomados)
  } catch (e) {
    console.error('[jpAbrirTecnicos]', e)
    window.toast?.('Error: ' + (e.message || e), 'error')
  }
}

function jpNombreTec (id) {
  const t = (jpTecnicos || []).find(x => x.id === id)
  return t ? t.nombre : '(técnico)'
}

function jpModalTecnicos (numeroOrden, trabajos, habilitados, tomados) {
  let ov = document.getElementById('jp-tec-modal')
  if (ov) ov.remove()
  ov = document.createElement('div')
  ov.id = 'jp-tec-modal'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:10002;display:flex;align-items:center;justify-content:center;padding:20px'
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove() })

  const idsHab = new Set(habilitados.map(h => h.tecnico_id))
  const opcionesTec = (jpTecnicos || []).filter(t => !idsHab.has(t.id))
    .map(t => `<option value="${jpEsc(t.id)}">${jpEsc(t.nombre)}</option>`).join('')

  const chipsHab = habilitados.length
    ? habilitados.map(h => `<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(139,92,246,.15);color:#8b5cf6;border-radius:14px;padding:3px 10px;font-size:12px;margin:2px">
        ${jpEsc(jpNombreTec(h.tecnico_id))}
        <button onclick="jpQuitarTecnico('${jpEsc(numeroOrden)}','${jpEsc(h.tecnico_id)}')" title="Quitar de la orden" style="background:none;border:0;color:#8b5cf6;cursor:pointer;font-size:14px;padding:0;line-height:1">×</button>
      </span>`).join('')
    : '<span style="color:#8b8f98;font-size:12px">Ningún técnico habilitado todavía.</span>'

  const filasTrabajo = trabajos.length
    ? trabajos.map(t => {
        const tom = tomados[t.id]
        const tag = t.tipo === 's' ? 'SERV' : 'PROD'
        const tagCol = t.tipo === 's' ? '#8b5cf6' : '#3b82f6'
        const estado = tom
          ? `<span style="color:#16a34a;font-weight:600">✓ ${jpEsc(jpNombreTec(tom.tecnico_id))}</span>
             <button onclick="jpReasignar('${jpEsc(t.id)}','${jpEsc(numeroOrden)}')" style="background:none;border:1px solid #2a2e37;color:#8b8f98;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;margin-left:6px">cambiar</button>`
          : '<span style="color:#8b8f98;font-size:12px">sin tomar</span>'
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #1c1f26">
          <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;background:${tagCol}22;color:${tagCol}">${tag}</span>
          <span style="flex:1;font-size:13px">${jpEsc(t.descripcion || '')}</span>
          ${estado}
        </div>`
      }).join('')
    : '<div style="color:#8b8f98;font-size:12px;padding:8px 0">Esta orden no tiene trabajos del checklist.</div>'

  ov.innerHTML = `
    <div style="background:#15171c;border:1px solid #2a2e37;border-radius:12px;max-width:600px;width:100%;padding:18px;color:#e6edf3;max-height:85vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <b style="font-size:15px">👷 Técnicos · Orden ${jpEsc(numeroOrden)}</b>
        <button onclick="document.getElementById('jp-tec-modal').remove()" style="background:none;border:0;color:#8b8f98;font-size:22px;cursor:pointer">×</button>
      </div>
      <div style="font-size:11px;color:#8b8f98;margin-bottom:14px">Habilitá los técnicos que trabajan esta orden. Cada uno entra y se asigna los trabajos que hizo. Vos podés corregir con «cambiar».</div>

      <div style="font-weight:700;font-size:12px;color:#8b5cf6;text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px">Técnicos habilitados</div>
      <div style="margin-bottom:8px">${chipsHab}</div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <select id="jp-tec-add-sel" class="jp-inp" style="flex:1">
          <option value="">— Agregar técnico a la orden —</option>${opcionesTec}
        </select>
        <button class="jp-b" style="border-color:#8b5cf6;color:#8b5cf6" onclick="jpHabilitarTecnico('${jpEsc(numeroOrden)}')">＋ Habilitar</button>
      </div>

      <div style="font-weight:700;font-size:12px;color:#8b8f98;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px">Trabajos de la orden</div>
      <div>${filasTrabajo}</div>
    </div>`
  document.body.appendChild(ov)
}

window.jpHabilitarTecnico = async function (numeroOrden) {
  const sel = document.getElementById('jp-tec-add-sel')
  const id = sel?.value
  if (!id) { window.toast?.('Elegí un técnico', 'error'); return }
  const { data, error } = await jpSb().rpc('orden_tecnico_habilitar', { p_numero_orden: numeroOrden, p_tecnico_id: id })
  if (error) { window.toast?.(error.message, 'error'); return }
  window.toast?.(`${data.tecnico} habilitado`, 'success')
  jpAbrirTecnicos(numeroOrden)   // recargar el modal
}

window.jpQuitarTecnico = async function (numeroOrden, tecnicoId) {
  // Quitar un técnico habilitado. Si tiene trabajos tomados, la base los suelta por CASCADE
  // del registro de habilitación NO — hay que soltar sus trabajos primero. Se avisa.
  if (!confirm('¿Quitar este técnico de la orden?\n\nSi ya tomó trabajos, esos trabajos quedan sin ejecutor y hay que reasignarlos.')) return
  const sb = jpSb()
  // Soltar sus trabajos tomados en esta orden
  await sb.from('orden_tecnicos').delete().eq('numero_orden', numeroOrden).eq('tecnico_id', tecnicoId)
  window.toast?.('Técnico quitado', 'success')
  jpAbrirTecnicos(numeroOrden)
}

window.jpReasignar = async function (hallazgoLineaId, numeroOrden) {
  // Reasignar un trabajo a otro técnico habilitado (el caso Alex→Josué).
  const { data: ot } = await jpSb().from('orden_tecnicos').select('tecnico_id')
    .eq('numero_orden', numeroOrden).is('hallazgo_linea_id', null).eq('rol', 'ejecuta')
  const habilitados = (ot || []).map(x => x.tecnico_id)
  if (!habilitados.length) { window.toast?.('No hay técnicos habilitados en esta orden', 'error'); return }

  const opciones = habilitados.map((id, i) => `${i + 1}. ${jpNombreTec(id)}`).join('\n')
  const elec = prompt(`¿Quién ejecutó este trabajo?\n\n${opciones}\n\n(escribí el número, o 0 para liberar)`)
  if (elec === null) return
  const n = parseInt(elec, 10)
  const nuevo = n === 0 ? null : habilitados[n - 1]
  if (n !== 0 && !nuevo) { window.toast?.('Opción inválida', 'error'); return }

  const { error } = await jpSb().rpc('orden_trabajo_reasignar', {
    p_hallazgo_linea_id: hallazgoLineaId, p_nuevo_tecnico: nuevo
  })
  if (error) { window.toast?.(error.message, 'error'); return }
  window.toast?.(nuevo ? 'Reasignado' : 'Liberado', 'success')
  jpAbrirTecnicos(numeroOrden)
}

// ============================================================================
// PDF de cotización para el cliente (Fase: presentación profesional)
// Genera un PDF con miniaturas de fotos + detalle, lo sube a Storage, y devuelve
// el link público. El mensaje de WhatsApp queda corto: solo el link.
// ============================================================================

// Descarga una imagen (URL firmada) y la devuelve como dataURL base64, redimensionada
// a miniatura. jsPDF necesita base64, no puede embeber por URL.
async function jpImgAMiniatura (url, maxW = 220) {
  if (!url) return null
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    const bmp = await createImageBitmap(blob)
    const escala = Math.min(1, maxW / bmp.width)
    const w = Math.round(bmp.width * escala), h = Math.round(bmp.height * escala)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.7), w, h }
  } catch (e) { console.warn('miniatura falló', e); return null }
}

// Carga jsPDF del CDN si no está (el archivo local js/jspdf.min.js da 404).
// Mismo método que usa el cotizador, que sí funciona.
function jpLoadScript (src) {
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script'); sc.src = src
    sc.onload = resolve; sc.onerror = () => reject(new Error('No se pudo cargar ' + src))
    document.head.appendChild(sc)
  })
}
async function jpEnsureJsPDF () {
  if (window.jspdf && window.jspdf.jsPDF) return
  await jpLoadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
}

// Construye el PDF con jsPDF y lo devuelve como Blob.
async function jpConstruirPDF (datos) {
  await jpEnsureJsPDF()
  const { jsPDF } = window.jspdf || {}
  if (!jsPDF) throw new Error('jsPDF no está cargado')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, M = 15
  let y = M

  const fmt = v => 'L. ' + Number(v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // — Encabezado —
  doc.setFillColor(20, 22, 28); doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(200, 162, 74); doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
  doc.text('TECNIMAX', M, 14)
  doc.setTextColor(230, 237, 243); doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  doc.text('Revisión de su vehículo', M, 21)
  doc.setFontSize(9); doc.setTextColor(139, 148, 158)
  doc.text('Orden #' + (datos.numero_orden || '—'), W - M, 14, { align: 'right' })
  doc.text(new Date().toLocaleDateString('es-HN'), W - M, 20, { align: 'right' })
  y = 38

  // — Datos del vehículo —
  doc.setTextColor(20, 22, 28); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text(datos.nombre || 'Cliente', M, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(80, 80, 80)
  doc.text([datos.veh, datos.placa].filter(Boolean).join('  ·  '), M, y); y += 8
  doc.setDrawColor(220, 220, 220); doc.line(M, y, W - M, y); y += 6

  // — Grupos por severidad —
  const nuevaPaginaSiHaceFalta = (alto) => {
    if (y + alto > 280) { doc.addPage(); y = M }
  }

  for (const sev of ['rojo', 'amarillo']) {
    const gs = datos.grupos.filter(g => g.severidad === sev)
    if (!gs.length) continue
    nuevaPaginaSiHaceFalta(14)
    // Título de sección
    if (sev === 'rojo') { doc.setTextColor(200, 30, 30); doc.text('■ URGENTE', M, y) }
    else { doc.setTextColor(200, 150, 0); doc.text('■ RECOMENDADO', M, y) }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
    y += 7

    for (const g of gs) {
      nuevaPaginaSiHaceFalta(30)
      const yInicio = y
      const tieneFoto = !!g.miniatura
      const textoX = tieneFoto ? M + 42 : M
      const textoW = tieneFoto ? (W - M - 42 - M) : (W - 2 * M)

      // Miniatura a la izquierda
      if (tieneFoto) {
        const mw = 38, mh = Math.min(30, mw * g.miniatura.h / g.miniatura.w)
        try { doc.addImage(g.miniatura.dataUrl, 'JPEG', M, y, mw, mh) } catch (e) {}
      }

      // Nombre del punto
      doc.setTextColor(20, 22, 28); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
      let ty = y + 4
      const titulo = g.punto ? g.punto.nombre : (g.lineas[0] || '')
      doc.text(titulo, textoX, ty); ty += 5

      // Medición (si es real)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90)
      if (g.medicionTexto) { doc.text(g.medicionTexto, textoX, ty); ty += 4.5 }
      // Nota del técnico
      if (g.nota) {
        const notaLineas = doc.splitTextToSize('« ' + g.nota + ' »', textoW)
        doc.text(notaLineas, textoX, ty); ty += notaLineas.length * 4
      }
      // Detalle de líneas + precio
      doc.setTextColor(20, 22, 28); doc.setFontSize(9.5)
      const detLineas = doc.splitTextToSize(g.lineas.join(' + '), textoW - 32)
      doc.text(detLineas, textoX, ty)
      doc.setFont('helvetica', 'bold')
      doc.text(fmt(g.total), W - M, ty, { align: 'right' })
      ty += detLineas.length * 4.5

      y = Math.max(ty, yInicio + (tieneFoto ? 32 : 0)) + 5
      doc.setDrawColor(235, 235, 235); doc.line(M, y - 2, W - M, y - 2)
    }
    y += 3
  }

  // — Fotos de desmontaje (si hay) —
  if (datos.desmontaje?.del || datos.desmontaje?.tra) {
    nuevaPaginaSiHaceFalta(50)
    doc.setTextColor(20, 22, 28); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text('Desmontamos las ruedas para medir sus frenos:', M, y); y += 6
    let fx = M
    for (const [lbl, mini] of [['Delantera', datos.desmontaje.del], ['Trasera', datos.desmontaje.tra]]) {
      if (mini) {
        const mw = 55, mh = Math.min(42, mw * mini.h / mini.w)
        try { doc.addImage(mini.dataUrl, 'JPEG', fx, y, mw, mh) } catch (e) {}
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90, 90, 90)
        doc.text(lbl, fx, y + mh + 4)
        fx += mw + 10
      }
    }
    y += 50
  }

  // — Total —
  nuevaPaginaSiHaceFalta(20)
  doc.setFillColor(20, 22, 28); doc.rect(M, y, W - 2 * M, 14, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text('TOTAL', M + 5, y + 9)
  doc.setTextColor(200, 162, 74); doc.setFontSize(14)
  doc.text(fmt(datos.total), W - M - 5, y + 9, { align: 'right' })
  y += 20

  // — Pie —
  doc.setTextColor(90, 90, 90); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text('Su carro está en el taller. Si autoriza, se lo entregamos hoy.', M, y)

  return doc.output('blob')
}

// ============================================================================
// Editar con el cliente: el jefe de pista poda la cotización en vivo.
// Quita (esconde con flag 'oculto') ítems que el cliente rechaza; puede regresarlos.
// Agregar sigue siendo del cotizador. Al guardar, recalcula el total y deja la orden
// lista para generar PDF y autorizar.
// ============================================================================
let _jpEditPF = null   // proforma en edición (copia de trabajo)

window.jpEditarCliente = async function (proformaId) {
  const sb = jpSb()
  const { data: pf, error } = await sb.from('cotizador_proformas')
    .select('id,correlativo,numero_orden,cliente,placa,marca,modelo,items,estado').eq('id', proformaId).single()
  if (error) { window.toast?.(error.message, 'error'); return }
  _jpEditPF = pf
  jpRenderEditModal()
}

function jpRenderEditModal () {
  const pf = _jpEditPF
  const items = Array.isArray(pf.items) ? pf.items : []
  const fmt = v => 'L. ' + Number(v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })

  // Total solo de lo NO oculto
  const total = items.filter(it => !it.oculto).reduce((sm, it) => {
    const precio = Number(it.precio || 0), cant = Number(it.cantidad || 1), isv = Number(it.isv || 0)
    return sm + precio * cant * (1 + isv / 100)
  }, 0)

  const fila = (it, i) => {
    const precio = Number(it.precio || 0), cant = Number(it.cantidad || 1)
    const oculto = !!it.oculto
    const tag = it.tipo === 's' ? 'MO' : 'Pieza'
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid #1c1f26;${oculto ? 'opacity:.45' : ''}">
      <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;background:rgba(139,92,246,.15);color:#8b5cf6">${tag}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;${oculto ? 'text-decoration:line-through' : ''}">${jpEsc(it.desc || '')}</div>
        <div style="font-size:11px;color:#6b7280">${cant} × ${fmt(precio)}</div>
      </div>
      ${oculto
        ? `<button onclick="jpEditToggle(${i})" style="background:none;border:1px solid #16a34a;color:#16a34a;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">↩ Regresar</button>`
        : `<button onclick="jpEditToggle(${i})" style="background:none;border:1px solid #f85149;color:#f85149;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">✕ Quitar</button>`}
    </div>`
  }

  let modal = document.getElementById('jp-edit-modal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'jp-edit-modal'
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px'
    document.body.appendChild(modal)
  }
  modal.innerHTML = `
    <div style="background:#0d1117;border:1px solid #2a2e37;border-radius:14px;max-width:520px;width:100%;max-height:85vh;display:flex;flex-direction:column">
      <div style="padding:16px 18px;border-bottom:1px solid #2a2e37">
        <div style="font-size:15px;font-weight:700">Editar con el cliente</div>
        <div style="font-size:12px;color:#8b949e">${jpEsc([pf.marca, pf.modelo].filter(Boolean).join(' '))} · ${jpEsc(pf.placa || '')} · orden #${jpEsc(pf.numero_orden || '')}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px">Quitá lo que el cliente rechace. Podés regresarlo si cambia de opinión.</div>
      </div>
      <div style="flex:1;overflow:auto;padding:6px 16px">
        ${items.length ? items.map(fila).join('') : '<div style="padding:20px;text-align:center;color:#8b949e">Sin ítems.</div>'}
      </div>
      <div style="padding:14px 18px;border-top:1px solid #2a2e37;display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div style="font-size:11px;color:#8b949e">TOTAL con lo aceptado</div>
          <div style="font-size:20px;font-weight:800;color:#16a34a">${fmt(total)}</div>
        </div>
        <button onclick="jpEditCancelar()" style="background:none;border:1px solid #3a3f4a;color:#8b949e;border-radius:8px;padding:9px 16px;cursor:pointer">Cancelar</button>
        <button onclick="jpEditGuardar()" style="background:#16a34a;border:0;color:#fff;border-radius:8px;padding:9px 18px;font-weight:600;cursor:pointer">Guardar y generar PDF</button>
      </div>
    </div>`
}

// Esconder/regresar un ítem (toggle del flag oculto), en la copia de trabajo
window.jpEditToggle = function (i) {
  const it = _jpEditPF.items[i]; if (!it) return
  it.oculto = !it.oculto
  jpRenderEditModal()
}

window.jpEditCancelar = function () {
  _jpEditPF = null
  document.getElementById('jp-edit-modal')?.remove()
}

window.jpEditGuardar = async function () {
  const sb = jpSb(); const pf = _jpEditPF
  // Recalcular total de lo NO oculto
  const total = (pf.items || []).filter(it => !it.oculto).reduce((sm, it) =>
    sm + Number(it.precio || 0) * Number(it.cantidad || 1) * (1 + Number(it.isv || 0) / 100), 0)

  const { error } = await sb.from('cotizador_proformas')
    .update({ items: pf.items, total }).eq('id', pf.id)
  if (error) { window.toast?.(error.message, 'error'); return }

  window.toast?.('Cotización actualizada', 'success')
  document.getElementById('jp-edit-modal')?.remove()
  // Generar el PDF con lo acordado
  if (window.jpEnviarHallazgos) await window.jpEnviarHallazgos(pf.id)
  _jpEditPF = null
  if (window.initJefePista) initJefePista()
}