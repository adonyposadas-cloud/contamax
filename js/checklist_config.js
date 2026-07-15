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
window.__chkCfgBuild = '20260714a'

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

      <div>${PUNTOS.map(tarjeta).join('')}</div>`
  }

  function tarjeta (p) {
    const lineas = LINEAS[p.id] || []
    const sinPrecio = lineas.some(l => {
      const cat = l.tipo === 'p' ? NOMB.p[l.producto_cat_id] : NOMB.s[l.servicio_cat_id]
      return !cat || cat.precio_base == null
    })
    const mide = p.tipo_punto === 'medicion'
    return `
      <div style="background:#15171c;border:1px solid ${p.activo ? '#2a2e37' : '#4a2a2a'};border-radius:12px;padding:14px;margin-bottom:12px;${p.activo ? '' : 'opacity:.7'}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:11px;color:#6b7280">#${p.orden}</span>
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
          <label style="color:#8b949e">Orden
            <input type="number" value="${p.orden}" onchange="chkCfgEdit(${p.id},'orden',this.value)" style="width:56px;background:#0d1117;color:#e6edf3;border:1px solid #2a2e37;border-radius:6px;padding:4px 6px;margin-left:4px">
          </label>
        </div>

        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:${mide ? '10' : '2'}px;font-size:12px">
          <label style="cursor:pointer"><input type="checkbox" ${p.foto_obligatoria ? 'checked' : ''} onchange="chkCfgEdit(${p.id},'foto_obligatoria',this.checked)"> 📷 Foto obligatoria</label>
          <label style="cursor:pointer"><input type="checkbox" ${p.pide_medicion ? 'checked' : ''} onchange="chkCfgEdit(${p.id},'pide_medicion',this.checked)"> 📏 Pide medición</label>
          <label style="cursor:pointer"><input type="checkbox" ${p.nota_obligatoria ? 'checked' : ''} onchange="chkCfgEdit(${p.id},'nota_obligatoria',this.checked)"> 📝 Nota obligatoria</label>
          <label style="cursor:pointer;color:${sinPrecio ? '#f85149' : '#e6edf3'}" title="${sinPrecio ? 'Hay líneas de venta sin precio: la base no dejará activar comisión' : ''}">
            <input type="checkbox" ${p.paga_comision ? 'checked' : ''} onchange="chkCfgEdit(${p.id},'paga_comision',this.checked)"> 💰 Paga comisión${sinPrecio ? ' 🔒' : ''}
          </label>
        </div>

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
    </div>`
  }

  window.chkCfgEdit = async function (id, campo, valor) {
    const v = (typeof valor === 'boolean') ? String(valor) : String(valor)
    const { data, error } = await sb().rpc('checklist_punto_editar', {
      p_id: id, p_campo: campo, p_valor: v
    })
    if (error) { toast(error.message, 'error'); initChecklistConfig(); return }
    toast('Guardado', 'success')
    // Recargar para reflejar candados y dependencias (ej. tipo cambió → umbrales)
    initChecklistConfig()
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
})()