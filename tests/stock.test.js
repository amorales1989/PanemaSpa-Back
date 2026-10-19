// Control de stock: activación por empresa, movimientos de ventas/compras/mermas, recetas y ajustes
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciar, nuevaEmpresa, terminar } from './ayudantes.js'

let dueno, cfg
const ids = {}
const de = (lista, nombre) => lista.find((x) => x.nombre === nombre)
const vender = (items) => dueno.post('/ventas', { canalId: cfg.canales[0].id, metodoPagoId: de(cfg.metodosPago, 'Efectivo').id, items })
const comprar = (items) => dueno.post('/egresos', {
    categoriaId: de(cfg.categorias.egreso, 'Insumos').id, metodoPagoId: de(cfg.metodosPago, 'Efectivo').id, items,
})
const stockDe = async (ruta) => (await dueno.get(ruta)).datos.stock

before(async () => {
    iniciar()
    dueno = await nuevaEmpresa('stock')
    cfg = (await dueno.get('/config')).datos
    ids.harina = (await dueno.post('/insumos', { nombre: 'Harina', unidad: 'kg', precio: 1000, stockMinimo: 5 })).datos.id
    ids.bebida = (await dueno.post('/productos', { nombre: 'Bebida lata', unidad: 'un', precio: 1200, stockMinimo: 6 })).datos.id
    ids.pan = (await dueno.post('/productos', {
        nombre: 'Pan', unidad: 'un', precio: 300, receta: [{ insumoId: ids.harina, cantidad: 0.1 }],
    })).datos.id
})
after(terminar)

describe('control de stock', () => {
    test('apagado: las ventas no mueven stock y no se puede ajustar', async () => {
        await vender([{ productoId: ids.bebida, cantidad: 2 }])
        assert.equal(await stockDe(`/productos/${ids.bebida}`), 0)
        const r = await dueno.post('/stock/ajustes', { items: [{ productoId: ids.bebida, modo: 'reposicion', cantidad: 5 }] })
        assert.equal(r.status, 409)
        assert.equal(r.datos.codigo, 'STOCK_INACTIVO')
    })

    test('se activa en la empresa', async () => {
        const r = await dueno.patch('/empresa', { controlStock: true })
        assert.equal(r.status, 200, JSON.stringify(r.datos))
        assert.equal(r.datos.controlStock, true)
    })

    test('reposición suma y conteo fija el valor real', async () => {
        const r = await dueno.post('/stock/ajustes', {
            motivo: 'Llegó pedido', items: [{ productoId: ids.bebida, modo: 'reposicion', cantidad: 24 }],
        })
        assert.equal(r.status, 200, JSON.stringify(r.datos))
        assert.equal(await stockDe(`/productos/${ids.bebida}`), 24)
        await dueno.post('/stock/ajustes', { items: [{ productoId: ids.bebida, modo: 'conteo', cantidad: 20 }] })
        assert.equal(await stockDe(`/productos/${ids.bebida}`), 20)
    })

    test('la compra suma insumos; la venta de un producto con receta los descuenta', async () => {
        const c = await comprar([{ insumoId: ids.harina, cantidad: 10, precio: 1000 }])
        assert.equal(c.status, 201, JSON.stringify(c.datos))
        assert.equal(await stockDe(`/insumos/${ids.harina}`), 10)
        const v = await vender([{ productoId: ids.pan, cantidad: 30 }, { productoId: ids.bebida, cantidad: 15 }])
        assert.equal(v.status, 201, JSON.stringify(v.datos))
        assert.equal(await stockDe(`/insumos/${ids.harina}`), 7)
        assert.equal(await stockDe(`/productos/${ids.bebida}`), 5)
        assert.equal(await stockDe(`/productos/${ids.pan}`), 0) // con receta no lleva stock propio
        ids.venta = v.datos.id
        ids.compra = c.datos.id
    })

    test('por debajo del mínimo; anular devuelve lo movido', async () => {
        const b = (await dueno.get(`/productos/${ids.bebida}`)).datos
        assert.ok(b.stock <= b.stockMinimo)
        await dueno.post(`/ventas/${ids.venta}/anular`, { motivo: 'error' })
        assert.equal(await stockDe(`/insumos/${ids.harina}`), 10)
        assert.equal(await stockDe(`/productos/${ids.bebida}`), 20)
        await dueno.post(`/egresos/${ids.compra}/anular`, { motivo: 'error' })
        assert.equal(await stockDe(`/insumos/${ids.harina}`), 0)
    })

    test('merma de producto con receta e insumo', async () => {
        await comprar([{ insumoId: ids.harina, cantidad: 4, precio: 1000 }])
        const r = await dueno.post('/mermas', {
            motivoId: cfg.motivosMerma[0].id,
            items: [{ productoId: ids.pan, cantidad: 10 }, { insumoId: ids.harina, cantidad: 1 }],
        })
        assert.equal(r.status, 201, JSON.stringify(r.datos))
        assert.equal(await stockDe(`/insumos/${ids.harina}`), 2)
    })

    test('historial de movimientos y validaciones de ajuste', async () => {
        const m = (await dueno.get(`/stock/movimientos?productoId=${ids.bebida}`)).datos
        assert.deepEqual(m.map((x) => [x.origen, x.cantidad, x.anulacion]),
            [['venta', 15, true], ['venta', -15, false], ['conteo', -4, false], ['reposicion', 24, false]])
        assert.equal((await dueno.post('/stock/ajustes', { items: [{ productoId: ids.pan, modo: 'reposicion', cantidad: 1 }] })).status, 400)
        assert.equal((await dueno.post('/stock/ajustes', { items: [{ productoId: ids.bebida, modo: 'reposicion', cantidad: 0 }] })).status, 400)
    })

    test('el mínimo se puede quitar', async () => {
        const r = await dueno.patch(`/insumos/${ids.harina}`, { stockMinimo: null })
        assert.equal(r.datos.stockMinimo, null)
    })
})
