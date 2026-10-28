import { betterAuth } from "better-auth";
import { hashPassword, verifyPassword } from "./password";

// Builds Better Auth for one request. baseURL is the request's origin, so the shop works on
// workers.dev and on a custom domain without config.
export function createAuth(env: Env, baseURL: string) {
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
