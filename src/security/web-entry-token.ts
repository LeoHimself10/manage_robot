import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 30 * 60; // 30 minutes

export interface SignParams {
  planId: string;
  userId: string;
  role: "manager";
  ttlSeconds?: number;
}

export interface SignedToken {
  token: string;
  exp: number;
  nonce: string;
}

export interface VerifiedToken {
  planId: string;
  userId: string;
  role: string;
  exp: number;
  nonce: string;
}

function readSecret(): string {
  const s = process.env.ASSIGNMENT_WEB_SECRET?.trim();
  if (!s) throw new Error("ASSIGNMENT_WEB_SECRET is required for signed tokens");
  return s;
}

function serializePayload(params: {
  planId: string;
  userId: string;
  role: string;
  exp: number;
  nonce: string;
}): string {
  return `v1|${params.planId}|${params.userId}|${params.role}|${params.exp}|${params.nonce}`;
}

export function signAssignmentEntry(params: SignParams): SignedToken {
  const secret = readSecret();
  const exp =
    Math.floor(Date.now() / 1000) + (params.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const nonce = randomBytes(8).toString("hex");
  const payload = serializePayload({ ...params, exp, nonce });
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return { token: `${payload}|${sig}`, exp, nonce };
}

export function verifyAssignmentEntry(token: string): VerifiedToken {
  const secret = readSecret();
  const parts = token.split("|");
  // v1|planId|userId|role|exp|nonce|sig → 7 parts
  if (parts.length !== 7 || parts[0] !== "v1") {
    throw new Error("Invalid token format");
  }
  const [version, planId, userId, role, expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) throw new Error("Invalid token: bad exp");

  const payload = serializePayload({ planId, userId, role, exp, nonce });
  const expectedSig = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Constant-time compare to prevent timing attacks
  if (expectedSig.length !== sig.length) {
    throw new Error("Invalid token signature");
  }
  if (
    !timingSafeEqual(Buffer.from(expectedSig), Buffer.from(sig))
  ) {
    throw new Error("Invalid token signature");
  }

  if (Date.now() / 1000 > exp) throw new Error("Token expired");
  return { planId, userId, role, exp, nonce };
}
