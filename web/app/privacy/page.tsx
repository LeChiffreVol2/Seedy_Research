import type { Metadata } from "next";

import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Privacy | Seedy Research",
  description: "How Seedy Research handles account, research, and usage data.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="Privacy"
      title="Your research data stays tied to your account."
      intro="Effective August 12, 2026. Seedy Research is a public research preview, and this notice describes the data needed to operate it."
    >
      <section>
        <h2>What we store</h2>
        <p>We store your account name and email, chat sessions, saved papers, notes, research workspaces, feedback, plan and credit records, and security or performance metadata needed to run the service. Guest sessions use signed cookies and may be stored so the product can continue across requests.</p>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>We use this data to authenticate you, sync your work, retrieve cited research, generate requested outputs, prevent abuse, support users, diagnose failures, and improve answer quality. We do not sell personal data.</p>
      </section>
      <section>
        <h2>Service providers</h2>
        <p>Supabase provides authentication and database storage; Vercel hosts the web and API services; configured AI providers process prompts needed to generate answers or translations; Stripe processes billing when paid plans are enabled; and OpenAlex may receive a research topic for global metadata discovery. Provider handling is governed by their own terms.</p>
      </section>
      <section>
        <h2>Retention and sharing</h2>
        <p>Chat and workspace content remains until you delete it or your account. Operational trace content and negative-feedback snapshots are scheduled to expire after 30 days. Shared links expire after 30 days and can be revoked. Do not place confidential, regulated, or personally identifying third-party data in research prompts.</p>
      </section>
      <section>
        <h2>Your controls</h2>
        <p>You can delete chats, revoke share links, export work, and permanently delete your account from Account settings. For access, correction, deletion problems, copyright, or source takedown requests, submit a tracked request through the Support page.</p>
      </section>
    </LegalShell>
  );
}
