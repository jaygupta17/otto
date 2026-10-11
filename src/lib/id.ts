export function uid(prefix = ""): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const s = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
  return prefix + s;
}

/** URL-safe random password, 32 chars. */
export function randomSecret(len = 32): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
