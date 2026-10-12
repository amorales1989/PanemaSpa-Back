// Deja constancia de acciones sensibles (anular, ajustar precios, eliminar...).
// Se llama con el `db` de la transacción, así queda o no junto con la acción.
export const auditar = (db, req, { accion, entidad, entidadId = null, datos = null }) =>
    db.query(
        `insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos, ip)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [req.contexto.empresaId, req.usuario.id, accion, entidad, entidadId, datos && JSON.stringify(datos), req.ip ?? null],
    )
