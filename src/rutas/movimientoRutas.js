import express from 'express'
import { z } from 'zod'
import { egresos, mermas, ventas } from '../controladores/movimientoControlador.js'
import { permiso } from '../middlewares/permiso.js'
import { idValido, validar } from '../middlewares/validar.js'
import { anulacion, cantidad, dinero, fecha, filtroMovimientos, textoOpcional, uuid } from '../utilidades/esquemas.js'

// ---------- Ventas ----------

// Cada línea es un producto O una promo. `precio` es opcional: si no viene se usa el del
// catálogo, y si viene distinto exige el permiso ventas.modificar_precio.
const lineaVenta = z.object({
    productoId: uuid.optional(),
    promoId: uuid.optional(),
    cantidad,
    precio: dinero.optional(),
}).refine((l) => Boolean(l.productoId) !== Boolean(l.promoId), 'Cada línea lleva productoId o promoId (uno solo)')

const esquemaVenta = z.object({
    fecha: fecha.optional(),
    sucursalId: uuid.optional(),
    canalId: uuid,
    metodoPagoId: uuid,
    clienteId: uuid.nullish(),
    items: z.array(lineaVenta).min(1, 'La venta no tiene productos').max(200),
})

export const ventaRutas = express.Router()
ventaRutas.get('/', permiso('ventas.ver', 'ventas.ver_todas'),
    validar(filtroMovimientos.extend({ usuarioId: uuid.optional(), canalId: uuid.optional(), clienteId: uuid.optional() }), 'query'), ventas.listar)
ventaRutas.post('/', permiso('ventas.crear'), validar(esquemaVenta), ventas.crear)
ventaRutas.get('/:id', idValido, permiso('ventas.ver', 'ventas.ver_todas'), ventas.buscar)
ventaRutas.post('/:id/anular', idValido, permiso('ventas.anular'), validar(anulacion), ventas.anular)

// ---------- Egresos ----------

const esquemaEgreso = z.object({
    fecha: fecha.optional(),
    sucursalId: uuid.optional(),
    categoriaId: uuid,
    metodoPagoId: uuid,
    proveedor: textoOpcional(100),      // texto libre: se busca o se crea en proveedores
    descripcion: textoOpcional(200),
    monto: dinero.optional(),            // egresos sin insumos (sueldos, arriendo...)
    items: z.array(z.object({ insumoId: uuid, cantidad, precio: dinero })).max(200).optional(),
})

export const egresoRutas = express.Router()
egresoRutas.get('/', permiso('egresos.ver'),
    validar(filtroMovimientos.extend({ categoriaId: uuid.optional(), proveedorId: uuid.optional() }), 'query'), egresos.listar)
egresoRutas.post('/', permiso('egresos.crear'), validar(esquemaEgreso), egresos.crear)
egresoRutas.get('/:id', idValido, permiso('egresos.ver'), egresos.buscar)
egresoRutas.post('/:id/anular', idValido, permiso('egresos.anular'), validar(anulacion), egresos.anular)

// ---------- Mermas ----------

const lineaMerma = z.object({
    productoId: uuid.optional(),
    insumoId: uuid.optional(),
    cantidad,
}).refine((l) => Boolean(l.productoId) !== Boolean(l.insumoId), 'Cada línea lleva productoId o insumoId (uno solo)')

const esquemaMerma = z.object({
    fecha: fecha.optional(),
    sucursalId: uuid.optional(),
    motivoId: uuid,
    observacion: textoOpcional(300),
    items: z.array(lineaMerma).min(1, 'Agrega lo que se perdió').max(200),
})

export const mermaRutas = express.Router()
mermaRutas.get('/', permiso('mermas.ver'), validar(filtroMovimientos.extend({ motivoId: uuid.optional() }), 'query'), mermas.listar)
mermaRutas.post('/', permiso('mermas.crear'), validar(esquemaMerma), mermas.crear)
mermaRutas.get('/:id', idValido, permiso('mermas.ver'), mermas.buscar)
mermaRutas.post('/:id/anular', idValido, permiso('mermas.anular'), validar(anulacion), mermas.anular)
