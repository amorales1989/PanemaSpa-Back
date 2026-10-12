// La BD usa snake_case y la API responde en camelCase: precio_venta → precioVenta.
const aCamel = (clave) => clave.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())

export function camelizar(valor) {
    if (Array.isArray(valor)) return valor.map(camelizar)
    if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
        return Object.fromEntries(Object.entries(valor).map(([k, v]) => [aCamel(k), camelizar(v)]))
    }
    return valor
}
