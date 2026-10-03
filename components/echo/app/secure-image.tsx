"use client";

import { useSecureMediaUrl, useSignedStorageUrl } from "@/hooks/echo/use-secure-media";

/**
 * SecureImage — универсальный <img> для медиа из ПРИВАТНЫХ bucket'ов.
 *
 * Логика:
 *   - если есть `path + nonce` (новый зашифрованный формат) — резолвим blob:
 *     URL через приватный bucket (signed-URL + расшифровка в Rust);
 *   - если `src` — ПУБЛИЧНАЯ ссылка на наш (теперь приватный) bucket — достаём
 *     из неё путь и открываем через signed-URL (legacy-медиа, без шифрования);
 *   - если `src` — внешняя ссылка (giphy и т.п.) — показываем её как есть;
 *   - иначе рендерим `fallback`.
 *
 * Это компонент (не хук напрямую), поэтому безопасен внутри `.map()`
 * (сетка публикаций, списки обложек и т.п.) без нарушения правил хуков.
 */
export function SecureImage({
  src,
  bucket,
  path,
  nonce,
  mime,
  fallback,
  className,
  alt,
}: {
  src?: string | null;
  bucket: string;
  path?: string | null;
  nonce?: string | null;
  mime?: string | null;
  fallback?: React.ReactNode;
  className?: string;
  alt?: string;
}) {
  // Зашифрованное медиа (path + nonce) резолвим в blob:
  const secure = useSecureMediaUrl(
    bucket,
    path,
    nonce,
    (mime || "application/octet-stream") as string,
    Boolean(path && nonce),
  );
  // Legacy: публичная ссылка на приватный bucket → короткоживущий signed-URL.
  const legacySigned = useSignedStorageUrl(
    bucket,
    src,
    Boolean(src && !(path && nonce)),
  );

  // Приоритет: расшифрованное → signed legacy → исходный src (внешний).
  const effectiveSrc = secure || legacySigned || src;

  if (effectiveSrc) {
    return (
      <img src={effectiveSrc} className={className || "w-full h-full object-cover"} alt={alt || ""} />
    );
  }
  return <>{fallback}</>;
}