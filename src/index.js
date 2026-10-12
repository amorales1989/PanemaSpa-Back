import { env } from './config/env.js'
import { pool } from './config/db.js'
import { app } from './app.js'
import { logger } from './utilidades/logger.js'

process.on('unhandledRejection', (motivo) => {
    logger.error({ err: motivo }, '[unhandledRejection] Promesa rechazada sin capturar')
})

const servidor = app.listen(env.PORT, () => {
    logger.info(`API de Panema escuchando en el puerto ${env.PORT}`)
})

// Apagado ordenado (docker stop / deploy): termina requests en curso y cierra la BD
const apagar = (senal) => {
    logger.info(`${senal} recibido, cerrando...`)
    servidor.close(async () => {
        await pool.end()
        process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => apagar('SIGTERM'))
process.on('SIGINT', () => apagar('SIGINT'))
