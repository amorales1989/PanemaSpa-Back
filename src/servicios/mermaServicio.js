import { conEmpresa } from '../db/contexto.js'
import * as mermaRepositorio from '../repositorios/mermaRepositorio.js'
import * as productoRepositorio from '../repositorios/productoRepositorio.js'
import * as insumoRepositorio from '../repositorios/insumoRepositorio.js'
import { auditar } from '../utilidades/auditoria.js'
import { redondear } from '../utilidades/dinero.js'
import { datosInvalidos, noEncontrado } from '../utilidades/errores.js'
import { resolverFecha, resolverSucursal, validarCantidad, verificarActivo, verificarAnulacion } from './movimientoComun.js'

// La pérdida se valoriza a costo: productos a su costo, insumos a su último precio de compra
async function lineasDeMerma(db, req, items) {
    const dec = req.empresa.decimales
    const productos = await productoRepositorio.porIds(db, items.filter((i) => i.productoId).map((i) => i.productoId))
    const insumos = await insumoRepositorio.porIds(db, items.filter((i) => i.insumoId).map((i) => i.insumoId))
    return items.map((item, idx) => {
        const campo = `items.${idx}`
        const ref = item.productoId ? productos.get(item.productoId) : insumos.get(item.insumoId)
        if (!ref) throw datosInvalidos({ [campo]: ['El producto o insumo no existe'] })
        validarCantidad(ref.unidad, item.cantidad, campo)
        const costo = item.productoId ? ref.costo : ref.precio_ultimo
        return {
            productoId: item.productoId ?? null, insumoId: item.insumoId ?? null,
            codigo: ref.codigo, nombre: ref.nombre, unidad: ref.unidad, cantidad: item.cantidad,
            costoUnitario: costo, subtotal: redondear(item.cantidad * costo, dec),
        }
    })
}

export const crear = (req, datos, clave) =>
    conEmpresa(req.contexto, async (db) => {
        if (clave) {
            const existente = await mermaRepositorio.idPorClave(db, clave)
            if (existente) return { merma: await mermaRepositorio.buscar(db, existente), repetida: true }
        }
        const fecha = await resolverFecha(db, req, datos.fecha)
        const sucursalId = await resolverSucursal(db, req, datos.sucursalId)
        await verificarActivo(db, 'motivos_merma', datos.motivoId, 'motivoId')

        const lineas = await lineasDeMerma(db, req, datos.items)
        const total = redondear(lineas.reduce((t, l) => t + l.subtotal, 0), req.empresa.decimales)

        const id = await mermaRepositorio.insertarCabecera(db, {
            empresaId: req.contexto.empresaId, sucursalId, fecha, motivoId: datos.motivoId,
            observacion: datos.observacion, total, usuarioId: req.usuario.id, clave,
        })
        if (!id) return { merma: await mermaRepositorio.buscar(db, await mermaRepositorio.idPorClave(db, clave)), repetida: true }
        await mermaRepositorio.insertarItems(db, req.contexto.empresaId, id, lineas)
        return { merma: await mermaRepositorio.buscar(db, id), repetida: false }
    })

export const listar = (req, filtros) => conEmpresa(req.contexto, (db) => mermaRepositorio.listar(db, filtros))

export const buscar = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        const merma = await mermaRepositorio.buscar(db, id)
        if (!merma) throw noEncontrado('Merma no encontrada')
        return merma
    })

export const anular = (req, id, motivo) =>
    conEmpresa(req.contexto, async (db) => {
        const filas = await mermaRepositorio.anular(db, id, req.usuario.id, motivo)
        await verificarAnulacion(filas, () => mermaRepositorio.existe(db, id))
        await auditar(db, req, { accion: 'merma.anular', entidad: 'merma', entidadId: id, datos: { motivo } })
        return mermaRepositorio.buscar(db, id)
    })
