import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type UrlFetchGuardFailure = {
  ok: false;
  reason: "invalid_url" | "blocked_protocol" | "blocked_host" | "blocked_ip" | "host_not_allowed";
  hint: string;
};

export type UrlFetchGuardSuccess = {
  ok: true;
  url: URL;
};

export type UrlFetchGuardResult = UrlFetchGuardSuccess | UrlFetchGuardFailure;

const BLOCKED_HOSTNAMES = new Set(["localhost"]);

function readAllowedHosts(): Set<string> | null {
  const raw = process.env.READ_URL_ALLOWED_HOSTS?.trim();
  if (!raw) return null;
  const hosts = raw
    .split(/[,;\s]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? new Set(hosts) : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
    return isPrivateIpv4(parts);
  }
  if (kind === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (normalized.startsWith("fe80:")) return true;
  }
  return false;
}

function hostnameBlocked(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  if (!lower) return true;
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith(".local")) return true;
  if (lower.endsWith(".localhost")) return true;
  const ipKind = isIP(lower);
  if (ipKind !== 0) return isPrivateIpAddress(lower);
  return false;
}

export async function validateUrlForFetch(inputUrl: string): Promise<UrlFetchGuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl.trim());
  } catch {
    return {
      ok: false,
      reason: "invalid_url",
      hint: "URL 格式无效，请检查链接是否完整。",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: "blocked_protocol",
      hint: "仅支持 http(s) 链接。",
    };
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  if (hostnameBlocked(hostname)) {
    return {
      ok: false,
      reason: "blocked_host",
      hint: "该链接指向本机或内网地址，无法读取。请粘贴文档关键内容。",
    };
  }

  const allowedHosts = readAllowedHosts();
  if (allowedHosts && !allowedHosts.has(hostname)) {
    return {
      ok: false,
      reason: "host_not_allowed",
      hint: "该域名不在允许列表中，无法读取。请粘贴文档关键内容。",
    };
  }

  const ipKind = isIP(hostname);
  if (ipKind !== 0) {
    if (isPrivateIpAddress(hostname)) {
      return {
        ok: false,
        reason: "blocked_ip",
        hint: "该链接指向内网 IP，无法读取。请粘贴文档关键内容。",
      };
    }
    return { ok: true, url: parsed };
  }

  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    for (const record of records) {
      if (isPrivateIpAddress(record.address)) {
        return {
          ok: false,
          reason: "blocked_ip",
          hint: "该链接解析到内网地址，无法读取。请粘贴文档关键内容。",
        };
      }
    }
  } catch {
    return {
      ok: false,
      reason: "blocked_host",
      hint: "无法解析该域名，请检查链接或粘贴文档关键内容。",
    };
  }

  return { ok: true, url: parsed };
}
