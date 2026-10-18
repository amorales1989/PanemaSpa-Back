import * as adminRepositorio from '../repositorios/adminRepositorio.js'
import * as empresaRepositorio from '../repositorios/empresaRepositorio.js'
import * as equipoServicio from './equipoServicio.js'
import { consultar, transaccion } from '../db/contexto.js'
import { PAISES } from '../utilidades/paises.js'
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

// Alta de un negocio desde el panel: empresa lista para usar, 14 días de prueba y su dueño.
// Si el dueño no tenía cuenta se crea con contraseña temporal (se devuelve una sola vez).
export async function crearEmpresa(req, { nombre, pais, duenoNombre, duenoEmail }) {
    const empresa = await transaccion(async (db) => {
        const e = await empresaRepositorio.crear(db, { nombre, slug: await empresaRepositorio.slugLibre(db, nombre), pais })
        await empresaRepositorio.inicializar(db, e.id, pais)
        await empresaRepositorio.crearSuscripcionPrueba(db, e.id)
        return e
    })
    const { rows } = await consultar("select id from roles where empresa_id is null and codigo = 'dueno'")
    const dueno = await equipoServicio.agregar({ usuarioId: req.usuario.id, superadmin: true, ip: req.ip }, empresa.id,
        { nombre: duenoNombre, email: duenoEmail, rolId: rows[0].id })
    await adminRepositorio.auditar(req.usuario.id, empresa.id, 'admin.empresa.crear', { nombre, pais, duenoEmail }, req.ip)
    logger.info({ empresaId: empresa.id, pais, por: req.usuario.id }, 'empresa creada desde el panel')
    return { id: empresa.id, cuentaNueva: dueno.cuentaNueva, passwordTemporal: dueno.passwordTemporal }
}

// Cambiar el país cambia también la moneda y el huso horario (no toca montos ni datos ya cargados)
export async function cambiarPais(req, id, pais) {
    const { moneda, zonaHoraria } = PAISES[pais]
    if (!(await adminRepositorio.cambiarPais(id, pais, moneda, zonaHoraria))) throw noEncontrado('Empresa no encontrada')
    invalidarEmpresa(id)
    await adminRepositorio.auditar(req.usuario.id, id, 'admin.empresa.pais', { pais }, req.ip)
    return detalleEmpresa(id)
}
