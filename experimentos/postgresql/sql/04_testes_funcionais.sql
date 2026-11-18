-- EXP-BD-01: TESTES TRANSACIONAIS DO NUCLEO DE RESERVAS
-- Execute depois de 01, 02 e 03. Os testes NAO alteram definitivamente a base (ROLLBACK).
-- Capture a aba 'Messages' (NOTICEs) como evidencia e rode a consulta final.
BEGIN;
DO $$
DECLARE
 v_a BIGINT; v_b BIGINT; v_c BIGINT;
 v_s RECORD; v_rejeitou BOOLEAN; v_mensagem TEXT;
BEGIN
 SELECT * INTO v_s FROM ms.v_disponibilidade WHERE id_necessidade=1;
 IF v_s.quantidade_disponivel <> 100 THEN
  RAISE EXCEPTION 'FALHOU T01: esperado disponivel 100, encontrado %', v_s.quantidade_disponivel;
 END IF;
 RAISE NOTICE 'T01 APROVADO - disponibilidade inicial = 100';

 v_a := ms.criar_reserva(1,1,60,NOW()+INTERVAL '1 hour');
 SELECT * INTO v_s FROM ms.v_disponibilidade WHERE id_necessidade=1;
 IF v_s.quantidade_disponivel <> 40 OR v_s.quantidade_reservada <> 60 THEN
  RAISE EXCEPTION 'FALHOU T02';
 END IF;
 RAISE NOTICE 'T02 APROVADO - reserva 60, disponivel 40';

 v_b := ms.criar_reserva(2,1,40,NOW()+INTERVAL '1 hour');
 SELECT * INTO v_s FROM ms.v_disponibilidade WHERE id_necessidade=1;
 IF v_s.quantidade_disponivel <> 0 THEN RAISE EXCEPTION 'FALHOU T03'; END IF;
 RAISE NOTICE 'T03 APROVADO - reserva adicional 40, disponivel 0';

 v_rejeitou := FALSE;
 BEGIN
  PERFORM ms.criar_reserva(2,1,1,NOW()+INTERVAL '1 hour');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_mensagem = MESSAGE_TEXT;
  v_rejeitou := POSITION('indisponivel' IN v_mensagem)>0;
 END;
 IF NOT v_rejeitou THEN RAISE EXCEPTION 'FALHOU T04'; END IF;
 RAISE NOTICE 'T04 APROVADO - reserva acima do saldo foi recusada';

 PERFORM ms.cancelar_reserva(v_a,1);
 SELECT * INTO v_s FROM ms.v_disponibilidade WHERE id_necessidade=1;
 IF v_s.quantidade_disponivel <> 60 THEN RAISE EXCEPTION 'FALHOU T05'; END IF;
 RAISE NOTICE 'T05 APROVADO - cancelamento liberou 60';

 v_c := ms.criar_reserva(1,1,20,NOW()+INTERVAL '1 hour');
 PERFORM ms.informar_entrega(v_c,1);
 SELECT * INTO v_s FROM ms.v_disponibilidade WHERE id_necessidade=1;
 IF v_s.quantidade_disponivel <> 40 OR v_s.quantidade_confirmada <> 0 THEN
  RAISE EXCEPTION 'FALHOU T06';
 END IF;
 RAISE NOTICE 'T06 APROVADO - entrega informada ainda nao e confirmacao';

 v_rejeitou := FALSE;
 BEGIN
  PERFORM ms.confirmar_recebimento(v_c,2); -- Usuario 2 nao e membro da instituicao.
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_mensagem = MESSAGE_TEXT;
  v_rejeitou := POSITION('nao autorizado' IN v_mensagem)>0;
 END;
 IF NOT v_rejeitou THEN RAISE EXCEPTION 'FALHOU T07'; END IF;
 RAISE NOTICE 'T07 APROVADO - doador nao pode confirmar recebimento';

 PERFORM ms.confirmar_recebimento(v_c,3); -- Usuario 3 e membro ativo da instituicao.
 SELECT * INTO v_s FROM ms.v_disponibilidade WHERE id_necessidade=1;
 IF v_s.quantidade_disponivel <> 40 OR v_s.quantidade_confirmada <> 20
    OR v_s.quantidade_reservada <> 40 THEN RAISE EXCEPTION 'FALHOU T08'; END IF;
 RAISE NOTICE 'T08 APROVADO - confirmado 20; saldo permanece 40';

 v_rejeitou := FALSE;
 BEGIN
  PERFORM ms.confirmar_recebimento(v_c,3);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_mensagem = MESSAGE_TEXT;
  v_rejeitou := POSITION('exige entrega informada' IN v_mensagem)>0;
 END;
 IF NOT v_rejeitou THEN RAISE EXCEPTION 'FALHOU T09'; END IF;
 RAISE NOTICE 'T09 APROVADO - reconfirmacao foi bloqueada';

 -- Relogio simulado so para expirar a reserva B de forma deterministica.
 PERFORM ms.expirar_reserva(v_b, NOW()+INTERVAL '2 hours');
 SELECT * INTO v_s FROM ms.v_disponibilidade WHERE id_necessidade=1;
 IF v_s.quantidade_disponivel <> 80 OR v_s.quantidade_confirmada <> 20
    OR v_s.quantidade_reservada <> 0 THEN RAISE EXCEPTION 'FALHOU T10'; END IF;
 RAISE NOTICE 'T10 APROVADO - expiracao liberou 40; recebido continua 20';

 v_rejeitou := FALSE;
 BEGIN
  PERFORM ms.criar_reserva(1,1,-3,NOW()+INTERVAL '1 hour');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_mensagem = MESSAGE_TEXT;
  v_rejeitou := POSITION('positiva' IN v_mensagem)>0;
 END;
 IF NOT v_rejeitou THEN RAISE EXCEPTION 'FALHOU T11'; END IF;
 RAISE NOTICE 'T11 APROVADO - quantidade negativa recusada';

 v_rejeitou := FALSE;
 BEGIN
  PERFORM ms.cancelar_reserva(v_c,1);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_mensagem = MESSAGE_TEXT;
  v_rejeitou := POSITION('Estado nao permite cancelamento' IN v_mensagem)>0;
 END;
 IF NOT v_rejeitou THEN RAISE EXCEPTION 'FALHOU T12'; END IF;
 RAISE NOTICE 'T12 APROVADO - doacao confirmada nao pode ser cancelada';

 RAISE NOTICE 'EXP-BD-01 CONCLUIDO: 12 cenarios aprovados (transacao sera revertida).';
END;
$$;
ROLLBACK;
SELECT 'A base foi restaurada pelo ROLLBACK' AS verificacao,
       quantidade_solicitada, quantidade_reservada, quantidade_confirmada, quantidade_disponivel
FROM ms.v_disponibilidade WHERE id_necessidade=1;
