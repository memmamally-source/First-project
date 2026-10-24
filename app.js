/* Research Project Tracker — plain JS, no build step. Data lives in localStorage. */
(function () {
  'use strict';

  // ---------- Model ----------

  const STAGES = [
    { id: 'idea', label: 'Idea' },
    { id: 'protocol', label: 'Protocol' },
    { id: 'screening', label: 'Screening' },
    { id: 'extraction', label: 'Extraction' },
    { id: 'writing', label: 'Writing' },
    { id: 'submitted', label: 'Submitted' },
  ];
  const STAGE_IDS = STAGES.map((s) => s.id);

  // Reviews synthesise published studies; primary studies collect their own data.
  const STUDY_TYPES = [
    { id: 'meta-analysis', label: 'Meta-analysis', family: 'review' },
    { id: 'systematic-review', label: 'Systematic review', family: 'review' },
    { id: 'scoping-review', label: 'Scoping review', family: 'review' },
    { id: 'umbrella-review', label: 'Umbrella review', family: 'review' },
    { id: 'narrative-review', label: 'Narrative review', family: 'review' },
    { id: 'cross-sectional', label: 'Cross-sectional', family: 'primary' },
    { id: 'cohort', label: 'Cohort', family: 'primary' },
    { id: 'case-control', label: 'Case-control', family: 'primary' },
    { id: 'rct', label: 'Randomised controlled trial', family: 'primary' },
    { id: 'qualitative', label: 'Qualitative', family: 'primary' },
    { id: 'mixed-methods', label: 'Mixed methods', family: 'primary' },
    { id: 'case-report', label: 'Case report / series', family: 'primary' },
    { id: 'other', label: 'Other study type', family: 'primary' },
  ];
  const TYPE_IDS = STUDY_TYPES.map((t) => t.id);

  // Authorship roles. Contributors are thanked in the acknowledgements, not listed as authors.
  const ROLES = [
    { id: 'first', label: 'First author', plural: 'First author' },
    { id: 'coauthor', label: 'Co-author', plural: 'Co-authors' },
    { id: 'contributor', label: 'Contributor', plural: 'Contributors · acknowledged' },
  ];
  const ROLE_IDS = ROLES.map((r) => r.id);
  const roleLabel = (id) => (ROLES.find((r) => r.id === id) || ROLES[1]).label;

  // Older saves stored a free-text role; map it onto the fixed roles and keep any extra detail as a note.
  function roleFrom(raw) {
    const r = str(raw).trim().toLowerCase();
    if (ROLE_IDS.includes(r)) return r;
    if (/lead|first/.test(r)) return 'first';
    if (/contribut|acknowledg/.test(r)) return 'contributor';
    return 'coauthor';
  }
  function roleNote(m) {
    if (str(m.note)) return str(m.note);
    const r = str(m.role).trim();
    return !r || ROLE_IDS.includes(r) || /^(lead author|first author|co-?author|contributor)$/i.test(r) ? '' : r;
  }
  const FAMILY_LABEL = { review: 'Reviews', primary: 'Primary studies' };
  // Primary studies move through the same six steps, named for their own workflow.
  const PRIMARY_STAGE_LABELS = { protocol: 'Protocol & ethics', screening: 'Data collection', extraction: 'Analysis' };
  const STORAGE_KEY = 'research-tracker:v1';
  const WEEK_DAYS = 7;
  const REVISION_WINDOW_DAYS = 14;

  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(iso, n) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  // Rounded so DST shifts (23h/25h days) still count as one day.
  const daysUntil = (iso, today) => Math.round((parseISO(iso) - parseISO(today)) / 86400000);
  const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  const studyType = (id) => STUDY_TYPES.find((t) => t.id === id) || null;
  const familyOf = (typeId) => (studyType(typeId) || {}).family || '';

  function stageLabel(id, typeId) {
    if (familyOf(typeId) === 'primary' && PRIMARY_STAGE_LABELS[id]) return PRIMARY_STAGE_LABELS[id];
    const s = STAGES.find((x) => x.id === id);
    return s ? s.label : id;
  }

  // Column/bar label for a mix of projects: both names when reviews and primary studies are shown together.
  function stageLabelFor(id, projects) {
    const hasPrimary = projects.some((p) => familyOf(p.studyType) === 'primary');
    const hasReview = projects.some((p) => familyOf(p.studyType) !== 'primary');
    const review = stageLabel(id, '');
    const primary = stageLabel(id, 'other');
    if (hasPrimary && !hasReview) return primary;
    if (hasPrimary && review !== primary) return `${review} / ${primary}`;
    return review;
  }

  // The same label split for display: [name, alternate name for primary studies or ''].
  function stageLabelParts(id, projects) {
    const full = stageLabelFor(id, projects);
    const i = full.indexOf(' / ');
    return i < 0 ? [full, ''] : [full.slice(0, i), full.slice(i + 3)];
  }

  function stageNameHTML(id, projects) {
    const [main, alt] = stageLabelParts(id, projects);
    return `<span class="stage-name">${esc(main)}${alt ? `<span class="stage-alt">${esc(alt)}</span>` : ''}</span>`;
  }

  // filter: 'all', a family ('review' | 'primary'), 'none' (type not set), or a study type id.
  function matchesType(p, filter) {
    if (!filter || filter === 'all') return true;
    if (filter === 'none') return !p.studyType;
    if (filter === 'review' || filter === 'primary') return familyOf(p.studyType) === filter;
    return p.studyType === filter;
  }

  function filterByType(state, filter) {
    if (!filter || filter === 'all') return state;
    const projects = state.projects.filter((p) => matchesType(p, filter));
    const ids = new Set(projects.map((p) => p.id));
    return { ...state, projects, tasks: state.tasks.filter((t) => ids.has(t.projectId)) };
  }

  function typeCounts(projects) {
    return STUDY_TYPES.map((t) => ({ ...t, count: projects.filter((p) => p.studyType === t.id).length }))
      .filter((t) => t.count)
      .concat(projects.some((p) => !p.studyType)
        ? [{ id: 'none', label: 'Type not set', family: '', count: projects.filter((p) => !p.studyType).length }]
        : []);
  }

  function newProject(title) {
    const now = new Date().toISOString();
    return {
      id: uid(),
      title: title || 'Untitled project',
      stage: 'idea',
      studyType: '',
      team: [],
      nextAction: '',
      nextActionOwners: [],
      nextActionDue: '',
      journal: { target: '', submittedOn: '', revisionDue: '' },
      notes: '',
      createdAt: now,
      updatedAt: now,
    };
  }

  function newTask(projectId, title, owner, due, start) {
    const t = { id: uid(), projectId, title, owner: owner || '', start: start || '', due: due || '', done: false, doneAt: '' };
    if (t.start && t.due && t.start > t.due) [t.start, t.due] = [t.due, t.start];
    return t;
  }

  const str = (v) => (typeof v === 'string' ? v : '');
  const date = (v) => (isISODate(v) ? v : '');

  // Fills defaults and drops malformed rows, so older saves and imported files are safe to render.
  function normalizeState(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const projects = (Array.isArray(src.projects) ? src.projects : [])
      .filter((p) => p && typeof p === 'object' && p.id)
      .map((p) => {
        const j = p.journal && typeof p.journal === 'object' ? p.journal : {};
        return {
          ...newProject(),
          id: String(p.id),
          title: str(p.title) || 'Untitled project',
          stage: STAGE_IDS.includes(p.stage) ? p.stage : 'idea',
          studyType: TYPE_IDS.includes(p.studyType) ? p.studyType : '',
          team: (Array.isArray(p.team) ? p.team : [])
            .filter((m) => m && str(m.name).trim())
            .map((m) => ({ id: m.id ? String(m.id) : uid(), name: str(m.name).trim(), role: roleFrom(m.role), note: roleNote(m) })),
          nextAction: str(p.nextAction),
          nextActionOwners: ownersFrom(p),
          nextActionDue: date(p.nextActionDue),
          journal: { target: str(j.target), submittedOn: date(j.submittedOn), revisionDue: date(j.revisionDue) },
          notes: str(p.notes),
          ownerId: str(p.ownerId),
          createdAt: str(p.createdAt) || new Date().toISOString(),
          updatedAt: str(p.updatedAt) || new Date().toISOString(),
        };
      });
    const ids = new Set(projects.map((p) => p.id));
    const tasks = (Array.isArray(src.tasks) ? src.tasks : [])
      .filter((t) => t && t.id && ids.has(String(t.projectId)) && str(t.title).trim())
      .map((t) => ({
        id: String(t.id),
        projectId: String(t.projectId),
        title: str(t.title).trim(),
        owner: str(t.owner),
        // A task can run from a start date to its due date; dates entered the wrong way round are swapped.
        start: date(t.start) && date(t.due) && t.start > t.due ? t.due : date(t.start),
        due: date(t.start) && date(t.due) && t.start > t.due ? t.start : date(t.due),
        done: !!t.done,
        doneAt: str(t.doneAt),
      }));
    return { version: 1, me: str(src.me), projects, tasks, meetings: normalizeMeetings(src.meetings) };
  }

  // Everyone who has to do the next action, each ticked off separately.
  // Older saves had one free-text owner ("Ana & Ben"), which is split into people.
  function ownersFrom(p) {
    const list = Array.isArray(p.nextActionOwners) && (p.nextActionOwners.length || !str(p.nextActionOwner))
      ? p.nextActionOwners.map((o) => (typeof o === 'string' ? { name: o } : o || {}))
      : str(p.nextActionOwner).split(/\s*(?:,|&|\/|\band\b)\s*/i).map((name) => ({ name }));
    const seen = new Set();
    return list
      .map((o) => ({ name: str(o.name).trim(), done: !!o.done }))
      .filter((o) => o.name && !seen.has(o.name.toLowerCase()) && seen.add(o.name.toLowerCase()));
  }

  const pendingOwners = (p) => p.nextActionOwners.filter((o) => !o.done).map((o) => o.name);

  function joinNames(names) {
    return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  function waitingText(p) {
    if (!p.nextActionOwners.length) return '';
    const pending = pendingOwners(p);
    return pending.length ? `Waiting for ${joinNames(pending)}` : 'Everyone has finished';
  }

  const sameName = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

  // Every dated, open item across projects: tasks, next actions, and revision deadlines
  // of submitted papers. `days` is relative to today (negative = overdue).
  function deadlines(state, today, opts) {
    const mineOnly = !!(opts && opts.mineOnly && state.me);
    const keep = (owner) => !mineOnly || sameName(owner, state.me);
    const byId = new Map(state.projects.map((p) => [p.id, p]));
    const items = [];

    for (const t of state.tasks) {
      if (t.done || !t.due || !keep(t.owner)) continue;
      const p = byId.get(t.projectId);
      if (!p) continue;
      items.push({ kind: 'task', id: t.id, projectId: p.id, project: p.title, title: t.title, owner: t.owner, start: t.start, due: t.due, days: daysUntil(t.due, today) });
    }
    for (const p of state.projects) {
      const mineWaiting = !mineOnly || pendingOwners(p).some((n) => sameName(n, state.me));
      if (p.nextAction.trim() && p.nextActionDue && mineWaiting) {
        items.push({ kind: 'next', id: p.id, projectId: p.id, project: p.title, title: p.nextAction, owner: waitingText(p), waiting: pendingOwners(p), due: p.nextActionDue, days: daysUntil(p.nextActionDue, today) });
      }
      if (p.stage === 'submitted' && p.journal.revisionDue && !mineOnly) {
        const where = p.journal.target ? ` for ${p.journal.target}` : '';
        items.push({ kind: 'revision', id: p.id, projectId: p.id, project: p.title, title: `Revisions due${where}`, owner: '', due: p.journal.revisionDue, days: daysUntil(p.journal.revisionDue, today) });
      }
    }
    items.sort((x, y) => x.days - y.days || x.project.localeCompare(y.project));
    return items;
  }

  // The home screen: everything due within a week (or overdue), revision deadlines
  // within two weeks, and active projects that have no next action written down.
  function attention(state, today, opts) {
    const mineOnly = !!(opts && opts.mineOnly && state.me);
    const items = deadlines(state, today, opts).filter(
      (i) => i.days <= (i.kind === 'revision' ? REVISION_WINDOW_DAYS : WEEK_DAYS)
    );
    const noNextAction = mineOnly
      ? []
      : state.projects.filter((p) => p.stage !== 'submitted' && !p.nextAction.trim());
    return {
      overdue: items.filter((i) => i.days < 0),
      upcoming: items.filter((i) => i.days >= 0),
      noNextAction,
    };
  }

  // Figures for the dashboard tiles and charts.
  function dashboardStats(state, today, opts) {
    const mineOnly = !!(opts && opts.mineOnly && state.me);
    const att = attention(state, today, opts);
    const active = state.projects.filter((p) => p.stage !== 'submitted');
    const weekAgo = addDays(today, -WEEK_DAYS);
    const doneThisWeek = state.tasks.filter(
      (t) => t.done && t.doneAt && t.doneAt.slice(0, 10) >= weekAgo && (!mineOnly || sameName(t.owner, state.me))
    ).length;

    const byStage = STAGES.map((s) => ({
      ...s,
      label: stageLabelFor(s.id, state.projects),
      projects: state.projects.filter((p) => p.stage === s.id),
    }));

    // Open tasks per person, merging names case-insensitively; unassigned grouped last.
    const people = new Map();
    for (const t of state.tasks) {
      if (t.done || !state.projects.some((p) => p.id === t.projectId)) continue;
      const name = t.owner.trim();
      const key = name ? name.toLowerCase() : '';
      if (!people.has(key)) people.set(key, { name: name || 'Unassigned', open: 0, overdue: 0 });
      const row = people.get(key);
      row.open += 1;
      if (t.due && daysUntil(t.due, today) < 0) row.overdue += 1;
    }
    const workload = [...people.entries()]
      .sort(([ka, a], [kb, b]) => (ka === '') - (kb === '') || b.open - a.open || a.name.localeCompare(b.name))
      .map(([, row]) => row);

    return {
      activeCount: active.length,
      submittedCount: state.projects.length - active.length,
      overdueCount: att.overdue.length,
      dueSoonCount: att.upcoming.filter((i) => i.days <= WEEK_DAYS).length,
      doneThisWeek,
      byStage,
      workload,
      attention: att,
    };
  }

  // ---------- Meetings ----------

  const REPEATS = [
    { id: 'none', label: 'Does not repeat' },
    { id: 'weekdays', label: 'Every weekday (Mon–Fri)' },
    { id: 'weekly', label: 'Every week' },
    { id: 'fortnightly', label: 'Every 2 weeks' },
    { id: 'monthly', label: 'Every month, same date' },
    { id: 'monthly-nth', label: 'Every month, same weekday (e.g. 2nd Tuesday)' },
  ];
  const REPEAT_IDS = REPEATS.map((r) => r.id);
  const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

  function normalizeMeetings(list) {
    return (Array.isArray(list) ? list : [])
      .filter((m) => m && str(m.title).trim() && isISODate(m.date))
      .map((m) => ({
        id: m.id ? String(m.id) : uid(),
        title: str(m.title).trim(),
        date: m.date,
        start: isTime(m.start) ? m.start : '',
        end: isTime(m.end) ? m.end : '',
        repeat: REPEAT_IDS.includes(m.repeat) ? m.repeat : 'none',
        until: isISODate(m.until) && m.until >= m.date ? m.until : '',
        location: str(m.location).trim(),
        projectId: str(m.projectId),
        notes: str(m.notes),
        skip: (Array.isArray(m.skip) ? m.skip : []).filter(isISODate),
      }));
  }

  const nthOfMonth = (d) => Math.ceil(d.getDate() / 7);

  function occursOn(m, iso) {
    if (iso < m.date || (m.until && iso > m.until) || m.skip.includes(iso)) return false;
    const d = parseISO(iso);
    const s = parseISO(m.date);
    const gap = daysUntil(iso, m.date);
    switch (m.repeat) {
      case 'weekdays': return d.getDay() >= 1 && d.getDay() <= 5;
      case 'weekly': return gap % 7 === 0;
      case 'fortnightly': return gap % 14 === 0;
      case 'monthly': return d.getDate() === s.getDate();
      case 'monthly-nth': return d.getDay() === s.getDay() && nthOfMonth(d) === nthOfMonth(s);
      default: return iso === m.date;
    }
  }

  // Every meeting occurrence from..to (inclusive), sorted by date then start time.
  function meetingsBetween(meetings, from, to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      for (const m of meetings) if (occursOn(m, d)) out.push({ meeting: m, date: d });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.meeting.start || '99').localeCompare(b.meeting.start || '99'));
  }

  const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];
  function ordinalDay(n) {
    const v = n % 100;
    return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  // "Every 2 weeks on Tuesday, 09:00–10:00, until 1 Mar 2027"
  function describeMeeting(m) {
    const s = parseISO(m.date);
    const weekday = s.toLocaleDateString('en-GB', { weekday: 'long' });
    const when = {
      none: s.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
      weekdays: 'Every weekday',
      weekly: `Every ${weekday}`,
      fortnightly: `Every 2 weeks on ${weekday}`,
      monthly: `Every month on the ${ordinalDay(s.getDate())}`,
      'monthly-nth': `Every month on the ${ORDINAL[nthOfMonth(s) - 1]} ${weekday}`,
    }[m.repeat];
    const time = m.start ? `, ${m.start}${m.end ? `–${m.end}` : ''}` : '';
    const until = m.repeat !== 'none' && m.until
      ? `, until ${parseISO(m.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
    return when + time + until;
  }

  // Calendar file (iCalendar) so a meeting, repeats included, can be added to a phone or email calendar.
  function meetingICS(m, nowUTC) {
    const icsText = (v) => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const day = (iso) => iso.replace(/-/g, '');
    const at = (iso, hhmm) => `${day(iso)}T${hhmm.replace(':', '')}00`;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Research Project Tracker//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${m.id}@research-project-tracker`, `DTSTAMP:${nowUTC}`];
    if (m.start) {
      lines.push(`DTSTART:${at(m.date, m.start)}`);
      if (m.end && m.end > m.start) lines.push(`DTEND:${at(m.date, m.end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day(m.date)}`, `DTEND;VALUE=DATE:${day(addDays(m.date, 1))}`);
    }
    const s = parseISO(m.date);
    const byday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][s.getDay()];
    const rule = {
      weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      weekly: 'FREQ=WEEKLY',
      fortnightly: 'FREQ=WEEKLY;INTERVAL=2',
      monthly: `FREQ=MONTHLY;BYMONTHDAY=${s.getDate()}`,
      'monthly-nth': `FREQ=MONTHLY;BYDAY=${nthOfMonth(s)}${byday}`,
    }[m.repeat];
    if (rule) lines.push(`RRULE:${rule}${m.until ? `;UNTIL=${day(m.until)}T235959` : ''}`);
    for (const x of m.skip) lines.push(m.start ? `EXDATE:${at(x, m.start)}` : `EXDATE;VALUE=DATE:${day(x)}`);
    lines.push(`SUMMARY:${icsText(m.title)}`);
    if (m.location) lines.push(`LOCATION:${icsText(m.location)}`);
    if (m.notes) lines.push(`DESCRIPTION:${icsText(m.notes)}`);
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  // ---------- Task timelines ----------

  // Open tasks being worked on that day: started on or before it and due after it.
  function tasksInProgress(state, iso) {
    return state.tasks.filter((t) => !t.done && t.start && t.due && t.start <= iso && iso < t.due);
  }

  // Calendar file for a task: an all-day entry from its start date (or due date) to its due date.
  function taskICS(task, projectTitle, nowUTC) {
    const icsText = (v) => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const day = (iso) => iso.replace(/-/g, '');
    const first = task.start || task.due;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Research Project Tracker//EN', 'BEGIN:VEVENT',
      `UID:${task.id}@research-project-tracker`, `DTSTAMP:${nowUTC}`,
      `DTSTART;VALUE=DATE:${day(first)}`, `DTEND;VALUE=DATE:${day(addDays(task.due || first, 1))}`,
      `SUMMARY:${icsText(task.start ? task.title : `Due: ${task.title}`)}`,
      `DESCRIPTION:${icsText([projectTitle, task.owner && `Who: ${task.owner}`].filter(Boolean).join('\n'))}`,
      'END:VEVENT', 'END:VCALENDAR'];
    return lines.join('\r\n') + '\r\n';
  }

  // ---------- Search and people ----------

  function matchesSearch(p, q) {
    q = str(q).trim().toLowerCase();
    if (!q) return true;
    const hay = [p.title, p.journal.target, p.nextAction, (studyType(p.studyType) || {}).label, ...p.team.map((m) => m.name)]
      .join(' ').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  const ROLE_ORDER = ['first', 'coauthor', 'contributor', 'assigned'];

  // Everyone named on a team, a task or a next action, with the papers they're on.
  function peopleIndex(state) {
    const people = new Map();
    const person = (name) => {
      const key = str(name).trim().toLowerCase();
      if (!key) return null;
      if (!people.has(key)) people.set(key, { name: str(name).trim(), papers: new Map(), openTasks: 0, waitingOn: 0 });
      return people.get(key);
    };
    const paper = (who, p, role) => {
      if (!who.papers.has(p.id)) who.papers.set(p.id, { projectId: p.id, title: p.title, stage: p.stage, studyType: p.studyType, role, note: '', openTasks: 0, waiting: false });
      const entry = who.papers.get(p.id);
      if (ROLE_ORDER.indexOf(role) < ROLE_ORDER.indexOf(entry.role)) entry.role = role;
      return entry;
    };
    for (const p of state.projects) {
      for (const m of p.team) paper(person(m.name), p, m.role).note = m.note || '';
      for (const n of pendingOwners(p)) {
        const who = person(n);
        if (!who) continue;
        paper(who, p, 'assigned').waiting = true;
        who.waitingOn += 1;
      }
    }
    for (const t of state.tasks) {
      if (t.done) continue;
      const p = state.projects.find((x) => x.id === t.projectId);
      const who = p && person(t.owner);
      if (!who) continue;
      paper(who, p, 'assigned').openTasks += 1;
      who.openTasks += 1;
    }
    return [...people.values()]
      .map((x) => ({
        ...x,
        papers: [...x.papers.values()].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => b.papers.length - a.papers.length || a.name.localeCompare(b.name));
  }

  // ---------- Server rows (Supabase) ----------
  // A project row stores the project and its tasks together in `data`.
  const LOCAL_ONLY = ['ownerId'];

  function projectBody(state, p) {
    const body = {};
    for (const k of Object.keys(p)) if (!LOCAL_ONLY.includes(k) && k !== 'id') body[k] = p[k];
    body.tasks = state.tasks.filter((t) => t.projectId === p.id).map(({ projectId, ...t }) => t);
    return body;
  }

  function stateFromRows(rows, me) {
    const projects = [];
    const tasks = [];
    for (const row of rows || []) {
      const data = row && row.data && typeof row.data === 'object' ? row.data : {};
      const { tasks: rowTasks, ...rest } = data;
      projects.push({ ...rest, id: row.id, ownerId: row.owner_id });
      for (const t of Array.isArray(rowTasks) ? rowTasks : []) tasks.push({ ...t, projectId: row.id });
    }
    return normalizeState({ me, projects, tasks });
  }

  // Imported files get fresh ids, so they never collide with projects already in the database.
  function remapIds(data) {
    const src = normalizeState(data);
    const map = new Map(src.projects.map((p) => [p.id, uid()]));
    return {
      projects: src.projects.map((p) => ({ ...p, id: map.get(p.id), ownerId: '' })),
      tasks: src.tasks.map((t) => ({ ...t, id: uid(), projectId: map.get(t.projectId) })),
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { tasksInProgress, taskICS, normalizeMeetings, occursOn, meetingsBetween, describeMeeting, meetingICS, matchesSearch, peopleIndex, projectBody, stateFromRows, remapIds, waitingText, STAGES, STUDY_TYPES, ROLES, stageLabel, stageLabelFor, filterByType, typeCounts, attention, deadlines, dashboardStats, normalizeState, addDays, daysUntil, newProject, newTask };
  }
  if (typeof document === 'undefined') return;

  // ---------- Storage ----------

  let state;
  let storageOk = true;
  let editedSinceLoad = false;

  // Capabilities exist only when the page runs inside a claude.ai artifact viewer.
  const hasHost = () => !!(window.claude && typeof window.claude.use === 'function');
  function capability(name) {
    if (!hasHost()) return Promise.resolve(null);
    return Promise.resolve(window.claude.use(name)).catch(() => null);
  }

  // Supabase mode: real accounts on the hosted site, when config.js has the project's URL and key.
  const CONFIG = window.RPT_CONFIG || {};
  const sbConfigured = !!(CONFIG.supabaseUrl && CONFIG.supabaseKey);
  const sb = {
    client: null,
    user: null,
    known: new Set(), // project ids that exist on the server
    synced: {}, // project id -> last body sent or received (JSON)
    settingsSynced: '',
    shares: {}, // project id -> number of people it's shared with (owner's view)
    invites: [], // projects other people have invited me to, waiting for accept/decline
    timer: null,
    saving: false,
    again: false,
    failed: false,
  };
  const isSb = () => !!sb.client;
  const myId = () => (sb.user ? sb.user.id : '');
  const ownsProject = (p) => !isSb() || !p.ownerId || p.ownerId === myId();

  // Account sync inside claude.ai: the whole tracker is one private document per person.
  const cloud = { ref: null, pending: hasHost() && !sbConfigured, timer: null, saving: false, again: false };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return normalizeState(raw ? JSON.parse(raw) : null);
    } catch (e) {
      storageOk = false;
      return normalizeState(null);
    }
  }

  function saveLocal() {
    if (sbConfigured) return; // never leave account data in a shared browser
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
    document.getElementById('storage-warning').hidden = storageOk || !!cloud.ref;
  }

  function save() {
    editedSinceLoad = true;
    if (isSb()) return queueServerSave();
    saveLocal();
    queueCloudSave();
  }

  // ---------- Supabase: load, save, share ----------

  async function loadFromServer() {
    const c = sb.client;
    const [projects, members, invites, settings] = await Promise.all([
      c.from('projects').select('id, owner_id, data'),
      c.from('project_members').select('project_id, user_id'),
      c.from('project_invites').select('project_id, email'),
      c.from('user_settings').select('data').eq('user_id', myId()).maybeSingle(),
    ]);
    const err = projects.error || members.error || invites.error || settings.error;
    if (err) throw err;
    await loadInvites();
    const saved = (settings.data && settings.data.data) || {};
    const meta = sb.user.user_metadata || {};
    state = stateFromRows(projects.data, str(saved.me) || str(meta.full_name));
    state.meetings = normalizeMeetings(saved.meetings);
    sb.known = new Set(state.projects.map((p) => p.id));
    sb.synced = {};
    for (const p of state.projects) sb.synced[p.id] = JSON.stringify(projectBody(state, p));
    sb.settingsSynced = JSON.stringify(settingsBody());
    if (!(await loadShareCounts())) {
      // Older database without my_share_counts(): count rows (may double-count a re-invited person).
      sb.shares = {};
      for (const r of [...(members.data || []), ...(invites.data || [])]) {
        const p = state.projects.find((x) => x.id === r.project_id);
        if (p && ownsProject(p) && r.user_id !== myId()) sb.shares[r.project_id] = (sb.shares[r.project_id] || 0) + 1;
      }
    }
  }

  // "Shared with N": each person counted once, members and pending invites together.
  async function loadShareCounts() {
    try {
      const { data, error } = await sb.client.rpc('my_share_counts', {});
      if (error) return false;
      sb.shares = {};
      for (const r of data || []) sb.shares[r.project_id] = r.people;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Invitations waiting for me. Missing function (database update not run yet) just means none.
  async function loadInvites() {
    try {
      const { data, error } = await sb.client.rpc('my_invites', {});
      sb.invites = error ? [] : data || [];
      sb.inviteError = error ? error.message || 'unknown error' : '';
    } catch (e) {
      sb.invites = [];
      sb.inviteError = (e && e.message) || 'no connection';
    }
    updateInviteBadge();
    return sb.invites;
  }

  function updateInviteBadge() {
    const badge = document.getElementById('invite-badge');
    if (!badge) return;
    badge.textContent = sb.invites.length;
    badge.hidden = !sb.invites.length;
  }

  async function respondInvite(pid, accept) {
    const inv = sb.invites.find((i) => i.project_id === pid);
    const { data, error } = await sb.client.rpc('respond_invite', { pid, accept });
    if (error) return notice("Couldn't answer the invite", error.message || 'Try again in a moment.');
    if (data === 'gone') notice('Invite withdrawn', 'This invite is no longer available. The owner may have cancelled it.');
    if (accept && data === 'accepted') {
      await flushServer();
      await loadFromServer();
      ui.flash = `“${inv ? inv.title : 'The project'}” is now on your dashboard.`;
    } else {
      await loadInvites();
    }
    route();
  }

  // Checks for new invites every minute while the tab is visible.
  function watchInvites() {
    setInterval(async () => {
      if (!isSb() || !sb.user || document.visibilityState !== 'visible') return;
      const before = sb.invites.map((i) => i.project_id).join();
      await loadInvites();
      if (sb.invites.map((i) => i.project_id).join() === before) return;
      const active = document.activeElement;
      const typing = active && app().contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
      if (!typing && !/^#\/project\//.test(location.hash)) route();
    }, 60000);
  }

  function invitesHTML() {
    if (isSb() && sb.inviteError) {
      return `
        <div class="invite-error" role="alert">
          <span>Couldn't check for project invitations (${esc(sb.inviteError)}).</span>
          <button class="btn small" data-action="check-invites">Check again</button>
        </div>`;
    }
    if (!isSb() || !sb.invites.length) return '';
    return `
      <section class="panel invite-panel" aria-label="Invitations">
        <div class="panel-head"><h2>${sb.invites.length === 1 ? "You've been invited to a project" : `You've been invited to ${sb.invites.length} projects`}</h2></div>
        <ul class="invites">${sb.invites.map((i) => `
          <li class="${ui.inviteFocus === i.project_id ? 'is-focus' : ''}">
            <span class="invite-icon" aria-hidden="true">✉</span>
            <div class="item-body">
              <div class="item-title">${esc(i.title)}</div>
              <div class="meta">From ${esc(i.invited_by_name || i.invited_by_email)}${i.invited_by_name ? ` · ${esc(i.invited_by_email)}` : ''}</div>
            </div>
            <div class="invite-actions">
              <button class="btn" data-action="decline-invite" data-pid="${esc(i.project_id)}">Decline</button>
              <button class="btn primary" data-action="accept-invite" data-pid="${esc(i.project_id)}">Accept</button>
            </div>
          </li>`).join('')}
        </ul>
      </section>`;
  }

  function flashHTML() {
    if (!ui.flash) return '';
    const html = `<p class="flash" role="status">${esc(ui.flash)}</p>`;
    ui.flash = '';
    return html;
  }

  // Personal settings saved with the account: your name and your meetings.
  const settingsBody = () => ({ me: state.me, meetings: state.meetings });

  function hasUnsavedChanges() {
    if (sb.timer || sb.saving) return true;
    if (JSON.stringify(settingsBody()) !== sb.settingsSynced) return true;
    return state.projects.some((p) => sb.synced[p.id] !== JSON.stringify(projectBody(state, p)))
      || [...sb.known].some((id) => !state.projects.some((p) => p.id === id));
  }

  function queueServerSave(delay) {
    clearTimeout(sb.timer);
    setSyncStatus('Saving…');
    sb.timer = setTimeout(flushServer, delay == null ? 600 : delay);
  }

  // Sends only what changed since the last save; one save runs at a time.
  async function flushServer() {
    clearTimeout(sb.timer);
    sb.timer = null;
    if (!isSb() || !sb.user) return;
    if (sb.saving) {
      sb.again = true;
      return;
    }
    sb.saving = true;
    const c = sb.client;
    try {
      for (const p of state.projects.slice()) {
        const body = projectBody(state, p);
        const json = JSON.stringify(body);
        if (sb.synced[p.id] === json) continue;
        const res = sb.known.has(p.id)
          ? await c.from('projects').update({ data: body }).eq('id', p.id)
          : await c.from('projects').insert({ id: p.id, data: body });
        if (res.error) throw res.error;
        if (!p.ownerId) p.ownerId = myId();
        sb.known.add(p.id);
        sb.synced[p.id] = json;
      }
      for (const id of [...sb.known]) {
        if (state.projects.some((p) => p.id === id)) continue;
        const res = await c.from('projects').delete().eq('id', id);
        if (res.error) throw res.error;
        sb.known.delete(id);
        delete sb.synced[id];
      }
      const settingsJson = JSON.stringify(settingsBody());
      if (settingsJson !== sb.settingsSynced) {
        const res = await c.from('user_settings').upsert({ user_id: myId(), data: settingsBody() });
        if (res.error) throw res.error;
        sb.settingsSynced = settingsJson;
      }
      sb.failed = false;
      setSyncStatus('All changes saved.');
    } catch (e) {
      sb.failed = true;
      setSyncStatus("Couldn't save. Check your connection; I'll keep trying.");
      setTimeout(() => queueServerSave(0), 8000);
    } finally {
      sb.saving = false;
      if (sb.again) {
        sb.again = false;
        flushServer();
      }
    }
  }

  // Pick up co-authors' edits when you come back to the tab.
  async function refreshFromServer() {
    if (!isSb() || !sb.user || hasUnsavedChanges()) return;
    const active = document.activeElement;
    if (active && app().contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    try {
      await loadFromServer();
      route();
    } catch (e) {
      /* keep what's on screen; the next save or focus tries again */
    }
  }

  async function loadPeople(pid) {
    const list = document.getElementById('people-list');
    if (!list) return;
    const { data, error } = await sb.client.rpc('project_people', { pid });
    if (document.getElementById('people-list') !== list) return; // page changed meanwhile
    list.replaceChildren();
    if (error) {
      list.textContent = "Couldn't load who this is shared with.";
      return;
    }
    const p = findProject(pid);
    const owner = p && ownsProject(p);
    const seen = new Set();
    const people = (data || [])
      .slice()
      .sort((a, b) => ['owner', 'member', 'invited'].indexOf(a.role) - ['owner', 'member', 'invited'].indexOf(b.role))
      .filter((x) => {
        const key = (x.email || x.user_id || '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (owner) sb.shares[pid] = people.filter((x) => x.role !== 'owner').length;
    for (const person of people) {
      const li = document.createElement('li');
      const who = document.createElement('span');
      who.className = 'grow';
      const name = document.createElement('strong');
      name.textContent = person.full_name || person.email;
      who.appendChild(name);
      if (person.full_name) {
        const em = document.createElement('span');
        em.className = 'meta';
        em.textContent = person.email;
        who.appendChild(em);
      }
      const badge = document.createElement('span');
      badge.className = `access-badge access-${person.role}`;
      badge.textContent = { owner: 'Owner', member: 'Can edit', invited: 'Invited · waiting to accept' }[person.role] || person.role;
      li.append(who, badge);
      if (owner && person.role !== 'owner') {
        const x = document.createElement('button');
        x.className = 'icon-btn';
        x.textContent = '×';
        x.title = 'Stop sharing with this person';
        x.setAttribute('aria-label', `Stop sharing with ${person.email}`);
        x.dataset.action = 'unshare';
        x.dataset.user = person.user_id || '';
        x.dataset.email = person.email;
        li.appendChild(x);
      }
      list.appendChild(li);
    }
  }

  async function shareProject(p, email) {
    const msg = document.getElementById('share-msg');
    const show = (text, bad) => {
      if (!msg) return;
      msg.textContent = text;
      msg.className = bad ? 'share-msg is-error' : 'share-msg';
      msg.hidden = false;
    };
    await flushServer(); // the project must exist on the server before it can be shared
    const { data, error } = await sb.client.rpc('share_project', { pid: p.id, invitee: email });
    if (error) return show(error.message || "Couldn't share. Try again.", true);
    if (data === 'self') return show("That's your own email. Enter a co-author's email.", true);
    if (data === 'already') return show(`${email} is already on this project.`, true);
    loadPeople(p.id);
    if (data === 'added') return show(`Shared. ${email} can now see and edit this project from their dashboard.`);
    show(data === 'reinvited' ? `You'd already invited ${email}. Sending it again…` : `Sending the invite to ${email}…`);
    const emailed = await emailInvite(p, email);
    showInviteResult(p, email, emailed);
  }

  const inviteLink = (p) => `${location.origin}${location.pathname}?invite=${encodeURIComponent(p.id)}`;

  // Emails a sign-in link that lands on the invitation. Uses a separate client so the
  // sender's own session is never touched. Returns true when Supabase accepted the email.
  async function emailInvite(p, email) {
    try {
      const mailer = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit', storageKey: 'rpt-invite-mailer' },
      });
      const meta = sb.user.user_metadata || {};
      const { error } = await mailer.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: inviteLink(p),
          data: { invited_to: p.title, invited_by: meta.full_name || sb.user.email },
        },
      });
      return !error;
    } catch (e) {
      return false;
    }
  }

  function inviteMessage(p, email) {
    const meta = sb.user.user_metadata || {};
    const from = meta.full_name || sb.user.email;
    const subject = `Invitation: ${p.title}`;
    const body = `Hi,\n\n${from} has invited you to collaborate on "${p.title}" in Research Project Tracker.\n\n`
      + `Open this link to accept or decline:\n${inviteLink(p)}\n\n`
      + `If you don't have an account yet, create one with this email address (${email}) and the invitation will be waiting for you.`;
    return { subject, body };
  }

  // Shows what happened plus ways to send the invite yourself (in case the email doesn't arrive).
  function showInviteResult(p, email, emailed) {
    const msg = document.getElementById('share-msg');
    if (!msg) return;
    const { subject, body } = inviteMessage(p, email);
    const q = (v) => encodeURIComponent(v);
    msg.replaceChildren();
    msg.className = emailed ? 'share-msg' : 'share-msg is-warn';
    msg.hidden = false;
    const text = document.createElement('p');
    text.textContent = emailed
      ? `Invite emailed to ${email}. It's waiting on their dashboard too (one invite per person, however often you send it). Not arrived? Send it from your own email:`
      : `Invite created, but the automatic email couldn't be sent. Send it from your own email so ${email} gets it:`;
    const row = document.createElement('div');
    row.className = 'share-actions';
    const gmail = document.createElement('a');
    gmail.className = 'btn small';
    gmail.target = '_blank';
    gmail.rel = 'noopener';
    gmail.href = `https://mail.google.com/mail/?view=cm&fs=1&to=${q(email)}&su=${q(subject)}&body=${q(body)}`;
    gmail.textContent = 'Send from Gmail';
    const mail = document.createElement('a');
    mail.className = 'btn small';
    mail.href = `mailto:${email}?subject=${q(subject)}&body=${q(body)}`;
    mail.textContent = 'Open email app';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn small';
    copy.textContent = 'Copy invite link';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(inviteLink(p));
        copy.textContent = 'Link copied';
      } catch (e) {
        window.prompt('Copy this link', inviteLink(p));
      }
    });
    row.append(gmail, mail, copy);
    msg.append(text, row);
  }

  async function unshare(p, userId, email) {
    const c = sb.client;
    const res = userId
      ? await c.from('project_members').delete().eq('project_id', p.id).eq('user_id', userId)
      : await c.from('project_invites').delete().eq('project_id', p.id).eq('email', email);
    if (res.error) return notice("Couldn't stop sharing", res.error.message || 'Try again in a moment.');
    loadPeople(p.id);
  }

  async function leaveProject(p) {
    const res = await sb.client.from('project_members').delete().eq('project_id', p.id).eq('user_id', myId());
    if (res.error) return notice("Couldn't leave the project", res.error.message || 'Try again in a moment.');
    state.projects = state.projects.filter((x) => x.id !== p.id);
    state.tasks = state.tasks.filter((t) => t.projectId !== p.id);
    sb.known.delete(p.id);
    delete sb.synced[p.id];
    location.hash = '#/projects';
    route();
  }

  // ---------- Supabase: sign-in screen ----------

  const authEl = () => document.getElementById('auth');
  const shellEl = () => document.querySelector('.shell');

  const AUTH_MODES = {
    loading: { title: 'Opening your tracker…', fields: [], submit: '' },
    signin: { title: 'Sign in', help: 'Welcome back. Sign in to see your projects and the ones shared with you.', fields: ['email', 'password'], submit: 'Sign in', links: ['signup', 'forgot'] },
    signup: { title: 'Create your account', help: 'Your own dashboard, plus any projects co-authors share with this email.', fields: ['name', 'email', 'new-password', 'confirm'], submit: 'Create account', links: ['signin'] },
    forgot: { title: 'Reset your password', help: "Enter your email and we'll send you a link to choose a new password.", fields: ['email'], submit: 'Send reset link', links: ['signin'] },
    reset: { title: 'Choose a new password', help: 'Enter a new password for your account.', fields: ['new-password', 'confirm'], submit: 'Save password', links: [] },
    sent: { title: 'Check your email', help: '', fields: [], submit: '', links: ['signin'] },
    offline: { title: "Can't reach the sign-in service", help: 'Check your internet connection, then reload this page.', fields: [], submit: '', links: [] },
  };
  const AUTH_LINKS = { signin: 'I already have an account', signup: 'Create an account', forgot: 'Forgot password?' };

  function showAuth(mode, message) {
    const m = AUTH_MODES[mode];
    const root = authEl();
    shellEl().hidden = true;
    shellEl().classList.remove('ready');
    root.hidden = false;
    root.dataset.mode = mode;
    document.getElementById('auth-title').textContent = m.title;
    const help = document.getElementById('auth-help');
    help.textContent = message || m.help || '';
    help.hidden = !help.textContent;
    for (const f of ['name', 'email', 'password', 'new-password', 'confirm']) {
      const wrap = document.getElementById(`auth-${f}-field`);
      wrap.hidden = !m.fields.includes(f);
      wrap.querySelector('input').required = m.fields.includes(f);
    }
    const submit = document.getElementById('auth-submit');
    submit.hidden = !m.submit;
    submit.textContent = m.submit;
    submit.disabled = false;
    document.getElementById('auth-links').innerHTML = (m.links || [])
      .map((l) => `<button type="button" class="link-btn" data-auth="${l}">${esc(AUTH_LINKS[l])}</button>`).join('');
    authError('');
    const first = root.querySelector('.auth-field:not([hidden]) input');
    if (first) first.focus();
  }

  function authError(text) {
    const el = document.getElementById('auth-error');
    el.textContent = text;
    el.hidden = !text;
  }

  function friendlyAuthError(e) {
    const msg = (e && e.message) || '';
    if (/invalid login/i.test(msg)) return "That email and password don't match. Try again, or reset your password.";
    if (/not confirmed/i.test(msg)) return 'Confirm your email first. Open the link we sent you, then sign in.';
    if (/already registered|already exists/i.test(msg)) return 'There is already an account with this email. Sign in instead.';
    if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a minute, then try again.';
    if (/password/i.test(msg)) return msg;
    return msg || 'Something went wrong. Check your connection and try again.';
  }

  async function onAuthSubmit(e) {
    e.preventDefault();
    const mode = authEl().dataset.mode;
    const val = (id) => document.getElementById(`auth-${id}`).value;
    const email = val('email').trim();
    const submit = document.getElementById('auth-submit');
    const redirectTo = location.origin + location.pathname;
    if ((mode === 'signup' || mode === 'reset') && val('new-password').length < 8) return authError('Use at least 8 characters for your password.');
    if ((mode === 'signup' || mode === 'reset') && val('new-password') !== val('confirm')) return authError("The two passwords don't match.");
    submit.disabled = true;
    authError('');
    try {
      const a = sb.client.auth;
      if (mode === 'signin') {
        const { data, error } = await a.signInWithPassword({ email, password: val('password') });
        if (error) throw error;
        await startSession(data.session);
      } else if (mode === 'signup') {
        const { data, error } = await a.signUp({
          email,
          password: val('new-password'),
          options: { data: { full_name: val('name').trim() }, emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        if (data.session) await startSession(data.session);
        else showAuth('sent', `We've sent a confirmation link to ${email}. Open it to finish creating your account. It brings you back here, signed in.`);
      } else if (mode === 'forgot') {
        const { error } = await a.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        showAuth('sent', `If there's an account for ${email}, a link to reset the password is on its way.`);
      } else if (mode === 'reset') {
        const { data, error } = await a.updateUser({ password: val('new-password') });
        if (error) throw error;
        const { data: s } = await a.getSession();
        await startSession(s.session || (data && data.session));
      }
    } catch (err) {
      authError(friendlyAuthError(err));
      submit.disabled = false;
    }
  }

  async function startSession(session) {
    if (!session) return showAuth('signin');
    sb.user = session.user;
    authEl().hidden = true;
    shellEl().hidden = false;
    shellEl().classList.add('ready');
    const who = document.getElementById('account-name');
    if (who) who.textContent = (sb.user.user_metadata && sb.user.user_metadata.full_name) || sb.user.email;
    document.getElementById('account').hidden = false;
    state = normalizeState(null);
    cloud.pending = true; // shows "Loading your projects…"
    route();
    try {
      await loadFromServer();
      setSyncStatus('All changes saved.');
    } catch (e) {
      setSyncStatus("Couldn't load your projects. Reload the page to try again.");
    }
    cloud.pending = false;
    focusInviteFromLink();
    route();
  }

  // Arrived via an invite link (?invite=<project id>): point at that invite, then tidy the address.
  function focusInviteFromLink() {
    const params = new URLSearchParams(location.search);
    const pid = params.get('invite');
    if (!pid) return;
    params.delete('invite');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    if (sb.invites.some((i) => i.project_id === pid)) {
      ui.inviteFocus = pid;
      location.hash = '#/';
    } else if (state.projects.some((x) => x.id === pid)) {
      ui.flash = "You've already joined this project. Here it is.";
      location.hash = `#/project/${pid}`;
    } else {
      ui.flash = 'That invitation is no longer waiting. It may have been withdrawn, or accepted from another account.';
    }
  }

  async function signOut() {
    sb.invites = [];
    updateInviteBadge();
    if (hasUnsavedChanges()) await flushServer();
    await sb.client.auth.signOut();
    sb.user = null;
    sb.known = new Set();
    sb.synced = {};
    state = normalizeState(null);
    location.hash = '#/';
    showAuth('signin');
  }

  async function startSupabase() {
    document.getElementById('auth-form').addEventListener('submit', onAuthSubmit);
    authEl().addEventListener('click', (e) => {
      const b = e.target.closest('[data-auth]');
      if (b) showAuth(b.dataset.auth);
    });
    if (!window.supabase || !window.supabase.createClient) return showAuth('offline');
    sb.client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });
    let recovering = /type=recovery/.test(location.hash + location.search);
    sb.client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        recovering = true;
        showAuth('reset');
      }
    });
    showAuth('loading');
    watchInvites();
    const { data } = await sb.client.auth.getSession();
    if (recovering) return showAuth('reset');
    if (data && data.session) startSession(data.session);
    else showAuth('signin');
  }

  function setSyncStatus(text) {
    const el = document.getElementById('sync-status');
    if (el) el.textContent = text;
  }

  async function connectCloud() {
    try {
      const [db, user] = await Promise.all([capability('db'), capability('user')]);
      const id = db && user ? await user.id() : null;
      if (!id) return;
      const ref = db.doc(`data/users/${id}/tracker`);
      const snap = await ref.get();
      cloud.ref = ref;
      if (snap.exists && !editedSinceLoad) {
        state = normalizeState(snap.data());
        saveLocal();
      } else if (state.projects.length) {
        queueCloudSave(0);
      }
      setSyncStatus('Saved to your Claude account.');
    } catch (e) {
      cloud.ref = null;
    } finally {
      cloud.pending = false;
      document.getElementById('storage-warning').hidden = storageOk || !!cloud.ref;
      route();
    }
  }

  function queueCloudSave(delay) {
    if (!cloud.ref) return;
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(flushCloud, delay == null ? 700 : delay);
  }

  // One write at a time; edits made during a write are sent right after it.
  async function flushCloud() {
    clearTimeout(cloud.timer);
    cloud.timer = null;
    if (!cloud.ref) return;
    if (cloud.saving) {
      cloud.again = true;
      return;
    }
    cloud.saving = true;
    setSyncStatus('Saving…');
    try {
      await cloud.ref.set(JSON.parse(JSON.stringify(state)));
      setSyncStatus('Saved to your Claude account.');
    } catch (e) {
      const code = e && e.code;
      if (code === 'unavailable' || code === 'resource_exhausted') {
        cloud.again = true;
        setSyncStatus('Saving…');
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
      } else {
        setSyncStatus("Couldn't save to your account. Use Export backup to keep a copy.");
      }
    } finally {
      cloud.saving = false;
      if (cloud.again) {
        cloud.again = false;
        flushCloud();
      }
    }
  }

  // ---------- Rendering helpers ----------

  const app = () => document.getElementById('app');
  const today = () => toISO(new Date());
  const ui = { mineOnly: false, showDone: {}, typeFilter: 'all', calMonth: '', calDay: '', search: '', peopleView: 'person', projView: readPref('rpt-view', 'list') };

  // Small per-browser preferences (which view you like); safe if storage is blocked.
  function readPref(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writePref(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* preference just won't be remembered */
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return parseISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const fmtShort = (iso) => (iso ? parseISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

  function relDays(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    return days < 0 ? `${-days} days overdue` : `in ${days} days`;
  }

  function dueBadge(iso) {
    if (!iso) return '';
    const d = daysUntil(iso, today());
    const cls = d < 0 ? 'due-overdue' : d <= WEEK_DAYS ? 'due-soon' : 'due-later';
    return `<span class="due ${cls}" title="See everything due ${esc(fmtDate(iso))}" role="button" tabindex="0" data-action="show-day" data-date="${esc(iso)}">${esc(d <= REVISION_WINDOW_DAYS ? relDays(d) : fmtDate(iso))}</span>`;
  }

  const stagePill = (id, typeId) => `<span class="pill">${esc(stageLabel(id, typeId))}</span>`;

  const firstAuthors = (p) => p.team.filter((m) => m.role === 'first').map((m) => m.name).join(', ');

  function typeBadge(typeId) {
    const t = studyType(typeId);
    return t
      ? `<span class="type-badge type-${t.family}" title="${esc(FAMILY_LABEL[t.family])}">${esc(t.label)}</span>`
      : '<span class="type-badge type-none">Type not set</span>';
  }

  function typeOptions(selected, withFilters) {
    const opt = (v, label) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(label)}</option>`;
    const group = (family) => `
      <optgroup label="${esc(FAMILY_LABEL[family])}">
        ${withFilters ? opt(family, `All ${FAMILY_LABEL[family].toLowerCase()}`) : ''}
        ${STUDY_TYPES.filter((t) => t.family === family).map((t) => opt(t.id, t.label)).join('')}
      </optgroup>`;
    return (withFilters ? opt('all', 'All study types') : opt('', 'Choose a study type…'))
      + group('review') + group('primary')
      + (withFilters ? opt('none', 'Type not set') : '');
  }

  function typeFilterControl() {
    return `
      <label class="field-inline">Study type
        <select data-setting="type-filter" id="type-filter">${typeOptions(ui.typeFilter, true)}</select>
      </label>`;
  }
  function stageMeter(id, typeId) {
    const idx = STAGE_IDS.indexOf(id);
    return `
      <div class="meter" role="img" aria-label="${esc(`Stage ${idx + 1} of ${STAGES.length}: ${stageLabel(id, typeId)}`)}">
        <span class="meter-label">${esc(stageLabel(id, typeId))}</span>
        <span class="meter-steps">${STAGES.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</span>
      </div>`;
  }
  const findProject = (id) => state.projects.find((p) => p.id === id);
  const openTasks = (pid) => state.tasks.filter((t) => t.projectId === pid && !t.done);

  function allNames() {
    const names = new Set();
    if (state.me) names.add(state.me);
    for (const p of state.projects) for (const m of p.team) names.add(m.name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  function namesDatalist(id, project) {
    const names = project ? project.team.map((m) => m.name) : allNames();
    return `<datalist id="${id}">${names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;
  }

  function setNav(route) {
    document.querySelectorAll('[data-nav]').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === route);
    });
  }

  // ---------- Views ----------

  // ---------- Dashboard ----------

  const TIMELINE_DAYS = 30;
  const KIND_LABEL = { task: 'Task', next: 'Next action', revision: 'Revision deadline' };
  const ICON = {
    alert: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3.5M8 11.6v.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m5 8.2 2 2 4-4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // Tooltip content is kept out of the DOM and written with textContent (titles are user data).
  let tips = new Map();
  function tipAttr(title, rows) {
    const id = 'tip' + tips.size;
    tips.set(id, { title, rows });
    return `data-tip="${id}"`;
  }

  function showTip(el) {
    const tip = tips.get(el.dataset.tip);
    const box = document.getElementById('tooltip');
    if (!tip || !box) return;
    box.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tip-title';
    head.textContent = tip.title;
    box.appendChild(head);
    for (const r of tip.rows) {
      const row = document.createElement('div');
      row.className = 'tip-row';
      if (r.kind) {
        const key = document.createElement('span');
        key.className = `key key-${r.kind}`;
        row.appendChild(key);
      }
      const val = document.createElement('strong');
      val.textContent = r.value;
      row.appendChild(val);
      if (r.label) {
        const lab = document.createElement('span');
        lab.className = 'tip-label';
        lab.textContent = r.label;
        row.appendChild(lab);
      }
      box.appendChild(row);
    }
    box.hidden = false;
    const rect = el.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = rect.top - h - 8;
    if (top < 8) top = rect.bottom + 8;
    box.style.left = `${left + window.scrollX}px`;
    box.style.top = `${top + window.scrollY}px`;
  }

  function hideTip() {
    const box = document.getElementById('tooltip');
    if (box) box.hidden = true;
  }

  function tile(label, value, sub, mod, icon, dueKind) {
    const tag = dueKind ? 'button' : 'div';
    return `
      <${tag} class="tile ${mod || ''}${dueKind ? ' tile-btn' : ''}" ${dueKind ? `data-action="show-due" data-kind="${dueKind}" aria-label="${esc(`${label}: ${value}. Show the list`)}"` : ''}>
        <div class="tile-label">${icon ? ICON[icon] : ''}${esc(label)}</div>
        <div class="tile-value">${esc(value)}</div>
        <div class="tile-sub">${sub}</div>
      </${tag}>`;
  }

  // One lane per project; overdue items collapse into a band left of "today".
  function timelineHTML(items, t) {
    const inRange = items.filter((i) => i.days <= TIMELINE_DAYS);
    if (!inRange.length) return `<p class="muted">No deadlines in the next ${TIMELINE_DAYS} days.</p>`;
    const OVERDUE_W = 9; // % of the track reserved for the overdue band
    const x = (days) => (days < 0 ? OVERDUE_W / 2 : OVERDUE_W + 2 + (days / TIMELINE_DAYS) * (98 - OVERDUE_W - 2));

    const lanes = new Map();
    for (const i of inRange) {
      if (!lanes.has(i.projectId)) lanes.set(i.projectId, { project: i.project, id: i.projectId, groups: new Map(), items: [] });
      lanes.get(i.projectId).items.push(i);
      const key = i.days < 0 ? 'overdue' : String(i.days);
      const g = lanes.get(i.projectId).groups;
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(i);
    }

    const ticks = [0, 7, 14, 21, 28].map((d) => `
      <span class="tick${d === 0 ? ' tick-today' : ''}" style="left:${x(d)}%">${d === 0 ? 'Today' : esc(parseISO(addDays(t, d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</span>`).join('');

    const rows = [...lanes.values()].map((lane) => {
      const dots = [...lane.groups.entries()].map(([key, list]) => {
        const first = list[0];
        const when = key === 'overdue' ? 'Overdue' : `${fmtDate(first.due)} · ${relDays(first.days)}`;
        const tip = tipAttr(when, list.map((i) => ({
          kind: i.kind,
          value: i.title,
          label: [KIND_LABEL[i.kind], i.owner, key === 'overdue' ? relDays(i.days) : ''].filter(Boolean).join(' · '),
        })));
        const label = `${lane.project}: ${list.map((i) => i.title).join('; ')}, ${when}`;
        return `<button class="dot dot-${first.kind}${key === 'overdue' ? ' is-overdue' : ''}" style="left:${x(first.days)}%" ${tip} aria-label="${esc(label)}">${list.length > 1 ? `<span class="dot-count">${list.length}</span>` : ''}</button>`;
      }).join('');
      const bars = lane.items
        .filter((i) => i.kind === 'task' && i.start && i.days >= 0 && daysUntil(i.start, t) < i.days)
        .map((i) => {
          const from = x(Math.max(0, daysUntil(i.start, t)));
          return `<span class="tl-bar" style="left:${from}%;width:${Math.max(0.5, x(i.days) - from)}%" title="${esc(`${i.title}: ${fmtShort(i.start)} → ${fmtShort(i.due)}`)}"></span>`;
        }).join('');
      return `
        <div class="lane">
          <a class="lane-label" href="#/project/${esc(lane.id)}" title="${esc(lane.project)}">${esc(lane.project)}</a>
          <div class="lane-track">${bars}${dots}</div>
        </div>`;
    }).join('');

    return `
      <div class="legend" aria-hidden="true">
        <span><i class="key key-task"></i>Task</span>
        <span><i class="key key-span"></i>Task timeline (start → due)</span>
        <span><i class="key key-next"></i>Next action</span>
        <span><i class="key key-revision"></i>Revision deadline</span>
        <span><i class="key key-band"></i>Overdue</span>
      </div>
      <div class="timeline" style="--od:${OVERDUE_W}%;--today:${x(0)}%">
        <div class="lane lane-axis">
          <span class="lane-label"></span>
          <div class="lane-track">
            ${ticks}
          </div>
        </div>
        ${rows}
      </div>`;
  }

  function pipelineHTML(byStage, projectsInView) {
    const max = Math.max(1, ...byStage.map((s) => s.projects.length));
    return `<div class="bars">${byStage.map((s, i) => {
      const n = s.projects.length;
      const tip = tipAttr(`${s.label} · ${n} project${n === 1 ? '' : 's'}`, s.projects.map((p) => ({ value: p.title })));
      return `
        <div class="bar-row">
          <span class="bar-label" title="${esc(s.label)}"><span class="step-no">${i + 1}</span>${stageNameHTML(s.id, projectsInView)}</span>
          <button class="bar-track" ${tip} aria-label="${esc(`${s.label}: ${n}`)}">
            ${n ? `<span class="bar" style="width:${(n / max) * 100}%"></span>` : ''}
            <span class="bar-value">${n}</span>
          </button>
        </div>`;
    }).join('')}</div>`;
  }

  // Grouped by family so reviews and primary studies read as separate blocks.
  function typesHTML(projects) {
    const rows = typeCounts(projects);
    if (!rows.length) return '<p class="muted">No projects.</p>';
    const max = Math.max(1, ...rows.map((r) => r.count));
    const groups = [['review', FAMILY_LABEL.review], ['primary', FAMILY_LABEL.primary], ['', '']];
    return groups.map(([family, heading]) => {
      const list = rows.filter((r) => r.family === family);
      if (!list.length) return '';
      const total = list.reduce((n, r) => n + r.count, 0);
      return `
        ${heading ? `<button class="type-group" data-action="set-type" data-type="${family}">${esc(heading)} <span class="count">${total}</span></button>` : ''}
        <div class="bars">${list.map((r) => {
          const names = projects.filter((p) => (r.id === 'none' ? !p.studyType : p.studyType === r.id)).map((p) => ({ value: p.title }));
          const tip = tipAttr(`${r.label} · ${r.count}`, names);
          return `
            <div class="bar-row">
              <span class="bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
              <button class="bar-track is-link" data-action="set-type" data-type="${esc(r.id)}" ${tip} aria-label="${esc(`${r.label}: ${r.count}. Show only these`)}">
                <span class="bar" style="width:${(r.count / max) * 100}%"></span>
                <span class="bar-value">${r.count}</span>
              </button>
            </div>`;
        }).join('')}</div>`;
    }).join('');
  }

  // Month calendar (weeks start on Monday). Dots mark deadlines; selecting a day lists them.
  function calendarHTML(items, t) {
    const month = ui.calMonth || t.slice(0, 7);
    const selected = ui.calDay || t;
    const first = parseISO(`${month}-01`);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
    const start = addDays(`${month}-01`, -offset);
    const meetingDates = new Map();
    for (const x of meetingsBetween(state.meetings, start, addDays(start, cells - 1))) {
      meetingDates.set(x.date, (meetingDates.get(x.date) || 0) + 1);
    }
    const byDate = new Map();
    for (const i of items) {
      if (!byDate.has(i.due)) byDate.set(i.due, []);
      byDate.get(i.due).push(i);
    }
    // Days a task is being worked on (start → due) get a bar along the bottom of the cell.
    const spans = new Map();
    const lastCell = addDays(start, cells - 1);
    for (const i of items) {
      if (i.kind !== 'task' || !i.start) continue;
      for (let d = i.start < start ? start : i.start; d <= i.due && d <= lastCell; d = addDays(d, 1)) {
        spans.set(d, (spans.get(d) || 0) + 1);
      }
    }
    const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const weekdays = [...Array(7)].map((_, k) => parseISO(addDays('2024-01-01', k)).toLocaleDateString(undefined, { weekday: 'narrow' }));

    const dayCells = [...Array(cells)].map((_, k) => {
      const d = addDays(start, k);
      const list = byDate.get(d) || [];
      const cls = [
        'cal-day',
        d.slice(0, 7) !== month ? 'is-other' : '',
        d === t ? 'is-today' : '',
        d === selected ? 'is-selected' : '',
        list.some((i) => i.days < 0) ? 'has-overdue' : '',
      ].filter(Boolean).join(' ');
      const kinds = [...new Set(list.map((i) => i.kind))];
      const meets = meetingDates.get(d) || 0;
      const busy = spans.get(d) || 0;
      const prevBusy = spans.get(addDays(d, -1)) && d !== start && parseISO(d).getDay() !== 1;
      const nextBusy = spans.get(addDays(d, 1)) && parseISO(d).getDay() !== 0;
      const label = `${parseISO(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${list.length ? `, ${list.length} due` : ''}${busy ? `, ${busy} task${busy === 1 ? '' : 's'} in progress` : ''}${meets ? `, ${meets} meeting${meets === 1 ? '' : 's'}` : ''}`;
      return `
        <button class="${cls}" data-action="cal-day" data-date="${d}" aria-label="${esc(label)}" aria-pressed="${d === selected}">
          <span class="cal-num">${Number(d.slice(8))}</span>
          <span class="cal-dots">${kinds.slice(0, 3).map((k) => `<i class="key key-${k}"></i>`).join('')}${meets ? '<i class="key key-meeting"></i>' : ''}</span>
          ${busy ? `<span class="cal-span${prevBusy ? ' joins-left' : ''}${nextBusy ? ' joins-right' : ''}" aria-hidden="true"></span>` : ''}
        </button>`;
    }).join('');

    const dayItems = byDate.get(selected) || [];
    const dayMeets = meetingsBetween(state.meetings, selected, selected);
    const dayTitle = selected === t ? 'Today' : parseISO(selected).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    return `
      <div class="cal-head">
        <button class="icon-btn cal-nav" data-action="cal-prev" aria-label="Previous month">‹</button>
        <span class="cal-title">${esc(title)}</span>
        <button class="icon-btn cal-nav" data-action="cal-next" aria-label="Next month">›</button>
        ${month !== t.slice(0, 7) || selected !== t ? '<button class="link-btn cal-today" data-action="cal-today">Today</button>' : ''}
      </div>
      <div class="cal-grid" role="group" aria-label="${esc(title)}">
        ${weekdays.map((w) => `<span class="cal-wd" aria-hidden="true">${esc(w)}</span>`).join('')}
        ${dayCells}
      </div>
      <div class="legend cal-legend" aria-hidden="true">
        <span><i class="key key-task"></i>Task</span>
        <span><i class="key key-next"></i>Next action</span>
        <span><i class="key key-revision"></i>Revision</span>
        <span><i class="key key-meeting"></i>Meeting</span>
        <span><i class="key key-span"></i>Task in progress</span>
        <span><i class="key key-ring"></i>Overdue</span>
      </div>
      <div class="cal-list">
        <h3 class="subhead">${esc(dayTitle)}</h3>
        ${dayItems.length ? `<ul class="items">${dayItems.map((i) => `
          <li class="item ${i.days < 0 ? 'is-overdue' : ''}">
            <span class="kind-key"><i class="key key-${i.kind}"></i></span>
            <div class="item-body">
              <div class="item-title">${esc(i.title)}</div>
              <div class="meta"><span>${esc(KIND_LABEL[i.kind])}</span><span>·</span><a href="#/project/${esc(i.projectId)}">${esc(i.project)}</a>${i.owner ? `<span>· ${esc(i.owner)}</span>` : ''}</div>
            </div>
          </li>`).join('')}</ul>` : ''}
        ${dayMeets.length ? `<ul class="items">${dayMeets.map((x) => meetingRow(x.meeting, x.date)).join('')}</ul>` : ''}
        ${!dayItems.length && !dayMeets.length ? '<p class="muted small">Nothing due and no meetings.</p>' : ''}
      </div>`;
  }

  // ---------- Meetings: form, list, calendar file ----------

  const REPEAT_ICON = '<span class="repeat-icon" title="Repeats" aria-label="Repeats">↻</span>';

  function meetingTime(m) {
    return m.start ? `${m.start}${m.end ? `–${m.end}` : ''}` : 'All day';
  }

  function locationHTML(loc) {
    if (!loc) return '';
    return /^https?:\/\//i.test(loc)
      ? `<a href="${esc(loc)}" target="_blank" rel="noopener" class="join-link">Join</a>`
      : `<span>· ${esc(loc)}</span>`;
  }

  function dayLabel(iso) {
    const n = daysUntil(iso, today());
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    return parseISO(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function meetingForm(existing, presetDate) {
    const m = existing || { title: '', date: presetDate || today(), start: '', end: '', repeat: 'none', until: '', location: '', projectId: '', notes: '', skip: [] };
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.id = 'meeting-dialog';
    wrap.innerHTML = `
      <form class="modal meeting-form" role="dialog" aria-modal="true" aria-labelledby="meeting-title-h" novalidate>
        <h2 id="meeting-title-h">${existing ? 'Edit meeting' : 'New meeting'}</h2>
        <label class="field">Title
          <input id="mt-title" required placeholder="e.g. Weekly lab meeting" value="${esc(m.title)}">
        </label>
        <div class="row">
          <label class="field grow">Date<input id="mt-date" type="date" required value="${esc(m.date)}"></label>
          <label class="field">Start<input id="mt-start" type="time" value="${esc(m.start)}"></label>
          <label class="field">End<input id="mt-end" type="time" value="${esc(m.end)}"></label>
        </div>
        <div class="row">
          <label class="field grow">Repeats
            <select id="mt-repeat">${REPEATS.map((r) => `<option value="${r.id}"${r.id === m.repeat ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
          </label>
          <label class="field" id="mt-until-field">Until (optional)<input id="mt-until" type="date" value="${esc(m.until)}"></label>
        </div>
        <label class="field">Where (room or video link)
          <input id="mt-location" placeholder="e.g. Room 3.14 or https://zoom.us/j/…" value="${esc(m.location)}">
        </label>
        <label class="field">Project (optional)
          <select id="mt-project"><option value="">Not linked to a project</option>${state.projects
            .slice().sort((a, b) => a.title.localeCompare(b.title))
            .map((p) => `<option value="${esc(p.id)}"${p.id === m.projectId ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select>
        </label>
        <label class="field">Notes (optional)<textarea id="mt-notes" rows="2" placeholder="Agenda, who attends…">${esc(m.notes)}</textarea></label>
        ${m.skip.length ? `<p class="muted small">Cancelled dates: ${m.skip.map((x) => esc(fmtDate(x))).join(', ')} · <button type="button" class="link-btn" id="mt-restore">Restore them</button></p>` : ''}
        <p class="auth-error" id="mt-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn" id="mt-cancel">Cancel</button>
          <button class="btn primary">${existing ? 'Save changes' : 'Add meeting'}</button>
        </div>
      </form>`;
    const $ = (id) => wrap.querySelector(id);
    const syncUntil = () => { $('#mt-until-field').hidden = $('#mt-repeat').value === 'none'; };
    syncUntil();
    $('#mt-repeat').addEventListener('change', syncUntil);
    let skip = m.skip.slice();
    const restore = $('#mt-restore');
    if (restore) restore.addEventListener('click', () => { skip = []; restore.parentElement.remove(); });
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    $('#mt-cancel').addEventListener('click', close);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    $('form').addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const v = (id) => $(id).value.trim();
      const err = (t) => { const x = $('#mt-error'); x.textContent = t; x.hidden = false; };
      if (!v('#mt-title')) return err('Give the meeting a title.');
      if (!isISODate(v('#mt-date'))) return err('Choose a date.');
      if (v('#mt-end') && !v('#mt-start')) return err('Add a start time, or clear the end time.');
      if (v('#mt-start') && v('#mt-end') && v('#mt-end') <= v('#mt-start')) return err('The end time must be after the start time.');
      if (v('#mt-until') && v('#mt-until') < v('#mt-date') && v('#mt-repeat') !== 'none') return err('"Until" must be on or after the first date.');
      const [saved] = normalizeMeetings([{
        id: existing ? existing.id : uid(),
        title: v('#mt-title'), date: v('#mt-date'), start: v('#mt-start'), end: v('#mt-end'),
        repeat: v('#mt-repeat'), until: v('#mt-repeat') === 'none' ? '' : v('#mt-until'),
        location: v('#mt-location'), projectId: v('#mt-project'), notes: $('#mt-notes').value, skip,
      }]);
      if (existing) Object.assign(existing, saved);
      else state.meetings.push(saved);
      close();
      commit(); // also refreshes an open day pop-up
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    $('#mt-title').focus();
  }

  function deleteMeeting(m) {
    askDialog({
      title: 'Delete this meeting?',
      message: m.repeat === 'none'
        ? `“${m.title}” will be removed.`
        : `“${m.title}” and all its repeats will be removed. To skip just one date, use “Cancel this date” on that day instead.`,
      confirmLabel: 'Delete meeting',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      state.meetings = state.meetings.filter((x) => x.id !== m.id);
      commit();
    });
  }

  function downloadICS(m) {
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const name = m.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'meeting';
    saveFile(`${name}.ics`, meetingICS(m, now), 'text/calendar');
  }

  function meetingRow(m, date, opts) {
    const p = m.projectId && findProject(m.projectId);
    return `
      <li class="item meeting-item">
        <span class="meeting-time">${esc(opts && opts.showDay ? dayLabel(date) : meetingTime(m))}${opts && opts.showDay ? `<small>${esc(meetingTime(m))}</small>` : ''}</span>
        <div class="item-body">
          <div class="item-title">${esc(m.title)} ${m.repeat !== 'none' ? REPEAT_ICON : ''}</div>
          <div class="meta">
            <span>Meeting</span>
            ${p ? `<span>·</span><a href="#/project/${esc(p.id)}" data-close-due>${esc(p.title)}</a>` : ''}
            ${locationHTML(m.location)}
          </div>
          ${opts && opts.actions ? `
            <div class="meeting-actions">
              <button class="link-btn" data-action="edit-meeting" data-id="${esc(m.id)}">Edit</button>
              ${m.repeat !== 'none'
                ? `<button class="link-btn" data-action="skip-meeting" data-id="${esc(m.id)}" data-date="${esc(date)}">Cancel this date</button>`
                : `<button class="link-btn danger-link" data-action="delete-meeting" data-id="${esc(m.id)}">Delete</button>`}
            </div>` : ''}
        </div>
      </li>`;
  }

  function upcomingMeetingsHTML() {
    const t = today();
    const list = meetingsBetween(state.meetings, t, addDays(t, 13)).slice(0, 6);
    return `
      <section class="panel">
        <div class="panel-head"><h2>Upcoming meetings</h2><a class="panel-link" href="#/meetings">All →</a></div>
        ${list.length
          ? `<ul class="items">${list.map((x) => meetingRow(x.meeting, x.date, { showDay: true })).join('')}</ul>`
          : '<p class="muted small">No meetings in the next 2 weeks.</p>'}
        <button class="btn small" data-action="new-meeting">+ Add meeting</button>
      </section>`;
  }

  function renderMeetings() {
    setNav('meetings');
    const t = today();
    const series = state.meetings.slice().sort((a, b) => {
      const na = meetingsBetween([a], t, addDays(t, 400))[0];
      const nb = meetingsBetween([b], t, addDays(t, 400))[0];
      return (na ? na.date : '9999') .localeCompare(nb ? nb.date : '9999') || a.title.localeCompare(b.title);
    });
    const agenda = meetingsBetween(state.meetings, t, addDays(t, 27));
    const byDay = new Map();
    for (const x of agenda) {
      if (!byDay.has(x.date)) byDay.set(x.date, []);
      byDay.get(x.date).push(x);
    }
    app().innerHTML = `
      ${flashHTML()}
      <header class="page-head">
        <div>
          <h1>Meetings</h1>
          <p class="eyebrow">Research meetings, one-off or repeating. They also show on the dashboard calendar.</p>
        </div>
        <button class="btn primary" data-action="new-meeting">+ Add meeting</button>
      </header>
      ${!state.meetings.length
        ? '<section class="empty"><h2>No meetings yet</h2><p>Add your lab meetings, supervisions and journal clubs. Repeating meetings only need adding once.</p><button class="btn primary" data-action="new-meeting">+ Add meeting</button></section>'
        : `
        <div class="grid-2 meetings-grid">
          <section class="panel">
            <div class="panel-head"><h2>Next 4 weeks</h2></div>
            ${byDay.size ? [...byDay.entries()].map(([d, xs]) => `
              <h3 class="subhead">${esc(dayLabel(d))}</h3>
              <ul class="items">${xs.map((x) => meetingRow(x.meeting, x.date, { actions: true })).join('')}</ul>`).join('')
              : '<p class="muted">Nothing in the next 4 weeks.</p>'}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>All meetings <span class="count">${state.meetings.length}</span></h2></div>
            <ul class="items">${series.map((m) => {
              const next = meetingsBetween([m], t, addDays(t, 400))[0];
              const p = m.projectId && findProject(m.projectId);
              return `
                <li class="item series-item">
                  <div class="item-body">
                    <div class="item-title">${esc(m.title)} ${m.repeat !== 'none' ? REPEAT_ICON : ''}</div>
                    <div class="meta"><span>${esc(describeMeeting(m))}</span></div>
                    <div class="meta">
                      <span>${next ? `Next: ${esc(dayLabel(next.date))}` : 'No upcoming dates'}</span>
                      ${p ? `<span>·</span><a href="#/project/${esc(p.id)}">${esc(p.title)}</a>` : ''}
                      ${locationHTML(m.location)}
                    </div>
                    <div class="meeting-actions">
                      <button class="link-btn" data-action="edit-meeting" data-id="${esc(m.id)}">Edit</button>
                      <button class="link-btn" data-action="ics-meeting" data-id="${esc(m.id)}">Add to my calendar</button>
                      <button class="link-btn danger-link" data-action="delete-meeting" data-id="${esc(m.id)}">Delete</button>
                    </div>
                  </div>
                </li>`;
            }).join('')}</ul>
          </section>
        </div>`}`;
  }

  // ---------- "What's due" pop-up ----------
  // Opened from a calendar day, any due label ("in 3 days") or the Overdue / Due in 7 days tiles.
  // The list is fixed when it opens, so a task ticked off here stays visible (struck through).

  function openDue(spec) {
    const t = today();
    const scoped = spec.filtered ? filterByType(state, ui.typeFilter) : state;
    const all = deadlines(scoped, t, { mineOnly: spec.filtered && ui.mineOnly });
    const items = spec.kind === 'day'
      ? all.filter((i) => i.due === spec.date)
      : spec.kind === 'overdue'
        ? all.filter((i) => i.days < 0)
        : all.filter((i) => i.days >= 0 && i.days <= WEEK_DAYS);
    if (spec.kind === 'day') {
      // include tasks already done that day, so the day reads complete
      for (const task of scoped.tasks) {
        if (task.done && task.due === spec.date) {
          const p = scoped.projects.find((x) => x.id === task.projectId);
          if (p) items.push({ kind: 'task', id: task.id, projectId: p.id, project: p.title, title: task.title, owner: task.owner, due: task.due, days: daysUntil(task.due, t) });
        }
      }
    }
    ui.due = { ...spec, items, opener: document.activeElement };
    renderDue();
  }

  function closeDue() {
    if (!ui.due) return;
    const opener = ui.due.opener;
    ui.due = null;
    const el = document.getElementById('due-dialog');
    if (el) el.remove();
    if (opener && document.contains(opener)) opener.focus();
  }

  function renderDue() {
    const d = ui.due;
    if (!d) return;
    const t = today();
    let title;
    let sub;
    if (d.kind === 'day') {
      title = parseISO(d.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      const n = daysUntil(d.date, t);
      sub = n === 0 ? 'Today' : relDays(n).replace(/^./, (c) => c.toUpperCase());
    } else if (d.kind === 'overdue') {
      title = 'Overdue';
      sub = 'Past their due date';
    } else {
      title = 'Due in the next 7 days';
      sub = `${fmtDate(t)} – ${fmtDate(addDays(t, WEEK_DAYS))}`;
    }
    const multiDay = d.kind !== 'day';
    const meets = d.kind === 'day' ? meetingsBetween(state.meetings, d.date, d.date) : [];
    const working = d.kind === 'day'
      ? tasksInProgress(d.filtered ? filterByType(state, ui.typeFilter) : state, d.date)
        .filter((x) => !(d.filtered && ui.mineOnly && state.me) || sameName(x.owner, state.me))
      : [];
    const row = (i) => {
      const task = i.kind === 'task' ? state.tasks.find((x) => x.id === i.id) : null;
      const done = !!(task && task.done);
      return `
        <li class="item${done ? ' is-done' : ''}${i.days < 0 && !done ? ' is-overdue' : ''}">
          ${task
            ? `<input type="checkbox" class="check" data-action="toggle-task" data-id="${esc(i.id)}" ${done ? 'checked' : ''} aria-label="Mark “${esc(i.title)}” done">`
            : `<span class="kind-key"><i class="key key-${i.kind}"></i></span>`}
          <div class="item-body">
            <div class="item-title">${esc(i.title)}</div>
            <div class="meta">
              <span>${esc(KIND_LABEL[i.kind])}</span><span>·</span>
              <a href="#/project/${esc(i.projectId)}" data-close-due>${esc(i.project)}</a>
              ${i.owner ? `<span>· ${esc(i.owner)}</span>` : ''}
            </div>
          </div>
          ${multiDay ? `<span class="due-date${i.days < 0 ? ' is-late' : ''}">${esc(i.days < 0 || i.days <= 1 ? relDays(i.days) : fmtDate(i.due))}</span>` : ''}
        </li>`;
    };
    let el = document.getElementById('due-dialog');
    const fresh = !el;
    if (fresh) {
      el = document.createElement('div');
      el.id = 'due-dialog';
      el.className = 'modal-backdrop';
      el.addEventListener('mousedown', (e) => { if (e.target === el) closeDue(); });
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="modal due-modal" role="dialog" aria-modal="true" aria-labelledby="due-title">
        <div class="due-head">
          <div>
            <h2 id="due-title">${esc(title)}</h2>
            <p class="modal-msg">${esc(sub)} · ${d.items.length} due${d.kind === 'day' ? ` · ${meets.length} meeting${meets.length === 1 ? '' : 's'}` : ''}</p>
          </div>
          <button class="icon-btn" data-action="close-due" aria-label="Close">×</button>
        </div>
        ${meets.length ? `<h3 class="subhead">Meetings</h3><ul class="items due-list">${meets.map((x) => meetingRow(x.meeting, x.date, { actions: true })).join('')}</ul>` : ''}
        ${working.length ? `<h3 class="subhead">In progress</h3><ul class="items due-list">${working.map((x) => {
          const p = findProject(x.projectId);
          return `
            <li class="item">
              <input type="checkbox" class="check" data-action="toggle-task" data-id="${esc(x.id)}" aria-label="Mark “${esc(x.title)}” done">
              <div class="item-body">
                <div class="item-title">${esc(x.title)}</div>
                <div class="meta"><span>Task</span><span>·</span><a href="#/project/${esc(x.projectId)}" data-close-due>${esc(p ? p.title : '')}</a>${x.owner ? `<span>· ${esc(x.owner)}</span>` : ''}</div>
              </div>
              <span class="due-date">until ${esc(fmtShort(x.due))}</span>
            </li>`;
        }).join('')}</ul>` : ''}
        ${d.kind === 'day' ? `<h3 class="subhead">Due</h3>` : ''}
        ${d.items.length
          ? `<ul class="items due-list">${d.items.map(row).join('')}</ul>`
          : '<p class="muted">Nothing due.</p>'}
        ${d.kind === 'day' ? `<p class="due-add"><button class="btn small" data-action="new-meeting" data-date="${esc(d.date)}">+ Add a meeting on this day</button></p>` : ''}
      </div>`;
    if (fresh) el.querySelector('[data-action="close-due"]').focus();
  }

  function workloadHTML(rows) {
    if (!rows.length) return '<p class="muted">No open tasks.</p>';
    const max = Math.max(1, ...rows.map((r) => r.open));
    return `
      <div class="legend" aria-hidden="true">
        <span><i class="key key-ontrack"></i>On track</span>
        <span><i class="key key-late"></i>Overdue</span>
      </div>
      <div class="bars">${rows.map((r) => {
        const ok = r.open - r.overdue;
        const tip = tipAttr(r.name, [
          { kind: 'ontrack', value: String(ok), label: 'on track' },
          { kind: 'late', value: String(r.overdue), label: 'overdue' },
        ]);
        return `
          <div class="bar-row">
            <span class="bar-label" title="${esc(r.name)}">${esc(r.name)}</span>
            <button class="bar-track" ${tip} aria-label="${esc(`${r.name}: ${r.open} open, ${r.overdue} overdue`)}">
              <span class="stack" style="width:${(r.open / max) * 100}%">
                ${ok ? `<span class="seg seg-ontrack" style="flex:${ok}"></span>` : ''}
                ${r.overdue ? `<span class="seg seg-late" style="flex:${r.overdue}"></span>` : ''}
              </span>
              <span class="bar-value">${r.open}</span>
            </button>
          </div>`;
      }).join('')}</div>`;
  }

  function actionItem(i) {
    return `
      <li class="item ${i.days < 0 ? 'is-overdue' : ''}">
        ${i.kind === 'task'
          ? `<input type="checkbox" class="check" data-action="toggle-task" data-id="${esc(i.id)}" aria-label="Mark “${esc(i.title)}” done">`
          : `<span class="kind-key"><i class="key key-${i.kind}"></i></span>`}
        <div class="item-body">
          <div class="item-title">${esc(i.title)}</div>
          <div class="meta">
            <span>${esc(KIND_LABEL[i.kind])}</span>
            <span>·</span>
            <a href="#/project/${esc(i.projectId)}">${esc(i.project)}</a>
            ${i.owner ? `<span>· ${esc(i.owner)}</span>` : ''}
          </div>
        </div>
        ${dueBadge(i.due)}
      </li>`;
  }

  function renderHome() {
    setNav('home');
    tips = new Map();
    const t = today();

    if (!state.projects.length && cloud.pending) {
      app().innerHTML = `<section class="empty"><p>Loading your projects…</p></section>`;
      return;
    }
    if (!state.projects.length) {
      app().innerHTML = `
        ${flashHTML()}
        ${invitesHTML()}
        <section class="empty">
          <h1>Where does every paper stand?</h1>
          <p>Track each project from idea to submission: its stage, team, next action, deadlines and target journal.</p>
          <div class="row center">
            <button class="btn primary" data-action="new-project">Create your first project</button>
            <button class="btn" data-action="import">Import from a backup</button>
          </div>
        </section>`;
      return;
    }

    const vs = filterByType(state, ui.typeFilter);
    const st = dashboardStats(vs, t, { mineOnly: ui.mineOnly });
    const att = st.attention;
    const items = deadlines(vs, t, { mineOnly: ui.mineOnly });
    const actions = [...att.overdue, ...att.upcoming];
    const filtered = ui.typeFilter !== 'all';

    const overview = vs.projects
      .slice()
      .sort((a, b) => STAGE_IDS.indexOf(a.stage) - STAGE_IDS.indexOf(b.stage) || a.title.localeCompare(b.title))
      .map((p) => `
        <tr>
          <td class="cell-project"><a href="#/project/${esc(p.id)}">${esc(p.title)}</a> ${shareChip(p)}${firstAuthors(p) ? `<div class="meta">First author: ${esc(firstAuthors(p))}</div>` : ''}</td>
          <td>${typeBadge(p.studyType)}</td>
          <td>${stageMeter(p.stage, p.studyType)}</td>
          <td>${p.nextAction ? esc(p.nextAction) : '<span class="muted">Not set</span>'}${waitingText(p) ? `<div class="meta">${esc(waitingText(p))}</div>` : ''}</td>
          <td>${dueBadge(p.nextActionDue) || '<span class="muted">—</span>'}</td>
          <td class="num">${openTasks(p.id).length}</td>
          <td>${p.journal.target ? esc(p.journal.target) : '<span class="muted">—</span>'}</td>
        </tr>`)
      .join('');

    app().innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">${esc(parseISO(t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p>
          <h1>What needs my attention this week?</h1>
        </div>
        <div class="row">
          <label class="field-inline">Viewing as
            <input list="names-all" data-setting="me" value="${esc(state.me)}" placeholder="Your name" size="12">
          </label>
          ${namesDatalist('names-all')}
          ${typeFilterControl()}
          <div class="segmented" role="group" aria-label="Scope">
            <button data-action="set-mine" data-mine="0" aria-pressed="${!ui.mineOnly}">Everyone</button>
            <button data-action="set-mine" data-mine="1" aria-pressed="${ui.mineOnly}" ${state.me ? '' : 'disabled title="Enter your name first"'}>Only mine</button>
          </div>
        </div>
      </header>

      ${flashHTML()}
      ${invitesHTML()}
      <section class="tiles" aria-label="Summary">
        ${tile('Active projects', st.activeCount, `${st.submittedCount} submitted · under review`)}
        ${tile('Overdue', st.overdueCount, st.overdueCount ? 'Past their due date' : 'Nothing overdue', st.overdueCount ? 'tile-critical' : 'tile-good', st.overdueCount ? 'alert' : 'check', 'overdue')}
        ${tile('Due in 7 days', st.dueSoonCount, `Through ${esc(fmtDate(addDays(t, WEEK_DAYS)))}`, '', '', 'soon')}
        ${tile('Tasks completed', st.doneThisWeek, 'In the last 7 days')}
      </section>

      <div class="dash-grid">
        <section class="panel span-2">
          <div class="panel-head"><h2>Deadlines · next ${TIMELINE_DAYS} days</h2></div>
          ${timelineHTML(items, t)}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Pipeline</h2><a class="panel-link" href="#/projects">Board →</a></div>
          <p class="panel-sub">Projects at each stage</p>
          ${pipelineHTML(st.byStage, vs.projects)}
        </section>

        <section class="panel span-2">
          <div class="panel-head"><h2>Action items <span class="count">${actions.length}</span></h2></div>
          ${actions.length ? `<ul class="items">${actions.map(actionItem).join('')}</ul>` : '<p class="muted">Nothing overdue or due this week.</p>'}
          ${att.noNextAction.length ? `
            <h3 class="subhead">Needs a next action</h3>
            <ul class="items">${att.noNextAction.map((p) => `
              <li class="item">
                <span class="kind-key"><i class="key key-none"></i></span>
                <div class="item-body"><a href="#/project/${esc(p.id)}">${esc(p.title)}</a></div>
                ${stagePill(p.stage, p.studyType)}
              </li>`).join('')}
            </ul>` : ''}
        </section>
        <div class="side-col">
          <section class="panel cal-panel">
            <div class="panel-head"><h2>Calendar</h2><button class="link-btn panel-link" data-action="new-meeting">+ Meeting</button></div>
            ${calendarHTML(items, t)}
          </section>
          ${upcomingMeetingsHTML()}
          <section class="panel">
            <div class="panel-head"><h2>Study types</h2>${filtered ? '<button class="link-btn panel-link" data-action="set-type" data-type="all">Show all</button>' : ''}</div>
            <p class="panel-sub">Projects by design · select one to filter</p>
            ${typesHTML(vs.projects)}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Workload</h2></div>
            <p class="panel-sub">Open tasks by person</p>
            ${workloadHTML(st.workload)}
          </section>
        </div>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>Portfolio</h2><span class="muted small">${vs.projects.length} project${vs.projects.length === 1 ? '' : 's'}${filtered ? ` of ${state.projects.length}` : ''}</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Project</th><th>Study type</th><th>Stage</th><th>Next action</th><th>Due</th><th class="num">Open tasks</th><th>Target journal</th></tr></thead>
            <tbody>${overview}</tbody>
          </table>
        </div>
      </section>`;
  }

  function renderBoard() {
    setNav('projects');
    const shown = state.projects.filter((p) => matchesType(p, ui.typeFilter) && matchesSearch(p, ui.search));
    const sel = ui.selected || new Set();
    const listView = ui.projView === 'list';
    const cols = listView ? '' : STAGES.map((s) => {
      const ps = shown.filter((p) => p.stage === s.id);
      return `
        <section class="column">
          <h2>${stageNameHTML(s.id, shown)} <span class="count">${ps.length}</span></h2>
          ${ps.map((p) => {
            const open = openTasks(p.id).length;
            const tag = ui.selecting ? 'label' : 'a';
            return `
              <${tag} class="card${ui.selecting ? ' is-selectable' : ''}${sel.has(p.id) ? ' is-selected' : ''}" ${ui.selecting ? '' : `href="#/project/${esc(p.id)}"`}>
                ${ui.selecting ? `<input type="checkbox" class="check card-check" data-select="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.title)}">` : ''}
                <div class="card-title">${esc(p.title)}</div>
                <div class="card-type">${typeBadge(p.studyType)} ${shareChip(p)}</div>
                ${firstAuthors(p) ? `<div class="meta">First author: ${esc(firstAuthors(p))}</div>` : ''}
                ${p.journal.target ? `<div class="meta">→ ${esc(p.journal.target)}</div>` : ''}
                <div class="card-next">${p.nextAction ? `<strong>Next:</strong> ${esc(p.nextAction)}${waitingText(p) ? `<div class="meta">${esc(waitingText(p))}</div>` : ''}` : '<span class="muted">No next action</span>'}</div>
                <div class="card-foot">
                  <span class="meta">${open} open task${open === 1 ? '' : 's'}</span>
                  ${dueBadge(p.nextActionDue)}
                </div>
              </${tag}>`;
          }).join('') || '<p class="muted small">—</p>'}
        </section>`;
    }).join('');
    const rows = !listView ? '' : shown
      .slice()
      .sort((a, b) => STAGE_IDS.indexOf(a.stage) - STAGE_IDS.indexOf(b.stage) || a.title.localeCompare(b.title))
      .map((p) => {
        const authors = p.team.filter((m) => m.role !== 'contributor').map((m) => m.name);
        return `
        <tr class="row-link${sel.has(p.id) ? ' is-selected' : ''}" data-href="#/project/${esc(p.id)}">
          ${ui.selecting ? `<td class="cell-check"><input type="checkbox" class="check" data-select="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.title)}"></td>` : ''}
          <td class="cell-project">
            <a href="#/project/${esc(p.id)}">${esc(p.title)}</a>
            <div class="cell-badges">${typeBadge(p.studyType)} ${shareChip(p)}</div>
          </td>
          <td>${stageMeter(p.stage, p.studyType)}</td>
          <td>${authors.length ? esc(authors.slice(0, 3).join(', ')) + (authors.length > 3 ? ` <span class="muted">+${authors.length - 3}</span>` : '') : '<span class="muted">—</span>'}</td>
          <td>${p.nextAction ? esc(p.nextAction) : '<span class="muted">Not set</span>'}${waitingText(p) ? `<div class="meta">${esc(waitingText(p))}</div>` : ''}</td>
          <td>${dueBadge(p.nextActionDue) || '<span class="muted">—</span>'}</td>
          <td class="num">${openTasks(p.id).length}</td>
        </tr>`;
      }).join('');
    const results = !shown.length && state.projects.length
      ? `<p class="muted no-results">No projects match${ui.search ? ` “${esc(ui.search)}”` : ''}. <button class="link-btn" data-action="clear-search">Clear search</button></p>`
      : listView
        ? `<section class="panel list-panel"><div class="table-wrap"><table class="project-list">
            <thead><tr>${ui.selecting ? '<th></th>' : ''}<th>Project</th><th>Stage</th><th>Authors</th><th>Next action</th><th>Due</th><th class="num">Open tasks</th></tr></thead>
            <tbody>${rows}</tbody></table></div></section>`
        : `<div class="board">${cols}</div>`;
    app().innerHTML = `
      ${flashHTML()}
      <header class="page-head">
        <h1>Projects <span class="count">${shown.length}${shown.length !== state.projects.length ? ` of ${state.projects.length}` : ''}</span></h1>
        <div class="row">
          <input type="search" id="project-search" class="search-input" placeholder="Search title, author, journal…" value="${esc(ui.search)}" aria-label="Search projects">
          <div class="segmented" role="group" aria-label="View">
            <button data-action="proj-view" data-view="list" aria-pressed="${listView}">List</button>
            <button data-action="proj-view" data-view="board" aria-pressed="${!listView}">Board</button>
          </div>
          ${typeFilterControl()}
          ${state.projects.length ? `<button class="btn" data-action="toggle-select">${ui.selecting ? 'Cancel' : 'Select'}</button>` : ''}
          <button class="btn primary" data-action="new-project">+ New project</button>
        </div>
      </header>
      ${ui.selecting ? `
        <div class="select-bar" role="region" aria-label="Selection">
          <span><strong>${sel.size}</strong> selected · tick the projects to remove from your dashboard</span>
          <button class="link-btn" data-action="select-all">Select all shown</button>
          <button class="btn danger-solid small" data-action="remove-selected" ${sel.size ? '' : 'disabled'}>Remove from dashboard</button>
        </div>` : ''}
      ${results}`;
  }

  // ---------- People: who is on which paper ----------

  const ROLE_BADGE = { first: 'First author', coauthor: 'Co-author', contributor: 'Contributor', assigned: 'Not on team · has work' };

  function renderPeople() {
    setNav('people');
    const scoped = filterByType(state, ui.typeFilter);
    const q = ui.search.trim().toLowerCase();
    const everyone = peopleIndex(scoped);
    const people = everyone.filter((x) => !q || x.name.toLowerCase().includes(q) || x.papers.some((pp) => pp.title.toLowerCase().includes(q)));
    const byPaper = ui.peopleView === 'paper';

    const personCard = (x) => `
      <section class="panel person">
        <div class="person-head">
          <span class="avatar" aria-hidden="true">${esc(initials(x.name))}</span>
          <div class="grow">
            <h2>${esc(x.name)}</h2>
            <div class="meta">${x.papers.length} paper${x.papers.length === 1 ? '' : 's'} · ${x.openTasks} open task${x.openTasks === 1 ? '' : 's'}${x.waitingOn ? ` · <span class="waiting-on">waiting on them for ${x.waitingOn} next action${x.waitingOn === 1 ? '' : 's'}</span>` : ''}</div>
          </div>
        </div>
        <ul class="person-papers">${x.papers.map((pp) => `
          <li>
            <a href="#/project/${esc(pp.projectId)}" class="grow">${esc(pp.title)}</a>
            <span class="role-badge role-${pp.role}">${esc(ROLE_BADGE[pp.role])}</span>
            <span class="person-paper-meta">${esc(stageLabel(pp.stage, pp.studyType))}${pp.openTasks ? ` · ${pp.openTasks} task${pp.openTasks === 1 ? '' : 's'}` : ''}${pp.waiting ? ' · <strong>waiting on them</strong>' : ''}</span>
          </li>`).join('')}
        </ul>
      </section>`;

    const names = (p, role) => p.team.filter((m) => m.role === role).map((m) => esc(m.name)).join(', ') || '<span class="muted">—</span>';
    const paperRows = scoped.projects
      .filter((p) => !q || p.title.toLowerCase().includes(q) || p.team.some((m) => m.name.toLowerCase().includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((p) => `
        <tr>
          <td class="cell-project"><a href="#/project/${esc(p.id)}">${esc(p.title)}</a><div class="cell-badges">${typeBadge(p.studyType)}</div></td>
          <td>${names(p, 'first')}</td>
          <td>${names(p, 'coauthor')}</td>
          <td>${names(p, 'contributor')}</td>
          <td>${pendingOwners(p).length ? esc(joinNames(pendingOwners(p))) : '<span class="muted">—</span>'}</td>
        </tr>`).join('');

    app().innerHTML = `
      <header class="page-head">
        <div>
          <h1>People</h1>
          <p class="eyebrow">Who is on which paper, and what they're working on</p>
        </div>
        <div class="row">
          <input type="search" id="people-search" class="search-input" placeholder="Search people or papers…" value="${esc(ui.search)}" aria-label="Search people or papers">
          <div class="segmented" role="group" aria-label="Group by">
            <button data-action="people-view" data-view="person" aria-pressed="${!byPaper}">By person</button>
            <button data-action="people-view" data-view="paper" aria-pressed="${byPaper}">By paper</button>
          </div>
          ${typeFilterControl()}
        </div>
      </header>
      ${!everyone.length
        ? '<section class="empty"><p>Nobody yet. Add authors and contributors on each project page, under Team.</p></section>'
        : byPaper
          ? `<section class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Paper</th><th>First author</th><th>Co-authors</th><th>Contributors</th><th>Waiting for</th></tr></thead>
              <tbody>${paperRows || '<tr><td colspan="5" class="muted">No papers match.</td></tr>'}</tbody></table></div></section>`
          : people.length
            ? `<div class="people-grid">${people.map(personCard).join('')}</div>`
            : `<p class="muted no-results">Nobody matches “${esc(ui.search)}”. <button class="link-btn" data-action="clear-search">Clear search</button></p>`}`;
  }

  function renderProject(id) {
    setNav('projects');
    const p = findProject(id);
    if (!p) {
      app().innerHTML = `<section class="empty"><h1>Project not found</h1><p><a href="#/projects">Back to projects</a></p></section>`;
      return;
    }
    const idx = STAGE_IDS.indexOf(p.stage);
    const next = STAGES[idx + 1];
    const tasks = state.tasks.filter((t) => t.projectId === p.id);
    const open = tasks.filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    const done = tasks.filter((t) => t.done);

    const taskRow = (t) => `
      <li class="item ${t.done ? 'is-done' : ''}">
        <input type="checkbox" class="check" data-action="toggle-task" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} aria-label="Done">
        <div class="item-body">
          <div class="item-title">${esc(t.title)}</div>
          <div class="meta">${t.owner
            ? `<span class="owner-chip"><span class="mini-avatar" aria-hidden="true">${esc(initials(t.owner))}</span>${esc(t.owner)}</span>`
            : '<span class="muted">Unassigned</span>'}${t.start ? `<span>· ${esc(fmtShort(t.start))} → ${esc(t.due ? fmtShort(t.due) : 'no due date')}</span>` : ''}</div>
        </div>
        ${t.done ? '' : dueBadge(t.due)}
        <button class="icon-btn" data-action="edit-task" data-id="${esc(t.id)}" aria-label="Edit task" title="Edit dates, owner or name">✎</button>
        <button class="icon-btn" data-action="delete-task" data-id="${esc(t.id)}" aria-label="Delete task" title="Delete task">×</button>
      </li>`;

    app().innerHTML = `
      ${flashHTML()}
      <p><a href="#/projects">← All projects</a></p>
      <header class="page-head">
        <input class="title-input" data-field="title" value="${esc(p.title)}" aria-label="Project title">
        ${ownsProject(p)
          ? `<button class="btn danger" data-action="delete-project" data-id="${esc(p.id)}">Delete</button>`
          : '<button class="btn" data-action="leave-project">Leave project</button>'}
      </header>
      <div class="row type-row">
        <label class="field-inline">Study type
          <select data-field="studyType" id="project-type" class="${p.studyType ? '' : 'needs-value'}">${typeOptions(p.studyType, false)}</select>
        </label>
        ${p.studyType ? `<span class="muted small">${esc(FAMILY_LABEL[familyOf(p.studyType)])}</span>` : ''}
      </div>

      <ol class="stepper" aria-label="Stage">
        ${STAGES.map((s, i) => `
          <li class="${i < idx ? 'past' : i === idx ? 'current' : ''}">
            <button data-action="set-stage" data-stage="${s.id}" ${i === idx ? 'aria-current="step"' : ''}>${esc(stageLabel(s.id, p.studyType))}</button>
          </li>`).join('')}
      </ol>
      ${next ? `<p><button class="btn" data-action="set-stage" data-stage="${next.id}">Move to ${esc(stageLabel(next.id, p.studyType))} →</button></p>` : ''}

      <div class="grid-2">
        <section class="panel">
          <h2>Next action</h2>
          <label class="field">What's the very next step?
            <input data-field="nextAction" value="${esc(p.nextAction)}" placeholder="${familyOf(p.studyType) === 'primary' ? 'e.g. Finish data cleaning' : 'e.g. Finish full-text screening'}">
          </label>
          <div class="field-label">Who needs to do it</div>
          ${p.nextActionOwners.length ? `<ul class="owners">${p.nextActionOwners.map((o, i) => `
            <li class="${o.done ? 'is-done' : ''}">
              <label class="owner-check">
                <input type="checkbox" class="check" data-owner-done="${i}" ${o.done ? 'checked' : ''}>
                <span class="owner-name">${esc(o.name)}</span>
              </label>
              <span class="owner-state ${o.done ? 'state-done' : 'state-waiting'}">${o.done ? 'Done' : 'Waiting'}</span>
              <button class="icon-btn" data-action="remove-owner" data-index="${i}" aria-label="Remove ${esc(o.name)}" title="Remove">×</button>
            </li>`).join('')}</ul>` : ''}
          ${(() => {
            const free = p.team.filter((m) => m.role !== 'contributor' && !p.nextActionOwners.some((o) => sameName(o.name, m.name)));
            return free.length ? `<div class="owner-add">${free.map((m) => `<button class="chip" data-action="add-owner" data-name="${esc(m.name)}">+ ${esc(m.name)}</button>`).join('')}</div>` : '';
          })()}
          <form class="add-owner" data-form="add-owner">
            <input name="name" list="names-all" placeholder="Add someone else" aria-label="Add a person to this action">
            <button class="btn small">Add</button>
          </form>
          <label class="field">By
            <input type="date" data-field="nextActionDue" value="${esc(p.nextActionDue)}">
          </label>
          ${p.nextAction ? `
            <div class="waiting-line">
              <span>${p.nextActionOwners.length ? esc(waitingText(p)) + (pendingOwners(p).length ? '' : '.') : 'Nobody assigned yet.'}</span>
              <button class="btn small ${p.nextActionOwners.length && !pendingOwners(p).length ? 'primary' : ''}" data-action="next-done">Done — clear it</button>
            </div>` : ''}
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Tasks <span class="count">${open.length} open</span></h2>
            ${open.length ? `<div class="segmented small-seg" role="group" aria-label="Show tasks">
              <button data-action="task-group" data-group="list" aria-pressed="${ui.taskGroup !== 'person'}">List</button>
              <button data-action="task-group" data-group="person" aria-pressed="${ui.taskGroup === 'person'}">By person</button>
            </div>` : ''}
          </div>
          <form class="add-task" data-form="add-task">
            <input name="title" placeholder="New task" required aria-label="Task">
            <span class="owner-pick">${ownerPicker(p, ui.taskOwner && ui.taskOwner.pid === p.id ? ui.taskOwner.name : '', 'owner')}</span>
            <label class="mini-field">Start <span class="muted">(optional)</span><input name="start" type="date"></label>
            <label class="mini-field">Due<input name="due" type="date"></label>
            <button class="btn primary">Add</button>
          </form>
          ${taskGanttHTML(open)}
          ${!open.length ? '<p class="muted">No open tasks.</p>'
            : ui.taskGroup === 'person'
              ? tasksByPerson(open).map(([who, list]) => `
                  <h3 class="subhead">${esc(who || 'Unassigned')} <span class="count">${list.length}</span></h3>
                  <ul class="items">${list.map(taskRow).join('')}</ul>`).join('')
              : `<ul class="items">${open.map(taskRow).join('')}</ul>`}
          ${done.length ? `
            <button class="link-btn" data-action="toggle-show-done">${ui.showDone[p.id] ? 'Hide' : 'Show'} ${done.length} completed</button>
            ${ui.showDone[p.id] ? `<ul class="items">${done.map(taskRow).join('')}</ul>` : ''}` : ''}
        </section>
      </div>

      <div class="grid-2">
        <section class="panel">
          <h2>Team</h2>
          ${p.team.length ? ROLES.map((r) => {
            const members = p.team.filter((m) => m.role === r.id);
            if (!members.length) return '';
            return `
              <h3 class="subhead team-head">${esc(r.plural)}</h3>
              <ul class="team">${members.map((m) => {
                const n = openTasks(p.id).filter((t) => sameName(t.owner, m.name)).length;
                return `
                <li>
                  <span class="avatar avatar-${m.role}" aria-hidden="true">${esc(initials(m.name))}</span>
                  <span class="grow"><strong>${esc(m.name)}</strong>${m.note ? ` <span class="muted">· ${esc(m.note)}</span>` : ''}
                    <span class="meta">${n} open task${n === 1 ? '' : 's'}</span></span>
                  <button class="btn small task-for" data-action="task-for" data-name="${esc(m.name)}" title="Add a task for ${esc(m.name)}">+ Task</button>
                  <select class="role-select" data-member-role="${esc(m.id)}" aria-label="Role for ${esc(m.name)}">
                    ${ROLES.map((x) => `<option value="${x.id}"${x.id === m.role ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}
                  </select>
                  <button class="icon-btn" data-action="remove-member" data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}" title="Remove">×</button>
                </li>`;
              }).join('')}</ul>`;
          }).join('') : '<p class="muted">No authors yet. Add the first author below.</p>'}
          <form class="add-member" data-form="add-member">
            <input name="name" list="names-all" placeholder="Name" required aria-label="Name">
            <div class="segmented role-pick" role="radiogroup" aria-label="Role">
              ${ROLES.map((r) => `
                <label><input type="radio" name="role" value="${r.id}"${r.id === (p.team.some((m) => m.role === 'first') ? 'coauthor' : 'first') ? ' checked' : ''}><span>${esc(r.label)}</span></label>`).join('')}
            </div>
            <button class="btn">Add</button>
          </form>
          <label class="field">Notes
            <textarea data-field="notes" rows="4" placeholder="Registration number, search dates, decisions…">${esc(p.notes)}</textarea>
          </label>
        </section>
        <section class="panel">
          <h2>Journal</h2>
          <label class="field">Target journal
            <input data-field="journal.target" value="${esc(p.journal.target)}" placeholder="e.g. BMJ Open">
          </label>
          ${p.stage === 'submitted' || p.journal.submittedOn || p.journal.revisionDue ? `
          <div class="row">
            <label class="field grow">Submitted on
              <input type="date" data-field="journal.submittedOn" value="${esc(p.journal.submittedOn)}">
            </label>
            <label class="field grow">Revision deadline
              <input type="date" data-field="journal.revisionDue" value="${esc(p.journal.revisionDue)}">
            </label>
          </div>` : '<p class="muted small">Submission date and revision deadline appear here once you move this paper to Submitted.</p>'}
        </section>
      </div>
      ${isSb() ? sharePanelHTML(p) : ''}
      ${namesDatalist('names-project', p)}
      ${namesDatalist('names-all')}`;
    if (isSb()) loadPeople(p.id);
  }

  // Removes projects from my dashboard: deletes the ones I own, leaves the ones shared with me.
  async function removeProjects(ids) {
    const targets = state.projects.filter((p) => ids.includes(p.id));
    const left = [];
    for (const p of targets) {
      if (ownsProject(p)) continue;
      const res = await sb.client.from('project_members').delete().eq('project_id', p.id).eq('user_id', myId());
      if (res.error) return notice("Couldn't remove a shared project", res.error.message || 'Try again in a moment.');
      left.push(p.id);
      sb.known.delete(p.id);
      delete sb.synced[p.id];
    }
    state.projects = state.projects.filter((p) => !ids.includes(p.id));
    state.tasks = state.tasks.filter((t) => !ids.includes(t.projectId));
    ui.selecting = false;
    ui.selected = new Set();
    commit();
    const n = targets.length;
    ui.flash = `Removed ${n} project${n === 1 ? '' : 's'} from your dashboard.`;
    route();
  }

  function confirmRemove(ids) {
    const targets = state.projects.filter((p) => ids.includes(p.id));
    if (!targets.length) return;
    const owned = targets.filter(ownsProject).length;
    const shared = targets.length - owned;
    const parts = [];
    if (owned) parts.push(`${owned} project${owned === 1 ? '' : 's'} you own will be deleted, with their tasks${isSb() ? ', for everyone you shared them with' : ''}.`);
    if (shared) parts.push(`You'll leave ${shared} shared project${shared === 1 ? '' : 's'}; the owner keeps ${shared === 1 ? 'it' : 'them'}.`);
    askDialog({
      title: `Remove ${targets.length} project${targets.length === 1 ? '' : 's'}?`,
      message: `${parts.join(' ')} This can't be undone.`,
      confirmLabel: 'Remove',
      danger: true,
    }).then((ok) => ok && (isSb() ? removeProjects(ids) : removeLocal(ids)));
  }

  function removeLocal(ids) {
    const n = state.projects.filter((p) => ids.includes(p.id)).length;
    state.projects = state.projects.filter((p) => !ids.includes(p.id));
    state.tasks = state.tasks.filter((t) => !ids.includes(t.projectId));
    ui.selecting = false;
    ui.selected = new Set();
    ui.flash = `Removed ${n} project${n === 1 ? '' : 's'} from your dashboard.`;
    commit();
  }

  // "Who" picker: the project's team first, then anyone else already given work, then "Someone else…".
  function ownerPicker(p, selected, name, id) {
    const team = ROLE_ORDER.slice(0, 3).flatMap((r) => p.team.filter((m) => m.role === r)).map((m) => m.name);
    const others = [...new Set(state.tasks.filter((t) => t.projectId === p.id && t.owner && !team.some((n) => sameName(n, t.owner))).map((t) => t.owner))];
    if (selected && !team.some((n) => sameName(n, selected)) && !others.some((n) => sameName(n, selected))) others.push(selected);
    const opt = (n) => `<option value="${esc(n)}"${sameName(n, selected) ? ' selected' : ''}>${esc(n)}</option>`;
    return `
      <select name="${name}" ${id ? `id="${id}"` : ''} class="owner-select" data-owner-select aria-label="Who is this task for">
        <option value="">${selected ? 'Unassigned' : 'Who? (unassigned)'}</option>
        ${team.length ? `<optgroup label="Project team">${team.map(opt).join('')}</optgroup>` : ''}
        ${others.length ? `<optgroup label="Others">${others.map(opt).join('')}</optgroup>` : ''}
        <option value="__other">Someone else…</option>
      </select>
      <input name="${name}_other" ${id ? `id="${id}-other"` : ''} class="owner-other" placeholder="Their name" aria-label="Their name" hidden>`;
  }

  function tasksByPerson(tasks) {
    const groups = new Map();
    for (const t of tasks) {
      const key = t.owner.trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, [t.owner.trim(), []]);
      groups.get(key)[1].push(t);
    }
    return [...groups.values()].sort((a, b) => (!a[0]) - (!b[0]) || a[0].localeCompare(b[0]));
  }

  // Gantt-style view of a project's open tasks: a bar from start to due, or a dot when there's only a due date.
  function taskGanttHTML(tasks) {
    const dated = tasks.filter((t) => t.due).sort((a, b) => (a.start || a.due).localeCompare(b.start || b.due) || a.due.localeCompare(b.due));
    if (!dated.length) return '';
    const t = today();
    let from = dated.reduce((m, x) => ((x.start || x.due) < m ? x.start || x.due : m), t);
    let to = dated.reduce((m, x) => (x.due > m ? x.due : m), addDays(t, 14));
    from = addDays(from, -1);
    to = addDays(to, 1);
    const span = Math.max(1, daysUntil(to, from));
    const pct = (iso) => Math.min(100, Math.max(0, (daysUntil(iso, from) / span) * 100));
    const step = span > 120 ? 28 : span > 49 ? 14 : 7;
    const ticks = [];
    for (let d = from; d <= to; d = addDays(d, step)) ticks.push(d);
    return `
      <div class="gantt" aria-label="Task timeline">
        <div class="gantt-row gantt-axis">
          <span class="gantt-label"></span>
          <div class="gantt-track">
            ${ticks.map((d) => `<span class="tick" style="left:${pct(d)}%">${esc(fmtShort(d))}</span>`).join('')}
            ${t >= from && t <= to ? `<span class="gantt-today" style="left:${pct(t)}%"></span>` : ''}
          </div>
        </div>
        ${dated.map((x) => {
          const late = x.due < t;
          const label = `${x.title}${x.owner ? ` (${x.owner})` : ''}: ${x.start ? `${fmtShort(x.start)} → ` : 'due '}${fmtShort(x.due)}`;
          return `
            <div class="gantt-row">
              <span class="gantt-label" title="${esc(x.title)}">${esc(x.title)}</span>
              <div class="gantt-track">
                ${t >= from && t <= to ? `<span class="gantt-today" style="left:${pct(t)}%"></span>` : ''}
                ${x.start
                  ? `<span class="gantt-bar${late ? ' is-late' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}" style="left:${pct(x.start)}%;width:${Math.max(1.5, pct(addDays(x.due, 1)) - pct(x.start))}%"></span>`
                  : `<span class="gantt-dot${late ? ' is-late' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}" style="left:${pct(x.due)}%"></span>`}
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  function editTask(task) {
    const p = findProject(task.projectId);
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <form class="modal meeting-form" role="dialog" aria-modal="true" aria-labelledby="task-edit-h" novalidate>
        <h2 id="task-edit-h">Edit task</h2>
        <label class="field">Task<input id="te-title" value="${esc(task.title)}" required></label>
        <label class="field">Who${p ? ownerPicker(p, task.owner, 'te_owner', 'te-owner') : `<input id="te-owner" value="${esc(task.owner)}">`}</label>
        <div class="row">
          <label class="field grow">Start (optional)<input id="te-start" type="date" value="${esc(task.start)}"></label>
          <label class="field grow">Due<input id="te-due" type="date" value="${esc(task.due)}"></label>
        </div>
        <p class="muted small">With a start and due date, the task shows as a bar on the calendar and timelines.</p>
        <p class="auth-error" id="te-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn" id="te-ics" ${task.due || task.start ? '' : 'disabled title="Add a date first"'}>Add to my calendar</button>
          <span class="grow"></span>
          <button type="button" class="btn" id="te-cancel">Cancel</button>
          <button class="btn primary">Save</button>
        </div>
      </form>`;
    const $ = (id) => wrap.querySelector(id);
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    $('#te-cancel').addEventListener('click', close);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    $('#te-ics').addEventListener('click', () => {
      const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
      const name = task.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'task';
      saveFile(`${name}.ics`, taskICS({ ...task, start: $('#te-start').value, due: $('#te-due').value || $('#te-start').value }, p ? p.title : '', now), 'text/calendar');
    });
    $('form').addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const title = $('#te-title').value.trim();
      const start = $('#te-start').value;
      const due = $('#te-due').value;
      const err = (m) => { $('#te-error').textContent = m; $('#te-error').hidden = false; };
      if (!title) return err('Give the task a name.');
      if (start && !due) return err('Add a due date as well, so the task has an end.');
      if (start && due && start > due) return err('The start date must be on or before the due date.');
      const pick = $('#te-owner');
      const owner = pick.value === '__other' ? $('#te-owner-other').value.trim() : pick.value.trim();
      Object.assign(task, { title, owner, start, due });
      if (p) touch(p);
      close();
      commit();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    $('#te-title').focus();
  }

  function sharePanelHTML(p) {
    const owner = ownsProject(p);
    return `
      <section class="panel share-panel">
        <div class="panel-head"><h2>Sharing</h2></div>
        <p class="panel-sub">${owner
          ? 'People you share with see this project on their own dashboard and can edit it. Your other projects stay private.'
          : 'This project was shared with you. Changes you make are saved for everyone on it.'}</p>
        <ul class="people" id="people-list"><li class="muted">Loading…</li></ul>
        ${owner ? `
          <form class="share-form" data-form="share">
            <input type="email" name="email" id="share-email" placeholder="Co-author's email address" required aria-label="Co-author's email address" autocomplete="off">
            <button class="btn primary">Share</button>
          </form>` : ''}
        <p class="share-msg" id="share-msg" role="status" hidden></p>
      </section>`;
  }

  function shareChip(p) {
    if (!isSb()) return '';
    if (!ownsProject(p)) return '<span class="share-chip">Shared with you</span>';
    const n = sb.shares[p.id] || 0;
    return n ? `<span class="share-chip">Shared with ${n}</span>` : '';
  }

  function initials(name) {
    return name.split(/\s+/).filter((w) => /\w/.test(w)).slice(-2).map((w) => w.replace(/\W/g, '')[0] || '').join('').toUpperCase();
  }

  // In-page dialog (the artifact viewer blocks alert/confirm/prompt).
  // Resolves the typed text, true for a plain confirmation, or null when cancelled.
  function askDialog(opts) {
    const o = Object.assign({ message: '', input: null, confirmLabel: 'OK', cancelLabel: 'Cancel', danger: false }, opts);
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `
        <form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h2 id="modal-title"></h2>
          <p class="modal-msg"></p>
          ${o.input ? '<input id="modal-input" name="value" autocomplete="off" required>' : ''}
          ${o.select ? `<label class="field">${esc(o.select.label)}<select id="modal-select">${o.select.options}</select></label>` : ''}
          <div class="modal-actions">
            ${o.cancelLabel ? '<button type="button" class="btn" data-modal="cancel"></button>' : ''}
            <button class="btn ${o.danger ? 'danger-solid' : 'primary'}" data-modal="ok"></button>
          </div>
        </form>`;
      wrap.querySelector('#modal-title').textContent = o.title;
      const msg = wrap.querySelector('.modal-msg');
      msg.textContent = o.message;
      msg.hidden = !o.message;
      wrap.querySelector('[data-modal="ok"]').textContent = o.confirmLabel;
      const cancelBtn = wrap.querySelector('[data-modal="cancel"]');
      if (cancelBtn) cancelBtn.textContent = o.cancelLabel;
      const input = wrap.querySelector('#modal-input');
      if (input) {
        input.placeholder = o.input.placeholder || '';
        input.setAttribute('aria-label', o.input.label || o.title);
      }
      const prev = document.activeElement;
      const close = (value) => {
        wrap.remove();
        document.removeEventListener('keydown', onKey, true);
        if (prev && prev.focus) prev.focus();
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(null);
        }
      };
      wrap.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = input ? input.value.trim() || null : true;
        const sel = wrap.querySelector('#modal-select');
        close(sel && text ? { text, choice: sel.value } : text);
      });
      if (cancelBtn) cancelBtn.addEventListener('click', () => close(null));
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(wrap);
      (input || wrap.querySelector('[data-modal="ok"]')).focus();
    });
  }

  function notice(title, message) {
    return askDialog({ title, message, cancelLabel: null });
  }

  function route() {
    hideTip();
    const hash = location.hash || '#/';
    const page = hash.replace(/^(#\/[a-z]*).*$/, '$1');
    if (ui.page && ui.page !== page) ui.search = '';
    ui.page = page;
    const m = hash.match(/^#\/project\/(.+)$/);
    if (ui.due) renderDue();
    if (m) renderProject(decodeURIComponent(m[1]));
    else if (hash === '#/projects') renderBoard();
    else if (hash === '#/people') renderPeople();
    else if (hash === '#/meetings') renderMeetings();
    else renderHome();
  }

  // ---------- Actions ----------

  function addOwner(p, name) {
    name = String(name || '').trim();
    if (!name || p.nextActionOwners.some((o) => sameName(o.name, name))) return;
    p.nextActionOwners.push({ name, done: false });
    touch(p);
    commit();
  }

  function currentProject() {
    const m = (location.hash || '').match(/^#\/project\/(.+)$/);
    return m ? findProject(decodeURIComponent(m[1])) : null;
  }

  function touch(p) {
    p.updatedAt = new Date().toISOString();
  }

  function commit() {
    save();
    route();
  }

  function onClick(e) {
    if (e.target.closest('[data-close-due]')) closeDue();
    const row = e.target.closest('tr[data-href]');
    if (row && !ui.selecting && !e.target.closest('a, button, input, label, [data-action]')) {
      location.hash = row.dataset.href;
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const p = currentProject();

    if (a === 'new-project') {
      askDialog({
        title: 'New project',
        input: { label: 'Project title', placeholder: 'e.g. Telehealth adoption in rural primary care' },
        select: { label: 'Study type', options: typeOptions(familyOf(ui.typeFilter) ? ui.typeFilter : '', false) },
        confirmLabel: 'Create project',
      }).then((res) => {
        if (!res) return;
        const np = newProject(res.text);
        np.studyType = TYPE_IDS.includes(res.choice) ? res.choice : '';
        if (state.me) np.team.push({ id: uid(), name: state.me, role: 'first', note: '' });
        state.projects.push(np);
        save();
        location.hash = `#/project/${np.id}`;
      });
    } else if (a === 'new-meeting') {
      meetingForm(null, el.dataset.date);
    } else if (a === 'edit-meeting' || a === 'delete-meeting' || a === 'ics-meeting' || a === 'skip-meeting') {
      const m = state.meetings.find((x) => x.id === el.dataset.id);
      if (!m) return;
      if (a === 'edit-meeting') meetingForm(m);
      else if (a === 'delete-meeting') deleteMeeting(m);
      else if (a === 'ics-meeting') downloadICS(m);
      else {
        askDialog({
          title: 'Cancel this date?',
          message: `“${m.title}” on ${fmtDate(el.dataset.date)} will be skipped. The other dates stay.`,
          confirmLabel: 'Cancel this date',
          cancelLabel: 'Keep it',
        }).then((ok) => {
          if (!ok) return;
          if (!m.skip.includes(el.dataset.date)) m.skip.push(el.dataset.date);
          commit();
        });
      }
    } else if (a === 'show-day') {
      e.preventDefault();
      e.stopPropagation();
      openDue({ kind: 'day', date: el.dataset.date, filtered: false });
    } else if (a === 'show-due') {
      openDue({ kind: el.dataset.kind, filtered: true });
    } else if (a === 'close-due') {
      closeDue();
    } else if (a === 'cal-day') {
      ui.calDay = el.dataset.date;
      ui.calMonth = el.dataset.date.slice(0, 7);
      route();
      openDue({ kind: 'day', date: el.dataset.date, filtered: true });
    } else if (a === 'cal-prev' || a === 'cal-next') {
      const m = parseISO(`${ui.calMonth || today().slice(0, 7)}-01`);
      m.setMonth(m.getMonth() + (a === 'cal-next' ? 1 : -1));
      ui.calMonth = toISO(m).slice(0, 7);
      route();
      const nav = document.querySelector(`[data-action="${a}"]`);
      if (nav) nav.focus();
    } else if (a === 'cal-today') {
      ui.calMonth = '';
      ui.calDay = '';
      route();
    } else if (a === 'set-type') {
      ui.typeFilter = el.dataset.type || 'all';
      route();
    } else if (a === 'set-mine') {
      ui.mineOnly = el.dataset.mine === '1' && !!state.me;
      route();
    } else if (a === 'toggle-task') {
      const t = state.tasks.find((x) => x.id === el.dataset.id);
      if (!t) return;
      t.done = !t.done;
      t.doneAt = t.done ? new Date().toISOString() : '';
      commit();
    } else if (a === 'task-group') {
      ui.taskGroup = el.dataset.group;
      route();
    } else if (a === 'task-for' && p) {
      ui.taskOwner = { pid: p.id, name: el.dataset.name };
      route();
      const title = document.querySelector('.add-task input[name="title"]');
      if (title) {
        title.scrollIntoView({ block: 'center', behavior: 'smooth' });
        title.focus();
        title.placeholder = `New task for ${el.dataset.name}`;
      }
    } else if (a === 'edit-task') {
      const task = state.tasks.find((x) => x.id === el.dataset.id);
      if (task) editTask(task);
    } else if (a === 'delete-task') {
      state.tasks = state.tasks.filter((x) => x.id !== el.dataset.id);
      commit();
    } else if (a === 'toggle-show-done' && p) {
      ui.showDone[p.id] = !ui.showDone[p.id];
      route();
    } else if (a === 'set-stage' && p) {
      p.stage = el.dataset.stage;
      if (p.stage === 'submitted' && !p.journal.submittedOn) p.journal.submittedOn = today();
      touch(p);
      commit();
    } else if (a === 'add-owner' && p) {
      addOwner(p, el.dataset.name);
    } else if (a === 'remove-owner' && p) {
      p.nextActionOwners.splice(Number(el.dataset.index), 1);
      touch(p);
      commit();
    } else if (a === 'next-done' && p) {
      p.nextAction = '';
      p.nextActionDue = '';
      p.nextActionOwners = [];
      touch(p);
      commit();
      const input = document.querySelector('[data-field="nextAction"]');
      if (input) input.focus();
    } else if (a === 'remove-member' && p) {
      p.team = p.team.filter((m) => m.id !== el.dataset.id);
      touch(p);
      commit();
    } else if (a === 'delete-project' && p) {
      const n = state.tasks.filter((t) => t.projectId === p.id).length;
      askDialog({
        title: 'Delete this project?',
        message: `“${p.title}” and its ${n} task${n === 1 ? '' : 's'} will be removed. This can't be undone.`,
        confirmLabel: 'Delete project',
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        state.projects = state.projects.filter((x) => x.id !== p.id);
        state.tasks = state.tasks.filter((t) => t.projectId !== p.id);
        save();
        location.hash = '#/projects';
      });
    } else if (a === 'unshare' && p) {
      const who = el.dataset.email;
      askDialog({
        title: 'Stop sharing?',
        message: `${who} will no longer see “${p.title}” on their dashboard.`,
        confirmLabel: 'Stop sharing',
        danger: true,
      }).then((ok) => ok && unshare(p, el.dataset.user, who));
    } else if (a === 'leave-project' && p) {
      askDialog({
        title: 'Leave this project?',
        message: `“${p.title}” will disappear from your dashboard. The owner can share it with you again.`,
        confirmLabel: 'Leave project',
        danger: true,
      }).then((ok) => ok && leaveProject(p));
    } else if (a === 'proj-view') {
      ui.projView = el.dataset.view;
      writePref('rpt-view', ui.projView);
      route();
    } else if (a === 'people-view') {
      ui.peopleView = el.dataset.view;
      route();
    } else if (a === 'clear-search') {
      ui.search = '';
      route();
    } else if (a === 'toggle-select') {
      ui.selecting = !ui.selecting;
      ui.selected = new Set();
      route();
    } else if (a === 'select-all') {
      ui.selected = new Set(state.projects.filter((x) => matchesType(x, ui.typeFilter)).map((x) => x.id));
      route();
    } else if (a === 'remove-selected') {
      confirmRemove([...(ui.selected || [])]);
    } else if (a === 'check-invites') {
      el.disabled = true;
      loadInvites().then(() => route());
    } else if (a === 'accept-invite' || a === 'decline-invite') {
      el.disabled = true;
      respondInvite(el.dataset.pid, a === 'accept-invite');
    } else if (a === 'sign-out') {
      signOut();
    } else if (a === 'export') {
      exportData();
    } else if (a === 'import') {
      document.getElementById('import-file').click();
    }
  }

  // Field edits save in place without re-rendering, so focus isn't lost while moving between inputs.
  function onChange(e) {
    const el = e.target;
    if (el.matches && el.matches('[data-owner-select]')) {
      const other = el.parentElement.querySelector('.owner-other');
      if (other) {
        other.hidden = el.value !== '__other';
        if (!other.hidden) other.focus();
      }
      return;
    }
    if (el.dataset.select) {
      ui.selected = ui.selected || new Set();
      if (el.checked) ui.selected.add(el.dataset.select);
      else ui.selected.delete(el.dataset.select);
      route();
      return;
    }
    if (el.dataset.ownerDone !== undefined) {
      const p = currentProject();
      const o = p && p.nextActionOwners[Number(el.dataset.ownerDone)];
      if (!o) return;
      o.done = el.checked;
      touch(p);
      commit();
      return;
    }
    if (el.dataset.memberRole) {
      const p = currentProject();
      const m = p && p.team.find((x) => x.id === el.dataset.memberRole);
      if (!m) return;
      m.role = roleFrom(el.value);
      touch(p);
      commit();
      return;
    }
    if (el.dataset.setting === 'type-filter') {
      ui.typeFilter = el.value;
      route();
      return;
    }
    if (el.dataset.setting === 'me') {
      state.me = el.value.trim();
      if (!state.me) ui.mineOnly = false;
      commit();
      return;
    }
    const field = el.dataset.field;
    const p = currentProject();
    if (!field || !p) return;
    const value = field === 'notes' ? el.value : el.value.trim();
    if (field === 'studyType') {
      p.studyType = el.value;
      touch(p);
      commit();
      return;
    }
    if (field === 'title') {
      p.title = value || 'Untitled project';
      el.value = p.title;
    } else if (field.startsWith('journal.')) {
      p.journal[field.slice(8)] = value;
    } else {
      p[field] = value;
    }
    touch(p);
    save();
  }

  function onSubmit(e) {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const p = currentProject();
    if (!p) return;
    const f = new FormData(form);
    if (form.dataset.form === 'add-task') {
      const title = String(f.get('title') || '').trim();
      if (!title) return;
      const owner = f.get('owner') === '__other' ? String(f.get('owner_other') || '').trim() : String(f.get('owner') || '').trim();
      state.tasks.push(newTask(p.id, title, owner, String(f.get('due') || ''), String(f.get('start') || '')));
      ui.taskOwner = owner ? { pid: p.id, name: owner } : null; // keep adding for the same person
    } else if (form.dataset.form === 'share') {
      const email = String(f.get('email') || '').trim();
      if (email) shareProject(p, email).then(() => { form.reset(); });
      return;
    } else if (form.dataset.form === 'add-owner') {
      addOwner(p, f.get('name'));
      const input = document.querySelector('[data-form="add-owner"] input');
      if (input) input.focus();
      return;
    } else if (form.dataset.form === 'add-member') {
      const name = String(f.get('name') || '').trim();
      if (!name) return;
      if (!p.team.some((m) => sameName(m.name, name))) {
        p.team.push({ id: uid(), name, role: roleFrom(f.get('role')), note: '' });
      }
    }
    touch(p);
    commit();
    const first = document.querySelector(`[data-form="${form.dataset.form}"] input`);
    if (first) first.focus();
  }

  async function exportData() {
    const data = JSON.stringify({ ...state, projects: state.projects.map(({ ownerId, ...p }) => p) }, null, 2);
    saveFile(`research-projects-${today()}.json`, data, 'application/json');
  }

  async function saveFile(filename, data, type) {
    const downloads = await capability('downloads');
    if (downloads) {
      try {
        await downloads.save({ filename, data });
      } catch (e) {
        if (!e || e.code !== 'declined') notice("Couldn't save the file", 'The download was blocked here. Try again in a moment.');
      }
      return;
    }
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (err) {
        notice("Couldn't import that file", 'It isn\'t a valid JSON file. Choose a file made with Export backup.');
        return;
      }
      if (!data || !Array.isArray(data.projects)) {
        notice("Couldn't import that file", "It doesn't contain any projects. Choose a file made with Export backup.");
        return;
      }
      if (isSb()) {
        // Adds to what's already in the account; nothing is replaced.
        const add = normalizeState(remapIds(data));
        state.projects.push(...add.projects);
        state.tasks.push(...add.tasks);
        if (!state.me && data.me) state.me = String(data.me);
        for (const m of normalizeMeetings(data.meetings)) {
          if (!state.meetings.some((x) => x.id === m.id)) state.meetings.push(m);
        }
        commit();
        notice('Projects imported', `Added ${add.projects.length} project${add.projects.length === 1 ? '' : 's'} to your dashboard.`);
        return;
      }
      const apply = () => {
        state = normalizeState(data);
        commit();
      };
      if (!state.projects.length) return apply();
      askDialog({
        title: 'Replace your projects?',
        message: `Importing replaces all ${state.projects.length} current projects with the ${data.projects.length} in this file.`,
        confirmLabel: 'Replace projects',
        danger: true,
      }).then((ok) => ok && apply());
    };
    reader.readAsText(file);
  }

  function onSearchInput(e) {
    const el = e.target;
    if (el.id !== 'project-search' && el.id !== 'people-search') return;
    ui.search = el.value;
    const pos = el.selectionStart;
    route();
    const again = document.getElementById(el.id);
    if (again) {
      again.focus();
      again.setSelectionRange(pos, pos);
    }
  }

  function init() {
    state = load();
    document.getElementById('storage-warning').hidden = storageOk;
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('input', onSearchInput);
    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importData(file);
      e.target.value = '';
    });
    window.addEventListener('hashchange', route);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && cloud.timer) flushCloud();
    });
    const tipTarget = (e) => e.target.closest && e.target.closest('[data-tip]');
    document.addEventListener('pointerover', (e) => { const el = tipTarget(e); if (el) showTip(el); });
    document.addEventListener('pointerout', (e) => { if (tipTarget(e)) hideTip(); });
    document.addEventListener('focusin', (e) => { const el = tipTarget(e); if (el) showTip(el); else hideTip(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideTip();
        if (ui.due && !document.querySelector('.modal-backdrop:not(#due-dialog)')) closeDue();
      }
      const b = e.target.closest && e.target.closest('[role="button"][data-action]');
      if (b && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        b.click();
      }
    });
    window.addEventListener('scroll', hideTip, { passive: true });
    window.addEventListener('focus', refreshFromServer);
    window.addEventListener('beforeunload', (e) => {
      if (isSb() && hasUnsavedChanges()) {
        flushServer();
        e.preventDefault();
        e.returnValue = '';
      }
    });
    if (sbConfigured) {
      document.getElementById('storage-warning').hidden = true;
      startSupabase();
      return;
    }
    authEl().hidden = true;
    shellEl().hidden = false;
    route();
    if (cloud.pending) connectCloud();
  }

  // Installed-app support (offline shell). Only on the hosted site, never inside Claude or a file.
  // A new version takes over as soon as it's published: check on open and whenever the app comes back
  // to the foreground, and reload once when the new version activates.
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !hasHost()) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) {
        reloaded = true;
        location.reload();
      }
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      }).catch(() => {});
    });
  }

  function showVersion() {
    const meta = document.querySelector('meta[name="app-version"]');
    const el = document.getElementById('app-version');
    if (meta && el && meta.content !== 'dev') el.textContent = `Version ${meta.content}`;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showVersion);
  else showVersion();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
