import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { validateSession } from "./db.js";
import type { Permissions, Session } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

/**
 * Authenticate via Bearer token.
 * Sets request.session if valid.
 * Returns 401 if invalid/missing.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const session = validateSession(token);
    if (session) {
      request.session = session;
      return;
    }
  }

  reply.code(401).send({ error: "Invalid or missing session token" });
}

/**
 * Requires read-write permissions.
 * Also authenticates — no need to chain with authenticate.
 */
export async function requireReadWrite(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply);
  if (reply.sent) return;

  if (request.session?.permissions !== "readwrite") {
    reply.code(403).send({ error: "Read-write access required" });
  }
}

/** Check a password against configured credentials. Returns permissions or null. */
export function checkPassword(password: string): Permissions | null {
  if (password === config.authReadwritePassword) return "readwrite";
  if (password === config.authReadonlyPassword) return "readonly";
  return null;
}
