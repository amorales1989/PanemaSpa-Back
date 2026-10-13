import { conEmpresa } from '../db/contexto.js'
import * as configuracionRepositorio from '../repositorios/configuracionRepositorio.js'
import { conflicto, noEncontrado } from '../utilidades/errores.js'

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

// Renombrar o activar/desactivar (desactivar = deja de ofrecerse, los registros viejos la conservan)
export const actualizar = (contexto, lista, id, cambios) =>
    conEmpresa(contexto, async (db) => {
        const fila = await configuracionRepositorio.actualizar(db, lista, id, cambios)
        if (!fila) throw noEncontrado()
        return fila
    })

// Listas que no pueden quedar sin ninguna opción activa (sin ellas no se puede registrar)
const IMPRESCINDIBLES = new Set(['canales', 'metodos-pago', 'motivos-merma', 'sucursales'])

// Eliminar: si nunca se usó se borra; si ya tiene ventas, productos, compras… se archiva
// (deleted_at): desaparece de la configuración y los registros viejos la conservan.
export const eliminar = (contexto, lista, id) =>
    conEmpresa(contexto, async (db) => {
        const fila = await configuracionRepositorio.buscar(db, lista, id)
        if (!fila) throw noEncontrado()
        if (lista === 'categorias' && fila.con_items) {
            throw conflicto('CATEGORIA_INSUMOS', 'Es la categoría que se usa para las compras de insumos: no se puede eliminar')
        }
        if (IMPRESCINDIBLES.has(lista) && (await configuracionRepositorio.otrasActivas(db, lista, id)) === 0) {
            throw conflicto('ULTIMA_OPCION', 'Es la única opción activa de la lista: agrega otra antes de eliminarla')
        }
        try {
            await db.query('savepoint eliminar_opcion')
            await configuracionRepositorio.eliminar(db, lista, id)
            return { archivada: false }
        } catch (error) {
            // 23503: la usan ventas, egresos, mermas o productos → borrado lógico
            if (error.code !== '23503') throw error
            await db.query('rollback to savepoint eliminar_opcion')
            await configuracionRepositorio.archivar(db, lista, id)
            return { archivada: true }
        }
    })
