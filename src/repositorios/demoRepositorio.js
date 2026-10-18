// Empresas demo (panel de plataforma). Usa poolAdmin (dueño de las tablas):
// puede borrar movimientos, cosa que la API normal nunca hace.
// Solo se llama desde rutas protegidas por el middleware superadmin, y todo
// lo que borra o regenera exige empresas.es_demo.
import { poolAdmin } from '../config/db.js'

export async function transaccion(fn) {
    const cliente = await poolAdmin.connect()
    try {
        await cliente.query('begin')
        const resultado = await fn(cliente)
        await cliente.query('commit')
        return resultado
    } catch (error) {
        await cliente.query('rollback')
        throw error
    } finally {
        cliente.release()
    }
}

// Bloquea la empresa mientras se regenera (dos regeneraciones a la vez chocarían en los números)
export const buscarDemo = async (db, id) =>
    (await db.query(
        `select id, nombre, decimales, zona_horaria,
                (now() at time zone zona_horaria)::date as hoy,
                extract(hour from now() at time zone zona_horaria) * 60
                  + extract(minute from now() at time zone zona_horaria) as minuto_actual
         from empresas where id = $1 and es_demo and deleted_at is null for update`,
        [id],
    )).rows[0] ?? null

export const fijarEmpresa = (db, empresaId, usuarioId) =>
    db.query("select set_config('app.empresa_id', $1, true), set_config('app.usuario_id', $2, true)", [empresaId, usuarioId])

// Lo que el generador necesita para inventar movimientos coherentes con la configuración
export async function contexto(db, empresaId) {
    // En serie: un mismo cliente de pg no admite consultas en paralelo
    const consultas = [
        'select id from sucursales where empresa_id = $1 and activa and deleted_at is null order by created_at',
        'select id, nombre from canales_venta where empresa_id = $1 and activo and deleted_at is null order by orden, nombre',
        'select id, nombre, descuento_pct from metodos_pago where empresa_id = $1 and activo and deleted_at is null order by orden, nombre',
        'select id, nombre from motivos_merma where empresa_id = $1 and activo and deleted_at is null order by orden, nombre',
        `select id, nombre, con_items from categorias
           where empresa_id = $1 and ambito = 'egreso' and activa and deleted_at is null order by orden, nombre`,
        'select id from proveedores where empresa_id = $1 and activo and deleted_at is null order by nombre',
        `select id, codigo, nombre, unidad, precio_venta, costo from productos
           where empresa_id = $1 and activo and deleted_at is null and precio_venta > 0 order by codigo`,
        `select id, codigo, nombre, unidad, precio_ultimo from insumos
           where empresa_id = $1 and activo and deleted_at is null and precio_ultimo > 0 order by codigo`,
        `select pr.id, pr.codigo, pr.nombre, pr.precio,
                  json_agg(json_build_object('id', p.id, 'nombre', p.nombre, 'unidad', p.unidad, 'cantidad', pp.cantidad,
                                             'precio', p.precio_venta, 'costo', p.costo)) as componentes
           from promos pr
           join promo_productos pp on pp.promo_id = pr.id
           join productos p on p.id = pp.producto_id and p.activo and p.deleted_at is null
           where pr.empresa_id = $1 and pr.activa and pr.deleted_at is null and pr.precio > 0
           group by pr.id order by pr.codigo`,
    ]
    const r = []
    for (const sql of consultas) r.push((await db.query(sql, [empresaId])).rows)
    const [sucursales, canales, metodos, motivos, categorias, proveedores, productos, insumos, promos] = r
    return { sucursales, canales, metodos, motivos, categorias, proveedores, productos, insumos, promos }
}

// Los ítems y componentes se borran en cascada con su cabecera.
// La condición es_demo va en el mismo SQL: aunque alguien la llame mal, nunca toca una empresa real.
const SOLO_DEMO = 'exists (select 1 from empresas e where e.id = $1 and e.es_demo)'
export async function borrarMovimientos(db, empresaId) {
    for (const tabla of ['ventas', 'egresos', 'mermas']) {
        await db.query(`delete from ${tabla} where empresa_id = $1 and ${SOLO_DEMO}`, [empresaId])
    }
    await db.query(`delete from contadores where empresa_id = $1 and clave in ('venta', 'egreso', 'merma') and ${SOLO_DEMO}`, [empresaId])
}

export const fijarContador = (db, empresaId, clave, valor) =>
    db.query('insert into contadores (empresa_id, clave, valor) values ($1, $2, $3)', [empresaId, clave, valor])

// Inserta muchas filas de una vez: columnas = [['nombre', 'tipo pg'], ...].
// `constantes` son ids (uuid) iguales en todas las filas: empresa, sucursal, usuario.
async function insertarMasivo(db, tabla, columnas, filas, { constantes = {}, lote = 2000 } = {}) {
    const fijas = Object.entries(constantes)
    for (let i = 0; i < filas.length; i += lote) {
        const parte = filas.slice(i, i + lote)
        const valores = [...fijas.map(([, v]) => v), ...columnas.map(([c]) => parte.map((f) => f[c] ?? null))]
        const nombres = [...fijas.map(([c]) => c), ...columnas.map(([c]) => c)]
        const selectFijas = fijas.map((_, j) => `$${j + 1}::uuid`)
        const arreglos = columnas.map(([, tipo], j) => `$${fijas.length + j + 1}::${tipo}[]`)
        await db.query(
            `insert into ${tabla} (${nombres.join(', ')})
             select ${[...selectFijas, ...columnas.map(([c]) => `x.${c}`)].join(', ')}
             from unnest(${arreglos.join(', ')}) as x(${columnas.map(([c]) => c).join(', ')})`,
            valores,
        )
    }
}

// La hora de cada registro viene como minutos del día, en la zona horaria de la empresa
async function insertarCabeceras(db, tabla, columnas, filas, { empresaId, sucursalId, usuarioId, zona }) {
    const temporal = `demo_${tabla}`
    await db.query(`create temp table ${temporal} (like ${tabla} including defaults, minutos int) on commit drop`)
    await insertarMasivo(db, temporal, [['id', 'uuid'], ['numero', 'bigint'], ['fecha', 'date'], ['minutos', 'int'], ...columnas], filas,
        { constantes: { empresa_id: empresaId, sucursal_id: sucursalId, usuario_id: usuarioId } })
    const copiar = ['id', 'empresa_id', 'sucursal_id', 'usuario_id', 'numero', 'fecha', ...columnas.map(([c]) => c)]
    const hora = `(fecha + make_interval(mins => minutos)) at time zone $1`
    await db.query(
        `insert into ${tabla} (${copiar.join(', ')}, created_at${tabla === 'ventas' ? ', ocurrido_en' : ''})
         select ${copiar.join(', ')}, ${hora}${tabla === 'ventas' ? `, ${hora}` : ''} from ${temporal}`,
        [zona],
    )
}

export async function insertarVentas(db, base, ventas, items, componentes) {
    await insertarCabeceras(db, 'ventas', [
        ['canal_id', 'uuid'], ['metodo_pago_id', 'uuid'], ['total', 'numeric'], ['descuento_pct', 'numeric'], ['descuento', 'numeric'],
    ], ventas, base)
    await insertarMasivo(db, 'venta_items', [
        ['id', 'uuid'], ['venta_id', 'uuid'], ['producto_id', 'uuid'], ['promo_id', 'uuid'], ['codigo', 'int'], ['nombre', 'text'],
        ['unidad', 'text'], ['cantidad', 'numeric'], ['precio_unitario', 'numeric'], ['costo_unitario', 'numeric'],
        ['subtotal', 'numeric'], ['posicion', 'smallint'],
    ], items, { constantes: { empresa_id: base.empresaId } })
    await insertarMasivo(db, 'venta_item_componentes', [
        ['venta_item_id', 'uuid'], ['producto_id', 'uuid'], ['nombre', 'text'], ['unidad', 'text'], ['cantidad', 'numeric'],
        ['precio_prorrateado', 'numeric'], ['costo_unitario', 'numeric'],
    ], componentes, { constantes: { empresa_id: base.empresaId } })
}

// Las líneas de compra se insertan en orden de fecha: el trigger deja en cada insumo el último precio
export async function insertarEgresos(db, base, egresos, items) {
    await insertarCabeceras(db, 'egresos', [
        ['categoria_id', 'uuid'], ['proveedor_id', 'uuid'], ['metodo_pago_id', 'uuid'], ['descripcion', 'text'], ['total', 'numeric'],
    ], egresos, base)
    await insertarMasivo(db, 'egreso_items', [
        ['egreso_id', 'uuid'], ['insumo_id', 'uuid'], ['codigo', 'int'], ['nombre', 'text'], ['unidad', 'text'],
        ['cantidad', 'numeric'], ['precio_unitario', 'numeric'], ['subtotal', 'numeric'], ['posicion', 'smallint'],
    ], items, { constantes: { empresa_id: base.empresaId }, lote: 500 })
}

export async function insertarMermas(db, base, mermas, items) {
    await insertarCabeceras(db, 'mermas', [['motivo_id', 'uuid'], ['total', 'numeric']], mermas, base)
    await insertarMasivo(db, 'merma_items', [
        ['merma_id', 'uuid'], ['producto_id', 'uuid'], ['insumo_id', 'uuid'], ['codigo', 'int'], ['nombre', 'text'],
        ['unidad', 'text'], ['cantidad', 'numeric'], ['costo_unitario', 'numeric'], ['subtotal', 'numeric'], ['posicion', 'smallint'],
    ], items, { constantes: { empresa_id: base.empresaId } })
}

// ---------- Catálogo de ejemplo ----------

const categoriaId = async (db, empresaId, ambito, nombre) =>
    (await db.query(
        `select id from categorias where empresa_id = $1 and ambito = $2 and lower(nombre) = lower($3) and deleted_at is null`,
        [empresaId, ambito, nombre],
    )).rows[0]?.id ?? null

export async function sembrarCatalogo(db, empresaId, usuarioId, { productos, insumos, promos, proveedores }) {
    const idProducto = new Map()
    for (const [i, p] of productos.entries()) {
        const { rows } = await db.query(
            `insert into productos (empresa_id, codigo, nombre, categoria_id, unidad, precio_venta, costo, created_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
            [empresaId, 101 + i, p.nombre, await categoriaId(db, empresaId, 'producto', p.categoria), p.unidad, p.precio, p.costo, usuarioId],
        )
        idProducto.set(p.nombre, rows[0].id)
    }
    for (const [i, x] of insumos.entries()) {
        await db.query(
            `insert into insumos (empresa_id, codigo, nombre, categoria_id, unidad, precio_ultimo, precio_actualizado_en)
             values ($1, $2, $3, $4, $5, $6, current_date)`,
            [empresaId, 501 + i, x.nombre, await categoriaId(db, empresaId, 'insumo', x.categoria), x.unidad, x.precio],
        )
    }
    for (const [i, pr] of promos.entries()) {
        const { rows } = await db.query(
            'insert into promos (empresa_id, codigo, nombre, precio) values ($1, $2, $3, $4) returning id',
            [empresaId, 901 + i, pr.nombre, pr.precio],
        )
        for (const [nombre, cantidad] of pr.productos) {
            await db.query(
                'insert into promo_productos (empresa_id, promo_id, producto_id, cantidad) values ($1, $2, $3, $4)',
                [empresaId, rows[0].id, idProducto.get(nombre), cantidad],
            )
        }
    }
    for (const p of proveedores) {
        await db.query('insert into proveedores (empresa_id, nombre, contacto, telefono) values ($1, $2, $3, $4)',
            [empresaId, p.nombre, p.contacto, p.telefono])
    }
}

// Borra la demo completa. Los movimientos no tienen "on delete cascade" hacia empresas: van primero;
// lo demás (listas, membresías, auditoría) cae en cascada.
export async function eliminar(db, id) {
    await borrarMovimientos(db, id)
    // El catálogo se referencia entre sí sin cascada (promo → producto → categoría): en orden
    for (const tabla of ['promos', 'productos', 'insumos']) {
        await db.query(`delete from ${tabla} where empresa_id = $1 and ${SOLO_DEMO}`, [id])
    }
    await db.query('delete from empresas where id = $1 and es_demo', [id])
}
