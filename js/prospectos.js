/* ============================================================================
 * CONTAMAX · prospectos.js
 *
 * PROSPECCIÓN DE TALLERES — la herramienta del vendedor en ruta.
 *
 * Pensada para el CELULAR, parado en la puerta del taller:
 *   · Un toque para tomar la ubicación GPS (de ahí sale el link de Maps solo).
 *   · Un toque para la cámara. Las fotos se COMPRIMEN antes de subir: una foto
 *     de celular pesa 4 MB y con datos móviles eso no sube nunca. A 1280px y
 *     calidad 0.72 quedan en ~200 KB y se ven igual de bien en la ficha.
 *   · Botones grandes, una sola columna, nada de tablas anchas.
 *
 * Un taller es UNA ficha; cada pasada es una VISITA. Volver al mismo taller no
 * duplica nada: le suma una visita y queda el historial.
 * ========================================================================== */
window.__prospBuild = '20260720a'

;(function () {
  const sb = () => window._sb
  const esc = t => String(t ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
  const toast = (m, t) => window.toast?.(m, t)

  // Teléfono → wa.me (Honduras: 8 dígitos llevan 504 adelante)
  const normTel = t => { let n = String(t || '').replace(/\D/g, ''); if (n && n.length <= 8) n = '504' + n; return n }

  let TAB = 'talleres'
  let TALLERES = []
  let VISITAS = {}          // taller_id → visitas
  let BITACORA = []
  let USUARIOS = {}         // usuario_id → nombre
  let ABIERTO = null        // ficha desplegada
  let F = { q: '', zona: '', tipo: '', estado: '' }

  const TIPOS = [['mecanica', '🔧 Mecánica'], ['pintura', '🎨 Pintura'], ['ambos', '🔧🎨 Ambos'], ['otro', 'Otro']]
  const ESTADOS = [
    ['nuevo', 'Nuevo', '#8b949e'],
    ['interesado', 'Interesado', '#c8a24a'],
    ['cliente', 'Cliente', '#4e7a51'],
    ['descartado', 'Descartado', '#b4472f']
  ]
  const etTipo = t => (TIPOS.find(x => x[0] === t) || ['', t])[1]
  const etEstado = e => ESTADOS.find(x => x[0] === e) || ['', e, '#8b949e']

  const puede = () => {
    const p = (window._currentProfile ? window._currentProfile() : null) || {}
    const rol = p._rolReal || p.rol
    if (['super_admin', 'admin', 'gerencia', 'vendedor_ruta', 'cotizador', 'jefe_pista'].includes(rol)) return true
    return Array.isArray(p.permisos_modulos) ? p.permisos_modulos.includes('nav-prospectos') : false
  }

  // ── Carga ────────────────────────────────────────────────────────────────
  window.initProspectos = async function () {
    const root = document.getElementById('view-prospectos')
    if (!root) return
    root.innerHTML = '<div style="padding:24px;color:#8b949e">Cargando…</div>'
    try { await cargar(); render() } catch (e) {
      root.innerHTML = `<div style="padding:24px;color:#f85149">Error: ${esc(e.message || e)}</div>`
    }
  }

  async function cargar () {
    const [rt, rb, ru] = await Promise.all([
      sb().from('v_prosp_talleres').select('*').eq('activo', true).order('nombre'),
      sb().from('v_prosp_bitacora').select('*').order('dia', { ascending: false }).limit(60),
      sb().from('usuarios').select('id,nombre')
    ])
    if (rt.error) throw rt.error
    TALLERES = rt.data || []
    BITACORA = rb.error ? [] : (rb.data || [])
    USUARIOS = {}
    for (const u of (ru.data || [])) USUARIOS[u.id] = u.nombre
  }

  const quien = id => USUARIOS[id] || '—'

  // ── Render ───────────────────────────────────────────────────────────────
  function render () {
    const root = document.getElementById('view-prospectos')
    if (!root) return
    if (!puede()) { root.innerHTML = '<div style="padding:24px;color:#f85149">No tenés permiso sobre este módulo.</div>'; return }
    const tab = (k, t) => `<button onclick="prospTab('${k}')" style="flex:1;background:${TAB === k ? '#c8a24a' : 'transparent'};color:${TAB === k ? '#15171c' : '#8b949e'};border:1px solid ${TAB === k ? '#c8a24a' : '#2a2e37'};border-radius:9px;padding:10px;cursor:pointer;font-size:13.5px;font-weight:600">${t}</button>`

    root.innerHTML = `
      <div style="padding:14px 14px 30px;max-width:760px;margin:0 auto">
        <div style="display:flex;gap:8px;margin-bottom:12px">
          ${tab('talleres', `🏪 Talleres (${TALLERES.length})`)}
          ${tab('bitacora', '📋 Bitácora')}
        </div>
        <div id="prosp-body"></div>
      </div>`
    pintar()
  }

  window.prospTab = function (k) { TAB = k; ABIERTO = null; render() }

  function pintar () {
    const b = document.getElementById('prosp-body')
    if (b) b.innerHTML = TAB === 'talleres' ? vistaTalleres() : vistaBitacora()
  }

  // ── TALLERES ─────────────────────────────────────────────────────────────
  function filtrados () {
    const q = F.q.trim().toUpperCase()
    return TALLERES.filter(t => {
      if (F.zona && (t.zona || '') !== F.zona) return false
      if (F.tipo && t.tipo !== F.tipo) return false
      if (F.estado && t.estado !== F.estado) return false
      if (!q) return true
      return [t.nombre, t.dueno, t.zona, t.telefono, t.direccion, t.ultimos_carros]
        .some(v => String(v || '').toUpperCase().includes(q))
    })
  }

  function vistaTalleres () {
    const zonas = [...new Set(TALLERES.map(t => t.zona).filter(Boolean))].sort()
    const vis = filtrados()

    const chip = (activo, txt, onclick) =>
      `<button onclick="${onclick}" style="background:${activo ? '#c8a24a22' : 'transparent'};border:1px solid ${activo ? '#c8a24a' : '#2a2e37'};color:${activo ? '#c8a24a' : '#8b949e'};border-radius:14px;padding:5px 12px;cursor:pointer;font-size:12px;white-space:nowrap">${txt}</button>`

    const cards = vis.map(t => {
      const e = etEstado(t.estado)
      const abierta = ABIERTO === t.id
      const fotos = Array.isArray(t.ultimas_fotos) ? t.ultimas_fotos : []
      const sinVisitar = t.dias_sin_visitar
      return `
      <div style="background:#15171c;border:1px solid ${abierta ? '#c8a24a' : '#2a2e37'};border-radius:12px;margin-bottom:10px;overflow:hidden">
        <div onclick="prospAbrir(${t.id})" style="padding:12px 14px;cursor:pointer">
          <div style="display:flex;align-items:start;gap:10px">
            <div style="flex:1;min-width:0">
              <div style="color:#e6edf3;font-weight:600;font-size:15px;line-height:1.25">${esc(t.nombre)}</div>
              <div style="color:#6e7681;font-size:11.5px;margin-top:3px">
                ${esc(etTipo(t.tipo))}${t.zona ? ' · 📍 ' + esc(t.zona) : ''}
              </div>
            </div>
            <span style="background:${e[2]}22;color:${e[2]};border:1px solid ${e[2]}66;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap">${e[1]}</span>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;font-size:11.5px;color:#8b949e">
            <span>👤 ${esc(t.dueno || 'sin contacto')}</span>
            <span>🔁 ${t.visitas} visita${t.visitas === 1 ? '' : 's'}</span>
            ${sinVisitar != null ? `<span style="color:${sinVisitar > 60 ? '#f0a868' : '#8b949e'}">hace ${sinVisitar} día${sinVisitar === 1 ? '' : 's'}</span>` : ''}
          </div>
          ${fotos.length ? `<div style="display:flex;gap:5px;margin-top:9px;overflow-x:auto">
            ${fotos.slice(0, 3).map(f => `<img src="${esc(f.url)}" style="width:74px;height:56px;object-fit:cover;border-radius:7px;flex:0 0 auto" loading="lazy">`).join('')}
          </div>` : ''}
        </div>
        ${abierta ? detalle(t) : ''}
      </div>`
    }).join('')

    return `
      <input id="prosp-q" value="${esc(F.q)}" oninput="prospBuscar(this.value)" placeholder="🔍 Buscar taller, dueño, zona, carro…"
             style="width:100%;background:#0d1117;border:1px solid #2a2e37;border-radius:10px;color:#e6edf3;padding:11px 13px;font-size:14px;margin-bottom:10px">
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:4px">
        ${chip(!F.zona && !F.tipo && !F.estado, 'Todos', "prospFiltro('reset','')")}
        ${ESTADOS.map(e => chip(F.estado === e[0], e[1], `prospFiltro('estado','${e[0]}')`)).join('')}
        ${TIPOS.map(t => chip(F.tipo === t[0], t[1], `prospFiltro('tipo','${t[0]}')`)).join('')}
        ${zonas.map(z => chip(F.zona === z, '📍 ' + esc(z), `prospFiltro('zona','${esc(z).replace(/'/g, "\\'")}')`)).join('')}
      </div>
      <button onclick="prospNuevo()" style="width:100%;background:#c8a24a;color:#15171c;border:0;border-radius:10px;padding:13px;cursor:pointer;font-size:14.5px;font-weight:700;margin-bottom:12px">+ Nuevo taller</button>
      ${vis.length !== TALLERES.length ? `<div style="color:#6e7681;font-size:11.5px;margin-bottom:8px">Mostrando ${vis.length} de ${TALLERES.length}</div>` : ''}
      ${cards || '<div style="background:#15171c;border:1px dashed #2a2e37;border-radius:12px;padding:30px 20px;text-align:center;color:#6e7681;font-size:13px">No hay talleres que coincidan.</div>'}`
  }

  function detalle (t) {
    const vs = VISITAS[t.id]
    const tel = normTel(t.telefono)
    const bt = (txt, onclick, color) =>
      `<button onclick="${onclick}" style="flex:1;min-width:96px;background:#1c2027;border:1px solid #2a2e37;color:${color || '#8b949e'};border-radius:8px;padding:9px;cursor:pointer;font-size:12.5px">${txt}</button>`

    return `
      <div style="border-top:1px solid #21262d;padding:12px 14px;background:#0f1115">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:11px">
          ${tel.length >= 11 ? bt('💬 WhatsApp', `prospWA('${tel}','${esc(t.nombre).replace(/'/g, "\\'")}')`, '#25D366') : ''}
          ${t.telefono ? bt('📞 Llamar', `window.open('tel:${esc(t.telefono)}')`) : ''}
          ${t.mapa ? bt('🗺️ Mapa', `window.open('${esc(t.mapa)}','_blank')`) : bt('📍 Tomar GPS', `prospGPS(${t.id})`, '#c8a24a')}
        </div>
        <div style="font-size:12.5px;color:#8b949e;line-height:1.7">
          ${t.telefono ? `<div>📱 ${esc(t.telefono)}</div>` : ''}
          ${t.direccion ? `<div>🏠 ${esc(t.direccion)}</div>` : ''}
          ${t.ultimos_carros ? `<div style="margin-top:6px"><span style="color:#6e7681">Carros vistos:</span> <span style="color:#e6edf3">${esc(t.ultimos_carros)}</span></div>` : ''}
          ${t.ultima_observacion ? `<div style="margin-top:4px"><span style="color:#6e7681">Última nota:</span> ${esc(t.ultima_observacion)}</div>` : ''}
          ${t.notas ? `<div style="margin-top:4px;color:#6e7681">📝 ${esc(t.notas)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
          <button onclick="prospVisita(${t.id})" style="flex:2;min-width:150px;background:#c8a24a;color:#15171c;border:0;border-radius:9px;padding:11px;cursor:pointer;font-size:13.5px;font-weight:700">📷 Registrar visita</button>
          ${bt('✏️ Editar', `prospEditar(${t.id})`)}
        </div>
        <div style="margin-top:12px">
          <button onclick="prospHistorial(${t.id})" style="background:none;border:0;color:#c8a24a;cursor:pointer;font-size:12.5px;padding:0">
            ${vs ? '▾' : '▸'} Historial de visitas (${t.visitas})
          </button>
          ${vs ? `<div style="margin-top:8px">${vs.length ? vs.map(v => `
            <div style="border-left:2px solid #2a2e37;padding:6px 0 6px 10px;margin-bottom:8px">
              <div style="color:#6e7681;font-size:11px">
                ${new Date(v.fecha).toLocaleString('es-HN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                · ${esc(quien(v.usuario_id))}${v.atendido ? '' : ' · <span style="color:#f0a868">no lo atendieron</span>'}
              </div>
              ${v.carros ? `<div style="color:#e6edf3;font-size:12.5px;margin-top:3px">🚗 ${esc(v.carros)}</div>` : ''}
              ${v.observaciones ? `<div style="color:#8b949e;font-size:12.5px;margin-top:2px">${esc(v.observaciones)}</div>` : ''}
              ${(v.fotos || []).length ? `<div style="display:flex;gap:5px;margin-top:6px;overflow-x:auto">
                ${v.fotos.map(f => `<img src="${esc(f.url)}" onclick="window.open('${esc(f.url)}','_blank')" style="width:66px;height:50px;object-fit:cover;border-radius:6px;cursor:pointer;flex:0 0 auto" loading="lazy">`).join('')}
              </div>` : ''}
              <button onclick="prospVisitaBorrar(${v.id},${t.id})" style="background:none;border:0;color:#f85149;cursor:pointer;font-size:11px;padding:2px 0;margin-top:3px">borrar</button>
            </div>`).join('') : '<div style="color:#6e7681;font-size:12px">Sin visitas registradas.</div>'}</div>` : ''}
        </div>
      </div>`
  }

  window.prospBuscar = function (v) {
    F.q = v
    const b = document.getElementById('prosp-body')
    if (!b) return
    // Repintar solo la lista para no perder el foco del buscador
    const cur = document.activeElement
    b.innerHTML = vistaTalleres()
    const nq = document.getElementById('prosp-q')
    if (nq && cur && cur.id === 'prosp-q') { nq.focus(); nq.setSelectionRange(v.length, v.length) }
  }

  window.prospFiltro = function (k, v) {
    if (k === 'reset') { F.zona = ''; F.tipo = ''; F.estado = '' }
    else F[k] = F[k] === v ? '' : v
    ABIERTO = null; pintar()
  }

  window.prospAbrir = function (id) { ABIERTO = ABIERTO === id ? null : id; pintar() }

  window.prospWA = function (tel, nombre) {
    const msg = `Buenos días, le saluda Tecnimax. Pasamos por ${nombre} y quedamos a la orden para repuestos y servicio.`
    window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank')
  }

  window.prospHistorial = async function (id) {
    if (VISITAS[id]) { delete VISITAS[id]; pintar(); return }
    try {
      const { data, error } = await sb().from('prosp_visitas').select('*')
        .eq('taller_id', id).order('fecha', { ascending: false }).order('id', { ascending: false })
      if (error) throw new Error(error.message)
      VISITAS[id] = data || []
      pintar()
    } catch (e) { toast(e.message, 'error') }
  }

  // ── BITÁCORA ─────────────────────────────────────────────────────────────
  function vistaBitacora () {
    const porDia = {}
    for (const b of BITACORA) (porDia[b.dia] = porDia[b.dia] || []).push(b)
    const dias = Object.keys(porDia).sort().reverse()
    if (!dias.length) return '<div style="background:#15171c;border:1px dashed #2a2e37;border-radius:12px;padding:30px;text-align:center;color:#6e7681;font-size:13px">Todavía no hay visitas registradas.</div>'

    return dias.map(d => {
      const filas = porDia[d]
      const tot = filas.reduce((a, f) => a + f.visitas, 0)
      return `
      <div style="background:#15171c;border:1px solid #2a2e37;border-radius:12px;padding:12px 14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b style="color:#e6edf3;font-size:14px">${new Date(d + 'T12:00:00').toLocaleDateString('es-HN', { weekday: 'long', day: '2-digit', month: 'long' })}</b>
          <span style="color:#c8a24a;font-weight:700;font-size:14px">${tot} visita${tot === 1 ? '' : 's'}</span>
        </div>
        ${filas.map(f => `
          <div style="display:flex;justify-content:space-between;padding:5px 0;border-top:1px solid #21262d;font-size:12.5px">
            <span style="color:#e6edf3">${esc(quien(f.usuario_id))}</span>
            <span style="color:#8b949e">
              ${f.talleres} taller${f.talleres === 1 ? '' : 'es'} · ${f.atendidas}/${f.visitas} atendidas ·
              ${new Date(f.primera).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' })}–${new Date(f.ultima).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>`).join('')}
      </div>`
    }).join('')
  }

  // ── GPS ──────────────────────────────────────────────────────────────────
  function tomarGPS () {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('Este dispositivo no tiene GPS disponible'))
      navigator.geolocation.getCurrentPosition(
        p => res({ lat: +p.coords.latitude.toFixed(7), lng: +p.coords.longitude.toFixed(7), precision: Math.round(p.coords.accuracy) }),
        e => rej(new Error(e.code === 1 ? 'Diste "bloquear" a la ubicación. Habilitala en el candado de la barra de direcciones.' : 'No se pudo obtener la ubicación')),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
    })
  }

  window.prospGPS = async function (id) {
    toast('Buscando ubicación…')
    try {
      const g = await tomarGPS()
      await rpc('prosp_taller_ubicacion', { p_id: id, p_lat: g.lat, p_lng: g.lng })
      await recargar(`Ubicación guardada (±${g.precision} m)`)
    } catch (e) { toast(e.message, 'error') }
  }

  // ── FOTOS: comprimir y subir ─────────────────────────────────────────────
  // Una foto de celular pesa 3-5 MB. Con datos móviles en la calle eso no sube.
  // Se reduce a 1280px y calidad 0.72: quedan ~200 KB y se ven bien en la ficha.
  async function comprimir (file, max = 1280, calidad = 0.72) {
    try {
      const img = await createImageBitmap(file)
      const escala = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * escala), h = Math.round(img.height * escala)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', calidad))
      return blob && blob.size < file.size ? blob : file
    } catch (e) { return file }   // si el navegador no puede, se sube tal cual
  }

  async function subirFotos (tallerId, files, onProgreso) {
    const out = []
    for (let i = 0; i < files.length; i++) {
      if (onProgreso) onProgreso(i + 1, files.length)
      const blob = await comprimir(files[i])
      // Nombre único con Date.now(): siempre es INSERT, nunca UPDATE.
      // (upsert:true forzaría el camino de UPDATE y la policy lo rechaza)
      const path = `t${tallerId}/${Date.now()}_${i}.jpg`
      const { error } = await sb().storage.from('talleres-fotos')
        .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600' })
      if (error) throw new Error('No se pudo subir la foto: ' + error.message)
      const { data } = sb().storage.from('talleres-fotos').getPublicUrl(path)
      out.push({ path, url: data.publicUrl })
    }
    return out
  }

  // ── Modal genérico ───────────────────────────────────────────────────────
  function modal (titulo, campos, onOk, sub) {
    document.getElementById('prosp-modal')?.remove()
    const ov = document.createElement('div')
    ov.id = 'prosp-modal'
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10060;display:flex;align-items:flex-end;justify-content:center;padding:0'
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove() })
    const base = 'width:100%;background:#0d1117;border:1px solid #2a2e37;border-radius:9px;color:#e6edf3;padding:11px 12px;font-size:15px;margin-top:5px'
    const inputs = campos.map(c => {
      const id = 'pm-' + c.k
      let ctrl
      if (c.tipo === 'select') {
        ctrl = `<select id="${id}" style="${base}">${(c.opciones || []).map(o => `<option value="${esc(o[0])}"${String(c.valor) === String(o[0]) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`
      } else if (c.tipo === 'area') {
        ctrl = `<textarea id="${id}" rows="3" placeholder="${esc(c.ph || '')}" style="${base};font-family:inherit;resize:vertical">${esc(c.valor || '')}</textarea>`
      } else if (c.tipo === 'fotos') {
        ctrl = `<input id="${id}" type="file" accept="image/*" capture="environment" multiple style="${base};padding:9px">`
      } else if (c.tipo === 'gps') {
        ctrl = `<button type="button" id="${id}-btn" onclick="prospGPSCampo('${id}')" style="${base};background:#1c2027;color:#c8a24a;cursor:pointer;text-align:left">📍 Tomar ubicación acá</button><input id="${id}" type="hidden">`
      } else if (c.tipo === 'check') {
        ctrl = `<label style="display:flex;align-items:center;gap:9px;margin-top:6px;cursor:pointer"><input id="${id}" type="checkbox" ${c.valor ? 'checked' : ''} style="width:20px;height:20px"><span style="font-size:14px;color:#e6edf3">${esc(c.textoCheck || '')}</span></label>`
      } else {
        ctrl = `<input id="${id}" type="${c.tipo === 'tel' ? 'tel' : 'text'}" value="${esc(c.valor ?? '')}" placeholder="${esc(c.ph || '')}" style="${base}">`
      }
      return `<div style="margin-bottom:13px">
        ${c.tipo === 'check' ? '' : `<label style="font-size:11.5px;color:#8b949e;text-transform:uppercase;letter-spacing:.4px">${esc(c.label)}</label>`}
        ${ctrl}
        ${c.hint ? `<div style="font-size:11px;color:#6e7681;margin-top:3px">${esc(c.hint)}</div>` : ''}
      </div>`
    }).join('')

    ov.innerHTML = `
      <div style="background:#15171c;border:1px solid #2a2e37;border-radius:16px 16px 0 0;max-width:600px;width:100%;padding:18px 16px 22px;color:#e6edf3;max-height:92vh;overflow:auto">
        <div style="width:38px;height:4px;background:#2a2e37;border-radius:2px;margin:0 auto 14px"></div>
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:3px">
          <b style="font-size:16px">${esc(titulo)}</b>
          <button onclick="document.getElementById('prosp-modal').remove()" style="background:none;border:0;color:#8b8f98;font-size:24px;cursor:pointer;line-height:1">×</button>
        </div>
        ${sub ? `<div style="color:#8b949e;font-size:12.5px;margin-bottom:14px">${esc(sub)}</div>` : '<div style="height:10px"></div>'}
        ${inputs}
        <div id="pm-msg" style="font-size:12.5px;min-height:17px;margin-bottom:4px"></div>
        <button id="pm-ok" style="width:100%;background:#c8a24a;color:#15171c;border:0;border-radius:10px;padding:14px;cursor:pointer;font-size:15px;font-weight:700">Guardar</button>
      </div>`
    document.body.appendChild(ov)

    const leer = () => {
      const v = {}
      for (const c of campos) {
        const el = document.getElementById('pm-' + c.k)
        if (!el) continue
        if (c.tipo === 'fotos') v[c.k] = el.files ? Array.from(el.files) : []
        else if (c.tipo === 'check') v[c.k] = el.checked
        else if (c.tipo === 'gps') v[c.k] = el.value ? JSON.parse(el.value) : null
        else v[c.k] = el.value
      }
      return v
    }
    const ok = ov.querySelector('#pm-ok')
    const msg = ov.querySelector('#pm-msg')
    ok.onclick = async () => {
      ok.disabled = true; ok.textContent = 'Guardando…'
      try {
        const cerrar = await onOk(leer(), (t) => { msg.style.color = '#8b949e'; msg.textContent = t })
        if (cerrar !== false) ov.remove()
      } catch (e) {
        msg.style.color = '#f85149'; msg.textContent = e.message || String(e)
      }
      ok.disabled = false; ok.textContent = 'Guardar'
    }
  }

  window.prospGPSCampo = async function (id) {
    const btn = document.getElementById(id + '-btn')
    if (btn) { btn.textContent = '📍 Buscando…'; btn.disabled = true }
    try {
      const g = await tomarGPS()
      document.getElementById(id).value = JSON.stringify(g)
      if (btn) { btn.textContent = `✓ Ubicación tomada (±${g.precision} m)`; btn.style.color = '#4e7a51' }
    } catch (e) {
      if (btn) { btn.textContent = '📍 Tomar ubicación acá'; btn.style.color = '#c8a24a' }
      toast(e.message, 'error')
    }
    if (btn) btn.disabled = false
  }

  async function rpc (fn, args) {
    const { data, error } = await sb().rpc(fn, args)
    if (error) throw new Error(error.message)
    if (data && data.ok === false) throw new Error(data.mensaje || 'No se pudo guardar')
    return data
  }

  async function recargar (msg) {
    await cargar(); render()
    if (msg) toast(msg, 'success')
  }

  // ── Acciones ─────────────────────────────────────────────────────────────
  window.prospNuevo = function () {
    modal('Nuevo taller', [
      { k: 'nombre', label: 'Nombre del taller', ph: 'Ej: Taller El Buen Motor' },
      { k: 'dueno', label: 'Dueño o responsable', ph: 'Con quién se habló' },
      { k: 'telefono', label: 'Teléfono', tipo: 'tel', ph: '9704-5242' },
      { k: 'tipo', label: 'Tipo de taller', tipo: 'select', valor: 'mecanica', opciones: TIPOS },
      { k: 'zona', label: 'Zona', ph: 'Choloma, SPS centro, La Lima…' },
      { k: 'direccion', label: 'Dirección / referencia', ph: 'Frente a la gasolinera Uno' },
      { k: 'gps', label: 'Ubicación', tipo: 'gps', hint: 'Tocalo parado frente al taller: el link de Maps se arma solo.' },
      { k: 'notas', label: 'Notas', tipo: 'area', ph: 'Tiene 4 rampas, atiende de 7 a 5…' }
    ], async (v) => {
      if (!v.nombre || v.nombre.trim().length < 3) throw new Error('Poné el nombre del taller')
      const d = await rpc('prosp_taller_crear', {
        p_nombre: v.nombre.trim(),
        p_dueno: (v.dueno || '').trim() || null,
        p_telefono: (v.telefono || '').trim() || null,
        p_tipo: v.tipo,
        p_zona: (v.zona || '').trim() || null,
        p_direccion: (v.direccion || '').trim() || null,
        p_lat: v.gps ? v.gps.lat : null,
        p_lng: v.gps ? v.gps.lng : null,
        p_maps_url: null,
        p_notas: (v.notas || '').trim() || null
      })
      if (d.posibles_duplicados && d.posibles_duplicados.length) {
        toast(`⚠ Ojo: ya existe "${d.posibles_duplicados[0].nombre}" con ese nombre o teléfono`, 'error')
      }
      await recargar('Taller guardado')
      // Encadenar la visita: es lo que sigue naturalmente estando en la puerta
      ABIERTO = d.id; pintar()
      setTimeout(() => window.prospVisita(d.id), 250)
    }, 'Todo menos el nombre se puede completar después.')
  }

  window.prospVisita = function (tallerId) {
    const t = TALLERES.find(x => x.id === tallerId)
    modal('📷 Registrar visita', [
      { k: 'atendido', label: '', tipo: 'check', valor: true, textoCheck: 'Sí me atendieron' },
      { k: 'carros', label: 'Carros que vio', tipo: 'area', ph: 'Toyota Hilux 2018, 2 Corolla, Frontier 2015…',
        hint: 'Marcas, modelos y años. Esto es oro para saber qué repuestos ofrecerle.' },
      { k: 'obs', label: 'Observaciones', tipo: 'area', ph: 'Qué necesita, dónde compra hoy, qué le interesó…' },
      { k: 'fotos', label: 'Fotos del taller', tipo: 'fotos', hint: 'Podés tomar 2 o 3. Se comprimen solas antes de subir.' },
      { k: 'gps', label: 'Ubicación', tipo: 'gps' }
    ], async (v, prog) => {
      let fotos = []
      if (v.fotos && v.fotos.length) {
        if (v.fotos.length > 5) throw new Error('Máximo 5 fotos por visita')
        fotos = await subirFotos(tallerId, v.fotos, (i, n) => prog(`Subiendo foto ${i} de ${n}…`))
      }
      await rpc('prosp_visita_registrar', {
        p_taller_id: tallerId,
        p_carros: (v.carros || '').trim() || null,
        p_observaciones: (v.obs || '').trim() || null,
        p_atendido: !!v.atendido,
        p_fotos: fotos,
        p_lat: v.gps ? v.gps.lat : null,
        p_lng: v.gps ? v.gps.lng : null
      })
      delete VISITAS[tallerId]
      await recargar('Visita registrada')
      ABIERTO = tallerId; pintar()
    }, t ? t.nombre : '')
  }

  window.prospEditar = function (id) {
    const t = TALLERES.find(x => x.id === id); if (!t) return
    modal('Editar taller', [
      { k: 'nombre', label: 'Nombre', valor: t.nombre },
      { k: 'dueno', label: 'Dueño o responsable', valor: t.dueno || '' },
      { k: 'telefono', label: 'Teléfono', tipo: 'tel', valor: t.telefono || '' },
      { k: 'tipo', label: 'Tipo', tipo: 'select', valor: t.tipo, opciones: TIPOS },
      { k: 'estado', label: 'Estado del prospecto', tipo: 'select', valor: t.estado, opciones: ESTADOS.map(e => [e[0], e[1]]) },
      { k: 'zona', label: 'Zona', valor: t.zona || '' },
      { k: 'direccion', label: 'Dirección', valor: t.direccion || '' },
      { k: 'maps_url', label: 'Link de Google Maps', valor: t.maps_url || '', hint: 'Solo si el taller ya tiene ficha en Maps. El GPS tiene prioridad.' },
      { k: 'notas', label: 'Notas', tipo: 'area', valor: t.notas || '' }
    ], async v => {
      if (!v.nombre || v.nombre.trim().length < 3) throw new Error('Poné el nombre')
      const campos = [['nombre', v.nombre], ['dueno', v.dueno], ['telefono', v.telefono], ['tipo', v.tipo],
        ['estado', v.estado], ['zona', v.zona], ['direccion', v.direccion], ['maps_url', v.maps_url], ['notas', v.notas]]
      for (const [c, val] of campos) {
        await rpc('prosp_taller_editar', { p_id: id, p_campo: c, p_valor: String(val ?? '') })
      }
      await recargar('Guardado')
      ABIERTO = id; pintar()
    })
  }

  window.prospVisitaBorrar = async function (visitaId, tallerId) {
    if (!confirm('¿Borrar esta visita?')) return
    try {
      await rpc('prosp_visita_eliminar', { p_id: visitaId })
      delete VISITAS[tallerId]
      await recargar('Visita borrada')
      ABIERTO = tallerId
      await window.prospHistorial(tallerId)
    } catch (e) { toast(e.message, 'error') }
  }
})()