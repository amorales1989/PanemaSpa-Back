// Importación masiva del catálogo
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciar, miembro, nuevaEmpresa, terminar } from './ayudantes.js'

let dueno
let vendedor
const planilla = {
    productos: [
        { fila: 2, codigo: 101, nombre: 'Marraqueta', categoria: 'Panes', unidad: 'kg', precio: 2490, costo: 1100 },
        { fila: 3, codigo: 102, nombre: 'Café americano', categoria: 'Cafetería', unidad: 'un', precio: 1900, costo: 400 },
        { fila: 4, nombre: 'Medialuna', categoria: 'Pastelería', unidad: 'un', precio: 900, costo: 300 },
    ],
    insumos: [{ fila: 2, nombre: 'Harina', categoria: 'Secos', unidad: 'kg', precio: 880 }],
    promos: [{ fila: 2, codigo: 901, nombre: 'Desayuno', precio: 3200, productos: [{ codigo: 102, cantidad: 1 }, { codigo: 103, cantidad: 2 }] }],
}

before(async () => {
    iniciar()
    dueno = await nuevaEmpresa('importa')
    vendedor = await miembro(dueno, 'vendedor', 'importa-vend')
})
after(terminar)

describe('importar catálogo', () => {
    test('vista previa: calcula todo pero no guarda nada', async () => {
        const r = await dueno.post('/importar/catalogo', { ...planilla, aplicar: false })
        assert.equal(r.status, 200)
        assert.equal(r.datos.aplicado, false)
        assert.deepEqual(r.datos.productos, { creados: 3, actualizados: 0 })
        assert.deepEqual(r.datos.promos, { creadas: 1, actualizadas: 0 })
        assert.equal(r.datos.errores.length, 0)
        assert.equal((await dueno.get('/productos')).datos.length, 0)
    })

    test('aplicar: crea productos (código automático), insumos, promo y categorías nuevas', async () => {
        const r = await dueno.post('/importar/catalogo', { ...planilla, aplicar: true })
        assert.equal(r.datos.aplicado, true)
        const productos = (await dueno.get('/productos')).datos
        assert.deepEqual(productos.map((p) => [p.codigo, p.nombre]), [[101, 'Marraqueta'], [102, 'Café americano'], [103, 'Medialuna']])
        assert.equal(productos[0].costo, 1100)
        const promo = (await dueno.get('/promos')).datos[0]
        assert.equal(promo.precioNormal, 1900 + 2 * 900)
        assert.equal((await dueno.get('/insumos')).datos[0].codigo, 501)
    })

    test('reimportar actualiza por código o nombre y deja el cambio de precio en el historial', async () => {
        const r = await dueno.post('/importar/catalogo', {
            aplicar: true,
            productos: [
                { fila: 2, codigo: 101, nombre: 'Marraqueta', unidad: 'kg', precio: 2590 },
                { fila: 3, nombre: 'medialuna', unidad: 'un', precio: 950 },
            ],
        })
        assert.deepEqual(r.datos.productos, { creados: 0, actualizados: 2 })
        const marraqueta = (await dueno.get('/productos')).datos.find((p) => p.codigo === 101)
        const h = await dueno.get(`/productos/${marraqueta.id}/historial-precios`)
        assert.equal(h.datos[0].motivo, 'Importación')
        assert.equal(h.datos[0].precioNuevo, 2590)
    })

    test('una fila con error bloquea toda la importación e indica la fila', async () => {
        const r = await dueno.post('/importar/catalogo', {
            aplicar: true,
            productos: [{ fila: 2, codigo: 200, nombre: 'Nuevo bueno', unidad: 'un', precio: 100 }],
            promos: [{ fila: 5, nombre: 'Rota', precio: 1000, productos: [{ codigo: 999, cantidad: 1 }] }],
        })
        assert.equal(r.datos.aplicado, false)
        assert.deepEqual(r.datos.errores, [{ hoja: 'Promos', fila: 5, mensaje: 'No existe el producto con código 999' }])
        assert.ok(!(await dueno.get('/productos')).datos.some((p) => p.codigo === 200))
    })

    test('el vendedor no puede importar', async () => {
        assert.equal((await vendedor.post('/importar/catalogo', { productos: planilla.productos })).status, 403)
    })
})
