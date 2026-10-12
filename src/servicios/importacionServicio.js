// Importación masiva del catálogo (productos, insumos y promos) desde la planilla.
//
// Todo corre en UNA transacción: si cualquier fila tiene error no se guarda nada.
// En modo "previsualizar" se hace el trabajo completo y al final se deshace (rollback),
// así la vista previa muestra exactamente lo que pasaría al aplicar.
//
// Cada ítem existente se reconoce por su código o, si no trae código, por su nombre.
import { conEmpresa } from '../db/contexto.js'
import * as catalogoRepositorio from '../repositorios/catalogoRepositorio.js'
import * as productoRepositorio from '../repositorios/productoRepositorio.js'
import * as insumoRepositorio from '../repositorios/insumoRepositorio.js'
import * as promoRepositorio from '../repositorios/promoRepositorio.js'
import { auditar } from '../utilidades/auditoria.js'

class Simulacion extends Error {
    constructor(resultado) {
        super('simulación')
        this.resultado = resultado
    }
}

const buscarExistente = async (db, tabla, { codigo, nombre }) => {
    const { rows } = await db.query(
        `select id, codigo from ${tabla}
         where deleted_at is null and (($1::int is not null and codigo = $1) or ($1::int is null and lower(nombre) = lower($2)))
         limit 1`,
        [codigo ?? null, nombre],
    )
    return rows[0] ?? null
}

const codigoEnUso = async (db, tabla, codigo, salvoId) => {
    const { rowCount } = await db.query(
        `select 1 from ${tabla} where deleted_at is null and codigo = $1 and ($2::uuid is null or id <> $2)`, [codigo, salvoId ?? null])
    return rowCount > 0
}

async function importarProductos(db, req, filas, r, conCosto) {
    for (const f of filas) {
        const existente = await buscarExistente(db, 'productos', f)
        const categoriaId = f.categoria
            ? await catalogoRepositorio.categoriaPorNombre(db, req.contexto.empresaId, 'producto', f.categoria) : undefined
        const datos = {
            nombre: f.nombre, unidad: f.unidad, precio: f.precio, categoriaId,
            ...(conCosto && f.costo !== undefined && { costo: f.costo }),
        }
        if (existente) {
            await productoRepositorio.actualizar(db, existente.id, datos)
            r.productos.actualizados++
        } else {
            const codigo = f.codigo ?? (await catalogoRepositorio.siguienteCodigo(db, 'productos'))
            if (await codigoEnUso(db, 'productos', codigo)) {
                r.errores.push({ hoja: 'Productos', fila: f.fila, mensaje: `El código ${codigo} ya lo usa otro producto` })
                continue
            }
            await productoRepositorio.crear(db, req.contexto.empresaId, { ...datos, codigo, creadoPor: req.usuario.id })
            r.productos.creados++
        }
    }
}

async function importarInsumos(db, req, filas, r) {
    for (const f of filas) {
        const existente = await buscarExistente(db, 'insumos', f)
        const categoriaId = f.categoria
            ? await catalogoRepositorio.categoriaPorNombre(db, req.contexto.empresaId, 'insumo', f.categoria) : undefined
        const datos = { nombre: f.nombre, unidad: f.unidad, categoriaId, ...(f.precio !== undefined && { precio: f.precio }) }
        if (existente) {
            await insumoRepositorio.actualizar(db, existente.id, datos)
            r.insumos.actualizados++
        } else {
            const codigo = f.codigo ?? (await catalogoRepositorio.siguienteCodigo(db, 'insumos'))
            if (await codigoEnUso(db, 'insumos', codigo)) {
                r.errores.push({ hoja: 'Insumos', fila: f.fila, mensaje: `El código ${codigo} ya lo usa otro insumo` })
                continue
            }
            await insumoRepositorio.crear(db, req.contexto.empresaId, { ...datos, codigo })
            r.insumos.creados++
        }
    }
}

// Las promos nombran sus productos por código (pueden ser productos de esta misma planilla)
async function importarPromos(db, req, filas, r) {
    for (const f of filas) {
        const productos = []
        for (const c of f.productos) {
            const p = await buscarExistente(db, 'productos', { codigo: c.codigo })
            if (!p) r.errores.push({ hoja: 'Promos', fila: f.fila, mensaje: `No existe el producto con código ${c.codigo}` })
            else productos.push({ productoId: p.id, cantidad: c.cantidad })
        }
        if (productos.length !== f.productos.length) continue
        const repetidos = new Set(productos.map((p) => p.productoId)).size !== productos.length
        if (repetidos) {
            r.errores.push({ hoja: 'Promos', fila: f.fila, mensaje: 'Un producto aparece dos veces: suma las cantidades en uno' })
            continue
        }
        const existente = await buscarExistente(db, 'promos', f)
        const datos = { nombre: f.nombre, precio: f.precio, ...(f.activa !== undefined && { activa: f.activa }) }
        let id = existente?.id
        if (existente) {
            await promoRepositorio.actualizar(db, id, datos)
            r.promos.actualizadas++
        } else {
            const codigo = f.codigo ?? (await catalogoRepositorio.siguienteCodigo(db, 'promos'))
            if (await codigoEnUso(db, 'promos', codigo)) {
                r.errores.push({ hoja: 'Promos', fila: f.fila, mensaje: `El código ${codigo} ya lo usa otra promo` })
                continue
            }
            id = await promoRepositorio.crear(db, req.contexto.empresaId, { ...datos, codigo })
            r.promos.creadas++
        }
        await promoRepositorio.reemplazarProductos(db, req.contexto.empresaId, id, productos)
    }
}

export async function importar(req, { aplicar, productos, insumos, promos }) {
    const resultado = {
        aplicado: false,
        productos: { creados: 0, actualizados: 0 },
        insumos: { creados: 0, actualizados: 0 },
        promos: { creadas: 0, actualizadas: 0 },
        errores: [],
    }
    try {
        await conEmpresa(req.contexto, async (db) => {
            // Los cambios de precio quedan en el historial con este motivo
            await db.query("select set_config('app.motivo_precio', 'Importación', true)")
            await importarProductos(db, req, productos, resultado, req.permisos.has('productos.ver_costos'))
            await importarInsumos(db, req, insumos, resultado)
            await importarPromos(db, req, promos, resultado)
            // Con errores, o en la vista previa, se deshace todo
            if (resultado.errores.length || !aplicar) throw new Simulacion(resultado)
            await auditar(db, req, {
                accion: 'catalogo.importar', entidad: 'catalogo',
                datos: { productos: resultado.productos, insumos: resultado.insumos, promos: resultado.promos },
            })
        })
    } catch (error) {
        if (error instanceof Simulacion) return error.resultado
        throw error
    }
    return { ...resultado, aplicado: true }
}
