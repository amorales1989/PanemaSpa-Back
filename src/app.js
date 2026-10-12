import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { env } from './config/env.js'
import { pool } from './config/db.js'
import { auth } from './middlewares/auth.js'
import { empresa } from './middlewares/empresa.js'
import { manejarErrores, noEncontrada } from './middlewares/errores.js'

import authRutas from './rutas/authRutas.js'
import configuracionRutas from './rutas/configuracionRutas.js'

export const app = express()

// Detrás de proxies (Coolify y, si aplica, Vercel): req.ip toma la IP real del cliente (rate limit y sesiones)
app.set('trust proxy', env.TRUST_PROXY)
app.disable('x-powered-by')

app.use(helmet())
app.use(cors({
    origin: env.origenes,
    credentials: true, // la cookie del refresh token
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Empresa-Id', 'Idempotency-Key'],
}))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

// Fotos de productos (volumen persistente en UPLOADS_DIR)
app.use('/uploads', express.static(env.UPLOADS_DIR, {
    maxAge: '7d',
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
}))

app.get('/salud', async (req, res) => {
    await pool.query('select 1')
    res.json({ estado: 'ok', mensaje: 'API de Panema funcionando correctamente' })
})

// Públicas (o con auth propia)
app.use('/v1/auth', authRutas)

// De aquí en adelante: usuario autenticado + empresa activa (X-Empresa-Id)
const deEmpresa = express.Router()
deEmpresa.use(auth, empresa)
deEmpresa.use('/config', configuracionRutas)
// Próximas fases: productos, insumos, promos, ventas, egresos, mermas, estadisticas, equipo
app.use('/v1', deEmpresa)

app.use(noEncontrada)
app.use(manejarErrores)
