// Edge Function "admin-users": cadastro e gestão de usuários do Estoque Facilities.
// Só administradores ativos (public.members.is_admin) podem chamar.
// Ações (POST JSON):
//   { action: "create", email, password, full_name, is_admin }
//   { action: "update", user_id, full_name?, is_admin?, active?, password? }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // quem está chamando?
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return json({ error: "Sessão inválida. Entre novamente." }, 401);
  const callerId = caller.user.id;

  const { data: me } = await admin.from("members").select("is_admin, active").eq("user_id", callerId).maybeSingle();
  if (!me || !me.active || !me.is_admin) return json({ error: "Apenas administradores podem gerenciar usuários." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Requisição inválida." }, 400); }

  if (body.action === "create") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const fullName = String(body.full_name || "").trim();
    const isAdmin = body.is_admin === true;
    if (!EMAIL_RE.test(email)) return json({ error: "E-mail inválido." }, 400);
    if (!fullName) return json({ error: "Informe o nome." }, 400);
    if (password.length < 8) return json({ error: "A senha precisa ter pelo menos 8 caracteres." }, 400);

    const { data: created, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (error || !created?.user) {
      const msg = /already|registered|exists/i.test(error?.message || "")
        ? "Já existe um usuário com este e-mail."
        : ("Não foi possível criar o usuário: " + (error?.message || "erro"));
      return json({ error: msg }, 400);
    }
    const { error: mErr } = await admin.from("members").upsert({
      user_id: created.user.id, email, full_name: fullName, is_admin: isAdmin, active: true, created_by: callerId,
    });
    if (mErr) return json({ error: "Usuário criado, mas falhou ao registrar o acesso: " + mErr.message }, 500);
    return json({ ok: true, user_id: created.user.id });
  }

  if (body.action === "update") {
    const userId = String(body.user_id || "");
    if (!userId) return json({ error: "Usuário não informado." }, 400);
    const self = userId === callerId;
    if (self && (body.active === false || body.is_admin === false)) {
      return json({ error: "Você não pode desativar nem tirar o próprio acesso de administrador." }, 400);
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.full_name === "string" && body.full_name.trim()) patch.full_name = body.full_name.trim();
    if (typeof body.is_admin === "boolean") patch.is_admin = body.is_admin;
    if (typeof body.active === "boolean") patch.active = body.active;

    const authPatch: Record<string, unknown> = {};
    if (typeof body.password === "string" && body.password) {
      if (body.password.length < 8) return json({ error: "A senha precisa ter pelo menos 8 caracteres." }, 400);
      authPatch.password = body.password;
    }
    if (typeof body.active === "boolean") authPatch.ban_duration = body.active ? "none" : "876000h"; // desativado = bloqueado
    if (patch.full_name) authPatch.user_metadata = { full_name: patch.full_name };

    if (Object.keys(authPatch).length) {
      const { error } = await admin.auth.admin.updateUserById(userId, authPatch);
      if (error) return json({ error: "Não foi possível atualizar: " + error.message }, 400);
    }
    if (Object.keys(patch).length) {
      const { error } = await admin.from("members").update(patch).eq("user_id", userId);
      if (error) return json({ error: "Não foi possível atualizar: " + error.message }, 400);
    }
    return json({ ok: true });
  }

  return json({ error: "Ação desconhecida." }, 400);
});
