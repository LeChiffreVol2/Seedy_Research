import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const prefix = "/api/papers/";
  const { pathname } = request.nextUrl;

  // Nested reader requests have their own rights-aware route. Rewriting them
  // as a legacy paper-detail lookup would turn `<source>/reader` into a source
  // identifier and silently bypass the reader contract.
  if (pathname.startsWith(prefix) && pathname.endsWith("/reader")) {
    return NextResponse.next();
  }

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
