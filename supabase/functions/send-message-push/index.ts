// =================================================================
// Edge Function: send-message-push
// Supabase Edge Runtime (Deno) — отправка high-priority FCM data-пуша
// для обычного сообщения, чтобы разбудить приложение получателя
// в фоне и убрать задержку доставки (Android Doze / фоновый полинг).
//
// Поток:
//  1. Отправитель после INSERT сообщения вызывает эту функцию
//     (supabase.functions.invoke('send-message-push', ...)).
//  2. Функция проверяет JWT отправителя (только авторизованные).
//  3. Читает FCM-токен получателя из device_tokens через service_role
//     (обход RLS — клиент не может читать чужие токены).
//  4. Шлёт data-only push (БЕЗ объекта "notification" — иначе ОС
//     покажет стандартную шторку, а приложение не узнает о сообщении).
//
// Приватность: content сообщения E2EE-зашифрован и в пуш НЕ попадает —
// push несёт только метаданные (sender_id, sender_name, chat_id) и
// Generic-текст. Получатель видит «Новое сообщение», контент — только
// внутри приложения после дешифровки.
//
// Требуемые секреты (Supabase → Edge Functions → Secrets):
//  - FIREBASE_PROJECT_ID         (echo-mes)
//  - FIREBASE_ACCESS_TOKEN       (OAuth2-токен service account для FCM HTTP v1)
// =================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  // ── CORS preflight ──
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Отправитель обязан быть авторизован (JWT в Authorization).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => null);
    const {
      receiver_id,
      sender_id,
      sender_name,
      sender_avatar,
    } = body ?? {};

    if (!receiver_id || !sender_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: receiver_id, sender_id' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Аутентификация отправителя (живой запрос к GoTrue).
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service-role клиент — читаем токен получателя (обход RLS).
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: tokenRow, error: tokenErr } = await adminClient
      .from('device_tokens')
      .select('token')
      .eq('user_id', receiver_id)
      .maybeSingle();

    // Получатель не зарегистрировал токен — нечего слать, но не ошибка.
    if (tokenErr || !tokenRow?.token) {
      if (tokenErr) console.error('[send-message-push] device_tokens query error:', tokenErr);
      return new Response(
        JSON.stringify({ ok: true, skipped: 'no_device_token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const projectId =
      Deno.env.get('FIREBASE_PROJECT_ID') ?? 'echo-mes';
    const { getFcmAccessToken } = await import('../_shared/fcm.ts');
    let accessToken: string;
    try {
      accessToken = await getFcmAccessToken();
    } catch (e) {
      console.error('[send-message-push] FCM token source error:', e);
      return new Response(
        JSON.stringify({ error: 'Server misconfiguration (FCM OAuth)' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Firebase HTTP v1 API
    const endpoint =
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

    // Data-only push. Для DM chat получателя = ID отправителя (в чат-листе
    // DM-чат ключуется по id собеседника), чтобы тап открыл нужный чат.
    const message = {
      message: {
        token: tokenRow.token,
        data: {
          type: 'new_message',
          chat_id: String(sender_id),
          sender_id: String(sender_id),
          sender_name: String(sender_name ?? ''),
          sender_avatar: String(sender_avatar ?? ''),
          // ts позволяет клиенту отбросить устаревшие/дублированные пуши
          ts: String(Date.now()),
        },
        android: {
          // максимальный приоритет — мгновенное пробуждение из сна
          priority: 'high',
          // без TTL-накопления: доставляется/отбрасывается сразу
          ttl: '0s',
        },
      },
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[send-message-push] FCM error:', res.status, text.slice(0, 500));
      return new Response(
        JSON.stringify({ error: 'FCM send failed', detail: text.slice(0, 500) }),
        {
          status: res.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const result = await res.json();
    return new Response(
      JSON.stringify({ ok: true, name: result?.name ?? null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[send-message-push] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

