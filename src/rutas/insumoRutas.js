import express from 'express'
import { z } from 'zod'
import * as insumoControlador from '../controladores/insumoControlador.js'
import { permiso } from '../middlewares/permiso.js'
import { idValido, validar } from '../middlewares/validar.js'
import { codigo, dinero, filtroLista, texto, unidad, uuid } from '../utilidades/esquemas.js'

const router = express.Router()

const esquema = z.object({
    codigo: codigo.optional(),
    nombre: texto(100),
    categoriaId: uuid.nullish(),
    unidad,
    precio: dinero.optional(),           // precio de referencia; después lo actualizan las compras
    activo: z.boolean().optional(),
})

const ver = permiso('insumos.ver')
const gestionar = permiso('insumos.gestionar')

router.get('/', ver, validar(filtroLista, 'query'), insumoControlador.listar)
router.get('/siguiente-codigo', gestionar, insumoControlador.siguienteCodigo)
router.post('/', gestionar, validar(esquema), insumoControlador.crear)
router.get('/:id', idValido, ver, insumoControlador.buscar)
router.patch('/:id', idValido, gestionar, validar(esquema.partial()), insumoControlador.actualizar)
router.delete('/:id', idValido, gestionar, insumoControlador.eliminar)
router.get('/:id/compras', idValido, ver, insumoControlador.compras)

export default router
