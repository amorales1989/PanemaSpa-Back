// Control de stock: movimientos (ventas, compras, mermas, ajustes) y lo que hay que reponer.
// Las funciones stock_registrar / stock_revertir y el trigger que mantiene `stock` están en la migración 016.

export const controlActivo = async (db, empresaId) =>
    (await db.query('select control_stock from empresas where id = $1', [empresaId])).rows[0]?.control_stock ?? false

// origen: 'venta' | 'compra' | 'merma'. No hace nada si la empresa no lleva stock.
export const registrar = (db, origen, id) => db.query('select stock_registrar($1, $2)', [origen, id])

// Devuelve lo que movió un registro que se anula
export const revertir = (db, id) => db.query('select stock_revertir($1)', [id])

export async function insertarAjuste(db, empresaId, { productoId, insumoId, cantidad, origen, motivo, usuarioId }) {
    await db.query(
        `insert into stock_movimientos (empresa_id, producto_id, insumo_id, cantidad, origen, motivo, usuario_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [empresaId, productoId ?? null, insumoId ?? null, cantidad, origen, motivo ?? null, usuarioId],
    )
}

// Stock actual de los ítems a ajustar (bloqueados hasta terminar la transacción)
export async function stockActual(db, tabla, ids) {
    const { rows } = await db.query(
        `select t.id, t.nombre, t.stock, t.activo,
                ${tabla === 'productos' ? 'exists (select 1 from producto_insumos pi where pi.producto_id = t.id)' : 'false'} as con_receta
         from ${tabla} t where t.id = any($1::uuid[]) and t.deleted_at is null for update`,
        [ids],
    )
    return new Map(rows.map((r) => [r.id, r]))
}

// Costo nuevo de lo que ingresa: en productos (sin receta) el costo; en insumos el último precio de compra
export const ponerCostoProducto = (db, id, costo) =>
    db.query('update productos set costo = $2 where id = $1 and deleted_at is null', [id, costo])

export const ponerPrecioInsumo = (db, id, precio) =>
    db.query(
        `update insumos set precio_ultimo = $2, precio_actualizado_en = (now() at time zone e.zona_horaria)::date
         from empresas e where insumos.id = $1 and insumos.deleted_at is null and e.id = insumos.empresa_id`,
        [id, precio],
    )

// El trigger anota el cambio en el historial de precios con el motivo de la transacción
export const ponerPrecioVenta = (db, id, precio) =>
    db.query('update productos set precio_venta = $2 where id = $1 and deleted_at is null', [id, precio])

export const movimientos = async (db, { productoId, insumoId, limite = 50 }) => {
    const { rows } = await db.query(
        `select m.id, m.cantidad, m.origen, m.referencia_id, m.anulacion, m.motivo, m.created_at, u.nombre as usuario
         from stock_movimientos m left join usuarios u on u.id = m.usuario_id
         where ${productoId ? 'm.producto_id' : 'm.insumo_id'} = $1
         order by m.created_at desc, m.id desc limit $2`,
        [productoId ?? insumoId, limite],
    )
    return rows
}
