// Tabla de plataforma (sin RLS): siempre filtrar explícitamente.
const COLUMNAS = 'id, email, nombre, telefono, es_superadmin, email_verificado_en, activo, created_at'

export const buscarPorEmail = async (db, email) => {
    const { rows } = await db.query(`select ${COLUMNAS}, password_hash from usuarios where email = $1`, [email])
    return rows[0] ?? null
}

export const buscarPorId = async (db, id) => {
    const { rows } = await db.query(`select ${COLUMNAS} from usuarios where id = $1`, [id])
    return rows[0] ?? null
}

export const crear = async (db, { email, nombre, passwordHash }) => {
    const { rows } = await db.query(
        `insert into usuarios (email, nombre, password_hash) values ($1, $2, $3) returning ${COLUMNAS}`,
        [email, nombre, passwordHash],
    )
    return rows[0]
}

export const registrarAcceso = (db, id) => db.query('update usuarios set ultimo_acceso_en = now() where id = $1', [id])
