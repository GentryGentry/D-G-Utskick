import { describe, expect, it } from "vitest";
import { emailHash, isValidEmail, maskEmail, normalizeEmail } from "../../src/lib/email";

describe("normalizeEmail", () => {
  it("trims, lowercases and applies NFC", () => {
    expect(normalizeEmail("  Boende@Example.COM ")).toBe("boende@example.com");
    expect(normalizeEmail("åsa@example.com")).toBe("åsa@example.com");
  });
});
describe("isValidEmail", () => {
  it.each(["foo@", "@bar", "", "a b@example.com", "a@b@c"])("rejects %j", (v) => expect(isValidEmail(v)).toBe(false));
  it.each(["a+tag@example.com", "x@bostäder.example.org"])("accepts %j", (v) => expect(isValidEmail(v)).toBe(true));
  it("rejects header injection", () => expect(isValidEmail("a@example.com\r\nBcc: x@y.z")).toBe(false));
});
describe("maskEmail", () => {
  it("masks", () => expect(maskEmail("anna@example.com")).toBe("a***@example.com"));
  it("never throws or leaks on junk", () => {
    expect(maskEmail("nonsense")).toBe("***");
    expect(maskEmail("")).toBe("***");
  });
});
describe("emailHash", () => {
  it("is stable across formatting, differs by key", () => {
    expect(emailHash(" A@Example.com", "k1")).toBe(emailHash("a@example.com", "k1"));
    expect(emailHash("a@example.com", "k1")).not.toBe(emailHash("a@example.com", "k2"));
  });
  it("refuses an empty key", () => expect(() => emailHash("a@example.com", "")).toThrow());
});
