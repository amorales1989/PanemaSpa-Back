-- =====================================================================
-- 015 · Receta de los productos
--
-- Un producto puede estar hecho de varios insumos. La receta dice cuánto
-- de cada insumo (en la unidad del insumo) lleva una unidad del producto
-- (o un kilo, si se vende por kilo).
-- Con receta, el costo del producto se calcula solo: suma de
-- cantidad × último precio de compra de cada insumo, y se recalcula cada
-- vez que una compra cambia el precio de un insumo. Sin receta, el costo
-- sigue siendo el que se escribe a mano.
-- =====================================================================

create table producto_insumos (
  empresa_id   uuid not null,
  producto_id  uuid not null,
  insumo_id    uuid not null,
  cantidad     numeric(12,3) not null check (cantidad > 0),
  primary key (producto_id, insumo_id),
  foreign key (empresa_id, producto_id) references productos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, insumo_id) references insumos (empresa_id, id)
);
create index producto_insumos_insumo_idx on producto_insumos (empresa_id, insumo_id);

alter table producto_insumos enable row level security;
create policy aislamiento_empresa on producto_insumos
  using (empresa_id = app_empresa()) with check (empresa_id = app_empresa());
grant select, insert, update, delete on producto_insumos to panema_app;

-- Recalcula el costo de los productos indicados que tienen receta
create or replace function recalcular_costo_receta(p_productos uuid[]) returns void language sql as $$
  update productos p
     set costo = r.costo
    from (select pi.producto_id, sum(pi.cantidad * i.precio_ultimo) as costo
            from producto_insumos pi join insumos i on i.id = pi.insumo_id
           where pi.producto_id = any(p_productos)
           group by pi.producto_id) r
   where p.id = r.producto_id and p.costo is distinct from round(r.costo, 2);
$$;

-- Cuando una compra (o una edición) cambia el precio de un insumo, se actualiza el costo de lo que lo usa
create or replace function tg_costo_por_insumo() returns trigger language plpgsql as $$
begin
  perform recalcular_costo_receta(array(select producto_id from producto_insumos where insumo_id = new.id));
  return new;
end $$;
create trigger insumos_costo_productos after update of precio_ultimo on insumos
  for each row when (old.precio_ultimo is distinct from new.precio_ultimo)
  execute function tg_costo_por_insumo();
