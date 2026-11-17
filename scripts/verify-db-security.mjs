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
    "INSERT INTO store_domains (store_id,hostname) VALUES ($1,'tenant-a.example.test'),($2,'tenant-b.example.test')",
    [storeA, storeB],
  );
  await owner.query(
    "INSERT INTO audit_events (store_id,action,resource_type) VALUES ($1,'created','store'),($2,'created','store')",
    [storeA, storeB],
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
      assert.equal(result.rows[0].count, 1, `user A must see exactly one row in ${table}`);
    }
    const privateWebhookEvents = await runtime.query("SELECT count(*)::int AS count FROM channel_webhook_events");
    const privateCredentials = await runtime.query("SELECT count(*)::int AS count FROM channel_credentials");
    const privateOAuthStates = await runtime.query("SELECT count(*)::int AS count FROM channel_oauth_states");
    assert.equal(privateWebhookEvents.rows[0].count, 0, "merchant sessions must not read raw webhook payloads");
    assert.equal(privateCredentials.rows[0].count, 0, "merchant sessions must not read encrypted provider credentials");
    assert.equal(privateOAuthStates.rows[0].count, 0, "merchant sessions must not read OAuth transaction state");

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
    const workerIdentities = await runtime.query("SELECT count(*)::int AS count FROM channel_identities");
    const workerConversations = await runtime.query("SELECT count(*)::int AS count FROM conversations");
    const workerMessages = await runtime.query("SELECT count(*)::int AS count FROM conversation_messages");
    assert.equal(workerIdentities.rows[0].count, 2, "authenticated channel worker must persist identities across stores");
    assert.equal(workerConversations.rows[0].count, 2, "authenticated channel worker must persist conversations across stores");
    assert.equal(workerMessages.rows[0].count, 2, "authenticated channel worker must persist messages across stores");
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

    const crossTenantUpdate = await runtime.query(
      "UPDATE orders SET customer_note='unauthorized' WHERE store_id=$1",
      [storeB],
    );
    assert.equal(crossTenantUpdate.rowCount, 0, "user A must not update tenant B orders");

    await assert.rejects(
      runtime.query(
        "INSERT INTO products (store_id,name,slug,price_minor,status) VALUES ($1,'Intrusion','intrusion',1,'active')",
        [storeB],
      ),
      /row-level security/i,
      "user A must not insert products into tenant B",
    );
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
