import { armarSet } from '../utilidades/sql.js'

// `precio` en la API = precio_ultimo (último precio de compra; lo actualiza cada compra)
const COLUMNAS = `i.id, i.codigo, i.nombre, i.categoria_id, c.nombre as categoria, i.unidad,
    i.precio_ultimo as precio, i.precio_actualizado_en, i.activo, i.created_at, i.updated_at,
    i.stock, i.stock_minimo`

const CAMPOS = {
    codigo: 'codigo', nombre: 'nombre', categoriaId: 'categoria_id', unidad: 'unidad',
    precio: 'precio_ultimo', activo: 'activo', stockMinimo: 'stock_minimo',
}

export const listar = async (db, { incluirInactivos }) => {
    const { rows } = await db.query(
        `select ${COLUMNAS} from insumos i left join categorias c on c.id = i.categoria_id
         where i.deleted_at is null ${incluirInactivos ? '' : 'and i.activo'}
         order by i.codigo`,
    )
    return rows
}

export const buscar = async (db, id) => {
    const { rows } = await db.query(
        `select ${COLUMNAS} from insumos i left join categorias c on c.id = i.categoria_id
         where i.id = $1 and i.deleted_at is null`,
        [id],
    )
    return rows[0] ?? null
}

export const crear = async (db, empresaId, d) => {
    const { rows } = await db.query(
        `insert into insumos (empresa_id, codigo, nombre, categoria_id, unidad, precio_ultimo, activo, stock_minimo)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [empresaId, d.codigo, d.nombre, d.categoriaId ?? null, d.unidad, d.precio ?? 0, d.activo ?? true, d.stockMinimo ?? null],
    )
    return rows[0].id
}

export const actualizar = async (db, id, cambios) => {
    const { set, valores } = armarSet(cambios, CAMPOS, 2)
    if (!set) return 1
    const { rowCount } = await db.query(`update insumos set ${set} where id = $1 and deleted_at is null`, [id, ...valores])
    return rowCount
}

export const eliminar = async (db, id) => {
    const { rowCount } = await db.query(
        'update insumos set deleted_at = now(), activo = false where id = $1 and deleted_at is null', [id])
    return rowCount
}

// Compras del insumo (evolución de precio en la ficha)
export const compras = async (db, id, limite = 100) => {
    const { rows } = await db.query(
        `select e.id as egreso_id, e.fecha, pr.nombre as proveedor, ei.cantidad, ei.precio_unitario as precio, ei.subtotal
         from egreso_items ei
         join egresos e on e.id = ei.egreso_id and e.estado = 'confirmado'
         left join proveedores pr on pr.id = e.proveedor_id
         where ei.insumo_id = $1
         order by e.fecha desc, e.created_at desc limit $2`,
        [id, limite],
    )
    return rows
}

export const porIds = async (db, ids) => {
    const { rows } = await db.query(
        `select id, codigo, nombre, unidad, precio_ultimo, activo from insumos
         where id = any($1::uuid[]) and deleted_at is null`,
        [ids],
    )
    return new Map(rows.map((r) => [r.id, r]))
}

// Nombres de los productos vigentes que llevan el insumo en su receta
export const productosQueLoUsan = async (db, id) => {
    const { rows } = await db.query(
        `select p.nombre from producto_insumos pi join productos p on p.id = pi.producto_id
         where pi.insumo_id = $1 and p.deleted_at is null order by p.nombre`,
        [id],
    )
    return rows.map((r) => r.nombre)
}
