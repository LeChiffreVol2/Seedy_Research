import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const prefix = "/api/papers/";
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(prefix) && pathname.length > prefix.length) {
    const source = pathname.slice(prefix.length);
    const url = request.nextUrl.clone();
    url.pathname = "/api/papers";
    url.searchParams.set("source", decodeURIComponent(source));
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/papers/:path*"],
};
