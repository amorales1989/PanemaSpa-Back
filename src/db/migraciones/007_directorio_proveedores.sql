-- =====================================================================
-- 007 · Directorio de proveedores: datos de contacto y cuentas bancarias
-- =====================================================================

alter table proveedores add column contacto  text;   -- persona con quien se habla
alter table proveedores add column direccion text;
alter table proveedores add column notas     text;   -- días de entrega, condiciones, etc.
alter table proveedores add column updated_at timestamptz not null default now();
create trigger proveedores_updated before update on proveedores for each row execute function tg_updated_at();

-- Cuentas para transferir (un proveedor puede tener varias)
create table proveedor_cuentas (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null,
  proveedor_id   uuid not null,
  banco          text not null,
  tipo_cuenta    text not null check (tipo_cuenta in ('corriente', 'vista', 'rut', 'ahorro')),
  numero         text not null,
  titular        text not null,
  rut_titular    text,
  email          citext,
  principal      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (empresa_id, proveedor_id) references proveedores (empresa_id, id) on delete cascade
);
create index proveedor_cuentas_idx on proveedor_cuentas (proveedor_id);
create trigger proveedor_cuentas_updated before update on proveedor_cuentas for each row execute function tg_updated_at();

alter table proveedor_cuentas enable row level security;
create policy aislamiento_empresa on proveedor_cuentas
  using (empresa_id = app_empresa()) with check (empresa_id = app_empresa());
grant select, insert, update, delete on proveedor_cuentas to panema_app;

-- Ver el directorio (incluye datos bancarios). Editar sigue siendo proveedores.gestionar.
insert into permisos (codigo, modulo, descripcion) values
  ('proveedores.ver', 'catalogo', 'Ver el directorio de proveedores y sus cuentas bancarias');

insert into rol_permisos (rol_id, permiso_codigo)
select id, 'proveedores.ver' from roles
where empresa_id is null and codigo in ('dueno', 'administrador', 'encargado', 'contador');
