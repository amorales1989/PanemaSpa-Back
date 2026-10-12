import * as insumoServicio from '../servicios/insumoServicio.js'

export const listar = async (req, res) => res.json(await insumoServicio.listar(req, req.consulta))
export const buscar = async (req, res) => res.json(await insumoServicio.buscar(req, req.params.id))
export const siguienteCodigo = async (req, res) => res.json(await insumoServicio.siguienteCodigo(req))
export const crear = async (req, res) => res.status(201).json(await insumoServicio.crear(req, req.body))
export const actualizar = async (req, res) => res.json(await insumoServicio.actualizar(req, req.params.id, req.body))
export const compras = async (req, res) => res.json(await insumoServicio.compras(req, req.params.id))

export const eliminar = async (req, res) => {
    await insumoServicio.eliminar(req, req.params.id)
    res.status(204).end()
}
