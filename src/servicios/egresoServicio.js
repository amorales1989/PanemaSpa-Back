import { conEmpresa } from '../db/contexto.js'
import * as stockRepositorio from '../repositorios/stockRepositorio.js'
import * as egresoRepositorio from '../repositorios/egresoRepositorio.js'
import * as insumoRepositorio from '../repositorios/insumoRepositorio.js'
import * as configuracionRepositorio from '../repositorios/configuracionRepositorio.js'
import { auditar } from '../utilidades/auditoria.js'
import { redondear } from '../utilidades/dinero.js'
import { datosInvalidos, noEncontrado } from '../utilidades/errores.js'
import { resolverFecha, resolverSucursal, validarCantidad, verificarActivo, verificarAnulacion } from './movimientoComun.js'

async function lineasDeCompra(db, req, items) {
    const dec = req.empresa.decimales
    const insumos = await insumoRepositorio.porIds(db, items.map((i) => i.insumoId))
    return items.map((item, idx) => {
        const campo = `items.${idx}`
        const ins = insumos.get(item.insumoId)
        if (!ins?.activo) throw datosInvalidos({ [campo]: ['El insumo no existe o está desactivado'] })
        validarCantidad(ins.unidad, item.cantidad, campo)
        return {
            insumoId: ins.id, codigo: ins.codigo, nombre: ins.nombre, unidad: ins.unidad,
            cantidad: item.cantidad, precioUnitario: item.precio, subtotal: redondear(item.cantidad * item.precio, dec),
        }
    })
}

// Dos tipos de egreso:
//  - categoría con_items ("Insumos"): compra con líneas de insumos; el total es la suma
//  - el resto (sueldos, arriendo...): un monto y un detalle
export const crear = (req, datos, clave) =>
    conEmpresa(req.contexto, async (db) => {
        if (clave) {
            const existente = await egresoRepositorio.idPorClave(db, clave)
            if (existente) return { egreso: await egresoRepositorio.buscar(db, existente), repetido: true }
        }
        const categoria = await egresoRepositorio.categoria(db, datos.categoriaId)
        if (!categoria?.activa) throw datosInvalidos({ categoriaId: ['La categoría no existe o está desactivada'] })
        const fecha = await resolverFecha(db, req, datos.fecha)
        const sucursalId = await resolverSucursal(db, req, datos.sucursalId)
        await verificarActivo(db, 'metodos_pago', datos.metodoPagoId, 'metodoPagoId')
        const proveedorId = datos.proveedor
            ? await configuracionRepositorio.proveedorPorNombre(db, req.contexto.empresaId, datos.proveedor)
            : null

        let lineas = []
        let total
        let descripcion
        if (categoria.con_items) {
            if (!datos.items?.length) throw datosInvalidos({ items: ['Agrega al menos un insumo a la compra'] })
            lineas = await lineasDeCompra(db, req, datos.items)
            total = redondear(lineas.reduce((t, l) => t + l.subtotal, 0), req.empresa.decimales)
            descripcion = datos.descripcion ?? datos.proveedor ?? 'Compra de insumos'
        } else {
            if (datos.items?.length) throw datosInvalidos({ items: [`La categoría ${categoria.nombre} no lleva insumos`] })
            if (!datos.monto) throw datosInvalidos({ monto: ['Ingresa el monto'] })
            total = redondear(datos.monto, req.empresa.decimales)
            descripcion = datos.descripcion ?? categoria.nombre
        }

        const id = await egresoRepositorio.insertarCabecera(db, {
            empresaId: req.contexto.empresaId, sucursalId, fecha, categoriaId: categoria.id, proveedorId,
            metodoPagoId: datos.metodoPagoId, descripcion, total, usuarioId: req.usuario.id, clave,
        })
        if (!id) return { egreso: await egresoRepositorio.buscar(db, await egresoRepositorio.idPorClave(db, clave)), repetido: true }
        if (lineas.length) await egresoRepositorio.insertarItems(db, req.contexto.empresaId, id, lineas)
        if (lineas.length) await stockRepositorio.registrar(db, 'compra', id)
        return { egreso: await egresoRepositorio.buscar(db, id), repetido: false }
    })

export const listar = (req, filtros) => conEmpresa(req.contexto, (db) => egresoRepositorio.listar(db, filtros))

export const buscar = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        const egreso = await egresoRepositorio.buscar(db, id)
        if (!egreso) throw noEncontrado('Egreso no encontrado')
        return egreso
    })

// Nota: anular una compra no revierte el último precio del insumo (se corrige editando el insumo)
export const anular = (req, id, motivo) =>
    conEmpresa(req.contexto, async (db) => {
        const filas = await egresoRepositorio.anular(db, id, req.usuario.id, motivo)
        await verificarAnulacion(filas, () => egresoRepositorio.existe(db, id))
        await stockRepositorio.revertir(db, id)
        await auditar(db, req, { accion: 'egreso.anular', entidad: 'egreso', entidadId: id, datos: { motivo } })
        return egresoRepositorio.buscar(db, id)
    })
