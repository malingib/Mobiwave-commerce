type ProviderError = { code?: number };
type TemplateListResponse = {
  data?: Array<{ name?: string; status?: string; language?: string; components?: unknown[] }>;
  error?: ProviderError;
};
type ProviderSendResponse = { messages?: Array<{ id?: string }>; error?: ProviderError };

export type WhatsAppTemplatePayload = {
  name: string;
  language: { code: string };
  components: Array<Record<string, unknown>>;
};

function graphVersion() {
  const version = process.env.META_GRAPH_API_VERSION || "v27.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  return version;
}

function providerError(payload: { error?: ProviderError }, status: number) {
  if (payload.error) return "meta_api_" + (typeof payload.error.code === "number" ? payload.error.code : "error");
  return "meta_http_" + status;
}

export async function sendMetaTemplateMessage(input: {
  phoneNumberId: string;
  wabaId: string;
  recipientId: string;
  accessToken: string;
  template: Record<string, unknown>;
}): Promise<{ messageId: string }> {
  const name = typeof input.template.name === "string" ? input.template.name : "";
  const language = input.template.language && typeof input.template.language === "object"
    ? (input.template.language as Record<string, unknown>).code : "";
  const components = input.template.components === undefined ? [] : input.template.components;
  if (!input.accessToken || !input.phoneNumberId || !input.wabaId || !input.recipientId ||
      !/^[a-z0-9_]{1,512}$/.test(name) || typeof language !== "string" ||
      !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language) || !Array.isArray(components)) {
    throw new Error("invalid_template_message");
  }
  const version = graphVersion();
  const headers = { Authorization: "Bearer " + input.accessToken, "Content-Type": "application/json" };
  const listUrl = new URL("https://graph.facebook.com/" + version + "/" + encodeURIComponent(input.wabaId) + "/message_templates");
  listUrl.searchParams.set("name", name);
  listUrl.searchParams.set("fields", "name,status,language");
  let listResponse: Response;
  try {
    listResponse = await fetch(listUrl, { method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("template_approval_check_unknown");
  }
  let listPayload: TemplateListResponse;
  try { listPayload = await listResponse.json() as TemplateListResponse; }
  catch { throw new Error(listResponse.ok ? "template_approval_check_unknown" : "meta_http_" + listResponse.status); }
  if (!listResponse.ok || listPayload.error) throw new Error(providerError(listPayload, listResponse.status));
  const approved = (listPayload.data || []).some(template =>
    template.name === name && template.language === language && template.status === "APPROVED"
  );
  if (!approved) throw new Error("template_not_approved");

  const sendUrl = new URL("https://graph.facebook.com/" + version + "/" + encodeURIComponent(input.phoneNumberId) + "/messages");
  let sendResponse: Response;
  try {
    sendResponse = await fetch(sendUrl, {
      method: "POST", headers,
      body: JSON.stringify({
        messaging_product: "whatsapp", recipient_type: "individual", to: input.recipientId,
        type: "template", template: { name, language: { code: language }, components },
      }),
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // A timeout after submission is ambiguous; do not retry automatically.
    throw new Error("delivery_unknown");
  }
  let sendPayload: ProviderSendResponse;
  try { sendPayload = await sendResponse.json() as ProviderSendResponse; }
  catch { throw new Error(sendResponse.ok ? "delivery_unknown" : "meta_http_" + sendResponse.status); }
  if (!sendResponse.ok || sendPayload.error) throw new Error(providerError(sendPayload, sendResponse.status));
  const messageId = sendPayload.messages?.[0]?.id;
  if (typeof messageId !== "string" || !messageId || messageId.length > 512) throw new Error("delivery_unknown");
  return { messageId };
}
