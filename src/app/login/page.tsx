"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <>
      <h1>Logga in</h1>
      <form action={action}>
        <label htmlFor="email">E-post</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">Lösenord</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button type="submit" disabled={pending}>{pending ? "Loggar in…" : "Logga in"}</button>
        {state?.error && <p className="error" role="alert">{state.error}</p>}
      </form>
    </>
  );
}
