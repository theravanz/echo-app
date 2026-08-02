// =================================================================
// Edge Function: send-call-push
// Supabase Edge Runtime (Deno) — отправка высокоприоритетного
// DATA-пуша в Firebase Cloud Messaging (HTTP v1 API) для пробуждения
// Rust-бэкенда Tauri на Android из глубокого сна.
//
// ВАЖНО (защита №1): пуш СТРОГО data-only. Объект "notification"
// КАТЕГОРИЧЕСКИ запрещён — иначе ОС покажет стандартную шторку,
// и Rust не сможет сам решить, показывать ли экран входящего звонка.
// android.priority: "high" + ttl: "0s" дают мгновенную доставку.
// =================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // ── CORS preflight ──
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => null);
    const {
      target_fcm_token,
      room_id,
      caller_id,
      caller_name,
      caller_avatar,
    } = body ?? {};

    if (!target_fcm_token || !room_id || !caller_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const projectId =
      Deno.env.get("FIREBASE_PROJECT_ID") ??
      Deno.env.get("VITE_FIREBASE_PROJECT_ID") ??
      Deno.env.get("NEXT_PUBLIC_FIREBASE_PROJECT_ID") ??
      "";
    const accessToken = Deno.env.get("FIREBASE_ACCESS_TOKEN");

    if (!projectId || !accessToken) {
      console.error(
        "[send-call-push] Missing FIREBASE_PROJECT_ID or FIREBASE_ACCESS_TOKEN",
      );
      return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Firebase HTTP v1 API
    const endpoint =
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
        projectId,
      )}/messages:send`;

    // Чистое DATA-сообщение. Без "notification"! (см. шапку файла.)
    const message = {
      message: {
        token: target_fcm_token,
        data: {
          type: "incoming_call",
          room_id,
          caller_id,
          caller_name: String(caller_name ?? ""),
          caller_avatar: String(caller_avatar ?? ""),
          // ts позволяет Rust отбросить устаревшие/дублированные пуши
          ts: String(Date.now()),
        },
        android: {
          // максимальный приоритет — мгновенное пробуждение из сна
          priority: "high",
          // без TTL-накопления: квитируется или отбрасывается сразу
          ttl: "0s",
        },
      },
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(
        "[send-call-push] FCM error:",
        res.status,
        text.slice(0, 500),
      );
      return new Response(
        JSON.stringify({ error: "FCM send failed", detail: text.slice(0, 500) }),
        {
          status: res.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const result = await res.json();
    return new Response(
      JSON.stringify({ ok: true, name: result?.name ?? null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[send-call-push] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
