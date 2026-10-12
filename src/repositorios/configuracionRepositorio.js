// Tablas con RLS: `db` debe venir de conEmpresa(); el filtro por empresa lo pone Postgres.
import { armarSet } from '../utilidades/sql.js'

// Cada lista configurable: tabla, columnas que devuelve y campos editables (api → columna)
export const LISTAS = {
    canales: {
        tabla: 'canales_venta',
        columnas: 'id, nombre, orden, activo',
        campos: { nombre: 'nombre', orden: 'orden', activo: 'activo' },
        orden: 'orden, nombre',
    },
    'metodos-pago': {
        tabla: 'metodos_pago',
        columnas: 'id, nombre, orden, activo',
        campos: { nombre: 'nombre', orden: 'orden', activo: 'activo' },
        orden: 'orden, nombre',
    },
    'motivos-merma': {
        tabla: 'motivos_merma',
        columnas: 'id, nombre, orden, activo',
        campos: { nombre: 'nombre', orden: 'orden', activo: 'activo' },
        orden: 'orden, nombre',
    },
    categorias: {
        tabla: 'categorias',
        columnas: 'id, ambito, nombre, orden, activa as activo, con_items',
        campos: { ambito: 'ambito', nombre: 'nombre', orden: 'orden', activo: 'activa', conItems: 'con_items' },
        orden: 'ambito, orden, nombre',
    },
    proveedores: {
        tabla: 'proveedores',
        columnas: 'id, nombre, rut, telefono, email, activo',
        campos: { nombre: 'nombre', rut: 'rut', telefono: 'telefono', email: 'email', activo: 'activo' },
        orden: 'nombre',
    },
    sucursales: {
        tabla: 'sucursales',
        columnas: 'id, nombre, direccion, activa as activo',
        campos: { nombre: 'nombre', direccion: 'direccion', activo: 'activa' },
        orden: 'nombre',
    },
}

export const listar = async (db, lista) => {
    const { tabla, columnas, orden } = LISTAS[lista]
    const { rows } = await db.query(`select ${columnas} from ${tabla} order by ${orden}`)
    return rows
}

export const crear = async (db, lista, empresaId, entrada) => {
    const { tabla, columnas, campos } = LISTAS[lista]
    // Lo nuevo va al final de la lista (dentro de su ámbito, en categorías)
    const datos = { ...entrada }
    if (campos.orden && datos.orden === undefined) {
        const filtro = lista === 'categorias' ? 'where ambito = $1' : ''
        const { rows } = await db.query(`select coalesce(max(orden) + 1, 0) as orden from ${tabla} ${filtro}`, lista === 'categorias' ? [datos.ambito] : [])
        datos.orden = rows[0].orden
    }
    const presentes = Object.keys(campos).filter((c) => datos[c] !== undefined)
    const nombres = presentes.map((c) => campos[c])
    const marcadores = presentes.map((_, i) => `$${i + 2}`)
    const { rows } = await db.query(
        `insert into ${tabla} (empresa_id, ${nombres.join(', ')}) values ($1, ${marcadores.join(', ')}) returning ${columnas}`,
        [empresaId, ...presentes.map((c) => datos[c])],
    )
    return rows[0]
}

export const actualizar = async (db, lista, id, cambios) => {
    const { tabla, columnas, campos } = LISTAS[lista]
    const { set, valores } = armarSet(cambios, campos, 2)
    if (!set) return buscar(db, lista, id)
    const { rows } = await db.query(`update ${tabla} set ${set} where id = $1 returning ${columnas}`, [id, ...valores])
    return rows[0] ?? null
}

export const buscar = async (db, lista, id) => {
    const { tabla, columnas } = LISTAS[lista]
    const { rows } = await db.query(`select ${columnas} from ${tabla} where id = $1`, [id])
    return rows[0] ?? null
}

// Proveedor por nombre (sin distinguir mayúsculas); si no existe se crea.
// Las compras lo mandan como texto libre, igual que hoy en el front.
export async function proveedorPorNombre(db, empresaId, nombre) {
    const { rows } = await db.query(
        `with existente as (select id from proveedores where lower(nombre) = lower($2) limit 1),
              nuevo as (
                insert into proveedores (empresa_id, nombre)
                select $1, $2 where not exists (select 1 from existente)
                on conflict (empresa_id, nombre) do update set nombre = excluded.nombre
                returning id)
         select id from existente union all select id from nuevo`,
        [empresaId, nombre],
    )
    return rows[0].id
}
