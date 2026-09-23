# CLAUDE.md — WAP | Estoque Facilities

Contexto para o Claude Code em qualquer máquina. Leia também o `README.md`.
Responda ao usuário em **português do Brasil**; o público é de Facilities/RH, não
de TI, então explique em linguagem simples e peça confirmação antes de ações
destrutivas no banco.

## O que é

Site estático (HTML + JS puro, sem build, sem npm) de controle de estoque de
Facilities da Wap, por unidade (SM, AFP, SERRA, LINHARES, EUSEBIO…): catálogo,
contagem mensal, cobertura, pedido de compra, painel e página Configurações.
Migrado em 2026-09-23 de um artefato do Claude; o visual segue o do artefato.

- **Site**: https://wap-people.github.io/facilities.estoque/ (GitHub Pages,
  branch `main`, pasta raiz). Todo `git push` na `main` publica em 1–2 min.
- **Banco**: Supabase, projeto `jlvqqiwshtitockjoksr` (sa-east-1). Use o
  conector do Supabase (`apply_migration`, `execute_sql`, `get_advisors`…).

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | Todas as telas e modais. Referencia os assets com `?v=N`. |
| `styles.css` | Visual; cores em tokens no `:root`, com tema escuro. |
| `app.js` | Login, painel, estoque, pedido de compra, usuários, tempo real. Expõe `window.EstoqueApp` para o `settings.js`. |
| `settings.js` | Página Configurações (catálogo, copiar, importar planilha, unidades, aba Usuários). |
| `config.js` | URL e chave **anon** (pública) do Supabase. |
| `assets/` | Logos (preta/branca) e favicons. |
| `supabase/migrations/NNN_*.sql` | Histórico do schema, em ordem. |
| `supabase/functions/admin-users/` | Edge Function que cria/edita usuários (usa service role no servidor). |
| `supabase/seed.sql` | Dados originais do artefato (já aplicados). |

## Regras importantes

1. **Cache do GitHub Pages**: ao mudar `app.js`, `settings.js`, `config.js` ou
   `styles.css`, **aumente o `?v=`** correspondente em `index.html`. Sem isso,
   os usuários continuam com a versão antiga por até ~10 min.
2. **Mudança no banco = nova migração**: aplique com `apply_migration` **e**
   salve o mesmo SQL em `supabase/migrations/` com o próximo número
   (hoje o último é `004`). Depois rode `get_advisors` (security).
3. **Segurança (RLS)**: acesso = linha ativa em `public.members`
   (`private.is_allowed_user()`); admin = `private.is_admin()`. As funções de
   checagem ficam no schema `private` (fora da API). Excluir itens e criar
   unidades é só para admin. Nunca crie policy aberta para `anon`.
4. **Nunca** coloque a chave `service_role`/`secret` no código, em commits ou
   em mensagens. A chave de `config.js` é a anon, pública por natureza.
5. **Usuários** são criados pelo admin no próprio site (Configurações →
   Usuários → Edge Function `admin-users`). Não crie contas nem defina senhas
   pelo Claude; isso é feito pela pessoa no site ou no painel do Supabase.
6. **Dados reais**: o banco é de produção e é usado pela equipe. Para testar
   escrita, use transação com `rollback` ou peça confirmação antes.
7. **Git**: um hook em `.claude/settings.json` roda `git pull --ff-only`
   automaticamente ao abrir a sessão. Se ele avisar que falhou, resolva
   (commit/stash das alterações locais, depois `git pull --rebase`) antes de
   editar. Mais de uma pessoa trabalha no projeto; nunca use `push --force`.

## Modelo de dados (resumo)

- `units(id, label, sort)` — `id` em MAIÚSCULAS (`^[A-Z0-9_]{1,30}$`).
- `products(unit_id, code, name, category, unit, min_stock, avg_consumption)` — PK `(unit_id, code)`.
- `counts(unit_id, code, month 'AAAA-MM', qty, updated_at, updated_by)` — PK `(unit_id, code, month)`; FK para products com `on update/delete cascade`.
- `activity(type, code, name, detail, month, actor_*, created_at)` — tipos: `count`, `add`, `edit`, `delete`, `import`, `copy`.
- `members(user_id, email, full_name, is_admin, active)`.
- `allowed_domains` — legado, sem uso.
- Realtime ligado em `products`, `counts`, `activity`.

## Regras de negócio

- **Cobertura** = quantidade contada ÷ consumo médio mensal (em meses).
- **Crítico**: contado abaixo do estoque de segurança **ou** cobertura < 1 mês.
  **Atenção**: sem contagem ou cobertura < 2 meses. Senão, **saudável**.
- **Pedido de compra** = estoque de segurança − contado, para itens contados abaixo do mínimo (é calculado na tela, não é salvo).
- O seletor de mês vai do mês atual até dezembro do mesmo ano.

## Testar

- Local: `python -m http.server 5173` na pasta e abrir `http://localhost:5173`.
  O login usa o Supabase real.
- Sem login real: dá para simular com uma cópia de `index.html` que troque o
  `<script>` do supabase-js por um objeto falso `window.supabase`. **Não
  commite** esses arquivos de teste (`_mock-test.html` está no `.gitignore`).

## Pendências / próximos passos discutidos

- **Histórico** (menu "em breve"): linha do tempo filtrável de `activity` e
  gráfico por item. Falta registrar mudanças de segurança/consumo feitas na
  página Estoque.
- **Relatórios** (menu "em breve"): fechamento mensal por unidade e
  consolidado; exportar Excel/PDF. Para consumo real e custo faltam **pedidos
  de compra salvos (emitido → recebido)** e **preço por item**.
- A análise com IA do artefato foi removida (precisaria de chave da API
  Anthropic via Edge Function).
