-- =====================================================================
-- 011 · Comprobante de venta imprimible
--
-- Cada empresa decide si al finalizar una venta se ofrece imprimir el
-- detalle, en ticket de 80 mm (impresora térmica) u hoja carta/A4.
-- No es un documento tributario: es el detalle de la venta para el cliente.
-- =====================================================================

alter table empresas add column direccion text;
alter table empresas add column telefono text;
alter table empresas add column comprobante_activo boolean not null default false;
alter table empresas add column comprobante_formato text not null default 'ticket'
  check (comprobante_formato in ('ticket', 'carta'));
alter table empresas add column comprobante_pie text;   -- mensaje al final ("¡Gracias por tu compra!")
