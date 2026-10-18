import express from 'express'
import { z } from 'zod'
import { conEmpresa } from '../db/contexto.js'
import * as proveedorRepositorio from '../repositorios/proveedorRepositorio.js'
import { permiso } from '../middlewares/permiso.js'
import { idValido, validar } from '../middlewares/validar.js'
import { auditar } from '../utilidades/auditoria.js'
import { datosInvalidos, noEncontrado } from '../utilidades/errores.js'
import { texto, textoOpcional } from '../utilidades/esquemas.js'
import { PAISES, cbuValido, normalizarIdFiscal } from '../utilidades/paises.js'

// /v1/proveedores: directorio con datos de contacto y cuentas bancarias
const router = express.Router()

// RUT (Chile) o CUIT (Argentina), opcional. El formato depende del país: se valida en idFiscal()
const rut = z.string().trim().max(20).nullish().transform((v) => v || null)
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

// Chile: corriente / vista / CuentaRUT / ahorro + número. Argentina: caja de ahorro o corriente + CBU/CVU y/o alias.
const esquemaCuenta = z.object({
    banco: texto(60),
    tipoCuenta: z.enum(['corriente', 'vista', 'rut', 'ahorro']),
    numero: z.string().trim().max(30).regex(/^[\d\s-]*$/, 'Solo números (y guiones)').nullish().transform((v) => v?.replace(/\s/g, '') || null),
    alias: z.string().trim().max(20).regex(/^[a-zA-Z0-9.-]*$/, 'El alias solo lleva letras, números, puntos y guiones').nullish()
        .transform((v) => v?.toLowerCase() || null),
    titular: texto(100),
    rutTitular: rut,
    email,
    principal: z.boolean().optional(),
})

// Lo que depende del país, con mensajes claros para cada campo
function idFiscal(req, campo) {
    const valor = req.body[campo]
    if (!valor) return
    const id = normalizarIdFiscal(req.empresa.pais, valor)
    if (!id) throw datosInvalidos({ [campo]: [`${PAISES[req.empresa.pais].idFiscal} inválido (revisa el dígito verificador)`] })
    req.body[campo] = id
}

function validarCuenta(req, parcial) {
    idFiscal(req, 'rutTitular')
    const { numero, alias, tipoCuenta } = req.body
    if (req.empresa.pais === 'AR') {
        if (tipoCuenta && !['ahorro', 'corriente'].includes(tipoCuenta)) throw datosInvalidos({ tipoCuenta: ['En Argentina: caja de ahorro o cuenta corriente'] })
        if (numero && !cbuValido(numero)) throw datosInvalidos({ numero: ['CBU/CVU inválido: son 22 números (revisa que esté completo)'] })
        if (!parcial && !numero && !alias) throw datosInvalidos({ numero: ['Indica el CBU/CVU o el alias'] })
    } else {
        if (alias) throw datosInvalidos({ alias: ['El alias es solo para cuentas de Argentina'] })
        if (!parcial && (!numero || numero.length < 3)) throw datosInvalidos({ numero: ['Indica el número de cuenta'] })
    }
}

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
    idFiscal(req, 'rut')
    res.status(201).json(await conEmpresa(req.contexto, async (db) => {
        const id = await proveedorRepositorio.crear(db, req.contexto.empresaId, req.body)
        return proveedorRepositorio.buscar(db, id)
    }))
})

router.patch('/:id', idValido, gestionar, validar(esquemaProveedor.partial()), async (req, res) => {
    idFiscal(req, 'rut')
    res.json(await conProveedor(req, (db) => proveedorRepositorio.actualizar(db, req.params.id, req.body)))
})

// Cuentas bancarias (cambios auditados: son datos para transferir dinero)
router.post('/:id/cuentas', idValido, gestionar, validar(esquemaCuenta), async (req, res) => {
    validarCuenta(req, false)
    res.status(201).json(await conProveedor(req, async (db) => {
        const cuentaId = await proveedorRepositorio.crearCuenta(db, req.contexto.empresaId, req.params.id, req.body)
        await auditar(db, req, { accion: 'proveedor.cuenta.crear', entidad: 'proveedor_cuenta', entidadId: cuentaId, datos: req.body })
    }))
})

router.patch('/:id/cuentas/:cuentaId', idValido, cuentaValida, gestionar, validar(esquemaCuenta.partial()), async (req, res) => {
    validarCuenta(req, true)
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
