import type { MetadataRoute } from "next";

import { listPublicPaperRecordsForSitemap } from "@/lib/research-feed";

export const dynamic = "force-dynamic";

function origin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://seedresearch.vercel.app").replace(/\/+$/, "");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = origin();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/privacy`, changeFrequency: "monthly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "monthly", priority: 0.2 },
    { url: `${base}/support`, changeFrequency: "monthly", priority: 0.3 },
  ];
  try {
    const papers = await listPublicPaperRecordsForSitemap();
    return [
      ...staticRoutes,
      ...papers.map((paper) => ({
        url: `${base}/papers/${encodeURIComponent(paper.source)}`,
        lastModified: paper.updatedAt ? new Date(paper.updatedAt) : undefined,
        changeFrequency: "monthly" as const,
        priority: 0.6,
      })),
    ];
  } catch (error) {
    console.error("civilmcp_sitemap_failed", error instanceof Error ? error.message : "Unknown error");
    return staticRoutes;
  }
}
