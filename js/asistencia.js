// ══════════════════════════════════════════════
// ── MÓDULO ASISTENCIA · js/asistencia.js
// ── Importación de reloj marcador, cálculo de HE, tardes, permisos
// ══════════════════════════════════════════════
;(function(){
"use strict";

const getSb = () => window._sb
const fmt = (v) => (v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let asistenciaData = []   // processed attendance per employee per day
let asistenciaResumen = [] // summary per employee for the period
let configPlanilla = {}    // editable config values
let permisosCache = []

// ── LOAD CONFIG ──
async function loadConfig() {
  const { data } = await getSb().from('config_planilla').select('*')
  if (data) {
    for (const c of data) configPlanilla[c.clave] = parseFloat(c.valor)
  }
  window._configPlanilla = configPlanilla
}

// ── PARSE TIME CLOCK XLS ──

// ── PARSE TIME CLOCK - MULTIPLE FORMATS ──
function parseDateTimeStr(str) {
  if (!str) return null
  const s = String(str).trim()
  // Format A: "04/05/2026 07:45 a. m."
  const sA = s.replace(/a\.\s*m\./i, 'AM').replace(/p\.\s*m\./i, 'PM').replace(/\s+/g, ' ')
  const mA = sA.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (mA) {
    let [, dd, mm, yyyy, hh, min, ampm] = mA
    hh = parseInt(hh)
    if (ampm.toUpperCase() === 'PM' && hh < 12) hh += 12
    if (ampm.toUpperCase() === 'AM' && hh === 12) hh = 0
    return buildResult(yyyy, mm, dd, hh, parseInt(min))
  }
  // Format B: "16/5/2026 07:14:19" (24h)
  const mB = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/)
  if (mB) {
    return buildResult(mB[3], mB[2], mB[1], parseInt(mB[4]), parseInt(mB[5]))
  }
  // Format C: ISO
  const mC = s.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})/)
  if (mC) {
    return buildResult(mC[1], mC[2], mC[3], parseInt(mC[4]), parseInt(mC[5]))
  }
  return null
}

function buildResult(yyyy, mm, dd, hh, min) {
  const y = parseInt(yyyy), m = parseInt(mm) - 1, d = parseInt(dd)
  return {
    date: `${yyyy}-${String(parseInt(mm)).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    time: `${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    hours: hh, minutes: min,
    totalMinutes: hh * 60 + min,
    weekday: new Date(y, m, d).getDay(),
    day: d
  }
}

function detectFormat(rows) {
  if (rows[0]?.length >= 5) {
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const val = String(rows[i]?.[4] || '').toLowerCase()
      if (val.includes('estado') || val.includes('entrada') || val.includes('salida')) return 'RELOJ_ESTADO'
    }
  }
  return 'RELOJ_SIMPLE'
}

function processTimeClock(rows, quincena) {
  const format = detectFormat(rows)
  const empDays = {}
  const dataRows = rows.slice(1).filter(r => r && (r[0] || r[2]))

  for (const row of dataRows) {
    let name, horaStr, isEntrada, isSalida
    if (format === 'RELOJ_ESTADO') {
      name = (row[2] || '').toString().trim().toUpperCase()
      horaStr = (row[3] || '').toString().trim()
      const estado = (row[4] || '').toString()
      isEntrada = estado.includes('Entrada')
      isSalida = estado.includes('Salida')
    } else {
      name = (row[0] || '').toString().trim().toUpperCase()
      horaStr = (row[2] || '').toString().trim()
    }
    if (!name || !horaStr) continue
    const parsed = parseDateTimeStr(horaStr)
    if (!parsed) continue
    // Filter by quincena
    if (quincena === 'Q1' && parsed.day > 15) continue
    if (quincena === 'Q2' && parsed.day <= 15) continue
    // Simple format: determine by time
    if (format === 'RELOJ_SIMPLE') {
      isEntrada = parsed.totalMinutes < 720
      isSalida = parsed.totalMinutes >= 720
    }
    const key = `${name}|${parsed.date}`
    if (!empDays[key]) {
      empDays[key] = { nombre: name, fecha: parsed.date, weekday: parsed.weekday,
        entrada: null, salida: null, entradaMin: null, salidaMin: null }
    }
    const d = empDays[key]
    if (isEntrada && (d.entradaMin === null || parsed.totalMinutes < d.entradaMin)) {
      d.entrada = parsed.time; d.entradaMin = parsed.totalMinutes
    }
    if (isSalida && (d.salidaMin === null || parsed.totalMinutes > d.salidaMin)) {
      d.salida = parsed.time; d.salidaMin = parsed.totalMinutes
    }
  }
  return Object.values(empDays).sort((a, b) => a.nombre.localeCompare(b.nombre) || a.fecha.localeCompare(b.fecha))
}

// ── IMPORT UI ──
window.procesarReloj = async () => {
  const input = document.getElementById('reloj-file')
  if (!input.files?.length) { window.toast?.('Seleccioná un archivo', 'error'); return }
  const file = input.files[0]
  const quincena = document.getElementById('reloj-quincena').value
  await loadConfig()
  const { data: empleados } = await getSb().from('empleados').select('*').eq('activo', true)
  const data = await file.arrayBuffer()
  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false })
  if (rows.length < 2) { window.toast?.('Archivo vacío', 'error'); return }
  const dayRecords = processTimeClock(rows, quincena)
  if (!dayRecords.length) {
    window.toast?.('No se encontraron registros para la quincena seleccionada', 'error'); return
  }
  const fechas = dayRecords.map(d => d.fecha).sort()
  const fechaMin = fechas[0], fechaMax = fechas[fechas.length - 1]
  const { data: permisos } = await getSb().from('permisos_empleados')
    .select('*').gte('fecha', fechaMin).lte('fecha', fechaMax)
  permisosCache = permisos || []
  asistenciaData = calcularAsistencia(dayRecords, permisosCache)
  asistenciaResumen = calcularResumenQuincenal(asistenciaData, empleados || [])
  renderAsistencia(fechaMin, fechaMax)
  window.toast?.(`${dayRecords.length} registros · ${asistenciaResumen.length} empleados · ${quincena}`, 'success')
}

function renderAsistencia(fechaMin, fechaMax) {
  const container = document.getElementById('asistencia-resultado')
  if (!container) return
  container.classList.remove('hidden')
  
  const totalEmps = asistenciaResumen.length
  const totalAlertas = asistenciaResumen.reduce((s, r) => s + r.alertas.length, 0)
  const totalHE = asistenciaResumen.reduce((s, r) => s + r.heNeto, 0)
  const totalTardes = asistenciaResumen.reduce((s, r) => s + r.tardeDeducir, 0)
  const sinSalidaCount = asistenciaResumen.reduce((s, r) => s + r.sinSalida.length, 0)
  
  // Stats
  document.getElementById('ast-stats').innerHTML = `
    <div class="stats-row" style="grid-template-columns:repeat(5,1fr)">
      <div class="stat-card"><div class="stat-num">${totalEmps}</div><div class="stat-label">Empleados</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green)">${Math.round(totalHE / 60 * 10) / 10}h</div><div class="stat-label">HE Netas</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red)">${totalTardes}min</div><div class="stat-label">Tardes a deducir</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${sinSalidaCount ? 'var(--red)' : 'var(--green)'}">${sinSalidaCount}</div><div class="stat-label">Sin salida</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${totalAlertas ? 'var(--amber)' : 'var(--green)'}">${totalAlertas}</div><div class="stat-label">Alertas</div></div>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-top:6px">Período: ${fechaMin} al ${fechaMax}</div>`
  
  // Employee cards
  let html = ''
  for (const r of asistenciaResumen) {
    const heHoras = Math.round(r.heNeto / 60 * 10) / 10
    const matched = r.empleado_id ? '✅' : '⚠️'
    
    html += `
    <div style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:12px;overflow:hidden" id="ast-emp-${r.nombre.replace(/\s/g, '_')}">
      <div style="padding:12px 16px;background:var(--bg3);display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="toggleAstDetalle('${r.nombre.replace(/'/g, "\\'")}')">
        <div>
          <span style="font-weight:600">${matched} ${r.nombre}</span>
          <span style="font-size:11px;color:var(--text3);margin-left:8px">${r.diasTrabajados} días · ${r.dias.length} registros</span>
        </div>
        <div style="display:flex;gap:16px;font-size:12px;font-family:var(--mono)">
          <span style="color:var(--green)" title="HE netas">↑ ${heHoras}h</span>
          <span style="color:${r.totalTarde > 0 ? (r.tardeDeducir > 0 ? 'var(--red)' : 'var(--amber)') : 'var(--text3)'}" title="Tardes">⏰ ${r.totalTarde}min${r.tardeDeducir > 0 ? ' ✗' : r.totalTarde > 0 ? ' ✓' : ''}</span>
          <span style="color:${r.totalNegativo > 0 ? 'var(--red)' : 'var(--text3)'}" title="Negativo">↓ ${r.totalNegativo}min</span>
          ${r.sinSalida.length ? `<span style="color:var(--red)">❌ ${r.sinSalida.length}</span>` : ''}
        </div>
      </div>
      ${r.alertas.length ? `<div style="padding:6px 16px;background:var(--bg2);border-top:1px solid var(--border)">
        ${r.alertas.map(a => `<div style="font-size:11px;color:var(--amber);margin:2px 0">${a}</div>`).join('')}
      </div>` : ''}
      <div id="ast-det-${r.nombre.replace(/\s/g, '_')}" style="display:none">
        <table style="font-size:12px">
          <thead><tr>
            <th>Fecha</th><th>Día</th><th>Entrada</th><th>Salida</th>
            <th style="text-align:right">Tarde</th><th style="text-align:right">HE</th>
            <th style="text-align:right">Neg.</th><th>Notas</th>
          </tr></thead>
          <tbody>${r.dias.map(d => {
            const dow = ['Dom','Lun','Mar','Mie','Jue','Vie','Sáb'][d.weekday]
            const esSab = d.weekday === 6
            return `<tr style="${d.sin_salida ? 'background:#ff000015' : d.tiene_permiso ? 'background:#3b82f615' : ''}">
              <td style="font-family:var(--mono)">${d.fecha}</td>
              <td style="${esSab ? 'color:var(--gold)' : ''}">${dow}</td>
              <td style="font-family:var(--mono);color:${d.minutos_tarde > 0 ? 'var(--red)' : 'var(--green)'}">${d.entrada || '—'}</td>
              <td style="font-family:var(--mono);color:${d.sin_salida ? 'var(--red)' : d.minutos_negativos > 0 ? 'var(--amber)' : ''}">${d.salida || (d.sin_salida ? '❌ FALTA' : '—')}</td>
              <td style="text-align:right;color:${d.minutos_tarde > 0 ? 'var(--red)' : ''}">${d.minutos_tarde || ''}</td>
              <td style="text-align:right;color:${d.minutos_he > 0 ? 'var(--green)' : ''}">${d.minutos_he || ''}</td>
              <td style="text-align:right;color:${d.minutos_negativos > 0 ? 'var(--red)' : ''}">${d.minutos_negativos || ''}</td>
              <td style="font-size:11px;color:var(--text3)">${d.tiene_permiso ? '🔓 Permiso' : ''}</td>
            </tr>`
          }).join('')}</tbody>
          <tfoot><tr style="background:var(--bg3);font-weight:600">
            <td colspan="4" style="text-align:right">TOTALES</td>
            <td style="text-align:right;color:var(--red)">${r.totalTarde || ''}</td>
            <td style="text-align:right;color:var(--green)">${r.heNeto || ''}</td>
            <td style="text-align:right;color:var(--red)">${r.totalNegativo || ''}</td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>
    </div>`
  }
  
  document.getElementById('ast-empleados').innerHTML = html
  
  // Show action buttons
  document.getElementById('ast-acciones').classList.remove('hidden')
}

window.toggleAstDetalle = (nombre) => {
  const el = document.getElementById('ast-det-' + nombre.replace(/\s/g, '_'))
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none'
}

// ── SAVE ATTENDANCE TO DB ──
window.guardarAsistencia = async () => {
  if (!asistenciaData.length) return
  
  // Determine periodo
  const fechas = asistenciaData.map(d => d.fecha).sort()
  const firstDate = new Date(fechas[0] + 'T12:00:00')
  const mes = String(firstDate.getMonth() + 1).padStart(2, '0')
  const anio = firstDate.getFullYear()
  const quincena = firstDate.getDate() <= 15 ? 'Q1' : 'Q2'
  const periodo = `${anio}-${mes}-${quincena}`
  const lote = `REL-${Date.now()}`
  
  // Match employees
  const { data: empleados } = await getSb().from('empleados').select('id, nombre').eq('activo', true)
  
  const rows = asistenciaData.filter(d => d.entrada).map(d => {
    const emp = (empleados || []).find(e => {
      const en = e.nombre.toUpperCase().trim()
      const dn = d.nombre.toUpperCase().trim()
      return en === dn || en.includes(dn) || dn.includes(en)
    })
    return {
      empleado_id: emp?.id || null,
      empleado_nombre: d.nombre,
      fecha: d.fecha,
      dia_semana: d.weekday,
      hora_entrada: d.entrada,
      hora_salida: d.salida,
      minutos_tarde: d.minutos_tarde,
      minutos_he: d.minutos_he,
      minutos_negativos: d.minutos_negativos,
      sin_salida: d.sin_salida,
      tiene_permiso: d.tiene_permiso,
      permiso_id: d.permiso_id,
      periodo,
      lote,
      notas: d.notas?.join(' | ') || null
    }
  })
  
  // Delete existing for this periodo
  await getSb().from('asistencia_reloj').delete().eq('periodo', periodo)
  
  // Insert new
  const { error } = await getSb().from('asistencia_reloj').insert(rows)
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  
  window.toast?.(`${rows.length} registros de asistencia guardados para ${periodo}`, 'success')
  window.logActividad?.('asistencia_importada', 'rrhh', `${rows.length} registros · ${periodo}`)
}

// ── APPLY TO PLANILLA ──
window.aplicarAsistenciaAPlanilla = () => {
  if (!asistenciaResumen.length) return
  window._asistenciaResumen = asistenciaResumen
  window.toast?.('Datos de asistencia listos. Generá la planilla para aplicarlos automáticamente.', 'info')
}

// ── PERMISOS ──
window.openPermisoEmpleado = () => {
  document.getElementById('perm-nombre').value = ''
  document.getElementById('perm-fecha').value = ''
  document.getElementById('perm-hora').value = ''
  document.getElementById('perm-motivo').value = ''
  document.getElementById('perm-tipo').value = 'salida_anticipada'
  openModal('modal-permiso-emp')
}

window.guardarPermiso = async () => {
  const nombre = document.getElementById('perm-nombre').value.trim()
  const fecha = document.getElementById('perm-fecha').value
  const horaSalida = document.getElementById('perm-hora').value
  const motivo = document.getElementById('perm-motivo').value.trim()
  const tipo = document.getElementById('perm-tipo').value
  
  if (!nombre || !fecha) { window.toast?.('Nombre y fecha son obligatorios', 'error'); return }
  
  // Match employee
  const { data: emps } = await getSb().from('empleados').select('id, nombre')
    .ilike('nombre', `%${nombre}%`).limit(1)
  
  const { error } = await getSb().from('permisos_empleados').insert({
    empleado_id: emps?.[0]?.id || null,
    empleado_nombre: nombre.toUpperCase(),
    fecha,
    hora_salida: horaSalida || null,
    motivo,
    tipo,
    aprobado_por: window._currentProfile?.()?.nombre || ''
  })
  
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  closeModal('modal-permiso-emp')
  window.toast?.('Permiso registrado ✓', 'success')
  cargarPermisos()
}

async function cargarPermisos() {
  const { data } = await getSb().from('permisos_empleados')
    .select('*').order('fecha', { ascending: false }).limit(50)
  
  const tbody = document.getElementById('tbody-permisos')
  if (!tbody) return
  
  const tipoLabel = { salida_anticipada: 'Salida anticipada', falta_justificada: 'Falta justificada', permiso_dia: 'Permiso día completo' }
  
  tbody.innerHTML = (data || []).map(p => `
    <tr>
      <td>${p.fecha}</td>
      <td><strong>${p.empleado_nombre}</strong></td>
      <td>${p.hora_salida || '—'}</td>
      <td><span class="badge badge-blue" style="font-size:10px">${tipoLabel[p.tipo] || p.tipo}</span></td>
      <td style="font-size:12px;color:var(--text3)">${p.motivo || '—'}</td>
      <td style="font-size:11px;color:var(--text3)">${p.aprobado_por || '—'}</td>
      <td><button class="btn btn-ghost" style="padding:2px 6px;font-size:11px;color:var(--red)" onclick="eliminarPermiso('${p.id}')">✕</button></td>
    </tr>
  `).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">No hay permisos registrados</td></tr>'
}

window.eliminarPermiso = async (id) => {
  if (!confirm('¿Eliminar este permiso?')) return
  await getSb().from('permisos_empleados').delete().eq('id', id)
  window.toast?.('Permiso eliminado', 'success')
  cargarPermisos()
}

window.loadAsistencia = async () => {
  await cargarPermisos()
  // Auto-select quincena
  const q = document.getElementById('reloj-quincena')
  if (q) q.value = new Date().getDate() <= 15 ? 'Q1' : 'Q2'
}

// ── CONFIG IHSS ──
window.loadConfigPlanilla = async () => {
  await loadConfig()
  const keys = ['ihss_techo_mensual', 'ihss_pct_laboral', 'ihss_pct_patronal', 'gracia_tarde_min', 'he_gracia_lv_min', 'he_bloque_min']
  const labels = {
    ihss_techo_mensual: 'Techo IHSS mensual (L.)',
    ihss_pct_laboral: 'IHSS % laboral (ej: 0.025 = 2.5%)',
    ihss_pct_patronal: 'IHSS % patronal (ej: 0.05 = 5%)',
    gracia_tarde_min: 'Gracia tardes (min/quincena)',
    he_gracia_lv_min: 'Gracia HE Lun-Vie (min después de 5PM)',
    he_bloque_min: 'Bloque HE (min)'
  }
  const container = document.getElementById('config-planilla-fields')
  if (!container) return
  container.innerHTML = keys.map(k => `
    <div class="fld" style="margin-bottom:8px">
      <label>${labels[k] || k}</label>
      <input type="number" id="cfg-${k}" value="${configPlanilla[k] || 0}" step="any" style="max-width:200px">
    </div>
  `).join('')
  
  // Show calculated deduction
  const techo = configPlanilla.ihss_techo_mensual || 0
  const pct = configPlanilla.ihss_pct_laboral || 0
  const deduccion = Math.round(techo * pct * 100) / 100
  document.getElementById('config-ihss-calc').innerHTML = 
    `Deducción IHSS laboral quincenal: <strong style="color:var(--gold)">L. ${fmt(deduccion)}</strong> (${techo} × ${pct * 100}%)`
}

window.guardarConfigPlanilla = async () => {
  const keys = ['ihss_techo_mensual', 'ihss_pct_laboral', 'ihss_pct_patronal', 'gracia_tarde_min', 'he_gracia_lv_min', 'he_bloque_min']
  for (const k of keys) {
    const val = parseFloat(document.getElementById(`cfg-${k}`).value) || 0
    await getSb().from('config_planilla').upsert({ clave: k, valor: val, updated_at: new Date().toISOString() }, { onConflict: 'clave' })
    configPlanilla[k] = val
  }
  window.toast?.('Configuración guardada ✓', 'success')
  loadConfigPlanilla()
}

})();
