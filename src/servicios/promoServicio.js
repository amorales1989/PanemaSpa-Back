import { conEmpresa } from '../db/contexto.js'
import * as promoRepositorio from '../repositorios/promoRepositorio.js'
import * as productoRepositorio from '../repositorios/productoRepositorio.js'
import * as catalogoRepositorio from '../repositorios/catalogoRepositorio.js'
import { auditar } from '../utilidades/auditoria.js'
import { datosInvalidos, noEncontrado } from '../utilidades/errores.js'

async function validarProductos(db, productos) {
    if (!productos) return
    const ids = productos.map((p) => p.productoId)
    if (new Set(ids).size !== ids.length) throw datosInvalidos({ productos: ['Hay productos repetidos'] })
    const existentes = await productoRepositorio.porIds(db, ids)
    const faltan = ids.filter((id) => !existentes.has(id))
    if (faltan.length) throw datosInvalidos({ productos: ['Algún producto no existe o fue eliminado'] })
}

export const listar = (req, filtros) => conEmpresa(req.contexto, (db) => promoRepositorio.listar(db, filtros))

export const buscar = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        const promo = await promoRepositorio.buscar(db, id)
        if (!promo) throw noEncontrado('Promo no encontrada')
        return promo
    })

export const crear = (req, { productos, ...datos }) =>
    conEmpresa(req.contexto, async (db) => {
        await validarProductos(db, productos)
        const id = await promoRepositorio.crear(db, req.contexto.empresaId, {
            ...datos,
            codigo: datos.codigo ?? (await catalogoRepositorio.siguienteCodigo(db, 'promos')),
        })
        await promoRepositorio.reemplazarProductos(db, req.contexto.empresaId, id, productos)
        return promoRepositorio.buscar(db, id)
    })

export const actualizar = (req, id, { productos, ...cambios }) =>
    conEmpresa(req.contexto, async (db) => {
        if (!(await promoRepositorio.actualizar(db, id, cambios))) throw noEncontrado('Promo no encontrada')
        if (productos) {
            await validarProductos(db, productos)
            await promoRepositorio.reemplazarProductos(db, req.contexto.empresaId, id, productos)
        }
        return promoRepositorio.buscar(db, id)
    })

export const eliminar = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        if (!(await promoRepositorio.eliminar(db, id))) throw noEncontrado('Promo no encontrada')
        await auditar(db, req, { accion: 'promo.eliminar', entidad: 'promo', entidadId: id })
    })
