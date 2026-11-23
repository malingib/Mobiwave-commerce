import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanMediaObject } from "./scanner";

const input = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/png",
  sha256: "a".repeat(64),
  scannerUrl: "https://scanner.example.test/scan",
  scannerToken: "test-token",
};

describe("media scanner fail-closed behavior", () => {
  it("keeps media quarantined when scanner configuration is missing", async () => {
    assert.equal(await scanMediaObject({ ...input, scannerUrl: "", scannerToken: "" }), "quarantined");
  });

  it("accepts only an explicit clean result from a custom HTTPS scanner", async () => {
    const fetcher = async () => new Response(JSON.stringify({ status: "clean" }), { status: 200 });
    assert.equal(await scanMediaObject({ ...input, fetcher }), "available");
  });

  it("rejects an explicit infected result from a custom scanner", async () => {
    const fetcher = async () => new Response(JSON.stringify({ status: "infected" }), { status: 200 });
    assert.equal(await scanMediaObject({ ...input, fetcher }), "rejected");
  });

  it("uses Cloudmersive's HTTPS multipart endpoint and Apikey header", async () => {
    let requestUrl = "";
    let apiKey = "";
    let hasFile = false;
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      apiKey = new Headers(init?.headers).get("Apikey") || "";
      hasFile = init?.body instanceof FormData && init.body.has("inputFile");
      return new Response(JSON.stringify({ CleanResult: true, FoundViruses: [] }), { status: 200 });
    };
    const result = await scanMediaObject({ ...input, scannerProvider: "cloudmersive", fetcher });
    assert.equal(result, "available");
    assert.equal(requestUrl, "https://api.cloudmersive.com/virus/scan/file");
    assert.equal(apiKey, "test-token");
    assert.equal(hasFile, true);
  });

  it("rejects a Cloudmersive infected result and quarantines ambiguous results", async () => {
    const infected = async () => new Response(JSON.stringify({ CleanResult: false }), { status: 200 });
    const unknown = async () => new Response(JSON.stringify({}), { status: 200 });
    assert.equal(await scanMediaObject({ ...input, scannerProvider: "cloudmersive", fetcher: infected }), "rejected");
    assert.equal(await scanMediaObject({ ...input, scannerProvider: "cloudmersive", fetcher: unknown }), "quarantined");
  });

  it("quarantines HTTP failures, invalid responses, and non-HTTPS custom scanner URLs", async () => {
    const unavailable = async () => new Response("unavailable", { status: 503 });
    const unknown = async () => new Response(JSON.stringify({ status: "unknown" }), { status: 200 });
    assert.equal(await scanMediaObject({ ...input, fetcher: unavailable }), "quarantined");
    assert.equal(await scanMediaObject({ ...input, fetcher: unknown }), "quarantined");
    assert.equal(await scanMediaObject({ ...input, scannerUrl: "http://scanner.example.test", fetcher: unknown }), "quarantined");
  });
});
