-- =====================================================================
-- 012 · Descuento por medio de pago y clientes
-- =====================================================================

-- Descuento en ventas según cómo se paga (ej. 10% pagando con transferencia).
-- La venta guarda el porcentaje y el monto aplicados: si mañana cambia, las ventas de ayer no.
-- total = suma de las líneas - descuento
alter table metodos_pago add column descuento_pct numeric(5,2) not null default 0
  check (descuento_pct >= 0 and descuento_pct < 100);
alter table ventas add column descuento_pct numeric(5,2) not null default 0;
alter table ventas add column descuento numeric(14,2) not null default 0 check (descuento >= 0);

-- Clientes de cada empresa, para asociarlos a la venta y buscarlos rápido al cobrar
create table clientes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  documento   text,                 -- RUT, DNI, CUIT... (texto libre: cada país tiene su formato)
  telefono    text,
  email       citext,
  direccion   text,
  notas       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (empresa_id, id)
);
create index clientes_nombre_idx on clientes (empresa_id, lower(nombre)) where deleted_at is null;
create index clientes_documento_idx on clientes (empresa_id, documento) where deleted_at is null and documento is not null;
create trigger clientes_updated before update on clientes for each row execute function tg_updated_at();

alter table clientes enable row level security;
create policy aislamiento_empresa on clientes
  using (empresa_id = app_empresa()) with check (empresa_id = app_empresa());
grant select, insert, update, delete on clientes to panema_app;

-- La venta puede tener cliente (opcional). Un cliente eliminado se archiva: sus ventas lo siguen mostrando.
alter table ventas add column cliente_id uuid;
alter table ventas add constraint ventas_cliente_fk foreign key (empresa_id, cliente_id) references clientes (empresa_id, id);
create index ventas_cliente_idx on ventas (empresa_id, cliente_id, fecha desc) where cliente_id is not null;

insert into permisos (codigo, modulo, descripcion) values
  ('clientes.ver', 'clientes', 'Ver y buscar clientes'),
  ('clientes.gestionar', 'clientes', 'Editar y eliminar clientes');

insert into rol_permisos (rol_id, permiso_codigo)
select id, 'clientes.ver' from roles
where empresa_id is null and codigo in ('dueno', 'administrador', 'encargado', 'vendedor', 'contador');

insert into rol_permisos (rol_id, permiso_codigo)
select id, 'clientes.gestionar' from roles
where empresa_id is null and codigo in ('dueno', 'administrador', 'encargado');
