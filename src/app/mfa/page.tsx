"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Mode = "loading" | "enroll" | "verify";

export default function MfaPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") return router.replace("/app");
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = factors?.totp?.[0]; // listFactors returns only verified TOTP factors in .totp
      if (verified) { setFactorId(verified.id); setMode("verify"); return; }
      // Remove half-finished enrolments so they cannot pile up.
      for (const f of factors?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Autentiseringsapp" });
      if (error || !data) { setError("Kunde inte starta tvåstegsverifiering."); return; }
      setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret); setMode("enroll");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId });
    const { error: e2 } = e1 || !ch ? { error: e1 } : await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
    setBusy(false);
    if (e2) { setError("Koden stämde inte. Försök igen."); setCode(""); return; }
    router.replace("/app"); router.refresh();
  }

  if (mode === "loading") return <p className="muted">{error || "Laddar…"}</p>;
  return (
    <>
      <h1>{mode === "enroll" ? "Ställ in tvåstegsverifiering" : "Ange din kod"}</h1>
      {mode === "enroll" && (
        <>
          <p>Skanna QR-koden med en autentiseringsapp (till exempel Google Authenticator eller Microsoft Authenticator) och skriv sedan in koden den visar.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="qr" src={qr} alt="QR-kod för tvåstegsverifiering" />
          <p className="muted">Fungerar inte skanningen? Ange koden manuellt: <code>{secret}</code></p>
        </>
      )}
      <form onSubmit={submit}>
        <label htmlFor="code">Sexsiffrig kod</label>
        <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" disabled={busy}>{busy ? "Kontrollerar…" : "Bekräfta"}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </>
  );
}
