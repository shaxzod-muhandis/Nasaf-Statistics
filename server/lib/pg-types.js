// ═══════════════════════════════════════════════════════════════════════
// `pg` standart holatda Postgres `date` ustunini JS Date obyektiga
// aylantiradi. Butun kod bazasi (lib/dates.js) sanalarni "YYYY-MM-DD"
// SATR sifatida solishtiradi/formatlaydi — agar `pg` buni Date obyektiga
// aylantirsa, masalan `cycle.period_end < today` kabi solishtirishlar
// NOTO'G'RI natija beradi (Date→primitive konversiyasi "YYYY-MM-DD"
// emas, `Date.toString()` uzun formatida bo'ladi).
//
// Shu sababli `date` ustunini xom satr holida qaytarishga majburlaymiz.
// Bu fayl process boshida BIR MARTA import qilinishi kifoya — `pg`
// modulidagi type-parser registry butun process uchun global.
// ═══════════════════════════════════════════════════════════════════════
const { types } = require("pg");
const DATE_OID = 1082; // Postgres'da `date` turining OID raqami
types.setTypeParser(DATE_OID, (val) => val);
