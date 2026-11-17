import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

export type MetaChannel = "whatsapp" | "instagram";
export type OnboardingMode = "merchant_owned" | "mobiwave_managed";
export type AssetOwnerType = "merchant" | "mobiwave";

export function hashOAuthState(state: string) {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export async function issueMetaOAuthState(
  client: PoolClient,
  input: {
    storeId: string;
    userId: string;
    channel: MetaChannel;
    ownershipMode: OnboardingMode;
    assetOwnerType: AssetOwnerType;
  },
) {
  const state = randomBytes(32).toString("base64url");
  await client.query(
    \`INSERT INTO channel_oauth_states
      (state_hash, store_id, user_id, channel, ownership_mode, asset_owner_type, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')\`,
    [
      hashOAuthState(state), input.storeId, input.userId, input.channel,
      input.ownershipMode, input.assetOwnerType,
    ],
  );
  return state;
}

export async function consumeMetaOAuthState(
  client: PoolClient,
  state: string,
  userId: string,
  channel: MetaChannel,
) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(state)) return null;
  const result = await client.query(
    \`UPDATE channel_oauth_states
        SET consumed_at=now()
      WHERE state_hash=$1 AND user_id=$2 AND channel=$3
        AND consumed_at IS NULL AND expires_at>now()
      RETURNING store_id, ownership_mode, asset_owner_type\`,
    [hashOAuthState(state), userId, channel],
  );
  if (!result.rowCount) return null;
  return {
    storeId: String(result.rows[0].store_id),
    ownershipMode: result.rows[0].ownership_mode as OnboardingMode,
    assetOwnerType: result.rows[0].asset_owner_type as AssetOwnerType,
  };
}
