/* ============================================================
   CONTAMAX · Conciliación de depósitos de Taxis (Pieza 1)
   Cruza el estado de cuenta del banco (Excel) con las entregas
   reportadas (entregas_taxis) de un día, con match de 3 niveles:
     1) por identificador fuerte (Ficohsa: cédula · BAC: unidad)
     2) por monto + nombre del depositante (BAC)
     3) por monto exacto (único)
   Lo que queda ambiguo o suelto se empareja a mano (en memoria).
   ============================================================ */
(function () {
  const csb = () => window._sb
  let ctxBanco = 'BAC'
  let ctxFecha = ''
  let ctxFechaBanco = ''
  let ctxFile = null
  let ctxRes = null          // resultado de la conciliación
  let ctxSelDepositos = []   // depósitos huérfanos elegidos para emparejar (permite varios → 1 entrega)
  let ctxPartida = null      // total del débito de la partida [IMP-TAXI] del día (para el cuadre)

  // Cuenta contable de cada banco (debe coincidir con TAXI_CUENTAS de app.js)
  const CTX_CUENTA = { BAC: '110104-021', Ficohsa: '110104-013' }

  const fmt = n => 'L. ' + (parseFloat(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // Fecha local (Honduras UTC-6), NO UTC. toISOString() devolvería el día equivocado de noche.
  const fechaLocal = d => (d || new Date()).toLocaleDateString('en-CA')

  function norm(s) {
    return (s == null ? '' : String(s))
      .replace(/ñ/gi, 'n').replace(/#/g, 'N')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim()
  }
  const digs = s => String(s || '').replace(/\D/g, '')
  function tokens(n) { return new Set(norm(n).split(' ').filter(w => w.length >= 3)) }
  function nombresCoinciden(a, b) {
    const ta = tokens(a), tb = tokens(b)
    if (!ta.size || !tb.size) return false
    let common = 0; ta.forEach(t => { if (tb.has(t)) common++ })
    if (common >= 2) return true
    if (common >= 1) {
      const sub = [...ta].every(t => tb.has(t)) || [...tb].every(t => ta.has(t))
      if (sub) return true
    }
    return false
  }

  // Clasifica el depositante de una descripción según el banco
  function clasificar(desc, banco) {
    const d = String(desc || '').trim()
    const out = { nombre: null, unidad: null, identidad: null }
    if (banco === 'Ficohsa') {
      const m = d.match(/(\d{10,15})/)            // "TENGO - 0307199700008"
      if (m) out.identidad = m[1]
    } else { // BAC
      const tef = d.match(/TEF\s+DE:?\s*(.+)/i)    // "TEF DE:NOMBRE"
      if (tef) out.nombre = tef[1].trim()
      else if (/^\d+$/.test(d)) out.unidad = d     // descripción = número de unidad
      const atm = d.match(/ATM[_\s]*(\d{10,15})/i) // "DEP_ATM_0801..."
      if (atm) out.identidad = atm[1]
    }
    return out
  }

  // Parsea el extracto Excel → créditos del día seleccionado
  async function parseExtracto(file, banco, fecha) {
    const ab = await file.arrayBuffer()
    const wb = XLSX.read(ab, { type: 'array' })
    const sh = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: '' })
    // localizar fila de encabezado (tiene "Fecha" y una columna de crédito)
    let hi = -1, idxFecha = -1, idxDesc = -1, idxCred = -1, idxRef = -1
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const r = rows[i].map(c => norm(c))
      const fF = r.findIndex(c => c === 'FECHA')
      const fC = r.findIndex(c => c === 'CREDITO' || c === 'CREDITOS')
      const fD = r.findIndex(c => c === 'DESCRIPCION')
      const fR = r.findIndex(c => c === 'NUMERO DE REFERENCIA' || c === 'REFERENCIA' || c === 'NO REFERENCIA')
      if (fF >= 0 && fC >= 0) { hi = i; idxFecha = fF; idxCred = fC; idxDesc = fD; idxRef = fR; break }
    }
    if (hi < 0) throw new Error('No se encontró la tabla de movimientos en el archivo.')

    const movs = []
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i]
      const fechaRaw = String(r[idxFecha] || '').trim()
      const credRaw = String(r[idxCred] || '').replace(/,/g, '').trim()
      const desc = String(r[idxDesc] || '').trim()
      const ref = idxRef >= 0 ? String(r[idxRef] || '').trim() : null
      const cred = parseFloat(credRaw)
      if (!fechaRaw || !cred || cred <= 0) continue
      // normalizar fecha dd/mm/yyyy → yyyy-mm-dd
      const fm = fechaRaw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
      let fIso = null
      if (fm) { let [_, dd, mm, yy] = fm; if (yy.length === 2) yy = '20' + yy; fIso = `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` }
      if (fIso !== fecha) continue
      const cl = clasificar(desc, banco)
      movs.push({ idx: movs.length, desc, ref, monto: cred, fecha: fIso, ...cl, m: false, par: null })
    }
    return movs
  }

  async function cargarEntregas(banco, fecha) {
    const { data, error } = await csb().from('entregas_taxis').select('*')
      .eq('banco', banco).eq('fecha_deposito', fecha).eq('estado', 'Aprobada')
    if (error) throw error
    return (data || []).map((e, i) => ({
      idx: i, id: e.id, unidad: String(e.unidad || '').trim(),
      nombre: e.nombre_conductor || '', identidad: String(e.identidad || '').trim(),
      monto: parseFloat(e.monto) || 0, m: false, pars: [], nivel: null
    }))
  }

  function conciliar(entregas, movs, banco) {
    // Nivel 1: identificador fuerte (cédula/unidad) + el monto debe cuadrar
    entregas.forEach(e => {
      if (e.m) return
      // depósitos que comparten el identificador fuerte con esta entrega
      const mismos = movs.filter(mv => !mv.m && (
        (banco === 'Ficohsa' && mv.identidad && digs(mv.identidad) === digs(e.identidad)) ||
        (banco === 'BAC' && mv.unidad && mv.unidad === e.unidad) ||
        (banco === 'BAC' && mv.identidad && digs(mv.identidad) === digs(e.identidad))
      ))
      if (!mismos.length) return
      // a) un depósito de esa cédula/unidad que cuadra exacto
      const exacto = mismos.find(mv => Math.abs(mv.monto - e.monto) < 0.01)
      if (exacto) { e.m = exacto.m = true; e.pars = [exacto.idx]; exacto.par = e.idx; e.nivel = 1; return }
      // b) la SUMA de todos los de esa cédula/unidad cuadra (pago fraccionado identificado)
      const suma = mismos.reduce((s, mv) => s + mv.monto, 0)
      if (mismos.length > 1 && Math.abs(suma - e.monto) < 0.01) {
        e.m = true; e.pars = mismos.map(mv => mv.idx); mismos.forEach(mv => { mv.m = true; mv.par = e.idx }); e.nivel = 1; return
      }
      // c) hay depósitos con su cédula pero el monto no cuadra → revisión manual (no forzar)
    })
    // Nivel 2: monto + nombre (BAC)
    entregas.forEach(e => {
      if (e.m) return
      const cands = movs.filter(mv => !mv.m && Math.abs(mv.monto - e.monto) < 0.01 && mv.nombre && nombresCoinciden(mv.nombre, e.nombre))
      if (cands.length === 1) { const mv = cands[0]; e.m = mv.m = true; e.pars = [mv.idx]; mv.par = e.idx; e.nivel = 2 }
    })
    // Nivel 3: monto exacto único
    entregas.forEach(e => {
      if (e.m) return
      const cands = movs.filter(mv => !mv.m && Math.abs(mv.monto - e.monto) < 0.01)
      if (cands.length === 1) { const mv = cands[0]; e.m = mv.m = true; e.pars = [mv.idx]; mv.par = e.idx; e.nivel = 3 }
      else if (cands.length > 1) e.nivel = 'amb'
    })
    return {
      conciliados: entregas.filter(e => e.m),
      entregasHuerfanas: entregas.filter(e => !e.m),
      depositosHuerfanos: movs.filter(mv => !mv.m),
      entregas, movs, banco
    }
  }

  // Reaplica los emparejamientos manuales de una conciliación previa, identificando
  // cada depósito por su referencia bancaria o, si no hay, por monto. Así al re-conciliar
  // (tras subir entregas pendientes) no se pierde el trabajo manual; solo queda lo nuevo.
  async function reaplicarManuales(res, banco, fecha) {
    let manuales = []
    try {
      const { data, error } = await csb().rpc('tx_conciliacion_manual', { p_banco: banco, p_fecha: fecha })
      if (error || !data) return
      manuales = Array.isArray(data) ? data : []
    } catch { return }
    if (!manuales.length) return

    let reaplicados = 0
    manuales.forEach(man => {
      // localizar la entrega (por id, o por unidad + monto)
      const e = res.entregas.find(x => !x.m && (
        (man.entrega_id && x.id === man.entrega_id) ||
        (!man.entrega_id && x.unidad === man.unidad && Math.abs(x.monto - (man.monto_entrega || 0)) < 0.01)
      ))
      if (!e) return
      // localizar los depósitos (por referencia si existe, si no por monto)
      const refs = man.deposito_refs || []
      const usados = []
      for (const d of refs) {
        let mv = null
        if (d.ref) mv = res.movs.find(m => !m.m && m.ref && m.ref === d.ref && !usados.includes(m.idx))
        if (!mv) mv = res.movs.find(m => !m.m && Math.abs(m.monto - (d.monto || 0)) < 0.01 && !usados.includes(m.idx))
        if (mv) usados.push(mv.idx)
      }
      // solo reaplicar si se encontraron TODOS los depósitos del emparejamiento
      if (usados.length === refs.length && usados.length > 0) {
        e.m = true; e.pars = usados; e.nivel = 'manual'
        usados.forEach(i => { res.movs[i].m = true; res.movs[i].par = e.idx })
        reaplicados++
      }
    })
    if (reaplicados) {
      res.conciliados = res.entregas.filter(x => x.m)
      res.entregasHuerfanas = res.entregas.filter(x => !x.m)
      res.depositosHuerfanos = res.movs.filter(x => !x.m)
      window.toast?.(`${reaplicados} emparejamiento(s) manual(es) recuperado(s)`, 'info')
    }
  }

  // ── UI ──
  window.initConciliaTaxis = function () {
    ctxFecha = ctxFecha || fechaLocal()
    ctxFile = null; ctxRes = null
    const root = document.getElementById('ctx-root')
    root.innerHTML = `
      <div class="ctx-card">
        <div class="ctx-controls">
          <div class="ctx-fld">
            <label>Banco</label>
            <div class="ctx-banco">
              <button class="ctx-bbtn ${ctxBanco === 'BAC' ? 'on' : ''}" data-b="BAC" onclick="ctxSetBanco('BAC')">BAC</button>
              <button class="ctx-bbtn ${ctxBanco === 'Ficohsa' ? 'on' : ''}" data-b="Ficohsa" onclick="ctxSetBanco('Ficohsa')">Ficohsa</button>
            </div>
          </div>
          <div class="ctx-fld">
            <label>Entregas del día</label>
            <input type="date" id="ctx-fecha" value="${ctxFecha}" onchange="ctxSetFecha(this.value)">
          </div>
          <div class="ctx-fld">
            <label>Fecha en el banco</label>
            <input type="date" id="ctx-fecha-banco" value="${ctxFechaBanco || ctxFecha}" onchange="ctxSetFechaBanco(this.value)">
          </div>
          <div class="ctx-fld ctx-grow">
            <label>Estado de cuenta (Excel del banco)</label>
            <input type="file" id="ctx-file" accept=".xls,.xlsx,.csv" onchange="ctxSetFile(this.files[0])">
          </div>
          <button class="btn btn-gold" id="ctx-btn" onclick="ctxConciliar()" disabled>Conciliar →</button>
        </div>
      </div>
      <div id="ctx-out"></div>`
    ctxEnsureStyles()
  }

  window.ctxSetBanco = (b) => {
    ctxBanco = b
    document.querySelectorAll('.ctx-bbtn').forEach(x => x.classList.toggle('on', x.dataset.b === b))
    ctxSugerirFechaBanco()  // al cambiar de banco, re-sugerir
  }
  window.ctxSetFecha = (v) => { if (v) { ctxFecha = v; ctxSugerirFechaBanco() } }
  window.ctxSetFechaBanco = (v) => { if (v) ctxFechaBanco = v }

  // Si el día de entregas cae sábado/domingo y el banco es Ficohsa, sugiere el lunes siguiente
  function ctxSugerirFechaBanco() {
    const inp = document.getElementById('ctx-fecha-banco')
    if (!inp || !ctxFecha) return
    let sugerida = ctxFecha
    if (ctxBanco === 'Ficohsa') {
      const d = new Date(ctxFecha + 'T12:00:00')
      const dow = d.getDay() // 0=dom, 6=sáb
      if (dow === 6) d.setDate(d.getDate() + 2)       // sábado → lunes
      else if (dow === 0) d.setDate(d.getDate() + 1)  // domingo → lunes
      sugerida = fechaLocal(d)
    }
    ctxFechaBanco = sugerida
    inp.value = sugerida
  }
  window.ctxSetFile = (f) => { ctxFile = f || null; const b = document.getElementById('ctx-btn'); if (b) b.disabled = !ctxFile }

  window.ctxConciliar = async () => {
    if (!ctxFile) { window.toast?.('Subí el estado de cuenta', 'error'); return }
    const btn = document.getElementById('ctx-btn'); btn.disabled = true; btn.textContent = 'Conciliando…'
    try {
      const fechaBanco = ctxFechaBanco || ctxFecha
      const movsAll = await parseExtracto(ctxFile, ctxBanco, fechaBanco)

      // Guardar las referencias de este extracto y detectar las que NO se deben
      // volver a presentar:
      //   (1) re-envíos del banco: vistas en extractos de días anteriores (BAC).
      //   (2) ya conciliadas para otro día reciente (Ficohsa fin de semana: el
      //       mismo extracto del lunes se usa para sábado, domingo y lunes).
      let duplicados = []
      let movs = movsAll
      try {
        const payload = movsAll.filter(m => m.ref).map(m => ({ ref: m.ref, monto: m.monto, desc: m.desc }))
        if (payload.length) {
          await csb().rpc('tx_refs_guardar', { p_banco: ctxBanco, p_fecha: fechaBanco, p_refs: payload })
        }
        const seen = {}
        // (1) re-envíos por fecha del banco
        try {
          const { data: prev } = await csb().rpc('tx_refs_previas', { p_banco: ctxBanco, p_fecha: fechaBanco, p_dias: 7 })
          ;(Array.isArray(prev) ? prev : []).forEach(p => { if (p.referencia) seen[String(p.referencia)] = { tipo: 'reenvio', fecha: p.fecha } })
        } catch (e) {}
        // (2) ya conciliadas para otro día de entregas reciente (precede a re-envío)
        try {
          const { data: conc } = await csb().rpc('tx_refs_conciliadas_previas', { p_banco: ctxBanco, p_fecha_entregas: ctxFecha, p_dias: 15 })
          ;(Array.isArray(conc) ? conc : []).forEach(c => { if (c.referencia) seen[String(c.referencia)] = { tipo: 'conciliado', fecha: c.fecha_entregas } })
        } catch (e) {}
        if (Object.keys(seen).length) {
          movs = []
          movsAll.forEach(m => {
            const s = m.ref ? seen[String(m.ref)] : null
            if (s) { m.dupFecha = s.fecha; m.dupTipo = s.tipo; duplicados.push(m) }
            else movs.push(m)
          })
          movs.forEach((m, i) => { m.idx = i })   // re-indexar idx contra el array movs
        }
      } catch (e) { /* si falla la detección, seguimos con todos los movimientos */ }

      const entregas = await cargarEntregas(ctxBanco, ctxFecha)
      ctxRes = conciliar(entregas, movs, ctxBanco)
      ctxRes.duplicados = duplicados
      // Reaplicar emparejamientos manuales guardados de una conciliación previa
      await reaplicarManuales(ctxRes, ctxBanco, ctxFecha)
      // total del débito de la partida [IMP-TAXI] del día (de las entregas) para este banco
      ctxPartida = null
      const cuenta = CTX_CUENTA[ctxBanco]
      if (cuenta) {
        const { data, error } = await csb().rpc('tx_partida_total_dia', { p_cuenta: cuenta, p_fecha: ctxFecha })
        if (!error) ctxPartida = parseFloat(data) || 0
      }
      ctxRender()
    } catch (e) {
      window.toast?.('Error: ' + (e.message || e), 'error')
    } finally { btn.disabled = false; btn.textContent = 'Conciliar →' }
  }

  function ctxRender() {
    const out = document.getElementById('ctx-out')
    const r = ctxRes
    if (!r) return
    const totEnt = r.entregas.length, totMov = r.movs.length
    const conc = r.conciliados.length
    const pct = totEnt ? Math.round(100 * conc / totEnt) : 0

    const resumen = `
      <div class="ctx-stats">
        <div class="ctx-stat ok"><div class="ctx-n">${conc}</div><div class="ctx-l">Conciliados (${pct}%)</div></div>
        <div class="ctx-stat warn"><div class="ctx-n">${r.entregasHuerfanas.length}</div><div class="ctx-l">Entregas sin depósito</div></div>
        <div class="ctx-stat warn"><div class="ctx-n">${r.depositosHuerfanos.length}</div><div class="ctx-l">Depósitos sin entrega</div></div>
        ${(r.duplicados && r.duplicados.length) ? `<div class="ctx-stat dup"><div class="ctx-n">${r.duplicados.length}</div><div class="ctx-l">Omitidas</div></div>` : ''}
      </div>
      <div class="ctx-sub">Banco ${r.banco} · entregas del ${ctxFecha}${(ctxFechaBanco && ctxFechaBanco !== ctxFecha) ? ` · depósitos del banco con fecha ${ctxFechaBanco}` : ''} · ${totEnt} entregas reportadas vs ${totMov} depósitos en el extracto</div>`

    // Conciliados
    const concRows = r.conciliados.map(e => {
      const deps = (e.pars || []).map(i => r.movs[i]).filter(Boolean)
      const nivelTxt = e.nivel === 1 ? 'cédula/unidad' : (e.nivel === 2 ? 'monto+nombre' : (e.nivel === 3 ? 'monto' : 'manual'))
      const depTxt = deps.length > 1
        ? deps.map(mv => `${mv.desc} (${fmt(mv.monto)})`).join(' + ')
        : (deps[0] ? deps[0].desc : '')
      return `<div class="ctx-row ok">
        <div class="ctx-row-l"><b>#${e.unidad}</b> ${e.nombre} · ${fmt(e.monto)}${deps.length > 1 ? ' <span class="ctx-multi">' + deps.length + ' depósitos</span>' : ''}</div>
        <div class="ctx-row-r">${depTxt} <span class="ctx-tag">${nivelTxt}</span></div>
      </div>`
    }).join('')
    const cConc = `<div class="ctx-grp"><div class="ctx-grp-t ok">✓ Conciliados (${conc})</div>${concRows || '<div class="ctx-empty">—</div>'}</div>`

    // Depósitos huérfanos (selección múltiple para emparejar)
    const sumSel = ctxSelDepositos.reduce((s, i) => s + (r.movs[i] ? r.movs[i].monto : 0), 0)
    const depRows = r.depositosHuerfanos.map(mv => {
      const sel = ctxSelDepositos.includes(mv.idx)
      const refTxt = mv.ref ? `<span class="ctx-ref">Ref: ${mv.ref}</span>` : ''
      return `<div class="ctx-row warn ${sel ? 'sel' : ''}" onclick="ctxElegirDeposito(${mv.idx})">
        <div class="ctx-row-l">${mv.desc || '(sin descripción)'} · ${fmt(mv.monto)} ${refTxt}</div>
        <div class="ctx-row-r"><span class="ctx-pick">${sel ? '☑ elegido' : '☐ elegir'}</span></div>
      </div>`
    }).join('')
    const selInfo = ctxSelDepositos.length
      ? `<div class="ctx-selinfo">${ctxSelDepositos.length} depósito(s) elegidos · suma <b>${fmt(sumSel)}</b> — ahora tocá "emparejar" en la entrega que corresponda</div>`
      : ''
    const cDep = `<div class="ctx-grp"><div class="ctx-grp-t warn">🏦 Depósitos sin entrega (${r.depositosHuerfanos.length})</div>
      ${r.depositosHuerfanos.length ? '<div class="ctx-hint">Tocá uno o varios depósitos (si una entrega se pagó en partes), luego "emparejar" en la entrega.</div>' : ''}
      ${selInfo}
      ${depRows || '<div class="ctx-empty">Todos los depósitos tienen entrega. 🎉</div>'}</div>`

    // Entregas huérfanas (con botón emparejar)
    const entRows = r.entregasHuerfanas.map(e => {
      const sumOk = ctxSelDepositos.length && Math.abs(sumSel - e.monto) < 0.01
      return `<div class="ctx-row warn">
        <div class="ctx-row-l"><b>#${e.unidad}</b> ${e.nombre} · ${fmt(e.monto)}${e.nivel === 'amb' ? ' <span class="ctx-amb">ambiguo</span>' : ''}</div>
        <div class="ctx-row-r"><button class="ctx-mbtn ${sumOk ? 'cuadra' : ''}" onclick="ctxEmparejar(${e.idx})" ${ctxSelDepositos.length === 0 ? 'disabled' : ''}>emparejar${sumOk ? ' ✓' : ''}</button></div>
      </div>`
    }).join('')
    const cEnt = `<div class="ctx-grp"><div class="ctx-grp-t warn">🚕 Entregas sin depósito (${r.entregasHuerfanas.length})</div>
      ${entRows || '<div class="ctx-empty">Todas las entregas tienen depósito. 🎉</div>'}</div>`

    // Panel de cuadre contra la partida contable del día
    const totalConc = r.conciliados.reduce((s, e) => s + e.monto, 0)
    const totalEnt = r.entregas.reduce((s, e) => s + e.monto, 0)
    const totalExt = r.movs.reduce((s, m) => s + m.monto, 0)
    const cuenta = CTX_CUENTA[r.banco] || '—'
    // ctxPartida null = no se pudo consultar; 0 = consultado pero la partida aún no existe
    const hayPartida = ctxPartida != null && ctxPartida > 0
    let cCuadre
    if (hayPartida) {
      const dif = Math.round((totalConc - ctxPartida) * 100) / 100
      const cuadra = Math.abs(dif) < 0.01
      cCuadre = `<div class="ctx-grp ctx-cuadre ${cuadra ? 'ok' : 'no'}">
        <div class="ctx-grp-t ${cuadra ? 'ok' : 'warn'}">${cuadra ? '✓' : '⚠'} Cuadre contra la partida contable</div>
        <div class="ctx-cuadre-rows">
          <div><span>Total conciliado</span><b>${fmt(totalConc)}</b></div>
          <div><span>Partida del día (débito ${cuenta})</span><b>${fmt(ctxPartida)}</b></div>
          <div class="ctx-cuadre-dif ${cuadra ? 'ok' : 'no'}"><span>Diferencia</span><b>${fmt(dif)}</b></div>
        </div>
        ${cuadra
          ? '<div class="ctx-cuadre-msg ok">Cuadra exacto con el movimiento contable del día. 🎉</div>'
          : '<div class="ctx-cuadre-msg no">No cuadra. Podés guardar igual; la diferencia queda registrada para resolver después.</div>'}
        <button class="btn btn-gold ctx-save" onclick="ctxGuardar()">💾 Guardar conciliación</button>
      </div>`
    } else {
      // flujo normal: todavía no generaste la partida. No es descuadre.
      cCuadre = `<div class="ctx-grp ctx-cuadre pend">
        <div class="ctx-grp-t info">🕒 Pendiente de partida</div>
        <div class="ctx-cuadre-rows">
          <div><span>Total conciliado</span><b>${fmt(totalConc)}</b></div>
          <div><span>Partida del día (débito ${cuenta})</span><b>— aún no generada</b></div>
        </div>
        <div class="ctx-cuadre-msg info">Guardá la conciliación ahora. Cuando generes la partida de taxis del ${ctxFecha} por <b>${fmt(totalConc)}</b>, se cuadrará sola automáticamente.</div>
        <button class="btn btn-gold ctx-save" onclick="ctxGuardar()">💾 Guardar conciliación</button>
      </div>`
    }
    // Omitidos: re-envíos del banco o referencias ya conciliadas otro día
    const dups = r.duplicados || []
    const dupRows = dups.map(mv => {
      const tag = mv.dupTipo === 'conciliado'
        ? `ya conciliado el ${mv.dupFecha || '—'}`
        : `ya visto el ${mv.dupFecha || '—'}`
      return `<div class="ctx-row dup">
        <div class="ctx-row-l">${mv.desc || '(sin descripción)'} · ${fmt(mv.monto)} ${mv.ref ? `<span class="ctx-ref">Ref: ${mv.ref}</span>` : ''}</div>
        <div class="ctx-row-r"><span class="ctx-dup-tag">${tag}</span></div>
      </div>`
    }).join('')
    const cDup = dups.length
      ? `<div class="ctx-grp"><div class="ctx-grp-t dup">♻️ Referencias omitidas (${dups.length})</div>
          <div class="ctx-hint">Depósitos que ya se conciliaron otro día, o que el banco re-envió de días anteriores. Se omiten para no presentarlos de nuevo.</div>
          ${dupRows}</div>`
      : ''

    // guardar totales para ctxGuardar
    ctxRes._totales = { conciliado: totalConc, entregas: totalEnt, extracto: totalExt }

    out.innerHTML = resumen + cCuadre + cConc + cDep + cDup + cEnt
  }

  window.ctxElegirDeposito = (idx) => {
    const p = ctxSelDepositos.indexOf(idx)
    if (p >= 0) ctxSelDepositos.splice(p, 1); else ctxSelDepositos.push(idx)
    ctxRender()
  }
  window.ctxEmparejar = (entIdx) => {
    if (!ctxSelDepositos.length) { window.toast?.('Primero elegí uno o más depósitos', 'error'); return }
    const e = ctxRes.entregas[entIdx]
    if (!e) return
    const deps = ctxSelDepositos.map(i => ctxRes.movs[i]).filter(Boolean)
    const suma = deps.reduce((s, mv) => s + mv.monto, 0)
    if (Math.abs(suma - e.monto) > 0.01) {
      const txt = deps.length > 1
        ? `La suma de ${deps.length} depósitos (${fmt(suma)}) no coincide con la entrega (${fmt(e.monto)}).`
        : `Los montos no coinciden (entrega ${fmt(e.monto)} vs depósito ${fmt(suma)}).`
      if (!confirm(txt + ' ¿Emparejar igual?')) return
    }
    e.m = true; e.pars = ctxSelDepositos.slice(); e.nivel = 'manual'
    deps.forEach(mv => { mv.m = true; mv.par = e.idx })
    ctxRes.conciliados = ctxRes.entregas.filter(x => x.m)
    ctxRes.entregasHuerfanas = ctxRes.entregas.filter(x => !x.m)
    ctxRes.depositosHuerfanos = ctxRes.movs.filter(x => !x.m)
    ctxSelDepositos = []
    window.toast?.(deps.length > 1 ? `Emparejado (${deps.length} depósitos)` : 'Emparejado', 'success')
    ctxRender()
  }

  window.ctxGuardar = async () => {
    if (!ctxRes) return
    const r = ctxRes
    const t = r._totales || { conciliado: 0, entregas: 0, extracto: 0 }
    // Construir el detalle del cruce
    const detalle = []
    r.conciliados.forEach(e => {
      const deps = (e.pars || []).map(i => r.movs[i]).filter(Boolean)
      detalle.push({
        entrega_id: e.id || null, unidad: e.unidad, nombre: e.nombre,
        monto_entrega: e.monto,
        deposito_desc: deps.map(d => `${d.desc} (${d.monto})`).join(' + '),
        monto_deposito: deps.reduce((s, d) => s + d.monto, 0),
        deposito_refs: deps.map(d => ({ ref: d.ref || null, monto: d.monto })),
        nivel: String(e.nivel)
      })
    })
    r.entregasHuerfanas.forEach(e => detalle.push({
      entrega_id: e.id || null, unidad: e.unidad, nombre: e.nombre,
      monto_entrega: e.monto, deposito_desc: null, monto_deposito: null, nivel: 'huerfano_ent'
    }))
    r.depositosHuerfanos.forEach(mv => detalle.push({
      entrega_id: null, unidad: null, nombre: null, monto_entrega: null,
      deposito_desc: mv.desc, monto_deposito: mv.monto, nivel: 'huerfano_dep'
    }))

    const btn = document.querySelector('.ctx-save')
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…' }
    try {
      const { data, error } = await csb().rpc('tx_guardar_conciliacion', {
        p_banco: r.banco, p_fecha: ctxFecha, p_cuenta: CTX_CUENTA[r.banco] || null,
        p_total_entregas: t.entregas, p_total_extracto: t.extracto, p_total_conciliado: t.conciliado,
        p_detalle: detalle
      })
      if (error) throw error
      if (!data?.ok) { window.toast?.(data?.error || 'No se pudo guardar', 'error'); return }
      // Registrar las referencias conciliadas para no re-presentarlas otro día
      try {
        const refsConc = []
        r.conciliados.forEach(e => (e.pars || []).forEach(i => {
          const mv = r.movs[i]; if (mv && mv.ref) refsConc.push({ ref: mv.ref, monto: mv.monto })
        }))
        if (refsConc.length) {
          await csb().rpc('tx_refs_conciliadas_guardar', {
            p_banco: r.banco, p_fecha_entregas: ctxFecha,
            p_fecha_banco: (ctxFechaBanco || ctxFecha), p_refs: refsConc
          })
        }
      } catch (e) { /* no bloquear el guardado por esto */ }
      window.toast?.(data.cuadra ? 'Conciliación guardada · cuadra ✓' : `Guardada · diferencia ${fmt(data.diferencia)}`, data.cuadra ? 'success' : 'info')
    } catch (e) {
      window.toast?.('Error: ' + (e.message || e), 'error')
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar conciliación' }
    }
  }

  function ctxEnsureStyles() {
    if (document.getElementById('ctx-styles')) return
    const s = document.createElement('style'); s.id = 'ctx-styles'
    s.textContent = `
      .ctx-card{background:#15171c;border:1px solid #2a2e37;border-radius:12px;padding:16px;margin-bottom:14px}
      .ctx-controls{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end}
      .ctx-fld{display:flex;flex-direction:column;gap:5px}.ctx-fld.ctx-grow{flex:1;min-width:220px}
      .ctx-fld label{font-size:12px;color:#9aa0aa;text-transform:uppercase;letter-spacing:.04em}
      .ctx-fld input{padding:9px 11px;background:#15171c;border:1px solid #2a2e37;border-radius:9px;color:#e8eaed;font-size:14px}
      .ctx-banco{display:flex;gap:6px}
      .ctx-bbtn{background:#15171c;border:1px solid #2a2e37;border-radius:9px;padding:9px 18px;color:#9aa0aa;font-weight:600;cursor:pointer}
      .ctx-bbtn.on{background:#2563eb;border-color:#2563eb;color:#fff}
      .ctx-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:8px}
      .ctx-stat{background:#15171c;border:1px solid #2a2e37;border-radius:12px;padding:15px;text-align:center}
      .ctx-stat.ok{border-color:rgba(22,163,74,.4)}.ctx-stat.warn{border-color:rgba(240,165,0,.35)}
      .ctx-n{font-size:22px;font-weight:800;color:#e8eaed}.ctx-stat.ok .ctx-n{color:#3fb950}.ctx-stat.warn .ctx-n{color:#f0a500}
      .ctx-l{font-size:12px;color:#9aa0aa;margin-top:4px}
      .ctx-sub{font-size:12px;color:#8b8f98;margin-bottom:14px}
      .ctx-grp{background:#15171c;border:1px solid #2a2e37;border-radius:12px;padding:14px;margin-bottom:12px}
      .ctx-grp-t{font-size:14px;font-weight:700;margin-bottom:10px}
      .ctx-grp-t.ok{color:#3fb950}.ctx-grp-t.warn{color:#f0a500}
      .ctx-grp-t.dup{color:#a78bfa}
      .ctx-stat.dup{border-color:rgba(167,139,250,.4)}.ctx-stat.dup .ctx-n{color:#a78bfa}
      .ctx-row.dup{border-left:3px solid #a78bfa;opacity:.85}
      .ctx-dup-tag{background:rgba(167,139,250,.16);color:#c4b5fd;border-radius:5px;padding:2px 8px;font-size:11px;white-space:nowrap}
      .ctx-hint{font-size:12px;color:#8b8f98;margin-bottom:10px}
      .ctx-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 11px;border-radius:8px;margin-bottom:6px;font-size:13px;background:#1a1d24}
      .ctx-row.ok{border-left:3px solid #3fb950}
      .ctx-row.warn{border-left:3px solid #f0a500;cursor:default}
      .ctx-row.warn.sel{background:rgba(37,99,235,.18);border-left-color:#4a90e2}
      .ctx-row-l{color:#e8eaed}.ctx-row-l b{color:#f0a500}
      .ctx-ref{display:inline-block;background:rgba(74,144,226,.15);color:#7eb6ff;border-radius:5px;padding:1px 7px;font-size:12px;font-weight:600;margin-left:6px;user-select:all}
      .ctx-row-r{color:#9aa0aa;font-size:12px;text-align:right;display:flex;align-items:center;gap:8px}
      .ctx-tag{background:#21242b;border-radius:5px;padding:2px 7px;font-size:11px;color:#8b8f98}
      .ctx-amb{background:rgba(240,165,0,.18);color:#f0a500;border-radius:5px;padding:1px 6px;font-size:11px}
      .ctx-pick{cursor:pointer;color:#4a90e2;font-size:12px;font-weight:600}
      .ctx-mbtn{background:rgba(37,99,235,.16);border:1px solid rgba(37,99,235,.5);border-radius:7px;color:#4a90e2;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer}
      .ctx-mbtn:disabled{opacity:.4;cursor:not-allowed}
      .ctx-mbtn.cuadra{background:rgba(22,163,74,.2);border-color:rgba(22,163,74,.6);color:#3fb950}
      .ctx-selinfo{background:rgba(37,99,235,.12);border:1px solid rgba(37,99,235,.4);border-radius:8px;padding:9px 11px;margin-bottom:10px;font-size:12px;color:#9bb8f0}
      .ctx-selinfo b{color:#fff}
      .ctx-multi{background:rgba(37,99,235,.18);color:#4a90e2;border-radius:5px;padding:1px 7px;font-size:11px}
      .ctx-cuadre{border-width:1px}
      .ctx-cuadre.ok{border-color:rgba(22,163,74,.5);background:rgba(22,163,74,.06)}
      .ctx-cuadre.no{border-color:rgba(240,165,0,.5);background:rgba(240,165,0,.05)}
      .ctx-cuadre.pend{border-color:rgba(37,99,235,.45);background:rgba(37,99,235,.05)}
      .ctx-grp-t.info{color:#6ea8ff}
      .ctx-cuadre-msg.info{background:rgba(37,99,235,.1);color:#9bb8f0}
      .ctx-cuadre-msg.info b{color:#fff}
      .ctx-cuadre-rows{display:flex;flex-direction:column;gap:6px;margin:6px 0 10px}
      .ctx-cuadre-rows>div{display:flex;justify-content:space-between;font-size:14px;color:#c8ccd2;padding:3px 0}
      .ctx-cuadre-rows>div b{font-family:ui-monospace,monospace;color:#e8eaed}
      .ctx-cuadre-dif{border-top:1px solid #2a2e37;padding-top:8px!important;margin-top:2px}
      .ctx-cuadre-dif.ok b{color:#3fb950}.ctx-cuadre-dif.no b{color:#f0a500}
      .ctx-cuadre-msg{font-size:12px;padding:8px 10px;border-radius:7px;margin-bottom:10px}
      .ctx-cuadre-msg.ok{background:rgba(22,163,74,.12);color:#7ee2a0}
      .ctx-cuadre-msg.no{background:rgba(240,165,0,.1);color:#f0c674}
      .ctx-save{width:100%}
      .ctx-empty{color:#8b8f98;font-size:13px;padding:6px}
    `
    document.head.appendChild(s)
  }
})()