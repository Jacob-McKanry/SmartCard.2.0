import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MissingEnvVarError,
  UnsafeEnvVarError,
  apiUrl,
  kindeClientId,
  kindeDomain,
  requireHttpsUrl,
} from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("kindeDomain", () => {
  it("returns a well-formed https domain", () => {
    vi.stubEnv("EXPO_PUBLIC_KINDE_DOMAIN", "https://smartcard.kinde.com");
    expect(kindeDomain()).toBe("https://smartcard.kinde.com");
  });

  it("refuses to be missing rather than defaulting to something", () => {
    vi.stubEnv("EXPO_PUBLIC_KINDE_DOMAIN", "");
    expect(() => kindeDomain()).toThrow(MissingEnvVarError);
  });

  it("refuses cleartext even for a local host, because Kinde is always remote", () => {
    vi.stubEnv("EXPO_PUBLIC_KINDE_DOMAIN", "http://localhost:3000");
    expect(() => kindeDomain()).toThrow(UnsafeEnvVarError);
  });
});

describe("kindeClientId", () => {
  it("returns the id and trims incidental whitespace", () => {
    vi.stubEnv("EXPO_PUBLIC_KINDE_CLIENT_ID", "  abc123  ");
    expect(kindeClientId()).toBe("abc123");
  });

  it("treats whitespace-only as missing, not as a value", () => {
    vi.stubEnv("EXPO_PUBLIC_KINDE_CLIENT_ID", "   ");
    expect(() => kindeClientId()).toThrow(MissingEnvVarError);
  });
});

describe("apiUrl", () => {
  it("accepts https and strips a trailing slash so paths do not double up", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://smartcard.tech/");
    expect(apiUrl()).toBe("https://smartcard.tech");
  });

  it("allows cleartext to a laptop on the same network, which is the dev case", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "http://192.168.1.20:3000");
    expect(apiUrl()).toBe("http://192.168.1.20:3000");
  });

  it("allows cleartext to loopback", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "http://localhost:3000");
    expect(apiUrl()).toBe("http://localhost:3000");
  });

  it("REFUSES cleartext to a routable host — the token would be readable in transit", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "http://smartcard.tech");
    expect(() => apiUrl()).toThrow(UnsafeEnvVarError);
  });

  it("refuses a public IP over cleartext, not just a public hostname", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "http://8.8.8.8");
    expect(() => apiUrl()).toThrow(UnsafeEnvVarError);
  });

  it("refuses something that is not a URL at all", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "smartcard.tech");
    expect(() => apiUrl()).toThrow(UnsafeEnvVarError);
  });
});

describe("requireHttpsUrl's private-range boundaries", () => {
  const cleartext = (value: string) =>
    requireHttpsUrl(value, "TEST_VAR", "test", { allowLocalCleartext: true });

  it("accepts the edges of every RFC 1918 range", () => {
    expect(cleartext("http://10.0.0.1")).toBe("http://10.0.0.1");
    expect(cleartext("http://172.16.0.1")).toBe("http://172.16.0.1");
    expect(cleartext("http://172.31.255.255")).toBe("http://172.31.255.255");
    expect(cleartext("http://192.168.0.1")).toBe("http://192.168.0.1");
  });

  it("rejects the addresses just outside the 172.16/12 range, which look private but are not", () => {
    expect(() => cleartext("http://172.15.0.1")).toThrow(UnsafeEnvVarError);
    expect(() => cleartext("http://172.32.0.1")).toThrow(UnsafeEnvVarError);
  });

  it("does not treat a public host that merely starts with private digits as private", () => {
    // 10.0.0.1.evil.com is a routable name, not the 10/8 range.
    expect(() => cleartext("http://10.0.0.1.evil.com")).toThrow(UnsafeEnvVarError);
  });
});
