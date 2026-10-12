import * as promoServicio from '../servicios/promoServicio.js'

export const listar = async (req, res) => res.json(await promoServicio.listar(req, req.consulta))
export const buscar = async (req, res) => res.json(await promoServicio.buscar(req, req.params.id))
export const crear = async (req, res) => res.status(201).json(await promoServicio.crear(req, req.body))
export const actualizar = async (req, res) => res.json(await promoServicio.actualizar(req, req.params.id, req.body))

export const eliminar = async (req, res) => {
    await promoServicio.eliminar(req, req.params.id)
    res.status(204).end()
}
