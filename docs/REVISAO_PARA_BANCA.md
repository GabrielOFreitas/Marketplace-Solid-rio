# Revisão para banca — envio de 17/11/2026

## Resultado da auditoria do ZIP do Gabriel

**Decisão: publicável como protótipo experimental, com ressalvas de domínio; não como MVP completo.**

- 50 testes Node.js executados e aprovados, sem dependências para instalar.
- Separação de dados, estado, apresentação e testes.
- Filtros de mapa/itens, busca, notificações, reserva de estoque, expiração e cancelamento implementados em memória.
- 18 imagens da equipe incluídas em `docs/screenshots/`.
- 8 scripts PostgreSQL da experimentação do semestre incluídos em `experimentos/postgresql/sql/` (não integram o frontend).

## Lacunas críticas do MVP

1. `state.js:publishNeed` **não valida** instituição verificada nem identidade/perfil do usuário. Qualquer chamada com `institutionId` de uma instituição existente pode publicar (RN-002 não está garantida).
2. O fluxo principal do MVP (reservar quantidade de uma NECESSIDADE institucional, doador informa entrega, instituição confirma recebimento) **não está integrado ao frontend**. O frontend reserva itens OFERTADOS, e o QR simula retirada.
3. O front possui score e comprovante PJ/ESG exploratórios, não previstos no MVP. Não apresentar como funcionalidades homologadas ou documentos oficiais.
4. Necessidades do frontend não têm categoria, mas a estrutura PostgreSQL `ms.necessidade` exige `id_categoria`.
5. O mapa não usa API real; posições e distâncias são fixas no `data.js`.
6. Os testes Node.js são unitários/estruturais, não testes E2E em navegador ou de concorrência entre sessões reais.
7. A prova de conceito JavaScript de reservas de necessidades (`need-core.js` e testes) descrita anteriormente **não estava no ZIP atual**. Recuperá-la e publicá-la, se fizer parte do documento da banca.
8. A execução SQL local deve ser repetida pelo grupo para produzir evidência publicada.
9. A consulta pública ao repositório antigo `GabrielOFreitas/Marketplace-Solid-rio` não foi acessível durante esta auditoria (404). Verificar nome, visibilidade, permissões e URL antes de atualizar os links da banca.

## Checklist de publicação

- [ ] Confirmar a URL pública atual do repositório e se Gabriel mantém acesso.
- [ ] Clonar o repositório original para preservar histórico. Criar branch de integração.
- [ ] Copiar os arquivos **deste pacote** para o clone (exceto `.git` do clone), conferindo diff antes do commit.
- [ ] Executar `npm.cmd test` (Windows) ou `npm test`; salvar resultado.
- [ ] Revisar README, prints e scripts SQL; não incluir dados sensíveis.
- [ ] Recuperar a PoC JavaScript institucional original e as evidências SQL reais, se disponíveis.
- [ ] Publicar branch, revisar Pull Request, mesclar a `main`.
- [ ] Abrir o link em janela anônima e confirmar acesso ao código, prints e instruções.
- [ ] Atualizar slides para **50 testes do frontend atual**, distinguindo-os dos **43 do pacote experimental da fase anterior** e dos **12 cenários SQL**.

## Comparação com pacote anterior

No ZIP anterior `Marketplace-Solid-rio-main.zip` havia 30 testes originais. No ZIP atual, 50; houve ampliação de `state.js`, `ui.js`, `style.css`, filtros de mapa, categorias e notificações. Os 12 testes de `need-core` usados na documentação de Fase 03 não fazem parte dos 50 atuais.
