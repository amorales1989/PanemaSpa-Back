import * as adminServicio from '../servicios/adminServicio.js'

export const resumen = async (req, res) => res.json(await adminServicio.resumen())
export const listarEmpresas = async (req, res) => res.json(await adminServicio.listarEmpresas(req.consulta))
export const detalleEmpresa = async (req, res) => res.json(await adminServicio.detalleEmpresa(req.params.id))
export const cambiarEstado = async (req, res) => res.json(await adminServicio.cambiarEstado(req, req.params.id, req.body.estado))
export const guardarSuscripcion = async (req, res) => res.json(await adminServicio.guardarSuscripcion(req, req.params.id, req.body))
export const planes = async (req, res) => res.json(await adminServicio.planes())
