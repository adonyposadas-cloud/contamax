// ── CONTAMAX · Catálogo de PROVEEDORES con CAI/rangos (SAR) ──
// La auxiliar contable administra proveedores y sus rangos de facturación
// autorizados. Calcula estados: vigente / por vencer (30d) / vencido /
// rango casi agotado (5%). Base para la verificación fiscal de compras.
// Depende de: window._sb, window._currentProfile, window.toast, window.logActividad

const pvSb = () => window._sb
const pvFmt = n => (parseFloat(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 0 })

let pvProveedores = []
let pvCaiPorProv = {}     // proveedor_id -> [cai...]
let pvFiltro = ''
let pvEditProvId = null
let pvEditCaiId = null
let pvCaiProvActual = null   // proveedor al que se le agregan CAI en el modal

function pvPuedeEditar() {
  return ['super_admin', 'aux_contable', 'contador'].includes(window._currentProfile?.()?.rol)
}

window.initProveedores = async () => {
  pvFiltro = ''
  await pvCargar()
}

async function pvCargar() {
  const cont = document.getElementById('pv-lista')
  if (cont) cont.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)"><div class="spinner"></div></div>'

  const { data: provs, error } = await pvSb().from('proveedores')
    .select('id, nombre, rtn, verificado').order('nombre').limit(5000)
  if (error) { window.toast?.('Error cargando proveedores: ' + error.message, 'error'); return }
  pvProveedores = provs || []

  const { data: cais } = await pvSb().from('proveedor_cai')
    .select('*').order('fecha_limite', { ascending: true }).limit(20000)
  pvCaiPorProv = {}
  for (const c of (cais || [])) (pvCaiPorProv[c.proveedor_id] = pvCaiPorProv[c.proveedor_id] || []).push(c)

  pvRender()
}

// Estado de un CAI: {clase, etiqueta, color}
function pvEstadoCai(c) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const estados = []
  // Vencimiento
  if (c.fecha_limite) {
    const fl = new Date(c.fecha_limite + 'T00:00:00')
    const dias = Math.round((fl - hoy) / 864e5)
    if (dias < 0) estados.push({ txt: `VENCIDO hace ${-dias}d`, color: 'var(--red)', alerta: true })
    else if (dias <= 7) estados.push({ txt: `Vence en ${dias}d ⚠`, color: 'var(--red)', alerta: true })
    else if (dias <= 30) estados.push({ txt: `Vence en ${dias}d`, color: 'var(--amber)', alerta: true })
    else estados.push({ txt: `Vigente (${dias}d)`, color: 'var(--green)', alerta: false })
  }
  // Rango (usa la parte numérica final del número de factura)
  const numDesde = pvCorrelativo(c.rango_desde), numHasta = pvCorrelativo(c.rango_hasta)
  if (numDesde != null && numHasta != null && numHasta >= numDesde) {
    const total = numHasta - numDesde + 1
    const usados = c.ultimo_usado != null ? (pvCorrelativo(c.ultimo_usado) - numDesde + 1) : 0
    const restantes = total - usados
    const pct = total > 0 ? (restantes / total) * 100 : 100
    if (pct <= 5) estados.push({ txt: `Rango casi agotado (${restantes} rest.)`, color: 'var(--red)', alerta: true })
  }
  return estados
}

// Extrae el correlativo numérico (últimos dígitos) de un número de factura completo
function pvCorrelativo(num) {
  if (!num) return null
  const m = String(num).match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : null
}

function pvRender() {
  const cont = document.getElementById('pv-lista')
  if (!cont) return
  const q = pvFiltro.trim().toLowerCase()
  const lista = q
    ? pvProveedores.filter(p => (p.nombre || '').toLowerCase().includes(q) || (p.rtn || '').toLowerCase().includes(q))
    : pvProveedores

  // Conteo de alertas globales
  let conAlerta = 0
  for (const p of pvProveedores) {
    const cais = pvCaiPorProv[p.id] || []
    if (cais.some(c => pvEstadoCai(c).some(e => e.alerta))) conAlerta++
  }

  const filas = lista.map(p => {
    const cais = (pvCaiPorProv[p.id] || []).filter(c => c.activo !== false)
    const tieneAlerta = cais.some(c => pvEstadoCai(c).some(e => e.alerta))
    const caisHtml = cais.length
      ? cais.map(c => {
          const ests = pvEstadoCai(c)
          const badges = ests.map(e => `<span style="font-size:10px;color:${e.color};border:1px solid ${e.color};border-radius:3px;padding:1px 5px;margin-left:4px">${e.txt}</span>`).join('')
          return `<div style="font-size:11px;color:var(--text3);margin-top:3px;display:flex;align-items:center;flex-wrap:wrap;gap:2px">
            <span style="font-family:var(--mono)">${c.prefijo || ''} · ${c.rango_desde || '?'}→${c.rango_hasta || '?'}</span>
            ${c.sucursal ? `<span style="color:var(--text2)">· ${c.sucursal}</span>` : ''}
            ${badges}
            ${pvPuedeEditar() ? `<button onclick="pvEditarCai('${p.id}','${c.id}')" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--gold);padding:0 4px">✏️</button>` : ''}
          </div>`
        }).join('')
      : '<div style="font-size:11px;color:var(--amber);margin-top:3px">⚠ Sin rangos cargados</div>'

    return `<div class="card" style="padding:12px;margin-bottom:8px;${tieneAlerta ? 'border-left:3px solid var(--red)' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1">
          <div style="font-weight:600">${p.nombre}${tieneAlerta ? ' <span style="color:var(--red);font-size:11px">⚠ revisar</span>' : ''}</div>
          <div style="font-size:12px;color:var(--text3)">RTN: ${p.rtn || '— sin RTN —'}</div>
          ${caisHtml}
        </div>
        ${pvPuedeEditar() ? `<div style="display:flex;gap:4px">
          <button class="btn btn-ghost" onclick="pvAgregarCai('${p.id}')" style="padding:4px 10px;font-size:11px">+ Rango</button>
          <button class="btn btn-ghost" onclick="pvEditarProveedor('${p.id}')" style="padding:4px 8px;font-size:11px">✏️</button>
        </div>` : ''}
      </div>
    </div>`
  }).join('') || `<div style="text-align:center;padding:30px;color:var(--text3)">Sin proveedores${q ? ' para "' + q + '"' : ''}</div>`

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;color:var(--text3)">${pvProveedores.length} proveedor(es)${conAlerta ? ` · <span style="color:var(--red)">${conAlerta} con alerta</span>` : ''}</div>
      <div style="display:flex;gap:8px">
        <input type="text" id="pv-filtro" placeholder="🔎 Buscar por nombre o RTN..." value="${pvFiltro.replace(/"/g, '&quot;')}"
          oninput="pvFiltrar(this.value)" style="font-size:12px;padding:6px 10px;min-width:220px">
        ${pvPuedeEditar() ? '<button class="btn btn-gold" onclick="pvEditarProveedor(null)" style="padding:6px 14px;font-size:12px">+ Proveedor</button>' : ''}
      </div>
    </div>
    ${filas}`
  const inp = document.getElementById('pv-filtro')
  if (inp && pvFiltroFocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) }
}
let pvFiltroFocus = false
window.pvFiltrar = (txt) => { pvFiltro = txt || ''; pvFiltroFocus = true; pvRender() }

// ── Modal proveedor ──
window.pvEditarProveedor = (id) => {
  pvEditProvId = id
  const p = id ? pvProveedores.find(x => x.id === id) : null
  document.getElementById('pv-modal-title').textContent = p ? 'Editar proveedor' : 'Nuevo proveedor'
  document.getElementById('pv-nombre').value = p?.nombre || ''
  document.getElementById('pv-rtn').value = p?.rtn || ''
  document.getElementById('modal-proveedor').classList.add('open')
}

window.pvGuardarProveedor = async () => {
  const nombre = (document.getElementById('pv-nombre').value || '').toUpperCase().trim()
  const rtn = (document.getElementById('pv-rtn').value || '').trim()
  if (!nombre) { window.toast?.('Ingresá el nombre', 'error'); return }
  const payload = { nombre, rtn: rtn || null, verificado: true }
  let res
  if (pvEditProvId) res = await pvSb().from('proveedores').update(payload).eq('id', pvEditProvId)
  else res = await pvSb().from('proveedores').insert(payload)
  if (res.error) { window.toast?.('Error: ' + res.error.message, 'error'); return }
  window.toast?.('Proveedor guardado ✓', 'success')
  document.getElementById('modal-proveedor').classList.remove('open')
  await pvCargar()
}

// ── Modal CAI/rango ──
window.pvAgregarCai = (provId) => { pvAbrirCai(provId, null) }
window.pvEditarCai = (provId, caiId) => { pvAbrirCai(provId, caiId) }

function pvAbrirCai(provId, caiId) {
  pvCaiProvActual = provId
  pvEditCaiId = caiId
  const c = caiId ? (pvCaiPorProv[provId] || []).find(x => x.id === caiId) : null
  const prov = pvProveedores.find(x => x.id === provId)
  document.getElementById('pv-cai-modal-title').textContent = (c ? 'Editar rango' : 'Nuevo rango') + (prov ? ' · ' + prov.nombre : '')
  document.getElementById('pv-cai-cai').value = c?.cai || ''
  document.getElementById('pv-cai-prefijo').value = c?.prefijo || ''
  document.getElementById('pv-cai-desde').value = c?.rango_desde || ''
  document.getElementById('pv-cai-hasta').value = c?.rango_hasta || ''
  document.getElementById('pv-cai-fecha').value = c?.fecha_limite || ''
  document.getElementById('pv-cai-sucursal').value = c?.sucursal || ''
  document.getElementById('pv-cai-activo').checked = c ? (c.activo !== false) : true
  document.getElementById('modal-proveedor-cai').classList.add('open')
}

window.pvGuardarCai = async () => {
  const payload = {
    proveedor_id: pvCaiProvActual,
    cai: (document.getElementById('pv-cai-cai').value || '').trim() || null,
    prefijo: (document.getElementById('pv-cai-prefijo').value || '').trim() || null,
    rango_desde: (document.getElementById('pv-cai-desde').value || '').trim() || null,
    rango_hasta: (document.getElementById('pv-cai-hasta').value || '').trim() || null,
    fecha_limite: document.getElementById('pv-cai-fecha').value || null,
    sucursal: (document.getElementById('pv-cai-sucursal').value || '').trim() || null,
    activo: document.getElementById('pv-cai-activo').checked
  }
  if (!payload.rango_desde || !payload.rango_hasta) { window.toast?.('Ingresá el rango desde y hasta', 'error'); return }
  if (!payload.fecha_limite) { window.toast?.('Ingresá la fecha límite de emisión', 'error'); return }
  const prof = window._currentProfile?.()
  let res
  if (pvEditCaiId) res = await pvSb().from('proveedor_cai').update(payload).eq('id', pvEditCaiId)
  else { payload.created_by = prof?.id || null; res = await pvSb().from('proveedor_cai').insert(payload) }
  if (res.error) { window.toast?.('Error: ' + res.error.message, 'error'); return }
  window.toast?.('Rango guardado ✓', 'success')
  window.logActividad?.('proveedor_cai', 'compras', `${payload.prefijo || ''} ${payload.rango_desde}→${payload.rango_hasta}`)
  document.getElementById('modal-proveedor-cai').classList.remove('open')
  await pvCargar()
}

window.pvEliminarCai = async () => {
  if (!pvEditCaiId) return
  if (!confirm('¿Eliminar este rango?')) return
  const { error } = await pvSb().from('proveedor_cai').delete().eq('id', pvEditCaiId)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  document.getElementById('modal-proveedor-cai').classList.remove('open')
  await pvCargar()
}