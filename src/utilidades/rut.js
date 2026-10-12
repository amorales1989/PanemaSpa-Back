// RUT chileno: "76.123.456-7" · "761234567" → "76.123.456-7" si el dígito verificador es correcto
export function normalizarRut(valor) {
    const limpio = String(valor ?? '').replace(/[.\s-]/g, '').toUpperCase()
    const m = /^(\d{1,8})([\dK])$/.exec(limpio)
    if (!m) return null
    const [, cuerpo, dv] = m
    let suma = 0
    let factor = 2
    for (let i = cuerpo.length - 1; i >= 0; i--) {
        suma += Number(cuerpo[i]) * factor
        factor = factor === 7 ? 2 : factor + 1
    }
    const esperado = 11 - (suma % 11)
    const dvCorrecto = esperado === 11 ? '0' : esperado === 10 ? 'K' : String(esperado)
    if (dv !== dvCorrecto) return null
    return `${Number(cuerpo).toLocaleString('es-CL')}-${dv}`
}
