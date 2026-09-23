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
supabase/migrations/003_...  usuários (members) e login por senha
supabase/migrations/004_...  permissões da página Configurações
settings.js                   página Configurações
supabase/functions/admin-users   Edge Function de cadastro de usuários
supabase/seed.sql             dados importados do artefato
```

## Como funciona

- **Login com e-mail e senha.** Não envia e-mail nenhum (não precisa de SMTP).
- **Quem cadastra é o administrador**, pela página **Usuários** do próprio
  site: nome, e-mail e uma senha provisória (o sistema sugere uma). O
  administrador passa a senha para a pessoa, que pode trocá-la depois em
  **"senha"**, no topo da tela.
- **Esqueceu a senha?** O administrador clica em *redefinir senha*.
- **Desativar** bloqueia o login na hora; o histórico da pessoa continua.
- **Segurança**: só quem está cadastrado e ativo na tabela `members` lê ou
  grava dados (regra no banco). Criar/alterar usuários passa pela Edge
  Function `admin-users`, que confere se quem pede é administrador.
- **Tempo real**: uma contagem feita em um computador aparece nos outros em
  cerca de 1 segundo.

---

## Configuração inicial (uma vez só)

### 1. Criar o primeiro administrador
Supabase > **Authentication** > **Users** > **Add user** > **Create new user**:
- E-mail: `rafael.veiber@wap.ind.br`
- Senha: a sua (mínimo 8 caracteres)
- Marque **Auto Confirm User** > **Create user**

Esse e-mail vira administrador automaticamente (gatilho no banco). Depois é
só entrar no site e cadastrar os demais em **Usuários**.

### 2. Fechar o cadastro público
Supabase > **Authentication** > **Sign In / Providers**: desligue
**Allow new users to sign up** e salve. (Mesmo ligado, quem se cadastrasse
sozinho não veria nada — mas assim ninguém cria conta por fora.)

### 3. Publicação
O site é publicado pelo GitHub Pages a partir da branch `main`
(`https://wap-people.github.io/facilities.estoque/`). Cada `git push`
republica em 1–2 minutos.

---

## Configurações (só administradores)

Menu **Configurações**, com as abas:

- **Catálogo** — editar qualquer campo de um item (inclusive o código; as
  contagens acompanham), excluir item (apaga também as contagens dele),
  renomear/juntar categorias e exportar o catálogo em planilha.
- **Copiar catálogo** — copia os itens de uma unidade para outras (com ou sem
  estoque de segurança e consumo médio; mantém ou sobrescreve os que já
  existem). Contagens não são copiadas.
- **Importar planilha** — Excel (.xlsx) ou CSV com as colunas Código,
  Descrição, Categoria, Unidade, Estoque de segurança e Consumo médio. Mostra
  uma prévia (novos, a atualizar, sem mudança, erros) antes de gravar. O
  botão *Baixar modelo* traz o formato; o *Exportar planilha* do Catálogo gera
  um arquivo no mesmo formato, bom para editar em massa e reimportar.
- **Unidades** — renomear, mudar a ordem e criar unidades novas.
- **Usuários** — cadastrar, redefinir senha, desativar e promover a admin.

Edições, exclusões, importações e cópias aparecem em "Últimas movimentações".

## Tarefas do dia a dia

**Publicar uma alteração**: edite, faça commit e push na `main`. Se mudar
`app.js`, `config.js` ou `styles.css`, aumente o `?v=` correspondente em
`index.html` para ninguém ficar com a versão antiga em cache.

**Backup / exportar**: Supabase > Table Editor > tabela > *Export to CSV*.

**Testar localmente**:
```bash
python -m http.server 5173
```
e abra `http://localhost:5173`.

**Banco do zero** (outro projeto Supabase): rode, no SQL Editor, os arquivos
de `supabase/migrations/` em ordem (001 a 004), depois `supabase/seed.sql`,
e publique a função `supabase/functions/admin-users`.

## Modelo de dados

| Tabela | Chave | Campos |
|---|---|---|
| `units` | `id` | `label`, `sort` — SM, AFP, SERRA, LINHARES, EUSEBIO |
| `products` | `unit_id` + `code` | `name`, `category`, `unit`, `min_stock` (estoque de segurança), `avg_consumption` (consumo médio mensal) |
| `counts` | `unit_id` + `code` + `month` (`AAAA-MM`) | `qty` (vazio = sem contagem), `updated_at`, `updated_by` |
| `activity` | `id` | `type` (`count`/`add`), `code`, `name`, `detail`, `month`, `actor_name`, `actor_email`, `created_at` |
| `members` | `user_id` | `email`, `full_name`, `is_admin`, `active` — quem tem acesso |

## Diferenças em relação ao artefato

- O login do Claude foi substituído por login com e-mail e senha, com usuários cadastrados pelo administrador.
- O botão **"Gerar análise" (IA)** foi removido por enquanto (exige chave paga
  da API da Anthropic; pode voltar via Supabase Edge Function).
- "Baixar CSV" agora baixa o arquivo direto no navegador.
- As 3 movimentações antigas aparecem como "Importado do artefato", porque o
  autor delas era um usuário do Claude.
