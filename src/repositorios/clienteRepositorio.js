// Clientes de la empresa. Tablas con RLS: `db` viene de conEmpresa().
import { armarSet } from '../utilidades/sql.js'

const CAMPOS = {
    nombre: 'nombre', documento: 'documento', telefono: 'telefono', email: 'email', direccion: 'direccion', notas: 'notas',
}

// Cliente con lo que lleva comprado (ventas confirmadas)
const SELECT = `
    select c.id, c.nombre, c.documento, c.telefono, c.email, c.direccion, c.notas, c.created_at,
           coalesce(v.compras, 0) as compras, coalesce(v.total_comprado, 0) as total_comprado, v.ultima_compra
    from clientes c
    left join lateral (
        select count(*) as compras, sum(total) as total_comprado, max(fecha) as ultima_compra
        from ventas where cliente_id = c.id and estado = 'confirmada'
    ) v on true`

// Búsqueda por nombre, documento, teléfono o email. Primero los que empiezan con lo escrito.
// Los símbolos se ignoran al comparar documento y teléfono ("12.345.678-9" = "123456789").
export async function listar(db, { buscar, limite }) {
    const texto = buscar?.trim() || null
    const digitos = texto?.replace(/\D/g, '') || null
    const { rows } = await db.query(
        `${SELECT}
         where c.deleted_at is null
           and ($1::text is null
                or c.nombre ilike '%' || $1 || '%'
                or c.email ilike '%' || $1 || '%'
                or ($2::text is not null and length($2) >= 3 and (
                    regexp_replace(coalesce(c.documento, ''), '\\D', '', 'g') like '%' || $2 || '%'
                    or regexp_replace(coalesce(c.telefono, ''), '\\D', '', 'g') like '%' || $2 || '%'))
                or c.documento ilike '%' || $1 || '%')
         order by ($1::text is not null and c.nombre ilike $1 || '%') desc, v.ultima_compra desc nulls last, lower(c.nombre)
         limit $3`,
        [texto, digitos, limite],
    )
    return rows
}

export const buscar = async (db, id) => (await db.query(`${SELECT} where c.id = $1 and c.deleted_at is null`, [id])).rows[0] ?? null

export async function crear(db, empresaId, d) {
    const presentes = Object.keys(CAMPOS).filter((c) => d[c] !== undefined)
    const { rows } = await db.query(
        `insert into clientes (empresa_id, ${presentes.map((c) => CAMPOS[c]).join(', ')})
         values ($1, ${presentes.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
        [empresaId, ...presentes.map((c) => d[c])],
    )
    return rows[0].id
}

export async function actualizar(db, id, cambios) {
    const { set, valores } = armarSet(cambios, CAMPOS, 2)
    if (!set) return 1
    return (await db.query(`update clientes set ${set} where id = $1 and deleted_at is null`, [id, ...valores])).rowCount
}

// Borrado lógico: deja de aparecer en búsquedas; las ventas que lo tienen lo siguen mostrando
export const eliminar = async (db, id) =>
    (await db.query('update clientes set deleted_at = now() where id = $1 and deleted_at is null', [id])).rowCount

export const existe = async (db, id) =>
    (await db.query('select 1 from clientes where id = $1 and deleted_at is null', [id])).rowCount > 0

// Otro cliente (no eliminado) con el mismo documento, ignorando puntos y guiones
export async function conDocumento(db, documento, salvoId) {
    const digitos = documento?.replace(/[^0-9kK]/g, '').toUpperCase()
    if (!digitos) return null
    const { rows } = await db.query(
        `select id, nombre from clientes
         where deleted_at is null and upper(regexp_replace(documento, '[^0-9kK]', '', 'g')) = $1 and ($2::uuid is null or id <> $2)
         limit 1`,
        [digitos, salvoId ?? null],
    )
    return rows[0] ?? null
}
