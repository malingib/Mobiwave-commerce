import { afterEach, describe, it } from "node:test";
import { expect } from "expect";
import { fn } from "jest-mock";

const originalGlobals = new Map<string, { hadOwn: boolean; value: unknown }>();
const originalEnvs = new Map<string, string | undefined>();

function stubGlobal(name: string, value: unknown) {
  const target = globalThis as unknown as Record<string, unknown>;
  if (!originalGlobals.has(name)) {
    originalGlobals.set(name, { hadOwn: Object.prototype.hasOwnProperty.call(target, name), value: target[name] });
  }
  target[name] = value;
}

function unstubAllGlobals() {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const [name, original] of originalGlobals) {
    if (original.hadOwn) target[name] = original.value;
    else delete target[name];
  }
  originalGlobals.clear();
}

function stubEnv(name: string, value: string) {
  if (!originalEnvs.has(name)) originalEnvs.set(name, process.env[name]);
  process.env[name] = value;
}

function unstubAllEnvs() {
  for (const [name, value] of originalEnvs) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  originalEnvs.clear();
}

export const vi = { fn, stubGlobal, unstubAllGlobals, stubEnv, unstubAllEnvs };
export { afterEach, describe, expect, it };
