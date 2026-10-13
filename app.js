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

  function stageLabel(id) {
    const s = STAGES.find((x) => x.id === id);
    return s ? s.label : id;
  }

  function newProject(title) {
    const now = new Date().toISOString();
    return {
      id: uid(),
      title: title || 'Untitled project',
      stage: 'idea',
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

  // The home screen: everything due within a week (or overdue), revision deadlines
  // within two weeks, and active projects that have no next action written down.
  function attention(state, today, opts) {
    const mineOnly = !!(opts && opts.mineOnly && state.me);
    const keep = (owner) => !mineOnly || sameName(owner, state.me);
    const byId = new Map(state.projects.map((p) => [p.id, p]));
    const items = [];

    for (const t of state.tasks) {
      if (t.done || !t.due || !keep(t.owner)) continue;
      const p = byId.get(t.projectId);
      if (!p) continue;
      const days = daysUntil(t.due, today);
      if (days <= WEEK_DAYS) {
        items.push({ kind: 'task', id: t.id, projectId: p.id, project: p.title, title: t.title, owner: t.owner, due: t.due, days });
      }
    }

    for (const p of state.projects) {
      if (p.nextAction.trim() && p.nextActionDue && keep(p.nextActionOwner)) {
        const days = daysUntil(p.nextActionDue, today);
        if (days <= WEEK_DAYS) {
          items.push({ kind: 'next', id: p.id, projectId: p.id, project: p.title, title: p.nextAction, owner: p.nextActionOwner, due: p.nextActionDue, days });
        }
      }
      if (p.stage === 'submitted' && p.journal.revisionDue && !mineOnly) {
        const days = daysUntil(p.journal.revisionDue, today);
        if (days <= REVISION_WINDOW_DAYS) {
          const where = p.journal.target ? ` for ${p.journal.target}` : '';
          items.push({ kind: 'revision', id: p.id, projectId: p.id, project: p.title, title: `Revisions due${where}`, owner: '', due: p.journal.revisionDue, days });
        }
      }
    }

    items.sort((a, b) => a.days - b.days || a.project.localeCompare(b.project));
    const noNextAction = mineOnly
      ? []
      : state.projects.filter((p) => p.stage !== 'submitted' && !p.nextAction.trim());

    return {
      overdue: items.filter((i) => i.days < 0),
      upcoming: items.filter((i) => i.days >= 0),
      noNextAction,
    };
  }

  function exampleState(today) {
    const a = newProject('Exercise interventions for chronic low back pain: systematic review');
    Object.assign(a, {
      stage: 'screening',
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
    return {
      version: 1,
      me: 'You',
      projects: [a, b, c, d],
      tasks: [
        newTask(a.id, 'Resolve screening conflicts with Sam', 'You', addDays(today, 5)),
        newTask(a.id, 'Pilot the extraction form', 'Sam Lee', addDays(today, 12)),
        newTask(a.id, 'Run database searches', 'You', addDays(today, -30)),
        newTask(b.id, 'Update PRISMA-ScR flow diagram', 'You', addDays(today, 2)),
        newTask(b.id, 'Check reference formatting', '', ''),
        newTask(c.id, 'Re-run sensitivity analysis', 'You', addDays(today, 6)),
      ].map((t, i) => (i === 2 ? { ...t, done: true, doneAt: new Date().toISOString() } : t)),
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { STAGES, attention, normalizeState, addDays, daysUntil, newProject, newTask, exampleState };
  }
  if (typeof document === 'undefined') return;

  // ---------- Storage ----------

  let state;
  let storageOk = true;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return normalizeState(raw ? JSON.parse(raw) : null);
    } catch (e) {
      storageOk = false;
      return normalizeState(null);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
    document.getElementById('storage-warning').hidden = storageOk;
  }

  // ---------- Rendering helpers ----------

  const app = () => document.getElementById('app');
  const today = () => toISO(new Date());
  const ui = { mineOnly: false, showDone: {} };

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

  const stagePill = (id) => `<span class="pill stage-${esc(id)}">${esc(stageLabel(id))}</span>`;
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

  function renderHome() {
    setNav('home');
    const t = today();
    const att = attention(state, t, { mineOnly: ui.mineOnly });
    const end = addDays(t, WEEK_DAYS);

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

    const item = (i) => `
      <li class="item ${i.days < 0 ? 'is-overdue' : ''}">
        ${i.kind === 'task'
          ? `<input type="checkbox" class="check" data-action="toggle-task" data-id="${esc(i.id)}" aria-label="Mark done">`
          : `<span class="kind kind-${i.kind}">${i.kind === 'next' ? 'Next' : 'Rev'}</span>`}
        <div class="item-body">
          <div class="item-title">${esc(i.title)}</div>
          <div class="meta">
            <a href="#/project/${esc(i.projectId)}">${esc(i.project)}</a>
            ${i.owner ? `<span>· ${esc(i.owner)}</span>` : ''}
          </div>
        </div>
        ${dueBadge(i.due)}
      </li>`;

    const section = (title, list, emptyText) => `
      <section class="panel">
        <h2>${title} <span class="count">${list.length}</span></h2>
        ${list.length ? `<ul class="items">${list.map(item).join('')}</ul>` : `<p class="muted">${emptyText}</p>`}
      </section>`;

    const overview = state.projects
      .slice()
      .sort((a, b) => STAGE_IDS.indexOf(a.stage) - STAGE_IDS.indexOf(b.stage) || a.title.localeCompare(b.title))
      .map((p) => `
        <tr>
          <td><a href="#/project/${esc(p.id)}">${esc(p.title)}</a>${p.journal.target ? `<div class="meta">${esc(p.journal.target)}</div>` : ''}</td>
          <td>${stagePill(p.stage)}</td>
          <td>${p.nextAction ? esc(p.nextAction) : '<span class="muted">—</span>'}${p.nextActionOwner ? `<div class="meta">${esc(p.nextActionOwner)}</div>` : ''}</td>
          <td>${dueBadge(p.nextActionDue)}</td>
          <td class="num">${openTasks(p.id).length}</td>
        </tr>`)
      .join('');

    app().innerHTML = `
      <header class="page-head">
        <div>
          <h1>What needs my attention this week?</h1>
          <p class="muted">${esc(fmtDate(t))} – ${esc(fmtDate(end))}</p>
        </div>
        <div class="row">
          <label class="field-inline">I am
            <input list="names-all" data-setting="me" value="${esc(state.me)}" placeholder="Your name" size="12">
          </label>
          ${namesDatalist('names-all')}
          <label class="toggle ${state.me ? '' : 'disabled'}" title="${state.me ? '' : 'Enter your name first'}">
            <input type="checkbox" data-action="toggle-mine" ${ui.mineOnly ? 'checked' : ''} ${state.me ? '' : 'disabled'}> Only mine
          </label>
        </div>
      </header>
      <div class="grid-2">
        ${section('Overdue', att.overdue, 'Nothing overdue.')}
        ${section('Due soon', att.upcoming, 'Nothing due this week.')}
      </div>
      ${att.noNextAction.length ? `
        <section class="panel">
          <h2>Projects without a next action <span class="count">${att.noNextAction.length}</span></h2>
          <ul class="items">${att.noNextAction.map((p) => `
            <li class="item">
              <span class="kind kind-none">?</span>
              <div class="item-body"><a href="#/project/${esc(p.id)}">${esc(p.title)}</a></div>
              ${stagePill(p.stage)}
            </li>`).join('')}
          </ul>
        </section>` : ''}
      <section class="panel">
        <h2>All projects</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Project</th><th>Stage</th><th>Next action</th><th>Due</th><th class="num">Open tasks</th></tr></thead>
            <tbody>${overview}</tbody>
          </table>
        </div>
      </section>`;
  }

  function renderBoard() {
    setNav('projects');
    const cols = STAGES.map((s) => {
      const ps = state.projects.filter((p) => p.stage === s.id);
      return `
        <section class="column">
          <h2>${stagePill(s.id)} <span class="count">${ps.length}</span></h2>
          ${ps.map((p) => {
            const open = openTasks(p.id).length;
            return `
              <a class="card" href="#/project/${esc(p.id)}">
                <div class="card-title">${esc(p.title)}</div>
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
        <button class="btn primary" data-action="new-project">+ New project</button>
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

      <ol class="stepper" aria-label="Stage">
        ${STAGES.map((s, i) => `
          <li class="${i < idx ? 'past' : i === idx ? 'current' : ''}">
            <button data-action="set-stage" data-stage="${s.id}" ${i === idx ? 'aria-current="step"' : ''}>${esc(s.label)}</button>
          </li>`).join('')}
      </ol>
      ${next ? `<p><button class="btn" data-action="set-stage" data-stage="${next.id}">Move to ${esc(next.label)} →</button></p>` : ''}

      <div class="grid-2">
        <section class="panel">
          <h2>Next action</h2>
          <label class="field">What's the very next step?
            <input data-field="nextAction" value="${esc(p.nextAction)}" placeholder="e.g. Finish full-text screening">
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
          <div class="row">
            <label class="field grow">Submitted on
              <input type="date" data-field="journal.submittedOn" value="${esc(p.journal.submittedOn)}">
            </label>
            <label class="field grow">Revision deadline
              <input type="date" data-field="journal.revisionDue" value="${esc(p.journal.revisionDue)}">
            </label>
          </div>
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

  function route() {
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
      const title = prompt('Project title');
      if (!title || !title.trim()) return;
      const np = newProject(title.trim());
      if (state.me) np.team.push({ id: uid(), name: state.me, role: 'Lead author' });
      state.projects.push(np);
      save();
      location.hash = `#/project/${np.id}`;
    } else if (a === 'load-example') {
      state = normalizeState(exampleState(today()));
      commit();
    } else if (a === 'toggle-mine') {
      ui.mineOnly = el.checked;
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
      if (!confirm(`Delete “${p.title}” and its tasks? This can't be undone.`)) return;
      state.projects = state.projects.filter((x) => x.id !== p.id);
      state.tasks = state.tasks.filter((t) => t.projectId !== p.id);
      save();
      location.hash = '#/projects';
    } else if (a === 'export') {
      exportData();
    } else if (a === 'import') {
      document.getElementById('import-file').click();
    }
  }

  // Field edits save in place without re-rendering, so focus isn't lost while moving between inputs.
  function onChange(e) {
    const el = e.target;
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

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-projects-${today()}.json`;
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
        alert('That file is not valid JSON.');
        return;
      }
      if (!data || !Array.isArray(data.projects)) {
        alert('That file does not look like a project tracker export.');
        return;
      }
      if (state.projects.length && !confirm('Replace all current projects with the imported file?')) return;
      state = normalizeState(data);
      commit();
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
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
