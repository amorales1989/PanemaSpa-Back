import pg from 'pg'
import { env } from './env.js'

// numeric (dinero, cantidades) llega como string por defecto: lo pasamos a number.
// Seguro para CLP y montos < 9 billones; si algún día se manejan montos mayores, revisar.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)))
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)))
// date → 'YYYY-MM-DD' (sin conversión a Date ni zona horaria)
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

export const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
})

pool.on('error', (error) => {
    console.error('[pg] Error en conexión inactiva:', error.message)
})
