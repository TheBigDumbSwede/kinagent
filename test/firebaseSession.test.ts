import { describe, expect, it } from "vitest";
import { applySetCookieHeaders, buildCookieHeader, type BrowserStorageState } from "../src/auth/firebaseSession.js";

describe("Firebase session cookie helpers", () => {
  it("applies refreshed Set-Cookie values to saved browser state", () => {
    const storageState: BrowserStorageState = {
      cookies: [
        {
          name: "session",
          value: "old",
          domain: ".kindroid.ai",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Lax"
        }
      ],
      origins: []
    };

    const updates = applySetCookieHeaders(
      storageState,
      [
        "session=new; Domain=.kindroid.ai; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax",
        "theme=dark; Path=/app; SameSite=Strict"
      ],
      "https://kindroid.ai/app/home"
    );

    expect(updates).toBe(2);
    expect(buildCookieHeader(storageState, "api.kindroid.ai")).toContain("session=new");
    expect(buildCookieHeader(storageState, "kindroid.ai")).toContain("theme=dark");
  });

  it("removes expired Set-Cookie values from saved browser state", () => {
    const storageState: BrowserStorageState = {
      cookies: [{ name: "session", value: "old", domain: "kindroid.ai", path: "/" }],
      origins: []
    };

    const updates = applySetCookieHeaders(storageState, ["session=deleted; Path=/; Max-Age=0"], "https://kindroid.ai/");

    expect(updates).toBe(1);
    expect(buildCookieHeader(storageState, "kindroid.ai")).toBeNull();
  });
});
