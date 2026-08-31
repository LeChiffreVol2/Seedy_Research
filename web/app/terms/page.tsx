import type { Metadata } from "next";

import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Terms | Seed Research by SEEDY",
  description: "Terms for the Seed Research public research preview.",
};

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="Terms"
      title="Research evidence, not professional approval."
      intro="Effective August 12, 2026. By using Seed Research by SEEDY, you agree to these terms."
    >
      <section>
        <h2>Preview service</h2>
        <p>Seed Research helps users discover, compare, learn from, and inspect Thai research evidence, then connect it to global scholarly metadata and related work. Features, indexed sources, operational safety limits, and availability may change during the preview. Open Access has no answer-credit, Research Unit, model, or research-workflow plan gates. The service is provided as available and may be suspended to protect users, data, or infrastructure.</p>
      </section>
      <section>
        <h2>No professional advice</h2>
        <p>Outputs are research assistance only. They are not professional, regulatory, clinical, legal, financial, or safety approval. Verify citations on the original page and consult an appropriately qualified professional before making high-impact decisions.</p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>Do not abuse quotas, probe for secrets, bypass access controls, upload unlawful or confidential material, misrepresent generated work, or use the service to make unsupported safety-critical decisions. Automated access must use the documented MCP boundary and valid credentials.</p>
      </section>
      <section>
        <h2>Sources and intellectual property</h2>
        <p>Seed Research source code and third-party research content have separate rights. Paper copyright remains with authors or publishers. Public availability does not itself grant redistribution or commercial reuse rights. Metadata-only records are not presented as citable full-text evidence.</p>
      </section>
      <section>
        <h2>Accounts and access</h2>
        <p>You are responsible for account security. An account is optional for public research workflows and is required only for owner-scoped features such as sync, private sources, and personal API credentials. Paid features are not offered in Open Access.</p>
      </section>
      <section>
        <h2>Requests and disputes</h2>
        <p>Use the Support page for product issues, data requests, copyright notices, or source takedown requests. Include the source URL and enough detail for review; do not include sensitive documents in the request.</p>
      </section>
    </LegalShell>
  );
}
