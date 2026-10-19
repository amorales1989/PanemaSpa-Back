import { conEmpresa } from '../db/contexto.js'
import * as stockRepositorio from '../repositorios/stockRepositorio.js'
import { auditar } from '../utilidades/auditoria.js'
import { conflicto, datosInvalidos, sinPermiso } from '../utilidades/errores.js'
import { tiene } from '../middlewares/permiso.js'

// items: [{ productoId | insumoId, modo: 'reposicion' (suma) | 'conteo' (fija el stock real), cantidad }]
export const ajustar = (req, { items, motivo }) =>
    conEmpresa(req.contexto, async (db) => {
        if (!(await stockRepositorio.controlActivo(db, req.contexto.empresaId))) {
            throw conflicto('STOCK_INACTIVO', 'La empresa no lleva control de stock. Actívalo en Configuración.')
        }
        if (items.some((i) => i.productoId) && !tiene(req, 'productos.gestionar')) throw sinPermiso()
        if (items.some((i) => i.insumoId) && !tiene(req, 'insumos.gestionar')) throw sinPermiso()

        const productos = await stockRepositorio.stockActual(db, 'productos', items.filter((i) => i.productoId).map((i) => i.productoId))
        const insumos = await stockRepositorio.stockActual(db, 'insumos', items.filter((i) => i.insumoId).map((i) => i.insumoId))
        const vistos = new Set()
        let movidos = 0
        for (const item of items) {
            const id = item.productoId ?? item.insumoId
            if (vistos.has(id)) throw datosInvalidos({ items: ['Hay un ítem repetido'] })
            vistos.add(id)
            const actual = (item.productoId ? productos : insumos).get(id)
            if (!actual) throw datosInvalidos({ items: ['Uno de los ítems no existe o fue eliminado'] })
            if (actual.con_receta) {
                throw datosInvalidos({ items: [`"${actual.nombre}" tiene receta: su stock son sus insumos`] })
            }
            const cantidad = item.modo === 'reposicion' ? item.cantidad : Math.round((item.cantidad - Number(actual.stock)) * 1000) / 1000
            if (item.modo === 'reposicion' && cantidad <= 0) throw datosInvalidos({ items: ['La reposición debe ser mayor a 0'] })
            if (!cantidad) continue // el conteo coincide con lo que había
            await stockRepositorio.insertarAjuste(db, req.contexto.empresaId, {
                productoId: item.productoId, insumoId: item.insumoId, cantidad, origen: item.modo, motivo, usuarioId: req.usuario.id,
            })
            movidos++
        }
        await auditar(db, req, { accion: 'stock.ajustar', entidad: 'stock', datos: { motivo, items } })
        return { movidos }
    })

// Ingreso de mercadería: suma stock y, opcionalmente, actualiza el costo y el precio de venta.
// items: [{ productoId | insumoId, cantidad, costo?, precio? }]
export const ingresar = (req, { items, motivo }) =>
    conEmpresa(req.contexto, async (db) => {
        if (!(await stockRepositorio.controlActivo(db, req.contexto.empresaId))) {
            throw conflicto('STOCK_INACTIVO', 'La empresa no lleva control de stock. Actívalo en Configuración.')
        }
        if (items.some((i) => i.productoId) && !tiene(req, 'productos.gestionar')) throw sinPermiso()
        if (items.some((i) => i.insumoId) && !tiene(req, 'insumos.gestionar')) throw sinPermiso()
        if (items.some((i) => i.productoId && i.costo !== undefined) && !tiene(req, 'productos.ver_costos')) {
            throw sinPermiso('No tienes permiso para cambiar costos')
        }
        if (items.some((i) => i.precio !== undefined) && !tiene(req, 'precios.ajustar')) {
            throw sinPermiso('No tienes permiso para cambiar precios de venta')
        }
        if (items.some((i) => i.insumoId && i.precio !== undefined)) {
            throw datosInvalidos({ items: ['Los insumos no tienen precio de venta'] })
        }

        const productos = await stockRepositorio.stockActual(db, 'productos', items.filter((i) => i.productoId).map((i) => i.productoId))
        const insumos = await stockRepositorio.stockActual(db, 'insumos', items.filter((i) => i.insumoId).map((i) => i.insumoId))
        const vistos = new Set()
        await db.query("select set_config('app.motivo_precio', $1, true)", [motivo ? `Ingreso de stock: ${motivo}` : 'Ingreso de stock'])
        for (const item of items) {
            const id = item.productoId ?? item.insumoId
            if (vistos.has(id)) throw datosInvalidos({ items: ['Hay un ítem repetido'] })
            vistos.add(id)
            const actual = (item.productoId ? productos : insumos).get(id)
            if (!actual) throw datosInvalidos({ items: ['Uno de los ítems no existe o fue eliminado'] })
            if (actual.con_receta) throw datosInvalidos({ items: [`"${actual.nombre}" tiene receta: su stock son sus insumos`] })

            await stockRepositorio.insertarAjuste(db, req.contexto.empresaId, {
                productoId: item.productoId, insumoId: item.insumoId, cantidad: item.cantidad, origen: 'reposicion', motivo, usuarioId: req.usuario.id,
            })
            if (item.costo !== undefined) {
                if (item.productoId) await stockRepositorio.ponerCostoProducto(db, id, item.costo)
                else await stockRepositorio.ponerPrecioInsumo(db, id, item.costo) // recalcula el costo de las recetas que lo usan
            }
            if (item.precio !== undefined) await stockRepositorio.ponerPrecioVenta(db, id, item.precio)
        }
        await auditar(db, req, { accion: 'stock.ingresar', entidad: 'stock', datos: { motivo, items } })
        return { ingresados: items.length }
    })

export const movimientos = (req, filtros) => {
    if (!tiene(req, filtros.productoId ? 'productos.ver' : 'insumos.ver')) throw sinPermiso()
    return conEmpresa(req.contexto, (db) => stockRepositorio.movimientos(db, filtros))
}
