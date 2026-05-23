import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

const sb = createClient(
  'https://icghaqhtvutwlkhtotyv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZ2hhcWh0dnV0d2xraHRvdHl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTE3MzksImV4cCI6MjA5NDk2NzczOX0.2_sioWiJuNVwDaSggnczbzCVu8IorzBsrgbwNXXz39E'
)

// ── STATE ──
let currentUser = null
let currentProfile = null
let empresas = []
let tiposOrigen = []

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
  await loadTiposOrigen()
  // Vista inicial según rol
  const defaultViews = {
    super_admin: ['usuarios', 'Gestión de usuarios'],
    contador: ['partidas', 'Partidas contables'],
    aux_contable: ['pendientes', 'Facturas pendientes'],
    compras: ['compras', 'Registrar compras']
  }
  const [dv, dl] = defaultViews[profile.rol] || ['compras', 'Registrar compras']
  showView(dv, dl)
  // Load caja badge for super_admin
  if (profile.rol === 'super_admin') initCajaBadge()
  initAprobacionesBadge()
}

function setupUI() {
  const p = currentProfile
  const initials = p.nombre.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase()
  document.getElementById('top-avatar').textContent = initials
  document.getElementById('top-name').textContent = p.nombre.split(' ').slice(0,2).join(' ')
  const roleLabels = { super_admin:'Super Admin', contador:'Contador', aux_contable:'Aux. Contable', compras:'Compras' }
  document.getElementById('top-role').textContent = roleLabels[p.rol] || p.rol

  // ── PERMISOS POR ROL ──
  // Definir qué nav-items ve cada rol
  const permisos = {
    super_admin: ['nav-usuarios', 'nav-compras', 'nav-pendientes', 'nav-caja', 'nav-aprobaciones', 'nav-catalogo', 'nav-partidas', 'nav-importar', 'nav-importar-compras', 'nav-importar-costos'],
    contador:    ['nav-compras', 'nav-pendientes', 'nav-aprobaciones', 'nav-catalogo', 'nav-partidas', 'nav-importar', 'nav-importar-compras', 'nav-importar-costos'],
    aux_contable:['nav-compras', 'nav-pendientes', 'nav-catalogo', 'nav-partidas'],
    compras:     ['nav-compras', 'nav-pendientes']
  }
  const visibles = permisos[p.rol] || []

  // Ocultar todo primero
  const todosNav = ['nav-usuarios', 'nav-compras', 'nav-pendientes', 'nav-caja', 'nav-aprobaciones', 'nav-catalogo', 'nav-partidas', 'nav-importar', 'nav-importar-compras', 'nav-importar-costos']
  todosNav.forEach(id => {
    const el = document.getElementById(id)
    if (el) el.classList.toggle('hidden', !visibles.includes(id))
  })

  // Ocultar sección Contabilidad completa si no tiene ningún módulo contable
  const contabItems = ['nav-catalogo', 'nav-partidas', 'nav-importar', 'nav-importar-compras', 'nav-importar-costos']
  const tieneContab = contabItems.some(id => visibles.includes(id))
  document.getElementById('section-contab').classList.toggle('hidden', !tieneContab)
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
  if (id === 'importar-compras') { const ni = document.getElementById('nav-importar-compras'); if(ni) ni.classList.add('active') }
  if (id === 'importar-costos') { const ni = document.getElementById('nav-importar-costos'); if(ni) ni.classList.add('active') }
  document.getElementById('topbar-module').textContent = label
  if (id === 'usuarios') loadUsuarios()
  if (id === 'pendientes') loadPendientes()
  if (id === 'compras') initForm()
  if (id === 'catalogo') loadCatalogo()
  if (id === 'partidas') loadPartidas()
  if (id === 'partida-nueva' && !editingPartidaId) initPartidaNueva()
  if (id === 'caja') loadCaja()
  if (id === 'importar') initImport()
  if (id === 'importar-compras') initImportCompras()
  if (id === 'importar-costos') initImportCostos()
  if (id === 'aprobaciones') loadAprobaciones()
  // Ajustar botones según rol
  applyRoleRestrictions(id)
}

function applyRoleRestrictions(viewId) {
  const rol = currentProfile?.rol
  if (!rol) return
  const puedeCrearCuentas = ['super_admin', 'contador'].includes(rol)
  const puedeCrearPartidas = ['super_admin', 'contador'].includes(rol)
  const puedeCrearUsuarios = rol === 'super_admin'

  // Botón "+ Nueva cuenta" en catálogo
  const btnNuevaCuenta = document.querySelector('#view-catalogo .btn-gold')
  if (btnNuevaCuenta) btnNuevaCuenta.classList.toggle('hidden', !puedeCrearCuentas)

  // Botón "+ Nueva partida" en partidas
  const btnNuevaPartida = document.querySelector('#view-partidas .btn-gold')
  if (btnNuevaPartida) btnNuevaPartida.classList.toggle('hidden', !puedeCrearPartidas)

  // Botón "+ Nuevo usuario"
  const btnNuevoUsuario = document.querySelector('#view-usuarios .btn-gold')
  if (btnNuevoUsuario) btnNuevoUsuario.classList.toggle('hidden', !puedeCrearUsuarios)

  // Botón "Aprobar partida" en nueva partida — aux_contable no puede aprobar
  if (viewId === 'partida-nueva' && rol === 'aux_contable') {
    const btnsPartida = document.querySelectorAll('#view-partida-nueva .form-actions .btn')
    btnsPartida.forEach(b => {
      if (b.textContent.includes('Aprobar')) b.classList.add('hidden')
    })
  }
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

// ── TIPOS DE ORIGEN ──
async function loadTiposOrigen() {
  const { data } = await sb.from('tipos_origen').select('*').eq('activo', true).order('orden')
  tiposOrigen = data || []
  // Poblar select del formulario de partida
  const pnOrigen = document.getElementById('pn-origen')
  if (pnOrigen) {
    pnOrigen.innerHTML = tiposOrigen.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')
  }
  // Poblar select del filtro de partidas
  const fpOrigen = document.getElementById('fp-origen')
  if (fpOrigen) {
    fpOrigen.innerHTML = '<option value="">Todo origen</option>' + tiposOrigen.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')
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
let pendientesData = []

async function loadPendientes() {
  const container = document.getElementById('lista-pendientes')
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)"><div class="spinner"></div></div>'
  let query = sb.from('facturas_compras')
    .select('*, centro_costo:centros_costo(nombre), proveedor:proveedores(nombre), registrado:usuarios!registrado_por(nombre)')
    .order('created_at', { ascending: false })
    .limit(500)
  if (currentProfile.rol === 'compras') {
    query = query.eq('registrado_por', currentProfile.id)
  }
  const { data, error } = await query
  if (error) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${error.message}</div></div>`; return }
  pendientesData = data || []
  filtrarPendientes()
}

window.filtrarPendientes = () => {
  const buscar = (document.getElementById('pend-buscar')?.value || '').toLowerCase().trim()
  const estadoFiltro = document.getElementById('pend-estado')?.value || 'todos'
  const container = document.getElementById('lista-pendientes')

  let filtered = pendientesData
  if (estadoFiltro === 'pend_documento') {
    filtered = filtered.filter(f => f.estado === 'procesada' && f.recibida === false && f.forma_pago === 'credito')
  } else if (estadoFiltro !== 'todos') {
    filtered = filtered.filter(f => f.estado === estadoFiltro)
  }
  if (buscar) {
    filtered = filtered.filter(f =>
      (f.numero_factura || '').toLowerCase().includes(buscar) ||
      (f.proveedor?.nombre || '').toLowerCase().includes(buscar) ||
      (f.observaciones || '').toLowerCase().includes(buscar) ||
      (f.centro_costo?.nombre || '').toLowerCase().includes(buscar)
    )
  }

  const pendPartida = pendientesData.filter(f => f.estado === 'pendiente').length
  const pendDocumento = pendientesData.filter(f => f.estado === 'procesada' && f.recibida === false && f.forma_pago === 'credito').length
  const totalPend = pendPartida + pendDocumento
  const badge = document.getElementById('badge-pendientes')
  if (totalPend > 0) { badge.classList.remove('hidden'); badge.textContent = totalPend }
  else badge.classList.add('hidden')

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No hay facturas que coincidan</div><div class="empty-sub">Intenta con otro término de búsqueda</div></div>'
    return
  }

  const tipoLabel = { repuestos:'Repuestos/Mat.', servicios:'Servicios', combustible:'Combustible', mantenimiento:'Mant. Vehículo', admin:'Administrativo', otro:'Otro' }
  container.innerHTML = '<div class="pending-list">' + filtered.map(f => {
    const esImportada = (f.observaciones || '').includes('[IMP-COMPRA]')
    const clickablePartida = esImportada && f.estado === 'pendiente'
    const pendienteDoc = f.estado === 'procesada' && f.recibida === false && (f.observaciones || '').includes('[IMP-COMPRA]')

    // Determinar estado visual
    let statusLabel, statusClass
    if (f.estado === 'pendiente') { statusLabel = 'Pendiente partida'; statusClass = 'pendiente' }
    else if (pendienteDoc) { statusLabel = 'Pend. documento'; statusClass = 'pendiente' }
    else if (f.estado === 'procesada' && f.recibida) { statusLabel = 'Recibida ✓'; statusClass = 'procesada' }
    else if (f.estado === 'procesada') { statusLabel = 'Procesada'; statusClass = 'procesada' }
    else { statusLabel = f.estado; statusClass = f.estado }

    // Extraer proveedor de observaciones para las importadas sin proveedor
    let provNombre = f.proveedor?.nombre || ''
    if (!provNombre && esImportada) {
      const obs = f.observaciones || ''
      const m = obs.match(/\[IMP-COMPRA\]\s*(.+?)\s*·/)
      if (m) provNombre = m[1]
    }

    return `
    <div class="pending-item ${statusClass}" ${clickablePartida ? `onclick="crearPartidaDesdeFactura('${f.id}')" style="cursor:pointer"` : ''}>
      <div class="pi-left">
        <div class="pi-dot ${statusClass}"></div>
        <div>
          <div class="pi-info">${provNombre || 'Sin proveedor'} · Fact. ${f.numero_factura} · ${f.centro_costo?.nombre || ''}</div>
          <div class="pi-meta">${new Date(f.created_at).toLocaleDateString('es-HN')} ${new Date(f.created_at).toLocaleTimeString('es-HN',{hour:'2-digit',minute:'2-digit'})} · ${f.registrado?.nombre || ''} · ${tipoLabel[f.tipo_gasto]||f.tipo_gasto} · ${f.forma_pago}</div>
        </div>
      </div>
      <div class="pi-right" style="display:flex;align-items:center;gap:12px">
        ${pendienteDoc ? `<button class="btn btn-ghost" onclick="event.stopPropagation();marcarRecibida('${f.id}')" style="padding:5px 12px;font-size:11px;color:var(--green);border-color:var(--green)">✓ Recibida</button>` : ''}
        <div>
          <div class="pi-amount">L. ${parseFloat(f.total).toLocaleString('es-HN',{minimumFractionDigits:2})}</div>
          <div class="pi-status ${statusClass}">${statusLabel}</div>
        </div>
      </div>
    </div>`
  }).join('') + '</div>'
}

window.marcarRecibida = async (facturaId) => {
  const { error } = await sb.from('facturas_compras').update({
    recibida: true,
    recibida_por: currentProfile.id,
    recibida_at: new Date().toISOString(),
  }).eq('id', facturaId)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast('Documento marcado como recibido ✓', 'success')
  // Actualizar datos locales y refiltrar
  const f = pendientesData.find(x => x.id === facturaId)
  if (f) { f.recibida = true; f.recibida_por = currentProfile.id }
  filtrarPendientes()
}

// ── CREAR PARTIDA DESDE FACTURA PENDIENTE (CONTADO IMPORTADAS) ──
window.crearPartidaDesdeFactura = async (facturaId) => {
  // Cargar factura
  const { data: factura, error } = await sb.from('facturas_compras')
    .select('*')
    .eq('id', facturaId)
    .single()
  if (error || !factura) { toast('Error al cargar factura', 'error'); return }

  // Cargar cuentas detalle
  if (!cuentasDetalle.length) {
    const { data } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').eq('es_detalle', true).order('codigo')
    cuentasDetalle = data || []
  }
  const getCuenta = (codigo) => cuentasDetalle.find(c => c.codigo === codigo)

  // Extraer descripción de productos desde observaciones
  const obs = factura.observaciones || ''
  const productosDesc = obs.replace('[IMP-COMPRA]', '').replace(factura.proveedor || '', '').replace(/^[\s·]+/, '').trim()

  // Navegar al formulario de nueva partida
  editingPartidaId = null
  showView('partida-nueva', 'Nueva partida · Compra contado')

  await new Promise(r => setTimeout(r, 300))

  // Llenar encabezado
  document.getElementById('pn-fecha').value = factura.fecha_factura
  document.getElementById('pn-descripcion').value = productosDesc || obs
  document.getElementById('pn-origen').value = 'compra'
  document.getElementById('pn-documento').value = factura.numero_factura || ''

  const esFiscal = factura.numero_factura && !factura.numero_factura.startsWith('SF-')

  // Limpiar líneas y crear las de débito pre-llenadas
  partidaLineas = []
  lineaCounter = 0

  const ctaInventario = getCuenta('110501-001')
  const ctaIva = getCuenta('110402-001')

  // Débito: Inventario
  if (factura.subtotal > 0) {
    lineaCounter++
    partidaLineas.push({
      id: lineaCounter,
      cuenta_id: ctaInventario?.id || '',
      cuenta_codigo: '110501-001',
      cuenta_nombre: 'INVENTARIO PARA LA VENTA BODEGA PRINCIPAL',
      tipo: 'debito',
      monto: Math.round(factura.subtotal * 100) / 100,
      centro_costo_id: factura.centro_costo_id || '',
      descripcion: productosDesc,
      aplica_fiscal: esFiscal,
    })
  }

  // Débito: IVA
  if (factura.isv > 0) {
    lineaCounter++
    partidaLineas.push({
      id: lineaCounter,
      cuenta_id: ctaIva?.id || '',
      cuenta_codigo: '110402-001',
      cuenta_nombre: 'IVA S/COMPRAS NACIONALES',
      tipo: 'debito',
      monto: Math.round(factura.isv * 100) / 100,
      centro_costo_id: factura.centro_costo_id || '',
      descripcion: '',
      aplica_fiscal: esFiscal,
    })
  }

  // Línea vacía para crédito (forma de pago — el usuario la llena)
  lineaCounter++
  partidaLineas.push({
    id: lineaCounter,
    cuenta_id: '',
    cuenta_codigo: '',
    cuenta_nombre: '',
    tipo: 'credito',
    monto: 0,
    centro_costo_id: '',
    descripcion: '',
    aplica_fiscal: esFiscal,
  })

  renderLineas()
  calcTotales()

  // Guardar referencia para actualizar estado al guardar
  window._facturaContadoId = facturaId

  toast('Débitos cargados. Completá el crédito con la forma de pago (caja, banco, etc.)', 'info')
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
let editingPartidaId = null

let allPartidas = []

async function loadPartidas() {
  const tbody = document.getElementById('tbody-partidas')
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'
  const { data, error } = await sb.from('partidas_contables')
    .select('*, centro_costo:centros_costo(nombre), generador:usuarios!generada_por(nombre)')
    .order('created_at', { ascending: false }).limit(200)
  if (error) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--red)">${error.message}</td></tr>`; return }
  allPartidas = data || []
  if (!allPartidas.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3)">No hay partidas registradas. Crea la primera.</td></tr>'
    document.getElementById('sp-total').textContent = '0'
    document.getElementById('sp-borrador').textContent = '0'
    document.getElementById('sp-aprobadas').textContent = '0'
    return
  }
  document.getElementById('sp-total').textContent = allPartidas.length
  document.getElementById('sp-borrador').textContent = allPartidas.filter(p => p.estado === 'borrador').length
  document.getElementById('sp-aprobadas').textContent = allPartidas.filter(p => p.estado === 'aprobada').length
  filtrarPartidas()
}
window.loadPartidas = loadPartidas

window.filtrarPartidas = () => {
  const buscar = (document.getElementById('fp-buscar')?.value || '').toLowerCase()
  const desde = document.getElementById('fp-desde')?.value || ''
  const hasta = document.getElementById('fp-hasta')?.value || ''
  const estado = document.getElementById('fp-estado')?.value || ''
  const origen = document.getElementById('fp-origen')?.value || ''

  let filtered = allPartidas
  if (buscar) filtered = filtered.filter(p => p.descripcion?.toLowerCase().includes(buscar) || p.numero_documento?.toLowerCase().includes(buscar) || String(p.numero_partida).includes(buscar))
  if (desde) filtered = filtered.filter(p => p.fecha_partida >= desde)
  if (hasta) filtered = filtered.filter(p => p.fecha_partida <= hasta)
  if (estado) filtered = filtered.filter(p => p.estado === estado)
  if (origen) filtered = filtered.filter(p => p.tipo_origen === origen)

  renderPartidasTable(filtered)
}

window.limpiarFiltrosPartidas = () => {
  ['fp-buscar','fp-desde','fp-hasta'].forEach(id => { const el = document.getElementById(id); if(el) el.value = '' })
  ;['fp-estado','fp-origen'].forEach(id => { const el = document.getElementById(id); if(el) el.value = '' })
  filtrarPartidas()
}

function renderPartidasTable(data) {
  const tbody = document.getElementById('tbody-partidas')
  const countEl = document.getElementById('fp-count')
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3)">No hay partidas con estos filtros</td></tr>'
    if (countEl) countEl.textContent = '0 resultados'
    return
  }
  if (countEl) countEl.textContent = data.length === allPartidas.length ? '' : `${data.length} de ${allPartidas.length}`
  const getOrigenLabel = (id) => { const t = tiposOrigen.find(x => x.id === id); return t ? t.nombre : id }
  const estadoBadge = { borrador:'badge-amber', aprobada:'badge-green', rechazada:'badge-red', pendiente_caja:'badge-amber', pendiente_anulacion:'badge-red', anulada:'badge-red' }
  const estadoLabel = { pendiente_caja:'⏳ Pend. caja', pendiente_anulacion:'⚠ Pend. anulación', anulada:'✕ Anulada' }
  tbody.innerHTML = data.map(p => `
    <tr style="cursor:pointer" onclick="editarPartida('${p.id}')">
      <td class="mono" style="color:var(--gold)">${p.numero_partida || '—'}</td>
      <td class="mono" style="color:var(--text3)">${new Date(p.fecha_partida).toLocaleDateString('es-HN')}</td>
      <td style="color:var(--text);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.descripcion}</td>
      <td><span class="badge badge-blue" style="font-size:10px">${getOrigenLabel(p.tipo_origen)}</span></td>
      <td class="mono" style="font-weight:500">L. ${parseFloat(p.total).toLocaleString('es-HN',{minimumFractionDigits:2})}</td>
      <td><span class="badge ${estadoBadge[p.estado]||'badge-amber'}">${estadoLabel[p.estado] || p.estado}</span></td>
    </tr>`).join('')
}

async function initPartidaNueva() {
  editingPartidaId = null
  document.getElementById('pn-title').textContent = 'Nueva partida contable'
  const btnElim = document.getElementById('btn-eliminar-partida')
  if (btnElim) btnElim.classList.add('hidden')
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
  editingPartidaId = null
  window._facturaContadoId = null
  showView('partida-nueva', 'Nueva partida')
}

window.volverDesdePartida = () => {
  if (window._facturaContadoId) {
    window._facturaContadoId = null
    showView('pendientes', 'Facturas pendientes')
  } else {
    showView('partidas', 'Partidas contables')
  }
}

// ── EDITAR PARTIDA EXISTENTE ──
window.editarPartida = async (id) => {
  // Cargar cuentas si no están
  if (!cuentasDetalle.length) {
    const { data } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').eq('es_detalle', true).order('codigo')
    cuentasDetalle = data || []
  }

  // Cargar partida
  const { data: partida, error: pErr } = await sb.from('partidas_contables')
    .select('*')
    .eq('id', id)
    .single()
  if (pErr || !partida) { toast('Error al cargar partida', 'error'); return }

  // Cargar líneas
  const { data: lineas, error: lErr } = await sb.from('lineas_partida')
    .select('*')
    .eq('partida_id', id)
    .order('id')
  if (lErr) { toast('Error al cargar líneas', 'error'); return }

  // Navegar al formulario
  editingPartidaId = id
  showView('partida-nueva', `Editar partida #${partida.numero_partida || '—'}`)

  // Esperar que cargue
  await new Promise(r => setTimeout(r, 200))

  // Llenar encabezado
  document.getElementById('pn-title').textContent = `Editar partida #${partida.numero_partida || '—'}`
  document.getElementById('pn-fecha').value = partida.fecha_partida
  document.getElementById('pn-descripcion').value = partida.descripcion || ''
  document.getElementById('pn-documento').value = partida.numero_documento || ''
  document.getElementById('pn-origen').value = partida.tipo_origen || 'compra'

  // Cargar líneas en el formulario
  partidaLineas = []
  lineaCounter = 0
  for (const l of lineas) {
    lineaCounter++
    partidaLineas.push({
      id: lineaCounter,
      cuenta_id: l.cuenta_id || '',
      cuenta_codigo: l.cuenta_codigo || '',
      cuenta_nombre: l.cuenta_nombre || '',
      tipo: l.tipo,
      monto: parseFloat(l.monto) || 0,
      centro_costo_id: l.centro_costo_id || '',
      descripcion: l.descripcion || '',
      aplica_fiscal: l.aplica_fiscal !== false
    })
  }

  renderLineas()
  calcTotales()

  // Mostrar botón eliminar/anular cuando editamos
  const btnElim = document.getElementById('btn-eliminar-partida')
  if (btnElim) {
    btnElim.classList.remove('hidden')
    if (currentProfile?.rol === 'aux_contable') {
      btnElim.textContent = 'Solicitar anulación'
    } else {
      btnElim.textContent = 'Eliminar partida'
    }
  }

  // Auxiliar contable: cambiar texto del botón aprobar
  const btnAprobar = document.getElementById('btn-aprobar-partida')
  if (btnAprobar && currentProfile?.rol === 'aux_contable') {
    btnAprobar.textContent = 'Enviar a revisión'
  } else if (btnAprobar) {
    btnAprobar.textContent = 'Aprobar partida ✓'
  }
}

window.eliminarPartida = async () => {
  if (!editingPartidaId) return
  const rol = currentProfile?.rol

  if (rol === 'aux_contable') {
    // Auxiliar no puede eliminar — solo solicitar anulación
    if (!confirm('¿Solicitar anulación de esta partida?\n\nUn superior deberá aprobar la anulación.')) return
    const { error } = await sb.from('partidas_contables').update({
      estado: 'pendiente_anulacion',
      modificada_por: currentProfile.id,
      modificada_at: new Date().toISOString(),
    }).eq('id', editingPartidaId)
    if (error) { toast('Error: ' + error.message, 'error'); return }
    toast('Anulación solicitada · Pendiente de aprobación', 'info')
    editingPartidaId = null
    showView('partidas', 'Partidas contables')
  } else {
    // Super admin / contador pueden eliminar directamente
    if (!confirm('¿Eliminar esta partida y todas sus líneas?\n\nEsta acción no se puede deshacer.')) return
    const { error: lErr } = await sb.from('lineas_partida').delete().eq('partida_id', editingPartidaId)
    if (lErr) { toast('Error al borrar líneas: ' + lErr.message, 'error'); return }
    const { error: pErr } = await sb.from('partidas_contables').delete().eq('id', editingPartidaId)
    if (pErr) { toast('Error al borrar partida: ' + pErr.message, 'error'); return }
    toast('Partida eliminada', 'success')
    editingPartidaId = null
    showView('partidas', 'Partidas contables')
  }
}

window.addLinea = () => {
  lineaCounter++
  const id = lineaCounter
  // Agregar al inicio (arriba) para que el dropdown no quede cortado
  partidaLineas.unshift({ id, cuenta_id:'', cuenta_codigo:'', cuenta_nombre:'', tipo:'debito', monto:0, centro_costo_id:'', descripcion:'', aplica_fiscal:true })
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
    const esCaja = esCuentaCaja(l.cuenta_codigo) && currentProfile?.rol === 'super_admin'
    // Para cuentas de caja: mostrar botón de conteo + input normal
    const debeInput = esCaja
      ? `<div style="display:flex;gap:4px;align-items:center">
          <input type="text" inputmode="decimal" value="${debeVal}" placeholder="0.00"
            oninput="setDebe(${l.id},this.value)" style="text-align:right;font-family:var(--mono);flex:1">
          <button onclick="openCajaDebe(${l.id})" title="Contar billetes" style="width:28px;height:28px;border-radius:6px;border:0.5px solid var(--green);background:transparent;color:var(--green);cursor:pointer;font-size:13px;flex-shrink:0">💵</button>
        </div>`
      : `<input type="text" inputmode="decimal" value="${debeVal}" placeholder="0.00"
          oninput="setDebe(${l.id},this.value)" style="text-align:right;font-family:var(--mono)">`
    const haberInput = esCaja
      ? `<div style="display:flex;gap:4px;align-items:center">
          <input type="text" inputmode="decimal" value="${haberVal}" placeholder="0.00"
            oninput="setHaber(${l.id},this.value)" style="text-align:right;font-family:var(--mono);flex:1">
          <button onclick="openCajaHaber(${l.id})" title="Contar billetes" style="width:28px;height:28px;border-radius:6px;border:0.5px solid var(--red);background:transparent;color:var(--red);cursor:pointer;font-size:13px;flex-shrink:0">💵</button>
        </div>`
      : `<input type="text" inputmode="decimal" value="${haberVal}" placeholder="0.00"
          oninput="setHaber(${l.id},this.value)" style="text-align:right;font-family:var(--mono)">`
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
      <td>${debeInput}</td>
      <td>${haberInput}</td>
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
  // Limpiar haber de esta línea
  const row = document.querySelector(`input[data-lid="${id}"]`)?.closest('tr')
  if (row) { const haberInput = row.querySelectorAll('input[inputmode="decimal"]')[1]; if (haberInput) haberInput.value = '' }
  calcTotales()
}

window.setHaber = (id, val) => {
  const l = partidaLineas.find(x => x.id === id)
  if (!l) return
  const v = parseFloat(val) || 0
  l.tipo = 'credito'
  l.monto = v
  // Limpiar debe de esta línea
  const row = document.querySelector(`input[data-lid="${id}"]`)?.closest('tr')
  if (row) { const debeInput = row.querySelectorAll('input[inputmode="decimal"]')[0]; if (debeInput) debeInput.value = '' }
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
  // Close any other open dropdowns first
  document.querySelectorAll('.cuenta-dropdown.open').forEach(d => d.classList.remove('open'))
  filterCuentas(lid, input.value)
  positionDropdown(lid, input)
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

function positionDropdown(lid, input) {
  const dd = document.getElementById('dd-' + lid)
  const rect = input.getBoundingClientRect()
  const ddHeight = 320
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top

  if (spaceBelow < ddHeight && spaceAbove > spaceBelow) {
    // Abrir hacia arriba
    dd.style.bottom = (window.innerHeight - rect.top + 2) + 'px'
    dd.style.top = 'auto'
  } else {
    // Abrir hacia abajo (normal)
    dd.style.top = (rect.bottom + 2) + 'px'
    dd.style.bottom = 'auto'
  }
  dd.style.left = rect.left + 'px'
  dd.style.width = Math.max(rect.width, 340) + 'px'
}

window.filterCuentas = (lid, query) => {
  const dd = document.getElementById('dd-' + lid)
  const q = (query || '').toLowerCase()
  const filtered = cuentasDetalle.filter(c =>
    c.codigo.toLowerCase().includes(q) || c.nombre.toLowerCase().includes(q)
  ).slice(0, 30)
  dd.innerHTML = filtered.length ? filtered.map(c => `
    <div class="cuenta-opt" onclick="selectCuenta(${lid},'${c.id}','${c.codigo}','${c.nombre.replace(/'/g,'')}')">
      <span><span class="cc-code">${c.codigo}</span>${c.nombre}</span>
      <span class="cc-tipo">${c.tipo}</span>
    </div>`).join('') : '<div style="padding:12px;color:var(--text3);font-size:12px">No se encontraron cuentas</div>'
  dd.classList.add('open')
  // Reposition in case content scrolled
  const input = document.querySelector(`input[data-lid="${lid}"]`)
  if (input) positionDropdown(lid, input)
}

window.selectCuenta = (lid, cid, codigo, nombre) => {
  const l = partidaLineas.find(x => x.id === lid)
  if (l) { l.cuenta_id = cid; l.cuenta_codigo = codigo; l.cuenta_nombre = nombre }
  document.getElementById('dd-' + lid).classList.remove('open')
  // Re-render para que aparezca el botón de billetes si es cuenta de caja
  renderLineas()
  calcTotales()
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
  const tocaCaja = partidaAfectaCajaGeneral(lineasValidas)
  const hayEgresoCaja = tieneEgresoCaja(lineasValidas)
  const esSuperAdmin = currentProfile.rol === 'super_admin'

  if (hayEgresoCaja && !esSuperAdmin) {
    toast('Solo el Super Admin puede registrar egresos de Caja General (créditos a caja)', 'error')
    return
  }

  let estadoFinal = estado
  if (tocaCaja && !esSuperAdmin && estado === 'aprobada') {
    estadoFinal = 'pendiente_caja'
  }

  // Auxiliar contable: no puede aprobar directamente, queda como borrador
  const esAuxContable = currentProfile.rol === 'aux_contable'
  if (esAuxContable && estado === 'aprobada') {
    estadoFinal = 'borrador'
  }

  let partidaId = editingPartidaId

  if (editingPartidaId) {
    // ── ACTUALIZAR partida existente ──
    const updateData = {
      tipo_origen, descripcion, numero_documento: documento || null,
      fecha_partida: fecha, estado: estadoFinal, total: debitos,
      aprobada_at: estadoFinal === 'aprobada' ? new Date().toISOString() : null,
      aprobada_por: estadoFinal === 'aprobada' ? currentProfile.id : null
    }
    // Si auxiliar modifica, registrar quién y cuándo
    if (esAuxContable) {
      updateData.modificada_por = currentProfile.id
      updateData.modificada_at = new Date().toISOString()
    }
    const { error: pErr } = await sb.from('partidas_contables').update(updateData).eq('id', editingPartidaId)
    if (pErr) { toast('Error: ' + pErr.message, 'error'); return }

    // Borrar líneas viejas y crear nuevas
    const { error: delErr } = await sb.from('lineas_partida').delete().eq('partida_id', editingPartidaId)
    if (delErr) { toast('Error al borrar líneas: ' + delErr.message, 'error'); return }
  } else {
    // ── CREAR partida nueva ──
    const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
      centro_costo_id: null,
      generada_por: currentProfile.id,
      tipo_origen, descripcion, numero_documento: documento || null,
      fecha_partida: fecha, estado: estadoFinal, total: debitos,
      aprobada_at: estadoFinal === 'aprobada' ? new Date().toISOString() : null,
      aprobada_por: estadoFinal === 'aprobada' ? currentProfile.id : null
    }).select('id').single()
    if (pErr) { toast('Error: ' + pErr.message, 'error'); return }
    partidaId = partida.id
  }

  // Insertar líneas
  const lineas = lineasValidas.map(l => ({
    partida_id: partidaId,
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

  // Guardar conteo de billetes si existe
  const lineasConBilletes = lineasValidas.filter(l => l.billetes && esCuentaCaja(l.cuenta_codigo))
  if (lineasConBilletes.length > 0) {
    // Borrar conteos anteriores de esta partida
    await sb.from('conteo_billetes').delete().eq('partida_id', partidaId)
    const conteos = lineasConBilletes.map(l => ({
      partida_id: partidaId,
      tipo: l.tipo === 'debito' ? 'ingreso' : 'egreso',
      den_500: l.billetes[500] || 0,
      den_200: l.billetes[200] || 0,
      den_100: l.billetes[100] || 0,
      den_50: l.billetes[50] || 0,
      den_20: l.billetes[20] || 0,
      den_10: l.billetes[10] || 0,
      den_5: l.billetes[5] || 0,
      den_2: l.billetes[2] || 0,
      den_1: l.billetes[1] || 0,
      total_billetes: Object.values(l.billetes).reduce((s, v) => s + v, 0),
      total_monto: l.monto,
      registrado_por: currentProfile.id
    }))
    await sb.from('conteo_billetes').insert(conteos)
  }

  // ── SINCRONIZAR LIBRO DE COMPRAS ──
  // Solo para partidas de tipo 'compra'
  if (tipo_origen === 'compra' && documento) {
    await syncLibroCompras(partidaId, fecha, documento, lineasValidas, descripcion)
  }

  // Mensajes según resultado
  const accion = editingPartidaId ? 'actualizada' : 'guardada'
  if (estadoFinal === 'pendiente_caja') {
    toast(`Partida ${accion} · Pendiente de aprobación por Caja General`, 'info')
  } else if (estadoFinal === 'aprobada') {
    toast(`Partida ${accion} y contabilizada ✓`, 'success')
  } else if (esAuxContable && estado === 'aprobada') {
    toast(`Partida ${accion} · Enviada a revisión por un superior`, 'info')
  } else {
    toast(`Borrador ${accion}`, 'success')
  }
  editingPartidaId = null

  // ── Insertar en LIBRO DE VENTAS (solo ventas fiscales) ──
  if (window._importVentasData) {
    const vd = window._importVentasData
    const registros = []

    // Tecnimax fiscal
    if (vd.tecnimax_fiscal?.facturas?.length) {
      for (const f of vd.tecnimax_fiscal.facturas) {
        registros.push({
          centro_costo_id: vd.ccTecniId,
          fecha: vd.fecha,
          factura_interna: String(f.factura_interna || ''),
          factura_electronica: f.factura_electronica || '',
          cliente: f.cliente || '',
          rtn_cliente: f.rtn || '',
          subtotal: Math.round(f.subtotal * 100) / 100,
          total_gravado: Math.round(f.total_gravado * 100) / 100,
          total_exento: Math.round(f.total_exento * 100) / 100,
          isv: Math.round(f.impuestos * 100) / 100,
          total: Math.round(f.total * 100) / 100,
          monto_efectivo: Math.round(f.monto_efectivo * 100) / 100,
          monto_tarjeta: Math.round(f.monto_tarjeta * 100) / 100,
          monto_transferencia: Math.round(f.monto_transferencia * 100) / 100,
          incluir_fiscal: true,
          numero_documento: documento || null,
          origen: 'import_alpha',
          partida_id: partidaId,
        })
      }
    }

    // Yonker fiscal
    if (vd.yonker_fiscal?.facturas?.length) {
      for (const f of vd.yonker_fiscal.facturas) {
        registros.push({
          centro_costo_id: vd.ccYonkerId,
          fecha: vd.fecha,
          factura_interna: String(f.factura_interna || ''),
          factura_electronica: f.factura_electronica || '',
          cliente: f.cliente || '',
          rtn_cliente: f.rtn || '',
          subtotal: Math.round(f.subtotal * 100) / 100,
          total_gravado: Math.round(f.total_gravado * 100) / 100,
          total_exento: Math.round(f.total_exento * 100) / 100,
          isv: Math.round(f.impuestos * 100) / 100,
          total: Math.round(f.total * 100) / 100,
          monto_efectivo: Math.round(f.monto_efectivo * 100) / 100,
          monto_tarjeta: Math.round(f.monto_tarjeta * 100) / 100,
          monto_transferencia: Math.round(f.monto_transferencia * 100) / 100,
          incluir_fiscal: true,
          numero_documento: documento || null,
          origen: 'import_alpha',
          partida_id: partidaId,
        })
      }
    }

    if (registros.length) {
      const { error: lvErr } = await sb.from('libro_ventas').insert(registros)
      if (lvErr) console.error('Error libro_ventas:', lvErr.message)
      else console.log(`📗 ${registros.length} registros insertados en libro_ventas`)
    }
    window._importVentasData = null
  }

  // Si vino de una factura de contado importada, marcarla como procesada
  let volverAPendientes = false
  if (window._facturaContadoId) {
    await sb.from('facturas_compras').update({ estado: 'procesada' }).eq('id', window._facturaContadoId)
    window._facturaContadoId = null
    volverAPendientes = true
  }

  if (volverAPendientes) {
    showView('pendientes', 'Facturas pendientes')
  } else {
    showView('partidas', 'Partidas contables')
  }
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
const CAJA_CODIGOS = ['110101', '110101-001', '110102', '110102-001'] // Solo Caja Chica + Caja General MN (NO chequeras ni bancos)

function esCuentaCaja(codigo) {
  if (!codigo) return false
  // Match exacto o subcuentas directas, pero NO 110103 (chequeras) ni 110104 (bancos)
  return CAJA_CODIGOS.some(c => codigo === c || codigo.startsWith(c + '-'))
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
  const fechaSel = document.getElementById('cj-fecha')?.value || ''
  renderCajaList(fechaSel)
}

let cajaPartidas = []

async function loadCaja() {
  const container = document.getElementById('lista-caja')
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)"><div class="spinner"></div></div>'

  // Cargar partidas que afectan caja general (las que tienen lineas con cuentas de caja)
  // Primero obtener las líneas que tocan caja
  const { data: lineasCaja, error: lcErr } = await sb.from('lineas_partida')
    .select('partida_id, tipo, monto, cuenta_codigo, cuenta_nombre')
    .or(CAJA_CODIGOS.map(c => `cuenta_codigo.eq.${c},cuenta_codigo.like.${c}-%`).join(','))

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
      caja_debitos: debitos,
      caja_creditos: creditos,
      caja_tipo: debitos > creditos ? 'ingreso' : 'egreso',
      caja_monto: debitos > creditos ? debitos : creditos,
      caja_lineas: lineas
    }
  })

  // Cargar conteos de billetes
  const { data: conteos } = await sb.from('conteo_billetes')
    .select('*')
    .in('partida_id', partidaIds)
  if (conteos?.length) {
    for (const p of cajaPartidas) {
      p.billetes = conteos.filter(c => c.partida_id === p.id)
    }
  }

  updateCajaStats()
  renderCajaList()
  updateCajaBadge()
}
window.loadCaja = loadCaja

function updateCajaStats() {
  const fmt = (v) => 'L. ' + v.toLocaleString('es-HN', { minimumFractionDigits: 2 })

  // Saldo acumulado (todas las aprobadas, sin filtro de fecha)
  const aprobadas = cajaPartidas.filter(p => p.estado === 'aprobada')
  const totalIngresosAcum = aprobadas.filter(p => p.caja_tipo === 'ingreso').reduce((s, p) => s + p.caja_monto, 0)
  const totalEgresosAcum = aprobadas.filter(p => p.caja_tipo === 'egreso').reduce((s, p) => s + p.caja_monto, 0)
  const saldo = totalIngresosAcum - totalEgresosAcum

  document.getElementById('cj-saldo').textContent = fmt(saldo)
  document.getElementById('cj-saldo').style.color = saldo >= 0 ? 'var(--green)' : 'var(--red)'
  document.getElementById('cj-total-ingresos').textContent = fmt(totalIngresosAcum)
  document.getElementById('cj-total-egresos').textContent = fmt(totalEgresosAcum)

  // Stats filtrados por fecha seleccionada
  filtrarCajaFecha()
}

window.filtrarCajaFecha = () => {
  const fechaSel = document.getElementById('cj-fecha')?.value || ''
  const fmt = (v) => 'L. ' + v.toLocaleString('es-HN', { minimumFractionDigits: 2 })

  let filtradas = cajaPartidas
  if (fechaSel) {
    filtradas = filtradas.filter(p => p.fecha_partida === fechaSel)
  }

  const pendientes = filtradas.filter(p => p.estado === 'pendiente_caja')
  const aprobadasFiltro = filtradas.filter(p => p.estado === 'aprobada')
  const ingresos = aprobadasFiltro.filter(p => p.caja_tipo === 'ingreso')
  const egresos = aprobadasFiltro.filter(p => p.caja_tipo === 'egreso')

  document.getElementById('cj-pendientes').textContent = pendientes.length
  document.getElementById('cj-aprobadas').textContent = aprobadasFiltro.length
  const totalIng = ingresos.reduce((s, p) => s + p.caja_monto, 0)
  const totalEgr = egresos.reduce((s, p) => s + p.caja_monto, 0)
  document.getElementById('cj-ingresos').textContent = fmt(totalIng)
  document.getElementById('cj-egresos').textContent = fmt(totalEgr)

  // Resumen de fecha
  const resumenEl = document.getElementById('cj-fecha-resumen')
  if (resumenEl) {
    if (fechaSel) {
      resumenEl.textContent = `${filtradas.length} movimiento${filtradas.length !== 1 ? 's' : ''} el ${new Date(fechaSel + 'T12:00:00').toLocaleDateString('es-HN')}`
    } else {
      resumenEl.textContent = `${cajaPartidas.length} movimientos en total`
    }
  }

  // También filtrar la lista visible
  renderCajaList(fechaSel)
}

function renderCajaList(fechaFiltro) {
  const container = document.getElementById('lista-caja')
  let filtered = cajaPartidas
  if (filtroCajaActual !== 'todos') {
    filtered = filtered.filter(p => p.estado === filtroCajaActual)
  }
  if (fechaFiltro) {
    filtered = filtered.filter(p => p.fecha_partida === fechaFiltro)
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

    // Detalle de billetes si existe
    let billetesInfo = ''
    if (p.billetes?.length) {
      const denoms = [500,200,100,50,20,10,5,2,1]
      const detalles = p.billetes.map(b => {
        const partes = denoms
          .map(d => ({ d, q: b[`den_${d}`] || 0 }))
          .filter(x => x.q > 0)
          .map(x => `${x.q}×L.${x.d}`)
        return partes.length ? `<span style="color:${b.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)'}">${partes.join(' + ')}</span>` : ''
      }).filter(Boolean)
      if (detalles.length) {
        billetesInfo = `<p style="margin-top:4px;font-size:11px">💵 ${detalles.join(' | ')}</p>`
      }
    }

    return `
    <div class="caja-card ${p.estado}">
      <div class="caja-left">
        <div class="caja-icon ${iconClass}">${icon}</div>
        <div class="caja-info">
          <h4>Partida #${p.numero_partida || '—'} · ${p.descripcion}</h4>
          <p>${fecha} ${hora} · ${p.generador?.nombre || 'Sistema'} · Doc: ${p.numero_documento || '—'}</p>
          ${billetesInfo}
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
  // Abrir conteo de billetes antes de aprobar
  const partida = cajaPartidas.find(p => p.id === id)
  const desc = partida ? partida.descripcion : ''
  const monto = partida ? partida.caja_monto : 0
  const tipo = partida?.caja_tipo === 'ingreso' ? 'recibís' : 'entregás'

  openBilletes(
    `💵 Conteo de billetes · ${partida?.caja_tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}`,
    `${desc} — Contá los billetes que ${tipo} (esperado: L. ${monto.toLocaleString('es-HN', {minimumFractionDigits:2})})`,
    async (montoContado, detalle) => {
      // Verificar si coincide
      if (Math.abs(montoContado - monto) > 0.01) {
        const diff = montoContado - monto
        const ok = confirm(`⚠️ El conteo (L. ${montoContado.toLocaleString('es-HN',{minimumFractionDigits:2})}) no coincide con el monto esperado (L. ${monto.toLocaleString('es-HN',{minimumFractionDigits:2})}).\n\nDiferencia: L. ${diff.toLocaleString('es-HN',{minimumFractionDigits:2})}\n\n¿Aprobar de todas formas?`)
        if (!ok) return
      }

      const { error } = await sb.from('partidas_contables').update({
        estado: 'aprobada',
        aprobada_at: new Date().toISOString(),
        aprobada_por: currentProfile.id
      }).eq('id', id)
      if (error) { toast('Error: ' + error.message, 'error'); return }
      toast('Entrega aprobada y contabilizada ✓', 'success')
      loadCaja()
    }
  )
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

// ══════════════════════════════════════════════
// ── PENDIENTES DE APROBACIÓN
// ══════════════════════════════════════════════

async function loadAprobaciones() {
  const container = document.getElementById('lista-aprobaciones')
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)"><div class="spinner"></div></div>'

  // Buscar partidas en borrador (modificadas por auxiliar) y pendientes de anulación
  const { data, error } = await sb.from('partidas_contables')
    .select('*, modificador:usuarios!modificada_por(nombre), generador:usuarios!generada_por(nombre)')
    .in('estado', ['borrador', 'pendiente_anulacion'])
    .order('modificada_at', { ascending: false, nullsFirst: false })

  if (error) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${error.message}</div></div>`
    return
  }

  // Actualizar badge
  const badge = document.getElementById('badge-aprobaciones')
  if (data?.length > 0) { badge.classList.remove('hidden'); badge.textContent = data.length }
  else badge.classList.add('hidden')

  if (!data?.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-text">No hay partidas pendientes de aprobación</div><div class="empty-sub">Todo está al día</div></div>'
    return
  }

  const fmt = (v) => parseFloat(v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })

  container.innerHTML = `
    <div style="margin-bottom:12px;display:flex;gap:10px">
      <div class="stat-card" style="flex:1"><div class="stat-num" style="color:var(--amber)">${data.filter(p => p.estado === 'borrador').length}</div><div class="stat-label"><span class="stat-dot" style="background:var(--amber)"></span>Modificadas</div></div>
      <div class="stat-card" style="flex:1"><div class="stat-num" style="color:var(--red)">${data.filter(p => p.estado === 'pendiente_anulacion').length}</div><div class="stat-label"><span class="stat-dot" style="background:var(--red)"></span>Pend. anulación</div></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>N°</th><th>Fecha</th><th>Descripción</th><th>Total</th>
          <th>Modificado por</th><th>Fecha modif.</th><th>Estado</th><th style="width:180px">Acciones</th>
        </tr></thead>
        <tbody>${data.map(p => {
          const esAnulacion = p.estado === 'pendiente_anulacion'
          const modificador = p.modificador?.nombre || p.generador?.nombre || '—'
          const fechaMod = p.modificada_at ? new Date(p.modificada_at).toLocaleDateString('es-HN') + ' ' + new Date(p.modificada_at).toLocaleTimeString('es-HN', {hour:'2-digit',minute:'2-digit'}) : '—'
          return `<tr>
            <td class="mono" style="color:var(--gold);cursor:pointer" onclick="editarPartida('${p.id}')">${p.numero_partida || '—'}</td>
            <td class="mono" style="font-size:12px">${new Date(p.fecha_partida).toLocaleDateString('es-HN')}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${p.descripcion}</td>
            <td class="mono" style="font-weight:500">L. ${fmt(p.total)}</td>
            <td style="font-size:12px;color:var(--amber)">${modificador}</td>
            <td style="font-size:11px;color:var(--text3)">${fechaMod}</td>
            <td><span class="badge ${esAnulacion ? 'badge-red' : 'badge-amber'}">${esAnulacion ? '⚠ Anulación' : 'Modificada'}</span></td>
            <td style="display:flex;gap:6px">
              <button class="btn btn-ghost" onclick="aprobarPartidaPendiente('${p.id}')" style="padding:4px 10px;font-size:11px;color:var(--green);border-color:var(--green)">${esAnulacion ? '✓ Anular' : '✓ Aprobar'}</button>
              <button class="btn btn-ghost" onclick="rechazarPartidaPendiente('${p.id}')" style="padding:4px 10px;font-size:11px;color:var(--red);border-color:var(--red)">✕ Rechazar</button>
            </td>
          </tr>`
        }).join('')}
        </tbody>
      </table>
    </div>`
}

window.aprobarPartidaPendiente = async (id) => {
  // Cargar partida para saber si es anulación o modificación
  const { data: partida } = await sb.from('partidas_contables').select('estado').eq('id', id).single()
  if (!partida) { toast('Partida no encontrada', 'error'); return }

  if (partida.estado === 'pendiente_anulacion') {
    if (!confirm('¿Aprobar la anulación de esta partida?\n\nLa partida quedará como anulada.')) return
    const { error } = await sb.from('partidas_contables').update({
      estado: 'anulada',
      aprobada_por: currentProfile.id,
      aprobada_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast('Error: ' + error.message, 'error'); return }
    toast('Partida anulada ✓', 'success')
  } else {
    if (!confirm('¿Aprobar esta partida modificada?')) return
    const { error } = await sb.from('partidas_contables').update({
      estado: 'aprobada',
      aprobada_por: currentProfile.id,
      aprobada_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast('Error: ' + error.message, 'error'); return }
    toast('Partida aprobada ✓', 'success')
  }
  loadAprobaciones()
}

window.rechazarPartidaPendiente = async (id) => {
  const motivo = prompt('Motivo del rechazo (opcional):')
  if (motivo === null) return

  const { data: partida } = await sb.from('partidas_contables').select('estado').eq('id', id).single()

  if (partida?.estado === 'pendiente_anulacion') {
    // Rechazar anulación = volver a aprobada
    const { error } = await sb.from('partidas_contables').update({
      estado: 'aprobada',
      modificada_por: null,
      modificada_at: null,
    }).eq('id', id)
    if (error) { toast('Error: ' + error.message, 'error'); return }
    toast('Anulación rechazada · Partida restaurada como aprobada', 'info')
  } else {
    // Rechazar modificación = marcar como rechazada
    const { error } = await sb.from('partidas_contables').update({
      estado: 'rechazada',
    }).eq('id', id)
    if (error) { toast('Error: ' + error.message, 'error'); return }
    toast('Modificación rechazada', 'info')
  }
  loadAprobaciones()
}

// Cargar badge de aprobaciones al iniciar
async function initAprobacionesBadge() {
  if (['super_admin', 'contador'].includes(currentProfile?.rol)) {
    const { count } = await sb.from('partidas_contables')
      .select('id', { count: 'exact', head: true })
      .in('estado', ['borrador', 'pendiente_anulacion'])
    const badge = document.getElementById('badge-aprobaciones')
    if (count > 0) { badge.classList.remove('hidden'); badge.textContent = count }
    else badge.classList.add('hidden')
  }
}

// ══════════════════════════════════════════════
// ── SINCRONIZACIÓN LIBRO DE COMPRAS / VENTAS
// ══════════════════════════════════════════════

async function syncLibroCompras(partidaId, fecha, numDocumento, lineasValidas, descripcion) {
  // Buscar si ya existe en libro_compras por numero_documento
  const { data: existente } = await sb.from('libro_compras')
    .select('id, incluir_fiscal')
    .eq('numero_documento', numDocumento)
    .maybeSingle()

  // Determinar si alguna línea tiene aplica_fiscal = true
  const algunaFiscal = lineasValidas.some(l => l.aplica_fiscal)

  // Extraer datos de las líneas para el registro
  const lineaInventario = lineasValidas.find(l => l.cuenta_codigo?.startsWith('110501'))
  const lineaIva = lineasValidas.find(l => l.cuenta_codigo?.startsWith('110402'))
  const lineaProveedor = lineasValidas.find(l => l.cuenta_codigo?.startsWith('210101'))
  const lineaCaja = lineasValidas.find(l => l.cuenta_codigo?.startsWith('1101'))

  const subtotal = lineaInventario?.monto || 0
  const isv = lineaIva?.monto || 0
  const total = lineasValidas.filter(l => l.tipo === 'credito').reduce((s, l) => s + l.monto, 0) || (subtotal + isv)
  const provNombre = lineaProveedor?.cuenta_nombre || lineaProveedor?.descripcion || ''
  const cuentaProv = lineaProveedor?.cuenta_codigo || ''
  const formaPago = lineaProveedor ? 'credito' : (lineaCaja ? 'contado' : 'otro')
  const centroCostoId = lineaInventario?.centro_costo_id || lineasValidas[0]?.centro_costo_id || null

  if (existente) {
    // Ya existe → actualizar incluir_fiscal según el check
    await sb.from('libro_compras').update({
      incluir_fiscal: algunaFiscal,
      subtotal: Math.round(subtotal * 100) / 100,
      isv: Math.round(isv * 100) / 100,
      total: Math.round(total * 100) / 100,
      proveedor: provNombre,
      cuenta_proveedor: cuentaProv,
      productos: descripcion,
      forma_pago: formaPago,
    }).eq('id', existente.id)
  } else if (algunaFiscal) {
    // No existe y tiene fiscal → insertar
    await sb.from('libro_compras').insert({
      centro_costo_id: centroCostoId,
      fecha,
      numero_factura: numDocumento,
      numero_documento: numDocumento,
      proveedor: provNombre,
      rtn_proveedor: '',
      cuenta_proveedor: cuentaProv,
      subtotal: Math.round(subtotal * 100) / 100,
      isv: Math.round(isv * 100) / 100,
      total: Math.round(total * 100) / 100,
      forma_pago: formaPago,
      productos: descripcion,
      incluir_fiscal: true,
      origen: 'manual',
      partida_id: partidaId,
    })
  }
}

// ══════════════════════════════════════════════
// ── IMPORTAR VENTAS TALLER ALPHA
// ══════════════════════════════════════════════

// Mapeo de cuentas
const IMPORT_CUENTAS = {
  caja_general:      { codigo: '110102',      nombre: 'CAJA GENERAL' },
  venta_tecnimax:    { codigo: '410101-001',  nombre: 'VENTA DE BODEGA TECNIMAX' },
  isv_ventas:        { codigo: '210201-001',  nombre: 'IMPUESTO SOBRE VENTAS' },
  venta_yonker:      { codigo: '410101-002',  nombre: 'VENTA YONKER TECNIMAX' },
  venta_tecnimax_int:{ codigo: '410301-001',  nombre: 'VENTA TECNIMAX 2' },
  venta_yonker_int:  { codigo: '410301-002',  nombre: 'VENTA YONKER TECNIMAX 2' },
  bono_tecnimax:     { codigo: '410301-003',  nombre: 'BONO POR VENTA TECNIMAX' },
}

let importFiles = []
let importData = null
let importFiscalTab = 'tecnimax'

function initImport() {
  // Default: fecha de ayer (los reportes siempre son del día anterior)
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  document.getElementById('imp-fecha').value = ayer.toISOString().split('T')[0]
  const fecha = document.getElementById('imp-fecha').value
  document.getElementById('imp-desc').value = `Ventas Alpha ${fecha}`
  resetImport()
  document.getElementById('import-step1').classList.remove('hidden')
}

window.onImportFiles = (input) => {
  importFiles = Array.from(input.files || [])
  const list = document.getElementById('import-file-list')
  if (!importFiles.length) { list.innerHTML = ''; return }
  list.innerHTML = importFiles.map(f => `
    <div class="imp-file-item">
      <span class="imp-file-icon">📊</span>
      <span class="imp-file-name">${f.name}</span>
      <span style="font-size:11px;color:var(--text3)">${(f.size/1024).toFixed(0)} KB</span>
    </div>`).join('')
  document.getElementById('import-zone').classList.add('has-file')
  document.getElementById('btn-procesar-import').disabled = false
}

function parseAlphaExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  // Identificar empresa — buscar en las primeras filas el valor después de "Empresa:"
  let empresaRaw = ''
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const row = data[r]
    if (!row) continue
    for (let c = 0; c < Math.min(10, row.length); c++) {
      const val = String(row[c] || '').trim()
      if (val.toLowerCase() === 'empresa:' || val.toLowerCase() === 'empresa') {
        // El nombre está en la siguiente columna
        empresaRaw = String(row[c + 1] || '').trim()
        if (!empresaRaw) {
          // O quizás en la siguiente fila misma columna
          empresaRaw = String((data[r + 1] || [])[c] || '').trim()
        }
        break
      }
    }
    if (empresaRaw) break
  }

  // Si aún no encontró, intentar fila 3 columnas 1-5
  if (!empresaRaw) {
    for (let c = 0; c < 6; c++) {
      const v = String((data[3] || [])[c] || '').trim()
      if (v && v !== 'Empresa:' && v.length > 2 && !v.includes('Fecha')) {
        empresaRaw = v
        break
      }
    }
  }

  // Detectar tipo: si el nombre es todo mayúsculas = interno, si tiene mixed case = fiscal
  let tipo, centro
  const esUpper = empresaRaw === empresaRaw.toUpperCase() && empresaRaw.length > 0
  const tieneYonker = empresaRaw.toLowerCase().includes('yonker')

  if (tieneYonker && esUpper) { tipo = 'yonker_interno'; centro = 'Yonker' }
  else if (tieneYonker && !esUpper) { tipo = 'yonker_fiscal'; centro = 'Yonker' }
  else if (!tieneYonker && esUpper) { tipo = 'tecnimax_interno'; centro = 'Tecnicentro' }
  else if (!tieneYonker && !esUpper && empresaRaw) { tipo = 'tecnimax_fiscal'; centro = 'Tecnicentro' }
  else { tipo = 'desconocido'; centro = empresaRaw || '?' }

  // Buscar dinámicamente la fila de headers y columnas
  let headerRow = -1
  let colMap = {}
  for (let r = 0; r < Math.min(20, data.length); r++) {
    const row = data[r]
    if (!row) continue
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').trim().toLowerCase()
      if (val === 'no. factura interna' || val.includes('factura interna')) {
        headerRow = r
        // Mapear todas las columnas por nombre
        for (let cc = 0; cc < row.length; cc++) {
          const h = String(row[cc] || '').trim().toLowerCase()
          if (h.includes('factura electr')) colMap.factura_electronica = cc
          else if (h.includes('factura interna')) colMap.factura_interna = cc
          else if (h === 'cliente') colMap.cliente = cc
          else if (h === 'rtn') colMap.rtn = cc
          else if (h === 'subtotal') colMap.subtotal = cc
          else if (h === 'impuestos' && !h.includes('devuelto') && !h.includes('servicio')) colMap.impuestos = cc
          else if (h === 'total') colMap.total = cc
          else if (h.includes('total exento')) colMap.total_exento = cc
          else if (h.includes('total gravado') && !h.includes('15')) colMap.total_gravado = cc
          else if (h === 'fecha') colMap.fecha = cc
          else if (h.includes('monto en tarjeta')) colMap.monto_tarjeta = cc
          else if (h.includes('monto en efectivo')) colMap.monto_efectivo = cc
          else if (h.includes('monto transacción') || h.includes('monto transaccion')) colMap.monto_transferencia = cc
        }
        break
      }
    }
    if (headerRow >= 0) break
  }

  // Fallback a posiciones fijas si no encontró headers
  if (headerRow < 0) headerRow = 8
  if (!colMap.factura_interna && colMap.factura_interna !== 0) colMap = { factura_interna:0, factura_electronica:4, cliente:10, rtn:11, subtotal:18, impuestos:19, total:24, total_exento:25, total_gravado:26, fecha:17, monto_tarjeta:30, monto_efectivo:31, monto_transferencia:33 }

  // Extraer filas de datos (empezar después del header)
  const facturas = []
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i]
    if (!row) break
    const firstCell = row[colMap.factura_interna]
    if (firstCell == null || String(firstCell).trim() === '') break
    // Verificar que sea un número (factura interna) no un texto de resumen
    if (isNaN(Number(firstCell))) break
    facturas.push({
      factura_interna: firstCell,
      factura_electronica: String(row[colMap.factura_electronica] || ''),
      cliente: String(row[colMap.cliente] || ''),
      rtn: String(row[colMap.rtn] || ''),
      subtotal: parseFloat(row[colMap.subtotal]) || 0,
      impuestos: parseFloat(row[colMap.impuestos]) || 0,
      total: parseFloat(row[colMap.total]) || 0,
      total_exento: parseFloat(row[colMap.total_exento]) || 0,
      total_gravado: parseFloat(row[colMap.total_gravado]) || 0,
      fecha: String(row[colMap.fecha] || ''),
      monto_tarjeta: parseFloat(row[colMap.monto_tarjeta]) || 0,
      monto_efectivo: parseFloat(row[colMap.monto_efectivo]) || 0,
      monto_transferencia: parseFloat(row[colMap.monto_transferencia]) || 0,
    })
  }

  const totales = {
    subtotal: facturas.reduce((s, f) => s + f.subtotal, 0),
    impuestos: facturas.reduce((s, f) => s + f.impuestos, 0),
    total: facturas.reduce((s, f) => s + f.total, 0),
    exento: facturas.reduce((s, f) => s + f.total_exento, 0),
  }

  return { empresaRaw, tipo, centro, facturas, totales }
}

function validarCorrelativos(facturas) {
  const nums = []
  let prefix = ''
  for (const f of facturas) {
    const parts = f.factura_electronica.split('-')
    if (parts.length >= 4) {
      nums.push(parseInt(parts[parts.length - 1]))
      if (!prefix) prefix = parts.slice(0, -1).join('-')
    }
  }
  if (!nums.length) return { ok: true, faltantes: [] }
  const sorted = [...nums].sort((a, b) => a - b)
  const expected = []
  for (let i = sorted[0]; i <= sorted[sorted.length - 1]; i++) expected.push(i)
  const faltantes = expected.filter(n => !nums.includes(n))
  return {
    ok: faltantes.length === 0,
    faltantes: faltantes.map(n => `${prefix}-${String(n).padStart(8, '0')}`),
    rango: `${prefix}-${String(sorted[0]).padStart(8, '0')} → ${prefix}-${String(sorted[sorted.length - 1]).padStart(8, '0')}`
  }
}

function validarISV(facturas) {
  const errores = []
  for (const f of facturas) {
    if (f.subtotal > 0) {
      const esperado = Math.round(f.subtotal * 0.15 * 100) / 100
      const diff = Math.abs(f.impuestos - esperado)
      if (diff > 0.05) {
        errores.push({ factura: f.factura_electronica, subtotal: f.subtotal, isv: f.impuestos, esperado, diff })
      }
    }
  }
  return errores
}

window.procesarImport = async () => {
  if (importFiles.length === 0) { toast('Selecciona los archivos Excel', 'error'); return }

  const btn = document.getElementById('btn-procesar-import')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Procesando...'

  try {
    const reportes = []
    for (const file of importFiles) {
      const buf = await file.arrayBuffer()
      const parsed = parseAlphaExcel(buf)
      reportes.push(parsed)
    }

    // Clasificar
    const tecnimax_fiscal = reportes.find(r => r.tipo === 'tecnimax_fiscal')
    const tecnimax_interno = reportes.find(r => r.tipo === 'tecnimax_interno')
    const yonker_fiscal = reportes.find(r => r.tipo === 'yonker_fiscal')
    const yonker_interno = reportes.find(r => r.tipo === 'yonker_interno')

    // Validaciones
    const alertas = []

    // Debug: mostrar qué se detectó
    for (const r of reportes) {
      alertas.push({ tipo: 'info', msg: `📄 "${r.empresaRaw}" → ${r.tipo} (${r.facturas.length} facturas, centro: ${r.centro})` })
    }

    // Verificar que se subieron los 4 tipos
    if (!tecnimax_fiscal) alertas.push({ tipo: 'error', msg: 'Falta reporte: Tecnimax fiscal (Tecnimax en minúscula)' })
    if (!tecnimax_interno) alertas.push({ tipo: 'error', msg: 'Falta reporte: TECNIMAX interno (TECNIMAX en mayúscula)' })
    if (!yonker_fiscal) alertas.push({ tipo: 'error', msg: 'Falta reporte: Yonker Tecnimax fiscal (Yonker Tecnimax en minúscula)' })
    if (!yonker_interno) alertas.push({ tipo: 'error', msg: 'Falta reporte: YONKER TECNIMAX interno (YONKER TECNIMAX en mayúscula)' })

    // Correlativos
    for (const r of reportes) {
      if (!r) continue
      const corr = validarCorrelativos(r.facturas)
      if (!corr.ok) {
        alertas.push({ tipo: 'warning', msg: `⚠️ ${r.empresaRaw}: Correlativos faltantes: ${corr.faltantes.join(', ')}` })
      } else {
        alertas.push({ tipo: 'success', msg: `✅ ${r.empresaRaw}: Correlativos completos (${corr.rango})` })
      }
    }

    // ISV en Tecnimax (fiscal e interno)
    for (const r of [tecnimax_fiscal, tecnimax_interno]) {
      if (!r) continue
      const errISV = validarISV(r.facturas)
      if (errISV.length) {
        for (const e of errISV) {
          alertas.push({ tipo: 'warning', msg: `⚠️ ${r.empresaRaw} Fact. ${e.factura}: ISV ${e.isv.toFixed(2)} ≠ esperado ${e.esperado.toFixed(2)} (diff: ${e.diff.toFixed(2)})` })
        }
      } else if (r.facturas.length) {
        alertas.push({ tipo: 'success', msg: `✅ ${r.empresaRaw}: ISV cuadra al 15% en todas las facturas` })
      }
    }

    // Yonker exentas
    for (const r of [yonker_fiscal, yonker_interno]) {
      if (!r) continue
      if (r.totales.impuestos !== 0) {
        alertas.push({ tipo: 'error', msg: `⚠️ ${r.empresaRaw}: Tiene impuestos (L. ${r.totales.impuestos.toFixed(2)}) pero debería ser exenta` })
      } else {
        alertas.push({ tipo: 'success', msg: `✅ ${r.empresaRaw}: Ventas exentas confirmado` })
      }
    }

    importData = { tecnimax_fiscal, tecnimax_interno, yonker_fiscal, yonker_interno, alertas }

    // Mostrar resultados
    renderImportResults()

  } catch (err) {
    toast('Error al procesar: ' + err.message, 'error')
  }
  btn.disabled = false; btn.textContent = 'Procesar reportes →'
}

function renderImportResults() {
  const d = importData
  document.getElementById('import-step1').classList.add('hidden')
  document.getElementById('import-step2').classList.remove('hidden')
  document.getElementById('import-step3').classList.remove('hidden')
  document.getElementById('import-step4').classList.remove('hidden')

  // Alertas
  const alertasHtml = d.alertas.map(a => `<div class="imp-alert ${a.tipo}"><span>${a.msg}</span></div>`).join('')
  document.getElementById('import-alertas').innerHTML = alertasHtml

  // Resumen de totales
  const fmt = (v) => 'L. ' + v.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const tf = d.tecnimax_fiscal?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const ti = d.tecnimax_interno?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const yf = d.yonker_fiscal?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const yi = d.yonker_interno?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const granTotal = tf.total + ti.total + yf.total + yi.total

  document.getElementById('import-resumen').innerHTML = `
    <div class="imp-summary">
      <div class="imp-sum-card">
        <div class="imp-sum-title">Tecnimax Fiscal (${d.tecnimax_fiscal?.facturas.length || 0} facturas)</div>
        <div class="imp-sum-row"><span class="label">Subtotal</span><span class="value">${fmt(tf.subtotal)}</span></div>
        <div class="imp-sum-row"><span class="label">ISV 15%</span><span class="value">${fmt(tf.impuestos)}</span></div>
        <div class="imp-sum-row imp-sum-total"><span class="label">Total</span><span class="value">${fmt(tf.total)}</span></div>
      </div>
      <div class="imp-sum-card">
        <div class="imp-sum-title">TECNIMAX Interno (${d.tecnimax_interno?.facturas.length || 0} facturas)</div>
        <div class="imp-sum-row"><span class="label">Subtotal</span><span class="value">${fmt(ti.subtotal)}</span></div>
        <div class="imp-sum-row"><span class="label">ISV (Bono)</span><span class="value">${fmt(ti.impuestos)}</span></div>
        <div class="imp-sum-row imp-sum-total"><span class="label">Total</span><span class="value">${fmt(ti.total)}</span></div>
      </div>
      <div class="imp-sum-card">
        <div class="imp-sum-title">Yonker Fiscal (${d.yonker_fiscal?.facturas.length || 0} facturas)</div>
        <div class="imp-sum-row"><span class="label">Total exento</span><span class="value">${fmt(yf.total)}</span></div>
        <div class="imp-sum-row imp-sum-total"><span class="label">Total</span><span class="value">${fmt(yf.total)}</span></div>
      </div>
      <div class="imp-sum-card">
        <div class="imp-sum-title">YONKER Interno (${d.yonker_interno?.facturas.length || 0} facturas)</div>
        <div class="imp-sum-row"><span class="label">Total exento</span><span class="value">${fmt(yi.total)}</span></div>
        <div class="imp-sum-row imp-sum-total"><span class="label">Total</span><span class="value">${fmt(yi.total)}</span></div>
      </div>
    </div>
    <div style="text-align:center;padding:12px;background:var(--bg3);border-radius:var(--radius);border:0.5px solid var(--gold)">
      <span style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Gran Total del día</span>
      <div style="font-size:24px;font-family:var(--mono);color:var(--gold);font-weight:500;margin-top:4px">${fmt(granTotal)}</div>
    </div>`

  // Detalle fiscal
  renderFiscalDetail()

  // Partida generada
  renderImportPartida()
}

window.showFiscalTab = (tab) => {
  importFiscalTab = tab
  document.getElementById('tab-fiscal-tecnimax').style.borderColor = tab === 'tecnimax' ? 'var(--gold)' : 'var(--border)'
  document.getElementById('tab-fiscal-tecnimax').style.color = tab === 'tecnimax' ? 'var(--gold)' : 'var(--text2)'
  document.getElementById('tab-fiscal-yonker').style.borderColor = tab === 'yonker' ? 'var(--gold)' : 'var(--border)'
  document.getElementById('tab-fiscal-yonker').style.color = tab === 'yonker' ? 'var(--gold)' : 'var(--text2)'
  renderFiscalDetail()
}

function renderFiscalDetail() {
  const d = importData
  const facturas = importFiscalTab === 'tecnimax'
    ? (d.tecnimax_fiscal?.facturas || [])
    : (d.yonker_fiscal?.facturas || [])
  const fmt = (v) => v.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const tbody = document.getElementById('tbody-fiscal')

  // Obtener números y detectar faltantes para insertar como "Anulada"
  const facturasConAnuladas = []
  const nums = []
  let prefix = ''
  for (const f of facturas) {
    const parts = f.factura_electronica.split('-')
    if (parts.length >= 4) {
      nums.push(parseInt(parts[parts.length - 1]))
      if (!prefix) prefix = parts.slice(0, -1).join('-')
    }
  }

  if (nums.length > 0) {
    const sorted = [...nums].sort((a, b) => a - b)
    for (let n = sorted[0]; n <= sorted[sorted.length - 1]; n++) {
      const facNum = `${prefix}-${String(n).padStart(8, '0')}`
      const facReal = facturas.find(f => f.factura_electronica === facNum)
      if (facReal) {
        facturasConAnuladas.push({ ...facReal, anulada: false })
      } else {
        facturasConAnuladas.push({
          factura_electronica: facNum,
          cliente: 'ANULADA',
          rtn: '',
          subtotal: 0,
          impuestos: 0,
          total: 0,
          anulada: true
        })
      }
    }
  }

  // Ordenar de mayor a menor (más reciente primero)
  facturasConAnuladas.sort((a, b) => {
    const na = parseInt(a.factura_electronica.split('-').pop())
    const nb = parseInt(b.factura_electronica.split('-').pop())
    return nb - na
  })

  tbody.innerHTML = facturasConAnuladas.map(f => {
    if (f.anulada) {
      return `<tr style="background:#ef444408">
        <td class="mono" style="color:var(--red)">${f.factura_electronica}</td>
        <td style="color:var(--red);font-weight:500">⊘ ANULADA</td>
        <td>—</td><td class="mono" style="text-align:right;color:var(--text3)">0.00</td>
        <td class="mono" style="text-align:right;color:var(--text3)">0.00</td>
        <td class="mono" style="text-align:right;color:var(--text3)">0.00</td>
      </tr>`
    }
    return `<tr>
      <td class="mono" style="color:var(--gold)">${f.factura_electronica}</td>
      <td>${f.cliente}</td>
      <td class="mono" style="color:var(--text3)">${f.rtn && f.rtn !== 'null' && f.rtn !== 'NaN' ? f.rtn : '—'}</td>
      <td class="mono" style="text-align:right">${fmt(f.subtotal)}</td>
      <td class="mono" style="text-align:right">${fmt(f.impuestos)}</td>
      <td class="mono" style="text-align:right;font-weight:500">${fmt(f.total)}</td>
    </tr>`
  }).join('')

  // Add totals row (solo facturas reales, no anuladas)
  const reales = facturasConAnuladas.filter(f => !f.anulada)
  const totSub = reales.reduce((s, f) => s + f.subtotal, 0)
  const totISV = reales.reduce((s, f) => s + f.impuestos, 0)
  const totTotal = reales.reduce((s, f) => s + f.total, 0)
  const anuladas = facturasConAnuladas.filter(f => f.anulada).length
  tbody.innerHTML += `
    <tr style="background:var(--bg3);font-weight:500">
      <td colspan="3" style="text-align:right;padding:12px 18px;font-size:12px;color:var(--text3)">TOTALES (${reales.length} facturas${anuladas ? ', ' + anuladas + ' anulada' + (anuladas > 1 ? 's' : '') : ''})</td>
      <td class="mono" style="text-align:right;color:var(--gold)">${fmt(totSub)}</td>
      <td class="mono" style="text-align:right;color:var(--gold)">${fmt(totISV)}</td>
      <td class="mono" style="text-align:right;color:var(--gold)">${fmt(totTotal)}</td>
    </tr>`
}

function renderImportPartida() {
  const d = importData
  const tf = d.tecnimax_fiscal?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const ti = d.tecnimax_interno?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const yf = d.yonker_fiscal?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const yi = d.yonker_interno?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const granTotal = tf.total + ti.total + yf.total + yi.total

  const fmt = (v) => v.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const C = IMPORT_CUENTAS

  const lineas = [
    // DÉBITO — Caja General
    { codigo: C.caja_general.codigo, nombre: C.caja_general.nombre, centro: '—', debe: granTotal, haber: 0, fiscal: '—' },
    // CRÉDITOS FISCALES
    { codigo: C.venta_tecnimax.codigo, nombre: C.venta_tecnimax.nombre, centro: 'Tecnicentro', debe: 0, haber: tf.subtotal, fiscal: '✓' },
    { codigo: C.isv_ventas.codigo, nombre: C.isv_ventas.nombre, centro: '—', debe: 0, haber: tf.impuestos, fiscal: '✓' },
    { codigo: C.venta_yonker.codigo, nombre: C.venta_yonker.nombre, centro: 'Yonker', debe: 0, haber: yf.total, fiscal: '✓' },
    // CRÉDITOS INTERNOS
    { codigo: C.venta_tecnimax_int.codigo, nombre: C.venta_tecnimax_int.nombre, centro: 'Tecnicentro', debe: 0, haber: ti.subtotal, fiscal: '—' },
    { codigo: C.bono_tecnimax.codigo, nombre: C.bono_tecnimax.nombre, centro: 'Tecnicentro', debe: 0, haber: ti.impuestos, fiscal: '—' },
    { codigo: C.venta_yonker_int.codigo, nombre: C.venta_yonker_int.nombre, centro: 'Yonker', debe: 0, haber: yi.total, fiscal: '—' },
  ].filter(l => l.debe > 0 || l.haber > 0)

  const tbody = document.getElementById('tbody-import-partida')
  tbody.innerHTML = lineas.map(l => `
    <tr>
      <td><span class="mono" style="color:var(--gold);margin-right:8px">${l.codigo}</span>${l.nombre}</td>
      <td>${l.centro}</td>
      <td class="mono" style="text-align:right;color:${l.debe > 0 ? 'var(--text)' : 'var(--text3)'}">${l.debe > 0 ? fmt(l.debe) : ''}</td>
      <td class="mono" style="text-align:right;color:${l.haber > 0 ? 'var(--text)' : 'var(--text3)'}">${l.haber > 0 ? fmt(l.haber) : ''}</td>
      <td style="text-align:center;color:${l.fiscal === '✓' ? 'var(--green)' : 'var(--text3)'}">${l.fiscal}</td>
    </tr>`).join('')

  const totD = lineas.reduce((s, l) => s + l.debe, 0)
  const totC = lineas.reduce((s, l) => s + l.haber, 0)
  document.getElementById('imp-tot-d').textContent = fmt(totD)
  document.getElementById('imp-tot-c').textContent = fmt(totC)
}

window.resetImport = () => {
  importData = null
  importFiles = []
  document.getElementById('imp-files').value = ''
  document.getElementById('import-file-list').innerHTML = ''
  document.getElementById('import-zone').classList.remove('has-file')
  document.getElementById('btn-procesar-import').disabled = true
  document.getElementById('import-step1').classList.remove('hidden')
  document.getElementById('import-step2').classList.add('hidden')
  document.getElementById('import-step3').classList.add('hidden')
  document.getElementById('import-step4').classList.add('hidden')
}

window.guardarImportPartida = async () => {
  if (!importData) { toast('No hay datos procesados', 'error'); return }
  const fecha = document.getElementById('imp-fecha').value
  const descripcion = document.getElementById('imp-desc').value.trim() || `Ventas Alpha ${fecha}`
  if (!fecha) { toast('Selecciona la fecha de ventas', 'error'); return }

  const d = importData
  const tf = d.tecnimax_fiscal?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const ti = d.tecnimax_interno?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const yf = d.yonker_fiscal?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const yi = d.yonker_interno?.totales || { subtotal: 0, impuestos: 0, total: 0 }
  const C = IMPORT_CUENTAS

  // Buscar IDs de centro de costo
  const ccTecni = empresas.find(e => e.nombre.toLowerCase().includes('tecni') && !e.nombre.toLowerCase().includes('yonker'))
  const ccYonker = empresas.find(e => e.nombre.toLowerCase().includes('yonker'))

  // Cargar cuentas detalle si no están
  if (!cuentasDetalle.length) {
    const { data } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').eq('es_detalle', true).order('codigo')
    cuentasDetalle = data || []
  }

  const getCuenta = (codigo) => cuentasDetalle.find(c => c.codigo === codigo)

  // Preparar líneas de CRÉDITO (automáticas de la importación)
  const creditosRaw = [
    { cuenta: C.venta_tecnimax, monto: tf.subtotal, cc: ccTecni?.id || '', fiscal: true },
    { cuenta: C.isv_ventas, monto: tf.impuestos, cc: '', fiscal: true },
    { cuenta: C.venta_yonker, monto: yf.total, cc: ccYonker?.id || '', fiscal: true },
    { cuenta: C.venta_tecnimax_int, monto: ti.subtotal, cc: ccTecni?.id || '', fiscal: false },
    { cuenta: C.bono_tecnimax, monto: ti.impuestos, cc: ccTecni?.id || '', fiscal: false },
    { cuenta: C.venta_yonker_int, monto: yi.total, cc: ccYonker?.id || '', fiscal: false },
  ].filter(l => l.monto > 0)

  // Navegar al formulario de nueva partida
  editingPartidaId = null
  showView('partida-nueva', 'Nueva partida · Ventas Alpha')

  // Esperar a que el formulario cargue
  await new Promise(r => setTimeout(r, 300))

  // Llenar encabezado
  document.getElementById('pn-fecha').value = fecha
  document.getElementById('pn-descripcion').value = descripcion
  document.getElementById('pn-origen').value = 'venta_alpha'
  document.getElementById('pn-documento').value = ''

  // Limpiar líneas actuales y crear las de crédito + líneas vacías para débitos
  partidaLineas = []
  lineaCounter = 0

  // Agregar 2 líneas vacías para débitos (el usuario las llena manualmente)
  lineaCounter++
  partidaLineas.push({ id: lineaCounter, cuenta_id:'', cuenta_codigo:'', cuenta_nombre:'', tipo:'debito', monto:0, centro_costo_id:'', descripcion:'', aplica_fiscal:true })
  lineaCounter++
  partidaLineas.push({ id: lineaCounter, cuenta_id:'', cuenta_codigo:'', cuenta_nombre:'', tipo:'debito', monto:0, centro_costo_id:'', descripcion:'', aplica_fiscal:true })

  // Agregar líneas de crédito pre-llenadas
  for (const cr of creditosRaw) {
    lineaCounter++
    const cta = getCuenta(cr.cuenta.codigo)
    partidaLineas.push({
      id: lineaCounter,
      cuenta_id: cta?.id || '',
      cuenta_codigo: cr.cuenta.codigo,
      cuenta_nombre: cr.cuenta.nombre,
      tipo: 'credito',
      monto: Math.round(cr.monto * 100) / 100,
      centro_costo_id: cr.cc,
      descripcion: '',
      aplica_fiscal: cr.fiscal
    })
  }

  renderLineas()
  calcTotales()

  // Guardar datos fiscales para insertar en libro_ventas al guardar la partida
  window._importVentasData = {
    tecnimax_fiscal: d.tecnimax_fiscal,
    yonker_fiscal: d.yonker_fiscal,
    fecha,
    ccTecniId: ccTecni?.id || null,
    ccYonkerId: ccYonker?.id || null,
  }

  toast('Créditos cargados. Completá los débitos con las formas de pago.', 'info')
}
// ══════════════════════════════════════════════
// ── CONTEO DE BILLETES (DENOMINACIONES)
// ══════════════════════════════════════════════

const DENOMINACIONES = [1, 2, 5, 10, 20, 50, 100, 200, 500]
let billetesCallback = null
let billetesConteo = {}

function openBilletes(titulo, subtitulo, callback) {
  billetesCallback = callback
  billetesConteo = {}
  DENOMINACIONES.forEach(d => billetesConteo[d] = 0)
  document.getElementById('billetes-title').textContent = titulo || '💵 Conteo de billetes'
  document.getElementById('billetes-sub').textContent = subtitulo || 'Ingresa la cantidad de cada denominación'
  renderBilletes()
  document.getElementById('modal-billetes').classList.add('open')
  // Focus first input after render
  setTimeout(() => {
    const first = document.querySelector('#tbody-billetes input')
    if (first) first.focus()
  }, 200)
}

function renderBilletes() {
  const tbody = document.getElementById('tbody-billetes')
  tbody.innerHTML = DENOMINACIONES.slice().reverse().map(d => {
    const qty = billetesConteo[d] || 0
    const sub = qty * d
    return `<tr>
      <td style="padding:8px 12px">
        <span style="font-family:var(--mono);font-size:15px;color:var(--text);font-weight:500">L. ${d.toLocaleString('es-HN')}</span>
      </td>
      <td style="padding:8px 12px;text-align:center">
        <input type="text" inputmode="numeric" pattern="[0-9]*" value="${qty || ''}" placeholder="0" data-denom="${d}"
          oninput="updBillete(${d},this.value)" onfocus="this.select()"
          style="width:70px;text-align:center;background:var(--bg3);border:0.5px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-family:var(--mono);font-size:15px;outline:none">
      </td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--mono);font-size:14px;min-width:120px" id="bill-sub-${d}">
        ${sub > 0 ? '<span style="color:var(--green)">L. ' + sub.toLocaleString('es-HN', {minimumFractionDigits:2}) + '</span>' : '<span style="color:var(--text3)">—</span>'}
      </td>
    </tr>`
  }).join('')
  updateBilletesTotal()
}

window.updBillete = (denom, val) => {
  billetesConteo[denom] = parseInt(val) || 0
  const sub = billetesConteo[denom] * denom
  // Actualizar subtotal de esta fila
  const subEl = document.getElementById('bill-sub-' + denom)
  if (subEl) {
    subEl.innerHTML = sub > 0 ? '<span style="color:var(--green)">L. ' + sub.toLocaleString('es-HN', {minimumFractionDigits:2}) + '</span>' : '<span style="color:var(--text3)">—</span>'
  }
  updateBilletesTotal()
}

function updateBilletesTotal() {
  let totalQty = 0, totalMonto = 0
  DENOMINACIONES.forEach(d => {
    totalQty += billetesConteo[d] || 0
    totalMonto += (billetesConteo[d] || 0) * d
  })
  document.getElementById('bill-total-qty').textContent = totalQty
  document.getElementById('bill-total-monto').textContent = 'L. ' + totalMonto.toLocaleString('es-HN', { minimumFractionDigits: 2 })
}

window.cancelBilletes = () => {
  billetesCallback = null
  document.getElementById('modal-billetes').classList.remove('open')
}

window.aplicarBilletes = () => {
  let totalMonto = 0
  DENOMINACIONES.forEach(d => totalMonto += (billetesConteo[d] || 0) * d)
  if (billetesCallback) {
    billetesCallback(totalMonto, { ...billetesConteo })
  }
  document.getElementById('modal-billetes').classList.remove('open')
  billetesCallback = null
}

// ── Conectar con celdas Debe/Haber de Caja General ──
window.openCajaDebe = (lineaId) => {
  openBilletes('💵 Ingreso a Caja General', 'Contá los billetes que entran a caja', (monto, detalle) => {
    const l = partidaLineas.find(x => x.id === lineaId)
    if (l) { l.tipo = 'debito'; l.monto = monto; l.billetes = detalle }
    renderLineas()
    calcTotales()
  })
}

window.openCajaHaber = (lineaId) => {
  openBilletes('💵 Egreso de Caja General', 'Contá los billetes que salen de caja', (monto, detalle) => {
    const l = partidaLineas.find(x => x.id === lineaId)
    if (l) { l.tipo = 'credito'; l.monto = monto; l.billetes = detalle }
    renderLineas()
    calcTotales()
  })
}

// ── ARQUEO DE CAJA ──
window.verArqueo = async () => {
  // Cargar todos los conteos de billetes
  const { data: conteos, error } = await sb.from('conteo_billetes').select('*')
  if (error) { toast('Error al cargar arqueo: ' + error.message, 'error'); return }

  const denoms = [500, 200, 100, 50, 20, 10, 5, 2, 1]
  const tbody = document.getElementById('tbody-arqueo')

  let totIng = 0, totEgr = 0, totCaja = 0, totValor = 0

  tbody.innerHTML = denoms.map(d => {
    const ingresos = (conteos || []).filter(c => c.tipo === 'ingreso').reduce((s, c) => s + (c[`den_${d}`] || 0), 0)
    const egresos = (conteos || []).filter(c => c.tipo === 'egreso').reduce((s, c) => s + (c[`den_${d}`] || 0), 0)
    const enCaja = ingresos - egresos
    const valor = enCaja * d

    totIng += ingresos
    totEgr += egresos
    totCaja += enCaja
    totValor += valor

    return `<tr>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:14px;font-weight:500">L. ${d.toLocaleString('es-HN')}</td>
      <td style="padding:8px 12px;text-align:center;font-family:var(--mono);color:var(--green)">${ingresos || '—'}</td>
      <td style="padding:8px 12px;text-align:center;font-family:var(--mono);color:var(--red)">${egresos || '—'}</td>
      <td style="padding:8px 12px;text-align:center;font-family:var(--mono);font-weight:500;color:${enCaja >= 0 ? 'var(--text)' : 'var(--red)'}">${enCaja}</td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--mono);font-size:13px;color:${valor >= 0 ? 'var(--green)' : 'var(--red)'}">L. ${valor.toLocaleString('es-HN', {minimumFractionDigits:2})}</td>
    </tr>`
  }).join('')

  document.getElementById('arq-tot-ing').textContent = totIng
  document.getElementById('arq-tot-egr').textContent = totEgr
  document.getElementById('arq-tot-caja').textContent = totCaja
  document.getElementById('arq-tot-valor').textContent = 'L. ' + totValor.toLocaleString('es-HN', { minimumFractionDigits: 2 })

  document.getElementById('modal-arqueo').classList.add('open')
}

// ══════════════════════════════════════════════
// ── IMPORTAR COMPRAS ALPHA (XLS MENSUAL)
// ══════════════════════════════════════════════

const COMPRAS_CUENTAS = {
  inventario: { codigo: '110501-001', nombre: 'INVENTARIO PARA LA VENTA BODEGA PRINCIPAL' },
  iva_compras: { codigo: '110402-001', nombre: 'IVA S/COMPRAS NACIONALES' },
}

// Mapeo de proveedores del Excel → subcuenta 210101-XXX
// Usa matching fuzzy: normaliza el nombre, quita puntuación, y busca coincidencia
const PROVEEDORES_MAP = {
  'AUTOMUNDO':                  { codigo: '210101-001', nombre: 'AUTOMUNDO' },
  'REPUESTOS SAN MIGUEL':       { codigo: '210101-002', nombre: 'REPUESTOS SAN MIGUEL' },
  'JC REPUESTOS':               { codigo: '210101-003', nombre: 'JC REPUESTOS' },
  'CEMCOL COMERCIAL':           { codigo: '210101-004', nombre: 'CEMCOL COMERCIAL' },
  'CIA AFILIADAS':              { codigo: '210101-005', nombre: 'Cia. Afiliadas y Relacionadas.' },
  'REASA':                      { codigo: '210101-006', nombre: 'REASA' },
  'AUTOEXCEL':                  { codigo: '210101-007', nombre: 'AUTOEXCEL' },
  'REPACAR':                    { codigo: '210101-008', nombre: 'REPACAR' },
  'EL ESFUERZO COMERCIAL':      { codigo: '210101-009', nombre: 'EL ESFUERZO COMERCIAL' },
  'REYSA':                      { codigo: '210101-010', nombre: 'REYSA, S.A DE C.V' },
  'CORPORACION FLORES':         { codigo: '210101-011', nombre: 'CORPORACION FLORES' },
  'ALFHA REPUESTOS':            { codigo: '210101-012', nombre: 'ALFHA REPUESTOS' },
  'GRUPO Q HONDURAS':           { codigo: '210101-013', nombre: 'GRUPO Q HONDURAS' },
  'ACAVISA':                    { codigo: '210101-014', nombre: 'ACAVISA HONDURAS S.A' },
  'COMERCIAL PECAS':            { codigo: '210101-016', nombre: 'COMERCIAL PECAS' },
  'ALLAS':                      { codigo: '210101-017', nombre: 'ALLAS' },
  'SUPER REPUESTOS':            { codigo: '210101-018', nombre: 'SUPER REPUESTOS' },
  'CIREMA':                     { codigo: '210101-019', nombre: 'CIREMA' },
  'MAGNESEL':                   { codigo: '210101-020', nombre: 'MAGNESEL, S DE R. L.' },
  'PREMIUM AUTO PARTS':         { codigo: '210101-021', nombre: 'PREMIUM AUTO PARTS' },
  'INVERSIONES J Y R':          { codigo: '210101-022', nombre: 'INVERSIONES J Y R' },
  'IMPRESA REPUESTOS':          { codigo: '210101-023', nombre: 'IMPRESA REPUESTOS' },
  'IMPRESSA REPUESTOS':         { codigo: '210101-023', nombre: 'IMPRESA REPUESTOS' },
  'SOL Y CAR':                  { codigo: '210101-024', nombre: 'SOL Y CAR KASHIMA' },
  'SOL CAR':                    { codigo: '210101-024', nombre: 'SOL Y CAR KASHIMA' },
  'LLANTICENTRO FENIX':         { codigo: '210101-025', nombre: 'LLANTICENTRO FENIX' },
  'SUPERCAR':                   { codigo: '210101-026', nombre: 'SUPERCAR, S.A DE C.V' },
  'EMPRESA DE SEGURIDAD':       { codigo: '210101-027', nombre: 'EMPRESA DE SEGURIDAD PRIVADA (DAR)' },
  'OTROS PROVEEDORES':          { codigo: '210101-028', nombre: 'OTROS PROVEEDORES X PAGAR' },
  'BARJUM':                     { codigo: '210101-029', nombre: 'Barjum' },
  'BARJUN':                     { codigo: '210101-029', nombre: 'Barjum' },
}

let icFile = null
let icData = null // { credito: [...], contado: [...] }
let icProviderFilter = 'todos'

function normalizeProvName(name) {
  return (name || '').toUpperCase()
    .replace(/[.,\-_&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.{2,}/g, '')
}

function matchProveedor(excelName) {
  const norm = normalizeProvName(excelName)
  // Exact match first
  for (const [key, val] of Object.entries(PROVEEDORES_MAP)) {
    if (norm === key || norm.startsWith(key) || key.startsWith(norm)) return val
  }
  // Fuzzy: check if any key is contained in the name or vice versa
  for (const [key, val] of Object.entries(PROVEEDORES_MAP)) {
    const normKey = normalizeProvName(key)
    if (norm.includes(normKey) || normKey.includes(norm)) return val
  }
  // Partial word match (at least first 4 chars of first word)
  const firstWord = norm.split(' ')[0]
  if (firstWord.length >= 4) {
    for (const [key, val] of Object.entries(PROVEEDORES_MAP)) {
      const keyFirst = normalizeProvName(key).split(' ')[0]
      if (firstWord === keyFirst) return val
      if (firstWord.length >= 5 && keyFirst.startsWith(firstWord.substring(0, 5))) return val
    }
  }
  return null
}

function parseComprasSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName]
  if (!ws) return []
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  const facturas = []
  let i = 0
  while (i < data.length) {
    const row = data[i]
    if (!row) { i++; continue }

    const fecha = String(row[0] || '').trim()
    // Una fila de factura empieza con fecha dd-mm-yyyy
    if (!/^\d{2}-\d{2}-\d{4}$/.test(fecha)) { i++; continue }

    const noConsecutivo = String(row[1] || '').trim()
    const noFactura = String(row[2] || '').trim()
    const cedJuridica = String(row[4] || '').trim()
    const proveedor = String(row[5] || '').trim()
    const items = parseInt(row[6]) || 1
    const subtotal = parseFloat(row[11]) || 0
    const descuento = parseFloat(row[12]) || 0
    const isv = parseFloat(row[13]) || 0
    const total = parseFloat(row[14]) || 0

    // Saltar fila de totales al final
    if (proveedor === '' && noFactura === '' && noConsecutivo === '') { i++; continue }

    // Leer filas de detalle de productos
    const productos = []
    let j = i + 1
    // Saltar fila "Cabys" header
    if (j < data.length && String(data[j]?.[0] || '').trim().toLowerCase() === 'cabys') {
      j++
    }
    // Leer filas de producto (empiezan con NaN/vacío en col 0)
    while (j < data.length) {
      const pRow = data[j]
      if (!pRow) { j++; continue }
      const pFecha = String(pRow[0] || '').trim()
      // Si es otra fecha o "Total HNL" => ya no es detalle
      if (/^\d{2}-\d{2}-\d{4}$/.test(pFecha)) break
      if (pFecha.toLowerCase().includes('total')) break
      if (pFecha.toLowerCase() === 'cabys') break
      // Si la primera col es vacía o NaN, es detalle
      if (pFecha === '' || pFecha === 'NaN' || pFecha === 'null' || !pFecha) {
        const codigo = String(pRow[1] || '').trim()
        const nombre = String(pRow[4] || '').trim()
        const cantidad = parseFloat(pRow[7]) || 0
        const costo = parseFloat(pRow[11]) || 0
        if (nombre || codigo) {
          productos.push({ codigo, nombre, cantidad, costo })
        }
      }
      j++
    }

    facturas.push({
      fecha,
      no_consecutivo: noConsecutivo,
      no_factura: noFactura,
      ced_juridica: cedJuridica,
      proveedor,
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      descuento: Math.round(descuento * 100) / 100,
      isv: Math.round(isv * 100) / 100,
      total: Math.round(total * 100) / 100,
      productos,
      // Matching de proveedor
      cuenta_proveedor: matchProveedor(proveedor),
      duplicada: false,
    })

    i = j
  }

  return facturas
}

function initImportCompras() {
  // Default: mes actual
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  document.getElementById('ic-periodo').value = `${yyyy}-${mm}`

  // Poblar centros de costo
  const sel = document.getElementById('ic-centro')
  sel.innerHTML = '<option value="">— Seleccionar —</option>'
  empresas.forEach(e => {
    sel.innerHTML += `<option value="${e.id}">${e.nombre}</option>`
  })
  // Default: Tecnicentro si existe
  const tecni = empresas.find(e => e.nombre.toLowerCase().includes('tecni') && !e.nombre.toLowerCase().includes('yonker'))
  if (tecni) sel.value = tecni.id

  resetImportCompras()
  document.getElementById('ic-step1').classList.remove('hidden')
}

window.onImportComprasFile = (input) => {
  icFile = input.files?.[0] || null
  const info = document.getElementById('ic-file-info')
  if (!icFile) { info.innerHTML = ''; return }
  info.innerHTML = `
    <div class="imp-file-item">
      <span class="imp-file-icon">📦</span>
      <span class="imp-file-name">${icFile.name}</span>
      <span style="font-size:11px;color:var(--text3)">${(icFile.size/1024).toFixed(0)} KB</span>
    </div>`
  document.getElementById('ic-zone').classList.add('has-file')
  document.getElementById('btn-procesar-compras').disabled = false
}

window.resetImportCompras = () => {
  icData = null
  icFile = null
  icProviderFilter = 'todos'
  const fileInput = document.getElementById('ic-file')
  if (fileInput) fileInput.value = ''
  document.getElementById('ic-file-info').innerHTML = ''
  const zone = document.getElementById('ic-zone')
  if (zone) zone.classList.remove('has-file')
  const btn = document.getElementById('btn-procesar-compras')
  if (btn) btn.disabled = true
  ;['ic-step1','ic-step2','ic-step3','ic-step4','ic-step5','ic-step6'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden')
  })
  document.getElementById('ic-step1')?.classList.remove('hidden')
}

window.procesarImportCompras = async () => {
  if (!icFile) { toast('Selecciona un archivo XLS', 'error'); return }
  const btn = document.getElementById('btn-procesar-compras')
  btn.disabled = true
  btn.textContent = 'Procesando...'

  try {
    const arrayBuffer = await icFile.arrayBuffer()
    const wb = XLSX.read(arrayBuffer, { type: 'array' })

    const sheetNames = wb.SheetNames.map(s => s.trim())
    const creditoSheet = sheetNames.find(s => s.toLowerCase().includes('cr') && s.toLowerCase().includes('dito'))
      || sheetNames.find(s => s.toLowerCase().includes('credito'))
      || sheetNames.find(s => s.toLowerCase().includes('crédito'))
    const contadoSheet = sheetNames.find(s => s.toLowerCase().includes('contado'))

    if (!creditoSheet && !contadoSheet) {
      toast('No se encontraron hojas "Compras Crédito" ni "Compras Contado" en el archivo', 'error')
      btn.disabled = false; btn.textContent = 'Procesar reporte →'
      return
    }

    const credito = creditoSheet ? parseComprasSheet(wb, creditoSheet) : []
    const contado = contadoSheet ? parseComprasSheet(wb, contadoSheet) : []

    // Verificar duplicados contra partidas existentes en BD (crédito)
    const allNumsCredito = credito.map(f => f.no_factura).filter(n => n && n !== 'S/F')
    if (allNumsCredito.length) {
      const { data: existentes } = await sb.from('partidas_contables')
        .select('numero_documento')
        .in('numero_documento', allNumsCredito)
      const existSet = new Set((existentes || []).map(e => e.numero_documento))
      credito.forEach(f => { if (existSet.has(f.no_factura)) f.duplicada = true })
    }

    // Verificar duplicados contra facturas_compras (contado)
    const allNumsContado = contado.map(f => f.no_factura).filter(n => n && n !== 'S/F')
    if (allNumsContado.length) {
      const { data: existentes2 } = await sb.from('facturas_compras')
        .select('numero_factura')
        .in('numero_factura', allNumsContado)
      const existSet2 = new Set((existentes2 || []).map(e => e.numero_factura))
      contado.forEach(f => { if (existSet2.has(f.no_factura)) f.duplicada = true })
    }

    icData = { credito, contado }
    renderImportComprasResults()

  } catch (err) {
    toast('Error al procesar: ' + err.message, 'error')
    console.error(err)
  }

  btn.disabled = false
  btn.textContent = 'Procesar reporte →'
}

function renderImportComprasResults() {
  const d = icData
  if (!d) return

  const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })

  // Alertas
  const alertas = []
  const sinMatch = d.credito.filter(f => !f.cuenta_proveedor && !f.duplicada)
  if (sinMatch.length) {
    alertas.push({ tipo: 'warn', msg: `${sinMatch.length} factura(s) de crédito sin proveedor mapeado: ${[...new Set(sinMatch.map(f => f.proveedor))].join(', ')}. Se asignarán a OTROS PROVEEDORES X PAGAR (210101-028).` })
  }
  const dupsCredito = d.credito.filter(f => f.duplicada)
  const dupsContado = d.contado.filter(f => f.duplicada)
  if (dupsCredito.length || dupsContado.length) {
    alertas.push({ tipo: 'info', msg: `${dupsCredito.length + dupsContado.length} factura(s) ya registrada(s) en el sistema — se omitirán.` })
  }
  const sinFactura = [...d.credito, ...d.contado].filter(f => f.no_factura === 'S/F' || !f.no_factura)
  if (sinFactura.length) {
    alertas.push({ tipo: 'warn', msg: `${sinFactura.length} factura(s) sin número de factura (S/F).` })
  }

  document.getElementById('ic-alertas').innerHTML = alertas.map(a => `
    <div style="padding:10px 14px;border-radius:var(--radius);margin-bottom:8px;font-size:13px;line-height:1.5;
      background:${a.tipo === 'warn' ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)'};
      border-left:3px solid ${a.tipo === 'warn' ? 'var(--amber)' : 'var(--blue)'};
      color:${a.tipo === 'warn' ? 'var(--amber)' : 'var(--blue)'}">
      ${a.tipo === 'warn' ? '⚠️' : 'ℹ️'} ${a.msg}
    </div>`).join('')

  // Resumen
  const credValid = d.credito.filter(f => !f.duplicada)
  const contValid = d.contado.filter(f => !f.duplicada)
  const credTot = credValid.reduce((s, f) => s + f.total, 0)
  const contTot = contValid.reduce((s, f) => s + f.total, 0)

  document.getElementById('ic-resumen').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
      <div class="stat-card"><div class="stat-num" style="color:var(--green)">${credValid.length}</div><div class="stat-label"><span class="stat-dot" style="background:var(--green)"></span>Crédito</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--amber)">${contValid.length}</div><div class="stat-label"><span class="stat-dot" style="background:var(--amber)"></span>Contado</div></div>
      <div class="stat-card"><div class="stat-num">L. ${fmt(credTot)}</div><div class="stat-label"><span class="stat-dot" style="background:var(--green)"></span>Total crédito</div></div>
      <div class="stat-card"><div class="stat-num">L. ${fmt(contTot)}</div><div class="stat-label"><span class="stat-dot" style="background:var(--amber)"></span>Total contado</div></div>
    </div>`

  // Show steps 2-5
  document.getElementById('ic-step1').classList.add('hidden')
  document.getElementById('ic-step2').classList.remove('hidden')
  document.getElementById('ic-step3').classList.remove('hidden')
  document.getElementById('ic-step4').classList.remove('hidden')
  document.getElementById('ic-step5').classList.remove('hidden')

  // Render tables
  renderCreditoTable()
  renderContadoTable()
  renderComprasPreview()
}

function renderCreditoTable() {
  const d = icData
  if (!d) return
  const facturas = icProviderFilter === 'todos'
    ? d.credito
    : d.credito.filter(f => normalizeProvName(f.proveedor).includes(normalizeProvName(icProviderFilter)))

  const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const fallback = { codigo: '210101-028', nombre: 'OTROS PROVEEDORES X PAGAR' }

  // Provider tabs
  const proveedores = [...new Set(d.credito.map(f => f.proveedor))].sort()
  document.getElementById('ic-provider-tabs').innerHTML = `
    <button class="btn btn-ghost" style="padding:5px 10px;font-size:11px;${icProviderFilter === 'todos' ? 'border-color:var(--gold);color:var(--gold)' : ''}" onclick="icFilterProvider('todos')">Todos (${d.credito.length})</button>
    ${proveedores.map(p => {
      const count = d.credito.filter(f => f.proveedor === p).length
      const active = icProviderFilter === p
      return `<button class="btn btn-ghost" style="padding:5px 10px;font-size:11px;${active ? 'border-color:var(--gold);color:var(--gold)' : ''}" onclick="icFilterProvider('${p.replace(/'/g, "\\'")}')">${p} (${count})</button>`
    }).join('')}`

  document.getElementById('ic-credito-count').textContent = `${facturas.length} facturas`

  const tbody = document.getElementById('tbody-ic-credito')
  tbody.innerHTML = facturas.map(f => {
    const match = f.cuenta_proveedor || fallback
    const isDup = f.duplicada
    return `<tr style="${isDup ? 'opacity:0.4;text-decoration:line-through' : ''}">
      <td style="font-size:12px">${f.fecha}</td>
      <td style="font-family:var(--mono);font-size:12px">${f.no_factura}</td>
      <td style="font-size:12px">${f.proveedor}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(f.subtotal)}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(f.isv)}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:500">${fmt(f.total)}</td>
      <td style="font-size:11px"><span style="color:var(--gold);margin-right:4px">${match.codigo}</span>${!f.cuenta_proveedor ? '<span style="color:var(--amber)">⚠</span>' : ''}</td>
      <td style="text-align:center">${isDup ? '<span style="color:var(--red)">✕</span>' : '<span style="color:var(--green)">✓</span>'}</td>
    </tr>`
  }).join('')

  const valid = facturas.filter(f => !f.duplicada)
  document.getElementById('ic-cred-subtotal').textContent = fmt(valid.reduce((s, f) => s + f.subtotal, 0))
  document.getElementById('ic-cred-isv').textContent = fmt(valid.reduce((s, f) => s + f.isv, 0))
  document.getElementById('ic-cred-total').textContent = fmt(valid.reduce((s, f) => s + f.total, 0))
}

window.icFilterProvider = (p) => {
  icProviderFilter = p
  renderCreditoTable()
}

function renderContadoTable() {
  const d = icData
  if (!d) return
  const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })

  document.getElementById('ic-contado-count').textContent = `${d.contado.length} facturas`

  const tbody = document.getElementById('tbody-ic-contado')
  tbody.innerHTML = d.contado.map(f => {
    const isDup = f.duplicada
    return `<tr style="${isDup ? 'opacity:0.4;text-decoration:line-through' : ''}">
      <td style="font-size:12px">${f.fecha}</td>
      <td style="font-family:var(--mono);font-size:12px">${f.no_factura}</td>
      <td style="font-size:12px">${f.proveedor}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(f.subtotal)}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(f.isv)}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:500">${fmt(f.total)}</td>
    </tr>`
  }).join('')

  const valid = d.contado.filter(f => !f.duplicada)
  document.getElementById('ic-con-subtotal').textContent = fmt(valid.reduce((s, f) => s + f.subtotal, 0))
  document.getElementById('ic-con-isv').textContent = fmt(valid.reduce((s, f) => s + f.isv, 0))
  document.getElementById('ic-con-total').textContent = fmt(valid.reduce((s, f) => s + f.total, 0))
}

function renderComprasPreview() {
  const d = icData
  if (!d) return
  const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const fallback = { codigo: '210101-028', nombre: 'OTROS PROVEEDORES X PAGAR' }

  const credValid = d.credito.filter(f => !f.duplicada)
  const contValid = d.contado.filter(f => !f.duplicada)
  const dupsTotal = d.credito.filter(f => f.duplicada).length + d.contado.filter(f => f.duplicada).length

  document.getElementById('ic-total-credito-partidas').textContent = credValid.length
  document.getElementById('ic-total-contado-partidas').textContent = contValid.length
  document.getElementById('ic-total-duplicados').textContent = dupsTotal

  // Preview: agrupar créditos por proveedor para mostrar resumen de partidas
  const porProveedor = {}
  credValid.forEach(f => {
    const match = f.cuenta_proveedor || fallback
    const key = match.codigo
    if (!porProveedor[key]) porProveedor[key] = { cuenta: match, facturas: 0, subtotal: 0, isv: 0, total: 0 }
    porProveedor[key].facturas++
    porProveedor[key].subtotal += f.subtotal
    porProveedor[key].isv += f.isv
    porProveedor[key].total += f.total
  })

  const resumen = Object.values(porProveedor).sort((a, b) => b.total - a.total)
  document.getElementById('ic-preview-partidas').innerHTML = `
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;font-weight:500">Resumen de partidas a generar (crédito)</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Cada factura de crédito genera una partida: Deb Inventario + Deb IVA / Cred Proveedor</div>
    <div class="table-wrap" style="max-height:300px;overflow-y:auto">
      <table>
        <thead><tr>
          <th>Cuenta proveedor</th><th style="text-align:center">Facturas</th>
          <th style="text-align:right">Subtotal</th><th style="text-align:right">ISV</th><th style="text-align:right">Total</th>
        </tr></thead>
        <tbody>${resumen.map(r => `
          <tr>
            <td><span class="mono" style="color:var(--gold);margin-right:6px">${r.cuenta.codigo}</span>${r.cuenta.nombre}</td>
            <td style="text-align:center;font-family:var(--mono)">${r.facturas}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(r.subtotal)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(r.isv)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:500">${fmt(r.total)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr style="background:var(--bg3)">
            <td style="text-align:right;padding:12px 18px;font-size:12px;font-weight:500;color:var(--text3)">TOTAL</td>
            <td style="text-align:center;font-family:var(--mono);font-weight:500">${credValid.length}</td>
            <td style="text-align:right;font-family:var(--mono);font-weight:500;color:var(--gold)">${fmt(resumen.reduce((s, r) => s + r.subtotal, 0))}</td>
            <td style="text-align:right;font-family:var(--mono);font-weight:500;color:var(--gold)">${fmt(resumen.reduce((s, r) => s + r.isv, 0))}</td>
            <td style="text-align:right;font-family:var(--mono);font-weight:500;color:var(--gold)">${fmt(resumen.reduce((s, r) => s + r.total, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>`
}

window.guardarImportCompras = async () => {
  if (!icData) { toast('No hay datos procesados', 'error'); return }

  const periodo = document.getElementById('ic-periodo').value
  const centroCostoId = document.getElementById('ic-centro').value
  if (!periodo) { toast('Selecciona el período', 'error'); return }
  if (!centroCostoId) { toast('Selecciona el centro de costo', 'error'); return }

  const btn = document.getElementById('btn-guardar-compras')
  btn.disabled = true
  btn.textContent = 'Guardando...'

  const fallback = { codigo: '210101-028', nombre: 'OTROS PROVEEDORES X PAGAR' }

  // Cargar cuentas detalle si no están
  if (!cuentasDetalle.length) {
    const { data } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').eq('es_detalle', true).order('codigo')
    cuentasDetalle = data || []
  }
  const getCuenta = (codigo) => cuentasDetalle.find(c => c.codigo === codigo)

  const credValid = icData.credito.filter(f => !f.duplicada)
  let creadas = 0
  let errores = 0
  const log = []

  for (const factura of credValid) {
    const match = factura.cuenta_proveedor || fallback
    const ctaInventario = getCuenta(COMPRAS_CUENTAS.inventario.codigo)
    const ctaIva = getCuenta(COMPRAS_CUENTAS.iva_compras.codigo)
    const ctaProveedor = getCuenta(match.codigo)

    // Convertir fecha dd-mm-yyyy a yyyy-mm-dd
    const partes = factura.fecha.split('-')
    const fechaISO = `${partes[2]}-${partes[1]}-${partes[0]}`

    const productosDesc = factura.productos.map(p => p.nombre).filter(Boolean).join(', ')
    const descripcion = `${factura.proveedor} · ${productosDesc || 'Sin detalle'} [IMP-COMPRA]`

    // Crear partida
    const { data: partida, error: errP } = await sb.from('partidas_contables').insert({
      centro_costo_id: centroCostoId,
      generada_por: currentProfile.id,
      tipo_origen: 'compra',
      descripcion: descripcion,
      fecha_partida: fechaISO,
      numero_documento: factura.no_factura !== 'S/F' ? factura.no_factura : null,
      estado: 'aprobada',
      total: Math.round(factura.total * 100) / 100,
    }).select().single()

    if (errP) {
      errores++
      log.push(`<span style="color:var(--red)">✕</span> ${factura.no_factura} · ${factura.proveedor}: ${errP.message}`)
      continue
    }

    // Crear líneas: Deb Inventario + Deb IVA + Cred Proveedor
    const lineas = []
    const numDoc = factura.no_factura !== 'S/F' ? factura.no_factura : null
    const esFiscal = numDoc !== null  // S/F no aplica fiscal

    // Débito: Inventario
    if (factura.subtotal > 0) {
      lineas.push({
        partida_id: partida.id,
        cuenta_id: ctaInventario?.id || null,
        cuenta_codigo: COMPRAS_CUENTAS.inventario.codigo,
        cuenta_nombre: COMPRAS_CUENTAS.inventario.nombre,
        tipo: 'debito',
        monto: Math.round(factura.subtotal * 100) / 100,
        centro_costo_id: centroCostoId,
        descripcion: productosDesc.substring(0, 250),
        numero_documento: numDoc,
        aplica_fiscal: esFiscal,
      })
    }

    // Débito: IVA
    if (factura.isv > 0) {
      lineas.push({
        partida_id: partida.id,
        cuenta_id: ctaIva?.id || null,
        cuenta_codigo: COMPRAS_CUENTAS.iva_compras.codigo,
        cuenta_nombre: COMPRAS_CUENTAS.iva_compras.nombre,
        tipo: 'debito',
        monto: Math.round(factura.isv * 100) / 100,
        centro_costo_id: centroCostoId,
        descripcion: productosDesc.substring(0, 250),
        numero_documento: numDoc,
        aplica_fiscal: esFiscal,
      })
    }

    // Crédito: Proveedor — SIN centro de costo (pasivo corporativo)
    lineas.push({
      partida_id: partida.id,
      cuenta_id: ctaProveedor?.id || null,
      cuenta_codigo: match.codigo,
      cuenta_nombre: match.nombre,
      tipo: 'credito',
      monto: Math.round(factura.total * 100) / 100,
      centro_costo_id: null,
      descripcion: productosDesc.substring(0, 250),
      numero_documento: numDoc,
      aplica_fiscal: esFiscal,
    })

    const { error: errL } = await sb.from('lineas_partida').insert(lineas)
    if (errL) {
      errores++
      log.push(`<span style="color:var(--red)">✕</span> ${factura.no_factura} líneas: ${errL.message}`)
      // Eliminar partida huérfana
      await sb.from('partidas_contables').delete().eq('id', partida.id)
      continue
    }

    creadas++
    log.push(`<span style="color:var(--green)">✓</span> <span class="mono" style="color:var(--gold)">${factura.no_factura}</span> · ${factura.proveedor} · L. ${factura.total.toLocaleString('es-HN', {minimumFractionDigits:2})} → <span class="mono">${match.codigo}</span>`)

    // Insertar en libro_compras (solo facturas con número = fiscales)
    if (esFiscal) {
      await sb.from('libro_compras').insert({
        centro_costo_id: centroCostoId,
        fecha: fechaISO,
        numero_factura: factura.no_factura,
        numero_documento: factura.no_factura,
        proveedor: factura.proveedor,
        rtn_proveedor: factura.ced_juridica || '',
        cuenta_proveedor: match.codigo,
        subtotal: Math.round(factura.subtotal * 100) / 100,
        isv: Math.round(factura.isv * 100) / 100,
        total: Math.round(factura.total * 100) / 100,
        forma_pago: 'credito',
        productos: productosDesc.substring(0, 250),
        incluir_fiscal: true,
        origen: 'import_alpha',
        partida_id: partida.id,
      })
    }

    // Registrar en facturas_compras como contabilizada (pendiente de recibir documento)
    await sb.from('facturas_compras').insert({
      centro_costo_id: centroCostoId,
      registrado_por: currentProfile.id,
      numero_factura: factura.no_factura !== 'S/F' ? factura.no_factura : `SF-${factura.no_consecutivo}`,
      fecha_factura: fechaISO,
      tipo_gasto: 'repuestos',
      forma_pago: 'credito',
      subtotal: Math.round(factura.subtotal * 100) / 100,
      isv: Math.round(factura.isv * 100) / 100,
      total: Math.round(factura.total * 100) / 100,
      observaciones: `[IMP-COMPRA] ${factura.proveedor} · ${productosDesc.substring(0, 200)}`,
      estado: 'procesada',
      recibida: false,
    })
  }

  // ── CONTADO: registrar en facturas_compras como pendientes ──
  const contValid = icData.contado.filter(f => !f.duplicada)
  let contCreadas = 0
  let contErrores = 0

  for (const factura of contValid) {
    const partes = factura.fecha.split('-')
    const fechaISO = `${partes[2]}-${partes[1]}-${partes[0]}`

    const payload = {
      centro_costo_id: centroCostoId,
      registrado_por: currentProfile.id,
      numero_factura: factura.no_factura !== 'S/F' ? factura.no_factura : `SF-${factura.no_consecutivo}`,
      fecha_factura: fechaISO,
      tipo_gasto: 'repuestos',
      forma_pago: 'contado',
      subtotal: Math.round(factura.subtotal * 100) / 100,
      isv: Math.round(factura.isv * 100) / 100,
      total: Math.round(factura.total * 100) / 100,
      observaciones: `[IMP-COMPRA] ${factura.proveedor} · ${factura.productos.map(p => p.nombre).filter(Boolean).join(', ').substring(0, 200)}`,
      estado: 'pendiente',
    }

    const { error: errFC } = await sb.from('facturas_compras').insert(payload)
    if (errFC) {
      contErrores++
      log.push(`<span style="color:var(--red)">✕</span> [CONTADO] ${factura.no_factura} · ${factura.proveedor}: ${errFC.message}`)
    } else {
      contCreadas++
      log.push(`<span style="color:var(--amber)">◉</span> [CONTADO] <span class="mono" style="color:var(--gold)">${factura.no_factura}</span> · ${factura.proveedor} · L. ${factura.total.toLocaleString('es-HN', {minimumFractionDigits:2})} → Pendiente`)
    }
  }

  // Mostrar resultado
  document.getElementById('ic-step2').classList.add('hidden')
  document.getElementById('ic-step3').classList.add('hidden')
  document.getElementById('ic-step4').classList.add('hidden')
  document.getElementById('ic-step5').classList.add('hidden')
  document.getElementById('ic-step6').classList.remove('hidden')

  document.getElementById('ic-log').innerHTML = `
    <div style="margin-bottom:16px;padding:14px;border-radius:var(--radius);background:var(--bg3)">
      <div style="font-size:16px;font-weight:500;margin-bottom:8px">${creadas} partida(s) de crédito creadas correctamente</div>
      ${errores ? `<div style="color:var(--red)">${errores} error(es) en partidas</div>` : ''}
      <div style="color:var(--amber);margin-top:6px">${contCreadas} factura(s) de contado registradas como pendientes</div>
      ${contErrores ? `<div style="color:var(--red)">${contErrores} error(es) en contado</div>` : ''}
    </div>
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:500">Detalle</div>
    <div style="max-height:300px;overflow-y:auto;font-size:12px;line-height:2;font-family:var(--mono)">${log.join('<br>')}</div>`

  btn.disabled = false
  btn.textContent = 'Guardar partidas de crédito →'
  toast(`${creadas} partidas crédito + ${contCreadas} facturas contado registradas`, 'ok')
}

// ══════════════════════════════════════════════
// ── IMPORTAR COSTOS DE VENTA (UTILIDAD ALPHA)
// ══════════════════════════════════════════════

const COSTOS_CUENTAS = {
  costo_venta: { codigo: '510101-001', nombre: 'COSTO DE ADQUISICION DE MERCADERIA TECNIMAX' },
  inventario:  { codigo: '110501-001', nombre: 'INVENTARIO PARA LA VENTA BODEGA PRINCIPAL' },
}

let icuFiles = []
let icuData = null // array of parsed reports

function parseEuroNumber(val) {
  if (val == null || val === '' || val === 'NaN' || val === 'nan') return 0
  if (typeof val === 'number') return val
  // Format: "44.555,34" → 44555.34
  let s = String(val).trim()
  s = s.replace(/\./g, '')   // remove thousand separators
  s = s.replace(',', '.')    // decimal comma → point
  s = s.replace(/[^0-9.\-]/g, '') // remove any other chars
  return parseFloat(s) || 0
}

function parseUtilidadExcel(arrayBuffer, fileName) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', raw: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })

  // Detect report type from filename
  // XPlantel/Taxis = taxis, todo lo demás = tecnimax
  let tipo = 'tecnimax'
  let label = 'Tecnimax'
  const fnLower = fileName.toLowerCase()
  if (fnLower.includes('xplantel') || fnLower.includes('taxis')) {
    tipo = 'xplantel_taxis'; label = 'XPlantel Taxis'
  }

  // Also try detecting by case of data rows (MAYUSCULAS = interno concept from ventas)
  // But for costos, the filename convention is more reliable

  // Parse facturas
  const facturas = []
  let i = 1 // skip header row
  while (i < data.length) {
    const row = data[i]
    if (!row) { i++; continue }

    const firstCell = String(row[0] || '').trim()

    // Summary rows at the end
    if (firstCell === 'Ventas:' || firstCell === 'Costo Total:' || firstCell === 'Margen:' || firstCell === '% Margen:') break

    // Skip empty/subtotal rows
    if (!firstCell || firstCell === 'NaN' || firstCell === 'nan' || firstCell === 'Número') { i++; continue }

    // Must be a factura number
    const numFactura = firstCell.replace('.0', '')
    if (!/^\d+$/.test(numFactura)) { i++; continue }

    const fecha = String(row[1] || '').trim()
    const cliente = String(row[2] || '').trim()

    // Collect all product lines for this factura
    const productos = []
    let j = i
    const currentNum = numFactura
    while (j < data.length) {
      const r = data[j]
      if (!r) { j++; continue }
      const rNum = String(r[0] || '').trim().replace('.0', '')

      // If it's the same factura number or empty (continuation)
      if (rNum === currentNum) {
        productos.push({
          nombre: String(r[3] || '').trim(),
          marca: String(r[4] || '').trim(),
          categoria: String(r[5] || '').trim(),
          cantidad: parseEuroNumber(r[6]),
          costo_unitario: parseEuroNumber(r[7]),
          costo_total: parseEuroNumber(r[8]),
          venta_total: parseEuroNumber(r[9]),
          descuento: parseEuroNumber(r[10]),
        })
        j++
      } else if (rNum === '' || rNum === 'NaN' || rNum === 'nan') {
        // Subtotal row or empty — check if it has totals in col 8
        const costoSub = parseEuroNumber(r[8])
        const ventaSub = parseEuroNumber(r[9])
        if (costoSub > 0 || ventaSub > 0) {
          // This is the subtotal row — skip it
        }
        j++
        // If next row is also empty/NaN, we've reached the end of this factura
        const next = data[j]
        if (!next || String(next[0] || '').trim() === '' || String(next[0] || '').trim() === 'NaN') {
          j++
          break
        }
        if (/^\d+$/.test(String(next[0] || '').trim().replace('.0', ''))) {
          break // next factura
        }
      } else {
        break // different factura
      }
    }

    const costoTotal = productos.reduce((s, p) => s + p.costo_total, 0)
    const ventaTotal = productos.reduce((s, p) => s + p.venta_total, 0)

    facturas.push({
      numero: numFactura,
      fecha,
      cliente,
      productos,
      costo_total: Math.round(costoTotal * 100) / 100,
      venta_total: Math.round(ventaTotal * 100) / 100,
    })

    i = j
  }

  // Get summary from last rows
  let resumenVentas = 0, resumenCosto = 0, resumenMargen = 0
  for (let r = data.length - 10; r < data.length; r++) {
    if (!data[r]) continue
    const label = String(data[r][0] || '').trim()
    const val = parseEuroNumber(data[r][1])
    if (label === 'Ventas:') resumenVentas = val
    if (label === 'Costo Total:') resumenCosto = val
    if (label === 'Margen:') resumenMargen = val
  }

  return {
    tipo,
    label,
    fileName,
    facturas,
    totales: {
      ventas: resumenVentas || facturas.reduce((s, f) => s + f.venta_total, 0),
      costo: resumenCosto || facturas.reduce((s, f) => s + f.costo_total, 0),
      margen: resumenMargen,
      numFacturas: facturas.length,
    }
  }
}

function initImportCostos() {
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  document.getElementById('icu-fecha').value = ayer.toISOString().split('T')[0]

  const sel = document.getElementById('icu-centro')
  sel.innerHTML = '<option value="">— Seleccionar —</option>'
  empresas.forEach(e => {
    sel.innerHTML += `<option value="${e.id}">${e.nombre}</option>`
  })
  const tecni = empresas.find(e => e.nombre.toLowerCase().includes('tecni') && !e.nombre.toLowerCase().includes('yonker'))
  if (tecni) sel.value = tecni.id

  resetImportCostos()
  document.getElementById('icu-step1').classList.remove('hidden')
}

window.onImportCostosFiles = (input) => {
  icuFiles = Array.from(input.files || [])
  const list = document.getElementById('icu-file-list')
  if (!icuFiles.length) { list.innerHTML = ''; return }
  list.innerHTML = icuFiles.map(f => `
    <div class="imp-file-item">
      <span class="imp-file-icon">📊</span>
      <span class="imp-file-name">${f.name}</span>
      <span style="font-size:11px;color:var(--text3)">${(f.size/1024).toFixed(0)} KB</span>
    </div>`).join('')
  document.getElementById('icu-zone').classList.add('has-file')
  document.getElementById('btn-procesar-costos').disabled = false
}

window.resetImportCostos = () => {
  icuData = null
  icuFiles = []
  const fileInput = document.getElementById('icu-files')
  if (fileInput) fileInput.value = ''
  document.getElementById('icu-file-list').innerHTML = ''
  const zone = document.getElementById('icu-zone')
  if (zone) zone.classList.remove('has-file')
  const btn = document.getElementById('btn-procesar-costos')
  if (btn) btn.disabled = true
  ;['icu-step1','icu-step2','icu-step3'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden')
  })
  document.getElementById('icu-step1')?.classList.remove('hidden')
}

window.procesarImportCostos = async () => {
  if (!icuFiles.length) { toast('Selecciona los reportes', 'error'); return }

  const btn = document.getElementById('btn-procesar-costos')
  btn.disabled = true
  btn.textContent = 'Procesando...'

  try {
    const reportes = []
    for (const file of icuFiles) {
      const arrayBuffer = await file.arrayBuffer()
      const parsed = parseUtilidadExcel(arrayBuffer, file.name)
      reportes.push(parsed)
    }

    icuData = reportes
    renderImportCostosResults()

  } catch (err) {
    toast('Error al procesar: ' + err.message, 'error')
    console.error(err)
  }

  btn.disabled = false
  btn.textContent = 'Procesar reportes →'
}

function renderImportCostosResults() {
  if (!icuData) return
  const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })

  // Agrupar: Tecnimax (fiscal+interno sumados) y XPlantel Taxis
  const grupos = {}
  icuData.forEach(r => {
    const key = r.tipo === 'xplantel_taxis' ? 'XPlantel Taxis' : 'Tecnimax'
    if (!grupos[key]) grupos[key] = { label: key, ventas: 0, costo: 0, margen: 0, facturas: 0, archivos: [] }
    grupos[key].ventas += r.totales.ventas
    grupos[key].costo += r.totales.costo
    grupos[key].margen += r.totales.margen
    grupos[key].facturas += r.totales.numFacturas
    grupos[key].archivos.push(r.fileName)
  })
  const gruposArr = Object.values(grupos)

  const totalCosto = gruposArr.reduce((s, g) => s + g.costo, 0)
  const totalVentas = gruposArr.reduce((s, g) => s + g.ventas, 0)
  const totalFacturas = gruposArr.reduce((s, g) => s + g.facturas, 0)

  document.getElementById('icu-resumen').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
      <div class="stat-card"><div class="stat-num">${icuData.length}</div><div class="stat-label"><span class="stat-dot" style="background:var(--blue)"></span>Archivos</div></div>
      <div class="stat-card"><div class="stat-num">${totalFacturas}</div><div class="stat-label"><span class="stat-dot" style="background:var(--green)"></span>Facturas</div></div>
      <div class="stat-card"><div class="stat-num">L. ${fmt(totalVentas)}</div><div class="stat-label"><span class="stat-dot" style="background:var(--gold)"></span>Ventas total</div></div>
      <div class="stat-card"><div class="stat-num">L. ${fmt(totalCosto)}</div><div class="stat-label"><span class="stat-dot" style="background:var(--red)"></span>Costo total</div></div>
    </div>`

  document.getElementById('icu-detalle').innerHTML = `
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;font-weight:500">Detalle por archivo</div>
    <div class="table-wrap" style="margin-bottom:16px">
      <table>
        <thead><tr>
          <th>Archivo</th><th>Grupo</th><th style="text-align:center">Facturas</th>
          <th style="text-align:right">Ventas</th><th style="text-align:right">Costo</th>
        </tr></thead>
        <tbody>${icuData.map(r => `
          <tr>
            <td style="font-size:11px">${r.fileName}</td>
            <td><span class="badge badge-blue" style="font-size:10px">${r.tipo === 'xplantel_taxis' ? 'Taxis' : 'Tecnimax'}</span></td>
            <td style="text-align:center;font-family:var(--mono)">${r.totales.numFacturas}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(r.totales.ventas)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(r.totales.costo)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;font-weight:500">Partidas a generar (${gruposArr.length})</div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Partida</th><th style="text-align:center">Facturas</th>
          <th style="text-align:right">Ventas</th><th style="text-align:right">Costo</th>
          <th style="text-align:right">Margen</th>
        </tr></thead>
        <tbody>${gruposArr.map(g => `
          <tr>
            <td style="font-weight:500">${g.label}</td>
            <td style="text-align:center;font-family:var(--mono)">${g.facturas}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(g.ventas)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:500;color:var(--red)">${fmt(g.costo)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px;color:var(--green)">${fmt(g.ventas - g.costo)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:12px;padding:12px;border-radius:var(--radius);background:rgba(59,130,246,0.08);border-left:3px solid var(--blue);font-size:13px;color:var(--blue);line-height:1.5">
      ℹ️ Tecnimax fiscal + interno se suman en una sola partida.<br>
      Débito: <span class="mono">510101-001</span> COSTO DE ADQUISICION · Crédito: <span class="mono">110501-001</span> INVENTARIO
    </div>`

  document.getElementById('icu-step1').classList.add('hidden')
  document.getElementById('icu-step2').classList.remove('hidden')
}

window.guardarImportCostos = async () => {
  if (!icuData?.length) { toast('No hay datos procesados', 'error'); return }

  const fecha = document.getElementById('icu-fecha').value
  const centroCostoId = document.getElementById('icu-centro').value
  if (!fecha) { toast('Selecciona la fecha', 'error'); return }
  if (!centroCostoId) { toast('Selecciona el centro de costo', 'error'); return }

  const btn = document.getElementById('btn-guardar-costos')
  btn.disabled = true
  btn.textContent = 'Guardando...'

  if (!cuentasDetalle.length) {
    const { data } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').eq('es_detalle', true).order('codigo')
    cuentasDetalle = data || []
  }
  const getCuenta = (codigo) => cuentasDetalle.find(c => c.codigo === codigo)
  const ctaCosto = getCuenta(COSTOS_CUENTAS.costo_venta.codigo)
  const ctaInventario = getCuenta(COSTOS_CUENTAS.inventario.codigo)

  // Calcular rango del mes
  const [anio, mes] = fecha.split('-')
  const mesInicio = `${anio}-${mes}-01`
  const mesFin = `${anio}-${mes}-31`

  // Agrupar reportes: Tecnimax (fiscal+interno) y XPlantel Taxis
  const grupos = {}
  icuData.forEach(r => {
    const key = r.tipo === 'xplantel_taxis' ? 'XPlantel Taxis' : 'Tecnimax'
    if (!grupos[key]) grupos[key] = { label: key, costo: 0, ventas: 0, facturas: 0 }
    grupos[key].costo += r.totales.costo
    grupos[key].ventas += r.totales.ventas
    grupos[key].facturas += r.totales.numFacturas
  })

  let creadas = 0
  let actualizadas = 0
  let errores = 0
  const log = []

  for (const [key, grupo] of Object.entries(grupos)) {
    if (grupo.costo <= 0) {
      log.push(`<span style="color:var(--text3)">⊘</span> ${grupo.label}: Costo = 0, omitido`)
      continue
    }

    const costoTotal = Math.round(grupo.costo * 100) / 100
    const descLinea = `${grupo.label} · ${grupo.facturas} facturas`

    // Buscar partida existente del mes
    const searchPattern = `Costo de venta · ${grupo.label} %[IMP-COSTO]`
    const { data: existentes } = await sb.from('partidas_contables')
      .select('id')
      .like('descripcion', searchPattern)
      .gte('fecha_partida', mesInicio)
      .lte('fecha_partida', mesFin)
      .limit(1)

    const partidaExistente = existentes?.[0]
    const descripcion = `Costo de venta · ${grupo.label} · ${fecha} [IMP-COSTO]`

    const lineas = [
      {
        cuenta_id: ctaCosto?.id || null,
        cuenta_codigo: COSTOS_CUENTAS.costo_venta.codigo,
        cuenta_nombre: COSTOS_CUENTAS.costo_venta.nombre,
        tipo: 'debito',
        monto: costoTotal,
        centro_costo_id: centroCostoId,
        descripcion: descLinea,
        numero_documento: null,
        aplica_fiscal: false,
      },
      {
        cuenta_id: ctaInventario?.id || null,
        cuenta_codigo: COSTOS_CUENTAS.inventario.codigo,
        cuenta_nombre: COSTOS_CUENTAS.inventario.nombre,
        tipo: 'credito',
        monto: costoTotal,
        centro_costo_id: centroCostoId,
        descripcion: descLinea,
        numero_documento: null,
        aplica_fiscal: false,
      }
    ]

    if (partidaExistente) {
      // ── ACTUALIZAR ──
      const partidaId = partidaExistente.id
      const { error: errU } = await sb.from('partidas_contables').update({
        total: costoTotal, descripcion, fecha_partida: fecha,
      }).eq('id', partidaId)

      if (errU) { errores++; log.push(`<span style="color:var(--red)">✕</span> ${grupo.label}: ${errU.message}`); continue }

      await sb.from('lineas_partida').delete().eq('partida_id', partidaId)
      const { error: errL } = await sb.from('lineas_partida').insert(lineas.map(l => ({ ...l, partida_id: partidaId })))
      if (errL) { errores++; log.push(`<span style="color:var(--red)">✕</span> ${grupo.label} líneas: ${errL.message}`); continue }

      actualizadas++
      log.push(`<span style="color:var(--blue)">↻</span> ${grupo.label} · ACTUALIZADA · L. ${costoTotal.toLocaleString('es-HN', {minimumFractionDigits:2})} · ${grupo.facturas} facturas`)

    } else {
      // ── CREAR ──
      const { data: partida, error: errP } = await sb.from('partidas_contables').insert({
        centro_costo_id: centroCostoId, generada_por: currentProfile.id,
        tipo_origen: 'compra', descripcion, fecha_partida: fecha,
        numero_documento: null, estado: 'aprobada', total: costoTotal,
      }).select().single()

      if (errP) { errores++; log.push(`<span style="color:var(--red)">✕</span> ${grupo.label}: ${errP.message}`); continue }

      const { error: errL } = await sb.from('lineas_partida').insert(lineas.map(l => ({ ...l, partida_id: partida.id })))
      if (errL) {
        errores++; log.push(`<span style="color:var(--red)">✕</span> ${grupo.label} líneas: ${errL.message}`)
        await sb.from('partidas_contables').delete().eq('id', partida.id)
        continue
      }

      creadas++
      log.push(`<span style="color:var(--green)">✓</span> ${grupo.label} · NUEVA · L. ${costoTotal.toLocaleString('es-HN', {minimumFractionDigits:2})} · ${grupo.facturas} facturas`)
    }
  }

  // Mostrar resultado
  document.getElementById('icu-step2').classList.add('hidden')
  document.getElementById('icu-step3').classList.remove('hidden')

  document.getElementById('icu-log').innerHTML = `
    <div style="margin-bottom:16px;padding:14px;border-radius:var(--radius);background:var(--bg3)">
      <div style="font-size:16px;font-weight:500;margin-bottom:8px">${creadas} creada(s) · ${actualizadas} actualizada(s)</div>
      ${errores ? `<div style="color:var(--red)">${errores} error(es)</div>` : ''}
    </div>
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:500">Detalle</div>
    <div style="max-height:300px;overflow-y:auto;font-size:12px;line-height:2;font-family:var(--mono)">${log.join('<br>')}</div>`

  btn.disabled = false
  btn.textContent = 'Generar partidas de costo →'
  toast(`${creadas} creadas · ${actualizadas} actualizadas`, 'ok')
}