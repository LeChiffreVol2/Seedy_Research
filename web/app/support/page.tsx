"use client";

import { FormEvent, useState } from "react";

import { LegalShell } from "@/components/legal-shell";

type SupportCategory = "product_support" | "data_request" | "account_deletion" | "source_takedown" | "copyright";

export default function SupportPage() {
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<SupportCategory>("product_support");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [statusText, setStatusText] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setStatusText("");
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, category, subject, message, sourceUrl }),
      });
      const payload = await response.json() as { error?: string; requestId?: string };
      if (!response.ok) throw new Error(payload.error ?? "Request failed.");
      setStatus("sent");
      setStatusText(`Request received · ${payload.requestId}`);
      setSubject("");
      setMessage("");
      setSourceUrl("");
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : "Request failed.");
    }
  };

  return (
    <LegalShell
      eyebrow="Support"
      title="Send a tracked request."
      intro="Use this form for product support, privacy requests, account-deletion problems, copyright notices, or source takedowns."
    >
      <form className="supportForm" onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label>
        <label>Request type
          <select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)}>
            <option value="product_support">Product support</option>
            <option value="data_request">Privacy or data request</option>
            <option value="account_deletion">Account deletion issue</option>
            <option value="source_takedown">Source takedown</option>
            <option value="copyright">Copyright notice</option>
          </select>
        </label>
        <label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} required minLength={3} maxLength={160} /></label>
        <label>Source URL <small>Required for source or copyright requests</small><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} maxLength={1000} /></label>
        <label>Details<textarea value={message} onChange={(event) => setMessage(event.target.value)} required minLength={10} maxLength={4000} rows={7} /></label>
        <button type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send request"}</button>
        {statusText ? <p className={status === "error" ? "supportError" : "supportStatus"} role={status === "error" ? "alert" : "status"}>{statusText}</p> : null}
      </form>
    </LegalShell>
  );
}
