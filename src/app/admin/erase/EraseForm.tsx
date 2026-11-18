"use client";
import { useActionState } from "react";
import { erasePersonAction } from "../actions";

export default function EraseForm({ tenant }: { tenant: string }) {
  const [state, action, pending] = useActionState(erasePersonAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="tenant" value={tenant} />
      <label htmlFor="email">E-postadress som ska raderas</label>
      <input id="email" name="email" type="email" required autoComplete="off" />
      <label htmlFor="confirm">Skriv RADERA för att bekräfta</label>
      <input id="confirm" name="confirm" required autoComplete="off" />
      <button className="danger" type="submit" disabled={pending}>{pending ? "Raderar…" : "Radera helt"}</button>
      {state && "error" in state && <p className="error" role="alert">{state.error}</p>}
      {state && "done" in state && <p className="notice" role="status">Klart. Borttaget: {state.subscribers} adress(er), {state.suppressions} spärrnotering(ar), {state.events} leverantörshändelse(r).</p>}
    </form>
  );
}
