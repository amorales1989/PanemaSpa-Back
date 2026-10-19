import express from 'express'
import { z } from 'zod'
import * as productoControlador from '../controladores/productoControlador.js'
import { permiso } from '../middlewares/permiso.js'
import { idValido, validar } from '../middlewares/validar.js'
import { cantidad, codigo, dinero, filtroLista, stockMinimo, texto, unidad, uuid } from '../utilidades/esquemas.js'

const router = express.Router()

const esquema = z.object({
    codigo: codigo.optional(),           // si no viene, se asigna el siguiente libre
    nombre: texto(100),
    categoriaId: uuid.nullish(),
    categoria: z.string().trim().min(1).max(60).optional(),   // nombre: se crea si no existe
    unidad,
    precio: dinero,
    costo: dinero.optional(),
    activo: z.boolean().optional(),
    stockMinimo: stockMinimo.optional(),   // null = sin aviso de reposición
    // Insumos que lleva una unidad (o un kilo) del producto. Con receta, el costo se calcula solo.
    receta: z.array(z.object({ insumoId: uuid, cantidad })).max(100).optional(),
})

const esquemaAjuste = z.object({
    motivo: texto(100),
    cambios: z.array(z.object({ id: uuid, precio: dinero })).min(1).max(1000),
})

const esquemaImagen = z.object({ imagen: z.string().max(2_100_000) })

const ver = permiso('productos.ver')
const gestionar = permiso('productos.gestionar')

router.get('/', ver, validar(filtroLista, 'query'), productoControlador.listar)
router.get('/siguiente-codigo', gestionar, productoControlador.siguienteCodigo)
router.post('/ajuste-precios', permiso('precios.ajustar'), validar(esquemaAjuste), productoControlador.ajustarPrecios)
router.post('/', gestionar, validar(esquema), productoControlador.crear)
router.get('/:id', idValido, ver, productoControlador.buscar)
router.patch('/:id', idValido, gestionar, validar(esquema.partial()), productoControlador.actualizar)
router.delete('/:id', idValido, gestionar, productoControlador.eliminar)
router.get('/:id/historial-precios', idValido, ver, productoControlador.historialPrecios)
router.put('/:id/imagen', idValido, gestionar, validar(esquemaImagen), productoControlador.guardarImagen)
router.delete('/:id/imagen', idValido, gestionar, productoControlador.quitarImagen)

export default router
