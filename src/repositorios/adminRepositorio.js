// Panel de plataforma. Usa poolAdmin (dueño de las tablas): ve TODAS las empresas.
// Solo se llama desde rutas protegidas por el middleware superadmin.
import { poolAdmin } from '../config/db.js'

const db = () => poolAdmin

// Suscripción "actual" de cada empresa: la vigente (prueba/activa) o, si no hay, la última
const SUSCRIPCION_ACTUAL = `
    left join lateral (
        select s.* from suscripciones s where s.empresa_id = e.id
        order by (s.estado in ('prueba', 'activa')) desc, s.created_at desc limit 1
    ) s on true
    left join planes p on p.id = s.plan_id`

export async function resumen() {
    const { rows } = await db().query(`
        select
            (select count(*) from empresas where deleted_at is null) as empresas,
            (select count(*) from empresas where deleted_at is null and estado = 'activa') as activas,
            (select count(*) from empresas where deleted_at is null and estado = 'suspendida') as suspendidas,
            (select count(*) from empresas where deleted_at is null and created_at >= now() - interval '30 days') as nuevas_30d,
            (select count(*) from usuarios where activo) as usuarios,
            (select count(*) from suscripciones where estado = 'prueba') as en_prueba,
            (select count(*) from suscripciones where estado = 'prueba' and prueba_hasta <= current_date + 7) as pruebas_por_vencer,
            (select count(*) from ventas where estado = 'confirmada' and fecha >= current_date - 29) as ventas_30d,
            (select coalesce(sum(total), 0) from ventas where estado = 'confirmada' and fecha >= current_date - 29) as monto_30d`)
    return rows[0]
}

export async function listarEmpresas({ buscar, estado }) {
    const { rows } = await db().query(
        `select e.id, e.nombre, e.slug, e.estado, e.moneda, e.created_at,
                p.codigo as plan_codigo, p.nombre as plan, s.estado as suscripcion, s.prueba_hasta, s.periodo_fin,
                (select count(*) from empresa_usuarios eu where eu.empresa_id = e.id and eu.estado = 'activo') as usuarios,
                (select u.email from empresa_usuarios eu join roles r on r.id = eu.rol_id join usuarios u on u.id = eu.usuario_id
                 where eu.empresa_id = e.id and r.codigo = 'dueno' order by eu.created_at limit 1) as dueno_email,
                v.ventas_30d, v.monto_30d,
                greatest(v.ultima_venta, ua.ultimo_acceso) as ultima_actividad
         from empresas e
         ${SUSCRIPCION_ACTUAL}
         left join lateral (
             select count(*) filter (where fecha >= current_date - 29) as ventas_30d,
                    coalesce(sum(total) filter (where fecha >= current_date - 29), 0) as monto_30d,
                    max(created_at) as ultima_venta
             from ventas where empresa_id = e.id and estado = 'confirmada'
         ) v on true
         left join lateral (
             select max(u.ultimo_acceso_en) as ultimo_acceso
             from empresa_usuarios eu join usuarios u on u.id = eu.usuario_id where eu.empresa_id = e.id
         ) ua on true
         where e.deleted_at is null
           and ($1::text is null or e.nombre ilike '%' || $1 || '%' or e.slug ilike '%' || $1 || '%'
                or exists (select 1 from empresa_usuarios eu join usuarios u on u.id = eu.usuario_id
                           where eu.empresa_id = e.id and u.email ilike '%' || $1 || '%'))
           and ($2::text is null or e.estado = $2)
         order by e.created_at desc`,
        [buscar ?? null, estado ?? null],
    )
    return rows
}

export async function buscarEmpresa(id) {
    const { rows } = await db().query(
        `select e.id, e.nombre, e.razon_social, e.rut, e.slug, e.estado, e.moneda, e.zona_horaria, e.created_at,
                s.id as suscripcion_id, p.codigo as plan_codigo, p.nombre as plan, s.estado as suscripcion,
                s.prueba_hasta, s.periodo_inicio, s.periodo_fin,
                (select count(*) from productos where empresa_id = e.id and deleted_at is null) as productos,
                (select count(*) from ventas where empresa_id = e.id and estado = 'confirmada') as ventas,
                (select coalesce(sum(total), 0) from ventas where empresa_id = e.id and estado = 'confirmada') as monto_ventas,
                (select count(*) from sucursales where empresa_id = e.id) as sucursales
         from empresas e ${SUSCRIPCION_ACTUAL}
         where e.id = $1 and e.deleted_at is null`,
        [id],
    )
    return rows[0] ?? null
}

export async function usuariosDeEmpresa(empresaId) {
    const { rows } = await db().query(
        `select eu.id as membresia_id, u.id, u.email, u.nombre, r.codigo as rol_codigo, r.nombre as rol,
                eu.estado, u.activo, u.ultimo_acceso_en, eu.created_at
         from empresa_usuarios eu
         join usuarios u on u.id = eu.usuario_id
         join roles r on r.id = eu.rol_id
         where eu.empresa_id = $1
         order by eu.created_at`,
        [empresaId],
    )
    return rows
}

export async function historialSuscripciones(empresaId) {
    const { rows } = await db().query(
        `select s.id, p.codigo as plan_codigo, p.nombre as plan, s.estado, s.prueba_hasta, s.periodo_inicio, s.periodo_fin, s.created_at
         from suscripciones s join planes p on p.id = s.plan_id
         where s.empresa_id = $1 order by s.created_at desc`,
        [empresaId],
    )
    return rows
}

export async function planes() {
    const { rows } = await db().query(
        'select codigo, nombre, precio_mensual, moneda, max_usuarios, max_sucursales, max_productos, activo from planes order by precio_mensual',
    )
    return rows
}

export const cambiarEstado = async (id, estado) =>
    (await db().query('update empresas set estado = $2 where id = $1 and deleted_at is null', [id, estado])).rowCount

// Modifica la suscripción actual o crea una si la empresa no tiene
export async function guardarSuscripcion(empresaId, cambios) {
    const cliente = await db().connect()
    try {
        await cliente.query('begin')
        const actual = (await cliente.query(
            `select id from suscripciones where empresa_id = $1
             order by (estado in ('prueba', 'activa')) desc, created_at desc limit 1 for update`,
            [empresaId],
        )).rows[0]
        const planId = cambios.planCodigo
            ? (await cliente.query('select id from planes where codigo = $1', [cambios.planCodigo])).rows[0]?.id
            : undefined
        if (cambios.planCodigo && !planId) {
            await cliente.query('rollback')
            return { error: 'PLAN_INEXISTENTE' }
        }
        if (actual) {
            await cliente.query(
                `update suscripciones set
                    plan_id = coalesce($2, plan_id),
                    estado = coalesce($3, estado),
                    prueba_hasta = case when $4::boolean then $5::date else prueba_hasta end,
                    periodo_fin = coalesce($6::date, periodo_fin)
                 where id = $1`,
                [actual.id, planId ?? null, cambios.estado ?? null, cambios.pruebaHasta !== undefined,
                    cambios.pruebaHasta ?? null, cambios.periodoFin ?? null],
            )
        } else {
            await cliente.query(
                `insert into suscripciones (empresa_id, plan_id, estado, prueba_hasta, periodo_inicio, periodo_fin)
                 values ($1, coalesce($2, (select id from planes where codigo = 'basico')), coalesce($3, 'activa'),
                         $4::date, current_date, coalesce($5::date, current_date + 30))`,
                [empresaId, planId ?? null, cambios.estado ?? null, cambios.pruebaHasta ?? null, cambios.periodoFin ?? null],
            )
        }
        await cliente.query('commit')
        return { ok: true }
    } catch (error) {
        await cliente.query('rollback')
        throw error
    } finally {
        cliente.release()
    }
}

export const auditar = (usuarioId, empresaId, accion, datos, ip) =>
    db().query(
        `insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos, ip)
         values ($2, $1, $3, 'empresa', $2, $4, $5)`,
        [usuarioId, empresaId, accion, JSON.stringify(datos), ip ?? null],
    )
