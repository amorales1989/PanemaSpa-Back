-- =====================================================================
-- 005 · Contraseña temporal: obliga a cambiarla en el primer ingreso
-- =====================================================================
alter table usuarios add column debe_cambiar_password boolean not null default false;
