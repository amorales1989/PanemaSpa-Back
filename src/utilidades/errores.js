// Error controlado: el middleware de errores responde con este status y código.
// Cualquier otro error se responde como 500 sin exponer detalles.
export class ErrorApi extends Error {
    constructor(status, codigo, mensaje, detalles) {
        super(mensaje)
        this.status = status
        this.codigo = codigo
        this.detalles = detalles
    }
}

export const noAutenticado = (mensaje = 'Debes iniciar sesión') => new ErrorApi(401, 'NO_AUTENTICADO', mensaje)
export const sinPermiso = (mensaje = 'No tienes permiso para esta acción') => new ErrorApi(403, 'SIN_PERMISO', mensaje)
export const noEncontrado = (mensaje = 'No encontrado') => new ErrorApi(404, 'NO_ENCONTRADO', mensaje)
export const conflicto = (codigo, mensaje) => new ErrorApi(409, codigo, mensaje)
export const datosInvalidos = (detalles) => new ErrorApi(400, 'DATOS_INVALIDOS', 'Revisa los datos enviados', detalles)
