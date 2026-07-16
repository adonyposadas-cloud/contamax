/* ============================================================================
 * CONTAMAX · corrector.js   ·   build 20260715a
 *
 * Corrector ortográfico LOCAL para lo que escriben los técnicos (notas, nombres).
 * Sin IA, sin API, sin costo: un diccionario de errores comunes del español de taller
 * + reglas de acentos frecuentes. Corrige al vuelo lo que más se repite.
 *
 * Uso:
 *   window.Corrector.corregir("sella fuga de haceite en la parte de avajo")
 *     → "Sellar fuga de aceite en la parte de abajo"
 *   window.Corrector.enganchar(inputElement)   // corrige al salir del campo (blur)
 * ========================================================================== */
window.Corrector = (function () {

  // ── Diccionario de reemplazos exactos (palabra mal → palabra bien) ──
  // Todo en minúscula; el matcher respeta may/min de la palabra original.
  const DICC = {
    // errores de H
    'haceite': 'aceite', 'aseite': 'aceite', 'asaite': 'aceite',
    'hacer': 'hacer',                 // (correcta, ejemplo de no tocar)
    'aogado': 'ahogado', 'aogo': 'ahogo',
    'echo': 'hecho', 'echa': 'hecha', 'echos': 'hechos',
    // b / v
    'avajo': 'abajo', 'arriva': 'arriba', 'vujes': 'bujes', 'buje': 'buje',
    'valero': 'balero', 'valeros': 'baleros', 'vanda': 'banda', 'vandas': 'bandas',
    'combustion': 'combustión', 'valvula': 'válvula', 'valvulas': 'válvulas',
    'vateria': 'batería', 'bateria': 'batería',
    // s / c / z
    'frenoz': 'frenos', 'disco': 'disco', 'diskos': 'discos', 'disko': 'disco',
    'presion': 'presión', 'presiona': 'presiona',
    'suspencion': 'suspensión', 'suspension': 'suspensión',
    'amortiguodor': 'amortiguador', 'amortigador': 'amortiguador',
    'rotula': 'rótula', 'rotulas': 'rótulas',
    'retenedor': 'retenedor', 'rretenedor': 'retenedor',
    // errores de repetición de letras (se manejan también por regla abajo)
    'selllar': 'sellar', 'sellllar': 'sellar', 'selar': 'sellar',
    'fuja': 'fuga', 'fujas': 'fugas',
    // acentos que faltan comunes
    'motor': 'motor', 'direccion': 'dirección', 'transmision': 'transmisión',
    'refrigeracion': 'refrigeración', 'inyeccion': 'inyección',
    'alineacion': 'alineación', 'rotacion': 'rotación', 'reparacion': 'reparación',
    'revision': 'revisión', 'medicion': 'medición', 'condicion': 'condición',
    'esta': 'está', 'mira': 'mira', 'vencido': 'vencido', 'vencida': 'vencida',
    'malo': 'malo', 'mala': 'mala', 'roto': 'roto', 'rota': 'rota',
    // muletillas mal escritas
    'ai': 'ahí', 'ay': 'hay', 'aya': 'haya', 'valla': 'vaya',
    'porke': 'porque', 'ke': 'que', 'ke': 'que', 'k': 'que',
    'tanbien': 'también', 'tambien': 'también', 'asta': 'hasta',
    'nesesita': 'necesita', 'necesita': 'necesita', 'nesecita': 'necesita',
    'cambien': 'cambien', 'cambiar': 'cambiar', 'cambeo': 'cambio', 'canvio': 'cambio',
    'ruido': 'ruido', 'rruido': 'ruido', 'sonido': 'sonido'
  }

  // ── Reglas: cosas que se arreglan por patrón, no palabra por palabra ──
  function aplicarReglas (palabra) {
    let w = palabra
    // Triple letra o más → doble (selllar → sellar, rruido → ruido)
    w = w.replace(/([a-záéíóúñ])\1{2,}/gi, '$1$1')
    return w
  }

  // Respeta la capitalización de la palabra original
  function respetarCaso (original, corregida) {
    if (original === original.toUpperCase() && original.length > 1) return corregida.toUpperCase()
    if (original[0] === original[0].toUpperCase()) return corregida.charAt(0).toUpperCase() + corregida.slice(1)
    return corregida
  }

  function corregirPalabra (palabra) {
    const bajo = palabra.toLowerCase()
    // 1. Diccionario exacto
    if (DICC[bajo]) return respetarCaso(palabra, DICC[bajo])
    // 2. Reglas de patrón (repeticiones)
    const porRegla = aplicarReglas(bajo)
    if (porRegla !== bajo && DICC[porRegla]) return respetarCaso(palabra, DICC[porRegla])
    if (porRegla !== bajo) return respetarCaso(palabra, porRegla)
    return palabra
  }

  // Corrige un texto completo: palabra por palabra, respeta puntuación y espacios
  function corregir (texto) {
    if (!texto) return texto
    let out = texto.replace(/[A-Za-zÁÉÍÓÚáéíóúÑñ]+/g, (m) => corregirPalabra(m))
    // Primera letra de la frase en mayúscula
    out = out.replace(/(^\s*|[.!?]\s+)([a-záéíóúñ])/g, (m, p1, p2) => p1 + p2.toUpperCase())
    // Espacios dobles
    out = out.replace(/\s{2,}/g, ' ').trim()
    return out
  }

  // Engancha un input/textarea: corrige al salir del campo (blur), sin molestar al escribir.
  // También activa la autocorrección nativa del teléfono.
  function enganchar (el) {
    if (!el || el._correctorEnganchado) return
    el._correctorEnganchado = true
    el.setAttribute('autocorrect', 'on')
    el.setAttribute('autocapitalize', 'sentences')
    el.setAttribute('spellcheck', 'true')
    el.addEventListener('blur', () => {
      const antes = el.value
      const despues = corregir(antes)
      if (antes !== despues) {
        el.value = despues
        // disparar 'input' para que el resto del código note el cambio
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
  }

  // Engancha todos los campos con data-corregir en el documento
  function engancharTodos (root) {
    (root || document).querySelectorAll('[data-corregir], textarea, input[type="text"]').forEach(enganchar)
  }

  return { corregir, enganchar, engancharTodos, DICC }
})()