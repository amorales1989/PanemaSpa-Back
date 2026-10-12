-- =====================================================================
-- 006 · Nombres únicos sin distinguir mayúsculas en las listas de cada empresa
-- ("Mostrador" y "mostrador" son el mismo canal)
-- =====================================================================
create unique index canales_venta_nombre_ci  on canales_venta (empresa_id, lower(nombre));
create unique index metodos_pago_nombre_ci   on metodos_pago  (empresa_id, lower(nombre));
create unique index motivos_merma_nombre_ci  on motivos_merma (empresa_id, lower(nombre));
create unique index proveedores_nombre_ci    on proveedores   (empresa_id, lower(nombre));
create unique index sucursales_nombre_ci     on sucursales    (empresa_id, lower(nombre));
create unique index categorias_nombre_ci     on categorias    (empresa_id, ambito, lower(nombre));
