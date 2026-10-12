// Piezas de validación (zod) que se repiten en todos los módulos
import { z } from 'zod'

export const uuid = z.string().uuid('Id inválido')
export const texto = (max = 100) => z.string().trim().min(1, 'Requerido').max(max)
// Opcional: '' o ausente → null (para poder borrar el valor en un PATCH)
export const textoOpcional = (max = 300) =>
    z.string().trim().max(max).nullish().transform((v) => v || null)

export const dinero = z.coerce.number().min(0, 'No puede ser negativo').max(100_000_000_000)
// Hasta 3 decimales (kilos con gramos)
export const cantidad = z.coerce.number().max(1_000_000)
    .transform((v) => Math.round(v * 1000) / 1000)
    .refine((v) => v > 0, 'Debe ser mayor a 0')
export const unidad = z.enum(['un', 'kg', 'lt'])
export const codigo = z.coerce.number().int().min(1).max(999_999)
export const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD')
export const orden = z.coerce.number().int().min(0).max(32_000)

export const filtroLista = z.object({
    incluirInactivos: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
})

export const filtroMovimientos = z.object({
    desde: fecha.optional(),
    hasta: fecha.optional(),
    estado: z.enum(['confirmada', 'confirmado', 'anulada', 'anulado', 'todos']).optional(),
    cursor: z.string().max(100).optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
})

export const anulacion = z.object({ motivo: texto(300) })
