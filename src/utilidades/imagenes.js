// Imágenes subidas por la app (fotos de productos, logo de la empresa).
// El front ya las entrega reducidas como data URL; acá se validan y se guardan en UPLOADS_DIR.
import { randomBytes } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '../config/env.js'
import { ErrorApi, datosInvalidos } from './errores.js'

const FORMATOS = {
    'image/jpeg': { ext: 'jpg', firma: [0xff, 0xd8, 0xff] },
    'image/png': { ext: 'png', firma: [0x89, 0x50, 0x4e, 0x47] },
    'image/webp': { ext: 'webp', firma: [0x52, 0x49, 0x46, 0x46] },
}
const MAX_BYTES = 1_500_000

export function decodificarImagen(dataUrl, formatos = Object.keys(FORMATOS)) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!m || !formatos.includes(m[1])) {
        throw datosInvalidos({ imagen: [`Debe ser una imagen ${formatos.map((f) => f.split('/')[1].toUpperCase()).join(', ')} en base64`] })
    }
    const formato = FORMATOS[m[1]]
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length > MAX_BYTES) throw new ErrorApi(413, 'IMAGEN_GRANDE', 'La imagen supera 1,5 MB')
    // Que el contenido sea de verdad del tipo declarado
    if (!formato.firma.every((b, i) => bytes[i] === b)) throw datosInvalidos({ imagen: ['El archivo no es una imagen válida'] })
    return { bytes, ext: formato.ext }
}

const rutaArchivo = (url) => join(env.UPLOADS_DIR, url.replace(/^\/uploads\//, ''))

// Nombre nuevo en cada cambio: evita que el navegador muestre la imagen vieja en caché
export async function guardarArchivo(empresaId, prefijo, { bytes, ext }) {
    const url = `/uploads/${empresaId}/${prefijo}-${randomBytes(4).toString('hex')}.${ext}`
    await mkdir(join(env.UPLOADS_DIR, empresaId), { recursive: true })
    await writeFile(rutaArchivo(url), bytes)
    return url
}

export async function borrarArchivo(url) {
    if (!url?.startsWith('/uploads/')) return
    await unlink(rutaArchivo(url)).catch(() => {})
}
