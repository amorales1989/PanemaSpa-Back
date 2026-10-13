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

// Categoría por nombre (sin distinguir mayúsculas); si no existe se crea.
// El formulario del catálogo permite escribir una categoría nueva al crear el producto.
export async function categoriaPorNombre(db, empresaId, ambito, nombre) {
    const { rows } = await db.query(
        `with existente as (select id from categorias where ambito = $2 and lower(nombre) = lower($3) and deleted_at is null limit 1),
              nueva as (
                insert into categorias (empresa_id, ambito, nombre, orden)
                select $1, $2, $3, coalesce((select max(orden) + 1 from categorias where ambito = $2), 0)
                where not exists (select 1 from existente)
                on conflict (empresa_id, ambito, (lower(nombre))) where deleted_at is null do update set nombre = categorias.nombre
                returning id)
         select id from existente union all select id from nueva`,
        [empresaId, ambito, nombre],
    )
    return rows[0].id
}

// La categoría existe en esta empresa (RLS) y es del ámbito correcto
export async function categoriaDeAmbito(db, id, ambito) {
    const { rowCount } = await db.query('select 1 from categorias where id = $1 and ambito = $2', [id, ambito])
    return rowCount > 0
}
