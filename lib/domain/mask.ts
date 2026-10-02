const EMAIL_RE =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PHONE_RE = /\+\d[\d\s-]{6,}\d/g;
const PHONE_KEEP_PREFIX = 3;
const PHONE_KEEP_SUFFIX = 3;
const MAX_STRING_LENGTH = 2000;

export function maskEmail(email: string): string {
  return email.replace(EMAIL_RE, "$1***@$2");
}

export function maskPhone(phone: string): string {
  return phone.replace(PHONE_RE, (match) => {
    const compact = match.replace(/[\s-]/g, "");
    const hidden = compact.length - PHONE_KEEP_PREFIX - PHONE_KEEP_SUFFIX;
    if (hidden <= 0) {
      return "***";
    }
    return `${compact.slice(0, PHONE_KEEP_PREFIX)}${"*".repeat(hidden)}${compact.slice(-PHONE_KEEP_SUFFIX)}`;
  });
}

/** Masks emails and phone numbers anywhere inside free text, and caps its length. */
export function maskText(text: string): string {
  const masked = maskPhone(maskEmail(text));
  return masked.length > MAX_STRING_LENGTH
    ? `${masked.slice(0, MAX_STRING_LENGTH)}…[truncated ${masked.length - MAX_STRING_LENGTH} chars]`
    : masked;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Deep-masks every string in a JSON-compatible value. Names are intentionally kept. */
export function maskDeep(value: unknown): Json {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return maskText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(maskDeep);
  }
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = maskDeep(inner);
    }
    return out;
  }
  return String(value);
}
