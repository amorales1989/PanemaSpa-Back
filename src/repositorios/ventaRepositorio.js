import { listarPaginado } from './movimientoRepositorio.js'

const CABECERA = `
    select v.id, v.numero, v.fecha, v.ocurrido_en, v.total, v.estado,
           v.canal_id, cv.nombre as canal, v.metodo_pago_id, mp.nombre as metodo_pago,
           v.sucursal_id, s.nombre as sucursal, v.usuario_id, u.nombre as usuario,
           v.anulada_en, v.motivo_anulacion`

const JOINS = `
    from ventas v
    join canales_venta cv on cv.id = v.canal_id
    join metodos_pago mp on mp.id = v.metodo_pago_id
    join sucursales s on s.id = v.sucursal_id
    join usuarios u on u.id = v.usuario_id`

// Líneas de la venta; las promos traen sus componentes (productos con precio prorrateado)
const ITEMS = `
    (select coalesce(json_agg(json_build_object(
        'tipo', case when vi.promo_id is null then 'producto' else 'promo' end,
        'id', coalesce(vi.producto_id, vi.promo_id), 'codigo', vi.codigo, 'nombre', vi.nombre,
        'unidad', vi.unidad, 'cantidad', vi.cantidad, 'precio', vi.precio_unitario, 'subtotal', vi.subtotal,
        'componentes', (select json_agg(json_build_object('id', c.producto_id, 'nombre', c.nombre, 'unidad', c.unidad,
                               'cantidad', c.cantidad, 'precio', c.precio_prorrateado))
                        from venta_item_componentes c where c.venta_item_id = vi.id)
     ) order by vi.posicion), '[]') from venta_items vi where vi.venta_id = v.id) as items`

export const idPorClave = async (db, clave) => {
    const { rows } = await db.query('select id from ventas where clave_idempotencia = $1', [clave])
    return rows[0]?.id ?? null
}

// Devuelve null si otra petición con la misma clave ganó la carrera
export async function insertarCabecera(db, v) {
    const { rows } = await db.query(
        `insert into ventas (empresa_id, sucursal_id, numero, fecha, canal_id, metodo_pago_id, total, usuario_id, clave_idempotencia)
         values ($1, $2, siguiente_numero($1, 'venta'), $3, $4, $5, $6, $7, $8)
         on conflict (empresa_id, clave_idempotencia) where clave_idempotencia is not null do nothing
         returning id`,
        [v.empresaId, v.sucursalId, v.fecha, v.canalId, v.metodoPagoId, v.total, v.usuarioId, v.clave ?? null],
    )
    return rows[0]?.id ?? null
}

export async function insertarItems(db, empresaId, ventaId, lineas) {
    for (const [posicion, l] of lineas.entries()) {
        const { rows } = await db.query(
            `insert into venta_items (empresa_id, venta_id, producto_id, promo_id, codigo, nombre, unidad,
                                      cantidad, precio_unitario, costo_unitario, subtotal, posicion)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
            [empresaId, ventaId, l.productoId ?? null, l.promoId ?? null, l.codigo, l.nombre, l.unidad,
                l.cantidad, l.precioUnitario, l.costoUnitario, l.subtotal, posicion],
        )
        for (const c of l.componentes ?? []) {
            await db.query(
                `insert into venta_item_componentes (empresa_id, venta_item_id, producto_id, nombre, unidad,
                                                     cantidad, precio_prorrateado, costo_unitario)
                 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [empresaId, rows[0].id, c.productoId, c.nombre, c.unidad, c.cantidad, c.precioProrrateado, c.costoUnitario],
            )
        }
    }
}

export const buscar = async (db, id) => {
    const { rows } = await db.query(`${CABECERA}, ${ITEMS} ${JOINS} where v.id = $1`, [id])
    return rows[0] ?? null
}

export const listar = (db, f) =>
    listarPaginado(db, {
        select: `${CABECERA}, ${ITEMS} ${JOINS}`,
        alias: 'v',
        filtros: f,
        estados: ['confirmada', 'anulada'],
        extra: [['v.usuario_id = ?', f.usuarioId], ['v.canal_id = ?', f.canalId]],
    })

export const anular = async (db, id, usuarioId, motivo) => {
    const { rowCount } = await db.query(
        `update ventas set estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3
         where id = $1 and estado = 'confirmada'`,
        [id, usuarioId, motivo],
    )
    return rowCount
}

export const existe = async (db, id) => (await db.query('select 1 from ventas where id = $1', [id])).rowCount > 0
