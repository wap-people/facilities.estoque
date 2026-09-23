// Configuração do Supabase.
// Estes dois valores são PÚBLICOS por natureza (ficam no navegador de todo mundo);
// quem protege os dados são as regras de segurança (RLS) do banco, criadas em
// supabase/migrations/001_schema.sql. NUNCA coloque aqui a chave "service_role".
//
// Onde encontrar: Supabase > seu projeto > Project Settings > API
//   - Project URL          -> SUPABASE_URL
//   - anon / public key    -> SUPABASE_ANON_KEY
window.APP_CONFIG = {
  SUPABASE_URL: 'COLE_AQUI_A_PROJECT_URL',
  SUPABASE_ANON_KEY: 'COLE_AQUI_A_ANON_KEY',
  // Domínios de e-mail aceitos na tela de login (a trava real está no banco,
  // na tabela public.allowed_domains).
  ALLOWED_DOMAINS: ['wap.ind.br'],
};
