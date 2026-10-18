-- =====================================================================
-- 014 · Canal de venta y medio de pago por defecto
-- La caja abre la venta con estos ya elegidos. Uno por empresa como máximo;
-- sin ninguno marcado, la caja usa el primero de la lista.
-- =====================================================================

alter table canales_venta add column por_defecto boolean not null default false;
alter table metodos_pago  add column por_defecto boolean not null default false;

create unique index canales_venta_por_defecto_uq on canales_venta (empresa_id) where por_defecto and deleted_at is null;
create unique index metodos_pago_por_defecto_uq  on metodos_pago  (empresa_id) where por_defecto and deleted_at is null;
