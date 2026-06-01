// ══════════════════════════════════════════════
// ── MÓDULO VACACIONES · js/vacaciones.js
// ── Saldo de días por empleado + pago en efectivo (egreso Caja General)
// ══════════════════════════════════════════════
;(function () {
"use strict";

const getSb = () => window._sb
const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDias = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

const CAJA_GENERAL = '110102-001'  // Caja General MN (crédito)
let vacEmpleados = []

// Cuenta de gasto de vacaciones según la sección del empleado (GO/GV/GA)
function cuentaVacGasto(seccion) {
  const p = (seccion || '').trim().toUpperCase().split(/\s+/)[0]
  if (p === 'GV') return '610102-005'
  if (p === 'GA') return '610103-005'
  return '610101-005' // GO (default)
}

// ── Cargar lista de empleados con su saldo ──
window.loadVacaciones = async () => {
  const { data } = await getSb().from('empleados')
    .select('id, nombre, seccion, sueldo_mensual, vacaciones_saldo_dias, es_socio')
    .eq('activo', true).order('nombre')
  vacEmpleados = data || []
  renderVacaciones()
}

function renderVacaciones() {
  const totalDias = vacEmpleados.reduce((s, e) => s + (parseFloat(e.vacaciones_saldo_dias) || 0), 0)
  const conSaldo = vacEmpleados.filter(e => (parseFloat(e.vacaciones_saldo_dias) || 0) > 0).length
  const sEmp = document.getElementById('stat-vac-empleados'); if (sEmp) sEmp.textContent = conSaldo
  const sDia = document.getElementById('stat-vac-dias'); if (sDia) sDia.textContent = fmtDias(totalDias)

  const tbody = document.getElementById('tbody-vacaciones')
  if (!tbody) return
  tbody.innerHTML = vacEmpleados.map(e => {
    const saldo = parseFloat(e.vacaciones_saldo_dias) || 0
    return `<tr>
      <td>${e.nombre}</td>
      <td><span style="font-size:11px;padding:2px 8px;background:var(--bg1);border-radius:4px">${e.seccion || ''}</span></td>
      <td style="text-align:right">${fmt(e.sueldo_mensual)}</td>
      <td style="text-align:right;font-weight:600;color:${saldo > 0 ? 'var(--green)' : 'var(--text3)'}">${fmtDias(saldo)}</td>
      <td style="text-align:right"><button class="btn btn-ghost" style="padding:2px 10px;font-size:11px" onclick="openPagoVacaciones('${e.id}')">💵 Pagar</button></td>
    </tr>`
  }).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text3)">Sin empleados</td></tr>'
}

// ── Abrir modal de pago ──
window.openPagoVacaciones = (empleadoId = '') => {
  const sel = document.getElementById('pagovac-empleado')
  sel.innerHTML = '<option value="">— Seleccionar empleado —</option>'
  for (const e of vacEmpleados) {
    const o = document.createElement('option')
    o.value = e.id
    o.textContent = e.nombre
    o.dataset.saldo = e.vacaciones_saldo_dias || 0
    o.dataset.sueldo = e.sueldo_mensual || 0
    sel.appendChild(o)
  }
  sel.value = empleadoId || ''
  document.getElementById('pagovac-dias').value = ''
  document.getElementById('pagovac-referencia').value = ''
  document.getElementById('pagovac-motivo').value = ''
  window.recalcPagoVac()
  document.getElementById('modal-pago-vacaciones').classList.add('open')
}

// ── Recalcular saldo/monto/resultante en vivo ──
window.recalcPagoVac = () => {
  const sel = document.getElementById('pagovac-empleado')
  const opt = sel.options[sel.selectedIndex]
  const saldo = opt ? (parseFloat(opt.dataset.saldo) || 0) : 0
  const sueldo = opt ? (parseFloat(opt.dataset.sueldo) || 0) : 0
  const dias = parseFloat(document.getElementById('pagovac-dias').value) || 0
  const monto = Math.round(dias * (sueldo / 30) * 100) / 100
  const resultante = Math.round((saldo - dias) * 100) / 100
  document.getElementById('pagovac-saldo').textContent = fmtDias(saldo) + ' días'
  document.getElementById('pagovac-monto').textContent = 'L. ' + fmt(monto)
  const rEl = document.getElementById('pagovac-resultante')
  rEl.textContent = fmtDias(resultante) + ' días'
  rEl.style.color = resultante < 0 ? 'var(--red)' : 'var(--text)'
}

// ── Aplicar pago: partida + movimiento + saldo ──
window.aplicarPagoVacaciones = async () => {
  const sel = document.getElementById('pagovac-empleado')
  const empId = sel.value
  if (!empId) { window.toast?.('Seleccioná un empleado', 'error'); return }
  const emp = vacEmpleados.find(e => e.id === empId)
  if (!emp) { window.toast?.('Empleado no encontrado', 'error'); return }

  const dias = parseFloat(document.getElementById('pagovac-dias').value) || 0
  if (dias <= 0) { window.toast?.('Ingresá los días a pagar', 'error'); return }

  const saldo = parseFloat(emp.vacaciones_saldo_dias) || 0
  if (dias > saldo) {
    if (!confirm(`El saldo disponible es ${fmtDias(saldo)} días y vas a pagar ${fmtDias(dias)}. ¿Continuar de todos modos?`)) return
  }

  const referencia = document.getElementById('pagovac-referencia').value.trim()
  const motivo = document.getElementById('pagovac-motivo').value.trim()
  const monto = Math.round(dias * ((emp.sueldo_mensual || 0) / 30) * 100) / 100
  const resultante = Math.round((saldo - dias) * 100) / 100
  const hoy = new Date().toLocaleDateString('en-CA')  // YYYY-MM-DD local (evita off-by-one)

  const sb = getSb()
  const btn = document.getElementById('btn-aplicar-pagovac')
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando...' }

  try {
    // 1) Partida (borrador): Débito gasto vacaciones / Crédito Caja General
    const { data: cg } = await sb.from('catalogo_cuentas').select('id, codigo, nombre').eq('codigo', cuentaVacGasto(emp.seccion)).single()
    const { data: cc } = await sb.from('catalogo_cuentas').select('id, codigo, nombre').eq('codigo', CAJA_GENERAL).single()
    if (!cg || !cc) { window.toast?.('No se encontraron las cuentas contables (gasto o caja)', 'error'); throw new Error('cuentas') }

    const numPartida = await window.siguienteNumeroPartida()
    const desc = `PAGO VACACIONES ${emp.nombre} - ${fmtDias(dias)} DIA(S)${referencia ? ' REF ' + referencia : ''}`.toUpperCase()

    const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
      centro_costo_id: null,
      fecha_partida: hoy, numero_partida: numPartida, descripcion: desc,
      tipo_origen: 'otro', estado: 'borrador', total: monto,
      generada_por: window._currentProfile?.()?.id || null
    }).select().single()
    if (pErr || !partida) { window.toast?.('Error creando partida: ' + (pErr?.message || ''), 'error'); throw new Error('partida') }

    const { error: lErr } = await sb.from('lineas_partida').insert([
      { partida_id: partida.id, cuenta_id: cg.id, cuenta_codigo: cg.codigo, cuenta_nombre: cg.nombre, tipo: 'debito',  monto, descripcion: desc, aplica_fiscal: false },
      { partida_id: partida.id, cuenta_id: cc.id, cuenta_codigo: cc.codigo, cuenta_nombre: cc.nombre, tipo: 'credito', monto, descripcion: desc, aplica_fiscal: false }
    ])
    if (lErr) { window.toast?.('Error en líneas de partida: ' + lErr.message, 'error'); throw new Error('lineas') }

    // 2) Movimiento de vacaciones (resta saldo)
    await sb.from('vacaciones_movimientos').insert({
      empleado_id: emp.id, empleado_nombre: emp.nombre, fecha: hoy,
      tipo: 'pago_efectivo', dias: -Math.abs(dias), monto,
      saldo_resultante: resultante, referencia: referencia || null,
      motivo: motivo || 'Pago de vacaciones en efectivo', partida_numero: numPartida,
      created_by: window._currentProfile?.()?.nombre || null
    })

    // 3) Actualizar saldo del empleado
    await sb.from('empleados').update({ vacaciones_saldo_dias: resultante }).eq('id', emp.id)

    window.logActividad?.('vacaciones_pago', 'rrhh', `${emp.nombre} · ${fmtDias(dias)} días · L.${fmt(monto)} · Partida #${numPartida}`)
    window.toast?.(`Pago registrado · Partida #${numPartida} (borrador) · saldo: ${fmtDias(resultante)} días`, 'success')
    window.closeModal('modal-pago-vacaciones')
    await window.loadVacaciones()
  } catch (e) {
    console.error('aplicarPagoVacaciones:', e)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Aplicar y generar partida' }
  }
}

})(); // end IIFE