-- =====================================================================
-- 010 · Empresas demo
--
-- Las crea un superadmin para mostrarle la app a un posible cliente con
-- su nombre, logo y catálogo, y movimientos generados. No cuentan en las
-- métricas de la plataforma, no tienen suscripción y sus movimientos se
-- pueden regenerar o borrar (solo desde el panel de plataforma).
-- =====================================================================

alter table empresas add column es_demo boolean not null default false;
