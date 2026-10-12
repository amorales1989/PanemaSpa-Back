// Variables de entorno validadas al arrancar: si falta algo, la API no levanta.
import { z } from 'zod'

const esquema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    COOKIE_DOMAIN: z.string().optional().transform((v) => v || undefined),
    UPLOADS_DIR: z.string().default('./uploads'),
})

const resultado = esquema.safeParse(process.env)
if (!resultado.success) {
    console.error('Variables de entorno inválidas:', resultado.error.flatten().fieldErrors)
    process.exit(1)
}

export const env = {
    ...resultado.data,
    esProduccion: resultado.data.NODE_ENV === 'production',
    origenes: resultado.data.CORS_ORIGIN.split(',').map((o) => o.trim()),
}
