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
  // Límites reales del período (no los del archivo) para evaluar el séptimo día
  const refFecha = dayRecords[0].fecha
  const [refY, refM] = refFecha.split('-').map(Number)
  const bounds = _periodoBounds(refY, refM, quincena)
  asistenciaResumen = calcularResumenQuincenal(asistenciaData, empleados || [], bounds.inicio, bounds.fin, bounds.base)
  renderAsistencia(fechaMin, fechaMax)
  window.toast?.(`${dayRecords.length} registros · ${asistenciaResumen.length} empleados · ${quincena}`, 'success')
}

// ── CALCULATE ATTENDANCE PER DAY ──
function calcularAsistencia(dayRecords, permisos) {
  const HORA_ENTRADA = 8 * 60
  const HORA_SALIDA_LV = 17 * 60
  const HORA_SALIDA_SAB = 13 * 60
  const GRACIA_HE_LV = configPlanilla.he_gracia_lv_min || 30
  const BLOQUE_HE = configPlanilla.he_bloque_min || 30

  return dayRecords.map(d => {
    const result = { ...d, minutos_tarde: 0, minutos_he: 0, minutos_negativos: 0,
      sin_salida: false, tiene_permiso: false, permiso_id: null, notas: [] }
    const esSabado = d.weekday === 6
    const esDomingo = d.weekday === 0
    const esLaboral = d.weekday >= 1 && d.weekday <= 5

    if (esDomingo) return result

    const permiso = permisos.find(p =>
      p.empleado_nombre?.toUpperCase() === d.nombre?.toUpperCase() && p.fecha === d.fecha)
    if (permiso) { result.tiene_permiso = true; result.permiso_id = permiso.id }

    if (d.entrada && !d.salida) {
      result.sin_salida = true
      result.notas.push('⚠️ Sin salida registrada')
      return result
    }
    if (!d.entrada) return result

    if (d.entradaMin > HORA_ENTRADA) {
      result.minutos_tarde = d.entradaMin - HORA_ENTRADA
      result.notas.push(`Tarde: ${result.minutos_tarde}min`)
    }
    if (!d.salida) return result

    if (esSabado) {
      if (d.salidaMin > HORA_SALIDA_SAB) {
        const extraMin = d.salidaMin - HORA_SALIDA_SAB
        result.minutos_he = Math.floor(extraMin / BLOQUE_HE) * BLOQUE_HE
        if (result.minutos_he > 0) result.notas.push(`HE: ${result.minutos_he}min`)
      }
    } else if (esLaboral) {
      const inicioHE = HORA_SALIDA_LV + GRACIA_HE_LV
      if (d.salidaMin > inicioHE) {
        const extraMin = d.salidaMin - HORA_SALIDA_LV
        result.minutos_he = Math.floor(extraMin / BLOQUE_HE) * BLOQUE_HE
        if (result.minutos_he > 0) result.notas.push(`HE: ${result.minutos_he}min`)
      }
      if (d.salidaMin < HORA_SALIDA_LV && !result.tiene_permiso) {
        result.minutos_negativos = HORA_SALIDA_LV - d.salidaMin
        result.notas.push(`Negativo: ${result.minutos_negativos}min`)
      }
    }
    return result
  })
}

// ── HELPERS SÉPTIMO DÍA / FALTAS ──
function _localYMD(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// Límites del período según quincena. Quincena completa = 15 días (mes = 30); "Todo" = 30.
function _periodoBounds(anio, mes, quincena) {
  const ultimoDia = new Date(anio, mes, 0).getDate() // mes 1-based: día 0 del mes siguiente
  let ini, fin, base
  if (quincena === 'Q1') { ini = 1; fin = 15; base = 15 }
  else if (quincena === 'Q2') { ini = 16; fin = ultimoDia; base = 15 }
  else { ini = 1; fin = ultimoDia; base = 30 }
  const pad = n => String(n).padStart(2, '0')
  return { inicio: `${anio}-${pad(mes)}-${pad(ini)}`, fin: `${anio}-${pad(mes)}-${pad(fin)}`, base }
}

// Días laborables (Lun-Sáb) dentro del rango [inicioStr, finStr] inclusive.
function _diasLaborablesEnRango(inicioStr, finStr) {
  const out = []
  const [yi, mi, di] = inicioStr.split('-').map(Number)
  const [yf, mf, df] = finStr.split('-').map(Number)
  const dt = new Date(yi, mi - 1, di), end = new Date(yf, mf - 1, df)
  while (dt <= end) {
    const dow = dt.getDay()
    if (dow >= 1 && dow <= 6) out.push(_localYMD(dt)) // Lun(1)..Sáb(6)
    dt.setDate(dt.getDate() + 1)
  }
  return out
}

// Lunes de la semana a la que pertenece una fecha (para agrupar faltas por semana).
function _lunesDeLaSemana(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = dt.getDay()
  dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow)) // retrocede al lunes
  return _localYMD(dt)
}

// ¿Hay permiso de día completo (justifica la falta, conserva el domingo)?
function _tienePermisoDiaCompleto(empleadoId, nombre, fecha, permisos) {
  const n = (nombre || '').toUpperCase().trim()
  return (permisos || []).some(p => {
    if (p.fecha !== fecha) return false
    if (p.tipo !== 'falta_justificada' && p.tipo !== 'permiso_dia') return false
    if (empleadoId && p.empleado_id) return p.empleado_id === empleadoId  // cruce robusto por id
    return (p.empleado_nombre || '').toUpperCase().trim() === n            // respaldo por nombre
  })
}

// Suma los DÍAS de permiso marcados "a cuenta de vacaciones" en el período.
//  · permiso_dia / falta_justificada → 1 día completo
//  · salida_anticipada con hora → (fin de jornada − hora salida)/8  (fin: 17:00 L-V, 13:00 Sáb)
// Cruce por empleado_id (robusto) con respaldo por nombre.
function _diasPermisoVac(empleadoId, nombre, permisos) {
  const n = (nombre || '').toUpperCase().trim()
  let dias = 0
  for (const p of (permisos || [])) {
    if (!p.a_cuenta_vacaciones) continue
    const match = (empleadoId && p.empleado_id) ? p.empleado_id === empleadoId
                                                : (p.empleado_nombre || '').toUpperCase().trim() === n
    if (!match) continue
    if (p.tipo === 'permiso_dia' || p.tipo === 'falta_justificada') {
      dias += 1
    } else if (p.tipo === 'salida_anticipada' && p.hora_salida) {
      const [hh, mm] = String(p.hora_salida).split(':').map(Number)
      const salidaMin = (hh || 0) * 60 + (mm || 0)
      const [y, m, d] = String(p.fecha).split('-').map(Number)
      const dow = new Date(y, (m || 1) - 1, d || 1).getDay()  // 0=Dom … 6=Sáb
      const finJornada = dow === 6 ? 13 * 60 : 17 * 60        // 13:00 sábado, 17:00 L-V
      const horas = Math.max(0, (finJornada - salidaMin) / 60)
      dias += horas / 8
    }
  }
  return Math.round(dias * 1000) / 1000
}

// Calcula faltas injustificadas (agrupadas por semana) y días pagados.
// Regla: día Lun-Sáb sin entrada y sin permiso = falta injustificada (−1 día).
// Cada semana con ≥1 falta pierde además su domingo (−1 día por semana, no por falta).
// diasPagados = base − faltas − semanasConFalta. Socios: siempre base, sin deducción.
function _aplicarSeptimo(r, presentes, fechaInicio, fechaFin, baseDias, permisos) {
  r.faltasDetalle = []
  if (r.es_socio) {
    r.faltasInjustificadas = 0; r.semanasConFalta = 0; r.diasPagados = baseDias
    return
  }
  const esperados = _diasLaborablesEnRango(fechaInicio, fechaFin)
  const semanas = new Set()
  let faltas = 0
  for (const f of esperados) {
    if (presentes.has(f)) continue
    if (_tienePermisoDiaCompleto(r.empleado_id, r.nombre, f, permisos)) continue
    faltas++
    r.faltasDetalle.push(f)
    semanas.add(_lunesDeLaSemana(f))
  }
  r.faltasInjustificadas = faltas
  r.semanasConFalta = semanas.size
  r.diasPagados = Math.max(0, baseDias - faltas - semanas.size)
  if (faltas > 0) {
    const dom = semanas.size
    r.alertas.push(`🚫 ${faltas} falta(s) injustificada(s)${dom ? ` + ${dom} domingo(s)` : ''} → ${baseDias - faltas - dom} días pagados`)
  }
}

// ── SUMMARY PER EMPLOYEE ──
function calcularResumenQuincenal(dayRecords, empleados, fechaInicio, fechaFin, baseDias) {
  const GRACIA_TARDE = configPlanilla.gracia_tarde_min || 30
  const byEmpleado = {}

  for (const d of dayRecords) {
    if (!byEmpleado[d.nombre]) {
      byEmpleado[d.nombre] = { nombre: d.nombre, empleado_id: null, dias: [],
        totalTarde: 0, totalHE: 0, totalNegativo: 0, diasTrabajados: 0, diasFalta: 0,
        diasPagados: baseDias, faltasInjustificadas: 0, semanasConFalta: 0, faltasDetalle: [],
        alertas: [], sinSalida: [] }
    }
    byEmpleado[d.nombre].dias.push(d)
  }

  for (const [nombre, r] of Object.entries(byEmpleado)) {
    const emp = empleados.find(e => {
      const en = e.nombre.toUpperCase().trim()
      const rn = nombre.toUpperCase().trim()
      // 1. Exact match
      if (en === rn) return true
      // 2. Contains (either direction)
      if (en.includes(rn) || rn.includes(en)) return true
      // 3. All words from clock name exist in employee name
      const rnWords = rn.split(/\s+/)
      if (rnWords.length >= 2 && rnWords.every(w => en.includes(w))) return true
      // 4. All words from employee name exist in clock name
      const enWords = en.split(/\s+/)
      if (enWords.length >= 2 && enWords.every(w => rn.includes(w))) return true
      // 5. First name + any shared surname
      if (rnWords[0] === enWords[0] && rnWords.some(w => enWords.includes(w) && w !== rnWords[0])) return true
      return false
    })
    if (emp) {
      r.empleado_id = emp.id
      r.sueldo_mensual = emp.sueldo_mensual
      r.es_socio = emp.es_socio
    } else {
      r.alertas.push(`⚠️ No se encontró "${nombre}" en empleados`)
    }

    const presentes = new Set()
    for (const d of r.dias) {
      if (d.entrada) { r.diasTrabajados++; presentes.add(d.fecha) }
      r.totalTarde += d.minutos_tarde
      r.totalHE += d.minutos_he
      r.totalNegativo += d.minutos_negativos
      if (d.sin_salida) r.sinSalida.push(d.fecha)
    }

    if (r.totalTarde > GRACIA_TARDE) {
      r.tardeDeducir = r.totalTarde
      r.alertas.push(`⏰ Tardes: ${r.totalTarde}min excede ${GRACIA_TARDE}min → deducir todo`)
    } else {
      r.tardeDeducir = 0
    }

    // HE en bruto (NO se netea contra negativo). Las horas no trabajadas sin permiso
    // se descuentan del sueldo en la planilla; ya no hay arrastre entre quincenas.
    r.heNeto = r.totalHE
    r.minNoTrabajados = r.totalNegativo            // salidas tempranas SIN permiso → descuento de sueldo
    if (r.totalNegativo > 0) r.alertas.push(`📉 ${r.totalNegativo}min no trabajados (descuento de sueldo)`)
    if (r.sinSalida.length) r.alertas.push(`❌ Sin salida: ${r.sinSalida.join(', ')}`)

    // Séptimo día: días pagados según faltas injustificadas (Lun-Sáb sin entrada y sin permiso)
    if (fechaInicio && fechaFin) {
      _aplicarSeptimo(r, presentes, fechaInicio, fechaFin, baseDias || 15, permisosCache)
    } else {
      r.diasPagados = r.diasTrabajados // sin rango no se puede evaluar el séptimo (compat.)
    }
    r.diasPermisoVac = _diasPermisoVac(r.empleado_id, r.nombre, permisosCache)
  }

  return Object.values(byEmpleado).sort((a, b) => a.nombre.localeCompare(b.nombre))
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
          <span style="font-size:11px;color:var(--text3);margin-left:8px">${r.diasTrabajados} presentes · <strong style="color:var(--green)">${r.diasPagados ?? r.diasTrabajados} pagados</strong>${r.faltasInjustificadas ? ` · <span style="color:var(--red)">${r.faltasInjustificadas} falta(s)${r.semanasConFalta ? ` +${r.semanasConFalta} dom` : ''}</span>` : ''}</span>
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
      if (en === dn || en.includes(dn) || dn.includes(en)) return true
      const dnWords = dn.split(/\s+/)
      if (dnWords.length >= 2 && dnWords.every(w => en.includes(w))) return true
      const enWords = en.split(/\s+/)
      if (enWords.length >= 2 && enWords.every(w => dn.includes(w))) return true
      return false
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

// Resumen de asistencia (con séptimo) leído desde la tabla asistencia_reloj.
// La planilla usa esto para no depender de la variable en memoria, que no se comparte
// entre pestañas/ventanas ni sobrevive a un refresh. Requiere haber guardado la asistencia.
window.resumenAsistenciaDesdeDB = async (anio, mes, quincena) => {
  const pad = n => String(n).padStart(2, '0')
  const periodo = `${anio}-${pad(mes)}-${quincena}`
  const { data, error } = await getSb().from('asistencia_reloj')
    .select('*').eq('periodo', periodo).order('empleado_nombre').order('fecha')
  if (error || !data?.length) return []

  await loadConfig()
  const GRACIA_TARDE = configPlanilla.gracia_tarde_min || 30
  const bounds = _periodoBounds(parseInt(anio), parseInt(mes), quincena)

  // Permisos del período (justifican faltas → conservan el domingo)
  const { data: permisos } = await getSb().from('permisos_empleados')
    .select('*').gte('fecha', bounds.inicio).lte('fecha', bounds.fin)

  // es_socio por empleado (socios no sufren deducción de días)
  const empIds = [...new Set(data.map(r => r.empleado_id).filter(Boolean))]
  const sociosMap = {}
  if (empIds.length) {
    const { data: emps } = await getSb().from('empleados').select('id, es_socio').in('id', empIds)
    for (const em of (emps || [])) sociosMap[em.id] = em.es_socio
  }

  const byEmp = {}
  for (const r of data) {
    if (!byEmp[r.empleado_nombre]) {
      byEmp[r.empleado_nombre] = { nombre: r.empleado_nombre, empleado_id: r.empleado_id,
        totalTarde: 0, totalHE: 0, totalNeg: 0, diasTrabajados: 0, sinSalida: [], alertas: [],
        presentes: new Set(), es_socio: !!sociosMap[r.empleado_id] }
    }
    const e = byEmp[r.empleado_nombre]
    if (r.hora_entrada) { e.diasTrabajados++; e.presentes.add(r.fecha) }
    e.totalTarde += r.minutos_tarde || 0
    e.totalHE += r.minutos_he || 0
    e.totalNeg += r.minutos_negativos || 0
    if (r.sin_salida) e.sinSalida.push(r.fecha)
  }

  const out = []
  for (const e of Object.values(byEmp)) {
    e.tardeDeducir = e.totalTarde > GRACIA_TARDE ? e.totalTarde : 0
    e.heNeto = e.totalHE                              // HE en bruto (sin neteo)
    e.minNoTrabajados = e.totalNeg                    // salidas tempranas SIN permiso → descuento de sueldo
    _aplicarSeptimo(e, e.presentes, bounds.inicio, bounds.fin, bounds.base, permisos || [])
    e.diasPermisoVac = _diasPermisoVac(e.empleado_id, e.nombre, permisos || [])
    out.push(e)
  }
  return out
}

// ── PERMISOS ──
window.openPermisoEmpleado = async () => {
  const sel = document.getElementById('perm-nombre')
  sel.innerHTML = '<option value="">— Seleccionar empleado —</option>'
  const { data: emps } = await getSb().from('empleados')
    .select('id, nombre').eq('activo', true).order('nombre')
  for (const e of (emps || [])) {
    const o = document.createElement('option')
    o.value = e.id
    o.textContent = e.nombre
    sel.appendChild(o)
  }
  document.getElementById('perm-fecha').value = ''
  document.getElementById('perm-hora').value = ''
  document.getElementById('perm-motivo').value = ''
  document.getElementById('perm-tipo').value = 'salida_anticipada'
  document.getElementById('perm-acuenta-vac').checked = true
  document.getElementById('modal-permiso-emp').classList.add('open')
}

window.guardarPermiso = async () => {
  const sel = document.getElementById('perm-nombre')
  const empleadoId = sel.value
  const nombre = empleadoId ? sel.options[sel.selectedIndex].text : ''
  const fecha = document.getElementById('perm-fecha').value
  const horaSalida = document.getElementById('perm-hora').value
  const motivo = document.getElementById('perm-motivo').value.trim()
  const tipo = document.getElementById('perm-tipo').value
  const aCuentaVac = document.getElementById('perm-acuenta-vac').checked

  if (!empleadoId || !fecha) { window.toast?.('Seleccioná el empleado y la fecha', 'error'); return }

  const { error } = await getSb().from('permisos_empleados').insert({
    empleado_id: empleadoId,
    empleado_nombre: nombre.toUpperCase(),
    fecha,
    hora_salida: horaSalida || null,
    motivo,
    tipo,
    a_cuenta_vacaciones: aCuentaVac,
    aprobado_por: window._currentProfile?.()?.nombre || ''
  })

  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  window.closeModal('modal-permiso-emp')
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
      <td><span class="badge badge-blue" style="font-size:10px">${tipoLabel[p.tipo] || p.tipo}</span>${p.a_cuenta_vacaciones ? ' <span title="A cuenta de vacaciones">🏖️</span>' : ''}</td>
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
  const q = document.getElementById('reloj-quincena')
  if (q) q.value = new Date().getDate() <= 15 ? 'Q1' : 'Q2'
  // Load available periods
  await cargarPeriodosHistorial()
}

async function cargarPeriodosHistorial() {
  const { data } = await getSb().from('asistencia_reloj')
    .select('periodo').order('periodo', { ascending: false })
  if (!data?.length) return
  const periodos = [...new Set(data.map(d => d.periodo))].sort().reverse()
  const sel = document.getElementById('hist-periodo')
  if (!sel) return
  sel.innerHTML = periodos.map(p => `<option value="${p}">${p}</option>`).join('')
}

window.cargarHistorialAsistencia = async () => {
  const periodo = document.getElementById('hist-periodo').value
  if (!periodo) { window.toast?.('Seleccioná un período', 'error'); return }

  const { data, error } = await getSb().from('asistencia_reloj')
    .select('*')
    .eq('periodo', periodo)
    .order('empleado_nombre').order('fecha')
  if (error) { window.toast?.(error.message, 'error'); return }
  if (!data?.length) {
    document.getElementById('hist-resultado').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">No hay datos para este período</div>'
    return
  }

  await loadConfig()
  const GRACIA_TARDE = configPlanilla.gracia_tarde_min || 30

  // Group by employee
  const byEmp = {}
  for (const r of data) {
    if (!byEmp[r.empleado_nombre]) {
      byEmp[r.empleado_nombre] = { nombre: r.empleado_nombre, empleado_id: r.empleado_id, dias: [],
        totalTarde: 0, totalHE: 0, totalNeg: 0, diasTrabajados: 0, sinSalida: [], alertas: [],
        presentes: new Set(), diasPagados: 0, faltasInjustificadas: 0, semanasConFalta: 0, faltasDetalle: [] }
    }
    const e = byEmp[r.empleado_nombre]
    e.dias.push(r)
    if (r.hora_entrada) { e.diasTrabajados++; e.presentes.add(r.fecha) }
    e.totalTarde += r.minutos_tarde || 0
    e.totalHE += r.minutos_he || 0
    e.totalNeg += r.minutos_negativos || 0
    if (r.sin_salida) e.sinSalida.push(r.fecha)
  }

  // Calc alerts
  for (const e of Object.values(byEmp)) {
    if (e.totalTarde > GRACIA_TARDE) {
      e.tardeDeducir = e.totalTarde
      e.alertas.push(`⏰ Tardes: ${e.totalTarde}min excede ${GRACIA_TARDE}min → deducir todo`)
    } else {
      e.tardeDeducir = 0
    }
    e.heNeto = e.totalHE                              // HE en bruto (sin neteo)
    e.minNoTrabajados = e.totalNeg
    if (e.totalNeg > 0) e.alertas.push(`📉 ${e.totalNeg}min no trabajados (descuento de sueldo)`)
    if (e.sinSalida.length) e.alertas.push(`❌ Sin salida: ${e.sinSalida.join(', ')}`)
    if (!e.empleado_id) e.alertas.push(`⚠️ No vinculado a empleado`)
  }

  // ── Séptimo día / días pagados (a partir del período guardado) ──
  const partsP = periodo.split('-') // "YYYY-MM-Q1"
  const histAnio = parseInt(partsP[0]), histMes = parseInt(partsP[1]), histQ = partsP[2]
  const histBounds = _periodoBounds(histAnio, histMes, histQ)
  const empIds = [...new Set(Object.values(byEmp).map(e => e.empleado_id).filter(Boolean))]
  const sociosMap = {}
  if (empIds.length) {
    const { data: emps } = await getSb().from('empleados').select('id, es_socio').in('id', empIds)
    for (const em of (emps || [])) sociosMap[em.id] = em.es_socio
  }
  const { data: permisosPeriodo } = await getSb().from('permisos_empleados')
    .select('*').gte('fecha', histBounds.inicio).lte('fecha', histBounds.fin)
  for (const e of Object.values(byEmp)) {
    e.es_socio = !!sociosMap[e.empleado_id]
    _aplicarSeptimo(e, e.presentes, histBounds.inicio, histBounds.fin, histBounds.base, permisosPeriodo || [])
    e.diasPermisoVac = _diasPermisoVac(e.empleado_id, e.nombre, permisosPeriodo || [])
  }

  const empleados = Object.values(byEmp).sort((a, b) => a.nombre.localeCompare(b.nombre))
  const totalEmps = empleados.length
  const totalAlertas = empleados.reduce((s, e) => s + e.alertas.length, 0)
  const totalHE = empleados.reduce((s, e) => s + e.heNeto, 0)
  const totalTardes = empleados.reduce((s, e) => s + e.tardeDeducir, 0)
  const sinSalidaCount = empleados.reduce((s, e) => s + e.sinSalida.length, 0)

  let html = `
    <div class="stats-row" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">
      <div class="stat-card"><div class="stat-num">${totalEmps}</div><div class="stat-label">Empleados</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green)">${Math.round(totalHE / 60 * 10) / 10}h</div><div class="stat-label">HE Netas</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red)">${totalTardes}min</div><div class="stat-label">Tardes a deducir</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${sinSalidaCount ? 'var(--red)' : 'var(--green)'}">${sinSalidaCount}</div><div class="stat-label">Sin salida</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${totalAlertas ? 'var(--amber)' : 'var(--green)'}">${totalAlertas}</div><div class="stat-label">Alertas</div></div>
    </div>`

  for (const e of empleados) {
    const matched = e.empleado_id ? '✅' : '⚠️'
    const heH = Math.round(e.heNeto / 60 * 10) / 10

    html += `
    <div style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:10px;overflow:hidden">
      <div style="padding:10px 14px;background:var(--bg3);display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none'">
        <div>
          <span style="font-weight:600">${matched} ${e.nombre}</span>
          <span style="font-size:11px;color:var(--text3);margin-left:8px">${e.diasTrabajados} presentes · <strong style="color:var(--green)">${e.diasPagados ?? e.diasTrabajados} pagados</strong>${e.faltasInjustificadas ? ` · <span style="color:var(--red)">${e.faltasInjustificadas} falta(s)${e.semanasConFalta ? ` +${e.semanasConFalta} dom` : ''}</span>` : ''}</span>
        </div>
        <div style="display:flex;gap:14px;font-size:12px;font-family:var(--mono)">
          <span style="color:var(--green)">↑ ${heH}h</span>
          <span style="color:${e.tardeDeducir > 0 ? 'var(--red)' : e.totalTarde > 0 ? 'var(--amber)' : 'var(--text3)'}">⏰ ${e.totalTarde}min${e.tardeDeducir > 0 ? ' ✗' : e.totalTarde > 0 ? ' ✓' : ''}</span>
          <span style="color:${e.totalNeg > 0 ? 'var(--red)' : 'var(--text3)'}">↓ ${e.totalNeg}min</span>
          ${e.sinSalida.length ? `<span style="color:var(--red)">❌ ${e.sinSalida.length}</span>` : ''}
        </div>
      </div>
      <div style="display:none">
        ${e.alertas.length ? `<div style="padding:6px 14px;background:var(--bg2);border-top:1px solid var(--border)">
          ${e.alertas.map(a => `<div style="font-size:11px;color:var(--amber);margin:2px 0">${a}</div>`).join('')}
        </div>` : ''}
        <table style="font-size:12px">
          <thead><tr><th>Fecha</th><th>Día</th><th>Entrada</th><th>Salida</th><th style="text-align:right">Tarde</th><th style="text-align:right">HE</th><th style="text-align:right">Neg.</th><th>Notas</th></tr></thead>
          <tbody>${e.dias.map(d => {
            const dow = ['Dom','Lun','Mar','Mie','Jue','Vie','Sáb'][d.dia_semana]
            return `<tr style="${d.sin_salida ? 'background:#ff000015' : d.tiene_permiso ? 'background:#3b82f615' : ''}">
              <td style="font-family:var(--mono)">${d.fecha}</td>
              <td style="${d.dia_semana === 6 ? 'color:var(--gold)' : ''}">${dow}</td>
              <td style="font-family:var(--mono);color:${d.minutos_tarde > 0 ? 'var(--red)' : 'var(--green)'}">${d.hora_entrada || '—'}</td>
              <td style="font-family:var(--mono);color:${d.sin_salida ? 'var(--red)' : d.minutos_negativos > 0 ? 'var(--amber)' : ''}">${d.hora_salida || (d.sin_salida ? '❌' : '—')}</td>
              <td style="text-align:right;color:${d.minutos_tarde > 0 ? 'var(--red)' : ''}">${d.minutos_tarde || ''}</td>
              <td style="text-align:right;color:${d.minutos_he > 0 ? 'var(--green)' : ''}">${d.minutos_he || ''}</td>
              <td style="text-align:right;color:${d.minutos_negativos > 0 ? 'var(--red)' : ''}">${d.minutos_negativos || ''}</td>
              <td style="font-size:11px;color:var(--text3)">${d.tiene_permiso ? '🔓 Permiso' : ''} ${d.notas || ''}</td>
            </tr>`
          }).join('')}</tbody>
        </table>
      </div>
    </div>`
  }

  document.getElementById('hist-resultado').innerHTML = html
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