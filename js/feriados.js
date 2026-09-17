// js/feriados.js
// Administración del catálogo de feriados (RRHH → Config. planilla).
//
// Un feriado mal puesto le paga un día a toda la planilla sin que nadie trabaje;
// uno faltante se lo quita y además descuenta el domingo de esa semana, porque
// _aplicarSeptimo castiga con dos días cada semana con falta. Por eso la pantalla
// es solo para super_admin y no borra nada: desactiva.
//
// La tabla `feriados` la lee asistencia.js en cada cálculo.

const fbSb = () => window._sb
const fbRol = () => (window._currentProfile?.()?.rol || '').toLowerCase()
const fbEsAdmin = () => fbRol() === 'super_admin'

let fbLista = []

const FB_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const fbDiaSemana = (ymd) => {
  const d = new Date(String(ymd) + 'T12:00:00')   // mediodía: evita el corrimiento por zona horaria
  return isNaN(d) ? '—' : FB_DIAS[d.getDay()]
}
const fbEsc = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── Carga y pintado ──
window.cargarFeriadosAdmin = async () => {
  const host = document.getElementById('feriados-host')
  if (!host) return

  const btn = document.getElementById('btn-nuevo-feriado')
  if (btn) btn.style.display = fbEsAdmin() ? '' : 'none'

  host.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>'
  try {
    const { data, error } = await fbSb().from('feriados').select('*').order('fecha')
    if (error) throw error
    fbLista = data || []
    fbPintar(host)
  } catch (e) {
    host.innerHTML = `<div class="fb-warn">No se pudo leer el catálogo: ${fbEsc(e.message || e)}</div>`
  }
}

function fbPintar(host) {
  fbEnsureStyles()
  const hoy = new Date().toLocaleDateString('en-CA')
  const anios = [...new Set(fbLista.map(f => String(f.fecha).slice(0, 4)))].sort().reverse()

  if (!fbLista.length) {
    host.innerHTML = '<div class="fb-vacio">No hay feriados cargados. Mientras el catálogo esté vacío, todo día de lunes a sábado exige marca.</div>'
    return
  }

  host.innerHTML = anios.map(anio => {
    const delAnio = fbLista.filter(f => String(f.fecha).startsWith(anio))
    const filas = delAnio.map(f => {
      const pasado = String(f.fecha) < hoy
      const dia = fbDiaSemana(f.fecha)
      // Un feriado en domingo no hace daño pero tampoco sirve: el domingo ya no
      // es día esperado. Casi siempre significa que la fecha está mal escrita.
      const esDomingo = dia === 'Domingo'
      return `<tr class="${f.activo ? '' : 'fb-off'}">
        <td style="white-space:nowrap"><b>${f.fecha}</b></td>
        <td style="white-space:nowrap;color:var(--text3)">${dia}${esDomingo ? ' <span class="fb-alerta" title="Cae domingo: el domingo ya no exige marca, revisá que la fecha sea correcta">⚠</span>' : ''}</td>
        <td>${fbEsc(f.nombre)}${f.movil ? ' <span class="fb-chip">móvil</span>' : ''}</td>
        <td style="font-size:11px;color:var(--text3)">${fbEsc(f.nota || '')}</td>
        <td style="white-space:nowrap">${f.activo
            ? '<span class="badge badge-green">Activo</span>'
            : '<span class="badge badge-amber">Inactivo</span>'}${pasado ? ' <span class="fb-chip">pasado</span>' : ''}</td>
        <td style="text-align:right;white-space:nowrap">${fbEsAdmin()
            ? `<button class="btn btn-ghost fb-mini" onclick="fbToggle('${f.fecha}')">${f.activo ? 'Desactivar' : 'Activar'}</button>`
            : ''}</td>
      </tr>`
    }).join('')
    const activos = delAnio.filter(f => f.activo).length
    return `<div class="fb-anio">
      <div class="fb-anio-t">${anio} <span>${activos} activo(s) de ${delAnio.length}</span></div>
      <div class="fb-tw"><table class="fb-t">
        <thead><tr><th>Fecha</th><th>Día</th><th>Feriado</th><th>Nota</th><th>Estado</th><th></th></tr></thead>
        <tbody>${filas}</tbody></table></div>
    </div>`
  }).join('') + `<div class="fb-pie">Cambiar el catálogo <b>no modifica planillas ya generadas</b>.
    Afecta los cálculos de aquí en adelante; para corregir una quincena anterior hay que regenerarla,
    y si ya está aprobada o pagada, reabrirla primero.</div>`
}

// ── Alta ──
window.abrirFeriadoModal = () => {
  if (!fbEsAdmin()) { window.toast?.('Solo un super admin puede cargar feriados', 'error'); return }
  let bd = document.getElementById('modal-feriado')
  if (!bd) {
    bd = document.createElement('div')
    bd.className = 'modal-backdrop'; bd.id = 'modal-feriado'
    document.body.appendChild(bd)
    bd.addEventListener('click', ev => { if (ev.target === bd) closeModal('modal-feriado') })
  }
  bd.innerHTML = `<div class="modal" style="width:min(480px,94vw)">
      <div class="modal-header">
        <h3>📅 Nuevo feriado</h3>
        <button class="modal-close" onclick="closeModal('modal-feriado')">✕</button>
      </div>
      <div class="modal-body">
        <div class="fb-f"><label>Fecha</label>
          <input type="date" id="fb-fecha" onchange="fbPreviewDia()">
          <div class="fb-help" id="fb-dia-hint"></div>
        </div>
        <div class="fb-f"><label>Nombre del feriado</label>
          <input type="text" id="fb-nombre" placeholder="Ej: Día de la Independencia" maxlength="80">
        </div>
        <div class="fb-f"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="fb-movil" style="width:16px;height:16px">
          <span>Es móvil (cambia de fecha cada año)</span></label>
          <div class="fb-help">Semana Santa y el feriado morazánico se cargan año por año.</div>
        </div>
        <div class="fb-f"><label>Nota <span style="color:var(--text3)">(opcional)</span></label>
          <input type="text" id="fb-nota" maxlength="120">
        </div>
        <div id="fb-err" class="fb-warn hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('modal-feriado')">Cancelar</button>
        <button class="btn btn-gold" id="fb-guardar" onclick="fbGuardar()">Guardar</button>
      </div>
    </div>`
  bd.classList.add('open')
}

window.fbPreviewDia = () => {
  const f = document.getElementById('fb-fecha')?.value
  const hint = document.getElementById('fb-dia-hint')
  if (!hint) return
  if (!f) { hint.textContent = ''; return }
  const dia = fbDiaSemana(f)
  const hoy = new Date().toLocaleDateString('en-CA')
  let txt = dia
  if (dia === 'Domingo') txt += ' — el domingo ya no exige marca, así que cargarlo no cambia nada. Revisá la fecha.'
  else if (f < hoy) txt += ' — es una fecha pasada: no cambia las planillas ya generadas.'
  hint.textContent = txt
  hint.style.color = (dia === 'Domingo') ? '#f5c451' : 'var(--text3)'
}

window.fbGuardar = async () => {
  const err = document.getElementById('fb-err')
  const falla = m => { err.textContent = m; err.classList.remove('hidden') }
  err.classList.add('hidden')

  const fecha = document.getElementById('fb-fecha').value
  const nombre = (document.getElementById('fb-nombre').value || '').trim()
  const movil = document.getElementById('fb-movil').checked
  const nota = (document.getElementById('fb-nota').value || '').trim() || null

  if (!fecha) return falla('Falta la fecha.')
  if (!nombre) return falla('Falta el nombre del feriado.')
  if (fbLista.some(f => String(f.fecha) === fecha)) {
    return falla(`Ya existe un feriado el ${fecha}: ${fbLista.find(f => String(f.fecha) === fecha).nombre}`)
  }

  const btn = document.getElementById('fb-guardar')
  btn.disabled = true; btn.textContent = 'Guardando...'
  try {
    const quien = window._currentProfile?.()?.nombre || 'super_admin'
    const { error } = await fbSb().from('feriados')
      .insert({ fecha, nombre, movil, nota, activo: true, creado_por: quien })
    if (error) throw error
    window.logActividad?.('feriado_creado', 'rrhh', `${fecha} · ${nombre}${movil ? ' (móvil)' : ''}`)
    closeModal('modal-feriado')
    window.toast?.('Feriado agregado', 'success')
    await window.cargarFeriadosAdmin()
    // El cache de asistencia.js quedó viejo: se fuerza la relectura para que el
    // próximo cálculo lo tome sin tener que recargar la página.
    await window.cargarFeriados?.(true)
  } catch (e) {
    falla(e.message || String(e))
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar'
  }
}

// ── Activar / desactivar ──
// No hay borrar: si una quincena se calculó con ese feriado, borrarlo deja sin
// explicación por qué esos días no exigieron marca.
window.fbToggle = async (fecha) => {
  if (!fbEsAdmin()) { window.toast?.('Solo un super admin puede modificar feriados', 'error'); return }
  const f = fbLista.find(x => String(x.fecha) === String(fecha))
  if (!f) return
  const accion = f.activo ? 'desactivar' : 'activar'
  if (!confirm(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} el feriado del ${fecha} (${f.nombre})?\n\n` +
    (f.activo
      ? 'Ese día vuelve a exigir marca. Quien no marque ese día tendrá falta, y además perderá el domingo de esa semana.'
      : 'Ese día deja de exigir marca y se paga igual.') +
    '\n\nLas planillas ya generadas NO cambian.')) return
  try {
    const { error } = await fbSb().from('feriados').update({ activo: !f.activo }).eq('fecha', fecha)
    if (error) throw error
    window.logActividad?.(f.activo ? 'feriado_desactivado' : 'feriado_activado', 'rrhh', `${fecha} · ${f.nombre}`)
    window.toast?.(`Feriado ${f.activo ? 'desactivado' : 'activado'}`, 'success')
    await window.cargarFeriadosAdmin()
    await window.cargarFeriados?.(true)
  } catch (e) {
    window.toast?.('No se pudo cambiar: ' + (e.message || e), 'error')
  }
}

// ── Estilos ──
function fbEnsureStyles() {
  if (document.getElementById('fb-css')) return
  const st = document.createElement('style')
  st.id = 'fb-css'
  st.textContent = `
    .fb-anio{margin-bottom:16px}
    .fb-anio-t{font-weight:600;font-size:13px;margin-bottom:6px}
    .fb-anio-t span{color:var(--text3);font-weight:400;font-size:11px;margin-left:6px}
    .fb-tw{border:0.5px solid var(--border);border-radius:9px;overflow:hidden}
    .fb-t{width:100%;border-collapse:collapse;font-size:12px}
    .fb-t th{text-align:left;padding:7px 10px;font-size:10px;letter-spacing:.4px;text-transform:uppercase;
      color:var(--text3);border-bottom:0.5px solid var(--border)}
    .fb-t td{padding:8px 10px;border-bottom:0.5px solid var(--border)}
    .fb-t tr:last-child td{border-bottom:none}
    .fb-off td{opacity:.45}
    .fb-mini{font-size:11px;padding:3px 9px}
    .fb-chip{font-size:10px;color:var(--text3);border:1px solid var(--border);border-radius:5px;padding:1px 5px}
    .fb-alerta{color:#f5c451}
    .fb-vacio{padding:18px;text-align:center;color:var(--text3);font-size:12px;
      border:1px dashed var(--border);border-radius:9px}
    .fb-pie{font-size:11px;color:var(--text3);background:var(--bg3);border:0.5px solid var(--border);
      border-radius:8px;padding:9px 12px;line-height:1.5}
    .fb-f{margin-bottom:12px}
    .fb-f label{display:block;font-size:11px;color:var(--text3);margin-bottom:4px}
    .fb-f input[type=text],.fb-f input[type=date]{width:100%;padding:8px 11px;background:var(--bg3);
      border:0.5px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;outline:none}
    .fb-help{font-size:10px;color:var(--text3);margin-top:3px;line-height:1.4}
    .fb-warn{background:rgba(239,68,68,.12);border:0.5px solid rgba(239,68,68,.4);color:#fca5a5;
      border-radius:var(--radius);padding:9px 12px;font-size:12px}
    .fb-warn.hidden{display:none}`
  document.head.appendChild(st)
}