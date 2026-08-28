import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { ApiV1Error, parseOk, requestApiV1 } from "./http";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const echoSchema = z.object({ ok: z.literal(true), value: z.string() });

describe("requestApiV1", () => {
  it("sends no body and no Content-Type for a GET with no body argument", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: "x" }));

    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("sends a JSON body and Content-Type for a call with a body argument", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: "x" }));

    await requestApiV1("POST", "/api/v1/x", { a: 1 }, (json) => echoSchema.parse(json), { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ a: 1 });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("prefixes baseUrl onto the path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: "x" }));

    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), {
      fetchImpl,
      baseUrl: "https://smartcard.tech",
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://smartcard.tech/api/v1/x", expect.anything());
  });

  it("omits Authorization entirely for an empty-string token, not a malformed empty Bearer header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: "x" }));

    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), {
      fetchImpl,
      accessToken: "",
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("sends the token a static accessToken supplies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: "x" }));

    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), {
      fetchImpl,
      accessToken: "static-token",
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer static-token");
  });

  it("asks getToken at request time and sends what it answers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: "x" }));
    const getToken = vi.fn().mockResolvedValue("fresh-token");

    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), {
      fetchImpl,
      getToken,
    });

    expect(getToken).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer fresh-token");
  });

  it("prefers the live getToken answer over a stale static accessToken when both are given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: "x" }));

    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), {
      fetchImpl,
      accessToken: "stale-token",
      getToken: async () => "fresh-token",
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer fresh-token");
  });

  it("re-asks getToken on every request rather than caching the first answer", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true, value: "x" })));
    const getToken = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const opts = { fetchImpl, getToken };

    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), opts);
    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), opts);

    const headerOf = (call: number) =>
      ((fetchImpl.mock.calls[call] as [string, RequestInit])[1].headers as Record<string, string>)[
        "Authorization"
      ];
    expect(headerOf(0)).toBe("Bearer first");
    expect(headerOf(1)).toBe("Bearer second");
  });

  it("sends no Authorization header when getToken answers null", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: "x" }));

    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), {
      fetchImpl,
      getToken: async () => null,
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("lets a getToken failure propagate unchanged instead of disguising it as a transport error", async () => {
    const fetchImpl = vi.fn();
    const boom = new Error("secure store unavailable");

    await expect(
      requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), {
        fetchImpl,
        getToken: async () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);

    // No request was attempted, so calling this "couldn't reach SmartCard" would be a lie.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the ID token as X-Kinde-Id-Token when a provider supplies one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: "x" }));

    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), {
      fetchImpl,
      getToken: async () => "access",
      getIdToken: async () => "id-token",
    });

    const headers = (fetchImpl.mock.calls[0] as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;
    expect(headers["X-Kinde-Id-Token"]).toBe("id-token");
    expect(headers["Authorization"]).toBe("Bearer access");
  });

  it("omits X-Kinde-Id-Token entirely when there is no provider or it answers null", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true, value: "x" })));

    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), {
      fetchImpl,
      getToken: async () => "access",
    });
    await requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), {
      fetchImpl,
      getToken: async () => "access",
      getIdToken: async () => null,
    });

    for (const call of [0, 1]) {
      const headers = (fetchImpl.mock.calls[call] as [string, RequestInit])[1].headers as Record<
        string,
        string
      >;
      expect(headers["X-Kinde-Id-Token"]).toBeUndefined();
    }
  });

  it("classifies a non-JSON body as unreachable rather than throwing a raw SyntaxError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(
      requestApiV1("GET", "/api/v1/x", undefined, (json) => echoSchema.parse(json), { fetchImpl }),
    ).rejects.toBeInstanceOf(ApiV1Error);
  });

  it("classifies a body matching neither the success nor the failure shape as unreachable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { something: "unexpected" }));

    const error = await requestApiV1(
      "GET",
      "/api/v1/x",
      undefined,
      (json) => echoSchema.parse(json),
      { fetchImpl },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiV1Error);
    expect((error as ApiV1Error).message).toMatch(/couldn't reach/i);
  });
});

describe("parseOk", () => {
  it("accepts the bare success envelope", () => {
    expect(() => parseOk({ ok: true })).not.toThrow();
  });

  it("rejects anything else, including a well-formed failure shape", () => {
    expect(() => parseOk({ ok: false, message: "no" })).toThrow();
    expect(() => parseOk({})).toThrow();
  });
});
