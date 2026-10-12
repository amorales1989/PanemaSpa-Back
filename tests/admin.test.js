// Panel de plataforma (superadmin) y cambio de contraseña
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciar, nuevaEmpresa, pedir, pool, terminar } from './ayudantes.js'

let admin   // superadmin (dueño de su propia empresa también)
let cliente // dueño de una empresa cualquiera

before(async () => {
    iniciar()
    admin = await nuevaEmpresa('plataforma')
    cliente = await nuevaEmpresa('cliente-admin')
    await pool.query('update usuarios set es_superadmin = true where id = $1', [admin.usuarioId])
})
after(terminar)

const get = (c, ruta) => pedir(`/v1/admin${ruta}`, { token: c.token })
const patch = (c, ruta, body) => pedir(`/v1/admin${ruta}`, { metodo: 'PATCH', token: c.token, body })

describe('acceso', () => {
    test('un usuario normal no entra al panel; sin token tampoco', async () => {
        assert.equal((await get(cliente, '/empresas')).status, 403)
        assert.equal((await pedir('/v1/admin/empresas')).status, 401)
    })
})

describe('empresas', () => {
    test('lista todas las empresas con plan, usuarios y dueño', async () => {
        const r = await get(admin, '/empresas')
        assert.equal(r.status, 200)
        const fila = r.datos.find((e) => e.id === cliente.empresa)
        assert.ok(fila)
        assert.equal(fila.planCodigo, 'prueba')
        assert.equal(fila.suscripcion, 'prueba')
        assert.equal(fila.usuarios, 1)
        assert.match(fila.duenoEmail, /cliente-admin/)
    })

    test('buscar por nombre o email del dueño', async () => {
        const r = await get(admin, '/empresas?buscar=cliente-admin')
        assert.ok(r.datos.some((e) => e.id === cliente.empresa))
        assert.ok(!r.datos.some((e) => e.id === admin.empresa))
    })

    test('resumen de la plataforma', async () => {
        const r = await get(admin, '/resumen')
        assert.equal(r.status, 200)
        assert.ok(r.datos.empresas >= 2)
        assert.ok('pruebasPorVencer' in r.datos)
    })

    test('detalle con usuarios y suscripciones', async () => {
        const r = await get(admin, `/empresas/${cliente.empresa}`)
        assert.equal(r.status, 200)
        assert.equal(r.datos.usuarios.length, 1)
        assert.equal(r.datos.usuarios[0].rolCodigo, 'dueno')
        assert.equal(r.datos.suscripciones.length, 1)
        assert.equal(r.datos.sucursales, 1)
    })

    test('suspender bloquea a la empresa al instante; reactivar la devuelve', async () => {
        assert.equal((await cliente.get('/config')).status, 200)
        const s = await patch(admin, `/empresas/${cliente.empresa}/estado`, { estado: 'suspendida' })
        assert.equal(s.datos.estado, 'suspendida')
        const bloqueado = await cliente.get('/config')
        assert.equal(bloqueado.status, 403)
        assert.equal(bloqueado.datos.codigo, 'EMPRESA_SUSPENDIDA')
        await patch(admin, `/empresas/${cliente.empresa}/estado`, { estado: 'activa' })
        assert.equal((await cliente.get('/config')).status, 200)
    })

    test('cambiar plan y extender la prueba', async () => {
        const r = await patch(admin, `/empresas/${cliente.empresa}/suscripcion`, { planCodigo: 'pro', estado: 'activa', periodoFin: '2027-01-31' })
        assert.equal(r.status, 200)
        assert.equal(r.datos.planCodigo, 'pro')
        assert.equal(r.datos.suscripcion, 'activa')
        assert.equal(r.datos.periodoFin, '2027-01-31')
        const p = await patch(admin, `/empresas/${cliente.empresa}/suscripcion`, { pruebaHasta: '2026-12-31' })
        assert.equal(p.datos.pruebaHasta, '2026-12-31')
        assert.equal((await patch(admin, `/empresas/${cliente.empresa}/suscripcion`, { planCodigo: 'inventado' })).status, 400)
    })

    test('plan Fundador sin vencimiento y primero en la lista', async () => {
        const planes = (await get(admin, '/planes')).datos
        const fundador = planes.find((p) => p.codigo === 'fundador')
        assert.equal(fundador.precioMensual, 0)
        assert.equal(fundador.publico, false)

        const r = await patch(admin, `/empresas/${cliente.empresa}/suscripcion`, { planCodigo: 'fundador', estado: 'activa', pruebaHasta: null, periodoFin: null })
        assert.equal(r.status, 200)
        assert.equal(r.datos.planCodigo, 'fundador')
        assert.equal(r.datos.periodoFin, null)
        assert.equal(r.datos.fundadora, true)

        const lista = (await get(admin, '/empresas')).datos
        assert.equal(lista[0].id, cliente.empresa)
        assert.equal(lista[0].fundadora, true)
    })

    test('cada acción queda auditada', async () => {
        const { rows } = await pool.query(
            "select accion from auditoria where empresa_id = $1 and accion like 'admin.%' order by id", [cliente.empresa])
        assert.deepEqual(rows.map((r) => r.accion).slice(0, 3), ['admin.empresa.suspender', 'admin.empresa.reactivar', 'admin.suscripcion'])
        assert.ok(rows.length >= 5)
    })

    test('empresa inexistente → 404', async () => {
        assert.equal((await get(admin, '/empresas/00000000-0000-0000-0000-000000000000')).status, 404)
    })
})

describe('cambiar contraseña', () => {
    test('exige la actual, cambia y cierra las otras sesiones', async () => {
        const email = (await pedir('/v1/auth/yo', { token: cliente.token })).datos.usuario.email
        const otraSesion = await pedir('/v1/auth/login', { metodo: 'POST', body: { email, password: 'clave-segura-123' } })
        const cookieOtra = otraSesion.cookie.split(';')[0]

        const mal = await pedir('/v1/auth/cambiar-password', { metodo: 'POST', token: cliente.token, body: { actual: 'incorrecta', nueva: 'otra-clave-456' } })
        assert.equal(mal.status, 400)
        assert.equal(mal.datos.codigo, 'PASSWORD_INCORRECTA')

        const ok = await pedir('/v1/auth/cambiar-password', { metodo: 'POST', token: cliente.token, body: { actual: 'clave-segura-123', nueva: 'otra-clave-456' } })
        assert.equal(ok.status, 204)

        assert.equal((await pedir('/v1/auth/login', { metodo: 'POST', body: { email, password: 'clave-segura-123' } })).status, 401)
        assert.equal((await pedir('/v1/auth/login', { metodo: 'POST', body: { email, password: 'otra-clave-456' } })).status, 200)
        // La otra sesión quedó cerrada
        assert.equal((await pedir('/v1/auth/refresh', { metodo: 'POST', cookie: cookieOtra })).status, 401)
    })
})
