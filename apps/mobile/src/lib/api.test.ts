import { describe, expect, it, vi } from "vitest";

import { buildApiOptions } from "./api";

describe("buildApiOptions", () => {
  it("passes the base URL through so wrappers build absolute URLs", () => {
    const options = buildApiOptions("https://smartcard.tech", {
      getAccessToken: async () => "a",
      getIdToken: async () => "i",
    });

    expect(options.baseUrl).toBe("https://smartcard.tech");
  });

  it("defers to the session for both tokens rather than capturing their values", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("access-1");
    const getIdToken = vi.fn().mockResolvedValue("id-1");

    const options = buildApiOptions("https://smartcard.tech", { getAccessToken, getIdToken });

    // Building the options must not have read anything yet — that is the whole
    // point of a provider over a value.
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdToken).not.toHaveBeenCalled();

    await expect(options.getToken?.()).resolves.toBe("access-1");
    await expect(options.getIdToken?.()).resolves.toBe("id-1");
  });

  it("sees a refreshed token on a later call, because it re-asks every time", async () => {
    const getAccessToken = vi.fn().mockResolvedValueOnce("stale").mockResolvedValueOnce("refreshed");

    const options = buildApiOptions("https://smartcard.tech", {
      getAccessToken,
      getIdToken: async () => null,
    });

    await expect(options.getToken?.()).resolves.toBe("stale");
    await expect(options.getToken?.()).resolves.toBe("refreshed");
  });

  it("keeps the session object as the receiver, so a method using `this` still works", async () => {
    // @kinde/expo's hook returns an object; passing its methods around
    // detached is how `this` gets lost. The builder wraps rather than passes.
    const session = {
      token: "from-this",
      async getAccessToken(this: { token: string }): Promise<string | null> {
        return this.token;
      },
      async getIdToken(): Promise<string | null> {
        return null;
      },
    };

    const options = buildApiOptions("https://smartcard.tech", session);

    await expect(options.getToken?.()).resolves.toBe("from-this");
  });

  it("passes a null token straight through rather than inventing an empty string", async () => {
    const options = buildApiOptions("https://smartcard.tech", {
      getAccessToken: async () => null,
      getIdToken: async () => null,
    });

    await expect(options.getToken?.()).resolves.toBeNull();
  });
});
