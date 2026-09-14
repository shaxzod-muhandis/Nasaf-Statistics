// ═══════════════════════════════════════════════════════════════════════
// Postgres ulanish qatlami (Supabase)
// ═══════════════════════════════════════════════════════════════════════
// JSONBin.io'dagi readData()/writeData() o'rnini bu fayl bosadi. Netlify
// Functions har chaqiriqda yangi "cold start" bo'lishi mumkin, shu sababli
// pool modul darajasida (module-level) yaratiladi — "warm" chaqiriqlarda
// qayta ishlatiladi (xuddi eski kodning `_cache` o'zgaruvchisi kabi).
//
// DATABASE_URL — Supabase loyihasida "Connection Pooling" (Transaction
// mode, port 6543) connection string bo'lishi kerak, masalan:
//   postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres
// Bu rejim serverless funksiyalar uchun maxsus mo'ljallangan (pgbouncer),
// oddiy uzoq muddatli ulanishlar sonini cheklaydi. Batafsil: docs/SETUP.md
// ═══════════════════════════════════════════════════════════════════════

require("./pg-types"); // `date` ustunlarini satr sifatida qaytarish uchun (pastdagi izohga qarang)
const { Pool } = require("pg");

let _pool = null;

function getPool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL sozlanmagan! .env / Netlify environment variables'ni tekshiring.",
    );
  }
  _pool = new Pool({
    connectionString,
    max: 3, // pgbouncer (transaction pooling) orqasida bitta funksiya instance uchun yetarli
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  _pool.on("error", (err) => {
    // Idle client xatosi butun funksiyani yiqitmasligi kerak
    console.error("Postgres pool xatosi:", err.message);
  });
  return _pool;
}

// Oddiy so'rov — bitta query
async function query(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

// Tranzaksiya — bir nechta so'rovni atomik bajarish uchun
async function withTransaction(fn) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { getPool, query, withTransaction };
