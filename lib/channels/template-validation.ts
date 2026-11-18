const componentTypes = new Set(["header", "body", "button"]);
const parameterTypes = new Set(["text", "currency", "date_time", "image", "video", "document", "payload", "action"]);

export function validateWhatsAppTemplateComponents(value: unknown): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 10) return false;
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { return false; }
  if (serialized.length > 20_000) return false;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const component = item as Record<string, unknown>;
    if (!componentTypes.has(String(component.type))) return false;
    if (component.parameters !== undefined) {
      if (!Array.isArray(component.parameters) || component.parameters.length > 20) return false;
      for (const parameterValue of component.parameters) {
        if (!parameterValue || typeof parameterValue !== "object" || Array.isArray(parameterValue)) return false;
        const parameter = parameterValue as Record<string, unknown>;
        if (!parameterTypes.has(String(parameter.type))) return false;
        if (parameter.type === "text" && (typeof parameter.text !== "string" || parameter.text.length > 1024)) return false;
        if (parameter.type === "payload" && (typeof parameter.payload !== "string" || parameter.payload.length > 256)) return false;
      }
    }
    if (component.type === "button") {
      if (!["url", "quick_reply", "flow", "copy_code", "phone_number"].includes(String(component.sub_type))) return false;
      if (!/^(?:[0-9]|1[0-9])$/.test(String(component.index))) return false;
    }
  }
  return true;
}
