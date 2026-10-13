// Directorio de proveedores. Tablas con RLS: `db` viene de conEmpresa().
import { armarSet } from '../utilidades/sql.js'

const CAMPOS = {
    nombre: 'nombre', rut: 'rut', contacto: 'contacto', telefono: 'telefono',
    email: 'email', direccion: 'direccion', notas: 'notas', activo: 'activo',
}
const CAMPOS_CUENTA = {
    banco: 'banco', tipoCuenta: 'tipo_cuenta', numero: 'numero', titular: 'titular',
    rutTitular: 'rut_titular', email: 'email', principal: 'principal',
}

// Proveedor con sus cuentas y lo comprado en los últimos 90 días
const SELECT = `
    select p.id, p.nombre, p.rut, p.contacto, p.telefono, p.email, p.direccion, p.notas, p.activo, p.created_at,
           coalesce((select json_agg(json_build_object(
                       'id', c.id, 'banco', c.banco, 'tipoCuenta', c.tipo_cuenta, 'numero', c.numero,
                       'titular', c.titular, 'rutTitular', c.rut_titular, 'email', c.email, 'principal', c.principal)
                     order by c.principal desc, c.created_at)
                     from proveedor_cuentas c where c.proveedor_id = p.id), '[]') as cuentas,
           (select max(e.fecha) from egresos e where e.proveedor_id = p.id and e.estado = 'confirmado') as ultima_compra,
           (select coalesce(sum(e.total), 0) from egresos e
             where e.proveedor_id = p.id and e.estado = 'confirmado' and e.fecha >= current_date - 89) as comprado_90d
    from proveedores p`

export const listar = async (db) => (await db.query(`${SELECT} where p.deleted_at is null order by p.activo desc, lower(p.nombre)`)).rows
export const buscar = async (db, id) => (await db.query(`${SELECT} where p.id = $1 and p.deleted_at is null`, [id])).rows[0] ?? null

export async function crear(db, empresaId, d) {
    const presentes = Object.keys(CAMPOS).filter((c) => d[c] !== undefined)
    const { rows } = await db.query(
        `insert into proveedores (empresa_id, ${presentes.map((c) => CAMPOS[c]).join(', ')})
         values ($1, ${presentes.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
        [empresaId, ...presentes.map((c) => d[c])],
    )
    return rows[0].id
}

export async function actualizar(db, id, cambios) {
    const { set, valores } = armarSet(cambios, CAMPOS, 2)
    if (!set) return 1
    return (await db.query(`update proveedores set ${set} where id = $1`, [id, ...valores])).rowCount
}

// Solo una cuenta principal por proveedor
const quitarPrincipal = (db, proveedorId, salvo) =>
    db.query('update proveedor_cuentas set principal = false where proveedor_id = $1 and id <> $2 and principal',
        [proveedorId, salvo ?? '00000000-0000-0000-0000-000000000000'])

export async function crearCuenta(db, empresaId, proveedorId, d) {
    const presentes = Object.keys(CAMPOS_CUENTA).filter((c) => d[c] !== undefined)
    const { rows } = await db.query(
        `insert into proveedor_cuentas (empresa_id, proveedor_id, ${presentes.map((c) => CAMPOS_CUENTA[c]).join(', ')})
         values ($1, $2, ${presentes.map((_, i) => `$${i + 3}`).join(', ')}) returning id`,
        [empresaId, proveedorId, ...presentes.map((c) => d[c])],
    )
    // La primera cuenta (o la marcada) queda como principal
    const { rows: [{ n }] } = await db.query('select count(*)::int as n from proveedor_cuentas where proveedor_id = $1', [proveedorId])
    if (d.principal || n === 1) {
        await db.query('update proveedor_cuentas set principal = true where id = $1', [rows[0].id])
        await quitarPrincipal(db, proveedorId, rows[0].id)
    }
    return rows[0].id
}

export async function actualizarCuenta(db, proveedorId, cuentaId, cambios) {
    const { set, valores } = armarSet(cambios, CAMPOS_CUENTA, 3)
    if (!set) return 1
    const n = (await db.query(`update proveedor_cuentas set ${set} where id = $1 and proveedor_id = $2`,
        [cuentaId, proveedorId, ...valores])).rowCount
    if (n && cambios.principal) await quitarPrincipal(db, proveedorId, cuentaId)
    return n
}

export const eliminarCuenta = async (db, proveedorId, cuentaId) =>
    (await db.query('delete from proveedor_cuentas where id = $1 and proveedor_id = $2', [cuentaId, proveedorId])).rowCount
