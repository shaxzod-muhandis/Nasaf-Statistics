// Faqat lokal ishlab chiqish uchun — Vercel production'da api/index.js
// ishlatiladi (bu fayl production'da chaqirilmaydi).
require("../scripts/_env").loadEnv();
const app = require("./app");

const port = process.env.PORT || 5077;
app.listen(port, () => console.log(`Devor ekrani lokal serveri: http://localhost:${port}`));
