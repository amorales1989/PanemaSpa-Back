// Fase 4: configuración, catálogo y movimientos
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciar, miembro, nuevaEmpresa, pedir, terminar } from './ayudantes.js'

let dueno     // dueño de la empresa A
let vendedor  // vendedor de la empresa A
let otra      // dueño de la empresa B
let cfg       // /config de A
const de = (lista, nombre) => lista.find((x) => x.nombre === nombre)
const ids = {}

before(async () => {
    iniciar()
    dueno = await nuevaEmpresa('negocio-a')
    otra = await nuevaEmpresa('negocio-b')
    vendedor = await miembro(dueno, 'vendedor', 'vendedor-a')
    cfg = (await dueno.get('/config')).datos
})
after(terminar)

describe('configuración', () => {
    test('crear canal, rechazar duplicado y desactivar', async () => {
        const r = await dueno.post('/config/canales', { nombre: 'Kiosko' })
        assert.equal(r.status, 201)
        assert.equal(r.datos.nombre, 'Kiosko')
        assert.equal((await dueno.post('/config/canales', { nombre: 'Kiosko' })).status, 409)
        assert.equal((await dueno.post('/config/canales', { nombre: 'kiosko' })).status, 409)
        // Lo nuevo queda al final de la lista
        const canales = (await dueno.get('/config')).datos.canales
        assert.equal(canales.at(-1).nombre, 'Kiosko')
        const off = await dueno.patch(`/config/canales/${r.datos.id}`, { activo: false })
        assert.equal(off.datos.activo, false)
    })

    test('lista inexistente → 404, vendedor sin permiso → 403', async () => {
        assert.equal((await dueno.post('/config/inventadas', { nombre: 'x' })).status, 404)
        assert.equal((await dueno.post('/config/constructor', { nombre: 'x' })).status, 404)
        assert.equal((await vendedor.post('/config/canales', { nombre: 'Feria' })).status, 403)
    })

    test('categoría con ámbito', async () => {
        const r = await dueno.post('/config/categorias', { nombre: 'Bebidas', ambito: 'producto' })
        assert.equal(r.status, 201)
        assert.equal(r.datos.ambito, 'producto')
    })
})

describe('productos', () => {
    test('crear asigna código 101, 102... y respeta la categoría', async () => {
        const panes = de(cfg.categorias.producto, 'Panes')
        const r1 = await dueno.post('/productos', { nombre: 'Marraqueta', categoriaId: panes.id, unidad: 'kg', precio: 2490, costo: 1100 })
        assert.equal(r1.status, 201)
        assert.equal(r1.datos.codigo, 101)
        assert.equal(r1.datos.categoria, 'Panes')
        assert.equal(r1.datos.costo, 1100)
        ids.marraqueta = r1.datos.id

        const r2 = await dueno.post('/productos', { nombre: 'Medialuna', unidad: 'un', precio: 900, costo: 300 })
        assert.equal(r2.datos.codigo, 102)
        ids.medialuna = r2.datos.id
        const r3 = await dueno.post('/productos', { nombre: 'Café americano', unidad: 'un', precio: 1900, costo: 400 })
        ids.cafe = r3.datos.id
    })

    test('categoría por nombre: usa la existente o la crea', async () => {
        const r = await dueno.post('/productos', { nombre: 'Pan integral', categoria: 'panes', unidad: 'un', precio: 600 })
        assert.equal(r.datos.categoria, 'Panes')
        const n = await dueno.post('/productos', { nombre: 'Empanada', categoria: 'Salados', unidad: 'un', precio: 1500 })
        assert.equal(n.datos.categoria, 'Salados')
        const cats = (await dueno.get('/config')).datos.categorias.producto.map((c) => c.nombre)
        assert.ok(cats.includes('Salados'))
        await dueno.del(`/productos/${r.datos.id}`)
        await dueno.del(`/productos/${n.datos.id}`)
    })

    test('categoría de insumos en un producto → 400; código repetido → 409', async () => {
        const secos = de(cfg.categorias.insumo, 'Secos')
        assert.equal((await dueno.post('/productos', { nombre: 'X', categoriaId: secos.id, unidad: 'un', precio: 1 })).status, 400)
        assert.equal((await dueno.post('/productos', { nombre: 'X', codigo: 101, unidad: 'un', precio: 1 })).status, 409)
    })

    test('el vendedor ve productos pero no costos, y no puede crearlos', async () => {
        const r = await vendedor.get('/productos')
        assert.equal(r.status, 200)
        assert.ok(r.datos.length >= 3)
        assert.ok(r.datos.every((p) => !('costo' in p)))
        assert.equal((await vendedor.post('/productos', { nombre: 'Y', unidad: 'un', precio: 1 })).status, 403)
    })

    test('editar el precio deja historial con motivo y usuario', async () => {
        const r = await dueno.patch(`/productos/${ids.marraqueta}`, { precio: 2590 })
        assert.equal(r.datos.precio, 2590)
        const h = await dueno.get(`/productos/${ids.marraqueta}/historial-precios`)
        assert.equal(h.datos.length, 1)
        assert.deepEqual([h.datos[0].precioAnterior, h.datos[0].precioNuevo, h.datos[0].motivo], [2490, 2590, 'Edición'])
        assert.equal(h.datos[0].usuario, 'Dueño negocio-a')
    })

    test('ajuste masivo de precios', async () => {
        const r = await dueno.post('/productos/ajuste-precios', {
            motivo: 'Alza +10%',
            cambios: [{ id: ids.medialuna, precio: 990 }, { id: ids.cafe, precio: 2090 }],
        })
        assert.deepEqual(r.datos, { actualizados: 2 })
        const h = await dueno.get(`/productos/${ids.cafe}/historial-precios`)
        assert.equal(h.datos[0].motivo, 'Alza +10%')
        assert.equal((await vendedor.post('/productos/ajuste-precios', { motivo: 'x', cambios: [{ id: ids.cafe, precio: 1 }] })).status, 403)
    })

    test('foto: guardar, servir y validar el contenido', async () => {
        // JPEG mínimo (cabecera válida)
        const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString('base64')
        const r = await dueno.put(`/productos/${ids.medialuna}/imagen`, { imagen: `data:image/jpeg;base64,${jpeg}` })
        assert.equal(r.status, 200)
        assert.match(r.datos.imagenUrl, /^\/uploads\/.+\.jpg$/)
        assert.equal((await pedir(r.datos.imagenUrl)).status, 200)

        const falso = Buffer.from('<script>alert(1)</script>').toString('base64')
        assert.equal((await dueno.put(`/productos/${ids.medialuna}/imagen`, { imagen: `data:image/jpeg;base64,${falso}` })).status, 400)
    })

    test('otra empresa no ve ni toca el producto', async () => {
        assert.equal((await otra.get(`/productos/${ids.marraqueta}`)).status, 404)
        assert.equal((await otra.patch(`/productos/${ids.marraqueta}`, { precio: 1 })).status, 404)
        assert.equal((await otra.get('/productos')).datos.length, 0)
    })
})

describe('insumos y promos', () => {
    test('insumo con código 501', async () => {
        const r = await dueno.post('/insumos', { nombre: 'Harina', unidad: 'kg', precio: 880 })
        assert.equal(r.status, 201)
        assert.equal(r.datos.codigo, 501)
        ids.harina = r.datos.id
        ids.huevos = (await dueno.post('/insumos', { nombre: 'Huevos', unidad: 'un', precio: 180 })).datos.id
    })

    test('promo con productos y precio normal calculado', async () => {
        const r = await dueno.post('/promos', {
            nombre: 'Desayuno', precio: 3200,
            productos: [{ productoId: ids.cafe, cantidad: 1 }, { productoId: ids.medialuna, cantidad: 2 }],
        })
        assert.equal(r.status, 201)
        assert.equal(r.datos.codigo, 901)
        assert.equal(r.datos.precioNormal, 2090 + 2 * 990)
        assert.equal(r.datos.productos.length, 2)
        ids.desayuno = r.datos.id
    })

    test('no se puede eliminar un producto que está en una promo', async () => {
        const r = await dueno.del(`/productos/${ids.cafe}`)
        assert.equal(r.status, 409)
        assert.equal(r.datos.codigo, 'PRODUCTO_EN_PROMO')
    })

    test('promo con producto de otra empresa → 400', async () => {
        const r = await otra.post('/promos', { nombre: 'Robo', precio: 1, productos: [{ productoId: ids.cafe, cantidad: 1 }] })
        assert.equal(r.status, 400)
    })
})

describe('ventas', () => {
    const base = () => ({ canalId: de(cfg.canales, 'Mostrador').id, metodoPagoId: de(cfg.metodosPago, 'Efectivo').id })

    test('venta con producto por peso y promo: precios del catálogo y promo desglosada', async () => {
        const r = await vendedor.post('/ventas', {
            ...base(),
            items: [{ productoId: ids.marraqueta, cantidad: 0.512 }, { promoId: ids.desayuno, cantidad: 1 }],
        })
        assert.equal(r.status, 201, JSON.stringify(r.datos))
        assert.equal(r.datos.numero, 1)
        assert.equal(r.datos.items[0].subtotal, Math.round(0.512 * 2590))
        assert.equal(r.datos.items[1].tipo, 'promo')
        assert.equal(r.datos.items[1].componentes.length, 2)
        assert.equal(r.datos.total, Math.round(0.512 * 2590) + 3200)
        assert.equal(r.datos.usuario, 'Dueño vendedor-a')
        ids.venta1 = r.datos.id
    })

    test('el vendedor no puede cambiar precios; el dueño sí', async () => {
        const item = [{ productoId: ids.medialuna, cantidad: 2, precio: 500 }]
        assert.equal((await vendedor.post('/ventas', { ...base(), items: item })).status, 403)
        const r = await dueno.post('/ventas', { ...base(), items: item })
        assert.equal(r.status, 201)
        assert.equal(r.datos.total, 1000)
        assert.equal(r.datos.numero, 2)
    })

    test('mandar el mismo precio del catálogo no requiere permiso', async () => {
        const r = await vendedor.post('/ventas', { ...base(), items: [{ productoId: ids.medialuna, cantidad: 1, precio: 990 }] })
        assert.equal(r.status, 201)
    })

    test('Idempotency-Key: el reintento devuelve la misma venta', async () => {
        const headers = { 'Idempotency-Key': 'venta-test-0001' }
        const cuerpo = { ...base(), items: [{ productoId: ids.cafe, cantidad: 1 }] }
        const r1 = await dueno.post('/ventas', cuerpo, { headers })
        const r2 = await dueno.post('/ventas', cuerpo, { headers })
        assert.equal(r1.status, 201)
        assert.equal(r2.status, 200)
        assert.equal(r2.datos.id, r1.datos.id)
    })

    test('validaciones: cantidad no entera en unidades, producto ajeno, fecha futura', async () => {
        assert.equal((await dueno.post('/ventas', { ...base(), items: [{ productoId: ids.medialuna, cantidad: 1.5 }] })).status, 400)
        const ajeno = await otra.post('/ventas', {
            canalId: de((await otra.get('/config')).datos.canales, 'Mostrador').id,
            metodoPagoId: de((await otra.get('/config')).datos.metodosPago, 'Efectivo').id,
            items: [{ productoId: ids.cafe, cantidad: 1 }],
        })
        assert.equal(ajeno.status, 400)
        assert.equal((await dueno.post('/ventas', { ...base(), fecha: '2999-01-01', items: [{ productoId: ids.cafe, cantidad: 1 }] })).status, 400)
        assert.equal((await dueno.post('/ventas', { ...base(), items: [] })).status, 400)
    })

    test('el vendedor solo ve sus ventas; el dueño ve todas', async () => {
        const propias = await vendedor.get('/ventas')
        assert.ok(propias.datos.datos.every((v) => v.usuarioId === vendedor.usuarioId))
        const todas = await dueno.get('/ventas')
        assert.ok(todas.datos.datos.length > propias.datos.datos.length)
        const ajena = todas.datos.datos.find((v) => v.usuarioId === dueno.usuarioId)
        assert.equal((await vendedor.get(`/ventas/${ajena.id}`)).status, 404)
    })

    test('el vendedor solo ve las ventas de hoy (aunque pida otro rango)', async () => {
        // "Ayer" en la zona horaria de la empresa (America/Santiago), no en UTC
        const ayer = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(Date.now() - 86400000))
        const vieja = await vendedor.post('/ventas', { ...base(), fecha: ayer, items: [{ productoId: ids.medialuna, cantidad: 1 }] })
        assert.equal(vieja.status, 201)
        const lista = await vendedor.get(`/ventas?desde=2000-01-01&hasta=${ayer}`)
        assert.ok(!lista.datos.datos.some((v) => v.id === vieja.datos.id))
        assert.ok(lista.datos.datos.every((v) => v.fecha === lista.datos.datos[0].fecha))
        assert.equal((await vendedor.get(`/ventas/${vieja.datos.id}`)).status, 404)
        // El dueño sí la ve
        assert.equal((await dueno.get(`/ventas/${vieja.datos.id}`)).status, 200)
    })

    test('paginación con cursor', async () => {
        const p1 = await dueno.get('/ventas?limite=2')
        assert.equal(p1.datos.datos.length, 2)
        assert.ok(p1.datos.siguiente)
        const p2 = await dueno.get(`/ventas?limite=2&cursor=${p1.datos.siguiente}`)
        assert.ok(p2.datos.datos.length >= 1)
        assert.ok(p2.datos.datos[0].numero < p1.datos.datos[1].numero)
    })

    test('anular: vendedor no puede, dueño sí, y no dos veces', async () => {
        assert.equal((await vendedor.post(`/ventas/${ids.venta1}/anular`, { motivo: 'error' })).status, 403)
        const r = await dueno.post(`/ventas/${ids.venta1}/anular`, { motivo: 'Cobrada dos veces' })
        assert.equal(r.status, 200)
        assert.equal(r.datos.estado, 'anulada')
        assert.equal((await dueno.post(`/ventas/${ids.venta1}/anular`, { motivo: 'otra vez' })).status, 409)
        const confirmadas = await dueno.get('/ventas')
        assert.ok(!confirmadas.datos.datos.some((v) => v.id === ids.venta1))
    })
})

describe('egresos', () => {
    const insumos = () => de(cfg.categorias.egreso, 'Insumos').id
    const transferencia = () => de(cfg.metodosPago, 'Transferencia').id

    test('compra de insumos: total, proveedor creado y precio del insumo actualizado', async () => {
        const r = await dueno.post('/egresos', {
            categoriaId: insumos(), metodoPagoId: transferencia(), proveedor: 'Molinera del Sur',
            items: [{ insumoId: ids.harina, cantidad: 50, precio: 900 }, { insumoId: ids.huevos, cantidad: 180, precio: 190 }],
        })
        assert.equal(r.status, 201, JSON.stringify(r.datos))
        assert.equal(r.datos.total, 50 * 900 + 180 * 190)
        assert.equal(r.datos.proveedor, 'Molinera del Sur')
        assert.equal(r.datos.items.length, 2)
        assert.equal((await dueno.get(`/insumos/${ids.harina}`)).datos.precio, 900)
        assert.equal((await dueno.get(`/insumos/${ids.harina}/compras`)).datos.length, 1)

        // Mismo proveedor escrito distinto → no se duplica
        await dueno.post('/egresos', {
            categoriaId: insumos(), metodoPagoId: transferencia(), proveedor: 'molinera del sur',
            items: [{ insumoId: ids.harina, cantidad: 25, precio: 910 }],
        })
        const proveedores = (await dueno.get('/config')).datos.proveedores
        assert.equal(proveedores.filter((p) => p.nombre.toLowerCase() === 'molinera del sur').length, 1)
    })

    test('gasto sin insumos: requiere monto; compra sin insumos → 400', async () => {
        const sueldos = de(cfg.categorias.egreso, 'Sueldos').id
        assert.equal((await dueno.post('/egresos', { categoriaId: sueldos, metodoPagoId: transferencia() })).status, 400)
        const r = await dueno.post('/egresos', { categoriaId: sueldos, metodoPagoId: transferencia(), monto: 620000, descripcion: 'Sueldo vendedora' })
        assert.equal(r.status, 201)
        assert.equal(r.datos.total, 620000)
        assert.equal((await dueno.post('/egresos', { categoriaId: insumos(), metodoPagoId: transferencia(), monto: 1000 })).status, 400)
    })

    test('el vendedor no ve ni registra egresos', async () => {
        assert.equal((await vendedor.get('/egresos')).status, 403)
    })
})

describe('mermas', () => {
    test('merma valorizada a costo (producto) y a último precio (insumo)', async () => {
        const vencido = de(cfg.motivosMerma, 'Vencido').id
        const r = await vendedor.post('/mermas', {
            motivoId: vencido,
            items: [{ productoId: ids.medialuna, cantidad: 3 }, { insumoId: ids.harina, cantidad: 2 }],
        })
        assert.equal(r.status, 201, JSON.stringify(r.datos))
        assert.equal(r.datos.total, 3 * 300 + 2 * 910)
        assert.equal(r.datos.motivo, 'Vencido')
        // El vendedor registra merma pero no puede ver el listado (no tiene mermas.ver)
        assert.equal((await vendedor.get('/mermas')).status, 403)
        assert.equal((await dueno.get('/mermas')).datos.datos.length, 1)
    })
})
