// ══════════════════════════════════════════════════════════════
// CONCILIACIÓN BANCARIA · Fase 1 (bancos en Excel/XLS)
// Depende de: window._sb, window.catalogoCuentas, window.siguienteNumeroPartida,
//             window._currentProfile, window.toast, window.closeModal, XLSX
// ══════════════════════════════════════════════════════════════
(() => {
  const getSb = () => window._sb
  const fmtL = (v) => 'L. ' + (Number(v) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
  const localDateStr = (d) => new Date(d).toLocaleDateString('en-CA')

  // ── Bancos = solo el FORMATO de lectura del archivo (la cuenta se elige aparte) ──
  const BANCOS = [
    { id: 'BAC',       label: 'BAC',                 formato: 'excel' },
    { id: 'BANPAIS',   label: 'Banpaís',             formato: 'excel' },
    { id: 'OCCIDENTE', label: 'Banco de Occidente',  formato: 'excel' },
    { id: 'BANRURAL',  label: 'Banrural',            formato: 'excel' },
    { id: 'FICOHSA',   label: 'Ficohsa',             formato: 'excel' },
    { id: 'LAFISE',    label: 'Lafise',              formato: 'excel' },
    { id: 'ATLANTIDA', label: 'Atlántida',           formato: 'excel' },
    { id: 'GENERICO',  label: 'Otro / genérico (Excel)', formato: 'excel' }
  ]

  // Todas las cuentas contables de banco/chequera del catálogo (110103-xxx y 110104-xxx)
  const cuentasBanco = () => (window.catalogoCuentas || [])
    .filter(c => /^11010[34]-/.test(c.codigo))
    .sort((a, b) => a.codigo.localeCompare(b.codigo))

  let estadoConc = null  // { banco, cuenta, desde, hasta, tolerancia, banco_movs, libro_movs, pares, saldoBanco, saldoLibro }
  let archivoBanco = null
  let _ultimoNeteo = 0   // reversos netados en la última lectura del archivo

  // ──────────────────────────────────────────────────────────
  //  PARSER GENÉRICO DE ESTADO DE CUENTA (Excel/XLS)
  //  Detecta la fila de encabezados y mapea columnas por nombre.
  // ──────────────────────────────────────────────────────────
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // quita acentos

  // Hoja preferida por banco (las que tienen varias)
  const HOJA_PREFERIDA = { BANRURAL: 'movimientos' }

  function elegirHoja(wb, bancoId) {
    const pref = HOJA_PREFERIDA[bancoId]
    if (pref) {
      const found = wb.SheetNames.find(n => norm(n).includes(pref))
      if (found) return found
    }
    return wb.SheetNames[0]
  }

  // Encuentra la fila de headers: la que tenga "fecha" y ("debito" o "credito")
  function detectarHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const celdas = (rows[i] || []).map(norm)
      const tieneFecha = celdas.some(c => c === 'fecha' || c.startsWith('fecha '))
      const tieneDebCred = celdas.some(c => c.startsWith('debito') || c.startsWith('credito') || c.startsWith('debe') || c.startsWith('haber'))
      if (tieneFecha && tieneDebCred) return i
    }
    return -1
  }

  // Mapea índices de columna a campos lógicos
  function mapearColumnas(headerRow) {
    const m = { fecha: -1, desc: -1, debito: -1, credito: -1, saldo: -1, ref: -1 }
    headerRow.forEach((h, idx) => {
      const c = norm(h)
      if (c === 'fecha' && m.fecha < 0) m.fecha = idx
      else if ((c.startsWith('descrip') || c === 'concepto' || c === 'detalle') && m.desc < 0) m.desc = idx
      else if ((c.startsWith('debito') || c === 'debitos' || c === 'debe') && m.debito < 0) m.debito = idx
      else if ((c.startsWith('credito') || c === 'creditos' || c === 'haber') && m.credito < 0) m.credito = idx
      else if ((c.startsWith('saldo') || c.startsWith('balance')) && m.saldo < 0) m.saldo = idx
      else if ((c.startsWith('referencia') || c === 'ref' || c.startsWith('no. cheque') || c.startsWith('cheque')) && m.ref < 0) m.ref = idx
    })
    return m
  }

  const aNumero = (v) => {
    if (v == null || v === '') return 0
    let s = String(v).replace(/,/g, '').replace(/[^\d.\-]/g, '').trim()
    if (s === '' || s === '-' || s === '.') return 0
    const n = parseFloat(s)
    return isNaN(n) ? 0 : n
  }

  // Meses abreviados (Lafise exporta "31/MAY/2026"). Español + inglés por si acaso.
  const MESES_ABR = {
    ENE: '01', FEB: '02', MAR: '03', ABR: '04', MAY: '05', JUN: '06',
    JUL: '07', AGO: '08', SEP: '09', SET: '09', OCT: '10', NOV: '11', DIC: '12',
    JAN: '01', APR: '04', AUG: '08', DEC: '12'
  }

  // Normaliza fecha desde dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd, dd/MMM/yyyy, con o sin hora
  function aFecha(v) {
    if (v == null || v === '') return null
    // Si es un número serial de Excel
    if (typeof v === 'number') {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000))
      return isNaN(d) ? null : localDateStr(d)
    }
    let s = String(v).trim()
    s = s.split(' ')[0]  // quita hora
    let m
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`
    // dd/MMM/yyyy con mes en letras (Lafise: 31/MAY/2026)
    if ((m = s.match(/^(\d{1,2})[\/\-]([A-Za-z]{3,})[\/\-](\d{2,4})$/))) {
      const mm = MESES_ABR[m[2].toUpperCase().slice(0, 3)]
      if (mm) {
        let dd = m[1].padStart(2, '0'), yy = m[3]
        if (yy.length === 2) yy = '20' + yy
        return `${yy}-${mm}-${dd}`
      }
    }
    if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/))) {
      let dd = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0'), yy = m[3]
      if (yy.length === 2) yy = '20' + yy
      return `${yy}-${mm}-${dd}`
    }
    return null
  }

  // ──────────────────────────────────────────────────────────
  //  PRE-NETEO DE REVERSOS
  //  El banco a veces deposita un pago varias veces y lo revierte la
  //  misma cantidad de veces (queda 1 real). Cancelamos cada
  //  "REV ...NNNN" (egreso) contra un "...NNNN" original (ingreso) del
  //  MISMO archivo, igual monto y dirección opuesta. Si el original NO
  //  está en el archivo (p. ej. fue de otro mes), el reverso se conserva
  //  como movimiento real. Genérico: solo actúa donde hay prefijo "REV".
  // ──────────────────────────────────────────────────────────
  const _refNum = (desc) => {
    const nums = String(desc || '').match(/\d{5,}/g)  // referencia del pago
    return nums ? nums.sort((a, b) => b.length - a.length)[0] : null
  }
  const _esReverso = (desc) => /^\s*REV(?:\b|ERS)/i.test(String(desc || ''))

  function preNetearReversos(movs) {
    const out = movs.map(m => ({ ...m }))
    const usado = new Array(out.length).fill(false)
    let reversos = 0
    for (let i = 0; i < out.length; i++) {
      if (usado[i] || !_esReverso(out[i].descripcion)) continue
      const key = _refNum(out[i].descripcion)
      if (!key) continue
      for (let j = 0; j < out.length; j++) {
        if (usado[j] || j === i) continue
        const o = out[j]
        if (_esReverso(o.descripcion)) continue          // el original no es otro reverso
        if (_refNum(o.descripcion) !== key) continue      // misma referencia de pago
        if (Math.abs(o.monto - out[i].monto) > 0.01) continue  // mismo monto
        if (o.tipo === out[i].tipo) continue              // dirección opuesta
        usado[i] = usado[j] = true
        reversos++
        break
      }
    }
    return { movs: out.filter((_, k) => !usado[k]), reversos }
  }

  // Parsea un workbook a movimientos normalizados
  function parsearExcel(wb, bancoId) {
    const hoja = elegirHoja(wb, bancoId)
    const ws = wb.Sheets[hoja]
    const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
    const hIdx = detectarHeader(rows)
    if (hIdx < 0) throw new Error('No se encontró la fila de encabezados (Fecha / Débito / Crédito) en la hoja "' + hoja + '".')
    const cols = mapearColumnas(rows[hIdx])
    if (cols.fecha < 0 || (cols.debito < 0 && cols.credito < 0)) {
      throw new Error('No se pudieron mapear las columnas de Fecha/Débito/Crédito.')
    }
    const movs = []
    for (let i = hIdx + 1; i < rows.length; i++) {
      const row = rows[i] || []
      const fecha = aFecha(row[cols.fecha])
      if (!fecha) continue  // saltar filas de totales/saldo inicial/vacías
      const debito = cols.debito >= 0 ? aNumero(row[cols.debito]) : 0
      const credito = cols.credito >= 0 ? aNumero(row[cols.credito]) : 0
      if (debito === 0 && credito === 0) continue
      const desc = cols.desc >= 0 ? String(row[cols.desc] || '').trim() : ''
      const ref = cols.ref >= 0 ? String(row[cols.ref] || '').trim() : ''
      movs.push({
        fecha, descripcion: desc, referencia: ref,
        debito: r2(debito), credito: r2(credito),
        // dirección desde el punto de vista de la cuenta: ingreso = entra plata, egreso = sale
        tipo: credito > 0 ? 'ingreso' : 'egreso',
        monto: r2(credito > 0 ? credito : debito)
      })
    }
    // Pre-neteo de reversos del banco (depósitos duplicados revertidos)
    const { movs: movsNetos, reversos } = preNetearReversos(movs)
    _ultimoNeteo = reversos
    return movsNetos
  }

  // ──────────────────────────────────────────────────────────
  //  CARGA DE MOVIMIENTOS DEL LIBRO (sistema)
  // ──────────────────────────────────────────────────────────
  async function cargarLibro(cuentaCodigo, desde, hasta) {
    const sb = getSb()
    // partidas aprobadas del rango
    const fetchAll = async (build) => {
      let all = [], from = 0, size = 1000
      while (true) {
        const { data, error } = await build().range(from, from + size - 1)
        if (error || !data || !data.length) break
        all.push(...data); if (data.length < size) break; from += size
      }
      return all
    }
    const partidas = await fetchAll(() => sb.from('partidas_contables')
      .select('id, numero_partida, fecha_partida, descripcion').eq('estado', 'aprobada')
      .gte('fecha_partida', desde).lte('fecha_partida', hasta))
    const pMap = Object.fromEntries(partidas.map(p => [p.id, p]))
    const pIds = partidas.map(p => p.id)
    let lineas = []
    for (let i = 0; i < pIds.length; i += 200) {
      const chunk = pIds.slice(i, i + 200)
      const data = await fetchAll(() => sb.from('lineas_partida')
        .select('id, partida_id, cuenta_codigo, tipo, monto, descripcion')
        .eq('cuenta_codigo', cuentaCodigo).in('partida_id', chunk))
      if (data?.length) lineas.push(...data)
    }
    return lineas.map(l => {
      const p = pMap[l.partida_id]
      return {
        fecha: p?.fecha_partida, descripcion: l.descripcion || p?.descripcion || '',
        numero_partida: p?.numero_partida, partida_id: l.partida_id, linea_id: l.id,
        // débito a cuenta de banco = entra plata (ingreso); crédito = sale (egreso)
        tipo: l.tipo === 'debito' ? 'ingreso' : 'egreso',
        monto: r2(l.monto)
      }
    }).filter(x => x.fecha)
  }

  // ──────────────────────────────────────────────────────────
  //  MOTOR DE CRUCE  (monto exacto + fecha con tolerancia + misma dirección)
  // ──────────────────────────────────────────────────────────
  function diasEntre(a, b) {
    return Math.round(Math.abs((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000))
  }

  function conciliar(bancoMovs, libroMovs, tolDias, marcas) {
    const banco = bancoMovs.map((m, i) => ({ ...m, _i: i, _match: null }))
    const libro = libroMovs.map((m, i) => ({ ...m, _i: i, _match: null }))
    const pares = []

    // Grupos que quedaron a medias: el libro dice un total y el extracto ya no
    // trae todos sus movimientos. Es la fuente de descuadres invisibles.
    const gruposIncompletos = []

    // PASO 0a — marcas AGRUPADAS (N movimientos del banco : 1 línea del libro).
    // Junta las marcas por grupo_id, suma los movimientos del banco y empareja contra
    // la línea del libro de la misma partida (monto ≈ total del grupo). Caso típico: taxis,
    // donde muchos depósitos chicos suman un solo asiento consolidado en libros.
    if (marcas && marcas.length) {
      const grupos = {}
      for (const mk of marcas) {
        if (!mk.grupo_id) continue
        ;(grupos[mk.grupo_id] = grupos[mk.grupo_id] || []).push(mk)
      }
      for (const gid of Object.keys(grupos)) {
        const gmarcas = grupos[gid]
        const partidaId = gmarcas[0].partida_id
        const grupoTotal = Number(gmarcas[0].grupo_total) ||
          r2(gmarcas.reduce((s, mk) => s + Number(mk.mov_monto || 0), 0))
        const movsB = []
        const faltantesDelGrupo = []
        for (const mk of gmarcas) {
          const b = banco.find(x => x._match === null && !movsB.includes(x) &&
            x.fecha === mk.mov_fecha && Math.abs(x.monto - Number(mk.mov_monto)) <= 0.01 && x.tipo === mk.mov_tipo)
          if (b) movsB.push(b)
          else faltantesDelGrupo.push(mk)          // estaba conciliado, hoy no está en el extracto
        }
        if (!movsB.length) continue
        const l = libro.find(x => x._match === null && x.partida_id === partidaId &&
          x.tipo === movsB[0].tipo && Math.abs(x.monto - grupoTotal) <= 0.02)
        if (!l) continue

        // ── GRUPO INCOMPLETO ──
        // El grupo se cruza contra la línea del libro por su total ORIGINAL,
        // pero movsB solo trae los movimientos que HOY están en el extracto.
        // Si el banco quitó algunos, el resto se marcaba como cruzado igual y
        // la línea del libro también: todo quedaba "conciliado" y la plata que
        // faltaba desaparecía de la vista. El descuadre seguía en el total, sin
        // nada que lo explicara — que es exactamente lo que estaba pasando.
        // Ahora se cruza igual (para no llenar la pantalla de ruido) pero se
        // registra el faltante, y se muestra aparte con su monto exacto.
        const sumaB = r2(movsB.reduce((s, b) => s + Number(b.monto || 0), 0))
        const brecha = r2(Number(l.monto) - sumaB)
        if (Math.abs(brecha) > 0.02) {
          gruposIncompletos.push({
            grupo_id: gid,
            partida_id: partidaId,
            partida_numero: gmarcas[0].partida_numero,
            libro_monto: Number(l.monto),
            banco_suma: sumaB,
            brecha,
            esperados: gmarcas.length,
            encontrados: movsB.length,
            faltantes: faltantesDelGrupo
          })
        }

        l._match = movsB[0]._i
        for (const b of movsB) {
          b._match = l._i
          pares.push({ banco: b, libro: l, dias: diasEntre(b.fecha, l.fecha), porMarca: true, porGrupo: true })
        }
      }
    }

    // PASO 0b — marcas INDIVIDUALES (1 banco : 1 libro, por monto igual).
    // La marca solo "agarra" si la partida sigue aprobada (tiene línea en el libro);
    // si fue anulada, no hay línea y cae al cruce normal → vuelve a solo banco. Correcto.
    if (marcas && marcas.length) {
      for (const b of banco) {
        if (b._match !== null) continue
        const cand = marcas.filter(mk => !mk.grupo_id &&
          mk.mov_fecha === b.fecha && Math.abs(Number(mk.mov_monto) - b.monto) <= 0.01 && mk.mov_tipo === b.tipo)
        for (const marca of cand) {
          const l = libro.find(x => x._match === null && x.partida_id === marca.partida_id &&
            Math.abs(x.monto - b.monto) <= 0.01 && x.tipo === b.tipo)
          if (l) {
            b._match = l._i; l._match = b._i
            pares.push({ banco: b, libro: l, dias: diasEntre(b.fecha, l.fecha), porMarca: true })
            break
          }
        }
      }
    }

    // PASO 1..N — cruce por monto + fecha, en pasadas de diferencia de días CRECIENTE.
    // Los de fecha exacta primero, para que un movimiento lejano no robe la contraparte.
    for (let d = 0; d <= tolDias; d++) {
      for (const b of banco) {
        if (b._match !== null) continue
        let mejor = null
        for (const l of libro) {
          if (l._match !== null) continue
          if (l.tipo !== b.tipo) continue
          if (Math.abs(l.monto - b.monto) > 0.01) continue
          if (diasEntre(b.fecha, l.fecha) !== d) continue
          mejor = l; break
        }
        if (mejor) {
          b._match = mejor._i; mejor._match = b._i
          pares.push({ banco: b, libro: mejor, dias: d })
        }
      }
    }
    return {
      pares,
      soloBanco: banco.filter(b => b._match === null),
      soloLibro: libro.filter(l => l._match === null),
      gruposIncompletos,
      banco, libro
    }
  }

  // Carga las marcas de conciliación guardadas para una cuenta y período
  async function cargarMarcas(cuentaCodigo, desde, hasta) {
    const sb = getSb()
    const { data } = await sb.from('conciliacion_marcas')
      .select('*').eq('cuenta_codigo', cuentaCodigo)
      .gte('mov_fecha', desde).lte('mov_fecha', hasta)
    return data || []
  }

  // ──────────────────────────────────────────────────────────
  //  VISTA (autoinyectada)
  // ──────────────────────────────────────────────────────────
  function ensureView() {
    if (document.getElementById('view-conciliacion')) return
    const any = document.querySelector('.view')
    if (!any || !any.parentNode) return
    const v = document.createElement('div')
    v.className = 'view'; v.id = 'view-conciliacion'
    any.parentNode.appendChild(v)
  }

  window.initConciliacion = function () {
    ensureView()
    const view = document.getElementById('view-conciliacion')
    if (view && !view.classList.contains('active')) {
      document.querySelectorAll('.view').forEach(x => x.classList.remove('active'))
      view.classList.add('active')
    }
    const hoy = new Date()
    const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    view.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">🏦 Conciliación bancaria</div>
          <div class="page-sub">Cruce de movimientos del sistema contra el estado de cuenta del banco</div>
        </div>
      </div>

      <div class="form-card" style="margin-bottom:16px">
        <div style="display:flex;gap:14px;align-items:end;flex-wrap:wrap">
          <div class="fld" style="min-width:280px">
            <label>Cuenta contable a conciliar</label>
            <input type="text" id="cb-cuenta" list="cb-cuenta-dl" placeholder="Escribí código o nombre…" autocomplete="off" style="width:100%">
            <datalist id="cb-cuenta-dl">
              ${cuentasBanco().map(c => `<option value="${c.codigo} · ${c.nombre}"></option>`).join('')}
            </datalist>
          </div>
          <div class="fld" style="min-width:200px">
            <label>Formato del banco</label>
            <select id="cb-banco">
              <option value="">Seleccionar banco...</option>
              ${BANCOS.map(b => `<option value="${b.id}" ${b.formato === 'pdf' ? 'disabled' : ''}>${b.label}${b.formato === 'pdf' ? ' — (PDF, próximamente)' : ''}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin-top:12px">
          <div class="fld"><label>Desde</label><input type="date" id="cb-desde" value="${localDateStr(ini)}"></div>
          <div class="fld"><label>Hasta</label><input type="date" id="cb-hasta" value="${localDateStr(hoy)}"></div>
          <div class="fld" style="width:120px"><label>Tolerancia (días)</label><input type="number" id="cb-tol" value="3" min="0" max="15"></div>
        </div>
        <div style="display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin-top:12px">
          <div class="fld" style="flex:1;min-width:240px">
            <label>Estado de cuenta del banco (Excel/XLS)</label>
            <input type="file" id="cb-file" accept=".xlsx,.xls" onchange="window._cbArchivo(this.files[0])">
          </div>
          <button class="btn btn-gold" id="cb-btn" onclick="window._cbConciliar()">Conciliar →</button>
        </div>
        <div id="cb-fileinfo" style="font-size:12px;color:var(--text3);margin-top:8px"></div>
      </div>

      <div id="cb-resumen" style="margin-bottom:16px"></div>
      <div id="cb-resultado"></div>`
  }

  window._cbArchivo = (file) => {
    archivoBanco = file || null
    document.getElementById('cb-fileinfo').textContent = file ? `Archivo: ${file.name}` : ''
  }

  window._cbConciliar = async () => {
    const bancoId = document.getElementById('cb-banco').value
    const cuentaCod = (document.getElementById('cb-cuenta').value || '').trim().split(/\s+/)[0]
    const desde = document.getElementById('cb-desde').value
    const hasta = document.getElementById('cb-hasta').value
    const tol = parseInt(document.getElementById('cb-tol').value, 10) || 0
    if (!cuentaCod) { window.toast?.('Seleccioná la cuenta contable', 'error'); return }
    if (!cuentasBanco().some(c => c.codigo === cuentaCod)) { window.toast?.('Cuenta no válida — elegila de la lista', 'error'); return }
    if (!bancoId) { window.toast?.('Seleccioná el formato del banco', 'error'); return }
    if (!desde || !hasta) { window.toast?.('Seleccioná el período', 'error'); return }
    if (!archivoBanco) { window.toast?.('Subí el archivo del estado de cuenta', 'error'); return }

    const bancoDef = BANCOS.find(b => b.id === bancoId)
    const cuentaNombre = (window.catalogoCuentas || []).find(c => c.codigo === cuentaCod)?.nombre || cuentaCod
    const btn = document.getElementById('cb-btn')
    btn.disabled = true; btn.textContent = 'Procesando...'
    document.getElementById('cb-resultado').innerHTML = '<div style="text-align:center;padding:24px"><div class="spinner"></div></div>'

    try {
      // 1) Parsear archivo del banco
      const buf = await archivoBanco.arrayBuffer()
      const wb = window.XLSX.read(buf, { type: 'array' })
      const bancoMovs = parsearExcel(wb, bancoId)
      if (!bancoMovs.length) throw new Error('No se leyeron movimientos del archivo. Revisá que sea el estado de cuenta correcto.')

      // 2) Cargar libro + marcas.
      //
      // OJO CON EL RANGO: los movimientos del banco salen del ARCHIVO y no se
      // filtran por fecha, pero el libro y las marcas SÍ se filtran por el
      // Desde/Hasta del formulario. Si el archivo trae días fuera de ese rango,
      // sus marcas no se cargan, el grupo no se reconoce y esos movimientos
      // aparecen en "Solo en banco" como si nunca se hubieran conciliado.
      // Parece que el sistema deshizo una conciliación vieja, y no es cierto:
      // simplemente quedó fuera de la ventana. Peor aún, invita a re-agrupar y
      // duplicar marcas que ya existían.
      // Solución: el rango efectivo cubre SIEMPRE lo que trae el archivo.
      const fechasArch = bancoMovs.map(m => m.fecha).filter(Boolean).sort()
      const desdeEf = fechasArch.length && fechasArch[0] < desde ? fechasArch[0] : desde
      const hastaEf = fechasArch.length && fechasArch[fechasArch.length - 1] > hasta ? fechasArch[fechasArch.length - 1] : hasta
      const rangoAmpliado = (desdeEf !== desde || hastaEf !== hasta)

      const libroMovs = await cargarLibro(cuentaCod, desdeEf, hastaEf)
      // 2b) Materializar las marcas de taxis (depósitos ya conciliados en Taxis)
      //     para que el PASO 0a agrupe esos depósitos contra la partida [IMP-TAXI].
      try { await getSb().rpc('tx_marcas_taxis_sync', { p_cuenta: cuentaCod, p_desde: desdeEf, p_hasta: hastaEf }) }
      catch (e) { console.warn('No se sincronizaron marcas de taxis:', e?.message || e) }
      const marcas = await cargarMarcas(cuentaCod, desdeEf, hastaEf)

      // 3) Cruzar (marcas primero, luego monto+fecha)
      const res = conciliar(bancoMovs, libroMovs, tol, marcas)
      const saldoBancoNeto = r2(bancoMovs.reduce((s, m) => s + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0))
      const saldoLibroNeto = r2(libroMovs.reduce((s, m) => s + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0))

      estadoConc = { bancoId, banco: bancoDef.label, cuenta: cuentaCod, cuentaNombre, desde: desdeEf, hasta: hastaEf, desdeForm: desde, hastaForm: hasta, rangoAmpliado, tol, ...res, saldoBancoNeto, saldoLibroNeto, reversosNetados: _ultimoNeteo, marcas }
      renderResultado()
    } catch (e) {
      console.error('conciliar:', e)
      document.getElementById('cb-resultado').innerHTML = `<div style="text-align:center;padding:24px;color:var(--red)">Error: ${e.message}</div>`
    } finally {
      btn.disabled = false; btn.textContent = 'Conciliar →'
    }
  }

  // Marcas (conciliados guardados) cuyo movimiento del banco YA NO está en el
  // extracto subido: el banco lo eliminó/revirtió. Se surfacea para que no
  // descuadre en silencio.
  function marcasFaltantes(marcas, bancoMovs) {
    if (!marcas || !marcas.length) return []
    const out = []; const vistos = new Set()
    for (const mk of marcas) {
      if (!mk.mov_fecha || mk.mov_monto == null) continue
      const existe = (bancoMovs || []).some(b => b.fecha === mk.mov_fecha &&
        Math.abs(b.monto - Number(mk.mov_monto)) <= 0.01 && b.tipo === mk.mov_tipo)
      if (existe) continue
      const key = `${mk.mov_fecha}|${mk.mov_monto}|${mk.mov_tipo}|${mk.partida_id || ''}`
      if (vistos.has(key)) continue
      vistos.add(key); out.push(mk)
    }
    return out
  }

  // ──────────────────────────────────────────────────────────
  //  DESCONCILIAR marcas huérfanas
  //
  //  Una marca dice "este movimiento del banco ya está cruzado con esta
  //  partida". Si el banco lo revirtió o lo quitó del extracto, la marca queda
  //  apuntando a algo que no existe y ensucia la conciliación para siempre.
  //
  //  UN GRUPO SE DESHACE ENTERO O NADA. Cuando se concilian N movimientos del
  //  banco contra 1 línea del libro, esas N marcas comparten grupo_id y su suma
  //  es grupo_total. Sacar una sola dejaría a las otras N-1 diciendo que cuadran
  //  contra una línea que ya no cuadra: un descuadre nuevo, escondido y peor que
  //  el original. Por eso siempre se borra el grupo completo.
  //
  //  OJO con el alcance: borrar las marcas NO toca la partida ni la contabilidad.
  //  Solo dice "esto ya no está conciliado". Si el dinero de verdad no entró, la
  //  partida hay que corregirla aparte — eso es una decisión contable, no algo
  //  que deba hacer por su cuenta un botón de conciliación.
  // ──────────────────────────────────────────────────────────

  // Trae TODAS las marcas del grupo desde la base (no solo las que están en
  // memoria): un grupo puede tener movimientos fuera del período consultado.
  async function marcasDelGrupo(mk) {
    const sb = getSb()
    if (!mk.grupo_id) return [mk]
    const { data, error } = await sb.from('conciliacion_marcas')
      .select('*').eq('grupo_id', mk.grupo_id)
    if (error) throw new Error(error.message)
    return (data && data.length) ? data : [mk]
  }

  async function borrarMarcas(ids) {
    const sb = getSb()
    const { error } = await sb.from('conciliacion_marcas').delete().in('id', ids)
    if (error) throw new Error(error.message)
    if (estadoConc && Array.isArray(estadoConc.marcas)) {
      estadoConc.marcas = estadoConc.marcas.filter(m => !ids.includes(m.id))
    }
  }

  function resumenGrupo(marcas) {
    const suma = marcas.reduce((s, m) => s + Number(m.mov_monto || 0), 0)
    const parts = [...new Set(marcas.map(m => m.partida_numero).filter(Boolean))]
    return { n: marcas.length, suma, partidas: parts }
  }

  window._cbDesconciliar = async function (id) {
    const mk = (estadoConc?.marcas || []).find(m => m.id === id)
    if (!mk) { window.toast?.('No se encontró esa marca', 'error'); return }
    try {
      const grupo = await marcasDelGrupo(mk)
      const g = resumenGrupo(grupo)
      let msg
      if (g.n > 1) {
        msg = `Ese movimiento es parte de un GRUPO:\n\n` +
          `${g.n} movimientos del banco que suman ${fmtL(g.suma)}\n` +
          `conciliados contra la partida ${g.partidas.map(p => '#' + p).join(', ')}\n\n` +
          `Se van a desconciliar LOS ${g.n}, no solo este.\n` +
          `Un grupo se deshace entero: si se quitara uno solo, los otros ${g.n - 1} quedarían ` +
          `cuadrando contra una línea del libro que ya no cuadra.\n\n` +
          `Las partidas y la contabilidad NO se tocan.\n\n¿Continuar?`
      } else {
        msg = `¿Desconciliar este movimiento?\n\n` +
          `${mk.mov_fecha} · ${mk.mov_descripcion || '(sin descripción)'}\n` +
          `Monto: ${fmtL(mk.mov_monto)}${mk.partida_numero ? `\nPartida: #${mk.partida_numero}` : ''}\n\n` +
          `Se quita la marca de conciliación. La partida y la contabilidad NO se tocan.`
      }
      if (!confirm(msg)) return
      await borrarMarcas(grupo.map(m => m.id))
      window.toast?.(g.n > 1 ? `Grupo desconciliado (${g.n} movimientos)` : 'Movimiento desconciliado', 'success')
      renderResultado()
    } catch (e) { window.toast?.('Error: ' + e.message, 'error') }
  }

  window._cbDesconciliarTodas = async function () {
    const faltan = marcasFaltantes(estadoConc?.marcas, estadoConc?.banco)
    if (!faltan.length) { window.toast?.('No hay marcas para desconciliar', 'error'); return }
    try {
      // Juntar los grupos completos de cada huérfana. Varias huérfanas pueden
      // caer en el mismo grupo (pasó con los dos DEP_ATM del mismo día): así se
      // borra una sola vez y el conteo que se muestra es el real.
      const todas = new Map()
      for (const mk of faltan) {
        for (const m of await marcasDelGrupo(mk)) todas.set(m.id, m)
      }
      const lista = [...todas.values()]
      const g = resumenGrupo(lista)
      const grupos = new Set(lista.map(m => m.grupo_id || m.id)).size
      const msg =
        `Se van a desconciliar ${grupos} grupo(s) de conciliación:\n\n` +
        `${lista.length} movimientos del banco · ${fmtL(g.suma)}\n` +
        `Partidas afectadas: ${g.partidas.map(p => '#' + p).join(', ') || '—'}\n\n` +
        `Los ${faltan.length} movimientos que no aparecen en el extracto arrastran a todo su grupo: ` +
        `un grupo se deshace entero o queda descuadrado.\n\n` +
        `Las partidas y la contabilidad NO se tocan.\n\n¿Continuar?`
      if (!confirm(msg)) return
      await borrarMarcas(lista.map(m => m.id))
      window.toast?.(`${lista.length} movimiento(s) desconciliado(s)`, 'success')
      renderResultado()
    } catch (e) { window.toast?.('Error: ' + e.message, 'error') }
  }

  // ──────────────────────────────────────────────────────────
  //  RECUPERAR un grupo roto
  //
  //  Cuando se borran marcas de a una, el grupo queda con menos movimientos de
  //  los que su total reclama. Esos movimientos siguen en el extracto pero
  //  quedan sueltos en "Solo en banco", y NO se pueden reparar con «Agrupar N
  //  banco → 1 libro»: esa herramienta pide seleccionar la línea del libro, y
  //  esa línea ya está cruzada con la parte del grupo que sí sobrevivió.
  //
  //  Esto es lo que faltaba: volver a pegar los movimientos sueltos AL GRUPO
  //  que ya existe, usando su mismo grupo_id. Con un objetivo a la vista, para
  //  no tener que sumar doce depósitos a ojo.
  // ──────────────────────────────────────────────────────────
  let objetivoGrupo = null

  window._cbArmarGrupo = function (gid) {
    const g = (estadoConc?.gruposIncompletos || []).find(x => x.grupo_id === gid)
    if (!g) { window.toast?.('No se encontró ese grupo', 'error'); return }
    const mk = (estadoConc.marcas || []).find(m => m.grupo_id === gid)
    objetivoGrupo = {
      grupo_id: gid,
      partida_id: g.partida_id,
      partida_numero: g.partida_numero,
      falta: r2(g.sinMarca),
      cuenta_codigo: mk?.cuenta_codigo || estadoConc.cuenta,
      banco: mk?.banco || estadoConc.bancoId,
      grupo_total: mk?.grupo_total ?? g.libro_monto
    }
    // Limpiar selección previa para arrancar de cero
    document.querySelectorAll('.cb-sel-banco:checked').forEach(c => { c.checked = false })
    window._cbSumaSel()
    document.getElementById('cb-objetivo')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.toast?.(`Seleccioná los movimientos de la partida #${g.partida_numero}`, 'success')
  }

  window._cbCancelarObjetivo = function () {
    objetivoGrupo = null
    document.querySelectorAll('.cb-sel-banco:checked').forEach(c => { c.checked = false })
    window._cbSumaSel()
  }

  // Pinta el objetivo y cuánto falta según lo que va seleccionado
  function pintarObjetivo(sumaSel) {
    const cont = document.getElementById('cb-objetivo')
    if (!cont) return
    if (!objetivoGrupo) { cont.innerHTML = ''; return }
    const o = objetivoGrupo
    const restan = r2(o.falta - sumaSel)
    const cuadra = Math.abs(restan) < 0.01
    cont.innerHTML = `
      <div style="padding:10px 14px;background:${cuadra ? 'rgba(22,163,74,.10)' : 'rgba(224,168,0,.10)'};border-bottom:1px solid ${cuadra ? 'var(--green)' : 'var(--amber)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-size:13px">
            🔧 Armando el grupo de la partida <strong>#${o.partida_numero}</strong>
            <div style="font-size:12px;color:var(--text3);margin-top:3px">
              Falta recuperar <strong>${fmtL(o.falta)}</strong> ·
              seleccionado <strong style="color:var(--text)">${fmtL(sumaSel)}</strong> ·
              ${cuadra ? '<strong style="color:var(--green)">✓ cuadra exacto</strong>'
                       : `restan <strong style="color:var(--amber)">${fmtL(restan)}</strong>`}
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:11.5px" onclick="window._cbCancelarObjetivo()">Cancelar</button>
            <button class="btn ${cuadra ? 'btn-gold' : 'btn-ghost'}" style="padding:4px 12px;font-size:11.5px${cuadra ? '' : ';opacity:.5'}"
                    ${cuadra ? '' : 'disabled'} onclick="window._cbConfirmarGrupo()">Pegar al grupo #${o.partida_numero}</button>
          </div>
        </div>
      </div>`
  }

  let _guardandoGrupo = false
  window._cbConfirmarGrupo = async function () {
    if (!objetivoGrupo) return
    // Un segundo clic mientras se guarda insertaba las marcas DOS VECES.
    // Le pasó a la #1569: quedó con 52 marcas por 32,248 contra una línea de
    // 21,399 — el doble de lo recuperado.
    if (_guardandoGrupo) return
    const o = objetivoGrupo
    const sel = [...document.querySelectorAll('.cb-sel-banco:checked')].map(c => parseInt(c.value, 10))
    const movs = sel.map(i => estadoConc.banco.find(x => x._i === i)).filter(Boolean)
    if (!movs.length) { window.toast?.('No hay movimientos seleccionados', 'error'); return }
    const suma = r2(movs.reduce((s, m) => s + Number(m.monto || 0), 0))
    if (Math.abs(suma - o.falta) > 0.01) {
      window.toast?.(`La suma (${fmtL(suma)}) no coincide con lo que falta (${fmtL(o.falta)})`, 'error'); return
    }
    if (!confirm(
      `¿Pegar ${movs.length} movimiento(s) por ${fmtL(suma)} al grupo de la partida #${o.partida_numero}?\n\n` +
      `Se recrean las marcas que se habían borrado. La partida y la contabilidad NO se tocan.`)) return
    _guardandoGrupo = true
    const btnOk = document.querySelector('#cb-objetivo button.btn-gold')
    if (btnOk) { btnOk.disabled = true; btnOk.textContent = 'Guardando…' }
    try {
      // Releer el grupo desde la base antes de escribir.
      const { data: yaHay } = await getSb().from('conciliacion_marcas')
        .select('mov_fecha,mov_monto').eq('grupo_id', o.grupo_id)
      const actuales = yaHay || []
      const sumaActual = r2(actuales.reduce((s2, m) => s2 + Number(m.mov_monto || 0), 0))

      // INVARIANTE DURA: un grupo NUNCA puede sumar más que su total declarado.
      // Es la única regla que no depende de comparar descripciones (que difieren
      // entre las marcas de Taxis y las del extracto) ni de contar montos
      // repetidos (el 29-jun tiene siete depósitos de L.500 distintos, y
      // deduplicar por monto se llevaría marcas buenas).
      // Sin esta regla, la #1569 terminó con 52 marcas por 32,248 contra una
      // línea de 21,399.
      const totalGrupo = Number(o.grupo_total || 0)
      if (totalGrupo > 0 && r2(sumaActual + suma) > r2(totalGrupo) + 0.02) {
        window.toast?.(
          `No se puede: el grupo ya suma ${fmtL(sumaActual)} y la línea del libro dice ${fmtL(totalGrupo)}. ` +
          `Agregar ${fmtL(suma)} lo pasaría de largo.`, 'error')
        return
      }

      // Además, no reinsertar movimientos que ya estén (misma fecha y monto,
      // contando repeticiones: si el grupo ya tiene tres de L.500 ese día y se
      // seleccionan cuatro, solo entra uno).
      const cuenta = {}
      for (const m of actuales) {
        const k = `${m.mov_fecha}|${Number(m.mov_monto).toFixed(2)}`
        cuenta[k] = (cuenta[k] || 0) + 1
      }
      const nuevos = []
      for (const m of movs) {
        const k = `${m.fecha}|${Number(m.monto).toFixed(2)}`
        if (cuenta[k] > 0) { cuenta[k]--; continue }
        nuevos.push(m)
      }
      if (!nuevos.length) {
        window.toast?.('Esos movimientos ya estaban en el grupo — no se duplicó nada', 'error')
        objetivoGrupo = null; window._cbConciliar(); return
      }
      if (nuevos.length < movs.length) {
        window.toast?.(`${movs.length - nuevos.length} ya estaban en el grupo; se agregan ${nuevos.length}`, 'success')
      }
      const filas = nuevos.map(m => ({
        cuenta_codigo: o.cuenta_codigo, banco: o.banco,
        mov_fecha: m.fecha, mov_monto: m.monto, mov_tipo: m.tipo,
        mov_descripcion: (m.descripcion || '').slice(0, 120),
        partida_id: o.partida_id, partida_numero: o.partida_numero,
        origen: 'grupo', grupo_id: o.grupo_id, grupo_total: o.grupo_total
      }))
      const { error } = await getSb().from('conciliacion_marcas').insert(filas)
      if (error) throw new Error(error.message)
      objetivoGrupo = null
      window.toast?.(`${filas.length} movimiento(s) devueltos al grupo — reconciliando…`, 'success')
      window._cbConciliar()
    } catch (e) { window.toast?.('Error: ' + e.message, 'error') }
    finally { _guardandoGrupo = false }
  }

  function renderResultado() {
    const e = estadoConc
    const resumen = document.getElementById('cb-resumen')
    const dif = r2(e.saldoBancoNeto - e.saldoLibroNeto)
    const cuadra = Math.abs(dif) < 0.01
    const faltan = marcasFaltantes(e.marcas, e.banco)
    const gi = e.gruposIncompletos || []
    // Solo lo que el banco NO trae puede explicar el descuadre. Lo que perdió su
    // marca sigue en el extracto (queda en "Solo en banco"), así que no mueve el
    // neto: contarlo hacía que el aviso dijera L. 11,713 con un descuadre de 600.
    const sinBancoTot = r2(gi.reduce((s, g) =>
      s + r2((g.faltantes || []).reduce((a, f) => a + Number(f.mov_monto || 0), 0)), 0))
    const sinMarcaTot = r2(gi.reduce((s, g) => s + r2(g.brecha), 0) - sinBancoTot)
    const banner = `<div style="padding:11px 16px;border-radius:10px;margin-bottom:12px;font-weight:700;font-size:15px;background:${cuadra ? 'rgba(22,163,74,.12)' : 'rgba(248,81,73,.12)'};border:1px solid ${cuadra ? 'var(--green)' : 'var(--red)'};color:${cuadra ? 'var(--green)' : 'var(--red)'}">${cuadra ? '✓ CUADRA — banco y libro coinciden' : `⚠ NO CUADRA — Diferencia ${fmtL(dif)}`}${faltan.length ? ` · ${faltan.length} conciliado(s) ya no está(n) en el extracto` : ''}${gi.length ? `<div style="font-weight:500;font-size:12.5px;margin-top:5px;color:var(--amber)">🧩 ${gi.length} grupo(s) incompleto(s)${sinBancoTot !== 0 ? ` · ${fmtL(sinBancoTot)} que el banco ya no trae` : ''}${sinMarcaTot !== 0 ? ` · ${fmtL(sinMarcaTot)} de marcas perdidas (el dinero está, quedó en "Solo en banco")` : ''}</div>` : ''}</div>`
    const avisoRango = e.rangoAmpliado ? `<div style="padding:9px 14px;border-radius:9px;margin-bottom:10px;background:rgba(59,130,246,.10);border:1px solid #3b82f6;color:#9ec5fe;font-size:12.5px">
      📅 El archivo trae movimientos del <strong>${e.desde}</strong> al <strong>${e.hasta}</strong>, fuera del rango que pusiste (${e.desdeForm} → ${e.hastaForm}).
      Se amplió solo para cargar el libro y las marcas de esos días — si no, las conciliaciones viejas de esas fechas aparecerían como si nunca se hubieran hecho.
    </div>` : ''
    resumen.innerHTML = banner + avisoRango + `
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px">
        <div class="stat-card"><div class="stat-num" style="font-size:17px;color:var(--green)">${e.pares.length}</div><div class="stat-label">Conciliados</div></div>
        <div class="stat-card"><div class="stat-num" style="font-size:17px;color:var(--amber)">${e.soloBanco.length}</div><div class="stat-label">Solo en banco</div></div>
        <div class="stat-card"><div class="stat-num" style="font-size:17px;color:var(--red)">${e.soloLibro.length}</div><div class="stat-label">Solo en libro</div></div>
        <div class="stat-card"><div class="stat-num" style="font-size:15px">${fmtL(e.saldoBancoNeto)}</div><div class="stat-label">Neto banco</div></div>
        <div class="stat-card"><div class="stat-num" style="font-size:15px;color:${Math.abs(dif) < 0.01 ? 'var(--green)' : 'var(--red)'}">${fmtL(dif)}</div><div class="stat-label">Diferencia</div></div>
      </div>
      ${e.reversosNetados > 0 ? `<div style="margin-top:10px;padding:8px 12px;background:var(--bg3);border-radius:8px;font-size:12px;color:var(--text3)">🔄 Se netearon automáticamente <strong>${e.reversosNetados}</strong> reverso(s) del banco (depósitos duplicados que el banco revirtió). No afectan el neto.</div>` : ''}`

    const filaMov = (m, lado, idx) => `
      <tr class="cb-fila-${lado}" data-fecha="${m.fecha}">
        <td><input type="checkbox" class="cb-sel-${lado}" value="${idx}" onchange="window._cbSumaSel()"></td>
        <td style="font-size:12px">${m.fecha}</td>
        <td style="font-size:12px">${(m.descripcion || '').slice(0, 50)}${m.numero_partida ? ` · #${m.numero_partida}` : ''}</td>
        <td style="text-align:right;font-family:var(--mono);color:${m.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)'}">${m.tipo === 'ingreso' ? '+' : '−'} ${fmtL(m.monto)}</td>
        ${lado === 'banco' ? `<td><button class="btn btn-ghost" style="padding:3px 8px;font-size:11px" onclick="window._cbCrearPartida(${idx})">+ Partida</button></td>` : '<td></td>'}
      </tr>`

    const _diasMap = {}
    for (const m of e.soloBanco) _diasMap[m.fecha] = (_diasMap[m.fecha] || 0) + 1
    const _diasBanco = Object.keys(_diasMap).sort()
    const controlesDiaBanco = e.soloBanco.length ? `
      <div style="padding:8px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:var(--bg2);border-bottom:1px solid var(--border)">
        <label style="font-size:12px;color:var(--text3)">Filtrar día:</label>
        <select id="cb-banco-dia" onchange="window._cbFiltrarDiaBanco()" style="padding:3px 6px;font-size:12px">
          <option value="">Todos (${e.soloBanco.length})</option>
          ${_diasBanco.map(f => `<option value="${f}">${f} (${_diasMap[f]})</option>`).join('')}
        </select>
        <label style="font-size:12px;display:flex;align-items:center;gap:5px;cursor:pointer;color:var(--text2)">
          <input type="checkbox" id="cb-banco-all" onchange="window._cbSelTodosBanco(this.checked)" style="width:auto;margin:0"> Seleccionar todos (visibles)
        </label>
      </div>` : ''

    document.getElementById('cb-resultado').innerHTML = `
      ${(e.gruposIncompletos || []).length ? (() => {
        const gi = e.gruposIncompletos
        // Un grupo incompleto tiene DOS causas posibles, y se distinguen así:
        //
        //  a) LA MARCA EXISTE pero el movimiento no está en el extracto
        //     → el banco lo quitó o revirtió. Plata que el libro reclama y el
        //       banco no muestra. Eso sí es un problema contable.
        //
        //  b) EL MOVIMIENTO EXISTE pero su marca se borró
        //     → el grupo se rompió (pasa al desconciliar de a uno). El dinero
        //       está: el movimiento quedó suelto en "Solo en banco". No falta
        //       plata, falta volver a emparejarlo.
        //
        //  Se separan porque mezclarlas hacía decir "explican L. 11,713" cuando
        //  el descuadre real era L. 600: casi todo era (b), no plata perdida.
        for (const g of gi) {
          g.sinBanco = r2(g.faltantes.reduce((s2, f) => s2 + Number(f.mov_monto || 0), 0))
          g.sinMarca = r2(g.brecha - g.sinBanco)
        }
        const totSinBanco = r2(gi.reduce((s2, g) => s2 + g.sinBanco, 0))
        const totSinMarca = r2(gi.reduce((s2, g) => s2 + g.sinMarca, 0))
        return `<div class="table-wrap" style="margin-bottom:14px;border:1px solid var(--amber)">
        <div style="padding:10px 14px;font-weight:700;color:var(--amber);background:var(--bg3)">
          🧩 Grupos incompletos (${gi.length})
        </div>
        <div style="padding:9px 14px;font-size:12.5px;color:var(--text2);background:var(--bg2);border-bottom:1px solid var(--border)">
          ${totSinBanco !== 0 ? `⚠️ <strong style="color:var(--red)">${fmtL(totSinBanco)}</strong> — el banco <strong>ya no trae</strong> esos movimientos. Esa sí es plata que el libro reclama y el extracto no muestra: si el banco los revirtió, la partida tiene de más.` : ''}
          ${totSinBanco !== 0 && totSinMarca !== 0 ? '<br>' : ''}
          ${totSinMarca !== 0 ? `🔧 <strong style="color:var(--amber)">${fmtL(totSinMarca)}</strong> — <strong>el grupo se rompió</strong>: esos movimientos están en el extracto pero perdieron su marca, y quedaron sueltos abajo en "Solo en banco". <strong>No falta plata</strong>, falta volver a emparejarlos con «🧩 Agrupar N banco → 1 libro».` : ''}
        </div>
        <table style="width:100%"><thead><tr>
          <th>Partida</th><th style="text-align:right">Dice el libro</th><th style="text-align:right">Trae el extracto</th>
          <th style="text-align:right">Banco no lo trae</th><th style="text-align:right">Marca perdida</th><th>Movs</th><th>Qué falta</th>
        </tr></thead>
        <tbody>${gi.map(g => `<tr>
          <td>${g.partida_numero ? '#' + g.partida_numero : '—'}</td>
          <td style="text-align:right;font-family:var(--mono)">${fmtL(g.libro_monto)}</td>
          <td style="text-align:right;font-family:var(--mono)">${fmtL(g.banco_suma)}</td>
          <td style="text-align:right;font-family:var(--mono);color:${Math.abs(g.sinBanco) > 0.01 ? 'var(--red)' : 'var(--text3)'};font-weight:${Math.abs(g.sinBanco) > 0.01 ? '700' : '400'}">${Math.abs(g.sinBanco) > 0.01 ? fmtL(g.sinBanco) : '—'}</td>
          <td style="text-align:right;font-family:var(--mono);color:${Math.abs(g.sinMarca) > 0.01 ? 'var(--amber)' : 'var(--text3)'}">${Math.abs(g.sinMarca) > 0.01 ? fmtL(g.sinMarca) : '—'}</td>
          <td style="font-size:12px">${g.encontrados} de ${g.esperados}</td>
          <td style="font-size:11.5px;color:var(--text3)">
            ${g.faltantes.slice(0, 3).map(m => `${m.mov_fecha} · ${fmtL(m.mov_monto)} · ${(m.mov_descripcion || '').slice(0, 24)}`).join('<br>') || '<em>—</em>'}
            ${g.faltantes.length > 3 ? `<br>… y ${g.faltantes.length - 3} más` : ''}
            ${Math.abs(g.sinMarca) > 0.01 ? `<div style="margin-top:5px"><button class="btn btn-ghost" style="padding:3px 9px;font-size:11px;color:var(--amber);border-color:var(--amber)"
              onclick="window._cbArmarGrupo('${g.grupo_id}')">🔧 Recuperar ${fmtL(g.sinMarca)}</button></div>` : ''}
          </td>
        </tr>`).join('')}</tbody></table>
        <div style="padding:8px 14px;font-size:12px;color:var(--text3)">
          <strong>"Banco no lo trae"</strong>: la marca existe pero el movimiento no está en el extracto. El banco lo quitó o revirtió → revisá la partida.
          <br><strong>"Marca perdida"</strong>: el movimiento está en el extracto pero sin marca, y quedó suelto en "Solo en banco". Se arregla seleccionándolo ahí y usando «🧩 Agrupar N banco → 1 libro» contra la línea de esa partida. No es plata faltante.
        </div>
      </div>` })() : ''}
      ${faltan.length ? (() => {
        // Cuántas marcas tiene cada grupo (de las que están en memoria: sirve
        // para avisar del arrastre; el conteo exacto sale de la base al borrar)
        const porGrupo = {}
        for (const m of (estadoConc.marcas || [])) {
          const k = m.grupo_id || ('solo:' + m.id)
          porGrupo[k] = porGrupo[k] || { n: 0, suma: 0, partida: m.partida_numero }
          porGrupo[k].n++; porGrupo[k].suma += Number(m.mov_monto || 0)
        }
        const gruposAfectados = new Set(faltan.map(m => m.grupo_id || ('solo:' + m.id)))
        return `<div class="table-wrap" style="margin-bottom:14px;border:1px solid var(--red)">
        <div style="padding:10px 14px;font-weight:700;color:var(--red);background:var(--bg3);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span>⚠️ Conciliados que ya NO están en el extracto (${faltan.length}) — el banco los eliminó o revirtió</span>
          <button class="btn btn-ghost" style="padding:4px 10px;font-size:11.5px;color:var(--red);border-color:var(--red)"
                  onclick="window._cbDesconciliarTodas()">Desconciliar ${gruposAfectados.size} grupo(s)</button>
        </div>
        <table style="width:100%"><thead><tr><th>Fecha</th><th>Descripción</th><th style="text-align:right">Monto</th><th>Partida</th><th>Grupo</th><th style="text-align:right">Acción</th></tr></thead>
        <tbody>${faltan.map(mk => {
          const k = mk.grupo_id || ('solo:' + mk.id)
          const g = porGrupo[k] || { n: 1, suma: Number(mk.mov_monto || 0) }
          return `<tr>
          <td>${mk.mov_fecha}</td>
          <td>${(mk.mov_descripcion || '—')}</td>
          <td style="text-align:right;color:var(--red)">${fmtL(mk.mov_monto)}</td>
          <td>${mk.partida_numero ? '#' + mk.partida_numero : '—'}</td>
          <td style="font-size:11.5px;color:${g.n > 1 ? 'var(--amber)' : 'var(--text3)'}">
            ${g.n > 1 ? `⚠ ${g.n} movs · ${fmtL(g.suma)}` : 'individual'}
          </td>
          <td style="text-align:right">
            <button class="btn btn-ghost" style="padding:3px 9px;font-size:11px"
                    onclick="window._cbDesconciliar('${mk.id}')">${g.n > 1 ? `Desconciliar grupo (${g.n})` : 'Desconciliar'}</button>
          </td>
        </tr>` }).join('')}</tbody></table>
        <div style="padding:8px 14px;font-size:12px;color:var(--text3)">
          Estaban conciliados antes pero no aparecen en el estado de cuenta subido. Revisá si el banco los revirtió (duplicados) o si falta un extracto.
          <br><strong>Los que dicen "N movs" arrastran a todo su grupo:</strong> esos N se conciliaron juntos contra una sola línea del libro, así que se deshacen enteros o el grupo queda descuadrado.
          <br><strong>Desconciliar solo quita la marca</strong> — no toca la partida ni la contabilidad.
        </div>
      </div>` })() : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="table-wrap">
          <div style="padding:10px 14px;font-weight:600;color:var(--amber);background:var(--bg3)">⚠️ Solo en el banco (${e.soloBanco.length}) — falta registrar en el sistema</div>
          <div id="cb-objetivo"></div>
          ${controlesDiaBanco}
          <table style="width:100%"><thead><tr><th style="width:28px"></th><th>Fecha</th><th>Descripción</th><th style="text-align:right">Monto</th><th>Acción</th></tr></thead>
          <tbody>${e.soloBanco.map((m) => filaMov(m, 'banco', m._i)).join('') || '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text3)">Todo conciliado ✓</td></tr>'}</tbody></table>
        </div>
        <div class="table-wrap">
          <div style="padding:10px 14px;font-weight:600;color:var(--red);background:var(--bg3)">⚠️ Solo en el libro (${e.soloLibro.length}) — no aparece en el banco</div>
          <table style="width:100%"><thead><tr><th style="width:28px"></th><th>Fecha</th><th>Descripción</th><th style="text-align:right">Monto</th><th></th></tr></thead>
          <tbody>${e.soloLibro.map((m) => filaMov(m, 'libro', m._i)).join('') || '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text3)">Todo conciliado ✓</td></tr>'}</tbody></table>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin:12px 0;flex-wrap:wrap;align-items:center">
        <button class="btn btn-gold" onclick="window._cbCrearPartidaSeleccionados()">+ Crear 1 partida de seleccionados (banco)</button>
        <button class="btn btn-ghost" onclick="window._cbEmparejar()">🔗 Emparejar seleccionados (manual)</button>
        <button class="btn btn-ghost" onclick="window._cbAgrupar()">🧩 Agrupar N banco → 1 libro</button>
        <span style="font-size:12px;color:var(--text3)">tol. suma <input type="number" id="cb-tol-suma" value="0" min="0" step="0.01" style="width:74px;padding:3px 6px" oninput="window._cbSumaSel()"></span>
        <button class="btn btn-ghost" onclick="window._cbToggleConciliados()">Ver conciliados (${e.pares.length})</button>
      </div>
      <div id="cb-suma-sel" style="font-size:13px;color:var(--text3);margin:-4px 0 12px;min-height:18px"></div>
      <div id="cb-conciliados" class="table-wrap" style="display:none">
        <div style="padding:10px 14px;font-weight:600;color:var(--green);background:var(--bg3)">✅ Conciliados (${e.pares.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px">
          <input id="cb-concil-q" placeholder="Buscar descripción, # partida o monto…" autocomplete="off" oninput="window._cbFiltrarConcil()" style="flex:1;min-width:200px;padding:6px 8px;font-size:12px">
          <select id="cb-concil-tipo" onchange="window._cbFiltrarConcil()" style="padding:6px 8px;font-size:12px">
            <option value="">Tipo: todos</option>
            <option value="grupo">🧩 Grupo</option>
            <option value="marca">🔗 Marca</option>
            <option value="directo">Directo</option>
          </select>
          <label style="font-size:12px;color:var(--text3);display:flex;align-items:center;gap:5px;white-space:nowrap"><input type="checkbox" id="cb-concil-desfase" onchange="window._cbFiltrarConcil()"> solo Δdías&gt;0</label>
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" onclick="window._cbLimpiarConcil()">Limpiar</button>
          <span id="cb-concil-count" style="font-size:12px;color:var(--text3)"></span>
        </div>
        <table style="width:100%"><thead><tr><th>Fecha banco</th><th>Descripción banco</th><th>Fecha libro</th><th>Partida</th><th style="text-align:right">Monto</th><th>Δ días</th><th></th></tr></thead>
        <tbody id="cb-concil-tbody">${e.pares.map(cbConcilRow).join('')}</tbody></table>
      </div>`
  }

  // Una fila de la tabla de conciliados (reutilizable por el filtro)
  function cbConcilRow(p) {
    return `<tr>
      <td style="font-size:12px">${p.banco.fecha}</td>
      <td style="font-size:12px">${(p.banco.descripcion || '').slice(0, 40)}</td>
      <td style="font-size:12px">${p.libro.fecha}</td>
      <td style="font-size:12px">#${p.libro.numero_partida || '—'}</td>
      <td style="text-align:right;font-family:var(--mono)">${fmtL(p.banco.monto)}</td>
      <td style="text-align:center;font-size:12px;color:var(--text3)">${p.dias}</td>
      <td style="font-size:11px;color:var(--gold)">${p.porGrupo ? '🧩 grupo' : (p.porMarca ? '🔗 marca' : '')}</td>
    </tr>`
  }

  window._cbFiltrarConcil = () => {
    const pares = (estadoConc && estadoConc.pares) || []
    const q = (document.getElementById('cb-concil-q')?.value || '').trim().toLowerCase()
    const qn = q.replace(/[,\s]/g, '')   // versión numérica (sin comas/espacios) para montos
    const tipo = document.getElementById('cb-concil-tipo')?.value || ''
    const soloDesfase = !!document.getElementById('cb-concil-desfase')?.checked
    let list = pares
    if (q) list = list.filter(p => {
      const desc = (p.banco.descripcion || '').toLowerCase()
      const part = String(p.libro.numero_partida || '').toLowerCase()
      const montoStr = String(p.banco.monto)                       // "2010.12"
      const montoFmt = fmtL(p.banco.monto).replace(/[^\d.]/g, '')   // "2010.12" desde "L. 2,010.12"
      const matchMonto = qn !== '' && (montoStr.includes(qn) || montoFmt.includes(qn))
      return desc.includes(q) || part.includes(q) || matchMonto
    })
    if (tipo === 'grupo') list = list.filter(p => p.porGrupo)
    else if (tipo === 'marca') list = list.filter(p => p.porMarca && !p.porGrupo)
    else if (tipo === 'directo') list = list.filter(p => !p.porGrupo && !p.porMarca)
    if (soloDesfase) list = list.filter(p => Math.abs(Number(p.dias) || 0) > 0)
    const tb = document.getElementById('cb-concil-tbody')
    if (tb) tb.innerHTML = list.map(cbConcilRow).join('') || '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--text3)">Sin resultados</td></tr>'
    const c = document.getElementById('cb-concil-count'); if (c) c.textContent = `${list.length} de ${pares.length}`
  }
  window._cbLimpiarConcil = () => {
    const q = document.getElementById('cb-concil-q'); if (q) q.value = ''
    const t = document.getElementById('cb-concil-tipo'); if (t) t.value = ''
    const d = document.getElementById('cb-concil-desfase'); if (d) d.checked = false
    window._cbFiltrarConcil()
  }

  window._cbToggleConciliados = () => {
    const el = document.getElementById('cb-conciliados')
    el.style.display = el.style.display === 'none' ? '' : 'none'
  }

  // Filtrar el panel "Solo en el banco" por día.
  // IMPORTANTE: la selección se MANTIENE entre días — así se pueden ir marcando
  // depósitos de varios días para completar una misma partida/emparejamiento.
  window._cbFiltrarDiaBanco = () => {
    const dia = document.getElementById('cb-banco-dia')?.value || ''
    document.querySelectorAll('.cb-fila-banco').forEach(tr => {
      const show = !dia || tr.getAttribute('data-fecha') === dia
      tr.style.display = show ? '' : 'none'
      // (las filas ocultas conservan su check: la suma y las acciones los incluyen)
    })
    const all = document.getElementById('cb-banco-all'); if (all) all.checked = false
    window._cbSumaSel()
  }

  // Marcar/desmarcar todas las filas visibles del banco
  window._cbSelTodosBanco = (checked) => {
    document.querySelectorAll('.cb-fila-banco').forEach(tr => {
      if (tr.style.display !== 'none') { const cb = tr.querySelector('.cb-sel-banco'); if (cb) cb.checked = checked }
    })
    window._cbSumaSel()
  }

  // Emparejado manual: 1 del banco + 1 del libro seleccionados
  window._cbEmparejar = async () => {
    const selB = [...document.querySelectorAll('.cb-sel-banco:checked')].map(c => parseInt(c.value, 10))
    const selL = [...document.querySelectorAll('.cb-sel-libro:checked')].map(c => parseInt(c.value, 10))
    if (selB.length !== 1 || selL.length !== 1) {
      window.toast?.('Seleccioná exactamente 1 del banco y 1 del libro', 'error'); return
    }
    const b = estadoConc.banco.find(x => x._i === selB[0])
    const l = estadoConc.libro.find(x => x._i === selL[0])
    if (!b || !l) return
    b._match = l._i; l._match = b._i
    estadoConc.pares.push({ banco: b, libro: l, dias: diasEntre(b.fecha, l.fecha), porMarca: true })
    estadoConc.soloBanco = estadoConc.soloBanco.filter(x => x._i !== b._i)
    estadoConc.soloLibro = estadoConc.soloLibro.filter(x => x._i !== l._i)
    // Guardar marca para que el emparejado quede persistente en la próxima conciliación
    if (l.partida_id) {
      const sb = getSb()
      const { error } = await sb.from('conciliacion_marcas').insert({
        cuenta_codigo: estadoConc.cuenta, banco: estadoConc.bancoId,
        mov_fecha: b.fecha, mov_monto: b.monto, mov_tipo: b.tipo,
        mov_descripcion: (b.descripcion || '').slice(0, 160),
        partida_id: l.partida_id, partida_numero: l.numero_partida || null, origen: 'manual'
      })
      if (error) console.warn('No se guardó la marca manual:', error.message)
    }
    window.toast?.('Emparejado manual ✓ (guardado)', 'success')
    renderResultado()
  }

  // Suma en vivo de lo seleccionado (banco) vs la línea del libro elegida
  window._cbSumaSel = () => {
    const el = document.getElementById('cb-suma-sel')
    if (!el || !estadoConc) return
    const selB = [...document.querySelectorAll('.cb-sel-banco:checked')].map(c => parseInt(c.value, 10))
    const selL = [...document.querySelectorAll('.cb-sel-libro:checked')].map(c => parseInt(c.value, 10))
    // Si se está armando un grupo roto, el objetivo se actualiza con cada clic
    if (objetivoGrupo) {
      const movsObj = selB.map(i => estadoConc.banco.find(x => x._i === i)).filter(Boolean)
      pintarObjetivo(r2(movsObj.reduce((s2, m) => s2 + Number(m.monto || 0), 0)))
    }
    if (!selB.length && !selL.length) { el.innerHTML = ''; return }
    const movsB = selB.map(i => estadoConc.banco.find(x => x._i === i)).filter(Boolean)
    // Neto: ingreso suma, egreso resta → un crédito y un débito iguales se cancelan
    const cbSigned = (m) => (m.tipo === 'ingreso' ? m.monto : -m.monto)
    const sumaB = r2(movsB.reduce((s, b) => s + cbSigned(b), 0))
    // ¿Cuántos seleccionados están ocultos por el filtro de día actual?
    const ocultosSel = [...document.querySelectorAll('.cb-sel-banco:checked')]
      .filter(c => c.closest('tr')?.style.display === 'none').length
    let html = `Banco seleccionado (neto): <strong>${fmtL(sumaB)}</strong> (${movsB.length} mov.${ocultosSel > 0 ? `, <span style="color:var(--amber)">${ocultosSel} de otros días</span>` : ''})`
    if (selL.length === 1) {
      const l = estadoConc.libro.find(x => x._i === selL[0])
      if (l) {
        const tol = Math.max(0, parseFloat(document.getElementById('cb-tol-suma')?.value) || 0)
        const lSigned = cbSigned(l)
        const dif = r2(sumaB - lSigned)
        const cuadra = Math.abs(dif) <= tol + 0.001
        html += ` &nbsp;·&nbsp; Libro: <strong>${fmtL(lSigned)}</strong> &nbsp;·&nbsp; Diferencia: <strong style="color:${cuadra ? 'var(--green)' : 'var(--red)'}">${fmtL(dif)}</strong> ${cuadra ? '✓ cuadra' : ''}`
      }
    } else if (selL.length > 1) {
      html += ` &nbsp;·&nbsp; <span style="color:var(--amber)">seleccioná solo 1 del libro para comparar</span>`
    }
    el.innerHTML = html
  }

  // Agrupado manual: N del banco (que suman) : 1 del libro
  window._cbAgrupar = async () => {
    const selB = [...document.querySelectorAll('.cb-sel-banco:checked')].map(c => parseInt(c.value, 10))
    const selL = [...document.querySelectorAll('.cb-sel-libro:checked')].map(c => parseInt(c.value, 10))
    if (selB.length < 1 || selL.length !== 1) {
      window.toast?.('Seleccioná 1 o más del banco y exactamente 1 del libro', 'error'); return
    }
    const movsB = selB.map(i => estadoConc.banco.find(x => x._i === i)).filter(Boolean)
    const l = estadoConc.libro.find(x => x._i === selL[0])
    if (!movsB.length || !l) return
    if (movsB.some(b => b.tipo !== l.tipo)) {
      window.toast?.('Los movimientos del banco y la línea del libro deben ser del mismo tipo (ingreso/egreso).', 'error'); return
    }
    const suma = r2(movsB.reduce((s, b) => s + b.monto, 0))
    const tol = Math.max(0, parseFloat(document.getElementById('cb-tol-suma')?.value) || 0)
    const dif = r2(Math.abs(suma - l.monto))
    if (dif > tol + 0.001) {
      window.toast?.(`La suma del banco (${fmtL(suma)}) no coincide con el libro (${fmtL(l.monto)}). Diferencia ${fmtL(dif)} > tolerancia ${fmtL(tol)}.`, 'error'); return
    }
    if (!l.partida_id) {
      window.toast?.('La línea del libro no tiene partida asociada; no se puede guardar el grupo.', 'error'); return
    }
    // Actualizar estado en memoria: las N del banco apuntan a la misma línea del libro
    l._match = movsB[0]._i
    for (const b of movsB) {
      b._match = l._i
      estadoConc.pares.push({ banco: b, libro: l, dias: diasEntre(b.fecha, l.fecha), porMarca: true, porGrupo: true })
      estadoConc.soloBanco = estadoConc.soloBanco.filter(x => x._i !== b._i)
    }
    estadoConc.soloLibro = estadoConc.soloLibro.filter(x => x._i !== l._i)
    // Guardar el grupo: una marca por movimiento del banco, con grupo_id y grupo_total compartidos
    //
    // ANTES de insertar hay que ver si esa línea del libro YA tiene marcas. Si
    // se agrupa de nuevo sobre una partida que ya tenía grupo (típico al reparar
    // uno roto), quedaban DOS grupos para la misma línea. En la conciliación
    // siguiente los dos pelean por los mismos movimientos del banco: el que
    // corre primero se los lleva y el otro queda incompleto. El resultado es que
    // días que estaban bien aparecen de golpe sin conciliar, sin que nadie haya
    // borrado nada. Una línea del libro = un solo grupo.
    let previas = []
    try {
      const { data } = await getSb().from('conciliacion_marcas')
        .select('id,grupo_id,mov_monto,grupo_total')
        .eq('partida_id', l.partida_id).eq('cuenta_codigo', estadoConc.cuenta)
      previas = (data || []).filter(m => Math.abs(Number(m.grupo_total ?? l.monto) - Number(l.monto)) <= 0.02)
    } catch (e) { /* si no se puede consultar, se sigue y se avisa abajo */ }

    if (previas.length) {
      const sumaPrev = r2(previas.reduce((s, m) => s + Number(m.mov_monto || 0), 0))
      const ok = confirm(
        `La partida #${l.numero_partida || '—'} YA tiene ${previas.length} marca(s) de conciliación ` +
        `por ${fmtL(sumaPrev)} contra esta misma línea.\n\n` +
        `Si se agregan las nuevas sin quitar las viejas, quedan DOS grupos para la misma línea y ` +
        `la próxima conciliación se descuadra sola.\n\n` +
        `¿Reemplazar las ${previas.length} marcas anteriores por estos ${movsB.length} movimientos?\n\n` +
        `(No se toca la partida ni la contabilidad.)`)
      if (!ok) { window.toast?.('Agrupado cancelado', 'error'); return }
      const { error: dErr } = await getSb().from('conciliacion_marcas')
        .delete().in('id', previas.map(m => m.id))
      if (dErr) { window.toast?.('No se pudieron quitar las marcas anteriores: ' + dErr.message, 'error'); return }
    }

    const gid = (window.crypto?.randomUUID?.() || ('g' + Date.now() + Math.random().toString(36).slice(2)))
    const filas = movsB.map(b => ({
      cuenta_codigo: estadoConc.cuenta, banco: estadoConc.bancoId,
      mov_fecha: b.fecha, mov_monto: b.monto, mov_tipo: b.tipo,
      mov_descripcion: (b.descripcion || '').slice(0, 160),
      partida_id: l.partida_id, partida_numero: l.numero_partida || null,
      grupo_id: gid, grupo_total: l.monto, origen: 'grupo'
    }))
    const { error } = await getSb().from('conciliacion_marcas').insert(filas)
    if (error) console.warn('No se guardó el grupo de marcas:', error.message)
    window.toast?.(`Agrupado ✓ ${movsB.length} mov. del banco → partida #${l.numero_partida || '—'} (guardado)`, 'success')
    renderResultado()
  }

  window._cbCrearPartidaSeleccionados = () => {
    const sel = [...document.querySelectorAll('.cb-sel-banco:checked')].map(c => parseInt(c.value, 10))
    if (!sel.length) { window.toast?.('Seleccioná al menos un movimiento del banco', 'error'); return }
    const movs = estadoConc.soloBanco.filter(x => sel.includes(x._i))
    abrirModalPartida(movs)
  }

  // ── PASO 7: crear partida desde 1 o varios movimientos del banco ──
  window._cbCrearPartida = (idx) => {
    const m = estadoConc.soloBanco.find(x => x._i === idx)
    if (!m) return
    abrirModalPartida([m])
  }

  // Crea el modal del paso 7 en el DOM (no depende de index.html)
  function ensureModalPartida() {
    const old = document.getElementById('modal-cb-partida')
    if (old) old.remove()
    const div = document.createElement('div')
    div.className = 'modal-backdrop'
    div.id = 'modal-cb-partida'
    div.innerHTML = `
      <div class="modal" style="max-width:640px">
        <div class="modal-header"><h3>Registrar movimiento(s) del banco</h3><button class="modal-close" onclick="closeModal('modal-cb-partida')">✕</button></div>
        <div class="modal-body">
          <div id="cb-cp-info" style="background:var(--bg3);border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px"></div>
          <div id="cb-cp-lineas"></div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;font-size:12px;margin-top:10px">
            <input type="checkbox" id="cb-cp-fiscal" style="width:auto;margin:0"> Aplica al libro fiscal
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick="closeModal('modal-cb-partida')">Cancelar</button>
          <button class="btn btn-gold" id="cb-cp-btn" onclick="window._cbGuardarPartida()">Crear partida</button>
        </div>
      </div>`
    document.body.appendChild(div)
  }

  function abrirModalPartida(movs) {
    ensureModalPartida()
    window._cbPartidaMovs = movs
    const totalIng = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0)
    const totalEgr = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0)
    document.getElementById('cb-cp-info').innerHTML = `
      <strong>${movs.length} movimiento(s)</strong> · cuenta banco <strong>${estadoConc.cuenta}</strong><br>
      ${totalIng > 0 ? `Entradas: <span style="color:var(--green)">${fmtL(totalIng)}</span> · ` : ''}${totalEgr > 0 ? `Salidas: <span style="color:var(--red)">${fmtL(totalEgr)}</span>` : ''}<br>
      <span style="color:var(--text3)">Elegí la contracuenta de cada movimiento. El banco se debita/acredita automáticamente.</span>`

    const cuentas = (window.catalogoCuentas || []).filter(c => c.codigo.includes('-'))
    const centros = (window._empresas?.() || [])
    // datalist compartido para autocompletar escribiendo
    let dl = document.getElementById('cb-cp-datalist')
    if (dl) dl.remove()
    dl = document.createElement('datalist')
    dl.id = 'cb-cp-datalist'
    dl.innerHTML = cuentas.map(c => `<option value="${c.codigo} · ${c.nombre}"></option>`).join('')
    document.body.appendChild(dl)

    const optsCentro = '<option value="">Centro de costo...</option>' + centros.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')

    document.getElementById('cb-cp-lineas').innerHTML = movs.map((m) => `
      <div style="padding:8px 0;border-bottom:0.5px solid var(--border)">
        <div style="font-size:12px;margin-bottom:4px">
          ${m.fecha} · <span style="color:${m.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)'}">${m.tipo === 'ingreso' ? '+' : '−'} ${fmtL(m.monto)}</span>
          <span style="color:var(--text3)"> · ${(m.descripcion || '').slice(0, 40)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:8px">
          <div class="fld"><input type="text" class="cb-cp-cuenta" data-i="${m._i}" list="cb-cp-datalist"
            placeholder="Escribí código o nombre de cuenta..." autocomplete="off" style="width:100%"></div>
          <div class="fld"><select class="cb-cp-centro" data-i="${m._i}" style="width:100%">${optsCentro}</select></div>
        </div>
      </div>`).join('')
    document.getElementById('cb-cp-fiscal').checked = false
    document.getElementById('modal-cb-partida').classList.add('open')
  }

  window._cbGuardarPartida = async () => {
    const movs = window._cbPartidaMovs || []
    if (!movs.length) return
    const fiscal = document.getElementById('cb-cp-fiscal').checked
    const selects = [...document.querySelectorAll('.cb-cp-cuenta')]
    const asignaciones = []
    for (const s of selects) {
      const i = parseInt(s.dataset.i, 10)
      const raw = (s.value || '').trim()
      let cod = raw.split('·')[0].trim()
      const m = movs.find(x => x._i === i)
      if (!(window.catalogoCuentas || []).some(c => c.codigo === cod)) {
        const porTexto = (window.catalogoCuentas || []).find(c => raw.toUpperCase().includes(c.codigo) || (`${c.codigo} · ${c.nombre}`.toUpperCase() === raw.toUpperCase()))
        cod = porTexto ? porTexto.codigo : ''
      }
      if (!cod) { window.toast?.('Elegí una cuenta válida para todos los movimientos (usá la lista)', 'error'); return }
      // centro de costo de esa misma línea
      const selC = document.querySelector(`.cb-cp-centro[data-i="${i}"]`)
      const centroId = selC ? (selC.value || null) : null
      asignaciones.push({ mov: m, contraCod: cod, centroId })
    }

    const sb = getSb()
    const cuentas = window.catalogoCuentas || []
    const banco = cuentas.find(c => c.codigo === estadoConc.cuenta)
    if (!banco) { window.toast?.('No se encontró la cuenta del banco en el catálogo', 'error'); return }
    const currentProfile = window._currentProfile?.() || {}

    const btn = document.getElementById('cb-cp-btn')
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'
    try {
      const total = r2(asignaciones.reduce((s, a) => s + a.mov.monto, 0))
      const num = await window.siguienteNumeroPartida()
      const descPartida = asignaciones.length === 1
        ? `CONCILIACIÓN ${estadoConc.bancoId} · ${asignaciones[0].mov.descripcion || ''}`.toUpperCase().slice(0, 160)
        : `CONCILIACIÓN ${estadoConc.bancoId} · ${asignaciones.length} movimientos`.toUpperCase().slice(0, 160)
      const fecha = asignaciones.map(a => a.mov.fecha).sort().slice(-1)[0]

      // Partida APROBADA (para que cuente en la próxima conciliación)
      const { data: partida, error: pErr } = await sb.from('partidas_contables').insert({
        centro_costo_id: null, fecha_partida: fecha, numero_partida: num,
        descripcion: descPartida, tipo_origen: 'otro', estado: 'aprobada', total,
        generada_por: currentProfile.id || null,
        aprobada_at: new Date().toISOString(),
        aprobada_por: currentProfile.id || null
      }).select().single()
      if (pErr || !partida) throw new Error(pErr?.message || 'No se creó la partida')

      // Por CADA movimiento: 1 línea contra (con su centro) + 1 línea de banco (misma fecha/monto)
      // → así cada movimiento del banco matchea 1 a 1 en la próxima conciliación
      const lineas = []
      for (const a of asignaciones) {
        const contra = cuentas.find(c => c.codigo === a.contraCod)
        if (!contra) throw new Error('Cuenta no encontrada: ' + a.contraCod)
        const esIngreso = a.mov.tipo === 'ingreso'
        const desc = (a.mov.descripcion || descPartida).slice(0, 160)
        // contracuenta (gasto/ingreso) con su centro de costo
        lineas.push({
          partida_id: partida.id, cuenta_id: contra.id, cuenta_codigo: contra.codigo, cuenta_nombre: contra.nombre,
          tipo: esIngreso ? 'credito' : 'debito', monto: a.mov.monto, descripcion: desc,
          aplica_fiscal: fiscal, centro_costo_id: a.centroId
        })
        // línea de banco individual (sin centro), opuesta
        lineas.push({
          partida_id: partida.id, cuenta_id: banco.id, cuenta_codigo: banco.codigo, cuenta_nombre: banco.nombre,
          tipo: esIngreso ? 'debito' : 'credito', monto: a.mov.monto, descripcion: desc,
          aplica_fiscal: fiscal, centro_costo_id: null
        })
      }

      const { error: lErr } = await sb.from('lineas_partida').insert(lineas)
      if (lErr) throw new Error(lErr.message)

      // Guardar MARCAS: vincula cada movimiento del banco con esta partida
      // (doble verificación: en la próxima conciliación se reconoce por la marca)
      const marcas = asignaciones.map(a => ({
        cuenta_codigo: estadoConc.cuenta, banco: estadoConc.bancoId,
        mov_fecha: a.mov.fecha, mov_monto: a.mov.monto, mov_tipo: a.mov.tipo,
        mov_descripcion: (a.mov.descripcion || '').slice(0, 160),
        partida_id: partida.id, partida_numero: num, origen: 'partida'
      }))
      const { error: mErr } = await sb.from('conciliacion_marcas').insert(marcas)
      if (mErr) console.warn('No se guardaron las marcas de conciliación:', mErr.message)

      window.toast?.(`Partida #${num} creada y APROBADA con ${asignaciones.length} movimiento(s) ✓`, 'success')
      document.getElementById('modal-cb-partida').classList.remove('open')
      const ids = asignaciones.map(a => a.mov._i)
      estadoConc.soloBanco = estadoConc.soloBanco.filter(x => !ids.includes(x._i))
      renderResultado()
    } catch (e) {
      console.error(e); window.toast?.('Error: ' + e.message, 'error')
    } finally {
      btn.disabled = false; btn.textContent = 'Crear partida'
    }
  }
})()