// ── CONTAMAX · Conciliación de cuentas PUENTE (partidas abiertas) ──
// Empareja 1 débito con 1 crédito de igual monto dentro de una cuenta puente.
// Tres zonas: (1) Sugerencias automáticas con confirmación de 1 click,
// (2) Pendientes para emparejar manual, (3) Ya conciliados con deshacer.
// Depende de: window._sb, window._currentProfile, window.toast, window.logActividad

const cpSb = () => window._sb
const cpFmt = n => (parseFloat(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let cpCuenta = null
let cpMovs = { debe: [], haber: [] }
let cpSel = { debe: null, haber: null }

window.initConciliaPuente = async () => {
  cpSel = { debe: null, haber: null }
  cpMovs = { debe: [], haber: [] }
  cpCuenta = null
  const hoy = new Date()
  const ini = new Date(hoy.getTime() - 60 * 864e5)
  const fi = document.getElementById('cp-fecha-ini'); if (fi && !fi.value) fi.value = ini.toISOString().split('T')[0]
  const ff = document.getElementById('cp-fecha-fin'); if (ff && !ff.value) ff.value = hoy.toISOString().split('T')[0]
  await cpLlenarSelectorCuentas()
  document.getElementById('cp-resultado')?.classList.add('hidden')
}

async function cpLlenarSelectorCuentas() {
  const sel = document.getElementById('cp-cuenta')
  if (!sel) return
  const { data, error } = await cpSb().from('catalogo_cuentas')
    .select('id, codigo, nombre').eq('es_cuenta_puente', true).order('codigo')
  if (error) { window.toast?.('Error cargando cuentas puente: ' + error.message, 'error'); return }
  if (!data || !data.length) {
    sel.innerHTML = '<option value="">— No hay cuentas marcadas como puente —</option>'
    return
  }
  sel.innerHTML = '<option value="">Seleccioná una cuenta puente…</option>' +
    data.map(c => `<option value="${c.id}" data-codigo="${c.codigo}" data-nombre="${(c.nombre || '').replace(/"/g, '&quot;')}">${c.codigo} · ${c.nombre}</option>`).join('')
}

window.cpConsultar = async () => {
  const sel = document.getElementById('cp-cuenta')
  const cuentaId = sel?.value
  if (!cuentaId) { window.toast?.('Seleccioná una cuenta puente', 'error'); return }
  const opt = sel.options[sel.selectedIndex]
  cpCuenta = { id: cuentaId, codigo: opt.dataset.codigo, nombre: opt.dataset.nombre }

  const fechaIni = document.getElementById('cp-fecha-ini').value
  const fechaFin = document.getElementById('cp-fecha-fin').value
  const verConciliados = document.getElementById('cp-ver-conciliados')?.checked

  const btn = document.getElementById('cp-btn-consultar')
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando…' }

  const { data: lineas, error } = await cpSb().from('lineas_partida')
    .select('id, monto, tipo, descripcion, conciliado_puente, grupo_conciliacion, partida:partidas_contables(id, fecha_partida, numero_partida, descripcion, estado)')
    .eq('cuenta_id', cuentaId)
    .order('id', { ascending: true }).limit(5000)
  if (btn) { btn.disabled = false; btn.textContent = 'Consultar →' }
  if (error) { window.toast?.('Error: ' + error.message, 'error'); return }

  const filtradas = (lineas || []).filter(l => {
    if (!l.partida || l.partida.estado !== 'aprobada') return false
    const f = l.partida.fecha_partida
    if (f < fechaIni || f > fechaFin) return false
    if (!verConciliados && l.conciliado_puente) return false
    return true
  })
  const mapMov = l => ({
    id: l.id, monto: Math.round((parseFloat(l.monto) || 0) * 100) / 100,
    fecha: l.partida.fecha_partida, numPartida: l.partida.numero_partida || '—',
    partidaId: l.partida.id, descripcion: l.descripcion || l.partida.descripcion || '',
    conciliado: !!l.conciliado_puente, grupo: l.grupo_conciliacion
  })
  cpMovs.debe = filtradas.filter(l => l.tipo === 'debito').map(mapMov)
  cpMovs.haber = filtradas.filter(l => l.tipo === 'credito').map(mapMov)
  cpSel = { debe: null, haber: null }

  cpRender()
  document.getElementById('cp-resultado')?.classList.remove('hidden')
}

// ── Similitud de referencias ──
function cpTokens(s) {
  return new Set((s || '').toLowerCase().replace(/[^a-z0-9áéíóúñ ]/gi, ' ').split(/\s+/).filter(w => w.length >= 4))
}
function cpCoincide(a, b) {
  const ta = cpTokens(a), tb = cpTokens(b)
  for (const w of ta) if (tb.has(w)) return true
  return false
}

// ── SUGERENCIAS de alta confianza ──
// Par seguro = mismo monto exacto + referencia coincide + ÚNICO de ese monto en
// cada lado. Si hay varios del mismo monto, van a pendientes (revisión manual).
function cpCalcularSugerencias() {
  const debe = cpMovs.debe.filter(m => !m.conciliado)
  const haber = cpMovs.haber.filter(m => !m.conciliado)
  const sugeridas = []
  const usadosD = new Set(), usadosH = new Set()
  for (const d of debe) {
    if (usadosD.has(d.id)) continue
    const cand = haber.filter(h => !usadosH.has(h.id) && Math.abs(h.monto - d.monto) < 0.01 && cpCoincide(d.descripcion, h.descripcion))
    const compitenD = debe.filter(x => !usadosD.has(x.id) && Math.abs(x.monto - d.monto) < 0.01 && cand.some(h => cpCoincide(x.descripcion, h.descripcion)))
    if (cand.length === 1 && compitenD.length === 1) {
      sugeridas.push({ d, h: cand[0] })
      usadosD.add(d.id); usadosH.add(cand[0].id)
    }
  }
  return sugeridas
}

function cpRender() {
  const pend = m => !m.conciliado
  const sugeridas = cpCalcularSugerencias()
  const idsSugeridos = new Set()
  sugeridas.forEach(s => { idsSugeridos.add(s.d.id); idsSugeridos.add(s.h.id) })

  const debePend = cpMovs.debe.filter(m => pend(m) && !idsSugeridos.has(m.id))
  const haberPend = cpMovs.haber.filter(m => pend(m) && !idsSugeridos.has(m.id))
  const conciliados = [...cpMovs.debe, ...cpMovs.haber].filter(m => m.conciliado)

  const totD = cpMovs.debe.filter(pend).reduce((s, m) => s + m.monto, 0)
  const totH = cpMovs.haber.filter(pend).reduce((s, m) => s + m.monto, 0)

  const resumen = document.getElementById('cp-resumen')
  if (resumen) {
    resumen.innerHTML = `
      <div style="font-weight:600;color:var(--gold);margin-bottom:4px">${cpCuenta.codigo} — ${cpCuenta.nombre}</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;font-size:13px">
        <span>Débitos abiertos: <strong>${cpMovs.debe.filter(pend).length}</strong> · L. ${cpFmt(totD)}</span>
        <span>Créditos abiertos: <strong>${cpMovs.haber.filter(pend).length}</strong> · L. ${cpFmt(totH)}</span>
        <span>Pendiente neto: <strong style="color:${Math.abs(totD - totH) < 0.01 ? 'var(--green)' : 'var(--amber)'}">L. ${cpFmt(totD - totH)}</strong></span>
      </div>`
  }

  // ── ZONA 1: Sugerencias ──
  const zonaSug = document.getElementById('cp-zona-sugerencias')
  if (zonaSug) {
    if (sugeridas.length) {
      zonaSug.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
          <span style="font-size:12px;color:var(--green);letter-spacing:1px">✓ SUGERENCIAS AUTOMÁTICAS (${sugeridas.length}) — mismo monto y referencia</span>
          <button class="btn btn-gold" onclick="cpConciliarTodasSugerencias()" style="padding:6px 14px;font-size:12px">Conciliar todas (${sugeridas.length})</button>
        </div>
        <div style="max-height:260px;overflow-y:auto">
          <table style="width:100%">
            <thead><tr><th>Cargo (DEBE)</th><th>Abono (HABER)</th><th style="text-align:right">Monto</th><th style="width:90px"></th></tr></thead>
            <tbody>${sugeridas.map(s => `<tr style="background:rgba(16,185,129,0.08)">
              <td style="font-size:12px"><span style="font-family:var(--mono);font-size:11px">#${s.d.numPartida} · ${s.d.fecha}</span><br>${s.d.descripcion || '—'}</td>
              <td style="font-size:12px"><span style="font-family:var(--mono);font-size:11px">#${s.h.numPartida} · ${s.h.fecha}</span><br>${s.h.descripcion || '—'}</td>
              <td style="text-align:right;font-family:var(--mono);font-weight:600">L. ${cpFmt(s.d.monto)}</td>
              <td><button class="btn btn-ghost" onclick="cpConciliarUno('${s.d.id}','${s.h.id}')" style="padding:4px 10px;font-size:11px;border-color:var(--green);color:var(--green)">Conciliar</button></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`
      zonaSug.style.display = ''
    } else {
      zonaSug.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:8px 0">No hay sugerencias automáticas — emparejá manualmente abajo.</div>'
      zonaSug.style.display = ''
    }
  }

  // ── ZONA 2: Pendientes (manual) ──
  document.getElementById('cp-tbody-debe').innerHTML = cpPintaLado('debe', debePend)
  document.getElementById('cp-tbody-haber').innerHTML = cpPintaLado('haber', haberPend)
  cpRenderBarraAccion()

  // ── ZONA 3: Ya conciliados ──
  const zonaConc = document.getElementById('cp-zona-conciliados')
  if (zonaConc) {
    const grupos = {}
    conciliados.forEach(m => { if (m.grupo) (grupos[m.grupo] = grupos[m.grupo] || []).push(m) })
    const setDebe = new Set(cpMovs.debe.map(x => x.id))
    const filas = Object.entries(grupos).map(([g, movs]) => {
      const d = movs.find(x => setDebe.has(x.id)), h = movs.find(x => !setDebe.has(x.id))
      const monto = movs[0]?.monto || 0
      return `<tr style="opacity:0.85">
        <td style="font-size:12px">${d ? `#${d.numPartida} ${d.descripcion || ''}` : '—'}</td>
        <td style="font-size:12px">${h ? `#${h.numPartida} ${h.descripcion || ''}` : '—'}</td>
        <td style="text-align:right;font-family:var(--mono)">L. ${cpFmt(monto)}</td>
        <td><button class="btn btn-ghost" onclick="cpDesconciliar('${g}')" style="padding:3px 10px;font-size:11px;border-color:var(--amber);color:var(--amber)">Deshacer</button></td>
      </tr>`
    }).join('')
    if (filas) {
      zonaConc.innerHTML = `
        <div style="font-size:12px;color:var(--text3);letter-spacing:1px;margin:18px 0 8px">YA CONCILIADOS (${Object.keys(grupos).length})</div>
        <div style="max-height:240px;overflow-y:auto">
          <table style="width:100%"><thead><tr><th>Cargo</th><th>Abono</th><th style="text-align:right">Monto</th><th style="width:90px"></th></tr></thead>
          <tbody>${filas}</tbody></table>
        </div>`
      zonaConc.style.display = ''
    } else {
      zonaConc.innerHTML = ''
      zonaConc.style.display = 'none'
    }
  }
}

function cpPintaLado(lado, movs) {
  const opuesto = lado === 'debe' ? cpSel.haber : cpSel.debe
  const movOpuesto = opuesto ? (lado === 'debe' ? cpMovs.haber : cpMovs.debe).find(m => String(m.id) === String(opuesto)) : null
  return movs.map(m => {
    const selected = String(cpSel[lado]) === String(m.id)
    const sugiere = movOpuesto && Math.abs(m.monto - movOpuesto.monto) < 0.01
    const bg = selected ? 'background:rgba(96,165,250,0.18);' : sugiere ? 'background:rgba(245,158,11,0.10);' : ''
    return `<tr style="cursor:pointer;${bg}" onclick="cpSeleccionar('${lado}','${m.id}')">
      <td style="font-family:var(--mono);font-size:11px">${m.fecha}</td>
      <td style="font-family:var(--mono);font-size:11px">#${m.numPartida}</td>
      <td style="font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(m.descripcion || '').replace(/"/g, '&quot;')}">${m.descripcion || '—'}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px">L. ${cpFmt(m.monto)}</td>
    </tr>`
  }).join('') || `<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text3)">Sin movimientos pendientes</td></tr>`
}

window.cpSeleccionar = (lado, id) => {
  cpSel[lado] = String(cpSel[lado]) === String(id) ? null : id
  cpRender()
}

function cpRenderBarraAccion() {
  const barra = document.getElementById('cp-barra-accion')
  if (!barra) return
  const d = cpSel.debe ? cpMovs.debe.find(m => String(m.id) === String(cpSel.debe)) : null
  const h = cpSel.haber ? cpMovs.haber.find(m => String(m.id) === String(cpSel.haber)) : null
  if (!d || !h) {
    barra.innerHTML = '<span style="font-size:12px;color:var(--text3)">Seleccioná un movimiento del DEBE y uno del HABER para conciliarlos manualmente.</span>'
    return
  }
  const cuadra = Math.abs(d.monto - h.monto) < 0.01
  const refOk = cpCoincide(d.descripcion, h.descripcion)
  barra.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <span style="font-size:13px">DEBE #${d.numPartida} <strong>L. ${cpFmt(d.monto)}</strong> ↔ HABER #${h.numPartida} <strong>L. ${cpFmt(h.monto)}</strong></span>
      <span style="font-size:12px;color:${cuadra ? 'var(--green)' : 'var(--red)'}">${cuadra ? '✓ Montos iguales' : '✗ Montos distintos (dif. L. ' + cpFmt(Math.abs(d.monto - h.monto)) + ')'}</span>
      ${refOk ? '<span style="font-size:11px;color:var(--green)">✓ referencia coincide</span>' : '<span style="font-size:11px;color:var(--amber)">⚠ referencias distintas</span>'}
      <button class="btn btn-gold" ${cuadra ? '' : 'disabled style="opacity:0.5;cursor:not-allowed"'} onclick="cpConciliarPar()" style="padding:6px 16px;font-size:13px">Conciliar par</button>
    </div>`
}

window.cpConciliarPar = async () => {
  const d = cpMovs.debe.find(m => String(m.id) === String(cpSel.debe))
  const h = cpMovs.haber.find(m => String(m.id) === String(cpSel.haber))
  if (!d || !h) return
  const ok = await cpGuardarPar(d, h)
  if (ok) { cpSel = { debe: null, haber: null }; cpRender() }
}

window.cpConciliarUno = async (idD, idH) => {
  const d = cpMovs.debe.find(m => String(m.id) === String(idD))
  const h = cpMovs.haber.find(m => String(m.id) === String(idH))
  if (!d || !h) return
  const ok = await cpGuardarPar(d, h)
  if (ok) cpRender()
}

window.cpConciliarTodasSugerencias = async () => {
  const sug = cpCalcularSugerencias()
  if (!sug.length) return
  if (!confirm(`¿Conciliar ${sug.length} par(es) sugerido(s)? Podés deshacer cualquiera después.`)) return
  let ok = 0
  for (const s of sug) {
    const r = await cpGuardarPar(s.d, s.h, true)
    if (r) ok++
  }
  window.toast?.(`${ok} de ${sug.length} pares conciliados`, ok === sug.length ? 'success' : 'info')
  cpRender()
}

// Núcleo: guarda un par (auditoría primero, luego marca las líneas)
async function cpGuardarPar(d, h, silencioso = false) {
  if (Math.abs(d.monto - h.monto) >= 0.01) {
    if (!silencioso) window.toast?.('El par no suma cero — los montos deben ser iguales', 'error')
    return false
  }
  const prof = window._currentProfile ? window._currentProfile() : null
  const grupo = (crypto?.randomUUID && crypto.randomUUID()) || ('g-' + Date.now() + '-' + Math.random())

  const { error: aErr } = await cpSb().from('conciliaciones_puente').insert({
    id: grupo, cuenta_id: cpCuenta.id, cuenta_codigo: cpCuenta.codigo,
    monto: d.monto, linea_debito_id: d.id, linea_credito_id: h.id,
    conciliado_por: prof?.id || null, conciliado_por_nombre: prof?.nombre || null
  })
  if (aErr) { if (!silencioso) window.toast?.('No se pudo guardar: ' + aErr.message, 'error'); return false }

  const { error: lErr } = await cpSb().from('lineas_partida')
    .update({ conciliado_puente: true, grupo_conciliacion: grupo }).in('id', [d.id, h.id])
  if (lErr) {
    await cpSb().from('conciliaciones_puente').delete().eq('id', grupo)
    if (!silencioso) window.toast?.('No se pudieron marcar las líneas: ' + lErr.message, 'error')
    return false
  }

  d.conciliado = true; d.grupo = grupo
  h.conciliado = true; h.grupo = grupo
  if (!silencioso) window.toast?.(`Par conciliado: L. ${cpFmt(d.monto)}`, 'success')
  window.logActividad?.('conciliacion_puente', 'contabilidad', `${cpCuenta.codigo} · L. ${cpFmt(d.monto)} · #${d.numPartida}↔#${h.numPartida}`)
  return true
}

window.cpDesconciliar = async (grupo) => {
  if (!grupo) return
  if (!confirm('¿Deshacer esta conciliación? Las dos líneas volverán a quedar abiertas.')) return
  const { error: lErr } = await cpSb().from('lineas_partida')
    .update({ conciliado_puente: false, grupo_conciliacion: null }).eq('grupo_conciliacion', grupo)
  if (lErr) { window.toast?.('Error: ' + lErr.message, 'error'); return }
  await cpSb().from('conciliaciones_puente').delete().eq('id', grupo)
  ;[...cpMovs.debe, ...cpMovs.haber].forEach(m => { if (m.grupo === grupo) { m.conciliado = false; m.grupo = null } })
  window.toast?.('Conciliación deshecha', 'success')
  cpRender()
}