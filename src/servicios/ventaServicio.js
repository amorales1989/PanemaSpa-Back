import { conEmpresa } from '../db/contexto.js'
import * as stockRepositorio from '../repositorios/stockRepositorio.js'
import * as ventaRepositorio from '../repositorios/ventaRepositorio.js'
import * as productoRepositorio from '../repositorios/productoRepositorio.js'
import * as promoRepositorio from '../repositorios/promoRepositorio.js'
import * as clienteRepositorio from '../repositorios/clienteRepositorio.js'
import { auditar } from '../utilidades/auditoria.js'
import { redondear } from '../utilidades/dinero.js'
import { datosInvalidos, noEncontrado, sinPermiso } from '../utilidades/errores.js'
import { tiene } from '../middlewares/permiso.js'
import { hoyEmpresa, resolverFecha, resolverSucursal, validarCantidad, verificarActivo, verificarAnulacion } from './movimientoComun.js'

const redondear3 = (n) => Math.round(n * 1000) / 1000

// Precio de la línea: el del catálogo, salvo que se mande otro y el usuario tenga permiso
function precioDeLinea(req, enviado, catalogo, campo) {
    if (enviado === undefined || enviado === catalogo) return catalogo
    if (!tiene(req, 'ventas.modificar_precio')) {
        throw sinPermiso(`No tienes permiso para cambiar precios (${campo})`)
    }
    return enviado
}

// Arma las líneas con precios y costos LEÍDOS DEL CATÁLOGO (no los del navegador)
async function armarLineas(db, req, items, fecha) {
    const dec = req.empresa.decimales
    const productos = await productoRepositorio.porIds(db, items.filter((i) => i.productoId).map((i) => i.productoId))
    const promos = await promoRepositorio.vendiblesPorIds(db, items.filter((i) => i.promoId).map((i) => i.promoId), fecha)

    return items.map((item, idx) => {
        const campo = `items.${idx}`
        if (item.productoId) {
            const p = productos.get(item.productoId)
            if (!p?.activo) throw datosInvalidos({ [campo]: ['El producto no existe o está desactivado'] })
            validarCantidad(p.unidad, item.cantidad, campo)
            const precio = precioDeLinea(req, item.precio, p.precio_venta, p.nombre)
            return {
                productoId: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: item.cantidad,
                precioUnitario: precio, costoUnitario: p.costo, subtotal: redondear(item.cantidad * precio, dec),
            }
        }
        const promo = promos.get(item.promoId)
        if (!promo) throw datosInvalidos({ [campo]: ['La promo no existe, está desactivada o fuera de vigencia'] })
        validarCantidad('un', item.cantidad, campo)
        const precio = precioDeLinea(req, item.precio, promo.precio, promo.nombre)
        // El precio promo se reparte entre sus productos en proporción a su precio normal
        const normal = promo.componentes.reduce((t, c) => t + c.precio * c.cantidad, 0)
        const factor = normal ? precio / normal : 0
        return {
            promoId: promo.id, codigo: promo.codigo, nombre: promo.nombre, unidad: 'un', cantidad: item.cantidad,
            precioUnitario: precio,
            costoUnitario: redondear(promo.componentes.reduce((t, c) => t + c.costo * c.cantidad, 0), 2),
            subtotal: redondear(item.cantidad * precio, dec),
            componentes: promo.componentes.map((c) => ({
                productoId: c.id, nombre: c.nombre, unidad: c.unidad,
                cantidad: redondear3(c.cantidad * item.cantidad),
                precioProrrateado: redondear(c.precio * factor, dec),
                costoUnitario: c.costo,
            })),
        }
    })
}

// Quien no ve las ventas de todos (ej. Vendedor) solo ve las propias y solo las de hoy
// (en la zona horaria de la empresa). Se aplica en el servidor: lo demás ni siquiera llega al navegador.
const soloPropias = (req) => !tiene(req, 'ventas.ver_todas')

export const crear = (req, datos, clave) =>
    conEmpresa(req.contexto, async (db) => {
        if (clave) {
            const existente = await ventaRepositorio.idPorClave(db, clave)
            if (existente) return { venta: await ventaRepositorio.buscar(db, existente), repetida: true }
        }
        const fecha = await resolverFecha(db, req, datos.fecha)
        const sucursalId = await resolverSucursal(db, req, datos.sucursalId)
        await verificarActivo(db, 'canales_venta', datos.canalId, 'canalId')
        await verificarActivo(db, 'metodos_pago', datos.metodoPagoId, 'metodoPagoId')

        if (datos.clienteId && !(await clienteRepositorio.existe(db, datos.clienteId))) {
            throw datosInvalidos({ clienteId: ['El cliente no existe'] })
        }

        const lineas = await armarLineas(db, req, datos.items, fecha)
        const dec = req.empresa.decimales
        const subtotal = redondear(lineas.reduce((t, l) => t + l.subtotal, 0), dec)
        // Descuento del medio de pago (ej. 10% con transferencia), leído del servidor, sobre toda la venta
        const descuentoPct = await ventaRepositorio.descuentoDelMetodo(db, datos.metodoPagoId)
        const descuento = redondear((subtotal * descuentoPct) / 100, dec)

        const id = await ventaRepositorio.insertarCabecera(db, {
            empresaId: req.contexto.empresaId, sucursalId, fecha, canalId: datos.canalId,
            metodoPagoId: datos.metodoPagoId, total: redondear(subtotal - descuento, dec), usuarioId: req.usuario.id, clave,
            descuentoPct, descuento, clienteId: datos.clienteId ?? null,
        })
        if (!id) {
            // Otra petición con la misma Idempotency-Key se registró justo antes
            return { venta: await ventaRepositorio.buscar(db, await ventaRepositorio.idPorClave(db, clave)), repetida: true }
        }
        await ventaRepositorio.insertarItems(db, req.contexto.empresaId, id, lineas)
        await stockRepositorio.registrar(db, 'venta', id)
        return { venta: await ventaRepositorio.buscar(db, id), repetida: false }
    })

export const listar = (req, filtros) =>
    conEmpresa(req.contexto, async (db) => {
        if (!soloPropias(req)) return ventaRepositorio.listar(db, filtros)
        const hoy = await hoyEmpresa(db, req.empresa.zonaHoraria)
        return ventaRepositorio.listar(db, { ...filtros, desde: hoy, hasta: hoy, usuarioId: req.usuario.id })
    })

export const buscar = (req, id) =>
    conEmpresa(req.contexto, async (db) => {
        const venta = await ventaRepositorio.buscar(db, id)
        const ajena = soloPropias(req) && (venta?.usuario_id !== req.usuario.id || venta?.fecha !== (await hoyEmpresa(db, req.empresa.zonaHoraria)))
        if (!venta || ajena) throw noEncontrado('Venta no encontrada')
        return venta
    })

export const anular = (req, id, motivo) =>
    conEmpresa(req.contexto, async (db) => {
        const filas = await ventaRepositorio.anular(db, id, req.usuario.id, motivo)
        await verificarAnulacion(filas, () => ventaRepositorio.existe(db, id))
        await stockRepositorio.revertir(db, id)
        await auditar(db, req, { accion: 'venta.anular', entidad: 'venta', entidadId: id, datos: { motivo } })
        return ventaRepositorio.buscar(db, id)
    })
