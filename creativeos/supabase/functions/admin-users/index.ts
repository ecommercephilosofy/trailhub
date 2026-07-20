// Edge Function `admin-users` — alta/baja de usuarios desde la página Admin.
// Solo ADMIN. Usa el service role (el cliente no puede llamar a la API admin).
//   invite: crea el usuario + perfil y devuelve un action_link de invitación
//           (para copiar/enviar por WhatsApp — el email de Supabase a veces
//           lo consume el escáner de links del correo).
//   delete: borra usuario + perfil (las tarjetas asignadas quedan sin editor).
//
// Deploy: supabase functions deploy admin-users
import { createClient } from "jsr:@supabase/supabase-js@2";

// CORS: solo la app (SITE_URL) y desarrollo local — antes era "*".
const ALLOWED_ORIGINS = [
  Deno.env.get("SITE_URL") || "https://creativeos-murex-three.vercel.app",
  "http://localhost:5173",
];

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { action, email, name, role, user_id } = await req.json();

    const authed = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user } } = await authed.auth.getUser();
    if (!user) return Response.json({ error: "sin sesión" }, { status: 401, headers: cors });

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: me } = await service.from("profiles")
      .select("custom_role").eq("user_id", user.id).maybeSingle();
    if (me?.custom_role !== "ADMIN") {
      return Response.json({ error: "solo ADMIN" }, { status: 403, headers: cors });
    }

    const site = Deno.env.get("SITE_URL") || "https://creativeos-murex-three.vercel.app";

    if (action === "invite") {
      if (!email?.includes("@")) return Response.json({ error: "email inválido" }, { status: 400, headers: cors });
      // ¿Existe ya? → solo generar link de recovery (re-invitación)
      const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 });
      let target = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      const existed = !!target;
      if (!target) {
        const { data: created, error } = await service.auth.admin.createUser({
          email, email_confirm: true,
          password: crypto.randomUUID() + "Aa1!",
        });
        if (error) throw error;
        target = created.user;
      }
      // El rol solo se fija al CREAR el usuario (el trigger handle_new_user dejó el
      // profile en VIEWER). En una re-invitación NO se toca el rol: los cambios de
      // rol van por /Admin (setRole) — así una re-invitación no puede degradar al
      // último ADMIN a EDITOR y dejar el sistema sin admin.
      const profileRow: Record<string, unknown> = {
        user_id: target!.id, email, name: name || email.split("@")[0],
      };
      if (!existed) {
        profileRow.custom_role = ["ADMIN", "MANAGER", "EDITOR", "VIEWER"].includes(role) ? role : "EDITOR";
      }
      const { error: upErr } = await service.from("profiles").upsert(profileRow);
      if (upErr) throw upErr;
      const { data: link, error: linkErr } = await service.auth.admin.generateLink({
        type: "recovery", email, options: { redirectTo: site },
      });
      if (linkErr) throw linkErr;
      return Response.json({
        ok: true, user_id: target!.id,
        action_link: link.properties?.action_link,
      }, { headers: cors });
    }

    if (action === "delete") {
      if (!user_id) return Response.json({ error: "falta user_id" }, { status: 400, headers: cors });
      if (user_id === user.id) return Response.json({ error: "no puedes borrarte a ti mismo" }, { status: 400, headers: cors });
      // Guard: nunca dejar el sistema sin ADMIN (borrar al último = lockout total)
      const { data: target } = await service.from("profiles")
        .select("custom_role").eq("user_id", user_id).maybeSingle();
      if (target?.custom_role === "ADMIN") {
        const { count } = await service.from("profiles")
          .select("user_id", { count: "exact", head: true }).eq("custom_role", "ADMIN");
        if ((count ?? 0) <= 1) {
          return Response.json({ error: "no puedes borrar al último ADMIN" }, { status: 400, headers: cors });
        }
      }
      // Con las FKs en ON DELETE SET NULL (migración 002) el borrado del profile
      // ya no falla por bonus/anotaciones/run_requests. Comprobamos AMBOS errores:
      // antes se ignoraban y la función devolvía ok:true sin borrar nada.
      const { error: delProfErr } = await service.from("profiles").delete().eq("user_id", user_id);
      if (delProfErr) throw delProfErr;
      const { error: delUserErr } = await service.auth.admin.deleteUser(user_id);
      if (delUserErr) throw delUserErr;
      return Response.json({ ok: true }, { headers: cors });
    }

    return Response.json({ error: `acción desconocida: ${action}` }, { status: 400, headers: cors });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500, headers: cors });
  }
});
