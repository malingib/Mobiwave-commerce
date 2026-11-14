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
];

const appUrl = new URL(databaseUrl);
appUrl.username = "commerce_app";
appUrl.password = "commerce-test-only";

let runtimePool;
let authPool;

try {
  await owner.query("CREATE ROLE commerce_app LOGIN BYPASSRLS PASSWORD 'commerce-test-only'");
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
    WHERE rolname IN ('commerce_app', 'commerce_runtime', 'commerce_auth_runtime')
    ORDER BY rolname
  `);
  assert.deepEqual(
    roleChecks.rows.map(({ rolname, rolcanlogin, rolbypassrls }) => ({ rolname, rolcanlogin, rolbypassrls })),
    [
      { rolname: "commerce_app", rolcanlogin: true, rolbypassrls: true },
      { rolname: "commerce_auth_runtime", rolcanlogin: false, rolbypassrls: false },
      { rolname: "commerce_runtime", rolcanlogin: false, rolbypassrls: false },
    ],
  );

  const privilegeChecks = await owner.query(`
    SELECT
      has_table_privilege('commerce_runtime', 'public."user"', 'SELECT') AS runtime_reads_auth,
      has_table_privilege('commerce_runtime', 'public.orders', 'SELECT') AS runtime_reads_orders,
      has_table_privilege('commerce_auth_runtime', 'public.stores', 'SELECT') AS auth_reads_stores,
      has_table_privilege('commerce_auth_runtime', 'public."user"', 'SELECT') AS auth_reads_users
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

  runtimePool = new Pool({
    connectionString: appUrl.toString(),
    options: "-c role=commerce_runtime",
    max: 2,
  });
  authPool = new Pool({
    connectionString: appUrl.toString(),
    options: "-c role=commerce_auth_runtime",
    max: 1,
  });

  const runtime = await runtimePool.connect();
  try {
    await runtime.query("BEGIN");
    const identity = await runtime.query(
      "SELECT current_user AS role, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypassrls",
    );
    assert.deepEqual(identity.rows[0], { role: "commerce_runtime", bypassrls: false });
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
    ];
    for (const table of tenantTables) {
      const result = await runtime.query(`SELECT count(*)::int AS count FROM ${table}`);
      assert.equal(result.rows[0].count, 1, `user A must see exactly one row in ${table}`);
    }

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
  assert.deepEqual(authIdentity.rows[0], { role: "commerce_auth_runtime", bypassrls: false });
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
