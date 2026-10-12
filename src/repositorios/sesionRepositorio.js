export const crear = async (db, { usuarioId, tokenHash, userAgent, ip, dias }) => {
    const { rows } = await db.query(
        `insert into sesiones (usuario_id, refresh_token_hash, user_agent, ip, expira_en)
         values ($1, $2, $3, $4, now() + make_interval(days => $5))
         returning id`,
        [usuarioId, tokenHash, userAgent?.slice(0, 300) ?? null, ip ?? null, dias],
    )
    return rows[0].id
}

// "for update" evita que dos refresh simultáneos con el mismo token roten dos veces
export const buscarPorHash = async (db, tokenHash) => {
    const { rows } = await db.query(
        `select id, usuario_id, expira_en, revocada_en, expira_en < now() as vencida,
                revocada_en > now() - interval '60 seconds' as revocada_reciente
         from sesiones where refresh_token_hash = $1 for update`,
        [tokenHash],
    )
    return rows[0] ?? null
}

export const revocar = (db, id) =>
    db.query('update sesiones set revocada_en = now() where id = $1 and revocada_en is null', [id])

export const revocarTodas = (db, usuarioId) =>
    db.query('update sesiones set revocada_en = now() where usuario_id = $1 and revocada_en is null', [usuarioId])
