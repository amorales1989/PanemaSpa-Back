// Variables de entorno validadas al arrancar: si falta algo, la API no levanta.
import { z } from 'zod'

const esquema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    // Panel de plataforma (superadmin): conexión que ve todas las empresas (dueño de las tablas, sin RLS).
    // Si no se define se usa DATABASE_URL_MIGRACIONES; sin ninguna, /v1/admin responde 503.
    DATABASE_URL_ADMIN: z.string().url().optional(),
    DATABASE_URL_MIGRACIONES: z.string().url().optional(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    COOKIE_DOMAIN: z.string().optional().transform((v) => v || undefined),
    // Ruta de la cookie del refresh token tal como la ve el navegador.
    // Con el front en Vercel haciendo proxy de /api → API: '/api/v1/auth'
    COOKIE_PATH: z.string().default('/v1/auth'),
    // Cantidad de proxies delante de la API: 1 = solo Coolify, 2 = Vercel + Coolify
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
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
