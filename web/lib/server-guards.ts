import { randomUUID } from "node:crypto";

const PLACEHOLDER_VALUES = new Set([
  "",
  "change-me",
  "changeme",
  "replace-with-random-secret",
  "build-placeholder",
  "placeholder",
  "sk-...",
  "eyj...",
]);

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  key: string;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
  policy?: string;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

export function clampEnvNumber(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function isPlaceholderSecret(value: string | undefined | null): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return PLACEHOLDER_VALUES.has(normalized) || normalized.startsWith("replace-") || normalized.includes("your-");
}

export function isStrictProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.CIVILMCP_ENV === "production"
  );
}

export function assertRequiredServerEnv(
  requirements: Array<{ name: string; value?: string | null; secret?: boolean; minLength?: number }>,
) {
  if (!isStrictProductionRuntime()) return;

  const missing = requirements
    .filter(
      (item) =>
        !item.value ||
        (item.secret && isPlaceholderSecret(item.value)) ||
        (item.minLength !== undefined && item.value.trim().length < item.minLength),
    )
    .map((item) => item.name);
  if (missing.length) {
    throw new Error(`Production env preflight failed: ${missing.join(", ")} is missing, weak, or placeholder.`);
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function getRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwarded ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown-ip"
  );
}

export function requestIdentityKey(request: Request, scope: string): string {
  const cookies = parseCookies(request.headers.get("cookie"));
  const userOrSession = cookies.civilmcp_user || cookies.civilmcp_session;
  return `${scope}:${userOrSession || getRequestIp(request)}`;
}

export function checkRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const existing = rateLimitBuckets.get(key);
  const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  const remaining = Math.max(0, limit - bucket.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    allowed: bucket.count <= limit,
    key,
    limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds,
  };
}

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.policy ? { "X-RateLimit-Policy": result.policy } : {}),
    ...(result.allowed ? {} : { "Retry-After": String(result.retryAfterSeconds) }),
  };
}

export async function readBoundedJson<T>(request: Request, maxBytes: number): Promise<T> {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw Object.assign(new Error(`Request body exceeds ${maxBytes} bytes.`), { statusCode: 413 });
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw Object.assign(new Error(`Request body exceeds ${maxBytes} bytes.`), { statusCode: 413 });
  }

  try {
    return JSON.parse(text || "{}") as T;
  } catch (error) {
    throw Object.assign(new Error("Invalid JSON request body."), { statusCode: 400, cause: error });
  }
}

export function safeTraceId(): string {
  return `trace_${randomUUID()}`;
}
