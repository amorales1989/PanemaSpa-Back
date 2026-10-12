// Gestión del equipo de una empresa. La usan dos actores:
//  - el superadmin desde el panel de plataforma (/v1/admin/empresas/:id/usuarios)
//  - el dueño/administrador desde la app (/v1/equipo), con permiso usuarios.gestionar
//
// actor: { usuarioId, superadmin: bool, esDueno: bool, ip }
import { randomInt } from 'node:crypto'
import argon2 from 'argon2'
import { transaccion } from '../db/contexto.js'
import * as equipoRepositorio from '../repositorios/equipoRepositorio.js'
import * as usuarioRepositorio from '../repositorios/usuarioRepositorio.js'
import { invalidarMembresia } from '../middlewares/empresa.js'
import { conflicto, datosInvalidos, noEncontrado, sinPermiso } from '../utilidades/errores.js'

// Sin caracteres que se confunden al dictarla (0/O, 1/l/I)
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const passwordTemporal = () => Array.from({ length: 10 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')

const auditar = (db, actor, empresaId, accion, entidadId, datos) =>
    db.query(
        `insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos, ip)
         values ($1, $2, $3, 'membresia', $4, $5, $6)`,
        [empresaId, actor.usuarioId, accion, entidadId, JSON.stringify(datos ?? null), actor.ip ?? null],
    )

// Solo un dueño (o el superadmin) puede nombrar dueños o tocar a un dueño
const puedeTocarDuenos = (actor) => actor.superadmin || actor.esDueno

export const listar = (empresaId) =>
    transaccion(async (db) => ({
        miembros: await equipoRepositorio.listar(db, empresaId),
        roles: await equipoRepositorio.roles(db, empresaId),
    }))

// Si el email no tiene cuenta, se crea con contraseña temporal (se devuelve UNA vez).
// Si ya tiene cuenta (por ejemplo en otra empresa), solo se le da acceso a esta.
export async function agregar(actor, empresaId, { nombre, email, rolId }) {
    const temporal = passwordTemporal()
    const hash = await argon2.hash(temporal)
    return transaccion(async (db) => {
        const rol = await equipoRepositorio.rol(db, empresaId, rolId)
        if (!rol) throw datosInvalidos({ rolId: ['Rol inválido'] })
        if (rol.codigo === 'dueno' && !puedeTocarDuenos(actor)) throw sinPermiso('Solo un dueño puede nombrar a otro dueño')

        const existente = await usuarioRepositorio.buscarPorEmail(db, email)
        const usuarioId = existente?.id ?? (await equipoRepositorio.crearUsuario(db, { email, nombre, passwordHash: hash }))
        const membresiaId = await equipoRepositorio.agregarMiembro(db, { empresaId, usuarioId, rolId, invitadoPor: actor.usuarioId })
        if (!membresiaId) throw conflicto('YA_ES_MIEMBRO', 'Esa persona ya es parte del equipo')

        await auditar(db, actor, empresaId, 'equipo.agregar', membresiaId, { email, rol: rol.codigo, cuentaNueva: !existente })
        return {
            membresiaId,
            cuentaNueva: !existente,
            // Solo para cuentas nuevas: se muestra una única vez para entregársela a la persona
            passwordTemporal: existente ? null : temporal,
        }
    })
}

export function actualizar(actor, empresaId, membresiaId, { rolId, estado }) {
    return transaccion(async (db) => {
        const m = await equipoRepositorio.membresia(db, empresaId, membresiaId)
        if (!m) throw noEncontrado('Miembro no encontrado')
        if (m.usuario_id === actor.usuarioId && !actor.superadmin) {
            throw conflicto('PROPIA_CUENTA', 'No puedes cambiar tu propio rol ni suspenderte')
        }
        const nuevoRol = rolId ? await equipoRepositorio.rol(db, empresaId, rolId) : null
        if (rolId && !nuevoRol) throw datosInvalidos({ rolId: ['Rol inválido'] })

        const tocaDueno = m.rol_codigo === 'dueno' || nuevoRol?.codigo === 'dueno'
        if (tocaDueno && !puedeTocarDuenos(actor)) throw sinPermiso('Solo un dueño puede modificar a un dueño')

        // Nunca dejar la empresa sin un dueño activo
        const dejaDeSerDuenoActivo = m.rol_codigo === 'dueno' && m.estado === 'activo'
            && ((nuevoRol && nuevoRol.codigo !== 'dueno') || estado === 'suspendido')
        if (dejaDeSerDuenoActivo && (await equipoRepositorio.otrosDuenosActivos(db, empresaId, membresiaId)) === 0) {
            throw conflicto('ULTIMO_DUENO', 'La empresa tiene que tener al menos un dueño activo')
        }

        await equipoRepositorio.actualizarMiembro(db, membresiaId, { rolId, estado })
        await auditar(db, actor, empresaId, 'equipo.actualizar', membresiaId, { rol: nuevoRol?.codigo, estado })
        invalidarMembresia(m.usuario_id, empresaId) // el cambio aplica ya, no en 60 s
        return (await equipoRepositorio.listar(db, empresaId)).find((x) => x.membresia_id === membresiaId)
    })
}

// Nueva contraseña temporal + cierra sus sesiones. El dueño solo puede hacerlo con
// personas que pertenecen únicamente a su empresa (si no, afectaría otras empresas).
export async function restablecerPassword(actor, empresaId, membresiaId) {
    const temporal = passwordTemporal()
    const hash = await argon2.hash(temporal)
    return transaccion(async (db) => {
        const m = await equipoRepositorio.membresia(db, empresaId, membresiaId)
        if (!m) throw noEncontrado('Miembro no encontrado')
        if (m.usuario_id === actor.usuarioId) throw conflicto('PROPIA_CUENTA', 'Para tu cuenta usa "Cambiar contraseña"')
        if (m.rol_codigo === 'dueno' && !puedeTocarDuenos(actor)) throw sinPermiso('Solo un dueño puede modificar a un dueño')
        if (!actor.superadmin && !(await equipoRepositorio.soloEnEstaEmpresa(db, m.usuario_id, empresaId))) {
            throw conflicto('OTRAS_EMPRESAS', 'Esta persona usa su cuenta en otras empresas: pídele que use "olvidé mi contraseña"')
        }
        await equipoRepositorio.ponerPasswordTemporal(db, m.usuario_id, hash)
        await auditar(db, actor, empresaId, 'equipo.restablecer_password', membresiaId)
        return { passwordTemporal: temporal }
    })
}

// Eliminar del equipo: quita el acceso a esta empresa (nadie se elimina a sí mismo,
// solo un dueño elimina dueños y siempre queda al menos un dueño activo)
export function eliminar(actor, empresaId, membresiaId) {
    return transaccion(async (db) => {
        const m = await equipoRepositorio.membresia(db, empresaId, membresiaId)
        if (!m) throw noEncontrado('Miembro no encontrado')
        if (m.usuario_id === actor.usuarioId) throw conflicto('PROPIA_CUENTA', 'No puedes eliminar tu propio usuario')
        if (m.rol_codigo === 'dueno' && !puedeTocarDuenos(actor)) throw sinPermiso('Solo un dueño puede eliminar a un dueño')
        if (m.rol_codigo === 'dueno' && m.estado === 'activo' && (await equipoRepositorio.otrosDuenosActivos(db, empresaId, membresiaId)) === 0) {
            throw conflicto('ULTIMO_DUENO', 'La empresa tiene que tener al menos un dueño activo')
        }
        await equipoRepositorio.quitarMiembro(db, membresiaId)
        await auditar(db, actor, empresaId, 'equipo.eliminar', membresiaId, { usuarioId: m.usuario_id, rol: m.rol_codigo })
        invalidarMembresia(m.usuario_id, empresaId) // pierde el acceso ya, aunque tenga la sesión abierta
    })
}
