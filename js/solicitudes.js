// ── CONTAMAX · Solicitudes de mejora (buzón interno) ──
// Cualquier usuario crea solicitudes y ve las suyas. El super_admin ve todas,
// cambia estado/prioridad y responde. Depende de: window._sb, window._currentProfile, window.toast
const solSb = () => window._sb
const solProfile = () => { try { return window._currentProfile?.() || {} } catch (e) { return {} } }
const solEsSuper = () => { const p = solProfile(); return (p._rolReal || p.rol) === 'super_admin' }
const solEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const solFecha = ts => { if (!ts) return ''; try { return new Date(ts).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' } }

const SOL_MODULOS = ['Cotizador', 'Yonker', 'Taxis', 'Contabilidad', 'Caja', 'Compras', 'RRHH', 'Fiscal', 'Otro']
const SOL_ESTADOS = { nueva: 'Nueva', en_revision: 'En revisión', en_progreso: 'En progreso', hecha: 'Hecha', descartada: 'Descartada' }
const SOL_ESTADO_COLOR = { nueva: '#f59e0b', en_revision: '#3b82f6', en_progreso: '#8b5cf6', hecha: '#16a34a', descartada: '#8b8f98' }
const SOL_PRIOR = { baja: 'Baja', media: 'Media', alta: 'Alta' }
const SOL_PRIOR_COLOR = { baja: '#8b8f98', media: '#f59e0b', alta: '#f85149' }

let solData = []
let solFiltroEstado = ''
let solArchivos = []   // archivos seleccionados (aún no subidos)
let solPasteReady = false

function solStyles() {
  if (document.getElementById('sol-styles')) return
  const s = document.createElement('style'); s.id = 'sol-styles'
  s.textContent = `
    #view-solicitudes .sol-wrap{max-width:920px}
    #view-solicitudes .sol-card-form,#view-solicitudes .sol-card{background:#15171c;border:1px solid #2a2e37;border-radius:12px;padding:16px;margin-bottom:14px}
    #view-solicitudes .sol-h{font-weight:700;font-size:15px;margin-bottom:4px;color:#e6e6e6}
    #view-solicitudes .sol-sub{font-size:12px;color:#8b8f98;margin-bottom:12px}
    #view-solicitudes .sol-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
    #view-solicitudes .sol-fld{display:flex;flex-direction:column;gap:4px;flex:1;min-width:160px}
    #view-solicitudes .sol-fld label{font-size:11px;color:#8b8f98;text-transform:uppercase;letter-spacing:.5px}
    #view-solicitudes .sol-inp{background:#0f1114;border:1px solid #2a2e37;border-radius:8px;padding:8px 10px;color:#e6e6e6;font-size:13px;width:100%}
    #view-solicitudes textarea.sol-inp{resize:vertical;min-height:70px}
    #view-solicitudes .sol-b{background:#0f1114;border:1px solid #2a2e37;border-radius:8px;padding:8px 14px;color:#e6e6e6;font-size:13px;cursor:pointer}
    #view-solicitudes .sol-b:hover{border-color:#3a3f4a}
    #view-solicitudes .sol-b.ok{background:#f0a500;border-color:#f0a500;color:#1a1a1a;font-weight:700}
    #view-solicitudes .sol-b.del{color:#f85149;padding:8px 10px}
    #view-solicitudes .sol-card-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px;color:#e6e6e6}
    #view-solicitudes .sol-bdg{font-size:11px;font-weight:700;padding:2px 9px;border-radius:12px}
    #view-solicitudes .sol-meta{font-size:11px;color:#8b8f98;margin:4px 0}
    #view-solicitudes .sol-desc{font-size:13px;color:#c8ccd2;margin:6px 0;white-space:pre-wrap}
    #view-solicitudes .sol-resp{font-size:13px;color:#c8ccd2;margin-top:8px;padding:8px 10px;background:rgba(22,163,74,.1);border-left:3px solid #16a34a;border-radius:6px}
    #view-solicitudes .sol-card-new{border-color:#f0a500}
    #view-solicitudes .sol-nuevo{color:#f0a500;font-size:10px}
    #view-solicitudes .sol-pri{font-size:11px}
    #view-solicitudes .sol-gest{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
    #view-solicitudes .sol-gest .sol-resp-inp{flex:1;min-width:180px}
    #view-solicitudes .sol-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
    #view-solicitudes .sol-chip{padding:4px 12px;border-radius:14px;background:#15171c;border:1px solid #2a2e37;color:#c8ccd2;font-size:12px;cursor:pointer}
    #view-solicitudes .sol-chip.on{background:#f0a500;border-color:#f0a500;color:#1a1a1a;font-weight:700}
    #view-solicitudes .sol-empty{text-align:center;color:#8b8f98;padding:22px}`
  document.head.appendChild(s)
}

window.initSolicitudes = async () => {
  solStyles()
  solArchivos = []
  solSetupPaste()
  const root = document.getElementById('view-solicitudes')
  if (!root) return
  const esSuper = solEsSuper()
  const opMod = SOL_MODULOS.map(m => `<option value="${m}">${m}</option>`).join('')
  const opPri = Object.entries(SOL_PRIOR).map(([k, v]) => `<option value="${k}" ${k === 'media' ? 'selected' : ''}>${v}</option>`).join('')
  root.innerHTML = `
    <div class="sol-wrap">
      <div class="sol-card-form">
        <div class="sol-h">🎫 Nueva solicitud de mejora</div>
        <div class="sol-sub">Contanos qué te gustaría mejorar en CONTAMAX. Lo vamos a revisar y trabajar con calma, una a una. No hace falta llamar.</div>
        <div class="sol-row">
          <div class="sol-fld" style="flex:2"><label>Título</label><input id="sol-titulo" class="sol-inp" placeholder="Ej: Agregar filtro por fecha en KM recorridos" maxlength="120"></div>
          <div class="sol-fld"><label>Módulo</label><select id="sol-modulo" class="sol-inp">${opMod}</select></div>
          <div class="sol-fld"><label>Prioridad sugerida</label><select id="sol-prior" class="sol-inp">${opPri}</select></div>
        </div>
        <div class="sol-fld" style="margin-bottom:10px"><label>Descripción / detalle</label><textarea id="sol-desc" class="sol-inp" placeholder="Explicá con detalle qué necesitás, en qué pantalla, y para qué te sirve."></textarea></div>
        <div class="sol-fld" style="margin-bottom:10px">
          <label>Adjuntos — subí archivos o pegá una captura con Ctrl+V (opcional)</label>
          <input type="file" id="sol-files" accept="image/*,application/pdf" multiple onchange="solAddArchivos(this)" style="font-size:12px;color:#c8ccd2">
          <div id="sol-preview" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"></div>
        </div>
        <div style="display:flex;justify-content:flex-end"><button class="sol-b ok" id="sol-enviar-btn" onclick="solEnviar()">Enviar solicitud</button></div>
      </div>
      <div class="sol-card-form">
        <div class="sol-h">${esSuper ? '📋 Todas las solicitudes' : '📋 Mis solicitudes'}</div>
        <div id="sol-chips"></div>
        <div id="sol-list"><div class="sol-empty">Cargando…</div></div>
      </div>
    </div>`
  await solCargar()
  await solMarcarVistas()
}

async function solCargar() {
  const cont = document.getElementById('sol-list')
  if (cont) cont.innerHTML = '<div class="sol-empty">Cargando…</div>'
  try {
    const { data, error } = await solSb().from('solicitudes_mejora').select('*').order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    solData = data || []
    solRender()
  } catch (e) {
    console.error('[solicitudes]', e)
    if (cont) cont.innerHTML = `<div class="sol-empty" style="color:#f85149">Error al cargar: ${solEsc(e.message || e)}</div>`
  }
}

function solBadgeEstado(r) {
  const c = SOL_ESTADO_COLOR[r.estado] || '#8b8f98'
  return `<span class="sol-bdg" style="background:${c}22;color:${c}">${SOL_ESTADOS[r.estado] || r.estado}</span>`
}

function solRender() {
  const cont = document.getElementById('sol-list'); if (!cont) return
  const chips = document.getElementById('sol-chips')
  const esSuper = solEsSuper()
  if (chips) {
    if (esSuper) {
      const tot = { '': solData.length }
      Object.keys(SOL_ESTADOS).forEach(k => { tot[k] = solData.filter(r => r.estado === k).length })
      chips.innerHTML = '<div class="sol-chips">' +
        `<span class="sol-chip ${solFiltroEstado === '' ? 'on' : ''}" onclick="solFiltrar('')">Todas · ${tot['']}</span>` +
        Object.entries(SOL_ESTADOS).map(([k, v]) => `<span class="sol-chip ${solFiltroEstado === k ? 'on' : ''}" onclick="solFiltrar('${k}')">${v} · ${tot[k]}</span>`).join('') +
        '</div>'
    } else chips.innerHTML = ''
  }
  let rows = solData.slice()
  if (esSuper && solFiltroEstado) rows = rows.filter(r => r.estado === solFiltroEstado)
  const _ord = { nueva: 0, en_revision: 1, en_progreso: 2, hecha: 3, descartada: 4 }
  rows.sort((a, b) => (_ord[a.estado] ?? 9) - (_ord[b.estado] ?? 9) || new Date(b.created_at) - new Date(a.created_at))
  if (!rows.length) {
    cont.innerHTML = `<div class="sol-empty">${esSuper ? 'No hay solicitudes con ese filtro.' : 'Todavía no tenés solicitudes. Creá una arriba.'}</div>`
    return
  }
  cont.innerHTML = rows.map(r => esSuper ? solCardSuper(r) : solCardUser(r)).join('')
}

function solCardUser(r) {
  const nuevo = !r.visto_por_usuario ? ' <span class="sol-nuevo">● novedad</span>' : ''
  return `<div class="sol-card ${!r.visto_por_usuario ? 'sol-card-new' : ''}">
    <div class="sol-card-h"><b>${solEsc(r.titulo)}</b> ${solBadgeEstado(r)}${nuevo}</div>
    <div class="sol-meta">${solEsc(r.modulo)} · ${solFecha(r.created_at)}${r.prioridad ? ' · prioridad ' + (SOL_PRIOR[r.prioridad] || r.prioridad) : ''}</div>
    ${r.descripcion ? `<div class="sol-desc">${solEsc(r.descripcion)}</div>` : ''}
    ${solAdjuntosHTML(r)}
    ${r.respuesta ? `<div class="sol-resp"><b>Respuesta:</b> ${solEsc(r.respuesta)}${r.atendido_por ? ' — ' + solEsc(r.atendido_por) : ''}</div>` : ''}
  </div>`
}

function solCardSuper(r) {
  const opE = Object.entries(SOL_ESTADOS).map(([k, v]) => `<option value="${k}" ${r.estado === k ? 'selected' : ''}>${v}</option>`).join('')
  const opP = ['', 'baja', 'media', 'alta'].map(k => `<option value="${k}" ${(r.prioridad || '') === k ? 'selected' : ''}>${k ? SOL_PRIOR[k] : '— prioridad —'}</option>`).join('')
  const cs = SOL_PRIOR_COLOR[r.prioridad_sugerida] || '#8b8f98'
  return `<div class="sol-card">
    <div class="sol-card-h"><b>${solEsc(r.titulo)}</b> ${solBadgeEstado(r)} <span class="sol-pri" style="color:${cs}">sugerida: ${SOL_PRIOR[r.prioridad_sugerida] || '—'}</span></div>
    <div class="sol-meta">${solEsc(r.modulo)} · ${solEsc(r.creado_por || '—')} · ${solFecha(r.created_at)}</div>
    ${r.descripcion ? `<div class="sol-desc">${solEsc(r.descripcion)}</div>` : ''}
    ${solAdjuntosHTML(r)}
    <div class="sol-gest">
      <select id="sol-est-${r.id}" class="sol-inp" style="width:auto">${opE}</select>
      <select id="sol-pri-${r.id}" class="sol-inp" style="width:auto">${opP}</select>
      <input id="sol-resp-${r.id}" class="sol-inp sol-resp-inp" placeholder="Respuesta para el usuario…" value="${solEsc(r.respuesta || '')}">
      <button class="sol-b ok" onclick="solGuardarGestion('${r.id}')">Guardar</button>
      <button class="sol-b del" onclick="solEliminar('${r.id}')">🗑</button>
    </div>
  </div>`
}

window.solFiltrar = (est) => { solFiltroEstado = est; solRender() }

window.solEnviar = async () => {
  const t = document.getElementById('sol-titulo')
  const titulo = (t?.value || '').trim()
  if (!titulo) { window.toast?.('Escribí un título', 'error'); return }
  const prof = solProfile()
  const btn = document.getElementById('sol-enviar-btn')
  if (btn) { btn.disabled = true; btn.textContent = solArchivos.length ? 'Subiendo…' : 'Enviando…' }
  try {
    const adjuntos = []
    for (let i = 0; i < solArchivos.length; i++) {
      const file = solArchivos[i]
      const safe = String(file.name || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
      const path = `${prof.auth_user_id}/${Date.now()}_${i}_${safe}`
      const { error: upErr } = await solSb().storage.from('solicitudes').upload(path, file)
      if (upErr) throw upErr
      adjuntos.push({ path, nombre: file.name, tipo: file.type || '' })
    }
    const { error } = await solSb().from('solicitudes_mejora').insert({
      titulo,
      descripcion: (document.getElementById('sol-desc')?.value || '').trim(),
      modulo: document.getElementById('sol-modulo')?.value || 'Otro',
      prioridad_sugerida: document.getElementById('sol-prior')?.value || 'media',
      creado_por: prof.nombre || '',
      creado_por_id: prof.auth_user_id,
      adjuntos
    })
    if (error) throw error
    if (t) t.value = ''
    const d = document.getElementById('sol-desc'); if (d) d.value = ''
    solArchivos = []; solRenderPreview()
    window.toast?.('✅ Solicitud enviada. La vamos a revisar con calma.', 'success')
    solCargar()
  } catch (e) { console.error('[sol enviar]', e); window.toast?.('Error al enviar: ' + (e.message || e), 'error') } finally { if (btn) { btn.disabled = false; btn.textContent = 'Enviar solicitud' } }
}

// ── Adjuntos ──
window.solAddArchivos = (input) => {
  Array.from(input.files || []).forEach(f => {
    if (f.size > 10 * 1024 * 1024) { window.toast?.(`"${f.name}" supera 10 MB`, 'error'); return }
    solArchivos.push(f)
  })
  input.value = ''
  solRenderPreview()
}
window.solQuitarArchivo = (i) => { solArchivos.splice(i, 1); solRenderPreview() }
function solRenderPreview () {
  const c = document.getElementById('sol-preview'); if (!c) return
  c.innerHTML = solArchivos.map((f, i) => {
    const esImg = (f.type || '').startsWith('image/')
    const thumb = esImg ? `<img src="${URL.createObjectURL(f)}" style="width:42px;height:42px;object-fit:cover;border-radius:6px;border:1px solid #2a2e37">` : '<span style="font-size:22px">📄</span>'
    return `<span style="display:inline-flex;align-items:center;gap:6px;background:#15171c;border:1px solid #2a2e37;border-radius:8px;padding:4px 8px;font-size:12px;color:#c8ccd2">${thumb}<span style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${solEsc(f.name)}</span><span style="cursor:pointer;color:#f85149" onclick="solQuitarArchivo(${i})">✕</span></span>`
  }).join('')
}
// Pegar captura con Ctrl+V mientras el módulo está abierto (una sola vez)
function solSetupPaste () {
  if (solPasteReady) return
  solPasteReady = true
  document.addEventListener('paste', e => {
    const view = document.getElementById('view-solicitudes')
    if (!view || !view.classList.contains('active')) return
    const item = [...(e.clipboardData?.items || [])].find(it => it.type && it.type.startsWith('image/'))
    if (!item) return
    const ae = document.activeElement
    const enTexto = ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && !['file', 'checkbox', 'radio', 'button'].includes((ae.type || 'text').toLowerCase())))
    const hayTexto = !!(e.clipboardData?.getData?.('text/plain') || '').trim()
    if (enTexto && hayTexto) return   // están pegando texto, no imagen
    const blob = item.getAsFile()
    if (!blob) return
    e.preventDefault()
    if (blob.size > 10 * 1024 * 1024) { window.toast?.('La imagen pegada supera 10 MB', 'error'); return }
    const ext = ((blob.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg')
    solArchivos.push(new File([blob], `captura_${Date.now()}.${ext}`, { type: blob.type || 'image/png' }))
    solRenderPreview()
    window.toast?.('📸 Captura pegada ✓', 'success')
  })
}
window.solAbrirAdjunto = async (path) => {
  try {
    // Descargar el blob directo — maneja rutas con espacios/caracteres raros
    const { data, error } = await solSb().storage.from('solicitudes').download(path)
    if (error || !data) throw (error || new Error('no data'))
    const url = URL.createObjectURL(data)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (e) {
    try {
      const { data, error } = await solSb().storage.from('solicitudes').createSignedUrl(path, 3600)
      if (error || !data || !data.signedUrl) throw (error || new Error('sin url'))
      window.open(data.signedUrl, '_blank')
    } catch (e2) { console.error('[sol adjunto]', e, e2); window.toast?.('No se pudo abrir el adjunto', 'error') }
  }
}
function solAdjuntosHTML (r) {
  const a = Array.isArray(r.adjuntos) ? r.adjuntos : []
  if (!a.length) return ''
  return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' + a.map(x => {
    const icon = (x.tipo || '').includes('pdf') ? '📄' : '🖼️'
    const p = String(x.path || '').replace(/'/g, "\\'")
    return `<span class="sol-chip" style="cursor:pointer" onclick="solAbrirAdjunto('${p}')">${icon} ${solEsc(x.nombre || 'archivo')}</span>`
  }).join('') + '</div>'
}

window.solGuardarGestion = async (id) => {
  if (!solEsSuper()) return
  const est = document.getElementById('sol-est-' + id)?.value
  const pri = document.getElementById('sol-pri-' + id)?.value || null
  const resp = document.getElementById('sol-resp-' + id)?.value || ''
  const prof = solProfile()
  try {
    const { error } = await solSb().from('solicitudes_mejora').update({
      estado: est, prioridad: pri, respuesta: resp,
      atendido_por: prof.nombre || '', visto_por_usuario: false, updated_at: new Date().toISOString()
    }).eq('id', id)
    if (error) throw error
    window.toast?.('Guardado', 'success'); solCargar()
  } catch (e) { console.error('[sol gestion]', e); window.toast?.('Error: ' + (e.message || e), 'error') }
}

window.solEliminar = async (id) => {
  if (!solEsSuper()) return
  if (!confirm('¿Eliminar esta solicitud definitivamente?')) return
  try { const { error } = await solSb().from('solicitudes_mejora').delete().eq('id', id); if (error) throw error; solCargar() } catch (e) { window.toast?.('Error: ' + (e.message || e), 'error') }
}

async function solMarcarVistas() {
  const prof = solProfile()
  if (!prof.auth_user_id) return
  try {
    await solSb().from('solicitudes_mejora').update({ visto_por_usuario: true })
      .eq('creado_por_id', prof.auth_user_id).eq('visto_por_usuario', false)
    window.initSolicitudesBadge?.()
  } catch (e) { /* silencioso */ }
}

window.initSolicitudesBadge = async () => {
  const badge = document.getElementById('badge-solicitudes')
  if (!badge || !solSb()) return
  const prof = solProfile()
  try {
    let n = 0
    if (solEsSuper()) {
      const { count } = await solSb().from('solicitudes_mejora').select('id', { count: 'exact', head: true }).eq('estado', 'nueva')
      n = count || 0
    } else if (prof.auth_user_id) {
      const { count } = await solSb().from('solicitudes_mejora').select('id', { count: 'exact', head: true }).eq('creado_por_id', prof.auth_user_id).eq('visto_por_usuario', false)
      n = count || 0
    }
    if (n > 0) { badge.classList.remove('hidden'); badge.textContent = n } else badge.classList.add('hidden')
  } catch (e) { /* silencioso */ }
}