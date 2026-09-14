#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// supabase/migrations/*.sql fayllarini DATABASE_URL'ga tartib bilan
// qo'llaydi. `npm run db:migrate` orqali ishga tushiriladi.
//
// Eslatma: buni Supabase SQL Editor'da qo'lda ham bajarish mumkin —
// bu skript shunchaki qulaylik uchun (CI/terminal'dan bir buyruq bilan).
// ═══════════════════════════════════════════════════════════════════════

require("./_env").loadEnv();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ DATABASE_URL environment o'zgaruvchisi topilmadi.");
    console.error("   .env faylida yoki shell'da DATABASE_URL='postgresql://...' o'rnating.");
    process.exit(1);
  }

  const dir = path.join(__dirname, "..", "supabase", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("Hech qanday migratsiya fayli topilmadi:", dir);
    return;
  }

  const client = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("✅ Bazaga ulandi.");

  try {
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      console.log(`▶ Bajarilmoqda: ${file} ...`);
      await client.query(sql);
      console.log(`  ✅ ${file} muvaffaqiyatli`);
    }
    console.log("\n🎉 Barcha migratsiyalar muvaffaqiyatli qo'llandi.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("❌ Migratsiya xatosi:", e.message);
  process.exit(1);
});
