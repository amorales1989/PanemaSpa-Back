import { verificarAcceso } from '../utilidades/tokens.js'
import { noAutenticado } from '../utilidades/errores.js'

// Verifica "Authorization: Bearer <token>" → req.usuario = { id, sesionId }
export async function auth(req, res, next) {
    const [tipo, token] = (req.headers.authorization ?? '').split(' ')
    if (tipo !== 'Bearer' || !token) throw noAutenticado()
    try {
        const { usuarioId, sesionId } = await verificarAcceso(token)
        req.usuario = { id: usuarioId, sesionId }
    } catch {
        throw noAutenticado('La sesión expiró')
    }
    next()
}
