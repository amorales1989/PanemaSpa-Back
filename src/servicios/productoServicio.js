import { randomBytes } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { conEmpresa } from '../db/contexto.js'
import { env } from '../config/env.js'
import * as productoRepositorio from '../repositorios/productoRepositorio.js'
import * as catalogoRepositorio from '../repositorios/catalogoRepositorio.js'
import { auditar } from '../utilidades/auditoria.js'
import { ErrorApi, conflicto, datosInvalidos, noEncontrado } from '../utilidades/errores.js'
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

// El front ya entrega la foto reducida (JPEG ~480px) como data URL
const FORMATOS = {
    'image/jpeg': { ext: 'jpg', firma: [0xff, 0xd8, 0xff] },
    'image/png': { ext: 'png', firma: [0x89, 0x50, 0x4e, 0x47] },
    'image/webp': { ext: 'webp', firma: [0x52, 0x49, 0x46, 0x46] },
}
const MAX_BYTES = 1_500_000

function decodificarImagen(dataUrl) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!m) throw datosInvalidos({ imagen: ['Debe ser una imagen JPEG, PNG o WebP en base64'] })
    const formato = FORMATOS[m[1]]
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length > MAX_BYTES) throw new ErrorApi(413, 'IMAGEN_GRANDE', 'La imagen supera 1,5 MB')
    // Que el contenido sea de verdad del tipo declarado
    if (!formato.firma.every((b, i) => bytes[i] === b)) throw datosInvalidos({ imagen: ['El archivo no es una imagen válida'] })
    return { bytes, ext: formato.ext }
}

const rutaArchivo = (url) => url && join(env.UPLOADS_DIR, url.replace(/^\/uploads\//, ''))

async function borrarArchivo(url) {
    if (!url?.startsWith('/uploads/')) return
    await unlink(rutaArchivo(url)).catch(() => {})
}

export const guardarImagen = async (req, id, dataUrl) => {
    const { bytes, ext } = decodificarImagen(dataUrl)
    const empresaId = req.contexto.empresaId
    // Nombre nuevo en cada cambio: evita que el navegador muestre la foto vieja en caché
    const nombre = `${id}-${randomBytes(4).toString('hex')}.${ext}`
    const url = `/uploads/${empresaId}/${nombre}`

    const anterior = await conEmpresa(req.contexto, async (db) => {
        const producto = await productoRepositorio.buscar(db, id, false)
        if (!producto) throw noEncontrado('Producto no encontrado')
        await mkdir(join(env.UPLOADS_DIR, empresaId), { recursive: true })
        await writeFile(rutaArchivo(url), bytes)
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
