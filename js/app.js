import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(
  'https://icghaqhtvutwlkhtotyv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZ2hhcWh0dnV0d2xraHRvdHl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTE3MzksImV4cCI6MjA5NDk2NzczOX0.2_sioWiJuNVwDaSggnczbzCVu8IorzBsrgbwNXXz39E'
)

// ── STATE ──
let currentUser = null
let currentProfile = null
let empresas = []

// ── INIT ──
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await sb.auth.getSession()
  if (session) {
    await initSession(session.user)
  } else {
    hideOverlay()
    showScreen('login-screen')
  }
})

async function initSession(user) {
  currentUser = user
  const { data: profile } = await sb.from('usuarios')
    .select('*, centros_costo(nombre,codigo)')
    .eq('auth_user_id', user.id)
    .single()
  currentProfile = profile
  if (!profile) {
    await sb.auth.signOut()
    hideOverlay()
    showScreen('login-screen')
    toast('No se encontró perfil de usuario. Contacta al administrador.', 'error')
    return
  }
  await sb.from('usuarios').update({ ultimo_acceso: new Date().toISOString() }).eq('auth_user_id', user.id)
  hideOverlay()
  setupUI()
  showScreen('main-screen')
  await loadEmpresas()
  const defaultView = profile.rol === 'compras' ? 'compras' : 'usuarios'
  const defaultLabel = profile.rol === 'compras' ? 'Registrar compras' : 'Gestión de usuarios'
  showView(defaultView, defaultLabel)
  // Load caja badge for super_admin
  if (profile.rol === 'super_admin') initCajaBadge()
}

function setupUI() {
  const p = currentProfile
  const initials = p.nombre.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase()
  document.getElementById('top-avatar').textContent = initials
  document.getElementById('top-name').textContent = p.nombre.split(' ').slice(0,2).join(' ')
  const roleLabels = { super_admin:'Super Admin', contador:'Contador', aux_contable:'Aux. Contable', compras:'Compras' }
  document.getElementById('top-role').textContent = roleLabels[p.rol] || p.rol
  // Sidebar: compras solo ve sus vistas
  if (p.rol === 'compras') {
    document.getElementById('section-contab').classList.add('hidden')
    document.getElementById('nav-usuarios').classList.add('hidden')
    document.getElementById('nav-caja').classList.add('hidden')
  }
  // Caja General solo visible para super_admin
  if (p.rol === 'super_admin') {
    document.getElementById('nav-caja').classList.remove('hidden')
  }
}

// ── AUTH ──
window.doLogin = async () => {
  const email = document.getElementById('login-email').value.trim()
  const pass = document.getElementById('login-pass').value
  const btn = document.getElementById('btn-login')
  const lbl = document.getElementById('login-label')
  const err = document.getElementById('login-error')
  if (!email || !pass) { showError(err, 'Completa todos los campos'); return }
  btn.disabled = true
  lbl.innerHTML = '<span class="spinner"></span>'
  err.classList.add('hidden')
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass })
  if (error) {
    btn.disabled = false
    lbl.textContent = 'Ingresar al sistema'
    showError(err, 'Correo o contraseña incorrectos')
    return
  }
  await initSession(data.user)
}

window.doLogout = async () => {
  await sb.auth.signOut()
  currentUser = null; currentProfile = null
  showScreen('login-screen')
  toast('Sesión cerrada', 'info')
}

// ── NAVIGATION ──
window.showView = (id, label) => {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
  const view = document.getElementById('view-' + id)
  if (view) view.classList.add('active')
  const nav = document.getElementById('nav-' + id)
  if (nav) nav.classList.add('active')
  if (id === 'partida-nueva') { const np = document.getElementById('nav-partidas'); if(np) np.classList.add('active') }
  document.getElementById('topbar-module').textContent = label
  if (id === 'usuarios') loadUsuarios()
  if (id === 'pendientes') loadPendientes()
  if (id === 'compras') initForm()
  if (id === 'catalogo') loadCatalogo()
  if (id === 'partidas') loadPartidas()
  if (id === 'partida-nueva') initPartidaNueva()
  if (id === 'caja') loadCaja()
}

// ── EMPRESAS ──
async function loadEmpresas() {
  const { data } = await sb.from('centros_costo').select('*').eq('activa', true).eq('es_corporativo', false).order('nombre')
  empresas = data || []
  // Poblar selects
  const selects = ['fc-empresa', 'nu-empresa']
  selects.forEach(sid => {
    const sel = document.getElementById(sid)
    if (!sel) return
    const isEmpresa = sid === 'fc-empresa'
    if (!isEmpresa) sel.innerHTML = '<option value="">Todos los centros de costo</option>'
    else sel.innerHTML = '<option value="">Seleccionar centro de costo...</option>'
    empresas.forEach(e => {
      const opt = document.createElement('option')
      opt.value = e.id
      opt.textContent = e.nombre
      sel.appendChild(opt)
    })
  })
  // Si usuario tiene empresa asignada, preseleccionar
  if (currentProfile?.centro_costo_id) {
    const sel = document.getElementById('fc-empresa')
    if (sel) sel.value = currentProfile.centro_costo_id
  }
}

// ── USUARIOS ──
async function loadUsuarios() {
  const tbody = document.getElementById('tbody-usuarios')
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'
  const { data, error } = await sb.from('usuarios').select('*, centro_costo:centros_costo(nombre)').order('created_at', { ascending: false })
  if (error) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--red);padding:30px">${error.message}</td></tr>`; return }
  if (!data?.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text3)">No hay usuarios registrados</td></tr>'; return }
  document.getElementById('stat-total').textContent = data.length
  document.getElementById('stat-activos').textContent = data.filter(u => u.activo).length
  const roleBadge = { super_admin:'badge-gold', contador:'badge-blue', aux_contable:'badge-green', compras:'badge-amber' }
  const roleLabel = { super_admin:'Super Admin', contador:'Contador', aux_contable:'Aux. Contable', compras:'Compras' }
  tbody.innerHTML = data.map(u => `
    <tr>
      <td><div class="cell-name">
        <div class="avatar" style="width:30px;height:30px;font-size:10px">${u.nombre.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}</div>
        <div>
          <div style="font-weight:500">${u.nombre}</div>
          <div class="mono" style="color:var(--text3)">${u.email}</div>
        </div>
      </div></td>
      <td><span class="badge ${roleBadge[u.rol]||'badge-amber'}">${roleLabel[u.rol]||u.rol}</span></td>
      <td>${u.centro_costo?.nombre || '<span style="color:var(--text3)">Todas</span>'}</td>
      <td><span class="badge ${u.activo?'badge-on':'badge-off'}">${u.activo?'Activo':'Inactivo'}</span></td>
      <td class="mono" style="color:var(--text3)">${new Date(u.created_at).toLocaleDateString('es-HN')}</td>
    </tr>`).join('')
}
window.loadUsuarios = loadUsuarios

window.openModalUsuario = () => {
  document.getElementById('modal-error').classList.add('hidden')
  document.getElementById('modal-usuario').classList.add('open')
}

window.crearUsuario = async () => {
  const nombre = document.getElementById('nu-nombre').value.trim()
  const email = document.getElementById('nu-email').value.trim()
  const pass = document.getElementById('nu-pass').value
  const rol = document.getElementById('nu-rol').value
  const centro_costo_id = document.getElementById('nu-empresa').value || null
  const err = document.getElementById('modal-error')
  if (!nombre || !email || !pass) { showError(err, 'Completa todos los campos'); return }
  if (pass.length < 8) { showError(err, 'La contraseña debe tener al menos 8 caracteres'); return }
  const btn = document.getElementById('btn-crear-usuario')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'
  // 1. Guardar sesión actual del admin
  const { data: { session: adminSession } } = await sb.auth.getSession()
  // 2. Crear nuevo usuario en Auth
  const { data: signData, error: signErr } = await sb.auth.signUp({ email, password: pass, options: { data: { nombre } } })
  if (signErr) {
    btn.disabled = false; btn.textContent = 'Crear usuario'
    showError(err, signErr.message); return
  }
  // 3. Insertar perfil en tabla usuarios
  const { error: profileErr } = await sb.from('usuarios').insert({
    auth_user_id: signData.user.id, nombre, email, rol, centro_costo_id, activo: true
  })
  // 4. Restaurar sesión del admin inmediatamente
  if (adminSession) {
    await sb.auth.setSession({
      access_token: adminSession.access_token,
      refresh_token: adminSession.refresh_token
    })
  }
  if (profileErr) {
    btn.disabled = false; btn.textContent = 'Crear usuario'
    showError(err, profileErr.message); return
  }
  btn.disabled = false; btn.textContent = 'Crear usuario'
  closeModal('modal-usuario')
  toast(`Usuario ${nombre} creado correctamente`, 'success')
  loadUsuarios()
  ['nu-nombre','nu-email','nu-pass'].forEach(id => document.getElementById(id).value = '')
}

// ── COMPRAS FORM ──
function initForm() {
  const today = new Date().toISOString().split('T')[0]
  document.getElementById('fc-fecha').value = today
  togglePagoFields()
}

window.calcISV = () => {
  const sub = parseFloat(document.getElementById('fc-subtotal').value) || 0
  const isv = sub * 0.15
  document.getElementById('fc-isv').value = isv.toFixed(2)
  document.getElementById('fc-total').value = (sub + isv).toFixed(2)
}

window.togglePagoFields = () => {
  const pago = document.getElementById('fc-pago').value
  document.getElementById('field-banco').classList.toggle('hidden', pago === 'contado')
  document.getElementById('field-cheque').classList.toggle('hidden', pago !== 'credito')
}

window.previewFoto = (input) => {
  if (!input.files?.[0]) return
  const f = input.files[0]
  document.getElementById('preview-name').textContent = f.name
  document.getElementById('preview-size').textContent = (f.size / 1024).toFixed(0) + ' KB'
  document.getElementById('upload-preview').classList.remove('hidden')
  document.getElementById('upload-zone').classList.add('has-file')
}

window.resetForm = () => {
  ['fc-numero','fc-cai','fc-proveedor-nombre','fc-rtn','fc-subtotal','fc-isv','fc-total','fc-banco','fc-cheque','fc-obs'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = ''
  })
  document.getElementById('fc-file').value = ''
  document.getElementById('upload-preview').classList.add('hidden')
  document.getElementById('upload-zone').classList.remove('has-file')
  initForm()
}

window.guardarCompra = async () => {
  const centro_costo_id = document.getElementById('fc-empresa').value
  const fecha = document.getElementById('fc-fecha').value
  const numero = document.getElementById('fc-numero').value.trim()
  const proveedorNombre = document.getElementById('fc-proveedor-nombre').value.trim()
  const subtotal = parseFloat(document.getElementById('fc-subtotal').value) || 0
  const btn = document.getElementById('btn-guardar-compra')
  if (!centro_costo_id) { toast('Selecciona un centro de costo', 'error'); return }
  if (!fecha) { toast('Ingresa la fecha de la factura', 'error'); return }
  if (!numero) { toast('Ingresa el número de factura', 'error'); return }
  if (!proveedorNombre) { toast('Ingresa el nombre del proveedor', 'error'); return }
  if (subtotal <= 0) { toast('El subtotal debe ser mayor a 0', 'error'); return }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando...'

  // Buscar o crear proveedor
  let proveedor_id = null
  const rtn = document.getElementById('fc-rtn').value.trim()
  if (rtn) {
    const { data: provExist } = await sb.from('proveedores').select('id').eq('rtn', rtn).single()
    if (provExist) {
      proveedor_id = provExist.id
    } else {
      const { data: newProv } = await sb.from('proveedores').insert({ nombre: proveedorNombre, rtn }).select('id').single()
      if (newProv) proveedor_id = newProv.id
    }
  }

  // Subir foto si existe
  let foto_url = null
  const fileInput = document.getElementById('fc-file')
  if (fileInput.files?.[0]) {
    const file = fileInput.files[0]
    const ext = file.name.split('.').pop()
    const path = `facturas/${centro_costo_id}/${Date.now()}.${ext}`
    const { error: uploadErr } = await sb.storage.from('facturas-compras').upload(path, file)
    if (!uploadErr) foto_url = path
  }

  const payload = {
    centro_costo_id,
    proveedor_id,
    registrado_por: currentProfile.id,
    numero_factura: numero,
    cai: document.getElementById('fc-cai').value.trim() || null,
    fecha_factura: fecha,
    tipo_gasto: document.getElementById('fc-tipo').value,
    forma_pago: document.getElementById('fc-pago').value,
    banco: document.getElementById('fc-banco').value.trim() || null,
    numero_cheque: document.getElementById('fc-cheque').value.trim() || null,
    subtotal: parseFloat(document.getElementById('fc-subtotal').value),
    isv: parseFloat(document.getElementById('fc-isv').value) || 0,
    total: parseFloat(document.getElementById('fc-total').value),
    foto_url,
    observaciones: document.getElementById('fc-obs').value.trim() || null,
    estado: 'pendiente'
  }

  const { error } = await sb.from('facturas_compras').insert(payload)
  btn.disabled = false; btn.textContent = 'Guardar y enviar a contabilidad →'
  if (error) { toast('Error al guardar: ' + error.message, 'error'); return }
  toast('Factura registrada y enviada a contabilidad', 'success')
  resetForm()
  setTimeout(() => showView('pendientes', 'Facturas pendientes'), 1000)
}

// ── PENDIENTES ──
async function loadPendientes() {
  const container = document.getElementById('lista-pendientes')
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)"><div class="spinner"></div></div>'
  let query = sb.from('facturas_compras')
    .select('*, centro_costo:centros_costo(nombre), proveedor:proveedores(nombre), registrado:usuarios!registrado_por(nombre)')
    .order('created_at', { ascending: false })
    .limit(50)
  if (currentProfile.rol === 'compras') {
    query = query.eq('registrado_por', currentProfile.id)
  }
  const { data, error } = await query
  if (error) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${error.message}</div></div>`; return }
  if (!data?.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No hay facturas registradas</div><div class="empty-sub">Las facturas registradas aparecerán aquí</div></div>'
    return
  }
  const pending = data.filter(f => f.estado === 'pendiente').length
  const badge = document.getElementById('badge-pendientes')
  if (pending > 0) { badge.classList.remove('hidden'); badge.textContent = pending }
  else badge.classList.add('hidden')
  const tipoLabel = { repuestos:'Repuestos/Mat.', servicios:'Servicios', combustible:'Combustible', mantenimiento:'Mant. Vehículo', admin:'Administrativo', otro:'Otro' }
  container.innerHTML = '<div class="pending-list">' + data.map(f => `
    <div class="pending-item ${f.estado}">
      <div class="pi-left">
        <div class="pi-dot ${f.estado}"></div>
        <div>
          <div class="pi-info">${f.proveedor?.nombre || 'Sin proveedor'} · Fact. ${f.numero_factura} · ${f.centro_costo?.nombre || ''}</div>
          <div class="pi-meta">${new Date(f.created_at).toLocaleDateString('es-HN')} ${new Date(f.created_at).toLocaleTimeString('es-HN',{hour:'2-digit',minute:'2-digit'})} · ${f.registrado?.nombre || ''} · ${tipoLabel[f.tipo_gasto]||f.tipo_gasto} · ${f.forma_pago}</div>
        </div>
      </div>
      <div class="pi-right">
        <div class="pi-amount">L. ${parseFloat(f.total).toLocaleString('es-HN',{minimumFractionDigits:2})}</div>
        <div class="pi-status ${f.estado}">${f.estado === 'pendiente' ? 'Pendiente partida' : f.estado === 'procesada' ? 'Partida generada' : 'Rechazada'}</div>
      </div>
    </div>`).join('') + '</div>'
}

// ── HELPERS ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}
function hideOverlay() {
  document.getElementById('loading-overlay').style.display = 'none'
}
function showError(el, msg) {
  el.textContent = msg; el.classList.remove('hidden')
}
window.closeModal = (id) => {
  document.getElementById(id).classList.remove('open')
}
window.toast = (msg, type = 'info') => {
  const icons = { success: '✓', error: '✕', info: '·' }
  const wrap = document.getElementById('toasts')
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.innerHTML = `<span>${icons[type]}</span> ${msg}`
  wrap.appendChild(el)
  setTimeout(() => el.remove(), 3500)
}

// Allow Enter key on login
document.getElementById('login-pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.doLogin()
})

// ── PARTIDAS CONTABLES ──
let partidaLineas = []
let lineaCounter = 0
let cuentasDetalle = []

async function loadPartidas() {
  const tbody = document.getElementById('tbody-partidas')
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'
  const { data, error } = await sb.from('partidas_contables')
    .select('*, centro_costo:centros_costo(nombre), generador:usuarios!generada_por(nombre)')
    .order('created_at', { ascending: false }).limit(100)
  if (error) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--red)">${error.message}</td></tr>`; return }
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3)">No hay partidas registradas. Crea la primera.</td></tr>'
    document.getElementById('sp-total').textContent = '0'
    document.getElementById('sp-borrador').textContent = '0'
    document.getElementById('sp-aprobadas').textContent = '0'
    return
  }
  document.getElementById('sp-total').textContent = data.length
  document.getElementById('sp-borrador').textContent = data.filter(p => p.estado === 'borrador').length
  document.getElementById('sp-aprobadas').textContent = data.filter(p => p.estado === 'aprobada').length
  const origenLabel = { compra:'Compra', venta_alpha:'Venta Alpha', entrega_taxi:'Taxi', gasto_autolote:'Autolote' }
  const estadoBadge = { borrador:'badge-amber', aprobada:'badge-green', rechazada:'badge-red', pendiente_caja:'badge-amber' }
  tbody.innerHTML = data.map(p => `
    <tr>
      <td class="mono" style="color:var(--gold)">${p.numero_partida || '—'}</td>
      <td class="mono" style="color:var(--text3)">${new Date(p.fecha_partida).toLocaleDateString('es-HN')}</td>
      <td style="color:var(--text);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.descripcion}</td>
      <td><span class="badge badge-blue" style="font-size:10px">${origenLabel[p.tipo_origen]||p.tipo_origen}</span></td>
      <td class="mono" style="font-weight:500">L. ${parseFloat(p.total).toLocaleString('es-HN',{minimumFractionDigits:2})}</td>
      <td><span class="badge ${estadoBadge[p.estado]||'badge-amber'}">${p.estado === 'pendiente_caja' ? '⏳ Pend. caja' : p.estado}</span></td>
    </tr>`).join('')
}
window.loadPartidas = loadPartidas

async function initPartidaNueva() {
  document.getElementById('pn-fecha').value = new Date().toISOString().split('T')[0]
  document.getElementById('pn-descripcion').value = ''
  document.getElementById('pn-documento').value = ''
  document.getElementById('pn-origen').value = 'compra'
  partidaLineas = []
  lineaCounter = 0
  // Load cuentas detalle for selector
  if (!cuentasDetalle.length) {
    const { data } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').eq('es_detalle', true).order('codigo')
    cuentasDetalle = data || []
  }
  // Start with 2 empty lines
  addLinea(); addLinea()
}
window.initPartidaNueva = initPartidaNueva

window.nuevaPartida = () => {
  showView('partida-nueva', 'Nueva partida')
}

window.addLinea = () => {
  lineaCounter++
  const id = lineaCounter
  partidaLineas.push({ id, cuenta_id:'', cuenta_codigo:'', cuenta_nombre:'', tipo:'debito', monto:0, centro_costo_id:'', descripcion:'', aplica_fiscal:true })
  renderLineas()
}

window.removeLinea = (id) => {
  partidaLineas = partidaLineas.filter(l => l.id !== id)
  renderLineas()
  calcTotales()
}

function renderLineas() {
  const tbody = document.getElementById('tbody-lineas')
  tbody.innerHTML = partidaLineas.map(l => {
    const debeVal = l.tipo === 'debito' && l.monto ? l.monto : ''
    const haberVal = l.tipo === 'credito' && l.monto ? l.monto : ''
    return `
    <tr class="linea-row">
      <td>
        <div class="cuenta-wrap">
          <input type="text" value="${l.cuenta_codigo ? l.cuenta_codigo+' '+l.cuenta_nombre : ''}" placeholder="Buscar cuenta..."
            onfocus="openCuentaDD(${l.id},this)" oninput="filterCuentas(${l.id},this.value)" data-lid="${l.id}" autocomplete="off">
          <div class="cuenta-dropdown" id="dd-${l.id}"></div>
        </div>
      </td>
      <td>
        <select onchange="updLinea(${l.id},'centro_costo_id',this.value)">
          <option value="">—</option>
          ${empresas.map(e => `<option value="${e.id}" ${l.centro_costo_id===e.id?'selected':''}>${e.nombre}</option>`).join('')}
        </select>
      </td>
      <td>
        <input type="text" inputmode="decimal" value="${debeVal}" placeholder="0.00"
          oninput="setDebe(${l.id},this.value)" style="text-align:right;font-family:var(--mono)">
      </td>
      <td>
        <input type="text" inputmode="decimal" value="${haberVal}" placeholder="0.00"
          oninput="setHaber(${l.id},this.value)" style="text-align:right;font-family:var(--mono)">
      </td>
      <td style="text-align:center">
        <input type="checkbox" class="fiscal-check" ${l.aplica_fiscal?'checked':''} onchange="updLinea(${l.id},'aplica_fiscal',this.checked)">
      </td>
      <td style="text-align:center">
        <button class="linea-del" onclick="removeLinea(${l.id})">✕</button>
      </td>
    </tr>`
  }).join('')
}

window.setDebe = (id, val) => {
  const l = partidaLineas.find(x => x.id === id)
  if (!l) return
  const v = parseFloat(val) || 0
  l.tipo = 'debito'
  l.monto = v
  calcTotales()
}

window.setHaber = (id, val) => {
  const l = partidaLineas.find(x => x.id === id)
  if (!l) return
  const v = parseFloat(val) || 0
  l.tipo = 'credito'
  l.monto = v
  calcTotales()
}

window.updLinea = (id, field, val) => {
  const l = partidaLineas.find(x => x.id === id)
  if (!l) return
  if (field === 'monto') l[field] = parseFloat(val) || 0
  else if (field === 'aplica_fiscal') l[field] = val
  else l[field] = val
  calcTotales()
}

function calcTotales() {
  const debitos = partidaLineas.filter(l => l.tipo === 'debito').reduce((s, l) => s + (l.monto || 0), 0)
  const creditos = partidaLineas.filter(l => l.tipo === 'credito').reduce((s, l) => s + (l.monto || 0), 0)
  const diff = Math.abs(debitos - creditos)
  document.getElementById('pn-tot-d').textContent = debitos.toFixed(2)
  document.getElementById('pn-tot-c').textContent = creditos.toFixed(2)
  const diffEl = document.getElementById('pn-diff')
  const balEl = document.getElementById('pn-balance')
  if (diff < 0.01 && debitos > 0) {
    diffEl.textContent = 'Cuadrada ✓'
    diffEl.style.color = 'var(--green)'
    balEl.textContent = `Cuadrada: L. ${debitos.toFixed(2)}`
    balEl.style.color = 'var(--green)'
  } else {
    diffEl.textContent = `Diferencia: L. ${diff.toFixed(2)}`
    diffEl.style.color = 'var(--red)'
    balEl.textContent = `Descuadre: L. ${diff.toFixed(2)}`
    balEl.style.color = 'var(--red)'
  }
}

// Cuenta dropdown search
window.openCuentaDD = (lid, input) => {
  filterCuentas(lid, input.value)
  document.getElementById('dd-' + lid).classList.add('open')
  // Close on outside click
  setTimeout(() => {
    const handler = (e) => {
      if (!e.target.closest('.cuenta-wrap')) {
        document.querySelectorAll('.cuenta-dropdown').forEach(d => d.classList.remove('open'))
        document.removeEventListener('click', handler)
      }
    }
    document.addEventListener('click', handler)
  }, 100)
}

window.filterCuentas = (lid, query) => {
  const dd = document.getElementById('dd-' + lid)
  const q = (query || '').toLowerCase()
  const filtered = cuentasDetalle.filter(c =>
    c.codigo.toLowerCase().includes(q) || c.nombre.toLowerCase().includes(q)
  ).slice(0, 15)
  dd.innerHTML = filtered.length ? filtered.map(c => `
    <div class="cuenta-opt" onclick="selectCuenta(${lid},'${c.id}','${c.codigo}','${c.nombre.replace(/'/g,'')}')">
      <span><span class="cc-code">${c.codigo}</span>${c.nombre}</span>
      <span class="cc-tipo">${c.tipo}</span>
    </div>`).join('') : '<div style="padding:12px;color:var(--text3);font-size:12px">No se encontraron cuentas</div>'
  dd.classList.add('open')
}

window.selectCuenta = (lid, cid, codigo, nombre) => {
  const l = partidaLineas.find(x => x.id === lid)
  if (l) { l.cuenta_id = cid; l.cuenta_codigo = codigo; l.cuenta_nombre = nombre }
  const input = document.querySelector(`input[data-lid="${lid}"]`)
  if (input) input.value = codigo + ' ' + nombre
  document.getElementById('dd-' + lid).classList.remove('open')
}

window.guardarPartida = async (estado) => {
  const fecha = document.getElementById('pn-fecha').value
  const descripcion = document.getElementById('pn-descripcion').value.trim()
  const documento = document.getElementById('pn-documento').value.trim()
  const tipo_origen = document.getElementById('pn-origen').value
  if (!fecha) { toast('Selecciona la fecha', 'error'); return }
  if (!descripcion) { toast('Ingresa una descripción', 'error'); return }
  const lineasValidas = partidaLineas.filter(l => l.cuenta_id && l.monto > 0)
  if (lineasValidas.length < 2) { toast('Necesitas al menos 2 líneas con cuenta y monto', 'error'); return }
  // Validar centro de costo obligatorio para gastos, ingresos y costos
  for (const l of lineasValidas) {
    const cuenta = cuentasDetalle.find(c => c.id === l.cuenta_id)
    if (cuenta && ['gasto','ingreso','costo'].includes(cuenta.tipo) && !l.centro_costo_id) {
      toast(`La cuenta ${l.cuenta_codigo} ${l.cuenta_nombre} es de tipo ${cuenta.tipo} y requiere centro de costo`, 'error')
      return
    }
  }
  const debitos = lineasValidas.filter(l => l.tipo === 'debito').reduce((s, l) => s + l.monto, 0)
  const creditos = lineasValidas.filter(l => l.tipo === 'credito').reduce((s, l) => s + l.monto, 0)
  if (estado === 'aprobada' && Math.abs(debitos - creditos) >= 0.01) {
    toast('La partida debe cuadrar para aprobarla (débitos = créditos)', 'error'); return
  }

  // ── CONTROL DE CAJA GENERAL ──
  // Detectar si esta partida toca cuentas de Caja General
  const tocaCaja = partidaAfectaCajaGeneral(lineasValidas)
  const hayEgresoCaja = tieneEgresoCaja(lineasValidas)
  const esSuperAdmin = currentProfile.rol === 'super_admin'

  // Regla: Solo super_admin puede hacer egresos de caja (créditos a caja)
  if (hayEgresoCaja && !esSuperAdmin) {
    toast('Solo el Super Admin puede registrar egresos de Caja General (créditos a caja)', 'error')
    return
  }

  // Regla: Si toca caja y NO es super_admin → estado = pendiente_caja
  let estadoFinal = estado
  if (tocaCaja && !esSuperAdmin && estado === 'aprobada') {
    estadoFinal = 'pendiente_caja'
  }

  const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
    centro_costo_id: null,
    generada_por: currentProfile.id,
    tipo_origen, descripcion, numero_documento: documento || null,
    fecha_partida: fecha, estado: estadoFinal, total: debitos,
    aprobada_at: estadoFinal === 'aprobada' ? new Date().toISOString() : null,
    aprobada_por: estadoFinal === 'aprobada' ? currentProfile.id : null
  }).select('id').single()
  if (pErr) { toast('Error: ' + pErr.message, 'error'); return }
  const lineas = lineasValidas.map(l => ({
    partida_id: partida.id,
    cuenta_id: l.cuenta_id,
    cuenta_codigo: l.cuenta_codigo,
    cuenta_nombre: l.cuenta_nombre,
    tipo: l.tipo,
    monto: l.monto,
    centro_costo_id: l.centro_costo_id || null,
    descripcion: descripcion,
    numero_documento: documento || null,
    aplica_fiscal: l.aplica_fiscal
  }))
  const { error: lErr } = await sb.from('lineas_partida').insert(lineas)
  if (lErr) { toast('Error en líneas: ' + lErr.message, 'error'); return }

  // Mensajes según resultado
  if (estadoFinal === 'pendiente_caja') {
    toast('Partida guardada · Pendiente de aprobación por Caja General', 'info')
  } else if (estadoFinal === 'aprobada') {
    toast('Partida aprobada y contabilizada ✓', 'success')
  } else {
    toast('Borrador guardado', 'success')
  }
  showView('partidas', 'Partidas contables')
}

// ── CATÁLOGO DE CUENTAS ──
let allCuentas = []
let filtroTipo = 'todos'
let collapsedGroups = new Set()
let editingCuentaId = null

async function loadCatalogo() {
  const body = document.getElementById('tree-body')
  body.innerHTML = '<div style="text-align:center;padding:30px"><div class="spinner"></div></div>'
  const { data, error } = await sb.from('catalogo_cuentas').select('*').order('codigo')
  if (error) { body.innerHTML = `<div style="text-align:center;padding:30px;color:var(--red)">${error.message}</div>`; return }
  allCuentas = data || []
  document.getElementById('cs-total').textContent = allCuentas.length
  document.getElementById('cs-detalle').textContent = allCuentas.filter(c => c.es_detalle).length
  document.getElementById('cs-grupo').textContent = allCuentas.filter(c => !c.es_detalle).length
  populatePadreSelect()
  renderTree()
}
window.loadCatalogo = loadCatalogo

function populatePadreSelect() {
  const sel = document.getElementById('nc-padre')
  sel.innerHTML = '<option value="">Sin cuenta padre (raíz)</option>'
  allCuentas.filter(c => !c.es_detalle).sort((a,b) => a.codigo.localeCompare(b.codigo)).forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.id
    opt.textContent = `${c.codigo} · ${c.nombre}`
    sel.appendChild(opt)
  })
}

function renderTree() {
  const body = document.getElementById('tree-body')
  const buscar = (document.getElementById('cat-buscar')?.value || '').toLowerCase()
  let filtered = allCuentas
  if (filtroTipo !== 'todos') filtered = filtered.filter(c => c.tipo === filtroTipo)
  if (buscar) filtered = filtered.filter(c => c.codigo.toLowerCase().includes(buscar) || c.nombre.toLowerCase().includes(buscar))
  if (!filtered.length) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">No se encontraron cuentas</div>'
    return
  }
  // Check which parent codes are collapsed
  const hiddenIds = new Set()
  if (!buscar) {
    allCuentas.forEach(c => {
      if (collapsedGroups.has(c.id)) {
        allCuentas.filter(ch => ch.cuenta_padre === c.id).forEach(ch => {
          hiddenIds.add(ch.id)
          // Also hide grandchildren
          allCuentas.filter(gc => gc.cuenta_padre === ch.id).forEach(gc => hiddenIds.add(gc.id))
        })
      }
    })
  }
  const nivelLabels = { 1: 'Grupo', 2: 'Subgrupo', 3: 'Cuenta', 4: 'Subcuenta' }
  const tipoColors = { activo:'badge-activo', pasivo:'badge-pasivo', capital:'badge-capital', ingreso:'badge-ingreso', gasto:'badge-gasto', costo:'badge-costo' }
  const hasChildren = (id) => allCuentas.some(c => c.cuenta_padre === id)
  body.innerHTML = filtered.filter(c => !hiddenIds.has(c.id)).map(c => {
    const isGroup = hasChildren(c.id)
    const isCollapsed = collapsedGroups.has(c.id)
    const toggleBtn = isGroup ? `<span class="tree-toggle" onclick="toggleGroup('${c.id}')">${isCollapsed ? '▸' : '▾'}</span>` : '<span style="width:22px;display:inline-block"></span>'
    return `<div class="tree-row nivel-${c.nivel}">
      <div class="tree-name">${toggleBtn}<span class="tree-code">${c.codigo}</span>${c.nombre}${c.es_detalle ? '' : ' <span style="font-size:10px;color:var(--text3);margin-left:4px">(grupo)</span>'}</div>
      <span><span class="badge-tipo ${tipoColors[c.tipo]||''}">${c.tipo}</span></span>
      <span style="font-size:12px;color:var(--text3);text-transform:capitalize">${c.naturaleza}</span>
      <span style="font-size:12px;color:var(--text3)">${nivelLabels[c.nivel]||c.nivel}</span>
      <div class="tree-actions">
        <button class="tree-btn" onclick="editarCuenta('${c.id}')" title="Editar">✎</button>
        <button class="tree-btn" onclick="eliminarCuenta('${c.id}','${c.codigo}','${c.nombre.replace(/'/g,'')}')" title="Eliminar" style="color:var(--red)">✕</button>
      </div>
    </div>`
  }).join('')
}

window.toggleGroup = (id) => {
  if (collapsedGroups.has(id)) collapsedGroups.delete(id)
  else collapsedGroups.add(id)
  renderTree()
}

window.filtrarCatalogo = () => renderTree()

window.filtrarTipo = (btn, tipo) => {
  filtroTipo = tipo
  document.querySelectorAll('.cat-filter').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  renderTree()
}

window.openModalCuenta = (editing = null) => {
  editingCuentaId = editing
  const err = document.getElementById('modal-cuenta-error')
  err.classList.add('hidden')
  document.getElementById('modal-cuenta-title').textContent = editing ? 'Editar cuenta contable' : 'Nueva cuenta contable'
  document.getElementById('btn-guardar-cuenta').textContent = editing ? 'Guardar cambios' : 'Guardar cuenta'
  if (editing) {
    const c = allCuentas.find(x => x.id === editing)
    if (c) {
      document.getElementById('nc-codigo').value = c.codigo
      document.getElementById('nc-nombre').value = c.nombre
      document.getElementById('nc-tipo').value = c.tipo
      document.getElementById('nc-naturaleza').value = c.naturaleza
      document.getElementById('nc-nivel').value = c.nivel
      document.getElementById('nc-padre').value = c.cuenta_padre || ''
      document.getElementById('nc-detalle').checked = c.es_detalle
    }
  } else {
    ['nc-codigo','nc-nombre'].forEach(id => document.getElementById(id).value = '')
    document.getElementById('nc-tipo').value = 'activo'
    document.getElementById('nc-naturaleza').value = 'deudora'
    document.getElementById('nc-nivel').value = '3'
    document.getElementById('nc-padre').value = ''
    document.getElementById('nc-detalle').checked = true
  }
  document.getElementById('modal-cuenta').classList.add('open')
}

window.editarCuenta = (id) => openModalCuenta(id)

window.eliminarCuenta = async (id, codigo, nombre) => {
  // Check if account has children
  const hasKids = allCuentas.some(c => c.cuenta_padre === id)
  if (hasKids) {
    toast(`No se puede eliminar ${codigo} porque tiene subcuentas. Elimina las subcuentas primero.`, 'error')
    return
  }
  if (!confirm(`¿Eliminar la cuenta ${codigo} · ${nombre}?\n\nEsta acción no se puede deshacer.`)) return
  const { error } = await sb.from('catalogo_cuentas').delete().eq('id', id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast(`Cuenta ${codigo} eliminada`, 'success')
  loadCatalogo()
}

window.onNivelChange = () => {
  const nivel = parseInt(document.getElementById('nc-nivel').value)
  document.getElementById('nc-detalle').checked = nivel >= 3
}

window.guardarCuenta = async () => {
  const codigo = document.getElementById('nc-codigo').value.trim()
  const nombre = document.getElementById('nc-nombre').value.trim()
  const tipo = document.getElementById('nc-tipo').value
  const naturaleza = document.getElementById('nc-naturaleza').value
  const nivel = parseInt(document.getElementById('nc-nivel').value)
  const cuenta_padre = document.getElementById('nc-padre').value || null
  const es_detalle = document.getElementById('nc-detalle').checked
  const err = document.getElementById('modal-cuenta-error')
  if (!codigo || !nombre) { showError(err, 'Código y nombre son obligatorios'); return }
  // Check duplicate code
  const dup = allCuentas.find(c => c.codigo === codigo && c.id !== editingCuentaId)
  if (dup) { showError(err, `El código ${codigo} ya existe: ${dup.nombre}`); return }
  const btn = document.getElementById('btn-guardar-cuenta')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'
  const payload = { codigo, nombre, tipo, naturaleza, nivel, cuenta_padre, es_detalle, activa: true }
  let error
  if (editingCuentaId) {
    ({ error } = await sb.from('catalogo_cuentas').update(payload).eq('id', editingCuentaId))
  } else {
    ({ error } = await sb.from('catalogo_cuentas').insert(payload))
  }
  btn.disabled = false; btn.textContent = editingCuentaId ? 'Guardar cambios' : 'Guardar cuenta'
  if (error) { showError(err, error.message); return }
  closeModal('modal-cuenta')
  toast(editingCuentaId ? 'Cuenta actualizada' : `Cuenta ${codigo} creada correctamente`, 'success')
  editingCuentaId = null
  loadCatalogo()
}

// ══════════════════════════════════════
// ── CAJA GENERAL — Control de efectivo
// ══════════════════════════════════════

// Cuentas de caja general: detectamos por código (1101 = Caja, o cuentas que empiecen con 1101)
// El super_admin define qué cuentas son "Caja General"
const CAJA_CODIGOS = ['1101', '110101', '110101-001'] // Caja, Caja General, subcuentas

function esCuentaCaja(codigo) {
  if (!codigo) return false
  return CAJA_CODIGOS.some(c => codigo === c || codigo.startsWith(c + '-') || codigo.startsWith(c + '0'))
}

function lineaAfectaCaja(linea) {
  return esCuentaCaja(linea.cuenta_codigo)
}

function partidaAfectaCajaGeneral(lineas) {
  return lineas.some(l => lineaAfectaCaja(l))
}

function tieneEgresoCaja(lineas) {
  // Egreso = crédito a caja (dinero sale)
  return lineas.some(l => lineaAfectaCaja(l) && l.tipo === 'credito' && l.monto > 0)
}

function tieneIngresoCaja(lineas) {
  // Ingreso = débito a caja (dinero entra)
  return lineas.some(l => lineaAfectaCaja(l) && l.tipo === 'debito' && l.monto > 0)
}

let filtroCajaActual = 'pendiente_caja'

window.filtroCaja = (btn, filtro) => {
  filtroCajaActual = filtro
  document.querySelectorAll('.caja-tab').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  renderCajaList()
}

let cajaPartidas = []

async function loadCaja() {
  const container = document.getElementById('lista-caja')
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)"><div class="spinner"></div></div>'

  // Cargar partidas que afectan caja general (las que tienen lineas con cuentas de caja)
  // Primero obtener las líneas que tocan caja
  const { data: lineasCaja, error: lcErr } = await sb.from('lineas_partida')
    .select('partida_id, tipo, monto, cuenta_codigo, cuenta_nombre')
    .or(CAJA_CODIGOS.map(c => `cuenta_codigo.eq.${c},cuenta_codigo.like.${c}-%,cuenta_codigo.like.${c}0%`).join(','))

  if (lcErr) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${lcErr.message}</div></div>`
    return
  }

  if (!lineasCaja?.length) {
    cajaPartidas = []
    updateCajaStats()
    renderCajaList()
    return
  }

  // Obtener IDs únicos de partidas
  const partidaIds = [...new Set(lineasCaja.map(l => l.partida_id))]

  // Cargar esas partidas con detalles
  const { data: partidas, error: pErr } = await sb.from('partidas_contables')
    .select('*, generador:usuarios!generada_por(nombre), aprobador:usuarios!aprobada_por(nombre)')
    .in('id', partidaIds)
    .order('created_at', { ascending: false })

  if (pErr) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${pErr.message}</div></div>`
    return
  }

  // Enriquecer cada partida con info de caja
  cajaPartidas = (partidas || []).map(p => {
    const lineas = lineasCaja.filter(l => l.partida_id === p.id)
    const debitos = lineas.filter(l => l.tipo === 'debito').reduce((s, l) => s + (parseFloat(l.monto) || 0), 0)
    const creditos = lineas.filter(l => l.tipo === 'credito').reduce((s, l) => s + (parseFloat(l.monto) || 0), 0)
    return {
      ...p,
      caja_debitos: debitos,   // dinero que entra
      caja_creditos: creditos, // dinero que sale
      caja_tipo: debitos > creditos ? 'ingreso' : 'egreso',
      caja_monto: debitos > creditos ? debitos : creditos,
      caja_lineas: lineas
    }
  })

  updateCajaStats()
  renderCajaList()
  updateCajaBadge()
}
window.loadCaja = loadCaja

function updateCajaStats() {
  const hoy = new Date().toISOString().split('T')[0]
  const pendientes = cajaPartidas.filter(p => p.estado === 'pendiente_caja')
  const aprobadasHoy = cajaPartidas.filter(p => p.estado === 'aprobada' && p.aprobada_at?.startsWith(hoy))
  const ingresosHoy = cajaPartidas.filter(p => p.estado === 'aprobada' && p.fecha_partida === hoy && p.caja_tipo === 'ingreso')
  const egresosHoy = cajaPartidas.filter(p => p.estado === 'aprobada' && p.fecha_partida === hoy && p.caja_tipo === 'egreso')

  document.getElementById('cj-pendientes').textContent = pendientes.length
  document.getElementById('cj-aprobadas').textContent = aprobadasHoy.length
  const totalIng = ingresosHoy.reduce((s, p) => s + p.caja_monto, 0)
  const totalEgr = egresosHoy.reduce((s, p) => s + p.caja_monto, 0)
  document.getElementById('cj-ingresos').textContent = 'L. ' + totalIng.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  document.getElementById('cj-egresos').textContent = 'L. ' + totalEgr.toLocaleString('es-HN', { minimumFractionDigits: 2 })
}

function renderCajaList() {
  const container = document.getElementById('lista-caja')
  let filtered = cajaPartidas
  if (filtroCajaActual !== 'todos') {
    filtered = filtered.filter(p => p.estado === filtroCajaActual)
  }

  if (!filtered.length) {
    const msgs = {
      pendiente_caja: 'No hay entregas pendientes de aprobación',
      aprobada: 'No hay movimientos aprobados',
      rechazada: 'No hay movimientos rechazados',
      todos: 'No hay movimientos de caja registrados'
    }
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">${msgs[filtroCajaActual]}</div><div class="empty-sub">Los movimientos que afecten Caja General aparecerán aquí</div></div>`
    return
  }

  container.innerHTML = filtered.map(p => {
    const esIngreso = p.caja_tipo === 'ingreso'
    const iconClass = esIngreso ? 'ingreso' : 'egreso'
    const icon = esIngreso ? '↓' : '↑'
    const montoClass = esIngreso ? 'ingreso' : 'egreso'
    const signo = esIngreso ? '+' : '-'
    const estadoBadge = p.estado === 'pendiente_caja' ? 'badge-amber'
      : p.estado === 'aprobada' ? 'badge-green' : 'badge-red'
    const estadoLabel = p.estado === 'pendiente_caja' ? 'Pendiente aprobación'
      : p.estado === 'aprobada' ? 'Aprobada' : 'Rechazada'
    const fecha = new Date(p.created_at).toLocaleDateString('es-HN')
    const hora = new Date(p.created_at).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' })

    const actions = p.estado === 'pendiente_caja' ? `
      <div class="caja-actions">
        <button class="caja-btn aprobar" onclick="aprobarCaja('${p.id}')">✓ Aprobar</button>
        <button class="caja-btn rechazar" onclick="rechazarCaja('${p.id}')">✕ Rechazar</button>
      </div>` : ''

    const aprobadoInfo = p.estado === 'aprobada' && p.aprobador?.nombre
      ? `<span style="font-size:11px;color:var(--text3)">Aprobada por ${p.aprobador.nombre}</span>` : ''

    return `
    <div class="caja-card ${p.estado}">
      <div class="caja-left">
        <div class="caja-icon ${iconClass}">${icon}</div>
        <div class="caja-info">
          <h4>Partida #${p.numero_partida || '—'} · ${p.descripcion}</h4>
          <p>${fecha} ${hora} · ${p.generador?.nombre || 'Sistema'} · Doc: ${p.numero_documento || '—'}</p>
          <p style="margin-top:4px">Cuentas: ${p.caja_lineas.map(l => l.cuenta_codigo + ' ' + l.cuenta_nombre).join(', ')}</p>
          ${aprobadoInfo}
        </div>
      </div>
      <div class="caja-right">
        <div>
          <div class="caja-monto ${montoClass}">${signo} L. ${p.caja_monto.toLocaleString('es-HN', { minimumFractionDigits: 2 })}</div>
          <div style="text-align:right;margin-top:4px"><span class="badge ${estadoBadge}">${estadoLabel}</span></div>
        </div>
        ${actions}
      </div>
    </div>`
  }).join('')
}

async function updateCajaBadge() {
  // Contar pendientes de caja para el badge del sidebar
  const { count, error } = await sb.from('partidas_contables')
    .select('*', { count: 'exact', head: true })
    .eq('estado', 'pendiente_caja')
  if (!error && count > 0) {
    const badge = document.getElementById('badge-caja')
    badge.classList.remove('hidden')
    badge.textContent = count
  } else {
    document.getElementById('badge-caja').classList.add('hidden')
  }
}

window.aprobarCaja = async (id) => {
  if (!confirm('¿Aprobar esta entrega a Caja General?\n\nEl movimiento quedará contabilizado.')) return
  const { error } = await sb.from('partidas_contables').update({
    estado: 'aprobada',
    aprobada_at: new Date().toISOString(),
    aprobada_por: currentProfile.id
  }).eq('id', id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast('Entrega aprobada y contabilizada ✓', 'success')
  loadCaja()
}

window.rechazarCaja = async (id) => {
  const motivo = prompt('Motivo del rechazo (opcional):')
  if (motivo === null) return // canceló el prompt
  const { error } = await sb.from('partidas_contables').update({
    estado: 'rechazada'
  }).eq('id', id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast('Entrega rechazada', 'info')
  loadCaja()
}

// Cargar badge de caja al iniciar (solo super_admin)
async function initCajaBadge() {
  if (currentProfile?.rol === 'super_admin') {
    await updateCajaBadge()
  }
}

