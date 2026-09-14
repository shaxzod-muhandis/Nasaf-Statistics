-- ═══════════════════════════════════════════════════════════════════════
-- Devor ekrani — telefon raqam orqali kirish uchun bir martalik kodlar.
-- Asosiy Tracker loyihasi bilan BIR XIL bazada yashaydi (shu jadval
-- boshqa hech qaysi loyihaga tegishli emas, faqat shu kirish oqimi
-- uchun).
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists wall_otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_wall_otp_phone on wall_otp_codes(phone, created_at desc);
