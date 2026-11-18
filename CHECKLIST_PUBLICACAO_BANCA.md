# Checklist de integração para banca (17/11/2026)

## Bases e origem

- **Frontend e 50 testes:** versão recente entregue por Gabriel (`marketplace-solidario.zip`).
- **README revisado, capturas atualizadas e PostgreSQL:** pacote de revisão anterior (`Marketplace_Solidario_Gabriel_Pacote_Para_GitHub.zip`).
- **PoC independente de necessidades + 12 testes:** `Marketplace_Solidario_Fase03_Revisado.zip`.
- **Scripts SQL de 00 a 07:** iguais ao ZIP `Marketplace_Solidario_PostgreSQL_PoC.zip` (a versão anterior 04 contém uma checagem extra antes do BEGIN; nesta integração mantivemos os scripts originais da PoC).

## Validado nesta integração

- `node --test` → **62 testes aprovados, 0 falhas**.
- `node --test tests/state.test.js tests/ui.test.js` → **50 frontend aprovados**.
- `node --test experimentos/reserva-necessidade/need-core.test.js` → **12 PoC de necessidades aprovados**.
- As 18 capturas de tela do Gabriel estão presentes em `docs/screenshots/`.
- Os 11 esquemas de tabelas da PoC PostgreSQL estão descritos nos scripts; **não houve execução de PostgreSQL nesta validação**.

## Pendente da equipe antes da publicação

- [ ] Anexar prints originais SQL: funções, testes T01–T12 e consulta de disponibilidade em `docs/evidencias/`.
- [ ] Executar as suítes acima na pasta exata que será enviada ao GitHub.
- [ ] Conferir que branch e README representam a versão publicada.
- [ ] Verificar repositório pela janela anônima e link do commit.
- [ ] Confirmar que não existem arquivos de segredo ou dados pessoais reais.
- [ ] Não apresentar a interface como integrada ao PostgreSQL ou ao fluxo de reserva de necessidades; não apresentar a RN-002 como garantida pela interface atual.
- [ ] Não afirmar testes reais de concorrência com múltiplas sessões sem tê-los executado.

## Ordem SQL em banco experimental novo

1. Conectado a `postgres`, execute `00_criar_banco.sql` (apenas se banco ainda não existe).
2. No novo `marketplace_solidario`, execute `01_estrutura.sql`, `02_operacoes.sql` e `03_dados_demonstracao.sql`.
3. Execute `04_testes_funcionais.sql`, verifique avisos e capturas de resultados.
4. Execute `07_inspecao.sql`.
5. `05_concorrencia_sessao_A.sql` e `06_concorrencia_sessao_B.sql` são opcionais, exigem duas sessões e gravam alterações: usar banco descartável.

## Relação com documento entregue

O documento acadêmico da Fase 03 registra um conjunto de **43 testes** da versão experimental anterior. Este pacote combina **50 frontend atualizados + 12 testes independentes do núcleo do MVP = 62**. São bases/versões diferentes; não substituir um número pelo outro sem explicar a evolução.
