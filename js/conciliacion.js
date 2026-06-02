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

    // PASO 0 — emparejar por MARCA explícita (movimiento del banco ya registrado en una partida).
    // La marca solo "agarra" si la partida sigue aprobada (tiene línea en el libro);
    // si fue anulada, no hay línea y cae al cruce normal → vuelve a solo banco. Correcto.
    if (marcas && marcas.length) {
      for (const b of banco) {
        if (b._match !== null) continue
        const cand = marcas.filter(mk =>
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
            <select id="cb-cuenta">
              <option value="">Seleccionar cuenta...</option>
              ${cuentasBanco().map(c => `<option value="${c.codigo}">${c.codigo} · ${c.nombre}</option>`).join('')}
            </select>
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
    const cuentaCod = document.getElementById('cb-cuenta').value
    const desde = document.getElementById('cb-desde').value
    const hasta = document.getElementById('cb-hasta').value
    const tol = parseInt(document.getElementById('cb-tol').value, 10) || 0
    if (!cuentaCod) { window.toast?.('Seleccioná la cuenta contable', 'error'); return }
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

      // 2) Cargar libro (de la cuenta elegida) + marcas guardadas
      const libroMovs = await cargarLibro(cuentaCod, desde, hasta)
      const marcas = await cargarMarcas(cuentaCod, desde, hasta)

      // 3) Cruzar (marcas primero, luego monto+fecha)
      const res = conciliar(bancoMovs, libroMovs, tol, marcas)
      const saldoBancoNeto = r2(bancoMovs.reduce((s, m) => s + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0))
      const saldoLibroNeto = r2(libroMovs.reduce((s, m) => s + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0))

      estadoConc = { bancoId, banco: bancoDef.label, cuenta: cuentaCod, cuentaNombre, desde, hasta, tol, ...res, saldoBancoNeto, saldoLibroNeto, reversosNetados: _ultimoNeteo }
      renderResultado()
    } catch (e) {
      console.error('conciliar:', e)
      document.getElementById('cb-resultado').innerHTML = `<div style="text-align:center;padding:24px;color:var(--red)">Error: ${e.message}</div>`
    } finally {
      btn.disabled = false; btn.textContent = 'Conciliar →'
    }
  }

  function renderResultado() {
    const e = estadoConc
    const resumen = document.getElementById('cb-resumen')
    const dif = r2(e.saldoBancoNeto - e.saldoLibroNeto)
    resumen.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px">
        <div class="stat-card"><div class="stat-num" style="font-size:17px;color:var(--green)">${e.pares.length}</div><div class="stat-label">Conciliados</div></div>
        <div class="stat-card"><div class="stat-num" style="font-size:17px;color:var(--amber)">${e.soloBanco.length}</div><div class="stat-label">Solo en banco</div></div>
        <div class="stat-card"><div class="stat-num" style="font-size:17px;color:var(--red)">${e.soloLibro.length}</div><div class="stat-label">Solo en libro</div></div>
        <div class="stat-card"><div class="stat-num" style="font-size:15px">${fmtL(e.saldoBancoNeto)}</div><div class="stat-label">Neto banco</div></div>
        <div class="stat-card"><div class="stat-num" style="font-size:15px;color:${Math.abs(dif) < 0.01 ? 'var(--green)' : 'var(--red)'}">${fmtL(dif)}</div><div class="stat-label">Diferencia</div></div>
      </div>
      ${e.reversosNetados > 0 ? `<div style="margin-top:10px;padding:8px 12px;background:var(--bg3);border-radius:8px;font-size:12px;color:var(--text3)">🔄 Se netearon automáticamente <strong>${e.reversosNetados}</strong> reverso(s) del banco (depósitos duplicados que el banco revirtió). No afectan el neto.</div>` : ''}`

    const filaMov = (m, lado, idx) => `
      <tr>
        <td><input type="checkbox" class="cb-sel-${lado}" value="${idx}"></td>
        <td style="font-size:12px">${m.fecha}</td>
        <td style="font-size:12px">${(m.descripcion || '').slice(0, 50)}${m.numero_partida ? ` · #${m.numero_partida}` : ''}</td>
        <td style="text-align:right;font-family:var(--mono);color:${m.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)'}">${m.tipo === 'ingreso' ? '+' : '−'} ${fmtL(m.monto)}</td>
        ${lado === 'banco' ? `<td><button class="btn btn-ghost" style="padding:3px 8px;font-size:11px" onclick="window._cbCrearPartida(${idx})">+ Partida</button></td>` : '<td></td>'}
      </tr>`

    document.getElementById('cb-resultado').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="table-wrap">
          <div style="padding:10px 14px;font-weight:600;color:var(--amber);background:var(--bg3)">⚠️ Solo en el banco (${e.soloBanco.length}) — falta registrar en el sistema</div>
          <table style="width:100%"><thead><tr><th style="width:28px"></th><th>Fecha</th><th>Descripción</th><th style="text-align:right">Monto</th><th>Acción</th></tr></thead>
          <tbody>${e.soloBanco.map((m) => filaMov(m, 'banco', m._i)).join('') || '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text3)">Todo conciliado ✓</td></tr>'}</tbody></table>
        </div>
        <div class="table-wrap">
          <div style="padding:10px 14px;font-weight:600;color:var(--red);background:var(--bg3)">⚠️ Solo en el libro (${e.soloLibro.length}) — no aparece en el banco</div>
          <table style="width:100%"><thead><tr><th style="width:28px"></th><th>Fecha</th><th>Descripción</th><th style="text-align:right">Monto</th><th></th></tr></thead>
          <tbody>${e.soloLibro.map((m) => filaMov(m, 'libro', m._i)).join('') || '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text3)">Todo conciliado ✓</td></tr>'}</tbody></table>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin:12px 0;flex-wrap:wrap">
        <button class="btn btn-gold" onclick="window._cbCrearPartidaSeleccionados()">+ Crear 1 partida de seleccionados (banco)</button>
        <button class="btn btn-ghost" onclick="window._cbEmparejar()">🔗 Emparejar seleccionados (manual)</button>
        <button class="btn btn-ghost" onclick="window._cbToggleConciliados()">Ver conciliados (${e.pares.length})</button>
      </div>
      <div id="cb-conciliados" class="table-wrap" style="display:none">
        <div style="padding:10px 14px;font-weight:600;color:var(--green);background:var(--bg3)">✅ Conciliados (${e.pares.length})</div>
        <table style="width:100%"><thead><tr><th>Fecha banco</th><th>Descripción banco</th><th>Fecha libro</th><th>Partida</th><th style="text-align:right">Monto</th><th>Δ días</th><th></th></tr></thead>
        <tbody>${e.pares.map(p => `<tr>
          <td style="font-size:12px">${p.banco.fecha}</td>
          <td style="font-size:12px">${(p.banco.descripcion || '').slice(0, 40)}</td>
          <td style="font-size:12px">${p.libro.fecha}</td>
          <td style="font-size:12px">#${p.libro.numero_partida || '—'}</td>
          <td style="text-align:right;font-family:var(--mono)">${fmtL(p.banco.monto)}</td>
          <td style="text-align:center;font-size:12px;color:var(--text3)">${p.dias}</td>
          <td style="font-size:11px;color:var(--gold)">${p.porMarca ? '🔗 marca' : ''}</td>
        </tr>`).join('')}</tbody></table>
      </div>`
  }

  window._cbToggleConciliados = () => {
    const el = document.getElementById('cb-conciliados')
    el.style.display = el.style.display === 'none' ? '' : 'none'
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

  // Botón para crear partida agrupada de los seleccionados del banco
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
          <input type="text" class="cb-cp-cuenta" data-i="${m._i}" list="cb-cp-datalist"
            placeholder="Escribí código o nombre de cuenta..." autocomplete="off" style="font-size:12px;width:100%">
          <select class="cb-cp-centro" data-i="${m._i}" style="font-size:12px">${optsCentro}</select>
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