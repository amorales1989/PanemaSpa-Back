import * as equipoServicio from '../servicios/equipoServicio.js'

// Quién hace el cambio: superadmin desde /v1/admin, o miembro de la empresa desde /v1/equipo
const actorDe = (req, superadmin) => ({
    usuarioId: req.usuario.id,
    superadmin,
    esDueno: req.membresia?.rol === 'dueno',
    ip: req.ip,
})

function controlador({ superadmin }) {
    const empresaDe = (req) => (superadmin ? req.params.id : req.contexto.empresaId)
    return {
        listar: async (req, res) => res.json(await equipoServicio.listar(empresaDe(req))),
        agregar: async (req, res) => res.status(201).json(await equipoServicio.agregar(actorDe(req, superadmin), empresaDe(req), req.body)),
        actualizar: async (req, res) =>
            res.json(await equipoServicio.actualizar(actorDe(req, superadmin), empresaDe(req), req.params.membresiaId, req.body)),
        restablecerPassword: async (req, res) =>
            res.json(await equipoServicio.restablecerPassword(actorDe(req, superadmin), empresaDe(req), req.params.membresiaId)),
    }
}

export const desdeEmpresa = controlador({ superadmin: false })
export const desdeAdmin = controlador({ superadmin: true })
