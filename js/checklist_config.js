/* ============================================================================
 * CONTAMAX · checklist_config.js   ·   build 20260714a
 *
 * CONFIGURAR CHECKLIST — solo super_admin.
 *
 * El checklist es un ser vivo. Viene invierno → se agrega "limpiaparabrisas".
 * Viene feriado → "herramientas y llanta de repuesto". Pasa la temporada → se apagan.
 * Esta pantalla deja hacer todo eso sin tocar SQL.
 *
 * Tres candados que evitan que un error cueste plata:
 *   1. No se puede marcar "paga comisión" si una línea de venta no tiene precio.
 *   2. Los informativos exigen nota (es donde el técnico dice QUÉ falta).
 *   3. Desactivar un punto NO borra sus hallazgos: solo deja de aparecer en
 *      inspecciones NUEVAS. Las en curso lo conservan.
 *
 * Todo cambio va por RPC (checklist_punto_editar / _crear): valida en el SERVIDOR.
 * Si la validación viviera en este JS, un fetch la saltaría.
 * ========================================================================== */
window.__chkCfgBuild = '20260722a'

;(function () {
  const sb = () => window._sb
  const esc = t => String(t ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
  const fmt = v => v == null ? '—' : Number(v).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const toast = (m, t) => window.toast?.(m, t)

  let PUNTOS = []
  let LINEAS = {}   // punto_id → [líneas de venta]
  let TASAS = {}

  const SISTEMAS = ['FRENOS', 'SUSPENSION', 'MOTOR', 'ELECTRICO', 'REFRIGERACION', 'LLANTAS', 'INFORMATIVO']
  const TIPOS = [
    ['medicion', 'Medición (número + umbral)'],
    ['si_no', 'Sí / No (🟢🟡🔴)'],
    ['informativo', 'Informativo (reporta y abre venta)']
  ]

  const esSuper = () => {
    const p = (window._currentProfile ? window._currentProfile() : null) || {}
    return (p._rolReal || p.rol) === 'super_admin'
  }

  window.initChecklistConfig = async function () {
    const root = document.getElementById('view-checklist-config')
    if (!root) return
    if (!esSuper()) { root.innerHTML = '<div style="padding:24px;color:#f85149">Solo super_admin puede configurar el checklist.</div>'; return }
    root.innerHTML = '<div style="padding:24px;color:#8b949e">Cargando…</div>'
    try {
      const [rp, rl, rt] = await Promise.all([
        sb().from('checklist_puntos').select('*').order('orden'),
        sb().from('checklist_punto_lineas').select('*'),
        sb().from('comision_tasas').select('codigo,pct')
      ])
      if (rp.error) throw rp.error
      PUNTOS = rp.data || []
      LINEAS = {}
      for (const l of (rl.data || [])) (LINEAS[l.punto_id] = LINEAS[l.punto_id] || []).push(l)
      TASAS = {}; for (const t of (rt.data || [])) TASAS[t.codigo] = Number(t.pct)
      // Traer nombres de productos/servicios para mostrar qué vende cada línea
      await cargarNombres()
      render()
    } catch (e) {
      root.innerHTML = `<div style="padding:24px;color:#f85149">Error: ${esc(e.message || e)}</div>`
    }
  }

  let NOMB = { p: {}, s: {} }
  async function cargarNombres () {
    const [rp, rs] = await Promise.all([
      sb().from('productos_cat').select('id,nombre,precio_base'),
      sb().from('servicios_cat').select('id,nombre,precio_base,comision_codigo')
    ])
    NOMB = { p: {}, s: {} }
    for (const x of (rp.data || [])) NOMB.p[x.id] = x
    for (const x of (rs.data || [])) NOMB.s[x.id] = x
  }

  function render () {
    const root = document.getElementById('view-checklist-config')
    root.innerHTML = `
      <div style="background:rgba(200,162,74,.08);border-left:3px solid #c8a24a;padding:11px 14px;margin-bottom:14px;font-size:12px;color:#8b949e">
        El checklist es un ser vivo: agregá puntos por temporada y apagalos cuando pase.
        <b style="color:#e6edf3">Desactivar un punto no borra nada</b> — solo deja de aparecer en inspecciones nuevas.
        Un punto que paga comisión no puede quedar sin precio (la base lo impide).
      </div>

      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <button class="btn btn-gold" onclick="chkCfgNuevo()">＋ Agregar punto nuevo</button>
      </div>

      <div id="chk-lista-puntos">${PUNTOS.map(tarjeta).join('')}</div>`
  }

  function tarjeta (p) {
    const lineas = LINEAS[p.id] || []
    const sinPrecio = lineas.some(l => {
      const cat = l.tipo === 'p' ? NOMB.p[l.producto_cat_id] : NOMB.s[l.servicio_cat_id]
      return !cat || cat.precio_base == null
    })
    // Los umbrales hacen falta si el punto mide por tipo O por 'medición siempre'
    const mide = p.tipo_punto === 'medicion' || !!p.medicion_siempre
    return `
      <div id="chk-punto-${p.id}" data-pid="${p.id}" style="background:#15171c;border:1px solid ${p.activo ? '#2a2e37' : '#4a2a2a'};border-radius:12px;padding:14px;margin-bottom:12px;${p.activo ? '' : 'opacity:.7'}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span class="chk-grip" data-grip="${p.id}" title="Arrastrá para reordenar" style="cursor:grab;touch-action:none;user-select:none;color:#6b7280;font-size:17px;line-height:1;padding:2px 2px">⠿</span>
          <span style="display:inline-flex;flex-direction:column;gap:1px">
            <button onclick="chkMover(${p.id},'arriba')" title="Subir" style="background:none;border:0;color:#8b949e;cursor:pointer;font-size:11px;line-height:1;padding:0">▲</button>
            <button onclick="chkMover(${p.id},'abajo')" title="Bajar" style="background:none;border:0;color:#8b949e;cursor:pointer;font-size:11px;line-height:1;padding:0">▼</button>
          </span>
          <span style="font-size:11px;color:#6b7280;min-width:24px">#${p.orden}</span>
          <input value="${esc(p.nombre)}" onchange="chkCfgEdit(${p.id},'nombre',this.value)"
                 style="flex:1;font-weight:600;background:#0d1117;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:6px 9px;font-size:14px">
          <label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:${p.activo ? '#16a34a' : '#f85149'};cursor:pointer">
            <input type="checkbox" ${p.activo ? 'checked' : ''} onchange="chkCfgEdit(${p.id},'activo',this.checked)"> ${p.activo ? 'activo' : 'apagado'}
          </label>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;font-size:12px">
          <label style="color:#8b949e">Tipo
            <select onchange="chkCfgEdit(${p.id},'tipo_punto',this.value)" style="background:#0d1117;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:4px 6px;margin-left:4px">
              ${TIPOS.map(([v, l]) => `<option value="${v}" ${p.tipo_punto === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <label style="color:#8b949e">Sistema
            <select onchange="chkCfgEdit(${p.id},'sistema',this.value)" style="background:#0d1117;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:4px 6px;margin-left:4px">
              ${SISTEMAS.map(sis => `<option value="${sis}" ${p.sistema === sis ? 'selected' : ''}>${sis}</option>`).join('')}
            </select>
          </label>
        </div>

        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:${mide ? '10' : '2'}px;font-size:12px">
          <label style="cursor:pointer"><input type="checkbox" ${p.foto_obligatoria ? 'checked' : ''} onchange="chkCfgEdit(${p.id},'foto_obligatoria',this.checked)"> 📷 Foto obligatoria</label>
          <label style="cursor:pointer"><input type="checkbox" ${p.pide_medicion ? 'checked' : ''} onchange="chkCfgEdit(${p.id},'pide_medicion',this.checked)"> 📏 Pide medición</label>
          <label style="cursor:pointer;color:${p.medicion_siempre ? '#f0a500' : '#e6edf3'}" title="Pide el número SIEMPRE, aunque el punto salga en verde y aunque 'Pide medición' esté apagado. Se usa en frenos: el técnico ya desmontó la rueda y tiene el dato en la mano. Construye el historial de desgaste por placa.">
            <input type="checkbox" ${p.medicion_siempre ? 'checked' : ''} onchange="chkCfgEdit(${p.id},'medicion_siempre',this.checked)"> 📐 Medición siempre${p.medicion_siempre ? ' ⚠' : ''}
          </label>
          <label style="cursor:pointer"><input type="checkbox" ${p.nota_obligatoria ? 'checked' : ''} onchange="chkCfgEdit(${p.id},'nota_obligatoria',this.checked)"> 📝 Nota obligatoria</label>
          <label style="cursor:pointer;color:${sinPrecio ? '#f85149' : '#e6edf3'}" title="${sinPrecio ? 'Hay líneas de venta sin precio: la base no dejará activar comisión' : ''}">
            <input type="checkbox" ${p.paga_comision ? 'checked' : ''} onchange="chkCfgEdit(${p.id},'paga_comision',this.checked)"> 💰 Paga comisión${sinPrecio ? ' 🔒' : ''}
          </label>
        </div>

        ${(p.medicion_siempre && !p.pide_medicion) ? `
        <div style="font-size:11.5px;color:#f0a500;margin:-4px 0 8px">
          ⚠ Aunque «Pide medición» esté apagado, este punto <b>sigue pidiendo el número</b> por «Medición siempre».
        </div>` : ''}

        ${mide ? `
        <div style="display:flex;gap:10px;align-items:center;font-size:12px;color:#8b949e;margin-bottom:10px">
          <span>Umbrales:</span>
          🟡 &lt;<input type="number" step="0.1" value="${p.umbral_amarillo ?? ''}" onchange="chkCfgEdit(${p.id},'umbral_amarillo',this.value)" style="width:60px;background:#0d1117;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:4px 6px">
          🔴 &lt;<input type="number" step="0.1" value="${p.umbral_rojo ?? ''}" onchange="chkCfgEdit(${p.id},'umbral_rojo',this.value)" style="width:60px;background:#0d1117;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:4px 6px">
          <input value="${esc(p.unidad_medicion || 'mm')}" onchange="chkCfgEdit(${p.id},'unidad_medicion',this.value)" style="width:44px;background:#0d1117;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:4px 6px" title="unidad">
        </div>` : ''}

        <div style="border-top:1px solid #2a2e37;padding-top:9px">
          <div style="font-size:11px;color:#8b949e;margin-bottom:5px">QUÉ VENDE cuando sale 🟡 / 🔴:</div>
          ${lineas.length ? lineas.map(lineaRow).join('') : '<div style="font-size:11px;color:#6b7280;font-style:italic">Ninguna línea de venta. Este punto es solo informativo mientras no tenga qué vender.</div>'}
          <div id="chk-add-linea-${p.id}" style="margin-top:6px"></div>
          <button onclick="chkLineaFormAbrir(${p.id})" style="margin-top:4px;font-size:11px;background:none;border:1px dashed #3a3f4a;color:#8b949e;border-radius:6px;padding:4px 10px;cursor:pointer">+ Agregar línea de venta</button>
        </div>
      </div>`
  }

  function lineaRow (l) {
    const cat = l.tipo === 'p' ? NOMB.p[l.producto_cat_id] : NOMB.s[l.servicio_cat_id]
    const nombre = cat ? cat.nombre : '(no encontrado)'
    const precio = cat ? cat.precio_base : null
    const cod = (l.tipo === 's' && cat) ? cat.comision_codigo : null
    const pct = cod ? (TASAS[cod] ?? null) : (l.tipo === 'p' ? 3 : null)
    const sev = l.severidad === 'rojo' ? '🔴' : (l.severidad === 'amarillo' ? '🟡' : '')
    return `<div style="display:flex;gap:8px;align-items:center;font-size:12px;padding:3px 0">
      <span>${sev}</span>
      <span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:6px;background:${l.tipo === 's' ? 'rgba(139,92,246,.18)' : 'rgba(59,130,246,.18)'};color:${l.tipo === 's' ? '#8b5cf6' : '#3b82f6'}">${l.tipo === 's' ? 'SERV' : 'PROD'}</span>
      <span style="flex:1">${esc(nombre)} <span style="color:#6b7280">×${fmt(l.cantidad_default)}</span></span>
      <span style="color:${precio == null ? '#f85149' : '#8b949e'}">${precio == null ? 'SIN PRECIO' : 'L.' + fmt(precio)}</span>
      ${cod ? `<span style="color:#c8a24a">cód ${cod}</span>` : ''}
      ${pct != null ? `<span style="color:#16a34a">${pct}%</span>` : ''}
      <button onclick="chkLineaQuitar(${l.id})" title="Quitar esta línea" style="background:none;border:0;color:#f85149;cursor:pointer;font-size:14px;padding:0 4px">✕</button>
    </div>`
  }

  // ── Editor de líneas de venta: abrir el formulario de agregar ──
  window.chkMover = async function (id, direccion) {
    // Intercambio local ANTES de llamar a la base: la pantalla responde al instante,
    // sin flashear. El RPC solo persiste; si falla, revertimos.
    const i = PUNTOS.findIndex(x => x.id === id)
    if (i < 0) return
    const j = direccion === 'arriba' ? i - 1 : i + 1
    if (j < 0 || j >= PUNTOS.length) return   // ya está en el extremo

    // Intercambiar en el array y sus números de orden
    const a = PUNTOS[i], b = PUNTOS[j]
    const oa = a.orden; a.orden = b.orden; b.orden = oa
    PUNTOS[i] = b; PUNTOS[j] = a

    // Repintar SOLO la lista (no toda la pantalla)
    const cont = document.getElementById('chk-lista-puntos')
    if (cont) cont.innerHTML = PUNTOS.map(tarjeta).join('')

    // Persistir en la base. Si falla, recargar para volver al estado real.
    const { data, error } = await sb().rpc('checklist_punto_mover', { p_id: id, p_direccion: direccion })
    if (error || (data && data.ok === false)) {
      toast((error && error.message) || (data && data.mensaje) || 'No se pudo mover', 'error')
      initChecklistConfig()
    }
  }

  window.chkLineaFormAbrir = function (puntoId) {
    const cont = document.getElementById('chk-add-linea-' + puntoId)
    if (!cont) return
    if (cont.innerHTML) { cont.innerHTML = ''; return }   // toggle

    // Opciones de servicios y productos del catálogo (ordenados por nombre)
    const opts = (obj) => Object.values(obj)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
      .map(x => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')

    cont.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px;background:#0d1117;border:1px solid #2a2e37;border-radius:8px">
        <select id="nl-sev-${puntoId}" style="background:#161b22;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:5px">
          <option value="amarillo">🟡 Recomendado</option>
          <option value="rojo">🔴 Urgente</option>
        </select>
        <select id="nl-tipo-${puntoId}" onchange="chkLineaTipoCambio(${puntoId})" style="background:#161b22;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:5px">
          <option value="s">Servicio</option>
          <option value="p">Producto</option>
        </select>
        <select id="nl-cat-${puntoId}" style="flex:1;min-width:180px;background:#161b22;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:5px">
          ${opts(NOMB.s)}
        </select>
        <input id="nl-cant-${puntoId}" type="number" step="0.1" min="0.1" value="1" title="cantidad" style="width:60px;background:#161b22;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:5px">
        <button onclick="chkLineaGuardar(${puntoId})" style="background:#16a34a;border:0;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px">Agregar</button>
      </div>`
  }

  // Cambiar el selector de catálogo según tipo (servicio vs producto)
  window.chkLineaTipoCambio = function (puntoId) {
    const tipo = document.getElementById('nl-tipo-' + puntoId).value
    const sel = document.getElementById('nl-cat-' + puntoId)
    const obj = tipo === 'p' ? NOMB.p : NOMB.s
    sel.innerHTML = Object.values(obj)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
      .map(x => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')
  }

  // Refresca las líneas de venta de UN solo punto y repinta SOLO su tarjeta.
  // Así agregar/quitar una línea no reconstruye toda la pantalla (que mandaba
  // el scroll arriba). Mismo espíritu que chkMover: tocar lo mínimo.
  async function refrescarLineasPunto (puntoId) {
    const { data, error } = await sb().from('checklist_punto_lineas').select('*').eq('punto_id', puntoId)
    if (error) { toast(error.message, 'error'); initChecklistConfig(); return }
    LINEAS[puntoId] = data || []
    const p = PUNTOS.find(x => x.id === puntoId)
    const card = document.getElementById('chk-punto-' + puntoId)
    if (p && card) card.outerHTML = tarjeta(p)
    else initChecklistConfig()   // fallback si no ubicamos la tarjeta
  }

  window.chkLineaGuardar = async function (puntoId) {
    const sev = document.getElementById('nl-sev-' + puntoId).value
    const tipo = document.getElementById('nl-tipo-' + puntoId).value
    const catId = document.getElementById('nl-cat-' + puntoId).value
    const cant = parseFloat(document.getElementById('nl-cant-' + puntoId).value) || 1
    const { error } = await sb().rpc('checklist_linea_agregar', {
      p_punto_id: puntoId, p_severidad: sev, p_tipo: tipo, p_cat_id: catId, p_cantidad: cant
    })
    if (error) { toast(error.message, 'error'); return }
    toast('Línea agregada', 'success')
    await refrescarLineasPunto(puntoId)
  }

  window.chkLineaQuitar = async function (id) {
    if (!confirm('¿Quitar esta línea de venta? Solo afecta órdenes nuevas.')) return
    // Ubicar a qué punto pertenece ANTES de quitarla, para repintar solo esa tarjeta.
    let puntoId = null
    for (const pid in LINEAS) { const hit = (LINEAS[pid] || []).find(l => l.id === id); if (hit) { puntoId = hit.punto_id; break } }
    const { error } = await sb().rpc('checklist_linea_quitar', { p_id: id })
    if (error) { toast(error.message, 'error'); return }
    toast('Línea quitada', 'success')
    if (puntoId != null) await refrescarLineasPunto(puntoId)
    else initChecklistConfig()
  }

  // Re-baja UN punto y repinta SOLO su tarjeta. Refleja el estado real guardado
  // (candados de comisión, umbrales al cambiar tipo) sin recargar toda la pantalla.
  async function refrescarPunto (id) {
    const { data, error } = await sb().from('checklist_puntos').select('*').eq('id', id).single()
    if (error) { toast(error.message, 'error'); initChecklistConfig(); return }
    const i = PUNTOS.findIndex(x => x.id === id)
    if (i >= 0) PUNTOS[i] = data
    const card = document.getElementById('chk-punto-' + id)
    if (i >= 0 && card) card.outerHTML = tarjeta(data)
    else initChecklistConfig()
  }

  window.chkCfgEdit = async function (id, campo, valor) {
    const { error } = await sb().rpc('checklist_punto_editar', {
      p_id: id, p_campo: campo, p_valor: String(valor)
    })
    if (error) { toast(error.message, 'error'); initChecklistConfig(); return }
    toast('Guardado', 'success')
    // Repinta solo esa tarjeta: refleja candados y dependencias (ej. tipo → umbrales)
    // sin mandar el scroll arriba.
    await refrescarPunto(id)
  }

  window.chkCfgNuevo = async function () {
    const nombre = prompt('Nombre del punto nuevo:\n(ej. "Limpiaparabrisas y plumillas")')
    if (!nombre || !nombre.trim()) return
    const codigo = 'CHK_' + nombre.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '_').slice(0, 20)
    const sistema = prompt(`Sistema:\n${SISTEMAS.join(' · ')}`, 'ELECTRICO')
    if (!sistema || !SISTEMAS.includes(sistema.toUpperCase())) { toast('Sistema inválido', 'error'); return }
    const tipo = prompt('Tipo:\nmedicion · si_no · informativo', 'si_no')
    if (!['medicion', 'si_no', 'informativo'].includes(tipo)) { toast('Tipo inválido', 'error'); return }

    const { data, error } = await sb().rpc('checklist_punto_crear', {
      p_codigo: codigo, p_nombre: nombre.trim(), p_sistema: sistema.toUpperCase(), p_tipo: tipo
    })
    if (error) { toast(error.message, 'error'); return }
    toast(data.aviso || 'Punto creado', 'success')
    initChecklistConfig()
  }
  // ══════════════════════════════════════════════════════════════════════════
  //  ARRASTRAR Y SOLTAR para reordenar (agarrás el ⠿, la llevás y la soltás).
  //  Con auto-scroll en los bordes: podés traer una tarjeta del fondo hasta
  //  arriba sin soltarla. Un solo guardado al soltar (checklist_punto_reordenar).
  //  Las flechas ▲▼ siguen para ajuste fino de un paso.
  // ══════════════════════════════════════════════════════════════════════════
  let DS = null   // estado del arrastre en curso

  function scrollParent (el) {
    let n = el && el.parentElement
    while (n) {
      const s = getComputedStyle(n)
      if (/(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n
      n = n.parentElement
    }
    return window
  }

  function autoScroll (y) {
    const margin = 90, vh = window.innerHeight
    let dy = 0
    if (y < margin) dy = -Math.ceil((margin - y) / 5)
    else if (y > vh - margin) dy = Math.ceil((y - (vh - margin)) / 5)
    if (!dy) return
    const sc = DS.scroller
    if (sc === window) window.scrollBy(0, dy)
    else sc.scrollTop += dy
  }

  function colocarPlaceholder (y) {
    const cards = [...DS.list.querySelectorAll('[data-pid]')].filter(c => c !== DS.card)
    let ref = null
    for (const c of cards) {
      const r = c.getBoundingClientRect()
      if (y < r.top + r.height / 2) { ref = c; break }
    }
    if (ref) DS.list.insertBefore(DS.ph, ref)
    else DS.list.appendChild(DS.ph)
  }

  function tick () {
    if (!DS) return
    const y = DS.lastY
    DS.card.style.top = (y - DS.offsetY) + 'px'
    autoScroll(y)
    colocarPlaceholder(y)
    DS.raf = requestAnimationFrame(tick)
  }

  function onDragMove (e) { if (DS) { DS.lastY = e.clientY; DS.moved = true } }

  async function onDragUp () {
    if (!DS) return
    cancelAnimationFrame(DS.raf)
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragUp)
    window.removeEventListener('pointercancel', onDragUp)

    const { card, ph, list, moved } = DS
    for (const k of ['position', 'zIndex', 'width', 'left', 'top', 'pointerEvents', 'boxShadow', 'opacity', 'transform']) card.style[k] = ''
    document.body.style.userSelect = ''
    const grip = card.querySelector('.chk-grip'); if (grip) grip.style.cursor = 'grab'
    list.insertBefore(card, ph)
    ph.remove()
    DS = null
    if (moved) await persistirOrden()
  }

  async function persistirOrden () {
    const list = document.getElementById('chk-lista-puntos')
    if (!list) return
    const ids = [...list.querySelectorAll('[data-pid]')].map(c => Number(c.dataset.pid))
    // Reordenar el arreglo local para que #orden y el estado de las flechas
    // queden coherentes, y repintar SOLO la lista (sin recargar → sin salto).
    const byId = {}; for (const p of PUNTOS) byId[p.id] = p
    const nuevo = ids.map(id => byId[id]).filter(Boolean)
    if (nuevo.length === PUNTOS.length) {
      PUNTOS = nuevo
      PUNTOS.forEach((p, i) => { p.orden = i + 1 })
      list.innerHTML = PUNTOS.map(tarjeta).join('')
    }
    const { data, error } = await sb().rpc('checklist_punto_reordenar', { p_ids: ids })
    if (error || (data && data.ok === false)) {
      toast((error && error.message) || 'No se pudo guardar el orden', 'error')
      initChecklistConfig()
    } else {
      toast('Orden guardado', 'success')
    }
  }

  // Delegado en document: sobrevive a los repintados de tarjetas.
  document.addEventListener('pointerdown', function (e) {
    const grip = e.target.closest && e.target.closest('.chk-grip')
    if (!grip) return
    if (e.button != null && e.button !== 0) return   // solo botón primario
    const card = grip.closest('[data-pid]')
    const list = document.getElementById('chk-lista-puntos')
    if (!card || !list) return
    e.preventDefault()

    const rect = card.getBoundingClientRect()
    DS = {
      card, list, ph: null, raf: 0, moved: false,
      offsetY: e.clientY - rect.top, lastY: e.clientY,
      scroller: scrollParent(list)
    }
    const ph = document.createElement('div')
    ph.className = 'chk-ph'
    ph.style.cssText = `height:${rect.height}px;margin-bottom:12px;border:2px dashed #c8a24a;border-radius:12px;background:rgba(200,162,74,.06)`
    card.parentNode.insertBefore(ph, card)
    DS.ph = ph

    card.style.position = 'fixed'
    card.style.zIndex = '10050'
    card.style.width = rect.width + 'px'
    card.style.left = rect.left + 'px'
    card.style.top = (e.clientY - DS.offsetY) + 'px'
    card.style.pointerEvents = 'none'
    card.style.boxShadow = '0 14px 34px rgba(0,0,0,.55)'
    card.style.opacity = '.97'
    card.style.transform = 'rotate(.35deg)'
    grip.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'

    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragUp)
    window.addEventListener('pointercancel', onDragUp)
    DS.raf = requestAnimationFrame(tick)
  })
})()