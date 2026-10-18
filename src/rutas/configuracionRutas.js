import express from 'express'
import { z } from 'zod'
import * as configuracionControlador from '../controladores/configuracionControlador.js'
import { permiso } from '../middlewares/permiso.js'
import { idValido, validar } from '../middlewares/validar.js'
import { noEncontrado } from '../utilidades/errores.js'
import { orden, texto, textoOpcional } from '../utilidades/esquemas.js'

// Montada detrás de auth + empresa (ver app.js)
const router = express.Router()

const simple = z.object({ nombre: texto(60), orden: orden.optional(), activo: z.boolean().optional() })

const ESQUEMAS = {
    canales: simple,
    // Descuento en ventas pagadas con este medio (0 = sin descuento)
    'metodos-pago': simple.extend({ descuentoPct: z.coerce.number().min(0).max(99.99).optional() }),
    'motivos-merma': simple,
    categorias: simple.extend({
        ambito: z.enum(['producto', 'insumo', 'egreso']),
        conItems: z.boolean().optional(),
    }),
    proveedores: z.object({
        nombre: texto(100),
        rut: textoOpcional(20),
        telefono: textoOpcional(30),
        email: z.string().trim().email().max(200).nullish().or(z.literal('').transform(() => null)),
        activo: z.boolean().optional(),
    }),
    sucursales: z.object({ nombre: texto(60), direccion: textoOpcional(200), activo: z.boolean().optional() }),
}

// Sucursales tienen su propio permiso; el resto, configuración general
const permisoDe = (req, res, next) =>
    permiso(req.params.lista === 'sucursales' ? 'sucursales.gestionar' : 'configuracion.gestionar')(req, res, next)

function validarLista(parcial) {
    return (req, res, next) => {
        // hasOwn: que "constructor", "__proto__", etc. no cuenten como listas
        if (!Object.hasOwn(ESQUEMAS, req.params.lista)) throw noEncontrado('Lista inexistente')
        const esquema = ESQUEMAS[req.params.lista]
        // En la edición el ámbito de una categoría no se cambia
        const final = parcial ? esquema.partial().omit({ ambito: true }) : esquema
        return validar(final)(req, res, next)
    }
}

router.get('/', configuracionControlador.obtener)
router.post('/:lista', validarLista(false), permisoDe, configuracionControlador.crear)
router.patch('/:lista/:id', idValido, validarLista(true), permisoDe, configuracionControlador.actualizar)
router.delete('/:lista/:id', idValido, (req, res, next) => {
    if (!Object.hasOwn(ESQUEMAS, req.params.lista)) throw noEncontrado('Lista inexistente')
    next()
}, permisoDe, configuracionControlador.eliminar)

export default router
