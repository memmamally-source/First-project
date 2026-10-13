const test = require('node:test');
const assert = require('node:assert');
const { attention, normalizeState, newProject, newTask, addDays, daysUntil } = require('../app.js');

const TODAY = '2026-03-27'; // spans the EU DST change on 29 March

function setup() {
  const p = newProject('Review A');
  p.stage = 'screening';
  p.nextAction = 'Finish full-text screening';
  p.nextActionOwner = 'Ana';
  p.nextActionDue = addDays(TODAY, 2);
  const q = newProject('Review B'); // no next action
  const s = newProject('Paper C');
  s.stage = 'submitted';
  s.journal = { target: 'BMJ Open', submittedOn: '', revisionDue: addDays(TODAY, 10) };
  const tasks = [
    newTask(p.id, 'overdue', 'Ana', addDays(TODAY, -3)),
    newTask(p.id, 'this week', 'Ben', addDays(TODAY, 7)),
    newTask(p.id, 'next month', 'Ana', addDays(TODAY, 30)),
    newTask(p.id, 'no date', 'Ana', ''),
    { ...newTask(p.id, 'done', 'Ana', addDays(TODAY, 1)), done: true },
  ];
  return normalizeState({ me: 'ana', projects: [p, q, s], tasks });
}

test('date helpers survive DST', () => {
  assert.strictEqual(addDays('2026-03-28', 2), '2026-03-30');
  assert.strictEqual(daysUntil('2026-03-30', '2026-03-28'), 2);
});

test('groups overdue, upcoming and projects without next action', () => {
  const a = attention(setup(), TODAY);
  assert.deepStrictEqual(a.overdue.map((i) => i.title), ['overdue']);
  assert.deepStrictEqual(a.upcoming.map((i) => i.title), ['Finish full-text screening', 'this week', 'Revisions due for BMJ Open']);
  assert.deepStrictEqual(a.noNextAction.map((p) => p.title), ['Review B']);
});

test('only-mine filters by owner, case-insensitively', () => {
  const a = attention(setup(), TODAY, { mineOnly: true });
  assert.deepStrictEqual([...a.overdue, ...a.upcoming].map((i) => i.title), ['overdue', 'Finish full-text screening']);
  assert.deepStrictEqual(a.noNextAction, []);
});

test('normalizeState repairs bad input', () => {
  const s = normalizeState({ projects: [{ id: 'x', stage: 'bogus', nextActionDue: 'soon' }, null], tasks: [{ id: 't', projectId: 'missing', title: 'orphan' }] });
  assert.strictEqual(s.projects.length, 1);
  assert.strictEqual(s.projects[0].stage, 'idea');
  assert.strictEqual(s.projects[0].nextActionDue, '');
  assert.strictEqual(s.tasks.length, 0);
});

test('dashboardStats counts tiles, stages and workload', () => {
  const { dashboardStats } = require('../app.js');
  const s = dashboardStats(setup(), TODAY);
  assert.strictEqual(s.activeCount, 2);
  assert.strictEqual(s.submittedCount, 1);
  assert.strictEqual(s.overdueCount, 1);
  assert.strictEqual(s.dueSoonCount, 2); // revision is 10 days out, so not "this week"
  assert.deepStrictEqual(s.byStage.map((x) => x.projects.length), [1, 0, 1, 0, 0, 1]);
  assert.deepStrictEqual(s.workload, [
    { name: 'Ana', open: 3, overdue: 1 },
    { name: 'Ben', open: 1, overdue: 0 },
  ]);
});

test('study types: stage names, filtering and counts', () => {
  const { stageLabel, stageLabelFor, filterByType, typeCounts } = require('../app.js');
  assert.strictEqual(stageLabel('screening', 'meta-analysis'), 'Screening');
  assert.strictEqual(stageLabel('screening', 'cross-sectional'), 'Data collection');
  assert.strictEqual(stageLabel('extraction', 'cohort'), 'Analysis');
  assert.strictEqual(stageLabel('writing', 'cohort'), 'Writing');
  const s = normalizeState({ projects: [
    { id: 'a', studyType: 'meta-analysis' }, { id: 'b', studyType: 'cross-sectional' },
    { id: 'c', studyType: 'bogus' },
  ], tasks: [{ id: 't', projectId: 'b', title: 'x' }] });
  assert.strictEqual(s.projects[2].studyType, '');
  assert.strictEqual(stageLabelFor('screening', s.projects), 'Screening / Data collection');
  assert.strictEqual(stageLabelFor('screening', [s.projects[1]]), 'Data collection');
  const prim = filterByType(s, 'primary');
  assert.deepStrictEqual(prim.projects.map((p) => p.id), ['b']);
  assert.strictEqual(prim.tasks.length, 1);
  assert.deepStrictEqual(filterByType(s, 'review').projects.map((p) => p.id), ['a']);
  assert.deepStrictEqual(filterByType(s, 'none').projects.map((p) => p.id), ['c']);
  assert.deepStrictEqual(typeCounts(s.projects).map((t) => [t.id, t.count]), [['meta-analysis', 1], ['cross-sectional', 1], ['none', 1]]);
});

test('team roles: legacy free text maps to first author, co-author or contributor', () => {
  const s = normalizeState({ projects: [{ id: 'p', team: [
    { name: 'A', role: 'Lead author' }, { name: 'B', role: 'Supervisor' },
    { name: 'C', role: 'Contributor' }, { name: 'D', role: 'coauthor' }, { name: 'E' },
  ] }] });
  assert.deepStrictEqual(s.projects[0].team.map((m) => [m.name, m.role, m.note]), [
    ['A', 'first', ''], ['B', 'coauthor', 'Supervisor'], ['C', 'contributor', ''], ['D', 'coauthor', ''], ['E', 'coauthor', ''],
  ]);
});

test('next action with several people shows who we are waiting for', () => {
  const { waitingText } = require('../app.js');
  const s = normalizeState({ me: 'ana', projects: [
    { id: 'a', nextAction: 'Screen full texts', nextActionDue: addDays(TODAY, 2), nextActionOwners: [{ name: 'Ana', done: true }, { name: 'Ben' }, { name: 'Cy' }] },
    { id: 'b', nextAction: 'Old style', nextActionOwner: 'Ana & Ben' },
  ] });
  assert.strictEqual(waitingText(s.projects[0]), 'Waiting for Ben and Cy');
  assert.deepStrictEqual(s.projects[1].nextActionOwners, [{ name: 'Ana', done: false }, { name: 'Ben', done: false }]);
  // Ana is done, so the action is no longer hers under "Only mine".
  assert.strictEqual(attention(s, TODAY, { mineOnly: true }).upcoming.length, 0);
  assert.strictEqual(attention(s, TODAY).upcoming[0].owner, 'Waiting for Ben and Cy');
  s.projects[0].nextActionOwners.forEach((o) => { o.done = true; });
  assert.strictEqual(waitingText(s.projects[0]), 'Everyone has finished');
});

test('server rows: projects and tasks round-trip; imports get fresh ids', () => {
  const { projectBody, stateFromRows, remapIds } = require('../app.js');
  const ex = normalizeState({ me: 'Ana', projects: [
    { id: 'p1', title: 'Exercise for back pain', stage: 'screening', studyType: 'meta-analysis', team: [{ name: 'Ana', role: 'first' }], nextAction: 'Screen', nextActionOwners: [{ name: 'Ana' }] },
    { id: 'p2', title: 'ICU burnout survey', stage: 'idea', studyType: 'cross-sectional' },
  ], tasks: [
    { id: 't1', projectId: 'p1', title: 'Resolve conflicts', owner: 'Ana', due: TODAY },
    { id: 't2', projectId: 'p1', title: 'Pilot form', done: true },
    { id: 't3', projectId: 'p2', title: 'Ethics form' },
  ] });
  const p = ex.projects[0];
  const body = projectBody(ex, p);
  assert.ok(!('id' in body) && !('ownerId' in body));
  assert.strictEqual(body.tasks.length, ex.tasks.filter((t) => t.projectId === p.id).length);
  assert.ok(body.tasks.every((t) => !('projectId' in t)));
  const back = stateFromRows([{ id: p.id, owner_id: 'u1', data: JSON.parse(JSON.stringify(body)) }], 'Ana');
  assert.strictEqual(back.projects[0].title, p.title);
  assert.strictEqual(back.projects[0].ownerId, 'u1');
  assert.deepStrictEqual(projectBody(back, back.projects[0]), body);
  const r = remapIds(ex);
  assert.strictEqual(r.projects.length, ex.projects.length);
  assert.ok(r.projects.every((x) => !ex.projects.some((o) => o.id === x.id) && /^[0-9a-f-]{36}$/.test(x.id)));
  const ids = new Set(r.projects.map((x) => x.id));
  assert.ok(r.tasks.every((t) => ids.has(t.projectId)));
  assert.strictEqual(r.tasks.length, ex.tasks.length);
});

test('people index: who is on which paper, with roles, tasks and waiting', () => {
  const { peopleIndex, matchesSearch } = require('../app.js');
  const s = normalizeState({ projects: [
    { id: 'a', title: 'PAD', team: [{ name: 'Ana', role: 'first' }, { name: 'ben', role: 'coauthor' }], nextAction: 'Screen', nextActionOwners: [{ name: 'Ben' }, { name: 'Cy' }] },
    { id: 'b', title: 'ECHO', team: [{ name: 'Ben', role: 'first' }, { name: 'Dee', role: 'contributor' }] },
  ], tasks: [{ id: 't', projectId: 'b', title: 'x', owner: 'Ana' }, { id: 'u', projectId: 'a', title: 'y', owner: 'Ana', done: true }] });
  const idx = Object.fromEntries(peopleIndex(s).map((p) => [p.name.toLowerCase(), p]));
  assert.deepStrictEqual(idx.ben.papers.map((p) => [p.title, p.role, p.waiting]), [['ECHO', 'first', false], ['PAD', 'coauthor', true]]);
  assert.strictEqual(idx.ben.waitingOn, 1);
  assert.deepStrictEqual(idx.ana.papers.map((p) => [p.title, p.role, p.openTasks]), [['PAD', 'first', 0], ['ECHO', 'assigned', 1]]);
  assert.deepStrictEqual(idx.cy.papers.map((p) => p.role), ['assigned']);
  assert.deepStrictEqual(idx.dee.papers.map((p) => p.role), ['contributor']);
  assert.ok(matchesSearch(s.projects[1], 'echo dee'));
  assert.ok(!matchesSearch(s.projects[1], 'pad'));
});

test('every button in the app has a click handler', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../app.js'), 'utf8') + fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const used = new Set([...src.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]));
  const handled = new Set([...src.matchAll(/a === '([a-z-]+)'/g)].map((m) => m[1]));
  const missing = [...used].filter((a) => !handled.has(a));
  assert.deepStrictEqual(missing, []);
});
