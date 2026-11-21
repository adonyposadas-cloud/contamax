// ══════════════════════════════════════════════
// ── TIMERS TAXIS · js/timers_taxis.js
// ── Panel de los timers de eWeLink que programa el bot (taxi-timer-bot.js).
//
// El bot manda cada 15 min la foto de todos los dispositivos (tx_timers_estado) y deja
// en tx_bot_timer_log cada corte que programó. Aquí se cruzan las dos cosas:
//   · corte actual del timer de ciclo, en línea, modo y si el timer está activo
//   · si el corte ya no es el que dejó el bot (alguien lo movió a mano o se corrió)
//   · hace cuánto el bot no programa la unidad
// y se dan órdenes: "activar / poner corte" con la fecha que se elija. El bot la
// ejecuta cuando el dispositivo esté en línea (tx_timer_ordenes).
// ══════════════════════════════════════════════
;(function () {
  'use strict'
  const sb = () => window._sb
  const $ = (id) => document.getElementById(id)
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
  const numU = (s) => String(s ?? '').replace(/^0+/, '')
  const DIA = 86400e3

  let filas = [], filtro = 'problemas', busca = '', leidoMax = null
  let ordenCol = null, ordenDir = 1   // clic en el encabezado: unidad / corte / ultima (null = orden por alertas)
  // Valor para ordenar; lo que no tiene dato (nunca programado, sin corte) va siempre al final
  const valorOrden = {
    unidad: (f) => Number(f.d.unidad) || 0,
    corte: (f) => f.corte ? f.corte.getTime() : null,
    ultima: (f) => f.p?.ultima_at ? new Date(f.p.ultima_at).getTime() : null
  }

  const fechaHN = (d) => d ? new Date(d).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
  const hace = (d) => {
    if (!d) return '—'
    const m = Math.round((Date.now() - new Date(d)) / 60000)
    if (m < 1) return 'ahora'
    if (m < 60) return `hace ${m} min`
    const h = Math.round(m / 60)
    if (h < 24) return `hace ${h} h`
    const dd = Math.floor(m / 1440)
    return `hace ${dd} día${dd === 1 ? '' : 's'}`
  }
  // Ciclo del timer: "inicio periodo duración"; la duración es la de la acción de inicio (startDo)
  function cicloDe (d) {
    const ts = (d.timers || []).filter(t => typeof t.at === 'string' && t.at.trim().split(/\s+/).length === 3)
    const t = ts.find(x => !x._lista && x.enabled !== 0) || ts.find(x => !x._lista) || ts[0]
    if (!t) return null
    const [, p, dur] = t.at.trim().split(/\s+/).map(Number)
    if (!p || !dur || dur > p) return null
    const apagando = t.startDo && t.startDo.switch === 'off'
    return apagando ? { on: p - dur, off: dur, arranca: 'off' } : { on: dur, off: p - dur, arranca: 'on' }
  }
  const MODO = { ciclo: 'Ciclo (intervalo)', repetir: 'Repetir (horario)', unico: 'Una sola vez', otro: 'Otro modo', 'sin timer': 'Sin timer' }

  async function cargar () {
    const box = $('tt-contenido')
    if (!box) return
    box.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div></div>'
    const [est, prog, ord, uni] = await Promise.all([
      sb().from('tx_timers_estado').select('*').order('unidad'),
      sb().rpc('tx_timers_ultima_prog'),
      sb().from('tx_timer_ordenes').select('*').gte('created_at', new Date(Date.now() - 45 * DIA).toISOString()).order('created_at', { ascending: false }).limit(1000),
      sb().from('unidades_taxis').select('registro, motorista, propietario, activo, placa')
    ])
    const err = est.error || prog.error || ord.error
    if (err) {
      box.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(err.message)}</div>
        <div class="empty-sub">Si dice que no existe la tabla o la función: falta correr <b>sql/tx_timers_panel.sql</b> en Supabase.</div></div>`
      return
    }
    const progPor = Object.fromEntries((prog.data || []).map(p => [p.device_id, p]))
    const uniPor = {}
    for (const u of (uni.data || [])) { const k = numU(u.registro); if (!uniPor[k] || u.activo) uniPor[k] = u }
    const ordPor = {}
    for (const o of (ord.data || [])) (ordPor[o.device_id] = ordPor[o.device_id] || []).push(o)
    leidoMax = (est.data || []).reduce((a, d) => (!a || d.leido_at > a ? d.leido_at : a), null)

    // Solo los dispositivos de los carros: el nombre dice TAXI o VIP (los de la casa y demás no salen)
    // ("TAXI 2598", "VIP 5940", "Taxi2598"…; no "VIPER" ni otras palabras que solo empiecen igual)
    const esCarro = (d) => /(^|[^A-Z])(TAXI|VIP)(?![A-Z])/i.test(String(d.nombre || ''))
    const carros = (est.data || []).filter(esCarro)
    // Unidades con algún dispositivo que sí tiene timer de ciclo (el otro suele ser el viejo)
    const conCiclo = new Set(carros.filter(d => d.modo === 'ciclo').map(d => numU(d.unidad)))
    filas = carros.map(d => {
      const p = progPor[d.device_id]
      const u = uniPor[numU(d.unidad)]
      const ords = ordPor[d.device_id] || []
      const pend = ords.find(o => o.estado === 'pendiente')
      const ultOrd = ords.find(o => o.estado !== 'pendiente' && o.estado !== 'cancelada')
      const corte = d.ciclo_at ? new Date(d.ciclo_at) : null
      const esperado = p?.at_nuevo ? new Date(String(p.at_nuevo).split(' ')[0]) : null
      // ¿El corte es el que dejó el bot (o el de la última orden cumplida)?
      const igual = (a, b) => a && b && Math.abs(a - b) < 60000
      const porOrden = ultOrd?.estado === 'hecha' && igual(corte, new Date(ultOrd.at_nuevo)) &&
        (!p?.ultima_at || new Date(ultOrd.hecha_at) > new Date(p.ultima_at))
      const movido = !!(corte && esperado && !igual(corte, esperado) && !porOrden)
      const diasSinProg = p?.ultima_at ? Math.floor((Date.now() - new Date(p.ultima_at)) / DIA) : null
      const vencido = !!(corte && corte < Date.now())
      const desactivado = d.ciclo_activo === false
      // Conexión: los GSM se apagan con el carro, así que "fuera de línea ahora" no dice nada.
      // Importa cuándo se vio en línea por última vez (foto del bot cada 15 min, o lo que diga eWeLink).
      const vistoAt = [d.visto_en_linea_at, d.ewelink_online_at].filter(Boolean).sort().pop() || null
      const desdeFoto = d.primera_foto_at || null
      const sinConexion = !d.online && (vistoAt ? Date.now() - new Date(vistoAt) > 3 * DIA
        : !!desdeFoto && Date.now() - new Date(desdeFoto) > DIA)
      // Dispositivos que no hay que atender: la unidad no existe o está de baja en Contamax,
      // o es el dispositivo viejo de una unidad cuyo otro dispositivo sí tiene el timer
      const estadoUnidad = !u ? 'no_existe' : !u.activo ? 'baja' : null
      const reemplazado = d.modo !== 'ciclo' && conCiclo.has(numU(d.unidad))
      const ignorar = !!estadoUnidad || reemplazado
      const alertas = []
      if (ignorar) return { d, p, u, pend, ultOrd, corte, esperado, porOrden, movido, diasSinProg, vencido, desactivado, alertas, vistoAt, desdeFoto, sinConexion, estadoUnidad, reemplazado, ignorar }
      if (desactivado) alertas.push('desactivado')
      if (d.modo && d.modo !== 'ciclo') alertas.push('modo')
      if (d.n_ciclo > 1) alertas.push('varios')
      if (movido) alertas.push('movido')
      if (sinConexion) alertas.push('sinconexion')
      if (diasSinProg != null && diasSinProg >= 7) alertas.push('sinprog')
      return { d, p, u, pend, ultOrd, corte, esperado, porOrden, movido, diasSinProg, vencido, desactivado, alertas, vistoAt, desdeFoto, sinConexion, estadoUnidad, reemplazado, ignorar }
    })
    // Repetidos: la misma unidad en más de un dispositivo. El "en uso" es el que el bot programó
    // más recientemente; si ninguno, el que se ha conectado; el resto se marca como posible viejo.
    const grupos = {}
    for (const f of filas) { const k = numU(f.d.unidad); if (k) (grupos[k] = grupos[k] || []).push(f) }
    for (const g of Object.values(grupos)) {
      if (g.length < 2) continue
      const peso = (f) => [f.p?.ultima_at ? new Date(f.p.ultima_at).getTime() : 0, f.d.online ? 2 : f.vistoAt ? 1 : 0, f.d.ciclo_activo ? 1 : 0]
      const orden = [...g].sort((a, b) => { const x = peso(a), y = peso(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] })
      const top = peso(orden[0]), seg = peso(orden[1])
      const claro = top.some((v, i) => v !== seg[i])   // hay uno que se distingue
      g.forEach(f => { f.repetido = g.length; f.posibleViejo = claro && f !== orden[0]; f.enUso = claro && f === orden[0] })
    }
    pintar()
  }

  function pasaFiltro (f) {
    if (filtro === 'repetidos') return !!f.repetido
    if (f.ignorar && filtro !== 'ignorados' && filtro !== 'todos') return false
    switch (filtro) {
      case 'problemas': return f.alertas.length > 0 || !!f.pend
      case 'desactivados': return f.desactivado
      case 'offline': return f.sinConexion
      case 'enlinea': return f.d.online
      case 'movidos': return f.movido
      case 'vencidos': return f.vencido && !f.desactivado
      case 'sinprog': return f.diasSinProg == null || f.diasSinProg >= 7
      case 'modo': return f.d.modo !== 'ciclo' || f.d.n_ciclo > 1
      case 'ordenes': return !!f.pend || !!f.ultOrd
      case 'ignorados': return f.ignorar
      default: return true
    }
  }

  function pintar () {
    const box = $('tt-contenido')
    if (!box) return
    const q = busca.toLowerCase().trim()
    // Con texto en el buscador se busca en TODAS las unidades (el filtro de arriba no aplica)
    const lista = filas.filter(f => q || pasaFiltro(f)).filter(f => !q || [f.d.unidad, f.d.nombre, f.u?.motorista, f.u?.propietario, f.u?.placa]
      .some(x => String(x || '').toLowerCase().includes(q)))
      .sort(ordenCol
        ? (a, b) => {
            const x = valorOrden[ordenCol](a), y = valorOrden[ordenCol](b)
            if (x == null && y == null) return (Number(a.d.unidad) || 0) - (Number(b.d.unidad) || 0)
            if (x == null) return 1
            if (y == null) return -1
            return (x - y) * ordenDir || (Number(a.d.unidad) || 0) - (Number(b.d.unidad) || 0)
          }
        : filtro === 'repetidos'
        ? (a, b) => (Number(a.d.unidad) || 0) - (Number(b.d.unidad) || 0) || (b.enUso ? 1 : 0) - (a.enUso ? 1 : 0)
        : (a, b) => b.alertas.length - a.alertas.length || (Number(a.d.unidad) || 0) - (Number(b.d.unidad) || 0))
    const th = (col, txt) => `<th style="cursor:pointer;white-space:normal" onclick="ttOrdenar_('${col}')" title="Ordenar por esta columna">${txt}${ordenCol === col ? (ordenDir === 1 ? ' ▲' : ' ▼') : ' <span style="opacity:.35">⇅</span>'}</th>`
    const cuenta = (fn) => filas.filter(f => !f.ignorar).filter(fn).length
    const chips = [
      ['problemas', 'Con alertas', cuenta(f => f.alertas.length > 0 || !!f.pend)],
      ['desactivados', 'Desactivados', cuenta(f => f.desactivado)],
      ['offline', 'Sin conexión 3+ días', cuenta(f => f.sinConexion)],
      ['enlinea', 'En línea ahora', cuenta(f => f.d.online)],
      ['movidos', 'Corte movido', cuenta(f => f.movido)],
      ['vencidos', 'Corte vencido', cuenta(f => f.vencido && !f.desactivado)],
      ['sinprog', 'Sin programar 7+ días', cuenta(f => f.diasSinProg == null || f.diasSinProg >= 7)],
      ['modo', 'Otro modo', cuenta(f => f.d.modo !== 'ciclo' || f.d.n_ciclo > 1)],
      ['ordenes', 'Órdenes', cuenta(f => !!f.pend || !!f.ultOrd)],
      ['repetidos', 'Repetidos', filas.filter(f => f.repetido).length],
      ['ignorados', 'No activas / reemplazados', filas.filter(f => f.ignorar).length],
      ['todos', 'Todos', filas.length]
    ]
    const viejo = leidoMax && (Date.now() - new Date(leidoMax)) > 35 * 60000
    box.innerHTML = `
      <div class="form-card" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="font-size:12.5px;color:${viejo ? 'var(--red)' : 'var(--text3)'}">
            Última lectura de eWeLink: <b>${leidoMax ? hace(leidoMax) : 'nunca'}</b>${leidoMax ? ' · ' + fechaHN(leidoMax) : ''}
            ${viejo ? ' · ⚠ el bot no ha mandado datos: revisá que esté corriendo en la PC' : ' · el bot la actualiza cada 15 min'}
          </div>
          <div style="display:flex;gap:8px">
            <input type="text" id="tt-buscar" placeholder="Unidad, motorista, placa…" value="${esc(busca)}" oninput="ttBuscar(this.value)" style="min-width:220px">
            <button class="btn btn-ghost" onclick="initTimersTaxis()">↻ Actualizar</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
          ${chips.map(([k, l, n]) => `<button class="btn ${filtro === k ? 'btn-gold' : 'btn-ghost'}" style="padding:4px 12px;font-size:12px" onclick="ttFiltro('${k}')">${l} <span style="opacity:.7">(${n})</span></button>`).join('')}
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          ${th('unidad', 'Unidad')}<th>Dispositivo</th><th>Modo / timer</th>${th('corte', 'Corte programado')}${th('ultima', 'Última programación del bot')}<th>Alertas</th><th></th>
        </tr></thead>
        <tbody>${lista.length ? lista.map(fila).join('') : '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text3)">Nada en este filtro</td></tr>'}</tbody>
      </table></div>
      <div style="font-size:11.5px;color:var(--text3);margin-top:8px">
        "Corte movido": el inicio del timer ya no es el que dejó el bot en su última programación (alguien lo cambió en la app o se corrió).
        Las órdenes las ejecuta el bot cuando el dispositivo está en línea. La hora normal del corte es 7:30 p. m.; un carro puede tener otra si se le da una orden con otra hora.
      </div>`
  }

  function conexionTxt (f) {
    const d = f.d
    if (d.online) return 'en línea ahora'
    if (f.vistoAt) return `visto en línea ${hace(f.vistoAt)}`
    if (d.ewelink_offline_at) return `desconectado ${hace(d.ewelink_offline_at)}`
    return f.desdeFoto ? `sin conectarse desde que empezó el registro (${new Date(f.desdeFoto).toLocaleDateString('es-HN')})` : 'fuera de línea'
  }

  function fila (f) {
    const { d, p, u } = f
    const dot = `<span title="${d.online ? 'En línea' : 'Fuera de línea'}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${d.online ? 'var(--green)' : 'var(--red)'};margin-right:6px"></span>`
    const timer = d.ciclo_activo == null ? '<span style="color:var(--text3)">sin timer de ciclo</span>'
      : d.ciclo_activo ? '<span style="color:var(--green)">activo</span>' : '<b style="color:var(--red)">DESACTIVADO</b>'
    let corteTxt = '—'
    if (f.corte) {
      const dias = Math.round((f.corte - Date.now()) / DIA)
      corteTxt = `${fechaHN(f.corte)}<div style="font-size:11.5px;color:${f.vencido ? 'var(--red)' : 'var(--text3)'}">${f.vencido ? `vencido ${hace(f.corte)}` : dias <= 0 ? 'hoy' : `faltan ${dias} día${dias === 1 ? '' : 's'}`}</div>`
    }
    if (f.movido) corteTxt += `<div style="font-size:11.5px;color:var(--amber)">⚠ el bot lo dejó en ${fechaHN(f.esperado)}</div>`
    if (f.porOrden) corteTxt += '<div style="font-size:11.5px;color:var(--text3)">puesto por orden de Contamax</div>'
    // "12 en 30 días" se toca y abre el historial de esa unidad
    const progTxt = p?.ultima_at
      ? `${hace(p.ultima_at)}<div style="font-size:11.5px;color:var(--text3)">${fechaHN(p.ultima_at)} ·
          <a href="#" onclick="ttHistorial('${esc(d.device_id)}');return false" title="Ver las programaciones anteriores"
             style="color:var(--blue);text-decoration:none;border-bottom:1px dotted var(--blue)">${p.entregas_30d} en 30 días</a></div>`
      : '<span style="color:var(--text3)">nunca (desde que existe el bot)</span>'
    const etiquetas = {
      desactivado: ['Timer desactivado', 'var(--red)'], modo: [`Modo: ${MODO[d.modo] || d.modo}`, 'var(--amber)'],
      varios: [`${d.n_ciclo} timers de ciclo`, 'var(--amber)'], movido: ['Corte movido', 'var(--amber)'],
      sinconexion: [f.vistoAt ? `Sin conexión ${hace(f.vistoAt).replace('hace ', '')}` : 'No se ha conectado (desde que hay registro)', 'var(--red)'], sinprog: [`${f.diasSinProg} días sin programar`, 'var(--amber)']
    }
    const motivoIgn = f.estadoUnidad === 'no_existe' ? 'No existe en Unidades Taxis de Contamax'
      : f.estadoUnidad === 'baja' ? 'Unidad dada de baja en Contamax'
      : f.reemplazado ? 'Dispositivo viejo: otro de esta unidad tiene el timer' : ''
    const al = motivoIgn ? `<span style="font-size:11.5px;color:var(--text3)">${motivoIgn}</span>` : f.alertas.map(a => `<span style="display:inline-block;font-size:11px;border:1px solid ${etiquetas[a][1]};color:${etiquetas[a][1]};border-radius:10px;padding:1px 8px;margin:1px 3px 1px 0">${etiquetas[a][0]}</span>`).join('')
    let ordTxt = ''
    if (f.pend) {
      ordTxt = `<div style="font-size:11.5px;color:var(--blue);margin-top:4px">🕓 Orden: ${f.pend.accion === 'desactivar' ? 'DESACTIVAR el timer' : `activar con corte ${fechaHN(f.pend.at_nuevo)}${f.pend.min_on ? (f.pend.arranca === 'off' ? ` · arranca Off ${f.pend.min_off} / On ${f.pend.min_on} min` : ` · On ${f.pend.min_on} / Off ${f.pend.min_off} min`) : ''}`} al conectarse
        · ${esc(f.pend.creada_nombre || '')} <a href="#" onclick="ttCancelar(${f.pend.id});return false" style="color:var(--red)">cancelar</a></div>`
    } else if (f.ultOrd) {
      ordTxt = `<div style="font-size:11.5px;color:${f.ultOrd.estado === 'hecha' ? 'var(--green)' : 'var(--red)'};margin-top:4px">
        ${f.ultOrd.estado === 'hecha' ? '✓' : '✕'} Orden ${hace(f.ultOrd.hecha_at)}: ${esc(f.ultOrd.detalle || f.ultOrd.estado)}</div>`
    }
    // Desactivado desde la app (solo en la nube): el bot lo copia al equipo activado cuando se conecte
    const puede = d.n_ciclo === 1
    const btn = puede
      ? `<button class="btn ${f.desactivado ? 'btn-gold' : 'btn-ghost'}" style="padding:4px 10px;font-size:11.5px;white-space:nowrap" onclick="ttOrdenar('${esc(d.device_id)}')"
          title="El bot lo hace cuando el dispositivo esté en línea">${f.desactivado ? '⚡ Activar' : '📅 Poner corte'}</button>`
      : `<span style="font-size:11px;color:var(--text3)" title="El bot no puede programarlo: activarlo o corregirlo en la app de eWeLink">a mano</span>`
    return `<tr>
      <td><b style="font-family:var(--mono)">${esc(d.unidad || '—')}</b><div style="font-size:11.5px;color:var(--text3)">${esc(u?.motorista || u?.propietario || '')}${u?.placa ? ' · ' + esc(u.placa) : ''}</div></td>
      <td>${dot}${esc(d.nombre)}<div style="font-size:11px;color:${d.online ? 'var(--green)' : f.sinConexion ? 'var(--red)' : 'var(--text3)'}">${conexionTxt(f)}</div>${f.repetido ? `
        <div style="font-size:11px;margin-top:3px"><span style="color:var(--text3)" title="ID del dispositivo en eWeLink (Configuración del dispositivo)">ID …${esc(String(d.device_id).slice(-6))}</span>
        · <span style="color:${f.posibleViejo ? 'var(--red)' : f.enUso ? 'var(--green)' : 'var(--amber)'}">${f.posibleViejo ? 'posible viejo: borrar en eWeLink' : f.enUso ? 'en uso' : `repetido (${f.repetido})`}</span></div>` : ''}</td>
      <td>${esc(MODO[d.modo] || d.modo || '—')}<div style="font-size:11.5px">${timer}</div>${(() => { const c = cicloDe(d); return c ? `<div style="font-size:11px;color:${c.arranca === 'off' ? 'var(--amber)' : 'var(--text3)'}">${c.arranca === 'off' ? `arranca Off ${c.off} min · On ${c.on} min` : `On ${c.on} min · Off ${c.off} min`}</div>` : '' })()}${d.modo === 'sin timer'
        ? `<div style="font-size:11px;color:var(--amber)">${d.online || f.vistoAt ? 'se ha conectado: falta crearle el timer en eWeLink' : 'no se ha conectado desde que hay registro: revisar el dispositivo'}</div>` : ''}</td>
      <td style="font-size:12.5px">${corteTxt}</td>
      <td style="font-size:12.5px">${progTxt}</td>
      <td style="max-width:240px">${al || '<span style="color:var(--green);font-size:12px">OK</span>'}${ordTxt}</td>
      <td>${btn}</td>
    </tr>`
  }

  // Selector de hora con el estilo de la app (el <input type="time"> de Chrome no toma el tema)
  function selHora (hhmm) {
    const [h, m] = (hhmm || '19:30').split(':').map(Number)
    const h12 = h % 12 === 0 ? 12 : h % 12, pm = h >= 12
    const mins = [...new Set([...Array.from({ length: 12 }, (_, k) => k * 5), m])].sort((a, b) => a - b)
    const opt = (v, txt, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${txt}</option>`
    return `<select id="tt-h" style="flex:1;min-width:0">${Array.from({ length: 12 }, (_, k) => k + 1).map(x => opt(x, x, x === h12)).join('')}</select>
      <select id="tt-m" style="flex:1;min-width:0">${mins.map(x => opt(String(x).padStart(2, '0'), String(x).padStart(2, '0'), x === m)).join('')}</select>
      <select id="tt-ap" style="flex:1;min-width:0">${opt('am', 'a. m.', !pm)}${opt('pm', 'p. m.', pm)}</select>`
  }

  window.initTimersTaxis = () => cargar()
  window.ttFiltro = (k) => { filtro = k; pintar() }
  // Clic en el encabezado: 1° ascendente (la más vieja primero), 2° descendente, 3° vuelve al orden por alertas
  window.ttOrdenar_ = (col) => {
    if (ordenCol !== col) { ordenCol = col; ordenDir = 1 } else if (ordenDir === 1) ordenDir = -1; else { ordenCol = null; ordenDir = 1 }
    pintar()
  }
  window.ttBuscar = (v) => { busca = v; pintar(); const i = $('tt-buscar'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length) } }

  // Orden: activar / poner corte con la fecha elegida (siempre 19:30 de Honduras)
  window.ttOrdenar = (deviceId) => {
    const f = filas.find(x => x.d.device_id === deviceId)
    if (!f) return
    const manana = new Date(Date.now() - 6 * 3600e3 + DIA).toISOString().slice(0, 10)
    const cic = cicloDe(f.d)
    // Hora del corte: la que tiene hoy el timer (un carro puede tener hora especial); si no, 19:30
    const horaAct = f.corte ? new Date(f.corte - 6 * 3600e3).toISOString().slice(11, 16) : '19:30'
    const sugerida = f.corte && f.corte > Date.now() ? new Date(f.corte - 6 * 3600e3).toISOString().slice(0, 10) : manana
    const ov = document.createElement('div')
    ov.className = 'modal-overlay open'
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px'
    ov.onclick = (ev) => { if (ev.target === ov) ov.remove() }
    ov.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);max-width:440px;width:100%;padding:20px">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">${f.desactivado ? '⚡ Activar timer' : '📅 Poner corte'} · unidad ${esc(f.d.unidad || '')}</div>
      <div style="font-size:12.5px;color:var(--text3);margin-bottom:12px">${esc(f.d.nombre)} · ${f.d.online ? 'en línea: el bot lo hace en el próximo minuto' : 'fuera de línea: el bot lo hace cuando se conecte'}.
        ${f.corte ? `Corte actual: ${fechaHN(f.corte)}.` : ''}</div>
      ${f.desactivado ? '' : `<label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;cursor:pointer">
        <input type="checkbox" id="tt-desact" onchange="document.getElementById('tt-campos').style.display=this.checked?'none':''"> ⏸ Desactivar el timer (deja de cortar)</label>`}
      <div id="tt-campos">
      <div style="display:flex;gap:10px">
        <div style="flex:2"><label style="font-size:11px;color:var(--text3)">FECHA DE CORTE</label>
          <input type="date" id="tt-fecha" value="${sugerida}" min="${new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10)}" style="width:100%;margin:4px 0 4px"></div>
        <div style="flex:2"><label style="font-size:11px;color:var(--text3)">HORA</label>
          <div style="display:flex;gap:4px;margin:4px 0 4px">${selHora(horaAct)}</div></div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:12px">Normal: 7:30 p. m. Si ponés otra hora, el bot la usa en las entregas siguientes de este carro (para volver a lo normal, dale una orden a las 7:30 p. m.).</div>
      <label style="font-size:11px;color:var(--text3)">CICLO (MINUTOS, COMO EN EWELINK)</label>
      <div style="display:flex;gap:10px;margin:4px 0 4px">
        <div style="flex:1"><div style="font-size:11px;color:var(--text3)">Encendido (On)</div><input type="number" id="tt-on" min="1" max="1440" step="1" value="${cic ? cic.on : ''}" style="width:100%"></div>
        <div style="flex:1"><div style="font-size:11px;color:var(--text3)">Apagado (Off)</div><input type="number" id="tt-off" min="1" max="1440" step="1" value="${cic ? cic.off : ''}" style="width:100%"></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin:8px 0 4px"><span style="font-size:11px;color:var(--text3)">ARRANCA CON</span>
        <select id="tt-arranca" style="flex:1"><option value="on"${!cic || cic.arranca === 'on' ? ' selected' : ''}>Encendido (como la mayoría)</option><option value="off"${cic && cic.arranca === 'off' ? ' selected' : ''}>Apagado</option></select></div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:14px">${cic ? `Hoy: ${cic.arranca === 'off' ? `arranca Off ${cic.off} min · On ${cic.on} min` : `On ${cic.on} min · Off ${cic.off} min`}. Si no lo cambiás, queda igual.` : 'No se pudo leer el ciclo actual: llená los dos tiempos.'}</div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-gold" id="tt-ok">Dar la orden</button>
      </div></div>`
    document.body.appendChild(ov)
    ov.querySelector('#tt-ok').onclick = async () => {
      if (ov.querySelector('#tt-desact')?.checked) {
        // Se apaga en el dispositivo; la app de eWeLink puede seguir mostrándolo activo
        if (!confirm(`¿Desactivar el timer de la unidad ${f.d.unidad}? El carro deja de cortarse.\n\nOjo: la app de eWeLink puede seguir mostrándolo como activo; en este panel sale desactivado.`)) return
        const { error: e0 } = await sb().rpc('tx_timer_ordenar', { p_device_id: deviceId, p_at: null, p_min_on: null, p_min_off: null, p_accion: 'desactivar' })
        if (e0) { window.toast?.('Error: ' + e0.message, 'error'); return }
        ov.remove()
        window.toast?.(`Orden dada: desactivar el timer de la unidad ${f.d.unidad}`, 'success')
        window.logActividad?.('timer_orden', 'taxis', `Unidad ${f.d.unidad} · ${f.d.nombre}: desactivar`, null)
        cargar(); return
      }
      const fecha = ov.querySelector('#tt-fecha').value
      if (!fecha) { window.toast?.('Elegí la fecha', 'error'); return }
      // Hora de las tres listas (12 h) a 24 h
      const h12 = parseInt(ov.querySelector('#tt-h').value, 10), mi = ov.querySelector('#tt-m').value, pm = ov.querySelector('#tt-ap').value === 'pm'
      const hora = `${String((h12 % 12) + (pm ? 12 : 0)).padStart(2, '0')}:${mi}`
      if (!/^\d{2}:\d{2}$/.test(hora)) { window.toast?.('Hora inválida', 'error'); return }
      const at = new Date(`${fecha}T${hora}:00-06:00`)
      if (at <= Date.now()) { window.toast?.('Esa fecha y hora de corte ya pasó', 'error'); return }
      const on = parseInt(ov.querySelector('#tt-on').value, 10), off = parseInt(ov.querySelector('#tt-off').value, 10)
      if (!(on >= 1 && on <= 1440 && off >= 1 && off <= 1440)) { window.toast?.('Poné los dos tiempos del ciclo entre 1 y 1440 minutos', 'error'); return }
      const arranca = ov.querySelector('#tt-arranca').value
      const cambiaArranque = !cic || cic.arranca !== arranca
      const cambia = !cic || cic.on !== on || cic.off !== off || cambiaArranque
      const { error } = await sb().rpc('tx_timer_ordenar', { p_device_id: deviceId, p_at: at.toISOString(),
        p_min_on: cambia ? on : null, p_min_off: cambia ? off : null, p_accion: 'activar', p_arranca: cambiaArranque ? arranca : null })
      if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
      ov.remove()
      window.toast?.(`Orden dada: unidad ${f.d.unidad} con corte ${fechaHN(at)}${cambia ? ` · ciclo ${arranca === 'off' ? `arranca Off ${off} / On ${on}` : `On ${on} / Off ${off}`} min` : ''}`, 'success')
      window.logActividad?.('timer_orden', 'taxis', `Unidad ${f.d.unidad} · ${f.d.nombre}: corte ${fecha} ${hora}`, null)
      cargar()
    }
  }
  // ── Historial: las programaciones anteriores de una unidad ──
  // Se abre tocando "12 en 30 días". Trae de a 10, de la más reciente hacia
  // atrás, y el botón de abajo sigue cargando sin cerrar la ventana.
  const PASO = 10
  window.ttHistorial = async (deviceId) => {
    const f = filas.find(x => x.d.device_id === deviceId)
    if (!f) return
    const ov = document.createElement('div')
    ov.className = 'modal-overlay open'
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px'
    ov.onclick = (ev) => { if (ev.target === ov) ov.remove() }
    ov.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);max-width:520px;width:100%;max-height:85vh;display:flex;flex-direction:column;padding:20px">
      <div style="font-size:15px;font-weight:700;margin-bottom:2px">🕓 Programaciones · unidad ${esc(f.d.unidad || '')}</div>
      <div style="font-size:12.5px;color:var(--text3);margin-bottom:12px">${esc(f.d.nombre)}</div>
      <div id="tt-hist" style="overflow-y:auto;flex:1;min-height:80px"><div style="text-align:center;padding:24px"><div class="spinner"></div></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px">
        <span id="tt-hist-pie" style="font-size:11.5px;color:var(--text3)"></span>
        <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
      </div></div>`
    document.body.appendChild(ov)

    const caja = ov.querySelector('#tt-hist')
    const pie = ov.querySelector('#tt-hist-pie')
    let cargadas = []

    async function traer () {
      const { data, error } = await sb().rpc('tx_timers_historial',
        { p_device_id: deviceId, p_desde: cargadas.length, p_limite: PASO })
      if (error) {
        caja.innerHTML = `<div style="color:var(--red);font-size:13px;padding:8px">${esc(error.message)}</div>`
        return
      }
      cargadas = cargadas.concat(data || [])
      pintarHist(data && data.length ? Number(data[0].total) : cargadas.length)
    }

    function pintarHist (total) {
      if (!cargadas.length) {
        caja.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px">El bot no tiene programaciones anotadas de esta unidad.</div>'
        pie.textContent = ''
        return
      }
      caja.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr style="color:var(--text3);font-size:11px;text-align:left">
          <th style="padding:4px 6px;font-weight:600">CUÁNDO LO PROGRAMÓ</th>
          <th style="padding:4px 6px;font-weight:600">CORTE QUE LE DEJÓ</th>
        </tr></thead>
        <tbody>${cargadas.map(r => `<tr style="border-top:1px solid var(--border)">
          <td style="padding:6px">${fechaHN(r.updated_at)}<div style="font-size:11px;color:var(--text3)">${hace(r.updated_at)}</div></td>
          <td style="padding:6px">${fechaHN(r.at_nuevo)}</td>
        </tr>`).join('')}</tbody></table>
        ${cargadas.length < total ? `<div style="text-align:center;padding:10px">
          <button class="btn btn-ghost" id="tt-hist-mas" style="font-size:12px">Ver ${Math.min(PASO, total - cargadas.length)} más</button></div>` : ''}`
      pie.textContent = `${cargadas.length} de ${total}`
      const mas = ov.querySelector('#tt-hist-mas')
      if (mas) mas.onclick = () => { mas.disabled = true; mas.textContent = 'Cargando…'; traer() }
    }

    traer()
  }

  window.ttCancelar = async (id) => {
    if (!confirm('¿Cancelar esta orden?')) return
    const { error } = await sb().rpc('tx_timer_cancelar', { p_id: id })
    if (error) { window.toast?.('Error: ' + error.message, 'error'); return }
    window.toast?.('Orden cancelada', 'success')
    cargar()
  }
})()
