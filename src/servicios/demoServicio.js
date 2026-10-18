// Empresas demo: para mostrarle la app a un posible cliente con su nombre, logo y catálogo.
//
// El superadmin crea la demo (queda como dueño), la personaliza desde la app misma
// (Configuración, Productos, importar planilla) y genera movimientos inventados a partir
// del catálogo y las listas que tenga en ese momento. Regenerar borra los movimientos
// anteriores y crea otros hasta hoy, así la demo siempre se ve "al día".
import { randomUUID } from 'node:crypto'
import * as demoRepositorio from '../repositorios/demoRepositorio.js'
import * as empresaRepositorio from '../repositorios/empresaRepositorio.js'
import { auditar } from '../repositorios/adminRepositorio.js'
import { invalidarEmpresa } from '../middlewares/empresa.js'
import { redondear } from '../utilidades/dinero.js'
import { conflicto, noEncontrado } from '../utilidades/errores.js'
import { logger } from '../utilidades/logger.js'
import { CATALOGO_DEMO } from './demoCatalogo.js'

// ---------- Azar ----------

const azar = (min, max) => min + Math.random() * (max - min)
const entero = (min, max) => Math.floor(azar(min, max + 1))
const probable = (p) => Math.random() < p

// Elige un elemento según pesos relativos
function elegir(lista, pesos) {
    let r = Math.random() * pesos.reduce((t, p) => t + p, 0)
    for (let i = 0; i < lista.length; i++) {
        r -= pesos[i]
        if (r <= 0) return lista[i]
    }
    return lista.at(-1)
}

// Varios elementos distintos según pesos
function elegirVarios(lista, pesos, n) {
    const restantes = lista.map((x, i) => [x, pesos[i]])
    const elegidos = []
    while (elegidos.length < n && restantes.length) {
        const [x] = elegir(restantes, restantes.map(([, p]) => p))
        elegidos.push(x)
        restantes.splice(restantes.findIndex(([y]) => y === x), 1)
    }
    return elegidos
}

// Normal con media y desvío (Box-Muller)
const normal = (media, desvio) => media + desvio * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())

const mezclar = (lista) => lista.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x)

// Pesos que decaen por orden: el primero de la lista es el más usado (Mostrador, Efectivo...)
const pesosPorOrden = (n, decaimiento = 0.45) => Array.from({ length: n }, (_, i) => decaimiento ** i)

// ---------- Calendario ----------

const DIA_MS = 86_400_000
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10)
const diaSemana = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = domingo
const diaDelMes = (iso) => Number(iso.slice(8, 10))
const ultimoDelMes = (iso) => sumarDias(`${sumarDias(`${iso.slice(0, 8)}01`, 32).slice(0, 8)}01`, -1)
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Más venta el fin de semana, menos el lunes
const FACTOR_DIA = [1.25, 0.82, 0.9, 0.95, 1.0, 1.15, 1.35]

// Hora de la venta: peak de desayuno, peak de once y algo entre medio (minutos del día)
function minutoDeVenta() {
    const m = elegir([() => normal(8.75 * 60, 60), () => normal(18 * 60, 75), () => azar(10 * 60, 17 * 60)], [0.42, 0.4, 0.18])()
    return Math.round(Math.min(Math.max(m, 7.5 * 60), 21 * 60 - 1))
}

// ---------- Montos ----------

// Montos "redondos" como los de una boleta de gasto real
const montoRedondo = (n, dec) => (dec > 0 ? redondear(n, dec) : n >= 10_000 ? Math.round(n / 1000) * 1000 : Math.round(n / 10) * 10)
const redondearA = (n, paso) => Math.max(paso, Math.round(n / paso) * paso)

// Cantidad vendida en una línea según unidad y precio
function cantidadVendida(producto) {
    if (producto.unidad === 'kg') return redondearA(azar(0.25, 1.5), 0.05)
    if (producto.unidad === 'lt') return entero(1, 2)
    if (producto.precio_venta < 1000) return entero(2, 6)
    if (producto.precio_venta < 3500) return elegir([1, 2, 3], [0.7, 0.24, 0.06])
    return 1
}

// ---------- Generador ----------

function generarVentas({ productos, promos, canales, metodos }, dias, hoy, minutoActual, ventasDia, dec) {
    // Popularidad: orden al azar, decae suave; lo caro (tortas) se vende menos
    const precios = productos.map((p) => p.precio_venta).sort((a, b) => a - b)
    const mediana = precios[Math.floor(precios.length / 2)]
    const orden = mezclar(productos.map((_, i) => i))
    const popularidad = productos.map((p, i) => (1 / (orden.indexOf(i) + 1) ** 0.6) * Math.min(1.5, Math.sqrt(mediana / p.precio_venta)))
    const pesosCanal = pesosPorOrden(canales.length, 0.25)
    const pesosMetodo = metodos.map((m, i) => (/d[eé]bito/i.test(m.nombre) ? 1.4 : /efectivo/i.test(m.nombre) ? 1 : 0.5 ** i))

    const ventas = []
    const items = []
    const componentes = []

    for (let k = 0; k < dias; k++) {
        const fecha = sumarDias(hoy, k - dias + 1)
        const tendencia = 0.82 + 0.23 * (dias > 1 ? k / (dias - 1) : 1) // el negocio va creciendo
        const n = Math.round(ventasDia * FACTOR_DIA[diaSemana(fecha)] * tendencia * azar(0.85, 1.15))
        for (let v = 0; v < n; v++) {
            const minutos = minutoDeVenta()
            if (fecha === hoy && minutos > minutoActual) continue
            const ventaId = randomUUID()
            const lineas = []
            const cuantos = elegir([1, 2, 3, 4], [0.45, 0.32, 0.16, 0.07])
            for (const p of elegirVarios(productos, popularidad, cuantos)) {
                const cantidad = cantidadVendida(p)
                lineas.push({
                    id: randomUUID(), venta_id: ventaId, producto_id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad,
                    cantidad, precio_unitario: p.precio_venta, costo_unitario: p.costo, subtotal: redondear(cantidad * p.precio_venta, dec),
                })
            }
            if (promos.length && probable(0.12)) {
                const promo = promos[entero(0, promos.length - 1)]
                const cantidad = elegir([1, 2], [0.85, 0.15])
                const lineaId = randomUUID()
                // Mismo prorrateo que una venta real: el precio promo se reparte según el precio normal
                const normalPromo = promo.componentes.reduce((t, c) => t + c.precio * c.cantidad, 0)
                const factor = normalPromo ? promo.precio / normalPromo : 0
                lineas.push({
                    id: lineaId, venta_id: ventaId, promo_id: promo.id, codigo: promo.codigo, nombre: promo.nombre, unidad: 'un',
                    cantidad, precio_unitario: promo.precio,
                    costo_unitario: redondear(promo.componentes.reduce((t, c) => t + c.costo * c.cantidad, 0), 2),
                    subtotal: redondear(cantidad * promo.precio, dec),
                })
                for (const c of promo.componentes) {
                    componentes.push({
                        venta_item_id: lineaId, producto_id: c.id, nombre: c.nombre, unidad: c.unidad,
                        cantidad: Math.round(c.cantidad * cantidad * 1000) / 1000,
                        precio_prorrateado: redondear(c.precio * factor, dec), costo_unitario: c.costo,
                    })
                }
            }
            lineas.forEach((l, posicion) => items.push({ ...l, posicion }))
            // Igual que una venta real: descuento del medio de pago sobre toda la venta
            const metodo = elegir(metodos, pesosMetodo)
            const subtotal = redondear(lineas.reduce((t, l) => t + l.subtotal, 0), dec)
            const descuento = redondear((subtotal * metodo.descuento_pct) / 100, dec)
            ventas.push({
                id: ventaId, fecha, minutos,
                canal_id: elegir(canales, pesosCanal).id,
                metodo_pago_id: metodo.id,
                total: redondear(subtotal - descuento, dec),
                descuento_pct: metodo.descuento_pct,
                descuento,
            })
        }
    }
    return { ventas, items, componentes }
}

// Gastos fijos que se reconocen por el nombre de la categoría de egreso
const GASTOS_FIJOS = [
    { patron: /sueldo|remunera|personal/i, parte: 0.22, dia: 'fin', texto: (mes) => `Sueldos ${mes}` },
    { patron: /arriendo|alquiler/i, parte: 0.1, dia: 5, texto: (mes) => `Arriendo local ${mes}` },
    { patron: /servicio|luz|agua|gas/i, parte: 0.05, dia: 12, texto: () => 'Luz, agua y gas' },
]

function generarEgresos({ categorias, insumos, proveedores, metodos }, dias, hoy, ventasPorDia, dec) {
    const egresos = []
    const items = []
    const transferencia = metodos.find((m) => /transfer/i.test(m.nombre)) ?? metodos[0]
    const otroMetodo = () => (probable(0.6) ? transferencia : metodos[entero(0, metodos.length - 1)])
    const agregar = (fecha, categoria, total, descripcion, extra = {}) => {
        const e = { id: randomUUID(), fecha, minutos: entero(9 * 60, 17 * 60), categoria_id: categoria.id, descripcion, total, ...extra }
        egresos.push(e)
        return e
    }

    // Compras de insumos dos veces por semana: ~30% de lo vendido desde la compra anterior
    const compras = categorias.find((c) => c.con_items)
    if (compras && insumos.length) {
        let acumulado = 0
        for (let k = 0; k < dias; k++) {
            const fecha = sumarDias(hoy, k - dias + 1)
            acumulado += ventasPorDia.get(fecha) ?? 0
            if (![1, 4].includes(diaSemana(fecha)) || acumulado === 0) continue
            const objetivo = acumulado * 0.3
            acumulado = 0
            // Los precios suben de a poco: la última compra queda cerca del precio actual del insumo
            const inflacion = 0.94 + 0.06 * (dias > 1 ? k / (dias - 1) : 1)
            const elegidos = elegirVarios(insumos, insumos.map(() => 1), Math.min(insumos.length, entero(3, 6)))
            const lineas = elegidos.map((ins, posicion) => {
                const precio = redondear(ins.precio_ultimo * inflacion * azar(0.98, 1.02), dec)
                const bruta = (objetivo / elegidos.length) * azar(0.6, 1.4) / precio
                const cantidad = ins.unidad === 'un' ? Math.max(1, Math.round(bruta)) : redondearA(bruta, 0.5)
                return { insumo_id: ins.id, codigo: ins.codigo, nombre: ins.nombre, unidad: ins.unidad, cantidad, precio_unitario: precio, subtotal: redondear(cantidad * precio, dec), posicion }
            })
            const e = agregar(fecha, compras, redondear(lineas.reduce((t, l) => t + l.subtotal, 0), dec), 'Compra de insumos', {
                proveedor_id: proveedores.length ? proveedores[entero(0, proveedores.length - 1)].id : null,
                metodo_pago_id: otroMetodo().id,
            })
            for (const l of lineas) items.push({ ...l, egreso_id: e.id })
        }
    }

    // Negocio de reventa (sin insumos): compras de mercadería sin detalle, ~45% de lo vendido
    const mercaderia = categorias.find((c) => !c.con_items && /mercader|reposici/i.test(c.nombre))
    if (mercaderia && !(compras && insumos.length)) {
        let acumulado = 0
        for (let k = 0; k < dias; k++) {
            const fecha = sumarDias(hoy, k - dias + 1)
            acumulado += ventasPorDia.get(fecha) ?? 0
            if (diaSemana(fecha) !== 2 || acumulado === 0) continue
            agregar(fecha, mercaderia, montoRedondo(acumulado * azar(0.4, 0.5), dec), 'Reposición de mercadería', {
                proveedor_id: proveedores.length ? proveedores[entero(0, proveedores.length - 1)].id : null,
                metodo_pago_id: otroMetodo().id,
            })
            acumulado = 0
        }
    }

    // Fijos mensuales y algunos gastos variables
    const promedioMensual = ([...ventasPorDia.values()].reduce((t, x) => t + x, 0) / Math.max(1, ventasPorDia.size)) * 30
    const fijos = GASTOS_FIJOS.map((g) => ({ ...g, categoria: categorias.find((c) => !c.con_items && g.patron.test(c.nombre)) })).filter((g) => g.categoria)
    const mantencion = categorias.find((c) => !c.con_items && /manten/i.test(c.nombre))
    const otros = categorias.find((c) => !c.con_items && /otro/i.test(c.nombre))
    for (let k = 0; k < dias; k++) {
        const fecha = sumarDias(hoy, k - dias + 1)
        const mes = MESES[Number(fecha.slice(5, 7)) - 1]
        for (const g of fijos) {
            const toca = g.dia === 'fin' ? fecha === ultimoDelMes(fecha) : diaDelMes(fecha) === g.dia
            if (toca) agregar(fecha, g.categoria, montoRedondo(promedioMensual * g.parte * azar(0.95, 1.05), dec), g.texto(mes), { metodo_pago_id: transferencia.id })
        }
        if (mantencion && probable(1 / 40)) {
            agregar(fecha, mantencion, montoRedondo(promedioMensual * azar(0.01, 0.03), dec), 'Mantención de equipos', { metodo_pago_id: otroMetodo().id })
        }
        if (otros && probable(0.1)) {
            agregar(fecha, otros, montoRedondo(promedioMensual * azar(0.003, 0.01), dec), 'Gastos varios', { metodo_pago_id: otroMetodo().id })
        }
    }
    return { egresos, items }
}

// Merma de casi todos los días, registrada al cierre: ~1,5% de lo vendido ese día (valorizada a costo)
function generarMermas({ motivos, productos, insumos }, dias, hoy, minutoActual, ventasPorDia, dec) {
    const mermas = []
    const items = []
    if (!motivos.length) return { mermas, items }
    const pesosMotivo = motivos.map((m) => (/sobreprod/i.test(m.nombre) ? 2 : /venc/i.test(m.nombre) ? 1.5 : 1))
    const costoDe = (p) => (p.costo > 0 ? p.costo : redondear(p.precio_venta * 0.35, dec))
    for (let k = 0; k < dias; k++) {
        const fecha = sumarDias(hoy, k - dias + 1)
        const minutos = entero(19 * 60, 21 * 60 - 1)
        const objetivo = (ventasPorDia.get(fecha) ?? 0) * azar(0.005, 0.03)
        if (!objetivo || !probable(0.8) || (fecha === hoy && minutos > minutoActual)) continue
        const mermaId = randomUUID()
        const lineas = []
        if (insumos.length && probable(0.12)) {
            const ins = insumos[entero(0, insumos.length - 1)]
            const bruta = objetivo / ins.precio_ultimo
            const cantidad = ins.unidad === 'un' ? Math.max(1, Math.round(bruta)) : redondearA(bruta, 0.5)
            lineas.push({ insumo_id: ins.id, codigo: ins.codigo, nombre: ins.nombre, unidad: ins.unidad, cantidad, costo_unitario: ins.precio_ultimo })
        } else {
            // Se pierde lo de alta rotación, no una torta entera (salvo que alcance el objetivo del día)
            const candidatos = productos.filter((p) => costoDe(p) <= objetivo)
            const lista = candidatos.length ? candidatos : productos
            const elegidos = elegirVarios(lista, lista.map((p) => 1 / Math.sqrt(p.precio_venta)), entero(1, 3))
            for (const p of elegidos) {
                const bruta = objetivo / elegidos.length / costoDe(p)
                const cantidad = p.unidad === 'un' ? Math.max(1, Math.round(bruta)) : redondearA(bruta, 0.05)
                lineas.push({ producto_id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad, costo_unitario: costoDe(p) })
            }
        }
        const conSubtotal = lineas.map((l, posicion) => ({ ...l, merma_id: mermaId, posicion, subtotal: redondear(l.cantidad * l.costo_unitario, dec) }))
        items.push(...conSubtotal)
        mermas.push({
            id: mermaId, fecha, minutos, motivo_id: elegir(motivos, pesosMotivo).id,
            total: redondear(conSubtotal.reduce((t, l) => t + l.subtotal, 0), dec),
        })
    }
    return { mermas, items }
}

// Número correlativo en orden cronológico, como si se hubieran registrado uno a uno
const numerar = (lista) =>
    lista.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.minutos - b.minutos).map((x, i) => ({ ...x, numero: i + 1 }))

// Borra los movimientos de la demo y genera otros hasta hoy. Corre dentro de la transacción `db`.
async function generar(db, empresa, usuarioId, { dias, ventasDia }) {
    await demoRepositorio.fijarEmpresa(db, empresa.id, usuarioId)
    const ctx = await demoRepositorio.contexto(db, empresa.id)
    const falta = !ctx.productos.length ? 'productos activos con precio'
        : !ctx.canales.length ? 'canales de venta' : !ctx.metodos.length ? 'métodos de pago' : !ctx.sucursales.length ? 'sucursales' : null
    if (falta) throw conflicto('DEMO_INCOMPLETA', `La demo no tiene ${falta}: agrégalos antes de generar movimientos`)

    const dec = empresa.decimales
    const hoy = empresa.hoy
    const minutoActual = Number(empresa.minuto_actual)
    const v = generarVentas(ctx, dias, hoy, minutoActual, ventasDia, dec)
    const ventasPorDia = new Map()
    for (const x of v.ventas) ventasPorDia.set(x.fecha, (ventasPorDia.get(x.fecha) ?? 0) + x.total)
    const e = generarEgresos(ctx, dias, hoy, ventasPorDia, dec)
    const m = generarMermas(ctx, dias, hoy, minutoActual, ventasPorDia, dec)

    const ventas = numerar(v.ventas)
    const egresos = numerar(e.egresos)
    const mermas = numerar(m.mermas)
    // Las líneas de compra en orden de fecha: el trigger deja el precio de la última compra en cada insumo
    const fechaEgreso = new Map(egresos.map((x) => [x.id, x.fecha]))
    e.items.sort((a, b) => fechaEgreso.get(a.egreso_id).localeCompare(fechaEgreso.get(b.egreso_id)))

    const base = { empresaId: empresa.id, sucursalId: ctx.sucursales[0].id, usuarioId, zona: empresa.zona_horaria }
    await demoRepositorio.borrarMovimientos(db, empresa.id)
    await demoRepositorio.insertarVentas(db, base, ventas, v.items, v.componentes)
    await demoRepositorio.insertarEgresos(db, base, egresos, e.items)
    await demoRepositorio.insertarMermas(db, base, mermas, m.items)
    await demoRepositorio.fijarContador(db, empresa.id, 'venta', ventas.length)
    await demoRepositorio.fijarContador(db, empresa.id, 'egreso', egresos.length)
    await demoRepositorio.fijarContador(db, empresa.id, 'merma', mermas.length)

    return {
        ventas: ventas.length,
        montoVentas: redondear(ventas.reduce((t, x) => t + x.total, 0), dec),
        egresos: egresos.length,
        mermas: mermas.length,
    }
}

// ---------- Casos de uso ----------

export async function crear(req, { nombre, pais, catalogo, dias, ventasDia }) {
    const usuarioId = req.usuario.id
    const r = await demoRepositorio.transaccion(async (db) => {
        const empresa = await empresaRepositorio.crear(db, { nombre, slug: await empresaRepositorio.slugLibre(db, `demo ${nombre}`), esDemo: true, pais })
        // Quien la crea queda como dueño: la ve en el selector de empresas de la app
        await empresaRepositorio.agregarMiembro(db, { empresaId: empresa.id, usuarioId, rolCodigo: 'dueno' })
        await empresaRepositorio.inicializar(db, empresa.id, pais)
        if (catalogo) await demoRepositorio.sembrarCatalogo(db, empresa.id, usuarioId, CATALOGO_DEMO)
        const demo = await demoRepositorio.buscarDemo(db, empresa.id)
        const resumen = catalogo ? await generar(db, demo, usuarioId, { dias, ventasDia }) : null
        return { id: empresa.id, resumen }
    })
    await auditar(usuarioId, r.id, 'admin.demo.crear', { nombre, pais, catalogo, dias, ventasDia }, req.ip)
    logger.info({ empresaId: r.id, por: usuarioId }, 'demo creada')
    return r
}

export async function regenerar(req, id, opciones) {
    const resumen = await demoRepositorio.transaccion(async (db) => {
        const demo = await demoRepositorio.buscarDemo(db, id)
        if (!demo) throw noEncontrado('Demo no encontrada')
        return generar(db, demo, req.usuario.id, opciones)
    })
    await auditar(req.usuario.id, id, 'admin.demo.regenerar', opciones, req.ip)
    return resumen
}

export async function eliminar(req, id) {
    await demoRepositorio.transaccion(async (db) => {
        if (!(await demoRepositorio.buscarDemo(db, id))) throw noEncontrado('Demo no encontrada')
        await demoRepositorio.eliminar(db, id)
    })
    invalidarEmpresa(id)
    logger.info({ empresaId: id, por: req.usuario.id }, 'demo eliminada')
}
