// Transacciones con contexto de empresa.
//
// Todo acceso a tablas de negocio pasa por conEmpresa(): abre una transacción
// y setea app.empresa_id / app.usuario_id, que es lo que leen las políticas
// RLS y los triggers. Fuera de esta función, las tablas de negocio no
// devuelven filas.
import { pool } from '../config/db.js'

async function enTransaccion(fn, preparar) {
    const cliente = await pool.connect()
    try {
        await cliente.query('begin')
        if (preparar) await preparar(cliente)
        const resultado = await fn(cliente)
        await cliente.query('commit')
        return resultado
    } catch (error) {
        await cliente.query('rollback')
        throw error
    } finally {
        cliente.release()
    }
}

// contexto: { empresaId, usuarioId } (lo arma el middleware de empresa en req.contexto)
export const conEmpresa = ({ empresaId, usuarioId }, fn) =>
    enTransaccion(fn, (cliente) =>
        cliente.query(
            "select set_config('app.empresa_id', $1, true), set_config('app.usuario_id', $2, true)",
            [empresaId, usuarioId ?? ''],
        ),
    )

// Para tablas de plataforma (usuarios, empresas, sesiones...) que no tienen RLS
export const transaccion = (fn) => enTransaccion(fn)

// Consulta suelta fuera de transacción (solo tablas de plataforma)
export const consultar = (sql, params) => pool.query(sql, params)
