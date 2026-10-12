# PanemaSpa · Back

API multi-empresa (SaaS) para el control del negocio de panaderías y pastelerías.
Node 22 + Express 5 + PostgreSQL 16, con Row Level Security por empresa.

El plan completo y el modelo de datos están en el repo del front: `docs/PLAN-SAAS.md`.

## Desarrollo local

```bash
npm install
cp .env.example .env          # completar JWT_SECRET (openssl rand -base64 48)
npm run db:dev                # Postgres en Docker (puerto 5432)
npm run migrar                # aplica src/db/migraciones/*.sql
npm run dev                   # http://localhost:3000/salud
```

## Tests

Corren contra una base real (incluyen los tests de aislamiento entre empresas):

```bash
docker run -d --name panema-test -e POSTGRES_DB=panema -e POSTGRES_USER=panema \
  -e POSTGRES_PASSWORD=dueno-test -p 55433:5432 postgres:16

cat > .env.test <<'EOF'
NODE_ENV=test
DATABASE_URL=postgres://panema_app:app-test@localhost:55433/panema
DATABASE_URL_MIGRACIONES=postgres://panema:dueno-test@localhost:55433/panema
APP_DB_PASSWORD=app-test
JWT_SECRET=secreto-solo-para-tests-0123456789abcdef
EOF

node --env-file=.env.test scripts/migrar.js
npm test
```

## Estructura

```
src/
  config/        env.js (variables validadas), db.js (pool pg)
  db/            contexto.js (conEmpresa / transaccion), migraciones/
  middlewares/   auth (JWT), empresa (X-Empresa-Id + permisos), permiso, validar (zod), errores
  rutas/ → controladores/ → servicios/ → repositorios/
  utilidades/    errores (ErrorApi), tokens, logger, texto
scripts/         migrar.js
docs/            DEPLOY-COOLIFY.md
```

### Reglas

- **Toda consulta a tablas de negocio va dentro de `conEmpresa(req.contexto, fn)`**. Ahí se setea `app.empresa_id` y Postgres filtra por RLS. Fuera de eso, esas tablas no devuelven filas.
- La API se conecta como `panema_app`, que no es dueño de las tablas, así que RLS siempre aplica y no puede borrar movimientos. Las migraciones usan el usuario dueño (`DATABASE_URL_MIGRACIONES`).
- Las rutas verifican **permisos** (`permiso('ventas.crear')`), nunca nombres de rol.
- Los errores se lanzan con `ErrorApi` (`utilidades/errores.js`). Express 5 los lleva solo al middleware de errores, así que no hace falta un try/catch por controlador.
- Una migración ya aplicada no se edita: los cambios van en un archivo `00N_*.sql` nuevo.

## Endpoints actuales

| Método | Ruta | Auth |
|---|---|---|
| GET | `/salud` | — |
| POST | `/v1/auth/registro` | — (crea usuario dueño + empresa + prueba de 14 días) |
| POST | `/v1/auth/login` | — |
| POST | `/v1/auth/refresh` | cookie `panema_rt` (rota el token) |
| POST | `/v1/auth/logout` | cookie |
| GET | `/v1/auth/yo` | Bearer: usuario + empresas con rol y permisos |
| GET | `/v1/config` | Bearer + `X-Empresa-Id`: canales, métodos de pago, categorías, motivos, sucursales, proveedores |

## Producción (VPS con Coolify)

Paso a paso en [docs/DEPLOY-COOLIFY.md](docs/DEPLOY-COOLIFY.md). En resumen:

- Postgres 16 como recurso de base de datos de Coolify, sin acceso público y con backups a S3/R2.
- Esta API como aplicación desde GitHub (build pack Dockerfile, puerto 3000, dominio `https://api.tudominio.cl`).
- Las migraciones corren solas al arrancar el contenedor (`CMD` del Dockerfile). Si una falla, el contenedor nuevo no levanta.
- Volumen persistente en `/app/uploads` para las fotos.
