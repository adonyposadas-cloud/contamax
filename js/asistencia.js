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
let _permisosLista = []
let _novedades = null
let incapacidadesCache = []

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
  const { data: incapsAll } = await getSb().from('permisos_empleados').select('*').eq('tipo', 'incapacidad')
  incapacidadesCache = incapsAll || []
  asistenciaData = calcularAsistencia(dayRecords, permisosCache)
  // Límites reales del período (no los del archivo) para evaluar el séptimo día
  const refFecha = dayRecords[0].fecha
  const [refY, refM] = refFecha.split('-').map(Number)
  const bounds = _periodoBounds(refY, refM, quincena)
  asistenciaResumen = calcularResumenQuincenal(asistenciaData, empleados || [], bounds.inicio, bounds.fin, bounds.base)
  renderAsistencia(fechaMin, fechaMax)
  window.toast?.(`${dayRecords.length} registros · ${asistenciaResumen.length} empleados · ${quincena}`, 'success')
}

// Minutos de HE a partir de los minutos marcados DESPUÉS de la hora de salida.
// Regla (acordada con Maximino):
//   · 0–29 min  → 0   gracia: no acumula HE (margen para cerrar/arreglarse y marcar tarde)
//   · ≥ 30 min  → se pagan TODOS los minutos marcados (ej. 35→35, 116→116)
function calcularMinutosHE(extraMin, graciaMin) {
  const gracia = graciaMin || 30
  if (extraMin < gracia) return 0   // primeros (gracia-1) min no acumulan
  return extraMin                    // a partir de la gracia → se paga el total marcado
}

// HE en minutos de un día, a partir del día de la semana y la hora de salida (en minutos).
// Centraliza la regla para que SIEMPRE coincidan la pantalla de Asistencia, la planilla
// y el historial. Al recalcular desde la hora de salida (en vez de confiar en el valor
// guardado en asistencia_reloj.minutos_he), un cambio de regla aplica en todos lados sin
// necesidad de re-importar el reloj.
function heMinutosDia(weekday, salidaMin, graciaMin) {
  if (salidaMin == null) return 0
  if (weekday === 0) return 0                                   // domingo → sin HE
  const horaSalida = weekday === 6 ? (13 * 60) : (17 * 60)      // 13:00 sábado, 17:00 L-V
  const extraMin = salidaMin - horaSalida
  if (extraMin <= 0) return 0
  return calcularMinutosHE(extraMin, graciaMin)
}

// ── CALCULATE ATTENDANCE PER DAY ──
function calcularAsistencia(dayRecords, permisos) {
  const HORA_ENTRADA = 8 * 60
  const HORA_SALIDA_LV = 17 * 60
  const HORA_SALIDA_SAB = 13 * 60
  const GRACIA_HE_LV = configPlanilla.he_gracia_lv_min || 30

  return dayRecords.map(d => {
    const result = { ...d, minutos_tarde: 0, minutos_he: 0, minutos_negativos: 0,
      sin_salida: false, tiene_permiso: false, permiso_id: null, notas: [] }
    const esDomingo = d.weekday === 0
    const esLaboral = d.weekday >= 1 && d.weekday <= 5

    if (esDomingo) return result

    const permiso = permisos.find(p =>
      _matchEmpleado(d.empleado_id, d.nombre, p) && String(p.fecha).slice(0, 10) === String(d.fecha).slice(0, 10))
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

    result.minutos_he = heMinutosDia(d.weekday, d.salidaMin, GRACIA_HE_LV)
    if (result.minutos_he > 0) result.notas.push(`HE: ${result.minutos_he}min`)

    if (esLaboral && d.salidaMin < HORA_SALIDA_LV && !result.tiene_permiso) {
      result.minutos_negativos = HORA_SALIDA_LV - d.salidaMin
      result.notas.push(`Negativo: ${result.minutos_negativos}min`)
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

// Cruce robusto registro↔empleado: por id si ambos lo tienen; si no, por nombre
// (igualdad, contención, o subconjunto de palabras) para tolerar nombres cortos del reloj.
function _matchEmpleado(empleadoId, nombre, p) {
  if (empleadoId && p.empleado_id) return p.empleado_id === empleadoId
  const a = (nombre || '').toUpperCase().trim()
  const b = (p.empleado_nombre || '').toUpperCase().trim()
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true
  const aw = a.split(/\s+/), bw = b.split(/\s+/)
  if (aw.length >= 2 && aw.every(w => b.includes(w))) return true
  if (bw.length >= 2 && bw.every(w => a.includes(w))) return true
  return false
}

// ¿Hay permiso de día completo (justifica la falta, conserva el domingo)?
function _tienePermisoDiaCompleto(empleadoId, nombre, fecha, permisos) {
  return (permisos || []).some(p => {
    if (p.fecha !== fecha) return false
    if (p.tipo !== 'falta_justificada' && p.tipo !== 'permiso_dia') return false
    return _matchEmpleado(empleadoId, nombre, p)
  })
}

// Suma los DÍAS de permiso marcados "a cuenta de vacaciones" en el período.
//  · permiso_dia / falta_justificada → 1 día completo
//  · salida_anticipada con hora → (fin de jornada − hora salida)/8  (fin: 17:00 L-V, 13:00 Sáb)
// Cruce por empleado_id (robusto) con respaldo por nombre.
// Tratamiento del permiso. Compatibilidad: registros viejos sin 'tratamiento'
// usan a_cuenta_vacaciones (true → 'vacaciones', false → 'goce' como antes).
function _tratamiento(p) {
  if (p.tratamiento) return p.tratamiento
  return p.a_cuenta_vacaciones ? 'vacaciones' : 'goce'
}

// Fracción de día (jornada = 8h) cubierta por el permiso, desde la hora de salida marcada
// hasta el fin de jornada, EXCLUYENDO la hora de almuerzo (12:00–13:00, solo L-V; el sábado
// termina a las 13:00 y no tiene almuerzo). Ej. salida 12:04 un L-V →
// (17:00−12:04) − almuerzo(12:04→13:00) = 4h = 0.5 día.
function _fraccionDiaDesdeSalida(fecha, salidaMin) {
  if (salidaMin == null) return 0
  const [y, m, d] = String(fecha).split('-').map(Number)
  const dow = new Date(y, (m || 1) - 1, d || 1).getDay()   // 0=Dom … 6=Sáb
  const fin = dow === 6 ? 13 * 60 : 17 * 60                 // fin de jornada
  if (salidaMin >= fin) return 0
  let span = fin - salidaMin
  if (dow !== 6) {                                          // descontar almuerzo 12:00–13:00 (L-V)
    const ov = Math.max(0, Math.min(fin, 13 * 60) - Math.max(salidaMin, 12 * 60))
    span -= ov
  }
  return Math.max(0, span) / 60 / 8
}

// Fracción de día (jornada = 8h) PERDIDA por una llegada tarde, desde el inicio de jornada
// (08:00) hasta la hora en que llegó, EXCLUYENDO el almuerzo (12:00–13:00, solo L-V) si la
// llegada lo cruza. Ej. llegó 10:00 un L-V → (10:00−08:00) = 2h = 0.25 día.
// Llegó 13:30 → (13:30−08:00) − almuerzo(60) = 4.5h = 0.5625 día.
function _fraccionMananaPerdida(fecha, entradaMin) {
  if (entradaMin == null) return 0
  const ini = 8 * 60                                       // inicio de jornada 08:00
  if (entradaMin <= ini) return 0
  const [y, m, d] = String(fecha).split('-').map(Number)
  const dow = new Date(y, (m || 1) - 1, d || 1).getDay()   // 0=Dom … 6=Sáb
  const fin = dow === 6 ? 13 * 60 : 17 * 60                 // fin de jornada
  const llegada = Math.min(entradaMin, fin)                // no contar más allá del fin
  let span = llegada - ini
  if (dow !== 6) {                                          // descontar almuerzo 12:00–13:00 (L-V)
    const ov = Math.max(0, Math.min(llegada, 13 * 60) - Math.max(ini, 12 * 60))
    span -= ov
  }
  return Math.max(0, span) / 60 / 8
}

// Días-equivalentes de un permiso. Usa la hora de salida marcada del reloj ese día:
//  · salida_anticipada → hora del permiso (o, si no la tiene, la marcada en el reloj)
//  · llegada_tarde → fracción de la mañana perdida desde 08:00 hasta la hora de entrada
//    declarada en el permiso (p.hora_entrada); el resto del día se paga como trabajado.
//  · permiso_dia / falta_justificada → si ese día marcó salida (trabajó parte del día),
//    se cobra solo la fracción desde la salida hasta el fin de jornada (menos almuerzo);
//    si no marcó (ausencia total), es 1 día completo.
function _diasDePermiso(p, salidaMin) {
  if (p.tipo === 'salida_anticipada') {
    const exit = p.hora_salida ? _horaAMin(p.hora_salida) : salidaMin
    return _fraccionDiaDesdeSalida(p.fecha, exit)
  }
  if (p.tipo === 'llegada_tarde') {
    const ent = p.hora_entrada ? _horaAMin(p.hora_entrada) : null
    return _fraccionMananaPerdida(p.fecha, ent)
  }
  if (p.tipo === 'permiso_dia' || p.tipo === 'falta_justificada') {
    return salidaMin != null ? _fraccionDiaDesdeSalida(p.fecha, salidaMin) : 1
  }
  return 0
}

// ¿El empleado tiene un permiso de "llegada tarde justificada" ese día? Implica que SÍ estuvo
// presente (solo llegó tarde), aunque el reloj no haya capturado la marca de entrada. Sirve
// para que la lógica de faltas/séptimo no lo cuente como ausencia.
function _tienePermisoLlegadaTarde(empleadoId, nombre, fecha, permisos) {
  return (permisos || []).some(p =>
    p.tipo === 'llegada_tarde' &&
    String(p.fecha).slice(0, 10) === String(fecha).slice(0, 10) &&
    _matchEmpleado(empleadoId, nombre, p))
}

// hora_salida (en minutos) declarada en un permiso para ese día, si existe. Se usa como
// salida efectiva para calcular HE cuando el empleado estuvo PRESENTE pero NO marcó salida
// (ej. se fue a dejar una encomienda y la salida quedó justificada por permiso). heMinutosDia
// devuelve 0 si la hora es anterior al fin de jornada, así que es seguro para cualquier tipo.
function _horaSalidaPermiso(empleadoId, nombre, fecha, permisos) {
  const p = (permisos || []).find(x => x.hora_salida &&
    String(x.fecha).slice(0, 10) === String(fecha).slice(0, 10) &&
    _matchEmpleado(empleadoId, nombre, x))
  return p ? _horaAMin(p.hora_salida) : null
}

// Suma los DÍAS de permiso marcados "a cuenta de vacaciones" (tratamiento='vacaciones').
// salidaPorFecha: mapa { 'YYYY-MM-DD': minutosDeSalidaMarcada } para calcular fracciones.
function _diasPermisoVac(empleadoId, nombre, permisos, salidaPorFecha) {
  let dias = 0
  for (const p of (permisos || [])) {
    if (_tratamiento(p) !== 'vacaciones') continue
    if (!_matchEmpleado(empleadoId, nombre, p)) continue
    const sal = salidaPorFecha ? salidaPorFecha[String(p.fecha).slice(0, 10)] : null
    dias += _diasDePermiso(p, sal == null ? null : sal)
  }
  return Math.round(dias * 1000) / 1000
}

// Suma los DÍAS de permiso SIN goce de sueldo (tratamiento='sin_goce') → se descuentan
// del salario. Misma conversión hora/día que las vacaciones.
function _diasPermisoSinGoce(empleadoId, nombre, permisos, salidaPorFecha) {
  let dias = 0
  for (const p of (permisos || [])) {
    if (_tratamiento(p) !== 'sin_goce') continue
    if (!_matchEmpleado(empleadoId, nombre, p)) continue
    const sal = salidaPorFecha ? salidaPorFecha[String(p.fecha).slice(0, 10)] : null
    dias += _diasDePermiso(p, sal == null ? null : sal)
  }
  return Math.round(dias * 1000) / 1000
}

// Suma n días calendario a un 'YYYY-MM-DD' (local, sin desfase de zona horaria).
function _addDaysYMD(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, (d || 1) + n)
  const pad = x => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

// ¿La fecha cae dentro del rango de alguna incapacidad del empleado? (justifica la ausencia)
function _diaEnIncapacidad(empleadoId, nombre, fechaYMD, incapacidades) {
  for (const p of (incapacidades || [])) {
    if (p.tipo !== 'incapacidad') continue
    if (!_matchEmpleado(empleadoId, nombre, p)) continue
    const total = parseInt(p.dias) || 0
    if (total < 1 || !p.fecha) continue
    if (fechaYMD >= p.fecha && fechaYMD < _addDaysYMD(p.fecha, total)) return true
  }
  return false
}

// Días de incapacidad que caen en el período y el pago de la EMPRESA en días-equivalentes.
//  · día 1-3 del EPISODIO → 100% (empresa)   · día 4+ → 34% (empresa; IHSS cubre 66%)
//  · el "episodio" acumula días por la cadena continua_de cuando es_continuacion = true.
// Devuelve { dias: <días calendario en el período>, empresa: <días-equivalentes a pagar> }.
function _incapacidadEnPeriodo(empleadoId, nombre, incapacidades, inicio, fin) {
  const mine = (incapacidades || []).filter(p => {
    if (p.tipo !== 'incapacidad') return false
    return _matchEmpleado(empleadoId, nombre, p)
  })
  if (!mine.length) return { dias: 0, empresa: 0 }
  const byId = {}; for (const p of mine) byId[p.id] = p
  const cache = {}
  const offsetOf = (rec, seen) => {
    if (!rec) return 0
    if (cache[rec.id] != null) return cache[rec.id]
    seen = seen || {}
    if (seen[rec.id]) return 0                         // guarda contra ciclos
    seen[rec.id] = true
    let off = 0
    if (rec.es_continuacion && rec.continua_de && byId[rec.continua_de]) {
      const parent = byId[rec.continua_de]
      off = offsetOf(parent, seen) + (parseInt(parent.dias) || 0)
    }
    cache[rec.id] = off
    return off
  }
  let dias = 0, empresa = 0
  for (const rec of mine) {
    const total = parseInt(rec.dias) || 0
    if (total < 1 || !rec.fecha) continue
    const off = offsetOf(rec)
    for (let i = 0; i < total; i++) {
      const dayYMD = _addDaysYMD(rec.fecha, i)
      if (dayYMD < inicio || dayYMD > fin) continue    // solo los días dentro de la quincena
      const episodeDay = off + i + 1                   // posición 1-based en el episodio
      dias += 1
      empresa += (episodeDay <= 3 ? 1.0 : 0.34)
    }
  }
  return { dias, empresa: Math.round(empresa * 1000) / 1000 }
}

// Calcula faltas injustificadas (agrupadas por semana) y días pagados.
// Regla: día Lun-Sáb sin entrada y sin permiso = falta injustificada (−1 día).
// Cada semana con ≥1 falta pierde además su domingo (−1 día por semana, no por falta).
// diasPagados = base − faltas − semanasConFalta. Socios: siempre base, sin deducción.
function _aplicarSeptimo(r, presentes, fechaInicio, fechaFin, baseDias, permisos, incapacidades) {
  r.faltasDetalle = []
  if (r.es_socio) {
    r.faltasInjustificadas = 0; r.semanasConFalta = 0; r.diasPagados = baseDias
    return
  }
  const incaps = incapacidades || (permisos || []).filter(p => p.tipo === 'incapacidad')
  const esperados = _diasLaborablesEnRango(fechaInicio, fechaFin)
  const semanas = new Set()
  let faltas = 0
  for (const f of esperados) {
    if (presentes.has(f)) continue
    if (_tienePermisoLlegadaTarde(r.empleado_id, r.nombre, f, permisos)) continue   // llegó tarde, pero estuvo presente
    if (_tienePermisoDiaCompleto(r.empleado_id, r.nombre, f, permisos)) continue
    if (_diaEnIncapacidad(r.empleado_id, r.nombre, f, incaps)) continue   // incapacidad justifica
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
    const _penalFechasP = new Set()
    for (const d of r.dias) {
      if (d.entrada) { r.diasTrabajados++; presentes.add(d.fecha) }
      const _llegoTarde = _tienePermisoLlegadaTarde(r.empleado_id, r.nombre, d.fecha, permisosCache)
      r.totalTarde += _llegoTarde ? 0 : d.minutos_tarde
      r.totalHE += d.minutos_he
      r.totalNegativo += d.minutos_negativos
      if (d.sin_salida) {
        r.sinSalida.push(d.fecha)
        // Sin salida y SIN permiso que justifique el no marcaje → penalidad ½ día.
        // Justificado por permiso de salida, permiso de día completo, o día dentro de una incapacidad.
        const _justif = _horaSalidaPermiso(r.empleado_id, r.nombre, d.fecha, permisosCache) != null
          || _tienePermisoDiaCompleto(r.empleado_id, r.nombre, d.fecha, permisosCache)
          || _diaEnIncapacidad(r.empleado_id, r.nombre, String(d.fecha).slice(0, 10), incapacidadesCache || [])
        if (!_justif) { _penalFechasP.add(String(d.fecha).slice(0, 10)); if (Array.isArray(d.notas)) d.notas.push('½ día descontado (sin salida)') }
      }
    }
    r.diasSinSalidaPenal = _penalFechasP.size

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
    if (r.diasSinSalidaPenal > 0) r.alertas.push(`❌ ${r.diasSinSalidaPenal} día(s) sin salida sin permiso → ½ día descontado c/u`)

    // Séptimo día: días pagados según faltas injustificadas (Lun-Sáb sin entrada y sin permiso)
    if (fechaInicio && fechaFin) {
      _aplicarSeptimo(r, presentes, fechaInicio, fechaFin, baseDias || 15, permisosCache, incapacidadesCache)
    } else {
      r.diasPagados = r.diasTrabajados // sin rango no se puede evaluar el séptimo (compat.)
    }
    const _salPorFecha = {}
    for (const dd of r.dias) { if (dd.salidaMin != null) _salPorFecha[String(dd.fecha).slice(0, 10)] = dd.salidaMin }
    r.diasPermisoVac = _diasPermisoVac(r.empleado_id, r.nombre, permisosCache, _salPorFecha)
    r.diasPermisoSinGoce = _diasPermisoSinGoce(r.empleado_id, r.nombre, permisosCache, _salPorFecha)
    if (fechaInicio && fechaFin) {
      const incap = _incapacidadEnPeriodo(r.empleado_id, r.nombre, incapacidadesCache, fechaInicio, fechaFin)
      r.diasIncapacidad = incap.dias
      r.diasIncapEmpresa = incap.empresa
    } else { r.diasIncapacidad = 0; r.diasIncapEmpresa = 0 }
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
    <div class="stats-row" style="grid-template-columns:repeat(6,1fr)">
      <div class="stat-card"><div class="stat-num">${totalEmps}</div><div class="stat-label">Empleados</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green)">${Math.round(totalHE / 60 * 10) / 10}h</div><div class="stat-label">HE Netas</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red)">${totalTardes}min</div><div class="stat-label">Tardes a deducir</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${sinSalidaCount ? 'var(--red)' : 'var(--green)'}">${sinSalidaCount}</div><div class="stat-label">Sin salida</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${totalAlertas ? 'var(--amber)' : 'var(--green)'}">${totalAlertas}</div><div class="stat-label">Alertas</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="window.abrirNovedades()" title="Ver novedades del día (ayer/hoy)"><div class="stat-num" id="nov-count" style="color:var(--gold)">…</div><div class="stat-label">Novedades hoy ▸</div></div>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-top:6px">Período: ${fechaMin} al ${fechaMax}</div>`
  
  // Employee cards
  let html = ''
  for (const r of asistenciaResumen) {
    const heHoras = Math.round(r.heNeto / 60 * 10) / 10
    const matched = r.empleado_id ? '✅' : '⚠️'
    
    html += `
    <div data-nombre="${r.nombre.toUpperCase().replace(/"/g, '')}" style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:12px;overflow:hidden" id="ast-emp-${r.nombre.replace(/\s/g, '_')}">
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
  ensureBuscadorEmpleados()
  actualizarContadorNovedades()
  
  // Show action buttons
  document.getElementById('ast-acciones').classList.remove('hidden')
}

// ── BUSCADOR DE EMPLEADOS (filtra las tarjetas por nombre) ──
function ensureBuscadorEmpleados() {
  if (document.getElementById('ast-buscar')) return
  const cont = document.getElementById('ast-empleados')
  if (!cont || !cont.parentNode) return
  const wrap = document.createElement('div')
  wrap.style.margin = '4px 0 12px'
  wrap.innerHTML = `<input type="text" id="ast-buscar" placeholder="🔍 Buscar empleado…" oninput="window._filtrarEmpleados(this.value)" style="width:100%;max-width:360px;padding:7px 10px">`
  cont.parentNode.insertBefore(wrap, cont)
}
window._filtrarEmpleados = (q) => {
  const t = (q || '').trim().toUpperCase()
  document.querySelectorAll('#ast-empleados > div[data-nombre]').forEach(card => {
    card.style.display = (!t || card.getAttribute('data-nombre').includes(t)) ? '' : 'none'
  })
}

// ── NOVEDADES DEL DÍA (ayer/hoy, en vivo desde marcaciones_raw) ──
function _horaAMin(hora) {
  const p = String(hora).split(':')
  return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0)
}
function _addDaysStr(fecha, n) {
  const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() + n)
  return _localYMD(d)
}

async function calcularNovedades() {
  const sb = getSb()
  await loadConfig()
  const HORA_ENTRADA = 8 * 60, HORA_SALIDA_LV = 17 * 60
  const GRACIA_TARDE = configPlanilla.gracia_tarde_min || 30
  const hoy = new Date()
  const fHoy = _localYMD(hoy)
  // "Ayer" = ÚLTIMO día con marcajes antes de hoy (no el día anterior literal). Así el lunes
  // muestra el sábado, y tras un feriado muestra el último día efectivamente marcado.
  const { data: ultMarc } = await sb.from('marcaciones_raw')
    .select('fecha').lt('fecha', fHoy).order('fecha', { ascending: false }).limit(1)
  const fAyer = ultMarc?.[0]?.fecha || _addDaysStr(fHoy, -1)
  // Fin de jornada del día anterior: sábado 1:00pm, resto 5:00pm (para "salió temprano").
  const finAyer = new Date(fAyer + 'T12:00:00').getDay() === 6 ? 13 * 60 : HORA_SALIDA_LV
  const hace60 = _addDaysStr(fHoy, -60)

  const { data: mapas } = await sb.from('reloj_empleados').select('pin, empleado_nombre, activo')
  const mapaPin = {}
  for (const r of (mapas || [])) if (r.activo !== false && r.empleado_nombre) mapaPin[String(r.pin)] = r.empleado_nombre
  const { data: empleados } = await sb.from('empleados').select('id, nombre').eq('activo', true)
  const { data: permisos } = await sb.from('permisos_empleados').select('*').gte('fecha', hace60).lte('fecha', fHoy)
  const { data: marc } = await sb.from('marcaciones_raw').select('pin, fecha, hora').gte('fecha', fAyer).lte('fecha', fHoy).limit(20000)

  // Entrada/salida por empleado+día (mismo criterio que la planilla: corte mediodía)
  const dias = {}
  for (const mk of (marc || [])) {
    const nombre = mapaPin[String(mk.pin)]
    if (!nombre) continue
    const tm = _horaAMin(mk.hora)
    const key = nombre + '|' + mk.fecha
    if (!dias[key]) dias[key] = { nombre, fecha: mk.fecha, entradaMin: null, salidaMin: null, entrada: null, salida: null }
    const d = dias[key]
    if (tm < 720 && (d.entradaMin === null || tm < d.entradaMin)) { d.entradaMin = tm; d.entrada = String(mk.hora).slice(0, 5) }
    if (tm >= 720 && (d.salidaMin === null || tm > d.salidaMin)) { d.salidaMin = tm; d.salida = String(mk.hora).slice(0, 5) }
  }
  const tienePermiso = (nombre, fecha) => (permisos || []).some(p => {
    if (p.empleado_nombre?.toUpperCase() !== nombre.toUpperCase()) return false
    const ini = p.fecha
    const fin = p.fecha_fin || (p.dias > 1 ? _addDaysStr(p.fecha, p.dias - 1) : p.fecha)
    return fecha >= ini && fecha <= fin
  })
  const esLaboral = (fecha) => new Date(fecha + 'T12:00:00').getDay() !== 0  // domingo no

  const sinSalidaAyer = [], tardeHoy = [], ausentesHoy = [], conPermisoHoy = [], salioTempranoAyer = []

  if (esLaboral(fAyer)) {
    for (const key in dias) {
      const d = dias[key]
      if (d.fecha !== fAyer || tienePermiso(d.nombre, fAyer)) continue
      if (d.entrada && !d.salida) sinSalidaAyer.push({ nombre: d.nombre, entrada: d.entrada })
      else if (d.salida && d.salidaMin < finAyer) salioTempranoAyer.push({ nombre: d.nombre, salida: d.salida, min: finAyer - d.salidaMin })
    }
  }

  const presentesHoy = new Set()
  for (const key in dias) { const d = dias[key]; if (d.fecha === fHoy && d.entrada) presentesHoy.add(d.nombre.toUpperCase()) }
  if (esLaboral(fHoy)) {
    for (const key in dias) {
      const d = dias[key]
      if (d.fecha !== fHoy || !d.entrada) continue
      if (d.entradaMin > HORA_ENTRADA) {
        const min = d.entradaMin - HORA_ENTRADA
        tardeHoy.push({ nombre: d.nombre, entrada: d.entrada, min, excede: min > GRACIA_TARDE })
      }
    }
    const nombresMapeados = new Set(Object.values(mapaPin).map(n => n.toUpperCase()))
    for (const e of (empleados || [])) {
      const N = e.nombre.toUpperCase()
      if (!nombresMapeados.has(N)) continue          // sin PIN vinculado → no se puede saber
      if (presentesHoy.has(N)) continue
      if (tienePermiso(e.nombre, fHoy)) { conPermisoHoy.push({ nombre: e.nombre }); continue }
      ausentesHoy.push({ nombre: e.nombre })
    }
  }

  const byName = (a, b) => a.nombre.localeCompare(b.nombre)
  sinSalidaAyer.sort(byName); tardeHoy.sort((a, b) => b.min - a.min)
  ausentesHoy.sort(byName); conPermisoHoy.sort(byName); salioTempranoAyer.sort(byName)
  return { fHoy, fAyer, finAyerTxt: finAyer === 13 * 60 ? '1:00pm' : '5:00pm', sinSalidaAyer, tardeHoy, ausentesHoy, conPermisoHoy, salioTempranoAyer }
}

async function actualizarContadorNovedades() {
  try {
    const n = await calcularNovedades()
    _novedades = n
    const el = document.getElementById('nov-count')
    if (el) el.textContent = n.sinSalidaAyer.length + n.tardeHoy.length + n.ausentesHoy.length
  } catch (e) { console.warn('novedades:', e) }
}

function ensureNovedadesModal() {
  if (document.getElementById('modal-novedades')) return
  const div = document.createElement('div')
  div.className = 'modal-backdrop'; div.id = 'modal-novedades'
  div.innerHTML = `
    <div class="modal" style="width:min(560px,94vw);max-width:560px;max-height:88vh;display:flex;flex-direction:column">
      <div class="modal-header"><h3>📋 Novedades del día</h3><button class="modal-close" onclick="closeNovedades()">✕</button></div>
      <div class="modal-body" id="novedades-body" style="flex:1;min-height:0;overflow-y:auto">Cargando…</div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeNovedades()">Cerrar</button></div>
    </div>`
  document.body.appendChild(div)
}
window.closeNovedades = () => { const m = document.getElementById('modal-novedades'); if (m) m.classList.remove('open') }

function renderNovedades(n) {
  const linea = (txt, extra = '') => `<div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:5px 9px;background:var(--bg2);border-radius:6px"><span>${txt}</span><span style="color:var(--text3);font-family:var(--mono);font-size:12px">${extra}</span></div>`
  const sec = (color, icono, titulo, items, fmtItem, vacio) => `
    <div style="margin-bottom:16px">
      <div style="font-weight:600;color:${color};margin-bottom:6px">${icono} ${titulo} (${items.length})</div>
      ${items.length ? `<div style="display:flex;flex-direction:column;gap:4px">${items.map(fmtItem).join('')}</div>` : `<div style="font-size:12px;color:var(--text3);padding:2px 0">${vacio}</div>`}
    </div>`
  return `
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Hoy: <strong>${n.fHoy}</strong> · Día anterior marcado: <strong>${n.fAyer}</strong></div>
    ${sec('var(--red)', '🚪', 'No marcó SALIDA el día anterior — citar a firmar deducción', n.sinSalidaAyer, d => linea(d.nombre, 'entró ' + d.entrada), 'Nadie ✓')}
    ${sec('var(--amber)', '⏰', 'Llegó TARDE hoy', n.tardeHoy, d => linea(d.nombre + (d.excede ? ' ⚠️ excede gracia' : ''), d.entrada + ' · ' + d.min + 'min'), 'Nadie ✓')}
    ${sec('var(--text2)', '🚫', 'No marcó ENTRADA hoy — ausente / no ha llegado', n.ausentesHoy, d => linea(d.nombre), 'Todos presentes ✓')}
    ${n.salioTempranoAyer.length ? sec('var(--amber)', '🏃', `Salió temprano el día anterior (antes de ${n.finAyerTxt})`, n.salioTempranoAyer, d => linea(d.nombre, 'salió ' + d.salida + ' · ' + d.min + 'min antes'), '') : ''}
    ${sec('#60a5fa', '🔓', 'Con permiso / incapacidad hoy (informativo)', n.conPermisoHoy, d => linea(d.nombre), '—')}`
}

window.abrirNovedades = async () => {
  ensureNovedadesModal()
  document.getElementById('modal-novedades').classList.add('open')
  const body = document.getElementById('novedades-body')
  body.innerHTML = 'Cargando…'
  const n = _novedades || await calcularNovedades()
  _novedades = n
  body.innerHTML = renderNovedades(n)
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
  const GRACIA_HE = configPlanilla.he_gracia_lv_min || 30
  const bounds = _periodoBounds(parseInt(anio), parseInt(mes), quincena)

  // Permisos del período (justifican faltas → conservan el domingo)
  const { data: permisos } = await getSb().from('permisos_empleados')
    .select('*').gte('fecha', bounds.inicio).lte('fecha', bounds.fin)

  // Incapacidades: se traen TODAS (sin filtro de fecha) porque un episodio puede
  // empezar en otra quincena y/o encadenarse (continua_de) para el conteo 100%/34%.
  const { data: incapacidades } = await getSb().from('permisos_empleados')
    .select('*').eq('tipo', 'incapacidad')

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
        totalTarde: 0, totalHE: 0, totalNeg: 0, diasTrabajados: 0, sinSalida: [], diasSinSalidaPenal: 0, sinSalidaPenalFechas: new Set(), alertas: [],
        presentes: new Set(), salidaPorFecha: {}, es_socio: !!sociosMap[r.empleado_id] }
    }
    const e = byEmp[r.empleado_nombre]
    // HE del día: usa la salida marcada; si no marcó salida pero estuvo presente, usa la
    // hora de salida justificada por un permiso (ej. encomienda → trabajó hasta esa hora).
    let _salidaHE = r.hora_salida ? _horaAMin(r.hora_salida) : null
    if (_salidaHE == null && r.hora_entrada) {
      _salidaHE = _horaSalidaPermiso(r.empleado_id, r.empleado_nombre, r.fecha, permisos || [])
    }
    r.minutos_he = _salidaHE != null ? heMinutosDia(r.dia_semana, _salidaHE, GRACIA_HE) : 0
    if (r.hora_salida) e.salidaPorFecha[String(r.fecha).slice(0, 10)] = _horaAMin(r.hora_salida)
    if (r.hora_entrada) { e.diasTrabajados++; e.presentes.add(r.fecha) }
    // Un permiso de "llegada tarde justificada" gobierna ese día (goce / sin goce / vacaciones):
    // no se aplica el descuento automático por tardanza para no duplicar el cobro.
    const _llegoTarde = _tienePermisoLlegadaTarde(r.empleado_id, r.nombre, r.fecha, permisos || [])
    e.totalTarde += _llegoTarde ? 0 : (r.minutos_tarde || 0)
    e.totalHE += r.minutos_he || 0
    e.totalNeg += r.minutos_negativos || 0
    if (r.sin_salida) {
      e.sinSalida.push(r.fecha)
      // Entrada SIN salida y SIN permiso que justifique el no marcaje → penalidad fija de ½ día.
      // Se considera justificado si: hay permiso que cubra la salida (hora_salida, ej. encomienda),
      // un permiso de día completo, o el día cae dentro de una INCAPACIDAD (se fue al seguro).
      // Un permiso de "llegada tarde" NO justifica el no marcar salida.
      const _fYMD = String(r.fecha).slice(0, 10)
      const _justif = _horaSalidaPermiso(r.empleado_id, r.empleado_nombre, r.fecha, permisos || []) != null
        || _tienePermisoDiaCompleto(r.empleado_id, r.empleado_nombre, r.fecha, permisos || [])
        || _diaEnIncapacidad(r.empleado_id, r.empleado_nombre, _fYMD, incapacidades || [])
      if (!_justif) e.sinSalidaPenalFechas.add(_fYMD)   // por FECHA, no por fila (filas duplicadas no inflan)
    }
  }

  const out = []
  for (const e of Object.values(byEmp)) {
    e.tardeDeducir = e.totalTarde > GRACIA_TARDE ? e.totalTarde : 0
    e.heNeto = e.totalHE                              // HE en bruto (sin neteo)
    e.minNoTrabajados = e.totalNeg                    // salidas tempranas SIN permiso → descuento de sueldo
    e.diasSinSalidaPenal = e.sinSalidaPenalFechas.size
    if (e.diasSinSalidaPenal > 0) e.alertas.push(`❌ ${e.diasSinSalidaPenal} día(s) sin salida sin permiso → ½ día descontado c/u`)
    _aplicarSeptimo(e, e.presentes, bounds.inicio, bounds.fin, bounds.base, permisos || [], incapacidades || [])
    e.diasPermisoVac = _diasPermisoVac(e.empleado_id, e.nombre, permisos || [], e.salidaPorFecha)
    e.diasPermisoSinGoce = _diasPermisoSinGoce(e.empleado_id, e.nombre, permisos || [], e.salidaPorFecha)
    const incap = _incapacidadEnPeriodo(e.empleado_id, e.nombre, incapacidades || [], bounds.inicio, bounds.fin)
    e.diasIncapacidad = incap.dias
    e.diasIncapEmpresa = incap.empresa
    out.push(e)
  }
  return out
}

// ── PERMISOS / INCAPACIDADES ──
// ── Filtro de búsqueda para el desplegable de empleados del permiso ──
let permEmpleados = []

function renderPermEmpleadosOptions(q) {
  const sel = document.getElementById('perm-nombre')
  if (!sel) return
  const query = (q || '').trim().toUpperCase()
  const prev = sel.value
  const lista = permEmpleados.filter(e => !query || (e.nombre || '').toUpperCase().includes(query))
  sel.innerHTML = '<option value="">— Seleccionar empleado —</option>' +
    lista.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('')
  if (prev && lista.some(e => String(e.id) === String(prev))) sel.value = prev
}

function ensurePermBuscador() {
  if (document.getElementById('perm-buscar')) return
  const sel = document.getElementById('perm-nombre')
  if (!sel) return
  const inp = document.createElement('input')
  inp.type = 'text'
  inp.id = 'perm-buscar'
  inp.placeholder = 'Buscar empleado...'
  inp.autocomplete = 'off'
  inp.style.marginBottom = '6px'
  inp.addEventListener('input', () => renderPermEmpleadosOptions(inp.value))
  sel.parentNode.insertBefore(inp, sel)
}

window.openPermisoEmpleado = async () => {
  const { data: emps } = await getSb().from('empleados')
    .select('id, nombre').eq('activo', true).order('nombre')
  permEmpleados = emps || []
  ensurePermBuscador()
  const bq = document.getElementById('perm-buscar'); if (bq) bq.value = ''
  renderPermEmpleadosOptions('')
  document.getElementById('perm-fecha').value = ''
  document.getElementById('perm-hora').value = ''
  document.getElementById('perm-motivo').value = ''
  document.getElementById('perm-tipo').value = 'salida_anticipada'
  { const t = document.getElementById('perm-tratamiento'); if (t) t.value = 'sin_goce' }
  document.getElementById('perm-dias').value = ''
  document.getElementById('perm-diagnostico').value = ''
  document.getElementById('perm-continuacion').checked = false
  document.getElementById('perm-continua-de').innerHTML = ''
  onPermTipoChange()
  document.getElementById('modal-permiso-emp').classList.add('open')
}

// Muestra/oculta campos según el tipo seleccionado.
window.onPermTipoChange = () => {
  const tipo = document.getElementById('perm-tipo').value
  const esIncap = tipo === 'incapacidad'
  document.getElementById('fld-perm-incap').style.display = esIncap ? '' : 'none'
  document.getElementById('fld-perm-hora').style.display = esIncap ? 'none' : ''
  document.getElementById('fld-perm-acuenta').style.display = esIncap ? 'none' : ''
  document.getElementById('perm-fecha-label').textContent = esIncap ? 'Fecha de inicio' : 'Fecha'
  // La misma casilla de hora significa "salida" (salida anticipada) o "entrada" (llegada tarde)
  const lblHora = document.querySelector('#fld-perm-hora label')
  if (lblHora) lblHora.textContent = tipo === 'llegada_tarde' ? 'Hora de entrada (a la que llegó)' : 'Hora de salida'
  if (esIncap) onPermContinuacionChange()
}

// Al marcar "continuación", carga las incapacidades previas de ese empleado para enlazar.
window.onPermContinuacionChange = async () => {
  const chk = document.getElementById('perm-continuacion').checked
  const cont = document.getElementById('fld-perm-continua-de')
  cont.style.display = chk ? '' : 'none'
  if (!chk) return
  const empleadoId = document.getElementById('perm-nombre').value
  const selDe = document.getElementById('perm-continua-de')
  selDe.innerHTML = ''
  if (!empleadoId) {
    selDe.innerHTML = '<option value="">— Seleccioná primero el empleado —</option>'
    return
  }
  const { data: previas } = await getSb().from('permisos_empleados')
    .select('id, fecha, dias, diagnostico')
    .eq('empleado_id', empleadoId).eq('tipo', 'incapacidad')
    .order('fecha', { ascending: false }).limit(20)
  if (!previas?.length) {
    selDe.innerHTML = '<option value="">— No hay incapacidades previas —</option>'
    return
  }
  selDe.innerHTML = '<option value="">— Seleccionar incapacidad previa —</option>'
  for (const p of previas) {
    const o = document.createElement('option')
    o.value = p.id
    o.textContent = `${p.fecha} · ${p.dias || '?'} día(s)${p.diagnostico ? ' · ' + p.diagnostico : ''}`
    selDe.appendChild(o)
  }
}

window.guardarPermiso = async () => {
  const sel = document.getElementById('perm-nombre')
  const empleadoId = sel.value
  const nombre = empleadoId ? sel.options[sel.selectedIndex].text : ''
  const fecha = document.getElementById('perm-fecha').value
  const horaSalida = document.getElementById('perm-hora').value
  const motivo = document.getElementById('perm-motivo').value.trim()
  const tipo = document.getElementById('perm-tipo').value

  if (!empleadoId || !fecha) { window.toast?.('Seleccioná el empleado y la fecha', 'error'); return }

  // Aviso anti-error AM/PM: una hora de salida antes de las 8:00am es de madrugada
  // (imposible salir antes de entrar). Casi siempre es PM mal capturado (ej. 04:00 → 16:00),
  // y descontaría casi todo el día sin goce. Confirmar antes de guardar.
  if (tipo !== 'incapacidad' && tipo !== 'llegada_tarde' && horaSalida && _horaAMin(horaSalida) < 8 * 60) {
    const hh = parseInt(horaSalida.split(':')[0], 10) || 0
    const mm = horaSalida.split(':')[1] || '00'
    const pm = String(hh + 12).padStart(2, '0') + ':' + mm
    if (!confirm(`La hora de salida ${horaSalida} es de madrugada (antes de las 8:00am).\n¿Quizás querías ${pm} (PM)?\n\nAceptar = guardar ${horaSalida} de todos modos\nCancelar = volver y corregir`)) return
  }

  const reg = {
    empleado_id: empleadoId,
    empleado_nombre: nombre.toUpperCase(),
    fecha,
    motivo,
    tipo,
    aprobado_por: window._currentProfile?.()?.nombre || ''
  }

  if (tipo === 'incapacidad') {
    const dias = parseInt(document.getElementById('perm-dias').value) || 0
    if (dias < 1) { window.toast?.('Ingresá los días de incapacidad', 'error'); return }
    const esCont = document.getElementById('perm-continuacion').checked
    const continuaDe = document.getElementById('perm-continua-de').value || null
    if (esCont && !continuaDe) { window.toast?.('Seleccioná de cuál incapacidad continúa', 'error'); return }
    reg.dias = dias
    reg.diagnostico = document.getElementById('perm-diagnostico').value.trim() || null
    reg.es_continuacion = esCont
    reg.continua_de = esCont ? continuaDe : null
    reg.hora_salida = null
    reg.a_cuenta_vacaciones = false   // la incapacidad nunca toca vacaciones
    reg.tratamiento = 'incapacidad'
  } else {
    if (tipo === 'llegada_tarde') {
      reg.hora_entrada = horaSalida || null   // la casilla de hora = hora de entrada en este tipo
      reg.hora_salida = null
    } else {
      reg.hora_salida = horaSalida || null
    }
    const trat = document.getElementById('perm-tratamiento')?.value || 'sin_goce'
    reg.tratamiento = trat
    reg.a_cuenta_vacaciones = (trat === 'vacaciones')   // compatibilidad con lógica/exportes viejos
  }

  const { error } = await getSb().from('permisos_empleados').insert(reg)

  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
  window.closeModal('modal-permiso-emp')
  window.toast?.(tipo === 'incapacidad' ? 'Incapacidad registrada ✓' : 'Permiso registrado ✓', 'success')
  // Auditoría
  const _tlPerm = { salida_anticipada: 'Salida anticipada', falta_justificada: 'Falta justificada', permiso_dia: 'Permiso día completo', incapacidad: 'Incapacidad (IHSS)', llegada_tarde: 'Llegada tarde justificada' }
  const _detPerm = tipo === 'incapacidad'
    ? `${reg.empleado_nombre} · ${fecha} · ${_tlPerm[tipo]} · ${reg.dias || 0} día(s)${reg.diagnostico ? ' · ' + reg.diagnostico : ''}`
    : `${reg.empleado_nombre} · ${fecha} · ${_tlPerm[tipo] || tipo}${reg.hora_salida ? ' · ' + reg.hora_salida : ''}${reg.tratamiento ? ' · ' + reg.tratamiento : ''}`
  window.logActividad?.('permiso_creado', 'rrhh', _detPerm)
  cargarPermisos()
}

async function cargarPermisos() {
  // Filtro por empleado: con empleado seleccionado se consultan TODOS sus
  // permisos en el servidor; sin filtro, los últimos 50 como siempre
  const filtroNombre = document.getElementById('filtro-perm-empleado')?.value || ''
  let q = getSb().from('permisos_empleados').select('*').order('fecha', { ascending: false })
  q = filtroNombre ? q.eq('empleado_nombre', filtroNombre).limit(300) : q.limit(50)
  const { data } = await q

  const tbody = document.getElementById('tbody-permisos')
  if (!tbody) return

  await _ensureFiltroPermisos(filtroNombre)
  
  const tipoLabel = { salida_anticipada: 'Salida anticipada', falta_justificada: 'Falta justificada', permiso_dia: 'Permiso día completo', incapacidad: 'Incapacidad (IHSS)', llegada_tarde: 'Llegada tarde justificada' }

  _permisosLista = data || []
  tbody.innerHTML = (data || []).map(p => `
    <tr style="cursor:pointer" onclick="window.verPermiso('${p.id}')">
      <td>${p.fecha}</td>
      <td><strong>${p.empleado_nombre}</strong></td>
      <td>${p.tipo === 'incapacidad' ? (p.dias ? p.dias + ' día(s)' : '—') : (p.hora_salida || '—')}</td>
      <td><span class="badge badge-blue" style="font-size:10px">${tipoLabel[p.tipo] || p.tipo}</span>${p.a_cuenta_vacaciones ? ' <span title="A cuenta de vacaciones">🏖️</span>' : ''}${p.tipo === 'incapacidad' ? ' 🏥' : ''}${p.es_continuacion ? ' <span title="Continuación/prórroga IHSS">🔗</span>' : ''}</td>
      <td style="font-size:12px;color:var(--text3)">${p.tipo === 'incapacidad' && p.diagnostico ? p.diagnostico : (p.motivo || '—')}</td>
      <td style="font-size:11px;color:var(--text3)">${p.aprobado_por || '—'}</td>
      <td><button class="btn btn-ghost" style="padding:2px 6px;font-size:11px;color:var(--red)" onclick="event.stopPropagation(); eliminarPermiso('${p.id}')">✕</button></td>
    </tr>
  `).join('') || `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">${filtroNombre ? 'Este empleado no tiene permisos registrados' : 'No hay permisos registrados'}</td></tr>`
}

// Inyecta (una sola vez) el selector de empleado arriba de la tabla de permisos
// y lo puebla con los nombres que tienen permisos presentados
async function _ensureFiltroPermisos(seleccionado) {
  let sel = document.getElementById('filtro-perm-empleado')
  if (!sel) {
    const tbody = document.getElementById('tbody-permisos')
    const tabla = tbody?.closest('table')
    if (!tabla || !tabla.parentNode) return
    const cont = document.createElement('div')
    cont.id = 'filtro-perm-cont'
    cont.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 0 8px'
    cont.innerHTML = `<span style="font-size:11px;color:var(--text3);letter-spacing:1px">EMPLEADO</span>
      <select id="filtro-perm-empleado" onchange="window._onFiltroPermisos()" style="max-width:300px;font-size:12px"></select>`
    tabla.parentNode.insertBefore(cont, tabla)
    sel = document.getElementById('filtro-perm-empleado')
  }
  const { data: noms } = await getSb().from('permisos_empleados').select('empleado_nombre').limit(2000)
  const unicos = [...new Set((noms || []).map(x => (x.empleado_nombre || '').trim()).filter(Boolean))].sort()
  const val = seleccionado || ''
  sel.innerHTML = `<option value="">Todos (${unicos.length} empleados con permisos)</option>` +
    unicos.map(n => `<option value="${n.replace(/"/g, '&quot;')}"${n === val ? ' selected' : ''}>${n}</option>`).join('')
}
window._onFiltroPermisos = () => cargarPermisos()

window.eliminarPermiso = async (id) => {
  if (!confirm('¿Eliminar este permiso?')) return
  // Capturar los datos ANTES de borrar, para dejar rastro de qué se eliminó
  const _p = (_permisosLista || []).find(x => x.id === id) || null
  await getSb().from('permisos_empleados').delete().eq('id', id)
  window.toast?.('Permiso eliminado', 'success')
  // Auditoría
  if (_p) {
    const _tlPerm = { salida_anticipada: 'Salida anticipada', falta_justificada: 'Falta justificada', permiso_dia: 'Permiso día completo', incapacidad: 'Incapacidad (IHSS)', llegada_tarde: 'Llegada tarde justificada' }
    const _ex = _p.tipo === 'incapacidad' ? ` · ${_p.dias || 0} día(s)` : (_p.hora_salida ? ` · ${_p.hora_salida}` : '')
    window.logActividad?.('permiso_eliminado', 'rrhh', `${_p.empleado_nombre} · ${_p.fecha} · ${_tlPerm[_p.tipo] || _p.tipo}${_ex}${_p.motivo ? ' · ' + _p.motivo : ''}`)
  } else {
    window.logActividad?.('permiso_eliminado', 'rrhh', `Permiso ${id} eliminado`)
  }
  cargarPermisos()
}

// ── Modal de detalle de permiso (clic en la fila) ──
function ensurePermisoModal() {
  if (document.getElementById('modal-ver-permiso')) return
  const div = document.createElement('div')
  div.className = 'modal-backdrop'; div.id = 'modal-ver-permiso'
  div.innerHTML = `
    <div class="modal" style="width:min(520px,94vw);max-width:520px">
      <div class="modal-header"><h3>📄 Detalle del permiso</h3><button class="modal-close" onclick="closeVerPermiso()">✕</button></div>
      <div class="modal-body" id="ver-permiso-body"></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeVerPermiso()">Cerrar</button></div>
    </div>`
  document.body.appendChild(div)
}

window.closeVerPermiso = () => { const m = document.getElementById('modal-ver-permiso'); if (m) m.classList.remove('open') }

window.verPermiso = (id) => {
  const p = _permisosLista.find(x => String(x.id) === String(id))
  if (!p) return
  ensurePermisoModal()
  const tipoLabel = { salida_anticipada: 'Salida anticipada', falta_justificada: 'Falta justificada', permiso_dia: 'Permiso día completo', incapacidad: 'Incapacidad (IHSS)', llegada_tarde: 'Llegada tarde justificada' }
  const fila = (lbl, val) => (val == null || val === '') ? '' :
    `<div style="display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text3);font-size:13px">${lbl}</span><span style="font-weight:500;text-align:right">${val}</span></div>`
  document.getElementById('ver-permiso-body').innerHTML =
    fila('Empleado', p.empleado_nombre) +
    fila('Tipo', tipoLabel[p.tipo] || p.tipo) +
    fila('Fecha', p.fecha) +
    fila('Fecha fin', (p.fecha_fin && p.fecha_fin !== p.fecha) ? p.fecha_fin : '') +
    (p.tipo === 'incapacidad' ? fila('Días', p.dias) : '') +
    (p.tipo === 'salida_anticipada' ? fila('Hora salida', p.hora_salida) : '') +
    (p.tipo === 'salida_anticipada' ? fila('Hora entrada', p.hora_entrada) : '') +
    (p.tipo === 'llegada_tarde' ? fila('Hora de entrada', p.hora_entrada) : '') +
    (p.tipo === 'incapacidad' ? fila('Diagnóstico', p.diagnostico) : '') +
    fila('Motivo', p.motivo) +
    fila('Tratamiento', ({goce:'Con goce de sueldo', vacaciones:'A cuenta de vacaciones 🏖️', sin_goce:'Sin goce (descuenta salario)'})[_tratamiento(p)] || '') +
    fila('Continuación/prórroga', p.es_continuacion ? 'Sí 🔗' : '') +
    fila('Aprobado por', p.aprobado_por) +
    fila('Registrado', p.created_at ? new Date(p.created_at).toLocaleString('es-HN') : '')
  document.getElementById('modal-ver-permiso').classList.add('open')
}

window.loadAsistencia = async () => {
  await cargarPermisos()
  const q = document.getElementById('reloj-quincena')
  if (q) q.value = new Date().getDate() <= 15 ? 'Q1' : 'Q2'
  // Load available periods
  await cargarPeriodosHistorial()
  ensureMapeoPinsLauncher()
  ensureRelojOnlineControls()
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
  const GRACIA_HE = configPlanilla.he_gracia_lv_min || 30

  // Group by employee
  const byEmp = {}
  for (const r of data) {
    if (!byEmp[r.empleado_nombre]) {
      byEmp[r.empleado_nombre] = { nombre: r.empleado_nombre, empleado_id: r.empleado_id, dias: [],
        totalTarde: 0, totalHE: 0, totalNeg: 0, diasTrabajados: 0, sinSalida: [], alertas: [],
        presentes: new Set(), diasPagados: 0, faltasInjustificadas: 0, semanasConFalta: 0, faltasDetalle: [] }
    }
    const e = byEmp[r.empleado_nombre]
    r.minutos_he = r.hora_salida ? heMinutosDia(r.dia_semana, _horaAMin(r.hora_salida), GRACIA_HE) : 0
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
  const { data: incapsHist } = await getSb().from('permisos_empleados')
    .select('*').eq('tipo', 'incapacidad')
  for (const e of Object.values(byEmp)) {
    e.es_socio = !!sociosMap[e.empleado_id]
    // HE: si un día no tuvo salida marcada pero el empleado estuvo presente, usar la hora de
    // salida justificada por un permiso (ej. encomienda → trabajó hasta esa hora) para el extra.
    e.diasSinSalidaPenal = 0
    const _penalFechasH = new Set()
    for (const dd of (e.dias || [])) {
      if (!dd.hora_salida && dd.hora_entrada) {
        const ps = _horaSalidaPermiso(e.empleado_id, e.nombre, dd.fecha, permisosPeriodo || [])
        if (ps != null) {
          const nuevoHE = heMinutosDia(dd.dia_semana, ps, GRACIA_HE)
          e.totalHE += (nuevoHE - (dd.minutos_he || 0))
          dd.minutos_he = nuevoHE
        }
        // Sin salida y SIN permiso que justifique el no marcaje → penalidad ½ día (igual que en planilla).
        // Justificado por permiso de salida, permiso de día completo, o día dentro de una incapacidad.
        const _justif = ps != null
          || _tienePermisoDiaCompleto(e.empleado_id, e.nombre, dd.fecha, permisosPeriodo || [])
          || _diaEnIncapacidad(e.empleado_id, e.nombre, String(dd.fecha).slice(0, 10), incapsHist || [])
        if (!_justif) { _penalFechasH.add(String(dd.fecha).slice(0, 10)); dd.notas = (dd.notas ? dd.notas + ' · ' : '') + '½ día descontado (sin salida)' }
      }
    }
    e.diasSinSalidaPenal = _penalFechasH.size
    if (e.diasSinSalidaPenal > 0) e.alertas.push(`❌ ${e.diasSinSalidaPenal} día(s) sin salida sin permiso → ½ día descontado c/u`)
    e.heNeto = e.totalHE
    _aplicarSeptimo(e, e.presentes, histBounds.inicio, histBounds.fin, histBounds.base, permisosPeriodo || [], incapsHist || [])
    const _salPorFecha = {}
    for (const dd of (e.dias || [])) { if (dd.hora_salida) _salPorFecha[String(dd.fecha).slice(0, 10)] = _horaAMin(dd.hora_salida) }
    e.diasPermisoVac = _diasPermisoVac(e.empleado_id, e.nombre, permisosPeriodo || [], _salPorFecha)
    e.diasPermisoSinGoce = _diasPermisoSinGoce(e.empleado_id, e.nombre, permisosPeriodo || [], _salPorFecha)
    const incap = _incapacidadEnPeriodo(e.empleado_id, e.nombre, incapsHist || [], histBounds.inicio, histBounds.fin)
    e.diasIncapacidad = incap.dias
    e.diasIncapEmpresa = incap.empresa
    // El ícono "🔓 Permiso" se guardaba al importar la asistencia; si el permiso se registró
    // DESPUÉS, el flag quedaba en false y no se veía (caso Omar). Recalcular contra los
    // permisos / incapacidades ACTUALES para que el ícono siempre refleje la realidad.
    for (const dd of (e.dias || [])) {
      const _f = String(dd.fecha).slice(0, 10)
      dd.tiene_permiso = (permisosPeriodo || []).some(p => _matchEmpleado(e.empleado_id, e.nombre, p) && String(p.fecha).slice(0, 10) === _f)
        || _diaEnIncapacidad(e.empleado_id, e.nombre, _f, incapsHist || [])
    }
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
  const keys = ['ihss_techo_mensual', 'ihss_pct_laboral', 'ihss_pct_patronal', 'gracia_tarde_min', 'he_gracia_lv_min', 'he_bloque_min', 'bono_educativo_monto', 'bono_educativo_tope', 'bono_educativo_anio']
  const labels = {
    ihss_techo_mensual: 'Techo IHSS mensual (L.)',
    ihss_pct_laboral: 'IHSS % laboral (ej: 0.025 = 2.5%)',
    ihss_pct_patronal: 'IHSS % patronal (ej: 0.05 = 5%)',
    gracia_tarde_min: 'Gracia tardes (min/quincena)',
    he_gracia_lv_min: 'Gracia HE Lun-Vie (min después de 5PM)',
    he_bloque_min: 'Bloque HE (min)',
    bono_educativo_monto: 'Bono educativo: monto anual (L.)',
    bono_educativo_tope: 'Bono educativo: tope salarial (2 sal. mín.)',
    bono_educativo_anio: 'Bono educativo: año vigente'
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
  const keys = ['ihss_techo_mensual', 'ihss_pct_laboral', 'ihss_pct_patronal', 'gracia_tarde_min', 'he_gracia_lv_min', 'he_bloque_min', 'bono_educativo_monto', 'bono_educativo_tope', 'bono_educativo_anio']
  for (const k of keys) {
    const val = parseFloat(document.getElementById(`cfg-${k}`).value) || 0
    await getSb().from('config_planilla').upsert({ clave: k, valor: val, updated_at: new Date().toISOString() }, { onConflict: 'clave' })
    configPlanilla[k] = val
  }
  window.toast?.('Configuración guardada ✓', 'success')
  loadConfigPlanilla()
}

// ══════════════════════════════════════════════
// ── MAPEO PIN DEL RELOJ ↔ EMPLEADO (tabla reloj_empleados)
//    Autoinyecta botón + modal. Lista los PIN vistos en marcaciones_raw
//    y permite asignar a cada uno el empleado (mismo nombre que planilla).
// ══════════════════════════════════════════════
let _empleadosMapeo = []

function ensureMapeoPinsLauncher() {
  if (document.getElementById('btn-mapeo-pins')) return
  const anchor = document.getElementById('reloj-quincena') || document.getElementById('reloj-file')
  if (!anchor || !anchor.parentNode) return
  const btn = document.createElement('button')
  btn.id = 'btn-mapeo-pins'; btn.type = 'button'
  btn.className = 'btn btn-ghost'; btn.style.margin = '8px 0'
  btn.textContent = '🔢 Vincular PIN ↔ empleado (reloj)'
  btn.onclick = () => window.abrirMapeoPins()
  anchor.parentNode.insertBefore(btn, anchor.nextSibling)
}

function ensureMapeoPinsModal() {
  if (document.getElementById('modal-reloj-pins')) return
  const div = document.createElement('div')
  div.className = 'modal-backdrop'; div.id = 'modal-reloj-pins'
  div.innerHTML = `
    <div class="modal" style="width:min(720px,94vw);max-width:720px;max-height:88vh;display:flex;flex-direction:column">
      <div class="modal-header"><h3>🔢 Vincular PIN del reloj ↔ empleado</h3><button class="modal-close" onclick="closeMapeoPins()">✕</button></div>
      <div class="modal-body" style="flex:1;min-height:0;overflow-y:auto">
        <div style="font-size:12px;color:var(--text3);margin-bottom:10px">Asigná a cada PIN del reloj su empleado (el mismo nombre que usás en la planilla). Se guarda al elegir.</div>
        <div id="mapeo-pins-resultado">Cargando…</div>
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeMapeoPins()">Cerrar</button></div>
    </div>`
  document.body.appendChild(div)
}

window.closeMapeoPins = () => { const m = document.getElementById('modal-reloj-pins'); if (m) m.classList.remove('open') }

window.abrirMapeoPins = async () => {
  ensureMapeoPinsModal()
  document.getElementById('modal-reloj-pins').classList.add('open')
  await cargarMapeoPins()
}

// Trae TODOS los PIN de marcaciones_raw (paginando) con su conteo
async function _conteoPins(sb) {
  const conteo = {}
  const size = 1000
  let from = 0
  for (let i = 0; i < 30; i++) {
    const { data, error } = await sb.from('marcaciones_raw').select('pin').range(from, from + size - 1)
    if (error || !data || !data.length) break
    for (const m of data) conteo[m.pin] = (conteo[m.pin] || 0) + 1
    if (data.length < size) break
    from += size
  }
  return conteo
}

async function cargarMapeoPins() {
  const cont = document.getElementById('mapeo-pins-resultado')
  if (!cont) return
  cont.innerHTML = 'Cargando…'
  const sb = getSb()
  const conteo = await _conteoPins(sb)
  const { data: emps } = await sb.from('empleados').select('id, nombre').eq('activo', true).order('nombre')
  _empleadosMapeo = emps || []
  const { data: mapas } = await sb.from('reloj_empleados').select('pin, empleado_id, empleado_nombre, activo')
  const mapaPorPin = {}
  for (const r of (mapas || [])) mapaPorPin[String(r.pin)] = r

  const pins = [...new Set([...Object.keys(conteo), ...Object.keys(mapaPorPin)])]
    .sort((a, b) => (conteo[b] || 0) - (conteo[a] || 0) || a.localeCompare(b, undefined, { numeric: true }))

  const optEmp = (selId) => `<option value="">— sin asignar —</option>` +
    _empleadosMapeo.map(e => `<option value="${e.id}" ${selId === e.id ? 'selected' : ''}>${e.nombre}</option>`).join('')

  const asignados = pins.filter(p => mapaPorPin[p]?.empleado_id).length
  cont.innerHTML = `
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px">${pins.length} PIN en el reloj · ${asignados} ya vinculados</div>
    <div class="table-wrap"><table style="width:100%"><thead><tr>
      <th style="width:60px">PIN</th><th style="width:70px;text-align:right">Marcas</th><th>Empleado</th>
    </tr></thead><tbody>
    ${pins.map(pin => `<tr>
      <td style="font-family:var(--mono);font-weight:600">${pin}</td>
      <td style="text-align:right;color:var(--text3);font-size:12px">${conteo[pin] || 0}</td>
      <td><select style="width:100%;padding:4px 6px" onchange="window.guardarMapeoPin('${pin}', this.value)">${optEmp(mapaPorPin[pin]?.empleado_id || '')}</select></td>
    </tr>`).join('')}
    </tbody></table></div>`
}

window.guardarMapeoPin = async (pin, empleadoId) => {
  const sb = getSb()
  if (!empleadoId) {
    await sb.from('reloj_empleados').delete().eq('pin', pin)
    window.toast?.(`PIN ${pin}: sin asignar`, 'info')
    return
  }
  const emp = _empleadosMapeo.find(e => e.id === empleadoId)
  const { error } = await sb.from('reloj_empleados')
    .upsert({ pin, empleado_id: empleadoId, empleado_nombre: emp?.nombre || null, activo: true }, { onConflict: 'pin' })
  if (error) window.toast?.('Error: ' + error.message, 'error')
  else window.toast?.(`PIN ${pin} → ${emp?.nombre}`, 'success')
}

// ══════════════════════════════════════════════
// ── CARGAR DEL RELOJ (EN LÍNEA): lee marcaciones_raw del mes/quincena,
//    resuelve nombre por PIN (reloj_empleados) y lo pasa por el MISMO
//    motor que el archivo (processTimeClock → calcularAsistencia → resumen).
// ══════════════════════════════════════════════
function ensureRelojOnlineControls() {
  if (document.getElementById('btn-reloj-online')) return
  const anchor = document.getElementById('reloj-quincena') || document.getElementById('reloj-file')
  if (!anchor || !anchor.parentNode) return
  const now = new Date()
  const mesDefault = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0'
  wrap.innerHTML = `
    <label style="font-size:13px;color:var(--text2)">Mes:</label>
    <input type="month" id="reloj-online-mes" value="${mesDefault}" style="padding:4px 6px">
    <button id="btn-reloj-online" type="button" class="btn btn-primary">📲 Cargar del reloj (en línea)</button>`
  anchor.parentNode.insertBefore(wrap, anchor.nextSibling)
  document.getElementById('btn-reloj-online').onclick = () => window.procesarRelojOnline()
}

window.procesarRelojOnline = async () => {
  const quincena = document.getElementById('reloj-quincena')?.value || 'Q1'
  const mes = document.getElementById('reloj-online-mes')?.value
  if (!mes) { window.toast?.('Elegí un mes', 'error'); return }
  const [anio, m] = mes.split('-').map(Number)
  const finDia = new Date(anio, m, 0).getDate()
  const desde = quincena === 'Q1' ? `${mes}-01` : `${mes}-16`
  const hasta = quincena === 'Q1' ? `${mes}-15` : `${mes}-${String(finDia).padStart(2, '0')}`
  const sb = getSb()
  await loadConfig()

  // Mapeo PIN → nombre (solo activos con empleado)
  const { data: mapas } = await sb.from('reloj_empleados').select('pin, empleado_nombre, activo')
  const mapaPin = {}
  for (const r of (mapas || [])) if (r.activo !== false && r.empleado_nombre) mapaPin[String(r.pin)] = r.empleado_nombre

  // Marcaciones del rango (paginado)
  let marc = []
  const size = 1000
  for (let from = 0, i = 0; i < 30; i++, from += size) {
    const { data, error } = await sb.from('marcaciones_raw')
      .select('pin, fecha, hora')
      .gte('fecha', desde).lte('fecha', hasta)
      .order('fecha').order('hora')
      .range(from, from + size - 1)
    if (error) { window.toast?.(error.message, 'error'); return }
    if (!data || !data.length) break
    marc = marc.concat(data)
    if (data.length < size) break
  }
  if (!marc.length) { window.toast?.('No hay marcaciones para ese mes/quincena', 'error'); return }

  // Filas sintéticas en formato RELOJ_SIMPLE (nombre en col 0, fecha/hora ISO en col 2)
  const rows = [['nombre', '', 'fecha_hora']]
  const sinMapeo = new Set()
  for (const mk of marc) {
    const nombre = mapaPin[String(mk.pin)]
    if (!nombre) { sinMapeo.add(mk.pin); continue }
    rows.push([nombre, '', `${mk.fecha}T${mk.hora}`])
  }
  if (rows.length <= 1) { window.toast?.('Ninguna marcación tiene PIN vinculado a un empleado. Vinculá los PINs primero.', 'error'); return }

  // MISMO motor que el archivo
  const dayRecords = processTimeClock(rows, quincena)
  if (!dayRecords.length) { window.toast?.('No se encontraron registros para la quincena seleccionada', 'error'); return }

  const fechas = dayRecords.map(d => d.fecha).sort()
  const fechaMin = fechas[0], fechaMax = fechas[fechas.length - 1]
  const { data: empleados } = await sb.from('empleados').select('*').eq('activo', true)
  const { data: permisos } = await sb.from('permisos_empleados').select('*').gte('fecha', fechaMin).lte('fecha', fechaMax)
  permisosCache = permisos || []
  const { data: incapsAll } = await sb.from('permisos_empleados').select('*').eq('tipo', 'incapacidad')
  incapacidadesCache = incapsAll || []
  asistenciaData = calcularAsistencia(dayRecords, permisosCache)
  const [refY, refM] = dayRecords[0].fecha.split('-').map(Number)
  const bounds = _periodoBounds(refY, refM, quincena)
  asistenciaResumen = calcularResumenQuincenal(asistenciaData, empleados || [], bounds.inicio, bounds.fin, bounds.base)
  renderAsistencia(fechaMin, fechaMax)
  window.toast?.(`${dayRecords.length} registros · ${asistenciaResumen.length} empleados · ${quincena}` +
    (sinMapeo.size ? ` · ${sinMapeo.size} PIN sin vincular (ignorados)` : ''), 'success')
}

})();