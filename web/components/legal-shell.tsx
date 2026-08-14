import Link from "next/link";
import type { ReactNode } from "react";

export function LegalShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="legalPage">
      <nav className="legalNav" aria-label="CivilMCP legal and support">
        <Link className="legalBrand" href="/">CivilMCP</Link>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/support">Support</Link>
        </div>
      </nav>
      <article className="legalCard">
        <header>
          <p>{eyebrow}</p>
          <h1>{title}</h1>
          <span>{intro}</span>
        </header>
        <div className="legalContent">{children}</div>
      </article>
    </main>
  );
}
