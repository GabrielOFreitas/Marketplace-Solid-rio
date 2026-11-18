-- Base nova de demonstracao, sem dados de pessoas/instituicoes reais.
-- IDs estaveis utilizados nos testes; execute apenas no banco recem-criado.
INSERT INTO ms.usuario (id_usuario, nome, email, tipo_usuario) VALUES
 (1, 'Doador Exemplo Um', 'doador1@example.invalid', 'DOADOR'),
 (2, 'Doador Exemplo Dois', 'doador2@example.invalid', 'DOADOR'),
 (3, 'Membro Exemplo', 'membro@example.invalid', 'INSTITUCIONAL'),
 (4, 'Admin Exemplo', 'admin@example.invalid', 'ADMINISTRADOR');

INSERT INTO ms.instituicao (id_instituicao, nome, status, descricao)
VALUES (1, 'Instituicao Ficticia para Testes', 'APROVADA', 'Registro ficticio sem CNPJ real');

INSERT INTO ms.membro_instituicao (id_membro, id_usuario, id_instituicao, papel)
VALUES (1, 3, 1, 'ADMIN_INSTITUCIONAL');

INSERT INTO ms.verificacao_instituicao
 (id_verificacao, id_instituicao, status_verificacao, data_analise, responsavel_analise)
VALUES (1, 1, 'APROVADA', NOW(), 4);

INSERT INTO ms.categoria (id_categoria, nome, descricao)
VALUES (1, 'Higiene', 'Produtos de higiene pessoal');

INSERT INTO ms.necessidade
 (id_necessidade, id_instituicao, id_categoria, titulo,
  quantidade_solicitada, unidade_medida, nivel_urgencia)
VALUES (1, 1, 1, 'Sabonetes para doacao', 100, 'unidades', 'ALTA');

INSERT INTO ms.localizacao (id_localizacao, id_instituicao, cidade, estado, nivel_visibilidade)
VALUES (1, 1, 'Anapolis', 'GO', 'APROXIMADA');

-- Atualiza sequencias de tabelas com IDs explicitos, para futuras inclusoes automaticas.
SELECT setval(pg_get_serial_sequence('ms.usuario', 'id_usuario'), 4, TRUE);
SELECT setval(pg_get_serial_sequence('ms.instituicao', 'id_instituicao'), 1, TRUE);
SELECT setval(pg_get_serial_sequence('ms.membro_instituicao', 'id_membro'), 1, TRUE);
SELECT setval(pg_get_serial_sequence('ms.verificacao_instituicao', 'id_verificacao'), 1, TRUE);
SELECT setval(pg_get_serial_sequence('ms.categoria', 'id_categoria'), 1, TRUE);
SELECT setval(pg_get_serial_sequence('ms.necessidade', 'id_necessidade'), 1, TRUE);
SELECT setval(pg_get_serial_sequence('ms.localizacao', 'id_localizacao'), 1, TRUE);

SELECT * FROM ms.v_disponibilidade WHERE id_necessidade = 1;
