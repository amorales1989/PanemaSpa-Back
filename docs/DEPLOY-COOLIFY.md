# Deploy en Coolify

Arquitectura: el front va en Vercel. En el VPS, Coolify corre Postgres 16 (recurso de base de datos) y la API (aplicación desde GitHub con este Dockerfile). El HTTPS lo maneja el proxy de Coolify.

```
app.tudominio.cl (Vercel) ──HTTPS──▶ api.tudominio.cl (proxy de Coolify)
                                         └─▶ API :3000 ──red interna──▶ Postgres :5432 (sin acceso público)
```

---

## 0. Antes de empezar

- **DNS**: en tu proveedor de dominio, crear un registro `A` de `api.tudominio.cl` que apunte a la IP del VPS. Si usas Cloudflare, déjalo en "DNS only" (nube gris) al principio, para que Let's Encrypt pueda emitir el certificado.
- **Generar 3 secretos**. Usa solo letras y números, para evitar problemas al armar las URLs de conexión:
  ```bash
  openssl rand -hex 24   # → contraseña del dueño de Postgres   (DB_OWNER)
  openssl rand -hex 24   # → contraseña de panema_app           (APP_DB_PASSWORD)
  openssl rand -hex 48   # → JWT_SECRET
  ```
  Guárdalos en tu gestor de contraseñas.

## 1. Proyecto

Coolify → **Projects → + Add** → nombre `Panema`. Usa el ambiente `production` que viene creado.

## 2. Base de datos

1. Dentro del proyecto: **+ New → Database → PostgreSQL**. Elegir la imagen **`postgres:16-alpine`**, del mismo major que en desarrollo.
2. Configuración:
   - **Name**: `panema-db`
   - **Username**: `panema`
   - **Password**: el secreto `DB_OWNER`
   - **Initial Database**: `panema`
   - **Make it publicly available**: ❌ **desactivado**. La base solo se accede desde la red interna.
3. **Start**.
4. Copiar el valor de **"Postgres URL (internal)"**. Tiene esta forma:
   ```
   postgres://panema:<DB_OWNER>@<id-del-recurso>:5432/panema
   ```
   El `<id-del-recurso>` es el hostname interno (un id tipo `k8s0w4c...`). Lo vas a usar en el paso 3.

### Respaldos (en el mismo recurso)

- **Backups → + Add**, con frecuencia `0 4 * * *` (todos los días a las 4:00).
- Antes, configurar un destino S3 en **Settings → S3 Storages**, para que el respaldo quede **fuera del VPS**. Sirven Cloudflare R2 (10 GB gratis) o Backblaze B2. Activar "Save to S3" en el backup.
- Retención: 14 locales y 30 en S3.
- **Probar una restauración** una vez (Backups → Restore, o `pg_restore` en una base de prueba).

## 3. API (back)

1. **+ New → Application**:
   - Repo público: **Public Repository**, URL `https://github.com/amorales1989/PanemaSpa-Back`.
   - Repo privado: **Private Repository (with GitHub App)**. Coolify te guía para instalar su GitHub App con acceso solo a este repo.
2. Configuración general:
   - **Branch**: `main`
   - **Build Pack**: `Dockerfile`
   - **Ports Exposes**: `3000`
   - **Domains**: `https://api.tudominio.cl`. Con el `https://` Coolify saca el certificado solo.
3. **Environment Variables** (no hace falta marcar "Build Variable" en ninguna):

   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PORT` | `3000` |
   | `DATABASE_URL_MIGRACIONES` | la *Postgres URL (internal)* del paso 2 |
   | `DATABASE_URL` | la misma URL, cambiando `panema:<DB_OWNER>` por `panema_app:<APP_DB_PASSWORD>` |
   | `APP_DB_PASSWORD` | el secreto `APP_DB_PASSWORD` |
   | `JWT_SECRET` | el secreto `JWT_SECRET` |
   | `CORS_ORIGIN`, `COOKIE_PATH`, `TRUST_PROXY` | ver paso 5 |
   | `UPLOADS_DIR` | `/app/uploads` |

   Ejemplo de `DATABASE_URL`:
   ```
   postgres://panema_app:9f3c...e1@k8s0w4c8g0kc:5432/panema
   ```
4. **Persistent Storage → + Add → Volume**:
   - Name `panema-uploads`
   - Destination path `/app/uploads`

   Sin esto, las fotos se pierden en cada deploy.
5. **Healthcheck**: activarlo con path `/salud` y puerto `3000`. La imagen ya trae `curl`.
6. **Deploy**. En los logs tiene que aparecer:
   ```
   → 001_esquema.sql
   → 002_seed_base.sql
   Migraciones al día
   API de Panema escuchando en el puerto 3000
   ```
   En cada arranque se aplican las migraciones pendientes. Si una falla, el contenedor nuevo no levanta y queda funcionando el anterior.
7. **Auto deploy**: con la GitHub App queda activo, y cada push a `main` redeploya. Con repo público hay que configurar el webhook que indica Coolify en **Webhooks**, o deployar a mano.

## 4. Verificar

```bash
curl https://api.tudominio.cl/salud
# {"estado":"ok","mensaje":"API de Panema funcionando correctamente"}

curl -X POST https://api.tudominio.cl/v1/auth/registro \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"Tu nombre","email":"tu@email.cl","password":"una-clave-larga","nombreEmpresa":"Panema"}'
# → accessToken + empresa creada
```

Ese primer registro deja creada la empresa Panema con su dueño.

## 5. Front en Vercel (`panema-spa.vercel.app`)

`vercel.app` es un dominio compartido, así que el navegador trata al front y a la API como sitios distintos y Safari bloquea la cookie de sesión. Por eso **Vercel hace de proxy**:

```
navegador ──▶ panema-spa.vercel.app/api/v1/... ──(rewrite de Vercel)──▶ https://API_COOLIFY/v1/...
```

- `vercel.json` del front reenvía `/api/:path*` al dominio de la API en Coolify.
- El front llama siempre a `/api/...` (mismo origen): no hay CORS y la cookie es de primera parte.
- Variables del back para este modo:

  | Variable | Valor |
  |---|---|
  | `CORS_ORIGIN` | `https://panema-spa.vercel.app` |
  | `COOKIE_PATH` | `/api/v1/auth` |
  | `TRUST_PROXY` | `2` (Vercel + Coolify) |
  | `COOKIE_DOMAIN` | *(no definirla)* |

**Con dominio propio** (`app.tudominio.cl` + `api.tudominio.cl`) se puede seguir con el proxy o llamar directo a la API. Para llamar directo: `COOKIE_DOMAIN=.tudominio.cl`, `COOKIE_PATH=/v1/auth`, `TRUST_PROXY=1`, y `CORS_ORIGIN` con el dominio nuevo.

## 6. Entrar a la base

- **Terminal**: en Coolify, recurso `panema-db` → **Terminal**, y ejecutar `psql -U panema -d panema`.
- **Desde tu PC** (DBeaver o pgAdmin) con túnel SSH, sin abrir puertos:
  ```bash
  # el id del contenedor sale en `docker ps` en el VPS
  ssh usuario@IP_VPS "docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <id-del-recurso>"
  ssh -L 5433:<IP_interna>:5432 usuario@IP_VPS
  # conectar DBeaver a localhost:5433, usuario panema
  ```

## Problemas comunes

| Síntoma | Causa probable |
|---|---|
| `Variables de entorno inválidas` en los logs | Falta una variable, o `JWT_SECRET` tiene menos de 32 caracteres |
| `password authentication failed for user "panema_app"` | `APP_DB_PASSWORD` no coincide con la contraseña dentro de `DATABASE_URL` |
| `getaddrinfo ENOTFOUND` | El hostname de la URL no es el interno del recurso, o la base está en otro servidor o red de Coolify |
| El certificado no se emite | El DNS todavía no apunta al VPS, o Cloudflare está en modo proxy |
| Login OK pero el refresh falla desde el front | El front no llama por `/api` (proxy de Vercel), o `COOKIE_PATH` no es `/api/v1/auth` |
| CORS bloqueado | El origen exacto del front, con `https://`, no está en `CORS_ORIGIN` |
