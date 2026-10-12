// Tests de punta a punta contra una BD real (ver README: "Tests").
// Lo más importante que cubren: una empresa NUNCA ve datos de otra.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/app.js'
import { pool } from '../src/config/db.js'

let base
let servidor
const sufijo = Date.now().toString(36)

const pedir = async (ruta, { metodo = 'GET', token, empresa, body, cookie } = {}) => {
    const res = await fetch(base + ruta, {
        method: metodo,
        headers: {
            ...(body && { 'Content-Type': 'application/json' }),
            ...(token && { Authorization: `Bearer ${token}` }),
            ...(empresa && { 'X-Empresa-Id': empresa }),
            ...(cookie && { Cookie: cookie }),
        },
        body: body && JSON.stringify(body),
    })
    const texto = await res.text()
    return { status: res.status, datos: texto ? JSON.parse(texto) : null, cookie: res.headers.get('set-cookie') }
}

const registrar = (quien) =>
    pedir('/v1/auth/registro', {
        metodo: 'POST',
        body: { nombre: `Dueño ${quien}`, email: `${quien}-${sufijo}@test.cl`, password: 'clave-segura-123', nombreEmpresa: `Panadería ${quien}` },
    })

const soloCookie = (setCookie) => setCookie?.split(';')[0]

let a
let b

before(async () => {
    servidor = app.listen(0)
    base = `http://localhost:${servidor.address().port}`
    a = await registrar('a')
    b = await registrar('b')
})

after(async () => {
    servidor.close()
    await pool.end()
})

describe('registro y sesión', () => {
    test('registrar crea usuario, empresa y devuelve token + cookie', () => {
        assert.equal(a.status, 201)
        assert.ok(a.datos.accessToken)
        assert.ok(a.datos.empresa.id)
        assert.match(a.cookie, /panema_rt=.*HttpOnly/i)
    })

    test('email repetido → 409', async () => {
        const r = await registrar('a')
        assert.equal(r.status, 409)
        assert.equal(r.datos.codigo, 'EMAIL_REGISTRADO')
    })

    test('datos inválidos → 400 con detalle por campo', async () => {
        const r = await pedir('/v1/auth/registro', { metodo: 'POST', body: { email: 'no-es-email', password: '123' } })
        assert.equal(r.status, 400)
        assert.ok(r.datos.detalles.email)
        assert.ok(r.datos.detalles.password)
    })

    test('login con contraseña incorrecta → 401', async () => {
        const r = await pedir('/v1/auth/login', { metodo: 'POST', body: { email: `a-${sufijo}@test.cl`, password: 'mala' } })
        assert.equal(r.status, 401)
    })

    test('login correcto', async () => {
        const r = await pedir('/v1/auth/login', { metodo: 'POST', body: { email: `A-${sufijo}@TEST.cl`, password: 'clave-segura-123' } })
        assert.equal(r.status, 200)
        assert.ok(r.datos.accessToken)
    })

    test('/yo devuelve la empresa con rol dueño y todos los permisos', async () => {
        const r = await pedir('/v1/auth/yo', { token: a.datos.accessToken })
        assert.equal(r.status, 200)
        assert.equal(r.datos.empresas.length, 1)
        assert.equal(r.datos.empresas[0].rol_codigo, 'dueno')
        assert.ok(r.datos.empresas[0].permisos.includes('suscripcion.gestionar'))
    })

    test('sin token → 401', async () => {
        const r = await pedir('/v1/auth/yo')
        assert.equal(r.status, 401)
    })

    test('refresh rota el token y reutilizar el viejo cierra todas las sesiones', async () => {
        const login = await pedir('/v1/auth/login', { metodo: 'POST', body: { email: `b-${sufijo}@test.cl`, password: 'clave-segura-123' } })
        const viejo = soloCookie(login.cookie)

        const r1 = await pedir('/v1/auth/refresh', { metodo: 'POST', cookie: viejo })
        assert.equal(r1.status, 200)
        const nuevo = soloCookie(r1.cookie)
        assert.notEqual(nuevo, viejo)

        const reuso = await pedir('/v1/auth/refresh', { metodo: 'POST', cookie: viejo })
        assert.equal(reuso.status, 401)

        // El token nuevo también quedó revocado por la detección de reuso
        const r2 = await pedir('/v1/auth/refresh', { metodo: 'POST', cookie: nuevo })
        assert.equal(r2.status, 401)
    })
})

describe('aislamiento entre empresas', () => {
    test('cada empresa ve su configuración', async () => {
        const r = await pedir('/v1/config', { token: a.datos.accessToken, empresa: a.datos.empresa.id })
        assert.equal(r.status, 200)
        assert.equal(r.datos.empresa.id, a.datos.empresa.id)
        assert.deepEqual(r.datos.metodosPago.map((m) => m.nombre), ['Efectivo', 'Débito', 'Crédito', 'Transferencia'])
        assert.equal(r.datos.sucursales.length, 1)
        assert.equal(r.datos.categorias.egreso.find((c) => c.con_items)?.nombre, 'Insumos')
    })

    test('usuario de A pidiendo la empresa B → 403', async () => {
        const r = await pedir('/v1/config', { token: a.datos.accessToken, empresa: b.datos.empresa.id })
        assert.equal(r.status, 403)
    })

    test('sin X-Empresa-Id → 400', async () => {
        const r = await pedir('/v1/config', { token: a.datos.accessToken })
        assert.equal(r.status, 400)
        assert.equal(r.datos.codigo, 'EMPRESA_REQUERIDA')
    })

    test('RLS: con la conexión de la API, sin contexto no se ve ninguna fila', async () => {
        const { rows } = await pool.query('select count(*)::int as n from metodos_pago')
        assert.equal(rows[0].n, 0)
    })

    test('RLS: con contexto de A no se ven ni se modifican filas de B', async () => {
        const cliente = await pool.connect()
        try {
            await cliente.query('begin')
            await cliente.query("select set_config('app.empresa_id', $1, true)", [a.datos.empresa.id])
            const { rows } = await cliente.query('select distinct empresa_id from metodos_pago')
            assert.deepEqual(rows.map((r) => r.empresa_id), [a.datos.empresa.id])

            const upd = await cliente.query("update metodos_pago set nombre = 'hack' where empresa_id = $1", [b.datos.empresa.id])
            assert.equal(upd.rowCount, 0)

            await assert.rejects(
                cliente.query("insert into metodos_pago (empresa_id, nombre) values ($1, 'hack')", [b.datos.empresa.id]),
                /row-level security/,
            )
        } finally {
            await cliente.query('rollback')
            cliente.release()
        }
    })

    test('la API no puede borrar ventas (se anulan)', async () => {
        await assert.rejects(pool.query('delete from ventas'), /permission denied/)
    })
})

describe('salud', () => {
    test('GET /salud', async () => {
        const r = await pedir('/salud')
        assert.equal(r.status, 200)
    })

    test('ruta inexistente → 404 JSON', async () => {
        const r = await pedir('/no-existe')
        assert.equal(r.status, 404)
    })
})

