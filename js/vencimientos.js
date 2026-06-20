// ════════════════════════════════════════════════════════════════════
// VENCIMIENTO DE DOCUMENTOS
// Seguimiento de documentos/obligaciones con fecha de vencimiento.
// Resalta vencidos y próximos a vencer (según "alerta_dias" por documento).
// Tabla: documentos_vencimiento.
// ════════════════════════════════════════════════════════════════════
let _vencData = []

function _vDias(fecha) {
  if (!fecha) return null
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const f = new Date(String(fecha).slice(0, 10) + 'T00:00:00')
  if (isNaN(f)) return null
  return Math.round((f - hoy) / 86400000)
}

// Clasifica un documento: 'vencido' | 'porvencer' | 'vigente' | 'resuelto' | 'sinfecha'
function _vEstado(d) {
  if (d.estado === 'renovado' || d.estado === 'no_aplica') return 'resuelto'
  const dias = _vDias(d.fecha_vencimiento)
  if (dias === null) return 'sinfecha'
  if (dias < 0) return 'vencido'
  if (dias <= (parseInt(d.alerta_dias) || 30)) return 'porvencer'
  return 'vigente'
}

window.initVencimientos = async function () {
  limpiarFormVenc()
  await _cargarVencimientos()
}

async function _cargarVencimientos() {
  const sb = window._sb
  const { data, error } = await sb.from('documentos_vencimiento')
    .select('*').eq('activo', true)
    .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  _vencData = data || []
  _renderVencimientos()
}

function _renderVencimientos() {
  const conteo = { total: 0, vencido: 0, porvencer: 0, vigente: 0 }
  _vencData.forEach(d => {
    const e = _vEstado(d)
    if (e === 'resuelto') return
    conteo.total++
    if (e === 'vencido') conteo.vencido++
    else if (e === 'porvencer') conteo.porvencer++
    else if (e === 'vigente') conteo.vigente++
  })
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v }
  set('venc-stat-total', conteo.total)
  set('venc-stat-vencidos', conteo.vencido)
  set('venc-stat-porvencer', conteo.porvencer)
  set('venc-stat-vigentes', conteo.vigente)
  set('venc-count', `${_vencData.length} documento(s)`)

  const color = { vencido: 'var(--red)', porvencer: 'var(--gold)', vigente: 'var(--green)', resuelto: 'var(--text3)', sinfecha: 'var(--text3)' }
  const etiqueta = { vencido: 'Vencido', porvencer: 'Por vencer', vigente: 'Vigente', resuelto: '—', sinfecha: 'Sin fecha' }
  const estLabel = { pendiente: 'Pendiente', en_tramite: 'En trámite', renovado: 'Renovado', no_aplica: 'No aplica' }
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // Orden: vencidos primero, luego por vencer, luego vigentes; resueltos al final
  const orden = { vencido: 0, porvencer: 1, sinfecha: 2, vigente: 3, resuelto: 4 }
  const filas = [..._vencData].sort((a, b) => {
    const ea = _vEstado(a), eb = _vEstado(b)
    if (orden[ea] !== orden[eb]) return orden[ea] - orden[eb]
    return _vDias(a.fecha_vencimiento) ?? 99999 - (_vDias(b.fecha_vencimiento) ?? 99999)
  })

  const lista = document.getElementById('venc-lista')
  if (!lista) return
  if (!filas.length) { lista.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3);font-size:13px">No hay documentos registrados. Agrega el primero arriba.</div>'; return }

  lista.innerHTML = `<table>
    <thead><tr>
      <th>Documento</th><th>Tipo</th><th>Ente</th><th>Vence</th>
      <th style="text-align:center">Días</th><th>Estado</th><th>Responsable</th><th></th>
    </tr></thead>
    <tbody>
      ${filas.map(d => {
        const e = _vEstado(d)
        const dias = _vDias(d.fecha_vencimiento)
        const diasTxt = dias === null ? '—' : (dias < 0 ? `${Math.abs(dias)}d vencido` : `${dias}d`)
        return `<tr>
          <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color[e]};margin-right:8px"></span>${esc(d.nombre)}${d.notas ? `<div style="font-size:11px;color:var(--text3);margin-left:16px">${esc(d.notas)}</div>` : ''}</td>
          <td style="font-size:12px">${esc(d.tipo || '—')}</td>
          <td style="font-size:12px">${esc(d.entidad || '—')}</td>
          <td style="font-family:var(--mono);font-size:12px">${d.fecha_vencimiento ? String(d.fecha_vencimiento).slice(0, 10) : '—'}</td>
          <td style="text-align:center;font-size:12px;color:${color[e]}">${diasTxt}</td>
          <td style="font-size:12px;color:${color[e]}">${etiqueta[e]}${(d.estado === 'renovado' || d.estado === 'no_aplica') ? ` (${estLabel[d.estado]})` : ''}</td>
          <td style="font-size:12px">${esc(d.responsable || '—')}</td>
          <td style="white-space:nowrap;text-align:right">
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="editarVencimiento('${d.id}')">✎</button>
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="eliminarVencimiento('${d.id}')">🗑</button>
          </td>
        </tr>`
      }).join('')}
    </tbody>
  </table>`
}

window.limpiarFormVenc = function () {
  const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val }
  v('venc-id', ''); v('venc-nombre', ''); v('venc-tipo', ''); v('venc-entidad', '')
  v('venc-fecha', ''); v('venc-alerta', '30'); v('venc-responsable', ''); v('venc-estado', 'pendiente'); v('venc-notas', '')
  const t = document.getElementById('venc-form-title'); if (t) t.textContent = 'Nuevo documento'
}

window.editarVencimiento = function (id) {
  const d = _vencData.find(x => String(x.id) === String(id))
  if (!d) return
  const v = (cid, val) => { const el = document.getElementById(cid); if (el) el.value = val ?? '' }
  v('venc-id', d.id); v('venc-nombre', d.nombre); v('venc-tipo', d.tipo); v('venc-entidad', d.entidad)
  v('venc-fecha', d.fecha_vencimiento ? String(d.fecha_vencimiento).slice(0, 10) : '')
  v('venc-alerta', d.alerta_dias ?? 30); v('venc-responsable', d.responsable)
  v('venc-estado', d.estado || 'pendiente'); v('venc-notas', d.notas)
  const t = document.getElementById('venc-form-title'); if (t) t.textContent = 'Editar documento'
  document.getElementById('venc-nombre')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

window.guardarVencimiento = async function () {
  const sb = window._sb
  const nombre = (document.getElementById('venc-nombre')?.value || '').trim()
  if (!nombre) { window.toast?.('El nombre del documento es obligatorio', 'error'); return }
  const id = document.getElementById('venc-id')?.value || ''
  const payload = {
    nombre,
    tipo: (document.getElementById('venc-tipo')?.value || '') || null,
    entidad: (document.getElementById('venc-entidad')?.value || '').trim() || null,
    fecha_vencimiento: document.getElementById('venc-fecha')?.value || null,
    alerta_dias: parseInt(document.getElementById('venc-alerta')?.value) || 30,
    responsable: (document.getElementById('venc-responsable')?.value || '').trim() || null,
    estado: document.getElementById('venc-estado')?.value || 'pendiente',
    notas: (document.getElementById('venc-notas')?.value || '').trim() || null
  }
  const btn = document.getElementById('btn-guardar-venc'); if (btn) { btn.disabled = true; btn.textContent = 'Guardando…' }
  let error
  if (id) { const r = await sb.from('documentos_vencimiento').update(payload).eq('id', id); error = r.error }
  else { const r = await sb.from('documentos_vencimiento').insert({ ...payload, activo: true }); error = r.error }
  if (btn) { btn.disabled = false; btn.textContent = 'Guardar documento →' }
  if (error) { window.toast?.('Error al guardar: ' + error.message, 'error'); return }
  window.toast?.(id ? 'Documento actualizado' : 'Documento agregado', 'success')
  limpiarFormVenc()
  await _cargarVencimientos()
}

window.eliminarVencimiento = async function (id) {
  const d = _vencData.find(x => String(x.id) === String(id))
  if (!confirm(`¿Eliminar "${d?.nombre || 'este documento'}"?`)) return
  const sb = window._sb
  const { error } = await sb.from('documentos_vencimiento').update({ activo: false }).eq('id', id)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  window.toast?.('Documento eliminado', 'success')
  await _cargarVencimientos()
}