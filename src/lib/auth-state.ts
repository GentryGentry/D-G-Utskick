/** Pure routing rule for the login flow, kept separate so it can be unit tested. */
export type Aal = string | null | undefined;
export type AuthDestination = "/login" | "/mfa" | "ok";

/** Two-step verification (TOTP) is required for every user (DECISIONS D-011).
 *  Anything short of a confirmed aal2 session never reaches the app. */
export function destinationFor(loggedIn: boolean, currentLevel: Aal): AuthDestination {
  if (!loggedIn) return "/login";
  return currentLevel === "aal2" ? "ok" : "/mfa";
}
