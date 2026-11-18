import { describe, expect, it } from "vitest";
import { destinationFor } from "../../src/lib/auth-state";

describe("destinationFor (2FA gate)", () => {
  it("sends anonymous users to login", () => expect(destinationFor(false, null)).toBe("/login"));
  it("never lets a password-only session through", () => expect(destinationFor(true, "aal1")).toBe("/mfa"));
  it("treats an unknown level as not verified", () => { expect(destinationFor(true, null)).toBe("/mfa"); expect(destinationFor(true, undefined)).toBe("/mfa"); });
  it("lets a verified session through", () => expect(destinationFor(true, "aal2")).toBe("ok"));
  it("a missing user wins over a stale aal2", () => expect(destinationFor(false, "aal2")).toBe("/login"));
});
