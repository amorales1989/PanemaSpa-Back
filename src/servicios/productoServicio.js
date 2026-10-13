import { conEmpresa } from '../db/contexto.js'
import { borrarArchivo, decodificarImagen, guardarArchivo } from '../utilidades/imagenes.js'
import * as productoRepositorio from '../repositorios/productoRepositorio.js'
import * as catalogoRepositorio from '../repositorios/catalogoRepositorio.js'
import { auditar } from '../utilidades/auditoria.js'
import { conflicto, datosInvalidos, noEncontrado } from '../utilidades/errores.js'
import { tiene } from '../middlewares/permiso.js'

const verCostos = (req) => tiene(req, 'productos.ver_costos')

// Acepta categoriaId o el nombre de la categoría (`categoria`), que se crea si no existe
async function resolverCategoria(db, req, datos) {
    const { categoria, ...resto } = datos
    if (categoria && !resto.categoriaId) {
        resto.categoriaId = await catalogoRepositorio.categoriaPorNombre(db, req.contexto.empresaId, 'producto', categoria)
    }
    await validarCategoria(db, resto.categoriaId)
    return resto
}

async function validarCategoria(db, categoriaId) {
    if (categoriaId && !(await catalogoRepositorio.categoriaDeAmbito(db, categoriaId, 'producto'))) {
        throw datosInvalidos({ categoriaId: ['La categoría no existe o no es de productos'] })
    }
}

// Quien no ve costos tampoco puede escribirlos
const sinCostoSiNoCorresponde = (req, datos) => {
    if (verCostos(req)) return datos
    const { costo: _ignorado, ...resto } = datos
    return resto
}

export const listar = (req, filtros) =>
    conEmpresa(req.contexto, (db) => productoRepositorio.listar(db, { conCosto: verCostos(req), ...filtros }))

export const buscar = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        const producto = await productoRepositorio.buscar(db, id, verCostos(req))
        if (!producto) throw noEncontrado('Producto no encontrado')
        return producto
    })

export const siguienteCodigo = (req) =>
    conEmpresa(req.contexto, async (db) => ({ codigo: await catalogoRepositorio.siguienteCodigo(db, 'productos') }))

export const crear = (req, entrada) =>
    conEmpresa(req.contexto, async (db) => {
        const datos = await resolverCategoria(db, req, entrada)
        const id = await productoRepositorio.crear(db, req.contexto.empresaId, {
            ...sinCostoSiNoCorresponde(req, datos),
            codigo: datos.codigo ?? (await catalogoRepositorio.siguienteCodigo(db, 'productos')),
            creadoPor: req.usuario.id,
        })
        return productoRepositorio.buscar(db, id, verCostos(req))
    })

export const actualizar = (req, id, entrada) =>
    conEmpresa(req.contexto, async (db) => {
        const cambios = await resolverCategoria(db, req, entrada)
        // El trigger anota el cambio de precio en el historial con este motivo
        await db.query("select set_config('app.motivo_precio', 'Edición', true)")
        const filas = await productoRepositorio.actualizar(db, id, sinCostoSiNoCorresponde(req, cambios))
        if (!filas) throw noEncontrado('Producto no encontrado')
        return productoRepositorio.buscar(db, id, verCostos(req))
    })

// Borrado lógico: las ventas y mermas ya registradas lo siguen mostrando
export const eliminar = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        const promos = await productoRepositorio.promosQueLoUsan(db, id)
        if (promos.length) {
            throw conflicto('PRODUCTO_EN_PROMO', `Está en las promos: ${promos.join(', ')}. Quítalo de ellas primero.`)
        }
        if (!(await productoRepositorio.eliminar(db, id))) throw noEncontrado('Producto no encontrado')
        await auditar(db, req, { accion: 'producto.eliminar', entidad: 'producto', entidadId: id })
    })

export const historialPrecios = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        if (!(await productoRepositorio.buscar(db, id, false))) throw noEncontrado('Producto no encontrado')
        return productoRepositorio.historialPrecios(db, id)
    })

// cambios: [{ id, precio }]. Se aplica todo o nada.
export const ajustarPrecios = (req, { cambios, motivo }) =>
    conEmpresa(req.contexto, async (db) => {
        await db.query("select set_config('app.motivo_precio', $1, true)", [motivo])
        const actualizados = await productoRepositorio.ajustarPrecios(db, cambios)
        await auditar(db, req, { accion: 'precios.ajustar', entidad: 'producto', datos: { motivo, cambios } })
        return { actualizados: actualizados.length }
    })

// ---------- Fotos ----------

export const guardarImagen = async (req, id, dataUrl) => {
    const imagen = decodificarImagen(dataUrl)
    let url
    const anterior = await conEmpresa(req.contexto, async (db) => {
        const producto = await productoRepositorio.buscar(db, id, false)
        if (!producto) throw noEncontrado('Producto no encontrado')
        url = await guardarArchivo(req.contexto.empresaId, id, imagen)
        await productoRepositorio.ponerImagen(db, id, url)
        return producto.imagen_url
    })
    await borrarArchivo(anterior)
    return { imagenUrl: url }
}

export const quitarImagen = async (req, id) => {
    const anterior = await conEmpresa(req.contexto, async (db) => {
        const producto = await productoRepositorio.buscar(db, id, false)
        if (!producto) throw noEncontrado('Producto no encontrado')
        await productoRepositorio.ponerImagen(db, id, null)
        return producto.imagen_url
    })
    await borrarArchivo(anterior)
}
