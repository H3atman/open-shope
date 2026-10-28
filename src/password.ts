// Password hashing for Better Auth: PBKDF2-SHA256 through Web Crypto, which is native in workerd.
// Stored as pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>, so ITERATIONS can change later
// without breaking existing hashes. 100,000 is the reported cap on deployed Workers; local
// workerd accepts more, so the cap and the sign-in CPU cost still need checking on a deploy.
const ITERATIONS = 100_000;
const encoder = new TextEncoder();

// Derives a 32-byte PBKDF2-SHA256 key from the password.
async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

// Hashes a new password with a random 16-byte salt.
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${salt.toBase64()}$${hash.toBase64()}`;
}

// Checks a password against a stored hash, comparing in constant time.
export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [scheme, iterations, salt, expected] = hash.split("$");
  if (scheme !== "pbkdf2-sha256" || !iterations || !salt || !expected) return false;
  const actual = await derive(password, Uint8Array.fromBase64(salt), Number(iterations));
  const wanted = Uint8Array.fromBase64(expected);
  return actual.byteLength === wanted.byteLength && crypto.subtle.timingSafeEqual(actual, wanted);
}
