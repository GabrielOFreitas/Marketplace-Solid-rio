-- EXP-BD-02: abra DUAS janelas Query Tool conectadas AO MESMO banco.
-- Sessao A: execute este arquivo; durante os 15 segundos, execute o arquivo B.
-- ATENCAO: este experimento grava uma reserva. Use base de testes limpa e reinicie antes de repetir.
BEGIN;
SELECT ms.criar_reserva(1,1,80,NOW()+INTERVAL '1 hour') AS reserva_a;
SELECT pg_sleep(15); -- mantem bloqueio transacional enquanto a outra sessao tenta reservar
COMMIT;
SELECT * FROM ms.v_disponibilidade WHERE id_necessidade=1;
