// Configuração do Supabase.
// Estes dois valores são PÚBLICOS por natureza (ficam no navegador de todo mundo);
// quem protege os dados são as regras de segurança (RLS) do banco, criadas em
// supabase/migrations/001_schema.sql. NUNCA coloque aqui a chave "service_role".
//
// Onde encontrar: Supabase > seu projeto > Project Settings > API
//   - Project URL          -> SUPABASE_URL
//   - anon / public key    -> SUPABASE_ANON_KEY
window.APP_CONFIG = {
  SUPABASE_URL: 'https://jlvqqiwshtitockjoksr.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsdnFxaXdzaHRpdG9ja2pva3NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNzgwNTAsImV4cCI6MjEwNTc1NDA1MH0.uEOWhGE5piT6dAZoLr05jH3TGG9mj2MQz7qc574cDIY',
};
