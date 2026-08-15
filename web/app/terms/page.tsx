import type { Metadata } from "next";

import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Terms | CivilMCP",
  description: "Terms for the CivilMCP public research preview.",
};

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="Terms"
      title="Research evidence, not engineering approval."
      intro="Effective August 12, 2026. By using the CivilMCP public research preview, you agree to these terms."
    >
      <section>
        <h2>Preview service</h2>
        <p>CivilMCP helps users discover, compare, and inspect civil-engineering research. Features, indexed sources, quotas, Research Unit weights, and availability may change during the preview. API Research Units and AI answer credits are separate allowances. The service is provided as available and may be suspended to protect users, data, or infrastructure.</p>
      </section>
      <section>
        <h2>No professional advice</h2>
        <p>Outputs are research assistance only. They are not structural design, certification, code compliance, safety approval, or professional engineering advice. Verify citations on the original page and use a qualified engineer for decisions affecting people, assets, or public safety.</p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>Do not abuse quotas, probe for secrets, bypass access controls, upload unlawful or confidential material, misrepresent generated work, or use the service to make unsupported safety-critical decisions. Automated access must use the documented MCP boundary and valid credentials.</p>
      </section>
      <section>
        <h2>Sources and intellectual property</h2>
        <p>CivilMCP source code and third-party research content have separate rights. Paper copyright remains with authors or publishers. Public availability does not itself grant redistribution or commercial reuse rights. Metadata-only records are not presented as citable full-text evidence.</p>
      </section>
      <section>
        <h2>Accounts and paid features</h2>
        <p>You are responsible for account security. Paid features are not offered while the production deployment remains on non-commercial Hobby hosting. If billing is enabled later, checkout terms, cancellation, and credit validity will be shown before purchase.</p>
      </section>
      <section>
        <h2>Requests and disputes</h2>
        <p>Use the Support page for product issues, data requests, copyright notices, or source takedown requests. Include the source URL and enough detail for review; do not include sensitive documents in the request.</p>
      </section>
    </LegalShell>
  );
}
