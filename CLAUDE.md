# Nasaf Digital — Devor ekrani (TV): Claude uchun yo'riqnoma

Avval shuni o'qing, keyin `README.md`. Asosiy tizim — qo'shni
**Nasaf-digital-Tracker** repo (`nasaf-tracker`); uning `CLAUDE.md`,
`docs/UI-USLUB.md` va `docs/OCHIQ-ISHLAR.md` fayllari bu loyihaga ham
tegishli.

## Loyiha nima

Ofisdagi LG televizorda (webOS) doim ochiq turadigan statistika taxtasi:
loyihalar holati (post/stories rejasi), xodimlar reytingi, bugungi ishlar
lentasi, muddati o'tgan vazifalar, 30 kunlik faollik va "qarsak" tabriklari
(xodim ish belgilaganda ekranda tabrik chiqadi, uning tanlagan qo'shig'i
chalinadi).

- Sayt: `https://nasaf-wall-screen.vercel.app/`
- Tracker bilan **bir xil Supabase bazani** o'qiydi (bir xil `DATABASE_URL`).
  Bu loyiha bazaga deyarli yozmaydi — yagona o'z jadvali `wall_otp_codes`.
- Kirish: telefon raqam → Tracker bot'i orqali 6 xonali kod → 30 kunlik JWT.
  Faqat `users` jadvalidagi faol, Telegram'i ulangan xodimlar kira oladi.

Til: interfeys, izohlar, commit xabarlari — **o'zbekcha (lotin)**.

## Tuzilma

| Yo'l | Nima |
|---|---|
| `web/index.html` | Butun frontend — bitta fayl: login + dashboard (1920×1080 kanvas) |
| `server/app.js` | Express: `/`, `/api/auth/request-code`, `/api/auth/verify-code`, `/api/stats`, `/api/celebrations` |
| `server/lib/stats.js` | **Barcha hisob-kitob**: loyiha foizi, reja, holat, reyting, lenta, tabriklar |
| `server/lib/auth.js` | OTP kod, rate limit, JWT |
| `server/lib/db.js`, `telegram.js`, `dates.js` | Baza, bot orqali xabar, Toshkent sanasi |
| `api/index.js` | Vercel kirish nuqtasi (`server/app.js` ni qayta ishlatadi) |
| `server/local.js` | Lokal server (`npm run dev`, port 5077) |
| `supabase/migrations/` | Faqat `wall_otp_codes` jadvali |
| `tv/app/` | webOS ilovasi — saytni to'liq ekranda ochadigan qobiq |
| `tv/deploy.sh` | Ilovani televizorga o'rnatish (LAN orqali, Developer Mode) |

## Buyruqlar

```bash
npm install
vercel env pull .env   # TV faqat `.env` ni o'qiydi (.env.local emas)
npm run dev         # http://localhost:5077
npm run db:migrate  # wall_otp_codes (PROD bazaga!)
tv/deploy.sh        # televizorga o'rnatish (ofis tarmog'ida)
```

Bu repoda avtomatik test yo'q. `stats.js` ni tekshirish uchun: `db.js`
ni `require.cache` orqali soxta bilan almashtirib, funksiyalarni to'g'ridan-
to'g'ri chaqiring, yoki prod bazadan `begin read only … rollback` ichida
o'qing.

## ⚠️ Qat'iy qoidalar

1. **Prod baza umumiy.** Bu yerdagi xato Tracker ma'lumotiga ta'sir
   qiladi. Bazaga faqat o'qish; `wall_otp_codes` dan boshqa jadvalga yozmang.
   Tahlil so'rovlari `begin read only; … rollback;` ichida.
2. **Foiz, reja va holat Tracker bilan bir xil bo'lishi SHART.** Panel
   (`private/app.html`), bot (`netlify/functions/api.js`) va shu repodagi
   `stats.js` bir xil hisoblaydi. Birida o'zgartirsangiz — uchalasida.
   Qoida va kalitlar jadvali: Tracker `CLAUDE.md` → "Uch joyda bir xil".
   - foiz = (bajarilgan post + stories) / (reja post + stories);
   - reja = kunlik (`expectedPctOf`);
   - holat: `REJA_TOLERANCE = 2`, `JIDDIY_ORTDA_GAP = 12`
     (`classifyProject`). TV kalitlari: `done`, `ahead`, `onTrack`,
     `behind` (= Ortda, sariq), `late` (= Jiddiy ortda), `debt`.
     Yorliqlar `web/index.html` → `STATUS_LABEL`.
3. **`@nasafdigital_manager` — test hisobi**, real xodim emas. Hozir
   `stats.js` da uni chiqarib tashlaydigan filtr **yo'q** — reyting yoki
   lentada ko'rinsa, bu sinov qoldig'i. Ma'lumotni tahlil qilganda uni
   hisobga olmang.
4. **Maxfiy qiymatlar** (`DATABASE_URL`, `BOT_TOKEN`, `JWT_SECRET`) kodga
   va commit'ga yozilmaydi. `JWT_SECRET` faqat shu loyihaniki.
5. **Televizor ssh kaliti** (`~/.ssh/webos_nasaftv_plain`) repoda yo'q va
   bo'lmasligi kerak. `known_hosts` ga avtomatik yozuv qo'shilmaydi.

## Ekran qanday ishlaydi (muhim nozikliklar)

- **Kanvas 1920×1080 qat'iy.** Dizayn aniq piksellarda; boshqa ekranlarda
  `fitCanvas()` uni `transform: scale` bilan moslaydi. 880px dan tor
  ekranda (telefon) kichraytirish o'chadi va tarkib bir ustunga tushadi.
  Yangi blokni piksellarda, kanvas ichida joylashtiring.
- **Loyiha kartalari sahifalanadi**, aylantirilmaydi: sig'magani 30
  soniyada keyingi sahifaga o'tadi (`startProjectRotation`). Gorizontal
  aylantirish ataylab olib tashlangan.
- **Ekran uxlamasligi:** Wake Lock + zaxira sifatida yashirin video
  (`keepScreenAwake`). Olib tashlamang — televizor ekrani o'chib qoladi.
- **Soat Toshkent vaqtida** (`tashkentNow`), televizor vaqt zonasiga
  bog'liq emas.
- **Tabrik ovozi** Web Audio orqali chalinadi (webOS avtomatik ijroni
  bloklaydi). Xodimning qo'shig'i Tracker profilida tanlanadi, tanlangan
  nuqtadan 10 soniya.
- **webOS ilovasi** (`tv/app/index.html`) faqat saytni ochadi va Wi-Fi
  ulanishini kutadi. Sayt yangilanishi televizorga qayta o'rnatishni
  talab qilmaydi — `main` ga push yetarli. `tv/deploy.sh` faqat LG
  ilovani o'chirib yuborganda (proshivka yangilanishi, Developer Mode
  muddati) kerak.

## UI

TV Tracker brend tizimida (Sora shrifti, brend ko'k `#2f7ab9`, holat
ranglari), lekin CSS o'zgaruvchilarisiz — ranglar to'g'ridan-to'g'ri
yozilgan. Yangi rang/komponent qo'shganda Tracker'ning
`docs/UI-USLUB.md` dagi qiymatlarini ishlating. Ekran 3–5 metrdan
o'qiladi: matn yirik, kontrast yuqori, harakat kam.

## Ishni topshirish

- Commit xabari o'zbekcha, `TV:` bilan boshlanadi
  (masalan `TV: reja chizig'i kunlik siljiydi`).
- `main` ga push = prod deploy (Vercel). Deploy `success` bo'lgach,
  saytni brauzerda 1920×1080 va telefon kengligida tekshiring.
- Holat mantig'iga tegilgan bo'lsa — Tracker'dagi panel va bot bilan bir
  xil raqam chiqishini real ma'lumotda solishtiring.
