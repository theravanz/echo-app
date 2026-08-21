import { importPKCS8, SignJWT } from "https://esm.sh/jose@6.2.9";

/**
 * Получение OAuth2 access-токена для Firebase Cloud Messaging (HTTP v1).
 * Токен mint'ится из service-account ключа (JWT assertion → oauth2 token
 * exchange) и кэшируется на ~2000с, чтобы не делать обмен на каждый пуш.
 *
 * Secrets:
 *  - FIREBASE_SERVICE_ACCOUNT  — полный JSON сервисного аккаунта Firebase
 *                                (client_email, private_key, token_uri, ...).
 *                                Это ОСНОВНОЙ источник. Токены из него живут
 *                                ~1 час и обновляются автоматически.
 *  - FIREBASE_ACCESS_TOKEN     — fallback: готовый OAuth2 access-токен
 *                                (только если нет/не хочешь выкатывать
 *                                service account). НЕ PEM-ключ (не содержит
 *                                переводов строк).
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let cached: { token: string; expiresAt: number } | null = null;

interface ServiceAccountJson {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}

async function mintAccessToken(sa: ServiceAccountJson): Promise<string> {
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account key is missing client_email or private_key");
  }

  const now = Math.floor(Date.now() / 1000);

  // Google подписывает JWT ключом сервисного аккаунта (RS256).
  const signer = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(sa.token_uri ?? TOKEN_URL)
    .sign(signer);

  const res = await fetch(sa.token_uri ?? TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`oauth2 token exchange failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("oauth2 token exchange returned no access_token");
  }
  return data.access_token;
}

/** Возвращает валидный OAuth Bearer-токен без переводов строк. */
export async function getFcmAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }

  // 1. Основной путь: JSON сервисного аккаунта → минтим OAuth-обмен.
  const saRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (saRaw) {
    try {
      const sa = JSON.parse(saRaw) as ServiceAccountJson;
      const token = await mintAccessToken(sa);
      cached = { token, expiresAt: Date.now() + 2_000_000 };
      return token;
    } catch (e) {
      console.error("[FCM-OAuth] Service-account mint failed:", e);
      // Если в переменную положили не JSON — пробуем fallback ниже.
    }
  }

  // 2. Fallback: готовый access-токен (БЕЗ переводов строк).
  const direct = Deno.env.get("FIREBASE_ACCESS_TOKEN");
  if (direct && !direct.includes("\n") && !/-----BEGIN .*KEY-----/.test(direct)) {
    return direct;
  }

  throw new Error(
    "No valid FCM OAuth token source. Set FIREBASE_SERVICE_ACCOUNT (JSON) " +
      "or a single-line FIREBASE_ACCESS_TOKEN.",
  );
}