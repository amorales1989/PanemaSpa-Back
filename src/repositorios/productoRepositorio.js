import { armarSet } from '../utilidades/sql.js'

// `precio` en la API = precio_venta. El costo solo sale si se pide (permiso productos.ver_costos).
// `receta`: insumos que lleva una unidad (o un kilo) del producto; el precio del insumo solo con costos.
const columnas = (conCosto) => `p.id, p.codigo, p.nombre, p.categoria_id, c.nombre as categoria, p.unidad,
    p.precio_venta as precio, ${conCosto ? 'p.costo,' : ''} p.imagen_url, p.activo, p.created_at, p.updated_at,
    coalesce((select json_agg(json_build_object(
                'insumoId', i.id, 'codigo', i.codigo, 'nombre', i.nombre, 'unidad', i.unidad, 'cantidad', pi.cantidad
                ${conCosto ? ", 'precio', i.precio_ultimo" : ''}) order by i.codigo)
              from producto_insumos pi join insumos i on i.id = pi.insumo_id
              where pi.producto_id = p.id), '[]') as receta`

const CAMPOS = {
    codigo: 'codigo', nombre: 'nombre', categoriaId: 'categoria_id', unidad: 'unidad',
    precio: 'precio_venta', costo: 'costo', activo: 'activo',
}

export const listar = async (db, { conCosto, incluirInactivos }) => {
    const { rows } = await db.query(
        `select ${columnas(conCosto)} from productos p left join categorias c on c.id = p.categoria_id
         where p.deleted_at is null ${incluirInactivos ? '' : 'and p.activo'}
         order by p.codigo`,
    )
    return rows
}

export const buscar = async (db, id, conCosto) => {
    const { rows } = await db.query(
        `select ${columnas(conCosto)} from productos p left join categorias c on c.id = p.categoria_id
         where p.id = $1 and p.deleted_at is null`,
        [id],
    )
    return rows[0] ?? null
}

export const crear = async (db, empresaId, d) => {
    const { rows } = await db.query(
        `insert into productos (empresa_id, codigo, nombre, categoria_id, unidad, precio_venta, costo, activo, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [empresaId, d.codigo, d.nombre, d.categoriaId ?? null, d.unidad, d.precio, d.costo ?? 0, d.activo ?? true, d.creadoPor],
    )
    return rows[0].id
}

export const actualizar = async (db, id, cambios) => {
    const { set, valores } = armarSet(cambios, CAMPOS, 2)
    if (!set) return 1
    const { rowCount } = await db.query(`update productos set ${set} where id = $1 and deleted_at is null`, [id, ...valores])
    return rowCount
}

export const eliminar = async (db, id) => {
    const { rowCount } = await db.query(
        'update productos set deleted_at = now(), activo = false where id = $1 and deleted_at is null', [id])
    return rowCount
}

// Nombres de las promos vigentes (no eliminadas) que incluyen el producto
export const promosQueLoUsan = async (db, id) => {
    const { rows } = await db.query(
        `select pr.nombre from promo_productos pp join promos pr on pr.id = pp.promo_id
         where pp.producto_id = $1 and pr.deleted_at is null order by pr.nombre`,
        [id],
    )
    return rows.map((r) => r.nombre)
}

export const historialPrecios = async (db, id) => {
    const { rows } = await db.query(
        `select h.id, h.precio_anterior, h.precio_nuevo, h.motivo, h.created_at, u.nombre as usuario
         from producto_precios h left join usuarios u on u.id = h.usuario_id
         where h.producto_id = $1 order by h.created_at desc, h.id desc`,
        [id],
    )
    return rows
}

// Aplica varios precios en una sola consulta; el trigger anota el historial de cada uno
export const ajustarPrecios = async (db, cambios) => {
    const { rows } = await db.query(
        `update productos p set precio_venta = c.precio
         from unnest($1::uuid[], $2::numeric[]) as c(id, precio)
         where p.id = c.id and p.deleted_at is null and p.precio_venta <> c.precio
         returning p.id`,
        [cambios.map((c) => c.id), cambios.map((c) => c.precio)],
    )
    return rows.map((r) => r.id)
}

// Reemplaza la receta completa y recalcula el costo si quedó con insumos
export async function reemplazarReceta(db, empresaId, productoId, receta) {
    await db.query('delete from producto_insumos where producto_id = $1', [productoId])
    if (!receta.length) return
    await db.query(
        `insert into producto_insumos (empresa_id, producto_id, insumo_id, cantidad)
         select $1, $2, x.insumo_id, x.cantidad from unnest($3::uuid[], $4::numeric[]) as x(insumo_id, cantidad)`,
        [empresaId, productoId, receta.map((r) => r.insumoId), receta.map((r) => r.cantidad)],
    )
    await db.query('select recalcular_costo_receta($1::uuid[])', [[productoId]])
}

export const ponerImagen = (db, id, url) =>
    db.query('update productos set imagen_url = $2 where id = $1 and deleted_at is null', [id, url])

// Productos activos por id (para armar ventas, promos y mermas)
export const porIds = async (db, ids) => {
    const { rows } = await db.query(
        `select id, codigo, nombre, unidad, precio_venta, costo, activo from productos
         where id = any($1::uuid[]) and deleted_at is null`,
        [ids],
    )
    return new Map(rows.map((r) => [r.id, r]))
}
