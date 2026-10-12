// Arma "set col1 = $1, col2 = $2" solo con los campos presentes en `cambios`.
// mapa: { campoApi: 'columna_bd' } — lo que no está en el mapa se ignora.
export function armarSet(cambios, mapa, desde = 1) {
    const columnas = []
    const valores = []
    for (const [campo, columna] of Object.entries(mapa)) {
        if (cambios[campo] === undefined) continue
        valores.push(cambios[campo])
        columnas.push(`${columna} = $${desde + valores.length - 1}`)
    }
    return { set: columnas.join(', '), valores }
}

// Cursor opaco para paginar listados ordenados por (fecha desc, clave desc)
export const cursorCodificar = (fecha, clave) => Buffer.from(`${fecha}|${clave}`).toString('base64url')
export function cursorDecodificar(cursor) {
    if (!cursor) return null
    const [fecha, clave] = Buffer.from(cursor, 'base64url').toString().split('|')
    return fecha && clave ? { fecha, clave } : null
}
