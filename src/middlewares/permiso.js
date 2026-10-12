import { sinPermiso } from '../utilidades/errores.js'

// router.post('/ventas', permiso('ventas.crear'), ...)
// Con varios códigos alcanza con tener uno: permiso('ventas.ver', 'ventas.ver_todas')
export const permiso = (...codigos) => (req, res, next) => {
    if (!codigos.some((c) => req.permisos?.has(c))) throw sinPermiso()
    next()
}

// Para decisiones dentro de un servicio/controlador (ej. ocultar costos)
export const tiene = (req, codigo) => req.permisos?.has(codigo) ?? false
