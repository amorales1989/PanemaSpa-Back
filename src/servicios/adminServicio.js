import * as adminRepositorio from '../repositorios/adminRepositorio.js'
import { invalidarEmpresa } from '../middlewares/empresa.js'
import { datosInvalidos, noEncontrado } from '../utilidades/errores.js'
import { logger } from '../utilidades/logger.js'

export const resumen = () => adminRepositorio.resumen()
export const listarEmpresas = (filtros) => adminRepositorio.listarEmpresas(filtros)
export const planes = () => adminRepositorio.planes()

export async function detalleEmpresa(id) {
    const empresa = await adminRepositorio.buscarEmpresa(id)
    if (!empresa) throw noEncontrado('Empresa no encontrada')
    return {
        ...empresa,
        usuarios: await adminRepositorio.usuariosDeEmpresa(id),
        suscripciones: await adminRepositorio.historialSuscripciones(id),
    }
}

// Suspendida: sus usuarios reciben 403 EMPRESA_SUSPENDIDA en todas las rutas de la empresa
export async function cambiarEstado(req, id, estado) {
    if (!(await adminRepositorio.cambiarEstado(id, estado))) throw noEncontrado('Empresa no encontrada')
    invalidarEmpresa(id) // que el cambio aplique ya, sin esperar el caché de membresías
    await adminRepositorio.auditar(req.usuario.id, id, `admin.empresa.${estado === 'activa' ? 'reactivar' : 'suspender'}`, { estado }, req.ip)
    logger.info({ empresaId: id, estado, por: req.usuario.id }, 'cambio de estado de empresa')
    return detalleEmpresa(id)
}

export async function guardarSuscripcion(req, id, cambios) {
    if (!(await adminRepositorio.buscarEmpresa(id))) throw noEncontrado('Empresa no encontrada')
    const r = await adminRepositorio.guardarSuscripcion(id, cambios)
    if (r.error) throw datosInvalidos({ planCodigo: ['El plan no existe'] })
    await adminRepositorio.auditar(req.usuario.id, id, 'admin.suscripcion', cambios, req.ip)
    return detalleEmpresa(id)
}
