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

  // Cuántos días atrás se busca una referencia para considerarla repetida.
  // BAC REUSA los números de transferencia: el mismo 412444292 apareció el
  // 07/07 (Rafael Moncada, L.200) y el 18/07 (Raúl Santos, L.500). Con una
  // ventana larga, el sistema descartaba depósitos buenos creyéndolos repetidos.
  // 3 días cubre lo que hay que cubrir (re-envío del banco y el extracto del
  // lunes que sirve para sábado y domingo) sin llegar a los números reusados.
  const DIAS_DUP = 3

  let ctxFecha = ''
  // ctxArchivos: un elemento por extracto cargado.
  //   { file, nombre, destino, auto, fechaBanco, fechaManual, movs, error }
  // La FECHA EN EL BANCO es por archivo, no global. Ficohsa acredita los
  // depósitos de sábado y domingo con fecha del lunes siguiente; BAC los
  // acredita el mismo día. Con un campo único, poner el lunes dejaba BAC en
  // cero y poner el viernes dejaba Ficohsa en cero.
  // Se concilia con TODOS los depósitos juntos contra TODAS las entregas del
  // día, en un solo cruce. Separar por cuenta encogía el lado de los depósitos
  // pero dejaba entero el de las entregas, y eso fabricaba huérfanas que no
  // eran errores: los depósitos que faltaban estaban en el otro archivo.
  // La cuenta contable la define el DEPÓSITO, no lo que eligió el motorista.
  let ctxArchivos = []
  // codigo de cuenta → fecha con la que el banco acreditó sus depósitos.
  // Se llena al conciliar y lo usan el subtítulo y el guardado.
  let ctxFechasBanco = {}
  let ctxRes = null          // resultado de la conciliación
  let ctxSelDepositos = []   // depósitos huérfanos elegidos para emparejar (permite varios → 1 entrega)
  let ctxDepFiltro = ''      // texto del buscador de depósitos sin entrega
  let ctxPartida = null      // total del débito de la partida [IMP-TAXI] del día (para el cuadre)

  // Los bancos y su cuenta contable salen de `destinos_deposito` (destinos.js),
  // ya no de un mapa fijo. Cada archivo guarda el CÓDIGO de su destino ('BAC',
  // 'BAC 2', 'Ficohsa'…), que es el mismo texto que traen entregas_taxis.banco
  // y tx_conciliaciones.banco — así las RPC siguen recibiendo lo que esperan y
  // cada cuenta conserva sus referencias y sus emparejamientos manuales aparte.
  let ctxDestinos = []
  // Sin código no hay destino: devolver null es correcto. Un archivo recién
  // cargado puede no tener cuenta asignada todavía y la pantalla se pinta igual.
  const ctxDest = (cod) => (cod ? ctxDestinos.find(d => d.codigo === cod) : null) || null
  // La INSTITUCIÓN es la que manda en el parseo: de ella depende cómo viene
  // escrito el depositante en el extracto. Dos cuentas del mismo banco se leen
  // igual, así que nada de esto se ramifica por código de destino.
  const ctxInst = (cod) => (ctxDest(cod) || {}).institucion || 'BAC'   // sin destino aún: se lee como BAC y se relee al elegir la cuenta
  const ctxCuentaDe = (cod) => (ctxDest(cod) || {}).cuenta_codigo || null

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

  // Clasifica el depositante de una descripción según la INSTITUCIÓN.
  // Antes recibía el banco y comparaba contra 'Ficohsa'/'BAC'. Con cuentas
  // nuevas ('BAC 2') esa comparación fallaba y caía al parseo de BAC por
  // descarte — funcionaba de casualidad. Ahora es explícito.
  function clasificar(desc, inst) {
    const d = String(desc || '').trim()
    const out = { nombre: null, unidad: null, identidad: null }
    if (inst === 'Ficohsa') {
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
  async function parseExtracto(file, inst, fecha) {
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
    // Texto del encabezado (lo que va antes de la tabla): de ahí sale el número
    // de cuenta para detectar a qué destino pertenece el archivo.
    const cabecera = rows.slice(0, hi + 1).map(r => (r || []).join(' ')).join(' ')

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
      const cl = clasificar(desc, inst)
      movs.push({ idx: movs.length, desc, ref, monto: cred, fecha: fIso, ...cl, m: false, par: null })
    }
    movs.cabecera = cabecera
    return movs
  }

  // Niveles 2 y 3 (monto+nombre y monto exacto único), repetidos mientras
  // haya progreso. Se corre dentro de conciliar() y OTRA VEZ después de
  // reponer los emparejamientos manuales: al ocupar esos depósitos, entregas
  // que antes tenían varios candidatos del mismo monto pasan a tener uno solo.
  // Antes se evaluaba una única vez y en orden, así que una entrega marcada
  // 'ambigua' quedaba así aunque después el empate se resolviera solo.
  function afinarPorMonto(entregas, movs) {
    let progreso = true
    while (progreso) {
      progreso = false
      entregas.forEach(e => {
        if (e.m) return
        const cands = movs.filter(mv => !mv.m && Math.abs(mv.monto - e.monto) < 0.01 && mv.nombre && nombresCoinciden(mv.nombre, e.nombre))
        if (cands.length === 1) {
          const mv = cands[0]
          e.m = mv.m = true; e.pars = [mv.idx]; mv.par = e.idx; e.nivel = 2
          progreso = true
        }
      })
      entregas.forEach(e => {
        if (e.m) return
        const cands = movs.filter(mv => !mv.m && Math.abs(mv.monto - e.monto) < 0.01)
        if (cands.length === 1) {
          const mv = cands[0]
          e.m = mv.m = true; e.pars = [mv.idx]; mv.par = e.idx; e.nivel = 3
          progreso = true
        }
      })
    }
    // Recién ahora se marca lo realmente ambiguo: varias entregas y varios
    // depósitos del mismo monto, sin forma de decidir cuál es cuál.
    let ambiguas = 0
    entregas.forEach(e => {
      if (e.m) { if (e.nivel === 'amb') e.nivel = 3; return }
      const cands = movs.filter(mv => !mv.m && Math.abs(mv.monto - e.monto) < 0.01)
      if (cands.length > 1) { e.nivel = 'amb'; ambiguas++ }
      else if (e.nivel === 'amb') e.nivel = null
    })
    return ambiguas
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
    const noReaplicados = []
    const nivelTxt = n => n === 1 ? 'cédula/unidad' : n === 2 ? 'monto+nombre' : n === 3 ? 'monto' : (n || 'automático')
    manuales.forEach(man => {
      const calza = x => (man.entrega_id && x.id === man.entrega_id) ||
        (!man.entrega_id && x.unidad === man.unidad && Math.abs(x.monto - (man.monto_entrega || 0)) < 0.01)
      // localizar la entrega libre
      const e = res.entregas.find(x => !x.m && calza(x))
      if (!e) {
        // ¿existe pero ya se concilió sola? No es un problema: el algoritmo
        // automático la resolvió sin necesidad del emparejamiento manual viejo.
        const ya = res.entregas.find(x => x.m && calza(x))
        noReaplicados.push({
          unidad: man.unidad, nombre: man.nombre, monto: man.monto_entrega,
          info: !!ya,
          motivo: ya
            ? `ya se concilió sola por ${nivelTxt(ya.nivel)} · no hace falta rehacerla`
            : 'la entrega ya no aparece en el día'
        })
        return
      }
      // Localizar los depósitos SOLO por referencia bancaria.
      // Antes había un respaldo por monto: si la referencia no aparecía, se
      // tomaba el primer depósito libre del mismo monto. Con veinte depósitos
      // de L.500.00 idénticos eso colocaba la marca en el motorista equivocado,
      // así que se quitó: si no calza la referencia, no se reaplica y se avisa.
      const refs = man.deposito_refs || []
      const usados = []
      const faltantes = []
      for (const d of refs) {
        let mv = null
        if (d.ref) mv = res.movs.find(m => !m.m && m.ref && m.ref === d.ref && !usados.includes(m.idx))
        if (mv) usados.push(mv.idx)
        else faltantes.push(d.ref ? `ref ${d.ref}` : `L.${fmt(d.monto || 0)} sin referencia`)
      }
      if (!faltantes.length && usados.length === refs.length && usados.length > 0) {
        e.m = true; e.pars = usados; e.nivel = 'manual'
        usados.forEach(i => { res.movs[i].m = true; res.movs[i].par = e.idx })
        reaplicados++
      } else {
        noReaplicados.push({
          unidad: man.unidad, nombre: man.nombre, monto: man.monto_entrega,
          motivo: faltantes.length ? `no se encontró ${faltantes.join(' · ')}` : 'sin depósitos guardados'
        })
      }
    })
    // Se llama una vez por cuenta: se acumula, no se pisa.
    res.manualesNoReaplicados = (res.manualesNoReaplicados || []).concat(noReaplicados)
    // Al reponer los manuales se ocuparon depósitos; entregas que antes tenían
    // varios candidatos del mismo monto pueden haber quedado con uno solo.
    const nuevos = afinarPorMonto(res.entregas, res.movs)
    if (reaplicados || res.entregas.some(x => x.m)) {
      res.conciliados = res.entregas.filter(x => x.m)
      res.entregasHuerfanas = res.entregas.filter(x => !x.m)
      res.depositosHuerfanos = res.movs.filter(x => !x.m)
    }
    if (reaplicados) {
      window.toast?.(`${reaplicados} emparejamiento(s) manual(es) recuperado(s)`, 'info')
    }
    if (noReaplicados.some(n => !n.info)) {
      const n = noReaplicados.filter(x => !x.info).length
      window.toast?.(`${n} emparejamiento(s) manual(es) NO se pudieron recuperar · revisalos abajo`, 'error')
    }
  }

  // ── DETECCIÓN DE CUENTA ──
  // Busca el número de cuenta del catálogo dentro del encabezado del extracto.
  // Primero el número completo; si no aparece (el banco lo enmascara o lo
  // escribe con guiones), se prueba con los últimos 6 dígitos, y SOLO se acepta
  // si un único destino coincide: con dos candidatos preferimos no elegir a
  // elegir mal, porque asignar el extracto a la cuenta equivocada manda el
  // dinero a otra cuenta contable y el total general igual cuadra.
  function detectarDestino(cabecera) {
    const dig = String(cabecera || '').replace(/\D/g, '')
    if (!dig) return ''
    const conNum = ctxDestinos.filter(d => d.numero_cuenta && String(d.numero_cuenta).replace(/\D/g, ''))
    const exactos = conNum.filter(d => dig.includes(String(d.numero_cuenta).replace(/\D/g, '')))
    if (exactos.length === 1) return exactos[0].codigo
    if (exactos.length > 1) return ''
    const colas = conNum.filter(d => {
      const n = String(d.numero_cuenta).replace(/\D/g, '')
      return n.length >= 6 && dig.includes(n.slice(-6))
    })
    return colas.length === 1 ? colas[0].codigo : ''
  }

  // Fecha que le corresponde a un archivo según la institución de su cuenta.
  // Ficohsa no acredita fin de semana: sábado y domingo caen con fecha del
  // lunes siguiente. BAC acredita el mismo día.
  function sugerirFecha(destino) {
    if (!ctxFecha) return ''
    if (ctxInst(destino) !== 'Ficohsa') return ctxFecha
    const d = new Date(ctxFecha + 'T12:00:00')
    const dow = d.getDay()                       // 0=dom, 6=sáb
    if (dow === 6) d.setDate(d.getDate() + 2)
    else if (dow === 0) d.setDate(d.getDate() + 1)
    return fechaLocal(d)
  }

  // ── UI ──
  window.initConciliaTaxis = async function () {
    ctxFecha = ctxFecha || fechaLocal()
    ctxArchivos = []; ctxRes = null
    const root = document.getElementById('ctx-root')
    root.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div></div>'
    ctxEnsureStyles()

    try {
      const todos = await window.cargarDestinos(true)
      ctxDestinos = (todos || []).filter(d => d.tipo === 'banco' && d.activa)
    } catch (e) {
      root.innerHTML = `<div class="ctx-empty">No se pudo leer el catálogo de destinos: ${String(e.message || e)}</div>`
      return
    }
    if (!ctxDestinos.length) {
      root.innerHTML = '<div class="ctx-empty">No hay cuentas bancarias activas en el catálogo. Agregá una en Contabilidad → Destinos de depósito.</div>'
      return
    }

    const sinNumero = ctxDestinos.filter(d => !d.numero_cuenta)
    root.innerHTML = `
      <div class="ctx-card">
        <div class="ctx-controls">
          <div class="ctx-fld">
            <label>Entregas del día</label>
            <input type="date" id="ctx-fecha" value="${ctxFecha}" onchange="ctxSetFecha(this.value)">
          </div>
          <div class="ctx-fld ctx-grow">
            <label>Estados de cuenta (uno por cuenta · podés elegir varios)</label>
            <input type="file" id="ctx-file" accept=".xls,.xlsx,.csv" multiple onchange="ctxAgregarArchivos(this.files)">
          </div>
          <button class="btn btn-gold" id="ctx-btn" onclick="ctxConciliar()" disabled>Conciliar →</button>
        </div>
        <div id="ctx-files"></div>
        ${sinNumero.length ? `<div class="ctx-aviso warn">⚠️ ${sinNumero.length} cuenta(s) sin número registrado (${sinNumero.map(d => d.codigo).join(', ')}). Sin el número no se puede detectar sola a qué cuenta pertenece cada archivo: vas a tener que elegirla a mano. Cargalo en Contabilidad → Destinos de depósito.</div>` : ''}
        <div class="ctx-aviso">Cada archivo lleva su propia <b>fecha en el banco</b>: Ficohsa acredita sábado y domingo con fecha del lunes, BAC el mismo día. Se ajusta sola al elegir la cuenta; podés corregirla.</div>
      </div>
      <div id="ctx-out"></div>`
    ctxRenderArchivos()
  }

  // ── ARCHIVOS ──
  window.ctxAgregarArchivos = async (fileList) => {
    const nuevos = Array.from(fileList || [])
    if (!nuevos.length) return
    const inp = document.getElementById('ctx-file')
    for (const f of nuevos) {
      if (ctxArchivos.some(a => a.nombre === f.name && a.file.size === f.size)) {
        window.toast?.(`"${f.name}" ya estaba cargado`, 'info')
        continue
      }
      const item = { file: f, nombre: f.name, destino: '', auto: false, fechaBanco: ctxFecha, fechaManual: false, movs: [], error: null, activo: true }
      ctxArchivos.push(item)
      try {
        // Primera lectura con la fecha del día solo para poder mirar el
        // encabezado. Con la cuenta detectada se ajusta la fecha y se relee.
        item.movs = await parseExtracto(f, 'BAC', item.fechaBanco)
        const det = detectarDestino(item.movs.cabecera)
        if (det) {
          item.destino = det; item.auto = true
          item.fechaBanco = sugerirFecha(det)
          await reparsear(item)
        }
      } catch (e) {
        item.error = e.message || String(e)
      }
    }
    if (inp) inp.value = ''
    ctxRenderArchivos()
  }

  window.ctxQuitarArchivo = (i) => {
    ctxArchivos.splice(i, 1); ctxRes = null
    const out = document.getElementById('ctx-out'); if (out) out.innerHTML = ''
    ctxRenderArchivos()
  }

  window.ctxSetDestinoArchivo = async (i, cod) => {
    const a = ctxArchivos[i]; if (!a) return
    a.destino = cod; a.auto = false
    // La fecha sugerida depende de la institución, así que cambia con la cuenta
    // — salvo que ya la hayas tocado a mano, en cuyo caso mandás vos.
    if (!a.fechaManual) a.fechaBanco = sugerirFecha(cod)
    await reparsear(a)
    ctxRenderArchivos()
  }

  window.ctxSetFechaArchivo = async (i, v) => {
    const a = ctxArchivos[i]; if (!a || !v) return
    a.fechaBanco = v; a.fechaManual = true
    await reparsear(a)
    ctxRenderArchivos()
  }

  async function reparsear(a) {
    a.error = null
    try {
      const inst = ctxInst(a.destino)
      a.movs = await parseExtracto(a.file, inst, a.fechaBanco || ctxFecha)
    } catch (e) { a.error = e.message || String(e); a.movs = [] }
  }

  function ctxRenderArchivos() {
    const cont = document.getElementById('ctx-files')
    if (!cont) return
    if (!ctxArchivos.length) { cont.innerHTML = ''; ctxActualizarBoton(); return }
    const filas = ctxArchivos.map((a, i) => {
      const opts = ['<option value="">— Elegir cuenta —</option>']
        .concat(ctxDestinos.map(d => `<option value="${d.codigo.replace(/"/g, '&quot;')}" ${d.codigo === a.destino ? 'selected' : ''}>${d.codigo} · ${d.etiqueta}</option>`))
        .join('')
      const cta = ctxCuentaDe(a.destino)
      const tot = a.movs.reduce((s, m) => s + m.monto, 0)
      const corrida = a.fechaBanco && a.fechaBanco !== ctxFecha
      const vacio = !a.error && a.destino && !a.movs.length
      return `<div class="ctx-file-row${a.error ? ' err' : ''}${vacio ? ' vacio' : ''}${a.activo ? '' : ' off'}">
        <label class="ctx-file-ck" title="Incluir este archivo en la conciliación">
          <input type="checkbox" ${a.activo ? 'checked' : ''} onchange="ctxSetActivo(${i}, this.checked)">
        </label>
        <div class="ctx-file-n" title="${a.nombre.replace(/"/g, '&quot;')}">📄 ${a.nombre}</div>
        <div class="ctx-file-sel">
          <select onchange="ctxSetDestinoArchivo(${i}, this.value)">${opts}</select>
          ${a.auto ? '<span class="ctx-auto">detectada</span>' : ''}
        </div>
        <div class="ctx-file-f">
          <input type="date" value="${a.fechaBanco || ctxFecha}" onchange="ctxSetFechaArchivo(${i}, this.value)" title="Fecha con la que el banco acreditó estos depósitos">
          ${corrida ? `<span class="ctx-auto" title="Ficohsa acredita sábado y domingo el lunes siguiente">${ctxInst(a.destino) === 'Ficohsa' ? 'fin de semana' : 'otra fecha'}</span>` : ''}
        </div>
        <div class="ctx-file-i">${a.error
          ? `<span class="ctx-file-err">${a.error}</span>`
          : `${a.movs.length} depósito(s) · ${fmt(tot)}${cta ? ` · <b>${cta}</b>` : ' · <span class="ctx-file-err">falta la cuenta</span>'}`}</div>
        <button class="ctx-file-x" onclick="ctxQuitarArchivo(${i})" title="Quitar">✕</button>
      </div>`
    }).join('')
    // Atajo por banco. BAC empareja por referencia y Ficohsa por monto, así que
    // cruzarlos juntos mete los depósitos de uno en el pozo de montos del otro
    // y hace más probable un emparejamiento equivocado. Conviene correr cada
    // banco por separado.
    const porInst = {}
    ctxArchivos.forEach(a => {
      const inst = ctxInst(a.destino) || '—'
      porInst[inst] = porInst[inst] || { total: 0, activos: 0 }
      porInst[inst].total++
      if (a.activo) porInst[inst].activos++
    })
    const chips = Object.keys(porInst).length > 1
      ? `<div class="ctx-inst-chips">Conciliar solo:
          ${Object.keys(porInst).sort().map(inst => {
            const c = porInst[inst]
            const on = c.activos === c.total && c.activos > 0
            return `<button class="ctx-inst-chip ${on ? 'on' : ''}" onclick="ctxSoloInst('${inst.replace(/'/g, "\\'")}')">${inst} <span>${c.total}</span></button>`
          }).join('')}
          <button class="ctx-inst-chip" onclick="ctxSoloInst('')">Todos</button>
        </div>` : ''

    const dup = ctxDestinosRepetidos()
    const vacios = ctxArchivos.filter(a => !a.error && a.destino && !a.movs.length)
    cont.innerHTML = `<div class="ctx-files">${chips}${filas}
      ${dup.length ? `<div class="ctx-file-warn">⚠️ Hay ${dup.length > 1 ? 'cuentas repetidas' : 'una cuenta repetida'} en dos archivos (${dup.join(', ')}). Cada cuenta va una sola vez: si no, sus depósitos se cuentan doble.</div>` : ''}
      ${vacios.length ? `<div class="ctx-file-warn">⚠️ ${vacios.length} archivo(s) sin ningún depósito en su fecha. Revisá la fecha en el banco de esa fila: el extracto puede traer los movimientos con otra fecha.</div>` : ''}</div>`
    ctxActualizarBoton()
  }

  window.ctxSetActivo = (i, v) => {
    const a = ctxArchivos[i]; if (!a) return
    a.activo = !!v
    ctxRes = null
    const out = document.getElementById('ctx-out'); if (out) out.innerHTML = ''
    ctxRenderArchivos()
  }

  // Deja activos solo los archivos de esa institución. '' = todos.
  window.ctxSoloInst = (inst) => {
    ctxArchivos.forEach(a => { a.activo = !inst || ctxInst(a.destino) === inst })
    ctxRes = null
    const out = document.getElementById('ctx-out'); if (out) out.innerHTML = ''
    ctxRenderArchivos()
  }

  const ctxActivos = () => ctxArchivos.filter(a => a.activo)

  function ctxDestinosRepetidos() {
    const c = {}
    ctxActivos().forEach(a => { if (a.destino) c[a.destino] = (c[a.destino] || 0) + 1 })
    return Object.keys(c).filter(k => c[k] > 1)
  }

  function ctxActualizarBoton() {
    const b = document.getElementById('ctx-btn')
    if (!b) return
    const act = ctxActivos()
    const listo = act.length > 0
      && act.every(a => !a.error && a.destino)
      && !ctxDestinosRepetidos().length
    b.disabled = !listo
  }

  window.ctxSetFecha = async (v) => {
    if (!v) return
    ctxFecha = v
    // Las fechas que no tocaste a mano siguen a la del día; las que corregiste
    // se respetan.
    for (const a of ctxArchivos) {
      if (!a.fechaManual) a.fechaBanco = sugerirFecha(a.destino)
      await reparsear(a)
    }
    ctxRenderArchivos()
  }

  window.ctxConciliar = async () => {
    const archivos = ctxActivos()
    if (!archivos.length) { window.toast?.('No hay ningún archivo seleccionado para conciliar', 'error'); return }
    if (archivos.some(a => !a.destino)) { window.toast?.('Falta indicar la cuenta de algún archivo', 'error'); return }
    if (ctxDestinosRepetidos().length) { window.toast?.('Hay una cuenta cargada dos veces', 'error'); return }
    ctxDepFiltro = ''
    const btn = document.getElementById('ctx-btn'); btn.disabled = true; btn.textContent = 'Conciliando…'
    try {
      const codigos = archivos.map(a => a.destino)
      // Cada cuenta guarda con qué fecha el banco acreditó sus depósitos; se
      // usa en las RPC de referencias, que trabajan por banco y por fecha.
      const fechaDe = {}
      archivos.forEach(a => { fechaDe[a.destino] = a.fechaBanco || ctxFecha })
      ctxFechasBanco = fechaDe

      // Todos los depósitos en una sola bolsa, cada uno con su cuenta pegada.
      // `destino` viaja con el movimiento hasta el guardado: es lo que decide a
      // qué cuenta contable entró el dinero, sin importar lo que dijo el motorista.
      const movsAll = []
      archivos.forEach(a => a.movs.forEach(m => movsAll.push({ ...m, destino: a.destino })))

      // ── Duplicados ──
      // La llave lleva la CUENTA además de referencia y monto: BAC reusa los
      // números de transferencia, así que el mismo ref+monto en dos cuentas
      // distintas son dos depósitos reales, no una repetición.
      const kRef = (destino, ref, monto) => {
        const r = String(ref == null ? '' : ref).trim()
        if (!r) return ''
        const n = Number(monto)
        return destino + '|' + r + (Number.isFinite(n) ? '|' + n.toFixed(2) : '')
      }
      let duplicados = []
      const _vistos = new Set()
      let movs = []
      movsAll.forEach(m => {
        const key = kRef(m.destino, m.ref, m.monto)
        if (key && _vistos.has(key)) { m.dupTipo = 'igual'; duplicados.push(m) }
        else { if (key) _vistos.add(key); movs.push(m) }
      })
      movs.forEach((m, i) => { m.idx = i })

      // ── Referencias ya vistas · una consulta por cuenta ──
      // Las RPC trabajan por banco, así que se llaman una vez por cuenta y los
      // resultados se guardan con la cuenta en la llave. Así cada cuenta
      // conserva su propio historial de re-envíos sin contaminar a las otras.
      try {
        const seen = {}, seenSolo = {}
        const marcar = (destino, referencia, monto, info) => {
          if (!referencia) return
          const r = String(referencia).trim()
          const n = Number(monto)
          if (Number.isFinite(n) && monto !== null && monto !== '') seen[destino + '|' + r + '|' + n.toFixed(2)] = info
          else seenSolo[destino + '|' + r] = info
        }
        for (const a of archivos) {
          const propios = movs.filter(m => m.destino === a.destino && m.ref)
          try {
            const payload = propios.map(m => ({ ref: m.ref, monto: m.monto, desc: m.desc }))
            if (payload.length) await csb().rpc('tx_refs_guardar', { p_banco: a.destino, p_fecha: a.fechaBanco || ctxFecha, p_refs: payload })
          } catch (e) {}
          try {
            const { data: prev } = await csb().rpc('tx_refs_previas', { p_banco: a.destino, p_fecha: a.fechaBanco || ctxFecha, p_dias: DIAS_DUP })
            ;(Array.isArray(prev) ? prev : []).forEach(x => marcar(a.destino, x.referencia, x.monto, { tipo: 'reenvio', fecha: x.fecha }))
          } catch (e) {}
          try {
            const { data: conc } = await csb().rpc('tx_refs_conciliadas_previas', { p_banco: a.destino, p_fecha_entregas: ctxFecha, p_dias: DIAS_DUP })
            ;(Array.isArray(conc) ? conc : []).forEach(x => marcar(a.destino, x.referencia, x.monto, { tipo: 'conciliado', fecha: x.fecha_entregas }))
          } catch (e) {}
        }
        if (Object.keys(seen).length || Object.keys(seenSolo).length) {
          const _f = []
          movs.forEach(m => {
            const r = m.ref ? String(m.ref).trim() : ''
            const s2 = r ? (seen[kRef(m.destino, m.ref, m.monto)] || seenSolo[m.destino + '|' + r]) : null
            if (s2) { m.dupFecha = s2.fecha; m.dupTipo = s2.tipo; duplicados.push(m) }
            else _f.push(m)
          })
          movs = _f
          movs.forEach((m, i) => { m.idx = i })
        }
      } catch (e) { /* si falla la detección, seguimos con todos los movimientos */ }

      // ── Entregas: TODAS las del día, sin filtrar por banco ──
      // Antes se filtraba por el banco elegido. Eso era el error de fondo: la
      // entrega dice a dónde CREYÓ depositar el motorista, y puede no coincidir
      // con dónde entró la plata. El cruce se hace contra todas y la cuenta la
      // pone el depósito.
      // Las entregas SIEMPRE se recortan a los bancos de esta corrida. Antes el
      // recorte solo se aplicaba si habías desmarcado algún archivo, así que
      // subir únicamente el extracto de Ficohsa traía también las entregas de
      // BAC y las mostraba como "sin depósito" — cuando en realidad su extracto
      // ni siquiera estaba en el cruce.
      // Si subís los dos bancos, `instituciones` los incluye a ambos y el
      // recorte no quita nada: ahí se sigue detectando quién depositó en el
      // banco equivocado.
      // Se declara ANTES de cargar las entregas: es lo que decide el recorte.
      const instituciones = [...new Set(archivos.map(a => ctxInst(a.destino)))]
      const todasInst = [...new Set(ctxDestinos.map(d => d.institucion).filter(Boolean))]
      const entregas = await cargarEntregasTodas(ctxFecha, codigos, instituciones)

      // El matching por identificador fuerte depende de la institución: se corre
      // una pasada por cada una, viendo solo sus propios depósitos.
      ctxRes = conciliarMulti(entregas, movs, instituciones)
      ctxSelDepositos = []   // el cálculo nuevo renumera los depósitos: lo elegido antes ya no aplica
      ctxRes.duplicados = duplicados
      ctxRes.codigos = codigos
      // Parcial = faltan bancos por conciliar, no que hayas desmarcado archivos.
      ctxRes.parcial = instituciones.length < todasInst.length ? instituciones : null

      // Emparejamientos manuales guardados: una consulta por cuenta, todas
      // aplicadas sobre el mismo resultado.
      ctxRes.manualesNoReaplicados = []
      for (const cod of codigos) await reaplicarManuales(ctxRes, cod, ctxFecha)

      // Partida contable: un total por cuenta.
      ctxPartida = {}
      for (const cod of codigos) {
        const cuenta = ctxCuentaDe(cod)
        if (!cuenta) continue
        try {
          const { data, error } = await csb().rpc('tx_partida_total_dia', { p_cuenta: cuenta, p_fecha: ctxFecha })
          if (!error) ctxPartida[cod] = parseFloat(data) || 0
        } catch (e) {}
      }
      ctxRender()
    } catch (e) {
      window.toast?.('Error: ' + (e.message || e), 'error')
    } finally { btn.disabled = false; btn.textContent = 'Conciliar →'; ctxActualizarBoton() }
  }

  // Todas las entregas aprobadas del día, sin importar el destino que declaró
  // el motorista. `bancoDeclarado` se conserva para poder señalar después los
  // casos en que el depósito entró en otra cuenta.
  // `instFiltro` limita a las entregas cuyo destino declarado pertenece a esas
  // instituciones. Null = todas, que es el caso normal.
  async function cargarEntregasTodas(fecha, codigos, instFiltro) {
    const { data, error } = await csb().from('entregas_taxis').select('*')
      .eq('fecha_deposito', fecha).eq('estado', 'Aprobada')
    if (error) throw error
    // Las entregas de caja no se depositan en banco: no tienen nada que cruzar.
    const soloBanco = (data || []).filter(e => {
      const d = ctxDestinos.find(x => x.codigo === String(e.banco || '').trim())
      if (!d) return false   // ctxDestinos ya viene filtrado a tipo banco
      if (instFiltro && !instFiltro.includes(d.institucion)) return false
      return true
    })
    return soloBanco.map((e, i) => ({
      idx: i, id: e.id, unidad: String(e.unidad || '').trim(),
      nombre: e.nombre_conductor || '', identidad: String(e.identidad || '').trim(),
      monto: parseFloat(e.monto) || 0, bancoDeclarado: String(e.banco || '').trim(),
      m: false, pars: [], nivel: null
    }))
  }

  // Nivel 1 por institución (cada pasada ve solo los depósitos de bancos de esa
  // institución), y después el afinado por monto sobre TODO el conjunto.
  function conciliarMulti(entregas, movs, instituciones) {
    instituciones.forEach(inst => {
      const propios = movs.filter(m => ctxInst(m.destino) === inst)
      entregas.forEach(e => {
        if (e.m) return
        const mismos = propios.filter(mv => !mv.m && (
          (inst === 'Ficohsa' && mv.identidad && digs(mv.identidad) === digs(e.identidad)) ||
          (inst === 'BAC' && mv.unidad && mv.unidad === e.unidad) ||
          (inst === 'BAC' && mv.identidad && digs(mv.identidad) === digs(e.identidad))
        ))
        if (!mismos.length) return
        const exacto = mismos.find(mv => Math.abs(mv.monto - e.monto) < 0.01)
        if (exacto) { e.m = exacto.m = true; e.pars = [exacto.idx]; exacto.par = e.idx; e.nivel = 1; return }
        const suma = mismos.reduce((s2, mv) => s2 + mv.monto, 0)
        if (mismos.length > 1 && Math.abs(suma - e.monto) < 0.01) {
          e.m = true; e.pars = mismos.map(mv => mv.idx); mismos.forEach(mv => { mv.m = true; mv.par = e.idx }); e.nivel = 1
        }
      })
    })
    afinarPorMonto(entregas, movs)
    return {
      conciliados: entregas.filter(e => e.m),
      entregasHuerfanas: entregas.filter(e => !e.m),
      depositosHuerfanos: movs.filter(mv => !mv.m),
      entregas, movs
    }
  }

  // Cuenta de una entrega conciliada = la de su depósito. Si sus depósitos
  // vienen de cuentas distintas (pago fraccionado entre dos cuentas), acá se
  // devuelve la primera solo para mostrar; el reparto real por monto lo hace
  // ctxGuardar, que manda la porción de cada cuenta a su propia conciliación.
  function destinoDeEntrega(e, r) {
    const deps = (e.pars || []).map(i => r.movs[i]).filter(Boolean)
    const cods = [...new Set(deps.map(d => d.destino))]
    return cods.length === 1 ? cods[0] : (cods[0] || '')
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
      <div class="ctx-sub">${(r.codigos || []).map(c => c + ((ctxFechasBanco[c] && ctxFechasBanco[c] !== ctxFecha) ? ` (banco ${ctxFechasBanco[c]})` : '')).join(' + ')} · entregas del ${ctxFecha} · ${totEnt} entregas reportadas vs ${totMov} depósitos en los extractos</div>
      ${r.parcial ? `<div class="ctx-parcial">Conciliación de <b>${r.parcial.join(' y ')}</b> únicamente. Las entregas de los otros bancos no entraron al cruce: subí su extracto y conciliá aparte.</div>` : ''}`

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
    // La selección guarda POSICIONES de la lista. Si el depósito elegido se concilió
    // por otro lado (o cambió el cálculo), esa posición queda colgada: la barra azul
    // no se podía soltar y "emparejar" habría usado el depósito equivocado.
    const vivos = new Set(r.depositosHuerfanos.map(mv => mv.idx))
    const habiaSel = ctxSelDepositos.length
    ctxSelDepositos = ctxSelDepositos.filter(i => vivos.has(i))
    if (habiaSel && !ctxSelDepositos.length) {
      window.toast?.('El depósito que tenías elegido ya quedó conciliado: se limpió la selección', 'info')
    }
    const sumSel = ctxSelDepositos.reduce((s, i) => s + (r.movs[i] ? r.movs[i].monto : 0), 0)
    const depRows = r.depositosHuerfanos.map(mv => {
      const sel = ctxSelDepositos.includes(mv.idx)
      const refTxt = mv.ref ? `<span class="ctx-ref">Ref: ${mv.ref}</span>` : ''
      const sTxt = `${mv.desc || ''} ${mv.ref || ''} ${mv.monto}`.toLowerCase().replace(/"/g, '')
      // Botón de pista: solo si el depósito trae un punto RapiBac reconocible.
      const punto = ctxPuntoRapibac(mv.desc)
      const pistaBtn = punto
        ? `<button class="ctx-punto-btn" onclick="event.stopPropagation();ctxQuienUsaPunto('${punto}', this)" title="Ver qué motoristas suelen depositar en el punto ${punto}"><svg class=ico aria-hidden=true><use href=#i-user></use></svg> ¿quién usa ${punto}?</button>`
        : ''
      // Botón de pista para transferencias: "TEF DE:NOMBRE".
      // Se pasa el índice, no el nombre, para no tener que escapar comillas.
      const depTef = ctxNombreTef(mv.desc)
      const depBtn = depTef
        ? `<button class="ctx-punto-btn" onclick="event.stopPropagation();ctxQuienDeposita(${mv.idx}, this)" title="Ver a qué motoristas le ha depositado antes esta persona"><svg class=ico aria-hidden=true><use href=#i-user></use></svg> ¿a quién le deposita?</button>`
        : ''
      return `<div class="ctx-row warn ctx-dep-row ${sel ? 'sel' : ''}" data-s="${sTxt}" onclick="ctxElegirDeposito(${mv.idx})">
        <div class="ctx-row-l">${mv.desc || '(sin descripción)'} · ${fmt(mv.monto)} ${refTxt}${pistaBtn}${depBtn}</div>
        <div class="ctx-row-r"><span class="ctx-pick">${sel ? '☑ elegido' : '☐ elegir'}</span></div>
      </div>`
    }).join('')
    const selInfo = ctxSelDepositos.length
      ? `<div class="ctx-selinfo">${ctxSelDepositos.length} depósito(s) elegidos · suma <b>${fmt(sumSel)}</b> — ahora tocá "emparejar" en la entrega que corresponda
           <button class="ctx-punto-btn" style="margin-left:8px" onclick="ctxLimpiarSeleccion()" title="Soltar los depósitos elegidos">limpiar</button></div>`
      : ''
    const buscador = r.depositosHuerfanos.length > 3
      ? `<div class="ctx-dep-search"><input id="ctx-dep-search" type="text" placeholder="🔎 Buscar por referencia, nombre o monto…" value="${ctxDepFiltro.replace(/"/g, '&quot;')}" oninput="ctxDepBuscar(this.value)" autocomplete="off" style="width:100%;padding:8px 10px;border-radius:8px;background:var(--bg-inset,#0f1115);border:1px solid #2a2f3a;color:var(--text,#e6e8ec);font-size:13px;margin:6px 0"><span id="ctx-dep-count" style="color:var(--text2,#8b8f98);font-size:11px"></span></div>`
      : ''
    const cDep = `<div class="ctx-grp"><div class="ctx-grp-t warn">🏦 Depósitos sin entrega (${r.depositosHuerfanos.length})</div>
      ${r.depositosHuerfanos.length ? '<div class="ctx-hint">Tocá uno o varios depósitos (si una entrega se pagó en partes), luego "emparejar" en la entrega.</div>' : ''}
      ${buscador}
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

    // ── Panel de cuadre · UNA FILA POR CUENTA ──
    // El total conciliado se reparte según la cuenta del DEPÓSITO, no según lo
    // que declaró el motorista. Cada cuenta se compara contra su propia partida.
    const totalConc = r.conciliados.reduce((s, e) => s + e.monto, 0)
    const totalEnt = r.entregas.reduce((s, e) => s + e.monto, 0)
    const totalExt = r.movs.reduce((s, m) => s + m.monto, 0)
    const porCuenta = {}
    ;(r.codigos || []).forEach(c => { porCuenta[c] = { conciliado: 0, n: 0 } })
    r.conciliados.forEach(e => {
      ;(e.pars || []).map(i => r.movs[i]).filter(Boolean).forEach(d => {
        if (!porCuenta[d.destino]) porCuenta[d.destino] = { conciliado: 0, n: 0 }
        porCuenta[d.destino].conciliado += d.monto
        porCuenta[d.destino].n++
      })
    })
    r._porCuenta = porCuenta

    const filasCuadre = Object.keys(porCuenta).map(cod => {
      const c = porCuenta[cod]
      const cuenta = ctxCuentaDe(cod) || '—'
      const p = ctxPartida ? ctxPartida[cod] : null
      const hay = p != null && p > 0
      const dif = hay ? Math.round((c.conciliado - p) * 100) / 100 : null
      const cuadra = hay && Math.abs(dif) < 0.01
      return `<div class="ctx-cq ${hay ? (cuadra ? 'ok' : 'no') : 'pend'}">
        <div class="ctx-cq-h"><b>${cod}</b> <span class="ctx-cq-cta">${cuenta}</span></div>
        <div class="ctx-cq-rows">
          <div><span>Conciliado (${c.n} depósito${c.n === 1 ? '' : 's'})</span><b>${fmt(c.conciliado)}</b></div>
          <div><span>Partida del día</span><b>${hay ? fmt(p) : '— aún no generada'}</b></div>
          ${hay ? `<div class="ctx-cuadre-dif ${cuadra ? 'ok' : 'no'}"><span>Diferencia</span><b>${fmt(dif)}</b></div>` : ''}
        </div>
      </div>`
    }).join('')

    const algunaPartida = ctxPartida && Object.keys(porCuenta).some(c => (ctxPartida[c] || 0) > 0)
    const todasCuadran = algunaPartida && Object.keys(porCuenta).every(c => {
      const p = ctxPartida[c]
      return p == null || p === 0 || Math.abs(porCuenta[c].conciliado - p) < 0.01
    })

    // Depósitos que entraron en otra INSTITUCIÓN de la que declaró el motorista.
    // Entre cuentas del mismo banco no se avisa: el motorista elige "BAC" y no
    // tiene forma de saber en cuál de las cuentas BAC cayó el depósito, así que
    // marcarlo sería ruido diario. Cambiar de banco sí es un error real.
    const desviados = r.conciliados.map(e => {
      const cod = destinoDeEntrega(e, r)
      if (!cod || !e.bancoDeclarado || cod === e.bancoDeclarado) return null
      return ctxInst(cod) !== ctxInst(e.bancoDeclarado) ? { e, cod } : null
    }).filter(Boolean)
    const cDesv = desviados.length ? `<div class="ctx-grp">
        <div class="ctx-grp-t warn">↪️ Depositaron en otro banco (${desviados.length})</div>
        <div class="ctx-hint">El motorista reportó un banco y el depósito entró en otro. Se contabiliza donde <b>realmente</b> entró, que es lo que dice el banco. Entre cuentas del mismo banco no se avisa: el motorista no puede distinguirlas.</div>
        ${desviados.map(d => `<div class="ctx-row warn">
          <div class="ctx-row-l">#${d.e.unidad || '—'} ${d.e.nombre || ''} · ${fmt(d.e.monto)}</div>
          <div class="ctx-row-r"><span class="ctx-dup-tag">reportó ${d.e.bancoDeclarado} → entró en ${d.cod}</span></div>
        </div>`).join('')}</div>` : ''

    const cCuadre = `<div class="ctx-grp ctx-cuadre ${algunaPartida ? (todasCuadran ? 'ok' : 'no') : 'pend'}">
      <div class="ctx-grp-t ${algunaPartida ? (todasCuadran ? 'ok' : 'warn') : 'info'}">
        ${algunaPartida ? (todasCuadran ? '✓ Cuadre contra las partidas contables' : '⚠ Cuadre contra las partidas contables') : '🕒 Pendiente de partida'}
      </div>
      <div class="ctx-cq-wrap">${filasCuadre}</div>
      <div class="ctx-cuadre-rows" style="margin-top:8px">
        <div><span>Total conciliado (todas las cuentas)</span><b>${fmt(totalConc)}</b></div>
      </div>
      <div class="ctx-cuadre-msg ${algunaPartida ? (todasCuadran ? 'ok' : 'no') : 'info'}">
        ${algunaPartida
          ? (todasCuadran
            ? 'Cada cuenta cuadra con su movimiento contable del día. 🎉'
            : 'Alguna cuenta no cuadra. Podés guardar igual; la diferencia queda registrada para resolver después.')
          : `Guardá la conciliación ahora. Cuando generes la partida de taxis del ${ctxFecha}, se cuadrará sola automáticamente.`}
      </div>
      <div class="ctx-cuadre-msg info">Se guarda <b>una conciliación por cuenta</b> (${Object.keys(porCuenta).length}), cada una con sus propios depósitos.</div>
      <button class="btn btn-gold ctx-save" onclick="ctxGuardar()"><svg class=ico aria-hidden=true><use href=#i-device-floppy></use></svg> Guardar conciliación</button>
    </div>` + cDesv

    // Omitidos: re-envíos del banco o referencias ya conciliadas otro día
    const dups = r.duplicados || []
    const dupRows = dups.map(mv => {
      const tag = mv.dupTipo === 'igual'
        ? 'repetido en el extracto'
        : mv.dupTipo === 'conciliado'
          ? `ya conciliado el ${mv.dupFecha || '—'}`
          : `ya visto el ${mv.dupFecha || '—'}`
      return `<div class="ctx-row dup">
        <div class="ctx-row-l">${mv.desc || '(sin descripción)'} · ${fmt(mv.monto)} ${mv.ref ? `<span class="ctx-ref">Ref: ${mv.ref}</span>` : ''}</div>
        <div class="ctx-row-r"><span class="ctx-dup-tag">${tag}</span></div>
      </div>`
    }).join('')
    const cDup = dups.length
      ? `<div class="ctx-grp"><div class="ctx-grp-t dup">♻️ Referencias omitidas (${dups.length})</div>
          <div class="ctx-hint">Depósitos repetidos dentro del mismo extracto, o que ya se conciliaron en los últimos ${DIAS_DUP} días, o que el banco re-envió de días anteriores. Se comparan por referencia <b>y monto</b>, porque BAC reusa los números de transferencia.</div>
          ${dupRows}</div>`
      : ''

    // Emparejamientos manuales de la conciliación anterior que no se repusieron.
    // Se separan los que hay que rehacer de los que se resolvieron solos.
    const noReTodos = r.manualesNoReaplicados || []
    const noRe = noReTodos.filter(n => !n.info)
    const noReInfo = noReTodos.filter(n => n.info)
    const filaNoRe = n => `<div class="ctx-row warn">
        <div class="ctx-row-l">#${n.unidad || '—'} ${n.nombre || ''} · ${fmt(n.monto || 0)}</div>
        <div class="ctx-row-r"><span class="ctx-dup-tag">${n.motivo}</span></div>
      </div>`
    const cNoRe = (noRe.length
      ? `<div class="ctx-grp"><div class="ctx-grp-t warn">⚠️ Emparejamientos manuales por rehacer (${noRe.length})</div>
          <div class="ctx-hint">Estos emparejamientos manuales estaban guardados de una conciliación anterior, pero sus depósitos no aparecen en el extracto cargado (referencia distinta, o el banco los reenvió con otro número). <b>No se reaplicaron</b>: hay que rehacerlos a mano abajo. Antes el sistema los colocaba en el primer depósito libre del mismo monto, y eso los asignaba al motorista equivocado.</div>
          ${noRe.map(filaNoRe).join('')}</div>`
      : '') + (noReInfo.length
      ? `<div class="ctx-grp"><div class="ctx-grp-t dup">ℹ️ Emparejamientos manuales que ya no hacen falta (${noReInfo.length})</div>
          <div class="ctx-hint">Estaban guardados como manuales, pero esta vez el sistema los resolvió solo. <b>No hay nada que hacer.</b></div>
          ${noReInfo.map(filaNoRe).join('')}</div>`
      : '')


    out.innerHTML = resumen + cCuadre + cNoRe + cConc + cDep + cEnt + cDup
    ctxDepAplicarFiltro()
  }

  function ctxDepAplicarFiltro() {
    const q = (ctxDepFiltro || '').trim().toLowerCase()
    const filas = document.querySelectorAll('#ctx-out .ctx-dep-row')
    let vis = 0
    filas.forEach(el => {
      const match = !q || (el.getAttribute('data-s') || '').includes(q)
      el.style.display = match ? '' : 'none'
      if (match) vis++
    })
    const cnt = document.getElementById('ctx-dep-count')
    if (cnt) cnt.textContent = q ? `${vis} de ${filas.length} depósito(s)` : ''
  }
  window.ctxDepBuscar = (v) => { ctxDepFiltro = v || ''; ctxDepAplicarFiltro() }

  window.ctxLimpiarSeleccion = () => { ctxSelDepositos = []; ctxRender() }

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
    const codigos = r.codigos || []

    // Una conciliación POR CUENTA: tx_conciliaciones lleva un banco y una
    // cuenta por fila, que es la forma que la tabla ya tiene y la que hace que
    // el cuadre contra la partida siga siendo por cuenta. No se inventa nada.
    //
    // El reparto del detalle:
    //   · conciliados → a la cuenta de SUS depósitos (si un pago se fraccionó
    //     entre dos cuentas, cada depósito va a la suya y la entrega aparece
    //     en ambas con el monto que le corresponde a cada una)
    //   · depósitos huérfanos → a la cuenta de su archivo
    //   · entregas huérfanas → NO se reparten. Una entrega sin depósito no
    //     pertenece a ninguna cuenta y ensuciaría el cuadre de la que le
    //     tocara. Se guardan en la primera cuenta solo como registro del
    //     problema, con monto_entrega intacto y sin monto_deposito.
    const porCod = {}
    codigos.forEach(c => { porCod[c] = { detalle: [], extracto: 0, conciliado: 0, entregas: 0 } })
    const bolsa = c => (porCod[c] = porCod[c] || { detalle: [], extracto: 0, conciliado: 0, entregas: 0 })

    r.movs.forEach(mv => { bolsa(mv.destino).extracto += mv.monto })

    r.conciliados.forEach(e => {
      const deps = (e.pars || []).map(i => r.movs[i]).filter(Boolean)
      const grupos = {}
      deps.forEach(d => { (grupos[d.destino] = grupos[d.destino] || []).push(d) })
      Object.keys(grupos).forEach(cod => {
        const ds = grupos[cod]
        const montoDep = ds.reduce((s2, d) => s2 + d.monto, 0)
        const b = bolsa(cod)
        b.conciliado += montoDep
        b.entregas += montoDep     // la parte de esta entrega que entró en esta cuenta
        b.detalle.push({
          entrega_id: e.id || null, unidad: e.unidad, nombre: e.nombre,
          monto_entrega: montoDep,
          deposito_desc: ds.map(d => `${d.desc} (${d.monto})`).join(' + '),
          monto_deposito: montoDep,
          deposito_refs: ds.map(d => ({ ref: d.ref || null, monto: d.monto })),
          nivel: String(e.nivel)
        })
      })
    })

    r.depositosHuerfanos.forEach(mv => {
      bolsa(mv.destino).detalle.push({
        entrega_id: null, unidad: null, nombre: null, monto_entrega: null,
        deposito_desc: mv.desc, monto_deposito: mv.monto, nivel: 'huerfano_dep'
      })
    })

    const primera = codigos[0]
    if (primera) {
      r.entregasHuerfanas.forEach(e => {
        bolsa(primera).detalle.push({
          entrega_id: e.id || null, unidad: e.unidad, nombre: e.nombre,
          monto_entrega: e.monto, deposito_desc: null, monto_deposito: null, nivel: 'huerfano_ent'
        })
      })
    }

    const btn = document.querySelector('.ctx-save')
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…' }
    const oks = [], fallos = []
    try {
      for (const cod of Object.keys(porCod)) {
        const b = porCod[cod]
        try {
          const { data, error } = await csb().rpc('tx_guardar_conciliacion', {
            p_banco: cod, p_fecha: ctxFecha, p_cuenta: ctxCuentaDe(cod) || null,
            p_total_entregas: b.entregas, p_total_extracto: b.extracto, p_total_conciliado: b.conciliado,
            p_detalle: b.detalle
          })
          if (error) throw error
          if (!data?.ok) throw new Error(data?.error || 'la base rechazó el guardado')
          oks.push({ cod, cuadra: !!data.cuadra, diferencia: data.diferencia })
        } catch (e) {
          fallos.push({ cod, msg: e.message || String(e) })
          continue
        }
        // Referencias conciliadas de ESTA cuenta, para no re-presentarlas.
        try {
          const refsConc = []
          r.conciliados.forEach(e => (e.pars || []).forEach(i => {
            const mv = r.movs[i]
            if (mv && mv.ref && mv.destino === cod) {
              refsConc.push({ ref: mv.ref, monto: mv.monto, desc: mv.desc || '', unidad: e.unidad || '' })
            }
          }))
          if (refsConc.length) {
            await csb().rpc('tx_refs_conciliadas_guardar', {
              p_banco: cod, p_fecha_entregas: ctxFecha,
              p_fecha_banco: (ctxFechasBanco[cod] || ctxFecha), p_refs: refsConc
            })
          }
        } catch (e) { /* no bloquear el guardado por esto */ }
      }

      // ── Sellar el destino REAL en cada entrega conciliada ──
      // Es lo que hace que la contabilidad se entere de en qué cuenta entró la
      // plata. Sin esto, generarPartidasTaxis agrupa por el banco que declaró
      // el motorista y debita todo a la cuenta vieja: la conciliación sabría la
      // verdad y la partida no, y el cuadre por cuenta nunca daría.
      if (!fallos.length) {
        try {
          const porDestino = {}
          r.conciliados.forEach(e => {
            if (!e.id) return
            const cod = destinoDeEntrega(e, r)
            const d = ctxDest(cod)
            if (d) (porDestino[d.id] = porDestino[d.id] || []).push(e.id)
          })
          for (const destId of Object.keys(porDestino)) {
            const ids = porDestino[destId]
            for (let i = 0; i < ids.length; i += 200) {
              const { error } = await csb().from('entregas_taxis')
                .update({ destino_id: destId }).in('id', ids.slice(i, i + 200))
              if (error) throw error
            }
          }
        } catch (e) {
          window.toast?.('Se guardó la conciliación pero NO se pudo marcar el destino de las entregas: ' + (e.message || e) + '. La partida del día quedaría en la cuenta equivocada — volvé a guardar.', 'error')
        }
      }

      // Un fallo parcial NO se reporta como éxito: quedaron cuentas guardadas y
      // otras no, y hay que saber cuáles para no re-guardar a ciegas.
      if (fallos.length) {
        window.toast?.(`${oks.length} cuenta(s) guardada(s), ${fallos.length} con error: ${fallos.map(f => f.cod + ' (' + f.msg + ')').join(' · ')}`, 'error')
      } else {
        const malos = oks.filter(o => !o.cuadra)
        window.toast?.(malos.length
          ? `Guardado · ${malos.length} cuenta(s) con diferencia: ${malos.map(o => o.cod + ' ' + fmt(o.diferencia)).join(' · ')}`
          : `Conciliación guardada · ${oks.length} cuenta(s) · cuadra ✓`,
          malos.length ? 'info' : 'success')
      }
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
      .ctx-card{background:var(--bg2,#15171c);border:1px solid var(--border,#2a2e37);border-radius:12px;padding:16px;margin-bottom:14px}
      .ctx-files{margin-top:12px;display:flex;flex-direction:column;gap:6px}
      .ctx-file-row{display:flex;align-items:center;gap:10px;background:var(--bg-inset,#0f1115);border:1px solid var(--border,#2a2e37);border-radius:9px;padding:8px 10px;font-size:12px;flex-wrap:wrap}
      .ctx-file-row.err{border-color:#5a2a2a}
      .ctx-file-n{flex:1 1 180px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text,#c9d1e0)}
      .ctx-file-sel{display:flex;align-items:center;gap:6px}
      .ctx-file-sel select{padding:5px 9px;background:var(--bg2,#15171c);border:1px solid var(--border,#2a2e37);border-radius:7px;color:var(--text,#e7e9ee);font-size:12px;outline:none}
      .ctx-auto{font-size:10px;color:var(--green-fg,#4ade80);border:1px solid #2b5f3f;border-radius:5px;padding:1px 6px}
      .ctx-file-f{display:flex;align-items:center;gap:6px}
      .ctx-file-f input{padding:4px 8px;background:var(--bg2,#15171c);border:1px solid var(--border,#2a2e37);border-radius:7px;color:var(--text,#e7e9ee);font-size:12px;outline:none}
      .ctx-file-row.vacio{border-color:#6b4a1f}
      .ctx-file-i{flex:1 1 180px;color:var(--text2,#8b93a3)}
      .ctx-file-i b{color:var(--text,#c9d1e0);font-family:var(--mono,monospace)}
      .ctx-file-err{color:var(--red-fg,#f87171)}
      .ctx-file-x{background:none;border:none;color:var(--text2,#8b93a3);cursor:pointer;font-size:14px;padding:0 4px}
      .ctx-file-x:hover{color:var(--red-fg,#f87171)}
      .ctx-file-warn{font-size:11px;color:var(--amber-fg,#f5c451);padding:6px 2px}
      .ctx-inst-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--text2,#8b93a3);padding:2px 0 6px}
      .ctx-inst-chip{background:var(--bg2,#15171c);border:1px solid var(--border,#2a2e37);border-radius:20px;padding:4px 11px;color:var(--text,#c9d1e0);font-size:11px;cursor:pointer}
      .ctx-inst-chip span{color:var(--text2,#8b93a3);margin-left:3px}
      .ctx-inst-chip.on{background:#1d3a5c;border-color:#2f6fb5;color:#fff}
      .ctx-inst-chip.on span{color:var(--blue-fg,#cfe3ff)}
      .ctx-file-ck{display:flex;align-items:center}
      .ctx-file-ck input{width:16px;height:16px;cursor:pointer}
      .ctx-file-row.off{opacity:.45}
      .ctx-parcial{background:rgba(37,99,235,.12);border:1px solid rgba(37,99,235,.4);color:#93c5fd;border-radius:9px;padding:8px 12px;font-size:12px;margin:8px 0}
      .ctx-aviso{font-size:11px;color:var(--text2,#8b93a3);margin-top:12px;padding-top:11px;border-top:1px solid var(--border,#2a2e37)}
      .ctx-aviso.warn{color:var(--amber-fg,#f5c451)}
      .ctx-cq-wrap{display:flex;flex-direction:column;gap:8px;margin:6px 0}
      .ctx-cq{border:1px solid var(--border,#2a2e37);border-radius:9px;padding:9px 11px;background:var(--bg-inset,#0f1115)}
      .ctx-cq.ok{border-color:#2b5f3f}.ctx-cq.no{border-color:#6b4a1f}.ctx-cq.pend{border-color:#2a3c5a}
      .ctx-cq-h{font-size:12px;margin-bottom:5px}
      .ctx-cq-cta{color:var(--text2,#8b93a3);font-family:var(--mono,monospace);font-size:11px;margin-left:6px}
      .ctx-cq-rows>div{display:flex;justify-content:space-between;font-size:12px;padding:1px 0}
      .ctx-fld select{width:100%;padding:8px 11px;background:var(--bg-inset,#0f1115);border:1px solid var(--border,#2a2e37);border-radius:8px;color:var(--text,#e7e9ee);font-size:13px;outline:none}
      .ctx-cta{font-size:11px;color:var(--text2,#8b93a3);margin-top:5px}
      .ctx-cta b{color:var(--text,#c9d1e0)}
      .ctx-personal{color:var(--amber-fg,#f5c451)}
      .ctx-aviso{font-size:11px;color:var(--text2,#8b93a3);margin-top:12px;padding-top:11px;border-top:1px solid var(--border,#2a2e37)}
      .ctx-punto-btn{margin-left:10px;padding:2px 8px;font-size:11px;background:var(--bg3,#1c2530);border:1px solid #2f3b4a;border-radius:6px;color:#7fb3ff;cursor:pointer}
      .ctx-punto-btn:hover{background:var(--bg4,#243141)}
      .ctx-controls{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end}
      .ctx-fld{display:flex;flex-direction:column;gap:5px}.ctx-fld.ctx-grow{flex:1;min-width:220px}
      .ctx-fld label{font-size:12px;color:var(--text2,#9aa0aa);text-transform:uppercase;letter-spacing:.04em}
      .ctx-fld input{padding:9px 11px;background:var(--bg2,#15171c);border:1px solid var(--border,#2a2e37);border-radius:9px;color:var(--text,#e8eaed);font-size:14px}
      .ctx-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:8px}
      .ctx-stat{background:var(--bg2,#15171c);border:1px solid var(--border,#2a2e37);border-radius:12px;padding:15px;text-align:center}
      .ctx-stat.ok{border-color:rgba(22,163,74,.4)}.ctx-stat.warn{border-color:rgba(240,165,0,.35)}
      .ctx-n{font-size:22px;font-weight:800;color:var(--text,#e8eaed)}.ctx-stat.ok .ctx-n{color:var(--green-fg,#3fb950)}.ctx-stat.warn .ctx-n{color:var(--gold,#f0a500)}
      .ctx-l{font-size:12px;color:var(--text2,#9aa0aa);margin-top:4px}
      .ctx-sub{font-size:12px;color:var(--text2,#8b8f98);margin-bottom:14px}
      .ctx-grp{background:var(--bg2,#15171c);border:1px solid var(--border,#2a2e37);border-radius:12px;padding:14px;margin-bottom:12px}
      .ctx-grp-t{font-size:14px;font-weight:700;margin-bottom:10px}
      .ctx-grp-t.ok{color:var(--green-fg,#3fb950)}.ctx-grp-t.warn{color:var(--gold,#f0a500)}
      .ctx-grp-t.dup{color:var(--purple-fg,#a78bfa)}
      .ctx-stat.dup{border-color:rgba(167,139,250,.4)}.ctx-stat.dup .ctx-n{color:var(--purple-fg,#a78bfa)}
      .ctx-row.dup{border-left:3px solid var(--purple,#a78bfa);opacity:.85}
      .ctx-dup-tag{background:rgba(167,139,250,.16);color:#c4b5fd;border-radius:5px;padding:2px 8px;font-size:11px;white-space:nowrap}
      .ctx-hint{font-size:12px;color:var(--text2,#8b8f98);margin-bottom:10px}
      .ctx-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 11px;border-radius:8px;margin-bottom:6px;font-size:13px;background:var(--bg3,#1a1d24)}
      .ctx-row.ok{border-left:3px solid var(--green,#3fb950)}
      .ctx-row.warn{border-left:3px solid var(--gold,#f0a500);cursor:default}
      .ctx-row.warn.sel{background:rgba(37,99,235,.18);border-left-color:var(--blue,#4a90e2)}
      .ctx-row-l{color:var(--text,#e8eaed)}.ctx-row-l b{color:var(--gold,#f0a500)}
      .ctx-ref{display:inline-block;background:rgba(74,144,226,.15);color:#7eb6ff;border-radius:5px;padding:1px 7px;font-size:12px;font-weight:600;margin-left:6px;user-select:all}
      .ctx-row-r{color:var(--text2,#9aa0aa);font-size:12px;text-align:right;display:flex;align-items:center;gap:8px}
      .ctx-tag{background:var(--bg3,#21242b);border-radius:5px;padding:2px 7px;font-size:11px;color:var(--text2,#8b8f98)}
      .ctx-amb{background:rgba(240,165,0,.18);color:var(--gold,#f0a500);border-radius:5px;padding:1px 6px;font-size:11px}
      .ctx-pick{cursor:pointer;color:var(--blue-fg,#4a90e2);font-size:12px;font-weight:600}
      .ctx-mbtn{background:rgba(37,99,235,.16);border:1px solid rgba(37,99,235,.5);border-radius:7px;color:var(--blue-fg,#4a90e2);padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer}
      .ctx-mbtn:disabled{opacity:.4;cursor:not-allowed}
      .ctx-mbtn.cuadra{background:rgba(22,163,74,.2);border-color:rgba(22,163,74,.6);color:var(--green-fg,#3fb950)}
      .ctx-selinfo{background:rgba(37,99,235,.12);border:1px solid rgba(37,99,235,.4);border-radius:8px;padding:9px 11px;margin-bottom:10px;font-size:12px;color:#9bb8f0}
      .ctx-selinfo b{color:#fff}
      .ctx-multi{background:rgba(37,99,235,.18);color:var(--blue-fg,#4a90e2);border-radius:5px;padding:1px 7px;font-size:11px}
      .ctx-cuadre{border-width:1px}
      .ctx-cuadre.ok{border-color:rgba(22,163,74,.5);background:rgba(22,163,74,.06)}
      .ctx-cuadre.no{border-color:rgba(240,165,0,.5);background:rgba(240,165,0,.05)}
      .ctx-cuadre.pend{border-color:rgba(37,99,235,.45);background:rgba(37,99,235,.05)}
      .ctx-grp-t.info{color:#6ea8ff}
      .ctx-cuadre-msg.info{background:rgba(37,99,235,.1);color:#9bb8f0}
      .ctx-cuadre-msg.info b{color:#fff}
      .ctx-cuadre-rows{display:flex;flex-direction:column;gap:6px;margin:6px 0 10px}
      .ctx-cuadre-rows>div{display:flex;justify-content:space-between;font-size:14px;color:var(--text,#c8ccd2);padding:3px 0}
      .ctx-cuadre-rows>div b{font-family:ui-monospace,monospace;color:var(--text,#e8eaed)}
      .ctx-cuadre-dif{border-top:1px solid var(--border,#2a2e37);padding-top:8px!important;margin-top:2px}
      .ctx-cuadre-dif.ok b{color:var(--green-fg,#3fb950)}.ctx-cuadre-dif.no b{color:var(--gold,#f0a500)}
      .ctx-cuadre-msg{font-size:12px;padding:8px 10px;border-radius:7px;margin-bottom:10px}
      .ctx-cuadre-msg.ok{background:rgba(22,163,74,.12);color:var(--green-fg,#7ee2a0)}
      .ctx-cuadre-msg.no{background:rgba(240,165,0,.1);color:var(--amber-fg,#f0c674)}
      .ctx-save{width:100%}
      .ctx-empty{color:var(--text2,#8b8f98);font-size:13px;padding:6px}
    `
    document.head.appendChild(s)
  }

// ── PISTA: motoristas por punto RapiBac ──
// Extrae el número de punto de una descripción de depósito.
// "DEP.RAPIBAC 025630" → "25630" (sin ceros de más, para comparar bien).
function ctxPuntoRapibac(desc) {
  const m = String(desc || '').toUpperCase().match(/RAPIBAC[^0-9]*([0-9]+)/)
  if (!m) return null
  const n = m[1].replace(/^0+/, '') || '0'
  return n
}

// Consulta reactiva: qué motoristas suelen depositar en ese punto.
// El historial arranca vacío y se llena a medida que se concilia.
window.ctxQuienUsaPunto = async (punto, btn) => {
  if (!punto) return
  const prev = btn ? btn.innerHTML : ''
  if (btn) { btn.disabled = true; btn.textContent = 'buscando…' }
  try {
    const { data, error } = await csb().rpc('tx_motoristas_por_punto', { p_punto: String(punto) })
    if (error) throw error
    const filas = data || []
    let cuerpo
    if (!filas.length) {
      cuerpo = `<div style="color:var(--text2,#8b8f98);font-size:13px">Todavía no hay historial para el punto ${punto}. Se irá llenando a medida que concilies depósitos de este punto.</div>`
    } else {
      cuerpo = `<div style="font-size:12px;color:var(--text2,#8b8f98);margin-bottom:8px">Suelen depositar en el punto ${punto}:</div>` +
        filas.map(f => {
          const tel = f.telefono ? ` · 📞 ${f.telefono}` : ''
          return `<div style="padding:6px 0;border-bottom:1px solid #23262d;font-size:13px">
            <b>#${f.unidad}</b> ${f.nombre || ''} <span style="color:var(--text2,#8b8f98)">— ${f.veces} vez(ces)${tel}</span>
            <div style="color:#6b7280;font-size:11px">último: ${f.ultimo || '—'}</div>
          </div>`
        }).join('')
    }
    ctxModalPista(`Punto RapiBac ${punto}`, cuerpo)
  } catch (e) {
    window.toast?.('Error consultando el punto: ' + (e.message || e), 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = prev }
  }
}

// ── PISTA: motoristas por depositante (transferencias BAC) ──
// "TEF DE:BRENDA ELIZABETH LOPEZ" → "BRENDA ELIZABETH LOPEZ"
function ctxNombreTef(desc) {
  const d = String(desc || '').trim()

  // BAC: "TEF DE:NOMBRE"
  let m = d.match(/TEF\s+DE:?\s*(.+)$/i)
  if (m) return ctxNombreValido(m[1])

  // Ficohsa: "Transferencia entre Cuentas-QUIEN DEPOSITA-QUIEN RECIBE".
  // Se toma el tramo del medio, que es el depositante. El último es siempre el
  // titular de la cuenta de Tecnimax y no sirve de pista.
  m = d.match(/Transferencia\s+entre\s+Cuentas\s*-\s*(.+)$/i)
  if (m) {
    const tramos = m[1].split('-').map(x => x.trim()).filter(Boolean)
    if (tramos.length) return ctxNombreValido(tramos[0])
  }

  // Los depósitos en corresponsal ("Deposito en Corresponsal TENGO") NO dan
  // pista: TENGO es el punto, no la persona, y ahí deposita cualquiera. Mostrar
  // el botón ahí sugeriría una identificación que no existe.
  return null
}

// Un nombre sirve como pista con al menos 2 palabras: con una sola es ruido.
// También se descartan los nombres de puntos y corresponsales.
function ctxNombreValido(txt) {
  const n = String(txt || '').trim().replace(/\s+/g, ' ')
  if (!n) return null
  if (/^(TENGO|CORRESPONSAL|RAPIBAC|BANCO|AGENCIA|PUNTO)\b/i.test(n)) return null
  return n.split(' ').filter(Boolean).length >= 2 ? n : null
}

// Consulta reactiva: a qué motoristas le ha depositado antes esta persona.
// Sirve para el caso del motorista sin cuenta que recibe el favor de un
// familiar o amigo: el nombre del extracto no es de nadie de la empresa.
window.ctxQuienDeposita = async (idx, btn) => {
  const mv = ctxRes && ctxRes.movs ? ctxRes.movs[idx] : null
  const nombre = ctxNombreTef(mv && mv.desc)
  if (!nombre) return
  const prev = btn ? btn.innerHTML : ''
  if (btn) { btn.disabled = true; btn.textContent = 'buscando…' }
  try {
    const { data, error } = await csb().rpc('tx_motoristas_por_depositante', { p_nombre: nombre })
    if (error) throw error
    const filas = data || []
    const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    let cuerpo
    if (!filas.length) {
      cuerpo = `<div style="color:var(--text2,#8b8f98);font-size:13px">No hay historial de <b>${esc(nombre)}</b>. Si lo conciliás hoy, la próxima vez ya va a aparecer.</div>`
    } else {
      cuerpo = `<div style="font-size:12px;color:var(--text2,#8b8f98);margin-bottom:8px"><b>${esc(nombre)}</b> le ha depositado a:</div>` +
        filas.map(f => {
          const tel = f.telefono ? ` · 📞 ${esc(f.telefono)}` : ''
          const dep = f.depositante && f.depositante.toUpperCase() !== nombre.toUpperCase()
            ? `<div style="color:#6b7280;font-size:11px">en el extracto figuró como: ${esc(f.depositante)}</div>` : ''
          // La pista agrupa por conductor. "unidades" trae todas las que
          // manejó; se destaca la más reciente.
          const varias = f.unidades && f.unidades.indexOf(',') >= 0
            ? `<div style="color:#6b7280;font-size:11px">unidades: ${esc(f.unidades)}</div>` : ''
          const quien = f.conductor
            ? `<b>#${esc(f.unidad)}</b> ${esc(f.conductor)}`
            : `<b>#${esc(f.unidad)}</b> <span style="color:var(--text2,#8b8f98)">(conductor no identificado)</span>`
          return `<div style="padding:6px 0;border-bottom:1px solid #23262d;font-size:13px">
            ${quien} <span style="color:var(--text2,#8b8f98)">— ${f.veces} vez(ces)${tel}</span>
            <div style="color:#6b7280;font-size:11px">último: ${esc(f.ultimo) || '—'}</div>${varias}${dep}
          </div>`
        }).join('')
    }
    ctxModalPista(`Depósitos de ${nombre}`, cuerpo)
  } catch (e) {
    window.toast?.('Error consultando el depositante: ' + (e.message || e), 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = prev }
  }
}

// Modal simple para mostrar la pista.
function ctxModalPista(titulo, htmlCuerpo) {
  document.getElementById('ctx-pista-modal')?.remove()
  const ov = document.createElement('div')
  ov.id = 'ctx-pista-modal'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center'
  ov.onclick = (e) => { if (e.target === ov) ov.remove() }
  ov.innerHTML = `<div style="background:var(--bg-inset,#14161b);border:1px solid #2a2f3a;border-radius:12px;max-width:420px;width:92%;max-height:70vh;overflow:auto;padding:18px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-weight:600;font-size:15px">👤 ${titulo}</div>
      <button onclick="document.getElementById('ctx-pista-modal').remove()" style="background:none;border:none;color:var(--text2,#8b8f98);font-size:20px;cursor:pointer">×</button>
    </div>
    <div style="font-size:11px;color:#6b7280;margin-bottom:10px">Es una pista por frecuencia, no una asignación: un punto lo pueden usar varios motoristas.</div>
    ${htmlCuerpo}
  </div>`
  document.body.appendChild(ov)
}

})()