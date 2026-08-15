import type { Metadata } from "next";
import { ArrowLeft, BookOpenCheck, Braces, Database, Gauge, KeyRound, Network, ShieldCheck } from "lucide-react";

import { MCP_API_SCALE_PREVIEW, MCP_FOUNDER_MONTHLY_UNITS, MCP_FREE_MONTHLY_UNITS, MCP_TOOL_UNIT_PRICING } from "@/lib/mcp-pricing";
import styles from "./developers.module.css";

export const metadata: Metadata = {
  title: "API & MCP | CivilMCP",
  description: "Connect research agents to Thai page-cited civil-engineering evidence through CivilMCP MCP v2.",
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
      <nav className={styles.nav}><a href="/"><ArrowLeft size={15} aria-hidden /> Back to CivilMCP</a><span>Research API</span></nav>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>CivilMCP v2</p>
        <h1>Thai research evidence for any AI agent.</h1>
        <p>Discover local work global indexes miss, retrieve claim-ready pages, and organize a private research library through one bounded MCP endpoint.</p>
        <div className={styles.endpoint}><div><span>Streamable HTTP</span><code>{endpoint}</code></div><a href="/?view=settings">Create personal key</a></div>
      </section>

      <section className={styles.proof} aria-label="CivilMCP API trust model">
        <article><Database size={18} aria-hidden /><strong>Thai-first corpus</strong><span>NCCE and student research plus rights-reviewed Thai journal discovery.</span></article>
        <article><BookOpenCheck size={18} aria-hidden /><strong>Exact-page evidence</strong><span>Evidence packets remain separate from metadata-only discovery records.</span></article>
        <article><ShieldCheck size={18} aria-hidden /><strong>Owner-scoped access</strong><span>Revocable personal keys today; OAuth 2.1 for supported interactive clients.</span></article>
      </section>

      <section className={styles.section} id="pricing">
        <div><p className={styles.eyebrow}>Research Units</p><h2>Predictable API usage, separate from AI credits.</h2><p className={styles.sectionLead}>A unit prices the research workload, not tokens. Failed tool calls are restored automatically.</p></div>
        <div className={styles.pricingGrid}>
          <article><span>Free</span><h3>฿0</h3><strong>{MCP_FREE_MONTHLY_UNITS.toLocaleString()} units / month</strong><p>Personal MCP key, OAuth, exact-page evidence, and private library tools.</p></article>
          <article className={styles.featuredPlan}><span>Founder Pro</span><h3>฿299 <small>/ month</small></h3><strong>{MCP_FOUNDER_MONTHLY_UNITS.toLocaleString()} units / month</strong><p>Included with Founder Pro. The existing 100 weekly + 500 monthly AI credits stay separate.</p></article>
          <article><span>API Scale · preview</span><h3>฿{MCP_API_SCALE_PREVIEW.priceThb.toLocaleString()} <small>/ month</small></h3><strong>{MCP_API_SCALE_PREVIEW.monthlyUnits.toLocaleString()} units / month</strong><p>Planned after paid infrastructure launch; extra {MCP_API_SCALE_PREVIEW.extraUnits.toLocaleString()} units target ฿{MCP_API_SCALE_PREVIEW.extraPriceThb}.</p></article>
        </div>
      </section>

      <section className={styles.unitSchedule} aria-label="Research Unit tool pricing">
        <Gauge size={19} aria-hidden />
        <div><strong>Per successful call</strong><p>{MCP_TOOL_UNIT_PRICING.map((item) => `${item.label} ${item.units}`).join(" · ")}</p></div>
      </section>

      <section className={styles.section}>
        <div><p className={styles.eyebrow}>Connect</p><h2>One endpoint, two secure paths.</h2></div>
        <div className={styles.connectGrid}>
          <article><Network size={19} aria-hidden /><h3>Interactive agents</h3><p>Add the endpoint to an OAuth-capable MCP client. The client opens CivilMCP sign-in and asks for explicit consent.</p><code>{endpoint}</code></article>
          <article><KeyRound size={19} aria-hidden /><h3>CLI and automation</h3><p>Create a personal key in Account and send it as a Bearer token. Keys are displayed once and can be revoked at any time.</p><pre>{`Authorization: Bearer cvmcp_…`}</pre></article>
        </div>
      </section>

      <section className={styles.section}>
        <div><p className={styles.eyebrow}>Public toolset</p><h2>High-level contracts instead of retrieval plumbing.</h2></div>
        <div className={styles.toolList}>{tools.map(([label, names, description]) => <article key={label}><span>{label}</span><div><code>{names}</code><p>{description}</p></div></article>)}</div>
      </section>

      <section className={styles.boundary}>
        <Braces size={21} aria-hidden />
        <div><h2>Evidence and metadata never blur together.</h2><p>Indexed CivilMCP packets may support claims with their returned pages. ThaiJO and OpenAlex records remain discovery metadata until rights, extraction, provenance, and page-mapping gates pass.</p></div>
      </section>

      <footer className={styles.footer}><span>Research evidence, not professional engineering advice.</span><div><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a></div></footer>
    </main>
  );
}
