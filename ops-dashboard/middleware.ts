import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="CityMCP Ops Dashboard", charset="UTF-8"',
    },
  });
}

function basicAuthEnabled() {
  return Boolean(process.env.OPS_DASHBOARD_BASIC_AUTH_USER && process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD);
}

function authDisabledForLocalDev() {
  return process.env.NODE_ENV !== "production" && process.env.OPS_DASHBOARD_AUTH_DISABLED === "true";
}

function authNotConfigured() {
  return new NextResponse("Ops dashboard authentication is not configured", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isAuthorized(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;

  const encoded = header.slice("Basic ".length);
  let decoded = "";
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) return false;

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  return username === process.env.OPS_DASHBOARD_BASIC_AUTH_USER && password === process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD;
}

function isIngestRefreshPath(request: NextRequest) {
  return request.nextUrl.pathname === "/api/ops/ingest/refresh";
}

function isAuthorizedIngestRefresh(request: NextRequest) {
  const secrets = [process.env.OPS_INGEST_SECRET?.trim(), process.env.CRON_SECRET?.trim()].filter(Boolean);
  if (secrets.length === 0) return false;

  const auth = request.headers.get("authorization") ?? "";
  const headerSecret = request.headers.get("x-ops-ingest-secret") ?? "";
  return secrets.some((secret) => auth === `Bearer ${secret}` || headerSecret === secret);
}

export function middleware(request: NextRequest) {
  if (isIngestRefreshPath(request) && isAuthorizedIngestRefresh(request)) return NextResponse.next();

  if (!basicAuthEnabled()) {
    if (authDisabledForLocalDev()) return NextResponse.next();
    return authNotConfigured();
  }
  if (isAuthorized(request)) return NextResponse.next();
  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
