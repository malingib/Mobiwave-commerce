type ProviderError = { code?: number; error_subcode?: number };
type ProviderResponse = { messages?: Array<{ id?: string }>; message_id?: string; error?: ProviderError };

export type MetaTextSendInput = {
  channel: "whatsapp" | "instagram"; accountId: string; recipientId: string; accessToken: string; text: string;
};

export async function sendMetaTextMessage(input: MetaTextSendInput): Promise<{ messageId: string }> {
  if (!input.accessToken || !input.accountId || !input.recipientId || !input.text.trim()) throw new Error("invalid_outbound_message");
  const version = process.env.META_GRAPH_API_VERSION || "v27.0";
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

export type ApprovedWhatsAppTemplate = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  bodyText: string;
  parameterCount: number;
};

function templateParameterCount(body: string) {
  const matches = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
  if (!matches.length) return 0;
  const unique = [...new Set(matches)].sort((a,b) => a-b);
  if (unique.length > 10 || unique.some((value,index) => value !== index + 1)) return null;
  return unique.length;
}

export async function listApprovedWhatsAppTemplates(
  wabaId: string,
  accessToken: string,
): Promise<ApprovedWhatsAppTemplate[]> {
  const version = process.env.META_GRAPH_API_VERSION || "v27.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  const url = new URL("https://graph.facebook.com/" + version + "/" + encodeURIComponent(wabaId) + "/message_templates");
  url.searchParams.set("fields","id,name,language,status,category,components");
  url.searchParams.set("status","APPROVED");
  url.searchParams.set("limit","100");
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: "Bearer " + accessToken },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error("meta_template_list_unavailable");
  }
  let payload: { data?: unknown; error?: ProviderError };
  try { payload = await response.json() as { data?: unknown; error?: ProviderError }; }
  catch { throw new Error(response.ok ? "meta_template_list_invalid" : "meta_http_" + response.status); }
  if (!response.ok || payload.error) {
    const code = typeof payload.error?.code === "number" ? String(payload.error.code) : "http_" + response.status;
    throw new Error("meta_api_" + code);
  }
  if (!Array.isArray(payload.data)) return [];
  const templates: ApprovedWhatsAppTemplate[] = [];
  for (const raw of payload.data) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (item.status !== "APPROVED" || typeof item.name !== "string" || typeof item.language !== "string") continue;
    const components = Array.isArray(item.components) ? item.components : [];
    const body = components.find(component =>
      Boolean(component) && typeof component === "object" && !Array.isArray(component) &&
      (component as Record<string, unknown>).type === "BODY",
    ) as Record<string, unknown> | undefined;
    if (!body || typeof body.text !== "string") continue;
    const header = components.find(component =>
      Boolean(component) && typeof component === "object" && !Array.isArray(component) &&
      (component as Record<string, unknown>).type === "HEADER",
    ) as Record<string, unknown> | undefined;
    // Initial template composer supports text headers only, without dynamic header parameters.
    if (header && (header.format !== "TEXT" || (typeof header.text === "string" && /\{\{\d+\}\}/.test(header.text)))) continue;
    const buttons = components.find(component =>
      Boolean(component) && typeof component === "object" && !Array.isArray(component) &&
      (component as Record<string, unknown>).type === "BUTTONS",
    ) as Record<string, unknown> | undefined;
    if (buttons && Array.isArray(buttons.buttons) && buttons.buttons.some(button =>
      Boolean(button) && typeof button === "object" && !Array.isArray(button) &&
      typeof (button as Record<string, unknown>).url === "string" &&
      /\{\{\d+\}\}/.test(String((button as Record<string, unknown>).url)),
    )) continue;
    const parameterCount = templateParameterCount(body.text);
    if (parameterCount === null) continue;
    templates.push({
      id: typeof item.id === "string" ? item.id : "",
      name: item.name,
      language: item.language,
      category: typeof item.category === "string" ? item.category : null,
      bodyText: body.text,
      parameterCount,
    });
  }
  return templates;
}

export async function sendWhatsAppTemplateMessage(input: {
  phoneNumberId: string;
  recipientId: string;
  accessToken: string;
  name: string;
  language: string;
  parameters: string[];
}): Promise<{ messageId: string }> {
  if (!input.accessToken || !input.phoneNumberId || !input.recipientId ||
      !/^[a-z0-9_]{1,512}$/.test(input.name) || !/^[a-z]{2,3}_[A-Za-z]{2,4}$/.test(input.language) ||
      input.parameters.length > 10 || input.parameters.some(value => !value || value.length > 1024)) {
    throw new Error("invalid_template_message");
  }
  const version = process.env.META_GRAPH_API_VERSION || "v27.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  const url = new URL("https://graph.facebook.com/" + version + "/" + encodeURIComponent(input.phoneNumberId) + "/messages");
  const template = {
    name: input.name,
    language: { code: input.language },
    ...(input.parameters.length ? {
      components: [{
        type: "body",
        parameters: input.parameters.map(text => ({ type: "text", text })),
      }],
    } : {}),
  };
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + input.accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: input.recipientId, type: "template", template }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("delivery_unknown");
  }
  let payload: ProviderResponse;
  try { payload = await response.json() as ProviderResponse; }
  catch { throw new Error(response.ok ? "delivery_unknown" : "meta_http_" + response.status); }
  if (!response.ok || payload.error) {
    const code = typeof payload.error?.code === "number" ? String(payload.error.code) : "http_" + response.status;
    throw new Error("meta_api_" + code);
  }
  const messageId = payload.messages?.[0]?.id;
  if (typeof messageId !== "string" || !messageId || messageId.length > 512) throw new Error("delivery_unknown");
  return { messageId };
}
