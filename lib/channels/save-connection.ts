import { db } from "@/lib/db";
import { encryptChannelCredential } from "@/lib/channels/credentials";
import type { MetaToken } from "@/lib/channels/meta-oauth";
import type { AssetOwnerType, MetaChannel, OnboardingMode } from "@/lib/channels/oauth-state";

export async function saveMetaChannelConnection(input: {
  storeId: string;
  userId: string;
  channel: MetaChannel;
  ownershipMode: OnboardingMode;
  assetOwnerType: AssetOwnerType;
  providerBusinessId?: string | null;
  providerAccountId: string;
  providerAddressId?: string | null;
  displayName?: string | null;
  metadata?: Record<string, unknown>;
  token: MetaToken;
}) {
  const tokenCiphertext = encryptChannelCredential(input.token.accessToken);
  const expiresAt = input.token.expiresIn
    ? new Date(Date.now() + input.token.expiresIn * 1000).toISOString()
    : null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [input.userId]);
    await client.query("SELECT set_config('app.channel_oauth','true',true)");
    await client.query("SELECT set_config('app.channel_worker','true',true)");
    const membership = await client.query(
      "SELECT role FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')",
      [input.storeId, input.userId],
    );
    if (!membership.rowCount) throw new Error("store_access_revoked");

    const connection = await client.query(
      \`INSERT INTO channel_connections
        (store_id,channel,ownership_mode,asset_owner_type,provider_business_id,
         provider_account_id,provider_address_id,display_name,status,connected_by,
         connected_at,last_verified_at,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'connected',$9,now(),now(),$10::jsonb)
       RETURNING id\`,
      [
        input.storeId, input.channel, input.ownershipMode, input.assetOwnerType,
        input.providerBusinessId || null, input.providerAccountId,
        input.providerAddressId || null, input.displayName || null, input.userId,
        JSON.stringify(input.metadata || {}),
      ],
    );
    const connectionId = String(connection.rows[0].id);
    const credential = await client.query(
      \`INSERT INTO channel_credentials
        (store_id,connection_id,token_ciphertext,token_type,scopes,expires_at,last_validated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       RETURNING id\`,
      [
        input.storeId, connectionId, tokenCiphertext, input.token.tokenType,
        input.token.scopes, expiresAt,
      ],
    );
    await client.query(
      "UPDATE channel_connections SET credential_ref=$1,updated_at=now() WHERE store_id=$2 AND id=$3",
      [credential.rows[0].id, input.storeId, connectionId],
    );
    await client.query(
      \`INSERT INTO channel_connection_events (store_id,connection_id,event_type,actor_user_id,details)
       VALUES ($1,$2,'created',$3,$4::jsonb),($1,$2,'connected',$3,$5::jsonb)\`,
      [
        input.storeId, connectionId, input.userId,
        JSON.stringify({ channel: input.channel, ownershipMode: input.ownershipMode }),
        JSON.stringify({ channel: input.channel, scopes: input.token.scopes, expiresAt }),
      ],
    );
    await client.query("COMMIT");
    return { id: connectionId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Error && error.message === "store_access_revoked") throw error;
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") {
      throw new Error("meta_account_already_connected");
    }
    throw error;
  } finally {
    client.release();
  }
}
