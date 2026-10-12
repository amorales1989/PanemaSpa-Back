import * as configuracionServicio from '../servicios/configuracionServicio.js'

export const obtener = async (req, res) => {
    res.json({ empresa: req.empresa, ...(await configuracionServicio.obtener(req.contexto)) })
}

export const crear = async (req, res) => {
    res.status(201).json(await configuracionServicio.crear(req.contexto, req.params.lista, req.body))
}

export const actualizar = async (req, res) => {
    res.json(await configuracionServicio.actualizar(req.contexto, req.params.lista, req.params.id, req.body))
}
