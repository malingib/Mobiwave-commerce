import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Client, Pool } = pg;
const root = process.cwd();
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const owner = new Client({ connectionString: databaseUrl });
await owner.connect();

const migrationPaths = [
  "db/migrations/0002-auth.sql",
  "db/migrations/0003-store-provisioning.sql",
  "db/migrations/0004-public-storefront-checkout.sql",
  "db/migrations/0005-limit-public-catalog-to-anonymous-context.sql",
  "db/migrations/0006-checkout-stock-decrement.sql",
  "db/migrations/0007-mpesa-callback-access.sql",
  "db/migrations/0008-superadmin-policies.sql",
  "db/migrations/0009-commerce-hardening.sql",
  "db/migrations/0010-mpesa-credentials.sql",
  "db/migrations/0011-domain-routing.sql",
  "db/migrations/0012-subscription-billing.sql",
  "db/migrations/0013-message-outbox.sql",
  "db/migrations/0014-payment-reconciliation-admin.sql",
  "db/migrations/0015-mpesa-platform-order-fallback.sql",
  "db/migrations/0016-mpesa-callback-read-policies.sql",
  "db/migrations/0017-commerce-hardening.sql",
  "db/migrations/0018-social-commerce-foundation.sql",
  "db/migrations/0019-meta-webhook-worker-access.sql",
  "db/migrations/0020-meta-channel-onboarding.sql",
  "db/migrations/0021-social-commerce-outbound.sql",
  "db/migrations/0022-conversation-attachment-security.sql",
  "db/migrations/0023-platform-provider-configurations.sql",
  "db/migrations/0024-store-wallet-ledger.sql",
  "db/migrations/0025-sms-delivery-idempotency.sql",
  "db/migrations/0026-sms-wallet-enforcement.sql",
  "db/migrations/0027-mpesa-wallet-topups.sql",
];

const appUrl = new URL(databaseUrl);
appUrl.username = "commerce_runtime_app";
appUrl.password = "commerce-test-only";
const authAppUrl = new URL(databaseUrl);
authAppUrl.username = "commerce_auth_app";
authAppUrl.password = "commerce-auth-test-only";

let runtimePool;
let authPool;

try {
  await owner.query("CREATE ROLE commerce_runtime_app LOGIN NOBYPASSRLS PASSWORD 'commerce-test-only'");
  await owner.query("CREATE ROLE commerce_auth_app LOGIN NOBYPASSRLS PASSWORD 'commerce-auth-test-only'");
  await owner.query(await readFile(join(root, "db/roles/commerce-runtime-bootstrap.sql"), "utf8"));
  await owner.query(await readFile(join(root, "db/schema.sql"), "utf8"));
  for (const path of migrationPaths) {
    await owner.query(await readFile(join(root, path), "utf8"));
  }
  await owner.query(await readFile(join(root, "db/roles/commerce-runtime.sql"), "utf8"));
  await owner.query(await readFile(join(root, "db/roles/commerce-auth-runtime.sql"), "utf8"));

  const walletSecurity = await owner.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('store_sms_billing_config','store_sms_usage','store_wallet_accounts','store_wallet_transactions','store_wallet_reservations','wallet_topup_attempts')
      ORDER BY c.relname`,
  );
  assert.deepEqual(walletSecurity.rows, [
    { relname: "store_sms_billing_config", relrowsecurity: true, relforcerowsecurity: true },
    { relname: "store_sms_usage", relrowsecurity: true, relforcerowsecurity: true },
    { relname: "store_wallet_accounts", relrowsecurity: true, relforcerowsecurity: true },
    { relname: "store_wallet_reservations", relrowsecurity: true, relforcerowsecurity: true },
    { relname: "store_wallet_transactions", relrowsecurity: true, relforcerowsecurity: true },
    { relname: "wallet_topup_attempts", relrowsecurity: true, relforcerowsecurity: true },
  ], "all wallet tables must enforce RLS");

  const roleChecks = await owner.query(`
    SELECT rolname, rolcanlogin, rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('commerce_runtime_app', 'commerce_auth_app', 'commerce_runtime', 'commerce_auth_runtime')
    ORDER BY rolname
  `);
  assert.deepEqual(
    roleChecks.rows.map(({ rolname, rolcanlogin, rolbypassrls }) => ({ rolname, rolcanlogin, rolbypassrls })),
    [
      { rolname: "commerce_auth_app", rolcanlogin: true, rolbypassrls: false },
      { rolname: "commerce_auth_runtime", rolcanlogin: false, rolbypassrls: false },
      { rolname: "commerce_runtime", rolcanlogin: false, rolbypassrls: false },
      { rolname: "commerce_runtime_app", rolcanlogin: true, rolbypassrls: false },
    ],
  );

  const privilegeChecks = await owner.query(`
    SELECT
      has_table_privilege('commerce_runtime_app', 'public."user"', 'SELECT') AS runtime_reads_auth,
      has_table_privilege('commerce_runtime_app', 'public.orders', 'SELECT') AS runtime_reads_orders,
      has_table_privilege('commerce_auth_app', 'public.stores', 'SELECT') AS auth_reads_stores,
      has_table_privilege('commerce_auth_app', 'public."user"', 'SELECT') AS auth_reads_users
  `);
  assert.deepEqual(privilegeChecks.rows[0], {
    runtime_reads_auth: false,
    runtime_reads_orders: true,
    auth_reads_stores: false,
    auth_reads_users: true,
  });

  const storeA = "10000000-0000-4000-8000-000000000001";
  const storeB = "10000000-0000-4000-8000-000000000002";
  const userA = "20000000-0000-4000-8000-000000000001";
  const userB = "20000000-0000-4000-8000-000000000002";
  const productA = "30000000-0000-4000-8000-000000000001";
  const productB = "30000000-0000-4000-8000-000000000002";
  const orderA = "40000000-0000-4000-8000-000000000001";
  const orderB = "40000000-0000-4000-8000-000000000002";
  const connectionA = "50000000-0000-4000-8000-000000000001";
  const connectionB = "50000000-0000-4000-8000-000000000002";
  const identityA = "60000000-0000-4000-8000-000000000001";
  const identityB = "60000000-0000-4000-8000-000000000002";
  const conversationA = "70000000-0000-4000-8000-000000000001";
  const conversationB = "70000000-0000-4000-8000-000000000002";
  const messageA = "80000000-0000-4000-8000-000000000001";
  const messageB = "80000000-0000-4000-8000-000000000002";
  const credentialA = "90000000-0000-4000-8000-000000000001";
  const credentialB = "90000000-0000-4000-8000-000000000002";

  await owner.query(
    "INSERT INTO stores (id,name,slug,status) VALUES ($1,'Tenant A','tenant-a','active'),($2,'Tenant B','tenant-b','active')",
    [storeA, storeB],
  );
  await owner.query(
    "INSERT INTO store_memberships (store_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner')",
    [storeA, userA, storeB, userB],
  );
  await owner.query(
    "INSERT INTO products (id,store_id,name,slug,price_minor,status) VALUES ($1,$2,'Product A','product-a',100,'active'),($3,$4,'Product B','product-b',200,'active')",
    [productA, storeA, productB, storeB],
  );
  await owner.query(
    `INSERT INTO orders (id,store_id,customer_name,customer_phone,subtotal_minor,total_minor)
     VALUES ($1,$2,'Customer A','254700000001',100,100),($3,$4,'Customer B','254700000002',200,200)`,
    [orderA, storeA, orderB, storeB],
  );
  await owner.query(
    `INSERT INTO order_items (store_id,order_id,product_id,product_name,quantity,unit_price_minor,line_total_minor)
     VALUES ($1,$2,$3,'Product A',1,100,100),($4,$5,$6,'Product B',1,200,200)`,
    [storeA, orderA, productA, storeB, orderB, productB],
  );
  await owner.query(
    `INSERT INTO payment_attempts (store_id,order_id,provider,amount_minor,idempotency_key)
     VALUES ($1,$2,'mpesa',100,'tenant-a-payment'),($3,$4,'mpesa',200,'tenant-b-payment')`,
    [storeA, orderA, storeB, orderB],
  );
  await owner.query(
    "INSERT INTO subscriptions (store_id) VALUES ($1),($2)",
    [storeA, storeB],
  );
  await owner.query(
    `INSERT INTO message_events (store_id,channel,recipient,template_key,dedupe_key)
     VALUES ($1,'sms','254700000001','order_created','tenant-a-message'),($2,'sms','254700000002','order_created','tenant-b-message')`,
    [storeA, storeB],
  );
  await owner.query(
    "INSERT INTO store_wallet_accounts (store_id,available_balance_minor) VALUES ($1,5000),($2,7000)",
    [storeA, storeB],
  );
  await owner.query(
    `INSERT INTO store_wallet_transactions (store_id,transaction_type,amount_minor,idempotency_key,description)
     VALUES ($1,'top_up',5000,'seed-topup-a','security test seed'),($2,'top_up',7000,'seed-topup-b','security test seed')`,
    [storeA, storeB],
  );
  await owner.query(
    `INSERT INTO store_wallet_reservations (store_id,amount_minor,idempotency_key,status)
     VALUES ($1,100,'seed-reservation-a','reserved'),($2,200,'seed-reservation-b','reserved')`,
    [storeA, storeB],
  );
  const smsEventA = "81000000-0000-4000-8000-000000000001";
  const smsEventB = "81000000-0000-4000-8000-000000000002";
  await owner.query(
    "INSERT INTO message_events (id,store_id,channel,recipient,template_key,dedupe_key) VALUES ($1,$2,'sms','254700000001','order_created','sms-billing-a'),($3,$4,'sms','254700000002','order_created','sms-billing-b')",
    [smsEventA,storeA,smsEventB,storeB],
  );
  await owner.query(
    "INSERT INTO store_sms_billing_config (store_id,included_segments_per_month,unit_rate_minor,currency,enabled) VALUES ($1,100,25,'KES',true),($2,200,30,'KES',true)",
    [storeA,storeB],
  );
  await owner.query(
    "INSERT INTO store_sms_usage (store_id,event_id,period_start,total_segments,included_segments,billable_segments,unit_rate_minor,amount_minor,currency,status) VALUES ($1,$2,date_trunc('month',now())::date,120,100,20,25,500,'KES','reserved'),($3,$4,date_trunc('month',now())::date,250,200,50,30,1500,'KES','reserved')",
    [storeA,smsEventA,storeB,smsEventB],
  );
  const topupA = "82000000-0000-4000-8000-000000000001";
  const topupB = "82000000-0000-4000-8000-000000000002";
  await owner.query(
    "INSERT INTO wallet_topup_attempts (id,store_id,amount_minor,customer_phone,idempotency_key,idempotency_hash) VALUES ($1,$2,1000,'254700000001','wallet-topup-a',$3),($4,$5,2000,'254700000002','wallet-topup-b',$6)",
    [topupA,storeA,"a".repeat(64),topupB,storeB,"b".repeat(64)],
  );
  await assert.rejects(
    owner.query("UPDATE wallet_topup_attempts SET amount_minor=2000 WHERE id=$1",[topupA]),
    /identity_is_immutable/i,
    "wallet top-up amount and request identity must be immutable",
  );
  await assert.rejects(
    owner.query("UPDATE store_sms_usage SET amount_minor=1 WHERE event_id=$1",[smsEventA]),
    /identity_is_immutable/i,
    "SMS usage financial identity must be immutable",
  );
  await assert.rejects(
    owner.query("UPDATE store_wallet_transactions SET description='tampered' WHERE idempotency_key='seed-topup-a'"),
    /append_only/i,
    "wallet financial movements must be immutable",
  );
  await assert.rejects(
    owner.query("DELETE FROM store_wallet_transactions WHERE idempotency_key='seed-topup-a'"),
    /append_only/i,
    "wallet financial movements must not be deletable",
  );
  await assert.rejects(
    owner.query("UPDATE store_wallet_reservations SET amount_minor=999 WHERE idempotency_key='seed-reservation-a'"),
    /identity_is_immutable/i,
    "wallet reservation identity must be immutable",
  );
  await owner.query(
    "INSERT INTO store_domains (store_id,hostname) VALUES ($1,'tenant-a.example.test'),($2,'tenant-b.example.test')",
    [storeA, storeB],
  );
  await owner.query(
    "INSERT INTO audit_events (store_id,action,resource_type) VALUES ($1,'created','store'),($2,'created','store')",
    [storeA, storeB],
  );
  await owner.query(
    "INSERT INTO platform_provider_configurations(provider,config_ciphertext,status) VALUES ('meta','{\"appSecret\":\"encrypted-test-value\"}'::jsonb,'configured')",
  );
  await owner.query(
    `INSERT INTO channel_connections
     (id,store_id,channel,ownership_mode,asset_owner_type,provider_account_id,status,connected_by)
     VALUES ($1,$2,'whatsapp','merchant_owned','merchant','wa-tenant-a','connected',$3),
            ($4,$5,'whatsapp','mobiwave_managed','merchant','wa-tenant-b','connected',$6)`,
    [connectionA,storeA,userA,connectionB,storeB,userB],
  );
  await owner.query(
    `INSERT INTO channel_credentials (id,store_id,connection_id,token_ciphertext,token_type)
     VALUES ($1,$2,$3,'cipher-a','bearer'),($4,$5,$6,'cipher-b','bearer')`,
    [credentialA,storeA,connectionA,credentialB,storeB,connectionB],
  );
  await owner.query("UPDATE channel_connections SET credential_ref=$1 WHERE id=$2", [credentialA,connectionA]);
  await owner.query("UPDATE channel_connections SET credential_ref=$1 WHERE id=$2", [credentialB,connectionB]);
  await owner.query(
    `INSERT INTO channel_oauth_states (state_hash,store_id,user_id,channel,ownership_mode,asset_owner_type,expires_at)
     VALUES ($1,$2,$3,'whatsapp','merchant_owned','merchant',now()+interval '5 minutes'),
            ($4,$5,$6,'instagram','mobiwave_managed','merchant',now()+interval '5 minutes')`,
    ['a'.repeat(64),storeA,userA,'b'.repeat(64),storeB,userB],
  );
  await owner.query(
    `INSERT INTO channel_webhook_events
     (store_id,connection_id,provider_event_id,event_type,payload,signature_valid)
     VALUES ($1,$2,'event-a','whatsapp.messages.message','{"text":"tenant A"}'::jsonb,true),
            ($3,$4,'event-b','whatsapp.messages.message','{"text":"tenant B"}'::jsonb,true)`,
    [storeA,connectionA,storeB,connectionB],
  );
  await owner.query(
    `INSERT INTO channel_identities (id,store_id,channel,external_user_id)
     VALUES ($1,$2,'whatsapp','contact-a'),($3,$4,'whatsapp','contact-b')`,
    [identityA,storeA,identityB,storeB],
  );
  await owner.query(
    `INSERT INTO conversations (id,store_id,connection_id,identity_id,channel)
     VALUES ($1,$2,$3,$4,'whatsapp'),($5,$6,$7,$8,'whatsapp')`,
    [conversationA,storeA,connectionA,identityA,conversationB,storeB,connectionB,identityB],
  );
  await owner.query(
    `INSERT INTO conversation_messages
     (id,store_id,conversation_id,connection_id,direction,content)
     VALUES ($1,$2,$3,$4,'inbound','hello A'),($5,$6,$7,$8,'inbound','hello B')`,
    [messageA,storeA,conversationA,connectionA,messageB,storeB,conversationB,connectionB],
  );
  await owner.query(
    `INSERT INTO conversation_attachments (store_id,message_id,storage_key,mime_type)
     VALUES ($1,$2,'tenant-a/object','image/jpeg'),($3,$4,'tenant-b/object','image/jpeg')`,
    [storeA,messageA,storeB,messageB],
  );
  const quarantinedAttachments = await owner.query(
    "SELECT count(*)::int AS count FROM conversation_attachments WHERE scan_status='quarantined' AND sha256 IS NULL",
  );
  assert.equal(quarantinedAttachments.rows[0].count, 2, "legacy and unscanned attachments must default to quarantine");
  await owner.query(
    `INSERT INTO conversation_notes (store_id,conversation_id,author_user_id,body)
     VALUES ($1,$2,$3,'private note A'),($4,$5,$6,'private note B')`,
    [storeA,conversationA,userA,storeB,conversationB,userB],
  );
  await owner.query(
    `INSERT INTO message_outbox
     (store_id,connection_id,conversation_id,message_id,idempotency_key,request_hash)
     VALUES ($1,$2,$3,$4,'tenant-a-outbox',$5),($6,$7,$8,$9,'tenant-b-outbox',$10)`,
    [storeA,connectionA,conversationA,messageA,"a".repeat(64),storeB,connectionB,conversationB,messageB,"b".repeat(64)],
  );

  runtimePool = new Pool({
    connectionString: appUrl.toString(),
    max: 2,
  });
  authPool = new Pool({
    connectionString: authAppUrl.toString(),
    max: 1,
  });

  const runtime = await runtimePool.connect();
  try {
    await runtime.query("BEGIN");
    const identity = await runtime.query(
      "SELECT current_user AS role, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypassrls",
    );
    assert.deepEqual(identity.rows[0], { role: "commerce_runtime_app", bypassrls: false });
    await runtime.query("SELECT set_config('app.user_id',$1,true)", [userA]);

    const tenantTables = [
      "stores",
      "products",
      "orders",
      "order_items",
      "payment_attempts",
      "subscriptions",
      "message_events",
      "store_wallet_accounts",
      "store_wallet_transactions",
      "store_wallet_reservations",
      "store_sms_billing_config",
      "store_sms_usage",
      "wallet_topup_attempts",
      "store_domains",
      "audit_events",
      "channel_connections",
      "channel_identities",
      "conversations",
      "conversation_messages",
      "conversation_attachments",
      "conversation_notes",
      "message_outbox",
    ];
    for (const table of tenantTables) {
      const result = await runtime.query(`SELECT count(*)::int AS count FROM ${table}`);
      const expectedCount = table === "message_events" ? 2 : 1;
      assert.equal(result.rows[0].count, expectedCount, `user A must see only its expected rows in ${table}`);
    }
    const privateWebhookEvents = await runtime.query("SELECT count(*)::int AS count FROM channel_webhook_events");
    const privateCredentials = await runtime.query("SELECT count(*)::int AS count FROM channel_credentials");
    const privateOAuthStates = await runtime.query("SELECT count(*)::int AS count FROM channel_oauth_states");
    assert.equal(privateWebhookEvents.rows[0].count, 0, "merchant sessions must not read raw webhook payloads");
    assert.equal(privateCredentials.rows[0].count, 0, "merchant sessions must not read encrypted provider credentials");
    assert.equal(privateOAuthStates.rows[0].count, 0, "merchant sessions must not read OAuth transaction state");
    const merchantProviderConfigs = await runtime.query("SELECT count(*)::int AS count FROM platform_provider_configurations");
    assert.equal(merchantProviderConfigs.rows[0].count, 0, "merchant sessions must not read platform provider credentials");
    await runtime.query("SELECT set_config('app.channel_worker','true',true)");
    const workerProviderConfigs = await runtime.query("SELECT count(*)::int AS count FROM platform_provider_configurations");
    assert.equal(workerProviderConfigs.rows[0].count, 0, "channel worker capability must not read platform provider credentials");
    await runtime.query("SELECT set_config('app.channel_worker','false',true)");
    await runtime.query("SELECT set_config('app.provider_config_read','true',true)");
    const providerRuntimeConfigs = await runtime.query("SELECT count(*)::int AS count FROM platform_provider_configurations");
    assert.equal(providerRuntimeConfigs.rows[0].count, 1, "trusted provider runtime capability must read platform settings");
    await runtime.query("SELECT set_config('app.provider_config_read','false',true)");
    const providerReadRevoked = await runtime.query("SELECT count(*)::int AS count FROM platform_provider_configurations");
    assert.equal(providerReadRevoked.rows[0].count, 0, "provider runtime capability must be transaction-local");
    await runtime.query("SELECT set_config('app.admin','true',true)");
    const adminProviderConfigs = await runtime.query("SELECT count(*)::int AS count FROM platform_provider_configurations");
    assert.equal(adminProviderConfigs.rows[0].count, 1, "platform admin capability must read provider status");
    await runtime.query("UPDATE platform_provider_configurations SET status='verified' WHERE provider='meta'");
    await runtime.query("SELECT set_config('app.admin','false',true)");


    await runtime.query("SELECT set_config('app.channel_worker','true',true)");
    const workerConnections = await runtime.query("SELECT count(*)::int AS count FROM channel_connections");
    const workerWebhookEvents = await runtime.query("SELECT count(*)::int AS count FROM channel_webhook_events");
    assert.equal(workerConnections.rows[0].count, 2, "authenticated channel worker must resolve connections across stores");
    assert.equal(workerWebhookEvents.rows[0].count, 2, "authenticated channel worker must read the private webhook queue");
    const claimedWebhooks = await runtime.query(
      `SELECT id FROM channel_webhook_events
        WHERE processing_status IN ('received','failed')
          AND next_attempt_at <= now()
        ORDER BY received_at ASC
        LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [10],
    );
    assert.equal(claimedWebhooks.rowCount, 2, "worker must be able to claim due webhook events with SKIP LOCKED");
    const workerIdentityId = "60000000-0000-4000-8000-000000000003";
    const workerConversationId = "70000000-0000-4000-8000-000000000003";
    const workerMessageId = "80000000-0000-4000-8000-000000000003";
    await runtime.query(
      "INSERT INTO channel_identities (id,store_id,channel,external_user_id) VALUES ($1,$2,'whatsapp','worker-contact')",
      [workerIdentityId, storeB],
    );
    await runtime.query(
      "INSERT INTO conversations (id,store_id,connection_id,identity_id,channel) VALUES ($1,$2,$3,$4,'whatsapp')",
      [workerConversationId, storeB, connectionB, workerIdentityId],
    );
    await runtime.query(
      "INSERT INTO conversation_messages (id,store_id,conversation_id,connection_id,direction,content) VALUES ($1,$2,$3,$4,'inbound','worker message')",
      [workerMessageId, storeB, workerConversationId, connectionB],
    );
    const workerIdentities = await runtime.query("SELECT count(*)::int AS count FROM channel_identities");
    const workerConversations = await runtime.query("SELECT count(*)::int AS count FROM conversations");
    const workerMessages = await runtime.query("SELECT count(*)::int AS count FROM conversation_messages");
    assert.equal(workerIdentities.rows[0].count, 3, "authenticated channel worker must insert identities across stores");
    assert.equal(workerConversations.rows[0].count, 3, "authenticated channel worker must insert conversations across stores");
    assert.equal(workerMessages.rows[0].count, 3, "authenticated channel worker must insert messages across stores");
    const workerCredentials = await runtime.query("SELECT count(*)::int AS count FROM channel_credentials");
    assert.equal(workerCredentials.rows[0].count, 2, "authenticated channel worker must resolve encrypted provider credentials");
    await runtime.query("SELECT set_config('app.channel_worker','false',true)");
    const merchantConnections = await runtime.query("SELECT count(*)::int AS count FROM channel_connections");
    assert.equal(merchantConnections.rows[0].count, 1, "worker capability must be transaction-local and revocable");
    const merchantIdentities = await runtime.query("SELECT count(*)::int AS count FROM channel_identities");
    const merchantConversations = await runtime.query("SELECT count(*)::int AS count FROM conversations");
    const merchantMessages = await runtime.query("SELECT count(*)::int AS count FROM conversation_messages");
    assert.equal(merchantIdentities.rows[0].count, 1, "worker capability must not widen merchant identity access");
    assert.equal(merchantConversations.rows[0].count, 1, "worker capability must not widen merchant conversation access");
    assert.equal(merchantMessages.rows[0].count, 1, "worker capability must not widen merchant message access");
    const workerCannotReadOAuth = await runtime.query("SELECT count(*)::int AS count FROM channel_oauth_states");
    assert.equal(workerCannotReadOAuth.rows[0].count, 0, "channel worker must not access OAuth transaction state");
    await runtime.query("SELECT set_config($1,$2,true)", ["app.channel_oauth","true"]);
    const oauthCredentials = await runtime.query("SELECT count(*)::int AS count FROM channel_credentials");
    const oauthStates = await runtime.query("SELECT count(*)::int AS count FROM channel_oauth_states");
    assert.equal(oauthCredentials.rows[0].count, 2, "OAuth capability must access the encrypted credential vault");
    assert.equal(oauthStates.rows[0].count, 2, "OAuth capability must access one-time transaction state");
    await runtime.query("SELECT set_config($1,$2,true)", ["app.channel_oauth","false"]);

    const crossTenantWalletUpdate = await runtime.query(
      "UPDATE store_wallet_accounts SET available_balance_minor=0 WHERE store_id=$1",
      [storeB],
    );
    assert.equal(crossTenantWalletUpdate.rowCount, 0, "merchant A must not mutate tenant B wallet balance");
    const crossTenantSmsConfig = await runtime.query(
      "UPDATE store_sms_billing_config SET enabled=false WHERE store_id=$1",
      [storeB],
    );
    assert.equal(crossTenantSmsConfig.rowCount,0,"merchant A must not change tenant B SMS billing config");
    const merchantSmsConfigWrite = await runtime.query(
      "UPDATE store_sms_billing_config SET unit_rate_minor=1 WHERE store_id=$1",
      [storeA],
    );
    assert.equal(merchantSmsConfigWrite.rowCount,0,"merchant sessions must not change platform-controlled SMS rates");
    const merchantTopupStatusWrite = await runtime.query(
      "UPDATE wallet_topup_attempts SET status='paid' WHERE store_id=$1",
      [storeA],
    );
    assert.equal(merchantTopupStatusWrite.rowCount,0,"merchants must not mark wallet top-ups paid");
    await runtime.query("SAVEPOINT before_cross_tenant_topup_insert");
    await runtime.query("SELECT set_config('app.wallet_topup','true',true)");
    await assert.rejects(
      runtime.query(
        "INSERT INTO wallet_topup_attempts (store_id,amount_minor,customer_phone,idempotency_key,idempotency_hash) VALUES ($1,1000,'254700000001','forged-topup-tenant-b',$2)",
        [storeB,"c".repeat(64)],
      ),
      /row-level security/i,
      "store owner A must not initiate a wallet top-up for store B",
    );
    await runtime.query("ROLLBACK TO SAVEPOINT before_cross_tenant_topup_insert");
    await runtime.query("RELEASE SAVEPOINT before_cross_tenant_topup_insert");
    await runtime.query("SELECT set_config('app.wallet_topup','false',true)");
    await runtime.query("SELECT set_config('app.mpesa_callback','true',true)");
    await runtime.query(
      "INSERT INTO mpesa_receipt_claims (receipt_number,payment_type,payment_attempt_id,store_id) VALUES ('MPESA123456','wallet_topup',$1,$2)",
      [topupA,storeA],
    );
    const topupLedger = await runtime.query(
      "INSERT INTO store_wallet_transactions (store_id,transaction_type,amount_minor,currency,idempotency_key,reference_type,reference_id,description) VALUES ($1,'top_up',1000,'KES',$2,'mpesa','MPESA123456','Verified wallet top-up') ON CONFLICT (store_id,idempotency_key) DO NOTHING RETURNING id",
      [storeA,"mpesa-topup:"+topupA],
    );
    assert.equal(topupLedger.rowCount,1,"first verified top-up must create one ledger credit");
    await runtime.query("UPDATE store_wallet_accounts SET available_balance_minor=available_balance_minor+1000 WHERE store_id=$1",[storeA]);
    const duplicateTopupLedger = await runtime.query(
      "INSERT INTO store_wallet_transactions (store_id,transaction_type,amount_minor,currency,idempotency_key,reference_type,reference_id,description) VALUES ($1,'top_up',1000,'KES',$2,'mpesa','MPESA123456','Verified wallet top-up') ON CONFLICT (store_id,idempotency_key) DO NOTHING RETURNING id",
      [storeA,"mpesa-topup:"+topupA],
    );
    assert.equal(duplicateTopupLedger.rowCount,0,"replayed top-up must not create a second credit");
    const creditedBalance = await runtime.query("SELECT available_balance_minor FROM store_wallet_accounts WHERE store_id=$1",[storeA]);
    assert.equal(Number(creditedBalance.rows[0].available_balance_minor),6000,"replayed top-up must not increment wallet balance twice");
    await runtime.query("UPDATE wallet_topup_attempts SET status='paid',provider_reference='MPESA123456' WHERE id=$1",[topupA]);
    await runtime.query("SELECT set_config('app.mpesa_callback','false',true)");
    await runtime.query("SELECT set_config('app.message_worker','true',true)");
    const workerSmsConfig = await runtime.query("SELECT count(*)::int AS count FROM store_sms_billing_config");
    assert.equal(workerSmsConfig.rows[0].count,2,"message worker must read billing configuration across stores");
    await runtime.query("SELECT store_id FROM store_sms_billing_config WHERE store_id=$1 FOR UPDATE",[storeA]);
    await runtime.query("SELECT set_config('app.message_worker','false',true)");
    await runtime.query("SAVEPOINT before_cross_tenant_wallet_reservation");
    await assert.rejects(
      runtime.query(
        "INSERT INTO store_wallet_reservations (store_id,amount_minor,idempotency_key) VALUES ($1,10,'forged-cross-tenant-wallet')",
        [storeB],
      ),
      /row-level security/i,
      "merchant A must not create a wallet reservation for tenant B",
    );
    await runtime.query("ROLLBACK TO SAVEPOINT before_cross_tenant_wallet_reservation");
    await runtime.query("RELEASE SAVEPOINT before_cross_tenant_wallet_reservation");

    const crossTenantUpdate = await runtime.query(
      "UPDATE orders SET customer_note='unauthorized' WHERE store_id=$1",
      [storeB],
    );
    assert.equal(crossTenantUpdate.rowCount, 0, "user A must not update tenant B orders");

    const crossTenantAttachmentUpdate = await runtime.query(
      "UPDATE conversation_attachments SET scan_status='available' WHERE store_id=$1",
      [storeB],
    );
    assert.equal(crossTenantAttachmentUpdate.rowCount, 0, "user A must not change tenant B attachment visibility");

    await runtime.query("SAVEPOINT before_cross_tenant_attachment_insert");
    await assert.rejects(
      runtime.query(
        "INSERT INTO conversation_attachments (store_id,message_id,storage_key,mime_type) VALUES ($1,$2,'tenant-b/forged-object','image/jpeg')",
        [storeB, messageB],
      ),
      /row-level security/i,
      "user A must not attach media to tenant B messages",
    );
    await runtime.query("ROLLBACK TO SAVEPOINT before_cross_tenant_attachment_insert");
    await runtime.query("RELEASE SAVEPOINT before_cross_tenant_attachment_insert");

    await runtime.query("SAVEPOINT before_cross_tenant_product_insert");
    await assert.rejects(
      runtime.query(
        "INSERT INTO products (store_id,name,slug,price_minor,status) VALUES ($1,'Intrusion','intrusion',1,'active')",
        [storeB],
      ),
      /row-level security/i,
      "user A must not insert products into tenant B",
    );
    await runtime.query("ROLLBACK TO SAVEPOINT before_cross_tenant_product_insert");
    await runtime.query("RELEASE SAVEPOINT before_cross_tenant_product_insert");
    await runtime.query("ROLLBACK");
  } catch (error) {
    await runtime.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    runtime.release();
  }

  const authIdentity = await authPool.query(
    "SELECT current_user AS role, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypassrls",
  );
  assert.deepEqual(authIdentity.rows[0], { role: "commerce_auth_app", bypassrls: false });
  await authPool.query('SELECT count(*) FROM public."user"');
  await assert.rejects(
    authPool.query("SELECT count(*) FROM public.stores"),
    /permission denied/i,
    "Better Auth role must not read commerce stores",
  );
  await assert.rejects(
    runtimePool.query('SELECT count(*) FROM public."user"'),
    /permission denied/i,
    "Commerce role must not read Better Auth identity data",
  );

  console.log("Database security verification passed: runtime roles, least privilege, forced RLS and cross-tenant isolation.");
} finally {
  await runtimePool?.end();
  await authPool?.end();
  await owner.end();
}
