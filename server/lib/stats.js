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

const TEMPO_MARGIN = 5; // foiz punkti — shundan kam farq "Rejada" hisoblanadi

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

  const daysElapsed = dayDiff(row.period_start, today) + 1;
  const totalDays = dayDiff(row.period_start, row.period_end) + 1;
  const expectedPct = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));
  const expectedItems = Math.round((expectedPct / 100) * (row.posts_target + row.stories_target));
  const actualItems = row.done_k + row.done_s;
  const delta = actualItems - expectedItems;

  let status = "onTrack";
  let statusLabel = "Rejada";
  if (delta >= TEMPO_MARGIN) {
    status = "ahead";
    statusLabel = "Oldinda";
  } else if (delta <= -TEMPO_MARGIN) {
    status = "behind";
    statusLabel = "Ortda";
  }

  const remaining = row.posts_target + row.stories_target - actualItems;
  const deltaText =
    status === "ahead"
      ? `Tempodan ${delta} vazifa oldinda`
      : status === "behind"
        ? `Tempodan ${Math.abs(delta)} vazifa orqada`
        : `Tempoda · ${remaining} vazifa qoldi`;

  return {
    status,
    statusLabel,
    daysLabel: `${dayDiff(today, row.period_end)} kun qoldi`,
    donePct,
    expectedPct: Math.round(expectedPct),
    deltaText,
  };
}

async function getEmployeeLeaderboard(monthStart, today, projectsById) {
  const r = await db.query(
    `with work as (
       select c.done_by as user_id, pc.project_id
       from checks c join project_cycles pc on pc.id = c.cycle_id
       where c.done_by is not null and c.work_date between $1 and $2
     ),
     by_project as (
       select user_id, project_id, count(*) as n
       from work group by user_id, project_id
     ),
     totals as (
       select user_id, sum(n)::int as done_count
       from by_project group by user_id
     ),
     primary_project as (
       select distinct on (user_id) user_id, project_id
       from by_project order by user_id, n desc
     )
     select t.user_id, t.done_count,
            coalesce(nullif(trim(concat(u.first_name, ' ', u.last_name)), ''), u.username) as name,
            pp.project_id as primary_project_id, p.label as primary_project_label
     from totals t
     join users u on u.id = t.user_id and u.is_active
     left join primary_project pp on pp.user_id = t.user_id
     left join projects p on p.id = pp.project_id
     order by t.done_count desc
     limit 10`,
    [monthStart, today],
  );

  return r.rows.map((row, idx) => {
    const primary = row.primary_project_id ? projectsById.get(row.primary_project_id) : null;
    return {
      rank: idx + 1,
      name: row.name,
      avatar: initials(row.name),
      doneCount: row.done_count,
      projectLabel: row.primary_project_label || "—",
      projectStatusLabel: primary ? primary.statusLabel : "—",
      remaining: primary ? primary.remaining : null,
    };
  });
}

async function getTodayFeed(today) {
  const r = await db.query(
    `select c.type, c.seq_number, c.done_at, p.label as project_label,
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
  return r.rows.map((row) => ({
    name: row.user_name || "—",
    avatar: initials(row.user_name),
    label: `${row.type === "k" ? "Post" : "Stories"} #${row.seq_number}`,
    projectLabel: row.project_label,
    time: fmtTime(row.done_at),
  }));
}

// "Qarsak" bildirishnomasi uchun — `since`dan keyin bajarilgan post/
// stories (checks) va bajarilgan deb belgilangan vazifalarni (tasks,
// status='done') birlashtirib, vaqt bo'yicha tartiblab qaytaradi.
// Devor ekrani buni tez-tez (getWallStats'dan mustaqil, alohida yengil
// so'rov sifatida) so'rab, yangi hodisa chiqsa tabriklov modalini
// ko'rsatadi.
async function getCelebrations(since) {
  const [checksR, tasksR] = await Promise.all([
    db.query(
      `select c.type, c.seq_number, c.done_at as at, p.label as project_label,
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
      `select t.title, t.completed_at as at,
              coalesce(nullif(trim(concat(u.first_name, ' ', u.last_name)), ''), u.username) as user_name
       from tasks t
       join users u on u.id = t.assignee_user_id
       where t.status = 'done' and t.completed_at is not null and t.completed_at > $1
       order by t.completed_at asc
       limit 20`,
      [since],
    ),
  ]);

  const checkEvents = checksR.rows
    .filter((row) => row.user_name)
    .map((row) => ({
      name: row.user_name,
      kind: row.type === "k" ? "post" : "stories",
      label: `${row.type === "k" ? "Post" : "Stories"} #${row.seq_number}`,
      detail: row.project_label,
      at: row.at,
    }));
  const taskEvents = tasksR.rows
    .filter((row) => row.user_name)
    .map((row) => ({
      name: row.user_name,
      kind: "task",
      label: "Vazifa",
      detail: row.title,
      at: row.at,
    }));

  return [...checkEvents, ...taskEvents].sort((a, b) => new Date(a.at) - new Date(b.at));
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
  // chiqadi (alifbo tartibi o'rniga). Avval holat bo'yicha (Oldinda >
  // Rejada > Ortda > Qarz), so'ng har bir holat ichida darajasi bo'yicha
  // (tempodan qanchalik oldinda/ortda, Qarz uchun — qancha kam qolgan).
  const STATUS_RANK = { ahead: 3, onTrack: 2, behind: 1, debt: 0 };
  projects.sort((a, b) => {
    const rankDiff = STATUS_RANK[b.status] - STATUS_RANK[a.status];
    if (rankDiff !== 0) return rankDiff;
    const scoreOf = (p) => (p.status === "debt" ? -p.remaining : p.donePct - p.expectedPct);
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
      overdueCount: overdue.count,
      overdueProjectCount: overdue.projectCount,
    },
    activity30d,
  };
}

module.exports = { getWallStats, getCelebrations };
