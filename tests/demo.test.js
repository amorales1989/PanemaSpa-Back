// Empresas demo: creación, movimientos generados, regeneración y borrado (solo superadmin)
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { poolAdmin } from '../src/config/db.js'
import { clienteDe, iniciar, nuevaEmpresa, pedir, pool, terminar } from './ayudantes.js'

// Para contar movimientos de cualquier empresa sin pasar por RLS
const db = poolAdmin

let admin   // superadmin
let cliente // empresa real, que las demos nunca deben tocar
let demo    // cliente del admin apuntando a la demo

before(async () => {
    iniciar()
    admin = await nuevaEmpresa('plataforma-demo')
    cliente = await nuevaEmpresa('cliente-demo')
    await pool.query('update usuarios set es_superadmin = true where id = $1', [admin.usuarioId])
})
after(terminar)

const llamar = (c, metodo, ruta, body) => pedir(`/v1/admin${ruta}`, { metodo, token: c.token, body })

describe('crear demo', () => {
    test('solo un superadmin puede crearla', async () => {
        const r = await llamar(cliente, 'POST', '/demos', { nombre: 'Intrusa' })
        assert.equal(r.status, 403)
    })

    test('crea la empresa con catálogo de ejemplo y movimientos hasta hoy', async () => {
        const r = await llamar(admin, 'POST', '/demos', { nombre: 'Panadería La Espiga', dias: 30, ventasDia: 20 })
        assert.equal(r.status, 201, JSON.stringify(r.datos))
        assert.ok(r.datos.resumen.ventas > 200)
        assert.ok(r.datos.resumen.egresos > 0)
        assert.ok(r.datos.resumen.mermas > 0)
        demo = clienteDe(admin.token, r.datos.id, admin.usuarioId)
    })

    test('el creador la ve en la app como dueño, sin planes (modo propio)', async () => {
        const yo = await pedir('/v1/auth/yo', { token: admin.token })
        const e = yo.datos.empresas.find((x) => x.id === demo.empresa)
        assert.equal(e.nombre, 'Panadería La Espiga')
        assert.equal(e.rolCodigo, 'dueno')
        assert.equal(e.modoPropio, true)
        assert.ok(!e.permisos.includes('suscripcion.gestionar'))
    })

    test('los movimientos son coherentes: totales, números y fechas', async () => {
        const r = await demo.get('/ventas?limite=500')
        assert.equal(r.status, 200)
        const ventas = r.datos.datos
        assert.ok(ventas.length > 0)
        for (const v of ventas) {
            const suma = v.items.reduce((t, i) => t + i.subtotal, 0)
            assert.equal(v.total, suma)
        }
        const { rows } = await db.query(
            `select min(numero) as min, max(numero) as max, count(*) as n, max(fecha) <= current_date as sin_futuro
             from ventas where empresa_id = $1`, [demo.empresa])
        assert.equal(Number(rows[0].min), 1)
        assert.equal(Number(rows[0].max), Number(rows[0].n))
        assert.equal(rows[0].sin_futuro, true)
    })

    test('una venta nueva sigue la numeración generada', async () => {
        const cfg = (await demo.get('/config')).datos
        const producto = (await demo.get('/productos')).datos.find((p) => p.unidad === 'un')
        const r = await demo.post('/ventas', {
            canalId: cfg.canales[0].id, metodoPagoId: cfg.metodosPago[0].id,
            items: [{ productoId: producto.id, cantidad: 1 }],
        })
        assert.equal(r.status, 201, JSON.stringify(r.datos))
        const { rows } = await db.query('select count(*)::int as n from ventas where empresa_id = $1', [demo.empresa])
        assert.equal(r.datos.numero, rows[0].n)
    })

    test('aparece marcada como demo en el panel', async () => {
        const lista = await llamar(admin, 'GET', '/empresas')
        assert.equal(lista.datos.find((e) => e.id === demo.empresa).esDemo, true)
        assert.equal(lista.datos.find((e) => e.id === cliente.empresa).esDemo, false)
        const detalle = await llamar(admin, 'GET', `/empresas/${demo.empresa}`)
        assert.equal(detalle.datos.esDemo, true)
        assert.ok(detalle.datos.primeraVenta)
    })
})

describe('regenerar', () => {
    test('reemplaza los movimientos y reinicia la numeración', async () => {
        const r = await llamar(admin, 'POST', `/empresas/${demo.empresa}/demo/regenerar`, { dias: 14, ventasDia: 10 })
        assert.equal(r.status, 200, JSON.stringify(r.datos))
        const { rows } = await db.query(
            `select count(*)::int as n, min(numero)::int as min, min(fecha) as desde from ventas where empresa_id = $1`, [demo.empresa])
        assert.equal(rows[0].n, r.datos.ventas)
        assert.equal(rows[0].min, 1)
        assert.ok(rows[0].desde >= new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10))
    })

    test('nunca toca una empresa real', async () => {
        const cfg = (await cliente.get('/config')).datos
        const prod = await cliente.post('/productos', { nombre: 'Pan real', unidad: 'un', precio: 500 })
        await cliente.post('/ventas', { canalId: cfg.canales[0].id, metodoPagoId: cfg.metodosPago[0].id, items: [{ productoId: prod.datos.id, cantidad: 1 }] })

        assert.equal((await llamar(admin, 'POST', `/empresas/${cliente.empresa}/demo/regenerar`, {})).status, 404)
        assert.equal((await llamar(admin, 'DELETE', `/empresas/${cliente.empresa}/demo`)).status, 404)
        const { rows } = await db.query('select count(*)::int as n from ventas where empresa_id = $1', [cliente.empresa])
        assert.equal(rows[0].n, 1)
    })

    test('una demo sin catálogo pide completarlo antes de generar', async () => {
        const r = await llamar(admin, 'POST', '/demos', { nombre: 'Demo vacía', catalogo: false })
        assert.equal(r.status, 201)
        assert.equal(r.datos.resumen, null)
        const g = await llamar(admin, 'POST', `/empresas/${r.datos.id}/demo/regenerar`, {})
        assert.equal(g.status, 409)
        assert.equal(g.datos.codigo, 'DEMO_INCOMPLETA')
        await llamar(admin, 'DELETE', `/empresas/${r.datos.id}/demo`)
    })
})

describe('eliminar', () => {
    test('borra la demo con todo lo suyo', async () => {
        assert.equal((await llamar(admin, 'DELETE', `/empresas/${demo.empresa}/demo`)).status, 204)
        assert.equal((await llamar(admin, 'GET', `/empresas/${demo.empresa}`)).status, 404)
        const { rows } = await db.query('select count(*)::int as n from ventas where empresa_id = $1', [demo.empresa])
        assert.equal(rows[0].n, 0)
        const yo = await pedir('/v1/auth/yo', { token: admin.token })
        assert.ok(!yo.datos.empresas.some((e) => e.id === demo.empresa))
    })
})
