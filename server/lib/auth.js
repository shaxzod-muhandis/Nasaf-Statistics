// ═══════════════════════════════════════════════════════════════════════
// Telefon raqam + Telegram bot orqali bir martalik kod (OTP) bilan kirish.
// Faqat users jadvalidagi mavjud, faol, telegram_chat_id'i bor xodimlar
// kira oladi (whitelist) — SMS xizmati o'rniga, kod ASOSIY Tracker
// loyihasining bir xil Telegram boti orqali yuboriladi.
// ═══════════════════════════════════════════════════════════════════════

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("./db");
const { sendTelegramMessage } = require("./telegram");

const OTP_TTL_MS = 5 * 60 * 1000; // 5 daqiqa
const OTP_MAX_ATTEMPTS = 5;
const REQUEST_RATE_LIMIT = 3; // shu vaqt oynasida nechta kod so'rash mumkin
const REQUEST_RATE_WINDOW_MIN = 10;
const TOKEN_TTL = "30d"; // "tokenning yaroqlilik muddati 1 oy" talabi

// O'zbekiston milliy raqam uzunligi (9 xona) bo'yicha solishtiradi —
// foydalanuvchi "+998 91 950 97 11" yoki "998919509711" yoki "919509711"
// qanday formatda kiritishidan qat'i nazar bir xil ishlaydi.
function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.slice(-9);
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

async function findActiveUserByPhone(normalizedPhone) {
  if (!normalizedPhone) return null;
  const r = await db.query(
    `select id, username, first_name, last_name, telegram_chat_id
     from users
     where is_active and telegram_chat_id is not null and phone is not null
       and right(regexp_replace(phone, '\\D', '', 'g'), 9) = $1`,
    [normalizedPhone],
  );
  return r.rows[0] || null;
}

async function requestCode(req, res) {
  try {
    const normalized = normalizePhone(req.body.phone);
    if (normalized.length !== 9) {
      return res.status(400).json({ error: "Telefon raqam noto'g'ri" });
    }

    // Javob HAR DOIM bir xil ("ok") — raqam topilmasa ham, limitga tegib
    // qolsa ham — shu orqali "qaysi raqamlar ro'yxatda bor" bilinmasligi
    // uchun (enumeration'ning oldini olish). Haqiqiy kod faqat mos kelgan
    // va limitga tegmagan holatdagina yuboriladi.
    const genericOk = () => res.json({ ok: true });

    const recentR = await db.query(
      `select count(*)::int as n from wall_otp_codes
       where phone = $1 and created_at > now() - ($2 * interval '1 minute')`,
      [normalized, REQUEST_RATE_WINDOW_MIN],
    );
    if (recentR.rows[0].n >= REQUEST_RATE_LIMIT) return genericOk();

    const user = await findActiveUserByPhone(normalized);
    if (!user) return genericOk();

    const code = generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await db.query(`insert into wall_otp_codes (phone, code_hash, expires_at) values ($1,$2,$3)`, [
      normalized,
      hashCode(code),
      expiresAt,
    ]);

    sendTelegramMessage(
      user.telegram_chat_id,
      `🔐 <b>Devor ekrani uchun kod:</b> ${code}\n5 daqiqa amal qiladi.`,
    ).catch((e) => console.error("OTP yuborish xatosi:", e.message));

    return genericOk();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function verifyCode(req, res) {
  try {
    const normalized = normalizePhone(req.body.phone);
    const code = String(req.body.code || "").trim();
    if (normalized.length !== 9 || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Ma'lumot noto'g'ri" });
    }

    const r = await db.query(
      `select * from wall_otp_codes
       where phone = $1 and consumed_at is null and expires_at > now()
       order by created_at desc limit 1`,
      [normalized],
    );
    const row = r.rows[0];
    if (!row) return res.status(400).json({ error: "Kod eskirgan yoki topilmadi. Qaytadan so'rang." });
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Urinishlar soni tugadi. Qaytadan kod so'rang." });
    }

    if (hashCode(code) !== row.code_hash) {
      await db.query(`update wall_otp_codes set attempts = attempts + 1 where id = $1`, [row.id]);
      return res.status(400).json({ error: "Kod noto'g'ri" });
    }

    const user = await findActiveUserByPhone(normalized);
    if (!user) return res.status(403).json({ error: "Ruxsat yo'q" });

    await db.query(`update wall_otp_codes set consumed_at = now() where id = $1`, [row.id]);

    const token = jwt.sign({ sub: user.id, phone: normalized }, process.env.JWT_SECRET, {
      expiresIn: TOKEN_TTL,
    });
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username;
    res.json({ ok: true, token, name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Kirish talab qilinadi" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Sessiya eskirgan, qaytadan kiring" });
  }
}

module.exports = { requestCode, verifyCode, requireAuth, normalizePhone };
