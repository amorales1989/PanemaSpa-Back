import { datosInvalidos } from '../utilidades/errores.js'

// router.post('/', validar(esquemaZod), controlador) → req.body queda parseado y limpio
export const validar = (esquema, origen = 'body') => (req, res, next) => {
    const resultado = esquema.safeParse(req[origen])
    if (!resultado.success) throw datosInvalidos(resultado.error.flatten().fieldErrors)
    if (origen === 'query') req.consulta = resultado.data
    else req[origen] = resultado.data
    next()
}
