/* ============================================================================
 * CONTAMAX · mecanico.js — Checklist de inspección (celular del técnico)
 * Requiere: checklist_01..05.sql
 *
 * FLUJO
 *   1. El mecánico ve las órdenes pendientes de inspeccionar
 *   2. Toca una → se CREA una proforma 'recomendado' nueva para esa orden
 *      (heredando cliente/placa/km de su hermana 'solicitado') y una inspección
 *      colgada de ELLA. Nunca se escribe sobre la proforma del jefe de pista:
 *      checklist_cerrar() le pisaría los ítems que pidió el cliente.
 *   3. 21 puntos: 🟢 / 🟡 / 🔴. Cero escritura obligatoria. Foto en 🟡 y 🔴.
 *   4. Cerrar → checklist_cerrar() valida EN EL SERVIDOR y vuelca los solicitados
 *
 * La atribución es mecanico_id = auth.uid() en la inspección. No depende de que
 * el nombre del técnico esté bien escrito en ningún lado.
 * ========================================================================== */
;(function () {
  'use strict'
  window.__mecBuild = '20260714h'

  const sb = () => window._sb || window.sb
  const $ = id => document.getElementById(id)
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const toast = (m, t) => window.toast?.(m, t)
  const num = v => parseFloat(v) || 0

  let PUNTOS = []          // catálogo (solo activos)
  let CFG = null
  let YO = null            // fila de `usuarios` (NO es auth.uid(): el vínculo es auth_user_id)
  let INSP = null          // inspección abierta
  let HALL = {}            // punto_id → { severidad, medicion, medicion_extra, foto_url, nota }
  let SUBIENDO = 0

  const SEV = {
    verde:    { lbl: 'Bien',        icon: '🟢', color: '#16a34a' },
    amarillo: { lbl: 'Desgastado',  icon: '🟡', color: '#f0a500' },
    rojo:     { lbl: 'Cambiar ya',  icon: '🔴', color: '#f85149' }
  }
  const RUEDAS = [['d_izq', 'Del. izq'], ['d_der', 'Del. der'], ['t_izq', 'Tras. izq'], ['t_der', 'Tras. der']]

  // ── Vista ──────────────────────────────────────────────────────────────────
  window.initMecanico = async function () {
    const v = $('view-mecanico')
    if (!v) return
    v.innerHTML = `
      <style>
        .mec-wrap{max-width:640px;margin:0 auto;padding:0 4px}
        .mec-card{background:var(--bg2,#161b22);border:1px solid var(--border,#2a3340);border-radius:12px;padding:14px;margin-bottom:10px}
        .mec-ord{display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer}
        .mec-sis{font-size:11px;font-weight:800;letter-spacing:.08em;color:var(--gold,#c8a24a);text-transform:uppercase;margin:18px 0 6px}
        .mec-pt{background:var(--bg2,#161b22);border:1px solid var(--border,#2a3340);border-radius:12px;padding:12px;margin-bottom:8px}
        .mec-pt.done{border-color:rgba(22,163,74,.45)}
        .mec-pt-nom{font-size:15px;font-weight:600;margin-bottom:9px}
        .mec-sevs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
        /* Botones grandes: se tocan con guante y con el pulgar */
        .mec-sev{padding:13px 4px;border-radius:10px;border:1.5px solid var(--border,#2a3340);
                 background:var(--bg3,#1c2333);color:var(--text2,#c9d1d9);font-size:13px;font-weight:700;
                 cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;min-height:58px}
        .mec-sev.on{color:#fff}
        .mec-extra{margin-top:10px;padding-top:10px;border-top:1px dashed var(--border,#2a3340)}
        .mec-in{width:100%;padding:11px;border-radius:8px;border:1px solid var(--border,#2a3340);
                background:var(--bg3,#1c2333);color:var(--text,#e6edf3);font-size:16px}
        .mec-foto{display:flex;align-items:center;gap:10px;margin-top:8px}
        .mec-foto img{width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid var(--border,#2a3340)}
        .mec-bar{position:sticky;bottom:0;background:var(--bg,#0d1117);border-top:1px solid var(--border,#2a3340);
                 padding:12px 4px;margin-top:14px;display:flex;gap:10px;align-items:center}
        .mec-prog{flex:1;font-size:13px;color:var(--text3,#8b949e)}
        .mec-ruedas{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      </style>
      <div class="mec-wrap" id="mec-root"><div style="text-align:center;padding:40px;color:var(--text3,#8b949e)">Cargando…</div></div>`
    await cargarCatalogo()
    await renderOrdenes()
  }

  // checklist_inspecciones.mecanico_id → usuarios.id (NO auth.uid()).
  // La tabla `usuarios` se llavea con auth por la columna auth_user_id.
  async function cargarYo () {
    if (YO) return YO
    const { data: { user } } = await sb().auth.getUser()
    if (!user) throw new Error('Sesión no iniciada')
    const { data, error } = await sb().from('usuarios')
      .select('id, nombre, rol, tecnico_id').eq('auth_user_id', user.id).single()
    if (error || !data) throw new Error('Tu usuario no está registrado en el sistema')
    YO = data
    return YO
  }

  // ── FOTOS ── El bucket es PRIVADO. foto_url guarda el PATH, no la URL.
  // getPublicUrl() ya no sirve: hay que pedir una URL FIRMADA que expira.
  const _urlCache = new Map()
  async function fotoUrl (path, segs) {
    if (!path) return ''
    const k = path + '|' + (segs || 3600)
    if (_urlCache.has(k)) return _urlCache.get(k)
    const { data, error } = await sb().storage.from('checklist-fotos')
      .createSignedUrl(path, segs || 3600)
    if (error || !data) return ''
    _urlCache.set(k, data.signedUrl)
    return data.signedUrl
  }

  // Link de 7 días para que el jefe de pista le mande la foto al cliente por WhatsApp.
  // Es lo que convierte el hallazgo en venta — y muere solo, sin dejar el bucket abierto.
  window.checklistFotoLink = async function (path) { return fotoUrl(path, 7 * 24 * 3600) }

  // Pinta las <img data-foto="path"> después del render (la firma es asíncrona)
  async function pintarFotos () {
    const imgs = document.querySelectorAll('#mec-root img[data-foto]')
    for (const im of imgs) {
      const u = await fotoUrl(im.getAttribute('data-foto'))
      if (u) im.src = u
    }
  }

  // cotizador_proformas.kilometraje es TEXTO ("125,000", ""). checklist_inspecciones
  // lo guarda como int. Sin esto: "invalid input syntax for type integer".
  const kmInt = v => {
    const n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10)
    return Number.isFinite(n) ? n : null
  }

  async function cargarCatalogo () {
    if (PUNTOS.length && CFG) return
    const [p, c] = await Promise.all([
      sb().from('checklist_puntos').select('*').eq('activo', true).order('orden'),
      sb().from('checklist_config').select('*').eq('id', 1).single()
    ])
    if (p.error) { toast('No se pudo cargar el checklist: ' + p.error.message, 'error'); return }
    PUNTOS = p.data || []
    CFG = c.data || { mm_llanta_amarillo: 4, mm_llanta_rojo: 3 }
  }

  // ── 1. Órdenes por inspeccionar ────────────────────────────────────────────
  async function renderOrdenes () {
    const root = $('mec-root'); if (!root) return
    root.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3,#8b949e)">Cargando órdenes…</div>'

    const yo = await cargarYo()

    // "EN PROCESO" = la misma definición que usa jefe_pista.js (línea 325).
    // No se inventa una nueva: si cambia allá, cambia acá. 'finalizada' queda afuera —
    // un carro ya entregado no se inspecciona.
    const EN_PROCESO = ['solicitada', 'pendiente', 'autorizada']

    // El mecánico ve SOLO sus órdenes. El filtro es por tecnico_id (UUID, enlace duro),
    // NO por el nombre en texto: un espacio o una tilde no pueden decidir quién ve —
    // y cobra — una orden. Si viera todas, elegiría los carros con más para encontrar
    // (selección por rentabilidad) y podría inspeccionar la orden de otro y llevarse
    // su comisión. La asignación la hace el jefe de pista; acá solo se respeta.
    let qSol = sb().from('cotizador_proformas')
      .select('id,numero_orden,cliente,placa,marca,modelo,anio_vehiculo,kilometraje,mecanico,tecnico_id,created_at')
      .eq('tipo_solicitud', 'solicitado').in('estado', EN_PROCESO)
    // super_admin/admin ven todo (para probar y supervisar). El mecánico, solo lo suyo.
    if (!['super_admin', 'admin'].includes(yo.rol)) {
      if (!yo.tecnico_id) {
        // Sin técnico asignado no hay nada que mostrar — y la base ya no deja crear un
        // mecánico así, pero si un usuario viejo quedó sin enlazar, se avisa en vez de
        // mostrarle órdenes que no son suyas.
        root.innerHTML = '<div class="mec-card">⚠️ Tu usuario no tiene un técnico asignado. Avisale al jefe de pista o a gerencia — sin eso, tu comisión no se acredita.</div>'
        return
      }
      qSol = qSol.eq('tecnico_id', yo.tecnico_id)
    }
    const [rSol, rRec] = await Promise.all([
      qSol.order('created_at', { ascending: false }).limit(120),
      // Qué órdenes YA tienen checklist. Se pregunta a checklist_inspecciones, NO a las
      // proformas: ahora la proforma solo existe si hubo hallazgos, así que un carro
      // sano no dejaría rastro y volvería a aparecer como "por inspeccionar".
      // La inspección es la fuente de verdad de "este carro ya se revisó".
      sb().from('checklist_inspecciones').select('numero_orden,estado,mecanico_id')
    ])
    if (rSol.error) { root.innerHTML = `<div class="mec-card">⚠️ ${esc(rSol.error.message)}</div>`; return }

    const conChecklist = new Set((rRec.data || []).map(i => i.numero_orden))
    const pend = (rSol.data || []).filter(p => !conChecklist.has(p.numero_orden))

    // Mis inspecciones sin cerrar (para retomarlas)
    const { data: abiertas } = await sb().from('checklist_inspecciones')
      .select('id,numero_orden,placa,estado').eq('estado', 'en_proceso').eq('mecanico_id', yo.id)

    let html = ''
    if (abiertas?.length) {
      html += '<div class="mec-sis">Inspecciones sin terminar</div>'
      html += abiertas.map(i => `
        <div class="mec-card" onclick="mecAbrirInspeccion('${i.id}')">
          <div class="mec-ord">
            <div><b>Orden #${esc(i.numero_orden || '—')}</b><div style="font-size:12px;color:var(--text3,#8b949e)">${esc(i.placa || '')}</div></div>
            <span style="color:var(--gold,#c8a24a);font-weight:700">Continuar →</span>
          </div>
        </div>`).join('')
    }

    html += '<div class="mec-sis">Por inspeccionar</div>'
    html += pend.length ? pend.map(p => `
      <div class="mec-card" onclick="mecIniciar('${p.id}')">
        <div class="mec-ord">
          <div style="min-width:0">
            <b>Orden #${esc(p.numero_orden || '—')}</b>
            <div style="font-size:13px;color:var(--text2,#c9d1d9)">${esc([p.marca, p.modelo, p.anio_vehiculo].filter(Boolean).join(' ') || '—')}</div>
            <div style="font-size:12px;color:var(--text3,#8b949e)">${esc(p.placa || 'sin placa')}${p.mecanico ? ' · ' + esc(p.mecanico) : ''}</div>
          </div>
          <span style="color:var(--green,#16a34a);font-weight:700;white-space:nowrap">Inspeccionar →</span>
        </div>
      </div>`).join('')
      : '<div class="mec-card" style="text-align:center;color:var(--text3,#8b949e)">No hay órdenes pendientes 🎉</div>'

    html += `<div style="margin-top:22px"><button class="btn btn-ghost" style="width:100%;padding:12px" onclick="mecComision()">💰 Mi comisión</button></div>`
    root.innerHTML = html
  }

  // ── 2. Iniciar: crea la proforma 'recomendado' + la inspección ─────────────
  window.mecIniciar = async function (proformaSolicitadoId) {
    const root = $('mec-root')
    root.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3,#8b949e)">Abriendo inspección…</div>'
    try {
      const yo = await cargarYo()   // 'yo' vivía solo en renderOrdenes; sin esto, "Inspeccionar" reventaba
      const { data: hermana, error: e0 } = await sb().from('cotizador_proformas')
        .select('numero_orden,cliente,placa,marca,modelo,anio_vehiculo,kilometraje,mecanico,jefe_pista')
        .eq('id', proformaSolicitadoId).single()
      if (e0) throw e0

      // ⚠️ NO se crea ninguna proforma acá.
      //
      // Antes sí, y era un bug de NÓMINA: un carro sano o una inspección abandonada
      // dejaban una 'recomendado' vacía, y v_bonos_cotizador las contaba como FUERA
      // DE SLA. El cotizador perdía su bono por proformas que nunca tuvieron un ítem.
      //
      // La proforma nace en checklist_cerrar(), y SOLO si hubo hallazgos 🟡/🔴.
      // La inspección no la necesita: le alcanza con numero_orden.
      const { data: insp, error: e2 } = await sb().from('checklist_inspecciones').insert({
        proforma_id: null,                        // se llena al CERRAR, y solo si hay hallazgos
        numero_orden: hermana.numero_orden,
        placa: hermana.placa,
        kilometraje: kmInt(hermana.kilometraje),
        mecanico_id: yo.id            // ← LA ATRIBUCIÓN. usuarios.id, no auth.uid().
      }).select('*').single()
      // Ya no hay proforma huérfana que limpiar: si el insert falla, no se creó nada.
      if (e2) throw e2

      INSP = insp; HALL = {}
      renderChecklist()
    } catch (e) {
      toast('Error: ' + (e.message || e), 'error')
      await renderOrdenes()
    }
  }

  window.mecAbrirInspeccion = async function (id) {
    const { data: insp, error } = await sb().from('checklist_inspecciones').select('*').eq('id', id).single()
    if (error) { toast('Error: ' + error.message, 'error'); return }
    const { data: h } = await sb().from('checklist_hallazgos').select('*').eq('inspeccion_id', id)
    INSP = insp; HALL = {}
    for (const x of (h || [])) HALL[x.punto_id] = x
    renderChecklist()
  }

  // ── 3. Los 21 puntos ───────────────────────────────────────────────────────
  function renderChecklist () {
    const root = $('mec-root'); if (!root || !INSP) return
    let html = `
      <div class="mec-card" style="position:sticky;top:0;z-index:5">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><b>Orden #${esc(INSP.numero_orden || '—')}</b>
            <div style="font-size:12px;color:var(--text3,#8b949e)">${esc(INSP.placa || 'sin placa')}</div></div>
          <button class="btn btn-ghost" style="font-size:12px" onclick="mecVolver()">← Salir</button>
        </div>
      </div>`

    // La foto del freno ARMADO no sirve de evidencia. Se exige el disco/tambor DESMONTADO.
    html += `<div class="mec-card" style="border-color:var(--gold,#c8a24a)">
      <div style="font-weight:700;margin-bottom:4px">🔧 Desmontaje de ruedas</div>
      <div style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:10px">
        Desmontá la <b>delantera izquierda</b> y la <b>trasera izquierda</b>. Sacá foto del disco/tambor descubierto.
      </div>
      ${['del', 'tra'].map(r => {
        const path = INSP['foto_desmontaje_' + r]
        const lbl = r === 'del' ? 'Delantera izq.' : 'Trasera izq.'
        return `<div class="mec-foto" style="margin-bottom:6px">
          ${path ? `<img data-foto="${esc(path)}" alt="">` : ''}
          <label class="btn ${path ? 'btn-ghost' : 'btn-gold'}" style="flex:1;text-align:center;padding:11px;cursor:pointer;margin:0">
            ${path ? '✓ ' + lbl : '📷 ' + lbl}
            <input type="file" accept="image/*" capture="environment" style="display:none" onchange="mecFotoDesmontaje('${r}', this)">
          </label></div>`
      }).join('')}
    </div>`

    let sisActual = ''
    for (const p of PUNTOS) {
      if (p.sistema !== sisActual) { sisActual = p.sistema; html += `<div class="mec-sis">${esc(sisActual)}</div>` }
      html += puntoHTML(p)
    }

    const done = PUNTOS.filter(p => HALL[p.id]).length
    html += `
      <div class="mec-bar">
        <div class="mec-prog"><b style="color:${done === PUNTOS.length ? 'var(--green,#16a34a)' : 'var(--gold,#c8a24a)'}">${done}/${PUNTOS.length}</b> puntos</div>
        <button class="btn btn-gold" id="mec-cerrar" style="padding:12px 20px;font-weight:700" onclick="mecCerrar()">Enviar a cotizar →</button>
      </div>`
    root.innerHTML = html
    pintarFotos()
  }

  function puntoHTML (p) {
    const h = HALL[p.id] || {}
    const sev = h.severidad || ''
    const necesitaFoto = p.foto_obligatoria && (sev === 'amarillo' || sev === 'rojo')
    const esLlanta = p.medicion_veces > 1

    const RUEDA_LBL = { del_izq: 'delantera izquierda', tras_izq: 'trasera izquierda' }
    let extra = ''

    // FRENOS: el número se pide aunque esté en 🟢. El técnico ya desmontó la rueda y
    // tiene el dato en la mano. Es lo que construye el historial de desgaste por placa.
    if (p.medicion_siempre && sev) {
      const est = !!h.medicion_estimada
      extra += '<div class="mec-extra">'
      if (!est) {
        extra += `<input class="mec-in" type="number" step="0.1" min="0" inputmode="decimal"
                    placeholder="Milímetros medidos (rueda ${esc(RUEDA_LBL[p.rueda_requerida] || '')})"
                    value="${h.medicion != null ? h.medicion : ''}"
                    onchange="mecMedicion(${p.id}, this.value)">`
      }
      extra += `<div style="margin-top:8px">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text3,#8b949e);cursor:pointer">
          <input type="checkbox" ${est ? 'checked' : ''} onchange="mecEstimada(${p.id}, this.checked)">
          No se pudo desmontar la rueda
        </label>
        ${est ? `<input class="mec-in" style="margin-top:6px" placeholder="¿Por qué? (obligatorio)"
                   value="${esc(h.motivo_estimada || '')}" onchange="mecMotivo(${p.id}, this.value)">
                 <div style="font-size:11px;color:#f0a500;margin-top:4px">⚠️ Sin medición este punto no paga comisión</div>` : ''}
      </div>`
      if (p.foto_obligatoria && (sev === 'amarillo' || sev === 'rojo')) extra += fotoHTML(p, h)
      extra += '</div>'
      return puntoWrap(p, sev, extra)
    }

    if (sev && sev !== 'verde') {
      extra += '<div class="mec-extra">'
      if (p.pide_medicion) {
        extra += esLlanta
          ? `<div style="font-size:12px;color:var(--text3,#8b949e);margin-bottom:6px">Milímetros por rueda</div>
             <div class="mec-ruedas">${RUEDAS.map(([k, lbl]) => `
               <input class="mec-in" type="number" step="0.1" min="0" inputmode="decimal" placeholder="${lbl} (mm)"
                      value="${(h.medicion_extra && h.medicion_extra[k]) != null ? h.medicion_extra[k] : ''}"
                      onchange="mecRueda(${p.id},'${k}',this.value)">`).join('')}</div>
             <div style="font-size:11px;color:var(--text3,#8b949e);margin-top:5px">🔴 ≤ ${CFG.mm_llanta_rojo} mm · 🟡 ≤ ${CFG.mm_llanta_amarillo} mm</div>`
          : `<input class="mec-in" type="number" step="0.1" min="0" inputmode="decimal"
                    placeholder="Medición (${esc(p.unidad_medicion || '')})" value="${h.medicion != null ? h.medicion : ''}"
                    onchange="mecMedicion(${p.id}, this.value)">`
      }
      if (necesitaFoto) extra += fotoHTML(p, h)
      extra += '</div>'
    }
    return puntoWrap(p, sev, extra)
  }

  function fotoHTML (p, h) {
    return `<div class="mec-foto">
      ${h.foto_url ? `<img data-foto="${esc(h.foto_url)}" alt="">` : ''}
      <label class="btn ${h.foto_url ? 'btn-ghost' : 'btn-gold'}" style="flex:1;text-align:center;padding:12px;cursor:pointer;margin:0">
        ${h.foto_url ? '🔄 Otra foto' : '📷 Tomar foto (obligatoria)'}
        <input type="file" accept="image/*" capture="environment" style="display:none" onchange="mecFoto(${p.id}, this)">
      </label></div>`
  }

  function puntoWrap (p, sev, extra) {
    // Muestra el umbral en el título: "🟡 <5mm · 🔴 <3mm". Convierte una opinión
    // ("desgastado") en una medición con referencia. Los valores salen de la base
    // (checklist_15), no del código: cambiar el mínimo no requiere tocar esto.
    const umbralHint = (p) => {
      if (p.umbral_amarillo == null && p.umbral_rojo == null) return ''
      const u = esc(p.unidad_medicion || 'mm')
      const a = p.umbral_amarillo != null ? `🟡 <${p.umbral_amarillo}${u}` : ''
      const r = p.umbral_rojo     != null ? `🔴 <${p.umbral_rojo}${u}` : ''
      return ` <span style="font-size:11px;color:var(--text3,#8b949e);font-weight:400">· ${[a, r].filter(Boolean).join(' · ')}</span>`
    }
    return `<div class="mec-pt ${sev ? 'done' : ''}">
      <div class="mec-pt-nom">${esc(p.nombre)}${p.pide_medicion ? ` <span style="font-size:11px;color:var(--text3,#8b949e)">(${esc(p.unidad_medicion)})</span>` : ''}${umbralHint(p)}</div>
      <div class="mec-sevs">
        ${['verde', 'amarillo', 'rojo'].map(s => `
          <button class="mec-sev ${sev === s ? 'on' : ''}" onclick="mecSev(${p.id},'${s}')"
                  style="${sev === s ? `background:${SEV[s].color};border-color:${SEV[s].color}` : ''}">
            <span style="font-size:19px">${SEV[s].icon}</span><span>${SEV[s].lbl}</span>
          </button>`).join('')}
      </div>
      ${extra}
    </div>`
  }

  // La excepción. El motivo lo exige la BASE (constraint chk_estimada_con_motivo),
  // no esta pantalla: acá solo se muestra el campo.
  window.mecEstimada = async function (puntoId, on) {
    const h = HALL[puntoId]; if (!h) return
    if (!on) {
      const { data, error } = await sb().from('checklist_hallazgos')
        .update({ medicion_estimada: false, motivo_estimada: null }).eq('id', h.id).select('*').single()
      if (error) { toast(error.message, 'error'); return }
      HALL[puntoId] = data; renderChecklist(); return
    }
    // Se marca en memoria: el INSERT real espera al motivo, o la constraint lo rebota.
    HALL[puntoId] = Object.assign({}, h, { medicion_estimada: true, motivo_estimada: h.motivo_estimada || '' })
    renderChecklist()
  }

  window.mecMotivo = async function (puntoId, motivo) {
    const h = HALL[puntoId]; if (!h) return
    const m = String(motivo || '').trim()
    if (!m) { toast('Escribí por qué no se pudo desmontar', 'error'); return }
    const { data, error } = await sb().from('checklist_hallazgos')
      .update({ medicion_estimada: true, motivo_estimada: m, medicion: null })
      .eq('id', h.id).select('*').single()
    if (error) { toast(error.message, 'error'); return }
    HALL[puntoId] = data
    toast('Excepción registrada — este punto no paga comisión')
  }

  // ── Interacción: cada tap guarda. Si el celular se cierra, no se pierde nada.
  window.mecSev = async function (puntoId, sev) {
    const prev = HALL[puntoId] || {}
    const row = {
      inspeccion_id: INSP.id, punto_id: puntoId, severidad: sev,
      medicion: sev === 'verde' ? null : (prev.medicion ?? null),
      medicion_extra: sev === 'verde' ? null : (prev.medicion_extra ?? null),
      foto_url: sev === 'verde' ? null : (prev.foto_url ?? null),
      nota: prev.nota ?? null
    }
    const { data, error } = await sb().from('checklist_hallazgos')
      .upsert(row, { onConflict: 'inspeccion_id,punto_id' }).select('*').single()
    if (error) { toast('No se guardó: ' + error.message, 'error'); return }
    HALL[puntoId] = data
    renderChecklist()
  }

  window.mecMedicion = async function (puntoId, val) {
    const h = HALL[puntoId]; if (!h) return
    const { data, error } = await sb().from('checklist_hallazgos')
      .update({ medicion: val === '' ? null : num(val) }).eq('id', h.id).select('*').single()
    if (error) { toast('No se guardó la medición', 'error'); return }
    HALL[puntoId] = data
  }

  window.mecRueda = async function (puntoId, rueda, val) {
    const h = HALL[puntoId]; if (!h) return
    const extra = Object.assign({}, h.medicion_extra || {})
    if (val === '') delete extra[rueda]; else extra[rueda] = num(val)
    // La medición "principal" es la PEOR rueda: es la que manda en el diagnóstico
    const vals = Object.values(extra).map(num).filter(v => v > 0)
    const peor = vals.length ? Math.min(...vals) : null
    const { data, error } = await sb().from('checklist_hallazgos')
      .update({ medicion_extra: extra, medicion: peor }).eq('id', h.id).select('*').single()
    if (error) { toast('No se guardó', 'error'); return }
    HALL[puntoId] = data
  }

  window.mecFoto = async function (puntoId, input) {
    const file = input.files?.[0]; if (!file) return
    const h = HALL[puntoId]; if (!h) return
    SUBIENDO++
    toast('Subiendo foto…')
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${INSP.id}/${puntoId}-${Date.now()}.${ext}`
      // upsert:false — la foto es LA EVIDENCIA que sostiene la comisión. No se
      // sobreescribe nunca. "Otra foto" sube un archivo NUEVO con otro path; la
      // anterior queda en el bucket como rastro.
      const up = await sb().storage.from('checklist-fotos').upload(path, file, { upsert: false })
      if (up.error) throw up.error
      // Se guarda el PATH. La URL se firma al mostrarla: el bucket es privado.
      const { data, error } = await sb().from('checklist_hallazgos')
        .update({ foto_url: path }).eq('id', h.id).select('*').single()
      if (error) throw error
      HALL[puntoId] = data
      renderChecklist()
      toast('Foto guardada', 'success')
    } catch (e) {
      toast('No se pudo subir la foto: ' + (e.message || e), 'error')
    } finally { SUBIENDO-- }
  }

  window.mecFotoDesmontaje = async function (rueda, input) {
    const file = input.files?.[0]; if (!file || !INSP) return
    SUBIENDO++; toast('Subiendo foto…')
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${INSP.id}/desmontaje-${rueda}-${Date.now()}.${ext}`
      const up = await sb().storage.from('checklist-fotos').upload(path, file, { upsert: false })
      if (up.error) throw up.error
      const campo = 'foto_desmontaje_' + rueda
      const ruedas = Array.from(new Set([...(INSP.ruedas_desmontadas || []), rueda === 'del' ? 'del_izq' : 'tras_izq']))
      const patch = { ruedas_desmontadas: ruedas }; patch[campo] = path
      const { data, error } = await sb().from('checklist_inspecciones')
        .update(patch).eq('id', INSP.id).select('*').single()
      if (error) throw error
      INSP = data
      renderChecklist()
      toast('Foto guardada', 'success')
    } catch (e) { toast('No se pudo subir: ' + (e.message || e), 'error') }
    finally { SUBIENDO-- }
  }

  // ── 4. Cerrar ──────────────────────────────────────────────────────────────
  // La validación de verdad vive en checklist_cerrar() (servidor). Acá solo se
  // adelanta el mensaje para no hacerlo ir y volver.
  window.mecCerrar = async function () {
    if (SUBIENDO > 0) { toast('Esperá a que termine de subir la foto', 'error'); return }
    const faltan = PUNTOS.filter(p => !HALL[p.id])
    if (faltan.length) { toast(`Faltan ${faltan.length} punto(s): ${faltan.slice(0, 3).map(p => p.nombre).join(', ')}${faltan.length > 3 ? '…' : ''}`, 'error'); return }
    const sinFoto = PUNTOS.filter(p => p.foto_obligatoria && ['amarillo', 'rojo'].includes(HALL[p.id]?.severidad) && !HALL[p.id]?.foto_url)
    if (sinFoto.length) { toast(`Falta la foto en: ${sinFoto.map(p => p.nombre).join(', ')}`, 'error'); return }

    // Frenos: número obligatorio, incluso en 🟢, salvo excepción registrada con motivo.
    const sinMed = PUNTOS.filter(p => p.medicion_siempre &&
      HALL[p.id]?.medicion == null && !HALL[p.id]?.medicion_estimada)
    if (sinMed.length) { toast(`Falta medir: ${sinMed.map(p => p.nombre).join(', ')}`, 'error'); return }
    const sinMotivo = PUNTOS.filter(p => HALL[p.id]?.medicion_estimada && !String(HALL[p.id]?.motivo_estimada || '').trim())
    if (sinMotivo.length) { toast(`Escribí por qué no se pudo desmontar: ${sinMotivo.map(p => p.nombre).join(', ')}`, 'error'); return }

    // Foto del freno desmontado, salvo que TODOS los puntos de esa rueda sean excepción
    const necesita = (r) => PUNTOS.some(p => p.rueda_requerida === r && !HALL[p.id]?.medicion_estimada)
    if (necesita('del_izq') && !INSP.foto_desmontaje_del) { toast('Falta la foto del freno delantero izquierdo desmontado', 'error'); return }
    if (necesita('tras_izq') && !INSP.foto_desmontaje_tra) { toast('Falta la foto del freno trasero izquierdo desmontado', 'error'); return }

    const btn = $('mec-cerrar'); if (btn) { btn.disabled = true; btn.textContent = 'Enviando…' }
    const { data, error } = await sb().rpc('checklist_cerrar', { p_inspeccion_id: INSP.id })
    if (error) {
      toast(error.message, 'error')
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar a cotizar →' }
      return
    }
    const n = (data && data.lineas) || 0
    toast(n ? `Enviado — ${n} ítem(s) para cotizar` : 'Enviado — el carro está bien', 'success')
    INSP = null; HALL = {}
    await renderOrdenes()
  }

  window.mecVolver = async function () { INSP = null; HALL = {}; await renderOrdenes() }

  // ── 5. Mi comisión ─────────────────────────────────────────────────────────
  window.mecComision = async function () {
    const root = $('mec-root')
    root.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3,#8b949e)">Cargando…</div>'
    const yo = await cargarYo()
    const { data, error } = await sb().from('v_checklist_comision')
      .select('*').eq('mecanico_id', yo.id).order('cerrada_at', { ascending: false }).limit(200)
    if (error) { root.innerHTML = `<div class="mec-card">⚠️ ${esc(error.message)}</div>`; return }

    const rows = data || []
    const pagada = rows.filter(r => r.devengada)
    const total = pagada.reduce((s, r) => s + num(r.comision), 0)
    const pend = rows.filter(r => !r.devengada)
    const fmtL = v => 'L. ' + num(v).toLocaleString('es-HN', { minimumFractionDigits: 2 })

    root.innerHTML = `
      <div class="mec-card" style="text-align:center">
        <div style="font-size:12px;color:var(--text3,#8b949e);letter-spacing:.08em">MI COMISIÓN</div>
        <div style="font-size:34px;font-weight:800;color:var(--green,#16a34a);margin:6px 0">${fmtL(total)}</div>
        <div style="font-size:12px;color:var(--text3,#8b949e)">${pagada.length} ítem(s) vendidos · ${pend.length} esperando que el cliente autorice</div>
      </div>
      <div class="mec-sis">Vendidos</div>
      ${pagada.length ? pagada.map(r => `
        <div class="mec-card" style="padding:11px">
          <div style="display:flex;justify-content:space-between;gap:8px">
            <div style="min-width:0">
              <div style="font-size:13px">${SEV[r.severidad]?.icon || ''} ${esc(r.descripcion)}</div>
              <div style="font-size:11px;color:var(--text3,#8b949e)">${esc(r.punto)} · ${num(r.cantidad_vendida)} × ${fmtL(r.precio_base_snapshot)} de lista</div>
            </div>
            <b style="color:var(--green,#16a34a);white-space:nowrap">${fmtL(r.comision)}</b>
          </div>
        </div>`).join('')
        : '<div class="mec-card" style="text-align:center;color:var(--text3,#8b949e)">Todavía nada vendido</div>'}
      ${pend.length ? `<div class="mec-sis">Esperando autorización del cliente</div>` + pend.map(r => `
        <div class="mec-card" style="padding:11px;opacity:.65">
          <div style="font-size:13px">${SEV[r.severidad]?.icon || ''} ${esc(r.descripcion)}</div>
          <div style="font-size:11px;color:var(--text3,#8b949e)">${esc(r.punto)} · no paga hasta que el cliente autorice</div>
        </div>`).join('') : ''}
      <div style="margin-top:18px"><button class="btn btn-ghost" style="width:100%;padding:12px" onclick="initMecanico()">← Volver</button></div>`
  }
})();