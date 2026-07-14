/* ============================================================================
 * CONTAMAX · precios.js — Lista de precios del catálogo
 *
 * Hasta ahora los precios de servicios_cat / productos_cat solo se podían editar
 * desde el SQL Editor. Esto los pone en la app.
 *
 * DOS COSAS QUE NO SON OBVIAS Y HAY QUE RESPETAR:
 *
 * 1. EDITAR UN PRECIO NO CAMBIA NINGUNA COMISIÓN YA GENERADA.
 *    La comisión usa precio_base_snapshot, congelado en el momento del hallazgo.
 *    Cambiar el precio hoy afecta a los hallazgos de MAÑANA. Los de julio no se mueven.
 *
 * 2. NO SE PUEDE DEJAR SIN PRECIO UN ÍTEM QUE PAGA COMISIÓN.
 *    Lo bloquea un trigger en la base (checklist_11.sql). Si se pudiera, el técnico
 *    cobraría CERO por encontrarlo — que es el problema que este proyecto existe
 *    para resolver, y ya nos pasó una vez.
 * ========================================================================== */
window.__preciosBuild = '20260714d'

;(function () {
  const sb = () => window._sb
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
  const fmt = (v) => v == null ? '—' : Number(v).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const toast = (m, t) => window.toast?.(m, t)

  let CAT = []
  let LOG = []
  let TASAS = {}
  let FILTRO = ''
  // Guardar el scroll: al guardar un código se repinta la vista y, sin esto, el usuario
  // vuelve al principio de una tabla de 39 filas. Con 21 códigos que llenar, es 21 veces.
  let SCROLL_TABLA = 0
  let SCROLL_PAG = 0
  let PRIMERA = true
  const EXTRA = 1        // punto_extra_recomendado: encontrar paga 1 punto más

  // El perfil se obtiene con window._currentProfile() — es una FUNCIÓN, no un objeto.
  // Leer window._perfil (inexistente) dejaba a todos, incluido el super_admin, en solo lectura.
  function puedeEditar () {
    const p = (window._currentProfile ? window._currentProfile() : null) || {}
    return ['super_admin', 'admin', 'gerencia'].includes(p._rolReal || p.rol)
  }

  window.initPrecios = async function () {
    const root = document.getElementById('view-precios')
    if (!root) return
    // Solo la primera vez. En los refrescos se conserva la tabla en pantalla hasta que
    // llegan los datos nuevos: sin parpadeo y sin perder el lugar.
    if (PRIMERA) root.innerHTML = '<div style="padding:24px;color:#8b949e">Cargando catálogo…</div>'
    else { SCROLL_TABLA = document.getElementById('pr-scroll')?.scrollTop || SCROLL_TABLA; SCROLL_PAG = window.scrollY }
    try {
      // v_catalogo_precios NO se toca: ya calcula bien la mediana histórica.
      // El código de comisión se trae aparte y se mezcla por id. Cero riesgo sobre
      // una pantalla que funciona.
      const [rc, rl, rs, rt] = await Promise.all([
        sb().from('v_catalogo_precios').select('*'),
        sb().from('catalogo_precio_log').select('*').order('cambiado_at', { ascending: false }).limit(40),
        sb().from('servicios_cat').select('id,comision_codigo'),
        sb().from('comision_tasas').select('codigo,pct')
      ])
      if (rc.error) throw rc.error
      const COD = {}; for (const x of (rs.data || [])) COD[x.id] = x.comision_codigo
      TASAS = {}; for (const x of (rt.data || [])) TASAS[x.codigo] = Number(x.pct)
      CAT = (rc.data || []).map(r => Object.assign({}, r, { comision_codigo: COD[r.id] ?? null }))
      CAT = CAT.sort((a, b) =>
        (b.puntos_comision || 0) - (a.puntos_comision || 0) ||
        String(a.tipo).localeCompare(b.tipo) ||
        String(a.nombre).localeCompare(b.nombre))
      LOG = rl.data || []
      render()
      PRIMERA = false
    } catch (e) {
      root.innerHTML = `<div style="padding:24px;color:#f85149">Error: ${esc(e.message || e)}</div>`
    }
  }

  function render () {
    const root = document.getElementById('view-precios'); if (!root) return
    const editable = puedeEditar()
    const q = FILTRO.trim().toLowerCase()
    const rows = CAT.filter(r => !q ||
      String(r.nombre).toLowerCase().includes(q) || String(r.codigo).toLowerCase().includes(q))

    const sinPrecio = CAT.filter(r => r.precio_base == null && r.puntos_comision > 0)
    // Un servicio sin código NO paga comisión (no cobra 4% por default, como hacía el
    // HTML viejo). Y el checklist obligatorio no se puede prender hasta que estén todos.
    const sinCodigo = CAT.filter(r => r.tipo === 'servicio' && !r.comision_codigo)

    root.innerHTML = `
      <style>
        #view-precios .pr-t{width:100%;border-collapse:collapse;font-size:13px}
        #view-precios .pr-t th{background:#0d1117;color:#8b949e;text-align:left;padding:9px 10px;
          font-size:11px;text-transform:uppercase;letter-spacing:.4px;position:sticky;top:0;z-index:1}
        #view-precios .pr-t td{border-bottom:1px solid #21262d;padding:8px 10px;vertical-align:middle}
        #view-precios .pr-t tr:hover td{background:#161b22}
        #view-precios .pr-in{width:110px;background:#0d1117;border:1px solid #30363d;border-radius:6px;
          color:#e6edf3;padding:6px 8px;font-size:13px;text-align:right;font-variant-numeric:tabular-nums}
        #view-precios .pr-in:focus{border-color:#c8a24a;outline:none}
        #view-precios .pr-badge{font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;border:1px solid}
      </style>

      ${sinPrecio.length ? `
        <div style="background:rgba(248,81,73,.10);border:1px solid #f85149;border-radius:10px;padding:11px 14px;margin-bottom:14px">
          <b style="color:#f85149;font-size:13px">⚠️ ${sinPrecio.length} ítem(s) sin precio pagan comisión CERO</b>
          <div style="font-size:12px;color:#8b949e;margin-top:3px">${sinPrecio.map(r => esc(r.nombre)).join(' · ')}</div>
        </div>` : ''}

      ${sinCodigo.length ? `
        <div style="background:rgba(248,81,73,.10);border:1px solid #f85149;border-radius:10px;padding:11px 14px;margin-bottom:14px">
          <b style="color:#f85149;font-size:13px">🔒 ${sinCodigo.length} servicio(s) sin código de comisión — el checklist NO puede arrancar</b>
          <div style="font-size:12px;color:#8b949e;margin-top:3px">
            Sin código, el técnico cobra cero. El checklist obligatorio queda bloqueado hasta que estén todos.
          </div>
        </div>` : ''}

      <div style="background:rgba(200,162,74,.08);border-left:3px solid #c8a24a;padding:10px 13px;margin-bottom:14px;font-size:12px;color:#8b949e">
        Cambiar un precio <b style="color:#e6edf3">no mueve ninguna comisión ya generada</b> — esas usan el precio congelado al momento del hallazgo.
        Afecta a los hallazgos de mañana en adelante. Todo cambio queda registrado.
      </div>

      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <input id="pr-q" class="pr-in" style="width:260px;text-align:left" placeholder="Buscar…" value="${esc(FILTRO)}">
        <span style="font-size:12px;color:#8b949e">${rows.length} de ${CAT.length}</span>
        ${!editable ? '<span style="font-size:12px;color:#f0a500">👁 Solo lectura</span>' : ''}
        <button class="btn btn-ghost" style="margin-left:auto" onclick="initPrecios()">↻ Recargar</button>
      </div>

      <div id="pr-scroll" style="max-height:62vh;overflow:auto;border:1px solid #21262d;border-radius:10px">
        <table class="pr-t">
          <thead><tr>
            <th>Ítem</th><th>Tipo</th>
            <th style="text-align:right">Precio de lista</th>
            <th style="text-align:right" title="Mediana de lo realmente facturado en el histórico">Mediana histórica</th>
            <th style="text-align:center" title="10=2% rápido · 20=3% destreza · 30=4% diagnóstico. El recomendado paga 1 punto más.">Código</th>
            <th style="text-align:center" title="Solicitado → Recomendado (el checklist paga 1 punto más)">%</th>
            <th style="text-align:center" title="A cuántos puntos del checklist que pagan comisión afecta este precio">Comisiones</th>
            <th>Último cambio</th>
          </tr></thead>
          <tbody>${rows.map(fila).join('')}</tbody>
        </table>
      </div>

      ${LOG.length ? `
        <div style="margin-top:18px">
          <div style="font-size:13px;font-weight:600;margin-bottom:7px">Bitácora de cambios</div>
          <div style="max-height:200px;overflow:auto;border:1px solid #21262d;border-radius:10px;padding:4px 0">
            ${LOG.map(l => `
              <div style="font-size:12px;color:#8b949e;padding:5px 12px;border-bottom:1px solid #161b22">
                <span style="color:#e6edf3">${esc(l.nombre || l.cat_id)}</span>
                · L. ${fmt(l.precio_anterior)} → <b style="color:#c8a24a">L. ${fmt(l.precio_nuevo)}</b>
                · ${new Date(l.cambiado_at).toLocaleString('es-HN')}
              </div>`).join('')}
          </div>
        </div>` : ''}
    `

    const q2 = document.getElementById('pr-q')
    if (q2) {
      q2.oninput = (e) => { FILTRO = e.target.value; SCROLL_TABLA = 0; render(); const el = document.getElementById('pr-q'); el.focus(); el.selectionStart = el.value.length }
    }

    // Volver exactamente donde estaba
    const sc = document.getElementById('pr-scroll')
    if (sc && SCROLL_TABLA) sc.scrollTop = SCROLL_TABLA
    if (SCROLL_PAG) window.scrollTo(0, SCROLL_PAG)
  }

  function fila (r) {
    const editable = puedeEditar()
    const paga = (r.puntos_comision || 0) > 0
    const sinPrecio = r.precio_base == null
    const sinCod = r.tipo === 'servicio' && !r.comision_codigo
    const pctBase = r.comision_codigo ? (TASAS[r.comision_codigo] ?? null) : null
    // Si la mediana difiere mucho del precio de lista, vale la pena que salte a la vista.
    const desvio = (r.precio_base && r.mediana_historica)
      ? Math.abs(r.precio_base - r.mediana_historica) / r.mediana_historica : 0
    const colorMed = desvio > 0.25 ? '#f0a500' : '#8b949e'

    return `<tr>
      <td>
        <div style="font-weight:600;color:${sinPrecio && paga ? '#f85149' : '#e6edf3'}">${esc(r.nombre)}</div>
        <div style="font-size:10px;color:#6e7681;font-family:monospace">${esc(r.codigo)}</div>
      </td>
      <td><span class="pr-badge" style="border-color:${r.tipo === 'servicio' ? '#3b82f6' : '#16a34a'};color:${r.tipo === 'servicio' ? '#3b82f6' : '#16a34a'}">
        ${r.tipo === 'servicio' ? 'SERVICIO' : 'PRODUCTO'}</span></td>
      <td style="text-align:right">
        ${editable
          ? `<input class="pr-in" type="number" step="0.01" min="0" value="${r.precio_base ?? ''}"
               placeholder="sin precio" data-id="${r.id}" data-tipo="${r.tipo}"
               onchange="prGuardar('${r.id}','${r.tipo}', this.value, ${r.precio_base ?? 'null'})">`
          : `<b>L. ${fmt(r.precio_base)}</b>`}
      </td>
      <td style="text-align:right;color:${colorMed};font-variant-numeric:tabular-nums">
        ${r.mediana_historica ? 'L. ' + fmt(r.mediana_historica) : '—'}
        ${r.veces_facturado ? `<div style="font-size:10px;color:#6e7681">${r.veces_facturado}× facturado</div>` : ''}
      </td>
      <td style="text-align:center">
        ${r.tipo !== 'servicio'
          ? '<span style="color:#6e7681" title="Los productos no llevan código: pagan 3% fijo">—</span>'
          : (editable
            ? `<select onchange="prCodigo('${r.id}', this.value)" style="background:#0d1117;color:#e6edf3;
                       border:1px solid ${sinCod ? '#f85149' : '#30363d'};border-radius:6px;padding:5px 6px;font-size:12px">
                 <option value="" ${sinCod ? 'selected' : ''}>— sin código —</option>
                 <option value="10" ${r.comision_codigo === '10' ? 'selected' : ''}>10 · rápido</option>
                 <option value="20" ${r.comision_codigo === '20' ? 'selected' : ''}>20 · destreza</option>
                 <option value="30" ${r.comision_codigo === '30' ? 'selected' : ''}>30 · diagnóstico</option>
               </select>`
            : `<b style="color:${sinCod ? '#f85149' : '#e6edf3'}">${r.comision_codigo || '—'}</b>`)}
      </td>
      <td style="text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums">
        ${pctBase == null
          ? (r.tipo === 'servicio' ? '<span style="color:#f85149" title="Sin código no paga comisión">⚠️</span>'
                                   : `<b style="color:#16a34a">3%</b>`)
          : `<span style="color:#8b949e">${pctBase}%</span> <span style="color:#6e7681">→</span> <b style="color:#16a34a">${pctBase + EXTRA}%</b>`}
      </td>
      <td style="text-align:center">
        ${paga
          ? `<span class="pr-badge" style="border-color:#c8a24a;color:#c8a24a" title="Este precio decide la comisión de ${r.puntos_comision} punto(s) del checklist">💰 ${r.puntos_comision}</span>`
          : '<span style="color:#6e7681">—</span>'}
      </td>
      <td style="font-size:11px;color:#8b949e">
        ${r.ultimo_cambio ? new Date(r.ultimo_cambio).toLocaleDateString('es-HN') : '—'}
      </td>
    </tr>`
  }

  window.prGuardar = async function (id, tipo, valor, anterior) {
    SCROLL_TABLA = document.getElementById('pr-scroll')?.scrollTop || 0
    SCROLL_PAG = window.scrollY
    const v = valor === '' ? null : Number(valor)
    if (v != null && (!isFinite(v) || v < 0)) { toast('Precio inválido', 'error'); return }
    if (v === anterior) return

    const item = CAT.find(r => r.id === id)
    // Aviso, no bloqueo: el que bloquea de verdad es el trigger de la base.
    if ((item?.puntos_comision || 0) > 0) {
      const msg = v == null
        ? `"${item.nombre}" decide la comisión de ${item.puntos_comision} punto(s).\n\nSin precio, el técnico cobra CERO por encontrarlo. La base lo va a rechazar.`
        : `"${item.nombre}" decide la comisión de ${item.puntos_comision} punto(s) del checklist.\n\nL. ${fmt(anterior)} → L. ${fmt(v)}\n\nLos hallazgos YA generados no se mueven. Esto afecta de acá en adelante.`
      if (!confirm(msg)) { render(); return }
    }

    const tabla = tipo === 'servicio' ? 'servicios_cat' : 'productos_cat'
    const { error } = await sb().from(tabla)
      .update({ precio_base: v, vigente_desde: new Date().toISOString().slice(0, 10) })
      .eq('id', id)
    if (error) { toast(error.message, 'error'); render(); return }
    toast('Precio actualizado', 'success')
    initPrecios()
  }
  /* ──────────────────────────────────────────────────────────────────────────
   * EL CÓDIGO DE COMISIÓN
   *
   * Va por RPC (catalogo_editar), no por UPDATE directo. Cambiar un código cambia
   * un SUELDO: el motivo lo exige la BASE, no este prompt. Un fetch a mano tampoco
   * lo saltea.
   *
   * OJO: acá NO hay default. El HTML viejo, cuando no encontraba el servicio en su
   * lista, cobraba 4% — la tasa más alta — sin que nadie se enterara. Ese fue el
   * hallazgo más grande del proyecto. Sin código no hay comisión, y punto.
   * ────────────────────────────────────────────────────────────────────────── */
  window.prCodigo = async function (id, valor) {
    SCROLL_TABLA = document.getElementById('pr-scroll')?.scrollTop || 0
    SCROLL_PAG = window.scrollY
    const item = CAT.find(r => r.id === id)
    if (!valor) { toast('No se puede dejar sin código: el técnico cobraría cero', 'error'); render(); return }

    let motivo = null
    if (item?.comision_codigo && item.comision_codigo !== valor) {
      const antes = TASAS[item.comision_codigo], ahora = TASAS[valor]
      motivo = prompt(
        `${item.nombre}\n\nCódigo ${item.comision_codigo} (${antes}%) → ${valor} (${ahora}%)\n\n` +
        `Esto cambia la comisión de TODOS los técnicos que hagan este servicio de acá en adelante.\n` +
        `Las comisiones ya generadas no se mueven.\n\n¿Por qué? (queda en bitácora)`)
      if (!motivo || !motivo.trim()) { toast('Cancelado', 'error'); render(); return }
    }

    const { data, error } = await sb().rpc('catalogo_editar', {
      p_tipo: 's', p_id: id, p_campo: 'comision_codigo', p_valor: valor, p_motivo: motivo
    })
    if (error) { toast(error.message, 'error'); render(); return }
    toast(`${item?.nombre || ''}: código ${data.antes || '—'} → ${data.ahora}`, 'success')
    initPrecios()
  }
})()