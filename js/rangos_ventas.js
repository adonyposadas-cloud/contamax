// ── CONTAMAX · Control de rango de VENTAS propias (SAR) ──
// Registra los rangos/CAI propios por centro de costo y analiza el libro de
// ventas para: estado del CAI (vigente/por vencer/vencido), facturas usadas vs
// restantes del rango (alerta 5%), y saltos en el correlativo (faltantes).
// Depende de: window._sb, window._currentProfile, window.toast, window.logActividad

const rvSb = () => window._sb
const rvFmt = n => (parseFloat(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 0 })

let rvCentros = []
let rvRangos = []           // todos los rangos propios
let rvAnalisis = {}         // rango_id -> { usadas, restantes, faltantes:[], ultimo }
let rvEditId = null
let rvCentroActual = null

function rvPuedeEditar() {
  return ['super_admin', 'aux_contable', 'contador'].includes(window._currentProfile?.()?.rol)
}

window.initRangosVentas = async () => {
  await rvCargar()
}

function rvCorrelativo(num) {
  if (!num) return null
  const m = String(num).match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : null
}

async function rvCargar() {
  const cont = document.getElementById('rv-lista')
  if (cont) cont.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3)">Cargando…</div>'

  const { data: cc } = await rvSb().from('centros_costo').select('id, nombre, codigo, tipo_actividad').order('nombre')
  rvCentros = cc || []
  const { data: rangos, error } = await rvSb().from('rangos_propios').select('*').order('fecha_limite', { ascending: true })
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  rvRangos = rangos || []

  // Analizar el libro de ventas para cada rango (usadas, restantes, faltantes)
  rvAnalisis = {}
  for (const r of rvRangos) await rvAnalizarRango(r)

  rvRender()
}

// Analiza el libro_ventas contra un rango: cuántas usadas, restantes y faltantes
async function rvAnalizarRango(r) {
  const desde = rvCorrelativo(r.rango_desde), hasta = rvCorrelativo(r.rango_hasta)
  if (desde == null || hasta == null || hasta < desde) { rvAnalisis[r.id] = null; return }
  const total = hasta - desde + 1

  // Traer facturas del libro de ese centro que empiecen con el prefijo
  let q = rvSb().from('libro_ventas').select('factura_electronica, cliente').limit(50000)
  if (r.centro_costo_id) q = q.eq('centro_costo_id', r.centro_costo_id)
  const { data: libro } = await q
  // Filtrar por prefijo y quedarnos con el correlativo
  const usadosSet = new Set()
  let ultimo = desde - 1
  for (const f of (libro || [])) {
    const fe = f.factura_electronica || ''
    if (r.prefijo && !fe.startsWith(r.prefijo)) continue
    const n = rvCorrelativo(fe)
    if (n == null || n < desde || n > hasta) continue
    usadosSet.add(n)
    if (n > ultimo) ultimo = n
  }
  // Faltantes = números entre desde y el último usado que NO están en el libro
  const faltantes = []
  for (let n = desde; n <= ultimo; n++) if (!usadosSet.has(n)) faltantes.push(n)
  const usadas = usadosSet.size
  const restantes = total - (ultimo - desde + 1)   // las que quedan por emitir del rango

  rvAnalisis[r.id] = {
    usadas, restantes, total, faltantes,
    ultimo: ultimo >= desde ? ultimo : null,
    pctRestante: total > 0 ? (restantes / total) * 100 : 100
  }
  // Actualizar ultimo_usado si cambió
  if (ultimo >= desde) {
    const ultimoStr = `${r.prefijo ? r.prefijo + '-' : ''}${String(ultimo).padStart(8, '0')}`
    if (r.ultimo_usado !== ultimoStr) rvSb().from('rangos_propios').update({ ultimo_usado: ultimoStr }).eq('id', r.id)
  }
}

function rvEstado(r) {
  const ests = []
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  if (r.fecha_limite) {
    const fl = new Date(r.fecha_limite + 'T00:00:00')
    const dias = Math.round((fl - hoy) / 864e5)
    if (dias < 0) ests.push({ txt: `VENCIDO hace ${-dias}d`, color: 'var(--red)', alerta: true })
    else if (dias <= 7) ests.push({ txt: `Vence en ${dias}d ⚠`, color: 'var(--red)', alerta: true })
    else if (dias <= 30) ests.push({ txt: `Vence en ${dias}d`, color: 'var(--amber)', alerta: true })
    else ests.push({ txt: `Vigente (${dias}d)`, color: 'var(--green)', alerta: false })
  }
  const a = rvAnalisis[r.id]
  if (a && a.pctRestante <= 5) ests.push({ txt: `Rango casi agotado (${a.restantes} rest.)`, color: 'var(--red)', alerta: true })
  if (a && a.faltantes.length) ests.push({ txt: `${a.faltantes.length} faltante(s) en correlativo`, color: 'var(--amber)', alerta: true })
  return ests
}

function rvNombreCentro(id) {
  return rvCentros.find(c => c.id === id)?.nombre || '— sin centro —'
}

function rvRender() {
  const cont = document.getElementById('rv-lista')
  if (!cont) return
  if (!rvRangos.length) {
    cont.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text3)">No hay rangos de venta cargados.${rvPuedeEditar() ? ' Agregá el primero con el botón de arriba.' : ''}</div>`
  }

  const filas = rvRangos.map(r => {
    const a = rvAnalisis[r.id]
    const ests = rvEstado(r)
    const tieneAlerta = ests.some(e => e.alerta)
    const badges = ests.map(e => `<span style="font-size:10px;color:${e.color};border:1px solid ${e.color};border-radius:3px;padding:1px 6px;margin-left:4px">${e.txt}</span>`).join('')
    const barra = a ? `
      <div style="margin-top:8px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:3px">
          <span>Usadas: ${a.usadas} · Último: ${a.ultimo != null ? a.ultimo : '—'}</span>
          <span>Restantes: <strong style="color:${a.pctRestante <= 5 ? 'var(--red)' : 'var(--text2)'}">${a.restantes}</strong> de ${a.total}</span>
        </div>
        <div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100, ((a.total - a.restantes) / a.total) * 100)}%;background:${a.pctRestante <= 5 ? 'var(--red)' : 'var(--gold)'}"></div>
        </div>
        ${a.faltantes.length ? `<div style="font-size:11px;color:var(--amber);margin-top:6px">⚠ Faltantes: ${a.faltantes.slice(0, 20).map(n => String(n).padStart(8, '0')).join(', ')}${a.faltantes.length > 20 ? ` … (+${a.faltantes.length - 20})` : ''}</div>` : ''}
      </div>` : '<div style="font-size:11px;color:var(--text3);margin-top:6px">Rango inválido o sin datos</div>'

    return `<div class="card" style="padding:14px;margin-bottom:10px;${tieneAlerta ? 'border-left:3px solid var(--red)' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1">
          <div style="font-weight:600">${rvNombreCentro(r.centro_costo_id)}${r.descripcion ? ` · <span style="font-weight:400;color:var(--text3)">${r.descripcion}</span>` : ''}${tieneAlerta ? ' <span style="color:var(--red);font-size:11px">⚠</span>' : ''}</div>
          <div style="font-size:12px;color:var(--text3);font-family:var(--mono)">${r.rango_desde || '?'} → ${r.rango_hasta || '?'}${badges}</div>
          ${barra}
        </div>
        ${rvPuedeEditar() ? `<button class="btn btn-ghost" onclick="rvEditar('${r.id}')" style="padding:4px 10px;font-size:11px">✏️</button>` : ''}
      </div>
    </div>`
  }).join('')

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:12px;color:var(--text3)">${rvRangos.length} rango(s) de venta</div>
      ${rvPuedeEditar() ? '<button class="btn btn-gold" onclick="rvEditar(null)" style="padding:6px 14px;font-size:12px">+ Rango de venta</button>' : ''}
    </div>
    ${filas}`
}

// ── Modal ──
window.rvEditar = (id) => {
  rvEditId = id
  const r = id ? rvRangos.find(x => x.id === id) : null
  document.getElementById('rv-modal-title').textContent = r ? 'Editar rango de venta' : 'Nuevo rango de venta'
  const sel = document.getElementById('rv-centro')
  sel.innerHTML = rvCentros.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')
  sel.value = r?.centro_costo_id || (rvCentros[0]?.id || '')
  document.getElementById('rv-cai').value = r?.cai || ''
  document.getElementById('rv-prefijo').value = r?.prefijo || ''
  document.getElementById('rv-desde').value = r?.rango_desde || ''
  document.getElementById('rv-hasta').value = r?.rango_hasta || ''
  document.getElementById('rv-fecha').value = r?.fecha_limite || ''
  document.getElementById('rv-desc').value = r?.descripcion || ''
  document.getElementById('rv-activo').checked = r ? (r.activo !== false) : true
  document.getElementById('rv-btn-eliminar').style.display = id ? '' : 'none'
  document.getElementById('modal-rango-venta').classList.add('open')
}

window.rvGuardar = async () => {
  const payload = {
    centro_costo_id: document.getElementById('rv-centro').value || null,
    cai: (document.getElementById('rv-cai').value || '').trim() || null,
    prefijo: (document.getElementById('rv-prefijo').value || '').trim() || null,
    rango_desde: (document.getElementById('rv-desde').value || '').trim() || null,
    rango_hasta: (document.getElementById('rv-hasta').value || '').trim() || null,
    fecha_limite: document.getElementById('rv-fecha').value || null,
    descripcion: (document.getElementById('rv-desc').value || '').trim() || null,
    activo: document.getElementById('rv-activo').checked
  }
  if (!payload.centro_costo_id) { window.toast?.('Elegí el centro de costo', 'error'); return }
  if (!payload.rango_desde || !payload.rango_hasta) { window.toast?.('Ingresá el rango desde y hasta', 'error'); return }
  if (!payload.fecha_limite) { window.toast?.('Ingresá la fecha límite', 'error'); return }
  const prof = window._currentProfile?.()
  let res
  if (rvEditId) res = await rvSb().from('rangos_propios').update(payload).eq('id', rvEditId)
  else { payload.created_by = prof?.id || null; res = await rvSb().from('rangos_propios').insert(payload) }
  if (res.error) { window.toast?.('Error: ' + res.error.message, 'error'); return }
  window.toast?.('Rango de venta guardado ✓', 'success')
  window.logActividad?.('rango_venta', 'fiscal', `${rvNombreCentro(payload.centro_costo_id)} · ${payload.rango_desde}→${payload.rango_hasta}`)
  document.getElementById('modal-rango-venta').classList.remove('open')
  await rvCargar()
}

window.rvEliminar = async () => {
  if (!rvEditId) return
  if (!confirm('¿Eliminar este rango de venta?')) return
  const { error } = await rvSb().from('rangos_propios').delete().eq('id', rvEditId)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  document.getElementById('modal-rango-venta').classList.remove('open')
  await rvCargar()
}