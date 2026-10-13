// Miembros de una empresa (empresa_usuarios + usuarios). Tablas de plataforma, sin RLS:
// todas las consultas filtran por empresa_id explícitamente.

export async function listar(db, empresaId) {
    const { rows } = await db.query(
        `select eu.id as membresia_id, u.id as usuario_id, u.email, u.nombre, eu.estado,
                r.id as rol_id, r.codigo as rol_codigo, r.nombre as rol,
                u.ultimo_acceso_en, u.debe_cambiar_password, eu.created_at
         from empresa_usuarios eu
         join usuarios u on u.id = eu.usuario_id
         join roles r on r.id = eu.rol_id
         where eu.empresa_id = $1
         order by eu.estado, r.codigo = 'dueno' desc, u.nombre`,
        [empresaId],
    )
    return rows
}

// Roles asignables en la empresa: los de sistema + los propios
export async function roles(db, empresaId) {
    const { rows } = await db.query(
        `select r.id, r.codigo, r.nombre, r.descripcion, r.empresa_id is null as de_sistema
         from roles r where r.empresa_id is null or r.empresa_id = $1
         order by r.empresa_id nulls first,
                  array_position(array['dueno','administrador','encargado','vendedor','produccion','contador'], r.codigo), r.nombre`,
        [empresaId],
    )
    return rows
}

export async function rol(db, empresaId, rolId) {
    const { rows } = await db.query(
        'select id, codigo, nombre from roles where id = $1 and (empresa_id is null or empresa_id = $2)', [rolId, empresaId])
    return rows[0] ?? null
}

export async function membresia(db, empresaId, membresiaId) {
    const { rows } = await db.query(
        `select eu.id, eu.usuario_id, eu.estado, r.codigo as rol_codigo
         from empresa_usuarios eu join roles r on r.id = eu.rol_id
         where eu.id = $1 and eu.empresa_id = $2 for update of eu`,
        [membresiaId, empresaId],
    )
    return rows[0] ?? null
}

export async function crearUsuario(db, { email, nombre, passwordHash }) {
    const { rows } = await db.query(
        `insert into usuarios (email, nombre, password_hash, debe_cambiar_password)
         values ($1, $2, $3, true) returning id`,
        [email, nombre, passwordHash],
    )
    return rows[0].id
}

export async function agregarMiembro(db, { empresaId, usuarioId, rolId, invitadoPor }) {
    const { rows } = await db.query(
        `insert into empresa_usuarios (empresa_id, usuario_id, rol_id, invitado_por)
         values ($1, $2, $3, $4)
         on conflict (empresa_id, usuario_id) do nothing returning id`,
        [empresaId, usuarioId, rolId, invitadoPor],
    )
    return rows[0]?.id ?? null
}

export const actualizarMiembro = (db, membresiaId, { rolId, estado }) =>
    db.query(
        `update empresa_usuarios set rol_id = coalesce($2, rol_id), estado = coalesce($3, estado) where id = $1`,
        [membresiaId, rolId ?? null, estado ?? null],
    )

// Dueños activos de la empresa sin contar una membresía (para no dejarla sin dueño)
export async function otrosDuenosActivos(db, empresaId, membresiaId) {
    const { rows } = await db.query(
        `select count(*)::int as n from empresa_usuarios eu join roles r on r.id = eu.rol_id
         where eu.empresa_id = $1 and eu.id <> $2 and eu.estado = 'activo' and r.codigo = 'dueno'`,
        [empresaId, membresiaId],
    )
    return rows[0].n
}

// Pertenece solo a esta empresa (entonces su dueño puede restablecerle la contraseña)
export async function soloEnEstaEmpresa(db, usuarioId, empresaId) {
    const { rows } = await db.query(
        'select count(*) filter (where empresa_id <> $2)::int as otras from empresa_usuarios where usuario_id = $1',
        [usuarioId, empresaId],
    )
    return rows[0].otras === 0
}

export const ponerPasswordTemporal = async (db, usuarioId, passwordHash) => {
    await db.query('update usuarios set password_hash = $2, debe_cambiar_password = true where id = $1', [usuarioId, passwordHash])
    await db.query('update sesiones set revocada_en = now() where usuario_id = $1 and revocada_en is null', [usuarioId])
}

// Quita el acceso a la empresa. El usuario (y sus ventas, compras y mermas) se conserva.
export const quitarMiembro = async (db, membresiaId) =>
    (await db.query('delete from empresa_usuarios where id = $1', [membresiaId])).rowCount

// Nombre y email de la cuenta (es global: se usa en todas sus empresas)
export async function actualizarUsuario(db, usuarioId, { nombre, email }) {
    await db.query(
        'update usuarios set nombre = coalesce($2, nombre), email = coalesce($3, email) where id = $1',
        [usuarioId, nombre ?? null, email ?? null],
    )
}
