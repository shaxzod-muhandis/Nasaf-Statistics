// ═══════════════════════════════════════════════════════════════════════
// Minimal Telegram sendMessage — asosiy Tracker loyihasidagi
// notify.js#sendMsg bilan bir xil mantiq (faqat shu loyihaga kerakli
// qismi: OTP kodni yuborish uchun).
// ═══════════════════════════════════════════════════════════════════════

async function sendTelegramMessage(chatId, text) {
  const botToken = process.env.BOT_TOKEN || "";
  if (!botToken || !chatId) return { ok: false, reason: "no_token_or_chatid" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`TG xato (${chatId}) [${r.status}]:`, JSON.stringify(b));
      return { ok: false, status: r.status, body: b };
    }
    return { ok: true };
  } catch (e) {
    console.error(`TG fetch xato (${chatId}):`, e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendTelegramMessage };
