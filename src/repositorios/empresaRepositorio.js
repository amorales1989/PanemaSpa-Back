import { PAISES, PAIS_POR_DEFECTO } from '../utilidades/paises.js'
import { armarSet } from '../utilidades/sql.js'
import { slugificar } from '../utilidades/texto.js'

export const slugExiste = async (db, slug) => {
    const { rowCount } = await db.query('select 1 from empresas where slug = $1', [slug])
    return rowCount > 0
}

export async function slugLibre(db, nombre) {
    const base = slugificar(nombre)
    if (!(await slugExiste(db, base))) return base
    for (let i = 2; i < 100; i++) {
        const candidato = `${base}-${i}`
        if (!(await slugExiste(db, candidato))) return candidato
    }
    return `${base}-${Date.now().toString(36)}`
}

// El país fija la moneda y el huso horario
export const crear = async (db, { nombre, slug, esDemo = false, pais = PAIS_POR_DEFECTO }) => {
    const { moneda, zonaHoraria } = PAISES[pais]
    const { rows } = await db.query(
        `insert into empresas (nombre, slug, es_demo, pais, moneda, zona_horaria) values ($1, $2, $3, $4, $5, $6)
         returning id, nombre, slug, pais, moneda, zona_horaria`,
        [nombre, slug, esDemo, pais, moneda, zonaHoraria],
    )
    return rows[0]
}

export const agregarMiembro = (db, { empresaId, usuarioId, rolCodigo, invitadoPor = null }) =>
    db.query(
        `insert into empresa_usuarios (empresa_id, usuario_id, rol_id, invitado_por)
         select $1, $2, r.id, $4 from roles r where r.empresa_id is null and r.codigo = $3`,
        [empresaId, usuarioId, rolCodigo, invitadoPor],
    )

// Crea sucursal, canales, métodos de pago, categorías y motivos por defecto.
// Las tablas tienen RLS, así que primero se fija la empresa en la transacción.
export const inicializar = async (db, empresaId, pais = PAIS_POR_DEFECTO) => {
    await db.query("select set_config('app.empresa_id', $1, true)", [empresaId])
    await db.query('select inicializar_empresa($1)', [empresaId])
    // Medios de pago habituales del país (ej. Mercado Pago en Argentina)
    for (const nombre of PAISES[pais].metodosExtra) {
        await db.query(
            `insert into metodos_pago (empresa_id, nombre, orden)
             select $1, $2, coalesce(max(orden) + 1, 0) from metodos_pago where empresa_id = $1`, [empresaId, nombre])
    }
}

export const crearSuscripcionPrueba = (db, empresaId, dias = 14) =>
    db.query(
        `insert into suscripciones (empresa_id, plan_id, estado, prueba_hasta, periodo_inicio, periodo_fin)
         select $1, p.id, 'prueba', current_date + $2::int, current_date, current_date + $2::int
         from planes p where p.codigo = 'prueba'`,
        [empresaId, dias],
    )

// Empresas del usuario con su rol y permisos (para el selector de empresa del front)
export const listarDeUsuario = async (db, usuarioId) => {
    const { rows } = await db.query(
        `select e.id, e.nombre, e.slug, e.pais, e.moneda, e.decimales, e.zona_horaria, e.logo_url, e.estado,
                -- Datos que van en el comprobante de venta impreso
                e.razon_social, e.rut, e.direccion, e.telefono, e.comprobante_activo, e.comprobante_formato, e.comprobante_pie, e.control_stock,
                r.codigo as rol_codigo, r.nombre as rol_nombre,
                -- modo_propio: empresa con plan interno (ej. Fundador) que usa el sistema como su
                -- desarrollo propio. El front no muestra nada de planes, pruebas ni pagos.
                -- Nunca exponer acá el plan ni la suscripción. Las demos también: se muestran como propias.
                e.es_demo or not coalesce((select p.publico from suscripciones s join planes p on p.id = s.plan_id
                              where s.empresa_id = e.id and s.estado in ('prueba', 'activa') limit 1), true) as modo_propio,
                coalesce(array_agg(rp.permiso_codigo order by rp.permiso_codigo)
                         filter (where rp.permiso_codigo is not null), '{}') as permisos
         from empresa_usuarios eu
         join empresas e on e.id = eu.empresa_id and e.deleted_at is null
         join roles r on r.id = eu.rol_id
         left join rol_permisos rp on rp.rol_id = r.id
         where eu.usuario_id = $1 and eu.estado = 'activo'
         group by e.id, r.id
         order by e.nombre`,
        [usuarioId],
    )
    // Sin suscripción visible tampoco hay nada que gestionar
    return rows.map((r) => (r.modo_propio ? { ...r, permisos: r.permisos.filter((p) => p !== 'suscripcion.gestionar') } : r))
}

// Datos que el dueño puede ver y editar de su empresa (nunca plan ni suscripción)
const DATOS_EMPRESA = `id, nombre, razon_social, rut, slug, pais, moneda, zona_horaria, logo_url,
    direccion, telefono, comprobante_activo, comprobante_formato, comprobante_pie, control_stock`

const CAMPOS = {
    nombre: 'nombre', razonSocial: 'razon_social', rut: 'rut', direccion: 'direccion', telefono: 'telefono',
    comprobanteActivo: 'comprobante_activo', comprobanteFormato: 'comprobante_formato', comprobantePie: 'comprobante_pie',
    controlStock: 'control_stock',
}

export const datos = async (db, id) =>
    (await db.query(`select ${DATOS_EMPRESA} from empresas where id = $1 and deleted_at is null`, [id])).rows[0] ?? null

// Solo cambia los campos presentes en `cambios`
export async function actualizarDatos(db, id, cambios) {
    const { set, valores } = armarSet(cambios, CAMPOS, 2)
    if (!set) return datos(db, id)
    return (await db.query(
        `update empresas set ${set} where id = $1 and deleted_at is null returning ${DATOS_EMPRESA}`, [id, ...valores],
    )).rows[0] ?? null
}

export const ponerLogo = (db, id, url) => db.query('update empresas set logo_url = $2 where id = $1', [id, url])
