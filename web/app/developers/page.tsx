import type { Metadata } from "next";
import { ArrowLeft, BookOpenCheck, Braces, Database, Gauge, KeyRound, Network, ShieldCheck } from "lucide-react";

import styles from "./developers.module.css";

export const metadata: Metadata = {
  title: "SeedyMCP & Research API | Seedy Research",
  description: "Collaborate with browser agents through SeedyMCP or connect independent clients to Thai page-cited evidence through the Seedy Research MCP API.",
};

const endpoint = "https://civil-mcp-server.vercel.app/v2/mcp";

const tools = [
  ["Discover", "discover_research · map_citation_network", "Find Thai evidence and bounded global metadata with citable status on every result."],
  ["Read", "get_paper · query_papers · compare_papers · get_evidence_snapshot", "Retrieve exact-page packets and build auditable comparison matrices."],
  ["Private", "list_private_sources", "List account-private PDF sources without making them public or shareable."],
  ["Library", "list_library · save_papers · move_papers · remove_papers", "Keep an owner-scoped reading workflow across authorized clients."],
  ["Folders", "create_library_folder · rename_library_folder · delete_library_folder", "Organize the library while preserving saved papers when a folder is deleted."],
];

export default function DevelopersPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}><a href="/"><ArrowLeft size={15} aria-hidden /> Back to SEEDY</a><span>WebMCP + Research API</span></nav>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>SEEDY · Seedy Research</p>
        <h1>Thai research evidence for people and agents.</h1>
        <p>Collaborate with an agent in the live page through seven browser-native SeedyMCP tools—including a dated Thai–global visibility audit, an evidence-bounded Research Passport, and a fail-closed OpenAlex connection trace—or connect an independent research client to the bounded remote MCP endpoint.</p>
        <div className={styles.endpoint}><div><span>Streamable HTTP</span><code>{endpoint}</code></div><a href="/?view=settings">Create personal key</a></div>
      </section>

      <section className={styles.proof} aria-label="Seedy Research API trust model">
        <article><Database size={18} aria-hidden /><strong>Thai-first corpus</strong><span>NCCE and student research plus reviewed-source Thai journal metadata.</span></article>
        <article><BookOpenCheck size={18} aria-hidden /><strong>Exact-page evidence</strong><span>Evidence packets remain separate from metadata-only discovery records.</span></article>
        <article><ShieldCheck size={18} aria-hidden /><strong>Owner-scoped access</strong><span>Revocable personal keys today; OAuth 2.1 for supported interactive clients.</span></article>
      </section>

      <section className={styles.section}>
        <div><p className={styles.eyebrow}>Two agent surfaces</p><h2>Share the page, or work remotely.</h2><p className={styles.sectionLead}>WebMCP and remote MCP reuse the same evidence rules but solve different jobs.</p></div>
        <div className={styles.connectGrid}>
          <article><Network size={19} aria-hidden /><h3>SeedyMCP · shared browser</h3><p>Open Explore with ChatGPT or Chrome. Six site tools discover research, open exact-page evidence, trace guarded global connections, build a Research Path, draft a review-gated Passport, and inspect progress while the person verifies the same page.</p><a href="/?view=explore">Open the SeedyMCP research surface</a></article>
          <article><Braces size={19} aria-hidden /><h3>Remote MCP · independent client</h3><p>Use the stateless endpoint for agents that need research and library tools without an open Seedy Research page.</p><code>{endpoint}</code></article>
        </div>
      </section>

      <section className={styles.section} id="access">
        <div><p className={styles.eyebrow}>Open Access</p><h2>The complete research API is unlocked.</h2><p className={styles.sectionLead}>There are no Research Unit or paid-plan gates. Sign in to create a revocable personal key and protect owner-scoped data.</p></div>
        <div className={styles.pricingGrid}>
          <article className={styles.featuredPlan}><span>Research API</span><h3>฿0</h3><strong>All 14 tools</strong><p>Discovery, comparison, exact-page evidence, citation mapping, and library workflows.</p></article>
          <article><span>Identity</span><h3>Yours</h3><strong>Revocable access</strong><p>Personal keys are shown once, hashed at rest, owner-scoped, and independently revocable.</p></article>
          <article><span>Reliability</span><h3>Bounded</h3><strong>Stable by design</strong><p>Per-client rate limits and fixed tool/evidence budgets protect availability without creating a paid tier.</p></article>
        </div>
      </section>

      <section className={styles.unitSchedule} aria-label="Research API reliability limits">
        <Gauge size={19} aria-hidden />
        <div><strong>Operational guardrails only</strong><p>Safety rate limits, exact-page evidence allow lists, and bounded context keep public access auditable and reliable.</p></div>
      </section>

      <section className={styles.section}>
        <div><p className={styles.eyebrow}>Connect</p><h2>One endpoint, two secure paths.</h2></div>
        <div className={styles.connectGrid}>
          <article><Network size={19} aria-hidden /><h3>Interactive agents</h3><p>Add the endpoint to an OAuth-capable MCP client. The client opens SEEDY sign-in and asks for explicit consent.</p><code>{endpoint}</code></article>
          <article><KeyRound size={19} aria-hidden /><h3>CLI and automation</h3><p>Create a personal key in Account and send it as a Bearer token. Keys are displayed once and can be revoked at any time.</p><pre>{`Authorization: Bearer cvmcp_…`}</pre></article>
        </div>
      </section>

      <section className={styles.section}>
        <div><p className={styles.eyebrow}>Public toolset</p><h2>High-level contracts instead of retrieval plumbing.</h2></div>
        <div className={styles.toolList}>{tools.map(([label, names, description]) => <article key={label}><span>{label}</span><div><code>{names}</code><p>{description}</p></div></article>)}</div>
      </section>

      <section className={styles.boundary}>
        <Braces size={21} aria-hidden />
        <div><h2>Evidence and metadata never blur together.</h2><p>Indexed Seedy Research packets may support claims with their returned pages. ThaiJO and OpenAlex records remain discovery metadata until rights, extraction, provenance, and page-mapping gates pass.</p></div>
      </section>

      <footer className={styles.footer}><span>Research evidence, not professional advice.</span><div><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a></div></footer>
    </main>
  );
}
