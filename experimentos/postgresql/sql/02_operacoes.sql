-- Funcoes de experimento: as chamadas devem ser realizadas via servidor confiavel na aplicacao futura.
-- Nesta PoC os IDs de usuario sao parametros didaticos: NAO constituem autenticacao real.
-- Padrao de bloqueio: sempre bloquear NECESSIDADE antes de modificar RESERVA/DOACAO.

CREATE OR REPLACE FUNCTION ms.criar_reserva(
  p_id_doador BIGINT, p_id_necessidade BIGINT,
  p_quantidade INTEGER, p_data_expiracao TIMESTAMPTZ
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_necessidade RECORD;
  v_reservadas INTEGER;
  v_disponivel INTEGER;
  v_id_doacao BIGINT;
  v_id_reserva BIGINT;
BEGIN
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser positiva';
  END IF;
  IF p_data_expiracao IS NULL OR p_data_expiracao <= NOW() THEN
    RAISE EXCEPTION 'Expiracao deve ser futura';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ms.usuario
    WHERE id_usuario = p_id_doador AND tipo_usuario = 'DOADOR' AND status = 'ATIVO'
  ) THEN
    RAISE EXCEPTION 'Doador inexistente ou inativo';
  END IF;

  -- SERIALIZA as reservas de uma mesma necessidade (inclusive sessoes concorrentes).
  SELECT n.id_instituicao, n.quantidade_solicitada, n.quantidade_confirmada,
         n.status, i.status AS status_instituicao
    INTO v_necessidade
    FROM ms.necessidade n JOIN ms.instituicao i
      ON i.id_instituicao = n.id_instituicao
   WHERE n.id_necessidade = p_id_necessidade
   FOR UPDATE OF n;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Necessidade inexistente';
  END IF;
  IF v_necessidade.status_instituicao <> 'APROVADA' THEN
    RAISE EXCEPTION 'Instituicao nao verificada ou suspensa';
  END IF;
  IF v_necessidade.status NOT IN ('ABERTA', 'PARCIALMENTE_ATENDIDA') THEN
    RAISE EXCEPTION 'Necessidade nao aceita novas reservas';
  END IF;

  SELECT COALESCE(SUM(r.quantidade_reservada), 0)::INTEGER INTO v_reservadas
    FROM ms.reserva r JOIN ms.doacao d ON d.id_doacao = r.id_doacao
   WHERE d.id_necessidade = p_id_necessidade
     AND r.status_reserva IN ('RESERVADA','ENTREGUE');
  v_disponivel := v_necessidade.quantidade_solicitada
                  - v_necessidade.quantidade_confirmada - v_reservadas;
  IF p_quantidade > v_disponivel THEN
    RAISE EXCEPTION 'Quantidade indisponivel: solicitado %, disponivel %',
                    p_quantidade, v_disponivel;
  END IF;

  INSERT INTO ms.doacao (id_usuario_doador, id_necessidade, quantidade, status_doacao)
  VALUES (p_id_doador, p_id_necessidade, p_quantidade, 'RESERVADA')
  RETURNING id_doacao INTO v_id_doacao;

  INSERT INTO ms.reserva (id_doacao, quantidade_reservada, data_expiracao, status_reserva)
  VALUES (v_id_doacao, p_quantidade, p_data_expiracao, 'RESERVADA')
  RETURNING id_reserva INTO v_id_reserva;

  RETURN v_id_reserva;
END;
$$;

CREATE OR REPLACE FUNCTION ms.cancelar_reserva(
 p_id_reserva BIGINT, p_id_doador BIGINT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_id_necessidade BIGINT; v_r RECORD;
BEGIN
  SELECT d.id_necessidade INTO v_id_necessidade
    FROM ms.reserva r JOIN ms.doacao d ON d.id_doacao = r.id_doacao
   WHERE r.id_reserva = p_id_reserva;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva inexistente'; END IF;
  PERFORM 1 FROM ms.necessidade WHERE id_necessidade = v_id_necessidade FOR UPDATE;
  SELECT r.id_doacao, r.status_reserva, d.id_usuario_doador INTO v_r
    FROM ms.reserva r JOIN ms.doacao d ON d.id_doacao = r.id_doacao
   WHERE r.id_reserva = p_id_reserva FOR UPDATE OF r, d;
  IF v_r.id_usuario_doador <> p_id_doador THEN
    RAISE EXCEPTION 'Doador nao autorizado';
  END IF;
  IF v_r.status_reserva <> 'RESERVADA' THEN
    RAISE EXCEPTION 'Estado nao permite cancelamento';
  END IF;
  UPDATE ms.reserva SET status_reserva = 'CANCELADA' WHERE id_reserva = p_id_reserva;
  UPDATE ms.doacao SET status_doacao = 'CANCELADA', data_atualizacao = NOW()
   WHERE id_doacao = v_r.id_doacao;
END;
$$;

CREATE OR REPLACE FUNCTION ms.informar_entrega(
 p_id_reserva BIGINT, p_id_doador BIGINT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_id_necessidade BIGINT; v_r RECORD;
BEGIN
  SELECT d.id_necessidade INTO v_id_necessidade
    FROM ms.reserva r JOIN ms.doacao d ON d.id_doacao = r.id_doacao
   WHERE r.id_reserva = p_id_reserva;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva inexistente'; END IF;
  PERFORM 1 FROM ms.necessidade WHERE id_necessidade = v_id_necessidade FOR UPDATE;
  SELECT r.id_doacao, r.status_reserva, r.data_expiracao, d.id_usuario_doador INTO v_r
    FROM ms.reserva r JOIN ms.doacao d ON d.id_doacao = r.id_doacao
   WHERE r.id_reserva = p_id_reserva FOR UPDATE OF r, d;
  IF v_r.id_usuario_doador <> p_id_doador THEN
    RAISE EXCEPTION 'Doador nao autorizado';
  END IF;
  IF v_r.status_reserva <> 'RESERVADA' THEN
    RAISE EXCEPTION 'Estado nao permite informar entrega';
  END IF;
  IF v_r.data_expiracao <= NOW() THEN
    RAISE EXCEPTION 'Reserva com prazo vencido; execute a expiracao';
  END IF;
  UPDATE ms.reserva SET status_reserva = 'ENTREGUE' WHERE id_reserva = p_id_reserva;
  UPDATE ms.doacao SET status_doacao = 'ENTREGUE', data_atualizacao = NOW()
   WHERE id_doacao = v_r.id_doacao;
  INSERT INTO ms.entrega (id_doacao, status_entrega, data_marcacao_doador)
  VALUES (v_r.id_doacao, 'INFORMADA', NOW());
END;
$$;

CREATE OR REPLACE FUNCTION ms.confirmar_recebimento(
 p_id_reserva BIGINT, p_id_membro BIGINT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_id_necessidade BIGINT; v_id_instituicao BIGINT; v_r RECORD;
BEGIN
  SELECT d.id_necessidade INTO v_id_necessidade
    FROM ms.reserva r JOIN ms.doacao d ON d.id_doacao = r.id_doacao
   WHERE r.id_reserva = p_id_reserva;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva inexistente'; END IF;
  SELECT id_instituicao INTO v_id_instituicao FROM ms.necessidade
   WHERE id_necessidade = v_id_necessidade FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM ms.membro_instituicao mi
    JOIN ms.usuario u ON u.id_usuario = mi.id_usuario
    JOIN ms.instituicao i ON i.id_instituicao = mi.id_instituicao
    WHERE mi.id_usuario = p_id_membro AND mi.id_instituicao = v_id_instituicao
      AND mi.status = 'ATIVO' AND u.status = 'ATIVO'
      AND u.tipo_usuario = 'INSTITUCIONAL' AND i.status = 'APROVADA'
  ) THEN RAISE EXCEPTION 'Membro institucional nao autorizado'; END IF;
  SELECT r.id_doacao, r.quantidade_reservada, r.status_reserva INTO v_r
    FROM ms.reserva r JOIN ms.doacao d ON d.id_doacao = r.id_doacao
   WHERE r.id_reserva = p_id_reserva FOR UPDATE OF r, d;
  IF v_r.status_reserva <> 'ENTREGUE' THEN
    RAISE EXCEPTION 'Confirmacao exige entrega informada';
  END IF;
  UPDATE ms.reserva SET status_reserva = 'CONFIRMADA'
   WHERE id_reserva = p_id_reserva;
  UPDATE ms.doacao SET status_doacao = 'CONFIRMADA', data_atualizacao = NOW()
   WHERE id_doacao = v_r.id_doacao;
  UPDATE ms.entrega SET status_entrega = 'CONFIRMADA',
    data_confirmacao_instituicao = NOW()
   WHERE id_doacao = v_r.id_doacao;
  UPDATE ms.necessidade
     SET quantidade_confirmada = quantidade_confirmada + v_r.quantidade_reservada,
         status = CASE
           WHEN quantidade_confirmada + v_r.quantidade_reservada >= quantidade_solicitada
             THEN 'ATENDIDA'
           ELSE 'PARCIALMENTE_ATENDIDA'
         END
   WHERE id_necessidade = v_id_necessidade;
END;
$$;

CREATE OR REPLACE FUNCTION ms.expirar_reserva(
 p_id_reserva BIGINT, p_agora TIMESTAMPTZ DEFAULT NOW()
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_id_necessidade BIGINT; v_r RECORD;
BEGIN
  SELECT d.id_necessidade INTO v_id_necessidade
    FROM ms.reserva r JOIN ms.doacao d ON d.id_doacao = r.id_doacao
   WHERE r.id_reserva = p_id_reserva;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva inexistente'; END IF;
  PERFORM 1 FROM ms.necessidade WHERE id_necessidade = v_id_necessidade FOR UPDATE;
  SELECT r.id_doacao, r.status_reserva, r.data_expiracao INTO v_r
    FROM ms.reserva r JOIN ms.doacao d ON d.id_doacao = r.id_doacao
   WHERE r.id_reserva = p_id_reserva FOR UPDATE OF r, d;
  IF v_r.status_reserva <> 'RESERVADA' THEN
    RAISE EXCEPTION 'Apenas reservas pendentes podem expirar';
  END IF;
  IF p_agora < v_r.data_expiracao THEN
    RAISE EXCEPTION 'Reserva ainda nao venceu';
  END IF;
  UPDATE ms.reserva SET status_reserva = 'EXPIRADA' WHERE id_reserva = p_id_reserva;
  UPDATE ms.doacao SET status_doacao = 'EXPIRADA', data_atualizacao = NOW()
   WHERE id_doacao = v_r.id_doacao;
END;
$$;
