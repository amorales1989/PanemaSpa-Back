import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { env } from '../config/env.js'

const secreto = new TextEncoder().encode(env.JWT_SECRET)

export const DURACION_ACCESO = '15m'
export const DIAS_REFRESH = 30

// Access token: corto, va en el header Authorization y vive en memoria del front
export const firmarAcceso = (usuarioId, sesionId) =>
    new SignJWT({ sid: sesionId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(usuarioId)
        .setIssuedAt()
        .setExpirationTime(DURACION_ACCESO)
        .sign(secreto)

export async function verificarAcceso(token) {
    const { payload } = await jwtVerify(token, secreto, { algorithms: ['HS256'] })
    return { usuarioId: payload.sub, sesionId: payload.sid }
}

// Refresh token: opaco, va en cookie httpOnly. En la BD se guarda solo su hash.
export const tokenAleatorio = () => randomBytes(32).toString('base64url')
export const hashToken = (token) => createHash('sha256').update(token).digest('hex')
