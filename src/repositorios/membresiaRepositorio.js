import { pool } from '../config/db.js'

// Membresía activa del usuario en la empresa + permisos de su rol, en una sola consulta.
// Devuelve null si no es miembro activo.
export async function buscarActiva(usuarioId, empresaId) {
    const { rows } = await pool.query(
        `select eu.id as membresia_id, eu.todas_sucursales,
                e.id, e.nombre, e.slug, e.moneda, e.decimales, e.zona_horaria, e.estado,
                r.codigo as rol_codigo,
                coalesce(array_agg(rp.permiso_codigo) filter (where rp.permiso_codigo is not null), '{}') as permisos
         from empresa_usuarios eu
         join empresas e on e.id = eu.empresa_id and e.deleted_at is null
         join roles r on r.id = eu.rol_id
         left join rol_permisos rp on rp.rol_id = r.id
         where eu.usuario_id = $1 and eu.empresa_id = $2 and eu.estado = 'activo'
         group by eu.id, e.id, r.id`,
        [usuarioId, empresaId],
    )
    const f = rows[0]
    if (!f) return null
    return {
        empresa: {
            id: f.id, nombre: f.nombre, slug: f.slug, moneda: f.moneda,
            decimales: f.decimales, zonaHoraria: f.zona_horaria, estado: f.estado,
        },
        membresia: { id: f.membresia_id, rol: f.rol_codigo, todasSucursales: f.todas_sucursales },
        permisos: new Set(f.permisos),
    }
}
