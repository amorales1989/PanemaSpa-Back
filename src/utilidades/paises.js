// Países donde opera la app: lo que cambia de uno a otro (moneda, huso horario, identificación
// fiscal, cuentas bancarias). Para sumar un país: agregarlo acá, en la migración (check de
// empresas.pais) y en src/lib/paises.js del front.
import { normalizarRut } from './rut.js'

export const PAISES = {
    AR: { nombre: 'Argentina', moneda: 'ARS', zonaHoraria: 'America/Argentina/Buenos_Aires', idFiscal: 'CUIT', metodosExtra: ['Mercado Pago'] },
    CL: { nombre: 'Chile', moneda: 'CLP', zonaHoraria: 'America/Santiago', idFiscal: 'RUT', metodosExtra: [] },
}
export const CODIGOS_PAIS = Object.keys(PAISES)
export const PAIS_POR_DEFECTO = 'AR'

// CUIT/CUIL argentino: 11 dígitos con verificador → "20-12345678-6" (null si es inválido)
export function normalizarCuit(valor) {
    const d = String(valor ?? '').replace(/\D/g, '')
    if (d.length !== 11) return null
    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    const suma = pesos.reduce((t, p, i) => t + p * Number(d[i]), 0)
    const resto = 11 - (suma % 11)
    const verificador = resto === 11 ? 0 : resto === 10 ? 9 : resto
    if (verificador !== Number(d[10])) return null
    return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d[10]}`
}

// Identificación fiscal según el país: RUT (Chile) o CUIT (Argentina)
export const normalizarIdFiscal = (pais, valor) => (pais === 'CL' ? normalizarRut(valor) : normalizarCuit(valor))

// CBU / CVU argentino: 22 dígitos con dos verificadores (banco+sucursal y cuenta)
export function cbuValido(valor) {
    const d = String(valor ?? '').replace(/\D/g, '')
    if (d.length !== 22) return false
    const verificador = (digitos, pesos) => (10 - (digitos.split('').reduce((t, n, i) => t + Number(n) * pesos[i % pesos.length], 0) % 10)) % 10
    return verificador(d.slice(0, 7), [7, 1, 3, 9]) === Number(d[7]) && verificador(d.slice(8, 21), [3, 9, 7, 1]) === Number(d[21])
}
