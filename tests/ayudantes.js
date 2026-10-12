// Utilidades para los tests de punta a punta
import { app } from '../src/app.js'
import { pool, poolAdmin } from '../src/config/db.js'

export { pool }

let base
let servidor

export function iniciar() {
    servidor = app.listen(0)
    base = `http://localhost:${servidor.address().port}`
}

export async function terminar() {
    servidor.close()
    await pool.end()
    await poolAdmin?.end()
}

export async function pedir(ruta, { metodo = 'GET', token, empresa, body, cookie, headers = {} } = {}) {
    const res = await fetch(base + ruta, {
        method: metodo,
        headers: {
            ...(body && { 'Content-Type': 'application/json' }),
            ...(token && { Authorization: `Bearer ${token}` }),
            ...(empresa && { 'X-Empresa-Id': empresa }),
            ...(cookie && { Cookie: cookie }),
            ...headers,
        },
        body: body && JSON.stringify(body),
    })
    const texto = await res.text()
    let datos = null
    try {
        datos = texto ? JSON.parse(texto) : null
    } catch {
        datos = texto
    }
    return { status: res.status, datos, cookie: res.headers.get('set-cookie') }
}

const sufijo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// Crea un dueño con su empresa y devuelve un "cliente" que ya manda token y empresa
export async function nuevaEmpresa(quien) {
    const r = await pedir('/v1/auth/registro', {
        metodo: 'POST',
        body: { nombre: `Dueño ${quien}`, email: `${quien}-${sufijo}@test.cl`, password: 'clave-segura-123', nombreEmpresa: `Panadería ${quien}` },
    })
    if (r.status !== 201) throw new Error(`registro ${quien}: ${r.status} ${JSON.stringify(r.datos)}`)
    return clienteDe(r.datos.accessToken, r.datos.empresa.id, r.datos.usuario.id)
}

export function clienteDe(token, empresa, usuarioId) {
    const llamar = (metodo) => (ruta, body, extra) => pedir(`/v1${ruta}`, { metodo, token, empresa, body, ...extra })
    return { token, empresa, usuarioId, get: llamar('GET'), post: llamar('POST'), patch: llamar('PATCH'), put: llamar('PUT'), del: llamar('DELETE') }
}

// Suma un usuario nuevo a una empresa existente con un rol de sistema (mientras no haya invitaciones)
export async function miembro(empresa, rolCodigo, quien) {
    const otro = await nuevaEmpresa(quien)
    await pool.query(
        `insert into empresa_usuarios (empresa_id, usuario_id, rol_id)
         select $1, $2, id from roles where empresa_id is null and codigo = $3`,
        [empresa.empresa, otro.usuarioId, rolCodigo],
    )
    return clienteDe(otro.token, empresa.empresa, otro.usuarioId)
}
