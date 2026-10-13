// Reglas compartidas por ventas, egresos y mermas
import { conflicto, datosInvalidos, noEncontrado, sinPermiso } from '../utilidades/errores.js'

// "Hoy" en la zona horaria de la empresa (no la del servidor)
export async function hoyEmpresa(db, zonaHoraria) {
    const { rows } = await db.query('select (now() at time zone $1)::date::text as hoy', [zonaHoraria])
    return rows[0].hoy
}

// Fecha del registro: la enviada (no futura) o hoy.
// Una fecha anterior requiere el permiso movimientos.fecha_anterior (el Vendedor registra siempre hoy).
export async function resolverFecha(db, req, fecha) {
    const hoy = await hoyEmpresa(db, req.empresa.zonaHoraria)
    if (!fecha || fecha === hoy) return hoy
    if (fecha > hoy) throw datosInvalidos({ fecha: ['No puede ser una fecha futura'] })
    if (!req.permisos.has('movimientos.fecha_anterior')) throw sinPermiso('No tienes permiso para registrar con una fecha anterior')
    return fecha
}

// Sucursal del registro: la enviada (si el usuario tiene acceso) o la primera disponible
export async function resolverSucursal(db, req, sucursalId) {
    const { todasSucursales, id: membresiaId } = req.membresia
    const { rows } = await db.query(
        `select s.id from sucursales s
         where s.activa and ($1::uuid is null or s.id = $1)
           and ($2 or exists (select 1 from empresa_usuario_sucursales eus
                              where eus.sucursal_id = s.id and eus.empresa_usuario_id = $3))
         order by s.created_at limit 1`,
        [sucursalId ?? null, todasSucursales, membresiaId],
    )
    if (!rows[0]) {
        if (sucursalId) throw datosInvalidos({ sucursalId: ['La sucursal no existe, está inactiva o no tienes acceso'] })
        throw sinPermiso('No tienes una sucursal asignada')
    }
    return rows[0].id
}

// canal / método de pago / motivo: debe existir en la empresa y estar activo
export async function verificarActivo(db, tabla, id, campo) {
    const { rows } = await db.query(`select activo from ${tabla} where id = $1`, [id])
    if (!rows[0]?.activo) throw datosInvalidos({ [campo]: ['No existe o está desactivado'] })
}

// Las unidades se venden/compran enteras; kilos y litros admiten decimales
export function validarCantidad(unidad, cantidad, campo) {
    if (unidad === 'un' && !Number.isInteger(cantidad)) {
        throw datosInvalidos({ [campo]: ['Los productos por unidad van en cantidades enteras'] })
    }
}

// Resultado de un update "... where estado = confirmado returning id"
export async function verificarAnulacion(filas, existe) {
    if (filas) return
    if (await existe()) throw conflicto('YA_ANULADO', 'El registro ya estaba anulado')
    throw noEncontrado()
}
