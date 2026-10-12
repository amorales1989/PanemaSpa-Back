import { z } from 'zod'
import { datosInvalidos, noEncontrado } from '../utilidades/errores.js'

// router.post('/', validar(esquemaZod), controlador) → req.body queda parseado y limpio.
// Para la query string el resultado queda en req.consulta (req.query es de solo lectura en Express 5).
export const validar = (esquema, origen = 'body') => (req, res, next) => {
    const resultado = esquema.safeParse(req[origen] ?? {})
    if (!resultado.success) throw datosInvalidos(resultado.error.flatten().fieldErrors)
    if (origen === 'query') req.consulta = resultado.data
    else req[origen] = resultado.data
    next()
}

// /:id con formato uuid; si no lo es, 404 (como si no existiera)
const esquemaId = z.object({ id: z.string().uuid() })
export const idValido = (req, res, next) => {
    if (!esquemaId.safeParse(req.params).success) throw noEncontrado()
    next()
}
