import express from 'express'
import { z } from 'zod'
import * as adminControlador from '../controladores/adminControlador.js'
import { auth } from '../middlewares/auth.js'
import { superadmin } from '../middlewares/superadmin.js'
import { idValido, validar } from '../middlewares/validar.js'
import { fecha } from '../utilidades/esquemas.js'
import { adminUsuariosRutas } from './equipoRutas.js'
import { CODIGOS_PAIS, PAIS_POR_DEFECTO } from '../utilidades/paises.js'

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

const pais = z.enum(CODIGOS_PAIS).default(PAIS_POR_DEFECTO)
router.post('/empresas', validar(z.object({
    nombre: z.string().trim().min(2).max(100),
    pais,
    duenoNombre: z.string().trim().min(2).max(100),
    duenoEmail: z.string().trim().toLowerCase().email('Email inválido').max(200),
})), adminControlador.crearEmpresa)
router.patch('/empresas/:id/pais', idValido, validar(z.object({ pais: z.enum(CODIGOS_PAIS) })), adminControlador.cambiarPais)

// Demos para mostrarle la app a posibles clientes
const generacion = {
    dias: z.number().int().min(7).max(365).default(180),
    ventasDia: z.number().int().min(5).max(300).default(30),
}
router.post('/demos', validar(z.object({
    nombre: z.string().trim().min(2).max(100),
    pais,
    catalogo: z.boolean().default(true),   // catálogo de ejemplo y movimientos generados
    ...generacion,
})), adminControlador.crearDemo)
router.post('/empresas/:id/demo/regenerar', idValido, validar(z.object(generacion)), adminControlador.regenerarDemo)
router.delete('/empresas/:id/demo', idValido, adminControlador.eliminarDemo)

export default router
