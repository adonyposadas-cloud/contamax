/* ============================================================
   CONTAMAX · Administración de destinos de depósito (Paso 2)

   Mantiene `destinos_deposito`, el catálogo que dice a dónde va
   el dinero de una entrega de taxi y contra qué cuenta contable
   se registra.

   tipo='banco' → se concilia contra extracto (sube archivo)
   tipo='caja'  → no se concilia; va por Caja General

   Este módulo es también la fuente de `bancoToCuenta()` en app.js:
   expone window.cargarDestinos() y window.DESTINOS, para que la
   generación de partidas deje de usar el mapa fijo.
   ============================================================ */
(function () {
  const csb = () => window._sb

  let destinos = []
  let editandoId = null

  const fmtInt = n => (n || 0).toLocaleString('es-HN')
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // ── CARGA (cache compartido con app.js) ────────────────────────────────
  // force=true la re-consulta. app.js la llama con await antes de generar
  // partidas, así que el cache nunca decide una contabilización por sí solo.
  window.cargarDestinos = async (force = false) => {
    if (!force && destinos.length) return destinos
    const { data, error } = await csb()
      .from('destinos_deposito').select('*').order('orden')
    if (error) throw error
    destinos = data || []
    window.DESTINOS = destinos
    return destinos
  }

  // Conteo de entregas por destino. Va aparte del select principal porque si
  // el embed de PostgREST falla (o la FK cambia), preferimos la pantalla sin
  // conteos antes que sin datos.
  async function contarEntregas() {
    try {
      const { data, error } = await csb()
        .from('destinos_deposito').select('id, entregas_taxis(count)')
      if (error) throw error
      const m = {}
      ;(data || []).forEach(r => { m[r.id] = r.entregas_taxis?.[0]?.count ?? null })
      return m
    } catch (e) {
      console.warn('destinos: no se pudieron contar las entregas', e)
      return {}
    }
  }

  // ── VISTA ──────────────────────────────────────────────────────────────
  window.initDestinos = async () => {
    const root = document.getElementById('dest-root')
    if (!root) return
    root.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div></div>'
    try {
      await window.cargarDestinos(true)
      const conteos = await contarEntregas()
      render(root, conteos)
    } catch (e) {
      root.innerHTML = `<div class="dst-error">No se pudo cargar el catálogo de destinos: ${esc(e.message || e)}</div>`
    }
  }

  function render(root, conteos) {
    const bancos = destinos.filter(d => d.tipo === 'banco')
    const cajas = destinos.filter(d => d.tipo === 'caja')

    const fila = d => {
      const n = conteos[d.id]
      return `<tr class="${d.activa ? '' : 'dst-off'}">
        <td><b>${esc(d.codigo)}</b>${d.activa ? '' : ' <span class="badge badge-amber">Inactivo</span>'}</td>
        <td>${esc(d.etiqueta)}</td>
        <td>${d.institucion ? esc(d.institucion) : '<span class="dst-dim">—</span>'}</td>
        <td class="dst-mono">${esc(d.cuenta_codigo)}</td>
        <td>${d.numero_cuenta ? esc(d.numero_cuenta) : '<span class="dst-dim">—</span>'}</td>
        <td>${d.es_propia
          ? '<span class="dst-dim">Empresa</span>'
          : `<span class="dst-warn" title="Cuenta a nombre de una persona natural">Personal${d.titular ? ' · ' + esc(d.titular) : ''}</span>`}</td>
        <td style="text-align:right" class="dst-mono">${n == null ? '<span class="dst-dim">—</span>' : fmtInt(n)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost dst-mini" onclick="dstEditar('${d.id}')">Editar</button>
          <button class="btn btn-ghost dst-mini" onclick="dstToggle('${d.id}')">${d.activa ? 'Desactivar' : 'Activar'}</button>
        </td></tr>`
    }

    const tabla = (titulo, sub, arr) => `
      <div class="dst-block">
        <div class="dst-block-title">${titulo}</div>
        <div class="dst-block-sub">${sub}</div>
        <div class="dst-tw"><table class="dst-table">
          <thead><tr>
            <th>Código</th><th>Etiqueta</th><th>Institución</th><th>Cuenta contable</th>
            <th>N° de cuenta</th><th>Titular</th><th style="text-align:right">Entregas</th><th></th>
          </tr></thead>
          <tbody>${arr.length ? arr.map(fila).join('')
            : '<tr><td colspan="8" class="dst-dim" style="text-align:center;padding:24px">Ninguno</td></tr>'}</tbody>
        </table></div>
      </div>`

    root.innerHTML = `
      <div class="dst-bar">
        <button class="btn btn-gold" onclick="dstNuevo()">+ Nuevo destino</button>
        <span class="dst-dim">${destinos.length} destino(s) · ${bancos.length} banco(s) · ${cajas.length} caja(s)</span>
      </div>
      ${tabla('🏦 Bancos', 'Se concilian contra el estado de cuenta. Cada uno necesita su propia cuenta contable.', bancos)}
      ${tabla('💵 Cajas', 'No se concilian contra extracto. Pueden compartir la misma cuenta contable.', cajas)}
      <div class="dst-nota">
        El <b>código</b> es el texto exacto que el formulario del motorista guarda en la entrega.
        Si no coincide letra por letra, la entrega no encuentra su destino y no se puede contabilizar.
      </div>`
  }

  // ── MODAL ──────────────────────────────────────────────────────────────
  window.dstNuevo = () => abrirModal(null)
  window.dstEditar = (id) => abrirModal(destinos.find(d => d.id === id) || null)

  function abrirModal(d) {
    editandoId = d ? d.id : null
    let bd = document.getElementById('modal-destino')
    if (!bd) {
      bd = document.createElement('div')
      bd.className = 'modal-backdrop'
      bd.id = 'modal-destino'
      document.body.appendChild(bd)
    }
    const v = (k, def = '') => esc(d ? (d[k] ?? def) : def)
    const tipo = d ? d.tipo : 'banco'
    // El código se bloquea al editar: es la llave con la que el formulario del
    // motorista escribe `entregas_taxis.banco`. Cambiarlo dejaría a las entregas
    // nuevas sin destino, y el error no se vería hasta contabilizar.
    const bloqueado = !!d
    bd.innerHTML = `
      <div class="modal" style="max-width:560px">
        <div class="modal-header">
          <h3>${d ? 'Editar destino' : 'Nuevo destino'}</h3>
          <button class="modal-close" onclick="closeModal('modal-destino')">✕</button>
        </div>
        <div class="modal-body">
          <div class="dst-f">
            <label>Tipo</label>
            <select id="dst-tipo" onchange="dstTipoChange()">
              <option value="banco" ${tipo === 'banco' ? 'selected' : ''}>Banco · se concilia contra extracto</option>
              <option value="caja"  ${tipo === 'caja' ? 'selected' : ''}>Caja · no se concilia</option>
            </select>
          </div>
          <div class="dst-f">
            <label>Código ${bloqueado ? '<span class="dst-dim">(no editable)</span>' : ''}</label>
            <input type="text" id="dst-codigo" value="${v('codigo')}" ${bloqueado ? 'disabled' : ''}
                   placeholder="BAC 3">
            <div class="dst-help">Texto exacto que guarda el formulario del motorista. Respetá mayúsculas y espacios.</div>
          </div>
          <div class="dst-f">
            <label>Etiqueta</label>
            <input type="text" id="dst-etiqueta" value="${v('etiqueta')}" placeholder="BAC AHORRO 7588126">
          </div>
          <div class="dst-f" id="dst-f-inst">
            <label>Institución</label>
            <select id="dst-institucion">
              <option value="">— Seleccionar —</option>
              <option value="BAC"     ${d && d.institucion === 'BAC' ? 'selected' : ''}>BAC</option>
              <option value="Ficohsa" ${d && d.institucion === 'Ficohsa' ? 'selected' : ''}>Ficohsa</option>
            </select>
            <div class="dst-help">Define cómo se lee el extracto y cómo se identifica al depositante. Solo hay lógica de lectura para estas dos.</div>
          </div>
          <div class="dst-f">
            <label>Cuenta contable</label>
            <input type="text" id="dst-cuenta" value="${v('cuenta_codigo')}" placeholder="110104-025">
            <div class="dst-help">Debe existir en el catálogo y ser cuenta de detalle.</div>
          </div>
          <div class="dst-f" id="dst-f-num">
            <label>N° de cuenta en el banco <span class="dst-dim">(opcional)</span></label>
            <input type="text" id="dst-numero" value="${v('numero_cuenta')}">
          </div>
          <div class="dst-row">
            <div class="dst-f" style="flex:1">
              <label>Titular <span class="dst-dim">(opcional)</span></label>
              <input type="text" id="dst-titular" value="${v('titular')}">
            </div>
            <div class="dst-f" style="flex:1">
              <label>A nombre de</label>
              <select id="dst-propia">
                <option value="true"  ${!d || d.es_propia ? 'selected' : ''}>La empresa</option>
                <option value="false" ${d && !d.es_propia ? 'selected' : ''}>Una persona natural</option>
              </select>
            </div>
          </div>
          <div class="dst-f">
            <label>Nota <span class="dst-dim">(opcional)</span></label>
            <input type="text" id="dst-nota" value="${v('nota')}">
          </div>
          <div id="dst-err" class="dst-error hidden"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('modal-destino')">Cancelar</button>
          <button class="btn btn-gold" id="dst-save" onclick="dstGuardar()">Guardar</button>
        </div>
      </div>`
    bd.classList.add('open')
    dstTipoChange()
  }

  window.dstTipoChange = () => {
    const esBanco = document.getElementById('dst-tipo').value === 'banco'
    document.getElementById('dst-f-inst').style.display = esBanco ? '' : 'none'
    document.getElementById('dst-f-num').style.display = esBanco ? '' : 'none'
  }

  // ── GUARDAR ────────────────────────────────────────────────────────────
  window.dstGuardar = async () => {
    const err = document.getElementById('dst-err')
    const falla = m => { err.textContent = m; err.classList.remove('hidden') }
    err.classList.add('hidden')

    const tipo = document.getElementById('dst-tipo').value
    const codigo = (editandoId
      ? (destinos.find(d => d.id === editandoId) || {}).codigo
      : document.getElementById('dst-codigo').value || '').trim()
    const etiqueta = (document.getElementById('dst-etiqueta').value || '').trim()
    const institucion = tipo === 'banco' ? (document.getElementById('dst-institucion').value || '').trim() : null
    const cuenta = (document.getElementById('dst-cuenta').value || '').trim()
    const numero = tipo === 'banco' ? ((document.getElementById('dst-numero').value || '').trim() || null) : null
    const titular = (document.getElementById('dst-titular').value || '').trim() || null
    const esPropia = document.getElementById('dst-propia').value === 'true'
    const nota = (document.getElementById('dst-nota').value || '').trim() || null

    if (!codigo) return falla('El código es obligatorio.')
    if (!etiqueta) return falla('La etiqueta es obligatoria.')
    if (tipo === 'banco' && !institucion) return falla('Un banco necesita institución: de ella depende cómo se lee el extracto.')
    if (!cuenta) return falla('La cuenta contable es obligatoria.')

    // Código repetido: lo bloquea un índice único en la base, pero avisamos
    // antes para no gastar el viaje y dar un mensaje entendible.
    if (!editandoId && destinos.some(d => d.codigo === codigo)) {
      return falla(`Ya existe un destino con el código "${codigo}".`)
    }
    // Dos BANCOS no pueden compartir cuenta contable: sus subtotales se sumarían
    // en la partida y el total general seguiría cuadrando (error invisible).
    // Las cajas sí la comparten a propósito.
    if (tipo === 'banco' && destinos.some(d => d.tipo === 'banco' && d.cuenta_codigo === cuenta && d.id !== editandoId)) {
      return falla(`La cuenta ${cuenta} ya la usa otro banco. Cada cuenta bancaria necesita su propia cuenta contable.`)
    }

    const btn = document.getElementById('dst-save')
    btn.disabled = true; btn.textContent = 'Guardando...'
    try {
      // La cuenta se valida contra el catálogo: si no existe o no es de detalle,
      // la partida fallaría después, lejos de acá y sin explicación.
      const { data: cta, error: eCta } = await csb()
        .from('catalogo_cuentas').select('codigo,nombre,es_detalle').eq('codigo', cuenta).maybeSingle()
      if (eCta) throw eCta
      if (!cta) throw new Error(`La cuenta ${cuenta} no existe en el catálogo.`)
      if (!cta.es_detalle) throw new Error(`La cuenta ${cuenta} no es de detalle; no se le pueden cargar movimientos.`)

      const payload = {
        tipo, etiqueta, institucion, cuenta_codigo: cuenta,
        numero_cuenta: numero, titular, es_propia: esPropia, nota
      }
      if (editandoId) {
        // UPDATE por identidad, nunca delete+insert: se conserva el id al que
        // apuntan las entregas históricas.
        const { error } = await csb().from('destinos_deposito').update(payload).eq('id', editandoId)
        if (error) throw error
      } else {
        payload.codigo = codigo
        payload.activa = true
        payload.orden = (destinos.reduce((m, d) => Math.max(m, d.orden || 0), 0)) + 1
        const { error } = await csb().from('destinos_deposito').insert(payload).select().single()
        if (error) throw error
      }
      closeModal('modal-destino')
      toast(editandoId ? 'Destino actualizado' : 'Destino creado', 'success')
      await window.initDestinos()
    } catch (e) {
      falla(e.message || String(e))
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar'
    }
  }

  // ── ACTIVAR / DESACTIVAR ───────────────────────────────────────────────
  // No hay borrar: las entregas históricas apuntan a estos ids. Desactivar lo
  // saca de los formularios sin romper lo ya contabilizado.
  window.dstToggle = async (id) => {
    const d = destinos.find(x => x.id === id)
    if (!d) return
    const accion = d.activa ? 'desactivar' : 'activar'
    if (!confirm(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} "${d.codigo}"?\n\n` +
      (d.activa
        ? 'Deja de aparecer para nuevas entregas. Lo ya registrado no cambia.'
        : 'Vuelve a aparecer como opción para nuevas entregas.'))) return
    try {
      const { error } = await csb().from('destinos_deposito').update({ activa: !d.activa }).eq('id', id)
      if (error) throw error
      toast(`Destino ${d.activa ? 'desactivado' : 'activado'}`, 'success')
      await window.initDestinos()
    } catch (e) {
      toast('No se pudo cambiar: ' + (e.message || e), 'error')
    }
  }

  // ── ESTILOS ────────────────────────────────────────────────────────────
  const st = document.createElement('style')
  st.textContent = `
    .dst-bar{display:flex;align-items:center;gap:14px;margin-bottom:16px;flex-wrap:wrap}
    .dst-block{margin-bottom:22px}
    .dst-block-title{font-weight:600;font-size:14px;margin-bottom:2px}
    .dst-block-sub{font-size:12px;color:var(--text3);margin-bottom:8px}
    .dst-tw{overflow-x:auto;border:0.5px solid var(--border);border-radius:var(--radius)}
    .dst-table{width:100%;border-collapse:collapse;font-size:12px;min-width:820px}
    .dst-table th{text-align:left;padding:8px 10px;color:var(--text3);font-weight:500;
      font-size:10px;letter-spacing:.5px;text-transform:uppercase;border-bottom:0.5px solid var(--border)}
    .dst-table td{padding:9px 10px;border-bottom:0.5px solid var(--border)}
    .dst-table tr:last-child td{border-bottom:none}
    .dst-off td{opacity:.45}
    .dst-mono{font-family:var(--mono)}
    .dst-dim{color:var(--text3)}
    .dst-warn{color:#f5c451}
    .dst-mini{font-size:11px;padding:4px 9px}
    .dst-nota{font-size:11px;color:var(--text3);background:var(--bg3);border:0.5px solid var(--border);
      border-radius:var(--radius);padding:9px 12px}
    .dst-f{margin-bottom:12px}
    .dst-f label{display:block;font-size:11px;color:var(--text3);margin-bottom:4px}
    .dst-f input,.dst-f select{width:100%;padding:8px 11px;background:var(--bg3);
      border:0.5px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;outline:none}
    .dst-f input:disabled{opacity:.5}
    .dst-help{font-size:10px;color:var(--text3);margin-top:3px}
    .dst-row{display:flex;gap:10px}
    .dst-error{background:rgba(239,68,68,.12);border:0.5px solid rgba(239,68,68,.4);
      color:#fca5a5;border-radius:var(--radius);padding:9px 12px;font-size:12px}
    .dst-error.hidden{display:none}
  `
  document.head.appendChild(st)
})()