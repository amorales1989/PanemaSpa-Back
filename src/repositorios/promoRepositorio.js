import { armarSet } from '../utilidades/sql.js'

const CAMPOS = {
    codigo: 'codigo', nombre: 'nombre', precio: 'precio', activa: 'activa',
    vigenteDesde: 'vigente_desde', vigenteHasta: 'vigente_hasta',
}

// Promo con sus productos y el precio normal (suma a precio de lista) para mostrar el descuento
const SELECT = `
    select pr.id, pr.codigo, pr.nombre, pr.precio, pr.activa, pr.vigente_desde, pr.vigente_hasta,
           coalesce(sum(pp.cantidad * p.precio_venta), 0) as precio_normal,
           coalesce(json_agg(json_build_object(
               'productoId', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'unidad', p.unidad,
               'cantidad', pp.cantidad, 'precio', p.precio_venta) order by p.codigo)
             filter (where p.id is not null), '[]') as productos
    from promos pr
    left join promo_productos pp on pp.promo_id = pr.id
    left join productos p on p.id = pp.producto_id
    where pr.deleted_at is null`

export const listar = async (db, { incluirInactivos }) => {
    const { rows } = await db.query(`${SELECT} ${incluirInactivos ? '' : 'and pr.activa'} group by pr.id order by pr.codigo`)
    return rows
}

export const buscar = async (db, id) => {
    const { rows } = await db.query(`${SELECT} and pr.id = $1 group by pr.id`, [id])
    return rows[0] ?? null
}

export const crear = async (db, empresaId, d) => {
    const { rows } = await db.query(
        `insert into promos (empresa_id, codigo, nombre, precio, activa, vigente_desde, vigente_hasta)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [empresaId, d.codigo, d.nombre, d.precio, d.activa ?? true, d.vigenteDesde ?? null, d.vigenteHasta ?? null],
    )
    return rows[0].id
}

export const actualizar = async (db, id, cambios) => {
    const { set, valores } = armarSet(cambios, CAMPOS, 2)
    if (!set) return 1
    const { rowCount } = await db.query(`update promos set ${set} where id = $1 and deleted_at is null`, [id, ...valores])
    return rowCount
}

export async function reemplazarProductos(db, empresaId, promoId, productos) {
    await db.query('delete from promo_productos where promo_id = $1', [promoId])
    await db.query(
        `insert into promo_productos (empresa_id, promo_id, producto_id, cantidad)
         select $1, $2, x.producto_id, x.cantidad from unnest($3::uuid[], $4::numeric[]) as x(producto_id, cantidad)`,
        [empresaId, promoId, productos.map((p) => p.productoId), productos.map((p) => p.cantidad)],
    )
}

export const eliminar = async (db, id) => {
    const { rowCount } = await db.query(
        'update promos set deleted_at = now(), activa = false where id = $1 and deleted_at is null', [id])
    return rowCount
}

// Promos vendibles hoy, con los productos que la componen (para armar ventas)
export const vendiblesPorIds = async (db, ids, hoy) => {
    const { rows } = await db.query(
        `select pr.id, pr.codigo, pr.nombre, pr.precio,
                json_agg(json_build_object('id', p.id, 'nombre', p.nombre, 'unidad', p.unidad,
                         'cantidad', pp.cantidad, 'precio', p.precio_venta, 'costo', p.costo)) as componentes
         from promos pr
         join promo_productos pp on pp.promo_id = pr.id
         join productos p on p.id = pp.producto_id
         where pr.id = any($1::uuid[]) and pr.deleted_at is null and pr.activa
           and (pr.vigente_desde is null or pr.vigente_desde <= $2)
           and (pr.vigente_hasta is null or pr.vigente_hasta >= $2)
         group by pr.id`,
        [ids, hoy],
    )
    return new Map(rows.map((r) => [r.id, r]))
}
