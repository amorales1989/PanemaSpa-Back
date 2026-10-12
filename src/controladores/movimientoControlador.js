// Controladores de ventas, egresos y mermas: misma forma, distinto servicio.
import * as ventaServicio from '../servicios/ventaServicio.js'
import * as egresoServicio from '../servicios/egresoServicio.js'
import * as mermaServicio from '../servicios/mermaServicio.js'
import { datosInvalidos } from '../utilidades/errores.js'

// Idempotency-Key: la genera el front por cada registro (crypto.randomUUID())
function claveIdempotencia(req) {
    const clave = req.get('idempotency-key')
    if (clave === undefined) return null
    if (!/^[\w-]{8,100}$/.test(clave)) throw datosInvalidos({ 'Idempotency-Key': ['Formato inválido'] })
    return clave
}

function controlador(servicio, clave) {
    return {
        // 201 si se creó; 200 con el mismo registro si era un reintento
        crear: async (req, res) => {
            const resultado = await servicio.crear(req, req.body, claveIdempotencia(req))
            const repetido = resultado.repetida ?? resultado.repetido
            res.status(repetido ? 200 : 201).json(resultado[clave])
        },
        listar: async (req, res) => res.json(await servicio.listar(req, req.consulta)),
        buscar: async (req, res) => res.json(await servicio.buscar(req, req.params.id)),
        anular: async (req, res) => res.json(await servicio.anular(req, req.params.id, req.body.motivo)),
    }
}

export const ventas = controlador(ventaServicio, 'venta')
export const egresos = controlador(egresoServicio, 'egreso')
export const mermas = controlador(mermaServicio, 'merma')
