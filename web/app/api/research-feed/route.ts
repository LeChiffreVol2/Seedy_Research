import { NextRequest, NextResponse } from "next/server";

import { applyChatIdentityCookies, chatIdentityErrorResponse, featureAccessDeniedResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { CIVILMCP_FEATURE_ACCESS, CIVILMCP_OPEN_ACCESS } from "@/lib/product-access";
import { listResearchFeed } from "@/lib/research-feed";
import { safeTraceId } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");
    if (provider && !/^[a-z0-9_:-]{1,64}$/.test(provider.trim().toLocaleLowerCase("en"))) {
      return finalize(NextResponse.json(
        { error: "Provider filter is invalid.", code: "invalid_provider" },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      ));
    }
    const payload = await listResearchFeed({
      filter: url.searchParams.get("filter"),
      collection: url.searchParams.get("collection"),
      provider,
      q: url.searchParams.get("q"),
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
    });

    const response = CIVILMCP_OPEN_ACCESS
      ? NextResponse.json(payload, {
          headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" },
        })
      : NextResponse.json(payload, {
          headers: { "Cache-Control": "private, max-age=0" },
        });
    return finalize(response);
  } catch (error) {
    const traceId = safeTraceId();
    console.error("civilmcp_research_feed_failed", {
      traceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return finalize(NextResponse.json(
      {
        error: "Failed to load research feed.",
        traceId,
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    ));
  }
}
