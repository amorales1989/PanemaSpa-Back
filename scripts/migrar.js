// Aplica en orden los .sql de src/db/migraciones que todavía no se aplicaron.
// Cada archivo corre en su propia transacción y queda anotado en _migraciones.
// Regla: una migración aplicada NO se edita; los cambios van en un archivo nuevo.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'

const DIR = join(import.meta.dirname, '../src/db/migraciones')
const url = process.env.DATABASE_URL_MIGRACIONES

if (!url) {
    console.error('Falta DATABASE_URL_MIGRACIONES')
    process.exit(1)
}

const cliente = new pg.Client({ connectionString: url })
await cliente.connect()

try {
    await cliente.query(`create table if not exists _migraciones (
        nombre text primary key,
        aplicada_en timestamptz not null default now()
    )`)
    const { rows } = await cliente.query('select nombre from _migraciones')
    const aplicadas = new Set(rows.map((r) => r.nombre))
    const archivos = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort()

    for (const archivo of archivos) {
        if (aplicadas.has(archivo)) continue
        const sql = await readFile(join(DIR, archivo), 'utf8')
        console.log(`→ ${archivo}`)
        await cliente.query('begin')
        try {
            await cliente.query(sql)
            await cliente.query('insert into _migraciones (nombre) values ($1)', [archivo])
            await cliente.query('commit')
        } catch (error) {
            await cliente.query('rollback')
            throw new Error(`${archivo}: ${error.message}`)
        }
    }

    // Contraseña del usuario con el que se conecta la API
    if (process.env.APP_DB_PASSWORD) {
        await cliente.query(`alter role panema_app password ${cliente.escapeLiteral(process.env.APP_DB_PASSWORD)}`)
    }
    console.log('Migraciones al día')
} catch (error) {
    console.error('Error migrando:', error.message)
    process.exitCode = 1
} finally {
    await cliente.end()
}
