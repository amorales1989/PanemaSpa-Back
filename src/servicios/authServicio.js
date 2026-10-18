import argon2 from 'argon2'
import { consultar, transaccion } from '../db/contexto.js'
import * as usuarioRepositorio from '../repositorios/usuarioRepositorio.js'
import * as sesionRepositorio from '../repositorios/sesionRepositorio.js'
import * as empresaRepositorio from '../repositorios/empresaRepositorio.js'
import { DIAS_REFRESH, firmarAcceso, hashToken, tokenAleatorio } from '../utilidades/tokens.js'
import { ErrorApi, conflicto, noAutenticado } from '../utilidades/errores.js'
import { logger } from '../utilidades/logger.js'

// Hash de relleno: si el email no existe igual se verifica algo, para que el
// tiempo de respuesta no revele qué emails están registrados.
const HASH_FALSO = await argon2.hash('contraseña-que-no-existe')

async function emitirSesion(db, usuarioId, { userAgent, ip }) {
    const refreshToken = tokenAleatorio()
    const sesionId = await sesionRepositorio.crear(db, {
        usuarioId, tokenHash: hashToken(refreshToken), userAgent, ip, dias: DIAS_REFRESH,
    })
    return { accessToken: await firmarAcceso(usuarioId, sesionId), refreshToken }
}

// Alta de un negocio nuevo: usuario dueño + empresa lista para usar + prueba de 14 días
export async function registrar({ nombre, email, password, nombreEmpresa, pais }, cliente) {
    const passwordHash = await argon2.hash(password)
    return transaccion(async (db) => {
        if (await usuarioRepositorio.buscarPorEmail(db, email)) {
            throw conflicto('EMAIL_REGISTRADO', 'Ya existe una cuenta con ese email. Inicia sesión.')
        }
        const usuario = await usuarioRepositorio.crear(db, { email, nombre, passwordHash })
        const empresa = await empresaRepositorio.crear(db, { nombre: nombreEmpresa, slug: await empresaRepositorio.slugLibre(db, nombreEmpresa), pais })
        await empresaRepositorio.agregarMiembro(db, { empresaId: empresa.id, usuarioId: usuario.id, rolCodigo: 'dueno' })
        await empresaRepositorio.inicializar(db, empresa.id, pais)
        await empresaRepositorio.crearSuscripcionPrueba(db, empresa.id)
        const tokens = await emitirSesion(db, usuario.id, cliente)
        logger.info({ usuarioId: usuario.id, empresaId: empresa.id }, 'registro de empresa')
        // TODO Fase 3: enviar email de verificación (tokens_usuario)
        return { usuario, empresa, ...tokens }
    })
}

export async function iniciarSesion({ email, password }, cliente) {
    const usuario = await usuarioRepositorio.buscarPorEmail({ query: consultar }, email)
    const ok = await argon2.verify(usuario?.password_hash ?? HASH_FALSO, password)
    if (!usuario || !ok || !usuario.activo) throw noAutenticado('Email o contraseña incorrectos')

    return transaccion(async (db) => {
        await usuarioRepositorio.registrarAcceso(db, usuario.id)
        const tokens = await emitirSesion(db, usuario.id, cliente)
        delete usuario.password_hash
        return { usuario, ...tokens }
    })
}

// Rotación: cada refresh invalida el token usado y entrega uno nuevo.
// Si llega un token ya revocado, alguien lo robó/reutilizó → se cierran todas las sesiones.
export async function refrescar(refreshToken, cliente) {
    if (!refreshToken) throw noAutenticado()
    const resultado = await transaccion(async (db) => {
        const sesion = await sesionRepositorio.buscarPorHash(db, hashToken(refreshToken))
        if (!sesion) return { error: 'inexistente' }
        // Revocado hace segundos: otra pestaña lo rotó primero (el navegador ya tiene la cookie nueva).
        // No es un robo: se rechaza solo este pedido y el front reintenta.
        if (sesion.revocada_reciente) return { error: 'rotada' }
        if (sesion.revocada_en) {
            await sesionRepositorio.revocarTodas(db, sesion.usuario_id)
            logger.warn({ usuarioId: sesion.usuario_id }, 'refresh token reutilizado: sesiones cerradas')
            return { error: 'reutilizado' }
        }
        if (sesion.vencida) return { error: 'vencida' }
        const usuario = await usuarioRepositorio.buscarPorId(db, sesion.usuario_id)
        if (!usuario?.activo) return { error: 'inactivo' }
        await sesionRepositorio.revocar(db, sesion.id)
        return emitirSesion(db, sesion.usuario_id, cliente)
    })
    // El error se lanza fuera de la transacción para que la revocación masiva quede confirmada
    if (resultado.error === 'rotada') throw new ErrorApi(401, 'SESION_ROTADA', 'La sesión se renovó en otra pestaña, reintenta')
    if (resultado.error) throw noAutenticado('La sesión expiró, vuelve a iniciar sesión')
    return resultado
}

export async function cerrarSesion(refreshToken) {
    if (!refreshToken) return
    await consultar(
        'update sesiones set revocada_en = now() where refresh_token_hash = $1 and revocada_en is null',
        [hashToken(refreshToken)],
    )
}

export async function perfil(usuarioId) {
    const db = { query: consultar }
    const usuario = await usuarioRepositorio.buscarPorId(db, usuarioId)
    if (!usuario?.activo) throw noAutenticado()
    const empresas = await empresaRepositorio.listarDeUsuario(db, usuarioId)
    return { usuario, empresas }
}

// Cambia la contraseña y cierra las demás sesiones (la actual sigue abierta)
export async function cambiarPassword(usuarioId, sesionId, { actual, nueva }) {
    const { rows } = await consultar('select password_hash from usuarios where id = $1 and activo', [usuarioId])
    if (!rows[0] || !(await argon2.verify(rows[0].password_hash ?? HASH_FALSO, actual))) {
        throw new ErrorApi(400, 'PASSWORD_INCORRECTA', 'La contraseña actual no es correcta')
    }
    const hash = await argon2.hash(nueva)
    await transaccion(async (db) => {
        await db.query('update usuarios set password_hash = $2, debe_cambiar_password = false where id = $1', [usuarioId, hash])
        await db.query(
            'update sesiones set revocada_en = now() where usuario_id = $1 and id <> $2 and revocada_en is null',
            [usuarioId, sesionId],
        )
    })
    logger.info({ usuarioId }, 'contraseña cambiada')
}
