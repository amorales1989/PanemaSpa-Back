import * as productoServicio from '../servicios/productoServicio.js'

export const listar = async (req, res) => res.json(await productoServicio.listar(req, req.consulta))
export const buscar = async (req, res) => res.json(await productoServicio.buscar(req, req.params.id))
export const siguienteCodigo = async (req, res) => res.json(await productoServicio.siguienteCodigo(req))
export const crear = async (req, res) => res.status(201).json(await productoServicio.crear(req, req.body))
export const actualizar = async (req, res) => res.json(await productoServicio.actualizar(req, req.params.id, req.body))

export const eliminar = async (req, res) => {
    await productoServicio.eliminar(req, req.params.id)
    res.status(204).end()
}

export const historialPrecios = async (req, res) => res.json(await productoServicio.historialPrecios(req, req.params.id))
export const ajustarPrecios = async (req, res) => res.json(await productoServicio.ajustarPrecios(req, req.body))
export const guardarImagen = async (req, res) => res.json(await productoServicio.guardarImagen(req, req.params.id, req.body.imagen))

export const quitarImagen = async (req, res) => {
    await productoServicio.quitarImagen(req, req.params.id)
    res.status(204).end()
}
