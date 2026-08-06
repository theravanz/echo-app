/**
 * Кросс-платформенный детектор устройства + геолокация по IP + часовой пояс + VPN.
 *
 * Зачем это здесь:
 * - `navigator.platform` нестабилен (Android WebView возвращает "Linux armv8l",
 *   macOS — "MacIntel", браузер — "Web Browser"), поэтому ОС определяем по
 *   `userAgent` + `userAgentData`, чтобы на Android/Linux/macOS и в браузере
 *   всегда корректно отображалось одно и то же устройство.
 * - Локацию получаем по IP (ipapi.co, бесплатно, HTTPS, CORS), сверяем с
 *   реальным часовым поясом устройства. При несовпадении считаем, что включён
 *   VPN/прокси, и пишем оба варианта локации через "/".
 */

export type OsName =
  | "Android"
  | "iOS"
  | "macOS"
  | "Windows"
  | "Linux"
  | "ChromeOS"
  | "Unknown";

export type DeviceType = "mobile" | "tablet" | "desktop";

export interface DeviceMeta {
  /** Каноническое имя ОС (общее для всех платформ). */
  os: OsName;
  /** Человекочитаемое имя ОС с версией, напр. "Android 14". */
  os_name: string;
  /** Браузер/оболочка: "Chrome", "Safari", "Echo (Tauri)" и т.п. */
  browser_name: string;
  /** Удобная строка платформы для отображения, напр. "Android · mobile". */
  platform: string;
  device_type: DeviceType;
  is_mobile: boolean;
  is_tauri: boolean;
}

export interface DeviceGeo {
  /** Публичный IP устройства. */
  ip: string;
  city: string;
  region: string;
  /** Полное название страны, напр. "Russia". */
  country: string;
  /** Код страны, напр. "RU". */
  countryCode: string;
  /** Часовой пояс устройства (Intl), напр. "Europe/Moscow". */
  tz: string;
  /** Часовой пояс, определённый по IP. */
  ipTz: string;
  /** true, если IP-таймзона расходится с таймзоной устройства (VPN/прокси). */
  isVpn: boolean;
  /**
   * Строка локации. При VPN-расхождении содержит оба варианта через "/",
   * напр. "Moscow, RU / Novosibirsk, RU".
   */
  locationLabel: string;
}

/** Расшифровка распространённых IANA-таймзон в читабельный "Город, Страна". */
const TZ_LABELS: Record<string, string> = {
  "Europe/Moscow": "Moscow, RU",
  "Europe/Kaliningrad": "Kaliningrad, RU",
  "Europe/Samara": "Samara, RU",
  "Europe/Yekaterinburg": "Yekaterinburg, RU",
  "Asia/Omsk": "Omsk, RU",
  "Asia/Novosibirsk": "Novosibirsk, RU",
  "Asia/Krasnoyarsk": "Krasnoyarsk, RU",
  "Asia/Irkutsk": "Irkutsk, RU",
  "Asia/Yakutsk": "Yakutsk, RU",
  "Asia/Vladivostok": "Vladivostok, RU",
  "Asia/Magadan": "Magadan, RU",
  "Asia/Kamchatka": "Petropavlovsk-Kamchatsky, RU",
  "Europe/Berlin": "Berlin, DE",
  "Europe/Paris": "Paris, FR",
  "Europe/London": "London, GB",
  "Europe/Madrid": "Madrid, ES",
  "Europe/Rome": "Rome, IT",
  "Europe/Warsaw": "Warsaw, PL",
  "Europe/Prague": "Prague, CZ",
  "Europe/Vienna": "Vienna, AT",
  "Europe/Amsterdam": "Amsterdam, NL",
  "Europe/Stockholm": "Stockholm, SE",
  "Europe/Oslo": "Oslo, NO",
  "Europe/Helsinki": "Helsinki, FI",
  "Europe/Copenhagen": "Copenhagen, DK",
  "Europe/Istanbul": "Istanbul, TR",
  "Europe/Athens": "Athens, GR",
  "Europe/Lisbon": "Lisbon, PT",
  "Europe/Dublin": "Dublin, IE",
  "Europe/Zurich": "Zurich, CH",
  "America/New_York": "New York, US",
  "America/Chicago": "Chicago, US",
  "America/Denver": "Denver, US",
  "America/Los_Angeles": "Los Angeles, US",
  "America/Sao_Paulo": "São Paulo, BR",
  "America/Toronto": "Toronto, CA",
  "America/Vancouver": "Vancouver, CA",
  "Asia/Tokyo": "Tokyo, JP",
  "Asia/Seoul": "Seoul, KR",
  "Asia/Shanghai": "Shanghai, CN",
  "Asia/Hong_Kong": "Hong Kong, HK",
  "Asia/Singapore": "Singapore, SG",
  "Asia/Dubai": "Dubai, AE",
  "Asia/Jerusalem": "Jerusalem, IL",
  "Asia/Almaty": "Almaty, KZ",
  "Asia/Tashkent": "Tashkent, UZ",
  "Asia/Kolkata": "Kolkata, IN",
  "Asia/Bangkok": "Bangkok, TH",
  "Asia/Jakarta": "Jakarta, ID",
  "Asia/Manila": "Manila, PH",
  "Asia/Karachi": "Karachi, PK",
  "Asia/Dhaka": "Dhaka, BD",
  "Australia/Sydney": "Sydney, AU",
  "Australia/Melbourne": "Melbourne, AU",
  "Pacific/Auckland": "Auckland, NZ",
  "Africa/Cairo": "Cairo, EG",
  "Africa/Johannesburg": "Johannesburg, ZA",
  "Africa/Lagos": "Lagos, NG",
  "Africa/Nairobi": "Nairobi, KE",
};
/** Переводит IANA-таймзону в читабельную метку, например "Novosibirsk, RU". */
export function tzLabel(tz?: string | null): string {
  if (!tz) return "";
  if (TZ_LABELS[tz]) return TZ_LABELS[tz];
  const parts = tz.split("/");
  const last = parts[parts.length - 1]?.replace(/_/g, " ") || tz;
  if (parts.length === 1) return last;
  const region =
    parts[0] === "Asia" ? "AS" : parts[0] === "Europe" ? "EU" : parts[0] === "America" ? "AM" : parts[0];
  return `${last}, ${region}`;
}

/** Текстовый код страны (RU/US/DE...) → полное имя (Russia/USA/...). */
const COUNTRY_NAMES: Record<string, string> = {
  RU: "Russia",
  US: "USA",
  GB: "UK",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  PL: "Poland",
  UA: "Ukraine",
  KZ: "Kazakhstan",
  BY: "Belarus",
  IN: "India",
  CN: "China",
  JP: "Japan",
  KR: "South Korea",
  AE: "UAE",
  TR: "Turkey",
  BR: "Brazil",
  MX: "Mexico",
  CA: "Canada",
  AU: "Australia",
  NZ: "New Zealand",
  NL: "Netherlands",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
  SE: "Sweden",
  NO: "Norway",
  FI: "Finland",
  DK: "Denmark",
  CZ: "Czechia",
};
export function countryName(code?: string | null): string {
  if (!code) return "";
  return COUNTRY_NAMES[code.toUpperCase()] || code.toUpperCase();
}

function getUA(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

function getRawPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const uaData = (navigator as any)?.userAgentData;
  return (navigator.platform || uaData?.platform || "").toLowerCase();
}

/** Надёжное определение ОС/браузера, одинаковое для Android/Linux/macOS/браузер. */
export function detectDeviceMeta(): DeviceMeta {
  if (typeof navigator === "undefined") {
    return {
      os: "Unknown",
      os_name: "Unknown",
      browser_name: "Echo Web",
      platform: "Web",
      device_type: "desktop",
      is_mobile: false,
      is_tauri: false,
    };
  }

  const ua = getUA();
  const rawPlatform = getRawPlatform();
  const maxTouch = navigator.maxTouchPoints || 0;
  const touch = typeof window !== "undefined" && ("ontouchstart" in window || maxTouch > 0);
  const isTauri = !!(window as any).__TAURI_INTERNALS__;

  // ── ОС ─────────────────────────────────────────────────────────────
  let os: OsName = "Unknown";
  let osName = "Unknown";
  let osVersion = "";

  if (/android/i.test(ua)) {
    os = "Android";
    const m = ua.match(/Android\s*([\d.]+)/i);
    osVersion = m ? m[1] : "";
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    os = "iOS";
    const m = ua.match(/OS\s*([\d_]+)/i);
    osVersion = m ? m[1].replace(/_/g, ".") : "";
  } else if (/mac os x|macintosh|mac/i.test(ua)) {
    os = "macOS";
    const m = ua.match(/Mac OS X\s*([\d_.]+)/i);
    osVersion = m ? m[1].replace(/_/g, ".") : "";
  } else if (/windows|win32|win64/i.test(ua) || rawPlatform.includes("win")) {
    os = "Windows";
    const m = ua.match(/Windows NT\s*([\d.]+)/i);
    osVersion = m ? m[1] : "";
  } else if (/cr os|chrome os/i.test(ua) || rawPlatform.includes("cros")) {
    os = "ChromeOS";
  } else if (/linux|x11/i.test(ua) || rawPlatform.includes("linux") || rawPlatform.includes("x11")) {
    // Android WebView уже перехвачен выше по /android/i — сюда доходит Linux desktop.
    os = "Linux";
  }

  switch (os) {
    case "Android": osName = osVersion ? `Android ${osVersion}` : "Android"; break;
    case "iOS": osName = osVersion ? `iOS ${osVersion}` : "iOS"; break;
    case "macOS": osName = osVersion ? `macOS ${osVersion}` : "macOS"; break;
    case "Windows": {
      const winMap: Record<string, string> = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" };
      osName = osVersion ? `Windows ${winMap[osVersion] || osVersion}` : "Windows";
      break;
    }
    case "ChromeOS": osName = "ChromeOS"; break;
    case "Linux": osName = "Linux"; break;
    default: osName = "Unknown";
  }

  // ── Браузер ────────────────────────────────────────────────────────
  let browser: string;
  if (isTauri) browser = "Echo (Tauri)";
  else if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\/|opera/i.test(ua)) browser = "Opera";
  else if (/samsungbrowser/i.test(ua)) browser = "Samsung Internet";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/crios\//i.test(ua)) browser = "Chrome (iOS)";
  else if (/chromium|crios|chrome\//i.test(ua)) browser = "Chrome";
  else if (/fxios/i.test(ua)) browser = "Firefox (iOS)";
  else if (/safari\//i.test(ua)) browser = "Safari";
  else browser = "Echo Web";

  // ── Тип устройства ─────────────────────────────────────────────────
  const isIpadLike =
    /ipad/i.test(ua) || (/macintosh/i.test(ua) && touch && maxTouch > 1 && !isTauri);
  let device_type: DeviceType = "desktop";
  if (/android/i.test(ua) && /mobile/i.test(ua)) device_type = "mobile";
  else if (/android/i.test(ua)) device_type = "tablet";
  else if (/iphone|ipod/i.test(ua)) device_type = "mobile";
  else if (isIpadLike) device_type = "tablet";

  const isMobile = device_type !== "desktop";
  const platform = isTauri ? `${osName} · app` : `${osName} · ${device_type}`;

  return {
    os,
    os_name: osName,
    browser_name: browser,
    platform,
    device_type,
    is_mobile: isMobile,
    is_tauri: isTauri,
  };
}

/** Приводит ответ любого гео-провайдера к единому формату (null если данных нет). */
function normalizeGeo(d: any): {
  ip: string; city: string; region: string;
  country: string; countryCode: string; timezone: string;
} | null {
  if (!d || typeof d !== "object") return null;

  // ipwho.is: { ip, city, region, country, country_code, timezone, ... }
  if (typeof d.country_code === "string" && typeof d.timezone === "string") {
    return {
      ip: d.ip || "",
      city: d.city || "",
      region: d.region || "",
      country: d.country || "",
      countryCode: d.country_code,
      timezone: d.timezone,
    };
  }
  // ipinfo.io: { ip, city, region, country(code), timezone }
  if (typeof d.timezone === "string" && d.country && typeof d.country === "string" && (d.city || d.region)) {
    return {
      ip: d.ip || "",
      city: d.city || "",
      region: d.region || "",
      country: "",
      countryCode: d.country,
      timezone: d.timezone,
    };
  }
  // ipapi.co: { ip, city, region, country_name, country, timezone }
  if (typeof d.timezone === "string" && (d.city || d.region || d.country)) {
    return {
      ip: d.ip || "",
      city: d.city || "",
      region: d.region || "",
      country: d.country_name || "",
      countryCode: d.country || "",
      timezone: d.timezone,
    };
  }
  return null;
}

/** Пробует несколько бесплатных HTTPS-провайдеров геолокации по IP. */
async function fetchGeo(): Promise<ReturnType<typeof normalizeGeo>> {
  const providers = [
    "https://ipwho.is/",
    "https://ipinfo.io/json/",
    "https://ipapi.co/json/",
  ];
  for (const url of providers) {
    try {
      const opts =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? { signal: AbortSignal.timeout(6000) }
          : {};
      const res = await fetch(url, opts);
      if (!res.ok) continue;
      const d = await res.json();
      const norm = normalizeGeo(d);
      if (norm) return norm;
    } catch {
      // пробуем следующий провайдер
    }
  }
  return null;
}

/**
 * Получает геолокацию по IP и сверяет с таймзоной устройства.
 * При расхождении помечает VPN и возвращает оба варианта локации через "/".
 * Провайдеры пробуются по очереди (fallback), чтобы не зависеть от одного сервиса.
 */
export async function resolveDeviceGeo(): Promise<DeviceGeo | null> {
  let deviceTz = "";
  if (typeof Intl !== "undefined" && typeof Intl.DateTimeFormat !== "undefined") {
    deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  }

  const geo = await fetchGeo();
  if (!geo) return null;

  const ip = geo.ip || "";
  const city = geo.city || "";
  const region = geo.region || "";
  const country = geo.country || countryName(geo.countryCode);
  const countryCode = geo.countryCode || "";
  const ipTz = geo.timezone || "";

  const mismatch = !!ipTz && !!deviceTz && ipTz !== deviceTz;
  const isVpn = mismatch;

  const ipCity = [city, region].filter(Boolean).join(", ");
  let locationLabel = ipCity
    ? `${ipCity}, ${countryCode || tzLabel(countryCode) || ""}`.trim().replace(/,\s*$/, "")
    : tzLabel(ipTz) || tzLabel(deviceTz) || "Unknown location";

  if (mismatch) {
    // Оба варианта через "/": локация по IP / локация по таймзоне устройства.
    const locA = ipCity ? `${ipCity}, ${countryCode}` : tzLabel(ipTz);
    const locB = tzLabel(deviceTz);
    locationLabel = `${locA} / ${locB}`;
  }

  return {
    ip,
    city,
    region,
    country,
    countryCode,
    tz: deviceTz,
    ipTz,
    isVpn,
    locationLabel,
  };
}

export interface DetectedDevice {
  meta: DeviceMeta;
  geo: DeviceGeo | null;
}

/** Единая точка вызова: метаданные устройства + (опционально) гео по IP. */
export async function detectDevice(withGeo = true): Promise<DetectedDevice> {
  const meta = detectDeviceMeta();
  const geo = withGeo ? await resolveDeviceGeo() : null;
  return { meta, geo };
}

