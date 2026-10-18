// Descuento por medio de pago y clientes asociados a la venta
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciar, miembro, nuevaEmpresa, terminar } from './ayudantes.js'

let dueno, cfg, producto
const metodo = (nombre) => cfg.metodosPago.find((m) => m.nombre === nombre)
const vender = (c, body) => c.post('/ventas', { canalId: cfg.canales[0].id, metodoPagoId: metodo('Efectivo').id, ...body })

before(async () => {
    iniciar()
    dueno = await nuevaEmpresa('clientes')
    cfg = (await dueno.get('/config')).datos
    producto = (await dueno.post('/productos', { nombre: 'Mate imperial', unidad: 'un', precio: 10000 })).datos
})
after(terminar)

describe('descuento por medio de pago', () => {
    test('se configura en el medio de pago', async () => {
        const r = await dueno.patch(`/config/metodos-pago/${metodo('Transferencia').id}`, { descuentoPct: 10 })
        assert.equal(r.status, 200, JSON.stringify(r.datos))
        cfg = (await dueno.get('/config')).datos
        assert.equal(metodo('Transferencia').descuentoPct, 10)
        assert.equal(metodo('Efectivo').descuentoPct, 0)
        assert.equal((await dueno.patch(`/config/metodos-pago/${metodo('Efectivo').id}`, { descuentoPct: 100 })).status, 400)
    })

    test('la venta con ese medio lleva el descuento; con otro, no', async () => {
        const items = [{ productoId: producto.id, cantidad: 3 }]
        const con = await vender(dueno, { metodoPagoId: metodo('Transferencia').id, items })
        assert.equal(con.status, 201, JSON.stringify(con.datos))
        assert.equal(con.datos.descuentoPct, 10)
        assert.equal(con.datos.descuento, 3000)
        assert.equal(con.datos.total, 27000)
        const sin = await vender(dueno, { items })
        assert.equal(sin.datos.descuento, 0)
        assert.equal(sin.datos.total, 30000)
    })

    test('cambiar el porcentaje no altera las ventas ya hechas', async () => {
        const v = await vender(dueno, { metodoPagoId: metodo('Transferencia').id, items: [{ productoId: producto.id, cantidad: 1 }] })
        await dueno.patch(`/config/metodos-pago/${metodo('Transferencia').id}`, { descuentoPct: 15 })
        const despues = await dueno.get(`/ventas/${v.datos.id}`)
        assert.equal(despues.datos.total, 9000)
        assert.equal(despues.datos.descuentoPct, 10)
    })
})

describe('canal y medio de pago por defecto', () => {
    test('se marca uno por lista; marcar otro desmarca el anterior', async () => {
        const marcar = (lista, id, porDefecto = true) => dueno.patch(`/config/${lista}/${id}`, { porDefecto })
        assert.equal((await marcar('metodos-pago', metodo('Débito').id)).status, 200)
        assert.equal((await marcar('metodos-pago', metodo('Transferencia').id)).status, 200)
        await marcar('canales', cfg.canales[1].id)
        const c = (await dueno.get('/config')).datos
        assert.deepEqual(c.metodosPago.filter((m) => m.porDefecto).map((m) => m.nombre), ['Transferencia'])
        assert.deepEqual(c.canales.filter((x) => x.porDefecto).map((x) => x.id), [cfg.canales[1].id])
        await marcar('metodos-pago', metodo('Transferencia').id, false)
        assert.ok(!(await dueno.get('/config')).datos.metodosPago.some((m) => m.porDefecto))
    })
})

describe('clientes', () => {
    let juana

    test('alta y búsqueda por nombre, documento o teléfono', async () => {
        const r = await dueno.post('/clientes', { nombre: 'Juana Pérez', documento: '12.345.678-5', telefono: '+56 9 8765 4321', email: 'JUANA@mail.cl' })
        assert.equal(r.status, 201, JSON.stringify(r.datos))
        juana = r.datos
        assert.equal(juana.email, 'juana@mail.cl')
        await dueno.post('/clientes', { nombre: 'Pedro Soto' })

        const nombres = async (q) => (await dueno.get(`/clientes?buscar=${encodeURIComponent(q)}`)).datos.map((c) => c.nombre)
        assert.deepEqual(await nombres('juana'), ['Juana Pérez'])
        assert.deepEqual(await nombres('12345678'), ['Juana Pérez'])   // sin puntos ni guion
        assert.deepEqual(await nombres('87654321'), ['Juana Pérez'])   // teléfono
        assert.deepEqual(await nombres('pedro'), ['Pedro Soto'])
        assert.equal((await dueno.get('/clientes')).datos.length, 2)
    })

    test('no se repite un documento (aunque se escriba distinto)', async () => {
        const r = await dueno.post('/clientes', { nombre: 'Otra Juana', documento: '123456785' })
        assert.equal(r.status, 409)
        assert.match(r.datos.error, /Juana Pérez/)
    })

    test('la venta guarda el cliente y suma a lo que lleva comprado', async () => {
        const v = await vender(dueno, { clienteId: juana.id, items: [{ productoId: producto.id, cantidad: 2 }] })
        assert.equal(v.status, 201)
        assert.equal(v.datos.cliente, 'Juana Pérez')
        assert.equal(v.datos.clienteDocumento, '12.345.678-5')
        const c = (await dueno.get(`/clientes/${juana.id}`)).datos
        assert.equal(c.compras, 1)
        assert.equal(c.totalComprado, 20000)
        const suyas = (await dueno.get(`/ventas?clienteId=${juana.id}`)).datos.datos
        assert.deepEqual(suyas.map((x) => x.id), [v.datos.id])
    })

    test('un cliente de otra empresa o inexistente no sirve', async () => {
        const otra = await nuevaEmpresa('clientes-otra')
        const ajeno = (await otra.post('/clientes', { nombre: 'Ajeno' })).datos
        assert.equal((await vender(dueno, { clienteId: ajeno.id, items: [{ productoId: producto.id, cantidad: 1 }] })).status, 400)
        assert.equal((await dueno.get(`/clientes/${ajeno.id}`)).status, 404)
    })

    test('el vendedor busca y da de alta desde la caja, pero no edita ni elimina', async () => {
        const v = await miembro(dueno, 'vendedor', 'clientes-vend')
        assert.equal((await v.get('/clientes?buscar=juana')).datos.length, 1)
        const nuevo = await v.post('/clientes', { nombre: 'Cliente del mostrador' })
        assert.equal(nuevo.status, 201)
        assert.equal((await v.patch(`/clientes/${nuevo.datos.id}`, { nombre: 'X' })).status, 403)
        assert.equal((await v.del(`/clientes/${nuevo.datos.id}`)).status, 403)
    })

    test('editar no borra lo que no se manda; eliminar lo saca de la búsqueda y las ventas lo conservan', async () => {
        const e = await dueno.patch(`/clientes/${juana.id}`, { notas: 'Prefiere transferencia' })
        assert.equal(e.datos.documento, '12.345.678-5')
        assert.equal(e.datos.notas, 'Prefiere transferencia')

        assert.equal((await dueno.del(`/clientes/${juana.id}`)).status, 204)
        assert.equal((await dueno.get('/clientes?buscar=juana')).datos.length, 0)
        const ventas = (await dueno.get(`/ventas?clienteId=${juana.id}`)).datos.datos
        assert.equal(ventas[0].cliente, 'Juana Pérez')
    })
})
