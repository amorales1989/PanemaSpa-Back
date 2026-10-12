import * as configuracionServicio from '../servicios/configuracionServicio.js'

export const obtener = async (req, res) => {
    res.json({ empresa: req.empresa, ...(await configuracionServicio.obtener(req.contexto)) })
}
