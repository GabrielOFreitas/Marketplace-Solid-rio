-- Execute no Query Tool do banco marketplace_solidario, nunca em postgres.
-- Resultado deve incluir 5 funcoes com assinatura BIGINT/BIGINT/INTEGER/TIMESTAMPTZ para criar_reserva.
SELECT current_database() AS banco, current_schema() AS esquema_padrao, current_user AS usuario;
SELECT n.nspname AS esquema, p.proname AS funcao,
       pg_get_function_identity_arguments(p.oid) AS parametros,
       pg_get_function_result(p.oid) AS retorno
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname = 'ms' AND p.proname IN
('criar_reserva','cancelar_reserva','informar_entrega','confirmar_recebimento','expirar_reserva')
ORDER BY funcao;
-- Diagnostico: 0 linhas => 02_operacoes.sql nao foi aplicado no banco atual.
