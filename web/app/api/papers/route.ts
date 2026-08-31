import { NextRequest, NextResponse } from "next/server";

import { applyChatIdentityCookies, chatIdentityErrorResponse, featureAccessDeniedResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { CIVILMCP_FEATURE_ACCESS, CIVILMCP_OPEN_ACCESS } from "@/lib/product-access";
import { getPaperDetail, type PaperEvidenceTarget } from "@/lib/research-feed";
import { safeTraceId } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

function boundedIndex(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : null;
}

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
    const sourceFromPath = url.pathname.startsWith("/api/papers/")
      ? decodeURIComponent(url.pathname.slice("/api/papers/".length))
      : "";
    const source = (url.searchParams.get("source") || sourceFromPath).trim();
    if (!source) {
      return finalize(NextResponse.json({ error: "Paper source is required." }, { status: 400, headers: { "Cache-Control": "no-store" } }));
    }

    const evidenceTarget: PaperEvidenceTarget = {
      id: url.searchParams.get("evidence")?.trim().slice(0, 120) || null,
      sectionIndex: boundedIndex(url.searchParams.get("section")),
      chunkIndex: boundedIndex(url.searchParams.get("chunk")),
      pageStart: boundedIndex(url.searchParams.get("page")),
    };
    const payload = await getPaperDetail(source, true, evidenceTarget);
    if (!payload) {
      return finalize(NextResponse.json({ error: "Paper not found." }, { status: 404, headers: { "Cache-Control": "no-store" } }));
    }

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
    console.error("civilmcp_paper_detail_failed", {
      traceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return finalize(NextResponse.json(
      {
        error: "Failed to load paper detail.",
        traceId,
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    ));
  }
}
