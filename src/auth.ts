/**
 * Auth helpers: PBKDF2 password hashing (WebCrypto, Workers-compatible)
 * + opaque session tokens.
 */

// NOTE: Cloudflare Workers production caps PBKDF2 at 100,000 iterations.
const ITERATIONS = 100_000;
const KEY_LEN_BITS = 256;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function generateSaltHex(lengthBytes = 16): string {
  const buf = new Uint8Array(lengthBytes);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function generateSessionToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

async function pbkdf2(password: string, saltBytes: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes as BufferSource,
      iterations: ITERATIONS,
    },
    keyMaterial,
    KEY_LEN_BITS
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPassword(
  password: string
): Promise<{ hash: string; salt: string }> {
  const salt = generateSaltHex(16);
  const hash = await pbkdf2(password, hexToBytes(salt));
  return { hash, salt };
}

export async function verifyPassword(
  password: string,
  saltHex: string,
  expectedHashHex: string
): Promise<boolean> {
  let computed: string;
  try {
    computed = await pbkdf2(password, hexToBytes(saltHex));
  } catch {
    return false;
  }
  // Constant-time comparison on hex strings.
  if (computed.length !== expectedHashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
  }
  return diff === 0;
}

export function sessionExpiryIso(days = 7): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
}
