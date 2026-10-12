import { listarPaginado } from './movimientoRepositorio.js'

const SELECT = `
    select e.id, e.numero, e.fecha, e.total, e.estado, e.descripcion,
           e.categoria_id, c.nombre as categoria, e.proveedor_id, pr.nombre as proveedor,
           e.metodo_pago_id, mp.nombre as metodo_pago, e.sucursal_id, s.nombre as sucursal,
           e.usuario_id, u.nombre as usuario, e.anulado_en, e.motivo_anulacion, e.created_at,
           (select coalesce(json_agg(json_build_object(
               'tipo', 'insumo', 'id', ei.insumo_id, 'codigo', ei.codigo, 'nombre', ei.nombre, 'unidad', ei.unidad,
               'cantidad', ei.cantidad, 'precio', ei.precio_unitario, 'subtotal', ei.subtotal) order by ei.posicion), '[]')
            from egreso_items ei where ei.egreso_id = e.id) as items
    from egresos e
    join categorias c on c.id = e.categoria_id
    left join proveedores pr on pr.id = e.proveedor_id
    join metodos_pago mp on mp.id = e.metodo_pago_id
    join sucursales s on s.id = e.sucursal_id
    join usuarios u on u.id = e.usuario_id`

export const idPorClave = async (db, clave) =>
    (await db.query('select id from egresos where clave_idempotencia = $1', [clave])).rows[0]?.id ?? null

export async function insertarCabecera(db, e) {
    const { rows } = await db.query(
        `insert into egresos (empresa_id, sucursal_id, numero, fecha, categoria_id, proveedor_id, metodo_pago_id,
                              descripcion, total, usuario_id, clave_idempotencia)
         values ($1, $2, siguiente_numero($1, 'egreso'), $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (empresa_id, clave_idempotencia) where clave_idempotencia is not null do nothing
         returning id`,
        [e.empresaId, e.sucursalId, e.fecha, e.categoriaId, e.proveedorId, e.metodoPagoId,
            e.descripcion, e.total, e.usuarioId, e.clave ?? null],
    )
    return rows[0]?.id ?? null
}

// El trigger de egreso_items actualiza el precio de cada insumo comprado
export const insertarItems = (db, empresaId, egresoId, lineas) =>
    db.query(
        `insert into egreso_items (empresa_id, egreso_id, insumo_id, codigo, nombre, unidad, cantidad, precio_unitario, subtotal, posicion)
         select $1, $2, x.insumo_id, x.codigo, x.nombre, x.unidad, x.cantidad, x.precio, x.subtotal, x.posicion
         from unnest($3::uuid[], $4::int[], $5::text[], $6::text[], $7::numeric[], $8::numeric[], $9::numeric[], $10::smallint[])
              as x(insumo_id, codigo, nombre, unidad, cantidad, precio, subtotal, posicion)`,
        [empresaId, egresoId, ...['insumoId', 'codigo', 'nombre', 'unidad', 'cantidad', 'precioUnitario', 'subtotal']
            .map((k) => lineas.map((l) => l[k])), lineas.map((_, i) => i)],
    )

export const buscar = async (db, id) => (await db.query(`${SELECT} where e.id = $1`, [id])).rows[0] ?? null

export const listar = (db, f) =>
    listarPaginado(db, {
        select: SELECT,
        alias: 'e',
        filtros: f,
        estados: ['confirmado', 'anulado'],
        extra: [['e.categoria_id = ?', f.categoriaId], ['e.proveedor_id = ?', f.proveedorId]],
    })

export const categoria = async (db, id) =>
    (await db.query("select id, nombre, activa, con_items from categorias where id = $1 and ambito = 'egreso'", [id])).rows[0] ?? null

export const anular = async (db, id, usuarioId, motivo) =>
    (await db.query(
        `update egresos set estado = 'anulado', anulado_en = now(), anulado_por = $2, motivo_anulacion = $3
         where id = $1 and estado = 'confirmado'`,
        [id, usuarioId, motivo],
    )).rowCount

export const existe = async (db, id) => (await db.query('select 1 from egresos where id = $1', [id])).rowCount > 0
