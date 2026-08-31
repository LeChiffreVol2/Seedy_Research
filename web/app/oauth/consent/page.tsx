"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { ArrowLeft, Check, Database, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import styles from "./consent.module.css";

type ViewState = "loading" | "signin" | "consent" | "error";
type AuthMode = "signin" | "signup";

function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

export default function OAuthConsentPage() {
  const supabase = useMemo(browserClient, []);
  const [state, setState] = useState<ViewState>("loading");
  const [authorizationId, setAuthorizationId] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id || id.length > 256) {
      setMessage("This authorization request is invalid or has expired.");
      setState("error");
      return;
    }
    if (!supabase) {
      setMessage("Authorization is temporarily unavailable.");
      setState("error");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setState("signin");
      return;
    }
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
    if (error || !data) {
      setMessage("This authorization request is invalid or has expired.");
      setState("error");
      return;
    }
    if ("redirect_url" in data) {
      window.location.assign(data.redirect_url);
      return;
    }
    setDetails(data);
    setState("consent");
  }, [supabase]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("authorization_id")?.trim() ?? "";
    setAuthorizationId(id);
    void load(id);
  }, [load]);

  const signInWithGoogle = async () => {
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", next);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      setMessage(error?.message ?? "Google sign-in is unavailable.");
      setBusy(false);
      return;
    }
    window.location.assign(data.url);
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const response = authMode === "signup"
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    const { error } = response;
    if (error) {
      setMessage(authMode === "signup" ? "Account creation is temporarily unavailable." : "Email or password is incorrect.");
      setBusy(false);
      return;
    }
    if (authMode === "signup" && !response.data.session) {
      setMessage("Check your email to confirm your account, then return to this authorization request.");
      setBusy(false);
      return;
    }
    await load(authorizationId);
    setBusy(false);
  };

  const decide = async (approved: boolean) => {
    if (!details || !supabase) return;
    setBusy(true);
    setMessage("");
    const response = approved
      ? await supabase.auth.oauth.approveAuthorization(details.authorization_id, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(details.authorization_id, { skipBrowserRedirect: true });
    if (response.error || !response.data?.redirect_url) {
      setMessage(response.error?.message ?? "SEEDY could not complete authorization.");
      setBusy(false);
      return;
    }
    window.location.assign(response.data.redirect_url);
  };

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="consent-title">
        <a className={styles.back} href="/"><ArrowLeft size={15} aria-hidden /> SEEDY</a>
        <header className={styles.header}>
          <div className={styles.mark}><ShieldCheck size={24} aria-hidden /></div>
          <div><span>Secure connection</span><h1 id="consent-title">Connect to Seed Research</h1></div>
        </header>

        {state === "loading" ? <p className={styles.status}>Checking authorization…</p> : null}

        {state === "signin" ? (
          <div className={styles.content}>
            <p>Sign in to approve access to your research library.</p>
            <button className={styles.google} type="button" onClick={() => void signInWithGoogle()} disabled={busy}>Continue with Google</button>
            <div className={styles.divider}><span>or use email</span></div>
            <form onSubmit={(event) => void submitPassword(event)}>
              <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <label>Password<input type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              <button className={styles.primary} type="submit" disabled={busy}>{busy ? "Please wait…" : authMode === "signup" ? "Create account" : "Sign in"}</button>
            </form>
            <p className={styles.secondary}>{authMode === "signup" ? "Already have an account?" : "New to SEEDY?"} <button type="button" onClick={() => { setAuthMode(authMode === "signup" ? "signin" : "signup"); setMessage(""); }}>{authMode === "signup" ? "Sign in" : "Create account"}</button></p>
          </div>
        ) : null}

        {state === "consent" && details ? (
          <div className={styles.content}>
            <div className={styles.client}>
              <div className={styles.clientIcon}><Database size={20} aria-hidden /></div>
              <div><span>Request from</span><strong>{details.client.name || "Research client"}</strong><small>{details.redirect_uri}</small></div>
            </div>
            <p>This client will be able to:</p>
            <ul className={styles.permissions}>
              <li><Check size={16} aria-hidden /><span>Search Thai and global research metadata</span></li>
              <li><Check size={16} aria-hidden /><span>Read exact-page Seed Research evidence and your private PDFs</span></li>
              <li><Check size={16} aria-hidden /><span>Organize papers in your private library</span></li>
            </ul>
            <div className={styles.trust}><ShieldCheck size={16} aria-hidden /><span>The client never receives your Google password or SEEDY service keys. You can revoke access from Account.</span></div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => void decide(false)} disabled={busy}>Deny</button>
              <button type="button" className={styles.primary} onClick={() => void decide(true)} disabled={busy}>{busy ? "Connecting…" : "Allow access"}</button>
            </div>
          </div>
        ) : null}

        {state === "error" ? <div className={styles.content}><p className={styles.error}>{message}</p><a className={styles.primaryLink} href="/developers">Return to API setup</a></div> : null}
        {message && state !== "error" ? <p className={styles.error} role="alert">{message}</p> : null}
      </section>
    </main>
  );
}
