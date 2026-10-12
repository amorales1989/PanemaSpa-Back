// Consultas compartidas por productos, insumos y promos

const TABLAS_CODIGO = { productos: 101, insumos: 501, promos: 901 }

// Próximo código libre: el mayor + 1 (o el inicial de cada tipo: 101, 501, 901)
export async function siguienteCodigo(db, tabla) {
    const base = TABLAS_CODIGO[tabla]
    const { rows } = await db.query(
        `select greatest(coalesce(max(codigo), 0) + 1, $1::int) as codigo from ${tabla} where deleted_at is null`,
        [base],
    )
    return rows[0].codigo
}

// La categoría existe en esta empresa (RLS) y es del ámbito correcto
export async function categoriaDeAmbito(db, id, ambito) {
    const { rowCount } = await db.query('select 1 from categorias where id = $1 and ambito = $2', [id, ambito])
    return rowCount > 0
}
