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
