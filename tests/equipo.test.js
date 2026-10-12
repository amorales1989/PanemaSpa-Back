// Gestión de equipo: superadmin (panel) y dueño/administrador (app)
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { clienteDe, iniciar, nuevaEmpresa, pedir, pool, terminar } from './ayudantes.js'

let admin, dueno, roles
const sufijo = Date.now().toString(36)
const login = (email, password) => pedir('/v1/auth/login', { metodo: 'POST', body: { email, password } })
const rolId = (codigo) => roles.find((r) => r.codigo === codigo).id
const panel = (metodo, ruta, body) => pedir(`/v1/admin/empresas/${dueno.empresa}/usuarios${ruta}`, { metodo, token: admin.token, body })

before(async () => {
    iniciar()
    admin = await nuevaEmpresa('equipo-admin')
    dueno = await nuevaEmpresa('equipo-dueno')
    await pool.query('update usuarios set es_superadmin = true where id = $1', [admin.usuarioId])
    roles = (await panel('GET', '')).datos.roles
})
after(terminar)

describe('desde el panel de plataforma', () => {
    test('lista miembros y roles de sistema en orden', async () => {
        const r = await panel('GET', '')
        assert.equal(r.datos.miembros.length, 1)
        assert.deepEqual(r.datos.roles.map((x) => x.codigo), ['dueno', 'administrador', 'encargado', 'vendedor', 'produccion', 'contador'])
    })

    test('agregar usuario nuevo: contraseña temporal y cambio obligatorio', async () => {
        const email = `cajera-${sufijo}@test.cl`
        const r = await panel('POST', '', { nombre: 'Cajera', email, rolId: rolId('vendedor') })
        assert.equal(r.status, 201)
        assert.equal(r.datos.cuentaNueva, true)
        assert.match(r.datos.passwordTemporal, /^[A-Za-z2-9]{10}$/)

        const l = await login(email, r.datos.passwordTemporal)
        assert.equal(l.status, 200)
        assert.equal(l.datos.usuario.debeCambiarPassword, true)
        const yo = await pedir('/v1/auth/yo', { token: l.datos.accessToken })
        assert.equal(yo.datos.empresas[0].rolCodigo, 'vendedor')

        await pedir('/v1/auth/cambiar-password', { metodo: 'POST', token: l.datos.accessToken, body: { actual: r.datos.passwordTemporal, nueva: 'mi-clave-propia-1' } })
        assert.equal((await login(email, 'mi-clave-propia-1')).datos.usuario.debeCambiarPassword, false)
    })

    test('usuario que ya tiene cuenta: solo recibe acceso, sin contraseña nueva', async () => {
        const email = (await pedir('/v1/auth/yo', { token: admin.token })).datos.usuario.email
        const r = await panel('POST', '', { nombre: 'X', email, rolId: rolId('contador') })
        assert.equal(r.datos.cuentaNueva, false)
        assert.equal(r.datos.passwordTemporal, null)
        assert.equal((await panel('POST', '', { nombre: 'X', email, rolId: rolId('contador') })).status, 409)
    })

    test('no se puede dejar la empresa sin dueño', async () => {
        const unico = (await panel('GET', '')).datos.miembros.find((m) => m.rolCodigo === 'dueno')
        const r = await panel('PATCH', `/${unico.membresiaId}`, { rolId: rolId('administrador') })
        assert.equal(r.status, 409)
        assert.equal(r.datos.codigo, 'ULTIMO_DUENO')
        assert.equal((await panel('PATCH', `/${unico.membresiaId}`, { estado: 'suspendido' })).status, 409)
    })

    test('suspender corta el acceso al instante; reactivar lo devuelve', async () => {
        const email = `suspendible-${sufijo}@test.cl`
        const alta = await panel('POST', '', { nombre: 'Temporal', email, rolId: rolId('encargado') })
        const l = await login(email, alta.datos.passwordTemporal)
        const c = clienteDe(l.datos.accessToken, dueno.empresa)
        assert.equal((await c.get('/config')).status, 200)
        await panel('PATCH', `/${alta.datos.membresiaId}`, { estado: 'suspendido' })
        assert.equal((await c.get('/config')).status, 403)
        await panel('PATCH', `/${alta.datos.membresiaId}`, { estado: 'activo' })
        assert.equal((await c.get('/config')).status, 200)
    })

    test('restablecer contraseña cierra sus sesiones', async () => {
        const email = `olvido-${sufijo}@test.cl`
        const alta = await panel('POST', '', { nombre: 'Olvidadiza', email, rolId: rolId('produccion') })
        const l = await login(email, alta.datos.passwordTemporal)
        const r = await panel('POST', `/${alta.datos.membresiaId}/restablecer-password`)
        assert.ok(r.datos.passwordTemporal)
        assert.equal((await pedir('/v1/auth/refresh', { metodo: 'POST', cookie: l.cookie.split(';')[0] })).status, 401)
        assert.equal((await login(email, r.datos.passwordTemporal)).status, 200)
    })

    test('un usuario normal no usa el panel', async () => {
        assert.equal((await pedir(`/v1/admin/empresas/${dueno.empresa}/usuarios`, { token: dueno.token })).status, 403)
    })
})

describe('desde la app (dueño y administrador)', () => {
    test('el dueño gestiona su equipo', async () => {
        const r = await dueno.get('/equipo')
        assert.equal(r.status, 200)
        const alta = await dueno.post('/equipo', { nombre: 'Panadero', email: `panadero-${sufijo}@test.cl`, rolId: rolId('produccion') })
        assert.equal(alta.status, 201)
        assert.ok(alta.datos.passwordTemporal)
    })

    test('el dueño no puede cambiarse a sí mismo', async () => {
        const yo = (await dueno.get('/equipo')).datos.miembros.find((m) => m.usuarioId === dueno.usuarioId)
        assert.equal((await dueno.patch(`/equipo/${yo.membresiaId}`, { rolId: rolId('vendedor') })).status, 409)
    })

    test('un administrador no puede nombrar dueños ni tocar al dueño', async () => {
        const email = `admin-emp-${sufijo}@test.cl`
        const alta = await dueno.post('/equipo', { nombre: 'Administradora', email, rolId: rolId('administrador') })
        const l = await login(email, alta.datos.passwordTemporal)
        const adm = clienteDe(l.datos.accessToken, dueno.empresa)
        assert.equal((await adm.post('/equipo', { nombre: 'Y', email: `y-${sufijo}@test.cl`, rolId: rolId('dueno') })).status, 403)
        const elDueno = (await adm.get('/equipo')).datos.miembros.find((m) => m.rolCodigo === 'dueno')
        assert.equal((await adm.patch(`/equipo/${elDueno.membresiaId}`, { estado: 'suspendido' })).status, 403)
        // Pero sí puede sumar un vendedor
        assert.equal((await adm.post('/equipo', { nombre: 'Z', email: `z-${sufijo}@test.cl`, rolId: rolId('vendedor') })).status, 201)
    })

    test('un vendedor no gestiona el equipo', async () => {
        const email = `vend-${sufijo}@test.cl`
        const alta = await dueno.post('/equipo', { nombre: 'Vendedor', email, rolId: rolId('vendedor') })
        const l = await login(email, alta.datos.passwordTemporal)
        assert.equal((await clienteDe(l.datos.accessToken, dueno.empresa).get('/equipo')).status, 403)
    })

    test('datos de la empresa: el dueño los edita, el vendedor no', async () => {
        const r = await dueno.patch('/empresa', { nombre: 'Panadería Renovada', razonSocial: 'Renovada SpA', rut: '76.123.456-7' })
        assert.equal(r.status, 200)
        assert.equal(r.datos.razonSocial, 'Renovada SpA')
        const texto = JSON.stringify(r.datos).toLowerCase()
        assert.ok(!/plan|suscripci/.test(texto))
        const yo = await pedir('/v1/auth/yo', { token: dueno.token })
        assert.equal(yo.datos.empresas[0].nombre, 'Panadería Renovada')

        const email = `vend2-${sufijo}@test.cl`
        const alta = await dueno.post('/equipo', { nombre: 'V2', email, rolId: rolId('vendedor') })
        const l = await login(email, alta.datos.passwordTemporal)
        const v = clienteDe(l.datos.accessToken, dueno.empresa)
        assert.equal((await v.get('/empresa')).status, 200)
        assert.equal((await v.patch('/empresa', { nombre: 'Hackeada' })).status, 403)
    })

    test('otra empresa no puede tocar miembros ajenos', async () => {
        const otra = await nuevaEmpresa('equipo-otra')
        const miembro = (await dueno.get('/equipo')).datos.miembros[0]
        assert.equal((await otra.patch(`/equipo/${miembro.membresiaId}`, { estado: 'suspendido' })).status, 404)
    })
})
