import { ErrorApi } from '../utilidades/errores.js'
import { logger } from '../utilidades/logger.js'

// Violaciones de restricciones de Postgres que tienen sentido para el usuario
const ERRORES_PG = {
    23505: [409, 'DUPLICADO', 'Ya existe un registro con esos datos'],
    23503: [400, 'REFERENCIA_INVALIDA', 'Uno de los datos referenciados no existe'],
    23514: [400, 'DATOS_INVALIDOS', 'Algún valor no cumple las reglas'],
    42501: [403, 'SIN_PERMISO', 'Operación no permitida'],
}

export function noEncontrada(req, res) {
    res.status(404).json({ error: 'Ruta no encontrada', codigo: 'RUTA_NO_ENCONTRADA' })
}

// eslint-disable-next-line no-unused-vars
export function manejarErrores(error, req, res, next) {
    if (error instanceof ErrorApi) {
        return res.status(error.status).json({ error: error.message, codigo: error.codigo, detalles: error.detalles })
    }
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'JSON inválido', codigo: 'JSON_INVALIDO' })
    }
    const pgError = ERRORES_PG[error.code]
    if (pgError) {
        const [status, codigo, mensaje] = pgError
        logger.warn({ codigo: error.code, constraint: error.constraint, ruta: req.originalUrl }, 'restricción de BD')
        return res.status(status).json({ error: mensaje, codigo })
    }
    logger.error({ err: error, ruta: req.originalUrl, metodo: req.method }, 'error no controlado')
    res.status(500).json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' })
}
