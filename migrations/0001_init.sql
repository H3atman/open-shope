-- Better Auth core tables (user, session, account, verification) plus shop settings.
-- "user"."role" is a Better Auth additional field that only the server sets.

CREATE TABLE "user" (
  "id" text NOT NULL PRIMARY KEY,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" integer NOT NULL,
  "image" text,
  "role" text NOT NULL DEFAULT 'customer'
);

CREATE TABLE "session" (
  "id" text NOT NULL PRIMARY KEY,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "expiresAt" date NOT NULL,
  "token" text NOT NULL UNIQUE,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE "account" (
  "id" text NOT NULL PRIMARY KEY,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text
);

CREATE TABLE "verification" (
  "id" text NOT NULL PRIMARY KEY,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" date NOT NULL
);

CREATE INDEX "session_userId_idx" ON "session" ("userId");
CREATE INDEX "account_userId_idx" ON "account" ("userId");
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

-- Key/value shop settings. The 'setup' row is the first-run claim.
CREATE TABLE "settings" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
