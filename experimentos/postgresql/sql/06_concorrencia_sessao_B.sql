-- Execute na janela B, enquanto a janela A esta no pg_sleep(15).
-- Com dados limpos (100 disponiveis), deve bloquear ate A dar COMMIT e,
-- depois, recusar 30 porque sobraram 20. Capture a mensagem de erro.
SELECT ms.criar_reserva(2,1,30,NOW()+INTERVAL '1 hour') AS reserva_b;
