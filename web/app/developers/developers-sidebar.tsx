"use client";

import { useEffect, useState } from "react";

import styles from "./developers.module.css";

const sections = [
  ["overview", "Overview"],
  ["trust", "Trust model"],
  ["webmcp", "WebMCP surfaces"],
  ["webmcp-tools", "Browser tools"],
  ["access", "Access"],
  ["connect", "Connect"],
  ["remote-tools", "Remote API tools"],
  ["evidence-boundary", "Evidence boundary"],
] as const;

type SectionId = (typeof sections)[number][0];

export function DevelopersSidebar() {
  const [activeSection, setActiveSection] = useState<SectionId>(sections[0][0]);

  useEffect(() => {
    const updateActiveSection = () => {
      const threshold = window.innerHeight * 0.28;
      let nextSection: SectionId = sections[0][0];

      for (const [id] of sections) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= threshold) nextSection = id;
      }

      setActiveSection(nextSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, []);

  return (
    <aside className={styles.sidebar}>
      <p>On this page</p>
      <nav aria-label="Developer page sections">
        {sections.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={activeSection === id ? "location" : undefined}
          >
            <span aria-hidden />
            {label}
          </a>
        ))}
      </nav>
      <a className={styles.sidebarAction} href="/?view=explore">Open live WebMCP</a>
    </aside>
  );
}
