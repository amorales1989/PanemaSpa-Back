import express from 'express'
import * as configuracionControlador from '../controladores/configuracionControlador.js'

// Montada detrás de auth + empresa (ver app.js). Lectura abierta a cualquier miembro:
// todos los roles necesitan las listas para sus formularios.
const router = express.Router()

router.get('/', configuracionControlador.obtener)

export default router
