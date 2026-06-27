import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'
window.XLSX = XLSX

const sb = createClient(
  'https://icghaqhtvutwlkhtotyv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZ2hhcWh0dnV0d2xraHRvdHl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTE3MzksImV4cCI6MjA5NDk2NzczOX0.2_sioWiJuNVwDaSggnczbzCVu8IorzBsrgbwNXXz39E'
)
window._sb = sb

// ── HELPERS ──
// Returns YYYY-MM-DD in local timezone (not UTC)
function localDateStr(d) {
  const dt = d || new Date()
  return dt.toLocaleDateString('en-CA') // en-CA returns YYYY-MM-DD format
}

// Correlativo de partida ATÓMICO: lo genera la BD (función siguiente_numero_partida).
// Evita los duplicados que producía el viejo "último + 1" en el cliente.
// Fallback: si la función no existe aún (BD sin migrar), usa el método viejo.
window.siguienteNumeroPartida = async () => {
  try {
    const { data, error } = await sb.rpc('siguiente_numero_partida')
    if (!error && Number.isInteger(data)) return data
  } catch (e) { /* cae al fallback */ }
  const { data: lastPN } = await sb.from('partidas_contables')
    .select('numero_partida').order('numero_partida', { ascending: false }).limit(1)
  return (lastPN?.[0]?.numero_partida || 0) + 1
}

// ── STATE ──
let currentUser = null
let currentProfile = null
let empresas = []
let tiposOrigen = []

// ── Exposición global para módulos externos (reportes.js, etc.) ──
window._empresas = () => empresas
window._currentProfile = () => currentProfile
window._allCentros = () => allCentros

// ── LOG DE ACTIVIDAD ──
window.logActividad = async (accion, modulo, detalle, referencia_id) => {
  try {
    const p = currentProfile
    await sb.from('actividad_log').insert({
      usuario_id: p?.id || null,
      usuario_nombre: p?.nombre || 'desconocido',
      usuario_rol: p?.rol || '',
      accion,
      modulo: modulo || null,
      detalle: detalle || null,
      referencia_id: referencia_id ? String(referencia_id) : null
    })
  } catch(e) { /* silent */ }
}

// ── INIT ──
window.addEventListener('DOMContentLoaded', async () => {
  setupCargaImagenes()
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
  // ultimo_acceso vía RPC: la política UPDATE de 'usuarios' exige super_admin,
  // así que este toque (solo la columna ultimo_acceso) se hace por una función
  // SECURITY DEFINER que actualiza únicamente la fila del usuario logueado.
  await sb.rpc('registrar_acceso')
  logActividad('login', 'auth', `Inicio de sesión · ${profile.rol}`)
  hideOverlay()
  setupUI()
  showScreen('main-screen')
  await loadEmpresas()
  await loadTiposOrigen()
  // Cargar catálogo de cuentas para reportes y búsquedas
  const { data: catData } = await sb.from('catalogo_cuentas').select('*').order('codigo')
  allCuentas = catData || []
  window.catalogoCuentas = allCuentas
  // Vista inicial según rol
  const defaultViews = {
    super_admin: ['usuarios', 'Gestión de usuarios'],
    contador: ['partidas', 'Partidas contables'],
    aux_contable: ['pendientes', 'Facturas pendientes'],
    compras: ['compras', 'Registrar compras'],
    contador_fiscal: ['declaracion-isv', 'Declaración de ISV']
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
  const roleLabels = { super_admin:'Super Admin', contador:'Contador', aux_contable:'Aux. Contable', compras:'Compras', contador_fiscal:'Contador Fiscal' }
  document.getElementById('top-role').textContent = roleLabels[p.rol] || p.rol

  // ── PERMISOS POR ROL ──
  // Definir qué nav-items ve cada rol
  const permisos = {
    super_admin: ['nav-usuarios', 'nav-compras', 'nav-pendientes', 'nav-caja', 'nav-caja-chica', 'nav-cxp', 'nav-cuentas-cobrar', 'nav-aprobaciones', 'nav-vehiculos', 'nav-catalogo', 'nav-tipos-origen', 'nav-partidas', 'nav-importar', 'nav-importar-compras', 'nav-importar-costos', 'nav-importar-fact-taxis', 'nav-importar-taxis', 'nav-partidas-taxis', 'nav-unidades-taxis', 'nav-financiamiento', 'nav-cierre-recibos', 'nav-revision-taxis', 'nav-conciliacion', 'nav-auxiliar', 'nav-balance-comp', 'nav-estado-resultados', 'nav-rentabilidad-taxis', 'nav-empleados', 'nav-planilla', 'nav-prestamos-emp', 'nav-asistencia', 'nav-config-planilla', 'nav-actividad', 'nav-declaracion-isv', 'nav-conciliacion-puente', 'nav-proveedores', 'nav-verif-compras', 'nav-gastos-huerfanos', 'nav-rangos-ventas', 'nav-vacaciones'],
    contador:    ['nav-compras', 'nav-pendientes', 'nav-aprobaciones', 'nav-vehiculos', 'nav-catalogo', 'nav-partidas', 'nav-importar', 'nav-importar-compras', 'nav-importar-costos', 'nav-importar-fact-taxis', 'nav-importar-taxis', 'nav-partidas-taxis', 'nav-unidades-taxis', 'nav-caja-chica', 'nav-cierre-recibos', 'nav-revision-taxis', 'nav-conciliacion', 'nav-auxiliar', 'nav-balance-comp', 'nav-estado-resultados', 'nav-rentabilidad-taxis', 'nav-empleados', 'nav-planilla', 'nav-prestamos-emp', 'nav-asistencia', 'nav-conciliacion-puente', 'nav-proveedores', 'nav-verif-compras', 'nav-gastos-huerfanos', 'nav-rangos-ventas', 'nav-vacaciones'],
    aux_contable:['nav-compras', 'nav-pendientes', 'nav-vehiculos', 'nav-catalogo', 'nav-partidas', 'nav-importar', 'nav-importar-compras', 'nav-importar-costos', 'nav-caja-chica', 'nav-cxp', 'nav-auxiliar', 'nav-balance-comp', 'nav-conciliacion-puente', 'nav-proveedores', 'nav-verif-compras', 'nav-revision-taxis'],
    compras:     ['nav-compras', 'nav-pendientes', 'nav-vehiculos'],
    contador_fiscal: ['nav-declaracion-isv']
  }
  window._permisosPorRol = permisos
  // Permisos personalizados (columna permisos_modulos) tienen prioridad sobre el rol.
  // super_admin siempre ve todo (no se puede auto-bloquear).
  let visibles
  if (p.rol === 'super_admin') {
    visibles = permisos.super_admin
  } else if (Array.isArray(p.permisos_modulos) && p.permisos_modulos.length) {
    visibles = p.permisos_modulos
  } else {
    visibles = permisos[p.rol] || []
  }
  window._soloSusPartidas = !!p.solo_sus_partidas && p.rol !== 'super_admin'

  // Ocultar todo primero
  const todosNav = ['nav-usuarios', 'nav-compras', 'nav-pendientes', 'nav-caja', 'nav-caja-chica', 'nav-cxp', 'nav-cuentas-cobrar', 'nav-aprobaciones', 'nav-vehiculos', 'nav-catalogo', 'nav-partidas', 'nav-importar', 'nav-importar-compras', 'nav-importar-costos', 'nav-importar-fact-taxis', 'nav-importar-taxis', 'nav-partidas-taxis', 'nav-unidades-taxis', 'nav-financiamiento', 'nav-cierre-recibos', 'nav-revision-taxis', 'nav-conciliacion', 'nav-conciliacion-puente', 'nav-auxiliar', 'nav-balance-comp', 'nav-estado-resultados', 'nav-rentabilidad-taxis', 'nav-gastos-huerfanos', 'nav-empleados', 'nav-planilla', 'nav-prestamos-emp', 'nav-asistencia', 'nav-config-planilla', 'nav-vacaciones', 'nav-actividad', 'nav-declaracion-isv', 'nav-proveedores', 'nav-verif-compras', 'nav-rangos-ventas']
  todosNav.forEach(id => {
    const el = document.getElementById(id)
    if (el) el.classList.toggle('hidden', !visibles.includes(id))
  })

  // Ocultar sección Contabilidad completa si no tiene ningún módulo contable
  const contabItems = ['nav-catalogo', 'nav-partidas', 'nav-tipos-origen', 'nav-proveedores', 'nav-verif-compras']
  const tieneContab = contabItems.some(id => visibles.includes(id))
  document.getElementById('section-contab').classList.toggle('hidden', !tieneContab)

  // Ocultar sección Importaciones si no tiene ningún módulo
  const importItems = ['nav-importar', 'nav-importar-compras', 'nav-importar-costos', 'nav-importar-fact-taxis', 'nav-importar-taxis', 'nav-partidas-taxis']
  const tieneImport = importItems.some(id => visibles.includes(id))
  const sectionImport = document.getElementById('section-importar')
  if (sectionImport) sectionImport.classList.toggle('hidden', !tieneImport)

  // Ocultar sección Reportes si no tiene ningún módulo de reportes
  const reporteItems = ['nav-auxiliar', 'nav-balance-comp', 'nav-estado-resultados', 'nav-rentabilidad-taxis', 'nav-gastos-huerfanos', 'nav-actividad']
  const tieneReportes = reporteItems.some(id => visibles.includes(id))
  const sectionReportes = document.getElementById('section-reportes')
  if (sectionReportes) sectionReportes.classList.toggle('hidden', !tieneReportes)

  // Ocultar sección Fiscal si no tiene el módulo
  const sectionFiscal = document.getElementById('section-fiscal')
  if (sectionFiscal) sectionFiscal.classList.toggle('hidden', !visibles.includes('nav-declaracion-isv') && !visibles.includes('nav-rangos-ventas'))

  // Ocultar sección RRHH si no tiene ningún módulo
  const rrhhItems = ['nav-empleados', 'nav-planilla', 'nav-prestamos-emp', 'nav-asistencia', 'nav-config-planilla', 'nav-vacaciones']
  const tieneRRHH = rrhhItems.some(id => visibles.includes(id))
  const sectionRRHH = document.getElementById('section-rrhh')
  if (sectionRRHH) sectionRRHH.classList.toggle('hidden', !tieneRRHH)
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
// ── Sidebar toggle (mobile) ──
window.toggleSidebar = () => {
  document.getElementById('sidebar').classList.toggle('open')
  document.getElementById('sidebar-overlay').classList.toggle('active')
}

window.showView = (id, label) => {
  // Close sidebar on mobile when navigating
  document.getElementById('sidebar').classList.remove('open')
  document.getElementById('sidebar-overlay').classList.remove('active')
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
  if (id === 'usuarios') { loadUsuarios(); loadCentrosCosto() }
  if (id === 'pendientes') loadPendientes()
  if (id === 'compras') initForm()
  if (id === 'catalogo') loadCatalogo()
  if (id === 'tipos-origen') loadTiposOrigenAdmin()
  if (id === 'partidas') loadPartidas()
  if (id === 'partida-nueva' && !editingPartidaId) initPartidaNueva()
  if (id === 'caja') loadCaja()
  if (id === 'caja-chica') window.loadCajaChica?.()
  if (id === 'cxp') window.loadCxP?.()
  if (id === 'importar') initImport()
  if (id === 'importar-compras') initImportCompras()
  if (id === 'importar-costos') initImportCostos()
  if (id === 'importar-taxis') resetImportTaxis()
  if (id === 'partidas-taxis') initPartidasTaxis()
  if (id === 'aprobaciones') loadAprobaciones()
  if (id === 'vehiculos') loadVehiculos()
  if (id === 'unidades-taxis') loadUnidadesTaxis()
  if (id === 'financiamiento') loadFinanciamiento()
  if (id === 'cierre-recibos') initCierreMensual()
  if (id === 'vencimientos' && window.initVencimientos) window.initVencimientos()
  if (id === 'conciliacion' && window.initConciliacion) window.initConciliacion()
  if (id === 'conciliacion-puente' && window.initConciliaPuente) window.initConciliaPuente()
  if (id === 'gastos-huerfanos' && window.initGastosHuerfanos) window.initGastosHuerfanos()
  if (id === 'proveedores' && window.initProveedores) window.initProveedores()
  if (id === 'verif-compras' && window.initVerifCompras) window.initVerifCompras()
  if (id === 'rangos-ventas' && window.initRangosVentas) window.initRangosVentas()
  if (id === 'auxiliar' && window.initAuxiliar) window.initAuxiliar()
  if (id === 'balance-comp' && window.initBalance) window.initBalance()
  if (id === 'estado-resultados' && window.initEstadoResultados) window.initEstadoResultados()
  if (id === 'rentabilidad-taxis' && window.initRentabilidadTaxis) window.initRentabilidadTaxis()
  if (id === 'empleados' && window.loadEmpleados) window.loadEmpleados()
  if (id === 'actividad') loadActividad()
  if (id === 'declaracion-isv' && window.loadDeclaracionISV) window.loadDeclaracionISV()
  if (id === 'planilla' && window.initPlanilla) window.initPlanilla()
  if (id === 'prestamos-emp' && window.loadPrestamosEmp) window.loadPrestamosEmp()
  // Ajustar botones según rol
  applyRoleRestrictions(id)
}

function applyRoleRestrictions(viewId) {
  const rol = currentProfile?.rol
  if (!rol) return
  const puedeCrearCuentas = ['super_admin', 'contador'].includes(rol)
  const puedeCrearPartidas = ['super_admin', 'contador', 'aux_contable'].includes(rol)
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

  // Botón "+ Nuevo vehículo" — solo super_admin
  const btnNuevoVin = document.getElementById('btn-nuevo-vin')
  if (btnNuevoVin) btnNuevoVin.classList.toggle('hidden', !puedeCrearUsuarios)

  // Botón "+ Nuevo centro" — solo super_admin
  const btnNuevoCentro = document.getElementById('btn-nuevo-centro')
  if (btnNuevoCentro) btnNuevoCentro.classList.toggle('hidden', !puedeCrearUsuarios)

  // Botón "+ Nueva unidad" taxis — solo super_admin
  const btnNuevaUnidad = document.getElementById('btn-nueva-unidad')
  if (btnNuevaUnidad) btnNuevaUnidad.classList.toggle('hidden', !puedeCrearUsuarios)

  // Botón "+ Nueva factura" en pendientes — solo compras y super_admin
  const btnNuevaFactPend = document.getElementById('btn-nueva-factura-pend')
  if (btnNuevaFactPend) btnNuevaFactPend.classList.toggle('hidden', !['super_admin', 'compras'].includes(rol))
}

// ── EMPRESAS ──
let todosLosCentros = []
window._todosLosCentros = () => todosLosCentros

async function loadEmpresas() {
  // Cargar TODOS los centros (para saber cuáles son privados en reportes)
  const { data: allCC } = await sb.from('centros_costo').select('*').order('nombre')
  todosLosCentros = allCC || []

  // Empresas operativas activas (para selects)
  empresas = todosLosCentros.filter(c => c.activa && !c.es_corporativo)
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

// ── ADMIN TIPOS DE ORIGEN ──
async function loadTiposOrigenAdmin() {
  const container = document.getElementById('tabla-tipos-origen')
  if (!container) return
  const { data, error } = await sb.from('tipos_origen').select('*').order('orden')
  if (error) { container.innerHTML = `<div style="color:var(--red);padding:20px">${error.message}</div>`; return }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('es-HN') : '—'
  container.innerHTML = `
    <table>
      <thead><tr>
        <th style="width:50px">Orden</th>
        <th>Nombre</th>
        <th>Valor (ID)</th>
        <th style="width:80px">Estado</th>
        <th style="width:120px">Acciones</th>
      </tr></thead>
      <tbody>${(data || []).map(t => `
        <tr>
          <td style="text-align:center;font-family:var(--mono)">${t.orden || '—'}</td>
          <td style="font-weight:500">${t.nombre}</td>
          <td style="font-family:var(--mono);font-size:12px;color:var(--text3)">${t.id}</td>
          <td style="text-align:center"><span class="badge ${t.activo ? 'badge-green' : 'badge-red'}">${t.activo ? 'Activo' : 'Inactivo'}</span></td>
          <td style="text-align:center">
            <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px" onclick="editarTipoOrigen('${t.id}','${t.nombre.replace(/'/g,"\\'")}',${t.orden || 0},${t.activo})">✏️</button>
            <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;color:var(--red)" onclick="eliminarTipoOrigen('${t.id}','${t.nombre.replace(/'/g,"\\'")}')">🗑️</button>
          </td>
        </tr>`).join('')}</tbody>
    </table>`
}
window.loadTiposOrigenAdmin = loadTiposOrigenAdmin

window.nuevoTipoOrigen = async () => {
  const nombre = prompt('Nombre del nuevo tipo de origen:')
  if (!nombre) return
  const id = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/(^_|_$)/g,'')
  const { data: maxOrden } = await sb.from('tipos_origen').select('orden').order('orden', { ascending: false }).limit(1)
  const orden = (maxOrden?.[0]?.orden || 0) + 1
  const { error } = await sb.from('tipos_origen').insert({ id, nombre: nombre.trim(), orden, activo: true })
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast(`Tipo "${nombre}" creado ✓`, 'success')
  loadTiposOrigenAdmin()
  loadTiposOrigen()
}

window.editarTipoOrigen = async (id, nombreActual, ordenActual, activoActual) => {
  const nombre = prompt('Nombre:', nombreActual)
  if (nombre === null) return
  const ordenStr = prompt('Orden (número):', ordenActual)
  if (ordenStr === null) return
  const activo = confirm('¿Está activo?')
  const { error } = await sb.from('tipos_origen').update({
    nombre: nombre.trim(),
    orden: parseInt(ordenStr) || 0,
    activo
  }).eq('id', id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast(`Tipo "${nombre}" actualizado ✓`, 'success')
  loadTiposOrigenAdmin()
  loadTiposOrigen()
}

window.eliminarTipoOrigen = async (id, nombre) => {
  if (!confirm(`¿Eliminar el tipo de origen "${nombre}"?\n\nLas partidas existentes con este tipo no se verán afectadas.`)) return
  const { error } = await sb.from('tipos_origen').delete().eq('id', id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast(`Tipo "${nombre}" eliminado`, 'success')
  loadTiposOrigenAdmin()
  loadTiposOrigen()
}

// ── USUARIOS ──
async function loadUsuarios() {
  const tbody = document.getElementById('tbody-usuarios')
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'
  const { data, error } = await sb.from('usuarios').select('*, centro_costo:centros_costo(nombre)').order('created_at', { ascending: false })
  if (error) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);padding:30px">${error.message}</td></tr>`; return }
  if (!data?.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3)">No hay usuarios registrados</td></tr>'; return }
  window._allUsuarios = data
  document.getElementById('stat-total').textContent = data.length
  document.getElementById('stat-activos').textContent = data.filter(u => u.activo).length
  const roleBadge = { super_admin:'badge-gold', contador:'badge-blue', aux_contable:'badge-green', compras:'badge-amber' }
  const roleLabel = { super_admin:'Super Admin', contador:'Contador', aux_contable:'Aux. Contable', compras:'Compras' }
  tbody.innerHTML = data.map(u => `
    <tr style="${!u.activo ? 'opacity:0.5' : ''}">
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
      <td>
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:12px" onclick="editarUsuario('${u.id}')" title="Editar">✏️</button>
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:12px" onclick="toggleUsuarioActivo('${u.id}', ${u.activo})" title="${u.activo ? 'Desactivar' : 'Activar'}">${u.activo ? '🚫' : '✅'}</button>
      </td>
    </tr>`).join('')
}
window.loadUsuarios = loadUsuarios

// ── CATÁLOGO DE MÓDULOS (para el panel de permisos por usuario) ──
const MODULOS_CATALOGO = [
  { grupo: 'Principal', items: [
    ['nav-usuarios', 'Usuarios'], ['nav-compras', 'Registrar compra'], ['nav-pendientes', 'Facturas pendientes'],
    ['nav-caja', 'Caja General'], ['nav-caja-chica', 'Caja Chica'], ['nav-cxp', 'Cuentas x Pagar'],
    ['nav-cuentas-cobrar', 'Cuentas x Cobrar'], ['nav-aprobaciones', 'Aprobaciones'], ['nav-vehiculos', 'Vehículos VIN'],
    ['nav-unidades-taxis', 'Unidades Taxis'], ['nav-financiamiento', 'Financiamiento'], ['nav-cierre-recibos', 'Cierre Recibos'],
    ['nav-conciliacion', 'Conciliación Bancaria'], ['nav-conciliacion-puente', 'Conciliación Puente']
  ]},
  { grupo: 'Contabilidad', items: [
    ['nav-catalogo', 'Catálogo de cuentas'], ['nav-partidas', 'Partidas'], ['nav-tipos-origen', 'Tipos de origen'],
    ['nav-proveedores', 'Proveedores'], ['nav-verif-compras', 'Verificar compras']
  ]},
  { grupo: 'Importaciones', items: [
    ['nav-importar', 'Ventas Alpha'], ['nav-importar-compras', 'Compras Alpha'], ['nav-importar-costos', 'Costos Alpha'],
    ['nav-importar-fact-taxis', 'Facturas Taxis'], ['nav-importar-taxis', 'Entregas Taxis'], ['nav-partidas-taxis', 'Partidas Taxis']
  ]},
  { grupo: 'RRHH', items: [
    ['nav-empleados', 'Empleados'], ['nav-planilla', 'Planilla'], ['nav-prestamos-emp', 'Préstamos'],
    ['nav-asistencia', 'Asistencia'], ['nav-config-planilla', 'Config. planilla'], ['nav-vacaciones', 'Vacaciones']
  ]},
  { grupo: 'Reportes', items: [
    ['nav-auxiliar', 'Auxiliar de cuentas'], ['nav-balance-comp', 'Balance comprobación'],
    ['nav-estado-resultados', 'Estado de resultados'], ['nav-rentabilidad-taxis', 'Rentabilidad Taxis'], ['nav-gastos-huerfanos', 'Gastos huérfanos'], ['nav-actividad', 'Actividad']
  ]},
  { grupo: 'Fiscal', items: [
    ['nav-declaracion-isv', 'Declaración ISV'], ['nav-rangos-ventas', 'Rango de ventas']
  ]}
]

// Renderiza el panel de checkboxes en el contenedor dado, con los ids marcados
function renderPanelPermisos(containerId, marcados) {
  const cont = document.getElementById(containerId)
  if (!cont) return
  const set = new Set(marcados || [])
  cont.innerHTML = MODULOS_CATALOGO.map(g => `
    <div style="margin-bottom:10px">
      <div style="font-size:11px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">${g.grupo}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">
        ${g.items.map(([id, label]) => `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;font-size:12px;margin:0">
            <input type="checkbox" class="${containerId}-chk" value="${id}" ${set.has(id) ? 'checked' : ''} style="width:auto;margin:0"> ${label}
          </label>`).join('')}
      </div>
    </div>`).join('')
}

// Lee los ids marcados de un panel
function leerPanelPermisos(containerId) {
  return [...document.querySelectorAll('.' + containerId + '-chk:checked')].map(c => c.value)
}

// Premarca el panel según la plantilla del rol elegido
window.aplicarPlantillaRol = (containerId, rol) => {
  const plantilla = (window._permisosPorRol || {})[rol] || []
  renderPanelPermisos(containerId, plantilla)
}

window.openModalUsuario = () => {
  document.getElementById('modal-error').classList.add('hidden')
  ;['nu-nombre','nu-email','nu-pass'].forEach(id => document.getElementById(id).value = '')
  document.getElementById('nu-rol').value = 'compras'
  renderPanelPermisos('nu-permisos', (window._permisosPorRol || {}).compras || [])
  const sp = document.getElementById('nu-solo-partidas'); if (sp) sp.checked = false
  document.getElementById('modal-usuario').classList.add('open')
}

// ── Editar usuario ──
let editingUserId = null
window.editarUsuario = (id) => {
  const u = (window._allUsuarios || []).find(x => x.id === id)
  if (!u) return
  editingUserId = id
  document.getElementById('modal-edit-user-title').textContent = 'Editar: ' + u.nombre
  document.getElementById('eu-nombre').value = u.nombre
  document.getElementById('eu-rol').value = u.rol
  document.getElementById('eu-pass').value = ''
  document.getElementById('modal-edit-error').classList.add('hidden')
  // Populate centro costo select
  const sel = document.getElementById('eu-empresa')
  const nuSel = document.getElementById('nu-empresa')
  sel.innerHTML = nuSel.innerHTML // copy options from create modal
  sel.value = u.centro_costo_id || ''
  // Panel de permisos: usa los guardados del usuario, o la plantilla del rol si no tiene
  const marcados = (Array.isArray(u.permisos_modulos) && u.permisos_modulos.length)
    ? u.permisos_modulos
    : ((window._permisosPorRol || {})[u.rol] || [])
  renderPanelPermisos('eu-permisos', marcados)
  const sp = document.getElementById('eu-solo-partidas'); if (sp) sp.checked = !!u.solo_sus_partidas
  document.getElementById('modal-editar-usuario').classList.add('open')
}

window.guardarEdicionUsuario = async () => {
  if (!editingUserId) return
  const nombre = document.getElementById('eu-nombre').value.trim()
  const rol = document.getElementById('eu-rol').value
  const centro_costo_id = document.getElementById('eu-empresa').value || null
  const newPass = document.getElementById('eu-pass').value
  const err = document.getElementById('modal-edit-error')
  const permisos_modulos = leerPanelPermisos('eu-permisos')
  const solo_sus_partidas = !!document.getElementById('eu-solo-partidas')?.checked

  if (!nombre) { showError(err, 'El nombre es obligatorio'); return }
  if (newPass && newPass.length < 8) { showError(err, 'La contraseña debe tener al menos 8 caracteres'); return }

  const btn = document.getElementById('btn-guardar-usuario')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'

  // Update profile in usuarios table
  const { error: updErr } = await sb.from('usuarios').update({ nombre, rol, centro_costo_id, permisos_modulos, solo_sus_partidas }).eq('id', editingUserId)
  if (updErr) {
    btn.disabled = false; btn.textContent = 'Guardar cambios'
    showError(err, updErr.message); return
  }

  // Update password if provided (requires admin API or auth.admin)
  if (newPass) {
    const user = (window._allUsuarios || []).find(x => x.id === editingUserId)
    if (user?.auth_user_id) {
      // Use Supabase auth admin updateUserById via RPC if available
      const { error: passErr } = await sb.rpc('admin_update_password', {
        target_user_id: user.auth_user_id,
        new_password: newPass
      })
      if (passErr) {
        // Fallback: try direct auth update (only works if current user is the target)
        toast('Perfil actualizado. Para cambiar contraseña, el usuario debe hacerlo desde su sesión.', 'info')
      } else {
        toast('Contraseña actualizada', 'success')
      }
    }
  }

  btn.disabled = false; btn.textContent = 'Guardar cambios'
  closeModal('modal-editar-usuario')
  toast('Usuario actualizado', 'success')
  loadUsuarios()
}

// ── Activar/Desactivar usuario ──
window.toggleUsuarioActivo = async (id, activo) => {
  if (!confirm(activo ? '¿Desactivar este usuario? No podrá iniciar sesión.' : '¿Reactivar este usuario?')) return
  const { error } = await sb.from('usuarios').update({ activo: !activo }).eq('id', id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast(activo ? 'Usuario desactivado' : 'Usuario reactivado', 'success')
  loadUsuarios()
}

window.crearUsuario = async () => {
  const nombre = document.getElementById('nu-nombre').value.trim()
  const email = document.getElementById('nu-email').value.trim()
  const pass = document.getElementById('nu-pass').value
  const rol = document.getElementById('nu-rol').value
  const centro_costo_id = document.getElementById('nu-empresa').value || null
  const permisos_modulos = leerPanelPermisos('nu-permisos')
  const solo_sus_partidas = !!document.getElementById('nu-solo-partidas')?.checked
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
  // 3. Restaurar sesión del admin ANTES de insertar el perfil.
  //    signUp puede haber cambiado la sesión al usuario nuevo; si insertáramos
  //    ahora, el INSERT correría como ese usuario y la política RLS (que exige
  //    super_admin) lo rechazaría. Restaurando primero, el INSERT corre como admin.
  if (adminSession) {
    await sb.auth.setSession({
      access_token: adminSession.access_token,
      refresh_token: adminSession.refresh_token
    })
  }
  // 4. Insertar perfil en tabla usuarios (ya como super_admin)
  const { error: profileErr } = await sb.from('usuarios').insert({
    auth_user_id: signData.user.id, nombre, email, rol, centro_costo_id, activo: true,
    permisos_modulos, solo_sus_partidas
  })
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

// ── CENTROS DE COSTO (CRUD) ──
let allCentros = []
let editingCentroId = null

async function loadCentrosCosto() {
  const tbody = document.getElementById('tbody-centros')
  if (!tbody) return
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'

  const { data, error } = await sb.from('centros_costo').select('*').order('nombre')
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);padding:30px">${error.message}</td></tr>`
    return
  }

  allCentros = data || []

  // Actualizar stat dinámico
  const elCentros = document.getElementById('stat-centros')
  if (elCentros) elCentros.textContent = allCentros.filter(c => c.activa).length

  if (!allCentros.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3)">No hay centros registrados</td></tr>'
    return
  }

  const actBadge = (t) => {
    const m = { gravada: ['Gravada', 'var(--green)'], exenta: ['Exenta', 'var(--amber)'], personal: ['Personal', 'var(--red)'], comun: ['Común', 'var(--text2)'] }
    const [lbl, col] = m[t] || m.comun
    return `<span title="Actividad fiscal (ISV)" style="display:inline-block;border:1px solid ${col};color:${col};border-radius:5px;padding:1px 6px;font-size:10px;font-weight:600;margin-left:6px">${lbl}</span>`
  }

  tbody.innerHTML = allCentros.map(c => `
    <tr style="${!c.activa ? 'opacity:0.5' : ''}">
      <td style="font-family:var(--mono);color:var(--gold);font-weight:500">${c.codigo || '—'}</td>
      <td style="font-weight:500">${c.nombre}${c.privado ? ' <span style="color:var(--red);font-size:11px" title="Centro privado — reportes solo Super Admin">🔒</span>' : ''}${actBadge(c.tipo_actividad)}</td>
      <td>${c.es_corporativo ? '<span class="badge badge-amber">Corporativo</span>' : '<span class="badge badge-blue">Operativo</span>'}</td>
      <td><span class="badge ${c.activa ? 'badge-on' : 'badge-off'}">${c.activa ? 'Activo' : 'Inactivo'}</span></td>
      <td class="mono" style="color:var(--text3);font-size:12px">${c.created_at ? new Date(c.created_at).toLocaleDateString('es-HN') : '—'}</td>
      <td style="text-align:center">
        <button onclick="editarCentro('${c.id}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="Editar">✏️</button>
        <button onclick="toggleCentro('${c.id}',${c.activa},'${c.nombre.replace(/'/g, "\\'")}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="${c.activa ? 'Desactivar' : 'Activar'}">${c.activa ? '🚫' : '✅'}</button>
      </td>
    </tr>`).join('')
}
window.loadCentrosCosto = loadCentrosCosto

window.openModalCentro = () => {
  editingCentroId = null
  document.getElementById('modal-centro-title').textContent = '🏢 Nuevo centro de costo'
  document.getElementById('btn-guardar-centro').textContent = 'Crear centro'
  document.getElementById('ncc-codigo').value = ''
  document.getElementById('ncc-nombre').value = ''
  document.getElementById('ncc-tipo-actividad').value = 'comun'
  document.getElementById('ncc-corporativo').checked = false
  document.getElementById('ncc-privado').checked = false
  document.getElementById('ncc-codigo').disabled = false
  document.getElementById('modal-centro-error').classList.add('hidden')
  document.getElementById('modal-centro').classList.add('open')
}

window.editarCentro = (id) => {
  const c = allCentros.find(x => x.id === id)
  if (!c) return
  editingCentroId = id
  document.getElementById('modal-centro-title').textContent = '✏️ Editar centro de costo'
  document.getElementById('btn-guardar-centro').textContent = 'Actualizar centro'
  document.getElementById('ncc-codigo').value = c.codigo || ''
  document.getElementById('ncc-nombre').value = c.nombre
  document.getElementById('ncc-tipo-actividad').value = ['gravada','exenta','comun','personal'].includes(c.tipo_actividad) ? c.tipo_actividad : 'comun'
  document.getElementById('ncc-corporativo').checked = c.es_corporativo || false
  document.getElementById('ncc-privado').checked = c.privado || false
  document.getElementById('ncc-codigo').disabled = false
  document.getElementById('modal-centro-error').classList.add('hidden')
  document.getElementById('modal-centro').classList.add('open')
}

window.guardarCentro = async () => {
  const codigo = document.getElementById('ncc-codigo').value.trim().toUpperCase()
  const nombre = document.getElementById('ncc-nombre').value.trim()
  const esCorporativo = document.getElementById('ncc-corporativo').checked
  const esPrivado = document.getElementById('ncc-privado').checked
  const tipoActividad = document.getElementById('ncc-tipo-actividad').value
  const err = document.getElementById('modal-centro-error')

  if (!nombre) { showError(err, 'El nombre es obligatorio'); return }

  const btn = document.getElementById('btn-guardar-centro')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'

  const payload = {
    codigo: codigo || null,
    nombre,
    es_corporativo: esCorporativo,
    privado: esPrivado,
    tipo_actividad: tipoActividad,
    activa: true
  }

  let error
  if (editingCentroId) {
    const { error: e } = await sb.from('centros_costo').update(payload).eq('id', editingCentroId)
    error = e
  } else {
    const { error: e } = await sb.from('centros_costo').insert(payload)
    error = e
  }

  btn.disabled = false
  btn.textContent = editingCentroId ? 'Actualizar centro' : 'Crear centro'

  if (error) {
    showError(err, error.message)
    return
  }

  closeModal('modal-centro')
  toast(editingCentroId ? 'Centro actualizado ✓' : 'Centro de costo creado ✓', 'success')
  editingCentroId = null
  loadCentrosCosto()
  // Recargar empresas para que los selects se actualicen en toda la app
  await loadEmpresas()
}

window.toggleCentro = async (id, activa, nombre) => {
  const accion = activa ? 'desactivar' : 'activar'
  if (!confirm(`¿${activa ? 'Desactivar' : 'Activar'} el centro "${nombre}"?\n\n${activa ? 'Ya no aparecerá en los selects de operación.' : 'Volverá a aparecer en los selects.'}`)) return

  const { error } = await sb.from('centros_costo').update({ activa: !activa }).eq('id', id)
  if (error) { toast('Error: ' + error.message, 'error'); return }

  toast(`Centro ${accion}do ✓`, 'success')
  loadCentrosCosto()
  await loadEmpresas()
}

// ── COMPRAS FORM ──

// Cache de autocompletado por tipo
let acCache = {}

// Permite a otros módulos (ej. pantalla de Proveedores) invalidar el cache
// para que un valor recién creado aparezca en el autocompletado sin recargar.
window.invalidarAcCache = (tipo) => { if (tipo) delete acCache[tipo]; else acCache = {} }

async function loadAcCache(tipo) {
  if (acCache[tipo]) return acCache[tipo]
  const { data } = await sb.from('autocomplete_valores').select('valor').eq('tipo', tipo).order('valor')
  let valores = (data || []).map(d => d.valor)
  // Para 'proveedor': combinar también con la tabla oficial de proveedores
  // (la pantalla de Proveedores es la fuente nueva). Sin duplicar nombres.
  if (tipo === 'proveedor') {
    const { data: provs } = await sb.from('proveedores').select('nombre').order('nombre').limit(5000)
    const set = new Set(valores.map(v => (v || '').toUpperCase().trim()))
    for (const p of (provs || [])) {
      const n = (p.nombre || '').toUpperCase().trim()
      if (n && !set.has(n)) { valores.push(p.nombre); set.add(n) }
    }
    valores.sort()
  }
  acCache[tipo] = valores
  return acCache[tipo]
}

async function acGuardar(tipo, valor) {
  if (!valor) return
  const v = valor.toUpperCase().trim()
  if (!v) return
  // Agregar al cache local
  if (!acCache[tipo]) acCache[tipo] = []
  if (!acCache[tipo].includes(v)) {
    acCache[tipo].push(v)
    acCache[tipo].sort()
    // Guardar en DB (ignorar error si ya existe)
    await sb.from('autocomplete_valores').insert({ tipo, valor: v }).single()
  }
}

window.acBuscar = async (input, tipo) => {
  const lista = input.parentElement.querySelector('.ac-list')
  const q = (input.value || '').toUpperCase().trim()
  const valores = await loadAcCache(tipo)
  const filtrados = q ? valores.filter(v => v.includes(q)) : valores

  if (!filtrados.length && !q) { lista.classList.add('hidden'); return }

  let html = filtrados.slice(0, 15).map(v =>
    `<div class="ac-item" onmousedown="acSelect(this,'${v.replace(/'/g, "\\'")}')"><b>${v.substring(0, q.length)}</b>${v.substring(q.length)}</div>`
  ).join('')

  if (q && !valores.includes(q)) {
    html += `<div class="ac-item ac-new" onmousedown="acSelect(this,'${q.replace(/'/g, "\\'")}')">+ Agregar "${q}"</div>`
  }

  if (html) { lista.innerHTML = html; lista.classList.remove('hidden') }
  else lista.classList.add('hidden')
}

// Autocompleta el número de factura: si compras escribió solo el correlativo
// (puros dígitos) y el proveedor tiene UN solo prefijo activo, antepone el
// prefijo y rellena el correlativo a 8 dígitos (formato SAR). Si el proveedor
// tiene varios prefijos o ninguno, deja el número como lo escribió (la auxiliar
// lo completará al verificar).
window.completarNumeroFactura = async () => {
  const numInput = document.getElementById('fc-numero')
  const provInput = document.getElementById('fc-proveedor-nombre')
  if (!numInput || !provInput) return
  const raw = (numInput.value || '').trim()
  if (!raw) return
  // Solo actuar si parece un correlativo suelto: únicamente dígitos (sin guiones
  // ni formato). Si ya tiene guiones o letras (S/F), no se toca.
  if (!/^\d+$/.test(raw)) return
  const nombre = (provInput.value || '').toUpperCase().trim()
  if (!nombre) return
  // Buscar el proveedor y sus CAI activos
  const { data: prov } = await sb.from('proveedores').select('id').eq('nombre', nombre).limit(1).maybeSingle()
  if (!prov) return
  const { data: cais } = await sb.from('proveedor_cai')
    .select('prefijo, activo').eq('proveedor_id', prov.id).eq('activo', true)
  const conPrefijo = (cais || []).filter(c => c.prefijo && c.prefijo.trim())
  // Solo autocompletar si hay EXACTAMENTE un prefijo activo (opción A)
  if (conPrefijo.length !== 1) return
  const prefijo = conPrefijo[0].prefijo.trim()
  const correlativo = raw.padStart(8, '0')   // rellenar a 8 dígitos
  numInput.value = `${prefijo}-${correlativo}`
  toast(`Número completado con el prefijo del proveedor`, 'success')
}

window.acSelect = (el, valor) => {
  const wrap = el.closest('.ac-wrap')
  const input = wrap.querySelector('input')
  input.value = valor
  el.closest('.ac-list').classList.add('hidden')
  // If it's a new value (from "+ Agregar"), save it
  if (el.classList.contains('ac-new')) {
    // Detect tipo from input id
    const id = input.id
    let tipo = null
    if (id.includes('proveedor')) tipo = 'proveedor'
    else if (id.includes('quien-pidio')) tipo = 'quien_pidio'
    else if (id.includes('tipo-gasto')) tipo = 'tipo_gasto'
    else if (id.includes('entregado')) tipo = 'entregado_a'
    if (tipo) {
      acGuardar(tipo, valor)
      toast(`"${valor}" agregado ✓`, 'success')
    }
  }
  // Si es el campo proveedor de compras, autollenar y proteger el RTN del proveedor
  if (input.id === 'fc-proveedor-nombre') aplicarRtnProveedor(valor, !el.classList.contains('ac-new'))
}

// Autollena el RTN del proveedor seleccionado (si existe en la tabla). Si el
// proveedor ya tiene RTN, el campo se bloquea para no sobrescribirlo por error.
// Si no tiene RTN (o es nuevo), el campo queda editable para capturarlo.
async function aplicarRtnProveedor(nombre, existente) {
  const rtnInput = document.getElementById('fc-rtn')
  if (!rtnInput) return
  const n = (nombre || '').toUpperCase().trim()
  if (!n) { rtnInput.value = ''; rtnInput.readOnly = false; rtnInput.title = ''; rtnInput.style.opacity = '1'; return }
  const { data } = await sb.from('proveedores').select('rtn').eq('nombre', n).limit(1).maybeSingle()
  if (data && data.rtn) {
    rtnInput.value = data.rtn
    rtnInput.readOnly = true                 // protegido: no se puede sobrescribir
    rtnInput.style.opacity = '0.7'
    rtnInput.title = 'RTN registrado del proveedor (protegido). Para cambiarlo, editá el proveedor en la pantalla Proveedores.'
  } else {
    // Proveedor sin RTN o nuevo: dejar editable para capturarlo
    rtnInput.readOnly = false
    rtnInput.style.opacity = '1'
    rtnInput.title = ''
    if (data && !data.rtn) rtnInput.value = ''   // existe pero sin RTN → vacío para que lo capturen
  }
}

window.acCerrar = (input) => {
  const lista = input.parentElement.querySelector('.ac-list')
  if (lista) lista.classList.add('hidden')
  // Forzar mayúsculas al salir
  if (input.value) input.value = input.value.toUpperCase().trim()
  // Si es el proveedor, intentar autollenar/proteger su RTN al salir del campo
  if (input.id === 'fc-proveedor-nombre') aplicarRtnProveedor(input.value, true)
}

function initForm() {
  const today = localDateStr()
  document.getElementById('fc-fecha').value = today
  // Pre-cargar caches de autocompletado
  ;['proveedor', 'quien_pidio', 'entregado_a', 'tipo_gasto'].forEach(t => loadAcCache(t))
  // Imagen: obligatoria para compras, opcional para los demás roles
  const reqLbl = document.getElementById('fc-img-req')
  if (reqLbl) reqLbl.textContent = (currentProfile?.rol === 'compras') ? '· obligatoria' : '· opcional'
  // RTN editable al iniciar
  const rtnInput = document.getElementById('fc-rtn')
  if (rtnInput) { rtnInput.readOnly = false; rtnInput.style.opacity = '1'; rtnInput.title = '' }
}

window.calcISV = () => {
  const sub = parseFloat(document.getElementById('fc-subtotal')?.value) || 0
  const isv = sub * 0.15
  const isvEl = document.getElementById('fc-isv')
  const totalEl = document.getElementById('fc-total')
  if (isvEl) isvEl.value = isv.toFixed(2)
  if (totalEl) totalEl.value = (sub + isv).toFixed(2)
}

window.togglePagoFields = () => {
  const pago = document.getElementById('fc-pago')?.value
  const banco = document.getElementById('field-banco')
  const cheque = document.getElementById('field-cheque')
  if (banco) banco.classList.toggle('hidden', pago === 'contado')
  if (cheque) cheque.classList.toggle('hidden', pago !== 'credito')
}

window.resetForm = () => {
  ;['fc-numero','fc-proveedor-nombre','fc-rtn','fc-quien-pidio','fc-descripcion','fc-monto','fc-tipo-gasto','fc-entregado-a','fc-obs'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = ''
  })
  document.getElementById('fc-file').value = ''
  document.getElementById('upload-preview').classList.add('hidden')
  document.getElementById('upload-zone').classList.remove('has-file')
  initForm()
}

window.previewFoto = (input) => {
  if (!input.files?.[0]) return
  const f = input.files[0]
  document.getElementById('preview-name').textContent = f.name
  document.getElementById('preview-size').textContent = (f.size / 1024).toFixed(0) + ' KB'
  document.getElementById('upload-preview').classList.remove('hidden')
  document.getElementById('upload-zone').classList.add('has-file')
}

// ── ARRASTRAR/SOLTAR Y PEGAR (Ctrl+V) IMÁGENES (factura y partida) ──
function setupCargaImagenes() {
  const esValido = (f) => f && (f.type.startsWith('image/') || f.type === 'application/pdf')
  // Asigna archivos a un <input type=file> (DataTransfer). append=true para no perder los previos.
  const setInputFiles = (input, files, append) => {
    const dt = new DataTransfer()
    if (append && input.files) for (const f of input.files) dt.items.add(f)
    for (const f of files) dt.items.add(f)
    input.files = dt.files
  }
  // Las capturas pegadas vienen sin nombre o como "image.png" → le ponemos uno con extensión
  const nombrarPegado = (file) => {
    if (file.name && file.name !== 'image.png' && file.name.includes('.')) return file
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
    return new File([file], `captura_${Date.now()}.${ext}`, { type: file.type })
  }
  const marcar = (el, on) => {
    if (!el) return
    el.style.outline = on ? '2px dashed var(--gold, #f5a623)' : ''
    el.style.outlineOffset = on ? '3px' : ''
  }
  const habilitarDrop = (zone, onFiles) => {
    if (!zone) return
    ;['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); marcar(zone, true) }))
    ;['dragleave', 'dragend'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); marcar(zone, false) }))
    zone.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); marcar(zone, false)
      const files = [...(e.dataTransfer?.files || [])].filter(esValido)
      if (files.length) onFiles(files)
    })
  }

  // Factura (compras): una sola imagen + preview
  const inputFc = document.getElementById('fc-file')
  habilitarDrop(document.getElementById('upload-zone'), (files) => {
    setInputFiles(inputFc, [files[0]], false)
    window.previewFoto(inputFc)
  })

  // Partida: adjunto múltiple; zona = toda la tarjeta del encabezado
  const inputPn = document.getElementById('pn-adjunto')
  const statusPn = document.getElementById('pn-adjunto-status')
  const refrescarPn = () => { if (statusPn && inputPn) statusPn.textContent = inputPn.files?.length ? `✓ ${inputPn.files.length} archivo(s) adjunto(s)` : '' }
  habilitarDrop(inputPn ? inputPn.closest('.form-card') : null, (files) => {
    setInputFiles(inputPn, files, true)
    refrescarPn()
    window.toast?.('Adjunto agregado', 'success')
  })
  inputPn?.addEventListener('change', refrescarPn)

  // Pegar (Ctrl+V): enruta al formulario que esté visible
  const visible = (el) => el && el.offsetParent !== null
  document.addEventListener('paste', e => {
    const imgItem = [...(e.clipboardData?.items || [])].find(it => it.type.startsWith('image/'))
    if (!imgItem) return
    // Si el usuario está escribiendo en un campo de texto y hay texto para pegar,
    // dejamos el pegado normal (no secuestramos como imagen).
    const ae = document.activeElement
    const enCampoTexto = ae && (
      ae.tagName === 'TEXTAREA' ||
      (ae.tagName === 'INPUT' && !['file', 'checkbox', 'radio', 'button', 'submit'].includes((ae.type || 'text').toLowerCase())) ||
      ae.isContentEditable
    )
    const hayTexto = !!(e.clipboardData?.getData?.('text/plain') || '').trim()
    if (enCampoTexto && hayTexto) return
    let target = null
    if (visible(document.getElementById('view-compras')) && inputFc) {
      target = { input: inputFc, after: () => window.previewFoto(inputFc), append: false }
    } else if (visible(document.getElementById('view-partida-nueva')) && inputPn) {
      target = { input: inputPn, after: refrescarPn, append: true }
    }
    if (!target) return
    const blob = imgItem.getAsFile()
    if (!blob) return
    e.preventDefault()
    setInputFiles(target.input, [nombrarPegado(blob)], target.append)
    target.after?.()
    window.toast?.('Imagen pegada ✓', 'success')
  })
}

window.guardarCompra = async () => {
  const fecha = document.getElementById('fc-fecha').value
  const numero = document.getElementById('fc-numero').value.trim()
  const proveedorNombre = (document.getElementById('fc-proveedor-nombre').value || '').toUpperCase().trim()
  const quienPidio = (document.getElementById('fc-quien-pidio').value || '').toUpperCase().trim()
  const descripcion = (document.getElementById('fc-descripcion').value || '').toUpperCase().trim()
  const monto = parseFloat(document.getElementById('fc-monto').value) || 0
  const tipoGasto = (document.getElementById('fc-tipo-gasto').value || '').toUpperCase().trim()
  const entregadoA = (document.getElementById('fc-entregado-a').value || '').toUpperCase().trim()
  const formaPago = document.getElementById('fc-pago').value
  const rtn = (document.getElementById('fc-rtn')?.value || '').trim()

  const btn = document.getElementById('btn-guardar-compra')
  if (!fecha) { toast('Ingresa la fecha de la factura', 'error'); return }
  if (!numero) { toast('Ingresa el número de factura', 'error'); return }
  if (!proveedorNombre) { toast('Ingresa el nombre del proveedor', 'error'); return }
  if (!quienPidio) { toast('Ingresa quién pidió la compra', 'error'); return }
  if (!descripcion) { toast('Ingresa la descripción de la compra', 'error'); return }
  if (monto <= 0) { toast('El monto debe ser mayor a 0', 'error'); return }
  if (!tipoGasto) { toast('Ingresa el tipo de gasto', 'error'); return }
  if (!entregadoA) { toast('Ingresa a quién se le entregó', 'error'); return }
  // La imagen es obligatoria solo para el rol 'compras'; los demás roles pueden
  // registrar sin imagen (la auxiliar la adjunta al verificar si hace falta).
  const esRolCompras = currentProfile?.rol === 'compras'
  if (esRolCompras && !document.getElementById('fc-file').files?.[0]) {
    toast('La imagen de la factura es obligatoria para compras', 'error'); return
  }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando...'

  // Guardar valores nuevos en autocompletado
  await Promise.all([
    acGuardar('proveedor', proveedorNombre),
    acGuardar('quien_pidio', quienPidio),
    acGuardar('entregado_a', entregadoA),
    acGuardar('tipo_gasto', tipoGasto),
  ])

  // Subir foto si existe
  let foto_url = null
  const fileInput = document.getElementById('fc-file')
  if (fileInput.files?.[0]) {
    const file = fileInput.files[0]
    const ext = file.name.split('.').pop()
    const path = `facturas/${Date.now()}.${ext}`
    const { error: uploadErr } = await sb.storage.from('facturas-compras').upload(path, file)
    if (!uploadErr) foto_url = path
  }

  const payload = {
    registrado_por: currentProfile.id,
    numero_factura: numero,
    fecha_factura: fecha,
    tipo_gasto: tipoGasto,
    forma_pago: formaPago,
    subtotal: monto,
    isv: 0,
    total: monto,
    tiene_isv: false,
    foto_url,
    observaciones: document.getElementById('fc-obs').value.trim() || null,
    quien_pidio: quienPidio,
    descripcion_compra: descripcion,
    entregado_a: entregadoA,
    rtn_proveedor: rtn || null,
    proveedor_verificado: false,
    estado: 'pendiente'
  }

  // Buscar o crear proveedor. Identificar por RTN si viene; si no, por nombre.
  let provExist = null
  if (rtn) {
    const { data } = await sb.from('proveedores').select('id, rtn').eq('rtn', rtn).limit(1).maybeSingle()
    provExist = data
  }
  if (!provExist) {
    const { data } = await sb.from('proveedores').select('id, rtn').eq('nombre', proveedorNombre).limit(1).maybeSingle()
    provExist = data
  }
  if (provExist) {
    payload.proveedor_id = provExist.id
    // Si el proveedor no tenía RTN y ahora lo capturamos, completarlo
    if (rtn && !provExist.rtn) await sb.from('proveedores').update({ rtn }).eq('id', provExist.id)
  } else {
    const { data: newProv } = await sb.from('proveedores').insert({ nombre: proveedorNombre, rtn: rtn || null }).select('id').single()
    if (newProv) payload.proveedor_id = newProv.id
  }

  const { error } = await sb.from('facturas_compras').insert(payload)
  btn.disabled = false; btn.textContent = 'Enviar solicitud →'
  if (error) { toast('Error al guardar: ' + error.message, 'error'); return }
  toast('Solicitud enviada a contabilidad ✓', 'success')
  logActividad('compra_registrada', 'compras', `${descripcion} · L. ${monto}`, null)
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
    const esContable = ['super_admin', 'contador', 'aux_contable'].includes(currentProfile?.rol)
    const clickablePartida = (esImportada && f.estado === 'pendiente') || (esContable && f.estado === 'pendiente')
    const clickAction = esContable && f.estado === 'pendiente' && !esImportada
      ? `abrirRevisarFactura('${f.id}')`
      : esImportada && f.estado === 'pendiente'
        ? `crearPartidaDesdeFactura('${f.id}')`
        : `abrirRevisarFactura('${f.id}')`
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
    <div class="pending-item ${statusClass}" ${clickablePartida ? `onclick="${clickAction}" style="cursor:pointer"` : ''}>
      <div class="pi-left">
        <div class="pi-dot ${statusClass}"></div>
        <div>
          <div class="pi-info">${provNombre || 'Sin proveedor'} · Fact. ${f.numero_factura}${f.descripcion_compra ? ' · ' + f.descripcion_compra : ''}${f.centro_costo?.nombre ? ' · ' + f.centro_costo.nombre : ''}</div>
          <div class="pi-meta">${new Date(f.created_at).toLocaleDateString('es-HN')} ${new Date(f.created_at).toLocaleTimeString('es-HN',{hour:'2-digit',minute:'2-digit'})} · ${f.registrado?.nombre || ''}${f.quien_pidio ? ' · Pidió: ' + f.quien_pidio : ''} · ${tipoLabel[f.tipo_gasto]||f.tipo_gasto} · ${f.forma_pago}${f.entregado_a ? ' · Entregado a: ' + f.entregado_a : ''}</div>
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

window.eliminarFactura = async (facturaId) => {
  const f = pendientesData.find(x => x.id === facturaId)
  const desc = f ? `${f.proveedor?.nombre || ''} · Fact. ${f.numero_factura} · L. ${parseFloat(f.total).toLocaleString('es-HN', {minimumFractionDigits:2})}` : facturaId
  if (!confirm(`¿Eliminar esta factura?\n\n${desc}\n\nEsta acción no se puede deshacer.`)) return

  // Si tiene foto, eliminar del storage
  if (f?.foto_url) {
    await sb.storage.from('facturas-compras').remove([f.foto_url])
  }

  const { error } = await sb.from('facturas_compras').delete().eq('id', facturaId)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast('Factura eliminada ✓', 'success')
  pendientesData = pendientesData.filter(x => x.id !== facturaId)
  filtrarPendientes()
}

// ── REVISAR FACTURA (MODAL AUXILIAR CONTABLE) ──
let facturaEnRevision = null
let fiscResultado = null

window.abrirRevisarFactura = async (facturaId) => {
  const f = pendientesData.find(x => x.id === facturaId)
  if (!f) return
  facturaEnRevision = f
  fiscResultado = null

  const fmt = v => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })

  // Obtener URL de la imagen si existe
  let imgHtml = '<div style="text-align:center;padding:30px;color:var(--text3)">Sin imagen adjunta</div>'
  if (f.foto_url) {
    const { data: urlData } = await sb.storage.from('facturas-compras').createSignedUrl(f.foto_url, 3600)
    if (urlData?.signedUrl) {
      imgHtml = `<img src="${urlData.signedUrl}" style="max-width:100%;max-height:400px;border-radius:var(--radius);cursor:pointer" onclick="window.open('${urlData.signedUrl}','_blank')" title="Clic para abrir en nueva pestaña">`
    }
  }

  // Construir select de centros de costo
  const centrosOpts = (empresas || []).map(e =>
    `<option value="${e.id}" ${f.centro_costo_id === e.id ? 'selected' : ''}>${e.nombre}</option>`
  ).join('')

  const html = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <!-- IZQUIERDA: Datos de la factura (editables) -->
      <div style="background:var(--bg3);border-radius:var(--radius);padding:16px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:12px;font-weight:500">Datos de la solicitud <span style="color:var(--amber);font-size:10px;text-transform:none">(editables si hay error)</span></div>
        <div style="display:grid;gap:8px">
          <div class="fld"><label style="font-size:11px;color:var(--text3)">Proveedor</label><input type="text" id="rev-proveedor" value="${f.proveedor?.nombre || ''}" style="text-transform:uppercase;font-size:13px;padding:6px 8px"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="fld"><label style="font-size:11px;color:var(--text3)">N° Factura</label><input type="text" id="rev-numero" value="${f.numero_factura || ''}" style="font-family:var(--mono);font-size:13px;padding:6px 8px"></div>
            <div class="fld"><label style="font-size:11px;color:var(--text3)">Fecha factura</label><input type="date" id="rev-fecha" value="${f.fecha_factura || ''}" style="font-size:13px;padding:6px 8px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="fld"><label style="font-size:11px;color:var(--text3)">Monto (L.)</label><input type="number" id="rev-monto" value="${f.total || 0}" step="0.01" onchange="calcISVRevision()" style="font-family:var(--mono);font-size:15px;padding:6px 8px;font-weight:600;color:var(--gold)"></div>
            <div class="fld"><label style="font-size:11px;color:var(--text3)">Tipo de gasto</label><input type="text" id="rev-tipo-gasto" value="${f.tipo_gasto || ''}" style="text-transform:uppercase;font-size:13px;padding:6px 8px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="fld"><label style="font-size:11px;color:var(--text3)">Forma de pago</label>
              <select id="rev-forma-pago" style="font-size:13px;padding:6px 8px">
                <option value="contado" ${f.forma_pago === 'contado' ? 'selected' : ''}>Contado</option>
                <option value="credito" ${f.forma_pago === 'credito' ? 'selected' : ''}>Crédito</option>
                <option value="tarjeta" ${f.forma_pago === 'tarjeta' ? 'selected' : ''}>Tarjeta</option>
              </select>
            </div>
            <div class="fld"><label style="font-size:11px;color:var(--text3)">Quién pidió</label><input type="text" id="rev-quien-pidio" value="${f.quien_pidio || ''}" style="text-transform:uppercase;font-size:13px;padding:6px 8px"></div>
          </div>
          <div class="fld"><label style="font-size:11px;color:var(--text3)">Descripción</label><input type="text" id="rev-descripcion" value="${f.descripcion_compra || ''}" style="text-transform:uppercase;font-size:13px;padding:6px 8px"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="fld"><label style="font-size:11px;color:var(--text3)">Entregado a</label><input type="text" id="rev-entregado-a" value="${f.entregado_a || ''}" style="text-transform:uppercase;font-size:13px;padding:6px 8px"></div>
            <div class="fld"><label style="font-size:11px;color:var(--text3)">Registrado por</label><input type="text" value="${f.registrado?.nombre || '—'}" disabled style="font-size:13px;padding:6px 8px;opacity:0.5"></div>
          </div>
        </div>
      </div>

      <!-- DERECHA: Imagen -->
      <div style="background:var(--bg3);border-radius:var(--radius);padding:16px;display:flex;align-items:center;justify-content:center">
        ${imgHtml}
      </div>
    </div>

    <!-- CAMPOS DEL AUXILIAR -->
    <div style="background:var(--bg3);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:12px;font-weight:500">Completar datos contables</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="fld">
          <label>Centro de costo *</label>
          <select id="rev-centro">
            <option value="">— Seleccionar —</option>
            ${centrosOpts}
          </select>
        </div>
        <div class="fld">
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="rev-tiene-isv" onchange="calcISVRevision()" style="width:16px;height:16px">
            ¿Tiene ISV?
          </label>
          <div style="margin-top:6px;font-family:var(--mono);font-size:14px;color:var(--text2)">
            ISV: <span id="rev-isv-monto">L. 0.00</span>
          </div>
        </div>
        <div class="fld">
          <label>Total con ISV</label>
          <div style="font-family:var(--mono);font-size:18px;font-weight:600;color:var(--gold);padding:8px 0" id="rev-total-final">L. ${fmt(f.total)}</div>
        </div>
      </div>
      ${f.observaciones ? `<div style="margin-top:12px;font-size:12px;color:var(--text3)">Obs: ${f.observaciones}</div>` : ''}
    </div>

    <!-- VERIFICACIÓN FISCAL (SAR) -->
    <div style="background:var(--bg3);border-radius:var(--radius);padding:16px;margin-bottom:16px;border-left:3px solid var(--gold)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--gold);font-weight:500">🛡️ Verificación fiscal (SAR)</div>
        <span id="fisc-estado-badge"></span>
      </div>
      <div id="fisc-contenido" style="font-size:13px;color:var(--text3)">Revisá el proveedor y el número, luego tocá "Verificar rango".</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="fiscVerificar()" style="font-size:12px;padding:6px 14px;border-color:var(--gold);color:var(--gold)">Verificar rango y CAI</button>
        <button class="btn btn-ghost" id="fisc-btn-imagen" onclick="document.getElementById('fisc-file').click()" style="font-size:12px;padding:6px 12px">📎 Adjuntar imagen</button>
        <input type="file" id="fisc-file" accept="image/*,.pdf" class="hidden" onchange="fiscSubirImagen(this)">
      </div>
    </div>`

  document.getElementById('modal-revisar-factura-title').textContent = `🧾 Revisar · ${f.proveedor?.nombre || 'Factura'} · ${f.numero_factura}`
  document.getElementById('revisar-factura-contenido').innerHTML = html
  const btnAnular = document.getElementById('btn-anular-factura')
  if (btnAnular) btnAnular.classList.toggle('hidden', currentProfile?.rol !== 'super_admin')
  document.getElementById('modal-revisar-factura').classList.add('open')
}

// ── VERIFICACIÓN FISCAL (SAR) ──
// Valida el número de factura contra los rangos/CAI del proveedor.
function fiscCorrelativo(num) {
  if (!num) return null
  const m = String(num).match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : null
}

window.fiscVerificar = async () => {
  const cont = document.getElementById('fisc-contenido')
  const badge = document.getElementById('fisc-estado-badge')
  if (!facturaEnRevision || !cont) return
  const nombre = (document.getElementById('rev-proveedor')?.value || '').toUpperCase().trim()
  const numero = (document.getElementById('rev-numero')?.value || '').trim()
  if (!nombre) { cont.innerHTML = '<span style="color:var(--red)">Falta el nombre del proveedor.</span>'; return }
  if (!numero) { cont.innerHTML = '<span style="color:var(--red)">Falta el número de factura.</span>'; return }

  // Buscar proveedor (por RTN de la factura si hay, si no por nombre)
  let prov = null
  const rtn = facturaEnRevision.rtn_proveedor
  if (rtn) { const { data } = await sb.from('proveedores').select('id, nombre, rtn').eq('rtn', rtn).maybeSingle(); prov = data }
  if (!prov) { const { data } = await sb.from('proveedores').select('id, nombre, rtn').eq('nombre', nombre).maybeSingle(); prov = data }
  if (!prov) {
    cont.innerHTML = `<span style="color:var(--amber)">⚠ El proveedor "${nombre}" no existe en el catálogo. Crealo en la pantalla Proveedores con su CAI y rangos, luego verificá.</span>`
    badge.innerHTML = '<span style="font-size:11px;color:var(--amber);border:1px solid var(--amber);border-radius:4px;padding:2px 8px">Sin proveedor</span>'
    fiscResultado = { ok: false, motivo: 'sin_proveedor', provId: null, caiId: null }
    return
  }

  // Traer sus CAI activos
  const { data: cais } = await sb.from('proveedor_cai').select('*').eq('proveedor_id', prov.id).eq('activo', true)
  if (!cais?.length) {
    cont.innerHTML = `<span style="color:var(--amber)">⚠ "${prov.nombre}" no tiene rangos CAI cargados. Agregalos en Proveedores para validar el crédito fiscal.</span>`
    badge.innerHTML = '<span style="font-size:11px;color:var(--amber);border:1px solid var(--amber);border-radius:4px;padding:2px 8px">Sin rangos</span>'
    fiscResultado = { ok: false, motivo: 'sin_cai', provId: prov.id, caiId: null }
    return
  }

  // Validar el número contra cada CAI
  const correlativo = fiscCorrelativo(numero)
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  let match = null, motivoFalla = null
  for (const c of cais) {
    const desde = fiscCorrelativo(c.rango_desde), hasta = fiscCorrelativo(c.rango_hasta)
    const enRango = correlativo != null && desde != null && hasta != null && correlativo >= desde && correlativo <= hasta
    // Si tiene prefijo, validar también que el número lo contenga
    const prefijoOk = !c.prefijo || String(numero).startsWith(c.prefijo)
    const vencido = c.fecha_limite && (new Date(c.fecha_limite + 'T00:00:00') < hoy)
    if (enRango && prefijoOk && !vencido) { match = c; break }
    if (enRango && prefijoOk && vencido) { motivoFalla = 'vencido'; match = c }   // cae en rango pero CAI vencido
  }

  if (match && motivoFalla !== 'vencido') {
    const fl = match.fecha_limite ? new Date(match.fecha_limite + 'T00:00:00') : null
    const dias = fl ? Math.round((fl - hoy) / 864e5) : null
    const aviso = dias != null && dias <= 30 ? ` <span style="color:${dias <= 7 ? 'var(--red)' : 'var(--amber)'}">(vence en ${dias}d)</span>` : ''
    cont.innerHTML = `<span style="color:var(--green)">✓ Factura válida.</span> Cae en el rango <span style="font-family:var(--mono)">${match.rango_desde}→${match.rango_hasta}</span>${match.sucursal ? ' · ' + match.sucursal : ''}. CAI vigente${aviso}.<div style="margin-top:10px"><button class="btn btn-gold" onclick="fiscGuardarValida()" style="font-size:12px;padding:6px 14px">Guardar verificación ✓</button></div>`
    badge.innerHTML = '<span style="font-size:11px;color:var(--green);border:1px solid var(--green);border-radius:4px;padding:2px 8px">✓ Con crédito fiscal</span>'
    fiscResultado = { ok: true, motivo: 'valido', provId: prov.id, caiId: match.id, credito: true }
  } else if (motivoFalla === 'vencido') {
    cont.innerHTML = `<span style="color:var(--red)">✗ El número cae en el rango, pero el CAI venció el ${match.fecha_limite}.</span> Esta factura no da crédito fiscal salvo que el proveedor la reemplace. Elegí cómo marcarla:` + fiscBotonesDecision()
    badge.innerHTML = '<span style="font-size:11px;color:var(--red);border:1px solid var(--red);border-radius:4px;padding:2px 8px">⚠ CAI vencido</span>'
    fiscResultado = { ok: false, motivo: 'vencido', provId: prov.id, caiId: match.id, credito: false }
  } else {
    cont.innerHTML = `<span style="color:var(--red)">✗ El número ${numero} no cae en ningún rango autorizado vigente de ${prov.nombre}.</span> Verificá el número, o si el rango es nuevo cargalo en Proveedores. Elegí cómo marcarla:` + fiscBotonesDecision()
    badge.innerHTML = '<span style="font-size:11px;color:var(--red);border:1px solid var(--red);border-radius:4px;padding:2px 8px">⚠ Fuera de rango</span>'
    fiscResultado = { ok: false, motivo: 'fuera_rango', provId: prov.id, caiId: null, credito: false }
  }
}

// Cuando la validación falla, la auxiliar decide explícitamente (fricción)
function fiscBotonesDecision() {
  return `<div style="display:flex;gap:8px;margin-top:10px">
    <button class="btn btn-ghost" onclick="fiscMarcar('sin_credito')" style="font-size:11px;padding:5px 10px;border-color:var(--red);color:var(--red)">Verificar SIN crédito fiscal</button>
    <button class="btn btn-ghost" onclick="fiscMarcar('pendiente')" style="font-size:11px;padding:5px 10px">Dejar pendiente</button>
  </div>`
}


// Guarda el resultado de verificación en la factura
window.fiscMarcar = async (decision) => {
  if (!facturaEnRevision) return
  const prof = currentProfile
  let payload = { verificado_por: prof?.id || null, verificado_fecha: new Date().toISOString() }
  if (decision === 'sin_credito') {
    payload.proveedor_verificado = true
    payload.credito_fiscal_valido = false
    payload.nota_verificacion = 'Verificada sin crédito fiscal (' + (fiscResultado?.motivo || '') + ')'
    if (fiscResultado?.provId) payload.proveedor_id = fiscResultado.provId
  } else if (decision === 'pendiente') {
    payload.proveedor_verificado = false
    payload.credito_fiscal_valido = null
    payload.nota_verificacion = 'Pendiente: ' + (fiscResultado?.motivo || '')
  }
  const { error } = await sb.from('facturas_compras').update(payload).eq('id', facturaEnRevision.id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast(decision === 'sin_credito' ? 'Marcada sin crédito fiscal' : 'Dejada pendiente', 'success')
  logActividad('factura_verificada', 'compras', `${facturaEnRevision.numero_factura} · ${decision}`)
}

// Verificación exitosa al pulsar Verificar: si fue válida, guarda con crédito fiscal
window.fiscGuardarValida = async () => {
  if (!facturaEnRevision || !fiscResultado?.ok) return
  const prof = currentProfile
  const payload = {
    proveedor_verificado: true, credito_fiscal_valido: true,
    cai_usado_id: fiscResultado.caiId || null,
    proveedor_id: fiscResultado.provId || facturaEnRevision.proveedor_id,
    verificado_por: prof?.id || null, verificado_fecha: new Date().toISOString(),
    nota_verificacion: 'Verificada con crédito fiscal'
  }
  const { error } = await sb.from('facturas_compras').update(payload).eq('id', facturaEnRevision.id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  // Actualizar ultimo_usado del CAI (para la alerta de rango agotado)
  if (fiscResultado.caiId) {
    const numero = (document.getElementById('rev-numero')?.value || '').trim()
    await sb.from('proveedor_cai').update({ ultimo_usado: numero }).eq('id', fiscResultado.caiId)
  }
  toast('Factura verificada con crédito fiscal ✓', 'success')
  logActividad('factura_verificada', 'compras', `${facturaEnRevision.numero_factura} · con crédito`)
}

// Subir imagen desde la verificación (la auxiliar la adjunta si compras no la puso)
window.fiscSubirImagen = async (input) => {
  if (!input.files?.[0] || !facturaEnRevision) return
  const file = input.files[0]
  const ext = file.name.split('.').pop()
  const path = `facturas/${Date.now()}.${ext}`
  const { error: upErr } = await sb.storage.from('facturas-compras').upload(path, file)
  if (upErr) { toast('Error subiendo imagen: ' + upErr.message, 'error'); return }
  const { error } = await sb.from('facturas_compras').update({ foto_url: path }).eq('id', facturaEnRevision.id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast('Imagen adjuntada ✓', 'success')
}

window.eliminarFacturaDesdeModal = async () => {
  if (!facturaEnRevision) return
  if (currentProfile?.rol !== 'super_admin') { toast('Solo Super Admin puede anular facturas', 'error'); return }
  const id = facturaEnRevision.id
  closeModal('modal-revisar-factura')
  facturaEnRevision = null
  await eliminarFactura(id)
}

window.calcISVRevision = () => {
  const tieneISV = document.getElementById('rev-tiene-isv').checked
  const monto = parseFloat(document.getElementById('rev-monto').value) || 0
  const fmt = v => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })

  if (tieneISV) {
    const subtotal = Math.round((monto / 1.15) * 100) / 100
    const isv = Math.round((monto - subtotal) * 100) / 100
    document.getElementById('rev-isv-monto').textContent = `L. ${fmt(isv)}`
    document.getElementById('rev-total-final').textContent = `L. ${fmt(monto)} (Sub: ${fmt(subtotal)} + ISV: ${fmt(isv)})`
  } else {
    document.getElementById('rev-isv-monto').textContent = 'L. 0.00'
    document.getElementById('rev-total-final').textContent = `L. ${fmt(monto)}`
  }
}

window.procesarFacturaAux = async () => {
  const f = facturaEnRevision
  if (!f) return

  const centroCostoId = document.getElementById('rev-centro').value
  if (!centroCostoId) { toast('Selecciona el centro de costo', 'error'); return }

  const tieneISV = document.getElementById('rev-tiene-isv').checked
  const monto = parseFloat(document.getElementById('rev-monto').value) || 0
  let subtotal = monto, isv = 0
  if (tieneISV) {
    subtotal = Math.round((monto / 1.15) * 100) / 100
    isv = Math.round((monto - subtotal) * 100) / 100
  }

  // Leer todos los campos editables
  const proveedorNombre = (document.getElementById('rev-proveedor').value || '').toUpperCase().trim()
  const numeroFactura = document.getElementById('rev-numero').value.trim()
  const fechaFactura = document.getElementById('rev-fecha').value
  const tipoGasto = (document.getElementById('rev-tipo-gasto').value || '').toUpperCase().trim()
  const formaPago = document.getElementById('rev-forma-pago').value
  const quienPidio = (document.getElementById('rev-quien-pidio').value || '').toUpperCase().trim()
  const descripcion = (document.getElementById('rev-descripcion').value || '').toUpperCase().trim()
  const entregadoA = (document.getElementById('rev-entregado-a').value || '').toUpperCase().trim()

  const btn = document.getElementById('btn-procesar-factura')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Procesando...'

  // Actualizar proveedor si cambió
  let proveedorId = f.proveedor_id
  if (proveedorNombre && proveedorNombre !== (f.proveedor?.nombre || '').toUpperCase()) {
    const { data: provExist } = await sb.from('proveedores').select('id').eq('nombre', proveedorNombre).limit(1).single()
    if (provExist) {
      proveedorId = provExist.id
    } else {
      const { data: newProv } = await sb.from('proveedores').insert({ nombre: proveedorNombre }).select('id').single()
      if (newProv) proveedorId = newProv.id
    }
  }

  // Actualizar la factura con todos los datos
  const { error } = await sb.from('facturas_compras').update({
    centro_costo_id: centroCostoId,
    proveedor_id: proveedorId,
    numero_factura: numeroFactura,
    fecha_factura: fechaFactura,
    tipo_gasto: tipoGasto,
    forma_pago: formaPago,
    quien_pidio: quienPidio,
    descripcion_compra: descripcion,
    entregado_a: entregadoA,
    tiene_isv: tieneISV,
    subtotal,
    isv,
    total: monto,
    estado: 'pendiente'
  }).eq('id', f.id)

  btn.disabled = false; btn.textContent = 'Aprobar y crear partida →'

  if (error) { toast('Error: ' + error.message, 'error'); return }

  // Actualizar datos locales
  f.centro_costo_id = centroCostoId
  f.numero_factura = numeroFactura
  f.fecha_factura = fechaFactura
  f.tipo_gasto = tipoGasto
  f.forma_pago = formaPago
  f.quien_pidio = quienPidio
  f.descripcion_compra = descripcion
  f.entregado_a = entregadoA
  f.tiene_isv = tieneISV
  f.subtotal = subtotal
  f.isv = isv
  f.total = monto

  closeModal('modal-revisar-factura')
  facturaEnRevision = null

  // Ahora abrir el flujo de crear partida existente
  crearPartidaDesdeFactura(f.id)
}

// ── CREAR PARTIDA DESDE FACTURA PENDIENTE (CONTADO IMPORTADAS) ──
window.crearPartidaDesdeFactura = async (facturaId) => {
  // Cargar factura
  const { data: factura, error } = await sb.from('facturas_compras')
    .select('*, proveedor_rel:proveedores(nombre)')
    .eq('id', facturaId)
    .single()
  if (error || !factura) { toast('Error al cargar factura', 'error'); return }
  // Set proveedor name from relation or direct field
  if (!factura.proveedor && factura.proveedor_rel?.nombre) factura.proveedor = factura.proveedor_rel.nombre

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

  // Llenar encabezado con proveedor + descripción
  document.getElementById('pn-fecha').value = factura.fecha_factura
  const prov = (factura.proveedor || '').toUpperCase()
  const desc = (factura.descripcion_compra || productosDesc || obs).toUpperCase()
  document.getElementById('pn-descripcion').value = prov && desc ? `${prov} · ${desc}` : prov || desc || obs
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

  // ── PASAR IMAGEN DE FACTURA AL ADJUNTO DE LA PARTIDA ──
  window._facturaFotoUrl = factura.foto_url || null
  const adjuntoLink = document.getElementById('pn-adjunto-link')
  const adjuntoStatus = document.getElementById('pn-adjunto-status')
  if (document.getElementById('pn-adjunto')) document.getElementById('pn-adjunto').value = ''
  if (factura.foto_url) {
    const { data: urlData } = await sb.storage.from('facturas-compras').createSignedUrl(factura.foto_url, 3600)
    if (urlData?.signedUrl && adjuntoLink) {
      adjuntoLink.href = urlData.signedUrl
      adjuntoLink.style.display = 'inline'
      adjuntoLink.textContent = '📷 Ver foto de factura (se adjuntará automáticamente)'
      if (adjuntoStatus) adjuntoStatus.textContent = '✓ Imagen de factura vinculada'
    }
  } else {
    if (adjuntoLink) adjuntoLink.style.display = 'none'
    if (adjuntoStatus) adjuntoStatus.textContent = ''
  }

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

// ESC key closes the topmost open modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const openModals = document.querySelectorAll('.modal-backdrop.open')
    if (openModals.length) {
      openModals[openModals.length - 1].classList.remove('open')
    }
  }
})
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

// PostgREST corta cada respuesta a ~1000 filas y .limit() no sube ese tope. Para traer
// el listado completo hay que paginar. buildQuery() debe devolver una consulta NUEVA con
// un .order estable (incluyendo un desempate único como id) en cada llamada.
async function _fetchAllPag(buildQuery, pageSize = 1000) {
  const all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || !data.length) break
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}

async function loadPartidas() {
  const tbody = document.getElementById('tbody-partidas')
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'
  let data
  try {
    data = await _fetchAllPag(() => {
      let q = sb.from('partidas_contables')
        .select('*, centro_costo:centros_costo(nombre), generador:usuarios!generada_por(nombre)')
        .order('numero_partida', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })   // desempate único para paginar sin perder filas
      // Si el usuario tiene "solo sus partidas", filtrar por las que él generó
      if (window._soloSusPartidas && currentProfile?.id) q = q.eq('generada_por', currentProfile.id)
      return q
    })
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--red)">${error.message}</td></tr>`; return
  }
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

// Marca/desmarca una partida como SENSIBLE (visible solo para super_admin).
// El bloqueo real lo hace la RLS; esto es la UI para prenderlo/apagarlo.
window.toggleSensible = async (id, valor) => {
  const v = (valor === true || valor === 'true')
  if (currentProfile?.rol !== 'super_admin') { toast('Solo super admin puede marcar partidas sensibles', 'error'); return }
  const msg = v
    ? '¿Marcar esta partida como SENSIBLE? Solo los super admin podrán verla; desaparece para el resto (listados, detalle y reportes).'
    : '¿Quitar la marca de sensible? Volverá a ser visible para todos los roles con acceso a partidas.'
  if (!confirm(msg)) return
  const { error } = await sb.from('partidas_contables').update({ es_sensible: v }).eq('id', id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  const p = allPartidas.find(x => x.id === id); if (p) p.es_sensible = v
  toast(v ? '🔒 Partida marcada como sensible' : '🔓 Partida visible para todos', 'success')
  logActividad(v ? 'marcar_sensible' : 'quitar_sensible', 'partidas', `Partida ${p?.numero_partida || id} ${v ? 'marcada sensible' : 'desmarcada'}`, id)
  filtrarPartidas()
}

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

  _partidasPagina = 1
  renderPartidasTable(filtered)
}

window.limpiarFiltrosPartidas = () => {
  ['fp-buscar','fp-desde','fp-hasta'].forEach(id => { const el = document.getElementById(id); if(el) el.value = '' })
  ;['fp-estado','fp-origen'].forEach(id => { const el = document.getElementById(id); if(el) el.value = '' })
  filtrarPartidas()
}

let _partidasFiltradas = []
let _partidasPagina = 1
const PARTIDAS_POR_PAGINA = 50

function renderPartidasTable(data) {
  _partidasFiltradas = data || []
  _renderPaginaPartidas()
}

window.partidasIrPagina = (delta) => {
  const totalPag = Math.max(1, Math.ceil(_partidasFiltradas.length / PARTIDAS_POR_PAGINA))
  _partidasPagina = Math.min(totalPag, Math.max(1, _partidasPagina + delta))
  _renderPaginaPartidas()
  document.getElementById('partidas-scroll')?.scrollTo({ top: 0 })
}

function _renderPaginaPartidas() {
  const tbody = document.getElementById('tbody-partidas')
  const countEl = document.getElementById('fp-count')
  const pagEl = document.getElementById('partidas-paginacion')
  const data = _partidasFiltradas
  const esSuper = currentProfile?.rol === 'super_admin'
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3)">No hay partidas con estos filtros</td></tr>'
    if (countEl) countEl.textContent = '0 resultados'
    if (pagEl) pagEl.innerHTML = ''
    return
  }
  if (countEl) countEl.textContent = data.length === allPartidas.length ? '' : `${data.length} de ${allPartidas.length}`

  const totalPag = Math.max(1, Math.ceil(data.length / PARTIDAS_POR_PAGINA))
  if (_partidasPagina > totalPag) _partidasPagina = totalPag
  const ini = (_partidasPagina - 1) * PARTIDAS_POR_PAGINA
  const pageData = data.slice(ini, ini + PARTIDAS_POR_PAGINA)

  const getOrigenLabel = (id) => { const t = tiposOrigen.find(x => x.id === id); return t ? t.nombre : id }
  const estadoBadge = { borrador:'badge-amber', aprobada:'badge-green', rechazada:'badge-red', pendiente_caja:'badge-amber', pendiente_anulacion:'badge-red', anulada:'badge-red' }
  const estadoLabel = { pendiente_caja:'⏳ Pend. caja', pendiente_anulacion:'⚠ Pend. anulación', anulada:'✕ Anulada' }
  tbody.innerHTML = pageData.map(p => `
    <tr style="cursor:pointer" onclick="verPartida('${p.id}')">
      <td class="mono" style="color:var(--gold)">${p.numero_partida || '—'}</td>
      <td class="mono" style="color:var(--text3)">${new Date(p.fecha_partida + 'T12:00:00').toLocaleDateString('es-HN')}</td>
      <td style="color:var(--text);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.es_sensible ? '<span title="Partida sensible — solo super admin" style="margin-right:5px">🔒</span>' : ''}${p.descripcion}</td>
      <td><span class="badge badge-blue" style="font-size:10px">${getOrigenLabel(p.tipo_origen)}</span></td>
      <td class="mono" style="font-weight:500">L. ${parseFloat(p.total).toLocaleString('es-HN',{minimumFractionDigits:2})}</td>
      <td style="display:flex;align-items:center;gap:8px"><span class="badge ${estadoBadge[p.estado]||'badge-amber'}">${estadoLabel[p.estado] || p.estado}</span><button onclick="event.stopPropagation();editarPartida('${p.id}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px" title="Editar">✏️</button>${esSuper ? `<button onclick="event.stopPropagation();window.toggleSensible('${p.id}', ${p.es_sensible ? 'false' : 'true'})" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px" title="${p.es_sensible ? 'Quitar sensible (la verán todos)' : 'Marcar sensible (solo super admin)'}">${p.es_sensible ? '🔒' : '🔓'}</button>` : ''}</td>
    </tr>`).join('')

  if (pagEl) {
    if (totalPag <= 1) {
      pagEl.innerHTML = `<span>${data.length} partida${data.length === 1 ? '' : 's'}</span>`
    } else {
      const desde = ini + 1, hastaN = Math.min(ini + PARTIDAS_POR_PAGINA, data.length)
      pagEl.innerHTML = `
        <span>Mostrando ${desde}–${hastaN} de ${data.length}</span>
        <span style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-ghost" style="padding:4px 10px" ${_partidasPagina <= 1 ? 'disabled' : ''} onclick="window.partidasIrPagina(-1)">← Anterior</button>
          <span>Página ${_partidasPagina} de ${totalPag}</span>
          <button class="btn btn-ghost" style="padding:4px 10px" ${_partidasPagina >= totalPag ? 'disabled' : ''} onclick="window.partidasIrPagina(1)">Siguiente →</button>
        </span>`
    }
  }
}

async function initPartidaNueva() {
  editingPartidaId = null
  window._facturaFotoUrl = null
  document.getElementById('pn-title').textContent = 'Nueva partida contable'
  const btnElim = document.getElementById('btn-eliminar-partida')
  if (btnElim) btnElim.classList.add('hidden')
  document.getElementById('pn-fecha').value = new Date().toLocaleDateString('en-CA')
  document.getElementById('pn-descripcion').value = ''
  document.getElementById('pn-documento').value = ''
  document.getElementById('pn-origen').value = 'compra'
  // Limpiar adjuntos
  const adjInput = document.getElementById('pn-adjunto')
  if (adjInput) adjInput.value = ''
  const adjLink = document.getElementById('pn-adjunto-link')
  if (adjLink) adjLink.style.display = 'none'
  const adjStatus = document.getElementById('pn-adjunto-status')
  if (adjStatus) adjStatus.innerHTML = ''
  const descIndCheck = document.getElementById('pn-desc-individual')
  if (descIndCheck) descIndCheck.checked = false
  partidaLineas = []
  lineaCounter = 0
  // Load cuentas detalle for selector
  if (!cuentasDetalle.length) {
    const { data } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').eq('es_detalle', true).order('codigo')
    cuentasDetalle = data || []
  }
  // Start with 2 empty lines
  addLinea(); addLinea()
  calcTotales()
}
window.initPartidaNueva = initPartidaNueva

window.nuevaPartida = () => {
  editingPartidaId = null
  window._facturaContadoId = null
  showView('partida-nueva', 'Nueva partida')
}

// Retorno genérico desde el editor de partidas. Si otra pantalla fijó
// window._origenPartida = {view, label, init}, se regresa ahí (y se limpia).
function _retornoPartida(fallback) {
  const o = window._origenPartida
  if (o && o.view) {
    window._origenPartida = null
    showView(o.view, o.label || '')
    if (o.init && typeof window[o.init] === 'function') window[o.init]()
    return true
  }
  return false
}

window.volverDesdePartida = () => {
  if (_retornoPartida()) return
  if (window._facturaContadoId) {
    window._facturaContadoId = null
    showView('pendientes', 'Facturas pendientes')
  } else {
    showView('partidas', 'Partidas contables')
  }
}

// ── EDITAR PARTIDA EXISTENTE ──
window.verPartida = async (id) => {
  const sb = getSb()
  const { data: p } = await sb.from('partidas_contables').select('*').eq('id', id).single()
  if (!p) { toast('Partida no encontrada', 'error'); return }
  const { data: lineas } = await sb.from('lineas_partida').select('*').eq('partida_id', id).order('id')
  const { data: ccData } = await sb.from('centros_costo').select('id, nombre')
  const ccMap = Object.fromEntries((ccData || []).map(c => [c.id, c.nombre]))
  const fmtM = v => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fecha = p.fecha_partida ? new Date(p.fecha_partida + 'T12:00:00').toLocaleDateString('es-HN') : '—'
  const estadoBadge = { aprobada: 'badge-on', borrador: 'badge-amber', pendiente_caja: 'badge-blue', anulada: 'badge-off' }

  // Adjuntos
  let adjuntosHtml = ''
  if (p.adjunto_url) {
    const paths = p.adjunto_url.split(',').filter(Boolean)
    const links = []
    for (let i = 0; i < paths.length; i++) {
      const { data: su } = await sb.storage.from('facturas-compras').createSignedUrl(paths[i].trim(), 3600)
      if (su?.signedUrl) links.push(`<a href="${su.signedUrl}" target="_blank" style="color:var(--blue);font-size:12px">📷 Adjunto ${i + 1}</a>`)
    }
    if (links.length) adjuntosHtml = `<div style="margin-top:10px">${links.join(' &nbsp;|&nbsp; ')}</div>`
  }

  document.getElementById('mvp-title').textContent = `Partida #${p.numero_partida || '—'}`
  document.getElementById('mvp-contenido').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;padding:14px;background:var(--bg3);border-radius:var(--radius)">
      <div><span style="color:var(--text3);font-size:11px">Fecha</span><div>${fecha}</div></div>
      <div><span style="color:var(--text3);font-size:11px">Tipo de origen</span><div>${p.tipo_origen || '—'}</div></div>
      <div><span style="color:var(--text3);font-size:11px">Nro. Documento</span><div style="font-family:var(--mono);font-size:12px">${p.numero_documento || '—'}</div></div>
      <div><span style="color:var(--text3);font-size:11px">Estado</span><div><span class="badge ${estadoBadge[p.estado] || ''}">${p.estado}</span></div></div>
      <div class="col-full"><span style="color:var(--text3);font-size:11px">Descripción</span><div>${p.descripcion || '—'}</div></div>
    </div>
    ${adjuntosHtml}
    <table style="width:100%;margin-top:10px">
      <thead><tr>
        <th style="text-align:left">Cuenta</th>
        <th>Centro costo</th>
        <th style="text-align:right">Debe</th>
        <th style="text-align:right">Haber</th>
      </tr></thead>
      <tbody>${(lineas || []).map(l => {
        const debe = l.tipo === 'debito' ? parseFloat(l.monto) || 0 : 0
        const haber = l.tipo === 'credito' ? parseFloat(l.monto) || 0 : 0
        return `<tr>
          <td style="font-size:12px"><span style="font-family:var(--mono);color:var(--gold)">${l.cuenta_codigo}</span> ${l.cuenta_nombre}</td>
          <td style="text-align:center;font-size:11px;color:var(--text3)">${l.centro_costo_id ? ccMap[l.centro_costo_id] || '—' : '—'}</td>
          <td style="text-align:right;font-family:var(--mono);font-size:12px${debe ? ';color:var(--green)' : ''}">${debe ? 'L. ' + fmtM(debe) : ''}</td>
          <td style="text-align:right;font-family:var(--mono);font-size:12px${haber ? ';color:var(--red)' : ''}">${haber ? 'L. ' + fmtM(haber) : ''}</td>
        </tr>
        ${l.descripcion && l.descripcion !== p.descripcion ? `<tr><td colspan="4" style="padding:2px 8px 8px;font-size:11px;color:var(--text3);font-style:italic">${l.descripcion}</td></tr>` : ''}`
      }).join('')}</tbody>
      <tfoot><tr style="background:var(--bg3);font-weight:600">
        <td colspan="2" style="text-align:right">TOTALES</td>
        <td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${fmtM((lineas || []).filter(l => l.tipo === 'debito').reduce((s, l) => s + (parseFloat(l.monto) || 0), 0))}</td>
        <td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${fmtM((lineas || []).filter(l => l.tipo === 'credito').reduce((s, l) => s + (parseFloat(l.monto) || 0), 0))}</td>
      </tr></tfoot>
    </table>`
  document.getElementById('modal-ver-partida').classList.add('open')
}

let _editPartidaEnCurso = false
window.editarPartida = async (id) => {
  if (_editPartidaEnCurso) return // evita doble clic que duplica las líneas
  _editPartidaEnCurso = true
  setTimeout(() => { _editPartidaEnCurso = false }, 8000) // seguro: liberar aunque algo falle
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
  if (pErr || !partida) { toast('Error al cargar partida', 'error'); _editPartidaEnCurso = false; return }

  // Cargar líneas
  const { data: lineas, error: lErr } = await sb.from('lineas_partida')
    .select('*')
    .eq('partida_id', id)
    .order('id')
  if (lErr) { toast('Error al cargar líneas', 'error'); _editPartidaEnCurso = false; return }

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

  // Mostrar adjuntos existentes (pueden ser múltiples separados por coma)
  const adjuntoLink = document.getElementById('pn-adjunto-link')
  const adjuntoStatus = document.getElementById('pn-adjunto-status')
  document.getElementById('pn-adjunto').value = ''
  if (partida.adjunto_url) {
    const paths = partida.adjunto_url.split(',').filter(Boolean)
    const links = []
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i].trim()
      const { data: signedUrl } = await sb.storage.from('facturas-compras').createSignedUrl(p, 3600)
      if (signedUrl?.signedUrl) {
        links.push(`<span style="display:inline-flex;align-items:center;gap:4px"><a href="${signedUrl.signedUrl}" target="_blank" style="font-size:11px;color:var(--blue)">📷 Adjunto ${i + 1}</a><button onclick="eliminarAdjuntoPartida('${p.replace(/'/g, "\\'")}')" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:11px;padding:2px 4px" title="Eliminar adjunto">✕</button></span>`)
      }
    }
    if (links.length) {
      adjuntoLink.style.display = 'none'
      adjuntoStatus.innerHTML = links.join(' &nbsp;|&nbsp; ')
    }
  } else {
    adjuntoLink.style.display = 'none'
    adjuntoStatus.textContent = ''
  }

  // Cargar líneas en el formulario
  partidaLineas = []
  lineaCounter = 0

  // Cargar conteos de billetes existentes para esta partida
  const { data: conteosExist } = await sb.from('conteo_billetes')
    .select('*')
    .eq('partida_id', id)

  for (const l of lineas) {
    lineaCounter++
    const lineaObj = {
      id: lineaCounter,
      cuenta_id: l.cuenta_id || '',
      cuenta_codigo: l.cuenta_codigo || '',
      cuenta_nombre: l.cuenta_nombre || '',
      tipo: l.tipo,
      monto: parseFloat(l.monto) || 0,
      centro_costo_id: l.centro_costo_id || '',
      descripcion: l.descripcion || '',
      aplica_fiscal: l.aplica_fiscal !== false,
      _fromDB: true // Marca que esta línea ya existía en la BD
    }
    // Si es cuenta de caja y hay conteo guardado, restaurar billetes
    if (esCuentaCaja(l.cuenta_codigo) && conteosExist?.length) {
      const tipoEsperado = l.tipo === 'debito' ? 'ingreso' : 'egreso'
      const conteo = conteosExist.find(c => c.tipo === tipoEsperado)
      if (conteo) {
        lineaObj.billetes = {
          500: conteo.den_500 || 0,
          200: conteo.den_200 || 0,
          100: conteo.den_100 || 0,
          50: conteo.den_50 || 0,
          20: conteo.den_20 || 0,
          10: conteo.den_10 || 0,
          5: conteo.den_5 || 0,
          2: conteo.den_2 || 0,
          1: conteo.den_1 || 0,
          _cheques: parseFloat(conteo.den_cheques) || 0
        }
      }
    }
    partidaLineas.push(lineaObj)
  }

  // Detectar si las líneas tienen descripciones individuales distintas
  const descCheck = document.getElementById('pn-desc-individual')
  if (descCheck) {
    const descs = partidaLineas.map(l => (l.descripcion || '').trim()).filter(Boolean)
    const tieneIndividuales = descs.length > 0 && new Set(descs).size > 1
    descCheck.checked = tieneIndividuales
  }

  renderLineas()
  calcTotales()

  // Mostrar botón eliminar/anular cuando editamos
  const btnElim = document.getElementById('btn-eliminar-partida')
  if (btnElim) {
    btnElim.classList.remove('hidden')
    const tocaCaja = partidaLineas.some(l => esCuentaCaja(l.cuenta_codigo) && l.monto > 0)
    if (currentProfile?.rol === 'aux_contable' || (tocaCaja && currentProfile?.rol !== 'super_admin')) {
      btnElim.textContent = 'Solicitar anulación'
    } else {
      btnElim.textContent = 'Anular partida'
    }
  }

  // Botón aprobar partida
  const btnAprobar = document.getElementById('btn-aprobar-partida')
  if (btnAprobar) {
    btnAprobar.textContent = 'Aprobar partida ✓'
  }
  _editPartidaEnCurso = false
}

window.eliminarPartida = async () => {
  if (!editingPartidaId) return
  const rol = currentProfile?.rol
  const esSuperAdmin = rol === 'super_admin'

  // Verificar si la partida tiene líneas de caja
  const tocaCaja = partidaLineas.some(l => esCuentaCaja(l.cuenta_codigo) && l.monto > 0)

  if (tocaCaja) {
    // ── Partidas con Caja General: NUNCA eliminar, solo anular ──
    if (esSuperAdmin) {
      if (!confirm('Esta partida afecta Caja General.\n\n¿Anular esta partida?\nEl correlativo se mantendrá con estado "anulada".')) return
      const { error } = await sb.from('partidas_contables').update({
        estado: 'anulada',
        modificada_por: currentProfile.id,
        modificada_at: new Date().toISOString(),
      }).eq('id', editingPartidaId)
      if (error) { toast('Error: ' + error.message, 'error'); return }
      await limpiarDatosImportacion(editingPartidaId)
      toast('Partida anulada ✓ (correlativo preservado)', 'success')
    logActividad('partida_anulada', 'partidas', `Partida #${partida.numero_partida} anulada`, partida.id)
    } else {
      // Otros roles: solicitar anulación al super_admin
      if (!confirm('Esta partida afecta Caja General.\n\n¿Solicitar anulación?\nUn Super Admin deberá aprobar la anulación.')) return
      const { error } = await sb.from('partidas_contables').update({
        estado: 'pendiente_anulacion',
        modificada_por: currentProfile.id,
        modificada_at: new Date().toISOString(),
      }).eq('id', editingPartidaId)
      if (error) { toast('Error: ' + error.message, 'error'); return }
      toast('Anulación solicitada · Pendiente de aprobación por Super Admin', 'info')
    }
  } else if (rol === 'aux_contable') {
    // Auxiliar no puede eliminar — solo solicitar anulación
    if (!confirm('¿Solicitar anulación de esta partida?\n\nUn superior deberá aprobar la anulación.')) return
    const { error } = await sb.from('partidas_contables').update({
      estado: 'pendiente_anulacion',
      modificada_por: currentProfile.id,
      modificada_at: new Date().toISOString(),
    }).eq('id', editingPartidaId)
    if (error) { toast('Error: ' + error.message, 'error'); return }
    toast('Anulación solicitada · Pendiente de aprobación', 'info')
  } else {
    // Super admin / contador: partidas SIN caja pueden anular o eliminar
    const accion = confirm('¿Qué deseas hacer con esta partida?\n\n• Aceptar = ANULAR (preserva correlativo)\n• Cancelar para volver')
    if (!accion) return
    const { error } = await sb.from('partidas_contables').update({
      estado: 'anulada',
      modificada_por: currentProfile.id,
      modificada_at: new Date().toISOString(),
    }).eq('id', editingPartidaId)
    if (error) { toast('Error: ' + error.message, 'error'); return }
    await limpiarDatosImportacion(editingPartidaId)
    toast('Partida anulada ✓', 'success')
  }
  editingPartidaId = null
  if (_retornoPartida()) return
  showView('partidas', 'Partidas contables')
}

// ── LIMPIEZA DE DATOS DE IMPORTACIÓN AL ANULAR ──
// Cuando se anula una partida generada por importación, se borran los datos
// vinculados en las tablas de detalle para evitar duplicados en reportes.
async function limpiarDatosImportacion(partidaId) {
  if (!partidaId) return
  // Facturas taxis (detalle por unidad)
  await sb.from('facturas_taxis').delete().eq('partida_id', partidaId)
  // Facturas taxis resumen (MANO DE OBRA, FACTURAS DE TAXIS, etc.)
  await sb.from('facturas_taxis_resumen').delete().eq('partida_id', partidaId)
  // Entregas taxis (si aplica)
  await sb.from('entregas_taxis').update({ partida_id: null }).eq('partida_id', partidaId)
  // Conteo billetes (si aplica)
  await sb.from('conteo_billetes').delete().eq('partida_id', partidaId)
  console.log(`[LIMPIEZA] Datos de importación limpiados para partida ${partidaId}`)
}

window.toggleAllFiscal = (checked) => {
  document.querySelectorAll('.fiscal-check').forEach(cb => {
    cb.checked = checked
    cb.dispatchEvent(new Event('change'))
  })
}

window.toggleDescIndividual = (checked) => {
  if (checked) {
    // Al activar, copiar descripción general a todas las líneas que no tengan una propia
    const descGeneral = document.getElementById('pn-descripcion').value.trim().toUpperCase()
    if (descGeneral) {
      partidaLineas.forEach(l => { if (!l.descripcion) l.descripcion = descGeneral })
    }
  }
  renderLineas()
}

window.addLinea = () => {
  lineaCounter++
  const id = lineaCounter
  // Agregar al inicio (arriba) para que el dropdown no quede cortado
  partidaLineas.unshift({ id, cuenta_id:'', cuenta_codigo:'', cuenta_nombre:'', tipo:'debito', monto:0, centro_costo_id:'', descripcion:'', aplica_fiscal:true })
  renderLineas()
}

window.removeLinea = (id) => {
  const l = partidaLineas.find(x => x.id === id)
  // No permitir eliminar línea de caja a usuarios no super_admin
  if (l && esCuentaCaja(l.cuenta_codigo) && currentProfile?.rol !== 'super_admin') {
    toast('Solo Super Admin puede eliminar líneas de Caja General', 'error')
    return
  }
  partidaLineas = partidaLineas.filter(l => l.id !== id)
  renderLineas()
  calcTotales()
}

// Filtro visual de líneas del asiento (no toca partidaLineas ni el cuadre)
window.aplicarFiltroLineas = () => {
  const q = (document.getElementById('pn-filtro-lineas')?.value || '').trim().toLowerCase()
  const tbody = document.getElementById('tbody-lineas')
  if (!tbody) return
  let visibles = 0, total = 0
  tbody.querySelectorAll('tr.linea-row').forEach(tr => {
    total++
    const txt = tr.getAttribute('data-busqueda') || ''
    const show = !q || txt.includes(q)
    tr.style.display = show ? '' : 'none'
    if (show) visibles++
    // ocultar también su fila de descripción individual (la siguiente hermana)
    const sig = tr.nextElementSibling
    if (sig && sig.classList.contains('linea-desc-row')) sig.style.display = show ? '' : 'none'
  })
  const info = document.getElementById('pn-filtro-info')
  if (info) info.textContent = q ? `${visibles} de ${total}` : ''
}

function renderLineas() {
  const tbody = document.getElementById('tbody-lineas')
  const esSuperAdmin = currentProfile?.rol === 'super_admin'
  const esAuxContable = currentProfile?.rol === 'aux_contable'
  tbody.innerHTML = partidaLineas.map(l => {
    const debeVal = l.tipo === 'debito' && l.monto ? l.monto : ''
    const haberVal = l.tipo === 'credito' && l.monto ? l.monto : ''
    const esCaja = esCuentaCaja(l.cuenta_codigo)
    const esCajaChica = l.cuenta_codigo === CUENTA_CAJA_CHICA

    // ── Política de Caja General ──
    // Super Admin: control total (botones 💵 en debe y haber, puede editar todo)
    // Otros roles: pueden AGREGAR nuevas líneas de caja (solo ingreso/débito con conteo)
    //              NO pueden modificar líneas de caja que ya existían en la BD (_fromDB)
    // ── Política de Caja Chica ──
    // Aux. Contable: control total de caja chica (debe y haber)
    // Otros roles: solo débito en caja chica, haber bloqueado
    const cajaReadonly = esCaja && !esSuperAdmin && !(esCajaChica && esAuxContable) && l._fromDB

    let debeInput, haberInput

    if (esCajaChica && esAuxContable) {
      // Aux. Contable es dueña de caja chica: control total con botón 💵
      debeInput = `<div style="display:flex;gap:4px;align-items:center">
          <input type="text" inputmode="decimal" value="${debeVal}" placeholder="0.00"
            oninput="setDebe(${l.id},this.value)" style="text-align:right;font-family:var(--mono);flex:1">
          <button onclick="openCajaDebe(${l.id})" title="Contar billetes" style="width:28px;height:28px;border-radius:6px;border:0.5px solid var(--green);background:transparent;color:var(--green);cursor:pointer;font-size:13px;flex-shrink:0">💵</button>
        </div>`
      haberInput = `<div style="display:flex;gap:4px;align-items:center">
          <input type="text" inputmode="decimal" value="${haberVal}" placeholder="0.00"
            oninput="setHaber(${l.id},this.value)" style="text-align:right;font-family:var(--mono);flex:1">
          <button onclick="openCajaHaber(${l.id})" title="Contar billetes" style="width:28px;height:28px;border-radius:6px;border:0.5px solid var(--red);background:transparent;color:var(--red);cursor:pointer;font-size:13px;flex-shrink:0">💵</button>
        </div>`
    } else if (esCaja && esSuperAdmin && !esCajaChica) {
      // Super Admin: botones 💵 en ambos lados (solo caja general; la caja chica la cuenta su responsable)
      debeInput = `<div style="display:flex;gap:4px;align-items:center">
          <input type="text" inputmode="decimal" value="${debeVal}" placeholder="0.00"
            oninput="setDebe(${l.id},this.value)" style="text-align:right;font-family:var(--mono);flex:1">
          <button onclick="openCajaDebe(${l.id})" title="Contar billetes" style="width:28px;height:28px;border-radius:6px;border:0.5px solid var(--green);background:transparent;color:var(--green);cursor:pointer;font-size:13px;flex-shrink:0">💵</button>
        </div>`
      haberInput = `<div style="display:flex;gap:4px;align-items:center">
          <input type="text" inputmode="decimal" value="${haberVal}" placeholder="0.00"
            oninput="setHaber(${l.id},this.value)" style="text-align:right;font-family:var(--mono);flex:1">
          <button onclick="openCajaHaber(${l.id})" title="Contar billetes" style="width:28px;height:28px;border-radius:6px;border:0.5px solid var(--red);background:transparent;color:var(--red);cursor:pointer;font-size:13px;flex-shrink:0">💵</button>
        </div>`
    } else if (esCaja && cajaReadonly) {
      // Otros roles editando partida existente con caja: solo lectura
      debeInput = `<input type="text" value="${debeVal}" placeholder="0.00" disabled
          style="text-align:right;font-family:var(--mono);opacity:0.6;cursor:not-allowed">`
      haberInput = `<input type="text" value="${haberVal}" placeholder="0.00" disabled
          style="text-align:right;font-family:var(--mono);opacity:0.6;cursor:not-allowed">`
    } else if (esCaja && !esSuperAdmin) {
      // Otros roles en partida nueva con caja: solo ingreso (débito) con botón 💵, haber bloqueado
      debeInput = `<div style="display:flex;gap:4px;align-items:center">
          <input type="text" inputmode="decimal" value="${debeVal}" placeholder="0.00"
            oninput="setDebe(${l.id},this.value)" style="text-align:right;font-family:var(--mono);flex:1">
          <button onclick="openCajaDebe(${l.id})" title="Contar billetes" style="width:28px;height:28px;border-radius:6px;border:0.5px solid var(--green);background:transparent;color:var(--green);cursor:pointer;font-size:13px;flex-shrink:0">💵</button>
        </div>`
      haberInput = `<input type="text" value="" placeholder="—" disabled
          style="text-align:right;font-family:var(--mono);opacity:0.4;cursor:not-allowed"
          title="Solo Super Admin puede registrar egresos de caja">`
    } else {
      // Cuentas normales (no caja)
      debeInput = `<input type="text" inputmode="decimal" value="${debeVal}" placeholder="0.00"
          oninput="setDebe(${l.id},this.value)" style="text-align:right;font-family:var(--mono)">`
      haberInput = `<input type="text" inputmode="decimal" value="${haberVal}" placeholder="0.00"
          oninput="setHaber(${l.id},this.value)" style="text-align:right;font-family:var(--mono)">`
    }

    // No permitir eliminar línea de caja a usuarios no super_admin en edición
    const deleteBtn = (cajaReadonly)
      ? `<span style="opacity:0.3;font-size:13px" title="No se puede eliminar línea de caja">🔒</span>`
      : `<button class="linea-del" onclick="removeLinea(${l.id})">✕</button>`

    // USD conversion row
    const showDescInd = document.getElementById('pn-desc-individual')?.checked
    const _busqDesc = `${l.cuenta_codigo || ''} ${l.cuenta_nombre || ''} ${l.descripcion || ''}`.toLowerCase()
    const descRow = showDescInd ? `
    <tr class="linea-desc-row" data-busqueda="${_busqDesc.replace(/"/g, '')}" style="border-top:none">
      <td colspan="6" style="padding:0 8px 8px 8px">
        <input type="text" value="${l.descripcion || ''}" placeholder="Descripción de esta línea..."
          oninput="updLinea(${l.id},'descripcion',this.value)"
          style="text-transform:uppercase;font-size:11px;padding:4px 8px;width:100%;border:1px dashed var(--border);background:var(--bg2);color:var(--text2);border-radius:4px">
      </td>
    </tr>` : ''

    const _busq = `${l.cuenta_codigo || ''} ${l.cuenta_nombre || ''} ${l.descripcion || ''}`.toLowerCase()
    return `
    <tr class="linea-row" data-busqueda="${_busq.replace(/"/g, '')}"${cajaReadonly ? ' style="background:rgba(255,193,7,0.05)"' : ''}>
      <td>
        <div class="cuenta-wrap">
          <input type="text" value="${l.cuenta_codigo ? l.cuenta_codigo+' '+l.cuenta_nombre : ''}" placeholder="Buscar cuenta..."
            onfocus="openCuentaDD(${l.id},this)" oninput="filterCuentas(${l.id},this.value)" data-lid="${l.id}" autocomplete="off"
            ${cajaReadonly ? 'disabled style="opacity:0.6;cursor:not-allowed"' : ''}>
          <div class="cuenta-dropdown" id="dd-${l.id}"></div>
        </div>
      </td>
      <td>
        <select onchange="updLinea(${l.id},'centro_costo_id',this.value)" ${cajaReadonly ? 'disabled style="opacity:0.6"' : ''}>
          <option value="">—</option>
          ${empresas.map(e => `<option value="${e.id}" ${l.centro_costo_id===e.id?'selected':''}>${e.nombre}</option>`).join('')}
        </select>
      </td>
      <td>${debeInput}</td>
      <td>${haberInput}</td>
      <td style="text-align:center">
        <input type="checkbox" class="fiscal-check" ${l.aplica_fiscal?'checked':''} onchange="updLinea(${l.id},'aplica_fiscal',this.checked)" ${cajaReadonly ? 'disabled' : ''}>
      </td>
      <td style="text-align:center">
        ${deleteBtn}
      </td>
    </tr>${descRow}`
  }).join('')
  if (typeof aplicarFiltroLineas === 'function') aplicarFiltroLineas()
}

// TC manual: se guarda en localStorage y persiste hasta que el usuario lo cambie
function fetchTCBac() {
  const stored = localStorage.getItem('contamax_tc_manual')
  window._lastTC = stored ? parseFloat(stored) : 26.7859
  const tcInput = document.getElementById('calc-usd-tc')
  if (tcInput) tcInput.value = window._lastTC
}
fetchTCBac()

// Guardar TC en localStorage cuando el usuario lo cambia
document.addEventListener('change', (e) => {
  if (e.target.id === 'calc-usd-tc') {
    const val = parseFloat(e.target.value)
    if (val > 0) {
      localStorage.setItem('contamax_tc_manual', val.toString())
      window._lastTC = val
    }
  }
})

// ── Calculadora USD en partida ──
window.calcUSD = () => {
  const num = (id) => parseFloat(String(document.getElementById(id)?.value || '').replace(/[^\d.]/g, '')) || 0
  const monto = num('calc-usd-monto')
  const tc = num('calc-usd-tc')
  const resultado = Math.round(monto * tc * 100) / 100
  document.getElementById('calc-usd-result').textContent = 'L. ' + resultado.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

window.copyCalcUSD = () => {
  const text = document.getElementById('calc-usd-result').textContent.replace('L. ', '').replace(/,/g, '')
  navigator.clipboard.writeText(text).then(() => toast('Copiado: ' + text, 'success')).catch(() => {
    // Fallback
    const el = document.createElement('textarea')
    el.value = text; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el)
    toast('Copiado: ' + text, 'success')
  })
}

window.setDebe = (id, val) => {
  const l = partidaLineas.find(x => x.id === id)
  if (!l) return
  const v = parseFloat(val) || 0
  l.tipo = 'debito'
  l.monto = v
  // Si es cuenta de caja y se editó directo (sin botón 💵), limpiar billetes
  if (esCuentaCaja(l.cuenta_codigo)) { delete l.billetes }
  // Limpiar haber de esta línea
  const row = document.querySelector(`input[data-lid="${id}"]`)?.closest('tr')
  if (row) { const haberInput = row.querySelectorAll('input[inputmode="decimal"]')[1]; if (haberInput) haberInput.value = '' }
  calcTotales()
}

window.setHaber = (id, val) => {
  const l = partidaLineas.find(x => x.id === id)
  if (!l) return
  // Bloquear egreso de caja para no super_admin
  if (esCuentaCaja(l.cuenta_codigo) && currentProfile?.rol !== 'super_admin') {
    toast('Solo Super Admin puede registrar egresos de Caja General', 'error')
    renderLineas()
    return
  }
  const v = parseFloat(val) || 0
  l.tipo = 'credito'
  l.monto = v
  // Si es cuenta de caja y se editó directo (sin botón 💵), limpiar billetes
  if (esCuentaCaja(l.cuenta_codigo)) { delete l.billetes }
  // Limpiar debe de esta línea
  const row = document.querySelector(`input[data-lid="${id}"]`)?.closest('tr')
  if (row) { const debeInput = row.querySelectorAll('input[inputmode="decimal"]')[0]; if (debeInput) debeInput.value = '' }
  calcTotales()
}

window.updLinea = (id, field, val) => {
  const l = partidaLineas.find(x => x.id === id)
  if (!l) return
  if (field === 'monto') l[field] = Math.round((parseFloat(val) || 0) * 100) / 100
  else if (field === 'aplica_fiscal') l[field] = val
  else l[field] = val
  calcTotales()
}

function calcTotales() {
  const debitos = Math.round(partidaLineas.filter(l => l.tipo === 'debito').reduce((s, l) => s + (l.monto || 0), 0) * 100) / 100
  const creditos = Math.round(partidaLineas.filter(l => l.tipo === 'credito').reduce((s, l) => s + (l.monto || 0), 0) * 100) / 100
  const diff = Math.round(Math.abs(debitos - creditos) * 100) / 100
  document.getElementById('pn-tot-d').textContent = debitos.toFixed(2)
  document.getElementById('pn-tot-c').textContent = creditos.toFixed(2)
  const diffEl = document.getElementById('pn-diff')
  const balEl = document.getElementById('pn-balance')
  if (diff === 0 && debitos > 0) {
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
  // Seleccionar todo el texto al enfocar (con timeout para que el clic del mouse no
  // deshaga la selección al soltar). Así, al hacer clic, se puede reemplazar la cuenta directo.
  setTimeout(() => { try { input.select() } catch (e) {} }, 0)
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
  if (l) {
    l.cuenta_id = cid; l.cuenta_codigo = codigo; l.cuenta_nombre = nombre
  }
  document.getElementById('dd-' + lid).classList.remove('open')
  renderLineas()
  calcTotales()
}

window.eliminarAdjuntoPartida = async (path) => {
  if (!editingPartidaId) return
  if (!confirm('¿Eliminar este adjunto?')) return
  const sb = getSb()
  // Remove from storage
  await sb.storage.from('facturas-compras').remove([path])
  // Update partida record
  const { data: partida } = await sb.from('partidas_contables').select('adjunto_url').eq('id', editingPartidaId).single()
  if (partida) {
    const paths = (partida.adjunto_url || '').split(',').filter(Boolean).map(p => p.trim())
    const updated = paths.filter(p => p !== path).join(',')
    await sb.from('partidas_contables').update({ adjunto_url: updated || null }).eq('id', editingPartidaId)
  }
  toast('Adjunto eliminado ✓', 'success')
  // Reload the partida to refresh adjuntos display
  editarPartida(editingPartidaId)
}

let _guardandoPartida = false
window.guardarPartida = async (estado) => {
  if (_guardandoPartida) return
  _guardandoPartida = true
  // Deshabilitar botones para evitar doble click
  document.querySelectorAll('#view-partida-nueva .btn-gold, #view-partida-nueva .btn-green').forEach(b => b.disabled = true)
  try {
  const fecha = document.getElementById('pn-fecha').value
  const descripcion = document.getElementById('pn-descripcion').value.trim().toUpperCase()
  const documento = document.getElementById('pn-documento').value.trim().toUpperCase()
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
  const debitos = Math.round(lineasValidas.filter(l => l.tipo === 'debito').reduce((s, l) => s + l.monto, 0) * 100) / 100
  const creditos = Math.round(lineasValidas.filter(l => l.tipo === 'credito').reduce((s, l) => s + l.monto, 0) * 100) / 100
  if (estado === 'aprobada' && debitos !== creditos) {
    toast(`La partida no cuadra: Débitos L.${debitos.toFixed(2)} ≠ Créditos L.${creditos.toFixed(2)}`, 'error'); return
  }

  // ── VALIDACIÓN DE UNIDADES (VIN, TAXI, VIP) EN DESCRIPCIÓN ──
  if (estado === 'aprobada') {
    const textosBuscar = [descripcion, ...lineasValidas.map(l => l.descripcion || '')]
    const refsEncontradas = []

    // Prefijos soportados:
    //   VIN 1234, VIN_1234              → vehiculos_vin
    //   T_1234, T_ARNOL                 → unidades_taxis (solo con guion bajo, evita TARJETA, TRASLADO)
    //   TAXI 1234, TAXI_ARNOL           → unidades_taxis
    //   VIP 1234, VIP_ARNOL             → unidades_taxis
    //   TAXI VIP 1234                   → unidades_taxis
    // Códigos pueden ser numéricos (01005) o alfanuméricos (ARNOL, J1791)
    const prefixPattern = /(?:(?:^|[\s,;(])TAXI[\s_]VIP[\s_]([A-Z0-9]+))|(?:(?:^|[\s,;(])TAXI[\s_]([A-Z0-9]+))|(?:(?:^|[\s,;(])VIP[\s_]([A-Z0-9]+))|(?:(?:^|[\s,;(])VIN[\s_]([A-Z0-9]+))|(?:(?:^|[\s,;(])T[_]([A-Z0-9]+))|(?:(?:^|[\s,;(])T\s([A-Z0-9]+))/gi
    for (const txt of textosBuscar) {
      if (!txt) continue
      const matches = txt.matchAll(prefixPattern)
      for (const m of matches) {
        const raw = (m[1] || m[2] || m[3] || m[4] || m[5] || m[6] || '').trim()
        if (!raw) continue
        const tipo = m[4] ? 'VIN' : 'TAXI'
        if (!refsEncontradas.some(r => r.raw === raw && r.tipo === tipo)) {
          refsEncontradas.push({ tipo, raw })
        }
      }
    }

    if (refsEncontradas.length > 0) {
      const errores = []
      for (const ref of refsEncontradas) {
        if (ref.tipo === 'VIN') {
          // Buscar por últimos dígitos en vehiculos_vin
          const { data: vinData } = await sb.from('vehiculos_vin')
            .select('vin, propietario')
            .eq('activo', true)
            .ilike('vin', `%${ref.raw}`)
            .limit(1)
          if (!vinData?.length) errores.push(`VIN ${ref.raw} no existe en la tabla de vehículos`)
        } else {
          // TAXI/VIP: buscar primero en unidades_taxis (registro numérico), luego en prestamos_taxis (codigo alfanumérico)
          let encontrado = false
          const regNum = parseInt(ref.raw)
          if (!isNaN(regNum) && String(regNum) === ref.raw.replace(/^0+/, '')) {
            const { data } = await sb.from('unidades_taxis')
              .select('registro')
              .eq('registro', regNum)
              .eq('activo', true)
              .limit(1)
            if (data?.length) encontrado = true
          }
          if (!encontrado) {
            // Buscar por codigo en prestamos_taxis (ARNOL, J1791, 01005, etc.)
            const { data } = await sb.from('prestamos_taxis')
              .select('codigo')
              .eq('activo', true)
              .ilike('codigo', ref.raw)
              .limit(1)
            if (data?.length) encontrado = true
          }
          if (!encontrado) errores.push(`TAXI ${ref.raw} no existe en unidades ni en financiamiento`)
        }
      }

      if (errores.length > 0) {
        toast(`⚠️ ${errores.join(' · ')} — Partida guardada como borrador`, 'error')
        estado = 'borrador'
      }
    }
  }

  // ── CONTROL DE CAJA GENERAL ──
  const tocaCaja = partidaAfectaCajaGeneral(lineasValidas)
  const hayEgresoCaja = tieneEgresoCaja(lineasValidas)
  const esSuperAdmin = currentProfile.rol === 'super_admin'
  const esAuxContable = currentProfile.rol === 'aux_contable'

  // Egreso de Caja General: solo super_admin
  const hayEgresoCajaGeneral = lineasValidas.some(l => lineaAfectaCaja(l) && l.tipo === 'credito' && l.monto > 0 && l.cuenta_codigo !== CUENTA_CAJA_CHICA)
  if (hayEgresoCajaGeneral && !esSuperAdmin) {
    toast('Solo el Super Admin puede registrar egresos de Caja General (créditos a caja)', 'error')
    return
  }

  // Egreso de Caja Chica: solo aux_contable o super_admin
  const hayEgresoCajaChica = lineasValidas.some(l => l.cuenta_codigo === CUENTA_CAJA_CHICA && l.tipo === 'credito' && l.monto > 0)
  if (hayEgresoCajaChica && !esAuxContable && !esSuperAdmin) {
    toast('Solo Aux. Contable o Super Admin pueden registrar egresos de Caja Chica', 'error')
    return
  }

  let estadoFinal = estado
  if (tocaCaja && estado === 'aprobada') {
    // Super Admin con conteo de billetes hecho → aprobada directamente
    // Super Admin sin conteo → pendiente_caja (se obliga a aprobar con conteo)
    // Aux. Contable con conteo en caja chica → aprobada directamente
    // Otros roles → pendiente_caja siempre
    const lineasCajaConBilletes = lineasValidas.filter(l => l.billetes && esCuentaCaja(l.cuenta_codigo))
    const lineasCajaChicaConBilletes = lineasValidas.filter(l => l.billetes && l.cuenta_codigo === CUENTA_CAJA_CHICA)
    if (esSuperAdmin && lineasCajaConBilletes.length > 0) {
      estadoFinal = 'aprobada'
    } else if (esAuxContable && lineasCajaChicaConBilletes.length > 0 && !lineasValidas.some(l => esCuentaCaja(l.cuenta_codigo) && l.cuenta_codigo !== CUENTA_CAJA_CHICA)) {
      // Aux. Contable con conteo en caja chica y sin tocar caja general → aprobada
      estadoFinal = 'aprobada'
    } else {
      estadoFinal = 'pendiente_caja'
    }
  }

  // ── CONTROL CAJA CHICA: partidas de otros usuarios quedan pendientes para el auxiliar ──
  const tocaCajaChica = lineasValidas.some(l => l.cuenta_codigo === CUENTA_CAJA_CHICA && l.monto > 0)
  if (tocaCajaChica && !esAuxContable && !esSuperAdmin && estado === 'aprobada') {
    estadoFinal = 'pendiente_caja'
  }

  let partidaId = editingPartidaId

  if (editingPartidaId) {
    // ── ACTUALIZAR partida existente ──
    // Preserve original tipo_origen if it was set by an import and form field is empty
    const originalPartida = allPartidas.find(p => p.id === editingPartidaId)
    const tipoOrigenFinal = tipo_origen || originalPartida?.tipo_origen || ''
    const updateData = {
      tipo_origen: tipoOrigenFinal, descripcion, numero_documento: documento || null,
      fecha_partida: fecha, estado: estadoFinal, total: debitos,
      aprobada_at: estadoFinal === 'aprobada' ? new Date().toISOString() : null,
      aprobada_por: estadoFinal === 'aprobada' ? currentProfile.id : null
    }
    // Si auxiliar modifica, registrar quién y cuándo
    if (esAuxContable) {
      updateData.modificada_por = currentProfile.id
      updateData.modificada_at = new Date().toISOString()
      // Si la partida ya estaba aprobada, pasa a borrador para re-aprobación
      if (originalPartida?.estado === 'aprobada' && estadoFinal === 'aprobada') {
        updateData.estado = 'borrador'
        updateData.aprobada_at = null
        updateData.aprobada_por = null
        estadoFinal = 'borrador'
      }
    }
    const { error: pErr } = await sb.from('partidas_contables').update(updateData).eq('id', editingPartidaId)
    if (pErr) { toast('Error: ' + pErr.message, 'error'); return }

    // ── BITÁCORA: detectar cambios antes de borrar líneas viejas ──
    try {
      const { data: lineasAntes } = await sb.from('lineas_partida').select('cuenta_codigo, cuenta_nombre, monto, tipo, descripcion').eq('partida_id', editingPartidaId)
      if (lineasAntes?.length) {
        const cambios = []
        const antes = (lineasAntes || []).map(l => ({ key: `${l.cuenta_codigo}_${l.tipo}`, codigo: l.cuenta_codigo, nombre: l.cuenta_nombre, monto: parseFloat(l.monto) || 0, tipo: l.tipo, desc: l.descripcion || '' }))
        const despues = lineasValidas.map(l => ({ key: `${l.cuenta_codigo}_${l.tipo}`, codigo: l.cuenta_codigo, nombre: l.cuenta_nombre, monto: l.monto, tipo: l.tipo, desc: l.descripcion || '' }))
        // Eliminadas
        const despuesKeys = despues.map(d => d.key)
        antes.filter(a => !despuesKeys.includes(a.key)).forEach(a => {
          cambios.push(`(-) ${a.codigo} ${a.tipo === 'debito' ? 'D' : 'H'} L.${a.monto.toFixed(2)}`)
        })
        // Agregadas
        const antesKeys = antes.map(a => a.key)
        despues.filter(d => !antesKeys.includes(d.key)).forEach(d => {
          cambios.push(`(+) ${d.codigo} ${d.tipo === 'debito' ? 'D' : 'H'} L.${d.monto.toFixed(2)}`)
        })
        // Montos cambiados
        antes.forEach(a => {
          const d = despues.find(x => x.key === a.key)
          if (d && Math.abs(a.monto - d.monto) > 0.01) {
            cambios.push(`(~) ${a.codigo} ${a.tipo === 'debito' ? 'D' : 'H'} L.${a.monto.toFixed(2)} → L.${d.monto.toFixed(2)}`)
          }
        })
        // Cambio de encabezado
        if (originalPartida && originalPartida.descripcion !== descripcion) {
          cambios.push(`Desc: "${originalPartida.descripcion}" → "${descripcion}"`)
        }
        if (cambios.length) {
          logActividad('partida_modificada', 'partidas', `Partida #${originalPartida?.numero_partida || '?'}: ${cambios.join(' | ')}`, editingPartidaId)
        }
      }
    } catch(e) { /* silent */ }

    // Borrar líneas viejas y crear nuevas
    const { error: delErr } = await sb.from('lineas_partida').delete().eq('partida_id', editingPartidaId)
    if (delErr) { toast('Error al borrar líneas: ' + delErr.message, 'error'); return }
  } else {
    // ── CREAR partida nueva ──
    // Correlativo atómico (evita duplicados por concurrencia)
    const nuevoNumero = await window.siguienteNumeroPartida()

    const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
      centro_costo_id: null,
      numero_partida: nuevoNumero,
      generada_por: currentProfile.id,
      tipo_origen, descripcion, numero_documento: documento || null,
      fecha_partida: fecha, estado: estadoFinal, total: debitos,
      aprobada_at: estadoFinal === 'aprobada' ? new Date().toISOString() : null,
      aprobada_por: estadoFinal === 'aprobada' ? currentProfile.id : null
    }).select('id').single()
    if (pErr) { toast('Error: ' + pErr.message, 'error'); return }
    partidaId = partida.id
  }

  // ── SUBIR ADJUNTOS (múltiples archivos) ──
  const adjuntoFiles = document.getElementById('pn-adjunto')?.files
  if (adjuntoFiles?.length && partidaId) {
    const paths = []
    for (let i = 0; i < adjuntoFiles.length; i++) {
      const file = adjuntoFiles[i]
      const ext = file.name.split('.').pop().toLowerCase()
      const path = `partidas/${partidaId}_${i + 1}.${ext}`
      const { error: upErr } = await sb.storage.from('facturas-compras').upload(path, file, { upsert: true })
      if (upErr) {
        toast(`Error subiendo ${file.name}: ${upErr.message}`, 'error')
      } else {
        paths.push(path)
      }
    }
    if (paths.length) {
      // Concatenar con adjuntos existentes si hay
      const { data: existing } = await sb.from('partidas_contables').select('adjunto_url').eq('id', partidaId).single()
      const existingPaths = existing?.adjunto_url ? existing.adjunto_url.split(',').filter(Boolean) : []
      const allPaths = [...existingPaths, ...paths].join(',')
      await sb.from('partidas_contables').update({ adjunto_url: allPaths }).eq('id', partidaId)
      toast(`${paths.length} adjunto(s) guardado(s) ✓`, 'success')
    }
  } else if (!adjuntoFiles?.length && window._facturaFotoUrl && partidaId && !editingPartidaId) {
    // ── COPIAR IMAGEN DE FACTURA como adjunto de la partida ──
    await sb.from('partidas_contables').update({ adjunto_url: window._facturaFotoUrl }).eq('id', partidaId)
  }
  window._facturaFotoUrl = null

  // Insertar líneas
  const lineas = lineasValidas.map(l => ({
    partida_id: partidaId,
    cuenta_id: l.cuenta_id,
    cuenta_codigo: l.cuenta_codigo,
    cuenta_nombre: l.cuenta_nombre,
    tipo: l.tipo,
    monto: Math.round((l.monto || 0) * 100) / 100,
    centro_costo_id: l.centro_costo_id || null,
    descripcion: (l.descripcion || descripcion).toUpperCase(),
    numero_documento: documento || null,
    aplica_fiscal: l.aplica_fiscal
  }))
  const { error: lErr } = await sb.from('lineas_partida').insert(lineas)
  if (lErr) { toast('Error en líneas: ' + lErr.message, 'error'); return }

  // Guardar conteo de billetes si existe
  const lineasConBilletes = lineasValidas.filter(l => l.billetes && esCuentaCaja(l.cuenta_codigo))
  if (lineasConBilletes.length > 0) {
    // Borrar conteos anteriores de esta partida
    const { error: delErr } = await sb.from('conteo_billetes').delete().eq('partida_id', partidaId)
    if (delErr) console.warn('[CONTEO] Error borrando conteos anteriores:', delErr)
    const conteos = lineasConBilletes.map(l => ({
      partida_id: partidaId,
      tipo: l.tipo === 'debito' ? 'ingreso' : 'egreso',
      cuenta_codigo: l.cuenta_codigo,
      den_500: l.billetes[500] || 0,
      den_200: l.billetes[200] || 0,
      den_100: l.billetes[100] || 0,
      den_50: l.billetes[50] || 0,
      den_20: l.billetes[20] || 0,
      den_10: l.billetes[10] || 0,
      den_5: l.billetes[5] || 0,
      den_2: l.billetes[2] || 0,
      den_1: l.billetes[1] || 0,
      den_cheques: l.billetes._cheques || 0,
      total_billetes: DENOMINACIONES.reduce((s, d) => s + (l.billetes[d] || 0), 0),
      total_monto: l.monto,
      registrado_por: currentProfile.id
    }))
    console.log('[CONTEO] Insertando conteos desde partida:', JSON.stringify(conteos))
    const { data: conteoData, error: conteoErr } = await sb.from('conteo_billetes').insert(conteos).select()
    if (conteoErr) {
      console.error('[CONTEO] Error al guardar conteo:', conteoErr)
      toast('⚠️ Error guardando conteo de billetes: ' + conteoErr.message, 'error')
    } else {
      console.log('[CONTEO] Conteos guardados OK:', conteoData)
    }
  }

  // ── SINCRONIZAR LIBRO DE COMPRAS ──
  // Solo para partidas de tipo 'compra'
  if (tipo_origen === 'compra' && documento) {
    await syncLibroCompras(partidaId, fecha, documento, lineasValidas, descripcion)
  }

  // Mensajes según resultado
  const accion = editingPartidaId ? 'actualizada' : 'guardada'
  if (estadoFinal === 'pendiente_caja') {
    const msgExtra = esSuperAdmin ? ' (falta conteo de billetes)' : ''
    toast(`Partida ${accion} · Pendiente de aprobación por Caja General${msgExtra}`, 'info')
  } else if (estadoFinal === 'aprobada' && tocaCaja) {
    toast(`Partida ${accion} y aprobada con conteo de billetes ✓`, 'success')
  } else if (estadoFinal === 'aprobada') {
    toast(`Partida ${accion} y contabilizada ✓`, 'success')
  } else if (esAuxContable && editingPartidaId && estadoFinal === 'borrador' && estado === 'aprobada') {
    toast(`Partida ${accion} · Pendiente de re-aprobación por Contador o Super Admin`, 'info')
  } else if (esAuxContable && estado === 'aprobada') {
    toast(`Partida ${accion} · Enviada a revisión por un superior`, 'info')
  } else {
    toast(`Borrador ${accion}`, 'success')
  }
  editingPartidaId = null
  logActividad(estadoFinal === 'aprobada' ? 'partida_aprobada' : 'partida_borrador', 'partidas', `${descripcion} · L. ${Math.round(debitos*100)/100}`, partidaId)

  // ── Insertar en LIBRO DE VENTAS (solo ventas fiscales) ──
  if (window._importVentasData) {
    const vd = window._importVentasData
    const registros = []
    const isvW = vd.isvWarnings || {}

    // Helper: arma un registro de libro_ventas (contado o crédito)
    const regVenta = (f, ccId, isCredito) => ({
      centro_costo_id: ccId,
      fecha: vd.fecha,
      factura_interna: String(f.factura_interna || ''),
      factura_electronica: f.factura_electronica || '',
      cliente: f.cliente || '',
      rtn_cliente: f.rtn || '',
      subtotal: Math.round((f.subtotal || 0) * 100) / 100,
      total_gravado: Math.round((f.total_gravado || 0) * 100) / 100,
      total_exento: Math.round((f.total_exento || 0) * 100) / 100,
      isv: Math.round((f.impuestos || 0) * 100) / 100,
      total: Math.round((f.total || 0) * 100) / 100,
      monto_efectivo: isCredito ? 0 : Math.round((f.monto_efectivo || 0) * 100) / 100,
      monto_tarjeta: isCredito ? 0 : Math.round((f.monto_tarjeta || 0) * 100) / 100,
      monto_transferencia: isCredito ? 0 : Math.round((f.monto_transferencia || 0) * 100) / 100,
      incluir_fiscal: true,
      numero_documento: documento || null,
      origen: 'import_alpha',
      partida_id: partidaId,
      observaciones: isvW[f.factura_electronica] || null,
    })

    if (vd.tecnimax_fiscal?.facturas?.length) for (const f of vd.tecnimax_fiscal.facturas) registros.push(regVenta(f, vd.ccTecniId, false))
    if (vd.tecnimax_fiscal?.facturasCredito?.length) for (const f of vd.tecnimax_fiscal.facturasCredito) registros.push(regVenta(f, vd.ccTecniId, true))
    if (vd.yonker_fiscal?.facturas?.length) for (const f of vd.yonker_fiscal.facturas) registros.push(regVenta(f, vd.ccYonkerId, false))
    if (vd.yonker_fiscal?.facturasCredito?.length) for (const f of vd.yonker_fiscal.facturasCredito) registros.push(regVenta(f, vd.ccYonkerId, true))

    if (registros.length) {
      // Dedupe por factura_electronica: no reinsertar las que ya estén en el libro
      const facts = registros.map(r => r.factura_electronica).filter(Boolean)
      let existentes = new Set()
      if (facts.length) {
        const { data: ya } = await sb.from('libro_ventas').select('factura_electronica').in('factura_electronica', facts)
        existentes = new Set((ya || []).map(x => x.factura_electronica))
      }
      const nuevos = registros.filter(r => !r.factura_electronica || !existentes.has(r.factura_electronica))
      if (nuevos.length) {
        const { error: lvErr } = await sb.from('libro_ventas').insert(nuevos)
        if (lvErr) console.error('Error libro_ventas:', lvErr.message)
        else console.log(`📗 ${nuevos.length} insertados en libro_ventas (${registros.length - nuevos.length} ya existían)`)
      }
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
    window._origenPartida = null
    showView('pendientes', 'Facturas pendientes')
  } else if (!_retornoPartida()) {
    showView('partidas', 'Partidas contables')
  }
  } finally {
    _guardandoPartida = false
    document.querySelectorAll('#view-partida-nueva .btn-gold, #view-partida-nueva .btn-green').forEach(b => b.disabled = false)
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
  window.catalogoCuentas = allCuentas
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
      <div class="tree-name" style="cursor:pointer" onclick="verDescCuenta('${c.id}')">${toggleBtn}<span class="tree-code">${c.codigo}</span>${c.nombre}${c.es_detalle ? '' : ' <span style="font-size:10px;color:var(--text3);margin-left:4px">(grupo)</span>'}${c.descripcion_uso ? ' <span style="font-size:10px;color:var(--blue)">💬</span>' : ''}</div>
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

// ── Descripción de uso de cuenta ──
let descCuentaId = null
window.verDescCuenta = (id) => {
  const c = allCuentas.find(x => x.id === id)
  if (!c) return
  descCuentaId = id
  document.getElementById('desc-cuenta-title').textContent = `${c.codigo} · ${c.nombre}`
  document.getElementById('desc-cuenta-texto').value = c.descripcion_uso || ''
  const rol = currentProfile?.rol
  const puedeEditar = rol === 'super_admin' || rol === 'contador'
  document.getElementById('desc-cuenta-texto').readOnly = !puedeEditar
  document.getElementById('btn-guardar-desc').style.display = puedeEditar ? 'inline-flex' : 'none'
  document.getElementById('desc-cuenta-hint').textContent = puedeEditar ? 'Escribí qué se carga en esta cuenta y cuándo se usa' : 'Solo el contador o Super Admin pueden editar esta descripción'
  document.getElementById('modal-desc-cuenta').classList.add('open')
}

window.guardarDescCuenta = async () => {
  if (!descCuentaId) return
  const texto = document.getElementById('desc-cuenta-texto').value.trim()
  const { error } = await sb.from('catalogo_cuentas').update({ descripcion_uso: texto }).eq('id', descCuentaId)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  const c = allCuentas.find(x => x.id === descCuentaId)
  if (c) c.descripcion_uso = texto
  closeModal('modal-desc-cuenta')
  toast('Descripción guardada ✓', 'success')
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
      const _ncp = document.getElementById('nc-puente'); if (_ncp) _ncp.checked = !!c.es_cuenta_puente
    }
  } else {
    ['nc-codigo','nc-nombre'].forEach(id => document.getElementById(id).value = '')
    document.getElementById('nc-tipo').value = 'activo'
    document.getElementById('nc-naturaleza').value = 'deudora'
    document.getElementById('nc-nivel').value = '3'
    document.getElementById('nc-padre').value = ''
    document.getElementById('nc-detalle').checked = true
    const _ncp = document.getElementById('nc-puente'); if (_ncp) _ncp.checked = false
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
  const es_cuenta_puente = document.getElementById('nc-puente')?.checked || false
  const err = document.getElementById('modal-cuenta-error')
  if (!codigo || !nombre) { showError(err, 'Código y nombre son obligatorios'); return }
  // Check duplicate code
  const dup = allCuentas.find(c => c.codigo === codigo && c.id !== editingCuentaId)
  if (dup) { showError(err, `El código ${codigo} ya existe: ${dup.nombre}`); return }
  const btn = document.getElementById('btn-guardar-cuenta')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'
  const payload = { codigo, nombre, tipo, naturaleza, nivel, cuenta_padre, es_detalle, es_cuenta_puente, activa: true }
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
const CAJA_CODIGOS = ['110101-001', '110102', '110102-001'] // Caja Chica MN + Caja General (NO 110101 genérico)

// ── CUENTAS SENSIBLES (solo Super Admin puede ver saldos) ──
const CUENTAS_SENSIBLES_PREFIJOS = ['110102', '110103', '110104'] // Caja General, Chequeras, Bancos
const GRUPOS_SENSIBLES_PREFIJOS = ['6204'] // GASTOS CASA (gastos personales): solo super_admin
function esCuentaSensible(codigo) {
  if (!codigo) return false
  if (CUENTAS_SENSIBLES_PREFIJOS.some(p => codigo === p || codigo.startsWith(p + '-'))) return true
  return GRUPOS_SENSIBLES_PREFIJOS.some(p => String(codigo).startsWith(p)) // todo el grupo 6204 (6204, 620401, 620401-XX…)
}
function puedeVerSensibles() {
  return currentProfile?.rol === 'super_admin'
}
window.esCuentaSensible = esCuentaSensible
window.puedeVerSensibles = puedeVerSensibles

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

  // Cargar partidas que afectan SOLO caja general (110102), NO caja chica (110101)
  // Primero obtener las líneas que tocan caja general
  const CAJA_GENERAL_CODIGOS = ['110102', '110102-001']
  const { data: lineasCaja, error: lcErr } = await sb.from('lineas_partida')
    .select('partida_id, tipo, monto, cuenta_codigo, cuenta_nombre')
    .or(CAJA_GENERAL_CODIGOS.map(c => `cuenta_codigo.eq.${c},cuenta_codigo.like.${c}-%`).join(','))

  if (lcErr) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${lcErr.message}</div></div>`
    return
  }

  if (!lineasCaja?.length) {
    cajaPartidas = []
    updateCajaStats()
    renderCajaList()
    loadCajaExtras()
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
      caja_monto: Math.abs(debitos - creditos), // neto: una partida puede mover caja por ambos lados
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
  loadCajaExtras()
}
window.loadCaja = loadCaja

function updateCajaStats() {
  const fmt = (v) => 'L. ' + v.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const hoy = localDateStr()

  // Saldo acumulado real (todas las aprobadas, sin filtro de fecha) — no cambia
  const aprobadas = cajaPartidas.filter(p => p.estado === 'aprobada')
  const totalIngresosAcum = aprobadas.filter(p => p.caja_tipo === 'ingreso').reduce((s, p) => s + p.caja_monto, 0)
  const totalEgresosAcum = aprobadas.filter(p => p.caja_tipo === 'egreso').reduce((s, p) => s + p.caja_monto, 0)
  const saldo = totalIngresosAcum - totalEgresosAcum

  // Vienen = saldo con que abrió el día (todo lo aprobado con fecha anterior a hoy)
  const antIng = aprobadas.filter(p => p.caja_tipo === 'ingreso' && p.fecha_partida < hoy).reduce((s, p) => s + p.caja_monto, 0)
  const antEgr = aprobadas.filter(p => p.caja_tipo === 'egreso' && p.fecha_partida < hoy).reduce((s, p) => s + p.caja_monto, 0)
  const vienen = antIng - antEgr
  // Ingresos / egresos SOLO de hoy
  const ingHoy = aprobadas.filter(p => p.caja_tipo === 'ingreso' && p.fecha_partida === hoy).reduce((s, p) => s + p.caja_monto, 0)
  const egrHoy = aprobadas.filter(p => p.caja_tipo === 'egreso' && p.fecha_partida === hoy).reduce((s, p) => s + p.caja_monto, 0)

  document.getElementById('cj-saldo').textContent = fmt(saldo)
  document.getElementById('cj-saldo').style.color = saldo >= 0 ? 'var(--green)' : 'var(--red)'
  const vEl = document.getElementById('cj-vienen'); if (vEl) vEl.textContent = fmt(vienen)
  document.getElementById('cj-total-ingresos').textContent = fmt(ingHoy)
  document.getElementById('cj-total-egresos').textContent = fmt(egrHoy)

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
        <button class="btn btn-ghost" style="padding:6px 10px;font-size:13px;margin-top:6px" onclick="verPartida('${p.id}')" title="Ver partida">👁️</button>
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

  // Cargar conteo existente si lo hay
  let existingBilletes = null
  const { data: conteoExist } = await sb.from('conteo_billetes')
    .select('*')
    .eq('partida_id', id)
    .limit(1)
  if (conteoExist?.length) {
    const c = conteoExist[0]
    existingBilletes = {
      500: c.den_500 || 0, 200: c.den_200 || 0, 100: c.den_100 || 0,
      50: c.den_50 || 0, 20: c.den_20 || 0, 10: c.den_10 || 0,
      5: c.den_5 || 0, 2: c.den_2 || 0, 1: c.den_1 || 0,
      _cheques: parseFloat(c.den_cheques) || 0
    }
  }

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

      // Guardar conteo de billetes (borrar anterior si existe)
      const tipoConteo = partida?.caja_tipo === 'ingreso' ? 'ingreso' : 'egreso'
      await sb.from('conteo_billetes').delete().eq('partida_id', id)
      const conteoBilletes = {
        partida_id: id,
        tipo: tipoConteo,
        den_500: detalle[500] || 0,
        den_200: detalle[200] || 0,
        den_100: detalle[100] || 0,
        den_50: detalle[50] || 0,
        den_20: detalle[20] || 0,
        den_10: detalle[10] || 0,
        den_5: detalle[5] || 0,
        den_2: detalle[2] || 0,
        den_1: detalle[1] || 0,
        den_cheques: detalle._cheques || 0,
        total_billetes: DENOMINACIONES.reduce((s, d) => s + (detalle[d] || 0), 0),
        total_monto: montoContado,
        registrado_por: currentProfile.id,
      }
      console.log('[CONTEO] Insertando conteo de billetes:', JSON.stringify(conteoBilletes))
      const { data: conteoData, error: conteoErr } = await sb.from('conteo_billetes').insert(conteoBilletes).select()
      if (conteoErr) {
        console.error('[CONTEO] Error al guardar conteo:', conteoErr)
        toast('⚠️ Error guardando conteo de billetes: ' + conteoErr.message, 'error')
        return // No aprobar si el conteo no se pudo guardar
      }
      console.log('[CONTEO] Conteo guardado OK:', conteoData)

      // Aprobar la partida
      const { error } = await sb.from('partidas_contables').update({
        estado: 'aprobada',
        aprobada_at: new Date().toISOString(),
        aprobada_por: currentProfile.id
      }).eq('id', id)
      if (error) { toast('Error: ' + error.message, 'error'); return }
      toast('Entrega aprobada y contabilizada ✓', 'success')
      loadCaja()
    },
    existingBilletes
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
            <td class="mono" style="font-size:12px">${new Date(p.fecha_partida + 'T12:00:00').toLocaleDateString('es-HN')}</td>
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
    if (!error) await limpiarDatosImportacion(id)
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
  const r2 = (v) => Math.round((+v || 0) * 100) / 100
  const algunaFiscal = lineasValidas.some(l => l.aplica_fiscal)

  // Si la partida ya no es fiscal, limpiar cualquier fila previa de esta partida y salir
  if (!algunaFiscal) {
    if (partidaId) await sb.from('libro_compras').delete().eq('partida_id', partidaId)
    return
  }

  const lineaProveedor = lineasValidas.find(l => l.cuenta_codigo?.startsWith('210101'))
  const lineaCaja = lineasValidas.find(l => l.cuenta_codigo?.startsWith('1101'))
  const lineaInventario = lineasValidas.find(l => l.cuenta_codigo?.startsWith('110501'))
  // TODAS las líneas de ISV con monto > 0 (puede haber varias facturas en una partida)
  const isvLines = lineasValidas.filter(l => l.cuenta_codigo?.startsWith('110402') && (+l.monto || 0) > 0)

  // Clasificación costo/gasto: costo si la partida tiene un débito en 510101 (costo de
  // adquisición) o en 110501 (inventario). Si no, se considera gasto.
  const tipoCompra = lineasValidas.some(l => l.tipo === 'debito'
    && (l.cuenta_codigo?.startsWith('510101') || l.cuenta_codigo?.startsWith('110501')))
    ? 'costo' : 'gasto'

  const cuentaProv = lineaProveedor?.cuenta_codigo || ''
  const formaPago = lineaProveedor ? 'credito' : (lineaCaja ? 'contado' : 'otro')
  const centroCostoId = lineaInventario?.centro_costo_id
    || lineasValidas.find(l => l.tipo === 'debito' && !l.cuenta_codigo?.startsWith('110402'))?.centro_costo_id
    || lineasValidas[0]?.centro_costo_id || null

  // Proveedor "general" de la partida (cuando la línea de ISV no lo trae en su descripción)
  let provGeneral = lineaProveedor?.cuenta_nombre || lineaProveedor?.descripcion || ''
  if (!provGeneral && numDocumento) {
    const { data: fc } = await sb.from('facturas_compras')
      .select('proveedor_rel:proveedores(nombre)')
      .eq('numero_factura', numDocumento)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()
    provGeneral = fc?.proveedor_rel?.nombre || ''
  }
  if (!provGeneral && descripcion && descripcion.includes('·')) provGeneral = descripcion.split('·')[0].trim()

  // Extrae { proveedor, n° factura } de la descripción de una línea (ej. "AGUA LA TIGRA FACT# 6729")
  const parseLinea = (desc) => {
    const d = (desc || '').trim()
    const m = d.match(/(?:fact\.?\s*#?\s*|#\s*)([\w\-\/.]+)/i)
    const numfac = m ? m[1] : ''
    let prov = m ? d.slice(0, m.index).trim() : ''
    prov = prov.replace(/\bfact\.?\b/i, '').replace(/[#·\-\s]+$/, '').trim()
    return { numfac, prov }
  }

  // Una fila por línea de ISV; si no hay ISV pero es fiscal, una sola fila (exento)
  const baseRows = []
  if (isvLines.length) {
    for (const li of isvLines) {
      const isv = r2(li.monto)
      const { numfac, prov } = parseLinea(li.descripcion)
      baseRows.push({
        numero_factura: numfac || numDocumento || '',
        proveedor: prov || provGeneral || '',
        isv,
        subtotal: r2(isv / 0.15),
        total: r2(isv / 0.15 + isv),
        productos: li.descripcion || descripcion,
        centro_costo_id: li.centro_costo_id || centroCostoId,
      })
    }
  } else {
    const subBase = lineaInventario ? r2(lineaInventario.monto)
      : r2(lineasValidas.filter(l => l.tipo === 'credito').reduce((s, l) => s + l.monto, 0))
    baseRows.push({
      numero_factura: numDocumento || '', proveedor: provGeneral || '',
      isv: 0, subtotal: subBase, total: subBase,
      productos: descripcion, centro_costo_id: centroCostoId,
    })
  }

  // Preservar la selección del contador (incluir_fiscal / periodo_fiscal / rtn) por n° de factura
  const { data: previas } = await sb.from('libro_compras')
    .select('numero_factura, incluir_fiscal, periodo_fiscal, rtn_proveedor')
    .eq('partida_id', partidaId)
  const prevMap = {}
  ;(previas || []).forEach(p => { prevMap[p.numero_factura] = p })

  // Reemplazar las filas de esta partida (borra y reinserta)
  if (partidaId) await sb.from('libro_compras').delete().eq('partida_id', partidaId)

  const registros = baseRows.map(b => {
    const prev = prevMap[b.numero_factura]
    const reg = {
      centro_costo_id: b.centro_costo_id,
      fecha,
      numero_factura: b.numero_factura,
      numero_documento: b.numero_factura,
      proveedor: b.proveedor,
      rtn_proveedor: prev?.rtn_proveedor || '',
      cuenta_proveedor: cuentaProv,
      subtotal: b.subtotal,
      isv: b.isv,
      total: b.total,
      forma_pago: formaPago,
      productos: b.productos,
      incluir_fiscal: prev ? prev.incluir_fiscal : true,
      tipo_compra: tipoCompra,
      origen: 'manual',
      partida_id: partidaId,
    }
    if (prev?.periodo_fiscal) reg.periodo_fiscal = prev.periodo_fiscal
    return reg
  })

  if (registros.length) {
    const { error: insErr } = await sb.from('libro_compras').insert(registros)
    if (insErr) console.error('syncLibroCompras insert:', insErr.message || insErr)
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

// Inserta SOLO las ventas a crédito del archivo ya procesado en libro_ventas (sin crear partida).
// Idempotente: no duplica las que ya estén (dedupe por factura_electronica).
window.sincronizarCreditoLibro = async () => {
  if (!importData) { toast('Primero procesá el archivo (Paso 1).', 'error'); return }
  const fecha = document.getElementById('imp-fecha')?.value
  if (!fecha) { toast('Indicá la fecha del reporte.', 'error'); return }
  const empresas = window._empresas?.() || []
  const ccTecni = empresas.find(e => e.nombre.toLowerCase().includes('tecni') && !e.nombre.toLowerCase().includes('yonker'))
  const ccYonker = empresas.find(e => e.nombre.toLowerCase().includes('yonker'))
  const isvW = window._isvWarnings || {}

  const reg = (f, ccId) => ({
    centro_costo_id: ccId, fecha,
    factura_interna: String(f.factura_interna || ''),
    factura_electronica: f.factura_electronica || '',
    cliente: f.cliente || '', rtn_cliente: f.rtn || '',
    subtotal: Math.round((f.subtotal || 0) * 100) / 100,
    total_gravado: Math.round((f.total_gravado || 0) * 100) / 100,
    total_exento: Math.round((f.total_exento || 0) * 100) / 100,
    isv: Math.round((f.impuestos || 0) * 100) / 100,
    total: Math.round((f.total || 0) * 100) / 100,
    monto_efectivo: 0, monto_tarjeta: 0, monto_transferencia: 0,
    incluir_fiscal: true, origen: 'import_alpha', partida_id: null,
    observaciones: isvW[f.factura_electronica] || null,
  })

  const registros = []
  if (importData.tecnimax_fiscal?.facturasCredito?.length) for (const f of importData.tecnimax_fiscal.facturasCredito) registros.push(reg(f, ccTecni?.id || null))
  if (importData.yonker_fiscal?.facturasCredito?.length) for (const f of importData.yonker_fiscal.facturasCredito) registros.push(reg(f, ccYonker?.id || null))

  if (!registros.length) { toast('Este archivo no tiene ventas a crédito.', 'info'); return }

  const facts = registros.map(r => r.factura_electronica).filter(Boolean)
  let existentes = new Set()
  if (facts.length) {
    const { data: ya } = await sb.from('libro_ventas').select('factura_electronica').in('factura_electronica', facts)
    existentes = new Set((ya || []).map(x => x.factura_electronica))
  }
  const nuevos = registros.filter(r => !r.factura_electronica || !existentes.has(r.factura_electronica))
  if (!nuevos.length) { toast('Las ventas a crédito de este archivo ya estaban en el libro.', 'info'); return }

  const { error } = await sb.from('libro_ventas').insert(nuevos)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast(`✅ ${nuevos.length} venta(s) a crédito agregada(s) al libro de ventas`, 'success')
  if (window.logActividad) window.logActividad('sync_credito_libro', 'importar', `Sincronizó ${nuevos.length} ventas a crédito al libro (${fecha})`)
}

function initImport() {
  // Default: fecha de ayer (los reportes siempre son del día anterior)
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  document.getElementById('imp-fecha').value = localDateStr(ayer)
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
  
  // ── Parsear una hoja individual ──
  function parseSheet(ws) {
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
    let headerRow = -1, colMap = {}
    for (let r = 0; r < Math.min(20, data.length); r++) {
      const row = data[r]
      if (!row) continue
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim().toLowerCase()
        if (val === 'no. factura interna' || val.includes('factura interna')) {
          headerRow = r
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
            else if (h.includes('tipo de venta')) colMap.tipo_venta = cc
            else if (h.includes('código cliente') || h.includes('codigo cliente')) colMap.codigo_cliente = cc
          }
          break
        }
      }
      if (headerRow >= 0) break
    }
    if (headerRow < 0) headerRow = 8
    if (!colMap.factura_interna && colMap.factura_interna !== 0) colMap = { factura_interna:0, factura_electronica:4, cliente:10, rtn:11, subtotal:18, impuestos:19, total:24, total_exento:25, total_gravado:26, fecha:17, monto_tarjeta:30, monto_efectivo:31, monto_transferencia:33, tipo_venta:13, codigo_cliente:9 }
    
    const facturas = []
    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i]
      if (!row) break
      const firstCell = row[colMap.factura_interna]
      if (firstCell == null || String(firstCell).trim() === '') break
      if (isNaN(Number(firstCell))) break
      const r2 = v => Math.round((parseFloat(v) || 0) * 100) / 100
      facturas.push({
        factura_interna: firstCell,
        factura_electronica: String(row[colMap.factura_electronica] || ''),
        cliente: String(row[colMap.cliente] || ''),
        rtn: String(row[colMap.rtn] || ''),
        subtotal: r2(row[colMap.subtotal]),
        impuestos: r2(row[colMap.impuestos]),
        total: r2(row[colMap.total]),
        total_exento: r2(row[colMap.total_exento]),
        total_gravado: r2(row[colMap.total_gravado]),
        fecha: String(row[colMap.fecha] || ''),
        monto_tarjeta: r2(row[colMap.monto_tarjeta]),
        monto_efectivo: r2(row[colMap.monto_efectivo]),
        monto_transferencia: r2(row[colMap.monto_transferencia]),
        tipo_venta: String(row[colMap.tipo_venta] || 'Contado'),
        codigo_cliente: String(row[colMap.codigo_cliente] || ''),
      })
    }
    return facturas
  }

  // ── Leer hoja principal (Contado o primera hoja) ──
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  // Identificar empresa
  let empresaRaw = ''
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const row = data[r]
    if (!row) continue
    for (let c = 0; c < Math.min(10, row.length); c++) {
      const val = String(row[c] || '').trim()
      if (val.toLowerCase() === 'empresa:' || val.toLowerCase() === 'empresa') {
        empresaRaw = String(row[c + 1] || '').trim()
        if (!empresaRaw) empresaRaw = String((data[r + 1] || [])[c] || '').trim()
        break
      }
    }
    if (empresaRaw) break
  }
  if (!empresaRaw) {
    for (let c = 0; c < 6; c++) {
      const v = String((data[3] || [])[c] || '').trim()
      if (v && v !== 'Empresa:' && v.length > 2 && !v.includes('Fecha')) { empresaRaw = v; break }
    }
  }

  // Detectar tipo
  let tipo, centro
  const esUpper = empresaRaw === empresaRaw.toUpperCase() && empresaRaw.length > 0
  const tieneYonker = empresaRaw.toLowerCase().includes('yonker')
  if (tieneYonker && esUpper) { tipo = 'yonker_interno'; centro = 'Yonker' }
  else if (tieneYonker && !esUpper) { tipo = 'yonker_fiscal'; centro = 'Yonker' }
  else if (!tieneYonker && esUpper) { tipo = 'tecnimax_interno'; centro = 'Tecnicentro' }
  else if (!tieneYonker && !esUpper && empresaRaw) { tipo = 'tecnimax_fiscal'; centro = 'Tecnicentro' }
  else { tipo = 'desconocido'; centro = empresaRaw || '?' }

  // Parsear hoja Contado (primera hoja)
  const facturasContado = parseSheet(ws)

  // ── Leer hoja Crédito si existe ──
  let facturasCredito = []
  const creditoSheetName = wb.SheetNames.find(s => s.toLowerCase().includes('créd') || s.toLowerCase().includes('cred'))
  if (creditoSheetName) {
    facturasCredito = parseSheet(wb.Sheets[creditoSheetName])
    facturasCredito.forEach(f => f.tipo_venta = 'Crédito')
  }

  // Todas las facturas (contado + crédito) para validación de correlativos
  const todasFacturas = [...facturasContado, ...facturasCredito]

  const totales = {
    subtotal: facturasContado.reduce((s, f) => s + f.subtotal, 0),
    impuestos: facturasContado.reduce((s, f) => s + f.impuestos, 0),
    total: facturasContado.reduce((s, f) => s + f.total, 0),
    exento: facturasContado.reduce((s, f) => s + f.total_exento, 0),
  }

  const totalesCredito = {
    subtotal: facturasCredito.reduce((s, f) => s + f.subtotal, 0),
    impuestos: facturasCredito.reduce((s, f) => s + f.impuestos, 0),
    total: facturasCredito.reduce((s, f) => s + f.total, 0),
    exento: facturasCredito.reduce((s, f) => s + f.total_exento, 0),
  }

  return { empresaRaw, tipo, centro, facturas: facturasContado, facturasCredito, todasFacturas, totales, totalesCredito }
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
      const creditCount = r.facturasCredito?.length || 0
      const creditInfo = creditCount ? ` + ${creditCount} crédito` : ''
      alertas.push({ tipo: 'info', msg: `📄 "${r.empresaRaw}" → ${r.tipo} (${r.facturas.length} facturas${creditInfo}, centro: ${r.centro})` })
    }

    // Verificar que se subieron los 4 tipos
    if (!tecnimax_fiscal) alertas.push({ tipo: 'error', msg: 'Falta reporte: Tecnimax fiscal (Tecnimax en minúscula)' })
    if (!tecnimax_interno) alertas.push({ tipo: 'error', msg: 'Falta reporte: TECNIMAX interno (TECNIMAX en mayúscula)' })
    if (!yonker_fiscal) alertas.push({ tipo: 'error', msg: 'Falta reporte: Yonker Tecnimax fiscal (Yonker Tecnimax en minúscula)' })
    if (!yonker_interno) alertas.push({ tipo: 'error', msg: 'Falta reporte: YONKER TECNIMAX interno (YONKER TECNIMAX en mayúscula)' })

    // Correlativos — usar todasFacturas (contado + crédito) para no marcar créditos como faltantes
    for (const r of reportes) {
      if (!r) continue
      const corr = validarCorrelativos(r.todasFacturas || r.facturas)
      if (!corr.ok) {
        alertas.push({ tipo: 'warning', msg: `⚠️ ${r.empresaRaw}: Correlativos faltantes: ${corr.faltantes.join(', ')}` })
      } else {
        alertas.push({ tipo: 'success', msg: `✅ ${r.empresaRaw}: Correlativos completos (${corr.rango})` })
      }
      // Mostrar info de facturas de crédito encontradas
      if (r.facturasCredito?.length) {
        const clientesCredito = r.facturasCredito.map(f => `${f.cliente} (L.${f.total.toLocaleString('es-HN',{minimumFractionDigits:2})})`).join(', ')
        alertas.push({ tipo: 'info', msg: `💳 ${r.empresaRaw}: ${r.facturasCredito.length} factura(s) a crédito: ${clientesCredito}` })
      }
    }

    // ISV en Tecnimax (fiscal e interno)
    const isvWarnings = {} // factura_electronica → warning text
    window._isvWarnings = isvWarnings
    for (const r of [tecnimax_fiscal, tecnimax_interno]) {
      if (!r) continue
      const errISV = validarISV(r.facturas)
      if (errISV.length) {
        for (const e of errISV) {
          alertas.push({ tipo: 'warning', msg: `⚠️ ${r.empresaRaw} Fact. ${e.factura}: ISV ${e.isv.toFixed(2)} ≠ esperado ${e.esperado.toFixed(2)} (diff: ${e.diff.toFixed(2)})` })
          isvWarnings[e.factura] = `ISV ${e.isv.toFixed(2)} ≠ esperado ${e.esperado.toFixed(2)} (diff: ${e.diff.toFixed(2)})`
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

    // ── Aviso de control de rango SAR propio (fecha límite y fin de rango) ──
    try {
      const { data: rangosP } = await sb.from('rangos_propios').select('*').eq('activo', true)
      if (rangosP?.length) {
        const corrDe = (num) => { const m = String(num || '').match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : null }
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
        // Mapa centro nombre → reportes (para saber el último correlativo facturado)
        for (const r of reportes) {
          if (!r) continue
          // Buscar el rango propio cuyo centro coincida con el del reporte (por nombre de centro)
          const facturasR = r.todasFacturas || r.facturas || []
          let maxN = null, prefijoFact = ''
          for (const f of facturasR) {
            const n = corrDe(f.factura_electronica)
            if (n != null && (maxN == null || n > maxN)) maxN = n
            if (!prefijoFact && f.factura_electronica) { const p = String(f.factura_electronica).split('-'); if (p.length >= 4) prefijoFact = p.slice(0, -1).join('-') }
          }
          // Casar por prefijo del rango con el de las facturas
          const rango = rangosP.find(rp => rp.prefijo && prefijoFact && prefijoFact.startsWith(rp.prefijo))
          if (!rango) continue
          // Fecha límite
          if (rango.fecha_limite) {
            const dias = Math.round((new Date(rango.fecha_limite + 'T00:00:00') - hoy) / 864e5)
            if (dias < 0) alertas.push({ tipo: 'error', msg: `🛑 ${r.empresaRaw}: tu CAI venció hace ${-dias} día(s) (${rango.fecha_limite}). Renová antes de seguir facturando.` })
            else if (dias <= 7) alertas.push({ tipo: 'error', msg: `⏰ ${r.empresaRaw}: tu CAI vence en ${dias} día(s) (${rango.fecha_limite}). Gestioná la renovación YA.` })
            else if (dias <= 30) alertas.push({ tipo: 'warning', msg: `📅 ${r.empresaRaw}: tu CAI vence en ${dias} día(s) (${rango.fecha_limite}).` })
          }
          // Fin de rango (5%)
          const desde = corrDe(rango.rango_desde), hasta = corrDe(rango.rango_hasta)
          if (desde != null && hasta != null && maxN != null && hasta >= desde) {
            const total = hasta - desde + 1
            const restantes = hasta - maxN
            const pct = (restantes / total) * 100
            if (restantes < 0) alertas.push({ tipo: 'error', msg: `🛑 ${r.empresaRaw}: estás facturando FUERA de tu rango autorizado (último: ${maxN}, tope: ${hasta}).` })
            else if (pct <= 5) alertas.push({ tipo: 'warning', msg: `📉 ${r.empresaRaw}: te quedan ${restantes} factura(s) de tu rango autorizado (tope ${hasta}). Gestioná un nuevo rango.` })
          }
        }
      }
    } catch (e) { console.log('Aviso rango propio no disponible:', e) }

    importData = { tecnimax_fiscal, tecnimax_interno, yonker_fiscal, yonker_interno, alertas }

    // Cargar cuentas detalle para búsqueda de CxC clientes
    if (!cuentasDetalle.length) {
      const { data } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').eq('es_detalle', true).order('codigo')
      cuentasDetalle = data || []
    }

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
  const tfc = d.tecnimax_fiscal?.totalesCredito || { total: 0 }
  const tic = d.tecnimax_interno?.totalesCredito || { total: 0 }
  const yfc = d.yonker_fiscal?.totalesCredito || { total: 0 }
  const yic = d.yonker_interno?.totalesCredito || { total: 0 }
  const totContado = tf.total + ti.total + yf.total + yi.total
  const totCredito = tfc.total + tic.total + yfc.total + yic.total
  const granTotal = totContado + totCredito

  // Fila de crédito (solo si hay) para cada tarjeta
  const rowCred = (c) => (c && c.total > 0)
    ? `<div class="imp-sum-row"><span class="label" style="color:var(--blue)">+ Crédito</span><span class="value" style="color:var(--blue)">${fmt(c.total)}</span></div>`
    : ''

  document.getElementById('import-resumen').innerHTML = `
    <div class="imp-summary">
      <div class="imp-sum-card">
        <div class="imp-sum-title">Tecnimax Fiscal (${d.tecnimax_fiscal?.facturas.length || 0} contado${tfc.total > 0 ? ' + ' + (d.tecnimax_fiscal?.facturasCredito.length || 0) + ' créd.' : ''})</div>
        <div class="imp-sum-row"><span class="label">Subtotal</span><span class="value">${fmt(tf.subtotal)}</span></div>
        <div class="imp-sum-row"><span class="label">ISV 15%</span><span class="value">${fmt(tf.impuestos)}</span></div>
        <div class="imp-sum-row"><span class="label">Contado</span><span class="value">${fmt(tf.total)}</span></div>
        ${rowCred(tfc)}
        <div class="imp-sum-row imp-sum-total"><span class="label">Total</span><span class="value">${fmt(tf.total + tfc.total)}</span></div>
      </div>
      <div class="imp-sum-card">
        <div class="imp-sum-title">TECNIMAX Interno (${d.tecnimax_interno?.facturas.length || 0} contado${tic.total > 0 ? ' + ' + (d.tecnimax_interno?.facturasCredito.length || 0) + ' créd.' : ''})</div>
        <div class="imp-sum-row"><span class="label">Subtotal</span><span class="value">${fmt(ti.subtotal)}</span></div>
        <div class="imp-sum-row"><span class="label">ISV (Bono)</span><span class="value">${fmt(ti.impuestos)}</span></div>
        <div class="imp-sum-row"><span class="label">Contado</span><span class="value">${fmt(ti.total)}</span></div>
        ${rowCred(tic)}
        <div class="imp-sum-row imp-sum-total"><span class="label">Total</span><span class="value">${fmt(ti.total + tic.total)}</span></div>
      </div>
      <div class="imp-sum-card">
        <div class="imp-sum-title">Yonker Fiscal (${d.yonker_fiscal?.facturas.length || 0} contado${yfc.total > 0 ? ' + ' + (d.yonker_fiscal?.facturasCredito.length || 0) + ' créd.' : ''})</div>
        <div class="imp-sum-row"><span class="label">Contado exento</span><span class="value">${fmt(yf.total)}</span></div>
        ${rowCred(yfc)}
        <div class="imp-sum-row imp-sum-total"><span class="label">Total</span><span class="value">${fmt(yf.total + yfc.total)}</span></div>
      </div>
      <div class="imp-sum-card">
        <div class="imp-sum-title">YONKER Interno (${d.yonker_interno?.facturas.length || 0} contado${yic.total > 0 ? ' + ' + (d.yonker_interno?.facturasCredito.length || 0) + ' créd.' : ''})</div>
        <div class="imp-sum-row"><span class="label">Contado exento</span><span class="value">${fmt(yi.total)}</span></div>
        ${rowCred(yic)}
        <div class="imp-sum-row imp-sum-total"><span class="label">Total</span><span class="value">${fmt(yi.total + yic.total)}</span></div>
      </div>
    </div>
    <div style="text-align:center;padding:12px;background:var(--bg3);border-radius:var(--radius);border:0.5px solid var(--gold)">
      <span style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Gran Total del día</span>
      <div style="font-size:24px;font-family:var(--mono);color:var(--gold);font-weight:500;margin-top:4px">${fmt(granTotal)}</div>
      ${totCredito > 0 ? `<div style="font-size:12px;color:var(--text3);margin-top:4px">Contado: ${fmt(totContado)} · Crédito: <span style="color:var(--blue)">${fmt(totCredito)}</span></div>` : ''}
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

  // Obtener números y detectar faltantes — verificar en hoja Crédito antes de marcar como anulada
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

  // Obtener facturas de crédito del mismo reporte para cruzar
  const reporteActual = importFiscalTab === 'tecnimax' ? d.tecnimax_fiscal : d.yonker_fiscal
  const factsCredito = reporteActual?.facturasCredito || []

  if (nums.length > 0) {
    const sorted = [...nums].sort((a, b) => a - b)
    // Incluir también nums de crédito para ampliar el rango
    const numsCredito = []
    for (const fc of factsCredito) {
      const parts = fc.factura_electronica.split('-')
      if (parts.length >= 4) numsCredito.push(parseInt(parts[parts.length - 1]))
    }
    const allNums = [...sorted, ...numsCredito].sort((a, b) => a - b)
    const minN = allNums[0], maxN = allNums[allNums.length - 1]

    for (let n = minN; n <= maxN; n++) {
      const facNum = `${prefix}-${String(n).padStart(8, '0')}`
      const facReal = facturas.find(f => f.factura_electronica === facNum)
      const facCredito = factsCredito.find(f => f.factura_electronica === facNum)
      if (facReal) {
        facturasConAnuladas.push({ ...facReal, anulada: false, esCredito: false })
      } else if (facCredito) {
        facturasConAnuladas.push({ ...facCredito, anulada: false, esCredito: true })
      } else {
        facturasConAnuladas.push({
          factura_electronica: facNum,
          cliente: 'ANULADA',
          rtn: '',
          subtotal: 0,
          impuestos: 0,
          total: 0,
          anulada: true,
          esCredito: false
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
    if (f.esCredito) {
      return `<tr style="background:#3b82f608">
        <td class="mono" style="color:var(--blue)">${f.factura_electronica}</td>
        <td style="color:var(--blue);font-weight:500">💳 ${f.cliente} <span style="font-size:10px;opacity:0.7">(CRÉDITO)</span></td>
        <td class="mono" style="color:var(--text3)">${f.rtn && f.rtn !== 'null' && f.rtn !== 'NaN' ? f.rtn : '—'}</td>
        <td class="mono" style="text-align:right">${fmt(f.subtotal)}</td>
        <td class="mono" style="text-align:right">${fmt(f.impuestos)}</td>
        <td class="mono" style="text-align:right;font-weight:500;color:var(--blue)">${fmt(f.total)}</td>
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

  // Calcular total de facturas a crédito de todos los reportes, separado por origen
  let totalCredito = 0
  let creditoTecnimaxFiscalSub = 0, creditoTecnimaxFiscalISV = 0
  let creditoTecnimaxIntSub = 0, creditoTecnimaxIntISV = 0
  let creditoYonkerFiscalTotal = 0
  let creditoYonkerIntTotal = 0
  const facturasCredito = []

  const addCreditos = (r, tipo) => {
    if (!r?.facturasCredito?.length) return
    for (const fc of r.facturasCredito) {
      totalCredito += fc.total
      facturasCredito.push({ ...fc, centro: r.centro })
      if (tipo === 'tecnimax_fiscal') { creditoTecnimaxFiscalSub += fc.subtotal; creditoTecnimaxFiscalISV += fc.impuestos }
      else if (tipo === 'tecnimax_interno') { creditoTecnimaxIntSub += fc.subtotal; creditoTecnimaxIntISV += fc.impuestos }
      else if (tipo === 'yonker_fiscal') { creditoYonkerFiscalTotal += fc.total }
      else if (tipo === 'yonker_interno') { creditoYonkerIntTotal += fc.total }
    }
  }
  addCreditos(d.tecnimax_fiscal, 'tecnimax_fiscal')
  addCreditos(d.tecnimax_interno, 'tecnimax_interno')
  addCreditos(d.yonker_fiscal, 'yonker_fiscal')
  addCreditos(d.yonker_interno, 'yonker_interno')

  const r2 = (v) => Math.round(v * 100) / 100

  // Calcular total haber primero para que caja cuadre por diferencia
  const totalHaber = r2(
    (tf.subtotal + creditoTecnimaxFiscalSub) +
    (tf.impuestos + creditoTecnimaxFiscalISV) +
    (yf.total + creditoYonkerFiscalTotal) +
    (ti.subtotal + creditoTecnimaxIntSub) +
    (ti.impuestos + creditoTecnimaxIntISV) +
    (yi.total + creditoYonkerIntTotal)
  )
  const totalCxC = r2(totalCredito)
  const totalCaja = r2(totalHaber - totalCxC)

  const fmt = (v) => v.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const C = IMPORT_CUENTAS

  const lineas = [
    // DÉBITO — Caja General (total haber menos CxC para cuadrar exacto)
    { codigo: C.caja_general.codigo, nombre: C.caja_general.nombre, centro: '—', debe: totalCaja, haber: 0, fiscal: '—' },
  ]

  // DÉBITO — Cuentas por cobrar (facturas a crédito)
  for (const fc of facturasCredito) {
    const clienteNombre = fc.cliente.trim().toUpperCase()
    const cxcCuenta = cuentasDetalle.find(c => c.codigo.startsWith('110201-') && c.nombre.toUpperCase().includes(clienteNombre))
    lineas.push({
      codigo: cxcCuenta ? cxcCuenta.codigo : '110201-???',
      nombre: cxcCuenta ? cxcCuenta.nombre : `CxC ${clienteNombre} (cuenta no encontrada)`,
      centro: fc.centro === 'Yonker' ? 'Yonker' : 'Tecnicentro',
      debe: fc.total, haber: 0,
      fiscal: fc.tipo_venta === 'Crédito' ? '💳' : '—',
      _esCxC: true, _cliente: clienteNombre, _encontrada: !!cxcCuenta
    })
  }

  // CRÉDITOS — incluyen contado + crédito (la venta se registra igual, solo cambia el débito)
  lineas.push(
    { codigo: C.venta_tecnimax.codigo, nombre: C.venta_tecnimax.nombre, centro: 'Tecnicentro', debe: 0, haber: r2(tf.subtotal + creditoTecnimaxFiscalSub), fiscal: '✓' },
    { codigo: C.isv_ventas.codigo, nombre: C.isv_ventas.nombre, centro: '—', debe: 0, haber: r2(tf.impuestos + creditoTecnimaxFiscalISV), fiscal: '✓' },
    { codigo: C.venta_yonker.codigo, nombre: C.venta_yonker.nombre, centro: 'Yonker', debe: 0, haber: r2(yf.total + creditoYonkerFiscalTotal), fiscal: '✓' },
    { codigo: C.venta_tecnimax_int.codigo, nombre: C.venta_tecnimax_int.nombre, centro: 'Tecnicentro', debe: 0, haber: r2(ti.subtotal + creditoTecnimaxIntSub), fiscal: '—' },
    { codigo: C.bono_tecnimax.codigo, nombre: C.bono_tecnimax.nombre, centro: 'Tecnicentro', debe: 0, haber: r2(ti.impuestos + creditoTecnimaxIntISV), fiscal: '—' },
    { codigo: C.venta_yonker_int.codigo, nombre: C.venta_yonker_int.nombre, centro: 'Yonker', debe: 0, haber: r2(yi.total + creditoYonkerIntTotal), fiscal: '—' },
  )

  const filtered = lineas.filter(l => l.debe > 0 || l.haber > 0)

  const tbody = document.getElementById('tbody-import-partida')
  tbody.innerHTML = filtered.map(l => {
    const cxcStyle = l._esCxC ? (l._encontrada ? 'color:var(--blue)' : 'color:var(--red)') : ''
    return `<tr>
      <td><span class="mono" style="color:var(--gold);margin-right:8px">${l.codigo}</span><span style="${cxcStyle}">${l.nombre}</span></td>
      <td>${l.centro}</td>
      <td class="mono" style="text-align:right;color:${l.debe > 0 ? 'var(--text)' : 'var(--text3)'}">${l.debe > 0 ? fmt(l.debe) : ''}</td>
      <td class="mono" style="text-align:right;color:${l.haber > 0 ? 'var(--text)' : 'var(--text3)'}">${l.haber > 0 ? fmt(l.haber) : ''}</td>
      <td style="text-align:center;color:${l.fiscal === '✓' ? 'var(--green)' : l.fiscal === '💳' ? 'var(--blue)' : 'var(--text3)'}">${l.fiscal}</td>
    </tr>`
  }).join('')

  const totD = Math.round(filtered.reduce((s, l) => s + l.debe, 0) * 100) / 100
  const totC = Math.round(filtered.reduce((s, l) => s + l.haber, 0) * 100) / 100
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
    const { data } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').order('codigo')
    cuentasDetalle = data || []
  }

  const getCuenta = (codigo) => cuentasDetalle.find(c => c.codigo === codigo)

  // ── Recopilar facturas de crédito de todos los reportes ──
  let totalCredito = 0
  let crTFSub = 0, crTFISV = 0, crTISub = 0, crTIISV = 0, crYFTot = 0, crYITot = 0
  const facturasCredito = []
  const addCr = (r, tipo) => {
    if (!r?.facturasCredito?.length) return
    for (const fc of r.facturasCredito) {
      totalCredito += fc.total
      const centro = r.centro
      const ccId = centro === 'Yonker' ? (ccYonker?.id || '') : (ccTecni?.id || '')
      facturasCredito.push({ ...fc, ccId, centro })
      if (tipo === 'tf') { crTFSub += fc.subtotal; crTFISV += fc.impuestos }
      else if (tipo === 'ti') { crTISub += fc.subtotal; crTIISV += fc.impuestos }
      else if (tipo === 'yf') { crYFTot += fc.total }
      else if (tipo === 'yi') { crYITot += fc.total }
    }
  }
  addCr(d.tecnimax_fiscal, 'tf')
  addCr(d.tecnimax_interno, 'ti')
  addCr(d.yonker_fiscal, 'yf')
  addCr(d.yonker_interno, 'yi')

  const r2 = (v) => Math.round(v * 100) / 100

  // Preparar líneas de CRÉDITO — incluyen contado + crédito
  const creditosRaw = [
    { cuenta: C.venta_tecnimax, monto: r2(tf.subtotal + crTFSub), cc: ccTecni?.id || '', fiscal: true },
    { cuenta: C.isv_ventas, monto: r2(tf.impuestos + crTFISV), cc: '', fiscal: true },
    { cuenta: C.venta_yonker, monto: r2(yf.total + crYFTot), cc: ccYonker?.id || '', fiscal: true },
    { cuenta: C.venta_tecnimax_int, monto: r2(ti.subtotal + crTISub), cc: ccTecni?.id || '', fiscal: false },
    { cuenta: C.bono_tecnimax, monto: r2(ti.impuestos + crTIISV), cc: ccTecni?.id || '', fiscal: false },
    { cuenta: C.venta_yonker_int, monto: r2(yi.total + crYITot), cc: ccYonker?.id || '', fiscal: false },
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

  // ── DÉBITO: Líneas de CxC para facturas a crédito ──
  for (const fc of facturasCredito) {
    const clienteNombre = fc.cliente.trim().toUpperCase()
    const cxcCuenta = cuentasDetalle.find(c => c.codigo.startsWith('110201-') && c.nombre.toUpperCase().includes(clienteNombre))
    if (cxcCuenta) {
      lineaCounter++
      partidaLineas.push({
        id: lineaCounter,
        cuenta_id: cxcCuenta.id,
        cuenta_codigo: cxcCuenta.codigo,
        cuenta_nombre: cxcCuenta.nombre,
        tipo: 'debito',
        monto: Math.round(fc.total * 100) / 100,
        centro_costo_id: fc.ccId,
        descripcion: `CXC ${clienteNombre} FACT ${fc.factura_electronica}`,
        aplica_fiscal: true
      })
    } else {
      // Cuenta no encontrada — agregar línea vacía con nota
      lineaCounter++
      partidaLineas.push({
        id: lineaCounter,
        cuenta_id: '',
        cuenta_codigo: '',
        cuenta_nombre: '',
        tipo: 'debito',
        monto: Math.round(fc.total * 100) / 100,
        centro_costo_id: fc.ccId,
        descripcion: `⚠ CXC ${clienteNombre} - BUSCAR CUENTA`,
        aplica_fiscal: true
      })
    }
  }

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

  // Fallback: rellenar cuenta_id de líneas que tengan código pero no id (el flag
  // es_detalle pudo dejarlas fuera de cuentasDetalle). Sin esto, el cuadre no
  // cuenta esas líneas y la partida aparece descuadrada hasta reescribir la cuenta.
  const sinId = partidaLineas.filter(l => l.cuenta_codigo && !l.cuenta_id)
  if (sinId.length) {
    const codigos = [...new Set(sinId.map(l => l.cuenta_codigo))]
    const { data: ctasBD } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').in('codigo', codigos)
    for (const l of sinId) {
      const cta = (ctasBD || []).find(c => c.codigo === l.cuenta_codigo)
      if (cta) { l.cuenta_id = cta.id; if (!l.cuenta_nombre) l.cuenta_nombre = cta.nombre }
    }
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
    isvWarnings: window._isvWarnings || {},
  }

  toast('Créditos cargados. Completá los débitos con las formas de pago.', 'info')
}
// ══════════════════════════════════════════════
// ── CONTEO DE BILLETES (DENOMINACIONES)
// ══════════════════════════════════════════════

const DENOMINACIONES = [1, 2, 5, 10, 20, 50, 100, 200, 500]
let billetesCallback = null
let billetesConteo = {}
let billetesChequeMonto = 0  // Valor total de cheques
let billetesObjetivo = 0     // Monto que se quiere alcanzar (para la resta en vivo)
let billetesStock = null     // Stock disponible por denominación (solo egresos): {den: cantidad} o null

// Stock disponible por denominación de una caja (ingresos − egresos de conteos aprobados).
// Agrupa igual que el Arqueo: caja general = todo lo que NO es caja chica; caja chica = su propia cuenta.
async function cajaStockDenom(cuentaCodigo, excludePartidaId) {
  const stock = {}
  DENOMINACIONES.forEach(d => stock[d] = 0)
  if (!cuentaCodigo) return stock
  const esChica = String(cuentaCodigo).startsWith('110101')
  const { data } = await sb.from('conteo_billetes')
    .select('tipo, partida_id, cuenta_codigo, den_500,den_200,den_100,den_50,den_20,den_10,den_5,den_2,den_1, partida:partidas_contables(estado)')
  for (const c of (data || [])) {
    if (excludePartidaId && c.partida_id === excludePartidaId) continue
    if (!(c.partida?.estado === 'aprobada' || c.partida_id === null)) continue
    const enGrupo = esChica
      ? (c.cuenta_codigo === cuentaCodigo)      // cada caja chica = su propia cuenta
      : (c.cuenta_codigo !== '110101-001')      // caja general = todo lo que no es caja chica (igual que el arqueo)
    if (!enGrupo) continue
    const signo = c.tipo === 'ingreso' ? 1 : (c.tipo === 'egreso' ? -1 : 0)
    DENOMINACIONES.forEach(d => { stock[d] += signo * (c[`den_${d}`] || 0) })
  }
  return stock
}

async function openBilletes(titulo, subtitulo, callback, initialValues, objetivo, cuentaCodigo, chequearStock) {
  billetesCallback = callback
  billetesConteo = {}
  DENOMINACIONES.forEach(d => billetesConteo[d] = (initialValues && initialValues[d]) || 0)
  billetesChequeMonto = (initialValues && initialValues._cheques) || 0
  billetesObjetivo = objetivo || 0
  billetesStock = (chequearStock && cuentaCodigo) ? await cajaStockDenom(cuentaCodigo, editingPartidaId) : null
  document.getElementById('billetes-title').textContent = titulo || '💵 Conteo de billetes'
  document.getElementById('billetes-sub').textContent = subtitulo || 'Ingresa la cantidad de cada denominación'
  _ensureBilletesObjetivo()
  const objInput = document.getElementById('billetes-objetivo')
  if (objInput) objInput.value = billetesObjetivo ? billetesObjetivo : ''
  renderBilletes()
  document.getElementById('modal-billetes').classList.add('open')
  setTimeout(() => {
    const first = document.querySelector('#tbody-billetes input')
    if (first) first.focus()
  }, 200)
}

// Inyecta (una sola vez) el campo "Monto objetivo" + indicador de resta en el modal de billetes
function _ensureBilletesObjetivo() {
  if (document.getElementById('billetes-objetivo-wrap')) return
  const sub = document.getElementById('billetes-sub')
  if (!sub || !sub.parentNode) return
  const w = document.createElement('div')
  w.id = 'billetes-objetivo-wrap'
  w.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin:10px 0;padding:10px 12px;background:var(--bg3);border-radius:8px;border:0.5px solid var(--border)'
  w.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <label style="font-size:13px;color:var(--text2)">Monto objetivo:</label>
      <input type="text" inputmode="decimal" id="billetes-objetivo" placeholder="0.00" oninput="window.updBilletesObjetivo(this.value)" onfocus="this.select()"
        style="width:120px;text-align:right;font-family:var(--mono);font-size:15px;padding:6px 8px;background:var(--bg2);border:0.5px solid var(--gold);border-radius:6px;color:var(--text);outline:none">
      <span id="billetes-falta" style="font-family:var(--mono);font-size:14px;font-weight:600;margin-left:auto"></span>
    </div>
    <div id="billetes-stock-warn" style="font-size:12px;color:var(--red);font-weight:600"></div>`
  sub.parentNode.insertBefore(w, sub.nextSibling)
}

function renderBilletes() {
  const tbody = document.getElementById('tbody-billetes')
  let rows = DENOMINACIONES.slice().map(d => {
    const qty = billetesConteo[d] || 0
    const sub = qty * d
    const disp = billetesStock ? (billetesStock[d] || 0) : null
    const over = disp !== null && qty > disp
    return `<tr>
      <td style="padding:8px 12px">
        <span style="font-family:var(--mono);font-size:15px;color:var(--text);font-weight:500">L. ${d.toLocaleString('es-HN')}</span>
        ${disp !== null ? `<div id="bill-disp-${d}" style="font-size:11px;color:${over ? 'var(--red)' : 'var(--text3)'}">disp: ${disp}</div>` : ''}
      </td>
      <td style="padding:8px 12px;text-align:center">
        <input type="text" inputmode="numeric" pattern="[0-9]*" value="${qty || ''}" placeholder="0" data-denom="${d}"
          class="bill-input" oninput="updBillete(${d},this.value)" onblur="window.resolveBillete(${d},this)" onfocus="this.select()" onkeydown="window.billeteKey(event,this)"
          style="width:70px;text-align:center;background:var(--bg3);border:0.5px solid ${over ? 'var(--red)' : 'var(--border)'};border-radius:6px;padding:8px;color:var(--text);font-family:var(--mono);font-size:15px;outline:none">
      </td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--mono);font-size:14px;min-width:120px" id="bill-sub-${d}">
        ${sub > 0 ? '<span style="color:var(--green)">L. ' + sub.toLocaleString('es-HN', {minimumFractionDigits:2}) + '</span>' : '<span style="color:var(--text3)">—</span>'}
      </td>
    </tr>`
  }).join('')

  // Fila de cheques
  const cheqVal = billetesChequeMonto || 0
  rows += `<tr style="border-top:2px solid var(--border)">
    <td style="padding:8px 12px">
      <span style="font-size:14px;color:var(--amber);font-weight:500">📄 Cheques</span>
    </td>
    <td style="padding:8px 12px;text-align:center" colspan="1">
      <input type="text" inputmode="decimal" value="${cheqVal || ''}" placeholder="0.00"
        class="bill-input" oninput="updBilletesCheque(this.value)" onblur="window.resolveCheque(this)" onfocus="this.select()" onkeydown="window.billeteKey(event,this)"
        style="width:100px;text-align:center;background:rgba(245,158,11,0.05);border:0.5px solid var(--amber);border-radius:6px;padding:8px;color:var(--amber);font-family:var(--mono);font-size:15px;outline:none">
    </td>
    <td style="padding:8px 12px;text-align:right;font-family:var(--mono);font-size:14px" id="bill-sub-cheques">
      ${cheqVal > 0 ? '<span style="color:var(--amber)">L. ' + cheqVal.toLocaleString('es-HN', {minimumFractionDigits:2}) + '</span>' : '<span style="color:var(--text3)">—</span>'}
    </td>
  </tr>`

  tbody.innerHTML = rows
  updateBilletesTotal()
}

// Evalúa una expresión aritmética estilo Excel (+, -, *, /, paréntesis). Devuelve número o NaN.
// Sin eval/Function: tokeniza y resuelve con shunting-yard; solo acepta caracteres aritméticos.
function evalExprSeguro(expr) {
  const s = String(expr).trim()
  if (!s) return 0
  if (!/^[\d\s+\-*/.()]+$/.test(s)) return NaN
  const tokens = s.match(/\d+\.?\d*|[+\-*/()]/g)
  if (!tokens) return NaN
  const out = [], ops = [], prec = { '+': 1, '-': 1, '*': 2, '/': 2 }
  let prev = null
  for (const t of tokens) {
    if (/^[\d.]/.test(t)) { out.push(parseFloat(t)); prev = 'num' }
    else if (t === '(') { ops.push(t); prev = '(' }
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop())
      if (!ops.length) return NaN
      ops.pop(); prev = 'num'
    } else {
      if ((t === '+' || t === '-') && (prev === null || prev === 'op' || prev === '(')) out.push(0) // unario (+1, -3...)
      while (ops.length && prec[ops[ops.length - 1]] >= prec[t]) out.push(ops.pop())
      ops.push(t); prev = 'op'
    }
  }
  while (ops.length) { const o = ops.pop(); if (o === '(') return NaN; out.push(o) }
  const st = []
  for (const x of out) {
    if (typeof x === 'number') st.push(x)
    else {
      const b = st.pop(), a = st.pop()
      if (a === undefined || b === undefined) return NaN
      st.push(x === '+' ? a + b : x === '-' ? a - b : x === '*' ? a * b : a / b)
    }
  }
  return st.length === 1 ? st[0] : NaN
}

// Al salir de la celda, muestra el resultado entero ya calculado (como Excel)
window.resolveBillete = (denom, el) => { el.value = billetesConteo[denom] ? billetesConteo[denom] : '' }
window.resolveCheque = (el) => { el.value = billetesChequeMonto ? billetesChequeMonto : '' }

window.updBillete = (denom, val) => {
  const n = evalExprSeguro(val)
  if (!isNaN(n) && n >= 0) billetesConteo[denom] = Math.round(n) // billetes = entero
  const sub = billetesConteo[denom] * denom
  const subEl = document.getElementById('bill-sub-' + denom)
  if (subEl) {
    subEl.innerHTML = sub > 0 ? '<span style="color:var(--green)">L. ' + sub.toLocaleString('es-HN', {minimumFractionDigits:2}) + '</span>' : '<span style="color:var(--text3)">—</span>'
  }
  if (billetesStock) {
    const over = (billetesConteo[denom] || 0) > (billetesStock[denom] || 0)
    const inp = document.querySelector(`#tbody-billetes input[data-denom="${denom}"]`)
    if (inp) inp.style.borderColor = over ? 'var(--red)' : 'var(--border)'
    const dispEl = document.getElementById('bill-disp-' + denom)
    if (dispEl) dispEl.style.color = over ? 'var(--red)' : 'var(--text3)'
  }
  updateBilletesTotal()
}

window.updBilletesCheque = (val) => {
  const n = evalExprSeguro(val)
  if (!isNaN(n) && n >= 0) billetesChequeMonto = Math.round(n * 100) / 100
  const subEl = document.getElementById('bill-sub-cheques')
  if (subEl) {
    subEl.innerHTML = billetesChequeMonto > 0
      ? '<span style="color:var(--amber)">L. ' + billetesChequeMonto.toLocaleString('es-HN', {minimumFractionDigits:2}) + '</span>'
      : '<span style="color:var(--text3)">—</span>'
  }
  updateBilletesTotal()
}

function updateBilletesTotal() {
  let totalQty = 0, totalMonto = 0
  DENOMINACIONES.forEach(d => {
    totalQty += billetesConteo[d] || 0
    totalMonto += (billetesConteo[d] || 0) * d
  })
  totalMonto += billetesChequeMonto || 0
  if (billetesChequeMonto > 0) totalQty += 1 // Count cheques as 1 item
  document.getElementById('bill-total-qty').textContent = totalQty
  document.getElementById('bill-total-monto').textContent = 'L. ' + totalMonto.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const faltaEl = document.getElementById('billetes-falta')
  if (faltaEl) {
    if (!billetesObjetivo || billetesObjetivo <= 0) {
      faltaEl.textContent = ''
    } else {
      const dif = Math.round((billetesObjetivo - totalMonto) * 100) / 100
      if (Math.abs(dif) < 0.005) faltaEl.innerHTML = '<span style="color:var(--green)">✓ Exacto</span>'
      else if (dif > 0) faltaEl.innerHTML = '<span style="color:var(--amber)">Falta L. ' + dif.toLocaleString('es-HN', { minimumFractionDigits: 2 }) + '</span>'
      else faltaEl.innerHTML = '<span style="color:var(--red)">Sobra L. ' + Math.abs(dif).toLocaleString('es-HN', { minimumFractionDigits: 2 }) + '</span>'
    }
  }
  const warnEl = document.getElementById('billetes-stock-warn')
  if (warnEl) {
    const exceso = billetesStock && DENOMINACIONES.some(d => (billetesConteo[d] || 0) > (billetesStock[d] || 0))
    warnEl.textContent = exceso ? '⚠️ Estás sacando más billetes de los que hay disponibles en la caja' : ''
  }
}

window.updBilletesObjetivo = (val) => {
  const n = evalExprSeguro(String(val).replace(/,/g, ''))
  if (!isNaN(n) && n >= 0) billetesObjetivo = n
  updateBilletesTotal()
}

// Navegación con teclado entre casillas del contador (Enter/↓ baja, ↑ sube)
window.billeteKey = (e, el) => {
  if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const inputs = Array.from(document.querySelectorAll('#tbody-billetes .bill-input'))
  const i = inputs.indexOf(el)
  if (i === -1) return
  const next = (e.key === 'ArrowUp') ? inputs[i - 1] : inputs[i + 1]
  if (next) { next.focus(); if (next.select) next.select() }
}

window.cancelBilletes = () => {
  billetesCallback = null
  document.getElementById('modal-billetes').classList.remove('open')
}

window.aplicarBilletes = () => {
  if (billetesStock) {
    const over = DENOMINACIONES.filter(d => (billetesConteo[d] || 0) > (billetesStock[d] || 0))
    if (over.length) {
      window.toast?.('No hay suficientes billetes en caja para: ' + over.map(d => 'L.' + d).join(', '), 'error')
      return
    }
  }
  let totalMonto = 0
  DENOMINACIONES.forEach(d => totalMonto += (billetesConteo[d] || 0) * d)
  totalMonto += billetesChequeMonto || 0
  if (billetesCallback) {
    const detalle = { ...billetesConteo, _cheques: billetesChequeMonto || 0 }
    billetesCallback(totalMonto, detalle)
  }
  document.getElementById('modal-billetes').classList.remove('open')
  billetesCallback = null
}

// ── Conectar con celdas Debe/Haber de Caja General ──
window.openCajaDebe = (lineaId) => {
  const l = partidaLineas.find(x => x.id === lineaId)
  const existing = l?.billetes || null
  openBilletes('💵 Ingreso a Caja General', 'Contá los billetes que entran a caja', (monto, detalle) => {
    if (l) {
      const montoAnterior = l.monto || 0
      if (montoAnterior > 0 && Math.abs(montoAnterior - monto) > 0.01) {
        if (!confirm(`El monto actual es L. ${montoAnterior.toLocaleString('es-HN',{minimumFractionDigits:2})} pero el conteo suma L. ${monto.toLocaleString('es-HN',{minimumFractionDigits:2})}.\n\n¿Reemplazar el monto con el conteo de billetes?`)) return
      }
      l.tipo = 'debito'; l.monto = monto; l.billetes = detalle
    }
    renderLineas()
    calcTotales()
  }, existing, l?.monto || 0)
}

window.openCajaHaber = (lineaId) => {
  const l = partidaLineas.find(x => x.id === lineaId)
  const existing = l?.billetes || null
  openBilletes('💵 Egreso de Caja General', 'Contá los billetes que salen de caja', (monto, detalle) => {
    if (l) {
      const montoAnterior = l.monto || 0
      if (montoAnterior > 0 && Math.abs(montoAnterior - monto) > 0.01) {
        if (!confirm(`El monto actual es L. ${montoAnterior.toLocaleString('es-HN',{minimumFractionDigits:2})} pero el conteo suma L. ${monto.toLocaleString('es-HN',{minimumFractionDigits:2})}.\n\n¿Reemplazar el monto con el conteo de billetes?`)) return
      }
      l.tipo = 'credito'; l.monto = monto; l.billetes = detalle
    }
    renderLineas()
    calcTotales()
  }, existing, l?.monto || 0, l?.cuenta_codigo, true)
}

// ── ARQUEO DE CAJA ──
window.verArqueo = async () => {
  // Cargar conteos de billetes — solo caja general (excluir caja chica 110101-001)
  const { data: allConteos, error } = await sb.from('conteo_billetes').select('*, partida:partidas_contables(estado)')
  if (error) { toast('Error al cargar arqueo: ' + error.message, 'error'); return }

  // Filtrar: conteos de partidas aprobadas + cambios de denominaciones (sin partida),
  // excluyendo siempre los de caja chica (110101-001)
  const conteos = (allConteos || []).filter(c =>
    (c.partida?.estado === 'aprobada' || c.partida_id === null) &&
    c.cuenta_codigo !== '110101-001'
  )

  const denoms = [1, 2, 5, 10, 20, 50, 100, 200, 500]
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

  // Fila de cheques en el arqueo
  const cheqIng = (conteos || []).filter(c => c.tipo === 'ingreso').reduce((s, c) => s + (parseFloat(c.den_cheques) || 0), 0)
  const cheqEgr = (conteos || []).filter(c => c.tipo === 'egreso').reduce((s, c) => s + (parseFloat(c.den_cheques) || 0), 0)
  const cheqEnCaja = cheqIng - cheqEgr
  totValor += cheqEnCaja

  tbody.innerHTML += `<tr style="border-top:2px solid var(--border)">
    <td style="padding:8px 12px;font-size:14px;font-weight:500;color:var(--amber)">📄 Cheques</td>
    <td style="padding:8px 12px;text-align:center;font-family:var(--mono);color:var(--green)">${cheqIng > 0 ? 'L. ' + cheqIng.toLocaleString('es-HN',{minimumFractionDigits:2}) : '—'}</td>
    <td style="padding:8px 12px;text-align:center;font-family:var(--mono);color:var(--red)">${cheqEgr > 0 ? 'L. ' + cheqEgr.toLocaleString('es-HN',{minimumFractionDigits:2}) : '—'}</td>
    <td style="padding:8px 12px;text-align:center;font-family:var(--mono);font-weight:500;color:${cheqEnCaja >= 0 ? 'var(--amber)' : 'var(--red)'}">L. ${cheqEnCaja.toLocaleString('es-HN',{minimumFractionDigits:2})}</td>
    <td style="padding:8px 12px;text-align:right;font-family:var(--mono);font-size:13px;color:var(--amber)">L. ${cheqEnCaja.toLocaleString('es-HN',{minimumFractionDigits:2})}</td>
  </tr>`

  // Fila de dólares en el arqueo
  const usdSaldo = tcPromedio.saldo_usd || 0
  const usdTc = tcPromedio.tc_promedio || 25
  const usdValorLps = Math.round(usdSaldo * usdTc * 100) / 100
  totValor += usdValorLps

  tbody.innerHTML += `<tr>
    <td style="padding:8px 12px;font-size:14px;font-weight:500;color:var(--blue)">💲 Dólares</td>
    <td style="padding:8px 12px;text-align:center;font-family:var(--mono);color:var(--blue);font-weight:500" colspan="2">$ ${usdSaldo.toLocaleString('en-US',{minimumFractionDigits:2})} × TC ${usdTc.toFixed(4)}</td>
    <td style="padding:8px 12px;text-align:center;font-family:var(--mono);font-weight:500;color:var(--blue)">$ ${usdSaldo.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    <td style="padding:8px 12px;text-align:right;font-family:var(--mono);font-size:13px;color:var(--blue)">L. ${usdValorLps.toLocaleString('es-HN',{minimumFractionDigits:2})}</td>
  </tr>`

  document.getElementById('arq-tot-ing').textContent = totIng
  document.getElementById('arq-tot-egr').textContent = totEgr
  document.getElementById('arq-tot-caja').textContent = totCaja
  document.getElementById('arq-tot-valor').textContent = 'L. ' + totValor.toLocaleString('es-HN', { minimumFractionDigits: 2 })

  document.getElementById('modal-arqueo').classList.add('open')
}

// ══════════════════════════════════════════════
// ── CAJA GENERAL — USD Y CHEQUES
// ══════════════════════════════════════════════

let cajaUsdMoves = []
let cajaChequesMoves = []
let tcPromedio = { saldo_usd: 0, saldo_lps: 0, tc_promedio: 25.00 }

async function loadCajaExtras() {
  // Cargar movimientos USD
  const { data: usd } = await sb.from('caja_usd').select('*').order('created_at', { ascending: false })
  cajaUsdMoves = usd || []

  // Cargar TC promedio
  const { data: tcData } = await sb.from('caja_tc_promedio').select('*').limit(1).single()
  if (tcData) tcPromedio = tcData

  // Cheques: calcular desde conteo_billetes (den_cheques)
  const { data: allConteos } = await sb.from('conteo_billetes').select('tipo, den_cheques')
  let chequesIng = 0, chequesEgr = 0
  ;(allConteos || []).forEach(c => {
    const val = parseFloat(c.den_cheques) || 0
    if (c.tipo === 'ingreso') chequesIng += val
    else chequesEgr += val
  })
  const saldoCheques = chequesIng - chequesEgr

  updateCajaExtrasUI(saldoCheques)
}

function updateCajaExtrasUI(saldoCheques) {
  const fmtD = (v) => (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtL2 = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // USD
  const saldoUsd = tcPromedio.saldo_usd || 0
  const equivLps = saldoUsd * (tcPromedio.tc_promedio || 25)
  const elUsdSaldo = document.getElementById('cj-usd-saldo')
  const elUsdEquiv = document.getElementById('cj-usd-equiv-lps')
  const elTcProm = document.getElementById('cj-tc-promedio')
  if (elUsdSaldo) elUsdSaldo.textContent = `$ ${fmtD(saldoUsd)}`
  if (elUsdEquiv) elUsdEquiv.textContent = `L. ${fmtL2(equivLps)}`
  if (elTcProm) elTcProm.textContent = (tcPromedio.tc_promedio || 25).toFixed(4)

  // Cheques
  const elChqSaldo = document.getElementById('cj-cheques-saldo')
  if (elChqSaldo) elChqSaldo.textContent = `L. ${fmtL2(saldoCheques || 0)}`
}

// ── USD: Cambio bidireccional ──

let cambioUsdConteo = {}

window.onCambioDirChange = () => {
  const dir = document.getElementById('cxusd-dir').value
  const labelUsd = document.getElementById('cxusd-label-usd')
  const labelLps = document.getElementById('cxusd-label-lps')
  if (dir === 'usd_entra') {
    labelUsd.textContent = 'Dólares que entran'
    labelLps.textContent = 'Billetes Lps que salen de caja'
  } else {
    labelUsd.textContent = 'Dólares que salen'
    labelLps.textContent = 'Billetes Lps que entran a caja'
  }
}

window.openModalCambioUSD = () => {
  cambioUsdConteo = {}
  DENOMINACIONES.forEach(d => cambioUsdConteo[d] = 0)
  document.getElementById('cxusd-dir').value = 'usd_entra'
  document.getElementById('cxusd-monto').value = ''
  document.getElementById('cxusd-disp').textContent = `$ ${(tcPromedio.saldo_usd || 0).toFixed(2)}`
  document.getElementById('cxusd-desc').value = ''
  document.getElementById('modal-cxusd-error').classList.add('hidden')
  onCambioDirChange()
  renderCambioUsdTable()
  calcCambioUsdTC()
  document.getElementById('modal-cambio-usd').classList.add('open')
}

function renderCambioUsdTable() {
  const tbody = document.getElementById('tbody-cambio-usd')
  tbody.innerHTML = DENOMINACIONES.slice().reverse().map(d => {
    const qty = cambioUsdConteo[d] || 0
    const sub = qty * d
    return `<tr>
      <td style="padding:6px 10px;font-family:var(--mono);font-size:14px;font-weight:500">L. ${d.toLocaleString('es-HN')}</td>
      <td style="padding:6px 10px;text-align:center">
        <input type="text" inputmode="numeric" value="${qty || ''}" placeholder="0"
          oninput="updCambioUsd(${d},this.value)" onfocus="this.select()"
          style="width:70px;text-align:center;background:var(--bg3);border:0.5px solid var(--border);border-radius:6px;padding:6px;color:var(--text);font-family:var(--mono);font-size:14px;outline:none">
      </td>
      <td style="padding:6px 10px;text-align:right;font-family:var(--mono);font-size:13px;color:${sub > 0 ? 'var(--gold)' : 'var(--text3)'}">
        ${sub > 0 ? 'L. ' + sub.toLocaleString('es-HN', {minimumFractionDigits:2}) : '—'}
      </td>
    </tr>`
  }).join('')
}

window.updCambioUsd = (denom, val) => {
  cambioUsdConteo[denom] = parseInt(val) || 0
  const rows = document.querySelectorAll('#tbl-cambio-usd tbody tr')
  const denoms = DENOMINACIONES.slice().reverse()
  rows.forEach((row, i) => {
    const d = denoms[i]
    const qty = cambioUsdConteo[d] || 0
    const sub = qty * d
    const tdSub = row.querySelector('td:last-child')
    if (tdSub) tdSub.innerHTML = sub > 0
      ? `<span style="color:var(--gold)">L. ${sub.toLocaleString('es-HN', {minimumFractionDigits:2})}</span>`
      : '<span style="color:var(--text3)">—</span>'
  })
  calcCambioUsdTC()
}

window.calcCambioUsdTC = () => {
  let totalLps = 0, totalQty = 0
  DENOMINACIONES.forEach(d => {
    totalLps += (cambioUsdConteo[d] || 0) * d
    totalQty += cambioUsdConteo[d] || 0
  })
  const montoUsd = parseFloat(document.getElementById('cxusd-monto')?.value) || 0
  const tc = montoUsd > 0 ? totalLps / montoUsd : 0

  document.getElementById('cxusd-tot-qty').textContent = totalQty
  document.getElementById('cxusd-tot-lps').textContent = 'L. ' + totalLps.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  document.getElementById('cxusd-tc').textContent = tc > 0 ? tc.toFixed(4) : '—'
  document.getElementById('cxusd-equiv').textContent = 'L. ' + totalLps.toLocaleString('es-HN', { minimumFractionDigits: 2 })
}

window.ejecutarCambioUSD = async () => {
  const dir = document.getElementById('cxusd-dir').value
  const montoUsd = parseFloat(document.getElementById('cxusd-monto').value) || 0
  const desc = document.getElementById('cxusd-desc').value.trim()
  const err = document.getElementById('modal-cxusd-error')

  if (montoUsd <= 0) { showError(err, 'Ingresa el monto USD'); return }

  // Validar: si salen dólares, debe haber suficiente
  if (dir === 'usd_sale' && montoUsd > (tcPromedio.saldo_usd || 0)) {
    showError(err, `Solo hay $ ${(tcPromedio.saldo_usd || 0).toFixed(2)} en caja`)
    return
  }

  let totalLps = 0
  DENOMINACIONES.forEach(d => totalLps += (cambioUsdConteo[d] || 0) * d)
  if (totalLps <= 0) { showError(err, 'Contá los billetes del cambio'); return }

  const tc = totalLps / montoUsd
  const dirLabel = dir === 'usd_entra' ? 'Entran USD / Salen LPS' : 'Salen USD / Entran LPS'

  if (!confirm(`¿Confirmar cambio?\n\n${dirLabel}\n$ ${montoUsd.toFixed(2)} USD ↔ L. ${totalLps.toLocaleString('es-HN',{minimumFractionDigits:2})}\nTC resultante: ${tc.toFixed(4)}`)) return

  // Determinar tipos para USD y billetes
  const tipoUsd = dir === 'usd_entra' ? 'ingreso' : 'egreso'
  const tipoBilletes = dir === 'usd_entra' ? 'egreso' : 'ingreso'  // opuesto: si entran USD, salen LPS

  // 1. Registrar movimiento USD
  await sb.from('caja_usd').insert({
    tipo: tipoUsd,
    monto_usd: montoUsd,
    tipo_cambio: Math.round(tc * 10000) / 10000,
    monto_lps: totalLps,
    descripcion: desc || `Cambio $ ${montoUsd.toFixed(2)}`,
    registrado_por: currentProfile.id
  })

  // 2. Registrar movimiento de billetes
  await sb.from('conteo_billetes').insert({
    partida_id: null,
    tipo: tipoBilletes,
    den_500: cambioUsdConteo[500] || 0, den_200: cambioUsdConteo[200] || 0, den_100: cambioUsdConteo[100] || 0,
    den_50: cambioUsdConteo[50] || 0, den_20: cambioUsdConteo[20] || 0, den_10: cambioUsdConteo[10] || 0,
    den_5: cambioUsdConteo[5] || 0, den_2: cambioUsdConteo[2] || 0, den_1: cambioUsdConteo[1] || 0,
    den_cheques: 0,
    total_billetes: DENOMINACIONES.reduce((s, d) => s + (cambioUsdConteo[d] || 0), 0),
    total_monto: totalLps,
    registrado_por: currentProfile.id
  })

  // 3. Actualizar TC promedio ponderado
  let newSaldoUsd, newSaldoLps, newTc
  if (dir === 'usd_entra') {
    // Entran USD: sumar y recalcular promedio
    newSaldoUsd = (tcPromedio.saldo_usd || 0) + montoUsd
    newSaldoLps = (tcPromedio.saldo_lps || 0) + totalLps
    newTc = newSaldoUsd > 0 ? Math.round((newSaldoLps / newSaldoUsd) * 10000) / 10000 : tc
  } else {
    // Salen USD: restar al TC promedio actual
    const tcActual = tcPromedio.tc_promedio || 25
    const lpsQueRebaja = montoUsd * tcActual
    newSaldoUsd = (tcPromedio.saldo_usd || 0) - montoUsd
    newSaldoLps = (tcPromedio.saldo_lps || 0) - lpsQueRebaja
    if (newSaldoUsd < 0.01) { newSaldoUsd = 0; newSaldoLps = 0 }
    newTc = newSaldoUsd > 0.01 ? Math.round((newSaldoLps / newSaldoUsd) * 10000) / 10000 : tcActual
  }

  await sb.from('caja_tc_promedio').update({
    saldo_usd: Math.round(newSaldoUsd * 100) / 100,
    saldo_lps: Math.round(newSaldoLps * 100) / 100,
    tc_promedio: newTc,
    updated_at: new Date().toISOString()
  }).eq('id', tcPromedio.id)

  closeModal('modal-cambio-usd')
  toast(`Cambio: $ ${montoUsd.toFixed(2)} ↔ L. ${totalLps.toLocaleString('es-HN',{minimumFractionDigits:2})} · TC: ${tc.toFixed(4)}`, 'success')
  loadCajaExtras()
  loadCaja()
}

// ── CHEQUES: Saldo desde partidas contables ──
// Los cheques se manejan por partidas contra cuentas de chequeras (110103)
// El saldo se calcula automáticamente en loadCajaExtras

// ── CAMBIO DE DENOMINACIONES LPS ──

let cambioDenomIn = {}
let cambioDenomOut = {}
let cambioDenomCuenta = '110102-001'   // caja a la que pertenece el cambio (general por defecto)

window.openModalCambioDenoms = (cajaCodigo = '110102-001') => {
  cambioDenomCuenta = cajaCodigo || '110102-001'
  cambioDenomIn = {}
  cambioDenomOut = {}
  DENOMINACIONES.forEach(d => { cambioDenomIn[d] = 0; cambioDenomOut[d] = 0 })
  document.getElementById('modal-cxd-error').classList.add('hidden')
  renderCambioDenoms()
  document.getElementById('modal-cambio-denoms').classList.add('open')
}

function renderCambioDenoms() {
  const tbody = document.getElementById('tbody-cambio-denoms')
  tbody.innerHTML = DENOMINACIONES.slice().map(d => {
    const inQty = cambioDenomIn[d] || 0
    const outQty = cambioDenomOut[d] || 0
    const neto = (inQty - outQty) * d
    return `<tr data-denom="${d}">
      <td style="padding:6px 10px;font-family:var(--mono);font-size:14px;font-weight:500">L. ${d.toLocaleString('es-HN')}</td>
      <td style="padding:6px 10px;text-align:center">
        <input type="text" inputmode="numeric" value="${inQty || ''}" placeholder="0"
          class="cxd-input" data-side="in" data-denom="${d}"
          oninput="updCambioDenom('in',${d},this.value)" onblur="window.resolveCambio('in',${d},this)" onfocus="this.select()" onkeydown="window.cambioDenomKey(event,this)"
          style="width:70px;text-align:center;background:rgba(16,185,129,0.05);border:0.5px solid var(--green);border-radius:6px;padding:6px;color:var(--green);font-family:var(--mono);font-size:14px;outline:none">
      </td>
      <td style="padding:6px 10px;text-align:center">
        <input type="text" inputmode="numeric" value="${outQty || ''}" placeholder="0"
          class="cxd-input" data-side="out" data-denom="${d}"
          oninput="updCambioDenom('out',${d},this.value)" onblur="window.resolveCambio('out',${d},this)" onfocus="this.select()" onkeydown="window.cambioDenomKey(event,this)"
          style="width:70px;text-align:center;background:rgba(239,68,68,0.05);border:0.5px solid var(--red);border-radius:6px;padding:6px;color:var(--red);font-family:var(--mono);font-size:14px;outline:none">
      </td>
      <td class="neto-cell" style="padding:6px 10px;text-align:right;font-family:var(--mono);font-size:13px;color:${neto > 0 ? 'var(--green)' : neto < 0 ? 'var(--red)' : 'var(--text3)'}">
        ${neto !== 0 ? (neto > 0 ? '+' : '') + 'L. ' + neto.toLocaleString('es-HN',{minimumFractionDigits:2}) : '—'}
      </td>
    </tr>`
  }).join('')
  calcCambioDenomTotals()
}

// Navegación con teclado en el modal de Cambio de denominaciones (2 columnas: ENTRADA/SALIDA)
window.cambioDenomKey = (e, el) => {
  const order = DENOMINACIONES.slice()       // ascendente 1→500 (mismo orden que la tabla)
  const side = el.dataset.side
  const i = order.indexOf(parseInt(el.dataset.denom))
  const atStart = el.selectionStart === 0 && el.selectionEnd === 0
  const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length
  let tSide = side, tDenom = null
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    if (i + 1 < order.length) tDenom = order[i + 1]                       // baja en la misma columna
    else if (side === 'in') { tSide = 'out'; tDenom = order[0] }          // fin de ENTRADA → inicio de SALIDA
  } else if (e.key === 'ArrowUp') {
    if (i - 1 >= 0) tDenom = order[i - 1]                                 // sube en la misma columna
    else if (side === 'out') { tSide = 'in'; tDenom = order[order.length - 1] }
  } else if (e.key === 'ArrowRight' && side === 'in' && atEnd) {
    tSide = 'out'; tDenom = order[i]                                      // pasa a SALIDA (misma fila)
  } else if (e.key === 'ArrowLeft' && side === 'out' && atStart) {
    tSide = 'in'; tDenom = order[i]                                       // vuelve a ENTRADA (misma fila)
  } else return
  e.preventDefault()
  if (tDenom == null) return
  const next = document.querySelector(`#tbody-cambio-denoms input[data-side="${tSide}"][data-denom="${tDenom}"]`)
  if (next) { next.focus(); next.select() }
}

// Resuelve la celda de cambio al salir (muestra el resultado ya calculado, como Excel)
window.resolveCambio = (side, denom, el) => {
  const v = side === 'in' ? cambioDenomIn[denom] : cambioDenomOut[denom]
  el.value = v ? v : ''
}

window.updCambioDenom = (side, denom, val) => {
  const n = evalExprSeguro(val)
  if (!isNaN(n) && n >= 0) {
    if (side === 'in') cambioDenomIn[denom] = Math.round(n)
    else cambioDenomOut[denom] = Math.round(n)
  }
  // Only update the neto cell for this row, NOT re-render the whole table
  const row = document.querySelector(`#tbody-cambio-denoms tr[data-denom="${denom}"]`)
  if (row) {
    const neto = ((cambioDenomIn[denom] || 0) - (cambioDenomOut[denom] || 0)) * denom
    const netoCell = row.querySelector('.neto-cell')
    if (netoCell) {
      netoCell.style.color = neto > 0 ? 'var(--green)' : neto < 0 ? 'var(--red)' : 'var(--text3)'
      netoCell.textContent = neto !== 0 ? (neto > 0 ? '+' : '') + 'L. ' + neto.toLocaleString('es-HN',{minimumFractionDigits:2}) : '—'
    }
  }
  calcCambioDenomTotals()
}

function calcCambioDenomTotals() {
  let totIn = 0, totOut = 0
  DENOMINACIONES.forEach(d => {
    totIn += (cambioDenomIn[d] || 0) * d
    totOut += (cambioDenomOut[d] || 0) * d
  })
  const diff = totIn - totOut
  document.getElementById('cxd-tot-in').textContent = 'L. ' + totIn.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  document.getElementById('cxd-tot-out').textContent = 'L. ' + totOut.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const diffEl = document.getElementById('cxd-diff')
  if (Math.abs(diff) < 0.01) {
    diffEl.textContent = 'Cuadrado ✓'
    diffEl.style.color = 'var(--green)'
  } else {
    diffEl.textContent = `Diferencia: L. ${diff.toLocaleString('es-HN', { minimumFractionDigits: 2 })}`
    diffEl.style.color = 'var(--red)'
  }
}

window.ejecutarCambioDenoms = async () => {
  const err = document.getElementById('modal-cxd-error')
  let totIn = 0, totOut = 0
  DENOMINACIONES.forEach(d => {
    totIn += (cambioDenomIn[d] || 0) * d
    totOut += (cambioDenomOut[d] || 0) * d
  })

  if (totIn <= 0 && totOut <= 0) { showError(err, 'Ingresa cantidades de entrada y salida'); return }
  if (Math.abs(totIn - totOut) > 0.01) { showError(err, `Entrada (L. ${totIn.toFixed(2)}) y salida (L. ${totOut.toFixed(2)}) deben ser iguales`); return }

  // Registrar ingreso de denominaciones
  const hasIn = DENOMINACIONES.some(d => cambioDenomIn[d] > 0)
  const hasOut = DENOMINACIONES.some(d => cambioDenomOut[d] > 0)
  let errIns = null

  if (hasIn) {
    const { error: e } = await sb.from('conteo_billetes').insert({
      partida_id: null,
      cuenta_codigo: cambioDenomCuenta,
      tipo: 'ingreso',
      den_500: cambioDenomIn[500] || 0, den_200: cambioDenomIn[200] || 0, den_100: cambioDenomIn[100] || 0,
      den_50: cambioDenomIn[50] || 0, den_20: cambioDenomIn[20] || 0, den_10: cambioDenomIn[10] || 0,
      den_5: cambioDenomIn[5] || 0, den_2: cambioDenomIn[2] || 0, den_1: cambioDenomIn[1] || 0,
      den_cheques: 0,
      total_billetes: DENOMINACIONES.reduce((s, d) => s + (cambioDenomIn[d] || 0), 0),
      total_monto: totIn,
      registrado_por: currentProfile.id
    })
    if (e) errIns = e
  }

  if (!errIns && hasOut) {
    const { error: e } = await sb.from('conteo_billetes').insert({
      partida_id: null,
      cuenta_codigo: cambioDenomCuenta,
      tipo: 'egreso',
      den_500: cambioDenomOut[500] || 0, den_200: cambioDenomOut[200] || 0, den_100: cambioDenomOut[100] || 0,
      den_50: cambioDenomOut[50] || 0, den_20: cambioDenomOut[20] || 0, den_10: cambioDenomOut[10] || 0,
      den_5: cambioDenomOut[5] || 0, den_2: cambioDenomOut[2] || 0, den_1: cambioDenomOut[1] || 0,
      den_cheques: 0,
      total_billetes: DENOMINACIONES.reduce((s, d) => s + (cambioDenomOut[d] || 0), 0),
      total_monto: totOut,
      registrado_por: currentProfile.id
    })
    if (e) errIns = e
  }

  if (errIns) { showError(err, 'No se pudo registrar el cambio: ' + errIns.message); return }

  closeModal('modal-cambio-denoms')
  toast(`Cambio de denominaciones aplicado · L. ${totIn.toLocaleString('es-HN',{minimumFractionDigits:2})} ✓`, 'success')
  loadCaja()
}

// ── CHEQUES: Saldo desde partidas contables ──
// Los cheques se manejan por partidas contra cuentas de chequeras (110103)
// El saldo se calcula automáticamente en loadCajaExtras

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
    const numPartidaImp = await window.siguienteNumeroPartida()
    const { data: partida, error: errP } = await sb.from('partidas_contables').insert({
      centro_costo_id: centroCostoId,
      generada_por: currentProfile.id,
      tipo_origen: 'compra',
      descripcion: descripcion,
      fecha_partida: fechaISO,
      numero_partida: numPartidaImp,
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
  logActividad('import_ventas_alpha', 'importaciones', `${creadas} partidas crédito + ${contCreadas} contado`, null)
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
  document.getElementById('icu-fecha').value = localDateStr(ayer)

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

  // Calcular rango del mes como [inicio, inicioMesSiguiente) — robusto para meses de 28/30/31 días
  const [anio, mes] = fecha.split('-')
  const mesInicio = `${anio}-${mes}-01`
  const yNum = parseInt(anio, 10), mNum = parseInt(mes, 10)
  const mesSiguiente = mNum === 12 ? `${yNum + 1}-01-01` : `${yNum}-${String(mNum + 1).padStart(2, '0')}-01`

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

    // Buscar partida existente del mes (activa, no anulada). Toma la más reciente si hubiera varias.
    const searchPattern = `Costo de venta · ${grupo.label} %[IMP-COSTO]`
    const { data: existentes, error: errBusca } = await sb.from('partidas_contables')
      .select('id')
      .like('descripcion', searchPattern)
      .gte('fecha_partida', mesInicio)
      .lt('fecha_partida', mesSiguiente)
      .neq('estado', 'anulada')
      .order('fecha_partida', { ascending: false })
      .order('numero_partida', { ascending: false })
      .limit(1)
    if (errBusca) {
      errores++
      log.push(`<span style="color:var(--red)">✕</span> ${grupo.label}: no se pudo verificar si ya existe partida (${errBusca.message}). Omitido para no duplicar.`)
      continue
    }

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
      const numPartidaImp = await window.siguienteNumeroPartida()
      const { data: partida, error: errP } = await sb.from('partidas_contables').insert({
        centro_costo_id: centroCostoId, generada_por: currentProfile.id,
        tipo_origen: 'compra', descripcion, fecha_partida: fecha,
        numero_partida: numPartidaImp,
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

// ══════════════════════════════════════════════
// ── IMPORTAR ENTREGAS TAXIS
// ══════════════════════════════════════════════

let itxEntregasFile = null
let itxKmFile = null
let itxData = null // { entregas: [], km: [] }

// Tokeniza UN registro CSV respetando comillas y "" como comilla escapada.
function _csvTokenize(str) {
  const out = []; let cur = ''; let inQ = false
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (inQ) {
      if (c === '"') { if (str[i + 1] === '"') { cur += '"'; i++ } else inQ = false }
      else cur += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}

// Separa el texto en registros respetando saltos de línea dentro de comillas.
function _splitRecords(text) {
  const recs = []; let cur = ''; let inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cur += '""'; i++; continue }
      inQ = !inQ; cur += c
    } else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && text[i + 1] === '\n') i++
      if (cur.length) recs.push(cur); cur = ''
    } else cur += c
  }
  if (cur.length) recs.push(cur)
  return recs
}

// Devuelve array de objetos { 'Header': valor, ... }.
// Maneja el doble-encoding de Timar: si una fila colapsa a 1 campo que a su vez
// es un CSV completo (caso de las filas con Desglose JSON), lo vuelve a parsear.
function parseTaxiCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1) // quitar BOM
  const recs = _splitRecords(text)
  if (!recs.length) return []
  const header = _csvTokenize(recs[0]).map(h => h.trim())
  const ncol = header.length
  const rows = []
  for (let i = 1; i < recs.length; i++) {
    let fields = _csvTokenize(recs[i])
    if (fields.length < ncol && fields[0] && fields[0].indexOf(',') > -1) {
      const reparsed = _csvTokenize(fields[0])
      if (reparsed.length >= ncol - 1) fields = reparsed
    }
    if (fields.length === 1 && !fields[0].trim()) continue // línea vacía
    const obj = {}
    header.forEach((h, idx) => { obj[h] = (fields[idx] !== undefined ? fields[idx] : '').trim() })
    rows.push(obj)
  }
  return rows
}

function parseCSVorXLSX(arrayBuffer, fileName) {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'csv') {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer))
    return parseTaxiCSV(text)
  } else {
    const wb = XLSX.read(arrayBuffer, { type: 'array', raw: true, cellDates: false })
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: '' })
  }
}

function parseMontoTaxi(val) {
  if (val == null || val === '') return 0
  if (typeof val === 'number') return val
  let s = String(val).trim().replace(/\s/g, '')
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.')
  }
  return parseFloat(s) || 0
}

function parseFechaTaxi(val) {
  if (!val) return null
  const s = String(val).trim()
  // If it's already yyyy-mm-dd, return directly
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10)
  // DD/MM/YYYY or D/M/YYYY format
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, '0')
    const mm = dmyMatch[2].padStart(2, '0')
    const yyyy = dmyMatch[3]
    return `${yyyy}-${mm}-${dd}`
  }
  // If it's a number (Excel serial date)
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(parseFloat(s))
    if (serial > 40000 && serial < 60000) {
      const base = new Date(1899, 11, 30)
      base.setDate(base.getDate() + serial)
      const yyyy = base.getFullYear()
      const mm = String(base.getMonth() + 1).padStart(2, '0')
      const dd = String(base.getDate()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}`
    }
  }
  return s.substring(0, 10) || null
}

function extractDesglose(json) {
  if (!json) return {}
  try {
    const d = typeof json === 'string' ? JSON.parse(json) : json
    return {
      tarifa_dia: d.tarifaDia || 0,
      saldo_deudor: d.saldoDeudor || 0,
    }
  } catch { return {} }
}

window.onTaxiFile = (input, tipo) => {
  const file = input.files?.[0]
  if (tipo === 'entregas') {
    itxEntregasFile = file
    document.getElementById('itx-entregas-info').innerHTML = file
      ? `<div class="imp-file-item"><span class="imp-file-icon">🚕</span><span class="imp-file-name">${file.name}</span><span style="font-size:11px;color:var(--text3)">${(file.size/1024).toFixed(0)} KB</span></div>` : ''
  } else {
    itxKmFile = file
    document.getElementById('itx-km-info').innerHTML = file
      ? `<div class="imp-file-item"><span class="imp-file-icon">📏</span><span class="imp-file-name">${file.name}</span><span style="font-size:11px;color:var(--text3)">${(file.size/1024).toFixed(0)} KB</span></div>` : ''
  }
  document.getElementById('btn-procesar-taxis').disabled = !(itxEntregasFile || itxKmFile)
}

window.resetImportTaxis = () => {
  itxEntregasFile = null
  itxKmFile = null
  itxData = null
  ;['itx-entregas','itx-km'].forEach(id => { const el = document.getElementById(id); if(el) el.value = '' })
  ;['itx-entregas-info','itx-km-info'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = '' })
  const btn = document.getElementById('btn-procesar-taxis')
  if (btn) btn.disabled = true
  ;['itx-step1','itx-step2','itx-step3'].forEach(id => document.getElementById(id)?.classList.add('hidden'))
  document.getElementById('itx-step1')?.classList.remove('hidden')
}

window.procesarImportTaxis = async () => {
  if (!itxEntregasFile && !itxKmFile) { toast('Seleccioná al menos un archivo (entregas o km)', 'error'); return }
  const btn = document.getElementById('btn-procesar-taxis')
  btn.disabled = true; btn.textContent = 'Procesando...'

  try {
    // Parse entregas (solo si se subió el archivo; puede importarse solo km)
    let entregas = []
    if (itxEntregasFile) {
    const entregasAB = await itxEntregasFile.arrayBuffer()
    const entregasRaw = parseCSVorXLSX(entregasAB, itxEntregasFile.name)

    entregas = entregasRaw.map(r => {
      const desg = extractDesglose(r['Desglose'] || r['desglose'])
      return {
        id: String(r['ID'] || '').trim().replace(/^"+|"+$/g, ''),
        unidad: String(r['Unidad'] || '').trim(),
        nombre_conductor: String(r['Nombre'] || '').trim(),
        identidad: String(r['Identidad'] || '').trim(),
        telefono: String(r['Telefono'] || r['Teléfono'] || '').trim(),
        monto: parseMontoTaxi(r['Monto']),
        banco: String(r['Banco'] || '').trim(),
        fecha_deposito: parseFechaTaxi(r['Fecha Depósito'] || r['Fecha Deposito']),
        fecha_envio: parseFechaTaxi(r['Fecha Envío'] || r['Fecha Envio']),
        hora_envio: String(r['Hora Envío'] || r['Hora Envio'] || '').trim(),
        estado: String(r['Estado'] || 'Programado').trim(),
        imagen_url: String(r['Imagen'] || '').trim() || null,
        tarifa_dia: desg.tarifa_dia || parseMontoTaxi(r['Tarifa']),
        monto_esperado: parseMontoTaxi(r['Monto Esperado']),
        saldo_deudor: desg.saldo_deudor || 0,
        motivo: String(r['Motivo'] || '').trim() || null,
        programado_por: String(r['Programado Por'] || '').trim() || null,
        adelanto: parseMontoTaxi(r['ADELANTO'] || r['Adelanto']),
        desglose: (() => {
          let d = r['Desglose'] || r['desglose'] || null
          if (d && typeof d === 'string') d = d.replace(/§/g, ',').replace(/""/g, '"')
          return d
        })(),
      }
    }).filter(e => e.id && e.unidad)

    // ── Guard de fecha: descartar filas sin fecha de depósito válida ──
    // (filas dañadas en la hoja origen: comilla suelta, fecha mal escrita, etc.)
    {
      const _fechaOK = e => /^\d{4}-\d{2}-\d{2}$/.test(e.fecha_deposito || '')
      const _omitidas = entregas.filter(e => !_fechaOK(e))
      if (_omitidas.length) {
        console.warn('[IMPORT TAXIS] Omitidas por fecha de depósito inválida:',
          _omitidas.map(e => ({ id: e.id, unidad: e.unidad, fecha: e.fecha_deposito, motivo: e.motivo })))
        toast(`${_omitidas.length} fila(s) omitida(s) por fecha de depósito inválida — revisa la hoja origen`, 'error')
      }
      const _validas = entregas.filter(_fechaOK)
      entregas.length = 0
      entregas.push(..._validas)
    }
    }  // fin del bloque "if (itxEntregasFile)"

    // Parse km if provided
    let km = []
    if (itxKmFile) {
      const kmAB = await itxKmFile.arrayBuffer()
      const kmRaw = parseCSVorXLSX(kmAB, itxKmFile.name)
      km = kmRaw.map(r => ({
        fecha: parseFechaTaxi(r['Fecha_procesado'] || r['Fecha'] || r['fecha']),
        unidad: String(r['Vehiculo'] || r['Unidad'] || r['unidad'] || '').trim(),
        km_recorridos: parseFloat(r['kilometraje'] || r['KmRecorridos'] || r['Km'] || 0) || 0,
      })).filter(k => k.fecha && k.unidad)
    }

    // Check for existing IDs in batches
    const ids = entregas.map(e => e.id).filter(Boolean)
    const existSet = new Set()
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500)
      const { data: existentes } = await sb.from('entregas_taxis')
        .select('id')
        .in('id', batch)
      ;(existentes || []).forEach(e => existSet.add(e.id))
    }
    const nuevas = entregas.filter(e => !existSet.has(e.id))
    const duplicadas = entregas.filter(e => existSet.has(e.id))

    itxData = { entregas, km, nuevas, duplicadas }
    renderImportTaxisResults()
  } catch (err) {
    toast('Error: ' + err.message, 'error')
    console.error(err)
  }
  btn.disabled = false; btn.textContent = 'Procesar →'
}

function renderImportTaxisResults() {
  if (!itxData) return
  const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })
  const d = itxData

  // Resumen por banco (todas las entregas)
  const porBanco = {}
  d.entregas.forEach(e => {
    if (!porBanco[e.banco]) porBanco[e.banco] = { count: 0, total: 0 }
    porBanco[e.banco].count++
    porBanco[e.banco].total += e.monto
  })

  const totalMonto = d.entregas.reduce((s, e) => s + e.monto, 0)
  const unidades = new Set(d.entregas.map(e => e.unidad))

  document.getElementById('itx-resumen').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      <div class="stat-card"><div class="stat-num">${d.entregas.length}</div><div class="stat-label"><span class="stat-dot" style="background:var(--blue)"></span>Total entregas</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green)">${d.nuevas.length}</div><div class="stat-label"><span class="stat-dot" style="background:var(--green)"></span>Nuevas</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--amber)">${d.duplicadas.length}</div><div class="stat-label"><span class="stat-dot" style="background:var(--amber)"></span>A actualizar</div></div>
      <div class="stat-card"><div class="stat-num">L. ${fmt(totalMonto)}</div><div class="stat-label"><span class="stat-dot" style="background:var(--gold)"></span>Total</div></div>
    </div>
    ${d.km.length ? `<div style="padding:10px 14px;border-radius:var(--radius);margin-bottom:16px;background:rgba(59,130,246,0.08);border-left:3px solid var(--blue);font-size:13px;color:var(--blue)">📏 ${d.km.length} registros de Km diarios a importar</div>` : ''}
    <div class="table-wrap" style="max-height:300px;overflow-y:auto">
      <table>
        <thead><tr><th>Banco</th><th style="text-align:center">Entregas</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${Object.entries(porBanco).sort((a,b) => b[1].total - a[1].total).map(([banco, v]) => `
          <tr>
            <td>${banco}</td>
            <td style="text-align:center;font-family:var(--mono)">${v.count}</td>
            <td style="text-align:right;font-family:var(--mono);font-weight:500">L. ${fmt(v.total)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:var(--bg3)">
          <td style="text-align:right;font-weight:500;color:var(--text3)">TOTAL</td>
          <td style="text-align:center;font-family:var(--mono);font-weight:500">${d.entregas.length}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:500;color:var(--gold)">L. ${fmt(totalMonto)}</td>
        </tr></tfoot>
      </table>
    </div>`

  document.getElementById('itx-step1').classList.add('hidden')
  document.getElementById('itx-step2').classList.remove('hidden')
}

window.guardarImportTaxis = async () => {
  if (!itxData?.entregas?.length && !itxData?.km?.length) { toast('No hay datos', 'error'); return }
  const btn = document.getElementById('btn-guardar-taxis')
  btn.disabled = true; btn.textContent = 'Verificando...'

  let entregasOk = 0, entregasErr = 0, kmOk = 0, kmErr = 0
  const log = []

  // ── 1. Detectar fechas únicas del CSV ──
  const fechasEntregas = new Set()
  itxData.entregas.forEach(e => {
    if (e.fecha_deposito) fechasEntregas.add(e.fecha_deposito)
  })
  const fechasArr = [...fechasEntregas].sort()

  // ── 2. Verificar si hay partidas generadas para esas fechas ──
  let partidasAfectadas = []
  if (fechasArr.length) {
    const { data: partidas } = await sb.from('partidas_contables')
      .select('id, fecha_partida, descripcion, estado')
      .like('descripcion', '%[IMP-TAXI]%')
      .in('fecha_partida', fechasArr)
    partidasAfectadas = partidas || []
  }

  // ── 3. Si hay partidas, advertir al usuario ──
  if (partidasAfectadas.length > 0) {
    const fechasConPartida = [...new Set(partidasAfectadas.map(p => p.fecha_partida))].sort()
    const detallePartidas = partidasAfectadas.map(p => `  #${p.id} · ${p.fecha_partida} · ${p.estado}`).join('\n')
    const confirmar = confirm(
      `⚠️ Se encontraron ${partidasAfectadas.length} partida(s) de taxis ya generadas para las fechas que estás cargando:\n\n${detallePartidas}\n\n` +
      `Al continuar:\n` +
      `• Se borrarán las entregas de estas fechas y se recargarán del CSV\n` +
      `• Las partidas afectadas pasarán a "borrador" para revisión\n\n` +
      `¿Continuar?`
    )
    if (!confirmar) {
      btn.disabled = false; btn.textContent = 'Guardar entregas →'
      return
    }
  }

  btn.textContent = 'Procesando entregas...'

  // ── 4. Borrar entregas existentes de las fechas del CSV ──
  if (fechasArr.length) {
    for (const fecha of fechasArr) {
      const { error: delErr } = await sb.from('entregas_taxis')
        .delete()
        .eq('fecha_deposito', fecha)
      if (delErr) {
        log.push(`<span style="color:var(--red)">✕</span> Error borrando entregas de ${fecha}: ${delErr.message}`)
      } else {
        log.push(`<span style="color:var(--blue)">↻</span> ${fecha}: entregas anteriores eliminadas`)
      }
    }
  }

  // ── 5. Insertar todas las entregas del CSV (insert, ya no upsert) ──
  // DEDUPE por id, quedándonos con la ÚLTIMA aparición: la hoja de Timar a veces
  // exporta la misma entrega dos veces (p. ej. cambió de estado y quedó la fila
  // vieja). Dos filas con el mismo id en un mismo upsert hacen fallar TODO el
  // lote en Postgres: "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const _conteoIds = {}
  itxData.entregas.forEach(e => { _conteoIds[e.id] = (_conteoIds[e.id] || 0) + 1 })
  const _porId = new Map()
  itxData.entregas.forEach(e => _porId.set(e.id, e))  // la última pisa a la anterior
  const todas = [..._porId.values()]
  const _idsDup = Object.keys(_conteoIds).filter(k => _conteoIds[k] > 1)
  if (_idsDup.length > 0) {
    log.push(`<span style="color:var(--amber)">⚠</span> ${_idsDup.length} entrega(s) venían repetidas en el CSV (se usó la última versión): ${_idsDup.join(', ')}`)
  }
  for (let i = 0; i < todas.length; i += 50) {
    const batch = todas.slice(i, i + 50).map(e => ({
      id: e.id,
      unidad: e.unidad,
      nombre_conductor: e.nombre_conductor,
      identidad: e.identidad,
      telefono: e.telefono,
      monto: e.monto,
      banco: e.banco,
      fecha_deposito: e.fecha_deposito || null,
      fecha_envio: e.fecha_envio || null,
      hora_envio: e.hora_envio,
      estado: e.estado,
      imagen_url: e.imagen_url,
      tarifa_dia: e.tarifa_dia,
      monto_esperado: e.monto_esperado,
      saldo_deudor: e.saldo_deudor,
      motivo: e.motivo,
      programado_por: e.programado_por,
      adelanto: e.adelanto || null,
      desglose: e.desglose ? (typeof e.desglose === 'string' ? e.desglose : JSON.stringify(e.desglose)) : null,
    }))

    const { error } = await sb.from('entregas_taxis').upsert(batch, { onConflict: 'id' })
    if (error) {
      entregasErr += batch.length
      log.push(`<span style="color:var(--red)">✕</span> Lote ${Math.floor(i/50)+1}: ${error.message}`)
    } else {
      entregasOk += batch.length
    }
  }

  // ── 6. Marcar partidas afectadas como borrador para revisión ──
  if (partidasAfectadas.length > 0) {
    for (const p of partidasAfectadas) {
      const { error: updErr } = await sb.from('partidas_contables').update({
        estado: 'borrador',
        modificada_por: currentProfile.id,
        modificada_at: new Date().toISOString(),
        motivo_modificacion: 'Entregas recargadas desde CSV — revisar y regenerar partida',
      }).eq('id', p.id)
      if (updErr) {
        log.push(`<span style="color:var(--red)">✕</span> Error actualizando partida #${p.id}: ${updErr.message}`)
      } else {
        log.push(`<span style="color:var(--amber)">⚠</span> Partida #${p.id} (${p.fecha_partida}) → borrador (requiere revisión)`)
      }
    }
  }

  // ── 7. Km diarios: borrar por fechas del CSV y recargar ──
  if (itxData.km.length) {
    const fechasKm = new Set(itxData.km.map(k => k.fecha).filter(Boolean))
    for (const fecha of fechasKm) {
      await sb.from('km_diarios_taxis').delete().eq('fecha', fecha)
    }

    // DEDUPE por fecha+unidad (última aparición gana) — mismo motivo que las
    // entregas: claves repetidas en un mismo upsert tumban el lote completo.
    const _porClaveKm = new Map()
    itxData.km.forEach(k => _porClaveKm.set(`${k.fecha}|${k.unidad}`, k))
    const kmUnicos = [..._porClaveKm.values()]
    if (kmUnicos.length < itxData.km.length) {
      log.push(`<span style="color:var(--amber)">⚠</span> ${itxData.km.length - kmUnicos.length} registro(s) de km repetidos en el CSV (se usó la última versión)`)
    }

    for (let i = 0; i < kmUnicos.length; i += 100) {
      const batch = kmUnicos.slice(i, i + 100).map(k => ({
        fecha: k.fecha,
        unidad: k.unidad,
        km_recorridos: k.km_recorridos,
      }))

      const { error } = await sb.from('km_diarios_taxis').upsert(batch, { onConflict: 'fecha,unidad' })
      if (error) {
        kmErr += batch.length
        log.push(`<span style="color:var(--red)">✕</span> Km lote ${Math.floor(i/100)+1}: ${error.message}`)
      } else {
        kmOk += batch.length
      }
    }
  }

  // ── 8. Recalcular nuevas vs actualizadas para el resumen ──
  const nuevasCount = itxData.nuevas.length
  const actualizadasCount = itxData.duplicadas.length
  const borradasExtra = itxData.duplicadas.length > 0 ? ' (entregas anteriores reemplazadas)' : ''

  // Show results
  document.getElementById('itx-step2').classList.add('hidden')
  document.getElementById('itx-step3').classList.remove('hidden')

  document.getElementById('itx-log').innerHTML = `
    <div style="margin-bottom:16px;padding:14px;border-radius:var(--radius);background:var(--bg3)">
      <div style="font-size:16px;font-weight:500;margin-bottom:8px">${entregasOk} entregas cargadas${borradasExtra}</div>
      <div style="font-size:13px;color:var(--text3)">Fechas procesadas: ${fechasArr.join(', ')}</div>
      ${entregasErr ? `<div style="color:var(--red)">${entregasErr} errores en entregas</div>` : ''}
      ${kmOk ? `<div style="color:var(--blue);margin-top:4px">${kmOk} registros de Km importados</div>` : ''}
      ${kmErr ? `<div style="color:var(--red)">${kmErr} errores en Km</div>` : ''}
      ${partidasAfectadas.length ? `<div style="color:var(--amber);margin-top:4px">⚠ ${partidasAfectadas.length} partida(s) enviadas a revisión</div>` : ''}
    </div>
    ${log.length ? `<div style="font-size:12px;line-height:2;font-family:var(--mono);max-height:300px;overflow-y:auto">${log.join('<br>')}</div>` : ''}`

  btn.disabled = false; btn.textContent = 'Guardar entregas →'
  toast(`${entregasOk} entregas + ${kmOk} km importados`, 'ok')
}

// ══════════════════════════════════════════════
// ── PARTIDAS DE TAXIS (desde entregas importadas)
// ══════════════════════════════════════════════

const TAXI_CUENTAS = {
  bac:       { codigo: '110104-021', nombre: 'BAC ADONY AHORRO 758812601' },
  bac2:      { codigo: '110104-007', nombre: 'BAC ADONY AHORRO 72XXXXX' },
  ficohsa:   { codigo: '110104-013', nombre: 'FICOHSA ADONY AHORRO' },
  caja:      { codigo: '110102-001', nombre: 'CAJA GENERAL MN' },
  ingreso:   { codigo: '410101-003', nombre: 'Ingresos por renta Taxis' },
}

function bancoToCuenta(banco) {
  const b = (banco || '').toLowerCase().trim()
  if (b === 'bac') return TAXI_CUENTAS.bac
  if (b === 'bac 2' || b === 'bac2') return TAXI_CUENTAS.bac2
  if (b.includes('ficohsa')) return TAXI_CUENTAS.ficohsa
  // Caja Tecnimax, Caja Yonker, Caja Taxis → todas a Caja General
  if (b.includes('caja')) return TAXI_CUENTAS.caja
  return TAXI_CUENTAS.caja // default
}

let ptxData = null

function initPartidasTaxis() {
  const now = new Date()
  const primerDia = new Date(now.getFullYear(), now.getMonth(), 1)
  document.getElementById('ptx-desde').value = localDateStr(primerDia)
  document.getElementById('ptx-hasta').value = localDateStr(now)

  const sel = document.getElementById('ptx-centro')
  sel.innerHTML = '<option value="">— Seleccionar —</option>'
  empresas.forEach(e => {
    sel.innerHTML += `<option value="${e.id}">${e.nombre}</option>`
  })
  const taxis = empresas.find(e => e.nombre.toLowerCase().includes('taxi'))
  if (taxis) sel.value = taxis.id

  document.getElementById('ptx-resultado')?.classList.add('hidden')
  document.getElementById('ptx-log-card')?.classList.add('hidden')
}

window.consultarEntregasTaxis = async () => {
  const desde = document.getElementById('ptx-desde').value
  const hasta = document.getElementById('ptx-hasta').value
  if (!desde || !hasta) { toast('Selecciona el rango de fechas', 'error'); return }

  let data
  try {
    data = await _fetchAllPag(() => sb.from('entregas_taxis')
      .select('*')
      .gte('fecha_deposito', desde)
      .lte('fecha_deposito', hasta)
      .order('fecha_deposito')
      .order('id'))   // desempate único para paginar sin perder ni duplicar filas
  } catch (e) { toast('Error: ' + e.message, 'error'); return }
  if (!data?.length) { toast('No hay entregas en ese rango', 'info'); return }

  // Agrupar por fecha
  const porFecha = {}
  data.forEach(e => {
    const f = e.fecha_deposito
    if (!porFecha[f]) porFecha[f] = { fecha: f, entregas: [], porBanco: {} }
    porFecha[f].entregas.push(e)
    const banco = e.banco || 'Sin banco'
    if (!porFecha[f].porBanco[banco]) porFecha[f].porBanco[banco] = { count: 0, total: 0 }
    porFecha[f].porBanco[banco].count++
    porFecha[f].porBanco[banco].total += parseFloat(e.monto) || 0
  })

  // Verificar cuáles ya tienen partida (buscar por descripción)
  const fechas = Object.keys(porFecha)
  const { data: existentes } = await sb.from('partidas_contables')
    .select('fecha_partida, descripcion')
    .like('descripcion', '%[IMP-TAXI]%')
    .in('fecha_partida', fechas)

  const fechasConPartida = new Set((existentes || []).map(e => e.fecha_partida))
  Object.values(porFecha).forEach(d => {
    d.tienePartida = fechasConPartida.has(d.fecha)
  })

  ptxData = Object.values(porFecha).sort((a, b) => a.fecha.localeCompare(b.fecha))

  renderPartidasTaxis()
}

function renderPartidasTaxis() {
  if (!ptxData) return
  const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })

  const totalEntregas = ptxData.reduce((s, d) => s + d.entregas.length, 0)
  const totalMonto = ptxData.reduce((s, d) => s + d.entregas.reduce((ss, e) => ss + (parseFloat(e.monto) || 0), 0), 0)
  const diasNuevos = ptxData.filter(d => !d.tienePartida).length
  const diasExistentes = ptxData.filter(d => d.tienePartida).length

  document.getElementById('ptx-resumen').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
      <div class="stat-card"><div class="stat-num">${ptxData.length}</div><div class="stat-label"><span class="stat-dot" style="background:var(--blue)"></span>Días</div></div>
      <div class="stat-card"><div class="stat-num">${totalEntregas}</div><div class="stat-label"><span class="stat-dot" style="background:var(--green)"></span>Entregas</div></div>
      <div class="stat-card"><div class="stat-num">L. ${fmt(totalMonto)}</div><div class="stat-label"><span class="stat-dot" style="background:var(--gold)"></span>Total</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green)">${diasNuevos}</div><div class="stat-label"><span class="stat-dot" style="background:var(--green)"></span>Partidas nuevas</div></div>
    </div>`

  document.getElementById('ptx-detalle').innerHTML = `
    <div class="table-wrap" style="max-height:400px;overflow-y:auto">
      <table>
        <thead><tr>
          <th>Fecha</th><th style="text-align:center">Entregas</th>
          <th style="text-align:right">BAC</th><th style="text-align:right">Ficohsa</th>
          <th style="text-align:right">Cajas</th><th style="text-align:right">Total</th>
          <th>Estado</th>
        </tr></thead>
        <tbody>${ptxData.map(d => {
          const bac = (d.porBanco['BAC']?.total || 0) + (d.porBanco['BAC 2']?.total || 0)
          const ficohsa = d.porBanco['Ficohsa']?.total || 0
          const cajas = (d.porBanco['Caja Tecnimax']?.total || 0) + (d.porBanco['Caja Yonker']?.total || 0) + (d.porBanco['Caja Taxis']?.total || 0)
          const total = d.entregas.reduce((s, e) => s + (parseFloat(e.monto) || 0), 0)
          return `<tr style="${d.tienePartida ? 'opacity:0.5' : ''}">
            <td class="mono" style="font-size:12px">${d.fecha}</td>
            <td style="text-align:center;font-family:var(--mono)">${d.entregas.length}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(bac)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(ficohsa)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px">${fmt(cajas)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:500">${fmt(total)}</td>
            <td>${d.tienePartida ? '<span class="badge badge-green">✓ Creada</span>' : '<span class="badge badge-amber">Pendiente</span>'}</td>
          </tr>`
        }).join('')}
        </tbody>
      </table>
    </div>
    ${diasExistentes ? `<div style="margin-top:10px;font-size:12px;color:var(--text3)">Las fechas ya contabilizadas se omitirán.</div>` : ''}`

  document.getElementById('ptx-resultado').classList.remove('hidden')
  document.getElementById('ptx-log-card').classList.add('hidden')
}

window.generarPartidasTaxis = async () => {
  const centroCostoId = document.getElementById('ptx-centro').value
  if (!centroCostoId) { toast('Selecciona el centro de costo', 'error'); return }
  if (!ptxData) return

  const diasNuevos = ptxData.filter(d => !d.tienePartida)
  if (!diasNuevos.length) { toast('No hay días nuevos para contabilizar', 'info'); return }

  const btn = document.getElementById('btn-generar-ptx')
  btn.disabled = true; btn.textContent = 'Generando...'

  if (!cuentasDetalle.length) {
    const { data } = await sb.from('catalogo_cuentas').select('id,codigo,nombre,tipo').eq('es_detalle', true).order('codigo')
    cuentasDetalle = data || []
  }
  const getCuenta = (codigo) => cuentasDetalle.find(c => c.codigo === codigo)

  let creadas = 0, errores = 0
  const log = []
  const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })

  for (const dia of diasNuevos) {
    const total = dia.entregas.reduce((s, e) => s + (parseFloat(e.monto) || 0), 0)
    if (total <= 0) continue

    // Agrupar por cuenta contable
    const porCuenta = {}
    dia.entregas.forEach(e => {
      const cuenta = bancoToCuenta(e.banco)
      const key = cuenta.codigo
      if (!porCuenta[key]) porCuenta[key] = { cuenta, total: 0, count: 0 }
      porCuenta[key].total += parseFloat(e.monto) || 0
      porCuenta[key].count++
    })

    const descripcion = `Entregas taxis · ${dia.fecha} · ${dia.entregas.length} unidades · L. ${fmt(total)} [IMP-TAXI]`

    // Si alguna entrega va a caja, la partida queda pendiente_caja para conteo de billetes
    const tocaCajaGeneral = Object.keys(porCuenta).some(c => c.startsWith('1101') && !c.startsWith('11010'))
      || Object.keys(porCuenta).some(c => c === '110102-001')
    const estadoPartida = tocaCajaGeneral ? 'pendiente_caja' : 'aprobada'

    // Crear partida
    const numPartidaImp = await window.siguienteNumeroPartida()
    const { data: partida, error: errP } = await sb.from('partidas_contables').insert({
      centro_costo_id: centroCostoId,
      generada_por: currentProfile.id,
      tipo_origen: 'entrega_taxi',
      descripcion,
      fecha_partida: dia.fecha,
      numero_partida: numPartidaImp,
      numero_documento: null,
      estado: estadoPartida,
      total: Math.round(total * 100) / 100,
    }).select().single()

    if (errP) {
      errores++
      log.push(`<span style="color:var(--red)">✕</span> ${dia.fecha}: ${errP.message}`)
      continue
    }

    // Crear líneas de débito por cada banco/cuenta
    const lineas = []
    for (const [codigo, data] of Object.entries(porCuenta)) {
      const ctaDB = getCuenta(codigo)
      // Cuentas de caja y bancos (activos) no llevan centro de costo
      lineas.push({
        partida_id: partida.id,
        cuenta_id: ctaDB?.id || null,
        cuenta_codigo: codigo,
        cuenta_nombre: data.cuenta.nombre,
        tipo: 'debito',
        monto: Math.round(data.total * 100) / 100,
        centro_costo_id: null,
        descripcion: `${data.count} entregas`,
        numero_documento: null,
        aplica_fiscal: false,
      })
    }

    // Línea de crédito: Ingresos por renta (esta sí lleva centro de costo)
    const ctaIngreso = getCuenta(TAXI_CUENTAS.ingreso.codigo)
    lineas.push({
      partida_id: partida.id,
      cuenta_id: ctaIngreso?.id || null,
      cuenta_codigo: TAXI_CUENTAS.ingreso.codigo,
      cuenta_nombre: TAXI_CUENTAS.ingreso.nombre,
      tipo: 'credito',
      monto: Math.round(total * 100) / 100,
      centro_costo_id: centroCostoId,
      descripcion: `${dia.entregas.length} unidades`,
      numero_documento: null,
      aplica_fiscal: false,
    })

    const { error: errL } = await sb.from('lineas_partida').insert(lineas)
    if (errL) {
      errores++
      log.push(`<span style="color:var(--red)">✕</span> ${dia.fecha} líneas: ${errL.message}`)
      await sb.from('partidas_contables').delete().eq('id', partida.id)
      continue
    }

    creadas++
    const detalleBancos = Object.entries(porCuenta).map(([c, d]) => `${d.cuenta.nombre}: L.${fmt(d.total)}`).join(' · ')
    log.push(`<span style="color:var(--green)">✓</span> ${dia.fecha} · L. ${fmt(total)} · ${dia.entregas.length} entregas · ${detalleBancos}`)
  }

  document.getElementById('ptx-resultado').classList.add('hidden')
  document.getElementById('ptx-log-card').classList.remove('hidden')
  document.getElementById('ptx-log').innerHTML = `
    <div style="margin-bottom:16px;padding:14px;border-radius:var(--radius);background:var(--bg3)">
      <div style="font-size:16px;font-weight:500;margin-bottom:8px">${creadas} partida(s) creadas</div>
      ${errores ? `<div style="color:var(--red)">${errores} error(es)</div>` : ''}
    </div>
    <div style="max-height:400px;overflow-y:auto;font-size:12px;line-height:2;font-family:var(--mono)">${log.join('<br>')}</div>
    <div class="form-actions" style="margin-top:18px">
      <button class="btn btn-gold" onclick="initPartidasTaxis();document.getElementById('ptx-log-card').classList.add('hidden')">Consultar de nuevo</button>
      <button class="btn btn-ghost" onclick="showView('partidas','Partidas contables')">Ver partidas →</button>
    </div>`

  btn.disabled = false; btn.textContent = 'Generar partidas →'
  toast(`${creadas} partidas de taxis creadas`, 'ok')
}


// ══════════════════════════════════════════════
// ── MÓDULO VEHÍCULOS VIN
// ══════════════════════════════════════════════

let allVehiculos = []
let filteredVehiculos = []
let editingVinId = null

async function loadVehiculos() {
  const tbody = document.getElementById('tbody-vehiculos')
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'

  const { data, error } = await sb.from('vehiculos_vin')
    .select('*')
    .eq('activo', true)
    .order('fecha_compra', { ascending: false, nullsFirst: false })
    .order('vin')

  if (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--red);padding:30px">${error.message}</td></tr>`
    return
  }

  allVehiculos = data || []

  const propSelect = document.getElementById('vin-filtro-prop')
  if (propSelect) {
    const props = [...new Set(allVehiculos.map(v => v.propietario))].sort()
    propSelect.innerHTML = '<option value="">Todos los propietarios</option>' +
      props.map(p => `<option value="${p}">${p}</option>`).join('')
  }

  const fmtD = (v) => (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const props = new Set(allVehiculos.map(v => v.propietario))
  const totalCosto = allVehiculos.reduce((s, v) => s + (parseFloat(v.costo_copart) || 0), 0)

  const elTotal = document.getElementById('vin-stat-total')
  const elProps = document.getElementById('vin-stat-props')
  const elCosto = document.getElementById('vin-stat-costo')
  if (elTotal) elTotal.textContent = allVehiculos.length
  if (elProps) elProps.textContent = props.size
  if (elCosto) elCosto.textContent = `$${fmtD(totalCosto)}`

  // Ubicacion chips
  const ubicacionCounts = {}
  allVehiculos.forEach(v => {
    const ub = v.ubicacion || 'Sin asignar'
    ubicacionCounts[ub] = (ubicacionCounts[ub] || 0) + 1
  })
  const chipColors = {
    'Tránsito a puerto': '#f59e0b',
    'Bodega USA': '#3b82f6',
    'En tránsito marítimo': '#06b6d4',
    'Trámites aduaneros': '#f97316',
    'Grúa a TGU': '#8b5cf6',
    'Grúa a SPS': '#a855f7',
    'Llegado a plantel': '#22c55e',
    'Vendido': '#6b7280',
    'Sin asignar': '#4b5563'
  }
  const chipsEl = document.getElementById('vin-ubicacion-chips')
  if (chipsEl) {
    chipsEl.innerHTML = Object.entries(ubicacionCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([ub, count]) => {
        const color = chipColors[ub] || '#6b7280'
        return `<span onclick="document.getElementById('vin-filtro-ubicacion').value='${ub === 'Sin asignar' ? '' : ub}';filtrarVehiculos()" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:${color}22;border:1px solid ${color}44;color:${color};border-radius:20px;padding:4px 12px;font-size:12px;font-weight:500">
          <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>
          ${ub} <strong>${count}</strong>
        </span>`
      }).join('')
  }

  filtrarVehiculos()
}
window.loadVehiculos = loadVehiculos

window.filtrarVehiculos = () => {
  const term = (document.getElementById('vin-buscar')?.value || '').toLowerCase().trim()
  const propFilter = document.getElementById('vin-filtro-prop')?.value || ''
  const ubicacionFilter = document.getElementById('vin-filtro-ubicacion')?.value || ''

  filteredVehiculos = allVehiculos.filter(v => {
    if (propFilter && v.propietario !== propFilter) return false
    if (ubicacionFilter && (v.ubicacion || '') !== ubicacionFilter) return false
    if (term) {
      const searchable = `${v.vin} ${v.propietario} ${v.marca} ${v.modelo} ${v.anio} ${v.ubicacion || ''} ${v.notas || ''}`.toLowerCase()
      return searchable.includes(term)
    }
    return true
  })

  const elFiltrados = document.getElementById('vin-stat-filtrados')
  if (elFiltrados) elFiltrados.textContent = filteredVehiculos.length

  renderVehiculosTable()
}

function renderVehiculosTable() {
  const tbody = document.getElementById('tbody-vehiculos')
  if (!tbody) return

  if (!filteredVehiculos.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text3)">No se encontraron vehículos</td></tr>'
    return
  }

  const fmtD = (v) => (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const esSuperAdmin = currentProfile?.rol === 'super_admin'

  const ubicBadge = (ub) => {
    const colors = {
      'Tránsito a puerto': 'badge-amber',
      'Bodega USA': 'badge-blue',
      'En tránsito marítimo': 'badge-blue',
      'Trámites aduaneros': 'badge-amber',
      'Grúa a TGU': 'badge-purple',
      'Grúa a SPS': 'badge-purple',
      'Llegado a plantel': 'badge-on',
      'Vendido': 'badge-off'
    }
    if (!ub) return '<span style="color:var(--text3);font-size:11px">—</span>'
    const cls = colors[ub] || 'badge-off'
    return `<span class="badge ${cls}" style="font-size:10px;white-space:nowrap">${ub}</span>`
  }

  tbody.innerHTML = filteredVehiculos.map(v => {
    const last4 = v.vin.slice(-4)
    const fecha = v.fecha_compra ? new Date(v.fecha_compra + 'T12:00:00').toLocaleDateString('es-HN') : '—'
    return `
    <tr style="cursor:pointer" onclick="verDetalleVin('${v.id}')">
      <td style="font-family:var(--mono);font-size:16px;font-weight:600;color:var(--gold);letter-spacing:1px">${last4}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text3)">${v.vin}</td>
      <td><span class="badge badge-blue">${v.propietario}</span></td>
      <td>${v.marca}</td>
      <td>${v.modelo}</td>
      <td style="font-family:var(--mono)">${v.anio || '—'}</td>
      <td style="text-align:right;font-family:var(--mono);font-weight:500">$${fmtD(v.costo_copart)}</td>
      <td style="font-size:12px;color:var(--text3)">${fecha}</td>
      <td>${ubicBadge(v.ubicacion)}</td>
      <td style="text-align:center" onclick="event.stopPropagation()">
        ${esSuperAdmin ? `
          <button onclick="editarVehiculo('${v.id}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="Editar">✏️</button>
          <button onclick="eliminarVehiculo('${v.id}','${v.vin}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="Eliminar">🗑️</button>
        ` : '<span style="color:var(--text3);font-size:11px">—</span>'}
      </td>
    </tr>`
  }).join('')
}

window.openModalVin = () => {
  editingVinId = null
  document.getElementById('modal-vin-title').textContent = '🚗 Nuevo vehículo'
  document.getElementById('btn-guardar-vin').textContent = 'Guardar vehículo'
  ;['nv-vin','nv-propietario','nv-marca','nv-modelo','nv-anio','nv-costo','nv-fecha','nv-notas','nv-ubicacion'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = ''
  })
  document.getElementById('nv-vin').disabled = false
  document.getElementById('modal-vin-error').classList.add('hidden')
  document.getElementById('modal-vin').classList.add('open')
}

window.editarVehiculo = (id) => {
  const v = allVehiculos.find(x => x.id === id)
  if (!v) return
  editingVinId = id
  document.getElementById('modal-vin-title').textContent = '✏️ Editar vehículo'
  document.getElementById('btn-guardar-vin').textContent = 'Actualizar vehículo'
  document.getElementById('nv-vin').value = v.vin
  document.getElementById('nv-vin').disabled = true
  document.getElementById('nv-propietario').value = v.propietario
  document.getElementById('nv-marca').value = v.marca
  document.getElementById('nv-modelo').value = v.modelo
  document.getElementById('nv-anio').value = v.anio || ''
  document.getElementById('nv-costo').value = v.costo_copart || ''
  document.getElementById('nv-fecha').value = v.fecha_compra || ''
  document.getElementById('nv-notas').value = v.notas || ''
  document.getElementById('nv-ubicacion').value = v.ubicacion || ''
  document.getElementById('modal-vin-error').classList.add('hidden')
  document.getElementById('modal-vin').classList.add('open')
}

window.guardarVehiculo = async () => {
  const vin = document.getElementById('nv-vin').value.trim().toUpperCase()
  const propietario = document.getElementById('nv-propietario').value.trim().toUpperCase()
  const marca = document.getElementById('nv-marca').value.trim().toUpperCase()
  const modelo = document.getElementById('nv-modelo').value.trim().toUpperCase()
  const anio = parseInt(document.getElementById('nv-anio').value) || null
  const costo = parseFloat(document.getElementById('nv-costo').value) || 0
  const fecha = document.getElementById('nv-fecha').value || null
  const notas = document.getElementById('nv-notas').value.trim()
  const ubicacion = document.getElementById('nv-ubicacion').value || null
  const err = document.getElementById('modal-vin-error')

  if (!vin) { showError(err, 'El VIN es obligatorio'); return }
  if (vin.length < 4) { showError(err, 'El VIN debe tener al menos 4 caracteres'); return }
  if (!propietario) { showError(err, 'El propietario es obligatorio'); return }

  const btn = document.getElementById('btn-guardar-vin')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'

  const payload = { vin, propietario, marca, modelo, anio, costo_copart: costo, fecha_compra: fecha, notas, ubicacion, activo: true }

  let error
  if (editingVinId) {
    const { error: e } = await sb.from('vehiculos_vin').update(payload).eq('id', editingVinId)
    error = e
  } else {
    const { error: e } = await sb.from('vehiculos_vin').insert(payload)
    error = e
  }

  btn.disabled = false
  btn.textContent = editingVinId ? 'Actualizar vehículo' : 'Guardar vehículo'

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      showError(err, 'Ya existe un vehículo con este VIN')
    } else {
      showError(err, error.message)
    }
    return
  }

  closeModal('modal-vin')
  toast(editingVinId ? 'Vehículo actualizado ✓' : 'Vehículo registrado ✓', 'success')
  editingVinId = null
  vinCache = null
  loadVehiculos()
}

window.exportarVehiculosExcel = () => {
  if (!filteredVehiculos.length) { toast('No hay vehículos para exportar', 'error'); return }
  const rows = filteredVehiculos.map(v => ({
    'VIN': v.vin,
    'Propietario': v.propietario,
    'Marca': v.marca,
    'Modelo': v.modelo,
    'Año': v.anio || '',
    'Costo Copart (USD)': v.costo_copart || 0,
    'Fecha Compra': v.fecha_compra || '',
    'Ubicación': v.ubicacion || 'Sin asignar',
    'Notas': v.notas || ''
  }))
  const ws = window.XLSX.utils.json_to_sheet(rows)
  // Column widths
  ws['!cols'] = [
    { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 6 },
    { wch: 16 }, { wch: 12 }, { wch: 22 }, { wch: 30 }
  ]
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Vehículos')
  const fecha = new Date().toISOString().slice(0, 10)
  window.XLSX.writeFile(wb, `Vehiculos_${fecha}.xlsx`)
  toast(`${filteredVehiculos.length} vehículos exportados ✓`, 'success')
}

window.eliminarVehiculo = async (id, vin) => {
  if (!confirm(`¿Eliminar el vehículo VIN ${vin}?\n\nSe marcará como inactivo.`)) return
  const { error } = await sb.from('vehiculos_vin').update({ activo: false }).eq('id', id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast('Vehículo eliminado ✓', 'success')
  vinCache = null
  loadVehiculos()
}

// ── BUSCADOR DE VIN (Modal desde Partidas) ──
let vinCache = null

async function ensureVinCache() {
  if (vinCache) return
  const { data } = await sb.from('vehiculos_vin')
    .select('vin, propietario, marca, modelo, anio, costo_copart')
    .eq('activo', true)
    .order('propietario')
  vinCache = data || []
}

window.abrirBuscarVin = async () => {
  document.getElementById('vin-search-input').value = ''
  document.getElementById('vin-search-results').innerHTML =
    '<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">Escribe al menos 2 caracteres para buscar</div>'
  document.getElementById('modal-buscar-vin').classList.add('open')
  await ensureVinCache()
  setTimeout(() => document.getElementById('vin-search-input').focus(), 200)
}

window.buscarVinLive = () => {
  const term = (document.getElementById('vin-search-input')?.value || '').trim().toUpperCase()
  const container = document.getElementById('vin-search-results')

  if (term.length < 2) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">Escribe al menos 2 caracteres para buscar</div>'
    return
  }

  if (!vinCache) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)"><div class="spinner"></div></div>'
    ensureVinCache().then(() => buscarVinLive())
    return
  }

  const results = vinCache.filter(v => v.vin.includes(term) || v.propietario.includes(term))
  const fmtD = (v) => (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (!results.length) {
    container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">No se encontraron vehículos con "${term}"</div>`
    return
  }

  container.innerHTML = `
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">${results.length} resultado(s)</div>
    <table style="width:100%">
      <thead><tr>
        <th style="width:80px">Últimos 4</th>
        <th>VIN completo</th>
        <th>Propietario</th>
        <th>Vehículo</th>
        <th style="text-align:right">Costo</th>
      </tr></thead>
      <tbody>${results.map(v => {
        const last4 = v.vin.slice(-4)
        const vinHL = v.vin.replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
          '<span style="background:rgba(250,204,21,0.3);border-radius:2px;padding:0 2px">$1</span>')
        return `<tr style="cursor:pointer" onclick="seleccionarVinResult('${v.propietario}','${v.vin}')">
          <td style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--gold);letter-spacing:1px;text-align:center">${last4}</td>
          <td style="font-family:var(--mono);font-size:11px;color:var(--text2)">${vinHL}</td>
          <td><span class="badge badge-blue" style="font-size:12px">${v.propietario}</span></td>
          <td style="font-size:12px">${v.marca} ${v.modelo} ${v.anio || ''}</td>
          <td style="text-align:right;font-family:var(--mono);font-size:12px">$${fmtD(v.costo_copart)}</td>
        </tr>`
      }).join('')}</tbody>
    </table>`
}

window.seleccionarVinResult = (propietario, vin) => {
  const last4 = vin.slice(-4)
  const descInput = document.getElementById('pn-descripcion')
  if (descInput) {
    const current = descInput.value
    if (current && !current.includes(last4)) {
      descInput.value = `${current} · VIN ${last4} (${propietario})`
    } else if (!current) {
      descInput.value = `Gasto VIN ${last4} (${propietario})`
    }
  }
  toast(`VIN ${last4} → ${propietario}`, 'success')
  closeModal('modal-buscar-vin')
}

// ── BUSCAR TAXI DESDE PARTIDA ──
let taxiCache = null

async function ensureTaxiCache() {
  if (taxiCache) return
  const { data } = await sb.from('unidades_taxis').select('*').eq('activo', true).order('registro')
  taxiCache = data || []
}

window.abrirBuscarTaxi = async () => {
  document.getElementById('taxi-search-input').value = ''
  document.getElementById('taxi-search-results').innerHTML =
    '<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">Escribe al menos 1 carácter para buscar</div>'
  document.getElementById('modal-buscar-taxi').classList.add('open')
  await ensureTaxiCache()
  setTimeout(() => document.getElementById('taxi-search-input').focus(), 200)
}

window.buscarTaxiLive = () => {
  const term = (document.getElementById('taxi-search-input')?.value || '').trim().toUpperCase()
  const container = document.getElementById('taxi-search-results')

  if (term.length < 1) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">Escribe al menos 1 carácter para buscar</div>'
    return
  }

  if (!taxiCache) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)"><div class="spinner"></div></div>'
    ensureTaxiCache().then(() => buscarTaxiLive())
    return
  }

  const results = taxiCache.filter(u => {
    const searchable = `${u.registro} ${u.propietario || ''} ${u.motorista || ''} ${u.placa || ''} ${u.marca || ''} ${u.modalidad || ''}`.toUpperCase()
    return searchable.includes(term)
  })
  const fmtD = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })

  if (!results.length) {
    container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">No se encontraron unidades con "${term}"</div>`
    return
  }

  container.innerHTML = `
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">${results.length} resultado(s)</div>
    <table style="width:100%">
      <thead><tr>
        <th style="width:70px">Registro</th>
        <th>Modalidad</th>
        <th>Propietario</th>
        <th>Motorista</th>
        <th>Placa</th>
        <th>Vehículo</th>
        <th style="text-align:right">Saldo</th>
      </tr></thead>
      <tbody>${results.map(u => `
        <tr style="cursor:pointer" onclick="seleccionarTaxiResult(${u.registro},'${(u.propietario||'').replace(/'/g,"\\'")}','${(u.motorista||'').replace(/'/g,"\\'")}')">
          <td style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--gold);letter-spacing:1px;text-align:center">${u.registro}</td>
          <td><span class="badge ${u.modalidad === 'VIP' ? 'badge-blue' : u.modalidad === 'BUS' ? 'badge-green' : 'badge-amber'}">${u.modalidad}</span></td>
          <td>${u.propietario !== 'TAXIS' ? `<span class="badge badge-green">${u.propietario}</span>` : '<span style="color:var(--text3)">TAXIS</span>'}</td>
          <td style="font-size:12px">${u.motorista || '<span style="color:var(--text3)">—</span>'}</td>
          <td style="font-family:var(--mono);font-size:12px">${u.placa || '—'}</td>
          <td style="font-size:12px">${u.marca || ''} ${u.modelo || ''} ${u.anio || ''}</td>
          <td style="text-align:right;font-family:var(--mono);font-size:12px">${u.financiado && u.saldo_prestamo ? 'L. ' + fmtD(u.saldo_prestamo) : '<span style="color:var(--text3)">—</span>'}</td>
        </tr>`).join('')}</tbody>
    </table>`
}

window.seleccionarTaxiResult = (registro, propietario, motorista) => {
  const descInput = document.getElementById('pn-descripcion')
  if (descInput) {
    const current = descInput.value
    const info = `TAXI #${registro}${motorista ? ' (' + motorista + ')' : ''}`
    if (current && !current.includes(`#${registro}`)) {
      descInput.value = `${current} · ${info}`
    } else if (!current) {
      descInput.value = info
    }
  }
  toast(`Taxi #${registro} → ${motorista || propietario}`, 'success')
  closeModal('modal-buscar-taxi')
}

// ── DETALLE DE VEHÍCULO VIN (inversión total) ──

window.verDetalleVin = async (vinId) => {
  const v = allVehiculos.find(x => x.id === vinId)
  if (!v) return
  // Extract all trailing digits from VIN for search - try multiple lengths
  const trailingDigits = v.vin.match(/(\d+)$/)?.[1] || v.vin.slice(-4)
  const last4 = v.vin.slice(-4)
  const last5 = v.vin.slice(-5)
  const last6 = v.vin.slice(-6)
  // Build search variants: full trailing, last6, last5, last4
  const searchVariants = [...new Set([trailingDigits, last6, last5, last4].filter(s => s.length >= 4))]

  document.getElementById('modal-dv-title').textContent = `🚗 Detalle VIN ${last4} · ${v.marca} ${v.modelo} ${v.anio || ''}`
  document.getElementById('dv-info').innerHTML = `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:14px;display:flex;gap:20px;flex-wrap:wrap">
      <div><span style="color:var(--text3);font-size:11px">VIN completo</span><div style="font-family:var(--mono);font-size:12px;letter-spacing:1px">${v.vin}</div></div>
      <div><span style="color:var(--text3);font-size:11px">Propietario</span><div><span class="badge badge-blue">${v.propietario}</span></div></div>
      <div><span style="color:var(--text3);font-size:11px">Vehículo</span><div>${v.marca} ${v.modelo} ${v.anio || ''}</div></div>
      <div><span style="color:var(--text3);font-size:11px">Costo Copart</span><div style="font-family:var(--mono);font-weight:600;color:var(--gold)">$ ${(v.costo_copart || 0).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
      <div><span style="color:var(--text3);font-size:11px">Ubicación</span><div>${v.ubicacion ? `<span class="badge ${({'Tránsito a puerto':'badge-amber','Bodega USA':'badge-blue','En tránsito marítimo':'badge-blue','Trámites aduaneros':'badge-amber','Grúa a TGU':'badge-purple','Grúa a SPS':'badge-purple','Llegado a plantel':'badge-on','Vendido':'badge-off'})[v.ubicacion] || 'badge-off'}">${v.ubicacion}</span>` : '<span style="color:var(--text3)">Sin asignar</span>'}</div></div>
    </div>`
  document.getElementById('dv-resumen').innerHTML = ''
  document.getElementById('dv-contenido').innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>'
  document.getElementById('modal-detalle-vin').classList.add('open')

  const fmtL = (val) => (val || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // 1. Buscar en facturas_taxis donde tipo_unidad='VIN' y registro coincide
  const regNum = parseInt(last4)
  const { data: facturas } = await sb.from('facturas_taxis')
    .select('fecha, descripcion, monto, es_mano_obra')
    .eq('tipo_unidad', 'VIN')
    .eq('registro', regNum)
    .order('fecha')

  // 2. Buscar en lineas_partida donde la descripción menciona el VIN con prefijo
  // Only search with proper VIN prefix to avoid false positives (e.g. 1180 matching 11800)
  const lineaFilters = searchVariants.flatMap(s => [
    `descripcion.ilike.%VIN ${s}%`,
    `descripcion.ilike.%VIN_${s}%`,
    `descripcion.ilike.%VIN  ${s}%`
  ])
  lineaFilters.push(`descripcion.ilike.%${v.vin}%`) // full VIN always safe
  const orFilter = [...new Set(lineaFilters)].join(',')

  const { data: lineasVin } = await sb.from('lineas_partida')
    .select('monto, descripcion, tipo, partida:partidas_contables(fecha_partida, estado, descripcion)')
    .or(orFilter)

  // Also search partidas whose description mentions this VIN
  const { data: partidasVin } = await sb.from('partidas_contables')
    .select('id, fecha_partida, estado, descripcion')
    .or(orFilter)
    .eq('estado', 'aprobada')

  let lineasVinPadre = []
  if (partidasVin?.length) {
    const ids = partidasVin.map(p => p.id)
    const { data: lp } = await sb.from('lineas_partida')
      .select('monto, descripcion, tipo, partida_id')
      .in('partida_id', ids)
      .eq('tipo', 'debito')
    lineasVinPadre = (lp || []).map(l => {
      const p = partidasVin.find(pp => pp.id === l.partida_id)
      return { ...l, partida: p }
    })
  }

  // Filtrar solo partidas aprobadas y débitos (gastos) — merge both searches
  const allLineasVin = [...(lineasVin || []), ...(lineasVinPadre || [])]
  // Deduplicate by partida id + monto
  const seenIds = new Set()
  const gastosPartidas = allLineasVin.filter(l => {
    if (!l.partida?.estado || l.partida.estado !== 'aprobada') return false
    if (l.tipo !== 'debito') return false
    const key = `${l.partida.fecha_partida}-${l.monto}`
    if (seenIds.has(key)) return false
    seenIds.add(key)
    return true
  }).map(l => ({
    fecha: l.partida.fecha_partida,
    descripcion: l.descripcion || l.partida.descripcion,
    monto: parseFloat(l.monto) || 0,
    fuente: 'partida'
  }))

  // 3. Combinar facturas importadas + gastos de partidas manuales (evitar duplicados)
  const gastosFacturas = (facturas || []).map(f => ({
    fecha: f.fecha,
    descripcion: f.descripcion,
    monto: parseFloat(f.monto) || 0,
    es_mano_obra: f.es_mano_obra,
    fuente: 'factura'
  }))

  // Deduplicar: si un gasto de partida tiene la misma fecha y monto similar a una factura, es duplicado
  const todosGastos = [...gastosFacturas]
  gastosPartidas.forEach(gp => {
    const isDup = gastosFacturas.some(gf =>
      gf.fecha === gp.fecha && Math.abs(gf.monto - gp.monto) < 0.02
    )
    if (!isDup) todosGastos.push(gp)
  })

  // Ordenar por fecha
  todosGastos.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))

  const totalGastos = todosGastos.reduce((s, g) => s + g.monto, 0)
  const totalMO = todosGastos.filter(g => g.es_mano_obra).reduce((s, g) => s + g.monto, 0)
  const totalRepuestos = totalGastos - totalMO
  const costoCopartLps = (v.costo_copart || 0) * 25  // Aproximación, ajustar TC si necesario
  const inversionTotal = totalGastos + costoCopartLps

  // Resumen
  document.getElementById('dv-resumen').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      <div class="stat-card"><div class="stat-num" style="color:var(--gold);font-size:16px">$ ${(v.costo_copart || 0).toLocaleString('en-US',{minimumFractionDigits:2})}</div><div class="stat-label">Costo Copart</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);font-size:16px">L. ${fmtL(totalGastos)}</div><div class="stat-label">Gastos adicionales</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--amber);font-size:16px">L. ${fmtL(totalMO)}</div><div class="stat-label">Mano de obra</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--blue);font-size:16px">${todosGastos.length}</div><div class="stat-label">Movimientos</div></div>
    </div>`

  // Tabla de gastos
  document.getElementById('dv-contenido').innerHTML = todosGastos.length ? `
    <div class="table-wrap">
      <div class="table-header"><span class="table-title">Historial de gastos</span></div>
      <table>
        <thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Fuente</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>${todosGastos.map(g => `
          <tr>
            <td style="font-family:var(--mono);font-size:12px">${g.fecha || '—'}</td>
            <td style="font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${g.descripcion}">${g.descripcion}</td>
            <td>${g.es_mano_obra ? '<span class="badge badge-blue" style="font-size:10px">M.O.</span>' : '<span class="badge badge-amber" style="font-size:10px">Repuesto</span>'}</td>
            <td style="font-size:11px;color:var(--text3)">${g.fuente === 'factura' ? '📋 Importación' : '📝 Partida'}</td>
            <td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${fmtL(g.monto)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr style="background:var(--bg3)"><td colspan="4" style="text-align:right">Repuestos/materiales</td><td style="text-align:right;font-family:var(--mono)">L. ${fmtL(totalRepuestos)}</td></tr>
          <tr style="background:var(--bg3)"><td colspan="4" style="text-align:right">Mano de obra</td><td style="text-align:right;font-family:var(--mono)">L. ${fmtL(totalMO)}</td></tr>
          <tr style="background:var(--bg3);font-weight:600"><td colspan="4" style="text-align:right;color:var(--red)">Total gastos adicionales</td><td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${fmtL(totalGastos)}</td></tr>
        </tfoot>
      </table>
    </div>` : '<div style="text-align:center;padding:30px;color:var(--text3)">No se encontraron gastos registrados para este VIN</div>'
}

// ══════════════════════════════════════════════
// ── MÓDULO UNIDADES TAXIS
// ══════════════════════════════════════════════

let allUnidades = []
let filteredUnidades = []
let editingUnidadId = null

async function loadUnidadesTaxis() {
  const tbody = document.getElementById('tbody-unidades-taxis')
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'

  const { data, error } = await sb.from('unidades_taxis').select('*').eq('activo', true).order('registro')
  if (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--red);padding:30px">${error.message}</td></tr>`
    return
  }
  allUnidades = data || []

  // Poblar filtro propietarios
  const propSelect = document.getElementById('ut-filtro-prop')
  if (propSelect) {
    const props = [...new Set(allUnidades.map(u => u.propietario))].sort()
    propSelect.innerHTML = '<option value="">Todos los propietarios</option>' + props.map(p => `<option value="${p}">${p}</option>`).join('')
  }

  // Stats
  const taxis = allUnidades.filter(u => u.modalidad === 'TAXI').length
  const vips = allUnidades.filter(u => u.modalidad === 'VIP').length
  const fins = allUnidades.filter(u => u.financiado).length
  const socios = allUnidades.filter(u => u.propietario !== 'TAXIS').length
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v }
  el('ut-stat-total', allUnidades.length)
  el('ut-stat-taxi', taxis)
  el('ut-stat-vip', vips)
  el('ut-stat-fin', fins)
  el('ut-stat-socios', socios)

  filtrarUnidades()
}
window.loadUnidadesTaxis = loadUnidadesTaxis

window.filtrarUnidades = () => {
  const term = (document.getElementById('ut-buscar')?.value || '').toLowerCase().trim()
  const propFilter = document.getElementById('ut-filtro-prop')?.value || ''
  const modFilter = document.getElementById('ut-filtro-mod')?.value || ''
  const finFilter = document.getElementById('ut-filtro-fin')?.value || ''

  filteredUnidades = allUnidades.filter(u => {
    if (propFilter && u.propietario !== propFilter) return false
    if (modFilter && u.modalidad !== modFilter) return false
    if (finFilter === 'true' && !u.financiado) return false
    if (finFilter === 'false' && u.financiado) return false
    if (term) {
      const searchable = `${u.registro} ${u.propietario} ${u.motorista || ''} ${u.placa || ''} ${u.marca || ''} ${u.modalidad}`.toLowerCase()
      return searchable.includes(term)
    }
    return true
  })
  renderUnidadesTable()
}

function renderUnidadesTable() {
  const tbody = document.getElementById('tbody-unidades-taxis')
  if (!tbody) return
  if (!filteredUnidades.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text3)">No se encontraron unidades</td></tr>'
    return
  }
  const fmtD = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const esSA = currentProfile?.rol === 'super_admin'

  tbody.innerHTML = filteredUnidades.map(u => `
    <tr style="cursor:pointer" onclick="verDetalleUnidad(${u.registro})">
      <td style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--gold);letter-spacing:1px">${u.registro}</td>
      <td><span class="badge ${u.modalidad === 'VIP' ? 'badge-blue' : u.modalidad === 'BUS' ? 'badge-green' : u.modalidad === 'PARTICULAR' ? 'badge-red' : 'badge-amber'}">${u.modalidad}</span></td>
      <td>${u.propietario !== 'TAXIS' ? `<span class="badge badge-green">${u.propietario}</span>` : '<span style="color:var(--text3)">TAXIS</span>'}</td>
      <td style="font-size:13px">${u.motorista || '<span style="color:var(--text3)">—</span>'}</td>
      <td>${u.financiado ? '<span class="badge badge-red" style="font-size:10px">FINANCIADO</span>' : '<span style="color:var(--text3);font-size:11px">—</span>'}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:13px">${u.financiado && u.saldo_prestamo ? 'L. ' + fmtD(u.saldo_prestamo) : '<span style="color:var(--text3)">—</span>'}</td>
      <td style="font-family:var(--mono);font-size:12px;color:var(--text3)">${u.placa || '—'}</td>
      <td style="text-align:center" onclick="event.stopPropagation()">
        ${esSA ? `
          <button onclick="editarUnidad('${u.id}')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="Editar">✏️</button>
          <button onclick="desactivarUnidad('${u.id}',${u.registro})" style="background:none;border:none;cursor:pointer;font-size:13px;padding:4px" title="Desactivar">🚫</button>
        ` : '—'}
      </td>
    </tr>`).join('')
}

// Toggle financiado fields visibility
document.addEventListener('change', (e) => {
  if (e.target.id === 'nut-financiado') {
    document.getElementById('nut-campos-fin').style.display = e.target.checked ? 'block' : 'none'
  }
})

window.openModalUnidad = () => {
  editingUnidadId = null
  document.getElementById('modal-unidad-title').textContent = '🚕 Nueva unidad'
  document.getElementById('btn-guardar-unidad').textContent = 'Guardar unidad'
  ;['nut-registro','nut-motorista','nut-placa','nut-marca','nut-anio','nut-color','nut-saldo','nut-tasa','nut-gps','nut-seguro','nut-admin','nut-notas'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = ''
  })
  document.getElementById('nut-registro').disabled = false
  document.getElementById('nut-propietario').value = 'TAXIS'
  document.getElementById('nut-modalidad').value = 'TAXI'
  document.getElementById('nut-financiado').checked = false
  document.getElementById('nut-campos-fin').style.display = 'none'
  document.getElementById('modal-unidad-error').classList.add('hidden')
  document.getElementById('modal-unidad-taxi').classList.add('open')
}

window.editarUnidad = (id) => {
  const u = allUnidades.find(x => x.id === id)
  if (!u) return
  editingUnidadId = id
  document.getElementById('modal-unidad-title').textContent = `✏️ Editar unidad #${u.registro}`
  document.getElementById('btn-guardar-unidad').textContent = 'Actualizar unidad'
  document.getElementById('nut-registro').value = u.registro
  document.getElementById('nut-registro').disabled = true
  document.getElementById('nut-modalidad').value = u.modalidad
  document.getElementById('nut-propietario').value = u.propietario
  document.getElementById('nut-motorista').value = u.motorista || ''
  document.getElementById('nut-placa').value = u.placa || ''
  document.getElementById('nut-marca').value = u.marca || ''
  document.getElementById('nut-anio').value = u.anio || ''
  document.getElementById('nut-color').value = u.color || ''
  document.getElementById('nut-financiado').checked = u.financiado
  document.getElementById('nut-campos-fin').style.display = u.financiado ? 'block' : 'none'
  document.getElementById('nut-saldo').value = u.saldo_prestamo || ''
  document.getElementById('nut-tasa').value = u.tasa_interes || ''
  document.getElementById('nut-gps').value = u.cuota_gps || ''
  document.getElementById('nut-seguro').value = u.cuota_seguro || ''
  document.getElementById('nut-admin').value = u.cuota_administracion || ''
  document.getElementById('nut-notas').value = u.notas || ''
  document.getElementById('modal-unidad-error').classList.add('hidden')
  document.getElementById('modal-unidad-taxi').classList.add('open')
}

window.guardarUnidad = async () => {
  const registro = parseInt(document.getElementById('nut-registro').value) || 0
  const modalidad = document.getElementById('nut-modalidad').value
  const propietario = document.getElementById('nut-propietario').value.trim().toUpperCase() || 'TAXIS'
  const motorista = document.getElementById('nut-motorista').value.trim()
  const placa = document.getElementById('nut-placa').value.trim().toUpperCase()
  const marca = document.getElementById('nut-marca').value.trim().toUpperCase()
  const anio = parseInt(document.getElementById('nut-anio').value) || 0
  const color = document.getElementById('nut-color').value.trim().toUpperCase()
  const financiado = document.getElementById('nut-financiado').checked
  const saldo = parseFloat(document.getElementById('nut-saldo').value) || 0
  const tasa = parseFloat(document.getElementById('nut-tasa').value) || 0
  const gps = parseFloat(document.getElementById('nut-gps').value) || 0
  const seguro = parseFloat(document.getElementById('nut-seguro').value) || 0
  const admin = parseFloat(document.getElementById('nut-admin').value) || 0
  const notas = document.getElementById('nut-notas').value.trim()
  const err = document.getElementById('modal-unidad-error')

  if (!registro) { showError(err, 'El número de registro es obligatorio'); return }

  const btn = document.getElementById('btn-guardar-unidad')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'

  const payload = {
    registro, modalidad, propietario, motorista, placa, marca, anio, color,
    financiado, saldo_prestamo: saldo, tasa_interes: tasa,
    cuota_gps: gps, cuota_seguro: seguro, cuota_administracion: admin,
    centro_costo: 'TAXIS', notas, activo: true
  }

  let error
  if (editingUnidadId) {
    const { error: e } = await sb.from('unidades_taxis').update(payload).eq('id', editingUnidadId)
    error = e
  } else {
    const { error: e } = await sb.from('unidades_taxis').insert(payload)
    error = e
  }

  btn.disabled = false
  btn.textContent = editingUnidadId ? 'Actualizar unidad' : 'Guardar unidad'

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      showError(err, `Ya existe una unidad con registro #${registro}`)
    } else { showError(err, error.message) }
    return
  }

  closeModal('modal-unidad-taxi')
  toast(editingUnidadId ? `Unidad #${registro} actualizada ✓` : `Unidad #${registro} registrada ✓`, 'success')
  editingUnidadId = null
  loadUnidadesTaxis()
}

window.desactivarUnidad = async (id, registro) => {
  if (!confirm(`¿Desactivar la unidad #${registro}?\n\nSe marcará como inactiva.`)) return
  const { error } = await sb.from('unidades_taxis').update({ activo: false }).eq('id', id)
  if (error) { toast('Error: ' + error.message, 'error'); return }
  toast(`Unidad #${registro} desactivada ✓`, 'success')
  loadUnidadesTaxis()
}

// ── DETALLE DE UNIDAD (entregas vs facturas) ──

let detalleRegistro = null

// Calcula ingresos/egresos de una unidad en un rango. Reutilizable por el modal y por reportes.
window.calcularRentabilidadUnidad = async (registro, desde, hasta) => {
  const { data: entregas } = await sb.from('entregas_taxis')
    .select('fecha_deposito, monto, banco')
    .eq('unidad', registro).gte('fecha_deposito', desde).lte('fecha_deposito', hasta)
    .order('fecha_deposito')

  const { data: facturas } = await sb.from('facturas_taxis')
    .select('fecha, descripcion, monto, es_mano_obra, tipo_unidad')
    .eq('registro', registro).gte('fecha', desde).lte('fecha', hasta).order('fecha')

  const reg = String(registro)
  const patterns = [
    `%TAXI ${reg}%`, `%TAXI_${reg}%`, `%T_${reg}%`,
    `%VIP ${reg}%`, `%VIP_${reg}%`,
    `%TAXI  ${reg}%`, `%VIP  ${reg}%`,
    `%TAXI VIP ${reg}%`, `%TAXI VIP  ${reg}%`
  ]
  const { data: partidasRango } = await sb.from('partidas_contables')
    .select('id, fecha_partida, descripcion').eq('estado', 'aprobada')
    .gte('fecha_partida', desde).lte('fecha_partida', hasta).limit(20000)
  // Buscar líneas directamente por patrón (sin pasar cientos de IDs a .in())
  let lineasCrudas = []
  for (const pat of patterns) {
    const { data } = await sb.from('lineas_partida')
      .select('descripcion, monto, tipo, cuenta_codigo, centro_costo_id, partida_id, partida:partidas_contables(id, fecha_partida, descripcion, estado)')
      .ilike('descripcion', pat).limit(20000)
    if (data?.length) lineasCrudas.push(...data)
  }
  let partidasGastos = lineasCrudas.filter(g => {
    const p = g.partida
    if (!p || p.estado !== 'aprobada') return false
    return p.fecha_partida >= desde && p.fecha_partida <= hasta
  })
  const seenKeys = new Set()
  partidasGastos = partidasGastos.filter(g => {
    const key = `${g.partida_id}_${g.cuenta_codigo}_${g.monto}`
    if (seenKeys.has(key)) return false
    seenKeys.add(key); return true
  }).filter(g => g.centro_costo_id)   // excluye bancos/caja (sin centro de costo)

  const partidaMap = Object.fromEntries((partidasRango || []).map(p => [p.id, p]))
  const gastosPartidas = partidasGastos.map(g => ({
    fecha: partidaMap[g.partida_id]?.fecha_partida || '',
    descripcion: g.descripcion || partidaMap[g.partida_id]?.descripcion || '',
    monto: parseFloat(g.monto) || 0, es_mano_obra: false,
    _fromPartida: true, _tipo: g.tipo, _cuenta: g.cuenta_codigo
  }))
  const todasFacturas = [...(facturas || []), ...gastosPartidas].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
  const esIngresoLinea = (f) => f._fromPartida && f._tipo === 'credito' && String(f._cuenta || '').startsWith('4')

  const totalEntregas = (entregas || []).reduce((s, e) => s + (parseFloat(e.monto) || 0), 0)
  const ingresosPartidas = todasFacturas.filter(esIngresoLinea).reduce((s, f) => s + (parseFloat(f.monto) || 0), 0)
  const totalIngresos = totalEntregas + ingresosPartidas
  const totalEgresos = todasFacturas.filter(f => !esIngresoLinea(f)).reduce((s, f) => s + (parseFloat(f.monto) || 0), 0)
  return { totalIngresos, totalEgresos, neto: totalIngresos - totalEgresos, entregasCount: (entregas || []).length, facturasCount: todasFacturas.length }
}

window.verDetalleUnidad = async (registro, desde = null, hasta = null) => {
  detalleRegistro = registro
  let u = allUnidades.find(x => x.registro === registro)
  if (!u) {
    const { data } = await sb.from('unidades_taxis').select('*').eq('registro', registro).maybeSingle()
    u = data || null
  }
  document.getElementById('modal-du-title').textContent = `🚕 Detalle unidad #${registro}${u ? ' · ' + u.modalidad + (u.propietario !== 'TAXIS' ? ' · ' + u.propietario : '') : ''}`
  // Rango: usa el recibido (desde el reporte) o, si no, el mes actual
  const hoy = new Date()
  document.getElementById('du-desde').value = desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0]
  document.getElementById('du-hasta').value = hasta || localDateStr(hoy)
  document.getElementById('du-resumen').innerHTML = ''
  document.getElementById('du-contenido').innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">Selecciona un rango de fechas y consulta</div>'
  document.getElementById('modal-detalle-unidad').classList.add('open')
  // Auto-consultar
  cargarDetalleUnidad()
}

window.cargarDetalleUnidad = async () => {
  if (!detalleRegistro) return
  const desde = document.getElementById('du-desde').value
  const hasta = document.getElementById('du-hasta').value
  if (!desde || !hasta) return

  const contenido = document.getElementById('du-contenido')
  contenido.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>'

  const fmtL = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // 1. Cargar entregas
  const { data: entregas } = await sb.from('entregas_taxis')
    .select('fecha_deposito, monto, banco')
    .eq('unidad', detalleRegistro)
    .gte('fecha_deposito', desde)
    .lte('fecha_deposito', hasta)
    .order('fecha_deposito')

  // 2. Cargar facturas (gastos) desde importación
  const { data: facturas } = await sb.from('facturas_taxis')
    .select('fecha, descripcion, monto, es_mano_obra, tipo_unidad, partida_id')
    .eq('registro', detalleRegistro)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha')

  // 3. Cargar gastos/ingresos de partidas manuales que referencian esta unidad
  const reg = String(detalleRegistro)
  // Patterns with single and double spaces to handle inconsistent spacing
  const patterns = [
    `%TAXI ${reg}%`, `%TAXI_${reg}%`, `%T_${reg}%`,
    `%VIP ${reg}%`, `%VIP_${reg}%`,
    `%TAXI  ${reg}%`, `%VIP  ${reg}%`,
    `%TAXI VIP ${reg}%`, `%TAXI VIP  ${reg}%`
  ]
  // Buscar las LÍNEAS directamente por patrón (sin pasar cientos de IDs a .in(),
  // que satura la consulta y trunca resultados). Luego se filtran por fecha/estado.
  let lineasCrudas = []
  for (const pat of patterns) {
    const { data } = await sb.from('lineas_partida')
      .select('descripcion, monto, tipo, cuenta_codigo, centro_costo_id, partida_id, partida:partidas_contables(id, fecha_partida, descripcion, estado)')
      .ilike('descripcion', pat).limit(20000)
    if (data?.length) lineasCrudas.push(...data)
  }
  // También: líneas de partidas cuyo ENCABEZADO referencia la unidad (aunque la
  // línea no tenga el patrón). Se buscan los encabezados que casen y se traen sus líneas.
  for (const pat of patterns) {
    const { data: heads } = await sb.from('partidas_contables')
      .select('id').eq('estado', 'aprobada').ilike('descripcion', pat)
      .gte('fecha_partida', desde).lte('fecha_partida', hasta).limit(5000)
    if (heads?.length) {
      const { data } = await sb.from('lineas_partida')
        .select('descripcion, monto, tipo, cuenta_codigo, centro_costo_id, partida_id, partida:partidas_contables(id, fecha_partida, descripcion, estado)')
        .in('partida_id', heads.map(h => h.id))
      if (data?.length) lineasCrudas.push(...data)
    }
  }
  // Filtrar por estado aprobada y rango de fechas (de la partida embebida)
  let partidasGastos = lineasCrudas.filter(g => {
    const p = g.partida
    if (!p || p.estado !== 'aprobada') return false
    return p.fecha_partida >= desde && p.fecha_partida <= hasta
  })
  // Mapa de partidas para fecha/descripción posterior
  const partidasRango = []
  { const vistos = new Set()
    for (const g of partidasGastos) {
      if (g.partida && !vistos.has(g.partida.id)) { vistos.add(g.partida.id); partidasRango.push(g.partida) }
    }
  }
  // Deduplicar
  const seenKeys = new Set()
  partidasGastos = partidasGastos.filter(g => {
    const key = `${g.partida_id}_${g.cuenta_codigo}_${g.monto}`
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
    return true
  })
  // Solo cuentan las líneas CON centro de costo. Las de bancos/caja (contrapartida)
  // van sin centro de costo, así que quedan excluidas automáticamente.
  partidasGastos = partidasGastos.filter(g => g.centro_costo_id)
  // Quitar duplicados entre fuentes: si una partida YA vino por importación (tiene filas
  // en facturas_taxis), sus líneas de GASTO ya están contadas ahí. Mantenemos solo los
  // ingresos (ventas, cuenta 4xxx) de esa partida; los gastos se omiten para no duplicar.
  const partidasConFactura = new Set((facturas || []).map(f => f.partida_id).filter(Boolean))
  partidasGastos = partidasGastos.filter(g => {
    const esIngreso = g.tipo === 'credito' && String(g.cuenta_codigo || '').startsWith('4')
    return esIngreso || !partidasConFactura.has(g.partida_id)
  })
  const partidaMap = Object.fromEntries((partidasRango || []).map(p => [p.id, p]))
  const gastosPartidas = partidasGastos.map(g => ({
    fecha: partidaMap[g.partida_id]?.fecha_partida || '',
    descripcion: g.descripcion || partidaMap[g.partida_id]?.descripcion || '',
    monto: parseFloat(g.monto) || 0,
    es_mano_obra: false,
    _fromPartida: true,
    _tipo: g.tipo,
    _cuenta: g.cuenta_codigo
  }))

  // Combinar facturas importadas + gastos de partidas manuales
  const todasFacturas = [...(facturas || []), ...gastosPartidas].sort((a, b) => a.fecha?.localeCompare(b.fecha))

  // Una línea de partida es INGRESO si es crédito a una cuenta de ingreso (código que inicia en 4)
  const esIngresoLinea = (f) => f._fromPartida && f._tipo === 'credito' && String(f._cuenta || '').startsWith('4')

  const totalEntregas = (entregas || []).reduce((s, e) => s + (parseFloat(e.monto) || 0), 0)
  const ingresosPartidas = todasFacturas.filter(esIngresoLinea).reduce((s, f) => s + (parseFloat(f.monto) || 0), 0)
  const totalIngresos = totalEntregas + ingresosPartidas
  // Gastos = facturas importadas + líneas de partida que NO son ingreso
  const totalFacturas = todasFacturas.filter(f => !esIngresoLinea(f)).reduce((s, f) => s + (parseFloat(f.monto) || 0), 0)
  const totalMO = todasFacturas.filter(f => !esIngresoLinea(f) && f.es_mano_obra).reduce((s, f) => s + (parseFloat(f.monto) || 0), 0)
  const totalRepuestos = totalFacturas - totalMO
  const neto = totalIngresos - totalFacturas

  // Resumen
  document.getElementById('du-resumen').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      <div class="stat-card"><div class="stat-num" style="color:var(--green);font-size:16px">L. ${fmtL(totalIngresos)}</div><div class="stat-label">Ingresos</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red);font-size:16px">L. ${fmtL(totalFacturas)}</div><div class="stat-label">Facturas (gasto)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--amber);font-size:16px">L. ${fmtL(totalMO)}</div><div class="stat-label">Mano de obra</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${neto >= 0 ? 'var(--green)' : 'var(--red)'};font-size:16px">L. ${fmtL(neto)}</div><div class="stat-label">${neto >= 0 ? 'Utilidad' : 'Pérdida'}</div></div>
    </div>`

  // Tabs de entregas y facturas
  let html = `
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn btn-ghost" onclick="toggleDetalleTab('entregas')" id="du-tab-entregas" style="border-color:var(--green);color:var(--green);font-size:12px;padding:6px 14px">📥 Entregas (${(entregas || []).length})</button>
      <button class="btn btn-ghost" onclick="toggleDetalleTab('facturas')" id="du-tab-facturas" style="font-size:12px;padding:6px 14px">🔧 Facturas (${todasFacturas.length})</button>
    </div>
    <div id="du-panel-entregas">
      <table style="width:100%">
        <thead><tr><th>Fecha</th><th>Banco</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>${(entregas || []).length ? (entregas || []).map(e => `
          <tr>
            <td style="font-family:var(--mono);font-size:12px">${e.fecha_deposito}</td>
            <td style="font-size:12px;color:var(--text3)">${e.banco || '—'}</td>
            <td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${fmtL(e.monto)}</td>
          </tr>`).join('') : '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text3)">No hay entregas en este período</td></tr>'}
        </tbody>
        <tfoot><tr style="background:var(--bg3);font-weight:600"><td colspan="2" style="text-align:right">Total entregas</td><td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${fmtL(totalEntregas)}</td></tr></tfoot>
      </table>
    </div>
    <div id="du-panel-facturas" style="display:none">
      <table style="width:100%">
        <thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>${todasFacturas.length ? todasFacturas.map(f => `
          <tr>
            <td style="font-family:var(--mono);font-size:12px">${f.fecha}</td>
            <td style="font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.descripcion}">${f.descripcion}</td>
            <td>${f._fromPartida ? (f._tipo === 'credito' && f._cuenta?.startsWith('4') ? '<span class="badge badge-on" style="font-size:10px">Ingreso</span>' : '<span class="badge badge-purple" style="font-size:10px">Gasto</span>') : f.es_mano_obra ? '<span class="badge badge-blue" style="font-size:10px">M.O.</span>' : '<span class="badge badge-amber" style="font-size:10px">Repuesto</span>'}</td>
            <td style="text-align:right;font-family:var(--mono);color:${f._fromPartida && f._tipo === 'credito' && f._cuenta?.startsWith('4') ? 'var(--green)' : 'var(--red)'}">L. ${fmtL(f.monto)}</td>
          </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text3)">No hay facturas en este período</td></tr>'}
        </tbody>
        <tfoot>
          ${ingresosPartidas > 0 ? `<tr style="background:var(--bg3)"><td colspan="3" style="text-align:right;color:var(--green)">Ingresos (partidas)</td><td style="text-align:right;font-family:var(--mono);color:var(--green)">L. ${fmtL(ingresosPartidas)}</td></tr>` : ''}
          <tr style="background:var(--bg3)"><td colspan="3" style="text-align:right">Repuestos</td><td style="text-align:right;font-family:var(--mono)">L. ${fmtL(totalRepuestos)}</td></tr>
          <tr style="background:var(--bg3)"><td colspan="3" style="text-align:right">Mano de obra</td><td style="text-align:right;font-family:var(--mono)">L. ${fmtL(totalMO)}</td></tr>
          <tr style="background:var(--bg3);font-weight:600"><td colspan="3" style="text-align:right">Total facturas</td><td style="text-align:right;font-family:var(--mono);color:var(--red)">L. ${fmtL(totalFacturas)}</td></tr>
        </tfoot>
      </table>
    </div>`

  contenido.innerHTML = html
}

window.toggleDetalleTab = (tab) => {
  const panelE = document.getElementById('du-panel-entregas')
  const panelF = document.getElementById('du-panel-facturas')
  const tabE = document.getElementById('du-tab-entregas')
  const tabF = document.getElementById('du-tab-facturas')
  if (tab === 'entregas') {
    panelE.style.display = ''; panelF.style.display = 'none'
    tabE.style.borderColor = 'var(--green)'; tabE.style.color = 'var(--green)'
    tabF.style.borderColor = ''; tabF.style.color = ''
  } else {
    panelE.style.display = 'none'; panelF.style.display = ''
    tabF.style.borderColor = 'var(--red)'; tabF.style.color = 'var(--red)'
    tabE.style.borderColor = ''; tabE.style.color = ''
  }
}


// ══════════════════════════════════════════════
// ── IMPORTAR FACTURAS TAXIS (XLSX plantel)
// ══════════════════════════════════════════════

const FACT_TAXIS_CUENTAS = {
  costo_mercaderia: { codigo: '510101-001', nombre: 'COSTO DE ADQUISICION DE MERCADERIA TECNIMAX' },
  inventario:       { codigo: '110501-001', nombre: 'INVENTARIO PARA LA VENTA BODEGA PRINCIPAL' },
  mano_obra:        { codigo: '410101-004', nombre: 'MANO DE OBRA TAXIS' },
  factura_taxis:    { codigo: '410301-004', nombre: 'VENTAS PLANTEL TAXIS' },
  factura_yonker:   { codigo: '410301-002', nombre: 'VENTA YONKER TECNIMAX 2' },
}

let factTaxisParsed = null  // { dias: [...], alertas: [...] }

// Parsear el prefijo: T_0089, VIP_4361, VIN_8789, TAXI 4361, VIP 8544, VIN 2109
function parseFactTaxisPrefix(desc) {
  if (!desc) return null
  const d = desc.trim()

  // Buscar prefijo en cualquier posición (no solo al inicio)
  // Orden: TAXI VIP primero, luego TAXI, VIP, VIN, T_ (para evitar matchs parciales)
  let m

  // TAXI VIP XXXX
  m = d.match(/(?:^|[\s,;(])TAXI[\s_]VIP[\s_](\d+)/i)
  if (m) return { tipo: 'VIP', registro: parseInt(m[1]), rest: d.replace(m[0], '').replace(/^[\s,]+/, '').trim() }

  // TAXI_XXXX, TAXI XXXX
  m = d.match(/(?:^|[\s,;(])TAXI[\s_](\d+)/i)
  if (m) return { tipo: 'TAXI', registro: parseInt(m[1]), rest: d.replace(m[0], '').replace(/^[\s,]+/, '').trim() }

  // TAXIS VIP XXXX (plural)
  m = d.match(/(?:^|[\s,;(])TAXIS[\s_]VIP[\s_](\d+)/i)
  if (m) return { tipo: 'VIP', registro: parseInt(m[1]), rest: d.replace(m[0], '').replace(/^[\s,]+/, '').trim() }

  // TAXIS XXXX (plural)
  m = d.match(/(?:^|[\s,;(])TAXIS[\s_](\d+)/i)
  if (m) return { tipo: 'TAXI', registro: parseInt(m[1]), rest: d.replace(m[0], '').replace(/^[\s,]+/, '').trim() }

  // VIP_XXXX, VIP XXXX, VIP_ XXXX (con word boundary)
  m = d.match(/(?:^|[\s,;(])VIP[\s_]+(\d+)/i)
  if (m) return { tipo: 'VIP', registro: parseInt(m[1]), rest: d.replace(m[0], '').replace(/^[\s,]+/, '').trim() }

  // VIN_XXXX, VIN XXXX (con word boundary)
  m = d.match(/(?:^|[\s,;(])VIN[\s_](\d+)/i)
  if (m) return { tipo: 'VIN', registro: parseInt(m[1]), rest: d.replace(m[0], '').replace(/^[\s,]+/, '').trim() }

  // VIN_XXXX con alfanumérico (VIN_3476)
  m = d.match(/(?:^|[\s,;(])VIN[\s_]([A-Z0-9]+)/i)
  if (m) { const num = parseInt(m[1]); if (!isNaN(num)) return { tipo: 'VIN', registro: num, rest: d.replace(m[0], '').replace(/^[\s,]+/, '').trim() } }

  // T_XXXX (solo con guion bajo, al inicio o tras espacio)
  m = d.match(/(?:^|[\s,;(])T[_](\d+)/i)
  if (m) return { tipo: 'TAXI', registro: parseInt(m[1]), rest: d.replace(m[0], '').replace(/^[\s,]+/, '').trim() }

  // CXP XXXX (Cuenta por pagar de un propietario - extraer VIN si existe después)
  m = d.match(/(?:^|[\s,;(])CXP[\s_](\w+)/i)
  if (m) {
    // Buscar VIN dentro del resto
    const vinMatch = d.match(/(?:^|[\s,;(])VIN[\s_](\d+)/i)
    if (vinMatch) return { tipo: 'VIN', registro: parseInt(vinMatch[1]), rest: d.replace(vinMatch[0], '').replace(/^[\s,]+/, '').trim() }
  }

  return null
}

window.parsearFacturasTaxis = async () => {
  const fileInput = document.getElementById('ift-file')
  if (!fileInput.files.length) return

  const file = fileInput.files[0]
  const data = await file.arrayBuffer()
  const wb = XLSX.read(data, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false })
  console.log('[FACT-TAXIS] Total rows:', rows.length)
  console.log('[FACT-TAXIS] Row 0:', JSON.stringify(rows[0]))
  console.log('[FACT-TAXIS] Row 1:', JSON.stringify(rows[1]))
  if (rows.length > 14) console.log('[FACT-TAXIS] Row 14 (resumen):', JSON.stringify(rows[14]))

  // Auto-detect columns by scanning first 20 rows
  let colFecha = -1, colDesc = -1, colDebito = -1, colCredito = -1

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i]
    if (!row || colDesc >= 0) break
    for (let j = 0; j < row.length; j++) {
      const val = row[j]
      if (val == null || val === '') continue
      const str = val.toString().trim()
      // Find the description column (has T_ or VIP_ or TAXI or VIN prefix)
      if (colDesc < 0 && /(^|[\s,;(])(T[_]\d|VIP[\s_]\d|TAXI[\s_]\d|TAXIS[\s_]\d|VIN[\s_]\d)/i.test(str)) {
        colDesc = j
        // Fecha is the column before desc (if it exists and had a date)
        if (j > 0) colFecha = j - 1
        // Debito is column after desc
        colDebito = j + 1
        // Credito is 2 columns after desc
        colCredito = j + 2
        break
      }
    }
  }

  // Fallback if nothing detected
  if (colDesc < 0) {
    colFecha = 0; colDesc = 1; colDebito = 2; colCredito = 3
  }

  console.log(`[FACT-TAXIS] Detected columns: fecha=${colFecha}, desc=${colDesc}, debito=${colDebito}, credito=${colCredito}`)

  // Cargar tablas de referencia
  const { data: unidades } = await sb.from('unidades_taxis').select('registro, modalidad, propietario').eq('activo', true)
  const { data: vins } = await sb.from('vehiculos_vin').select('vin, propietario').eq('activo', true)
  const unidadesMap = new Map((unidades || []).map(u => [u.registro, u]))
  const vinsMap = new Map((vins || []).map(v => [v.vin.slice(-4), v]))  // últimos 4 del VIN

  const dias = []     // { fecha, lineas: [...], resumen: [...] }
  const alertas = []
  let currentFecha = null
  let currentLineas = []
  let currentResumen = []

  function flushDia() {
    if (currentFecha && (currentLineas.length || currentResumen.length)) {
      dias.push({ fecha: currentFecha, lineas: [...currentLineas], resumen: [...currentResumen] })
    }
    currentLineas = []
    currentResumen = []
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const colB = row[colFecha]                        // fecha
    const colC = (row[colDesc] || '').toString().trim()  // descripción
    const colD = parseFloat(String(row[colDebito] || '').replace(/,/g, '')) || 0       // monto débito
    const colE = parseFloat(String(row[colCredito] || '').replace(/,/g, '')) || 0      // monto crédito (resumen)

    if (!colC) continue

    // ¿Hay nueva fecha en colB?
    if (colB != null && colB !== '') {
      flushDia()
      if (colB instanceof Date) {
        currentFecha = colB.toISOString().split('T')[0]
      } else if (typeof colB === 'number') {
        // Excel serial date → JS Date (SheetJS sin cellDates)
        const d = new Date(Math.round((colB - 25569) * 86400 * 1000))
        currentFecha = d.toISOString().split('T')[0]
      } else if (typeof colB === 'string') {
        const bs = colB.trim()
        // yyyy-mm-dd or yyyy-mm-ddT...
        if (/^\d{4}-\d{2}-\d{2}/.test(bs)) {
          currentFecha = bs.substring(0, 10)
        }
        // DD/MM/YYYY
        else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(bs)) {
          const parts = bs.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
          if (parts) currentFecha = `${parts[3]}-${parts[2].padStart(2,'0')}-${parts[1].padStart(2,'0')}`
        }
        // D-MMM, DD-MMM, D-MMM-YYYY (e.g. "12-May", "4-Jun", "12-May-2026")
        else {
          const meses = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
                          ene:'01',feb:'02',mar:'03',abr:'04',may:'05',jun:'06',jul:'07',ago:'08',sep:'09',oct:'10',nov:'11',dic:'12' }
          const mMatch = bs.match(/^(\d{1,2})[- ]([A-Za-z]{3})(?:[- ](\d{4}))?/)
          if (mMatch) {
            const dd = mMatch[1].padStart(2, '0')
            const mm = meses[mMatch[2].toLowerCase()] || '01'
            const yyyy = mMatch[3] || new Date().getFullYear().toString()
            currentFecha = `${yyyy}-${mm}-${dd}`
          } else {
            const d = new Date(bs)
            if (!isNaN(d.getTime())) currentFecha = d.toISOString().split('T')[0]
          }
        }
      }
    }

    // Líneas de resumen (tienen monto en colE)
    if (colE > 0 && (colC === 'MANO DE OBRA' || colC.startsWith('FACTURAS DE'))) {
      currentResumen.push({ concepto: colC, monto: colE })
      continue
    }

    // Líneas de detalle (tienen monto en colD)
    if (colD > 0 && currentFecha) {
      const parsed = parseFactTaxisPrefix(colC)
      if (!parsed) {
        alertas.push({ fecha: currentFecha, desc: colC, msg: 'Sin prefijo — importada como gasto sin unidad' })
        // Importar como gasto genérico sin unidad asignada
        currentLineas.push({
          fecha: currentFecha,
          tipo_unidad: 'OTRO',
          registro: 0,
          propietario: '',
          centro_costo: 'TAXIS',
          descripcion: colC,
          es_mano_obra: /MANO DE OBRA/i.test(colC),
          monto: colD,
          estado: 'alerta'
        })
        continue
      }

      const esManoObra = /MANO DE OBRA/i.test(colC)
      let propietario = ''
      let centroCosto = 'TAXIS'
      let estado = 'ok'

      if (parsed.tipo === 'TAXI' || parsed.tipo === 'VIP') {
        const unidad = unidadesMap.get(parsed.registro)
        if (unidad) {
          propietario = unidad.propietario
        } else {
          estado = 'alerta'
          alertas.push({ fecha: currentFecha, desc: colC, msg: `Registro #${parsed.registro} no encontrado en unidades_taxis` })
        }
      } else if (parsed.tipo === 'VIN') {
        // Buscar en vehiculos_vin por últimos 4 dígitos
        const regStr = parsed.registro.toString()
        const vinMatch = vinsMap.get(regStr.padStart(4, '0')) || vinsMap.get(regStr)
        if (vinMatch) {
          propietario = vinMatch.propietario
        } else {
          // Intentar extraer nombre del texto (VIN 2109 AUTOLOTE SENSOR...)
          const restWords = parsed.rest.split(/\s+/)
          // El primer word podría ser el nombre del dueño si no es un repuesto común
          const posibleNombre = restWords[0] || ''
          if (posibleNombre && !/^(ACEITE|SENSOR|BOBINA|FILTRO|BOMBA|SOPORTE|BALINERA|BUJE|FRICCI)/i.test(posibleNombre)) {
            propietario = posibleNombre.toUpperCase()
          }
          estado = 'alerta'
          alertas.push({ fecha: currentFecha, desc: colC, msg: `VIN ${parsed.registro} no encontrado en vehiculos_vin (propietario inferido: ${propietario || '?'})` })
        }
      }

      currentLineas.push({
        fecha: currentFecha,
        tipo_unidad: parsed.tipo,
        registro: parsed.registro,
        propietario,
        centro_costo: centroCosto,
        descripcion: colC,
        es_mano_obra: esManoObra,
        monto: colD,
        estado
      })
    }
  }
  flushDia()

  factTaxisParsed = { dias, alertas }

  // Stats
  const totalLineas = dias.reduce((s, d) => s + d.lineas.length, 0)
  const totalMO = dias.reduce((s, d) => s + d.resumen.filter(r => r.concepto === 'MANO DE OBRA').reduce((s2, r) => s2 + r.monto, 0), 0)
  const totalFact = dias.reduce((s, d) => s + d.resumen.filter(r => r.concepto.startsWith('FACTURAS')).reduce((s2, r) => s2 + r.monto, 0), 0)

  document.getElementById('ift-stat-dias').textContent = dias.length
  document.getElementById('ift-stat-lineas').textContent = totalLineas
  document.getElementById('ift-stat-mo').textContent = 'L. ' + totalMO.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  document.getElementById('ift-stat-fact').textContent = 'L. ' + totalFact.toLocaleString('es-HN', { minimumFractionDigits: 2 })
  document.getElementById('ift-stat-alerts').textContent = alertas.length

  // Alertas
  const alertsEl = document.getElementById('ift-alerts')
  if (alertas.length) {
    alertsEl.innerHTML = `<div style="background:rgba(239,68,68,0.08);border:1px solid var(--red);border-radius:var(--radius);padding:12px;margin-bottom:12px">
      <div style="font-weight:600;color:var(--red);margin-bottom:8px">⚠️ ${alertas.length} alerta(s) encontradas</div>
      ${alertas.map(a => `<div style="font-size:12px;color:var(--text2);margin-bottom:4px">
        <span style="color:var(--text3)">${a.fecha}</span> · <b>${a.desc}</b> → ${a.msg}
      </div>`).join('')}
    </div>`
  } else {
    alertsEl.innerHTML = '<div style="background:rgba(16,185,129,0.08);border:1px solid var(--green);border-radius:var(--radius);padding:12px;color:var(--green);font-size:13px">✅ Todas las unidades fueron validadas correctamente</div>'
  }

  // Preview table
  const fmtL = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const tbody = document.getElementById('tbody-ift-preview')
  let html = ''
  dias.forEach(dia => {
    // Header del día
    html += `<tr style="background:var(--bg3)"><td colspan="7" style="padding:10px 14px;font-weight:600;color:var(--gold)">${dia.fecha} · ${dia.lineas.length} líneas</td></tr>`
    dia.lineas.forEach(l => {
      const color = l.estado === 'alerta' ? 'rgba(239,68,68,0.06)' : ''
      html += `<tr style="${color ? 'background:'+color : ''}">
        <td style="font-family:var(--mono);font-size:12px;color:var(--text3)">${l.fecha}</td>
        <td><span class="badge ${l.tipo_unidad === 'VIP' ? 'badge-blue' : l.tipo_unidad === 'VIN' ? 'badge-green' : l.tipo_unidad === 'OTRO' ? 'badge-off' : 'badge-amber'}">${l.tipo_unidad === 'OTRO' ? 'S/A' : l.tipo_unidad}</span></td>
        <td style="font-family:var(--mono);font-weight:600;color:var(--gold)">${l.registro}</td>
        <td style="font-size:12px">${l.propietario || '—'}</td>
        <td style="font-size:12px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.descripcion}">${l.es_mano_obra ? '🔧 ' : ''}${l.descripcion}</td>
        <td style="text-align:right;font-family:var(--mono);font-size:13px">L. ${fmtL(l.monto)}</td>
        <td>${l.estado === 'alerta' ? '<span class="badge badge-red">⚠️</span>' : '<span style="color:var(--green)">✓</span>'}</td>
      </tr>`
    })
    // Resumen del día
    dia.resumen.forEach(r => {
      html += `<tr style="background:var(--bg2);border-top:1px solid var(--border)">
        <td></td><td colspan="4" style="text-align:right;font-weight:500;font-size:13px">${r.concepto}</td>
        <td style="text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">L. ${fmtL(r.monto)}</td>
        <td></td>
      </tr>`
    })
  })
  tbody.innerHTML = html
  document.getElementById('ift-preview').classList.remove('hidden')
}

window.importarFacturasTaxis = async () => {
  if (!factTaxisParsed || !factTaxisParsed.dias.length) { toast('No hay datos para importar', 'error'); return }

  const btn = document.getElementById('btn-importar-ft')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importando...'

  const lote = new Date().toISOString().split('T')[0] + '_' + Date.now()
  const { dias } = factTaxisParsed
  let partidasCreadas = 0

  // Obtener cuentas del catálogo
  const getCuenta = (codigo) => (window.catalogoCuentas || []).find(c => c.codigo === codigo)
  const ctaCosto = getCuenta(FACT_TAXIS_CUENTAS.costo_mercaderia.codigo)
  const ctaMO = getCuenta(FACT_TAXIS_CUENTAS.mano_obra.codigo)
  const ctaFactTaxis = getCuenta(FACT_TAXIS_CUENTAS.factura_taxis.codigo)
  const ctaFactYonker = getCuenta(FACT_TAXIS_CUENTAS.factura_yonker.codigo)

  console.log('[FACT-TAXIS] Cuentas:', { ctaCosto: ctaCosto?.codigo, ctaMO: ctaMO?.codigo, ctaFactTaxis: ctaFactTaxis?.codigo, ctaFactYonker: ctaFactYonker?.codigo })
  console.log('[FACT-TAXIS] catalogoCuentas length:', (window.catalogoCuentas || []).length)

  if (!ctaCosto) { toast('Cuenta 510101-001 no encontrada en el catálogo', 'error'); btn.disabled = false; btn.textContent = 'Importar y generar partidas →'; return }

  // Obtener centro de costo TAXIS
  const centroTaxis = empresas.find(e => e.nombre.toUpperCase().includes('TAXI'))
  console.log('[FACT-TAXIS] Centro taxis:', centroTaxis?.id, centroTaxis?.nombre)
  console.log('[FACT-TAXIS] Días a procesar:', dias.length)

  for (const dia of dias) {
    console.log(`[FACT-TAXIS] Procesando día ${dia.fecha}: ${dia.lineas.length} líneas, ${dia.resumen.length} resumen`)
    if (!dia.lineas.length) { console.log('[FACT-TAXIS] Día sin líneas, saltando'); continue }

    // Obtener siguiente número de partida (atómico)
    const numPartida = await window.siguienteNumeroPartida()

    const totalDebitos = dia.lineas.reduce((s, l) => s + l.monto, 0)
    const totalMO = dia.resumen.filter(r => r.concepto === 'MANO DE OBRA').reduce((s, r) => s + r.monto, 0)
    const factTaxi = dia.resumen.filter(r => r.concepto === 'FACTURAS DE TAXIS').reduce((s, r) => s + r.monto, 0)
    const factYonker = dia.resumen.filter(r => r.concepto === 'FACTURAS DE YONKER').reduce((s, r) => s + r.monto, 0)

    // Crear partida
    const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
      numero_partida: numPartida,
      fecha_partida: dia.fecha,
      descripcion: `Facturas taxis ${dia.fecha} · ${dia.lineas.length} líneas · L. ${totalDebitos.toFixed(2)} [IMP-FACT-TAXIS]`,
      estado: 'borrador',
      tipo_origen: 'IMP-FACT-TAXIS',
      generada_por: currentProfile.id,
      centro_costo_id: centroTaxis?.id || null,
      total: Math.round(totalDebitos * 100) / 100
    }).select().single()

    if (pErr) { console.error('[FACT-TAXIS] Error creando partida:', pErr.message); continue }
    console.log(`[FACT-TAXIS] Partida #${numPartida} creada: ${partida.id}`)

    // Líneas de débito: VIN → Inventario (110501-001) con centro del propietario
    //                   TAXI/VIP → Costo mercadería (510101-001) con centro TAXIS
    const ctaInventario = getCuenta(FACT_TAXIS_CUENTAS.inventario.codigo)

    const lineasPartida = dia.lineas.map(l => {
      const esVIN = l.tipo_unidad === 'VIN'
      // Para VIN: buscar el centro de costo del propietario en todos los centros
      let ccId = centroTaxis?.id || null
      if (esVIN && l.propietario) {
        const allCC = window._todosLosCentros ? window._todosLosCentros() : empresas
        const ccProp = allCC.find(e => e.nombre.toUpperCase().includes(l.propietario.toUpperCase()))
          || allCC.find(e => l.propietario.toUpperCase().includes(e.nombre.toUpperCase()))
        if (ccProp) ccId = ccProp.id
      }
      return {
        partida_id: partida.id,
        tipo: 'debito',
        cuenta_id: esVIN ? (ctaInventario?.id || null) : (ctaCosto?.id || null),
        cuenta_codigo: esVIN ? FACT_TAXIS_CUENTAS.inventario.codigo : FACT_TAXIS_CUENTAS.costo_mercaderia.codigo,
        cuenta_nombre: esVIN ? FACT_TAXIS_CUENTAS.inventario.nombre : FACT_TAXIS_CUENTAS.costo_mercaderia.nombre,
        monto: l.monto,
        descripcion: l.descripcion,
        centro_costo_id: ccId,
        aplica_fiscal: true
      }
    })

    // Líneas de crédito (resumen)
    if (totalMO > 0) {
      lineasPartida.push({
        partida_id: partida.id,
        tipo: 'credito',
        cuenta_id: ctaMO?.id || null,
        cuenta_codigo: FACT_TAXIS_CUENTAS.mano_obra.codigo,
        cuenta_nombre: FACT_TAXIS_CUENTAS.mano_obra.nombre,
        monto: totalMO,
        descripcion: `Mano de obra taxis ${dia.fecha}`,
        centro_costo_id: centroTaxis?.id || null,
        aplica_fiscal: true
      })
    }

    if (factTaxi > 0) {
      lineasPartida.push({
        partida_id: partida.id,
        tipo: 'credito',
        cuenta_id: ctaFactTaxis?.id || null,
        cuenta_codigo: FACT_TAXIS_CUENTAS.factura_taxis.codigo,
        cuenta_nombre: FACT_TAXIS_CUENTAS.factura_taxis.nombre,
        monto: factTaxi,
        descripcion: `Facturas de taxis ${dia.fecha}`,
        centro_costo_id: centroTaxis?.id || null,
        aplica_fiscal: true
      })
    }

    if (factYonker > 0) {
      lineasPartida.push({
        partida_id: partida.id,
        tipo: 'credito',
        cuenta_id: ctaFactYonker?.id || null,
        cuenta_codigo: FACT_TAXIS_CUENTAS.factura_yonker.codigo,
        cuenta_nombre: FACT_TAXIS_CUENTAS.factura_yonker.nombre,
        monto: factYonker,
        descripcion: `Facturas de yonker ${dia.fecha}`,
        centro_costo_id: centroTaxis?.id || null,
        aplica_fiscal: true
      })
    }

    const { error: linErr } = await sb.from('lineas_partida').insert(lineasPartida)
    if (linErr) console.error('[FACT-TAXIS] Error insertando líneas:', linErr.message)
    else console.log(`[FACT-TAXIS] ${lineasPartida.length} líneas insertadas`)

    // Guardar detalle en facturas_taxis
    const detalleRows = dia.lineas.map(l => ({
      fecha: l.fecha,
      tipo_unidad: l.tipo_unidad,
      registro: l.registro,
      propietario: l.propietario,
      centro_costo: l.centro_costo,
      descripcion: l.descripcion,
      es_mano_obra: l.es_mano_obra,
      monto: l.monto,
      lote_importacion: lote,
      partida_id: partida.id
    }))
    await sb.from('facturas_taxis').insert(detalleRows)

    // Guardar resumen
    const resumenRows = dia.resumen.map(r => ({
      fecha: dia.fecha,
      concepto: r.concepto,
      monto: r.monto,
      lote_importacion: lote,
      partida_id: partida.id
    }))
    if (resumenRows.length) await sb.from('facturas_taxis_resumen').insert(resumenRows)

    partidasCreadas++
  }

  btn.disabled = false; btn.textContent = 'Importar y generar partidas →'
  toast(`${partidasCreadas} partida(s) creadas desde facturas taxis ✓`, 'success')
  factTaxisParsed = null
  document.getElementById('ift-file').value = ''
  document.getElementById('ift-preview').classList.add('hidden')
}

// ══════════════════════════════════════════════
// ═══  CAJA CHICA  ═══
// ══════════════════════════════════════════════

const CUENTA_CAJA_CHICA = '110101-001'
let filtroCCActual = 'pendiente_caja'
let allCCPartidas = []

window.loadCajaChica = async () => {
  const fechaFiltro = document.getElementById('cc-fecha')?.value || null

  // Get all partidas that touch caja chica
  const { data: lineas, error } = await sb.from('lineas_partida')
    .select('*, partida:partidas_contables(id, numero_partida, descripcion, fecha_partida, estado, numero_documento, created_at, generador:usuarios!generada_por(nombre), aprobador:usuarios!aprobada_por(nombre))')
    .eq('cuenta_codigo', CUENTA_CAJA_CHICA)

  if (error) { toast('Error: ' + error.message, 'error'); return }

  const movs = (lineas || []).filter(l => l.partida)

  // Cargar conteos de billetes de caja chica (para mostrar el detalle en la tarjeta)
  const ccPartidaIds = [...new Set(movs.map(l => l.partida.id))]
  if (ccPartidaIds.length) {
    const { data: ccConteos } = await sb.from('conteo_billetes')
      .select('*').in('partida_id', ccPartidaIds).eq('cuenta_codigo', CUENTA_CAJA_CHICA)
    if (ccConteos?.length) {
      for (const l of movs) l.billetes = ccConteos.filter(c => c.partida_id === l.partida.id)
    }
  }

  // Saldo total (solo aprobadas) + vienen (día anterior) + hoy
  const hoyCC = localDateStr()
  let saldoTotal = 0, ingresosTotal = 0, egresosTotal = 0, vienenCC = 0
  movs.filter(l => l.partida.estado === 'aprobada').forEach(l => {
    const m = parseFloat(l.monto) || 0
    const f = l.partida.fecha_partida
    if (l.tipo === 'debito') {
      saldoTotal += m
      if (f === hoyCC) ingresosTotal += m
      if (f < hoyCC) vienenCC += m
    } else {
      saldoTotal -= m
      if (f === hoyCC) egresosTotal += m
      if (f < hoyCC) vienenCC -= m
    }
  })

  const fmt = v => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  document.getElementById('cc-saldo').textContent = 'L. ' + fmt(saldoTotal)
  const vccEl = document.getElementById('cc-vienen'); if (vccEl) vccEl.textContent = 'L. ' + fmt(vienenCC)
  document.getElementById('cc-total-ingresos').textContent = 'L. ' + fmt(ingresosTotal)
  document.getElementById('cc-total-egresos').textContent = 'L. ' + fmt(egresosTotal)

  // Filter by date if set
  let filtered = movs
  if (fechaFiltro) {
    filtered = movs.filter(l => l.partida.fecha_partida === fechaFiltro)
    const ingF = filtered.filter(l => l.partida.estado === 'aprobada' && l.tipo === 'debito').reduce((s, l) => s + (parseFloat(l.monto) || 0), 0)
    const egrF = filtered.filter(l => l.partida.estado === 'aprobada' && l.tipo === 'credito').reduce((s, l) => s + (parseFloat(l.monto) || 0), 0)
    document.getElementById('cc-fecha-resumen').textContent = `Ingresos: L.${fmt(ingF)} | Egresos: L.${fmt(egrF)}`
  } else {
    document.getElementById('cc-fecha-resumen').textContent = ''
  }

  // Stats
  const pendientes = filtered.filter(l => l.partida.estado === 'pendiente_caja' || l.partida.estado === 'borrador').length
  const aprobadas = filtered.filter(l => l.partida.estado === 'aprobada').length
  const ingrF = filtered.filter(l => l.partida.estado === 'aprobada' && l.tipo === 'debito').reduce((s, l) => s + (parseFloat(l.monto) || 0), 0)
  const egrF = filtered.filter(l => l.partida.estado === 'aprobada' && l.tipo === 'credito').reduce((s, l) => s + (parseFloat(l.monto) || 0), 0)

  document.getElementById('cc-stat-pendientes').textContent = pendientes
  document.getElementById('cc-stat-aprobadas').textContent = aprobadas
  document.getElementById('cc-stat-ingresos').textContent = 'L. ' + fmt(ingrF)
  document.getElementById('cc-stat-egresos').textContent = 'L. ' + fmt(egrF)

  allCCPartidas = filtered
  renderCajaChicaList()
}

window.filtrarCajaChicaFecha = () => loadCajaChica()

window.filtroCajaChica = (btn, filtro) => {
  document.querySelectorAll('#view-caja-chica .caja-tab').forEach(t => t.classList.remove('active'))
  btn.classList.add('active')
  filtroCCActual = filtro
  renderCajaChicaList()
}

function renderCajaChicaList() {
  const container = document.getElementById('lista-caja-chica')
  let data = allCCPartidas
  if (filtroCCActual !== 'todos') {
    if (filtroCCActual === 'pendiente_caja') {
      data = data.filter(l => l.partida.estado === 'pendiente_caja' || l.partida.estado === 'borrador')
    } else {
      data = data.filter(l => l.partida.estado === filtroCCActual)
    }
  }
  // Más reciente primero (igual que Caja General)
  data = [...data].sort((a, b) => new Date(b.partida.created_at || 0) - new Date(a.partida.created_at || 0))

  if (!data.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No hay movimientos</div></div>'
    return
  }

  const esAuxContable = currentProfile?.rol === 'aux_contable'
  const esSuperAdmin = currentProfile?.rol === 'super_admin'
  const puedeAprobar = esAuxContable || esSuperAdmin

  container.innerHTML = data.map(l => {
    const p = l.partida
    const monto = parseFloat(l.monto) || 0
    const esIngreso = l.tipo === 'debito'
    const iconClass = esIngreso ? 'ingreso' : 'egreso'
    const icon = esIngreso ? '↓' : '↑'
    const signo = esIngreso ? '+' : '-'
    const estadoBadge = p.estado === 'aprobada' ? 'badge-green'
      : p.estado === 'anulada' ? 'badge-red' : 'badge-amber'
    const estadoLabel = p.estado === 'aprobada' ? 'Aprobada'
      : p.estado === 'borrador' ? 'Borrador'
      : p.estado === 'pendiente_caja' ? 'Pendiente'
      : p.estado === 'anulada' ? 'Anulada' : p.estado
    const fecha = p.created_at ? new Date(p.created_at).toLocaleDateString('es-HN') : (p.fecha_partida || '')
    const hora = p.created_at ? new Date(p.created_at).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' }) : ''

    const aprobadoInfo = p.estado === 'aprobada' && p.aprobador?.nombre
      ? `<span style="font-size:11px;color:var(--text3)">Aprobada por ${p.aprobador.nombre}</span>` : ''

    // Detalle de billetes si existe
    let billetesInfo = ''
    if (l.billetes?.length) {
      const denoms = [500,200,100,50,20,10,5,2,1]
      const detalles = l.billetes.map(b => {
        const partes = denoms.map(d => ({ d, q: b[`den_${d}`] || 0 })).filter(x => x.q > 0).map(x => `${x.q}×L.${x.d}`)
        return partes.length ? `<span style="color:${b.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)'}">${partes.join(' + ')}</span>` : ''
      }).filter(Boolean)
      if (detalles.length) billetesInfo = `<p style="margin-top:4px;font-size:11px">💵 ${detalles.join(' | ')}</p>`
    }

    const actions = (p.estado === 'pendiente_caja' || p.estado === 'borrador') && puedeAprobar ? `
      <div class="caja-actions">
        <button class="caja-btn aprobar" onclick="aprobarMovCajaChica('${p.id}')">✓ Aprobar</button>
      </div>` : ''

    return `
    <div class="caja-card ${p.estado}">
      <div class="caja-left">
        <div class="caja-icon ${iconClass}">${icon}</div>
        <div class="caja-info">
          <h4>Partida #${p.numero_partida || '—'} · ${p.descripcion || 'Sin descripción'}</h4>
          <p>${fecha}${hora ? ' ' + hora : ''} · ${p.generador?.nombre || 'Sistema'} · Doc: ${p.numero_documento || '—'}</p>
          ${billetesInfo}
          ${aprobadoInfo}
        </div>
      </div>
      <div class="caja-right">
        <div>
          <div class="caja-monto ${iconClass}">${signo} L. ${monto.toLocaleString('es-HN', { minimumFractionDigits: 2 })}</div>
          <div style="text-align:right;margin-top:4px"><span class="badge ${estadoBadge}">${estadoLabel}</span></div>
        </div>
        ${actions}
        <button class="btn btn-ghost" style="padding:6px 10px;font-size:13px;margin-top:6px" onclick="verPartida('${p.id}')" title="Ver partida">👁️</button>
      </div>
    </div>`
  }).join('')
}

// Aprobar movimiento de caja chica
window.aprobarMovCajaChica = async (partidaId) => {
  const rol = currentProfile?.rol
  if (rol !== 'aux_contable' && rol !== 'super_admin' && rol !== 'contador') {
    toast('Solo Aux. Contable o Super Admin pueden aprobar movimientos de caja chica', 'error')
    return
  }

  // Buscar la línea de caja chica para saber el monto y tipo
  const item = allCCPartidas.find(l => l.partida?.id === partidaId)
  if (!item) { toast('No se encontró el movimiento', 'error'); return }

  const monto = parseFloat(item.monto) || 0
  const esIngreso = item.tipo === 'debito'
  const desc = item.partida.descripcion || 'Sin descripción'
  const tipo = esIngreso ? 'recibís' : 'entregás'

  // Cargar conteo existente si lo hay
  let existingBilletes = null
  const { data: conteoExist } = await sb.from('conteo_billetes')
    .select('*')
    .eq('partida_id', partidaId)
    .limit(1)
  if (conteoExist?.length) {
    const c = conteoExist[0]
    existingBilletes = {
      500: c.den_500 || 0, 200: c.den_200 || 0, 100: c.den_100 || 0,
      50: c.den_50 || 0, 20: c.den_20 || 0, 10: c.den_10 || 0,
      5: c.den_5 || 0, 2: c.den_2 || 0, 1: c.den_1 || 0,
      _cheques: parseFloat(c.den_cheques) || 0
    }
  }

  openBilletes(
    `💵 Conteo · Caja Chica · ${esIngreso ? 'Ingreso' : 'Egreso'}`,
    `${desc} — Contá los billetes que ${tipo} (esperado: L. ${monto.toLocaleString('es-HN', {minimumFractionDigits:2})})`,
    async (montoContado, detalle) => {
      if (Math.abs(montoContado - monto) > 0.01) {
        const diff = montoContado - monto
        const ok = confirm(`⚠️ El conteo (L. ${montoContado.toLocaleString('es-HN',{minimumFractionDigits:2})}) no coincide con el esperado (L. ${monto.toLocaleString('es-HN',{minimumFractionDigits:2})}).\n\nDiferencia: L. ${diff.toLocaleString('es-HN',{minimumFractionDigits:2})}\n\n¿Aprobar de todas formas?`)
        if (!ok) return
      }

      // Guardar conteo de billetes
      const tipoConteo = esIngreso ? 'ingreso' : 'egreso'
      await sb.from('conteo_billetes').delete().eq('partida_id', partidaId)
      const conteoBilletes = {
        partida_id: partidaId,
        tipo: tipoConteo,
        cuenta_codigo: CUENTA_CAJA_CHICA,
        den_500: detalle[500] || 0, den_200: detalle[200] || 0, den_100: detalle[100] || 0,
        den_50: detalle[50] || 0, den_20: detalle[20] || 0, den_10: detalle[10] || 0,
        den_5: detalle[5] || 0, den_2: detalle[2] || 0, den_1: detalle[1] || 0,
        den_cheques: detalle._cheques || 0,
        total_billetes: DENOMINACIONES.reduce((s, d) => s + (detalle[d] || 0), 0),
        total_monto: montoContado,
        registrado_por: currentProfile.id,
      }
      const { error: conteoErr } = await sb.from('conteo_billetes').insert(conteoBilletes)
      if (conteoErr) {
        toast('⚠️ Error guardando conteo: ' + conteoErr.message, 'error')
        return
      }

      // Aprobar la partida
      const { error } = await sb.from('partidas_contables').update({
        estado: 'aprobada',
        aprobada_at: new Date().toISOString(),
        aprobada_por: currentProfile?.id
      }).eq('id', partidaId)
      if (error) { toast('Error: ' + error.message, 'error'); return }
      toast('Movimiento de Caja Chica aprobado ✓', 'success')
      logActividad('caja_chica_aprobada', 'caja_chica', `Partida aprobada`, partidaId)
      loadCajaChica()
    },
    existingBilletes
  )
}

// Arqueo de caja chica — solo billetes, sin USD ni cheques
window.verArqueoCajaChica = async () => {
  const denoms = [1, 2, 5, 10, 20, 50, 100, 200, 500]
  
  // Get all conteos for caja chica account (by cuenta_codigo or by partida that touches caja chica)
  const { data: conteosDirect } = await sb.from('conteo_billetes')
    .select('*, partida:partidas_contables(estado)')
    .eq('cuenta_codigo', CUENTA_CAJA_CHICA)

  // Also get conteos without cuenta_codigo — check if their partida has a caja chica line
  const { data: conteosNull } = await sb.from('conteo_billetes')
    .select('*, partida:partidas_contables(estado)')
    .is('cuenta_codigo', null)

  let conteosFromPartidas = []
  if (conteosNull?.length) {
    const partidaIds = [...new Set(conteosNull.map(c => c.partida_id).filter(Boolean))]
    if (partidaIds.length) {
      const { data: lineasCC } = await sb.from('lineas_partida')
        .select('partida_id')
        .eq('cuenta_codigo', CUENTA_CAJA_CHICA)
        .in('partida_id', partidaIds)
      const ccPartidaIds = new Set((lineasCC || []).map(l => l.partida_id))
      conteosFromPartidas = conteosNull.filter(c => ccPartidaIds.has(c.partida_id))
    }
  }

  const conteos = [...(conteosDirect || []), ...conteosFromPartidas]

  // Válido si: la partida está aprobada, O es un cambio de billetes sin partida
  // (partida_id null = cambio de denominaciones, que es un movimiento válido por sí mismo).
  const validConteos = (conteos || []).filter(c => c.partida?.estado === 'aprobada' || !c.partida_id)
  
  let totalIng = 0, totalEgr = 0, totalCaja = 0, totalValor = 0
  const tbody = document.getElementById('tbody-arqueo-cc')
  
  // Mapeo denominación → campo en conteo_billetes
  const denField = { 500:'den_500', 200:'den_200', 100:'den_100', 50:'den_50', 20:'den_20', 10:'den_10', 5:'den_5', 2:'den_2', 1:'den_1' }

  tbody.innerHTML = denoms.map(d => {
    const field = denField[d]
    const ingresos = validConteos.filter(c => c.tipo === 'ingreso').reduce((s, c) => s + (c[field] || 0), 0)
    const egresos = validConteos.filter(c => c.tipo === 'egreso').reduce((s, c) => s + (c[field] || 0), 0)
    const enCaja = ingresos - egresos
    const valor = enCaja * d
    totalIng += ingresos; totalEgr += egresos; totalCaja += enCaja; totalValor += valor
    const fmt = v => v.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return `<tr>
      <td style="padding:8px 12px;font-weight:500">L. ${d}</td>
      <td style="padding:8px 12px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--green)">${ingresos || '—'}</td>
      <td style="padding:8px 12px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--red)">${egresos || '—'}</td>
      <td style="padding:8px 12px;text-align:center;font-family:var(--mono);font-size:13px;font-weight:500">${enCaja}</td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--gold)">L. ${fmt(valor)}</td>
    </tr>`
  }).join('')

  const fmt = v => v.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  document.getElementById('arqcc-tot-ing').textContent = totalIng
  document.getElementById('arqcc-tot-egr').textContent = totalEgr
  document.getElementById('arqcc-tot-caja').textContent = totalCaja
  document.getElementById('arqcc-tot-valor').textContent = 'L. ' + fmt(totalValor)
  
  document.getElementById('modal-arqueo-cc').classList.add('open')
}

// Cambio de denominaciones caja chica — reutiliza el modal de caja general
window.cambioDenomsCajaChica = () => {
  openModalCambioDenoms('110101-001')
}

window.esCuentaCajaChica = (codigo) => codigo === CUENTA_CAJA_CHICA

// ══════════════════════════════════════════════
// ═══  CUENTAS POR PAGAR (CxP)  ═══
// ══════════════════════════════════════════════

let cxpMovimientos = []
let cxpFiltrados = []
let cxpSeleccionados = new Set() // persists across filter changes
let cxpMontos = {} // id → monto for persistent sum calculation
let cxpSeleccionActiva = null // {id, nombre, fecha_pago, notas} when editing a saved selection

// Restore selections from localStorage
function restaurarCxPSeleccion() {
  try {
    const saved = localStorage.getItem('cxp_seleccionados')
    if (saved) cxpSeleccionados = new Set(JSON.parse(saved))
    const montos = localStorage.getItem('cxp_montos')
    if (montos) cxpMontos = JSON.parse(montos)
  } catch(e) {}
}
function guardarCxPSeleccion() {
  try {
    localStorage.setItem('cxp_seleccionados', JSON.stringify([...cxpSeleccionados]))
    localStorage.setItem('cxp_montos', JSON.stringify(cxpMontos))
  } catch(e) {}
}

window.loadCxP = () => {
  cxpMovimientos = []
  restaurarCxPSeleccion()
  const now = new Date()
  document.getElementById('cxp-desde').value = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1))
  document.getElementById('cxp-hasta').value = localDateStr()
}

let cxpDDIndex = -1

window.buscarCuentasCxP = (val) => {
  cxpDDIndex = -1
  const list = document.getElementById('cxp-cuenta-list')
  list.classList.remove('hidden')
  const term = (val || '').toLowerCase().trim()
  const catalogo = window.catalogoCuentas || []
  const tieneHijas = (codigo) => catalogo.some(c => c.activa !== false && c.codigo.startsWith(codigo + '-'))
  const esGrupo = (c) => c.codigo.length === 6 && !c.codigo.includes('-') && tieneHijas(c.codigo)

  const matches = catalogo.filter(c => {
    if (!term || c.codigo.toLowerCase().includes(term) || c.nombre.toLowerCase().includes(term)) {
      if (c.codigo.includes('-')) return true
      if (esGrupo(c)) return true
    }
    return false
  }).slice(0, 30)

  if (!matches.length) { list.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:12px">No se encontraron cuentas</div>'; return }
  list.innerHTML = matches.map(c => {
    const isGrp = esGrupo(c)
    const hijasCount = isGrp ? catalogo.filter(h => h.codigo.startsWith(c.codigo + '-')).length : 0
    return `<div class="ac-item cxp-dd-opt" onmousedown="selCuentaCxP('${c.id}','${c.codigo}','${c.nombre.replace(/'/g,"&#39;")}',${isGrp})" style="${isGrp ? 'background:var(--bg3);font-weight:600' : ''}">
      <span style="font-family:var(--mono);font-size:11px;color:var(--gold);min-width:90px">${c.codigo}</span>
      <span style="font-size:12px">${c.nombre} ${isGrp ? `<span style="color:var(--text3);font-size:10px">(${hijasCount} subcuentas)</span>` : ''}</span>
    </div>`
  }).join('')

  // Auto-detect group from typed value
  const codigoTyped = term.split(' ')[0]
  const rangoDiv = document.getElementById('cxp-rango-sub')
  if (codigoTyped.length === 6 && !codigoTyped.includes('-')) {
    const grupo = matches.find(c => c.codigo.toLowerCase() === codigoTyped && esGrupo(c))
    if (grupo) {
      document.getElementById('cxp-cuenta-id').value = grupo.id
      document.getElementById('cxp-cuenta-es-grupo').value = grupo.codigo
      const hijas = catalogo.filter(c => c.codigo.startsWith(grupo.codigo + '-'))
      const sufijos = hijas.map(c => c.codigo.split('-').pop()).sort()
      document.getElementById('cxp-sub-desde').value = sufijos[0] || '001'
      document.getElementById('cxp-sub-hasta').value = sufijos[sufijos.length - 1] || '999'
      document.getElementById('cxp-rango-info').textContent = `${hijas.length} subcuentas (${sufijos[0] || '?'} a ${sufijos[sufijos.length - 1] || '?'})`
      rangoDiv.style.display = 'grid'
      return
    }
  }
  if (codigoTyped.includes('-') || codigoTyped.length < 6 || codigoTyped.length > 6) {
    rangoDiv.style.display = 'none'
    document.getElementById('cxp-cuenta-es-grupo').value = ''
  }
}

window.selCuentaCxP = (id, codigo, nombre, isGroup) => {
  document.getElementById('cxp-cuenta-buscar').value = `${codigo} ${nombre}`
  document.getElementById('cxp-cuenta-id').value = id
  document.getElementById('cxp-cuenta-list').classList.add('hidden')
  document.getElementById('cxp-cuenta-es-grupo').value = isGroup ? codigo : ''
  cxpDDIndex = -1

  const rangoDiv = document.getElementById('cxp-rango-sub')
  if (isGroup) {
    rangoDiv.style.display = 'grid'
    const catalogo = window.catalogoCuentas || []
    const hijas = catalogo.filter(c => c.codigo.startsWith(codigo + '-'))
    const sufijos = hijas.map(c => c.codigo.split('-').pop()).sort()
    document.getElementById('cxp-sub-desde').value = sufijos[0] || '001'
    document.getElementById('cxp-sub-hasta').value = sufijos[sufijos.length - 1] || '999'
    document.getElementById('cxp-rango-info').textContent = `${hijas.length} subcuentas (${sufijos[0] || '?'} a ${sufijos[sufijos.length - 1] || '?'})`
  } else {
    rangoDiv.style.display = 'none'
  }
}

window.navCxPCuentaDD = (e) => {
  const list = document.getElementById('cxp-cuenta-list')
  if (list.classList.contains('hidden')) return
  const opts = list.querySelectorAll('.cxp-dd-opt')
  if (!opts.length) return
  if (e.key === 'ArrowDown') { e.preventDefault(); cxpDDIndex = Math.min(cxpDDIndex + 1, opts.length - 1); opts.forEach((o, i) => o.style.background = i === cxpDDIndex ? 'var(--bg3)' : ''); opts[cxpDDIndex].scrollIntoView({ block: 'nearest' }) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cxpDDIndex = Math.max(cxpDDIndex - 1, 0); opts.forEach((o, i) => o.style.background = i === cxpDDIndex ? 'var(--bg3)' : ''); opts[cxpDDIndex].scrollIntoView({ block: 'nearest' }) }
  else if (e.key === 'Enter') { e.preventDefault(); if (cxpDDIndex >= 0 && opts[cxpDDIndex]) opts[cxpDDIndex].dispatchEvent(new Event('mousedown')) }
  else if (e.key === 'Escape') { list.classList.add('hidden'); cxpDDIndex = -1 }
  else { cxpDDIndex = -1 }
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('#cxp-cuenta-buscar') && !e.target.closest('#cxp-cuenta-list')) {
    document.getElementById('cxp-cuenta-list')?.classList.add('hidden')
  }
})

window.consultarCxP = async () => {
  const cuentaId = document.getElementById('cxp-cuenta-id').value
  const grupoCodigo = document.getElementById('cxp-cuenta-es-grupo').value
  const cuentaInput = document.getElementById('cxp-cuenta-buscar').value.trim()
  const codigoCuenta = cuentaInput.split(' ')[0]

  if (!cuentaId && !grupoCodigo) { toast('Seleccioná una cuenta contable', 'error'); return }

  // Determine which account codes to query
  let codigos = []
  if (grupoCodigo) {
    const subDesde = document.getElementById('cxp-sub-desde').value.trim()
    const subHasta = document.getElementById('cxp-sub-hasta').value.trim()
    const catalogo = window.catalogoCuentas || []
    codigos = catalogo
      .filter(c => c.codigo.startsWith(grupoCodigo + '-'))
      .filter(c => {
        const sufijo = c.codigo.split('-').pop()
        return (!subDesde || sufijo >= subDesde) && (!subHasta || sufijo <= subHasta)
      })
      .map(c => c.codigo)
    if (!codigos.length) { toast('No hay subcuentas en ese rango', 'error'); return }
  } else {
    codigos = [codigoCuenta]
  }

  const desde = document.getElementById('cxp-desde').value
  const hasta = document.getElementById('cxp-hasta').value
  const estadoFiltro = document.getElementById('cxp-estado-filtro').value

  const tbody = document.getElementById('tbody-cxp')
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>'

  // Query lineas_partida for these accounts
  let query = sb.from('lineas_partida')
    .select('id, monto, tipo, cuenta_codigo, cuenta_nombre, descripcion, pagado, partida:partidas_contables(id, numero_partida, fecha_partida, estado, descripcion)')
    .in('cuenta_codigo', codigos)
    .eq('tipo', 'credito')
    .order('id', { ascending: true })

  const { data, error } = await query
  if (error) { toast('Error: ' + error.message, 'error'); return }

  // Filter by date and estado
  cxpMovimientos = (data || []).filter(l => {
    if (!l.partida || l.partida.estado !== 'aprobada') return false
    if (desde && l.partida.fecha_partida < desde) return false
    if (hasta && l.partida.fecha_partida > hasta) return false
    if (estadoFiltro === 'pendiente' && l.pagado) return false
    if (estadoFiltro === 'pagado' && !l.pagado) return false
    return true
  })

  document.getElementById('cxp-filtro-rapido').classList.remove('hidden')
  restaurarCxPSeleccion()
  cxpFiltrados = [...cxpMovimientos]
  renderCxPTabla()
}

window.filtrarCxPTexto = () => {
  const term = (document.getElementById('cxp-filtro-texto').value || '').toLowerCase()
  if (!term) {
    cxpFiltrados = [...cxpMovimientos]
  } else {
    cxpFiltrados = cxpMovimientos.filter(l => {
      const desc = (l.partida?.descripcion || '').toLowerCase()
      const monto = String(l.monto)
      return desc.includes(term) || monto.includes(term) || (l.cuenta_codigo || '').includes(term)
    })
  }
  renderCxPTabla()
}

function renderCxPTabla() {
  const tbody = document.getElementById('tbody-cxp')
  const fmt = v => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (!cxpFiltrados.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text3)">No hay movimientos</td></tr>'
    document.getElementById('btn-generar-pago').style.display = 'none'
    return
  }

  tbody.innerHTML = cxpFiltrados.map(l => {
    const p = l.partida
    const isChecked = cxpSeleccionados.has(l.id)
    return `<tr style="${l.pagado ? 'opacity:0.5' : ''}">
      <td><input type="checkbox" class="cxp-check" data-id="${l.id}" data-monto="${l.monto}" onchange="toggleCxPCheck(this)" ${isChecked ? 'checked' : ''} ${l.pagado ? 'disabled' : ''}></td>
      <td>${p.fecha_partida}</td>
      <td style="color:var(--gold)">${p.numero_partida || '—'}</td>
      <td style="font-family:var(--mono);font-size:11px">${l.cuenta_codigo}</td>
      <td style="max-width:300px">${p.descripcion || l.descripcion || '—'}</td>
      <td style="text-align:right;font-family:var(--mono);font-weight:500">L. ${fmt(l.monto)}</td>
      <td>${l.pagado ? '<span class="badge badge-on">Pagado</span>' : '<span class="badge badge-amber">Pendiente</span>'}</td>
    </tr>`
  }).join('')

  updateSumaCxP()
}

window.toggleCxPCheck = (cb) => {
  const id = cb.dataset.id
  const monto = parseFloat(cb.dataset.monto) || 0
  if (cb.checked) {
    cxpSeleccionados.add(id)
    cxpMontos[id] = monto
  } else {
    cxpSeleccionados.delete(id)
    delete cxpMontos[id]
  }
  guardarCxPSeleccion()
  updateSumaCxP()
}

window.toggleAllCxP = (checked) => {
  document.querySelectorAll('.cxp-check:not(:disabled)').forEach(cb => {
    cb.checked = checked
    const id = cb.dataset.id
    const monto = parseFloat(cb.dataset.monto) || 0
    if (checked) {
      cxpSeleccionados.add(id)
      cxpMontos[id] = monto
    } else {
      cxpSeleccionados.delete(id)
      delete cxpMontos[id]
    }
  })
  guardarCxPSeleccion()
  updateSumaCxP()
}

window.limpiarSelCxP = () => {
  if (!confirm('¿Limpiar toda la selección?')) return
  cxpSeleccionados = new Set()
  cxpMontos = {}
  cxpSeleccionActiva = null
  guardarCxPSeleccion()
  document.querySelectorAll('.cxp-check').forEach(cb => cb.checked = false)
  updateSumaCxP()
}

window.updateSumaCxP = () => {
  let suma = 0
  let count = cxpSeleccionados.size
  // Try from loaded movimientos first, fallback to stored montos
  if (cxpMovimientos.length) {
    cxpMovimientos.forEach(l => {
      if (cxpSeleccionados.has(l.id)) {
        suma += parseFloat(l.monto) || 0
        cxpMontos[l.id] = parseFloat(l.monto) || 0
      }
    })
  } else {
    // Use stored montos when movimientos not loaded
    cxpSeleccionados.forEach(id => {
      suma += cxpMontos[id] || 0
    })
  }
  suma = Math.round(suma * 100) / 100
  const fmt = v => v.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  document.getElementById('cxp-suma-sel').innerHTML = `Seleccionados: L. ${fmt(suma)} (${count})${cxpSeleccionActiva ? ` · <span style="color:var(--blue);font-size:11px">📂 ${cxpSeleccionActiva.nombre}</span>` : ''}`
  document.getElementById('btn-generar-pago').style.display = count > 0 ? 'inline-flex' : 'none'
  const btnLimpiar = document.getElementById('btn-limpiar-sel-cxp')
  if (btnLimpiar) btnLimpiar.style.display = count > 0 ? 'inline-flex' : 'none'
  const btnGuardar = document.getElementById('btn-guardar-sel-cxp')
  if (btnGuardar) btnGuardar.style.display = count > 0 ? 'inline-flex' : 'none'
}

window.generarPagoCxP = async () => {
  if (!cxpSeleccionados.size) return
  const ids = Array.from(cxpSeleccionados)
  let suma = 0
  cxpMovimientos.filter(l => cxpSeleccionados.has(l.id)).forEach(l => { suma += parseFloat(l.monto) || 0 })
  suma = Math.round(suma * 100) / 100

  // Group selected amounts by cuenta_codigo
  const porCuenta = {}
  cxpMovimientos.filter(l => cxpSeleccionados.has(l.id)).forEach(l => {
    const k = l.cuenta_codigo
    if (!porCuenta[k]) porCuenta[k] = { codigo: k, nombre: l.cuenta_nombre, total: 0, items: [] }
    porCuenta[k].total = Math.round((porCuenta[k].total + (parseFloat(l.monto) || 0)) * 100) / 100
    porCuenta[k].items.push(l)
  })

  const fmt = v => v.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const cuentasDetalle = Object.values(porCuenta).map(c => `${c.codigo} ${c.nombre}: L.${fmt(c.total)}`).join('\n')

  if (!confirm(`¿Generar partida de pago en borrador?\n\nCuentas:\n${cuentasDetalle}\n\nTotal: L. ${fmt(suma)}\n\nSe creará una partida borrador con los débitos. Vos cargás la forma de pago (crédito).`)) return

  // Get next partida number (atómico)
  const nuevoNumero = await window.siguienteNumeroPartida()

  // Build description
  const cuentasStr = Object.values(porCuenta).map(c => c.codigo).join(', ')
  const descripcion = `PAGO CUENTAS POR PAGAR: ${cuentasStr} · ${ids.length} movimientos`

  // Create partida as borrador
  const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
    centro_costo_id: null,
    numero_partida: nuevoNumero,
    generada_por: currentProfile.id,
    fecha_partida: localDateStr(),
    estado: 'borrador',
    total: suma,
    descripcion,
    tipo_origen: 'otro'
  }).select('id').single()

  if (pErr) { toast('Error creando partida: ' + pErr.message, 'error'); return }

  // Insert debit lines (one per cuenta)
  const lineas = Object.values(porCuenta).map(c => ({
    partida_id: partida.id,
    cuenta_codigo: c.codigo,
    cuenta_nombre: c.nombre,
    tipo: 'debito',
    monto: c.total,
    descripcion: `Pago ${c.items.length} cargos`,
    aplica_fiscal: true
  }))

  // Add empty credit line placeholder
  lineas.push({
    partida_id: partida.id,
    cuenta_codigo: '',
    cuenta_nombre: '',
    tipo: 'credito',
    monto: suma,
    descripcion: 'FORMA DE PAGO (editar)',
    aplica_fiscal: true
  })

  const { error: lErr } = await sb.from('lineas_partida').insert(lineas)
  if (lErr) { toast('Error en líneas: ' + lErr.message, 'error'); return }

  // Mark selected items as pagado
  await sb.from('lineas_partida').update({ pagado: true, pagado_at: new Date().toISOString() }).in('id', ids)

  toast(`Partida #${nuevoNumero} creada como borrador · L. ${fmt(suma)}. Editala para agregar la forma de pago.`, 'success')
  cxpSeleccionados = new Set()
  cxpMontos = {}
  guardarCxPSeleccion()
  consultarCxP()
}

window.openGuardarSelCxP = () => {
  if (!cxpSeleccionados.size) return
  const fmt = v => v.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  let suma = 0
  cxpSeleccionados.forEach(id => { suma += cxpMontos[id] || 0 })
  // Pre-fill with active selection if editing
  document.getElementById('gs-nombre').value = cxpSeleccionActiva?.nombre || ''
  document.getElementById('gs-fecha-pago').value = cxpSeleccionActiva?.fecha_pago || ''
  document.getElementById('gs-notas').value = cxpSeleccionActiva?.notas || ''
  document.getElementById('gs-resumen').innerHTML = `<strong>${cxpSeleccionados.size}</strong> movimientos · <strong style="color:var(--gold)">L. ${fmt(suma)}</strong>${cxpSeleccionActiva ? ' · <span style="color:var(--blue)">Editando selección existente</span>' : ''}`
  document.getElementById('modal-guardar-sel-cxp').classList.add('open')
}

window.guardarSelCxP = async () => {
  const nombre = document.getElementById('gs-nombre').value.trim()
  const fechaPago = document.getElementById('gs-fecha-pago').value
  const notas = document.getElementById('gs-notas').value.trim()
  if (!nombre) { toast('Ingresá un nombre', 'error'); return }
  if (!fechaPago) { toast('Ingresá la fecha de pago', 'error'); return }

  let suma = 0
  cxpSeleccionados.forEach(id => { suma += cxpMontos[id] || 0 })

  const payload = {
    nombre,
    fecha_pago: fechaPago,
    notas,
    linea_ids: [...cxpSeleccionados],
    montos: cxpMontos,
    total: Math.round(suma * 100) / 100,
    cantidad: cxpSeleccionados.size,
    creado_por: window._currentProfile()?.nombre || '',
    estado: 'pendiente'
  }

  let error
  if (cxpSeleccionActiva?.id) {
    // Update existing
    const res = await getSb().from('cxp_selecciones').update(payload).eq('id', cxpSeleccionActiva.id)
    error = res.error
  } else {
    // Create new
    const res = await getSb().from('cxp_selecciones').insert(payload)
    error = res.error
  }

  if (error) { toast('Error: ' + error.message, 'error'); return }
  // Update active selection reference
  cxpSeleccionActiva = { ...(cxpSeleccionActiva || {}), id: cxpSeleccionActiva?.id, nombre, fecha_pago: fechaPago, notas }
  closeModal('modal-guardar-sel-cxp')
  const accion = cxpSeleccionActiva?.id ? 'actualizada' : 'guardada'
  toast(`Selección "${nombre}" ${accion} · Pago: ${fechaPago}`, 'success')
  logActividad(`cxp_seleccion_${accion}`, 'cxp', `${nombre} · L. ${Math.round(suma*100)/100} · Pago: ${fechaPago}`)
}

window.verSeleccionesCxP = async () => {
  const { data, error } = await getSb().from('cxp_selecciones')
    .select('*')
    .order('fecha_pago', { ascending: true })
  if (error) { toast(error.message, 'error'); return }
  const list = document.getElementById('selecciones-cxp-list')
  const fmt = v => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (!data?.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3)">No hay selecciones guardadas</div>'
  } else {
    const estadoBadge = { pendiente: 'badge-amber', pagado: 'badge-on', cancelado: 'badge-off' }
    list.innerHTML = data.map(s => {
      const fechaPago = new Date(s.fecha_pago + 'T12:00:00').toLocaleDateString('es-HN')
      const diasFaltan = Math.ceil((new Date(s.fecha_pago + 'T12:00:00') - new Date()) / (1000 * 60 * 60 * 24))
      const diasLabel = diasFaltan < 0 ? `<span style="color:var(--red)">${Math.abs(diasFaltan)}d vencido</span>` : diasFaltan === 0 ? '<span style="color:var(--red)">Hoy</span>' : `${diasFaltan}d`
      return `
      <div style="padding:14px;background:var(--bg3);border-radius:var(--radius);margin-bottom:10px;border-left:3px solid ${s.estado === 'pagado' ? 'var(--green)' : diasFaltan < 3 ? 'var(--red)' : 'var(--gold)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <div style="font-weight:600">${s.nombre}</div>
            <div style="font-size:11px;color:var(--text3)">${s.creado_por} · ${new Date(s.created_at).toLocaleDateString('es-HN')}</div>
          </div>
          <div style="text-align:right">
            <div style="font-family:var(--mono);font-weight:600;color:var(--gold)">L. ${fmt(s.total)}</div>
            <div style="font-size:11px">${s.cantidad} items</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:12px">
            📅 Pago: <strong>${fechaPago}</strong> · ${diasLabel}
            <span class="badge ${estadoBadge[s.estado] || 'badge-amber'}" style="font-size:10px;margin-left:6px">${s.estado}</span>
            ${s.notas ? `<span style="color:var(--text3);margin-left:8px">${s.notas}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px">
            ${s.estado === 'pendiente' ? `
              <button class="btn btn-ghost" onclick="cargarSelCxP('${s.id}')" style="font-size:11px;padding:4px 10px;color:var(--blue)">📥 Cargar</button>
              <button class="btn btn-ghost" onclick="eliminarSelCxP('${s.id}','${s.nombre.replace(/'/g, "\\'")}')" style="font-size:11px;padding:4px 10px;color:var(--red)">🗑️</button>
            ` : ''}
          </div>
        </div>
      </div>`
    }).join('')
  }
  // Encabezado de la sección de programados + historial de pagos realizados
  list.innerHTML = `<div style="font-weight:600;font-size:13px;margin:0 0 10px;color:var(--text2)">📋 Pagos programados (pendientes)</div>` + list.innerHTML
  await renderHistorialPagosCxP(list)
  document.getElementById('modal-selecciones-cxp').classList.add('open')
}

// ── Historial de pagos realizados (reconstruido agrupando líneas pagadas por pagado_at) ──
// Cada grupo de pagado_at = un pago. Muestra fecha, total y el desglose de facturas.
let _histPagosCxP = []
async function renderHistorialPagosCxP(list) {
  const fmt = v => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const { data, error } = await getSb().from('lineas_partida')
    .select('id, monto, cuenta_codigo, cuenta_nombre, descripcion, pagado_at, partida:partidas_contables(numero_partida, fecha_partida, descripcion, estado)')
    .eq('pagado', true)
    .order('pagado_at', { ascending: false })
    .limit(1000)

  let html = `<div style="font-weight:600;font-size:13px;margin:22px 0 10px;color:var(--text2);border-top:1px solid var(--bg3);padding-top:16px">💸 Pagos realizados</div>`

  if (error || !data || !data.length) {
    list.innerHTML += html + `<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px">${error ? 'Error: ' + error.message : 'Aún no hay pagos registrados'}</div>`
    return
  }

  const grupos = {}
  data.forEach(l => {
    if (!l.pagado_at) return
    const k = l.pagado_at
    if (!grupos[k]) grupos[k] = { pagado_at: k, total: 0, lineas: [] }
    grupos[k].total = Math.round((grupos[k].total + (parseFloat(l.monto) || 0)) * 100) / 100
    grupos[k].lineas.push(l)
  })
  _histPagosCxP = Object.values(grupos).sort((a, b) => (b.pagado_at || '').localeCompare(a.pagado_at || ''))

  html += _histPagosCxP.map((g, i) => {
    const f = new Date(g.pagado_at)
    const fecha = f.toLocaleDateString('es-HN')
    const hora = f.toLocaleString('es-HN', { hour: '2-digit', minute: '2-digit', hour12: true })
    const detalle = g.lineas.map(l => `
      <tr>
        <td style="font-size:11px;color:var(--gold)">${l.partida?.numero_partida || '—'}</td>
        <td style="font-family:var(--mono);font-size:11px">${l.cuenta_codigo}</td>
        <td style="font-size:12px;max-width:280px">${l.partida?.descripcion || l.descripcion || l.cuenta_nombre || '—'}</td>
        <td style="text-align:right;font-family:var(--mono);font-size:12px">L. ${fmt(l.monto)}</td>
      </tr>`).join('')
    return `
      <div style="background:var(--bg3);border-radius:var(--radius);margin-bottom:8px;border-left:3px solid var(--green)">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;cursor:pointer" onclick="window._togglePagoCxP(${i})">
          <div>
            <div style="font-weight:600">📅 ${fecha} <span style="font-size:11px;color:var(--text3)">· ${hora}</span></div>
            <div style="font-size:11px;color:var(--text3)">${g.lineas.length} factura(s) · clic para ver detalle</div>
          </div>
          <div style="font-family:var(--mono);font-weight:600;color:var(--green)">L. ${fmt(g.total)}</div>
        </div>
        <div id="pago-cxp-det-${i}" style="display:none;padding:0 14px 12px">
          <table style="width:100%"><thead><tr>
            <th style="font-size:10px;text-align:left">PARTIDA</th><th style="font-size:10px;text-align:left">CUENTA</th><th style="font-size:10px;text-align:left">FACTURA / DESCRIPCIÓN</th><th style="font-size:10px;text-align:right">MONTO</th>
          </tr></thead><tbody>${detalle}</tbody></table>
        </div>
      </div>`
  }).join('')

  if (data.length >= 1000) html += `<div style="font-size:11px;color:var(--text3);text-align:center;padding:6px">Mostrando los pagos más recientes</div>`
  list.innerHTML += html
}

window._togglePagoCxP = (i) => {
  const d = document.getElementById(`pago-cxp-det-${i}`)
  if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none'
}

window.cargarSelCxP = async (selId) => {
  const { data: sel } = await getSb().from('cxp_selecciones').select('*').eq('id', selId).single()
  if (!sel) { toast('Selección no encontrada', 'error'); return }
  cxpSeleccionados = new Set(sel.linea_ids || [])
  cxpMontos = sel.montos || {}
  cxpSeleccionActiva = { id: sel.id, nombre: sel.nombre, fecha_pago: sel.fecha_pago, notas: sel.notas || '' }
  guardarCxPSeleccion()
  closeModal('modal-selecciones-cxp')
  toast(`Selección "${sel.nombre}" cargada · ${sel.cantidad} items`, 'success')
  // Update checkboxes if table is visible
  document.querySelectorAll('.cxp-check').forEach(cb => {
    cb.checked = cxpSeleccionados.has(cb.dataset.id)
  })
  updateSumaCxP()
}

window.eliminarSelCxP = async (selId, nombre) => {
  if (!confirm(`¿Eliminar la selección "${nombre}"?`)) return
  await getSb().from('cxp_selecciones').delete().eq('id', selId)
  toast('Selección eliminada', 'success')
  verSeleccionesCxP()
}

// ══════════════════════════════════════════════
// ── ACTIVIDAD DE USUARIOS ──
// ══════════════════════════════════════════════

window.loadActividad = async () => {
  const hoy = new Date().toLocaleDateString('en-CA')  // YYYY-MM-DD en hora local
  const iniEl = document.getElementById('act-fecha-ini')
  const finEl = document.getElementById('act-fecha-fin')
  if (iniEl && !iniEl.value) iniEl.value = hoy
  if (finEl && !finEl.value) finEl.value = hoy

  // ── Inyectar el buscador por # de partida (una sola vez) ──
  let partidaEl = document.getElementById('act-partida')
  if (!partidaEl) {
    const userSel = document.getElementById('act-usuario')
    partidaEl = document.createElement('input')
    partidaEl.id = 'act-partida'
    partidaEl.type = 'text'
    partidaEl.placeholder = '# de partida'
    partidaEl.title = 'Buscar el historial completo de una partida específica'
    partidaEl.style.cssText = 'width:130px;margin-left:8px'
    if (userSel) partidaEl.className = userSel.className
    partidaEl.addEventListener('keydown', e => { if (e.key === 'Enter') loadActividad() })
    if (userSel && userSel.parentNode) userSel.parentNode.insertBefore(partidaEl, userSel.nextSibling)
  }
  const partidaNum = (partidaEl.value || '').trim().replace(/^#/, '')

  // ── Inyectar el filtro por módulo (una sola vez) ──
  let moduloEl = document.getElementById('act-modulo')
  if (!moduloEl) {
    const userSel = document.getElementById('act-usuario')
    moduloEl = document.createElement('select')
    moduloEl.id = 'act-modulo'
    moduloEl.title = 'Filtrar por módulo'
    moduloEl.style.cssText = 'margin-left:8px'
    if (userSel) moduloEl.className = userSel.className
    moduloEl.innerHTML = '<option value="">Todos los módulos</option>'
      + ['rrhh', 'partidas', 'compras', 'importar', 'auth', 'caja'].map(m => `<option value="${m}">${m.toUpperCase()}</option>`).join('')
    moduloEl.addEventListener('change', () => loadActividad())
    if (userSel && userSel.parentNode) userSel.parentNode.insertBefore(moduloEl, userSel.nextSibling)
  }
  const moduloFilter = moduloEl.value

  // ════════════════════════════════════════════════════════════════
  //  MODO 1 · Historial de UNA partida específica (por número)
  // ════════════════════════════════════════════════════════════════
  if (partidaNum) {
    // numero_partida puede repetirse (sin UNIQUE), así que traemos todas las que coincidan
    const { data: parts, error: ep } = await getSb().from('partidas_contables')
      .select('*')
      .eq('numero_partida', partidaNum)
    if (ep) { toast(ep.message, 'error'); return }
    if (!parts || !parts.length) {
      document.getElementById('act-stats').innerHTML = ''
      document.getElementById('act-tabla').innerHTML =
        `<div style="text-align:center;padding:40px;color:var(--text3)">No se encontró ninguna partida #${partidaNum}</div>`
      return
    }
    const ids = parts.map(p => String(p.id))
    const { data: logsP, error: el } = await getSb().from('actividad_log')
      .select('*')
      .in('referencia_id', ids)
      .order('created_at', { ascending: true })
      .limit(500)
    if (el) { toast(el.message, 'error'); return }
    await renderHistorialPartida(partidaNum, parts, logsP || [])
    return
  }

  // ════════════════════════════════════════════════════════════════
  //  MODO 2 · Actividad general por rango de fechas / usuario
  // ════════════════════════════════════════════════════════════════
  const desde = new Date(iniEl.value + 'T00:00:00').toISOString()
  const hasta = new Date(finEl.value + 'T23:59:59.999').toISOString()
  const userFilter = document.getElementById('act-usuario').value

  let logs
  try {
    logs = await _fetchAllPag(() => {
      let q = getSb().from('actividad_log')
        .select('*')
        .gte('created_at', desde)
        .lte('created_at', hasta)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })   // desempate para paginar sin perder ni duplicar filas
      if (userFilter) q = q.eq('usuario_nombre', userFilter)
      if (moduloFilter) q = q.eq('modulo', moduloFilter)
      return q
    })
  } catch (error) { toast(error.message, 'error'); return }

  // Populate user filter (solo sin filtro de usuario, para no colapsar la lista a uno solo)
  const userSelect = document.getElementById('act-usuario')
  if (!userFilter) {
    const usuarios = [...new Set(logs.map(l => l.usuario_nombre).filter(Boolean))].sort()
    userSelect.innerHTML = '<option value="">Todos</option>' + usuarios.map(u => `<option value="${u}">${u}</option>`).join('')
  }

  // Stats by user
  const byUser = {}
  logs.forEach(l => {
    const u = l.usuario_nombre || 'desconocido'
    if (!byUser[u]) byUser[u] = { nombre: u, rol: l.usuario_rol, total: 0, logins: 0, acciones: {} }
    if (l.accion === 'login') { byUser[u].logins++; return }   // los login NO suman a la actividad
    byUser[u].total++
    byUser[u].acciones[l.accion] = (byUser[u].acciones[l.accion] || 0) + 1
  })

  // Stats cards
  const statsHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
      ${Object.values(byUser).map(u => `
        <div class="stat-card" style="padding:14px">
          <div style="font-weight:600;margin-bottom:6px">${u.nombre} <span class="badge badge-blue" style="font-size:10px">${u.rol}</span></div>
          <div style="font-size:24px;font-weight:700;color:var(--gold)">${u.total}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">${Object.entries(u.acciones).map(([a, n]) => `${_accionLabels[a] || a}: ${n}`).join(' · ') || 'Sin actividad registrada'}${u.logins ? ` · <span style="opacity:.55">🔑 ${u.logins} login${u.logins > 1 ? 's' : ''} (no cuentan)</span>` : ''}</div>
        </div>
      `).join('')}
    </div>`
  document.getElementById('act-stats').innerHTML = statsHtml

  // Activity table (las tarjetas cuentan el TOTAL; la tabla muestra hasta 500 filas)
  const MAX_TABLA = 500
  const logsTabla = logs.slice(0, MAX_TABLA)
  const notaTabla = logs.length > MAX_TABLA
    ? `<div style="padding:8px 4px;font-size:12px;color:var(--text3)">Mostrando las ${MAX_TABLA} más recientes de <b>${logs.length}</b> en el período (los totales de arriba sí cuentan todo).</div>`
    : ''
  const tablaHtml = `${notaTabla}
    <table>
      <thead><tr>
        <th>Hora</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Módulo</th><th>Detalle</th>
      </tr></thead>
      <tbody>${logsTabla.map(l => {
        const hora = new Date(l.created_at).toLocaleString('es-HN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
        const fecha = new Date(l.created_at).toLocaleDateString('es-HN')
        return `<tr>
          <td style="font-family:var(--mono);font-size:11px;white-space:nowrap">${fecha} ${hora}</td>
          <td style="font-weight:500">${l.usuario_nombre || '—'}</td>
          <td><span class="badge badge-blue" style="font-size:10px">${l.usuario_rol || ''}</span></td>
          <td><span class="badge badge-amber" style="font-size:10px">${_accionLabels[l.accion] || l.accion}</span></td>
          <td style="font-size:12px;color:var(--text3)">${l.modulo || '—'}</td>
          <td style="font-size:12px;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.detalle || ''}">${l.detalle || '—'}</td>
        </tr>`
      }).join('')}</tbody>
    </table>`
  document.getElementById('act-tabla').innerHTML = logs.length ? tablaHtml : '<div style="text-align:center;padding:40px;color:var(--text3)">No hay actividad en este período</div>'
}

// Etiquetas de acciones (compartidas por ambos modos)
const _accionLabels = {
  login: '🔑 Login',
  partida_aprobada: '✅ Partida aprobada',
  partida_borrador: '📝 Borrador guardado',
  partida_anulada: '🚫 Partida anulada',
  partida_modificada: '🔄 Partida modificada',
  compra_registrada: '🛒 Compra registrada',
  factura_verificada: '🧾 Factura verificada',
  import_ventas_alpha: '📥 Import ventas',
  sync_credito_libro: '🔗 Sync crédito libro',
  recibo_generado: '🧾 Recibo generado',
  prestamo_creado: '🆕 Préstamo creado',
  prestamo_editado: '✏️ Préstamo editado',
  prestamo_baja: '⏹ Préstamo baja',
  caja_chica_aprobada: '💰 Caja chica aprobada',
  // ── RRHH ──
  permiso_creado: '🟢 Permiso creado',
  permiso_eliminado: '🔴 Permiso eliminado',
  empleado_creado: '🆕 Empleado creado',
  empleado_editado: '✏️ Empleado editado',
  empleado_activado: '🔵 Empleado reactivado',
  empleado_desactivado: '⚫ Empleado desactivado',
  planilla_aprobada: '✅ Planilla aprobada',
  planilla_reabierta: '↩️ Planilla reabierta',
  planilla_bono_generada: '🎁 Bono generado',
  bono_educativo_generado: '🎓 Bono educativo',
  prestamo_emp_creado: '🆕 Préstamo empleado',
  prestamo_liquidado: '✅ Préstamo liquidado',
  vacaciones_pago: '🏖️ Vacaciones pagadas',
  vacaciones_ajuste: '🔧 Ajuste vacaciones',
  asistencia_importada: '📥 Asistencia importada'
}

// ── Historial completo de una partida específica ──
async function renderHistorialPartida(num, parts, logs) {
  const fmtFechaHora = ts => {
    const f = new Date(ts).toLocaleDateString('es-HN')
    const h = new Date(ts).toLocaleString('es-HN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
    return `${f} ${h}`
  }

  // Resolver nombres de registrado_por (fallback para partidas sin log, p. ej. importadas)
  const userIds = [...new Set(parts.map(p => p.registrado_por).filter(Boolean))]
  const nombres = {}
  if (userIds.length) {
    const { data: us } = await getSb().from('usuarios').select('id, nombre').in('id', userIds)
    ;(us || []).forEach(u => { nombres[u.id] = u.nombre })
  }

  // Eventos clave a partir del log
  const creLog = logs.find(l => l.accion === 'partida_aprobada' || l.accion === 'partida_borrador')
  const mods = logs.filter(l => l.accion === 'partida_modificada')
  const anulLog = logs.find(l => l.accion === 'partida_anulada')

  // Tarjetas resumen por cada partida que coincida con el número
  const tarjetas = parts.map(p => {
    const creadorNombre = creLog?.usuario_nombre || nombres[p.registrado_por] || '—'
    const creadoFecha = creLog ? fmtFechaHora(creLog.created_at) : (p.created_at ? fmtFechaHora(p.created_at) : '—')
    const estadoBadge = p.estado === 'aprobada' ? 'badge-green' : (p.estado === 'anulada' ? 'badge-red' : 'badge-amber')
    return `
      <div class="stat-card" style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:700;font-size:16px">Partida #${p.numero_partida}</div>
          <span class="badge ${estadoBadge}" style="font-size:10px">${p.estado || '—'}</span>
        </div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:10px">${p.descripcion || ''} · ${p.fecha_partida || ''}</div>
        <div style="display:grid;gap:6px;font-size:13px">
          <div>👤 <b>Creada por:</b> ${creadorNombre}</div>
          <div>🕐 <b>Fecha de creación:</b> ${creadoFecha}</div>
          <div>🔄 <b>Modificaciones:</b> ${mods.length}${mods.length ? ` · última por ${mods[mods.length-1].usuario_nombre} (${fmtFechaHora(mods[mods.length-1].created_at)})` : ''}</div>
          ${anulLog ? `<div style="color:var(--red)">🚫 <b>Anulada por:</b> ${anulLog.usuario_nombre} (${fmtFechaHora(anulLog.created_at)})</div>` : ''}
        </div>
        ${!creLog ? `<div style="font-size:11px;color:var(--text3);margin-top:8px;font-style:italic">Sin registro de creación en el log (partida importada o anterior al registro de actividad). Se muestra el dato de "registrado_por".</div>` : ''}
      </div>`
  }).join('')

  document.getElementById('act-stats').innerHTML =
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">${tarjetas}</div>`

  // Línea de tiempo (cronológica)
  const filas = logs.map(l => `
    <tr>
      <td style="font-family:var(--mono);font-size:11px;white-space:nowrap">${fmtFechaHora(l.created_at)}</td>
      <td style="font-weight:500">${l.usuario_nombre || '—'}</td>
      <td><span class="badge badge-blue" style="font-size:10px">${l.usuario_rol || ''}</span></td>
      <td><span class="badge badge-amber" style="font-size:10px">${_accionLabels[l.accion] || l.accion}</span></td>
      <td style="font-size:12px;max-width:480px;white-space:normal">${l.detalle || '—'}</td>
    </tr>`).join('')

  document.getElementById('act-tabla').innerHTML = logs.length ? `
    <div style="font-weight:600;margin:10px 0 6px">Línea de tiempo de la Partida #${num}</div>
    <table>
      <thead><tr><th>Fecha / Hora</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Detalle del cambio</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>`
    : `<div style="text-align:center;padding:40px;color:var(--text3)">La partida #${num} existe pero no tiene eventos registrados en el log de actividad.</div>`
}