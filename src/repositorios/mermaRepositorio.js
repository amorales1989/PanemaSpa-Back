import { listarPaginado } from './movimientoRepositorio.js'

const SELECT = `
    select m.id, m.numero, m.fecha, m.total, m.estado, m.observacion,
           m.motivo_id, mo.nombre as motivo, m.sucursal_id, s.nombre as sucursal,
           m.usuario_id, u.nombre as usuario, m.anulada_en, m.motivo_anulacion, m.created_at,
           (select coalesce(json_agg(json_build_object(
               'tipo', case when mi.producto_id is null then 'insumo' else 'producto' end,
               'id', coalesce(mi.producto_id, mi.insumo_id), 'codigo', mi.codigo, 'nombre', mi.nombre, 'unidad', mi.unidad,
               'cantidad', mi.cantidad, 'precio', mi.costo_unitario, 'subtotal', mi.subtotal) order by mi.posicion), '[]')
            from merma_items mi where mi.merma_id = m.id) as items
    from mermas m
    join motivos_merma mo on mo.id = m.motivo_id
    join sucursales s on s.id = m.sucursal_id
    join usuarios u on u.id = m.usuario_id`

export const idPorClave = async (db, clave) =>
    (await db.query('select id from mermas where clave_idempotencia = $1', [clave])).rows[0]?.id ?? null

export async function insertarCabecera(db, m) {
    const { rows } = await db.query(
        `insert into mermas (empresa_id, sucursal_id, numero, fecha, motivo_id, observacion, total, usuario_id, clave_idempotencia)
         values ($1, $2, siguiente_numero($1, 'merma'), $3, $4, $5, $6, $7, $8)
         on conflict (empresa_id, clave_idempotencia) where clave_idempotencia is not null do nothing
         returning id`,
        [m.empresaId, m.sucursalId, m.fecha, m.motivoId, m.observacion ?? null, m.total, m.usuarioId, m.clave ?? null],
    )
    return rows[0]?.id ?? null
}

export const insertarItems = (db, empresaId, mermaId, lineas) =>
    db.query(
        `insert into merma_items (empresa_id, merma_id, producto_id, insumo_id, codigo, nombre, unidad, cantidad, costo_unitario, subtotal, posicion)
         select $1, $2, x.producto_id, x.insumo_id, x.codigo, x.nombre, x.unidad, x.cantidad, x.costo, x.subtotal, x.posicion
         from unnest($3::uuid[], $4::uuid[], $5::int[], $6::text[], $7::text[], $8::numeric[], $9::numeric[], $10::numeric[], $11::smallint[])
              as x(producto_id, insumo_id, codigo, nombre, unidad, cantidad, costo, subtotal, posicion)`,
        [empresaId, mermaId, ...['productoId', 'insumoId', 'codigo', 'nombre', 'unidad', 'cantidad', 'costoUnitario', 'subtotal']
            .map((k) => lineas.map((l) => l[k] ?? null)), lineas.map((_, i) => i)],
    )

export const buscar = async (db, id) => (await db.query(`${SELECT} where m.id = $1`, [id])).rows[0] ?? null

export const listar = (db, f) =>
    listarPaginado(db, {
        select: SELECT,
        alias: 'm',
        filtros: f,
        estados: ['confirmada', 'anulada'],
        extra: [['m.motivo_id = ?', f.motivoId]],
    })

export const anular = async (db, id, usuarioId, motivo) =>
    (await db.query(
        `update mermas set estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3
         where id = $1 and estado = 'confirmada'`,
        [id, usuarioId, motivo],
    )).rowCount

export const existe = async (db, id) => (await db.query('select 1 from mermas where id = $1', [id])).rowCount > 0
