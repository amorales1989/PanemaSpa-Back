-- =====================================================================
-- 016 · Control de stock (opcional por empresa)
--
-- Con empresas.control_stock activo:
--   · Insumos: suben con cada compra; bajan con mermas y con lo que consumen
--     los productos con receta al venderse o mermarse.
--   · Productos sin receta (reventa): suben con la reposición; bajan con
--     ventas y mermas.
--   · Productos con receta no llevan stock propio: su stock son sus insumos.
--   · Ajustes manuales: reposición (suma) o conteo (fija el valor real).
-- Cada cambio queda en stock_movimientos y un trigger mantiene la columna
-- `stock`. Anular una venta, compra o merma revierte exactamente lo que
-- ese registro movió (aunque después se haya apagado el control o cambiado la receta).
-- Con stock_minimo cargado, lo que queda en o bajo el mínimo se marca para reponer.
-- =====================================================================

alter table empresas add column control_stock boolean not null default false;

alter table productos add column stock        numeric(14,3) not null default 0;
alter table productos add column stock_minimo numeric(14,3) check (stock_minimo >= 0);
alter table insumos   add column stock        numeric(14,3) not null default 0;
alter table insumos   add column stock_minimo numeric(14,3) check (stock_minimo >= 0);

create table stock_movimientos (
  id             bigint generated always as identity primary key,
  empresa_id     uuid not null references empresas(id),
  producto_id    uuid,
  insumo_id      uuid,
  cantidad       numeric(14,3) not null check (cantidad <> 0), -- + entra, − sale
  origen         text not null check (origen in ('venta', 'compra', 'merma', 'reposicion', 'conteo')),
  referencia_id  uuid,                                        -- venta / egreso / merma que lo generó
  anulacion      boolean not null default false,              -- reversa de un registro anulado
  motivo         text,
  usuario_id     uuid references usuarios(id),
  created_at     timestamptz not null default now(),
  check (num_nonnulls(producto_id, insumo_id) = 1),
  foreign key (empresa_id, producto_id) references productos (empresa_id, id),
  foreign key (empresa_id, insumo_id) references insumos (empresa_id, id)
);
create index stock_mov_producto_idx on stock_movimientos (empresa_id, producto_id, created_at desc) where producto_id is not null;
create index stock_mov_insumo_idx   on stock_movimientos (empresa_id, insumo_id, created_at desc) where insumo_id is not null;
create index stock_mov_ref_idx      on stock_movimientos (referencia_id) where referencia_id is not null;

alter table stock_movimientos enable row level security;
create policy aislamiento_empresa on stock_movimientos
  using (empresa_id = app_empresa()) with check (empresa_id = app_empresa());
grant select, insert on stock_movimientos to panema_app;

-- El stock de cada ítem es la suma de sus movimientos
create or replace function tg_stock_aplicar() returns trigger language plpgsql as $$
begin
  if new.producto_id is not null then
    update productos set stock = stock + new.cantidad where id = new.producto_id;
  else
    update insumos set stock = stock + new.cantidad where id = new.insumo_id;
  end if;
  return new;
end $$;
create trigger stock_movimientos_aplicar after insert on stock_movimientos
  for each row execute function tg_stock_aplicar();

-- Mueve el stock de un registro recién creado ('venta' | 'compra' | 'merma').
-- No hace nada si la empresa no lleva control de stock.
create or replace function stock_registrar(p_origen text, p_id uuid) returns void language plpgsql as $$
declare
  v_usuario uuid := nullif(current_setting('app.usuario_id', true), '')::uuid;
begin
  if not coalesce((select control_stock from empresas where id = app_empresa()), false) then return; end if;

  if p_origen = 'compra' then
    insert into stock_movimientos (empresa_id, insumo_id, cantidad, origen, referencia_id, usuario_id)
    select empresa_id, insumo_id, sum(cantidad), 'compra', p_id, v_usuario
      from egreso_items where egreso_id = p_id group by empresa_id, insumo_id;
    return;
  end if;

  if p_origen not in ('venta', 'merma') then raise exception 'Origen de stock desconocido: %', p_origen; end if;

  insert into stock_movimientos (empresa_id, producto_id, insumo_id, cantidad, origen, referencia_id, usuario_id)
  with salidas as (
    -- Productos vendidos (incluidos los de las promos, ya desglosados)
    select producto_id, null::uuid as insumo_id, cantidad from venta_items
     where p_origen = 'venta' and venta_id = p_id and producto_id is not null
    union all
    select c.producto_id, null, c.cantidad from venta_item_componentes c join venta_items vi on vi.id = c.venta_item_id
     where p_origen = 'venta' and vi.venta_id = p_id
    union all
    -- Productos o insumos mermados
    select producto_id, insumo_id, cantidad from merma_items where p_origen = 'merma' and merma_id = p_id
  ), lineas as (
    -- Producto sin receta: sale el producto
    select s.producto_id, null::uuid as insumo_id, s.cantidad from salidas s
     where s.producto_id is not null and not exists (select 1 from producto_insumos pi where pi.producto_id = s.producto_id)
    union all
    -- Producto con receta: salen sus insumos
    select null, pi.insumo_id, s.cantidad * pi.cantidad from salidas s join producto_insumos pi on pi.producto_id = s.producto_id
    union all
    -- Insumo mermado
    select null, s.insumo_id, s.cantidad from salidas s where s.insumo_id is not null
  )
  select app_empresa(), producto_id, insumo_id, -round(sum(cantidad), 3), p_origen, p_id, v_usuario
    from lineas group by producto_id, insumo_id having round(sum(cantidad), 3) <> 0;
end $$;

-- Al anular un registro, devuelve lo que movió
create or replace function stock_revertir(p_id uuid) returns void language sql as $$
  insert into stock_movimientos (empresa_id, producto_id, insumo_id, cantidad, origen, referencia_id, anulacion, usuario_id)
  select empresa_id, producto_id, insumo_id, -cantidad, origen, referencia_id, true,
         nullif(current_setting('app.usuario_id', true), '')::uuid
    from stock_movimientos where referencia_id = p_id and not anulacion;
$$;
