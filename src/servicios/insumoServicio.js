import { conEmpresa } from '../db/contexto.js'
import * as insumoRepositorio from '../repositorios/insumoRepositorio.js'
import * as catalogoRepositorio from '../repositorios/catalogoRepositorio.js'
import { auditar } from '../utilidades/auditoria.js'
import { conflicto, datosInvalidos, noEncontrado } from '../utilidades/errores.js'

// Acepta categoriaId o el nombre de la categoría (`categoria`), que se crea si no existe
async function resolverCategoria(db, req, datos) {
    const { categoria, ...resto } = datos
    if (categoria && !resto.categoriaId) {
        resto.categoriaId = await catalogoRepositorio.categoriaPorNombre(db, req.contexto.empresaId, 'insumo', categoria)
    }
    await validarCategoria(db, resto.categoriaId)
    return resto
}

async function validarCategoria(db, categoriaId) {
    if (categoriaId && !(await catalogoRepositorio.categoriaDeAmbito(db, categoriaId, 'insumo'))) {
        throw datosInvalidos({ categoriaId: ['La categoría no existe o no es de insumos'] })
    }
}

export const listar = (req, filtros) => conEmpresa(req.contexto, (db) => insumoRepositorio.listar(db, filtros))

export const buscar = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        const insumo = await insumoRepositorio.buscar(db, id)
        if (!insumo) throw noEncontrado('Insumo no encontrado')
        return insumo
    })

export const siguienteCodigo = (req) =>
    conEmpresa(req.contexto, async (db) => ({ codigo: await catalogoRepositorio.siguienteCodigo(db, 'insumos') }))

export const crear = (req, entrada) =>
    conEmpresa(req.contexto, async (db) => {
        const datos = await resolverCategoria(db, req, entrada)
        const id = await insumoRepositorio.crear(db, req.contexto.empresaId, {
            ...datos,
            codigo: datos.codigo ?? (await catalogoRepositorio.siguienteCodigo(db, 'insumos')),
        })
        return insumoRepositorio.buscar(db, id)
    })

export const actualizar = (req, id, entrada) =>
    conEmpresa(req.contexto, async (db) => {
        const cambios = await resolverCategoria(db, req, entrada)
        if (!(await insumoRepositorio.actualizar(db, id, cambios))) throw noEncontrado('Insumo no encontrado')
        return insumoRepositorio.buscar(db, id)
    })

export const eliminar = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        const productos = await insumoRepositorio.productosQueLoUsan(db, id)
        if (productos.length) {
            throw conflicto('INSUMO_EN_RECETA', `Lo usan en la receta de: ${productos.join(', ')}. Quítalo de ellas primero.`)
        }
        if (!(await insumoRepositorio.eliminar(db, id))) throw noEncontrado('Insumo no encontrado')
        await auditar(db, req, { accion: 'insumo.eliminar', entidad: 'insumo', entidadId: id })
    })

export const compras = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        if (!(await insumoRepositorio.buscar(db, id))) throw noEncontrado('Insumo no encontrado')
        return insumoRepositorio.compras(db, id)
    })
