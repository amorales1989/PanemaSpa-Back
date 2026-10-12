// Tablas con RLS: `db` debe venir de conEmpresa(); el filtro por empresa lo pone Postgres.
const lista = (tabla) => async (db) => {
    const { rows } = await db.query(`select id, nombre, orden, activo from ${tabla} order by orden, nombre`)
    return rows
}

export const canales = lista('canales_venta')
export const metodosPago = lista('metodos_pago')
export const motivosMerma = lista('motivos_merma')

export const categorias = async (db) => {
    const { rows } = await db.query(
        'select id, ambito, nombre, orden, activa as activo, con_items from categorias order by ambito, orden, nombre',
    )
    return rows
}

export const sucursales = async (db) => {
    const { rows } = await db.query('select id, nombre, direccion, activa as activo from sucursales order by nombre')
    return rows
}

export const proveedores = async (db) => {
    const { rows } = await db.query('select id, nombre, rut, telefono, email, activo from proveedores order by nombre')
    return rows
}
