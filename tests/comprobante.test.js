// Comprobante de venta imprimible: configuración por empresa
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciar, miembro, nuevaEmpresa, pedir, terminar } from './ayudantes.js'

let dueno

before(async () => {
    iniciar()
    dueno = await nuevaEmpresa('comprobante')
})
after(terminar)

describe('configuración del comprobante', () => {
    test('viene desactivado y en formato ticket', async () => {
        const r = await dueno.get('/empresa')
        assert.equal(r.datos.comprobanteActivo, false)
        assert.equal(r.datos.comprobanteFormato, 'ticket')
    })

    test('el dueño lo activa y llega en el perfil (lo usa la caja)', async () => {
        const r = await dueno.patch('/empresa', {
            comprobanteActivo: true, comprobanteFormato: 'carta', comprobantePie: '¡Gracias por tu compra!',
            direccion: 'Av. Siempre Viva 742', telefono: '+56 9 1234 5678',
        })
        assert.equal(r.status, 200, JSON.stringify(r.datos))
        const yo = (await pedir('/v1/auth/yo', { token: dueno.token })).datos.empresas[0]
        assert.equal(yo.comprobanteActivo, true)
        assert.equal(yo.comprobanteFormato, 'carta')
        assert.equal(yo.comprobantePie, '¡Gracias por tu compra!')
        assert.equal(yo.direccion, 'Av. Siempre Viva 742')
    })

    test('un cambio parcial no borra los demás datos', async () => {
        await dueno.patch('/empresa', { razonSocial: 'Comprobante SpA', rut: '76.086.428-5' })
        const r = await dueno.patch('/empresa', { comprobanteFormato: 'ticket' })
        assert.equal(r.datos.razonSocial, 'Comprobante SpA')
        assert.equal(r.datos.rut, '76.086.428-5')
        assert.equal(r.datos.direccion, 'Av. Siempre Viva 742')
        assert.equal(r.datos.comprobanteActivo, true)
    })

    test('vacío borra un dato; un formato inválido se rechaza', async () => {
        assert.equal((await dueno.patch('/empresa', { comprobantePie: '' })).datos.comprobantePie, null)
        assert.equal((await dueno.patch('/empresa', { comprobanteFormato: 'a5' })).status, 400)
    })

    test('el vendedor lo ve en su perfil pero no puede cambiarlo', async () => {
        const v = await miembro(dueno, 'vendedor', 'comprobante-vend')
        assert.equal((await v.patch('/empresa', { comprobanteActivo: false })).status, 403)
        const yo = (await pedir('/v1/auth/yo', { token: v.token })).datos.empresas.find((e) => e.id === dueno.empresa)
        assert.equal(yo.comprobanteActivo, true)
    })
})
