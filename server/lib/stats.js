// ═══════════════════════════════════════════════════════════════════════
// Devor ekrani uchun bitta umumiy statistika to'plami — hammaga bir xil
// ko'rinadi (shaxsiylashtirish yo'q). Yozish (rollover/cycle yaratish)
// mutlaqo qilmaydi — faqat asosiy Tracker allaqachon yozgan ma'lumotni
// o'qiydi, shu jumladan "qarz" tushunchasini xuddi asosiy loyihadagi
// getProjectCycleSummary()ning outstandingDebt mantig'i bilan bir xil
// tarzda (period_end < bugun VA maqsadga yetilmagan).
// ═══════════════════════════════════════════════════════════════════════

const db = require("./db");
const { todayTashkent, dayDiff, addDays } = require("./dates");

const MONTHS_UZ = [
  "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
  "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr",
];

// Loyiha holati BAJARILGAN va KUTILGAN foiz orasidagi farq bo'yicha
// aniqlanadi (foiz punktida):
//   0–5   → Rejada        (ko'k)
//   5–12  → Ortda         (sariq)
//   12+   → Jiddiy ortda  (qizil)
// Avval bu chegara vazifa SONI bilan solishtirilardi ("5 ta vazifa
// orqada"), shuning uchun katta loyihalarda deyarli hammasi "Ortda"
// bo'lib chiqardi.
const TEMPO_OK_GAP = 5;
const TEMPO_WARN_GAP = 12;

// Asosiy loyihadagi notify.js#projectPct bilan bir xil — Post 70%,
// Stories 30% og'irlikda (faqat bittasi bo'lsa, o'sha 100%).
function projectPct(doneK, k, doneS, s) {
  const hasK = k > 0;
  const hasS = s > 0;
  if (!hasK && !hasS) return 0;
  const kFrac = hasK ? doneK / k : 0;
  const sFrac = hasS ? doneS / s : 0;
  if (hasK && hasS) return Math.round((kFrac * 0.7 + sFrac * 0.3) * 100);
  return Math.round((hasK ? kFrac : sFrac) * 100);
}

function initials(name) {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

function fmtTime(d) {
  const dt = new Date(d);
  const tash = new Date(dt.getTime() + 5 * 60 * 60 * 1000);
  return `${String(tash.getUTCHours()).padStart(2, "0")}:${String(tash.getUTCMinutes()).padStart(2, "0")}`;
}

async function getActiveProjectsWithCycles() {
  const r = await db.query(`
    select
      p.id, p.label,
      pc.id as cycle_id, pc.period_start, pc.period_end,
      pc.posts_target, pc.stories_target,
      coalesce(ck.done_k, 0)::int as done_k,
      coalesce(ck.done_s, 0)::int as done_s
    from projects p
    join project_cycles pc on pc.project_id = p.id and pc.status = 'active'
    left join lateral (
      select count(*) filter (where type = 'k') as done_k,
             count(*) filter (where type = 's') as done_s
      from checks where cycle_id = pc.id
    ) ck on true
    where p.is_active = true
    order by p.label
  `);
  return r.rows;
}

// Diqqat: checks.editor_id/videographer_id juda kamdan-kam to'ldiriladi
// (real bazada 663 tadan atigi 18 tasida) — asosiy, deyarli har doim
// mavjud maydon done_by (kim ilovada belgini bosgan, users.id). Shu
// sababli "kim qildi" barcha joyda done_by/users asosida hisoblanadi,
// staff/editor-videographer emas (bu — dastlabki loyihada noto'g'ri
// taxmin qilingan edi, lokal test paytida haqiqiy ma'lumot bilan
// tekshirilib tuzatildi).
async function getTopContributors(cycleIds) {
  if (!cycleIds.length) return new Map();
  const r = await db.query(
    `select distinct on (cycle_id) cycle_id, name
     from (
       select c.cycle_id, u.id as user_id,
              coalesce(nullif(trim(concat(u.first_name, ' ', u.last_name)), ''), u.username) as name,
              count(*) as n
       from checks c
       join users u on u.id = c.done_by
       where c.cycle_id = any($1::uuid[])
       group by c.cycle_id, u.id, name
     ) agg
     order by cycle_id, n desc`,
    [cycleIds],
  );
  return new Map(r.rows.map((row) => [row.cycle_id, row.name]));
}

function classifyProject(row, today) {
  const isOverdue = row.period_end < today && (row.done_k < row.posts_target || row.done_s < row.stories_target);
  const donePct = projectPct(row.done_k, row.posts_target, row.done_s, row.stories_target);

  if (isOverdue) {
    return {
      status: "debt",
      statusLabel: "Qarz",
      daysLabel: `${dayDiff(row.period_end, today)} kun kechikdi`,
      donePct,
      deltaText: `${row.posts_target + row.stories_target - row.done_k - row.done_s} vazifa muddatdan chiqdi`,
    };
  }

  // To'liq bajarilgan loyiha — alohida, eng yaxshi holat. Tempo bilan
  // solishtirishning ma'nosi yo'q: ish tugagan, "necha foiz orqada"
  // degan savol qolmaydi.
  if (row.done_k >= row.posts_target && row.done_s >= row.stories_target) {
    return {
      status: "done",
      statusLabel: "Bajarildi",
      daysLabel: `${dayDiff(today, row.period_end)} kun qoldi`,
      donePct,
      deltaText: "Barcha vazifalar bajarildi",
    };
  }

  const daysElapsed = dayDiff(row.period_start, today) + 1;
  const totalDays = dayDiff(row.period_start, row.period_end) + 1;
  const expectedPct = Math.round(Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100)));
  const expectedItems = Math.round((expectedPct / 100) * (row.posts_target + row.stories_target));
  const actualItems = row.done_k + row.done_s;
  const delta = actualItems - expectedItems;

  // Rangni AYNAN ekranda ko'rinadigan raqamlar belgilaydi (ikkalasi ham
  // yaxlitlangan) — shunda ko'rsatkich bilan rang hech qachon
  // qarama-qarshi tushmaydi.
  const gap = expectedPct - donePct;
  let status = "onTrack";
  let statusLabel = "Rejada";
  if (gap > TEMPO_WARN_GAP) {
    status = "late";
    statusLabel = "Jiddiy ortda";
  } else if (gap > TEMPO_OK_GAP) {
    status = "behind";
    statusLabel = "Ortda";
  }

  // Matn holatdan mustaqil — vazifa soni bo'yicha aniq xabar beradi
  // (rejadan oldinda ketayotgan loyiha ham shu yerda ko'rinadi).
  const remaining = row.posts_target + row.stories_target - actualItems;
  const deltaText =
    delta > 0
      ? `Tempodan ${delta} vazifa oldinda`
      : delta < 0
        ? `Tempodan ${Math.abs(delta)} vazifa orqada`
        : `Tempoda · ${remaining} vazifa qoldi`;

  return {
    status,
    statusLabel,
    daysLabel: `${dayDiff(today, row.period_end)} kun qoldi`,
    donePct,
    expectedPct,
    deltaText,
  };
}

// Xodim reytingi loyihalar aro QO'SHILMAYDI — har bir xodim faqat
// bitta (shu oy eng ko'p ishlagan) loyihasi bo'yicha hisoblanadi, va
// qatorda ko'rsatilgan raqam ANIQ o'sha loyihaga tegishli (avval barcha
// loyihalar bo'yicha yig'indi ko'rsatilib, lekin faqat bitta loyiha
// nomi yozilardi — chalkashtirar edi, 2026-09-15 fikr-mulohaza).
// "Qoldi" ustuni ataylab yo'q — checklar oldindan xodimga
// "biriktirilmaydi" (ruxsati bor har kim istalgan postni belgilashi
// mumkin), shuning uchun "shaxsiy qolgan ish" tushunchasi bu ma'lumot
// modelida mavjud emas (avval loyihaning UMUMIY qolgan ishi
// ko'rsatilardi, lekin bu shaxsiy ko'rinib chalkashtirardi). Reyting va
// ko'rsatiladigan qator ENDI faqat BITTA aniq songa — shu oy shu
// loyihada bajargan ish soniga — asoslanadi.
async function getEmployeeLeaderboard(monthStart, today, projectsById) {
  const r = await db.query(
    `with by_project as (
       select c.done_by as user_id, pc.project_id, count(*) as n
       from checks c join project_cycles pc on pc.id = c.cycle_id
       where c.done_by is not null and c.work_date between $1 and $2
       group by c.done_by, pc.project_id
     ),
     top_per_user as (
       select distinct on (user_id) user_id, project_id, n
       from by_project
       order by user_id, n desc
     )
     select t.user_id, t.n as done_count, t.project_id,
            coalesce(nullif(trim(concat(u.first_name, ' ', u.last_name)), ''), u.username) as name,
            p.label as project_label
     from top_per_user t
     join users u on u.id = t.user_id and u.is_active
     join projects p on p.id = t.project_id
     order by t.n desc
     limit 10`,
    [monthStart, today],
  );

  return r.rows.map((row, idx) => {
    const project = projectsById.get(row.project_id);
    return {
      rank: idx + 1,
      name: row.name,
      avatar: initials(row.name),
      doneCount: row.done_count,
      projectLabel: row.project_label,
      projectStatusLabel: project ? project.statusLabel : "—",
    };
  });
}

const STORY_KIND_LABEL_UZ = { info: "Ma'lumot beruvchi", atmospheric: "Atmosferali video" };

async function getTodayFeed(today) {
  const r = await db.query(
    `select c.type, c.seq_number, c.done_at, c.story_kind, p.label as project_label,
            coalesce(nullif(trim(concat(u.first_name, ' ', u.last_name)), ''), u.username) as user_name
     from checks c
     join project_cycles pc on pc.id = c.cycle_id
     join projects p on p.id = pc.project_id
     left join users u on u.id = c.done_by
     where c.done_at is not null and (c.done_at + interval '5 hours')::date = $1::date
     order by c.done_at desc
     limit 20`,
    [today],
  );
  return r.rows.map((row) => {
    const kindLabel = row.type === "k" ? "Post" : "Stories";
    // story_kind — checks jadvalida haqiqatan bor maydon (o'ylab
    // topilmagan matn emas), stories'ni "Ma'lumot beruvchi"/"Atmosferali
    // video" deb aniqroq ko'rsatadi; postlarda bunday qo'shimcha
    // ma'lumot yo'q, shunchaki raqami ko'rsatiladi.
    const kindDetail = row.type === "s" && row.story_kind ? STORY_KIND_LABEL_UZ[row.story_kind] : null;
    return {
      name: row.user_name || "—",
      avatar: initials(row.user_name),
      label: `${kindLabel} #${row.seq_number}`,
      detail: kindDetail,
      projectLabel: row.project_label,
      time: fmtTime(row.done_at),
    };
  });
}

// "Qarsak" bildirishnomasi uchun — `since`dan keyin bajarilgan post/
// stories (checks) va bajarilgan deb belgilangan vazifalarni (tasks,
// status='done') birlashtirib, vaqt bo'yicha tartiblab qaytaradi.
// Devor ekrani buni tez-tez (getWallStats'dan mustaqil, alohida yengil
// so'rov sifatida) so'rab, yangi hodisa chiqsa tabriklov modalini
// ko'rsatadi.
async function getCelebrations(since) {
  const [checksR, tasksR, coinR] = await Promise.all([
    db.query(
      `select c.type, c.seq_number, c.done_at as at, p.label as project_label, u.id as user_id,
              coalesce(nullif(trim(concat(u.first_name, ' ', u.last_name)), ''), u.username) as user_name
       from checks c
       join project_cycles pc on pc.id = c.cycle_id
       join projects p on p.id = pc.project_id
       left join users u on u.id = c.done_by
       where c.done_at is not null and c.done_at > $1
       order by c.done_at asc
       limit 20`,
      [since],
    ),
    db.query(
      `select t.title, t.completed_at as at, u.id as user_id,
              coalesce(nullif(trim(concat(u.first_name, ' ', u.last_name)), ''), u.username) as user_name
       from tasks t
       join users u on u.id = t.assignee_user_id
       where t.status = 'done' and t.completed_at is not null and t.completed_at > $1
       order by t.completed_at asc
       limit 20`,
      [since],
    ),
    // Admin profilidan qo'lda berilgan Ncoin — faqat MUSBAT miqdor
    // (mukofot) tabriklashga loyiq; ayirish (manfiy tuzatish) hech
    // qachon bu ro'yxatga tushmaydi.
    db.query(
      `select t.amount, t.created_at as at, u.id as user_id,
              coalesce(nullif(trim(concat(u.first_name, ' ', u.last_name)), ''), u.username) as user_name
       from ncoin_transactions t
       join users u on u.id = t.user_id
       where t.reason = 'admin_adjustment' and t.amount > 0 and t.created_at > $1
       order by t.created_at asc
       limit 20`,
      [since],
    ),
  ]);

  const checkEvents = checksR.rows
    .filter((row) => row.user_name)
    .map((row) => ({
      name: row.user_name,
      userId: row.user_id,
      kind: row.type === "k" ? "post" : "stories",
      label: `${row.type === "k" ? "Post" : "Stories"} #${row.seq_number}`,
      detail: row.project_label,
      at: row.at,
    }));
  const taskEvents = tasksR.rows
    .filter((row) => row.user_name)
    .map((row) => ({
      name: row.user_name,
      userId: row.user_id,
      kind: "task",
      label: "Vazifa",
      detail: row.title,
      at: row.at,
    }));
  const coinEvents = coinR.rows
    .filter((row) => row.user_name)
    .map((row) => ({
      name: row.user_name,
      userId: row.user_id,
      kind: "coin",
      label: "Ncoin",
      detail: `+${Number(row.amount)} Ncoin`,
      at: row.at,
    }));

  const events = [...checkEvents, ...taskEvents, ...coinEvents].sort(
    (a, b) => new Date(a.at) - new Date(b.at),
  );
  await attachCelebrationSounds(events);
  return events;
}

// Har bir xodimning o'z "tabrik ovozi" (Profil bo'limidan yuklangan
// qisqa audio). Ataylab ALOHIDA va HIMOYALANGAN so'rov: ustun asosiy
// Tracker loyihasidagi 0016 migratsiyasida qo'shiladi, u hali
// qo'llanmagan bo'lsa ham devor ekranidagi tabriklar ishlashda davom
// etishi kerak — o'shanda hamma uchun standart qarsaklar qoladi.
// Ustun topilmasa so'rov VAQTINCHA o'chiriladi, butunlay emas —
// Tracker'da migratsiya qo'llangach devor ekrani o'zi tiklanishi kerak.
const CELEBRATION_SOUND_RETRY_MS = 5 * 60 * 1000;
let celebrationSoundOffUntil = 0;

async function attachCelebrationSounds(events) {
  if (Date.now() < celebrationSoundOffUntil || !events.length) return events;
  const ids = [...new Set(events.map((e) => e.userId).filter(Boolean))];
  if (!ids.length) return events;
  try {
    const r = await db.query(
      `select id, celebration_sound_url from users
       where id = any($1::uuid[]) and celebration_sound_url is not null`,
      [ids],
    );
    const byId = new Map(r.rows.map((row) => [String(row.id), row.celebration_sound_url]));
    events.forEach((e) => {
      e.soundUrl = byId.get(String(e.userId)) || null;
    });
    celebrationSoundOffUntil = 0;
  } catch (e) {
    if (e.code === "42703") {
      celebrationSoundOffUntil = Date.now() + CELEBRATION_SOUND_RETRY_MS;
      console.warn("celebration_sound_url ustuni yo'q — standart qarsaklar ishlatiladi");
    } else {
      console.error("Tabrik ovozlarini o'qishda xatolik:", e.message);
    }
  }
  return events;
}

async function getOnTimePct(rangeStart, rangeEnd) {
  // completed_at — timestamptz (haqiqiy UTC payt), due_date — oddiy
  // `date`. Boshqa joyda ishlatilgan konventsiyaga mos ravishda, "qaysi
  // Toshkent kuni tugatilgan"ni topish uchun +5 soat qo'shib ::date'ga
  // o'tkaziladi (aks holda UTC kun chegarasida 1 kunlik siljish xatosi
  // bo'ladi).
  const r = await db.query(
    `select
       count(*) filter (where (completed_at + interval '5 hours')::date <= due_date) as on_time,
       count(*) as total
     from tasks
     where status = 'done' and completed_at is not null and due_date is not null
       and (completed_at + interval '5 hours')::date >= $1::date
       and (completed_at + interval '5 hours')::date < $2::date`,
    [rangeStart, rangeEnd],
  );
  const { on_time, total } = r.rows[0];
  if (Number(total) === 0) return null;
  return Math.round((Number(on_time) / Number(total)) * 100);
}

async function getOverdueTasks(today) {
  const r = await db.query(
    `select id, project_id from tasks
     where status not in ('review','done','failed','cancelled')
       and due_date is not null and due_date < $1::date`,
    [today],
  );
  return {
    count: r.rows.length,
    projectCount: new Set(r.rows.map((row) => row.project_id).filter(Boolean)).size,
  };
}

// 30 kunlik xom kunlik hisob qaytaradi — frontend 7/14/30 kunlik
// filtr tugmasiga qarab shu massivdan kerakli oxirgi qismini kesib
// oladi (qayta so'rov yubormasdan, chunki eng katta oyna — 30 kun —
// baribir hammasini o'z ichiga oladi).
async function getActivity30d(today) {
  const start = addDays(today, -29);
  const r = await db.query(
    `select day::date as day, count(*)::int as n from (
       select (done_at + interval '5 hours')::date as day from checks where done_at is not null
       union all
       select (created_at + interval '5 hours')::date as day from task_activity
     ) x
     where day between $1::date and $2::date
     group by day`,
    [start, today],
  );
  const byDay = new Map(r.rows.map((row) => [row.day, row.n]));
  const days = [];
  for (let i = 0; i < 30; i++) {
    const d = addDays(start, i);
    days.push({ date: d, count: byDay.get(d) || 0 });
  }
  return { days };
}

async function getWallStats() {
  const today = todayTashkent();
  const monthStart = today.slice(0, 8) + "01";
  const prevMonthEnd = addDays(monthStart, -1);
  const prevMonthStart = prevMonthEnd.slice(0, 8) + "01";

  const projectRows = await getActiveProjectsWithCycles();
  const cycleIds = projectRows.map((row) => row.cycle_id);
  const topContributors = await getTopContributors(cycleIds);

  const projectsById = new Map();
  let soonestDaysLeft = null;
  const projects = projectRows.map((row) => {
    const tempo = classifyProject(row, today);
    const remaining = Math.max(0, row.posts_target + row.stories_target - row.done_k - row.done_s);
    const entry = {
      label: row.label,
      contributor: topContributors.get(row.cycle_id) || null,
      doneCount: row.done_k + row.done_s,
      targetCount: row.posts_target + row.stories_target,
      doneK: row.done_k,
      k: row.posts_target,
      doneS: row.done_s,
      s: row.stories_target,
      remaining,
      ...tempo,
    };
    if (tempo.status !== "debt") {
      const daysLeft = dayDiff(today, row.period_end);
      if (soonestDaysLeft === null || daysLeft < soonestDaysLeft) soonestDaysLeft = daysLeft;
    }
    projectsById.set(row.id, entry);
    return entry;
  });

  // Xodimlar paneli kabi — eng yaxshi natijali loyiha birinchi bo'lib
  // chiqadi (alifbo tartibi o'rniga). Avval holat bo'yicha (Rejada >
  // Ortda > Jiddiy ortda > Qarz), so'ng har bir holat ichida darajasi
  // bo'yicha (rejadan qanchalik oldinda/ortda, Qarz uchun — qancha kam
  // qolgan).
  const STATUS_RANK = { done: 4, onTrack: 3, behind: 2, late: 1, debt: 0 };
  projects.sort((a, b) => {
    const rankDiff = STATUS_RANK[b.status] - STATUS_RANK[a.status];
    if (rankDiff !== 0) return rankDiff;
    // Bajarilganlarda `expectedPct` yo'q (ko'rsatkich chizilmaydi) —
    // ular o'zaro foiz bo'yicha solishtiriladi.
    const scoreOf = (p) =>
      p.status === "debt" ? -p.remaining : p.status === "done" ? p.donePct : p.donePct - p.expectedPct;
    return scoreOf(b) - scoreOf(a);
  });

  const [employees, todayFeed, onTimePct, onTimePctPrevMonth, overdue, activity30d] = await Promise.all([
    getEmployeeLeaderboard(monthStart, today, projectsById),
    getTodayFeed(today),
    getOnTimePct(monthStart, addDays(today, 1)),
    getOnTimePct(prevMonthStart, monthStart),
    getOverdueTasks(today),
    getActivity30d(today),
  ]);

  const teamDoneCount = projectRows.reduce((sum, row) => sum + row.done_k + row.done_s, 0);
  const teamTargetCount = projectRows.reduce((sum, row) => sum + row.posts_target + row.stories_target, 0);

  // Oy nomi/yil ham "bugun" (Tashkent) satridan olinadi — server qaysi
  // UTC vaqtda ishlashidan qat'i nazar bir xil bo'lishi uchun (masalan
  // Toshkentda 00:00-05:00 oralig'ida UTC hali oldingi kunda bo'ladi).
  const [todayY, todayM] = today.split("-").map(Number);
  const monthLabel = MONTHS_UZ[todayM - 1];

  return {
    updatedAt: new Date().toISOString(),
    cycleLabel: `${monthLabel} ${todayY}${soonestDaysLeft != null ? ` · davr yopilishiga ${soonestDaysLeft} kun qoldi` : ""}`,
    projects,
    employees,
    todayFeed,
    summary: {
      teamDoneCount,
      teamTargetCount,
      onTimePct,
      onTimePctPrevMonth,
      todayDoneCount: todayFeed.length,
      todayActiveCount: new Set(todayFeed.map((f) => f.name)).size,
      todayPostCount: todayFeed.filter((f) => f.label.indexOf("Post") === 0).length,
      todayStoriesCount: todayFeed.filter((f) => f.label.indexOf("Stories") === 0).length,
      overdueCount: overdue.count,
      overdueProjectCount: overdue.projectCount,
    },
    activity30d,
  };
}

module.exports = { getWallStats, getCelebrations };
