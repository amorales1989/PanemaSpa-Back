import pino from 'pino'

export const logger = pino({
    level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    // Nunca loguear credenciales
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.contrasena'],
})
