import * as authServicio from '../servicios/authServicio.js'
import { DIAS_REFRESH } from '../utilidades/tokens.js'
import { env } from '../config/env.js'

const COOKIE = 'panema_rt'
const opcionesCookie = {
    httpOnly: true,
    secure: env.esProduccion,
    sameSite: 'lax',
    domain: env.COOKIE_DOMAIN,
    path: '/v1/auth',
}

const datosCliente = (req) => ({ userAgent: req.get('user-agent'), ip: req.ip })

function responderSesion(res, status, { refreshToken, accessToken, ...resto }) {
    res.cookie(COOKIE, refreshToken, { ...opcionesCookie, maxAge: DIAS_REFRESH * 86_400_000 })
    res.status(status).json({ accessToken, ...resto })
}

export const registrar = async (req, res) => {
    responderSesion(res, 201, await authServicio.registrar(req.body, datosCliente(req)))
}

export const iniciarSesion = async (req, res) => {
    responderSesion(res, 200, await authServicio.iniciarSesion(req.body, datosCliente(req)))
}

export const refrescar = async (req, res) => {
    try {
        responderSesion(res, 200, await authServicio.refrescar(req.cookies?.[COOKIE], datosCliente(req)))
    } catch (error) {
        res.clearCookie(COOKIE, opcionesCookie)
        throw error
    }
}

export const cerrarSesion = async (req, res) => {
    await authServicio.cerrarSesion(req.cookies?.[COOKIE])
    res.clearCookie(COOKIE, opcionesCookie)
    res.status(204).end()
}

export const perfil = async (req, res) => {
    res.json(await authServicio.perfil(req.usuario.id))
}
