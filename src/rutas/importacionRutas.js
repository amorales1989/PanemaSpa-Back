import express from 'express'
import { z } from 'zod'
import * as importacionServicio from '../servicios/importacionServicio.js'
import { sinPermiso } from '../utilidades/errores.js'
import { validar } from '../middlewares/validar.js'
import { cantidad, codigo, dinero, texto, unidad } from '../utilidades/esquemas.js'

// /v1/importar: carga masiva del catálogo desde la planilla (el front la lee y manda filas)
const router = express.Router()

const base = { fila: z.number().int().min(1), codigo: codigo.optional(), nombre: texto(100), categoria: z.string().trim().min(1).max(60).optional() }

const esquema = z.object({
    aplicar: z.boolean().default(false),
    productos: z.array(z.object({ ...base, unidad, precio: dinero, costo: dinero.optional() })).max(3000).default([]),
    insumos: z.array(z.object({ ...base, unidad, precio: dinero.optional() })).max(3000).default([]),
    promos: z.array(z.object({
        fila: base.fila, codigo: base.codigo, nombre: base.nombre, precio: dinero, activa: z.boolean().optional(),
        productos: z.array(z.object({ codigo, cantidad })).min(1, 'La promo necesita productos').max(30),
    })).max(500).default([]),
})

// Cada hoja exige el permiso de gestionar lo que trae
const permisosNecesarios = (req, res, next) => {
    const faltan = [
        req.body.productos?.length && 'productos.gestionar',
        req.body.insumos?.length && 'insumos.gestionar',
        req.body.promos?.length && 'promos.gestionar',
    ].filter((p) => p && !req.permisos.has(p))
    if (faltan.length) throw sinPermiso('No tienes permiso para importar alguna de las hojas')
    next()
}

router.post('/catalogo', validar(esquema), permisosNecesarios, async (req, res) => {
    res.json(await importacionServicio.importar(req, req.body))
})

export default router
