# Nasaf Digital — Devor ekrani

Ofis televizori uchun statistika taxtasi: loyihalar holati, xodimlar
reytingi, bugungi ishlar lentasi va tabriklar. Ma'lumot asosiy
**Nasaf Digital Tracker** bazasidan olinadi.

Sayt: https://nasaf-wall-screen.vercel.app/

## Ishga tushirish

```bash
npm install
vercel env pull .env     # TV faqat `.env` ni o'qiydi; yoki .env.example bo'yicha qo'lda
npm run dev              # http://localhost:5077
```

Kerakli o'zgaruvchilar (`.env.example` da izohi bilan):

| Kalit | Nima |
|---|---|
| `DATABASE_URL` | Tracker bilan **bir xil** Supabase bazasi |
| `DATABASE_SSL` | `true` (Supabase) |
| `BOT_TOKEN` | Tracker bot'i — kirish kodlari shu orqali yuboriladi |
| `JWT_SECRET` | Faqat shu loyihaning tasodifiy uzun kaliti (sessiya imzosi) |
| `PORT` | Lokal port, standart 5077 |

Birinchi marta: `npm run db:migrate` — `wall_otp_codes` jadvalini
yaratadi (boshqa jadvallar Tracker'niki).

## Kirish

Telefon raqam kiritiladi → Tracker bot'i Telegram'ga 6 xonali kod
yuboradi → kod kiritiladi → 30 kunlik sessiya. Faqat Tracker'da faol va
Telegram'i ulangan xodimlar kira oladi.

## Deploy

`main` ga push → Vercel avtomatik deploy qiladi. Televizordagi ilova
saytni ochadi, shuning uchun sayt yangilanishi televizorga hech narsa
o'rnatishni talab qilmaydi.

## Televizorga o'rnatish (LG webOS)

Faqat LG ilovani o'chirib yuborganda kerak (proshivka yangilanishi yoki
Developer Mode muddati tugashi):

1. Televizorda Developer Mode ilovasini ochib, sessiyani yoqing.
2. Ofis tarmog'idagi kompyuterdan:

```bash
tv/deploy.sh                          # standart IP
TV_IP=192.168.100.50 tv/deploy.sh     # boshqa IP
```

Skript `~/.ssh/webos_nasaftv_plain` kalitini kutadi (repoda yo'q, egasidan
oling yoki Developer Mode'dan qayta yarating).

## Tuzilma

`CLAUDE.md` ga qarang — fayllar, hisob-kitob qoidalari va nozikliklar
o'sha yerda.
