import express from 'express'
import { z } from 'zod'
import { consultar } from '../db/contexto.js'
import * as empresaRepositorio from '../repositorios/empresaRepositorio.js'
import { invalidarEmpresa } from '../middlewares/empresa.js'
import { permiso } from '../middlewares/permiso.js'
import { validar } from '../middlewares/validar.js'
import { auditar } from '../utilidades/auditoria.js'
import { noEncontrado } from '../utilidades/errores.js'
import { texto, textoOpcional } from '../utilidades/esquemas.js'
import { borrarArchivo, decodificarImagen, guardarArchivo } from '../utilidades/imagenes.js'

// /v1/empresa: datos de la empresa activa (la tabla empresas no tiene RLS: se filtra por el id del contexto)
const router = express.Router()
const db = { query: consultar }

const esquema = z.object({
    nombre: texto(100).optional(),
    razonSocial: textoOpcional(150),
    rut: textoOpcional(20),
}).refine((d) => Object.keys(d).length > 0, 'No hay cambios')

router.get('/', async (req, res) => {
    const empresa = await empresaRepositorio.datos(db, req.contexto.empresaId)
    if (!empresa) throw noEncontrado()
    res.json(empresa)
})

router.patch('/', permiso('configuracion.gestionar'), validar(esquema), async (req, res) => {
    const empresa = await empresaRepositorio.actualizarDatos(db, req.contexto.empresaId, req.body)
    if (!empresa) throw noEncontrado()
    invalidarEmpresa(req.contexto.empresaId) // el nombre nuevo aplica ya en todas las sesiones
    await auditar(db, req, { accion: 'empresa.actualizar', entidad: 'empresa', entidadId: req.contexto.empresaId, datos: req.body })
    res.json(empresa)
})

// Logo: PNG o JPEG (los informes PDF no admiten WebP). El front lo entrega reducido.
router.put('/logo', permiso('configuracion.gestionar'), validar(z.object({ imagen: z.string().max(2_100_000) })), async (req, res) => {
    const imagen = decodificarImagen(req.body.imagen, ['image/png', 'image/jpeg'])
    const anterior = (await empresaRepositorio.datos(db, req.contexto.empresaId))?.logo_url
    const url = await guardarArchivo(req.contexto.empresaId, 'logo', imagen)
    await empresaRepositorio.ponerLogo(db, req.contexto.empresaId, url)
    await borrarArchivo(anterior)
    await auditar(db, req, { accion: 'empresa.logo', entidad: 'empresa', entidadId: req.contexto.empresaId })
    res.json(await empresaRepositorio.datos(db, req.contexto.empresaId))
})

router.delete('/logo', permiso('configuracion.gestionar'), async (req, res) => {
    const anterior = (await empresaRepositorio.datos(db, req.contexto.empresaId))?.logo_url
    await empresaRepositorio.ponerLogo(db, req.contexto.empresaId, null)
    await borrarArchivo(anterior)
    res.json(await empresaRepositorio.datos(db, req.contexto.empresaId))
})

export default router
