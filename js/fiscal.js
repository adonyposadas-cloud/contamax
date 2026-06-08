// ═══════════════════════════════════════════════════════════════
//  fiscal.js · Declaración de ISV
//  Libro de Ventas (solo lectura, "en piedra") + Libro de Compras
//  (seleccionable, con rodaje al mes siguiente) + cuadre del período.
//  Lee libro_ventas / libro_compras. Crédito de compras controlado por
//  incluir_fiscal; el período de cada compra es periodo_fiscal (YYYY-MM).
// ═══════════════════════════════════════════════════════════════
(function () {
  let fPeriodo = ''
  let fCentro = ''
  let fVentas = []
  let fCompras = []
  let fSoloAlertas = false

  const getSb = () => window._sb
  const fmt = (v) => (Math.round((+v || 0) * 100) / 100).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const round2 = (v) => Math.round((+v || 0) * 100) / 100

  function periodoActual() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  function rangoMes(p) {
    const [y, m] = p.split('-').map(Number)
    const first = `${p}-01`
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    return { first, next }
  }
  function mesSiguiente(p) {
    const [y, m] = p.split('-').map(Number)
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }

  // ── Tope legal del crédito fiscal de compras (Art. 12 Ley del ISV) ──
  // El crédito por compras se puede consignar dentro de un plazo de 3 meses,
  // contado desde el período de la factura. Confirmá con tu contadora si "3 meses"
  // incluye o no el mes de origen: si junio puede ir hasta SEPTIEMBRE dejá 3; si el
  // tope es AGOSTO (3 meses contando junio) ponelo en 2.
  const MESES_LIMITE_CREDITO = 3
  function periodoDeFecha(fecha) { return (fecha || '').slice(0, 7) }
  function sumarMeses(p, n) {
    const [y, m] = p.split('-').map(Number)
    const total = (y * 12 + (m - 1)) + n
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
  }
  function periodoMaximoCredito(fecha) {
    const origen = periodoDeFecha(fecha)
    return origen ? sumarMeses(origen, MESES_LIMITE_CREDITO) : null
  }

  // ── Clasificación fiscal por actividad del centro de costo ──
  // El centro de costo trae tipo_actividad: 'gravada' | 'exenta' | 'comun' | 'personal'.
  //   gravada  → crédito 100% acreditable (taller / Tecnimax)
  //   exenta   → crédito NO acreditable, va a costo (yonker, si las ventas son exentas)
  //   comun    → acreditable solo en el % de ventas gravadas (prorrata): alquiler, energía, etc.
  //   personal → fuera de los libros fiscales: ni débito ni crédito (gasto del dueño)
  const TIPOS_ACTIVIDAD = ['gravada', 'exenta', 'comun', 'personal']
  function centroObj(id) { return (window._empresas?.() || []).find(e => e.id === id) || null }
  function tipoActividad(id) {
    const t = centroObj(id)?.tipo_actividad
    return TIPOS_ACTIVIDAD.includes(t) ? t : 'comun'   // sin clasificar → tratado como común (conservador)
  }
  function sinClasificar(id) {
    const c = centroObj(id)
    return !c || !TIPOS_ACTIVIDAD.includes(c.tipo_actividad)
  }
  function badgeActividad(id) {
    const t = tipoActividad(id)
    const sc = sinClasificar(id)
    const def = {
      gravada:  ['Gravada',  'var(--green)'],
      exenta:   ['Exenta',   'var(--amber)'],
      personal: ['Personal', 'var(--red)'],
      comun:    sc ? ['Sin clasificar', 'var(--red)'] : ['Común', 'var(--text2)'],
    }[t] || ['Común', 'var(--text2)']
    return `<span title="Actividad del centro de costo" style="display:inline-block;border:1px solid ${def[1]};color:${def[1]};border-radius:5px;padding:1px 6px;font-size:10px;font-weight:600;white-space:nowrap">${def[0]}</span>`
  }

  function etiquetaMes(p) {
    const [y, m] = p.split('-').map(Number)
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
    return `${meses[m - 1]} ${y}`
  }
  function puedeEditar() {
    const r = (window._currentProfile?.() || {}).rol
    return ['super_admin', 'contador', 'contador_fiscal'].includes(r)
  }
  // Editar datos de la factura (n° y proveedor) — solo interno, no el contador externo
  function puedeEditarDatos() {
    const r = (window._currentProfile?.() || {}).rol
    return ['super_admin', 'contador'].includes(r)
  }

  // ── Entrada del módulo ──
  window.loadDeclaracionISV = async () => {
    const inp = document.getElementById('fisc-periodo')
    if (inp && !inp.value) inp.value = periodoActual()
    // Centros de costo
    const selC = document.getElementById('fisc-centro')
    if (selC && selC.options.length <= 1) {
      const empresas = (window._empresas?.() || [])
      selC.innerHTML = '<option value="">Todos los centros</option>' +
        empresas.map(e => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')
    }
    await window.cargarISV()
  }

  // ── Consulta y render ──
  window.cargarISV = async () => {
    const sb = getSb()
    if (!sb) return
    fPeriodo = (document.getElementById('fisc-periodo')?.value) || periodoActual()
    fCentro = (document.getElementById('fisc-centro')?.value) || ''
    const cont = document.getElementById('fisc-contenido')
    if (cont) cont.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3)">Cargando…</div>'

    const { first, next } = rangoMes(fPeriodo)

    // VENTAS: por mes de la fecha (no ruedan)
    let qV = sb.from('libro_ventas')
      .select('id,fecha,factura_interna,factura_electronica,cliente,rtn_cliente,total_gravado,total_exento,isv,total,incluir_fiscal,centro_costo_id')
      .gte('fecha', first).lt('fecha', next).order('fecha')
    if (fCentro) qV = qV.eq('centro_costo_id', fCentro)

    // COMPRAS: por periodo_fiscal asignado
    let qC = sb.from('libro_compras')
      .select('id,fecha,numero_factura,proveedor,rtn_proveedor,subtotal,isv,total,incluir_fiscal,periodo_fiscal,centro_costo_id')
      .eq('periodo_fiscal', fPeriodo).order('fecha')
    if (fCentro) qC = qC.eq('centro_costo_id', fCentro)

    const [{ data: dv, error: ev }, { data: dc, error: ec }] = await Promise.all([qV, qC])
    if (ev || ec) {
      if (cont) cont.innerHTML = `<div style="padding:20px;color:var(--red)">No se pudo cargar la información fiscal. ${esc((ev || ec).message || '')}</div>`
      return
    }
    fVentas = dv || []
    fCompras = dc || []
    render()
  }

  function totales() {
    const esPersonal = (id) => tipoActividad(id) === 'personal'

    // ── VENTAS fiscales: incluidas y NO personales ──
    const ventasFisc = fVentas.filter(v => v.incluir_fiscal && !esPersonal(v.centro_costo_id))
    const debito = round2(ventasFisc.reduce((s, v) => s + (+v.isv || 0), 0))
    const baseGravada = ventasFisc.reduce((s, v) => s + (+v.total_gravado || 0), 0)
    const baseExenta = ventasFisc.reduce((s, v) => s + (+v.total_exento || 0), 0)
    const baseTotal = baseGravada + baseExenta
    // Factor de prorrata = ventas gravadas / (gravadas + exentas).
    // Sin ventas en el período: factor 1 (no se penaliza; el saldo a favor se arrastra).
    const factor = baseTotal > 0 ? (baseGravada / baseTotal) : 1

    // Ventas personales marcadas como fiscales (no deberían estarlo) — para alertar
    const nPersonalVentas = fVentas.filter(v => v.incluir_fiscal && esPersonal(v.centro_costo_id)).length

    // ── COMPRAS incluidas, separadas por actividad del centro ──
    const comprasInc = fCompras.filter(c => c.incluir_fiscal)
    let isvGravada = 0, isvExenta = 0, isvComun = 0, isvPersonal = 0
    let nSinClasif = 0, nPersonalCompras = 0
    for (const c of comprasInc) {
      const isv = +c.isv || 0
      const t = tipoActividad(c.centro_costo_id)
      if (t === 'gravada') isvGravada += isv
      else if (t === 'exenta') isvExenta += isv
      else if (t === 'personal') { isvPersonal += isv; nPersonalCompras++ }
      else { isvComun += isv; if (sinClasificar(c.centro_costo_id)) nSinClasif++ }
    }

    const comunAcreditable = round2(isvComun * factor)
    const comunACosto = round2(isvComun - comunAcreditable)

    // Crédito que SÍ va a la declaración:
    const creditoAcreditable = round2(isvGravada + comunAcreditable)
    // Crédito que NO acredita (se vuelve costo): exento + parte común + personal
    const creditoACosto = round2(isvExenta + comunACosto + isvPersonal)
    const neto = round2(debito - creditoAcreditable)

    return {
      debito, factor,
      baseGravada: round2(baseGravada), baseExenta: round2(baseExenta),
      isvGravada: round2(isvGravada), isvExenta: round2(isvExenta),
      isvComun: round2(isvComun), isvPersonal: round2(isvPersonal),
      comunAcreditable, comunACosto,
      creditoAcreditable, creditoACosto, neto,
      nSinClasif, nPersonalCompras, nPersonalVentas,
      // alias para compatibilidad con código viejo (export):
      credito: creditoAcreditable,
    }
  }

  function renderResumen() {
    const t = totales()
    const box = document.getElementById('fisc-resumen')
    if (!box) return
    const aPagar = t.neto > 0
    const cuadrado = t.neto === 0
    const netoLabel = cuadrado ? 'Cuadrado' : (aPagar ? 'ISV a pagar' : 'Saldo a favor')
    const netoColor = cuadrado ? 'var(--text2)' : (aPagar ? 'var(--red)' : 'var(--green)')
    const pct = (t.factor * 100)
    const pctTxt = (Math.round(pct * 100) / 100).toLocaleString('es-HN', { maximumFractionDigits: 2 })

    const stat = (label, val, color, border) => `
      <div style="flex:1;min-width:170px;background:var(--bg2);border:1px solid ${border || 'var(--border)'};border-radius:10px;padding:14px 16px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:6px">${label}</div>
        <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:${color || 'var(--text)'}">L. ${fmt(val)}</div>
      </div>`

    // Alertas de clasificación
    const alertas = []
    if (t.nSinClasif > 0) alertas.push(`⚠️ ${t.nSinClasif} compra(s) en centros <b>sin clasificar</b> — se trataron como comunes (prorrata). Clasificá esos centros.`)
    if (t.nPersonalCompras > 0) alertas.push(`🚫 ${t.nPersonalCompras} compra(s) de centros <b>personales</b> marcadas como fiscales — NO acreditan, van a costo. Revisá por qué están incluidas.`)
    if (t.nPersonalVentas > 0) alertas.push(`🚫 ${t.nPersonalVentas} venta(s) de centros <b>personales</b> marcadas como fiscales — quedaron fuera del débito.`)

    box.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${stat('Débito fiscal · ISV ventas', t.debito, 'var(--text)')}
        ${stat('Crédito ACREDITABLE · va a la declaración', t.creditoAcreditable, 'var(--green)', 'var(--green)')}
        <div style="flex:1;min-width:170px;background:var(--bg2);border:1px solid ${netoColor};border-radius:10px;padding:14px 16px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:6px">${netoLabel} · ${etiquetaMes(fPeriodo)}</div>
          <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:${netoColor}">L. ${fmt(Math.abs(t.neto))}</div>
        </div>
      </div>

      <div class="form-card" style="margin-top:12px;padding:14px 16px">
        <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px">📊 Desglose del crédito por actividad · prorrata del período</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:10px">
          Factor de prorrata = ventas gravadas ÷ (gravadas + exentas) =
          L. ${fmt(t.baseGravada)} ÷ L. ${fmt(t.baseGravada + t.baseExenta)} =
          <b style="color:var(--text)">${pctTxt}%</b>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;font-family:var(--mono);font-size:13px">
          <div><div style="font-size:10px;color:var(--text3);text-transform:uppercase">Directo gravado (100%)</div>L. ${fmt(t.isvGravada)}</div>
          <div><div style="font-size:10px;color:var(--text3);text-transform:uppercase">Común × ${pctTxt}%</div>L. ${fmt(t.comunAcreditable)} <span style="color:var(--text3)">de ${fmt(t.isvComun)}</span></div>
          <div style="color:var(--amber)"><div style="font-size:10px;color:var(--text3);text-transform:uppercase">A costo (no acredita)</div>L. ${fmt(t.creditoACosto)}</div>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:10px">
          "A costo" = exento (L. ${fmt(t.isvExenta)}) + común no acreditable (L. ${fmt(t.comunACosto)}) + personal (L. ${fmt(t.isvPersonal)}).
          Ese ISV no va a la declaración: se registra como costo de la mercadería / gasto no deducible.
        </div>
        ${alertas.length ? `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;display:flex;flex-direction:column;gap:6px">
          ${alertas.map(a => `<div style="font-size:12px;color:var(--text2)">${a}</div>`).join('')}
        </div>` : ''}
      </div>`
  }

  function trailingNum(fac) {
    const m = String(fac || '').match(/\d+/g)
    return m ? parseInt(m[m.length - 1], 10) : -1
  }
  function nombreCentro(id) {
    const c = (window._empresas?.() || []).find(e => e.id === id)
    return c ? c.nombre : 'Sin centro de costo'
  }
  function refCorrelativo(v) {
    return v.factura_electronica || v.numero_documento || v.factura_interna || ''
  }
  // Banderas de alerta de una venta
  function analizarVenta(v) {
    const grav = +v.total_gravado || 0
    const isv = +v.isv || 0
    const esperado = Math.round(grav * 0.15 * 100) / 100
    const dif = Math.round((isv - esperado) * 100) / 100
    const obs = (v.observaciones || '').trim()
    const anulada = /anul/i.test(obs)
    const isvMal = Math.abs(dif) > 1
    return { esperado, dif, obs, anulada, isvMal, tieneAlerta: anulada || isvMal || !!obs }
  }

  function render() {
    renderResumen()
    const cont = document.getElementById('fisc-contenido')
    if (!cont) return
    const editable = puedeEditar()

    // ── LIBRO DE VENTAS · una ventana por centro de costo (correlativos distintos) ──
    const grupos = {}
    fVentas.forEach(v => { (grupos[v.centro_costo_id] = grupos[v.centro_costo_id] || []).push(v) })
    let totalAlertas = 0, totalAnuladas = 0, totalIsvMal = 0
    const anuladasList = []

    const idsCentros = Object.keys(grupos).sort((x, y) => nombreCentro(x).localeCompare(nombreCentro(y)))
    const ventanasV = idsCentros.map(cid => {
      const lista = grupos[cid].slice().sort((x, y) => trailingNum(refCorrelativo(x)) - trailingNum(refCorrelativo(y)))
      const prefijo = (refCorrelativo(lista[0]) || '').split('-').slice(0, 2).join('-')

      // Secuencia completa: rellenar los huecos del correlativo como ANULADA (sin espacios)
      const presentes = new Map()
      lista.forEach(v => { const n = trailingNum(refCorrelativo(v)); if (n >= 0) presentes.set(n, v) })
      const nums = [...presentes.keys()].sort((a, b) => a - b)
      const sampleFac = refCorrelativo(lista[0]) || ''
      const mDig = sampleFac.match(/\d+$/)
      const padLen = mDig ? mDig[0].length : 0
      const pref = mDig ? sampleFac.slice(0, sampleFac.length - mDig[0].length) : ''
      const minN = nums.length ? nums[0] : 0, maxN = nums.length ? nums[nums.length - 1] : 0
      const spanOK = nums.length > 0 && (maxN - minN) <= 1500
      const secuencia = []
      if (spanOK) {
        for (let n = minN; n <= maxN; n++) {
          if (presentes.has(n)) secuencia.push({ v: presentes.get(n) })
          else secuencia.push({ gap: true, fac: pref + String(n).padStart(padLen, '0') })
        }
      } else {
        lista.forEach(v => secuencia.push({ v }))
      }

      let gravV = 0, exenV = 0, isvV = 0, nAlert = 0, nGaps = 0
      const filas = secuencia.map(item => {
        if (item.gap) {
          nAlert++; nGaps++; totalAnuladas++; totalAlertas++
          anuladasList.push({ c: nombreCentro(cid), fac: item.fac, m: 'hueco de correlativo' })
          return `<tr style="background:rgba(229,72,77,.06)">
            <td style="color:var(--text3)">—</td>
            <td style="font-family:var(--mono);color:var(--text2)">${esc(item.fac)}</td>
            <td colspan="5" style="color:var(--text3);font-style:italic">correlativo no registrado</td>
            <td><span style="display:inline-block;background:rgba(229,72,77,.15);color:var(--red);border:1px solid var(--red);border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700">🚫 ANULADA</span></td>
          </tr>`
        }
        const v = item.v
        const incl = !!v.incluir_fiscal
        if (incl) { gravV += +v.total_gravado || 0; exenV += +v.total_exento || 0; isvV += +v.isv || 0 }
        const a = analizarVenta(v)
        if (a.anulada) { totalAnuladas++; anuladasList.push({ c: nombreCentro(cid), fac: refCorrelativo(v), m: a.obs || 'marcada anulada' }) }
        if (a.isvMal) totalIsvMal++
        if (a.tieneAlerta) { nAlert++; totalAlertas++ }
        if (fSoloAlertas && !a.tieneAlerta) return ''
        const fac = refCorrelativo(v) || '—'
        let badges = ''
        if (a.anulada) badges += `<span title="Factura anulada${incl ? ' — ¡está sumando en el débito fiscal!' : ''}" style="display:inline-block;background:rgba(229,72,77,.15);color:var(--red);border:1px solid var(--red);border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700;margin:1px">🚫 ANULADA</span>`
        if (a.isvMal) badges += `<span title="ISV esperado L.${fmt(a.esperado)} · real L.${fmt(v.isv)} · diferencia L.${fmt(a.dif)}" style="display:inline-block;background:rgba(245,158,11,.15);color:var(--amber);border:1px solid var(--amber);border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700;margin:1px">⚠️ ISV ${a.dif > 0 ? '+' : ''}${fmt(a.dif)}</span>`
        if (a.obs && !a.anulada && !a.isvMal) badges += `<span title="${esc(a.obs)}" style="cursor:help;font-size:12px;margin:1px">📝</span>`
        const rowStyle = a.anulada ? 'background:rgba(229,72,77,.07)' : (incl ? '' : 'opacity:.45')
        return `<tr style="${rowStyle}">
          <td style="font-family:var(--mono)">${esc(v.fecha)}</td>
          <td style="font-family:var(--mono)">${esc(fac)}</td>
          <td>${esc(v.cliente)}</td>
          <td style="font-family:var(--mono)">${esc(v.rtn_cliente)}</td>
          <td style="text-align:right;font-family:var(--mono)">${fmt(v.total_gravado)}</td>
          <td style="text-align:right;font-family:var(--mono)">${fmt(v.total_exento)}</td>
          <td style="text-align:right;font-family:var(--mono)">${fmt(v.isv)}</td>
          <td>${badges || '<span style="color:var(--text3)">—</span>'}</td>
        </tr>`
      }).join('')
      return `
        <div class="form-card" style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div class="form-card-title" style="margin:0">🔒 Ventas · ${esc(nombreCentro(cid))} <span style="font-weight:400;color:var(--text3);font-size:12px">(${lista.length} fact. · serie ${esc(prefijo)})</span></div>
            ${nAlert ? `<span style="font-size:12px;color:var(--amber);font-weight:600">⚠️ ${nAlert} con alerta${nGaps ? ` · ${nGaps} anulada(s)` : ''}</span>` : '<span style="font-size:12px;color:var(--green)">✓ sin alertas</span>'}
          </div>
          <div class="table-wrap" style="max-height:320px;overflow:auto">
            <table>
              <thead><tr>
                <th>Fecha</th><th>Factura</th><th>Cliente</th><th>RTN</th>
                <th style="text-align:right">Gravado 15%</th><th style="text-align:right">Exento</th>
                <th style="text-align:right">ISV</th><th>Alerta</th>
              </tr></thead>
              <tbody>${filas || '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:18px">— sin filas que mostrar —</td></tr>'}</tbody>
              <tfoot><tr style="font-weight:700;border-top:2px solid var(--border)">
                <td colspan="4" style="text-align:right">Totales (incluidas):</td>
                <td style="text-align:right;font-family:var(--mono)">${fmt(gravV)}</td>
                <td style="text-align:right;font-family:var(--mono)">${fmt(exenV)}</td>
                <td style="text-align:right;font-family:var(--mono)">${fmt(isvV)}</td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>
        </div>`
    }).join('')

    // ── LIBRO DE COMPRAS (seleccionable + rodaje con tope legal + actividad) ──
    let subC = 0, isvC = 0
    const filasC = fCompras.map(c => {
      const incl = !!c.incluir_fiscal
      if (incl) { subC += +c.subtotal || 0; isvC += +c.isv || 0 }
      const sinProv = !((c.proveedor || '').trim())
      const chk = `<input type="checkbox" ${incl ? 'checked' : ''} ${editable ? '' : 'disabled'} onchange="window.fiscToggleCompra('${c.id}', this.checked)" style="width:auto;margin:0;cursor:pointer">`
      // Botón rodar con tope legal de 3 meses calculado desde la fecha de la factura
      const destinoRow = mesSiguiente(c.periodo_fiscal || fPeriodo)
      const limiteRow = periodoMaximoCredito(c.fecha)
      const enTope = limiteRow && destinoRow > limiteRow
      const btnMover = !editable
        ? ''
        : enTope
          ? `<button class="btn btn-ghost" style="padding:3px 8px;font-size:11px;opacity:.4;cursor:not-allowed" disabled title="Tope legal: el crédito solo puede acreditarse hasta ${etiquetaMes(limiteRow)} (plazo de ${MESES_LIMITE_CREDITO} meses, Art. 12 Ley del ISV)">⛔ tope</button>`
          : `<button class="btn btn-ghost" style="padding:3px 8px;font-size:11px" title="Reclamar en ${etiquetaMes(destinoRow)}" onclick="window.fiscMoverMes('${c.id}')">→ ${destinoRow}</button>`
      const btnEdit = puedeEditarDatos()
        ? `<button class="btn btn-ghost" style="padding:3px 8px;font-size:11px;margin-left:4px" title="Editar n° de factura y proveedor" onclick="window.fiscEditCompra('${c.id}')">✏️</button>`
        : ''
      const rowStyle = !incl ? 'opacity:.5' : (sinProv ? 'background:rgba(245,158,11,.07)' : '')
      const provCell = sinProv
        ? '<span style="color:var(--amber);font-style:italic">— sin proveedor —</span>'
        : esc(c.proveedor)
      return `<tr style="${rowStyle}">
        <td style="text-align:center">${chk}</td>
        <td style="font-family:var(--mono)">${esc(c.fecha)}</td>
        <td style="font-family:var(--mono)">${esc(c.numero_factura)}</td>
        <td>${provCell}</td>
        <td style="font-family:var(--mono)">${esc(c.rtn_proveedor)}</td>
        <td style="text-align:center">${badgeActividad(c.centro_costo_id)}</td>
        <td style="text-align:right;font-family:var(--mono)">${fmt(c.subtotal)}</td>
        <td style="text-align:right;font-family:var(--mono)">${fmt(c.isv)}</td>
        <td style="text-align:center;white-space:nowrap">${btnMover}${btnEdit}</td>
      </tr>`
    }).join('')

    cont.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div class="form-card-title" style="margin:0">🔒 Libro de Ventas · ${etiquetaMes(fPeriodo)} <span style="font-weight:400;color:var(--text3);font-size:12px">(no editable · ${fVentas.length} fact.)</span></div>
        <div style="display:flex;gap:14px;align-items:center;font-size:12px;flex-wrap:wrap">
          ${totalAlertas ? `<span style="color:var(--amber);font-weight:600">⚠️ ${totalAlertas} con alerta · ${totalAnuladas} anuladas · ${totalIsvMal} ISV no cuadra</span>` : '<span style="color:var(--green)">✓ sin alertas</span>'}
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;margin:0;font-size:12px"><input type="checkbox" ${fSoloAlertas ? 'checked' : ''} onchange="window.fiscToggleAlertas(this.checked)" style="width:auto;margin:0"> Ver solo con alertas</label>
        </div>
      </div>
      ${anuladasList.length ? `
      <div class="form-card" style="margin-bottom:14px;border-color:var(--red)">
        <div class="form-card-title" style="margin:0 0 8px 0;color:var(--red);font-size:13px">🚫 Anuladas / a verificar (${anuladasList.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${anuladasList.map(x => `<span title="${esc(x.c)} · ${esc(x.m)}" style="display:inline-block;background:rgba(229,72,77,.12);color:var(--red);border:1px solid var(--red);border-radius:6px;padding:3px 8px;font-family:var(--mono);font-size:11px;cursor:help">${esc(x.fac)}</span>`).join('')}
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">Pasá el mouse sobre cada una para ver el centro y el motivo. Los "hueco de correlativo" son números que no quedaron registrados (verificá que correspondan a facturas anuladas).</div>
      </div>` : ''}
      ${ventanasV || '<div class="form-card" style="margin-bottom:18px;text-align:center;color:var(--text3);padding:18px">Sin ventas en el período</div>'}

      <div class="form-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="form-card-title" style="margin:0">🧾 Libro de Compras · ${etiquetaMes(fPeriodo)} <span style="font-weight:400;color:var(--text3);font-size:12px">(marcá las que entran al crédito)</span></div>
          <span style="font-size:12px;color:var(--text3)">${fCompras.length} factura(s)</span>
        </div>
        <div class="table-wrap" style="max-height:380px;overflow:auto">
          <table>
            <thead><tr>
              <th style="text-align:center">Incluir</th><th>Fecha</th><th>Factura</th><th>Proveedor</th><th>RTN</th>
              <th style="text-align:center">Actividad</th><th style="text-align:right">Subtotal</th><th style="text-align:right">ISV</th><th style="text-align:center">Rodar</th>
            </tr></thead>
            <tbody>${filasC || '<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:18px">Sin compras asignadas a este período</td></tr>'}</tbody>
            <tfoot><tr style="font-weight:700;border-top:2px solid var(--border)">
              <td colspan="6" style="text-align:right">ISV incluido (bruto, antes de prorrata):</td>
              <td style="text-align:right;font-family:var(--mono)">${fmt(subC)}</td>
              <td style="text-align:right;font-family:var(--mono)">${fmt(isvC)}</td>
              <td></td>
            </tr></tfoot>
          </table>
        </div>
        <div class="form-actions" style="margin-top:14px">
          <button class="btn btn-ghost" onclick="window.fiscExportar()">📥 Exportar libros (Excel)</button>
        </div>
      </div>`
  }

  // ── Filtro "ver solo con alertas" ──
  window.fiscToggleAlertas = (checked) => { fSoloAlertas = !!checked; render() }

  // ── Toggle incluir/excluir una compra del crédito ──
  window.fiscToggleCompra = async (id, checked) => {
    if (!puedeEditar()) return
    const sb = getSb()
    const c = fCompras.find(x => x.id === id)
    if (c) c.incluir_fiscal = checked
    renderResumen()
    // actualizar footer de compras al vuelo
    const { error } = await sb.from('libro_compras').update({ incluir_fiscal: checked }).eq('id', id)
    if (error) {
      window.toast?.('No se pudo guardar el cambio: ' + (error.message || ''), 'error')
      if (c) c.incluir_fiscal = !checked
      render()
      return
    }
    window.logActividad?.('toggle_fiscal', 'declaracion-isv', `Compra ${c?.numero_factura || id} ${checked ? 'incluida' : 'excluida'} del ISV ${fPeriodo}`, id)
    render()
  }

  // ── Rodar una compra al mes siguiente (con tope legal de 3 meses) ──
  window.fiscMoverMes = async (id) => {
    if (!puedeEditar()) return
    const sb = getSb()
    const c = fCompras.find(x => x.id === id)
    const actual = c?.periodo_fiscal || fPeriodo
    const destino = mesSiguiente(actual)

    const limite = periodoMaximoCredito(c?.fecha)
    if (!limite) {
      window.toast?.('La factura no tiene fecha válida; no se puede validar el plazo del crédito.', 'error')
      return
    }
    if (destino > limite) {
      window.toast?.(
        `No se puede rodar: el crédito de esta factura solo puede declararse hasta ${etiquetaMes(limite)} ` +
        `(plazo legal de ${MESES_LIMITE_CREDITO} meses, Art. 12 Ley del ISV). Más allá de esa fecha se pierde.`,
        'error'
      )
      return
    }

    const { error } = await sb.from('libro_compras').update({ periodo_fiscal: destino }).eq('id', id)
    if (error) { window.toast?.('No se pudo mover la compra: ' + (error.message || ''), 'error'); return }
    fCompras = fCompras.filter(x => x.id !== id)
    window.logActividad?.('rodar_fiscal', 'declaracion-isv', `Compra ${c?.numero_factura || id} movida de ${fPeriodo} a ${destino}`, id)
    window.toast?.(`Compra movida a ${etiquetaMes(destino)}`, 'success')
    render()
  }

  // ── Editar n° de factura / proveedor / RTN de una compra ──
  window.fiscEditCompra = (id) => {
    if (!puedeEditarDatos()) return
    const c = fCompras.find(x => x.id === id)
    if (!c) return
    const prev = document.getElementById('fisc-edit-modal')
    if (prev) prev.remove()
    const wrap = document.createElement('div')
    wrap.id = 'fisc-edit-modal'
    wrap.style = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999'
    wrap.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:20px;width:440px;max-width:92vw">
        <div style="font-weight:700;font-size:15px;margin-bottom:4px">Editar factura de compra</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:14px">${esc(c.fecha)}</div>
        <div class="fld" style="margin-bottom:10px"><label>N° de factura</label><input type="text" id="fe-numfac" value="${esc(c.numero_factura)}"></div>
        <div class="fld" style="margin-bottom:10px"><label>Proveedor</label><input type="text" id="fe-prov" value="${esc(c.proveedor)}" style="text-transform:uppercase"></div>
        <div class="fld" style="margin-bottom:10px"><label>RTN del proveedor</label><input type="text" id="fe-rtn" value="${esc(c.rtn_proveedor)}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px">
          <div class="fld"><label>ISV</label><input type="text" inputmode="decimal" id="fe-isv" value="${(+c.isv || 0)}"></div>
          <div class="fld"><label>Subtotal (base)</label><input type="text" inputmode="decimal" id="fe-subtotal" value="${(+c.subtotal || 0)}"></div>
          <div class="fld"><label>Total</label><input type="text" inputmode="decimal" id="fe-total" value="${(+c.total || 0)}"></div>
        </div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          Calcular subtotal desde el ISV:
          <button class="btn btn-ghost" style="padding:2px 10px;font-size:11px" onclick="window.fiscCalcSub(0.15)">÷ 15%</button>
          <button class="btn btn-ghost" style="padding:2px 10px;font-size:11px" onclick="window.fiscCalcSub(0.18)">÷ 18%</button>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn btn-ghost" onclick="window.fiscCerrarEdit()">Cancelar</button>
          <button class="btn btn-gold" onclick="window.fiscGuardarCompra('${c.id}')">Guardar</button>
        </div>
      </div>`
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove() })
    document.body.appendChild(wrap)
    setTimeout(() => document.getElementById('fe-numfac')?.focus(), 50)
  }

  window.fiscCerrarEdit = () => { document.getElementById('fisc-edit-modal')?.remove() }

  // Calcula el subtotal (base) a partir del ISV y la tasa elegida
  window.fiscCalcSub = (rate) => {
    const isv = parseFloat(String(document.getElementById('fe-isv')?.value || '').replace(/[^\d.]/g, '')) || 0
    const sub = Math.round((isv / rate) * 100) / 100
    const elS = document.getElementById('fe-subtotal'); if (elS) elS.value = sub
    const elT = document.getElementById('fe-total'); if (elT) elT.value = Math.round((sub + isv) * 100) / 100
  }

  window.fiscGuardarCompra = async (id) => {
    if (!puedeEditarDatos()) return
    const sb = getSb()
    const numN = (el) => parseFloat(String(document.getElementById(el)?.value || '').replace(/[^\d.]/g, '')) || 0
    const numfac = (document.getElementById('fe-numfac')?.value || '').trim()
    const prov = (document.getElementById('fe-prov')?.value || '').trim().toUpperCase()
    const rtn = (document.getElementById('fe-rtn')?.value || '').trim()
    const isv = Math.round(numN('fe-isv') * 100) / 100
    const subtotal = Math.round(numN('fe-subtotal') * 100) / 100
    const total = Math.round(numN('fe-total') * 100) / 100
    const { error } = await sb.from('libro_compras')
      .update({ numero_factura: numfac, numero_documento: numfac, proveedor: prov, rtn_proveedor: rtn, isv, subtotal, total })
      .eq('id', id)
    if (error) { window.toast?.('No se pudo guardar: ' + (error.message || ''), 'error'); return }
    const c = fCompras.find(x => x.id === id)
    if (c) { c.numero_factura = numfac; c.numero_documento = numfac; c.proveedor = prov; c.rtn_proveedor = rtn; c.isv = isv; c.subtotal = subtotal; c.total = total }
    window.logActividad?.('editar_compra_fiscal', 'declaracion-isv', `Editó compra ${numfac} (prov: ${prov}, ISV ${isv}, base ${subtotal})`, id)
    window.fiscCerrarEdit()
    window.toast?.('Factura actualizada', 'success')
    render()
  }

  // ── Exportar ambos libros a Excel ──
  window.fiscExportar = () => {
    const XLSX = window.XLSX
    if (!XLSX) { window.toast?.('No se pudo cargar Excel', 'error'); return }
    const t = totales()
    const pct = Math.round(t.factor * 10000) / 100

    const ventasAoA = [['LIBRO DE VENTAS · ' + etiquetaMes(fPeriodo)], [],
      ['Fecha', 'Factura', 'Cliente', 'RTN', 'Centro', 'Actividad', 'Gravado 15%', 'Exento', 'ISV', 'Total', 'Fiscal']]
    fVentas.forEach(v => ventasAoA.push([
      v.fecha, v.factura_electronica || v.factura_interna || '', v.cliente || '', v.rtn_cliente || '',
      nombreCentro(v.centro_costo_id), tipoActividad(v.centro_costo_id),
      +v.total_gravado || 0, +v.total_exento || 0, +v.isv || 0, +v.total || 0, v.incluir_fiscal ? 'Sí' : 'No']))

    const comprasAoA = [['LIBRO DE COMPRAS · ' + etiquetaMes(fPeriodo)], [],
      ['Fecha', 'Factura', 'Proveedor', 'RTN', 'Centro', 'Actividad', 'Subtotal', 'ISV', 'Total', 'Incluida']]
    fCompras.forEach(c => comprasAoA.push([
      c.fecha, c.numero_factura || '', c.proveedor || '', c.rtn_proveedor || '',
      nombreCentro(c.centro_costo_id), tipoActividad(c.centro_costo_id),
      +c.subtotal || 0, +c.isv || 0, +c.total || 0, c.incluir_fiscal ? 'Sí' : 'No']))

    const resumenAoA = [['DECLARACIÓN DE ISV · ' + etiquetaMes(fPeriodo)], [],
      ['Débito fiscal (ISV ventas)', t.debito], [],
      ['CRÉDITO — desglose por actividad'],
      ['Directo gravado (100%)', t.isvGravada],
      ['Común (bruto)', t.isvComun],
      [`Factor de prorrata (ventas gravadas / totales)`, pct / 100],
      [`Común acreditable (× ${pct}%)`, t.comunAcreditable],
      ['Crédito ACREDITABLE (va a la declaración)', t.creditoAcreditable], [],
      ['A COSTO — no acredita'],
      ['Exento', t.isvExenta],
      ['Común no acreditable', t.comunACosto],
      ['Personal / no deducible', t.isvPersonal],
      ['Total a costo', t.creditoACosto], [],
      [t.neto > 0 ? 'ISV a pagar' : (t.neto < 0 ? 'Saldo a favor' : 'Cuadrado'), Math.abs(t.neto)]]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenAoA), 'Resumen')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ventasAoA), 'Ventas')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(comprasAoA), 'Compras')
    XLSX.writeFile(wb, `Declaracion_ISV_${fPeriodo}.xlsx`)
    window.logActividad?.('export_fiscal', 'declaracion-isv', `Exportó libros ISV ${fPeriodo}`)
  }
})()