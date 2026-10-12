import express from 'express'
import { z } from 'zod'
import * as promoControlador from '../controladores/promoControlador.js'
import { permiso } from '../middlewares/permiso.js'
import { idValido, validar } from '../middlewares/validar.js'
import { cantidad, codigo, dinero, fecha, filtroLista, texto, uuid } from '../utilidades/esquemas.js'

const router = express.Router()

const base = z.object({
    codigo: codigo.optional(),
    nombre: texto(100),
    precio: dinero,
    activa: z.boolean().optional(),
    vigenteDesde: fecha.nullish(),
    vigenteHasta: fecha.nullish(),
    productos: z.array(z.object({ productoId: uuid, cantidad })).min(1, 'La promo necesita al menos un producto').max(30),
})
const vigenciaValida = (d) => !d.vigenteDesde || !d.vigenteHasta || d.vigenteHasta >= d.vigenteDesde
const mensajeVigencia = { message: 'La fecha de término es anterior a la de inicio', path: ['vigenteHasta'] }

const ver = permiso('promos.ver')
const gestionar = permiso('promos.gestionar')

router.get('/', ver, validar(filtroLista, 'query'), promoControlador.listar)
router.post('/', gestionar, validar(base.refine(vigenciaValida, mensajeVigencia)), promoControlador.crear)
router.get('/:id', idValido, ver, promoControlador.buscar)
router.patch('/:id', idValido, gestionar, validar(base.partial().refine(vigenciaValida, mensajeVigencia)), promoControlador.actualizar)
router.delete('/:id', idValido, gestionar, promoControlador.eliminar)

export default router
