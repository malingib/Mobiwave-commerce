import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

type AnyFunction = (...args: any[]) => any;
type MockFunction<T extends AnyFunction> = T & {
  mock: { calls: Parameters<T>[] };
  mockImplementation(implementation: T): MockFunction<T>;
  mockResolvedValue(value: unknown): MockFunction<T>;
  mockRejectedValue(value: unknown): MockFunction<T>;
  mockResolvedValueOnce(value: unknown): MockFunction<T>;
  mockRejectedValueOnce(value: unknown): MockFunction<T>;
};

function fn<T extends AnyFunction = AnyFunction>(implementation?: T): MockFunction<T> {
  const calls: Parameters<T>[] = [];
  const once: Array<(...args: Parameters<T>) => ReturnType<T>> = [];
  let current: (...args: Parameters<T>) => ReturnType<T> =
    implementation || (() => undefined as ReturnType<T>);
  const mock = ((...args: Parameters<T>) => {
    calls.push(args);
    const next = once.shift();
    return (next || current)(...args);
  }) as MockFunction<T>;
  mock.mock = { calls };
  mock.mockImplementation = (next: T) => { current = next; return mock; };
  mock.mockResolvedValue = (value: unknown) => {
    current = (() => Promise.resolve(value)) as (...args: Parameters<T>) => ReturnType<T>;
    return mock;
  };
  mock.mockRejectedValue = (value: unknown) => {
    current = (() => Promise.reject(value)) as (...args: Parameters<T>) => ReturnType<T>;
    return mock;
  };
  mock.mockResolvedValueOnce = (value: unknown) => {
    once.push((() => Promise.resolve(value)) as (...args: Parameters<T>) => ReturnType<T>);
    return mock;
  };
  mock.mockRejectedValueOnce = (value: unknown) => {
    once.push((() => Promise.reject(value)) as (...args: Parameters<T>) => ReturnType<T>);
    return mock;
  };
  return mock;
}

function partialMatch(actual: any, expected: any): boolean {
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (actual === null || typeof actual !== "object") return false;
  return Object.keys(expected).every(key => partialMatch(actual[key], expected[key]));
}

function expect(actual: any): any {
  const make = (negated = false): any => {
    const check = (pass: boolean, message: string) => {
      if (negated ? pass : !pass) throw new assert.AssertionError({ message });
    };
    const promiseMatchers = {
      toBe: async (expected: unknown) => expect(await actual).toBe(expected),
      toEqual: async (expected: unknown) => expect(await actual).toEqual(expected),
      toMatchObject: async (expected: unknown) => expect(await actual).toMatchObject(expected),
    };
    const rejectionMatchers = {
      toThrow: async (expected?: string | RegExp) => {
        let error: unknown;
        try { await actual; } catch (caught) { error = caught; }
        const message = error instanceof Error ? error.message : String(error ?? "");
        const pass = error !== undefined && (expected === undefined ||
          (expected instanceof RegExp ? expected.test(message) : message.includes(expected)));
        check(pass, `Expected promise rejection to match ${String(expected)}; received ${message}`);
      },
    };
    return {
      get not() { return make(!negated); },
      get resolves() { return promiseMatchers; },
      get rejects() { return rejectionMatchers; },
      toBe(expected: unknown) {
        check(Object.is(actual, expected), `Expected ${String(actual)} to be ${String(expected)}`);
      },
      toEqual(expected: unknown) {
        let pass = true;
        try { assert.deepStrictEqual(actual, expected); } catch { pass = false; }
        check(pass, "Expected values to be deeply equal");
      },
      toMatchObject(expected: unknown) {
        check(partialMatch(actual, expected), "Expected object to contain the supplied properties");
      },
      toContain(expected: unknown) {
        const pass = typeof actual === "string"
          ? actual.includes(String(expected))
          : Array.isArray(actual) && actual.includes(expected);
        check(pass, `Expected value to contain ${String(expected)}`);
      },
      toMatch(expected: string | RegExp) {
        const pass = expected instanceof RegExp ? expected.test(String(actual)) : String(actual).includes(expected);
        check(pass, `Expected value to match ${String(expected)}`);
      },
      toBeNull() { check(actual === null, "Expected value to be null"); },
      toBeTruthy() { check(Boolean(actual), "Expected value to be truthy"); },
      toBeFalsy() { check(!actual, "Expected value to be falsy"); },
      toHaveLength(expected: number) { check(actual?.length === expected, `Expected length ${expected}, received ${actual?.length}`); },
      toHaveBeenCalledTimes(expected: number) {
        check(Array.isArray(actual?.mock?.calls) && actual.mock.calls.length === expected,
          `Expected mock to be called ${expected} times; received ${actual?.mock?.calls?.length ?? "not a mock"}`);
      },
      toHaveBeenCalled() {
        check(Array.isArray(actual?.mock?.calls) && actual.mock.calls.length > 0, "Expected mock to have been called");
      },
      toThrow(expected?: string | RegExp) {
        let error: unknown;
        try {
          if (typeof actual !== "function") throw new TypeError("toThrow expects a function");
          actual();
        } catch (caught) { error = caught; }
        const message = error instanceof Error ? error.message : String(error ?? "");
        const pass = error !== undefined && (expected === undefined ||
          (expected instanceof RegExp ? expected.test(message) : message.includes(expected)));
        check(pass, `Expected function to throw ${String(expected)}; received ${message}`);
      },
    };
  };
  return make();
}

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
