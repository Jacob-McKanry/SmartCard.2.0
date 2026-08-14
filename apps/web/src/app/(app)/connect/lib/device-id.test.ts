import { describe, expect, it } from "vitest";

import { getOrCreateDeviceId, type KeyValueStorage } from "./device-id";

function fakeStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("getOrCreateDeviceId", () => {
  it("generates and persists an id on first use", () => {
    const storage = fakeStorage();
    const id = getOrCreateDeviceId(storage, () => "generated-id");
    expect(id).toBe("generated-id");
    expect(storage.getItem("smartcard.connect.deviceId")).toBe("generated-id");
  });

  it("reuses a stored id rather than generating a new one", () => {
    const storage = fakeStorage({ "smartcard.connect.deviceId": "already-there" });
    const generateId = () => {
      throw new Error("must not be called when a value already exists");
    };
    expect(getOrCreateDeviceId(storage, generateId)).toBe("already-there");
  });

  it("treats a blank stored value as absent", () => {
    const storage = fakeStorage({ "smartcard.connect.deviceId": "   " });
    expect(getOrCreateDeviceId(storage, () => "fresh")).toBe("fresh");
  });

  it("is stable across repeated calls against the same storage", () => {
    const storage = fakeStorage();
    let calls = 0;
    const generateId = () => {
      calls += 1;
      return `id-${calls}`;
    };
    const first = getOrCreateDeviceId(storage, generateId);
    const second = getOrCreateDeviceId(storage, generateId);
    expect(first).toBe(second);
    expect(calls).toBe(1);
  });
});
