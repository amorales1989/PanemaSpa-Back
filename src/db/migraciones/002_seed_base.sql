-- =====================================================================
-- Panema SaaS · Datos base: permisos, roles de sistema, planes y la
-- función que deja lista una empresa nueva.
-- =====================================================================

insert into permisos (codigo, modulo, descripcion) values
  ('dashboard.ver',          'inicio',        'Ver el panel de inicio con totales'),
  ('ventas.crear',           'ventas',        'Registrar ventas'),
  ('ventas.ver',             'ventas',        'Ver sus propias ventas'),
  ('ventas.ver_todas',       'ventas',        'Ver las ventas de todo el equipo'),
  ('ventas.anular',          'ventas',        'Anular ventas'),
  ('egresos.crear',          'egresos',       'Registrar egresos y compras de insumos'),
  ('egresos.ver',            'egresos',       'Ver egresos'),
  ('egresos.anular',         'egresos',       'Anular egresos'),
  ('mermas.crear',           'mermas',        'Registrar merma'),
  ('mermas.ver',             'mermas',        'Ver merma'),
  ('mermas.anular',          'mermas',        'Anular merma'),
  ('productos.ver',          'catalogo',      'Ver productos (sin costos)'),
  ('productos.gestionar',    'catalogo',      'Crear, editar y eliminar productos'),
  ('productos.ver_costos',   'catalogo',      'Ver costos y márgenes'),
  ('precios.ajustar',        'catalogo',      'Ajuste masivo de precios'),
  ('insumos.ver',            'catalogo',      'Ver insumos'),
  ('insumos.gestionar',      'catalogo',      'Crear, editar y eliminar insumos'),
  ('promos.ver',             'catalogo',      'Ver promos'),
  ('promos.gestionar',       'catalogo',      'Crear, editar y activar promos'),
  ('proveedores.gestionar',  'catalogo',      'Administrar proveedores'),
  ('estadisticas.ver',       'reportes',      'Ver estadísticas'),
  ('reportes.descargar',     'reportes',      'Descargar informes PDF'),
  ('configuracion.gestionar','administracion','Canales, métodos de pago, categorías y motivos'),
  ('sucursales.gestionar',   'administracion','Administrar sucursales'),
  ('usuarios.gestionar',     'administracion','Invitar, suspender y cambiar rol de usuarios'),
  ('roles.gestionar',        'administracion','Crear roles personalizados'),
  ('suscripcion.gestionar',  'administracion','Plan, pagos y datos de la empresa');

-- Roles de sistema (empresa_id NULL): disponibles para todas las empresas
insert into roles (empresa_id, codigo, nombre, descripcion) values
  (null, 'dueno',         'Dueño',          'Acceso total, incluida la suscripción'),
  (null, 'administrador', 'Administrador',  'Todo menos la suscripción'),
  (null, 'encargado',     'Encargado/a',    'Opera el local: registros, catálogo y estadísticas'),
  (null, 'vendedor',      'Vendedor/a',     'Registra ventas y merma; ve solo lo suyo'),
  (null, 'produccion',    'Producción',     'Merma, compras de insumos y consulta de catálogo'),
  (null, 'contador',      'Contador/a',     'Solo lectura de movimientos, estadísticas e informes');

insert into rol_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
from roles r
join permisos p on case r.codigo
  when 'dueno'         then true
  when 'administrador' then p.codigo <> 'suscripcion.gestionar'
  when 'encargado'     then p.codigo in (
    'dashboard.ver', 'ventas.crear', 'ventas.ver', 'ventas.ver_todas', 'ventas.anular',
    'egresos.crear', 'egresos.ver', 'mermas.crear', 'mermas.ver', 'mermas.anular',
    'productos.ver', 'productos.gestionar', 'productos.ver_costos', 'insumos.ver', 'insumos.gestionar',
    'promos.ver', 'promos.gestionar', 'proveedores.gestionar', 'estadisticas.ver', 'reportes.descargar')
  when 'vendedor'      then p.codigo in ('ventas.crear', 'ventas.ver', 'mermas.crear', 'productos.ver', 'promos.ver')
  when 'produccion'    then p.codigo in ('mermas.crear', 'mermas.ver', 'egresos.crear', 'insumos.ver', 'productos.ver', 'promos.ver')
  when 'contador'      then p.codigo in (
    'dashboard.ver', 'ventas.ver', 'ventas.ver_todas', 'egresos.ver', 'mermas.ver',
    'productos.ver', 'productos.ver_costos', 'insumos.ver', 'promos.ver', 'estadisticas.ver', 'reportes.descargar')
end
where r.empresa_id is null;

insert into planes (codigo, nombre, precio_mensual, max_usuarios, max_sucursales, max_productos) values
  ('prueba', 'Prueba 14 días', 0,     3,    1,    50),
  ('basico', 'Básico',         19990, 3,    1,    200),
  ('pro',    'Pro',            39990, 15,   3,    null),
  ('negocio','Negocio',        79990, null, null, null);

-- Deja una empresa recién creada con sus listas por defecto.
-- Se llama dentro de la transacción del registro, con app.empresa_id ya seteado.
create or replace function inicializar_empresa(p_empresa uuid) returns void language plpgsql as $$
begin
  insert into sucursales (empresa_id, nombre) values (p_empresa, 'Casa matriz');

  insert into canales_venta (empresa_id, nombre, orden)
  select p_empresa, x, o from unnest(array['Mostrador', 'Pedidos y tortas', 'Delivery', 'Tienda online']) with ordinality as t(x, o);

  insert into metodos_pago (empresa_id, nombre, orden)
  select p_empresa, x, o from unnest(array['Efectivo', 'Débito', 'Crédito', 'Transferencia']) with ordinality as t(x, o);

  insert into motivos_merma (empresa_id, nombre, orden)
  select p_empresa, x, o from unnest(array['Vencido', 'Dañado', 'Sobreproducción']) with ordinality as t(x, o);

  insert into categorias (empresa_id, ambito, nombre, orden, con_items)
  select p_empresa, 'egreso', x, o, x = 'Insumos'
  from unnest(array['Insumos', 'Sueldos', 'Arriendo', 'Servicios', 'Mantención', 'Otros']) with ordinality as t(x, o);

  insert into categorias (empresa_id, ambito, nombre, orden)
  select p_empresa, 'producto', x, o from unnest(array['Panes', 'Pastelería', 'Tortas', 'Cafetería']) with ordinality as t(x, o);

  insert into categorias (empresa_id, ambito, nombre, orden)
  select p_empresa, 'insumo', x, o from unnest(array['Secos', 'Lácteos y huevos', 'Frutas y rellenos', 'Cafetería', 'Packaging']) with ordinality as t(x, o);
end $$;

-- Rol con el que se conecta la API: no es dueño de las tablas → RLS aplica.
-- (La contraseña se define al desplegar: alter role panema_app password '...')
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'panema_app') then
    create role panema_app login;
  end if;
end $$;
grant usage on schema public to panema_app;
grant select, insert, update, delete on all tables in schema public to panema_app;
grant usage on all sequences in schema public to panema_app;
grant execute on all functions in schema public to panema_app;
revoke delete on ventas, venta_items, venta_item_componentes, egresos, egreso_items, mermas, merma_items,
  producto_precios, auditoria from panema_app;   -- movimientos se anulan, no se borran

-- Tablas y funciones que creen migraciones futuras también quedan accesibles para la API
alter default privileges in schema public grant select, insert, update, delete on tables to panema_app;
alter default privileges in schema public grant usage on sequences to panema_app;
alter default privileges in schema public grant execute on functions to panema_app;
