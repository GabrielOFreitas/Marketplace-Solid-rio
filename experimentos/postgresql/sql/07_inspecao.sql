-- Consultas simples para evidencias no pgAdmin.
-- 1) Quantidade de tabelas do modelo (esperado: 11; VIEW nao conta como tabela).
SELECT COUNT(*) AS total_tabelas
FROM information_schema.tables
WHERE table_schema='ms' AND table_type='BASE TABLE';

-- 2) Entidades criadas.
SELECT table_name AS entidade
FROM information_schema.tables
WHERE table_schema='ms' AND table_type='BASE TABLE'
ORDER BY table_name;

-- 3) Necessidade, total reservado, confirmado e saldo disponivel.
SELECT * FROM ms.v_disponibilidade ORDER BY id_necessidade;

-- 4) Relacionamento entre doadores, doacoes, reservas e instituicoes.
SELECT d.id_doacao, u.nome AS doador, i.nome AS instituicao,
       n.titulo AS necessidade, d.quantidade, d.status_doacao,
       r.status_reserva, r.data_expiracao
FROM ms.doacao d
JOIN ms.usuario u ON u.id_usuario = d.id_usuario_doador
JOIN ms.necessidade n ON n.id_necessidade = d.id_necessidade
JOIN ms.instituicao i ON i.id_instituicao = n.id_instituicao
JOIN ms.reserva r ON r.id_doacao = d.id_doacao
ORDER BY d.id_doacao;
