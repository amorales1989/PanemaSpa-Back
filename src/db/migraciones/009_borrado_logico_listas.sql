-- =====================================================================
-- 009 · Borrado lógico en las listas de cada empresa
--
-- Eliminar una opción que ya se usó (un canal con ventas, una categoría con
-- productos...) la marca con deleted_at: desaparece de la configuración y de los
-- formularios, pero los registros viejos la siguen mostrando. Lo que nunca se
-- usó se borra de verdad. Un nombre eliminado se puede volver a crear.
-- =====================================================================

alter table canales_venta add column deleted_at timestamptz;
alter table metodos_pago  add column deleted_at timestamptz;
alter table motivos_merma add column deleted_at timestamptz;
alter table categorias    add column deleted_at timestamptz;
alter table sucursales    add column deleted_at timestamptz;
alter table proveedores   add column deleted_at timestamptz;

-- Nombres únicos (sin distinguir mayúsculas) solo entre lo no eliminado
alter table canales_venta drop constraint canales_venta_empresa_id_nombre_key;
alter table metodos_pago  drop constraint metodos_pago_empresa_id_nombre_key;
alter table motivos_merma drop constraint motivos_merma_empresa_id_nombre_key;
alter table proveedores   drop constraint proveedores_empresa_id_nombre_key;
alter table sucursales    drop constraint sucursales_empresa_id_nombre_key;
alter table categorias    drop constraint categorias_empresa_id_ambito_nombre_key;

drop index canales_venta_nombre_ci;
drop index metodos_pago_nombre_ci;
drop index motivos_merma_nombre_ci;
drop index proveedores_nombre_ci;
drop index sucursales_nombre_ci;
drop index categorias_nombre_ci;

create unique index canales_venta_nombre_uq on canales_venta (empresa_id, lower(nombre)) where deleted_at is null;
create unique index metodos_pago_nombre_uq  on metodos_pago  (empresa_id, lower(nombre)) where deleted_at is null;
create unique index motivos_merma_nombre_uq on motivos_merma (empresa_id, lower(nombre)) where deleted_at is null;
create unique index proveedores_nombre_uq   on proveedores   (empresa_id, lower(nombre)) where deleted_at is null;
create unique index sucursales_nombre_uq    on sucursales    (empresa_id, lower(nombre)) where deleted_at is null;
create unique index categorias_nombre_uq    on categorias    (empresa_id, ambito, lower(nombre)) where deleted_at is null;
