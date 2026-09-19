// ─────────────────────────────────────────────────────────────────────
// Единый менеджер back-навигации (Android back / Esc / edge-swipe).
//
// Модель: системный back закрывает ВЕРХНИЙ слой UI, а не приложение.
// Каждый компонент регистрирует свои закрываемые слои с приоритетом;
// closeTopLayer() закрывает верхний открытый. Приоритеты (сверху вниз):
//   110 settings-modal (глобальный оверлей z-[100])
//   100 contextMenu (внутри ChatArea)
//    90 bgPicker
//    80 mediaPicker / rightPanel
//    70 editingMessage / replyingTo (отмена)
//    60 выбранный чат (закрыть → onBack)
//
// Инварианты CHANGELOG 0.3.0: существующая onBack-логика не переписывается —
// сюда только ПОДКЛЮЧАЮТСЯ системные события. Ошибки не глотаются:
// вызывающий код обязан логировать с тегом [BACK-NAV].
// ─────────────────────────────────────────────────────────────────────

export interface NavLayer {
  /** Уникальный id слоя, напр. "chat-context-menu". */
  id: string;
  /** Больше = выше в стеке = закрывается первым. */
  priority: number;
  /** Открыт ли слой прямо сейчас (читается на каждый вызов). */
  isOpen: () => boolean;
  /** Закрыть слой (та же логика, что у кнопки-крестика/onBack). */
  close: () => void;
}

const layers = new Set<NavLayer>();
const listeners = new Set<() => void>();

/** Зарегистрировать слой. Возвращает функцию отрегистрации (для useEffect). */
export function registerNavLayer(layer: NavLayer): () => void {
  layers.add(layer);
  for (const fn of listeners) fn();
  return () => {
    layers.delete(layer);
    for (const fn of listeners) fn();
  };
}

/** Отсортированный снапшот: верхний стек первым. */
function sortedLayers(): NavLayer[] {
  return [...layers].sort((a, b) => b.priority - a.priority);
}

/** Есть ли хотя бы один открытый слой для закрытия. */
export function canGoBack(): boolean {
  return sortedLayers().some((l) => l.isOpen());
}

/**
 * Закрыть верхний открытый слой. Возвращает true, если что-то закрыто.
 * Никогда не бросает — но каждый слой отвечает за собственные try/catch
 * внутри close(); здесь — только диспетчеризация.
 */
export function closeTopLayer(): boolean {
  for (const l of sortedLayers()) {
    if (l.isOpen()) {
      try {
        l.close();
        console.log(`[BACK-NAV] closed layer: ${l.id}`);
      } catch (err) {
        console.error(`[BACK-NAV] failed to close layer ${l.id}:`, err);
      }
      return true;
    }
  }
  return false;
}

/** Подписка на изменения состава реестра (для реактивности, если понадобится). */
export function onNavLayersChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ─── Голосовая запись: Esc-координация ───
// ChatInput уже перехватывает Escape для отмены записи (rec !== "idle").
// Навигационный Esc обязан НЕ срабатывать в этот момент, поэтому
// ChatInput выставляет глобальный флаг через setVoiceRecordingActive().

let voiceRecordingActive = false;

export function setVoiceRecordingActive(active: boolean): void {
  voiceRecordingActive = active;
}

export function isVoiceRecordingActive(): boolean {
  return voiceRecordingActive;
}
