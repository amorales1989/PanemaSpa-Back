import { pool, poolAdmin } from '../config/db.js'
import { ErrorApi, sinPermiso } from '../utilidades/errores.js'

// Solo el equipo de la plataforma (usuarios.es_superadmin). Se consulta en cada request:
// quitar el permiso tiene efecto inmediato.
export async function superadmin(req, res, next) {
    if (!poolAdmin) throw new ErrorApi(503, 'ADMIN_NO_CONFIGURADO', 'Falta DATABASE_URL_ADMIN en el servidor')
    const { rows } = await pool.query('select es_superadmin, activo from usuarios where id = $1', [req.usuario.id])
    if (!rows[0]?.es_superadmin || !rows[0].activo) throw sinPermiso()
    next()
}
