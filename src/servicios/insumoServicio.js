import { conEmpresa } from '../db/contexto.js'
import * as insumoRepositorio from '../repositorios/insumoRepositorio.js'
import * as catalogoRepositorio from '../repositorios/catalogoRepositorio.js'
import { auditar } from '../utilidades/auditoria.js'
import { datosInvalidos, noEncontrado } from '../utilidades/errores.js'

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

export const crear = (req, datos) =>
    conEmpresa(req.contexto, async (db) => {
        await validarCategoria(db, datos.categoriaId)
        const id = await insumoRepositorio.crear(db, req.contexto.empresaId, {
            ...datos,
            codigo: datos.codigo ?? (await catalogoRepositorio.siguienteCodigo(db, 'insumos')),
        })
        return insumoRepositorio.buscar(db, id)
    })

export const actualizar = (req, id, cambios) =>
    conEmpresa(req.contexto, async (db) => {
        await validarCategoria(db, cambios.categoriaId)
        if (!(await insumoRepositorio.actualizar(db, id, cambios))) throw noEncontrado('Insumo no encontrado')
        return insumoRepositorio.buscar(db, id)
    })

export const eliminar = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        if (!(await insumoRepositorio.eliminar(db, id))) throw noEncontrado('Insumo no encontrado')
        await auditar(db, req, { accion: 'insumo.eliminar', entidad: 'insumo', entidadId: id })
    })

export const compras = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        if (!(await insumoRepositorio.buscar(db, id))) throw noEncontrado('Insumo no encontrado')
        return insumoRepositorio.compras(db, id)
    })
