import { NextRequest, NextResponse } from "next/server";

import {
  applyChatIdentityCookies,
  chatIdentityErrorResponse,
  featureAccessDeniedResponse,
  resolveChatIdentity,
} from "@/lib/chat-auth";
import { getPaperReader, PaperReaderRequestError } from "@/lib/paper-reader";
import { CIVILMCP_FEATURE_ACCESS, CIVILMCP_OPEN_ACCESS } from "@/lib/product-access";
import { safeTraceId } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";
export const dynamicParams = true;

type RouteContext = {
  params: Promise<{ source: string }>;
};

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new PaperReaderRequestError(400, "invalid_pagination", "Reader pagination must use positive integers.");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PaperReaderRequestError(400, "invalid_pagination", `Reader pagination must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export async function GET(request: NextRequest, context: RouteContext) {
  let finalize = (response: NextResponse) => response;

  if (CIVILMCP_OPEN_ACCESS) {
    if (!CIVILMCP_FEATURE_ACCESS.explore.enabled) {
      return NextResponse.json(
        { error: "Explore is not enabled in this environment.", code: "feature_disabled", feature: "explore" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
  } else {
    let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
    try {
      resolved = await resolveChatIdentity(request);
    } catch (error) {
      return chatIdentityErrorResponse(error, request);
    }
    const { identity, applyAuthCookies } = resolved;
    const accessDenied = featureAccessDeniedResponse("explore", identity, applyAuthCookies);
    if (accessDenied) return accessDenied;
    finalize = (response) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  }

  try {
    const { source } = await context.params;
    const url = new URL(request.url);
    const payload = await getPaperReader({
      source,
      provider: url.searchParams.get("provider"),
      assetId: url.searchParams.get("asset"),
      page: boundedInteger(url.searchParams.get("page"), 1, 1, 100_000),
      limit: boundedInteger(url.searchParams.get("limit"), 10, 1, 10),
    });
    if (!payload) {
      return finalize(NextResponse.json(
        { error: "Paper not found.", code: "paper_not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      ));
    }

    // Rights and takedown decisions must take effect on the next request. Do not
    // place full-page text in a shared cache even when the public product is open.
    return finalize(NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    }));
  } catch (error) {
    if (error instanceof PaperReaderRequestError) {
      return finalize(NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      ));
    }
    const traceId = safeTraceId();
    console.error("civilmcp_paper_reader_failed", {
      traceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return finalize(NextResponse.json(
      {
        error: "Failed to load the paper reader.",
        code: "reader_failed",
        traceId,
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    ));
  }
}
