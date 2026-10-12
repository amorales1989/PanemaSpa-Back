# PanemaSpa · Back

API multi-empresa (SaaS) para el control del negocio de panaderías y pastelerías.
Node 22 + Express 5 + PostgreSQL 16, con Row Level Security por empresa.

El plan completo y el modelo de datos están en el repo del front: `docs/PLAN-SAAS.md`.

## Desarrollo local

```bash
npm install
cp .env.example .env          # completar JWT_SECRET (openssl rand -base64 48)
npm run db:dev                # Postgres en Docker (puerto 5434)
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
- **Empresas en modo propio** (plan interno, ej. Panema con plan Fundador): usan el sistema como su desarrollo propio. Nada de lo que llega al cliente puede mencionar planes, pruebas, pagos ni suscripción. `/v1/auth/yo` devuelve `modoPropio: true` y el front oculta todo lo de facturación. El permiso `suscripcion.gestionar` se les quita automáticamente. Lo verifica un test en `tests/admin.test.js`.

## Endpoints

Respuestas en camelCase. Las rutas `/v1/*` (salvo `/v1/auth/*`) requieren `Authorization: Bearer <token>` y `X-Empresa-Id`. Entre paréntesis, el permiso.

**Auth**

| Método | Ruta | |
|---|---|---|
| GET | `/salud` | — |
| POST | `/v1/auth/registro` | crea usuario dueño + empresa + prueba de 14 días |
| POST | `/v1/auth/login` · `/refresh` · `/logout` | sesión (refresh en cookie `panema_rt`, rotativo) |
| GET | `/v1/auth/yo` | usuario + empresas con rol y permisos |
| POST | `/v1/auth/cambiar-password` | `{ actual, nueva }`; cierra las demás sesiones |

**Panel de plataforma** (solo `usuarios.es_superadmin`; sin `X-Empresa-Id`)

| Método | Ruta | |
|---|---|---|
| GET | `/v1/admin/resumen` | totales de la plataforma |
| GET | `/v1/admin/empresas?buscar&estado` | empresas con plan, suscripción, usuarios, ventas 30 días, última actividad |
| GET | `/v1/admin/empresas/:id` | detalle + usuarios + historial de suscripciones |
| PATCH | `/v1/admin/empresas/:id/estado` | `{ estado: activa \| suspendida }` (suspendida → sus usuarios reciben 403) |
| PATCH | `/v1/admin/empresas/:id/suscripcion` | `{ planCodigo?, estado?, pruebaHasta?, periodoFin? }` |
| GET | `/v1/admin/planes` | |

**Configuración**

| Método | Ruta | |
|---|---|---|
| GET | `/v1/config` | canales, métodos de pago, motivos, categorías, sucursales y proveedores (cualquier miembro) |
| POST / PATCH | `/v1/config/:lista[/:id]` | `canales`, `metodos-pago`, `motivos-merma`, `categorias`, `proveedores` (configuracion.gestionar), `sucursales` (sucursales.gestionar). No se borra: `activo: false` |

**Catálogo**

| Método | Ruta | |
|---|---|---|
| GET / POST | `/v1/productos` | listar (productos.ver; `costo` solo con productos.ver_costos) / crear (productos.gestionar). Sin `codigo` se asigna el siguiente (101…) |
| GET / PATCH / DELETE | `/v1/productos/:id` | borrado lógico; no deja borrar si está en una promo |
| GET | `/v1/productos/siguiente-codigo` · `/:id/historial-precios` | |
| POST | `/v1/productos/ajuste-precios` | `{ motivo, cambios: [{ id, precio }] }` (precios.ajustar) |
| PUT / DELETE | `/v1/productos/:id/imagen` | `{ imagen: "data:image/jpeg;base64,..." }` → `imagenUrl` (`/uploads/...`) |
| CRUD | `/v1/insumos` · `/:id/compras` | código 501…; `precio` = último precio de compra |
| CRUD | `/v1/promos` | `{ nombre, precio, productos: [{ productoId, cantidad }] }`; devuelve `precioNormal`. Código 901… |

**Movimientos** (header opcional `Idempotency-Key`: un reintento devuelve el mismo registro con 200)

| Método | Ruta | |
|---|---|---|
| POST | `/v1/ventas` | `{ canalId, metodoPagoId, items: [{ productoId \| promoId, cantidad, precio? }], fecha?, sucursalId? }`. Precios y costos los pone el servidor; un `precio` distinto exige ventas.modificar_precio |
| GET | `/v1/ventas` · `/:id` | paginado `?desde&hasta&estado&limite&cursor`. Sin ventas.ver_todas solo las propias |
| POST | `/v1/ventas/:id/anular` | `{ motivo }` (ventas.anular) |
| POST / GET | `/v1/egresos` | categoría con insumos: `items: [{ insumoId, cantidad, precio }]` + `proveedor` (texto; se crea si no existe). Otras: `monto` + `descripcion` |
| POST / GET | `/v1/mermas` | `{ motivoId, items: [{ productoId \| insumoId, cantidad }] }`, valorizada a costo |
| POST | `/v1/egresos/:id/anular` · `/v1/mermas/:id/anular` | |

## Producción (VPS con Coolify)

Paso a paso en [docs/DEPLOY-COOLIFY.md](docs/DEPLOY-COOLIFY.md). En resumen:

- Postgres 16 como recurso de base de datos de Coolify, sin acceso público y con backups a S3/R2.
- Esta API como aplicación desde GitHub (build pack Dockerfile, puerto 3000, dominio `https://api.tudominio.cl`).
- Las migraciones corren solas al arrancar el contenedor (`CMD` del Dockerfile). Si una falla, el contenedor nuevo no levanta.
- Volumen persistente en `/app/uploads` para las fotos.
