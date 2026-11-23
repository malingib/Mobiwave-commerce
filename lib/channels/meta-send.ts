import { getPlatformProviderConfig } from "@/lib/platform-provider-config";
type ProviderError = { code?: number; error_subcode?: number };
type ProviderResponse = { messages?: Array<{ id?: string }>; message_id?: string; error?: ProviderError };

export type MetaTextSendInput = {
  channel: "whatsapp" | "instagram"; accountId: string; recipientId: string; accessToken: string; text: string;
};

export async function sendMetaTextMessage(input: MetaTextSendInput): Promise<{ messageId: string }> {
  if (!input.accessToken || !input.accountId || !input.recipientId || !input.text.trim()) throw new Error("invalid_outbound_message");
  const config = process.env.DATABASE_URL ? await getPlatformProviderConfig("meta") : null;
  const version = config?.graphVersion || process.env.META_GRAPH_API_VERSION || "v27.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  const host = input.channel === "whatsapp" ? "graph.facebook.com" : "graph.instagram.com";
  const url = new URL("https://" + host + "/" + version + "/" + encodeURIComponent(input.accountId) + "/messages");
  const body = input.channel === "whatsapp"
    ? { messaging_product: "whatsapp", recipient_type: "individual", to: input.recipientId, type: "text", text: { preview_url: false, body: input.text } }
    : { recipient: { id: input.recipientId }, message: { text: input.text } };
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + input.accessToken, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    // The provider may have accepted the message before a network timeout. Never auto-retry.
    throw new Error("delivery_unknown");
  }
  let payload: ProviderResponse;
  try { payload = await response.json() as ProviderResponse; }
  catch { throw new Error(response.ok ? "delivery_unknown" : "meta_http_" + response.status); }
  if (!response.ok || payload.error) {
    const code = typeof payload.error?.code === "number" ? String(payload.error.code) : "http_" + response.status;
    throw new Error("meta_api_" + code);
  }
  const messageId = input.channel === "whatsapp" ? payload.messages?.[0]?.id : payload.message_id;
  if (typeof messageId !== "string" || !messageId || messageId.length > 512) throw new Error("delivery_unknown");
  return { messageId };
}