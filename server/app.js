// ═══════════════════════════════════════════════════════════════════════
// Devor ekrani — Express ilovasi. Asosiy Tracker loyihasidagi single-
// function Vercel konventsiyasi bilan bir xil (bitta funksiya, bitta
// rewrite — bu sessiyada Vercel'ning ko'p-segmentli /api/* yo'llarni
// buzadigan xatosi shu tarzda oldini olingan edi, shuning uchun bu yerda
// ham boshidanoq bitta funksiya saqlanadi).
// ═══════════════════════════════════════════════════════════════════════

const path = require("path");
const fs = require("fs");
const express = require("express");
const { requestCode, verifyCode, requireAuth } = require("./lib/auth");
const { getWallStats, getCelebrations } = require("./lib/stats");

const app = express();
app.use(express.json());

function sendIndexHtml(res) {
  const indexPath = path.join(process.cwd(), "web", "index.html");
  try {
    const html = fs.readFileSync(indexPath, "utf8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.send(html);
  } catch (e) {
    res.status(500).json({ error: "Sahifa topilmadi", detail: e.message });
  }
}

app.get("/", (req, res) => sendIndexHtml(res));

app.post("/api/auth/request-code", requestCode);
app.post("/api/auth/verify-code", verifyCode);

app.get("/api/stats", requireAuth, async (req, res) => {
  try {
    const stats = await getWallStats();
    res.json(stats);
  } catch (e) {
    console.error("Stats xatosi:", e);
    res.status(500).json({ error: e.message });
  }
});

// "Qarsak" tabrigi uchun — frontend buni har necha soniyada bir
// so'raydi (to'liq /api/stats'dan ancha yengil). `since` bo'lmasa,
// hozirgi vaqtdan boshlab hisoblaydi (birinchi so'rovda eski hodisalar
// bilan "to'lib ketmasin" deb).
app.get("/api/celebrations", requireAuth, async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date();
    if (isNaN(since.getTime())) return res.status(400).json({ error: "since noto'g'ri" });
    const events = await getCelebrations(since.toISOString());
    res.json({ ok: true, events, now: new Date().toISOString() });
  } catch (e) {
    console.error("Celebrations xatosi:", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
