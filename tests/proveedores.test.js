// Directorio de proveedores y cuentas bancarias
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciar, miembro, nuevaEmpresa, pool, terminar } from './ayudantes.js'

let dueno, vendedor, contador, otra
let id

before(async () => {
    iniciar()
    dueno = await nuevaEmpresa('prov-a')
    otra = await nuevaEmpresa('prov-b')
    vendedor = await miembro(dueno, 'vendedor', 'prov-vend')
    contador = await miembro(dueno, 'contador', 'prov-cont')
})
after(terminar)

describe('directorio de proveedores', () => {
    test('crear con RUT válido (se formatea) y rechazar uno inválido', async () => {
        const r = await dueno.post('/proveedores', {
            nombre: 'Molinera del Sur', rut: '761234560', contacto: 'Pedro', telefono: '+56 9 1234 5678',
            email: 'ventas@molinera.cl', notas: 'Entrega martes y viernes',
        })
        assert.equal(r.status, 201, JSON.stringify(r.datos))
        assert.equal(r.datos.rut, '76.123.456-0')
        id = r.datos.id
        const mal = await dueno.post('/proveedores', { nombre: 'X', rut: '76.123.456-7' })
        assert.equal(mal.status, 400)
        assert.match(mal.datos.detalles.rut[0], /dígito verificador/)
        assert.equal((await dueno.post('/proveedores', { nombre: 'molinera del sur' })).status, 409)
    })

    test('cuentas: la primera queda principal y solo hay una principal', async () => {
        const c1 = await dueno.post(`/proveedores/${id}/cuentas`, {
            banco: 'Banco de Chile', tipoCuenta: 'corriente', numero: '00-123-45678-09', titular: 'Molinera del Sur SpA', rutTitular: '76.123.456-0', email: 'pagos@molinera.cl',
        })
        assert.equal(c1.status, 201)
        assert.equal(c1.datos.cuentas[0].principal, true)
        const c2 = await dueno.post(`/proveedores/${id}/cuentas`, { banco: 'BancoEstado', tipoCuenta: 'rut', numero: '12345678', titular: 'Pedro Pérez', principal: true })
        assert.deepEqual(c2.datos.cuentas.map((c) => [c.banco, c.principal]), [['BancoEstado', true], ['Banco de Chile', false]])
        assert.equal((await dueno.post(`/proveedores/${id}/cuentas`, { banco: 'X', tipoCuenta: 'corriente', numero: 'abc', titular: 'Y' })).status, 400)
    })

    test('editar y borrar una cuenta queda en la auditoría', async () => {
        const cuenta = (await dueno.get(`/proveedores/${id}`)).datos.cuentas.find((c) => c.banco === 'BancoEstado')
        const e = await dueno.patch(`/proveedores/${id}/cuentas/${cuenta.id}`, { numero: '87654321' })
        assert.equal(e.datos.cuentas.find((c) => c.id === cuenta.id).numero, '87654321')
        const d = await dueno.del(`/proveedores/${id}/cuentas/${cuenta.id}`)
        assert.equal(d.datos.cuentas.length, 1)
        const { rows } = await pool.query("select accion from auditoria where accion like 'proveedor.cuenta.%' and empresa_id = $1 order by id", [dueno.empresa])
        assert.deepEqual(rows.map((r) => r.accion), ['proveedor.cuenta.crear', 'proveedor.cuenta.crear', 'proveedor.cuenta.actualizar', 'proveedor.cuenta.eliminar'])
    })

    test('las compras suman al proveedor', async () => {
        const cfg = (await dueno.get('/config')).datos
        const insumo = (await dueno.post('/insumos', { nombre: 'Harina', unidad: 'kg', precio: 880 })).datos
        await dueno.post('/egresos', {
            categoriaId: cfg.categorias.egreso.find((c) => c.conItems).id, metodoPagoId: cfg.metodosPago[0].id,
            proveedor: 'Molinera del Sur', items: [{ insumoId: insumo.id, cantidad: 25, precio: 900 }],
        })
        const p = (await dueno.get(`/proveedores/${id}`)).datos
        assert.equal(p.comprado90d, 22500)
        assert.ok(p.ultimaCompra)
    })

    test('permisos: el contador ve, el vendedor no ve las cuentas', async () => {
        const c = await contador.get('/proveedores')
        assert.equal(c.status, 200)
        assert.equal(c.datos[0].cuentas.length, 1)
        assert.equal((await contador.post('/proveedores', { nombre: 'Z' })).status, 403)
        assert.equal((await vendedor.get('/proveedores')).status, 403)
    })

    test('otra empresa no ve ni toca el proveedor', async () => {
        assert.equal((await otra.get(`/proveedores/${id}`)).status, 404)
        assert.equal((await otra.get('/proveedores')).datos.length, 0)
    })
})
