import express from 'express'
import { z } from 'zod'
import * as adminControlador from '../controladores/adminControlador.js'
import { auth } from '../middlewares/auth.js'
import { superadmin } from '../middlewares/superadmin.js'
import { idValido, validar } from '../middlewares/validar.js'
import { fecha } from '../utilidades/esquemas.js'
import { adminUsuariosRutas } from './equipoRutas.js'

// Panel de plataforma: solo usuarios con es_superadmin. No usa X-Empresa-Id.
const router = express.Router()
router.use(auth, superadmin)

const filtro = z.object({
    buscar: z.string().trim().max(100).optional().transform((v) => v || undefined),
    estado: z.enum(['activa', 'suspendida', 'cancelada']).optional(),
})

const esquemaSuscripcion = z.object({
    planCodigo: z.string().trim().max(30).optional(),
    estado: z.enum(['prueba', 'activa', 'vencida', 'cancelada']).optional(),
    pruebaHasta: fecha.nullable().optional(),
    periodoFin: fecha.nullable().optional(),   // null = sin vencimiento (contrato indefinido)
}).refine((d) => Object.keys(d).length > 0, 'No hay cambios')

router.get('/resumen', adminControlador.resumen)
router.get('/planes', adminControlador.planes)
router.get('/empresas', validar(filtro, 'query'), adminControlador.listarEmpresas)
router.get('/empresas/:id', idValido, adminControlador.detalleEmpresa)
router.patch('/empresas/:id/estado', idValido,
    validar(z.object({ estado: z.enum(['activa', 'suspendida']) })), adminControlador.cambiarEstado)
router.patch('/empresas/:id/suscripcion', idValido, validar(esquemaSuscripcion), adminControlador.guardarSuscripcion)
router.use('/empresas/:id/usuarios', idValido, adminUsuariosRutas)

export default router
