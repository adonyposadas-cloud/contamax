// ═══════════════════════════════════════════════════════════════
//  export_fiscal.js · Exportar a fiscal
//  Genera un .zip (lote.json + fotos) con SOLO lo fiscal de un rango de
//  fechas, para importarlo en el sistema fiscal aparte.
//  · Solo líneas con aplica_fiscal, monto > 0 y centro que no sea 'personal'
//    (opcional: excluir también centros privados).
//  · Una partida se puede exportar solo si sus líneas fiscales cuadran, o si
//    la diferencia es justo lo excluido y se eligió una cuenta de ajuste
//    (p. ej. la del socio): entonces viaja con una línea de ajuste.
//  · "Ocultar en descripciones": textos que se quitan/reemplazan al exportar.
//  · No viajan ids, números de partida, usuarios ni rutas de este sistema:
//    las referencias son huellas SHA-256 con sal (REF_SAL).
//  · Solo super_admin (rol real).
// ═══════════════════════════════════════════════════════════════
(function () {
  const REF_SAL = 'tmx-fiscal-v1'   // NO cambiar: cambiaría todas las huellas y duplicaría al reimportar
  const BUCKET = 'facturas-compras'
  const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'

  const getSb = () => window._sb
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const r2 = (v) => Math.round((+v || 0) * 100) / 100
  const fmt = (v) => r2(v).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  let efPartidas = []        // partidas analizadas (ver analizar())
  let efSel = new Set()      // ids seleccionados
  let efCentros = {}         // id → centro
  let efCuentas = {}         // id → cuenta
  let efCuentasCod = {}      // codigo → cuenta
  let efLibros = { ventas: [], compras: [] }
  let efAbierta = null       // id de la partida con el detalle abierto

  const esSuperAdmin = () => {
    const p = (window._currentProfile?.() || {})
    return (p._rolReal || p.rol) === 'super_admin'
  }

  async function sha256(texto) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  }
  const huella = (tipo, clave) => sha256(`${REF_SAL}|${tipo}|${clave}`)

  // Supabase devuelve máx. 1000 filas por consulta: paginar.
  async function todas(armar) {
    const out = []
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await armar().range(desde, desde + 999)
      if (error) throw error
      out.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    return out
  }
  async function porLotes(ids, armar) {
    const out = []
    for (let i = 0; i < ids.length; i += 150) out.push(...await todas(() => armar(ids.slice(i, i + 150))))
    return out
  }

  function centroExcluido(ccId) {
    if (!ccId) return null
    const c = efCentros[ccId]
    if (!c) return null
    if (c.tipo_actividad === 'personal') return 'centro personal'
    if ($('ef-excl-privados')?.checked && c.privado) return 'centro privado'
    return null
  }

  function motivoExclusion(l) {
    if (!l.aplica_fiscal) return 'no fiscal'
    if (!(+l.monto > 0)) return 'monto 0'
    return centroExcluido(l.centro_costo_id)
  }

  // ── Preferencias (por navegador): cuenta de ajuste y palabras a ocultar ──
  const PREF_KEY = 'ef-config'
  function leerPref() { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {} } catch (e) { return {} } }
  function guardarPref() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        cuadrar: $('ef-cuadrar').checked, cuadrarCta: $('ef-cuadrar-cta').value, ocultar: $('ef-ocultar').value,
      }))
    } catch (e) { /* sin almacenamiento: no pasa nada */ }
  }

  // Cuenta contra la que se cuadra lo excluido (p. ej. cuenta del socio).
  function cuentaAjuste() {
    if (!$('ef-cuadrar')?.checked) return null
    const c = efCuentasCod[String($('ef-cuadrar-cta').value || '').split('·')[0].trim()]
    return c && c.es_detalle !== false ? c : null
  }

  // Reglas "texto" o "texto = reemplazo", una por línea. Sin reemplazo se quita.
  function reglasOcultar() {
    return String($('ef-ocultar')?.value || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => {
      const [de, ...a] = s.split('=')
      const txt = de.trim()
      return txt ? { re: new RegExp(txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), por: a.join('=').trim() } : null
    }).filter(Boolean)
  }
  function limpiar(texto, reglas = reglasOcultar()) {
    if (texto == null || !reglas.length) return texto
    let t = String(texto)
    for (const r of reglas) t = t.replace(r.re, r.por)
    return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/([,;])\s*(?=[,;])/g, '').replace(/^[\s,;.·-]+|[\s,;·-]+$/g, '').trim()
  }
  const tieneOcultable = (p, reglas) => reglas.length && [p.descripcion, ...p.lineas.map(l => l.descripcion)]
    .some(t => t && reglas.some(r => { r.re.lastIndex = 0; return r.re.test(t) }))

  // p.estadoOrigen = estado en este sistema (aprobada/anulada).
  // estado = estado para el fiscal: ok | descuadre | sin | anulada.
  // ajuste: línea extra que cuadra lo excluido contra la cuenta de ajuste. Solo
  // se arma si la partida COMPLETA cuadra aquí (la diferencia es exactamente
  // lo que se dejó fuera); si no, sigue como "descuadre".
  function analizar(p, lineas) {
    const fiscales = lineas.filter(l => !motivoExclusion(l))
    const deb = r2(fiscales.filter(l => l.tipo === 'debito').reduce((s, l) => s + +l.monto, 0))
    const cre = r2(fiscales.filter(l => l.tipo === 'credito').reduce((s, l) => s + +l.monto, 0))
    const totD = r2(lineas.filter(l => l.tipo === 'debito').reduce((s, l) => s + (+l.monto || 0), 0))
    const totC = r2(lineas.filter(l => l.tipo === 'credito').reduce((s, l) => s + (+l.monto || 0), 0))
    const ajustable = Math.abs(totD - totC) < 0.005
    let estado = 'ok', ajuste = null
    if (p.estadoOrigen === 'anulada') estado = 'anulada'
    else if (!fiscales.length) estado = 'sin'
    else if (Math.abs(deb - cre) > 0.005) {
      const cta = ajustable ? cuentaAjuste() : null
      if (cta) {
        ajuste = { cuenta_codigo: cta.codigo, cuenta_nombre: cta.nombre, tipo: deb > cre ? 'credito' : 'debito',
          monto: r2(Math.abs(deb - cre)), centro_costo_id: null, descripcion: null, numero_documento: null }
      } else estado = 'descuadre'
    }
    return { ...p, lineas, fiscales, deb, cre, estado, ajuste, ajustable, parcial: fiscales.length > 0 && fiscales.length < lineas.length }
  }

  // ── CARGA ──
  window.initExportFiscal = function () {
    const cont = $('ef-contenido')
    if (!esSuperAdmin()) {
      cont.innerHTML = '<div class="empty-state"><div class="empty-text">Solo el Super Admin puede usar esta pantalla.</div></div>'
      $('ef-filtros').style.display = 'none'
      return
    }
    $('ef-filtros').style.display = ''
    if (!initExportFiscal._pref) {
      const pref = leerPref()
      $('ef-cuadrar').checked = !!pref.cuadrar
      $('ef-cuadrar-cta').value = pref.cuadrarCta || ''
      $('ef-ocultar').value = pref.ocultar || ''
      initExportFiscal._pref = true
    }
    if (!$('ef-desde').value) {
      const d = new Date()
      const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1)
      const fin = new Date(d.getFullYear(), d.getMonth(), 0)
      $('ef-desde').value = ini.toLocaleDateString('en-CA')
      $('ef-hasta').value = fin.toLocaleDateString('en-CA')
    }
    if (!efPartidas.length) cont.innerHTML = '<div class="empty-state"><div class="empty-text">Elige el rango y pulsa <b>Cargar</b>.</div></div>'
  }

  window.efCargar = async function () {
    if (!esSuperAdmin()) return
    const sb = getSb()
    const desde = $('ef-desde').value, hasta = $('ef-hasta').value
    if (!desde || !hasta || desde > hasta) { window.toast?.('Rango de fechas inválido', 'error'); return }
    const cont = $('ef-contenido')
    cont.innerHTML = '<div class="empty-state"><div class="empty-text">Cargando partidas…</div></div>'
    try {
      const [centros, cuentas] = await Promise.all([
        todas(() => sb.from('centros_costo').select('id,codigo,nombre,tipo_actividad,privado').order('nombre')),
        todas(() => sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo,naturaleza,nivel,cuenta_padre,es_detalle').order('codigo')),
      ])
      efCentros = Object.fromEntries(centros.map(c => [c.id, c]))
      efCuentas = Object.fromEntries(cuentas.map(c => [c.id, c]))
      efCuentasCod = Object.fromEntries(cuentas.map(c => [c.codigo, c]))
      $('ef-dl-cuentas').innerHTML = cuentas.filter(c => c.es_detalle !== false)
        .map(c => `<option value="${esc(c.codigo)} · ${esc(c.nombre)}"></option>`).join('')

      const partidas = await todas(() => sb.from('partidas_contables')
        .select('id,numero_partida,fecha_partida,numero_documento,descripcion,tipo_origen,estado,adjunto_url')
        .gte('fecha_partida', desde).lte('fecha_partida', hasta)
        .in('estado', ['aprobada', 'anulada'])
        .order('fecha_partida').order('numero_partida'))
      const ids = partidas.map(p => p.id)
      const lineas = await porLotes(ids, (lote) => sb.from('lineas_partida')
        .select('id,partida_id,cuenta_codigo,cuenta_nombre,tipo,monto,centro_costo_id,descripcion,numero_documento,aplica_fiscal')
        .in('partida_id', lote).order('id'))
      const [ventas, compras] = await Promise.all([
        porLotes(ids, (lote) => sb.from('libro_ventas').select('*').in('partida_id', lote).order('id')),
        porLotes(ids, (lote) => sb.from('libro_compras').select('*').in('partida_id', lote).order('id')),
      ])
      efLibros = { ventas, compras }

      const porPartida = {}
      lineas.forEach(l => (porPartida[l.partida_id] ||= []).push(l))
      efPartidas = partidas.map(({ estado, ...p }) => analizar({ ...p, estadoOrigen: estado }, porPartida[p.id] || []))
      efSel = new Set(efPartidas.filter(p => p.estado === 'ok').map(p => p.id))
      efAbierta = null
      efRender()
    } catch (e) {
      console.error('[export fiscal]', e)
      cont.innerHTML = `<div class="empty-state"><div class="empty-text">Error al cargar: ${esc(e.message || e)}</div></div>`
    }
  }

  // Al cambiar "excluir centros privados" o la cuenta de ajuste se recalcula
  // sin volver a consultar. Las que pasan a "Lista" se marcan.
  window.efReanalizar = function () {
    guardarPref()
    if (!efPartidas.length) return
    const antes = new Set(efPartidas.filter(p => p.estado === 'ok').map(p => p.id))
    efPartidas = efPartidas.map(p => analizar(p, p.lineas))
    efPartidas.forEach(p => {
      if (p.estado !== 'ok') efSel.delete(p.id)
      else if (!antes.has(p.id)) efSel.add(p.id)
    })
    efRender()
  }

  // ── RENDER ──
  const BADGE = {
    ok: '<span class="badge badge-green">Lista</span>',
    descuadre: '<span class="badge badge-red">Descuadra</span>',
    sin: '<span class="badge badge-off">Sin fiscal</span>',
    anulada: '<span class="badge badge-amber">Anulada</span>',
  }

  function visibles() {
    const filtro = $('ef-filtro').value
    const q = ($('ef-buscar').value || '').trim().toLowerCase()
    return efPartidas.filter(p => {
      if (filtro === 'sel' && !efSel.has(p.id)) return false
      if (filtro !== 'todas' && filtro !== 'sel' && p.estado !== filtro) return false
      if (filtro === 'todas' && p.estado === 'sin' && !$('ef-ver-sin').checked) return false
      if (q && !`${p.numero_documento || ''} ${p.descripcion || ''} ${p.numero_partida}`.toLowerCase().includes(q)) return false
      return true
    })
  }

  function efRender() {
    const cont = $('ef-contenido')
    const n = (e) => efPartidas.filter(p => p.estado === e).length
    const selArr = efPartidas.filter(p => efSel.has(p.id))
    const totalSel = r2(selArr.reduce((s, p) => s + Math.max(p.deb, p.cre), 0))
    const reglas = reglasOcultar()
    const nAjuste = efPartidas.filter(p => p.ajuste && p.estado === 'ok').length
    const nOcultas = selArr.filter(p => tieneOcultable(p, reglas)).length
    const nAjustables = efPartidas.filter(p => p.estado === 'descuadre' && p.ajustable).length
    $('ef-avisos').innerHTML = [
      nAjuste ? `${nAjuste} partida(s) se cuadran con una línea de ajuste a ${esc(cuentaAjuste()?.nombre || '')}.` : '',
      !cuentaAjuste() && nAjustables ? `${nAjustables} de las descuadradas se pueden cuadrar solas: elige la cuenta de ajuste.` : '',
      nOcultas ? `En ${nOcultas} partida(s) seleccionada(s) se ocultará texto. Las fotos no se modifican: revísalas.` : '',
    ].filter(Boolean).map(t => `<div>• ${t}</div>`).join('')
    $('ef-stat-ok').textContent = n('ok')
    $('ef-stat-desc').textContent = n('descuadre')
    $('ef-stat-sin').textContent = n('sin')
    $('ef-stat-sel').textContent = `${selArr.length} · L. ${fmt(totalSel)}`
    $('ef-btn-generar').disabled = !selArr.length && !efPartidas.some(p => p.estado === 'anulada')

    const filas = visibles()
    if (!filas.length) { cont.innerHTML = '<div class="empty-state"><div class="empty-text">No hay partidas con este filtro.</div></div>'; return }

    cont.innerHTML = `
      <div class="table-wrap" style="overflow-x:auto">
        <table>
          <thead><tr>
            <th style="width:32px"></th><th>N°</th><th>Fecha</th><th>Documento</th><th>Descripción</th>
            <th style="text-align:right">Debe fiscal</th><th style="text-align:right">Haber fiscal</th><th>Estado</th>
          </tr></thead>
          <tbody>${filas.map(filaHTML).join('')}</tbody>
        </table>
      </div>`
  }

  function filaHTML(p) {
    const puede = p.estado === 'ok'
    const dif = r2(p.deb - p.cre)
    const aj = p.ajuste && p.estado === 'ok' ? p.ajuste : null
    const nota = p.estado === 'descuadre'
      ? `<div style="font-size:11px;color:var(--red-fg)">Diferencia L. ${fmt(dif)}${p.ajustable ? ' · se puede cuadrar con cuenta de ajuste' : ' · la partida no cuadra ni completa'}</div>`
      : aj ? `<div style="font-size:11px;color:var(--text2)">+ ajuste L. ${fmt(aj.monto)}</div>`
      : (p.parcial ? `<div style="font-size:11px;color:var(--text3)">${p.fiscales.length} de ${p.lineas.length} líneas</div>` : '')
    const fotos = p.adjunto_url ? ' <span title="Tiene fotos adjuntas">📎</span>' : ''
    // Se muestra la descripción TAL COMO VIAJA (con el texto oculto ya quitado)
    const desc = limpiar(p.descripcion || '')
    const cambio = desc !== (p.descripcion || '')
    return `
      <tr style="cursor:pointer" onclick="efToggleDetalle('${p.id}')">
        <td onclick="event.stopPropagation()"><input type="checkbox" ${efSel.has(p.id) ? 'checked' : ''} ${puede ? '' : 'disabled'} onchange="efMarcar('${p.id}',this.checked)"></td>
        <td>${p.numero_partida ?? ''}</td>
        <td style="white-space:nowrap">${esc(p.fecha_partida)}</td>
        <td>${esc(p.numero_documento || '')}</td>
        <td>${esc(desc)}${cambio ? ` <span title="Original: ${esc(p.descripcion)}" style="color:var(--gold)">✎</span>` : ''}${fotos}</td>
        <td style="text-align:right">${fmt(p.deb + (aj?.tipo === 'debito' ? aj.monto : 0))}</td>
        <td style="text-align:right">${fmt(p.cre + (aj?.tipo === 'credito' ? aj.monto : 0))}</td>
        <td>${BADGE[p.estado] || ''}${nota}</td>
      </tr>
      ${efAbierta === p.id ? detalleHTML(p) : ''}`
  }

  function detalleHTML(p) {
    const filas = p.lineas.map(l => {
      const motivo = motivoExclusion(l)
      const cc = efCentros[l.centro_costo_id]
      return `<tr style="${motivo ? 'opacity:.45' : ''}">
        <td>${esc(l.cuenta_codigo)} · ${esc(l.cuenta_nombre)}</td>
        <td>${esc(cc ? cc.nombre : '')}</td>
        <td style="text-align:right">${l.tipo === 'debito' ? fmt(l.monto) : ''}</td>
        <td style="text-align:right">${l.tipo === 'credito' ? fmt(l.monto) : ''}</td>
        <td>${motivo ? `<span class="badge badge-off">${esc(motivo)}</span>` : '<span class="badge badge-green">va</span>'}</td>
      </tr>`
    }).join('')
    const aj = p.ajuste && p.estado === 'ok' ? p.ajuste : null
    const filaAj = aj ? `<tr style="color:var(--gold)">
        <td>${esc(aj.cuenta_codigo)} · ${esc(aj.cuenta_nombre)}</td><td></td>
        <td style="text-align:right">${aj.tipo === 'debito' ? fmt(aj.monto) : ''}</td>
        <td style="text-align:right">${aj.tipo === 'credito' ? fmt(aj.monto) : ''}</td>
        <td><span class="badge badge-gold">ajuste</span></td></tr>` : ''
    const ayuda = p.estado !== 'descuadre' ? ''
      : p.ajustable ? 'La partida completa cuadra: lo que falta es lo que se dejó fuera. Marca <b>Cuadrar lo excluido contra</b> y elige la cuenta (p. ej. la del socio).'
      : 'La partida no cuadra ni completa aquí: revisa sus montos en Partidas.'
    return `<tr><td></td><td colspan="7" style="background:var(--bg3)">
      <table style="font-size:12px"><thead><tr><th>Cuenta</th><th>Centro</th><th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th>Fiscal</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="5">Sin líneas</td></tr>'}${filaAj}</tbody></table>
      ${ayuda ? `<div style="font-size:12px;color:var(--text2);margin-top:6px">${ayuda}</div>` : ''}
    </td></tr>`
  }

  window.efToggleDetalle = (id) => { efAbierta = efAbierta === id ? null : id; efRender() }
  window.efMarcar = (id, v) => { v ? efSel.add(id) : efSel.delete(id); efRender() }
  window.efMarcarTodas = (v) => {
    visibles().forEach(p => { if (p.estado === 'ok') v ? efSel.add(p.id) : efSel.delete(p.id) })
    efRender()
  }
  window.efFiltrar = () => efRender()

  // ── GENERAR ARCHIVO ──
  function cargarJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip)
    return new Promise((ok, mal) => {
      const s = document.createElement('script')
      s.src = JSZIP_URL
      s.onload = () => window.JSZip ? ok(window.JSZip) : mal(new Error('JSZip no cargó'))
      s.onerror = () => mal(new Error('No se pudo descargar JSZip'))
      document.head.appendChild(s)
    })
  }

  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }
  const num = (v) => r2(v)

  window.efGenerar = async function () {
    if (!esSuperAdmin()) return
    const sb = getSb()
    const btn = $('ef-btn-generar')
    const estado = (t) => { $('ef-progreso').textContent = t }
    const desde = $('ef-desde').value, hasta = $('ef-hasta').value
    const sel = efPartidas.filter(p => efSel.has(p.id) && p.estado === 'ok')
    guardarPref()
    const conFotos = $('ef-fotos').checked

    btn.disabled = true
    try {
      estado('Preparando partidas…')
      const centrosUsados = new Set()
      const cuentasUsadas = new Set()
      const refPartida = {}
      const partidas = []
      for (const p of sel) {
        const ref = await huella('partida', p.id)
        refPartida[p.id] = ref
        const lineas = [...p.fiscales, ...(p.ajuste ? [p.ajuste] : [])]
          .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'debito' ? -1 : 1) || String(a.cuenta_codigo).localeCompare(String(b.cuenta_codigo)))
          .map(l => {
            const cc = efCentros[l.centro_costo_id]
            if (cc) centrosUsados.add(cc.id)
            cuentasUsadas.add(l.cuenta_codigo)
            return {
              cuenta_codigo: l.cuenta_codigo, cuenta_nombre: l.cuenta_nombre,
              centro_codigo: cc ? (cc.codigo || cc.nombre) : null,
              tipo: l.tipo, monto: num(l.monto),
              descripcion: limpiar(l.descripcion) || null, numero_documento: l.numero_documento || null,
            }
          })
        const cuerpo = {
          fecha: p.fecha_partida, numero_documento: p.numero_documento || null,
          descripcion: limpiar(p.descripcion) || '(sin descripción)', tipo_origen: p.tipo_origen || null, lineas,
        }
        partidas.push({ ref, hash: await sha256(JSON.stringify(cuerpo)), ...cuerpo })
      }

      // Anuladas aquí → se anulan allá. Opcional: también las no seleccionadas.
      const retirar = []
      for (const p of efPartidas) {
        const quitar = p.estado === 'anulada' || ($('ef-retirar-desmarcadas').checked && !efSel.has(p.id))
        if (quitar) retirar.push(await huella('partida', p.id))
      }

      estado('Preparando libros de ventas y compras…')
      const selIds = new Set(sel.map(p => p.id))
      const libro_ventas = []
      for (const v of efLibros.ventas) {
        if (!selIds.has(v.partida_id) || centroExcluido(v.centro_costo_id)) continue
        const cc = efCentros[v.centro_costo_id]
        if (cc) centrosUsados.add(cc.id)
        libro_ventas.push({
          ref: await huella('venta', `${v.centro_costo_id || ''}|${v.factura_electronica || v.id}`),
          partida_ref: refPartida[v.partida_id], centro_codigo: cc ? (cc.codigo || cc.nombre) : null,
          fecha: v.fecha, factura_interna: v.factura_interna, factura_electronica: v.factura_electronica,
          cliente: v.cliente, rtn_cliente: v.rtn_cliente, subtotal: num(v.subtotal), total_gravado: num(v.total_gravado),
          total_exento: num(v.total_exento), isv: num(v.isv), total: num(v.total), monto_efectivo: num(v.monto_efectivo),
          monto_tarjeta: num(v.monto_tarjeta), monto_transferencia: num(v.monto_transferencia),
          incluir_fiscal: v.incluir_fiscal !== false, numero_documento: v.numero_documento, observaciones: limpiar(v.observaciones),
        })
      }
      // Las compras se borran y recrean al editar la partida (cambian de id):
      // la huella usa partida + N° de factura + ocurrencia, no el id.
      const libro_compras = []
      const ocurr = {}
      for (const c of efLibros.compras) {
        if (!selIds.has(c.partida_id) || centroExcluido(c.centro_costo_id)) continue
        const cc = efCentros[c.centro_costo_id]
        if (cc) centrosUsados.add(cc.id)
        const k = `${c.partida_id}|${c.numero_factura || ''}`
        ocurr[k] = (ocurr[k] || 0) + 1
        libro_compras.push({
          ref: await huella('compra', `${k}|${ocurr[k]}`),
          partida_ref: refPartida[c.partida_id], centro_codigo: cc ? (cc.codigo || cc.nombre) : null,
          fecha: c.fecha, numero_factura: c.numero_factura, numero_documento: c.numero_documento,
          proveedor: c.proveedor, rtn_proveedor: c.rtn_proveedor, cuenta_proveedor: c.cuenta_proveedor,
          subtotal: num(c.subtotal), isv: num(c.isv), total: num(c.total), forma_pago: c.forma_pago,
          productos: limpiar(c.productos), tipo_compra: c.tipo_compra, incluir_fiscal: c.incluir_fiscal !== false,
          periodo_fiscal: c.periodo_fiscal || null,
        })
      }

      // Centros y cuentas (con sus padres, para los reportes por nivel)
      const centros = [...centrosUsados].map(id => efCentros[id]).map(c => ({
        codigo: c.codigo || c.nombre, nombre: c.nombre,
        tipo_actividad: ['gravada', 'exenta', 'comun'].includes(c.tipo_actividad) ? c.tipo_actividad : 'comun',
      }))
      const codigos = new Set()
      for (const cod of cuentasUsadas) {
        let c = efCuentasCod[cod]
        while (c && !codigos.has(c.codigo)) { codigos.add(c.codigo); c = efCuentas[c.cuenta_padre] }
      }
      const cuentas = [...codigos].sort().map(cod => {
        const c = efCuentasCod[cod]
        return {
          codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, naturaleza: c.naturaleza, nivel: c.nivel,
          cuenta_padre: efCuentas[c.cuenta_padre]?.codigo || null, es_detalle: c.es_detalle !== false,
        }
      })
      const faltan = [...cuentasUsadas].filter(cod => !efCuentasCod[cod])
      if (faltan.length) throw new Error('Cuentas que no están en el catálogo: ' + faltan.join(', '))

      const JSZip = await cargarJSZip()
      const zip = new JSZip()

      // Fotos / PDFs adjuntos a las partidas
      const documentos = []
      if (conFotos) {
        const tareas = []
        for (const p of sel) {
          const rutas = String(p.adjunto_url || '').split(',').map(s => s.trim()).filter(Boolean)
          for (const ruta of rutas) tareas.push({ p, ruta })
        }
        let hechas = 0, fallidas = 0
        const trabajar = async () => {
          while (tareas.length) {
            const { p, ruta } = tareas.shift()
            try {
              const { data, error } = await sb.storage.from(BUCKET).download(ruta)
              if (error) throw error
              const ext = (ruta.split('.').pop() || 'jpg').toLowerCase()
              const ref = await huella('documento', `${p.id}|${ruta}`)
              const archivo = `documentos/${ref}.${ext}`
              zip.file(archivo, data)
              documentos.push({
                ref, partida_ref: refPartida[p.id], archivo, storage_path: `importados/${ref}.${ext}`,
                nombre: `${p.numero_documento || 'documento'}.${ext}`, tipo_mime: MIME[ext] || data.type || null,
              })
            } catch (e) {
              fallidas++
              console.warn('[export fiscal] no se pudo bajar', ruta, e)
            }
            hechas++
            estado(`Descargando fotos… ${hechas}`)
          }
        }
        await Promise.all([trabajar(), trabajar(), trabajar(), trabajar()])
        if (fallidas) window.toast?.(`${fallidas} foto(s) no se pudieron descargar; el resto va en el archivo`, 'info')
      }

      const lote = {
        formato: 'fiscal-lote-v1',
        generado: new Date().toISOString(),
        desde, hasta,
        descripcion: `Período ${desde} a ${hasta}`,
        centros, cuentas, partidas, retirar, libro_ventas, libro_compras, documentos,
      }
      lote.hash = await sha256(JSON.stringify(lote))
      zip.file('lote.json', JSON.stringify(lote))

      estado('Comprimiendo…')
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `fiscal_${desde}_${hasta}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)

      const resumen = `${partidas.length} partidas, ${libro_ventas.length} ventas, ${libro_compras.length} compras, ${documentos.length} fotos, ${retirar.length} a retirar`
      estado(`Listo: ${resumen}.`)
      window.toast?.('Archivo fiscal generado', 'success')
      window.logActividad?.('exportar_fiscal', 'fiscal', `Exportó ${desde} a ${hasta}: ${resumen}`)
    } catch (e) {
      console.error('[export fiscal]', e)
      estado('')
      window.toast?.('Error: ' + (e.message || e), 'error')
    } finally {
      btn.disabled = false
    }
  }
})()
