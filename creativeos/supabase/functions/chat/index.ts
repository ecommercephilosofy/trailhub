// Edge Function `chat` — el cerebro Q&A dentro de CreativeOS.
// Mismo contexto que el bot de Telegram: el digest semanal que publica el
// pipeline en `chat_context`. Solo ADMIN/MANAGER (el rol se verifica aquí,
// no solo en la UI). Historial por usuario en `chat_messages` (RLS).
//
// Deploy:  supabase functions deploy chat
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 900;
const HISTORY_LIMIT = 12;

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
    const { message } = await req.json();
    if (!message?.trim()) {
      return Response.json({ error: "mensaje vacío" }, { status: 400, headers: cors });
    }

    // Usuario desde el JWT de la petición
    const authed = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user } } = await authed.auth.getUser();
    if (!user) return Response.json({ error: "sin sesión" }, { status: 401, headers: cors });

    // Rol (service client — bypassa RLS solo para leer el rol y el contexto)
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profile } = await service.from("profiles")
      .select("custom_role,name").eq("user_id", user.id).maybeSingle();
    if (!profile || !["ADMIN", "MANAGER"].includes(profile.custom_role)) {
      return Response.json({ error: "el chat es solo para dirección" }, { status: 403, headers: cors });
    }

    const { data: ctx } = await service.from("chat_context")
      .select("digest,week_date").eq("id", "main").maybeSingle();
    const { data: history } = await service.from("chat_messages")
      .select("role,content").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(HISTORY_LIMIT);

    const system = [
      "Eres el analista de adquisición pagada de Quies (dispositivo EMS anti-ronquidos, mercado hispano USAH/MX).",
      "Respondes al dueño/dirección en español, claro y directo, con cifras concretas del contexto.",
      "REGLAS: no inventes datos que no estén en el contexto; si falta el dato, dilo.",
      "La cuenta opera con CBO: las únicas palancas son pausar / clonar-iterar winners / zombie campaign. Nunca recomiendes 'subir budget a un ad'.",
      "",
      `## Contexto semanal (publicado ${ctx?.week_date ?? "?"})`,
      ctx?.digest ?? "(sin contexto publicado todavía — el pipeline lo sube cada lunes)",
    ].join("\n");

    const messages = [
      ...(history ?? []).reverse().map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      return Response.json({ error: `Anthropic ${resp.status}: ${detail.slice(0, 200)}` },
        { status: 502, headers: cors });
    }
    const data = await resp.json();
    const answer = (data.content ?? []).filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text).join("\n") || "(sin respuesta)";

    await service.from("chat_messages").insert([
      { user_id: user.id, role: "user", content: message },
      { user_id: user.id, role: "assistant", content: answer },
    ]);

    return Response.json({ answer }, { headers: cors });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors });
  }
});
