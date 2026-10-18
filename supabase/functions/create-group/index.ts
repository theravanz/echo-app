import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Лимит обычной группы (is_ultra_private = false).
const STANDARD_GROUP_LIMIT = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EncryptedKeyPacket {
  user_id: string;
  encrypted_payload: string;
  nonce: string;
}

interface CreateGroupPayload {
  group_id: string;
  creator_id: string;
  encrypted_metadata: string;
  metadata_nonce: string;
  members: string[];
  encrypted_keys: EncryptedKeyPacket[];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}


Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    // ── 1. JWT-валидация: только авторизованный пользователь ──
    // Живой запрос к GoTrue (не локальный decode): токен не просрочен,
    // не отозван, подпись верна.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json(401, { error: 'Missing Authorization header' });
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json(401, { error: 'Invalid or expired session' });
    }

    // ── 2. Парсинг payload ──
    let payload: CreateGroupPayload;
    try {
      payload = await req.json() as CreateGroupPayload;
    } catch {
      return json(400, { error: 'Invalid JSON body' });
    }

    const { group_id, creator_id, encrypted_metadata, metadata_nonce, members, encrypted_keys } = payload;

    // ── 3. Авторство: создавать группу может только сам создатель ──
    if (!creator_id || creator_id !== user.id) {
      return json(403, { error: 'creator_id must match authenticated user' });
    }
    if (!UUID_RE.test(group_id ?? '')) {
      return json(400, { error: 'group_id must be a valid UUID' });
    }

    // ── 4. Лимит обычной группы → 400 ──
    if (!Array.isArray(members) || members.length === 0) {
      return json(400, { error: 'members must be a non-empty array of UUIDs' });
    }
    if (members.length > STANDARD_GROUP_LIMIT) {
      return json(400, {
        error: `Group member limit exceeded: ${members.length} > ${STANDARD_GROUP_LIMIT}`,
      });
    }
    if (!members.every((m) => typeof m === 'string' && UUID_RE.test(m))) {
      return json(400, { error: 'members must contain only valid UUIDs' });
    }
    if (!members.includes(user.id)) {
      return json(400, { error: 'creator must be included in members' });
    }
    if (new Set(members).size !== members.length) {
      return json(400, { error: 'members contains duplicates' });
    }
    // ── 5. Шифротекст метаданных: сервер не расшифровывает, но пустые
    // строки отвергаем как повреждённые пакеты ──
    if (!encrypted_metadata || !metadata_nonce) {
      return json(400, { error: 'encrypted_metadata and metadata_nonce must not be empty' });
    }

    // ── 6. Пакеты ключей: структура + инварианты ──
    if (!Array.isArray(encrypted_keys)) {
      return json(400, { error: 'encrypted_keys must be an array' });
    }
    for (const k of encrypted_keys) {
      if (!k || typeof k.user_id !== 'string' || !UUID_RE.test(k.user_id)) {
        return json(400, { error: 'encrypted_keys[].user_id must be a valid UUID' });
      }
      if (!k.encrypted_payload || !k.nonce) {
        return json(400, { error: 'encrypted_keys[].encrypted_payload and nonce must not be empty' });
      }
      if (!members.includes(k.user_id)) {
        return json(400, { error: `key recipient ${k.user_id} is not a group member` });
      }
      if (k.user_id === user.id) {
        return json(400, { error: 'key packet for creator is not allowed' });
      }
    }
    if (new Set(encrypted_keys.map((k) => k.user_id)).size !== encrypted_keys.length) {
      return json(400, { error: 'encrypted_keys contains duplicate recipients' });
    }

    // ── 7. Атомарная запись: один RPC-вызов = одна Postgres-транзакция ──
    // RPC вызывается USER-клиентом (с JWT): внутри create_group_atomic
    // auth.uid() резолвится в создателя, service_role не нужен вообще.
    // Параллельные массивы: user_ids / payloads / nonces одной длины.
    const { data: createdId, error: rpcErr } = await userClient.rpc('create_group_atomic', {
      p_group_id: group_id,
      p_encrypted_metadata: encrypted_metadata,
      p_metadata_nonce: metadata_nonce,
      p_is_ultra_private: false,
      p_member_ids: members,
      p_key_user_ids: encrypted_keys.map((k) => k.user_id),
      p_key_payloads: encrypted_keys.map((k) => k.encrypted_payload),
      p_key_nonces: encrypted_keys.map((k) => k.nonce),
    });

    if (rpcErr) {
      console.error('[create-group] rpc failed:', rpcErr);
      const msg = String(rpcErr.message ?? '');
      // Нарушения инвариантов RPC (лимит, авторство, пакеты) → 400,
      // остальное (конфликт id, падение БД) → 500/409.
      if (
        msg.includes('limit exceeded') ||
        msg.includes('Not authenticated') ||
        msg.includes('must not be empty') ||
        msg.includes('not a group member') ||
        msg.includes('for creator is not allowed') ||
        msg.includes('must be included in members') ||
        msg.includes('length mismatch') ||
        msg.includes('Ultra-private')
      ) {
        return json(400, { error: msg });
      }
      if (msg.includes('duplicate key') || msg.includes('already exists')) {
        return json(409, { error: 'Group already exists' });
      }
      return json(500, { error: 'Failed to create group' });
    }

    return json(201, { group_id: createdId ?? group_id });
  } catch (err) {
    console.error('[create-group] Unexpected error:', err);
    return json(500, { error: 'Internal error' });
  }
});

