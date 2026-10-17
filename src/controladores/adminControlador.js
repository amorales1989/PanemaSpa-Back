import * as adminServicio from '../servicios/adminServicio.js'
import * as demoServicio from '../servicios/demoServicio.js'

export const resumen = async (req, res) => res.json(await adminServicio.resumen())
export const listarEmpresas = async (req, res) => res.json(await adminServicio.listarEmpresas(req.consulta))
export const detalleEmpresa = async (req, res) => res.json(await adminServicio.detalleEmpresa(req.params.id))
export const cambiarEstado = async (req, res) => res.json(await adminServicio.cambiarEstado(req, req.params.id, req.body.estado))
export const guardarSuscripcion = async (req, res) => res.json(await adminServicio.guardarSuscripcion(req, req.params.id, req.body))
export const planes = async (req, res) => res.json(await adminServicio.planes())

export const crearDemo = async (req, res) => res.status(201).json(await demoServicio.crear(req, req.body))
export const regenerarDemo = async (req, res) => res.json(await demoServicio.regenerar(req, req.params.id, req.body))
export const eliminarDemo = async (req, res) => {
    await demoServicio.eliminar(req, req.params.id)
    res.status(204).end()
}
