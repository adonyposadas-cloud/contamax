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
  ensureSumarDiasUI()  // inyecta botón "Sumar días" + modal (idempotente)
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
      <td style="text-align:right;font-weight:600;color:${saldo > 0 ? 'var(--green)' : saldo < 0 ? 'var(--red)' : 'var(--text3)'}">${fmtDias(saldo)}</td>
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

// ══════════════════════════════════════════════
// ── SUMAR DÍAS (ajuste de saldo · solo super_admin)
// ── Acredita días al saldo de uno o varios empleados.
// ── No genera partida: solo movimiento tipo 'ajuste' + saldo.
// ══════════════════════════════════════════════

let sumarDiasSel = new Set()

// Inyecta el botón en el header y el modal en el body (idempotente)
function ensureSumarDiasUI() {
  const header = document.querySelector('#view-vacaciones .page-header')
  if (header && !document.getElementById('btn-sumar-dias-vac')) {
    const pagarBtn = header.querySelector('button.btn-gold') || header.querySelector('button')
    const group = document.createElement('div')
    group.style.display = 'flex'
    group.style.gap = '8px'
    const sumarBtn = document.createElement('button')
    sumarBtn.id = 'btn-sumar-dias-vac'
    sumarBtn.className = 'btn btn-ghost'
    sumarBtn.textContent = '± Ajustar días'
    sumarBtn.onclick = () => window.openSumarDiasVac()
    if (pagarBtn) {
      header.insertBefore(group, pagarBtn)
      group.appendChild(sumarBtn)
      group.appendChild(pagarBtn)   // agrupa ambos botones a la derecha
    } else {
      header.appendChild(group)
      group.appendChild(sumarBtn)
    }
  }

  if (!document.getElementById('modal-sumar-dias-vac')) {
    const html = `
    <div class="modal-backdrop" id="modal-sumar-dias-vac">
      <div class="modal" style="width:520px">
        <div class="modal-title">± Ajustar días de vacaciones</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:12px">
          Positivo acredita días; negativo los descuenta (ej. vacaciones ya gozadas a cuenta del próximo año). No genera partida — solo afecta el saldo.
        </div>
        <div style="display:flex;gap:16px;margin-bottom:6px">
          <div class="fld" style="flex:0 0 140px">
            <label>Días (+/−)</label>
            <input type="number" id="sumardias-dias" step="0.5" placeholder="+/- días">
          </div>
          <div class="fld" style="flex:1">
            <label>Descripción / motivo</label>
            <input type="text" id="sumardias-motivo" placeholder="Ej: Día compensatorio — feriado trabajado 01/06/2026">
          </div>
        </div>
        <div class="fld">
          <label>Empleados</label>
          <input type="text" id="sumardias-buscar" placeholder="Buscar empleado..." oninput="renderSumarDiasLista()">
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0 6px">
          <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;text-transform:none;font-size:12px">
            <input type="checkbox" id="sumardias-all" style="width:auto;margin:0" onchange="toggleAllSumarDias()"> Seleccionar todos
          </label>
          <span id="sumardias-count" style="font-size:12px;color:var(--text3)">0 seleccionados</span>
        </div>
        <div id="sumardias-lista" style="max-height:280px;overflow-y:auto;border:1px solid var(--bg1);border-radius:6px;padding:4px"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeModal('modal-sumar-dias-vac')">Cancelar</button>
          <button class="btn btn-gold" id="btn-aplicar-sumardias" onclick="aplicarSumarDias()">Aplicar</button>
        </div>
      </div>
    </div>`
    const wrap = document.createElement('div')
    wrap.innerHTML = html.trim()
    document.body.appendChild(wrap.firstElementChild)
  }
}

window.openSumarDiasVac = () => {
  sumarDiasSel = new Set()
  const d = document.getElementById('sumardias-dias'); if (d) d.value = ''
  const m = document.getElementById('sumardias-motivo'); if (m) m.value = ''
  const b = document.getElementById('sumardias-buscar'); if (b) b.value = ''
  const a = document.getElementById('sumardias-all'); if (a) a.checked = false
  renderSumarDiasLista()
  document.getElementById('modal-sumar-dias-vac').classList.add('open')
}

window.renderSumarDiasLista = () => {
  const q = (document.getElementById('sumardias-buscar')?.value || '').trim().toUpperCase()
  const cont = document.getElementById('sumardias-lista')
  if (!cont) return
  const filtrados = vacEmpleados.filter(e => !q || (e.nombre || '').toUpperCase().includes(q))
  cont.innerHTML = filtrados.map(e => {
    const saldo = parseFloat(e.vacaciones_saldo_dias) || 0
    const checked = sumarDiasSel.has(e.id) ? 'checked' : ''
    return `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer">
      <input type="checkbox" value="${e.id}" ${checked} style="width:auto;margin:0" onchange="onSumarDiasCheck('${e.id}', this.checked)">
      <span style="flex:1">${e.nombre}</span>
      <span style="font-size:11px;padding:2px 8px;background:var(--bg1);border-radius:4px">${e.seccion || ''}</span>
      <span style="font-size:11px;color:${saldo > 0 ? 'var(--green)' : saldo < 0 ? 'var(--red)' : 'var(--text3)'};min-width:64px;text-align:right">${fmtDias(saldo)} días</span>
    </label>`
  }).join('') || '<div style="text-align:center;padding:16px;color:var(--text3)">Sin coincidencias</div>'
  updateSumarDiasCount()
}

window.onSumarDiasCheck = (id, checked) => {
  if (checked) sumarDiasSel.add(id); else sumarDiasSel.delete(id)
  updateSumarDiasCount()
}

function updateSumarDiasCount() {
  const c = document.getElementById('sumardias-count')
  if (c) c.textContent = sumarDiasSel.size + ' seleccionado' + (sumarDiasSel.size === 1 ? '' : 's')
}

window.toggleAllSumarDias = () => {
  const all = document.getElementById('sumardias-all')?.checked
  const q = (document.getElementById('sumardias-buscar')?.value || '').trim().toUpperCase()
  const visibles = vacEmpleados.filter(e => !q || (e.nombre || '').toUpperCase().includes(q))
  for (const e of visibles) { if (all) sumarDiasSel.add(e.id); else sumarDiasSel.delete(e.id) }
  renderSumarDiasLista()
}

window.aplicarSumarDias = async () => {
  const dias = parseFloat(document.getElementById('sumardias-dias').value) || 0
  if (!dias) { window.toast?.('Ingresá los días: positivo acredita, negativo descuenta (ej. vacaciones ya gozadas)', 'error'); return }
  const motivo = document.getElementById('sumardias-motivo').value.trim()
  if (!motivo) { window.toast?.('Escribí la descripción / motivo', 'error'); return }
  const seleccionados = vacEmpleados.filter(e => sumarDiasSel.has(e.id))
  if (seleccionados.length === 0) { window.toast?.('Seleccioná al menos un empleado', 'error'); return }

  if (!confirm(`Vas a ${dias > 0 ? 'SUMAR' : 'RESTAR'} ${fmtDias(Math.abs(dias))} día(s) a ${seleccionados.length} empleado(s).\nMotivo: ${motivo}\n\n¿Continuar?`)) return

  const sb = getSb()
  const hoy = new Date().toLocaleDateString('en-CA')  // YYYY-MM-DD local (evita off-by-one)
  const btn = document.getElementById('btn-aplicar-sumardias')
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando...' }

  try {
    // 1) Insertar un movimiento 'ajuste' por empleado (sin partida)
    const movimientos = seleccionados.map(emp => {
      const saldo = parseFloat(emp.vacaciones_saldo_dias) || 0
      const resultante = Math.round((saldo + dias) * 100) / 100
      return {
        empleado_id: emp.id, empleado_nombre: emp.nombre, fecha: hoy,
        tipo: 'ajuste', dias: dias, monto: 0,  // con signo: + acredita, − descuenta
        saldo_resultante: resultante, referencia: null,
        motivo, partida_numero: null,
        created_by: window._currentProfile?.()?.nombre || null
      }
    })
    const { error: mErr } = await sb.from('vacaciones_movimientos').insert(movimientos)
    if (mErr) { window.toast?.('Error registrando movimientos: ' + mErr.message, 'error'); throw new Error('mov') }

    // 2) Actualizar el saldo de cada empleado
    let ok = 0
    for (const emp of seleccionados) {
      const saldo = parseFloat(emp.vacaciones_saldo_dias) || 0
      const resultante = Math.round((saldo + dias) * 100) / 100
      const { error: uErr } = await sb.from('empleados').update({ vacaciones_saldo_dias: resultante }).eq('id', emp.id)
      if (uErr) { window.toast?.(`Error actualizando saldo de ${emp.nombre}: ${uErr.message}`, 'error') }
      else ok++
    }

    window.logActividad?.('vacaciones_ajuste', 'rrhh', `${dias > 0 ? '+' : ''}${fmtDias(dias)} días a ${ok} empleado(s) · ${motivo}`)
    window.toast?.(`Ajuste de ${dias > 0 ? '+' : ''}${fmtDias(dias)} día(s) aplicado a ${ok} empleado(s)`, 'success')
    window.closeModal('modal-sumar-dias-vac')
    await window.loadVacaciones()
  } catch (e) {
    console.error('aplicarSumarDias:', e)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Aplicar' }
  }
}

})(); // end IIFE