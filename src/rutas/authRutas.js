import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import * as authControlador from '../controladores/authControlador.js'
import { validar } from '../middlewares/validar.js'
import { auth } from '../middlewares/auth.js'
import { env } from '../config/env.js'

const router = express.Router()

// Frena fuerza bruta: 10 intentos cada 15 min por IP en login/registro
const limiteAcceso = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    message: { error: 'Demasiados intentos, espera unos minutos', codigo: 'DEMASIADOS_INTENTOS' },
})

const email = z.string().trim().toLowerCase().email('Email inválido').max(200)

const esquemaRegistro = z.object({
    nombre: z.string().trim().min(2).max(100),
    email,
    password: z.string().min(8, 'Mínimo 8 caracteres').max(200),
    nombreEmpresa: z.string().trim().min(2).max(100),
})

const esquemaLogin = z.object({
    email,
    password: z.string().min(1).max(200),
})

router.post('/registro', limiteAcceso, validar(esquemaRegistro), authControlador.registrar)
router.post('/login', limiteAcceso, validar(esquemaLogin), authControlador.iniciarSesion)
router.post('/refresh', authControlador.refrescar)
router.post('/logout', authControlador.cerrarSesion)
router.get('/yo', auth, authControlador.perfil)

const esquemaPassword = z.object({
    actual: z.string().min(1).max(200),
    nueva: z.string().min(8, 'Mínimo 8 caracteres').max(200),
}).refine((d) => d.actual !== d.nueva, { message: 'La nueva contraseña debe ser distinta', path: ['nueva'] })

router.post('/cambiar-password', limiteAcceso, auth, validar(esquemaPassword), authControlador.cambiarPassword)

export default router
