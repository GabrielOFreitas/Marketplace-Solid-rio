# EXP-JS-02 — Reserva sobre NECESSIDADE institucional

Este experimento é uma **prova de conceito isolada** criada para a Fase 03, construída a partir do repositório entregue por Gabriel. Não altera o fluxo visual original de oferta/retirada nem é integrado a PostgreSQL.

A interface original reserva estoque de um ponto de retirada. Este experimento demonstra o fluxo distinto do MVP: uma instituição verificada publica uma necessidade, um doador reserva parte da demanda, informa entrega e a instituição confirma o recebimento.

## Execução
Na raiz do repositório: `npm test` (Node >= 18). Os 12 testes EXP-JS-01 até EXP-JS-12 deste diretório são executados junto dos testes de Gabriel.

## Regras investigadas
`Disponível = solicitado - reservado_ativo - confirmado`; reserva acima do saldo é recusada; cancelamento e expiração liberam saldo; entrega não equivale à confirmação; confirmação exige vínculo institucional simulado e converte a quantidade de reservada para confirmada, sem alterar artificialmente o disponível.

## Limitações
Estado exclusivamente em memória; perfis e vínculo institucional simulados; relógio injetável; não testa concorrência entre usuários nem integridade transacional do PostgreSQL; não é um backend. Deve ser estudado e reproduzido pela equipe antes de ser apresentado à banca como evidência acadêmica.
