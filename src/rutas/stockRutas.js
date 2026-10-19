import express from 'express'
import { z } from 'zod'
import { permiso } from '../middlewares/permiso.js'
import { validar } from '../middlewares/validar.js'
import * as stockServicio from '../servicios/stockServicio.js'
import { cantidad, dinero, textoOpcional, uuid } from '../utilidades/esquemas.js'

const router = express.Router()

const cantidadStock = z.coerce.number().min(0, 'No puede ser negativa').max(1_000_000)
    .transform((v) => Math.round(v * 1000) / 1000)

const esquemaAjuste = z.object({
    motivo: textoOpcional(200).optional(),
    items: z.array(z.object({
        productoId: uuid.optional(),
        insumoId: uuid.optional(),
        modo: z.enum(['reposicion', 'conteo']),
        cantidad: cantidadStock,
    }).refine((i) => !!i.productoId !== !!i.insumoId, 'Indica un producto o un insumo')).min(1).max(500),
})

const esquemaIngreso = z.object({
    motivo: textoOpcional(200).optional(),
    items: z.array(z.object({
        productoId: uuid.optional(),
        insumoId: uuid.optional(),
        cantidad,                      // lo que entra (> 0)
        costo: dinero.optional(),      // costo unitario nuevo (insumos: precio de compra)
        precio: dinero.positive().optional(), // precio de venta nuevo (solo productos)
    }).refine((i) => !!i.productoId !== !!i.insumoId, 'Indica un producto o un insumo')).min(1).max(500),
})

const filtroMovimientos = z.object({ productoId: uuid.optional(), insumoId: uuid.optional() })
    .refine((f) => !!f.productoId !== !!f.insumoId, 'Indica un producto o un insumo')

// El permiso fino (productos.gestionar / insumos.gestionar) se revisa en el servicio según los ítems
router.post('/ajustes', permiso('productos.gestionar', 'insumos.gestionar'), validar(esquemaAjuste), async (req, res) =>
    res.json(await stockServicio.ajustar(req, req.body)))

router.post('/ingresos', permiso('productos.gestionar', 'insumos.gestionar'), validar(esquemaIngreso), async (req, res) =>
    res.json(await stockServicio.ingresar(req, req.body)))

router.get('/movimientos', permiso('productos.ver', 'insumos.ver'), validar(filtroMovimientos, 'query'), async (req, res) =>
    res.json(await stockServicio.movimientos(req, req.consulta)))

export default router
