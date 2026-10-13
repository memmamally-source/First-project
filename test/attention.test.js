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
