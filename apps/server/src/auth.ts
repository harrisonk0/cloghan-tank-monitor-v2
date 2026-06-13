import type { FastifyReply, FastifyRequest } from "fastify";
import cookie from "cookie";
import { validateApiKey } from "./db.js";
import type { ApiKey } from "./types.js";

// Extend FastifyRequest to include apiKey
declare module "fastify" {
  interface FastifyRequest {
    apiKey?: ApiKey;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const parsed = cookie.parse(header);
  return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/**
 * Authenticate via session cookie or Authorization header.
 * Sets request.apiKey if valid.
 * Returns 401 reply if invalid/missing.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // 1. Check session cookie
  const cookies = parseCookies(request.headers.cookie);
  const sessionKey = cookies.ctm_session;
  if (sessionKey) {
    const keyData = validateApiKey(sessionKey);
    if (keyData) {
      request.apiKey = keyData;
      return;
    }
  }

  // 2. Fall back to Authorization header
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const key = authHeader.slice(7);
    const keyData = validateApiKey(key);
    if (keyData) {
      request.apiKey = keyData;
      return;
    }
  }

  // 3. No valid auth found
  reply.code(401).send({ error: "Invalid or missing API key" });
}

/**
 * Requires read-write permissions.
 * Must be used after authenticate.
 */
export async function requireReadWrite(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.apiKey) {
    reply.code(401).send({ error: "Authentication required" });
    return;
  }
  if (request.apiKey.permissions !== "readwrite") {
    reply.code(403).send({ error: "Read-write access required" });
  }
}

/**
 * Set session cookie on reply.
 */
export function setSessionCookie(reply: FastifyReply, key: string): void {
  const cookieStr = cookie.serialize("ctm_session", key, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });
  reply.header("Set-Cookie", cookieStr);
}

/**
 * Clear session cookie on reply.
 */
export function clearSessionCookie(reply: FastifyReply): void {
  const cookieStr = cookie.serialize("ctm_session", "", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 0,
  });
  reply.header("Set-Cookie", cookieStr);
}
