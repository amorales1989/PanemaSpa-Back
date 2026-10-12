-- =====================================================================
-- Panema SaaS · Esquema base multi-empresa (PostgreSQL 16)
--
-- Modelo: una sola base, un solo esquema, columna empresa_id en cada
-- tabla de negocio + Row Level Security (RLS) como segunda barrera.
--
-- Convenciones:
--   * PK uuid (gen_random_uuid) en todo lo que se expone por la API.
--   * Dinero numeric(14,2), cantidades numeric(12,3) (kilos con gramos).
--   * Toda tabla de negocio tiene UNIQUE (empresa_id, id) para que las
--     FK hijas sean compuestas (empresa_id, x_id): así es IMPOSIBLE que
--     un registro de la empresa A apunte a un producto de la empresa B.
--   * Catálogo con borrado lógico (deleted_at); movimientos se ANULAN,
--     nunca se borran (auditoría / contabilidad).
--   * Las líneas guardan copia (snapshot) de nombre, unidad, precio y
--     costo del momento: si mañana cambia el precio, la venta de ayer no.
-- =====================================================================

create extension if not exists citext;

-- Función genérica para updated_at
create or replace function tg_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =====================================================================
-- 1. PLATAFORMA (globales, sin empresa_id)
-- =====================================================================

create table planes (
  id              smallint generated always as identity primary key,
  codigo          text not null unique,               -- 'basico', 'pro'
  nombre          text not null,
  precio_mensual  numeric(14,2) not null default 0,
  moneda          char(3) not null default 'CLP',
  max_usuarios    int,                                 -- null = ilimitado
  max_sucursales  int,
  max_productos   int,
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Personas. Un usuario es global y puede pertenecer a varias empresas.
create table usuarios (
  id                   uuid primary key default gen_random_uuid(),
  email                citext not null unique,
  password_hash        text,                           -- argon2id; null si entra solo por invitación aún no aceptada
  nombre               text not null,
  telefono             text,
  es_superadmin        boolean not null default false, -- equipo de la plataforma, no de una empresa
  email_verificado_en  timestamptz,
  ultimo_acceso_en     timestamptz,
  activo               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger usuarios_updated before update on usuarios for each row execute function tg_updated_at();

-- Refresh tokens (uno por dispositivo). Se guarda solo el hash.
create table sesiones (
  id                  uuid primary key default gen_random_uuid(),
  usuario_id          uuid not null references usuarios(id) on delete cascade,
  refresh_token_hash  text not null unique,
  user_agent          text,
  ip                  inet,
  expira_en           timestamptz not null,
  revocada_en         timestamptz,
  created_at          timestamptz not null default now()
);
create index sesiones_usuario_idx on sesiones (usuario_id) where revocada_en is null;

-- Tokens de un solo uso: verificar email, recuperar contraseña
create table tokens_usuario (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  tipo        text not null check (tipo in ('verificar_email', 'reset_password')),
  token_hash  text not null unique,
  expira_en   timestamptz not null,
  usado_en    timestamptz,
  created_at  timestamptz not null default now()
);

-- El "tenant"
create table empresas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  razon_social  text,
  rut           text,
  slug          citext not null unique,               -- panema → identifica la empresa en URLs
  moneda        char(3) not null default 'CLP',
  decimales     smallint not null default 0,          -- CLP = 0; redondeo de subtotales
  zona_horaria  text not null default 'America/Santiago',
  logo_url      text,
  estado        text not null default 'activa' check (estado in ('activa', 'suspendida', 'cancelada')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger empresas_updated before update on empresas for each row execute function tg_updated_at();

create table suscripciones (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references empresas(id) on delete cascade,
  plan_id          smallint not null references planes(id),
  estado           text not null check (estado in ('prueba', 'activa', 'vencida', 'cancelada')),
  prueba_hasta     date,
  periodo_inicio   date not null,
  periodo_fin      date not null,
  proveedor_pago   text,                               -- 'mercadopago', 'manual'
  proveedor_ref    text,                               -- id de la suscripción en el proveedor
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index suscripciones_una_vigente on suscripciones (empresa_id) where estado in ('prueba', 'activa');
create trigger suscripciones_updated before update on suscripciones for each row execute function tg_updated_at();

create table pagos_suscripcion (
  id               uuid primary key default gen_random_uuid(),
  suscripcion_id   uuid not null references suscripciones(id) on delete cascade,
  monto            numeric(14,2) not null,
  moneda           char(3) not null default 'CLP',
  estado           text not null check (estado in ('pendiente', 'aprobado', 'rechazado', 'reembolsado')),
  proveedor_ref    text unique,                        -- idempotencia de webhooks
  pagado_en        timestamptz,
  created_at       timestamptz not null default now()
);

-- =====================================================================
-- 2. SUCURSALES, ROLES, PERMISOS Y MEMBRESÍAS
-- =====================================================================

create table sucursales (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  direccion   text,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (empresa_id, nombre),
  unique (empresa_id, id)
);

-- Catálogo global de permisos (lo define el código, se carga por seed)
create table permisos (
  codigo       text primary key,                       -- 'ventas.crear'
  modulo       text not null,                          -- 'ventas'
  descripcion  text not null
);

-- empresa_id NULL = rol de sistema (plantilla compartida por todas las empresas).
-- empresa_id con valor = rol personalizado creado por esa empresa.
create table roles (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid references empresas(id) on delete cascade,
  codigo       text not null,
  nombre       text not null,
  descripcion  text,
  created_at   timestamptz not null default now(),
  unique nulls not distinct (empresa_id, codigo)
);

-- Tabla intermedia rol ↔ permiso (N:M)
create table rol_permisos (
  rol_id          uuid not null references roles(id) on delete cascade,
  permiso_codigo  text not null references permisos(codigo) on delete cascade,
  primary key (rol_id, permiso_codigo)
);

-- Tabla intermedia usuario ↔ empresa (N:M) con el rol que tiene en ESA empresa.
-- Un mismo usuario puede ser dueño en una empresa y contador en otra.
create table empresa_usuarios (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  usuario_id         uuid not null references usuarios(id) on delete cascade,
  rol_id             uuid not null references roles(id),
  estado             text not null default 'activo' check (estado in ('activo', 'suspendido')),
  todas_sucursales   boolean not null default true,    -- false → ver empresa_usuario_sucursales
  invitado_por       uuid references usuarios(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (empresa_id, usuario_id),
  unique (empresa_id, id)
);
create index empresa_usuarios_usuario_idx on empresa_usuarios (usuario_id);
create trigger empresa_usuarios_updated before update on empresa_usuarios for each row execute function tg_updated_at();

-- El rol asignado debe ser de sistema o de la misma empresa
create or replace function tg_valida_rol_empresa() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from roles r where r.id = new.rol_id and (r.empresa_id is null or r.empresa_id = new.empresa_id)) then
    raise exception 'El rol % no pertenece a la empresa %', new.rol_id, new.empresa_id;
  end if;
  return new;
end $$;
create trigger empresa_usuarios_valida_rol before insert or update of rol_id, empresa_id on empresa_usuarios
  for each row execute function tg_valida_rol_empresa();

-- Tabla intermedia membresía ↔ sucursal (solo si todas_sucursales = false)
create table empresa_usuario_sucursales (
  empresa_id          uuid not null,
  empresa_usuario_id  uuid not null,
  sucursal_id         uuid not null,
  primary key (empresa_usuario_id, sucursal_id),
  foreign key (empresa_id, empresa_usuario_id) references empresa_usuarios (empresa_id, id) on delete cascade,
  foreign key (empresa_id, sucursal_id) references sucursales (empresa_id, id) on delete cascade
);

create table invitaciones (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  email         citext not null,
  rol_id        uuid not null references roles(id),
  token_hash    text not null unique,
  invitado_por  uuid not null references usuarios(id),
  expira_en     timestamptz not null,
  aceptada_en   timestamptz,
  revocada_en   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index invitaciones_pendiente_unica on invitaciones (empresa_id, email)
  where aceptada_en is null and revocada_en is null;

-- =====================================================================
-- 3. CONFIGURACIÓN POR EMPRESA (listas que hoy están fijas en mock.js)
-- =====================================================================

-- Categorías de productos, insumos y egresos
create table categorias (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  ambito      text not null check (ambito in ('producto', 'insumo', 'egreso')),
  nombre      text not null,
  orden       smallint not null default 0,
  activa      boolean not null default true,
  -- egresos: si la categoría lleva líneas de insumos (la categoría "Insumos")
  con_items   boolean not null default false,
  unique (empresa_id, ambito, nombre),
  unique (empresa_id, id)
);

create table canales_venta (               -- Mostrador, Pedidos y tortas, Delivery, Tienda online
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  orden       smallint not null default 0,
  activo      boolean not null default true,
  unique (empresa_id, nombre),
  unique (empresa_id, id)
);

create table metodos_pago (                -- Efectivo, Débito, Crédito, Transferencia
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  orden       smallint not null default 0,
  activo      boolean not null default true,
  unique (empresa_id, nombre),
  unique (empresa_id, id)
);

create table motivos_merma (               -- Vencido, Dañado, Sobreproducción
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  orden       smallint not null default 0,
  activo      boolean not null default true,
  unique (empresa_id, nombre),
  unique (empresa_id, id)
);

create table proveedores (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  rut         text,
  telefono    text,
  email       citext,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (empresa_id, nombre),
  unique (empresa_id, id)
);

-- Correlativos por empresa (n° de venta, código sugerido de producto...)
create table contadores (
  empresa_id  uuid not null references empresas(id) on delete cascade,
  clave       text not null,
  valor       bigint not null default 0,
  primary key (empresa_id, clave)
);

create or replace function siguiente_numero(p_empresa uuid, p_clave text) returns bigint language sql as $$
  insert into contadores (empresa_id, clave, valor) values (p_empresa, p_clave, 1)
  on conflict (empresa_id, clave) do update set valor = contadores.valor + 1
  returning valor;
$$;

-- =====================================================================
-- 4. CATÁLOGO
-- =====================================================================

create table productos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  codigo        int not null,                          -- 101, 102... para tipear rápido
  nombre        text not null,
  categoria_id  uuid,
  unidad        text not null check (unidad in ('un', 'kg', 'lt')),
  precio_venta  numeric(14,2) not null check (precio_venta >= 0),
  costo         numeric(14,2) not null default 0 check (costo >= 0),
  imagen_url    text,
  activo        boolean not null default true,
  created_by    uuid references usuarios(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (empresa_id, id),
  foreign key (empresa_id, categoria_id) references categorias (empresa_id, id)
);
create unique index productos_codigo_uq on productos (empresa_id, codigo) where deleted_at is null;
create index productos_nombre_idx on productos (empresa_id, lower(nombre)) where deleted_at is null;
create trigger productos_updated before update on productos for each row execute function tg_updated_at();

-- Historial de precios de venta (edición o ajuste masivo)
create table producto_precios (
  id              bigint generated always as identity primary key,
  empresa_id      uuid not null,
  producto_id     uuid not null,
  precio_anterior numeric(14,2) not null,
  precio_nuevo    numeric(14,2) not null,
  motivo          text not null,                       -- 'Edición', 'Ajuste +8%'...
  usuario_id      uuid references usuarios(id),
  created_at      timestamptz not null default now(),
  foreign key (empresa_id, producto_id) references productos (empresa_id, id) on delete cascade
);
create index producto_precios_idx on producto_precios (empresa_id, producto_id, created_at desc);

-- El historial se escribe solo cuando cambia precio_venta
create or replace function tg_historial_precio() returns trigger language plpgsql as $$
begin
  if new.precio_venta is distinct from old.precio_venta then
    insert into producto_precios (empresa_id, producto_id, precio_anterior, precio_nuevo, motivo, usuario_id)
    values (new.empresa_id, new.id, old.precio_venta, new.precio_venta,
            coalesce(nullif(current_setting('app.motivo_precio', true), ''), 'Edición'),
            nullif(current_setting('app.usuario_id', true), '')::uuid);
  end if;
  return new;
end $$;
create trigger productos_historial_precio after update of precio_venta on productos
  for each row execute function tg_historial_precio();

create table insumos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references empresas(id) on delete cascade,
  codigo                int not null,                  -- 501, 502...
  nombre                text not null,
  categoria_id          uuid,
  unidad                text not null check (unidad in ('un', 'kg', 'lt')),
  precio_ultimo         numeric(14,2) not null default 0, -- se actualiza con cada compra
  precio_actualizado_en date,
  activo                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (empresa_id, id),
  foreign key (empresa_id, categoria_id) references categorias (empresa_id, id)
);
create unique index insumos_codigo_uq on insumos (empresa_id, codigo) where deleted_at is null;
create trigger insumos_updated before update on insumos for each row execute function tg_updated_at();

create table promos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  codigo         int not null,                         -- 901, 902...
  nombre         text not null,
  precio         numeric(14,2) not null check (precio >= 0),
  activa         boolean not null default true,
  vigente_desde  date,
  vigente_hasta  date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (empresa_id, id),
  check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde)
);
create unique index promos_codigo_uq on promos (empresa_id, codigo) where deleted_at is null;
create trigger promos_updated before update on promos for each row execute function tg_updated_at();

-- Tabla intermedia promo ↔ producto (N:M) con la cantidad de cada uno
create table promo_productos (
  empresa_id   uuid not null,
  promo_id     uuid not null,
  producto_id  uuid not null,
  cantidad     numeric(12,3) not null check (cantidad > 0),
  primary key (promo_id, producto_id),
  foreign key (empresa_id, promo_id) references promos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, producto_id) references productos (empresa_id, id)
);

-- =====================================================================
-- 5. MOVIMIENTOS (cabecera + líneas)
-- =====================================================================

create table ventas (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id),
  sucursal_id       uuid not null,
  numero            bigint not null,                   -- correlativo por empresa (n° de ticket)
  fecha             date not null,                     -- día del negocio (en la zona horaria de la empresa)
  ocurrido_en       timestamptz not null default now(),
  canal_id          uuid not null,
  metodo_pago_id    uuid not null,
  total             numeric(14,2) not null check (total >= 0),
  estado            text not null default 'confirmada' check (estado in ('confirmada', 'anulada')),
  anulada_en        timestamptz,
  anulada_por       uuid references usuarios(id),
  motivo_anulacion  text,
  usuario_id        uuid not null references usuarios(id), -- quién la registró
  created_at        timestamptz not null default now(),
  unique (empresa_id, id),
  unique (empresa_id, numero),
  foreign key (empresa_id, sucursal_id) references sucursales (empresa_id, id),
  foreign key (empresa_id, canal_id) references canales_venta (empresa_id, id),
  foreign key (empresa_id, metodo_pago_id) references metodos_pago (empresa_id, id)
);
create index ventas_fecha_idx on ventas (empresa_id, fecha desc) where estado = 'confirmada';
create index ventas_usuario_idx on ventas (empresa_id, usuario_id, fecha desc);

-- Línea de venta: un producto O una promo (nunca ambos)
create table venta_items (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null,
  venta_id         uuid not null,
  producto_id      uuid,
  promo_id         uuid,
  codigo           int,                                 -- snapshot
  nombre           text not null,                       -- snapshot
  unidad           text not null,                       -- snapshot
  cantidad         numeric(12,3) not null check (cantidad > 0),
  precio_unitario  numeric(14,2) not null check (precio_unitario >= 0),
  costo_unitario   numeric(14,2) not null default 0,    -- snapshot → margen histórico real
  subtotal         numeric(14,2) not null,
  unique (empresa_id, id),
  check (num_nonnulls(producto_id, promo_id) = 1),
  foreign key (empresa_id, venta_id) references ventas (empresa_id, id) on delete cascade,
  foreign key (empresa_id, producto_id) references productos (empresa_id, id),
  foreign key (empresa_id, promo_id) references promos (empresa_id, id)
);
create index venta_items_venta_idx on venta_items (venta_id);
create index venta_items_producto_idx on venta_items (empresa_id, producto_id) where producto_id is not null;
create index venta_items_promo_idx on venta_items (empresa_id, promo_id) where promo_id is not null;

-- Desglose de una línea promo en sus productos, con el precio promo prorrateado
-- (reemplaza a `componentes` / expandir() del front)
create table venta_item_componentes (
  empresa_id          uuid not null,
  venta_item_id       uuid not null,
  producto_id         uuid not null,
  nombre              text not null,
  unidad              text not null,
  cantidad            numeric(12,3) not null check (cantidad > 0), -- ya multiplicada por la cantidad de promos
  precio_prorrateado  numeric(14,2) not null,
  costo_unitario      numeric(14,2) not null default 0,
  primary key (venta_item_id, producto_id),
  foreign key (empresa_id, venta_item_id) references venta_items (empresa_id, id) on delete cascade,
  foreign key (empresa_id, producto_id) references productos (empresa_id, id)
);
create index venta_item_comp_producto_idx on venta_item_componentes (empresa_id, producto_id);

create table egresos (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id),
  sucursal_id       uuid not null,
  fecha             date not null,
  categoria_id      uuid not null,                     -- categorias.ambito = 'egreso'
  proveedor_id      uuid,
  metodo_pago_id    uuid not null,
  descripcion       text,
  total             numeric(14,2) not null check (total >= 0),
  estado            text not null default 'confirmado' check (estado in ('confirmado', 'anulado')),
  anulado_en        timestamptz,
  anulado_por       uuid references usuarios(id),
  motivo_anulacion  text,
  usuario_id        uuid not null references usuarios(id),
  created_at        timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, sucursal_id) references sucursales (empresa_id, id),
  foreign key (empresa_id, categoria_id) references categorias (empresa_id, id),
  foreign key (empresa_id, proveedor_id) references proveedores (empresa_id, id),
  foreign key (empresa_id, metodo_pago_id) references metodos_pago (empresa_id, id)
);
create index egresos_fecha_idx on egresos (empresa_id, fecha desc) where estado = 'confirmado';

-- Líneas de una compra de insumos
create table egreso_items (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null,
  egreso_id        uuid not null,
  insumo_id        uuid not null,
  codigo           int,
  nombre           text not null,
  unidad           text not null,
  cantidad         numeric(12,3) not null check (cantidad > 0),
  precio_unitario  numeric(14,2) not null check (precio_unitario >= 0),
  subtotal         numeric(14,2) not null,
  foreign key (empresa_id, egreso_id) references egresos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, insumo_id) references insumos (empresa_id, id)
);
create index egreso_items_egreso_idx on egreso_items (egreso_id);
create index egreso_items_insumo_idx on egreso_items (empresa_id, insumo_id);

-- "El precio de cada insumo se actualiza solo con cada compra"
-- (solo si la compra no es más antigua que la última registrada)
create or replace function tg_precio_insumo() returns trigger language plpgsql as $$
declare v_fecha date;
begin
  select fecha into v_fecha from egresos where id = new.egreso_id;
  update insumos
     set precio_ultimo = new.precio_unitario, precio_actualizado_en = v_fecha
   where id = new.insumo_id and empresa_id = new.empresa_id
     and (precio_actualizado_en is null or precio_actualizado_en <= v_fecha);
  return new;
end $$;
create trigger egreso_items_precio_insumo after insert on egreso_items
  for each row execute function tg_precio_insumo();

create table mermas (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id),
  sucursal_id       uuid not null,
  fecha             date not null,
  motivo_id         uuid not null,
  observacion       text,
  total             numeric(14,2) not null check (total >= 0),
  estado            text not null default 'confirmada' check (estado in ('confirmada', 'anulada')),
  anulada_en        timestamptz,
  anulada_por       uuid references usuarios(id),
  motivo_anulacion  text,
  usuario_id        uuid not null references usuarios(id),
  created_at        timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, sucursal_id) references sucursales (empresa_id, id),
  foreign key (empresa_id, motivo_id) references motivos_merma (empresa_id, id)
);
create index mermas_fecha_idx on mermas (empresa_id, fecha desc) where estado = 'confirmada';

-- Línea de merma: un producto O un insumo, valorizado a costo
create table merma_items (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null,
  merma_id        uuid not null,
  producto_id     uuid,
  insumo_id       uuid,
  codigo          int,
  nombre          text not null,
  unidad          text not null,
  cantidad        numeric(12,3) not null check (cantidad > 0),
  costo_unitario  numeric(14,2) not null check (costo_unitario >= 0),
  subtotal        numeric(14,2) not null,
  check (num_nonnulls(producto_id, insumo_id) = 1),
  foreign key (empresa_id, merma_id) references mermas (empresa_id, id) on delete cascade,
  foreign key (empresa_id, producto_id) references productos (empresa_id, id),
  foreign key (empresa_id, insumo_id) references insumos (empresa_id, id)
);
create index merma_items_merma_idx on merma_items (merma_id);

-- =====================================================================
-- 6. AUDITORÍA
-- =====================================================================

create table auditoria (
  id          bigint generated always as identity primary key,
  empresa_id  uuid references empresas(id) on delete cascade,
  usuario_id  uuid references usuarios(id),
  accion      text not null,                           -- 'venta.anular', 'precios.ajustar', 'usuario.invitar'
  entidad     text not null,
  entidad_id  uuid,
  datos       jsonb,                                   -- antes/después
  ip          inet,
  created_at  timestamptz not null default now()
);
create index auditoria_empresa_idx on auditoria (empresa_id, created_at desc);

-- =====================================================================
-- 7. ROW LEVEL SECURITY
--
-- La API se conecta con el rol `panema_app` (sin BYPASSRLS) y en cada
-- request abre una transacción con:
--     set local app.empresa_id = '<uuid>';
--     set local app.usuario_id = '<uuid>';
-- Si un repositorio olvida el "where empresa_id = ...", Postgres igual
-- filtra. Sin app.empresa_id seteado, no ve nada.
-- =====================================================================

create or replace function app_empresa() returns uuid language sql stable as $$
  select nullif(current_setting('app.empresa_id', true), '')::uuid
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'sucursales', 'empresa_usuario_sucursales', 'categorias', 'canales_venta', 'metodos_pago',
    'motivos_merma', 'proveedores', 'contadores', 'productos', 'producto_precios', 'insumos',
    'promos', 'promo_productos', 'ventas', 'venta_items', 'venta_item_componentes',
    'egresos', 'egreso_items', 'mermas', 'merma_items'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy aislamiento_empresa on %I using (empresa_id = app_empresa()) with check (empresa_id = app_empresa())', t);
  end loop;
end $$;
