-- =====================================================================
-- 013 · País de la empresa
--
-- Define moneda, huso horario, identificación fiscal (CUIT en Argentina,
-- RUT en Chile) y el formato de las cuentas bancarias de proveedores.
-- Las empresas nuevas son de Argentina salvo que se elija otro país;
-- las que ya existían eran todas de Chile.
-- =====================================================================

alter table empresas add column pais char(2) not null default 'CL' check (pais in ('AR', 'CL'));
alter table empresas alter column pais set default 'AR';

-- Columnas que guardan la identificación fiscal del país (RUT o CUIT). Se mantiene el nombre.
comment on column empresas.rut is 'Identificación fiscal: RUT (Chile) o CUIT (Argentina)';
comment on column proveedores.rut is 'Identificación fiscal: RUT (Chile) o CUIT (Argentina)';
comment on column proveedor_cuentas.rut_titular is 'Identificación fiscal del titular: RUT (Chile) o CUIT/CUIL (Argentina)';

-- Argentina: se transfiere a un CBU/CVU (22 dígitos) o a un alias. Basta con uno de los dos.
alter table proveedor_cuentas add column alias text;
alter table proveedor_cuentas alter column numero drop not null;
alter table proveedor_cuentas add constraint proveedor_cuentas_destino check (numero is not null or alias is not null);
