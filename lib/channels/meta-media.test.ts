import { afterEach, describe, expect, it, vi } from "@/lib/test-runtime";
import { createHash } from "node:crypto";
import { downloadInstagramMedia, downloadMetaMedia, sendMetaMediaMessage, uploadMetaMedia } from "@/lib/channels/meta-media";

afterEach(() => vi.unstubAllGlobals());

describe("official Meta WhatsApp media API", () => {
  it("retrieves media metadata and downloads the binary from an approved Meta CDN", async () => {
    const bytes = Buffer.from("clean-image-bytes");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123",
        mime_type: "image/jpeg",
        file_size: bytes.length,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": String(bytes.length) },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await downloadMetaMedia({ mediaId: "media-123", accessToken: "private-token" });
    expect(result.bytes.equals(bytes)).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, metadataInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(new Headers(metadataInit.headers).get("authorization")).toBe("Bearer private-token");
    expect(metadataInit.redirect).toBe("error");
  });

  it("rejects media metadata that points to an untrusted host", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      url: "https://attacker.example/file",
      mime_type: "image/jpeg",
      file_size: 10,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadMetaMedia({ mediaId: "media-123", accessToken: "private-token" }))
      .rejects.toThrow("meta_media_url_rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uploads a file using the official WhatsApp media endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: "uploaded-media-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadMetaMedia({
      phoneNumberId: "123456789",
      accessToken: "private-token",
      bytes: Buffer.from("file-bytes"),
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
    })).resolves.toBe("uploaded-media-1");
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("/v27.0/123456789/media");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-token");
    expect(init.body instanceof FormData).toBe(true);
    expect((init.body as FormData).get("messaging_product")).toBe("whatsapp");
    expect((init.body as FormData).get("type")).toBe("image/jpeg");
  });

  it("sends a WhatsApp media message by uploaded media ID", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      messages: [{ id: "wamid.media.1" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaMediaMessage({
      phoneNumberId: "123456789",
      recipientId: "254700000001",
      accessToken: "private-token",
      mediaId: "uploaded-media-1",
      mediaType: "image",
      caption: "Product photo",
    })).resolves.toEqual({ messageId: "wamid.media.1" });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "254700000001",
      type: "image",
      image: { id: "uploaded-media-1", caption: "Product photo" },
    });
  });

  it("does not retry an ambiguous media send failure", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("network timeout"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaMediaMessage({
      phoneNumberId: "123456789",
      recipientId: "254700000001",
      accessToken: "private-token",
      mediaId: "uploaded-media-1",
      mediaType: "document",
    })).rejects.toThrow("delivery_unknown");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("official Meta Instagram media retrieval", () => {
  it("downloads from an approved Instagram CDN and rejects redirects", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(bytes, {
      status: 200, headers: { "content-type": "image/jpeg", "content-length": String(bytes.length) },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await downloadInstagramMedia({ url: "https://scontent.cdninstagram.com/media/photo.jpg" });
    expect(result.bytes.equals(bytes)).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("error");
  });

  it("rejects untrusted Instagram attachment hosts before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadInstagramMedia({ url: "https://evil.example/media.jpg" }))
      .rejects.toThrow("meta_media_url_rejected");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Meta media download limits", () => {
  it("rejects a streamed response that exceeds the byte cap without Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(stream, {
      status: 200, headers: { "content-type": "image/jpeg" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadInstagramMedia({
      url: "https://scontent.cdninstagram.com/media/photo.jpg",
      maxBytes: 10,
    })).rejects.toThrow("meta_media_too_large");
  });

  it("rejects non-standard ports on Meta CDN URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadInstagramMedia({
      url: "https://scontent.cdninstagram.com:8443/media/photo.jpg",
    })).rejects.toThrow("meta_media_url_rejected");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
