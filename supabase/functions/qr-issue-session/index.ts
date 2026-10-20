import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Клиент "от имени пользователя" — проверяем JWT мобилки живым запросом к GoTrue.
    // Это гарантирует, что токен не просрочен, не отозван и подпись верна —
    // надёжнее, чем локальный decode JWT.
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service-role клиент — ТОЛЬКО внутри Edge Function, ключ никогда не уходит наружу.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Email может отсутствовать у phone-аккаунтов. Для выдачи НЕЗАВИСИМОЙ
    // сессии второму устройству через generateLink({ type: 'magiclink' })
    // нужен email — поэтому phone-аккаунту проставляем детерминированный
    // shadow-email (один раз, идемпотентно) и выпускаем тикет уже на него.
    // Shadow-домен echo-qr.local никуда не доставляет письма: тикет
    // потребляется только через verifyOtp({ token_hash }) на втором
    // устройстве, отправка email не выполняется вообще.
    let ticketEmail = user.email;
    if (!ticketEmail) {
      const hexId = user.id.replace(/-/g, '').toLowerCase();
      ticketEmail = `u_${hexId}@echo-qr.local`;
      const { error: updErr } = await adminClient.auth.admin.updateUserById(user.id, {
        email: ticketEmail,
        email_confirm: true,
      });
      if (updErr) {
        console.error('[qr-issue-session] shadow email update failed:', updErr);
        return new Response(JSON.stringify({ error: 'Failed to prepare account for QR login' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: ticketEmail,
    });
    if (linkErr || !linkData) {
      console.error('[qr-issue-session] generateLink failed:', linkErr);
      return new Response(JSON.stringify({ error: 'Failed to issue session token' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Отдаём только token_hash + email тикета — не полный action_link
    // (там email как plaintext). Десктоп гасит тикет через
    // verifyOtp({ token_hash, type: 'email' }) и получает СВОЮ пару
    // access/refresh — независимую от сессии телефона.
    return new Response(
      JSON.stringify({
        token_hash: linkData.properties.hashed_token,
        email: ticketEmail,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[qr-issue-session] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});