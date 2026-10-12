// Redondeo a los decimales de la moneda de la empresa (CLP = 0)
export function redondear(monto, decimales = 0) {
    const f = 10 ** decimales
    return Math.round((monto + Number.EPSILON) * f) / f
}
