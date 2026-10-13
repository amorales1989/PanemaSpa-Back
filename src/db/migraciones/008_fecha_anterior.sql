-- =====================================================================
-- 008 · Registrar ventas, egresos y mermas con una fecha anterior a hoy
-- (sin este permiso, todo se registra con la fecha del día)
-- =====================================================================
insert into permisos (codigo, modulo, descripcion) values
  ('movimientos.fecha_anterior', 'movimientos', 'Registrar ventas, egresos y mermas con una fecha anterior a hoy');

insert into rol_permisos (rol_id, permiso_codigo)
select id, 'movimientos.fecha_anterior' from roles
where empresa_id is null and codigo in ('dueno', 'administrador', 'encargado');
