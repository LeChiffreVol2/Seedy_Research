import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PaperReader } from "@/components/paper-reader";
import { getPaperDetail } from "@/lib/research-feed";

import styles from "./page.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ source: string }> };

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://civil-mcp-web.vercel.app").replace(/\/+$/, "");
}

function pageRange(start?: number | null, end?: number | null): string {
  if (start == null) return "Page unavailable";
  return end == null || end === start ? `p.${start}` : `p.${start}–${end}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { source } = await params;
  const detail = await getPaperDetail(source).catch(() => null);
  if (!detail) return { title: "Paper not found | Seedy Research", robots: { index: false, follow: false } };
  const canonical = `${appUrl()}/papers/${encodeURIComponent(detail.document.source)}`;
  const description = `${detail.document.sourceLabel}. ${detail.counts.sections} indexed sections and ${detail.counts.chunks} exact-page evidence chunks in Seedy Research.`;
  return {
    title: `${detail.document.title} | Seedy Research`,
    description,
    alternates: { canonical },
    openGraph: { title: detail.document.title, description, type: "article", url: canonical },
  };
}

export default async function PublicPaperPage({ params }: PageProps) {
  const { source } = await params;
  const detail = await getPaperDetail(source, true).catch(() => null);
  if (!detail) notFound();
  const paper = detail.document;
  const hasNativeFullText = paper.accessLevel === "full_text_licensed";
  const canonical = `${appUrl()}/papers/${encodeURIComponent(paper.source)}`;
  const openInApp = `${appUrl()}/?paper=${encodeURIComponent(paper.source)}`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    name: paper.title,
    identifier: paper.paperCode || paper.source,
    datePublished: paper.publishedAt || (paper.proceedingYear ? String(paper.proceedingYear) : undefined),
    inLanguage: paper.language || "th",
    url: canonical,
    author: paper.authors?.map((name) => ({ "@type": "Person", name })),
    sameAs: paper.canonicalUrl || undefined,
    license: paper.licenseUrl || undefined,
    isAccessibleForFree: hasNativeFullText || undefined,
    isPartOf: paper.journalTitle
      ? { "@type": "Periodical", name: paper.journalTitle }
      : { "@type": "Dataset", name: paper.sourceLabel },
    pagination: pageRange(paper.pageStart, paper.pageEnd),
  };

  return (
    <main className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
      <nav className={styles.nav} aria-label="SEEDY">
        <Link href="/" className={styles.brand}>SEEDY</Link>
        <Link href={openInApp} className={styles.primary}>Open in research app</Link>
      </nav>

      <article className={styles.paper}>
        <p className={styles.eyebrow}>{hasNativeFullText ? "Rights-verified full paper" : "Page-cited Thai research evidence"}</p>
        <h1>{paper.title}</h1>
        <div className={styles.meta}>
          <span>{paper.paperCode || paper.source}</span>
          <span>{paper.sourceLabel}</span>
          {paper.discipline ? <span>{paper.discipline.replace(/_/g, " ")}</span> : null}
          {paper.licenseExpression ? <span>{paper.licenseExpression}</span> : null}
          <span>{pageRange(paper.pageStart, paper.pageEnd)}</span>
        </div>
        <p className={styles.lead}>
          {hasNativeFullText
            ? `This rights-reviewed version of record has ${paper.pages.toLocaleString("en-US")} readable, searchable, and page-addressable pages. Highlights and private notes stay in this browser; every citation reopens the same verified asset.`
            : `This record is structured into ${detail.counts.sections.toLocaleString("en-US")} sections and ${detail.counts.chunks.toLocaleString("en-US")} page-linked evidence chunks. Open the research app to inspect evidence and ask cited questions.`}
        </p>
        <div className={styles.actions}>
          {hasNativeFullText
            ? <a href="#paper-reader-title" className={styles.primary}>Read full paper</a>
            : <Link href={openInApp} className={styles.primary}>Inspect exact-page evidence</Link>}
          {paper.canonicalUrl ? <a href={paper.canonicalUrl} target="_blank" rel="noreferrer" className={styles.secondary}>Publisher record</a> : null}
        </div>

        <PaperReader
          source={paper.source}
          paperTitle={paper.title}
          sourceLabel={paper.sourceLabel}
          canonicalUrl={paper.canonicalUrl}
          openInAppUrl={openInApp}
          fallbackCitation={`${paper.title}. ${paper.sourceLabel}${paper.proceedingYear ? ` (${paper.proceedingYear})` : ""}.`}
          fallbackOutline={detail.sections.slice(0, 24).flatMap((section) => section.pageStart == null ? [] : [{
            id: section.id,
            title: section.title,
            pageStart: section.pageStart,
            pageEnd: section.pageEnd,
          }])}
        />

        <section className={styles.section}>
          <header><h2>Evidence outline</h2><p>{hasNativeFullText ? "Every outline item resolves to a displayed, rights-verified source page." : "Section labels and page ranges only. Source text stays inside the controlled evidence workflow."}</p></header>
          <ol className={styles.outline}>
            {detail.sections.slice(0, 24).map((section) => (
              <li key={section.id}>
                <span>{section.title}</span>
                <small>{pageRange(section.pageStart, section.pageEnd)}</small>
              </li>
            ))}
          </ol>
        </section>

        {detail.related.length ? (
          <section className={styles.section}>
            <header><h2>Related Thai evidence</h2><p>More page-citable papers in the same research field.</p></header>
            <div className={styles.related}>
              {detail.related.slice(0, 6).map((item) => (
                <Link key={item.id} href={`/papers/${encodeURIComponent(item.source)}`}>
                  <strong>{item.title}</strong>
                  <span>{[item.paperCode, item.sourceLabel, `${item.evidenceCount} evidence chunks`].filter(Boolean).join(" · ")}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <footer className={styles.disclaimer}>Research evidence, not professional advice. Verify the original page before relying on a claim.</footer>
      </article>
    </main>
  );
}
