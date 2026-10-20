"use client";

import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabase";
import { bytesToBase64, base64ToBytes, compressAvatar, encryptBlob } from "@/lib/media";

/**
 * Группы (Zero-Knowledge): клиентский криптопайплайн + вызов Edge Function.
 *
 * Сервер — «слепой» ретранслятор: Name/Bio и групповые сиды он видит только
 * в шифротексте. Вся криптография — в Rust (KeyStore, ключи не покидают backend):
 *   1. group_gen_seed → Group Master Seed (32B OsRng) + Info_Key
 *      (HKDF "echo/group/info") + Message_Key_0 (HKDF "echo/group/msg0").
 *   2. group_seal_metadata(info_key, metadata_json_b64) → encrypted_metadata.
 *   3. group_seal_key_packet(recipient_pub, seed, info_key, msg_key_0) × N →
 *      encrypted_keys[] для Edge Function (создателю пакет не нужен —
 *      контракт create-group отвергает пакет для creator 400).
 *   4. supabase.functions.invoke('create-group', { body }) → 201 { group_id }.
 */

export interface GroupSeedBundle {
  seed: string;
  info_key: string;
  msg_key_0: string;
}

export interface GroupSealedBox {
  ciphertext: string;
  nonce: string;
  eph_pub: string;
}

export interface GroupKeyPacket {
  user_id: string;
  encrypted_payload: string;
  nonce: string;
}

export interface GroupCreateInput {
  name: string;
  bio: string;
  memberIds: string[];
  avatarFile: File | null;
  /** Публичные X25519-ключи участников (base64), включая создателя. */
  memberPubkeys: Map<string, string>;
  /** id создателя (auth.uid). */
  creatorId: string;
  groupId?: string;
}

export interface GroupCreateResult {
  group_id: string;
  /** Локальная копия сида — сохранить в зашифрованное хранилище. */
  seed: GroupSeedBundle;
}

const TAG = "[GroupCreate]";

/** UTF-8 строка → base64 (для metadata_json перед group_seal_metadata). */
function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  return bytesToBase64(bytes);
}

/** Загрузить аватара группы: compressAvatar → encryptBlob → приватный bucket.
 *
 * ВАЖНО (RLS storage.objects, 0007): INSERT требует первый сегмент пути =
 * auth.uid() создателя, поэтому путь "<creatorId>/g_<groupId>/avatar-…enc".
 * Возвращает path + nonce — оба уходят в зашифрованные метаданные группы,
 * иначе SecureAvatar не расшифрует (AES-GCM конверт требует nonce).
 */
async function uploadGroupAvatar(
  creatorId: string,
  groupId: string,
  file: File,
): Promise<{ path: string; nonce: string }> {
  const compressed = await compressAvatar(file);
  const env = await encryptBlob(compressed);
  const path = `${creatorId}/g_${groupId}/avatar-${Date.now()}.enc`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(
      path,
      new Blob([base64ToBytes(env.data) as unknown as BlobPart], { type: "application/octet-stream" }),
      { upsert: true, contentType: "application/octet-stream" },
    );
  if (error) throw error;
  // Тот же формат ссылки, что у аватаров профиля: расшифровка через
  // SecureAvatar/SecureImage по (bucket, path, nonce, mime).
  return { path, nonce: env.nonce };
}


/**
 * Полный пайплайн создания обычной группы (is_ultra_private = false).
 *
 * Шаги:
 *  1. group_id (client-generated) + members (creator обязан входить).
 *  2. Аватар (если есть) → приватный bucket, path идёт в метаданные.
 *  3. group_gen_seed → seed/info_key/msg_key_0.
 *  4. group_seal_metadata(info_key, { name, bio, avatar_url }) →
 *     encrypted_metadata/metadata_nonce.
 *  5. Цикл по участникам (кроме создателя): публичный ключ из memberPubkeys
 *     (fallback — profiles.public_key) → group_seal_key_packet →
 *     encrypted_keys[].
 *  6. functions.invoke('create-group', { body }) → 201 / 400 / 409 / 500.
 *
 * Ошибки Edge Function маппятся в человекочитаемые сообщения (дизайн-система:
 * toast.error/toast.success на вызывающей стороне).
 */
export async function createStandardGroup(input: GroupCreateInput): Promise<GroupCreateResult> {
  const groupId = input.groupId ?? crypto.randomUUID();
  const name = input.name.trim();
  if (!name) throw new Error("Введите название группы");

  const members = Array.from(new Set(input.memberIds));
  if (!members.includes(input.creatorId)) members.unshift(input.creatorId);

  // 1. Аватар → приватный bucket (тот же конвейер, что у аватаров профиля:
  //    compressAvatar → encryptBlob/AES-256-GCM → upload .enc).
  //    nonce сохраняется в метаданные — без него SecureAvatar не расшифрует.
  let avatarPath = "";
  let avatarNonce = "";
  if (input.avatarFile) {
    try {
      const av = await uploadGroupAvatar(input.creatorId, groupId, input.avatarFile);
      avatarPath = av.path;
      avatarNonce = av.nonce;
    } catch (e) {
      throw new Error(`Не удалось загрузить фото группы: ${(e as Error)?.message ?? e}`);
    }
  }

  // 2. Group Master Seed + KDF (Rust, OsRng + HKDF-SHA256).
  let seed: GroupSeedBundle;
  try {
    seed = await invoke<GroupSeedBundle>("group_gen_seed");
  } catch (e) {
    throw new Error(`Не удалось сгенерировать ключи группы: ${(e as Error)?.message ?? e}`);
  }
  if (!seed?.seed || !seed?.info_key || !seed?.msg_key_0) {
    throw new Error("group_gen_seed вернул пустой бандл (E2EE-ключ не загружен?)");
  }

  // 3. Метаданные { name, bio, avatar_url, avatar_nonce } → Info_Key (XSalsa20-Poly1305).
  const metadataJson = JSON.stringify({
    name,
    bio: input.bio.trim(),
    avatar_url: avatarPath,
    avatar_nonce: avatarNonce,
  });
  let sealedMeta: GroupSealedBox;
  try {
    sealedMeta = await invoke<GroupSealedBox>("group_seal_metadata", {
      infoKeyB64: seed.info_key,
      metadataB64: utf8ToB64(metadataJson),
    });
  } catch (e) {
    throw new Error(`Не удалось зашифровать метаданные: ${(e as Error)?.message ?? e}`);
  }

  // 4. Пакеты ключей участникам (X25519 DH + SalsaBox, Rust KeyStore).
  //    Создателя пропускаем: сид сгенерирован на его устройстве, контракт
  //    create-group отвергает пакет для creator (400).
  const encryptedKeys: GroupKeyPacket[] = [];
  for (const memberId of members) {
    if (memberId === input.creatorId) continue;
    let pubkey = input.memberPubkeys.get(memberId) ?? null;
    if (!pubkey) {
      // Fallback: публичный ключ из метаданных профиля (как в use-e2ee).
      try {
        const { data } = await supabase
          .from("profiles")
          .select("public_key")
          .eq("id", memberId)
          .maybeSingle();
        pubkey = data?.public_key ?? null;
      } catch {
        pubkey = null;
      }
    }
    if (!pubkey) {
      throw new Error("Нет публичного ключа участника — invite невозможен");
    }
    try {
      const sealed = await invoke<GroupSealedBox>("group_seal_key_packet", {
        recipientPubkey: pubkey,
        seedB64: seed.seed,
        infoKeyB64: seed.info_key,
        msgKey0B64: seed.msg_key_0,
      });
      encryptedKeys.push({ user_id: memberId, encrypted_payload: sealed.ciphertext, nonce: sealed.nonce });
    } catch (e) {
      throw new Error(`Не удалось упаковать ключ для участника: ${(e as Error)?.message ?? e}`);
    }
  }

  // 5. Edge Function: атомарная запись (группа → участники → mailbox).
  const { data, error } = await supabase.functions.invoke("create-group", {
    body: {
      group_id: groupId,
      creator_id: input.creatorId,
      encrypted_metadata: sealedMeta.ciphertext,
      metadata_nonce: sealedMeta.nonce,
      members,
      encrypted_keys: encryptedKeys,
    },
  });

  if (error) {
    // supabase-js FunctionsError: status доступен как error.status / в контексте.
    const status = (error as { status?: number })?.status;
    const msg = String((error as Error)?.message ?? "");
    if (status === 400 || /limit exceeded|must|not a group member|duplicates|empty/i.test(msg)) {
      throw new Error(`Некорректные данные группы (400): ${msg || "проверьте участников и название"}`);
    }
    if (status === 409 || /already exists/i.test(msg)) {
      throw new Error("Группа с таким id уже существует (409) — попробуйте ещё раз");
    }
    throw new Error(`Не удалось создать группу${status ? ` (${status})` : ""}: ${msg || "ошибка сервера"}`);
  }

  return { group_id: (data as { group_id?: string } | null)?.group_id ?? groupId, seed };
  return { group_id: (data as { group_id?: string } | null)?.group_id ?? groupId, seed };
}

// ── Расшифровка (сторона получателя / список чатов) ─────────────────

/** Расшифровать пакет ключей из group_key_mailbox (Rust KeyStore, X25519 DH). */
export async function openGroupKeyPacket(
  senderPubB64: string,
  ciphertextB64: string,
  nonceB64: string,
): Promise<GroupSeedBundle> {
  return invoke<GroupSeedBundle>("group_open_key_packet", {
    senderPubB64,
    ciphertextB64,
    nonceB64,
  });
}

/** Расшифровать метаданные группы (Info_Key → XSalsa20-Poly1305).
 * avatar_url = путь в bucket avatars, avatar_nonce — для SecureAvatar. */
export async function openGroupMetadata(
  infoKeyB64: string,
  senderPubB64: string,
  metadataCtB64: string,
  nonceB64: string,
): Promise<{ name: string; bio: string; avatar_url: string; avatar_nonce?: string }> {
  const json = await invoke<string>("group_open_metadata", {
    infoKeyB64,
    senderPubB64,
    metadataCtB64,
    nonceB64,
  });
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("Групповые метаданные — невалидный JSON");
  }
}

// ── Локальный кэш групповых ключей (SQLCipher через chat-cache) ────
// После первого раскрытия пакета info_key/seed/msg_key_0 сохраняем ЗДЕСЬ,
// чтобы при следующем fetchChats не лезть в mailbox и не гонять DH.
import { cacheGetBounded, cacheSetBounded } from "@/hooks/echo/chat-cache";

function groupKeysCacheKey(userId: string): string {
  return `echo_group_keys_${userId}`;
}

/** Прочитать локальный кэш групповых ключей: { [groupId]: GroupSeedBundle }. */
export async function loadGroupKeys(userId: string): Promise<Record<string, GroupSeedBundle>> {
  try {
    const raw = await cacheGetBounded(groupKeysCacheKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Сохранить/обновить ключ одной группы в локальном кэше (fire-and-forget). */
export async function saveGroupKey(userId: string, groupId: string, keys: GroupSeedBundle): Promise<void> {
  const all = await loadGroupKeys(userId);
  all[groupId] = keys;
  await cacheSetBounded(groupKeysCacheKey(userId), JSON.stringify(all));
}
