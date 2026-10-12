import express from 'express'
import { z } from 'zod'
import { conEmpresa } from '../db/contexto.js'
import * as proveedorRepositorio from '../repositorios/proveedorRepositorio.js'
import { permiso } from '../middlewares/permiso.js'
import { idValido, validar } from '../middlewares/validar.js'
import { auditar } from '../utilidades/auditoria.js'
import { noEncontrado } from '../utilidades/errores.js'
import { texto, textoOpcional } from '../utilidades/esquemas.js'
import { normalizarRut } from '../utilidades/rut.js'

// /v1/proveedores: directorio con datos de contacto y cuentas bancarias
const router = express.Router()

// RUT opcional: si viene, se valida el dígito verificador y se guarda con formato 76.123.456-7
const rut = z.string().trim().max(20).nullish().transform((v, ctx) => {
    if (!v) return null
    const r = normalizarRut(v)
    if (!r) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'RUT inválido (revisa el dígito verificador)' })
    return r
})
const email = z.string().trim().toLowerCase().email('Email inválido').max(200).nullish().or(z.literal('').transform(() => null))

const esquemaProveedor = z.object({
    nombre: texto(100),
    rut,
    contacto: textoOpcional(100),
    telefono: textoOpcional(30),
    email,
    direccion: textoOpcional(200),
    notas: textoOpcional(1000),
    activo: z.boolean().optional(),
})

const esquemaCuenta = z.object({
    banco: texto(60),
    tipoCuenta: z.enum(['corriente', 'vista', 'rut', 'ahorro']),
    numero: z.string().trim().min(3, 'Número de cuenta muy corto').max(30).regex(/^[\d-]+$/, 'Solo números (y guiones)'),
    titular: texto(100),
    rutTitular: rut,
    email,
    principal: z.boolean().optional(),
})

const cuentaValida = (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.cuentaId).success) throw noEncontrado()
    next()
}

const ver = permiso('proveedores.ver')
const gestionar = permiso('proveedores.gestionar')

const conProveedor = (req, fn) => conEmpresa(req.contexto, async (db) => {
    if (!(await proveedorRepositorio.buscar(db, req.params.id))) throw noEncontrado('Proveedor no encontrado')
    await fn(db)
    return proveedorRepositorio.buscar(db, req.params.id)
})

router.get('/', ver, async (req, res) => {
    res.json(await conEmpresa(req.contexto, (db) => proveedorRepositorio.listar(db)))
})

router.get('/:id', idValido, ver, async (req, res) => {
    const p = await conEmpresa(req.contexto, (db) => proveedorRepositorio.buscar(db, req.params.id))
    if (!p) throw noEncontrado('Proveedor no encontrado')
    res.json(p)
})

router.post('/', gestionar, validar(esquemaProveedor), async (req, res) => {
    res.status(201).json(await conEmpresa(req.contexto, async (db) => {
        const id = await proveedorRepositorio.crear(db, req.contexto.empresaId, req.body)
        return proveedorRepositorio.buscar(db, id)
    }))
})

router.patch('/:id', idValido, gestionar, validar(esquemaProveedor.partial()), async (req, res) => {
    res.json(await conProveedor(req, (db) => proveedorRepositorio.actualizar(db, req.params.id, req.body)))
})

// Cuentas bancarias (cambios auditados: son datos para transferir dinero)
router.post('/:id/cuentas', idValido, gestionar, validar(esquemaCuenta), async (req, res) => {
    res.status(201).json(await conProveedor(req, async (db) => {
        const cuentaId = await proveedorRepositorio.crearCuenta(db, req.contexto.empresaId, req.params.id, req.body)
        await auditar(db, req, { accion: 'proveedor.cuenta.crear', entidad: 'proveedor_cuenta', entidadId: cuentaId, datos: req.body })
    }))
})

router.patch('/:id/cuentas/:cuentaId', idValido, cuentaValida, gestionar, validar(esquemaCuenta.partial()), async (req, res) => {
    res.json(await conProveedor(req, async (db) => {
        if (!(await proveedorRepositorio.actualizarCuenta(db, req.params.id, req.params.cuentaId, req.body))) throw noEncontrado('Cuenta no encontrada')
        await auditar(db, req, { accion: 'proveedor.cuenta.actualizar', entidad: 'proveedor_cuenta', entidadId: req.params.cuentaId, datos: req.body })
    }))
})

router.delete('/:id/cuentas/:cuentaId', idValido, cuentaValida, gestionar, async (req, res) => {
    res.json(await conProveedor(req, async (db) => {
        if (!(await proveedorRepositorio.eliminarCuenta(db, req.params.id, req.params.cuentaId))) throw noEncontrado('Cuenta no encontrada')
        await auditar(db, req, { accion: 'proveedor.cuenta.eliminar', entidad: 'proveedor_cuenta', entidadId: req.params.cuentaId })
    }))
})

export default router
