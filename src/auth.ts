import { betterAuth } from "better-auth";
import { hashPassword, verifyPassword } from "./password";

type Auth = ReturnType<typeof createAuth>;

// Reuse Better Auth per origin to avoid rebuilding it on every request in an isolate.
const authByOrigin = new Map<string, Auth>();

// Resolves auth for workers.dev, custom domains and preview origins.
export function getAuth(env: Env, baseURL: string): Auth {
  let auth = authByOrigin.get(baseURL);
  if (!auth) {
    auth = createAuth(env, baseURL);
    authByOrigin.set(baseURL, auth);
  }
  return auth;
}

// Builds the auth instance with this deployment's bindings and secret.
function createAuth(env: Env, baseURL: string) {
  return betterAuth({
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    emailAndPassword: {
      enabled: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    user: {
      additionalFields: {
        // input: false makes Better Auth ignore any client-sent role; setup sets "owner".
        role: { type: "string", input: false, defaultValue: "customer" },
      },
    },
  });
}
