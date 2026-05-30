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
function parseDateTime(str) {
  if (!str) return null
  // Format: "04/05/2026 07:45 a. m." or "04/05/2026 05:16 p. m."
  const s = str.trim()
    .replace(/a\.\s*m\./i, 'AM')
    .replace(/p\.\s*m\./i, 'PM')
    .replace(/\s+/g, ' ')
  
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return null
  
  let [, dd, mm, yyyy, hh, min, ampm] = m
  hh = parseInt(hh)
  if (ampm.toUpperCase() === 'PM' && hh < 12) hh += 12
  if (ampm.toUpperCase() === 'AM' && hh === 12) hh = 0
  
  return {
    date: `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`,
    time: `${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    hours: hh,
    minutes: parseInt(min),
    totalMinutes: hh * 60 + parseInt(min),
    weekday: new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd)).getDay()
    // JS: 0=Sun, 1=Mon, ..., 6=Sat
  }
}

function processTimeClock(rows) {
  // Build per-employee, per-day: first entry, last exit
  const empDays = {}
  
  for (const row of rows) {
    const name = (row[2] || '').toString().trim()
    const horaStr = (row[3] || '').toString().trim()
    const estado = (row[4] || '').toString().trim()
    
    if (!name || !horaStr) continue
    
    const parsed = parseDateTime(horaStr)
    if (!parsed) continue
    
    const key = `${name}|${parsed.date}`
    if (!empDays[key]) {
      empDays[key] = {
        nombre: name,
        fecha: parsed.date,
        weekday: parsed.weekday, // 0=Sun, 1=Mon, ..., 6=Sat
        entrada: null,
        salida: null,
        entradaMin: null,
        salidaMin: null
      }
    }
    
    const d = empDays[key]
    if (estado.includes('Entrada')) {
      if (d.entradaMin === null || parsed.totalMinutes < d.entradaMin) {
        d.entrada = parsed.time
        d.entradaMin = parsed.totalMinutes
      }
    }
    if (estado.includes('Salida')) {
      if (d.salidaMin === null || parsed.totalMinutes > d.salidaMin) {
        d.salida = parsed.time
        d.salidaMin = parsed.totalMinutes
      }
    }
  }
  
  return Object.values(empDays).sort((a, b) => a.nombre.localeCompare(b.nombre) || a.fecha.localeCompare(b.fecha))
}

// ── CALCULATE ATTENDANCE ──
function calcularAsistencia(dayRecords, permisos) {
  const HORA_ENTRADA = 8 * 60       // 8:00 AM = 480 min
  const HORA_SALIDA_LV = 17 * 60    // 5:00 PM = 1020 min
  const HORA_SALIDA_SAB = 13 * 60   // 1:00 PM = 780 min
  const GRACIA_HE_LV = configPlanilla.he_gracia_lv_min || 30    // 30 min gracia L-V
  const BLOQUE_HE = configPlanilla.he_bloque_min || 30           // bloques de 30 min
  
  return dayRecords.map(d => {
    const result = {
      ...d,
      minutos_tarde: 0,
      minutos_he: 0,
      minutos_negativos: 0,
      sin_salida: false,
      tiene_permiso: false,
      permiso_id: null,
      notas: []
    }
    
    const esSabado = d.weekday === 6 // JS: 6=Sat
    const esDomingo = d.weekday === 0
    const esLaboral = d.weekday >= 1 && d.weekday <= 5 // Mon-Fri
    
    if (esDomingo) return result // No se procesa domingo
    
    // Check permisos for this day
    const permiso = permisos.find(p => 
      p.empleado_nombre === d.nombre && p.fecha === d.fecha
    )
    if (permiso) {
      result.tiene_permiso = true
      result.permiso_id = permiso.id
    }
    
    // Sin salida
    if (d.entrada && !d.salida) {
      result.sin_salida = true
      result.notas.push('⚠️ Sin salida registrada')
      return result
    }
    
    if (!d.entrada) return result
    
    // Llegada tarde (después de 8:00 AM)
    if (d.entradaMin > HORA_ENTRADA) {
      result.minutos_tarde = d.entradaMin - HORA_ENTRADA
      result.notas.push(`Tarde: ${result.minutos_tarde}min`)
    }
    
    if (!d.salida) return result
    
    const horaSalidaNormal = esSabado ? HORA_SALIDA_SAB : HORA_SALIDA_LV
    
    // Horas extra
    if (esSabado) {
      // Sábado: HE después de 1:00 PM SIN gracia
      if (d.salidaMin > HORA_SALIDA_SAB) {
        const extraMin = d.salidaMin - HORA_SALIDA_SAB
        result.minutos_he = Math.floor(extraMin / BLOQUE_HE) * BLOQUE_HE
        if (result.minutos_he > 0) result.notas.push(`HE: ${result.minutos_he}min`)
      }
    } else if (esLaboral) {
      // L-V: HE después de 5:00 PM + 30min gracia (desde 5:30 PM)
      const inicioHE = HORA_SALIDA_LV + GRACIA_HE_LV
      if (d.salidaMin > inicioHE) {
        const extraMin = d.salidaMin - HORA_SALIDA_LV
        result.minutos_he = Math.floor(extraMin / BLOQUE_HE) * BLOQUE_HE
        if (result.minutos_he > 0) result.notas.push(`HE: ${result.minutos_he}min`)
      }
      
      // Salida anticipada (antes de 5:00 PM, sin permiso)
      if (d.salidaMin < HORA_SALIDA_LV && !result.tiene_permiso) {
        result.minutos_negativos = HORA_SALIDA_LV - d.salidaMin
        result.notas.push(`Negativo: ${result.minutos_negativos}min`)
      }
    }
    
    return result
  })
}

function calcularResumenQuincenal(dayRecords, empleados) {
  const GRACIA_TARDE = configPlanilla.gracia_tarde_min || 30
  
  // Group by employee
  const byEmpleado = {}
  for (const d of dayRecords) {
    if (!byEmpleado[d.nombre]) {
      byEmpleado[d.nombre] = {
        nombre: d.nombre,
        empleado_id: null,
        dias: [],
        totalTarde: 0,
        totalHE: 0,
        totalNegativo: 0,
        diasTrabajados: 0,
        diasFalta: 0,
        alertas: [],
        sinSalida: []
      }
    }
    byEmpleado[d.nombre].dias.push(d)
  }
  
  // Match with empleados table
  for (const [nombre, r] of Object.entries(byEmpleado)) {
    const emp = empleados.find(e => {
      const empNombre = e.nombre.toUpperCase().trim()
      const relojNombre = nombre.toUpperCase().trim()
      return empNombre === relojNombre || empNombre.includes(relojNombre) || relojNombre.includes(empNombre)
    })
    if (emp) {
      r.empleado_id = emp.id
      r.sueldo_mensual = emp.sueldo_mensual
      r.es_socio = emp.es_socio
    } else {
      r.alertas.push(`⚠️ No se encontró empleado "${nombre}" en la tabla de empleados`)
    }
  }
  
  // Calculate summaries
  for (const r of Object.values(byEmpleado)) {
    for (const d of r.dias) {
      if (d.entrada) r.diasTrabajados++
      r.totalTarde += d.minutos_tarde
      r.totalHE += d.minutos_he
      r.totalNegativo += d.minutos_negativos
      if (d.sin_salida) r.sinSalida.push(d.fecha)
    }
    
    // Apply tardiness rule
    if (r.totalTarde > GRACIA_TARDE) {
      r.tardeDeducir = r.totalTarde  // deducir TODO si excede gracia
      r.alertas.push(`⏰ Tardes: ${r.totalTarde}min excede ${GRACIA_TARDE}min gracia → deducir ${r.totalTarde}min`)
    } else {
      r.tardeDeducir = 0 // dentro de gracia, no se cobra
    }
    
    // Net overtime
    r.heNeto = Math.max(0, r.totalHE - r.totalNegativo)
    r.negativoArrastre = Math.max(0, r.totalNegativo - r.totalHE) // negativo para siguiente quincena
    
    if (r.negativoArrastre > 0) {
      r.alertas.push(`📉 Negativo arrastre: ${r.negativoArrastre}min para siguiente quincena`)
    }
    
    if (r.sinSalida.length > 0) {
      r.alertas.push(`❌ Sin salida: ${r.sinSalida.join(', ')}`)
    }
  }
  
  return Object.values(byEmpleado).sort((a, b) => a.nombre.localeCompare(b.nombre))
}

// ── IMPORT UI ──
window.importarReloj = async (input) => {
  if (!input.files?.length) return
  const file = input.files[0]
  
  await loadConfig()
  
  // Load empleados
  const { data: empleados } = await getSb().from('empleados').select('*').eq('activo', true)
  
  // Load permisos for the date range (we'll determine dates from the file)
  
  // Read XLS
  const data = await file.arrayBuffer()
  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false })
  
  // Skip header row
  const dataRows = rows.slice(1).filter(r => r && r[2])
  
  // Process time clock
  const dayRecords = processTimeClock(dataRows)
  
  if (!dayRecords.length) {
    window.toast?.('No se encontraron registros en el archivo', 'error')
    return
  }
  
  // Determine date range
  const fechas = dayRecords.map(d => d.fecha).sort()
  const fechaMin = fechas[0]
  const fechaMax = fechas[fechas.length - 1]
  
  // Load permisos for this range
  const { data: permisos } = await getSb().from('permisos_empleados')
    .select('*')
    .gte('fecha', fechaMin)
    .lte('fecha', fechaMax)
  permisosCache = permisos || []
  
  // Calculate attendance
  asistenciaData = calcularAsistencia(dayRecords, permisosCache)
  asistenciaResumen = calcularResumenQuincenal(asistenciaData, empleados || [])
  
  // Render results
  renderAsistencia(fechaMin, fechaMax)
  window.toast?.(`${dayRecords.length} registros procesados · ${asistenciaResumen.length} empleados`, 'success')
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
