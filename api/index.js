// Vercel Node.js funksiyalari (req,res)ni to'g'ridan-to'g'ri chaqiradi
// (Lambda event/context emas) — Express ilovaning o'zi ham xuddi shu
// signaturaga ega, shuning uchun serverless-http kabi o'rovchisiz ham
// ishlaydi. Asosiy Tracker loyihasidagi api/index.js bilan bir xil
// yondashuv (serverless-http u yerda Netlify funksiyasi yo'li uchun
// alohida saqlangan, Vercel yo'lida ishlatilmaydi).
module.exports = require("../server/app");
