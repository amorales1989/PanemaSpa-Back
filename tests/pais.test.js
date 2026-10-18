// País de la empresa: moneda, huso horario, CUIT/RUT y cuentas bancarias de proveedores
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { poolAdmin } from '../src/config/db.js'
import { iniciar, nuevaEmpresa, pedir, pool, terminar } from './ayudantes.js'

let ar, cl, admin
const CUIT = '20-12345678-6'
const CBU = '2850590940090418135201'

before(async () => {
    iniciar()
    ar = await nuevaEmpresa('pais-ar', 'AR')
    cl = await nuevaEmpresa('pais-cl')
    admin = await nuevaEmpresa('pais-admin')
    await pool.query('update usuarios set es_superadmin = true where id = $1', [admin.usuarioId])
})
after(terminar)

const perfil = async (c) => (await pedir('/v1/auth/yo', { token: c.token })).datos.empresas.find((e) => e.id === c.empresa)

describe('alta según el país', () => {
    test('sin elegir país la empresa es de Argentina, en pesos argentinos y con Mercado Pago', async () => {
        const r = await pedir('/v1/auth/registro', {
            metodo: 'POST',
            body: { nombre: 'Sin país', email: `sinpais-${Date.now()}@test.cl`, password: 'clave-segura-123', nombreEmpresa: 'Mates del Sur' },
        })
        assert.equal(r.status, 201)
        const { rows } = await poolAdmin.query('select pais, moneda, zona_horaria from empresas where id = $1', [r.datos.empresa.id])
        assert.deepEqual(rows[0], { pais: 'AR', moneda: 'ARS', zona_horaria: 'America/Argentina/Buenos_Aires' })
        const yo = await perfil(ar)
        assert.equal(yo.pais, 'AR')
        const metodos = (await ar.get('/config')).datos.metodosPago.map((m) => m.nombre)
        assert.ok(metodos.includes('Mercado Pago'))
    })

    test('Chile: pesos chilenos, Santiago y sin Mercado Pago', async () => {
        const yo = await perfil(cl)
        assert.equal(yo.pais, 'CL')
        assert.equal(yo.moneda, 'CLP')
        assert.ok(!(await cl.get('/config')).datos.metodosPago.some((m) => m.nombre === 'Mercado Pago'))
    })
})

describe('identificación fiscal', () => {
    test('Argentina pide CUIT (con dígito verificador) y no acepta un RUT', async () => {
        const ok = await ar.post('/proveedores', { nombre: 'Yerbatera', rut: '20123456786' })
        assert.equal(ok.status, 201, JSON.stringify(ok.datos))
        assert.equal(ok.datos.rut, CUIT)
        const malo = await ar.post('/proveedores', { nombre: 'Otro', rut: '20-12345678-0' })
        assert.equal(malo.status, 400)
        assert.match(malo.datos.detalles.rut[0], /CUIT/)
        assert.equal((await ar.post('/proveedores', { nombre: 'Chileno', rut: '76.086.428-5' })).status, 400)
        const e = await ar.patch('/empresa', { rut: '20123456786' })
        assert.equal(e.datos.rut, CUIT)
    })

    test('Chile sigue pidiendo RUT', async () => {
        assert.equal((await cl.post('/proveedores', { nombre: 'Molino', rut: CUIT })).status, 400)
        const ok = await cl.post('/proveedores', { nombre: 'Molino', rut: '760864285' })
        assert.equal(ok.datos.rut, '76.086.428-5')
    })
})

describe('cuentas bancarias', () => {
    test('Argentina: CBU/CVU válido y alias; caja de ahorro o corriente', async () => {
        const p = (await ar.post('/proveedores', { nombre: 'Calabazas' })).datos
        const base = { banco: 'Banco Nación', tipoCuenta: 'ahorro', titular: 'Calabazas SRL' }
        const ok = await ar.post(`/proveedores/${p.id}/cuentas`, { ...base, numero: CBU, alias: 'Calabazas.Sur', rutTitular: '20123456786' })
        assert.equal(ok.status, 201, JSON.stringify(ok.datos))
        assert.equal(ok.datos.cuentas[0].alias, 'calabazas.sur')
        assert.equal(ok.datos.cuentas[0].rutTitular, CUIT)
        // Solo alias también sirve
        assert.equal((await ar.post(`/proveedores/${p.id}/cuentas`, { ...base, alias: 'otro.alias' })).status, 201)

        const err = async (body) => (await ar.post(`/proveedores/${p.id}/cuentas`, { ...base, ...body })).status
        assert.equal(await err({ numero: CBU.slice(0, 21) + '0' }), 400)  // verificador incorrecto
        assert.equal(await err({}), 400)                                   // ni CBU ni alias
        assert.equal(await err({ numero: CBU, tipoCuenta: 'vista' }), 400) // tipo chileno
    })

    test('Chile: número de cuenta, sin alias', async () => {
        const p = (await cl.post('/proveedores', { nombre: 'Lácteos' })).datos
        const base = { banco: 'BancoEstado', tipoCuenta: 'vista', titular: 'Lácteos SpA' }
        assert.equal((await cl.post(`/proveedores/${p.id}/cuentas`, { ...base, numero: '12345678' })).status, 201)
        assert.equal((await cl.post(`/proveedores/${p.id}/cuentas`, { ...base, numero: '12345678', alias: 'x.y' })).status, 400)
        assert.equal((await cl.post(`/proveedores/${p.id}/cuentas`, base)).status, 400)
    })
})

describe('panel de plataforma', () => {
    const llamar = (metodo, ruta, body) => pedir(`/v1/admin${ruta}`, { metodo, token: admin.token, body })

    test('crear empresa con su país y su dueño (contraseña temporal)', async () => {
        const email = `dueno-panel-${Date.now()}@test.cl`
        const r = await llamar('POST', '/empresas', { nombre: 'Panadería Chilena', pais: 'CL', duenoNombre: 'Rosa', duenoEmail: email })
        assert.equal(r.status, 201, JSON.stringify(r.datos))
        assert.ok(r.datos.passwordTemporal)
        const d = (await llamar('GET', `/empresas/${r.datos.id}`)).datos
        assert.equal(d.pais, 'CL')
        assert.equal(d.moneda, 'CLP')
        assert.equal(d.usuarios[0].email, email)
        assert.equal(d.usuarios[0].rolCodigo, 'dueno')
        const login = await pedir('/v1/auth/login', { metodo: 'POST', body: { email, password: r.datos.passwordTemporal } })
        assert.equal(login.status, 200)
    })

    test('cambiar el país cambia moneda y huso horario', async () => {
        const r = await llamar('PATCH', `/empresas/${cl.empresa}/pais`, { pais: 'AR' })
        assert.equal(r.status, 200)
        assert.equal(r.datos.moneda, 'ARS')
        assert.equal((await perfil(cl)).zonaHoraria, 'America/Argentina/Buenos_Aires')
        await llamar('PATCH', `/empresas/${cl.empresa}/pais`, { pais: 'CL' })
        assert.equal((await llamar('PATCH', `/empresas/${cl.empresa}/pais`, { pais: 'PE' })).status, 400)
    })

    test('la demo se crea en el país elegido (Argentina si no se dice)', async () => {
        const r = await llamar('POST', '/demos', { nombre: 'Demo AR', catalogo: false })
        assert.equal((await llamar('GET', `/empresas/${r.datos.id}`)).datos.pais, 'AR')
        await llamar('DELETE', `/empresas/${r.datos.id}/demo`)
    })
})
