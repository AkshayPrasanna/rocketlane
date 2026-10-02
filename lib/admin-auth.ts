/*
 * Admin sign-in is one shared password. The session is a signed, expiring token in an
 * httpOnly cookie. Only Web Crypto is used, so the same code runs in the proxy and in
 * server code.
 */

export const ADMIN_COOKIE = "onboarding_admin";
export const SESSION_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();
const HEX_RADIX = 16;
const PASSWORD_COMPARE_KEY = "admin-password-compare";

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(message)
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(HEX_RADIX).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference += Math.abs(a.charCodeAt(index) - b.charCodeAt(index));
  }
  return difference === 0;
}

/** Compares passwords by their HMACs, so length and content never show in the timing. */
export async function passwordMatches(
  input: string,
  expected: string
): Promise<boolean> {
  const [left, right] = await Promise.all([
    hmacHex(PASSWORD_COMPARE_KEY, input),
    hmacHex(PASSWORD_COMPARE_KEY, expected),
  ]);
  return constantTimeEqual(left, right);
}

export async function createSessionToken(
  password: string,
  nowMs: number
): Promise<string> {
  const expires = Math.floor(nowMs / 1000) + SESSION_SECONDS;
  return `${expires}.${await hmacHex(password, `admin-session:${expires}`)}`;
}

export async function verifySessionToken(
  token: string | null | undefined,
  password: string | undefined,
  nowMs: number
): Promise<boolean> {
  if (!(token && password)) {
    return false;
  }
  const [expiresText, signature] = token.split(".");
  const expires = Number(expiresText);
  if (!(signature && Number.isInteger(expires))) {
    return false;
  }
  if (expires * 1000 < nowMs) {
    return false;
  }
  const expected = await hmacHex(password, `admin-session:${expires}`);
  return constantTimeEqual(signature, expected);
}

/** Pulls one cookie out of a raw Cookie header. */
export function readCookie(
  header: string | null,
  name: string
): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return;
}
