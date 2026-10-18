import express from 'express'
import { z } from 'zod'
import { conEmpresa } from '../db/contexto.js'
import * as clienteRepositorio from '../repositorios/clienteRepositorio.js'
import { permiso } from '../middlewares/permiso.js'
import { idValido, validar } from '../middlewares/validar.js'
import { conflicto, noEncontrado } from '../utilidades/errores.js'
import { texto, textoOpcional } from '../utilidades/esquemas.js'

// /v1/clientes: para asociarlos a la venta y buscarlos rápido al cobrar
const router = express.Router()

const email = z.string().trim().toLowerCase().email('Email inválido').max(200).nullish().or(z.literal('').transform(() => null))

// .optional() en los opcionales: en una edición, lo que no viene no se toca
const esquemaCliente = z.object({
    nombre: texto(100),
    documento: textoOpcional(30).optional(),
    telefono: textoOpcional(30).optional(),
    email: email.optional(),
    direccion: textoOpcional(200).optional(),
    notas: textoOpcional(1000).optional(),
})

const filtro = z.object({
    buscar: z.string().trim().max(100).optional(),
    limite: z.coerce.number().int().min(1).max(500).default(50),
})

const ver = permiso('clientes.ver')
const gestionar = permiso('clientes.gestionar')
// Quien vende puede dar de alta un cliente desde la caja, aunque no administre clientes
const crear = permiso('clientes.gestionar', 'ventas.crear')

// Dos clientes con el mismo documento serían el mismo: se avisa cuál ya existe
async function documentoLibre(db, documento, salvoId) {
    const otro = await clienteRepositorio.conDocumento(db, documento, salvoId)
    if (otro) throw conflicto('DOCUMENTO_REPETIDO', `Ya existe un cliente con ese documento: ${otro.nombre}`)
}

router.get('/', ver, validar(filtro, 'query'), async (req, res) => {
    res.json(await conEmpresa(req.contexto, (db) => clienteRepositorio.listar(db, req.consulta)))
})

router.get('/:id', idValido, ver, async (req, res) => {
    const c = await conEmpresa(req.contexto, (db) => clienteRepositorio.buscar(db, req.params.id))
    if (!c) throw noEncontrado('Cliente no encontrado')
    res.json(c)
})

router.post('/', crear, validar(esquemaCliente), async (req, res) => {
    res.status(201).json(await conEmpresa(req.contexto, async (db) => {
        await documentoLibre(db, req.body.documento)
        const id = await clienteRepositorio.crear(db, req.contexto.empresaId, req.body)
        return clienteRepositorio.buscar(db, id)
    }))
})

router.patch('/:id', idValido, gestionar, validar(esquemaCliente.partial()), async (req, res) => {
    res.json(await conEmpresa(req.contexto, async (db) => {
        if (req.body.documento) await documentoLibre(db, req.body.documento, req.params.id)
        if (!(await clienteRepositorio.actualizar(db, req.params.id, req.body))) throw noEncontrado('Cliente no encontrado')
        return clienteRepositorio.buscar(db, req.params.id)
    }))
})

router.delete('/:id', idValido, gestionar, async (req, res) => {
    const n = await conEmpresa(req.contexto, (db) => clienteRepositorio.eliminar(db, req.params.id))
    if (!n) throw noEncontrado('Cliente no encontrado')
    res.status(204).end()
})

export default router
