-- =====================================================================
-- 003 · Precio editable en ventas (con permiso) e idempotencia de registros
-- =====================================================================

-- Cambiar el precio de una línea al vender (descuentos, redondeos).
-- Sin este permiso, el servidor usa siempre el precio del catálogo.
insert into permisos (codigo, modulo, descripcion) values
  ('ventas.modificar_precio', 'ventas', 'Cambiar el precio de un producto o promo al vender');

insert into rol_permisos (rol_id, permiso_codigo)
select id, 'ventas.modificar_precio' from roles
where empresa_id is null and codigo in ('dueno', 'administrador', 'encargado');

-- Idempotency-Key: si el front reintenta (doble clic, mala señal) con la misma
-- clave, se devuelve el registro ya creado en vez de duplicarlo.
alter table ventas  add column clave_idempotencia text;
alter table egresos add column clave_idempotencia text;
alter table mermas  add column clave_idempotencia text;

create unique index ventas_idempotencia_uq  on ventas  (empresa_id, clave_idempotencia) where clave_idempotencia is not null;
create unique index egresos_idempotencia_uq on egresos (empresa_id, clave_idempotencia) where clave_idempotencia is not null;
create unique index mermas_idempotencia_uq  on mermas  (empresa_id, clave_idempotencia) where clave_idempotencia is not null;

-- Correlativo por empresa también en egresos y mermas (como el n° de ticket de ventas):
-- ordena los listados y permite paginar de forma estable
alter table egresos add column numero bigint not null;
alter table mermas  add column numero bigint not null;
alter table egresos add constraint egresos_numero_uq unique (empresa_id, numero);
alter table mermas  add constraint mermas_numero_uq  unique (empresa_id, numero);

-- Orden de las líneas tal como se cargaron en el ticket
alter table venta_items  add column posicion smallint not null default 0;
alter table egreso_items add column posicion smallint not null default 0;
alter table merma_items  add column posicion smallint not null default 0;

-- Listados paginados por (fecha, numero)
create index ventas_lista_idx  on ventas  (empresa_id, fecha desc, numero desc);
create index egresos_lista_idx on egresos (empresa_id, fecha desc, numero desc);
create index mermas_lista_idx  on mermas  (empresa_id, fecha desc, numero desc);
