import express from 'express'
import { z } from 'zod'
import { desdeAdmin, desdeEmpresa } from '../controladores/equipoControlador.js'
import { permiso } from '../middlewares/permiso.js'
import { noEncontrado } from '../utilidades/errores.js'
import { validar } from '../middlewares/validar.js'
import { texto, uuid } from '../utilidades/esquemas.js'

export const esquemaAgregar = z.object({
    nombre: texto(100),
    email: z.string().trim().toLowerCase().email('Email inválido').max(200),
    rolId: uuid,
})
export const esquemaActualizar = z.object({
    rolId: uuid.optional(),
    estado: z.enum(['activo', 'suspendido']).optional(),
}).refine((d) => d.rolId || d.estado, 'No hay cambios')

const esquemaMembresia = z.object({ membresiaId: z.string().uuid() })
export const membresiaValida = (req, res, next) => {
    if (!esquemaMembresia.safeParse({ membresiaId: req.params.membresiaId }).success) throw noEncontrado()
    next()
}

// Montaje genérico: se usa en /v1/equipo (empresa activa) y en /v1/admin/empresas/:id/usuarios
export function montar(router, ctrl, guardia = (req, res, next) => next()) {
    router.get('/', guardia, ctrl.listar)
    router.post('/', guardia, validar(esquemaAgregar), ctrl.agregar)
    router.patch('/:membresiaId', membresiaValida, guardia, validar(esquemaActualizar), ctrl.actualizar)
    router.post('/:membresiaId/restablecer-password', membresiaValida, guardia, ctrl.restablecerPassword)
    return router
}

// /v1/equipo: el equipo de la empresa activa (dueño y administrador)
export const equipoRutas = montar(express.Router(), desdeEmpresa, permiso('usuarios.gestionar'))

// /v1/admin/empresas/:id/usuarios (mergeParams para leer :id)
export const adminUsuariosRutas = montar(express.Router({ mergeParams: true }), desdeAdmin)
