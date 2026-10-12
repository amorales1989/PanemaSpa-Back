import { conEmpresa } from '../db/contexto.js'
import * as configuracionRepositorio from '../repositorios/configuracionRepositorio.js'

// Todo lo que los formularios necesitan en una sola llamada (reemplaza las constantes de mock.js)
export const obtener = (contexto) =>
    conEmpresa(contexto, async (db) => {
        const categorias = await configuracionRepositorio.categorias(db)
        const porAmbito = (ambito) => categorias.filter((c) => c.ambito === ambito)
        return {
            canales: await configuracionRepositorio.canales(db),
            metodosPago: await configuracionRepositorio.metodosPago(db),
            motivosMerma: await configuracionRepositorio.motivosMerma(db),
            categorias: {
                producto: porAmbito('producto'),
                insumo: porAmbito('insumo'),
                egreso: porAmbito('egreso'),
            },
            sucursales: await configuracionRepositorio.sucursales(db),
            proveedores: await configuracionRepositorio.proveedores(db),
        }
    })
