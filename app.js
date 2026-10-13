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
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
      nextActionOwner: '',
      nextActionDue: '',
      journal: { target: '', submittedOn: '', revisionDue: '' },
      notes: '',
      createdAt: now,
      updatedAt: now,
    };
  }

  function newTask(projectId, title, owner, due) {
    return { id: uid(), projectId, title, owner: owner || '', due: due || '', done: false, doneAt: '' };
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
            .map((m) => ({ id: m.id ? String(m.id) : uid(), name: str(m.name).trim(), role: str(m.role) })),
          nextAction: str(p.nextAction),
          nextActionOwner: str(p.nextActionOwner),
          nextActionDue: date(p.nextActionDue),
          journal: { target: str(j.target), submittedOn: date(j.submittedOn), revisionDue: date(j.revisionDue) },
          notes: str(p.notes),
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
        due: date(t.due),
        done: !!t.done,
        doneAt: str(t.doneAt),
      }));
    return { version: 1, me: str(src.me), projects, tasks };
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
      items.push({ kind: 'task', id: t.id, projectId: p.id, project: p.title, title: t.title, owner: t.owner, due: t.due, days: daysUntil(t.due, today) });
    }
    for (const p of state.projects) {
      if (p.nextAction.trim() && p.nextActionDue && keep(p.nextActionOwner)) {
        items.push({ kind: 'next', id: p.id, projectId: p.id, project: p.title, title: p.nextAction, owner: p.nextActionOwner, due: p.nextActionDue, days: daysUntil(p.nextActionDue, today) });
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

  function exampleState(today) {
    const a = newProject('Exercise interventions for chronic low back pain: systematic review');
    Object.assign(a, {
      stage: 'screening',
      studyType: 'systematic-review',
      team: [
        { id: uid(), name: 'You', role: 'Lead author' },
        { id: uid(), name: 'Dr. Patel', role: 'Supervisor' },
        { id: uid(), name: 'Sam Lee', role: 'Second screener' },
      ],
      nextAction: 'Finish full-text screening',
      nextActionOwner: 'You',
      nextActionDue: addDays(today, 3),
      journal: { target: 'BMJ Open', submittedOn: '', revisionDue: '' },
      notes: 'PROSPERO registered. 412 records after deduplication.',
    });
    const b = newProject('Telehealth adoption in rural primary care: scoping review');
    Object.assign(b, {
      stage: 'writing',
      studyType: 'scoping-review',
      team: [
        { id: uid(), name: 'You', role: 'Lead author' },
        { id: uid(), name: 'Dr. Patel', role: 'Supervisor' },
      ],
      nextAction: 'Send draft to supervisor',
      nextActionOwner: 'You',
      nextActionDue: addDays(today, -1),
      journal: { target: 'Journal of Telemedicine and Telecare', submittedOn: '', revisionDue: '' },
    });
    const c = newProject('Sleep quality in shift-working nurses: meta-analysis');
    Object.assign(c, {
      stage: 'submitted',
      studyType: 'meta-analysis',
      team: [
        { id: uid(), name: 'You', role: 'Co-author' },
        { id: uid(), name: 'Maria Gomez', role: 'Lead author' },
      ],
      nextAction: 'Respond to reviewer 2 comments',
      nextActionOwner: 'Maria Gomez',
      nextActionDue: '',
      journal: { target: 'Sleep Medicine', submittedOn: addDays(today, -60), revisionDue: addDays(today, 10) },
    });
    const d = newProject('Digital mental health apps for adolescents');
    d.stage = 'idea';
    d.studyType = 'qualitative';
    const e = newProject('Burnout among ICU nurses: national survey');
    Object.assign(e, {
      stage: 'screening',
      studyType: 'cross-sectional',
      team: [
        { id: uid(), name: 'You', role: 'Lead author' },
        { id: uid(), name: 'Sam Lee', role: 'Statistician' },
      ],
      nextAction: 'Send survey reminder to participating units',
      nextActionOwner: 'You',
      nextActionDue: addDays(today, 4),
      journal: { target: 'Intensive and Critical Care Nursing', submittedOn: '', revisionDue: '' },
      notes: 'Ethics approved. Target sample 600; 342 responses so far.',
    });
    return {
      version: 1,
      me: 'You',
      projects: [a, b, c, d, e],
      tasks: [
        newTask(a.id, 'Resolve screening conflicts with Sam', 'You', addDays(today, 5)),
        newTask(a.id, 'Pilot the extraction form', 'Sam Lee', addDays(today, 12)),
        newTask(a.id, 'Run database searches', 'You', addDays(today, -30)),
        newTask(b.id, 'Update PRISMA-ScR flow diagram', 'You', addDays(today, 2)),
        newTask(b.id, 'Check reference formatting', '', ''),
        newTask(c.id, 'Re-run sensitivity analysis', 'You', addDays(today, 6)),
        newTask(e.id, 'Draft statistical analysis plan', 'Sam Lee', addDays(today, 9)),
      ].map((t, i) => (i === 2 ? { ...t, done: true, doneAt: new Date().toISOString() } : t)),
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { STAGES, STUDY_TYPES, stageLabel, stageLabelFor, filterByType, typeCounts, attention, deadlines, dashboardStats, normalizeState, addDays, daysUntil, newProject, newTask, exampleState };
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

  // Account sync: the whole tracker is one private document per person.
  const cloud = { ref: null, pending: hasHost(), timer: null, saving: false, again: false };

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
    saveLocal();
    queueCloudSave();
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
  const ui = { mineOnly: false, showDone: {}, typeFilter: 'all' };

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
    return `<span class="due ${cls}" title="${esc(fmtDate(iso))}">${esc(d <= REVISION_WINDOW_DAYS ? relDays(d) : fmtDate(iso))}</span>`;
  }

  const stagePill = (id, typeId) => `<span class="pill">${esc(stageLabel(id, typeId))}</span>`;

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

  function tile(label, value, sub, mod, icon) {
    return `
      <div class="tile ${mod || ''}">
        <div class="tile-label">${icon ? ICON[icon] : ''}${esc(label)}</div>
        <div class="tile-value">${esc(value)}</div>
        <div class="tile-sub">${sub}</div>
      </div>`;
  }

  // One lane per project; overdue items collapse into a band left of "today".
  function timelineHTML(items, t) {
    const inRange = items.filter((i) => i.days <= TIMELINE_DAYS);
    if (!inRange.length) return `<p class="muted">No deadlines in the next ${TIMELINE_DAYS} days.</p>`;
    const OVERDUE_W = 9; // % of the track reserved for the overdue band
    const x = (days) => (days < 0 ? OVERDUE_W / 2 : OVERDUE_W + 2 + (days / TIMELINE_DAYS) * (98 - OVERDUE_W - 2));

    const lanes = new Map();
    for (const i of inRange) {
      if (!lanes.has(i.projectId)) lanes.set(i.projectId, { project: i.project, id: i.projectId, groups: new Map() });
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
      return `
        <div class="lane">
          <a class="lane-label" href="#/project/${esc(lane.id)}" title="${esc(lane.project)}">${esc(lane.project)}</a>
          <div class="lane-track">${dots}</div>
        </div>`;
    }).join('');

    return `
      <div class="legend" aria-hidden="true">
        <span><i class="key key-task"></i>Task</span>
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
        <section class="empty">
          <h1>Where does every paper stand?</h1>
          <p>Track each project from idea to submission: its stage, team, next action, deadlines and target journal.</p>
          <div class="row center">
            <button class="btn primary" data-action="new-project">Create your first project</button>
            <button class="btn" data-action="load-example">Load example projects</button>
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
          <td class="cell-project"><a href="#/project/${esc(p.id)}">${esc(p.title)}</a></td>
          <td>${typeBadge(p.studyType)}</td>
          <td>${stageMeter(p.stage, p.studyType)}</td>
          <td>${p.nextAction ? esc(p.nextAction) : '<span class="muted">Not set</span>'}${p.nextActionOwner ? `<div class="meta">${esc(p.nextActionOwner)}</div>` : ''}</td>
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

      <section class="tiles" aria-label="Summary">
        ${tile('Active projects', st.activeCount, `${st.submittedCount} submitted · under review`)}
        ${tile('Overdue', st.overdueCount, st.overdueCount ? 'Past their due date' : 'Nothing overdue', st.overdueCount ? 'tile-critical' : 'tile-good', st.overdueCount ? 'alert' : 'check')}
        ${tile('Due in 7 days', st.dueSoonCount, `Through ${esc(fmtDate(addDays(t, WEEK_DAYS)))}`)}
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
    const shown = state.projects.filter((p) => matchesType(p, ui.typeFilter));
    const cols = STAGES.map((s) => {
      const ps = shown.filter((p) => p.stage === s.id);
      return `
        <section class="column">
          <h2>${stageNameHTML(s.id, shown)} <span class="count">${ps.length}</span></h2>
          ${ps.map((p) => {
            const open = openTasks(p.id).length;
            return `
              <a class="card" href="#/project/${esc(p.id)}">
                <div class="card-title">${esc(p.title)}</div>
                <div class="card-type">${typeBadge(p.studyType)}</div>
                ${p.journal.target ? `<div class="meta">→ ${esc(p.journal.target)}</div>` : ''}
                <div class="card-next">${p.nextAction ? `<strong>Next:</strong> ${esc(p.nextAction)}` : '<span class="muted">No next action</span>'}</div>
                <div class="card-foot">
                  <span class="meta">${open} open task${open === 1 ? '' : 's'}</span>
                  ${dueBadge(p.nextActionDue)}
                </div>
              </a>`;
          }).join('') || '<p class="muted small">—</p>'}
        </section>`;
    }).join('');
    app().innerHTML = `
      <header class="page-head">
        <h1>Projects</h1>
        <div class="row">
          ${typeFilterControl()}
          <button class="btn primary" data-action="new-project">+ New project</button>
        </div>
      </header>
      <div class="board">${cols}</div>`;
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
          ${t.owner ? `<div class="meta">${esc(t.owner)}</div>` : ''}
        </div>
        ${t.done ? '' : dueBadge(t.due)}
        <button class="icon-btn" data-action="delete-task" data-id="${esc(t.id)}" aria-label="Delete task" title="Delete task">×</button>
      </li>`;

    app().innerHTML = `
      <p><a href="#/projects">← All projects</a></p>
      <header class="page-head">
        <input class="title-input" data-field="title" value="${esc(p.title)}" aria-label="Project title">
        <button class="btn danger" data-action="delete-project" data-id="${esc(p.id)}">Delete</button>
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
          <div class="row">
            <label class="field grow">Who
              <input data-field="nextActionOwner" list="names-project" value="${esc(p.nextActionOwner)}" placeholder="Name">
            </label>
            <label class="field">By
              <input type="date" data-field="nextActionDue" value="${esc(p.nextActionDue)}">
            </label>
          </div>
          ${p.nextAction ? `<button class="btn small" data-action="next-done">Done — clear it</button>` : ''}
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

      <div class="grid-2">
        <section class="panel">
          <h2>Tasks <span class="count">${open.length} open</span></h2>
          <form class="add-task" data-form="add-task">
            <input name="title" placeholder="New task" required aria-label="Task">
            <input name="owner" list="names-project" placeholder="Who" aria-label="Owner">
            <input name="due" type="date" aria-label="Due date">
            <button class="btn primary">Add</button>
          </form>
          ${open.length ? `<ul class="items">${open.map(taskRow).join('')}</ul>` : '<p class="muted">No open tasks.</p>'}
          ${done.length ? `
            <button class="link-btn" data-action="toggle-show-done">${ui.showDone[p.id] ? 'Hide' : 'Show'} ${done.length} completed</button>
            ${ui.showDone[p.id] ? `<ul class="items">${done.map(taskRow).join('')}</ul>` : ''}` : ''}
        </section>

        <section class="panel">
          <h2>Team</h2>
          ${p.team.length ? `<ul class="team">${p.team.map((m) => `
            <li>
              <span class="avatar" aria-hidden="true">${esc(initials(m.name))}</span>
              <span class="grow"><strong>${esc(m.name)}</strong>${m.role ? ` <span class="muted">· ${esc(m.role)}</span>` : ''}
                <span class="meta">${openTasks(p.id).filter((t) => sameName(t.owner, m.name)).length} open tasks</span></span>
              <button class="icon-btn" data-action="remove-member" data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}" title="Remove">×</button>
            </li>`).join('')}</ul>` : '<p class="muted">No co-authors yet.</p>'}
          <form class="add-member" data-form="add-member">
            <input name="name" list="names-all" placeholder="Name" required aria-label="Name">
            <input name="role" placeholder="Role (e.g. Second screener)" aria-label="Role">
            <button class="btn">Add</button>
          </form>
          <label class="field">Notes
            <textarea data-field="notes" rows="4" placeholder="Registration number, search dates, decisions…">${esc(p.notes)}</textarea>
          </label>
        </section>
      </div>
      ${namesDatalist('names-project', p)}
      ${namesDatalist('names-all')}`;
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
    const m = hash.match(/^#\/project\/(.+)$/);
    if (m) renderProject(decodeURIComponent(m[1]));
    else if (hash === '#/projects') renderBoard();
    else renderHome();
  }

  // ---------- Actions ----------

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
        if (state.me) np.team.push({ id: uid(), name: state.me, role: 'Lead author' });
        state.projects.push(np);
        save();
        location.hash = `#/project/${np.id}`;
      });
    } else if (a === 'load-example') {
      state = normalizeState(exampleState(today()));
      commit();
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
    } else if (a === 'next-done' && p) {
      p.nextAction = '';
      p.nextActionDue = '';
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
    } else if (a === 'export') {
      exportData();
    } else if (a === 'import') {
      document.getElementById('import-file').click();
    }
  }

  // Field edits save in place without re-rendering, so focus isn't lost while moving between inputs.
  function onChange(e) {
    const el = e.target;
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
      state.tasks.push(newTask(p.id, title, String(f.get('owner') || '').trim(), String(f.get('due') || '')));
    } else if (form.dataset.form === 'add-member') {
      const name = String(f.get('name') || '').trim();
      if (!name) return;
      if (!p.team.some((m) => sameName(m.name, name))) {
        p.team.push({ id: uid(), name, role: String(f.get('role') || '').trim() });
      }
    }
    touch(p);
    commit();
    const first = document.querySelector(`[data-form="${form.dataset.form}"] input`);
    if (first) first.focus();
  }

  async function exportData() {
    const data = JSON.stringify(state, null, 2);
    const filename = `research-projects-${today()}.json`;
    const downloads = await capability('downloads');
    if (downloads) {
      try {
        await downloads.save({ filename, data });
      } catch (e) {
        if (!e || e.code !== 'declined') notice("Couldn't export", 'The download was blocked here. Try again in a moment.');
      }
      return;
    }
    const blob = new Blob([data], { type: 'application/json' });
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

  function init() {
    state = load();
    document.getElementById('storage-warning').hidden = storageOk;
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
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
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
    window.addEventListener('scroll', hideTip, { passive: true });
    route();
    if (cloud.pending) connectCloud();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
