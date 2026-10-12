-- =====================================================================
-- 004 · Plan Fundador y suscripciones sin vencimiento
--
-- Panema SpA es la cafetería que hizo posible el desarrollo: tiene
-- contrato indefinido y no paga suscripción.
-- =====================================================================

-- Planes internos: no se ofrecen a clientes nuevos, solo los asigna un superadmin
alter table planes add column publico boolean not null default true;

insert into planes (codigo, nombre, precio_mensual, max_usuarios, max_sucursales, max_productos, publico)
values ('fundador', 'Fundador', 0, null, null, null, false);

-- periodo_fin null = suscripción indefinida (nunca vence ni se cobra)
alter table suscripciones alter column periodo_fin drop not null;

-- Panema: plan Fundador, activa y sin vencimiento.
-- (Solo existe en producción; en otros ambientes no afecta ninguna fila.)
update suscripciones s
   set plan_id = (select id from planes where codigo = 'fundador'),
       estado = 'activa',
       prueba_hasta = null,
       periodo_fin = null
  from empresas e
 where e.id = s.empresa_id and e.slug = 'panema' and s.estado in ('prueba', 'activa');
