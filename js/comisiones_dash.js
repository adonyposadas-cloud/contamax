/* ============================================================================
 * CONTAMAX · comisiones_dash.js   ·   build 20260715a
 *
 * DASHBOARD DE COMISIONES DEL CHECKLIST — super_admin + gerencia.
 *
 * Vista maestra: cada técnico con su total del mes; click para desplegar su detalle
 * trabajo por trabajo (qué encontró, qué ejecutó, cuánto de cada uno).
 *
 * Lee dos vistas:
 *   · v_checklist_comision_mecanico → el resumen por técnico/mes
 *   · v_checklist_comision          → el detalle línea por línea (al expandir)
 *
 * La comisión corre sobre proformas FINALIZADAS. El 80% sin ejecutor aparece como
 * PENDIENTE (plata sin asignar) para que gerencia la cierre.
 * ========================================================================== */
window.__comDashBuild = '20260715c'

;(function () {
  const sb = () => window._sb
  const esc = t => String(t ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
  const fmtL = v => 'L. ' + Number(v || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const num = v => Number(v) || 0

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  let MES_SEL = null   // 'YYYY-MM' o null = todos
  let EXPANDIDO = null // tecnico_id expandido

  const esAutorizado = () => {
    const p = (window._currentProfile ? window._currentProfile() : null) || {}
    return ['super_admin', 'admin', 'gerencia'].includes(p._rolReal || p.rol)
  }

  window.initComisionesDash = async function () {
    const root = document.getElementById('view-comisiones-dash')
    if (!root) return
    if (!esAutorizado()) { root.innerHTML = '<div style="padding:24px;color:#f85149">Solo gerencia puede ver las comisiones.</div>'; return }
    root.innerHTML = '<div style="padding:24px;color:#8b949e">Cargando comisiones…</div>'
    try {
      const [rCom, rCfg] = await Promise.all([
        sb().from('v_checklist_comision_mecanico').select('*'),
        sb().from('checklist_config').select('mostrar_comision_tecnico').eq('id', 1).single()
      ])
      if (rCom.error) throw rCom.error
      window._comVisibleTec = !!(rCfg.data && rCfg.data.mostrar_comision_tecnico)
      render(rCom.data || [])
    } catch (e) {
      root.innerHTML = `<div style="padding:24px;color:#f85149">Error: ${esc(e.message || e)}</div>`
    }
  }

  // La fecha se trata como TEXTO 'YYYY-MM', sin new Date(): convertir a Date aplicaba
  // el desfase de zona horaria (UTC vs Honduras -6) y corría el mes hacia atrás.
  // El valor que llega es un timestamp ISO ('2026-07-15...'); se toman los primeros 7 chars.
  function mesKey (mes) {
    if (!mes) return null
    return String(mes).slice(0, 7)          // '2026-07'
  }
  function mesLabel (mesKeyStr) {
    if (!mesKeyStr) return '—'
    const [y, m] = String(mesKeyStr).slice(0, 7).split('-')
    const idx = parseInt(m, 10) - 1
    return (MESES[idx] || m) + ' ' + y
  }

  function render (filas) {
    const root = document.getElementById('view-comisiones-dash')

    // Meses disponibles (para el filtro)
    const meses = [...new Set(filas.map(f => mesKey(f.mes)).filter(Boolean))].sort().reverse()
    if (MES_SEL === null && meses.length) MES_SEL = meses[0]   // por default, el mes más reciente

    const filtradas = MES_SEL ? filas.filter(f => mesKey(f.mes) === MES_SEL) : filas

    // Agregar por técnico (por si un técnico tiene varias filas de mes, aunque el filtro ya acota)
    const porTec = {}
    for (const f of filtradas) {
      const t = porTec[f.tecnico_id] || (porTec[f.tecnico_id] = {
        tecnico_id: f.tecnico_id, tecnico: f.tecnico || '(sin nombre)',
        encuentra: 0, ejecuta: 0, servicios: 0, productos: 0, total: 0, lineas: 0
      })
      t.encuentra += num(f.comision_encuentra); t.ejecuta += num(f.comision_ejecuta)
      t.servicios += num(f.comision_servicios); t.productos += num(f.comision_productos)
      t.total += num(f.comision); t.lineas += num(f.lineas)
    }
    const tecnicos = Object.values(porTec).sort((a, b) => b.total - a.total)
    const granTotal = tecnicos.reduce((s, t) => s + t.total, 0)

    const chipsMes = meses.map(m => `
      <button onclick="comDashMes('${m}')" style="padding:5px 12px;border-radius:16px;font-size:12px;cursor:pointer;border:1px solid ${MES_SEL === m ? '#c8a24a' : '#2a2e37'};background:${MES_SEL === m ? 'rgba(200,162,74,.15)' : 'transparent'};color:${MES_SEL === m ? '#c8a24a' : '#8b949e'}">${mesLabel(m)}</button>`).join('')

    const vis = window._comVisibleTec
    root.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;margin-bottom:14px;border:1px solid ${vis ? '#16a34a' : '#3a3f4a'};border-radius:10px;background:${vis ? 'rgba(22,163,74,.08)' : 'rgba(255,255,255,.02)'}">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${vis ? '✅ Los técnicos VEN su comisión' : '🔒 Comisión oculta a los técnicos (modo prueba)'}</div>
          <div style="font-size:11px;color:#8b949e">${vis ? 'Cada técnico ve su "Mi comisión" en el celular.' : 'Podés cuadrar los números sin que ellos vean montos.'}</div>
        </div>
        <button onclick="comDashToggleComision(${vis ? 'false' : 'true'})" style="padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${vis ? '#f0a500' : '#16a34a'};background:transparent;color:${vis ? '#f0a500' : '#16a34a'}">
          ${vis ? 'Ocultar' : 'Activar para técnicos'}
        </button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div style="display:flex;gap:6px;flex-wrap:wrap">${chipsMes || '<span style="color:#8b949e;font-size:12px">Sin datos aún</span>'}</div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#8b949e;letter-spacing:.05em">TOTAL DEL MES</div>
          <div style="font-size:24px;font-weight:800;color:#16a34a">${fmtL(granTotal)}</div>
        </div>
      </div>

      ${tecnicos.length ? `
      <div style="border:1px solid #2a2e37;border-radius:12px;overflow:hidden">
        <div style="display:flex;padding:9px 14px;background:#15171c;font-size:11px;color:#8b949e;font-weight:700;letter-spacing:.04em">
          <div style="flex:1">TÉCNICO</div>
          <div style="width:90px;text-align:right">ENCONTRÓ</div>
          <div style="width:90px;text-align:right">EJECUTÓ</div>
          <div style="width:100px;text-align:right">TOTAL</div>
        </div>
        ${tecnicos.map(filaTecnico).join('')}
      </div>` : '<div style="padding:30px;text-align:center;color:#8b949e">No hay comisiones en este período. La comisión corre cuando la orden se finaliza.</div>'}

      <div id="com-dash-detalle"></div>`
  }

  function filaTecnico (t) {
    const abierto = EXPANDIDO === t.tecnico_id
    return `
      <div onclick="comDashDetalle('${esc(t.tecnico_id)}')" style="display:flex;align-items:center;padding:11px 14px;border-top:1px solid #1c1f26;cursor:pointer;background:${abierto ? '#1a1d24' : 'transparent'}">
        <div style="flex:1;font-size:14px;font-weight:600">${abierto ? '▾' : '▸'} ${esc(t.tecnico)}</div>
        <div style="width:90px;text-align:right;font-size:13px;color:#8b5cf6">${fmtL(t.encuentra)}</div>
        <div style="width:90px;text-align:right;font-size:13px;color:#16a34a">${fmtL(t.ejecuta)}</div>
        <div style="width:100px;text-align:right;font-size:14px;font-weight:700;color:#e6edf3">${fmtL(t.total)}</div>
      </div>`
  }

  window.comDashMes = function (m) { MES_SEL = m; EXPANDIDO = null; initComisionesDash() }

  window.comDashToggleComision = async function (mostrar) {
    const verbo = mostrar ? 'ACTIVAR la comisión para todos los técnicos' : 'OCULTAR la comisión a los técnicos'
    if (!confirm('¿Seguro que querés ' + verbo + '?')) return
    const { data, error } = await sb().rpc('checklist_toggle_comision', { p_mostrar: mostrar })
    if (error) { alert('Error: ' + error.message); return }
    initComisionesDash()   // recargar para reflejar el nuevo estado
  }

  window.comDashDetalle = async function (tecnicoId) {
    // Toggle
    if (EXPANDIDO === tecnicoId) { EXPANDIDO = null; document.getElementById('com-dash-detalle').innerHTML = ''; marcarExpandido(); return }
    EXPANDIDO = tecnicoId
    marcarExpandido()
    const cont = document.getElementById('com-dash-detalle')
    cont.innerHTML = '<div style="padding:14px;color:#8b949e">Cargando detalle…</div>'

    const { data, error } = await sb().from('v_checklist_comision').select('*').eq('tecnico_id', tecnicoId).limit(500)
    if (error) { cont.innerHTML = `<div style="padding:14px;color:#f85149">${esc(error.message)}</div>`; return }

    let rows = data || []
    // Filtrar por el mes seleccionado (el detalle no trae 'mes', se filtra por proforma_id
    // de las que están en el resumen del mes — simplificación: mostramos todo lo del técnico)
    const enc = rows.filter(r => r.rol_comision === 'encuentra')
    const eje = rows.filter(r => r.rol_comision === 'ejecuta')

    const filaDet = (r) => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #1c1f26">
        <span style="flex:1;font-size:12px">${esc(r.descripcion || '')}
          <span style="color:#6b7280"> · orden #${esc(r.numero_orden || '')}${r.estado_comision === 'pendiente' ? ' · <span style=\"color:#f0a500\">PENDIENTE</span>' : ''}</span>
        </span>
        <span style="font-size:12px;color:#8b949e">${fmtL(r.precio_real)} × ${num(r.cantidad)} · ${num(r.pct)}%</span>
        <span style="width:70px;text-align:right;font-size:13px;font-weight:600;color:#16a34a">${fmtL(r.comision)}</span>
      </div>`

    cont.innerHTML = `
      <div style="border:1px solid #2a2e37;border-top:0;border-radius:0 0 12px 12px;padding:12px 16px;background:#0f1115">
        ${enc.length ? `<div style="font-size:11px;color:#8b5cf6;font-weight:700;margin-bottom:2px">LO QUE ENCONTRÓ (20%)</div>${enc.map(filaDet).join('')}` : ''}
        ${eje.length ? `<div style="font-size:11px;color:#16a34a;font-weight:700;margin:10px 0 2px">LO QUE EJECUTÓ (80%)</div>${eje.map(filaDet).join('')}` : ''}
        ${!rows.length ? '<div style="color:#8b949e;font-size:12px">Sin detalle.</div>' : ''}
      </div>`
  }

  function marcarExpandido () {
    // Re-render de las filas para actualizar el ▸/▾ sin recargar todo
    document.querySelectorAll('#view-comisiones-dash [onclick^="comDashDetalle"]').forEach(el => {
      const id = el.getAttribute('onclick').match(/'([^']+)'/)[1]
      const arrow = el.querySelector('div')
      if (arrow) arrow.textContent = arrow.textContent.replace(/^[▸▾]/, EXPANDIDO === id ? '▾' : '▸')
      el.style.background = EXPANDIDO === id ? '#1a1d24' : 'transparent'
    })
  }
})()