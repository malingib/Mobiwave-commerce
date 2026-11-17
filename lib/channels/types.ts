export type ChannelName = "whatsapp" | "instagram" | "website";

export type NormalizedProviderEvent = {
  channel: "whatsapp" | "instagram";
  providerAccountId: string;
  providerEventId: string;
  eventType: string;
  occurredAt: string | null;
  payload: Record<string, unknown>;
};

export interface ChannelAdapter {
  readonly channel: ChannelName;
  verifyWebhook(rawBody: string, signature: string | null, appSecret: string): boolean;
  normalizeWebhook(payload: unknown): NormalizedProviderEvent[];
}
