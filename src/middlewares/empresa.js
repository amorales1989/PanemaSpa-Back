// Resuelve la empresa activa desde el header X-Empresa-Id y verifica que el
// usuario sea miembro activo. Deja en req:
//   req.empresa   → { id, nombre, moneda, decimales, zonaHoraria, ... }
//   req.membresia → { id, rol, todasSucursales }
//   req.permisos  → Set de códigos ('ventas.crear', ...)
//   req.contexto  → { empresaId, usuarioId } para conEmpresa()
import * as membresiaRepositorio from '../repositorios/membresiaRepositorio.js'
import { ErrorApi, sinPermiso } from '../utilidades/errores.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TTL_MS = 60_000
const cache = new Map()

// Llamar cuando cambie el rol, estado o permisos de alguien
export const invalidarMembresia = (usuarioId, empresaId) => {
    if (empresaId) cache.delete(`${usuarioId}:${empresaId}`)
    else for (const k of cache.keys()) if (k.startsWith(`${usuarioId}:`)) cache.delete(k)
}
export const invalidarEmpresa = (empresaId) => {
    for (const k of cache.keys()) if (k.endsWith(`:${empresaId}`)) cache.delete(k)
}

async function obtener(usuarioId, empresaId) {
    const clave = `${usuarioId}:${empresaId}`
    const guardado = cache.get(clave)
    if (guardado && guardado.vence > Date.now()) return guardado.valor
    const valor = await membresiaRepositorio.buscarActiva(usuarioId, empresaId)
    cache.set(clave, { valor, vence: Date.now() + TTL_MS })
    return valor
}

export async function empresa(req, res, next) {
    const empresaId = req.headers['x-empresa-id']
    if (!empresaId || !UUID.test(empresaId)) {
        throw new ErrorApi(400, 'EMPRESA_REQUERIDA', 'Falta el header X-Empresa-Id')
    }
    const m = await obtener(req.usuario.id, empresaId)
    if (!m) throw sinPermiso('No perteneces a esta empresa')
    if (m.empresa.estado !== 'activa') {
        throw new ErrorApi(403, 'EMPRESA_SUSPENDIDA', 'La cuenta de esta empresa está suspendida')
    }
    req.empresa = m.empresa
    req.membresia = m.membresia
    req.permisos = m.permisos
    req.contexto = { empresaId, usuarioId: req.usuario.id }
    next()
}
