"use client";

import { SecureImage } from "./secure-image";

/**
 * SecureAvatar — аватар, который умеет показывать ЗАШИФРОВАННОЕ медиа.
 * Тонкая обёртка над SecureImage с дефолтным bucket'ом "avatars".
 *
 * Логика:
 *   - если в `src` уже есть валидный URL (legacy-аватар) — показываем его;
 *   - если есть `path + nonce` (новый зашифрованный формат) — резолвим blob:
 *     URL через приватный bucket и показываем;
 *   - иначе рендерим `fallback` (инициалы/цвет).
 *
 * Это компонент (не хук напрямую), поэтому его можно использовать внутри
 * `.map()` в списках чатов без нарушения правил хуков React.
 */
export function SecureAvatar({
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
  return (
    <SecureImage
      src={src}
      bucket={bucket}
      path={path}
      nonce={nonce}
      mime={mime}
      fallback={fallback}
      className={className}
      alt={alt}
    />
  );
}