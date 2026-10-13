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
