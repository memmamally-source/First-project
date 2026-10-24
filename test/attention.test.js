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

test('meetings: repeats, end dates, cancelled dates and calendar files', () => {
  const { normalizeMeetings, occursOn, meetingsBetween, describeMeeting, meetingICS } = require('../app.js');
  const [weekly, fort, nth, monthly, once, days] = normalizeMeetings([
    { title: 'Lab meeting', date: '2026-10-13', start: '09:00', end: '10:00', repeat: 'weekly', until: '2026-11-10', skip: ['2026-10-27'] },
    { title: 'Supervision', date: '2026-10-14', start: '14:00', repeat: 'fortnightly' },
    { title: 'Journal club', date: '2026-10-13', repeat: 'monthly-nth' }, // 2nd Tuesday
    { title: 'Stats clinic', date: '2026-01-31', repeat: 'monthly' },
    { title: 'Ethics', date: '2026-10-20', start: '11:30' },
    { title: 'Standup', date: '2026-10-12', repeat: 'weekdays', start: '08:00' },
  ]);
  assert.ok(occursOn(weekly, '2026-10-20') && !occursOn(weekly, '2026-10-21'));
  assert.ok(!occursOn(weekly, '2026-10-27'), 'cancelled date is skipped');
  assert.ok(occursOn(weekly, '2026-11-10') && !occursOn(weekly, '2026-11-17'), 'ends on until');
  assert.ok(!occursOn(fort, '2026-10-21') && occursOn(fort, '2026-10-28'));
  assert.ok(occursOn(nth, '2026-11-10') && !occursOn(nth, '2026-11-03'), '2nd Tuesday of November');
  assert.ok(!occursOn(monthly, '2026-02-28') && occursOn(monthly, '2026-03-31'), 'months without the date are skipped');
  assert.ok(occursOn(days, '2026-10-16') && !occursOn(days, '2026-10-17'), 'weekdays only');
  assert.ok(!occursOn(weekly, '2026-10-06'), 'nothing before the start date');
  const week = meetingsBetween([weekly, once, days], '2026-10-19', '2026-10-21').map((x) => `${x.date} ${x.meeting.title}`);
  assert.deepStrictEqual(week, ['2026-10-19 Standup', '2026-10-20 Standup', '2026-10-20 Lab meeting', '2026-10-20 Ethics', '2026-10-21 Standup']);
  assert.strictEqual(describeMeeting(fort), 'Every 2 weeks on Wednesday, 14:00');
  assert.strictEqual(describeMeeting(nth), 'Every month on the second Tuesday');
  assert.strictEqual(describeMeeting(weekly), 'Every Tuesday, 09:00–10:00, until 10 Nov 2026');
  const ics = meetingICS(weekly, '20261013T000000Z');
  assert.match(ics, /DTSTART:20261013T090000\r\nDTEND:20261013T100000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;UNTIL=20261110T235959/);
  assert.match(ics, /EXDATE:20261027T090000/);
  assert.match(meetingICS(nth, 'x'), /RRULE:FREQ=MONTHLY;BYDAY=2TU/);
  assert.match(meetingICS(nth, 'x'), /DTSTART;VALUE=DATE:20261013/);
  assert.deepStrictEqual(normalizeMeetings([{ title: '', date: '2026-01-01' }, { title: 'x', date: 'bad' }]), []);
});

test('task timelines: start dates, in-progress days and calendar file', () => {
  const { tasksInProgress, taskICS, newTask } = require('../app.js');
  const s = normalizeState({ projects: [{ id: 'p', title: 'PAD' }], tasks: [
    { id: 'a', projectId: 'p', title: 'Screening', owner: 'Ana', start: '2026-10-20', due: '2026-10-24' },
    { id: 'b', projectId: 'p', title: 'Swapped', start: '2026-11-05', due: '2026-11-01' },
    { id: 'c', projectId: 'p', title: 'Due only', due: '2026-10-22' },
    { id: 'd', projectId: 'p', title: 'Done', start: '2026-10-20', due: '2026-10-30', done: true },
  ] });
  assert.deepStrictEqual([s.tasks[1].start, s.tasks[1].due], ['2026-11-01', '2026-11-05']);
  assert.deepStrictEqual(tasksInProgress(s, '2026-10-20').map((t) => t.id), ['a']);
  assert.deepStrictEqual(tasksInProgress(s, '2026-10-24').map((t) => t.id), [], 'due day is shown as due, not in progress');
  assert.deepStrictEqual(tasksInProgress(s, '2026-10-19').map((t) => t.id), []);
  const ics = taskICS(s.tasks[0], 'PAD', 'X');
  assert.match(ics, /DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261025/);
  assert.match(ics, /SUMMARY:Screening/);
  assert.match(taskICS(s.tasks[2], 'PAD', 'X'), /SUMMARY:Due: Due only/);
  const t = newTask('p', 'x', '', '2026-01-01', '2026-02-01');
  assert.deepStrictEqual([t.start, t.due], ['2026-01-01', '2026-02-01']);
});
