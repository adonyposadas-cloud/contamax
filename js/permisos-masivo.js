// js/permisos-masivo.js
// Carga masiva de permisos: el mismo permiso a varios empleados de una vez.
//
// El caso real: la semana morazánica se trabaja hasta el mediodía y el resto se
// carga a cuenta de vacaciones. Con 49 empleados eso son 49 formularios, y ahí
// es donde se olvida gente o se carga dos veces.
//
// El registro que inserta es idéntico al de guardarPermiso(): mismos campos,
// mismo `tratamiento`, misma compatibilidad con a_cuenta_vacaciones. Si esa
// función cambia, esta hay que revisarla.
//
// Medio día: no hace falta nada especial. _diasDePermiso calcula la fracción a
// partir de hora_salida contra la jornada, así que una salida a las 12:00 vale
// 0.5 días. La columna `dias` (entera) solo se usa para incapacidades.

const pmSb = () => window._sb
let pmEmpleados = []
let pmSel = new Set()

const pmEsc = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const PM_TIPOS = {
  salida_anticipada: 'Salida anticipada',
  falta_justificada: 'Falta justificada',
  permiso_dia: 'Permiso día completo',
  llegada_tarde: 'Llegada tarde justificada'
}

// ── Abrir ──
window.abrirPermisoMasivo = async () => {
  let bd = document.getElementById('modal-perm-masivo')
  if (!bd) {
    bd = document.createElement('div')
    bd.className = 'modal-backdrop'; bd.id = 'modal-perm-masivo'
    document.body.appendChild(bd)
    bd.addEventListener('click', ev => { if (ev.target === bd) closeModal('modal-perm-masivo') })
  }
  pmSel = new Set()
  bd.innerHTML = `<div class="modal pm-modal">
      <div class="modal-header">
        <h3>👥 Permiso a varios empleados</h3>
        <button class="modal-close" onclick="closeModal('modal-perm-masivo')">✕</button>
      </div>
      <div class="modal-body">
        <div class="pm-grid">
          <div class="pm-f"><label>Fecha</label>
            <input type="date" id="pm-fecha" onchange="pmRecalc()"></div>
          <div class="pm-f"><label>Tipo</label>
            <select id="pm-tipo" onchange="pmTipoChange()">
              ${Object.entries(PM_TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
            </select></div>
          <div class="pm-f" id="pm-wrap-hora"><label id="pm-lbl-hora">Hora de salida</label>
            <input type="time" id="pm-hora" value="12:00" onchange="pmRecalc()">
            <div class="pm-help">Salida a las 12:00 = medio día.</div></div>
          <div class="pm-f"><label>¿Cómo se trata?</label>
            <select id="pm-tratamiento" onchange="pmRecalc()">
              <option value="vacaciones">A cuenta de vacaciones</option>
              <option value="sin_goce">Sin goce de sueldo</option>
              <option value="con_goce">Con goce (no descuenta)</option>
            </select></div>
        </div>
        <div class="pm-f"><label>Motivo</label>
          <input type="text" id="pm-motivo" maxlength="120" placeholder="Ej: Semana morazánica — despacho al mediodía"></div>

        <div class="pm-sel-head">
          <div><b>Empleados</b> <span id="pm-conteo" class="pm-dim">0 seleccionados</span></div>
          <div class="pm-acts">
            <input type="text" id="pm-buscar" placeholder="Buscar..." oninput="pmPintarLista()">
            <select id="pm-seccion" onchange="pmPintarLista()"><option value="">Todas las secciones</option></select>
            <button class="btn btn-ghost pm-mini" onclick="pmMarcarTodos(true)">Marcar todos</button>
            <button class="btn btn-ghost pm-mini" onclick="pmMarcarTodos(false)">Ninguno</button>
          </div>
        </div>
        <div id="pm-excluidos"></div>
        <div class="pm-lista" id="pm-lista"><div style="text-align:center;padding:20px"><div class="spinner"></div></div></div>
        <div id="pm-preview" class="pm-preview"></div>
        <div id="pm-err" class="pm-warn hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('modal-perm-masivo')">Cancelar</button>
        <button class="btn btn-gold" id="pm-aplicar" onclick="pmAplicar()" disabled>Aplicar</button>
      </div>
    </div>`
  bd.classList.add('open')
  pmEnsureStyles()

  try {
    const { data, error } = await pmSb().from('empleados')
      .select('id, nombre, seccion, es_socio, activo').eq('activo', true).order('seccion').order('nombre')
    if (error) throw error
    pmEmpleados = data || []
    const secs = [...new Set(pmEmpleados.map(e => e.seccion).filter(Boolean))].sort()
    const selSec = document.getElementById('pm-seccion')
    secs.forEach(sc => selSec.insertAdjacentHTML('beforeend', `<option value="${pmEsc(sc)}">${pmEsc(sc)}</option>`))
    pmPintarLista()
    pmRecalc()
  } catch (e) {
    document.getElementById('pm-lista').innerHTML =
      `<div class="pm-warn">No se pudo cargar la lista: ${pmEsc(e.message || e)}</div>`
  }
}

window.pmTipoChange = () => {
  const tipo = document.getElementById('pm-tipo').value
  const wrap = document.getElementById('pm-wrap-hora')
  const lbl = document.getElementById('pm-lbl-hora')
  // Día completo y falta justificada no llevan hora: es el día entero.
  const conHora = tipo === 'salida_anticipada' || tipo === 'llegada_tarde'
  wrap.style.display = conHora ? '' : 'none'
  lbl.textContent = tipo === 'llegada_tarde' ? 'Hora de entrada' : 'Hora de salida'
  pmRecalc()
}

// ── Lista ──
window.pmPintarLista = () => {
  const q = (document.getElementById('pm-buscar')?.value || '').toLowerCase().trim()
  const sc = document.getElementById('pm-seccion')?.value || ''
  const host = document.getElementById('pm-lista')
  const filtrados = pmEmpleados.filter(e =>
    (!sc || e.seccion === sc) && (!q || e.nombre.toLowerCase().includes(q)))

  host.innerHTML = filtrados.map(e => `
    <label class="pm-row">
      <input type="checkbox" ${pmSel.has(e.id) ? 'checked' : ''} onchange="pmToggle('${e.id}', this.checked)">
      <span class="pm-nom">${pmEsc(e.nombre)}</span>
      <span class="pm-dim">${pmEsc(e.seccion || '—')}</span>
      ${e.es_socio ? '<span class="pm-chip">socio</span>' : ''}
    </label>`).join('') || '<div class="pm-dim" style="padding:14px;text-align:center">Sin resultados</div>'
  pmRecalc()
}

window.pmToggle = (id, on) => { on ? pmSel.add(id) : pmSel.delete(id); pmRecalc() }

// Marca solo lo que está a la vista: si filtraste por sección, "marcar todos"
// marca esa sección, no las 49 personas.
window.pmMarcarTodos = (on) => {
  const q = (document.getElementById('pm-buscar')?.value || '').toLowerCase().trim()
  const sc = document.getElementById('pm-seccion')?.value || ''
  pmEmpleados
    .filter(e => (!sc || e.seccion === sc) && (!q || e.nombre.toLowerCase().includes(q)))
    .forEach(e => on ? pmSel.add(e.id) : pmSel.delete(e.id))
  pmPintarLista()
}

// ── Vista previa ──
// Con 49 personas a medio día son ~24 días de vacaciones de un saque. Verlo
// antes de aplicar es la diferencia entre revisar y descubrirlo en la planilla.
window.pmRecalc = async () => {
  const cont = document.getElementById('pm-conteo')
  const prev = document.getElementById('pm-preview')
  const btn = document.getElementById('pm-aplicar')
  if (!cont) return
  cont.textContent = `${pmSel.size} seleccionado(s)`

  const fecha = document.getElementById('pm-fecha')?.value
  const tipo = document.getElementById('pm-tipo')?.value
  const trat = document.getElementById('pm-tratamiento')?.value
  const hora = document.getElementById('pm-hora')?.value

  btn.disabled = !(fecha && pmSel.size)
  if (!fecha || !pmSel.size) { prev.innerHTML = ''; return }

  const conHora = tipo === 'salida_anticipada' || tipo === 'llegada_tarde'
  // Se usa la MISMA función que la planilla, no una aproximación: la jornada y
  // los redondeos los define asistencia.js y acá solo se consultan.
  const muestra = { tipo, fecha, hora_salida: conHora && tipo !== 'llegada_tarde' ? hora : null,
                    hora_entrada: tipo === 'llegada_tarde' ? hora : null }
  const porPersona = window._diasDePermiso
    ? Math.round(window._diasDePermiso(muestra, null) * 100) / 100
    : (conHora ? null : 1)
  const total = porPersona == null ? null : Math.round(porPersona * pmSel.size * 100) / 100
  const etq = { vacaciones: 'días de vacaciones', sin_goce: 'días sin goce (se descuentan del sueldo)', con_goce: 'días con goce (no descuentan)' }[trat]

  const d = new Date(fecha + 'T12:00:00')
  const dia = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d.getDay()]

  prev.innerHTML = `<div class="pm-prev-t">Vista previa</div>
    <div class="pm-prev-g">
      <div><b>${pmSel.size}</b><span>empleados</span></div>
      <div><b>${fecha}</b><span>${dia}</span></div>
      <div><b>${porPersona == null ? '—' : porPersona}</b><span>día(s) c/u</span></div>
      <div><b>${total == null ? '—' : total}</b><span>${etq}</span></div>
    </div>
    ${dia === 'Domingo' ? '<div class="pm-warn" style="margin-top:8px">La fecha cae domingo: el domingo no es día esperado, así que el permiso no cambiaría nada.</div>' : ''}`
}
const _pmMin = (h) => { const [a, b] = String(h || '0:0').split(':').map(Number); return (a || 0) * 60 + (b || 0) }

// ── Aplicar ──
window.pmAplicar = async () => {
  const err = document.getElementById('pm-err')
  const falla = m => { err.textContent = m; err.classList.remove('hidden') }
  err.classList.add('hidden')

  const fecha = document.getElementById('pm-fecha').value
  const tipo = document.getElementById('pm-tipo').value
  const trat = document.getElementById('pm-tratamiento').value
  const hora = document.getElementById('pm-hora').value
  const motivo = (document.getElementById('pm-motivo').value || '').trim()
  if (!fecha || !pmSel.size) return falla('Faltan la fecha o los empleados.')
  if (!motivo) return falla('Poné un motivo: es lo que va a explicar estas 40 y pico de filas dentro de seis meses.')

  const conHora = tipo === 'salida_anticipada' || tipo === 'llegada_tarde'
  // Mismo aviso anti-AM/PM que el permiso individual, que acá pega por 49.
  if (conHora && hora && _pmMin(hora) < 8 * 60) {
    const hh = parseInt(hora.split(':')[0], 10) || 0
    const pm = String(hh + 12).padStart(2, '0') + ':' + (hora.split(':')[1] || '00')
    if (!confirm(`La hora ${hora} es de madrugada.\n¿Quizás querías ${pm} (PM)?\n\nAceptar = usar ${hora}\nCancelar = corregir`)) return
  }

  const btn = document.getElementById('pm-aplicar')
  btn.disabled = true; btn.textContent = 'Revisando...'

  try {
    // Quién ya tiene permiso ese día: se salta, no se duplica. Cargar dos veces
    // sobre 49 personas es un desastre de corregir uno por uno.
    const ids = [...pmSel]
    const { data: yaTienen, error: eDup } = await pmSb().from('permisos_empleados')
      .select('empleado_id, empleado_nombre, tipo')
      .eq('fecha', fecha).eq('eliminado', false).in('empleado_id', ids)
    if (eDup) throw eDup
    const conPermiso = new Set((yaTienen || []).map(p => p.empleado_id))
    const aplicar = ids.filter(id => !conPermiso.has(id))

    if (!aplicar.length) {
      btn.disabled = false; btn.textContent = 'Aplicar'
      return falla(`Los ${ids.length} seleccionados ya tienen un permiso el ${fecha}. No se agregó nada.`)
    }

    const nombres = Object.fromEntries(pmEmpleados.map(e => [e.id, e.nombre]))
    const saltados = [...conPermiso].map(id => nombres[id]).filter(Boolean)
    const resumen = `${aplicar.length} empleado(s) · ${fecha} · ${PM_TIPOS[tipo]}${conHora && hora ? ' · ' + hora : ''} · ${trat}`
      + (saltados.length ? `\n\nSe SALTAN ${saltados.length} que ya tienen permiso ese día:\n${saltados.slice(0, 12).join(', ')}${saltados.length > 12 ? '…' : ''}` : '')
    if (!confirm(`¿Aplicar el permiso?\n\n${resumen}\n\nQuedan registrados a tu nombre y se pueden anular después.`)) {
      btn.disabled = false; btn.textContent = 'Aplicar'; return
    }

    btn.textContent = 'Guardando...'
    const quien = window._currentProfile?.()?.nombre || ''
    const filas = aplicar.map(id => {
      const reg = {
        empleado_id: id,
        empleado_nombre: String(nombres[id] || '').toUpperCase(),
        fecha, motivo, tipo,
        aprobado_por: quien,
        tratamiento: trat,
        a_cuenta_vacaciones: (trat === 'vacaciones')   // compatibilidad con lógica vieja
      }
      if (tipo === 'llegada_tarde') { reg.hora_entrada = hora || null; reg.hora_salida = null }
      else if (conHora) { reg.hora_salida = hora || null }
      else { reg.hora_salida = null }
      return reg
    })

    const { error } = await pmSb().from('permisos_empleados').insert(filas)
    if (error) throw error

    window.logActividad?.('permiso_masivo', 'rrhh',
      `${aplicar.length} empleados · ${fecha} · ${PM_TIPOS[tipo]}${conHora && hora ? ' ' + hora : ''} · ${trat} · ${motivo}`)
    closeModal('modal-perm-masivo')
    window.toast?.(`${aplicar.length} permiso(s) registrados${saltados.length ? ` · ${saltados.length} saltado(s)` : ''}`, 'success')
    window.cargarPermisos?.()
  } catch (e) {
    falla(e.message || String(e))
    btn.disabled = false; btn.textContent = 'Aplicar'
  }
}

// ── Estilos ──
function pmEnsureStyles() {
  if (document.getElementById('pm-css')) return
  const st = document.createElement('style')
  st.id = 'pm-css'
  st.textContent = `
    .pm-modal{max-width:min(860px,96vw)!important;width:min(860px,96vw)!important}
    .pm-modal .modal-body{max-height:min(72vh,680px);overflow:auto}
    .pm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
    .pm-f{margin-bottom:10px}
    .pm-f label{display:block;font-size:11px;color:var(--text3);margin-bottom:4px}
    .pm-f input,.pm-f select{width:100%;padding:8px 11px;background:var(--bg3);border:0.5px solid var(--border);
      border-radius:var(--radius);color:var(--text);font-size:13px;outline:none}
    .pm-help{font-size:10px;color:var(--text3);margin-top:3px}
    .pm-sel-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 6px}
    .pm-acts{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .pm-acts input,.pm-acts select{padding:5px 9px;background:var(--bg3);border:0.5px solid var(--border);
      border-radius:var(--radius);color:var(--text);font-size:11px;outline:none}
    .pm-mini{font-size:11px;padding:4px 10px}
    .pm-dim{color:var(--text3);font-size:11px;font-weight:400}
    .pm-lista{max-height:260px;overflow:auto;border:0.5px solid var(--border);border-radius:9px}
    .pm-row{display:flex;align-items:center;gap:9px;padding:6px 11px;border-bottom:0.5px solid var(--border);cursor:pointer}
    .pm-row:last-child{border-bottom:none}
    .pm-row:hover{background:rgba(255,255,255,.03)}
    .pm-row input{width:16px;height:16px;cursor:pointer}
    .pm-nom{flex:1;font-size:12px}
    .pm-chip{font-size:10px;color:var(--text3);border:1px solid var(--border);border-radius:5px;padding:1px 5px}
    .pm-preview{margin-top:12px}
    .pm-prev-t{font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);margin-bottom:5px}
    .pm-prev-g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
    .pm-prev-g>div{background:var(--bg3);border:0.5px solid var(--border);border-radius:9px;padding:9px;text-align:center}
    .pm-prev-g b{display:block;font-size:15px}
    .pm-prev-g span{display:block;font-size:10px;color:var(--text3);margin-top:2px}
    .pm-warn{background:rgba(245,196,81,.12);border:0.5px solid rgba(245,196,81,.4);color:var(--amber-fg,#f5c451);
      border-radius:var(--radius);padding:9px 12px;font-size:12px;margin-top:10px}
    .pm-warn.hidden{display:none}
    @media (max-width:760px){ .pm-modal{width:96vw!important} .pm-prev-g{grid-template-columns:repeat(2,1fr)} }`
  document.head.appendChild(st)
}