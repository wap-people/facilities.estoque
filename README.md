# WAP | Estoque Facilities

Controle de estoque de Facilities da Wap (catálogo por unidade, contagem mensal,
cobertura, pedido de compra e painel geral), com dados compartilhados em tempo
real entre todos os usuários via **Supabase**, hospedado no **GitHub Pages**.

Migrado do artefato Claude "WAP | Estoque Facilities" — com os mesmos dados
(68 itens da unidade SM, contagens de setembro/2026 e as movimentações).

```
index.html                    telas (login, painel, estoque, modais)
styles.css                    visual (idêntico ao artefato)
app.js                        lógica do app + acesso ao Supabase
config.js                     URL e chave pública do Supabase
supabase/migrations/001_schema.sql   tabelas, segurança (RLS) e tempo real
supabase/seed.sql             dados importados do artefato
```

## Como funciona

- **Login por e-mail (link mágico)**: a pessoa digita o e-mail `@wap.ind.br`,
  recebe um link e entra. No primeiro acesso informa o nome, que aparece em
  "Últimas movimentações".
- **Segurança**: só e-mails dos domínios da tabela `allowed_domains` leem ou
  gravam dados (regra aplicada no banco, não só na tela). Ninguém apaga dados
  pelo site.
- **Tempo real**: uma contagem feita em um computador aparece nos outros em
  cerca de 1 segundo.

---

## Configuração (uma vez só)

### 1. Banco de dados
No Supabase > **SQL Editor** > *New query*: cole e rode o conteúdo de
`supabase/migrations/001_schema.sql`, depois `002_private_is_allowed_user.sql`
e por fim `supabase/seed.sql`. ✅ **Já feito** no projeto `jlvqqiwshtitockjoksr`. (Se o Claude estiver com o conector do Supabase, ele faz
isso por você.)

### 2. Login por e-mail
Supabase > **Authentication** > **URL Configuration**:
- **Site URL**: `https://wap-people.github.io/facilities.estoque/`
- **Redirect URLs** > *Add URL*: `https://wap-people.github.io/facilities.estoque/**`
  (e, se for testar localmente, `http://localhost:5173/**`)

Supabase > **Authentication** > **Sign In / Providers** > **Email**: deixe
*Enable Email provider* ligado. *Confirm email* pode ficar ligado.

> ⚠️ **Limite de e-mails**: o servidor de e-mail gratuito do Supabase envia
> só **poucos e-mails por hora** (é para testes). Com várias pessoas usando,
> configure um SMTP próprio em **Authentication > Emails > SMTP Settings**
> (ex.: o SMTP do Microsoft 365 da empresa, Resend, SendGrid ou Brevo). Depois
> de logada, a pessoa continua logada naquele navegador e não precisa de novo
> e-mail.

Opcional: em **Authentication > Emails > Templates > Magic Link**, traduza o
e-mail para português.

### 3. Chaves no site ✅ já preenchidas
Supabase > **Project Settings** > **API Keys** (ou **Data API**): copie a
**Project URL** e a chave **anon / public** e cole em `config.js`. Essa chave é
pública por natureza — **nunca** use a `service_role` / `secret`.

### 4. Publicar no GitHub Pages
GitHub > repositório `wap-people/facilities.estoque` > **Settings** > **Pages**:
- *Source*: **Deploy from a branch**
- *Branch*: `main` / `/ (root)` > **Save**

Em 1–2 minutos o site fica em
`https://wap-people.github.io/facilities.estoque/`. Cada `git push` na `main`
republica automaticamente.

> GitHub Pages com repositório **privado** exige plano pago da organização
> (Team/Enterprise). Com repositório privado sem esse plano, deixe-o público —
> o código não contém segredo, os dados ficam protegidos pelo login.

---

## Tarefas do dia a dia

**Liberar outro domínio de e-mail** (SQL Editor):
```sql
insert into public.allowed_domains (domain) values ('fresnomaq.com.br');
```
e adicione o domínio também em `ALLOWED_DOMAINS` no `config.js`.

**Tirar o acesso de alguém**: Supabase > Authentication > Users > ⋯ > *Delete user*
(ou *Ban*).

**Backup / exportar**: Supabase > Table Editor > tabela > *Export to CSV*.

**Publicar uma alteração**: edite, faça commit e push na `main`. Se mudar `app.js`, `config.js` ou `styles.css`, aumente o `?v=` correspondente em `index.html` para ninguém ficar com a versão antiga em cache.

**Testar localmente**:
```bash
python -m http.server 5173
```
e abra `http://localhost:5173`.

## Modelo de dados

| Tabela | Chave | Campos |
|---|---|---|
| `units` | `id` | `label`, `sort` — SM, AFP, SERRA, LINHARES, EUSEBIO |
| `products` | `unit_id` + `code` | `name`, `category`, `unit`, `min_stock` (estoque de segurança), `avg_consumption` (consumo médio mensal) |
| `counts` | `unit_id` + `code` + `month` (`AAAA-MM`) | `qty` (vazio = sem contagem), `updated_at`, `updated_by` |
| `activity` | `id` | `type` (`count`/`add`), `code`, `name`, `detail`, `month`, `actor_name`, `actor_email`, `created_at` |
| `allowed_domains` | `domain` | domínios de e-mail com acesso |

## Diferenças em relação ao artefato

- O login do Claude foi substituído pelo login por e-mail do Supabase.
- O botão **"Gerar análise" (IA)** foi removido por enquanto (exige chave paga
  da API da Anthropic; pode voltar via Supabase Edge Function).
- "Baixar CSV" agora baixa o arquivo direto no navegador.
- As 3 movimentações antigas aparecem como "Importado do artefato", porque o
  autor delas era um usuário do Claude.
