import { conEmpresa } from '../db/contexto.js'
import * as configuracionRepositorio from '../repositorios/configuracionRepositorio.js'
import { noEncontrado } from '../utilidades/errores.js'

// Todo lo que los formularios necesitan en una sola llamada (reemplaza las constantes de mock.js)
export const obtener = (contexto) =>
    conEmpresa(contexto, async (db) => {
        const listar = (lista) => configuracionRepositorio.listar(db, lista)
        const categorias = await listar('categorias')
        const porAmbito = (ambito) => categorias.filter((c) => c.ambito === ambito)
        return {
            canales: await listar('canales'),
            metodosPago: await listar('metodos-pago'),
            motivosMerma: await listar('motivos-merma'),
            categorias: {
                producto: porAmbito('producto'),
                insumo: porAmbito('insumo'),
                egreso: porAmbito('egreso'),
            },
            sucursales: await listar('sucursales'),
            proveedores: await listar('proveedores'),
        }
    })

export const crear = (contexto, lista, datos) =>
    conEmpresa(contexto, (db) => configuracionRepositorio.crear(db, lista, contexto.empresaId, datos))

// No hay borrado: se desactiva (activo = false) para no romper los movimientos que ya la usan
export const actualizar = (contexto, lista, id, cambios) =>
    conEmpresa(contexto, async (db) => {
        const fila = await configuracionRepositorio.actualizar(db, lista, id, cambios)
        if (!fila) throw noEncontrado()
        return fila
    })
