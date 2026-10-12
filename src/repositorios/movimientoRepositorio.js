// Listado paginado común a ventas, egresos y mermas: orden (fecha, numero) descendente
// con cursor opaco. Devuelve { datos, siguiente } (siguiente = cursor o null).
import { cursorCodificar, cursorDecodificar } from '../utilidades/sql.js'

export async function listarPaginado(db, { select, alias: a, filtros: f, estados: [confirmado, anulado], extra = [] }) {
    const condiciones = []
    const valores = []
    const agregar = (sql, valor) => {
        valores.push(valor)
        condiciones.push(sql.replaceAll('?', `$${valores.length}`))
    }
    if (f.desde) agregar(`${a}.fecha >= ?`, f.desde)
    if (f.hasta) agregar(`${a}.fecha <= ?`, f.hasta)
    if (f.estado !== 'todos') agregar(`${a}.estado = ?`, f.estado?.startsWith('anulad') ? anulado : confirmado)
    for (const [sql, valor] of extra) if (valor !== undefined && valor !== null) agregar(sql, valor)

    const cursor = cursorDecodificar(f.cursor)
    if (cursor) {
        valores.push(cursor.fecha, cursor.clave)
        condiciones.push(`(${a}.fecha, ${a}.numero) < ($${valores.length - 1}::date, $${valores.length}::bigint)`)
    }
    valores.push(f.limite + 1)
    const { rows } = await db.query(
        `${select} ${condiciones.length ? `where ${condiciones.join(' and ')}` : ''}
         order by ${a}.fecha desc, ${a}.numero desc limit $${valores.length}`,
        valores,
    )
    const hayMas = rows.length > f.limite
    const datos = hayMas ? rows.slice(0, f.limite) : rows
    const ultimo = datos.at(-1)
    return { datos, siguiente: hayMas ? cursorCodificar(ultimo.fecha, ultimo.numero) : null }
}
