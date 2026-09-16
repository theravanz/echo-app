"use client";

import { useSecureMediaUrl } from "@/hooks/echo/use-secure-media";

/**
 * SecureImage — универсальный <img> для ЗАШИФРОВАННОГО медиа.
 *
 * Логика:
 *   - если в `src` уже валидный URL (legacy / внешний) — показываем его;
 *   - если есть `path + nonce` (новый зашифрованный формат) — резолвим blob:
 *     URL через приватный bucket;
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
  const secure = useSecureMediaUrl(
    bucket,
    path,
    nonce,
    (mime || "application/octet-stream") as string,
    Boolean(path && !src),
  );
  const effectiveSrc = src || secure;

  if (effectiveSrc) {
    return (
      <img src={effectiveSrc} className={className || "w-full h-full object-cover"} alt={alt || ""} />
    );
  }
  return <>{fallback}</>;
}