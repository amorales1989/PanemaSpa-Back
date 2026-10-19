import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { env } from './config/env.js'
import { pool } from './config/db.js'
import { auth } from './middlewares/auth.js'
import { empresa } from './middlewares/empresa.js'
import { manejarErrores, noEncontrada } from './middlewares/errores.js'

import { camelizar } from './utilidades/camel.js'
import authRutas from './rutas/authRutas.js'
import adminRutas from './rutas/adminRutas.js'
import configuracionRutas from './rutas/configuracionRutas.js'
import productoRutas from './rutas/productoRutas.js'
import insumoRutas from './rutas/insumoRutas.js'
import promoRutas from './rutas/promoRutas.js'
import { egresoRutas, mermaRutas, ventaRutas } from './rutas/movimientoRutas.js'
import { equipoRutas } from './rutas/equipoRutas.js'
import empresaRutas from './rutas/empresaRutas.js'
import importacionRutas from './rutas/importacionRutas.js'
import clienteRutas from './rutas/clienteRutas.js'
import proveedorRutas from './rutas/proveedorRutas.js'
import stockRutas from './rutas/stockRutas.js'

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
// 3 MB: alcanza para la foto de un producto en base64 (~1,5 MB)
app.use(express.json({ limit: '3mb' }))
app.use(cookieParser())

// Todas las respuestas JSON en camelCase (la BD usa snake_case)
app.use((req, res, next) => {
    const json = res.json.bind(res)
    res.json = (cuerpo) => json(camelizar(cuerpo))
    next()
})

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
// Panel de plataforma (superadmin), sin empresa activa
app.use('/v1/admin', adminRutas)

// De aquí en adelante: usuario autenticado + empresa activa (X-Empresa-Id)
const deEmpresa = express.Router()
deEmpresa.use(auth, empresa)
deEmpresa.use('/config', configuracionRutas)
deEmpresa.use('/productos', productoRutas)
deEmpresa.use('/insumos', insumoRutas)
deEmpresa.use('/promos', promoRutas)
deEmpresa.use('/ventas', ventaRutas)
deEmpresa.use('/egresos', egresoRutas)
deEmpresa.use('/mermas', mermaRutas)
deEmpresa.use('/stock', stockRutas)
deEmpresa.use('/equipo', equipoRutas)
deEmpresa.use('/empresa', empresaRutas)
deEmpresa.use('/importar', importacionRutas)
deEmpresa.use('/proveedores', proveedorRutas)
deEmpresa.use('/clientes', clienteRutas)
// Próximas fases: estadisticas
app.use('/v1', deEmpresa)

app.use(noEncontrada)
app.use(manejarErrores)
