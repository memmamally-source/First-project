# Research Project Tracker

One place to see where every paper stands.

- **Dashboard** — "What needs my attention this week?": summary tiles (active projects, overdue, due in 7 days, tasks completed), a 30-day deadline timeline across projects, a stage pipeline chart, open tasks by person, an action list you can tick off, and a portfolio table. "Only mine" filters to your own work.
- **Projects** — a board by stage: idea → protocol → screening → extraction → writing → submitted.
- **Study types** — every project has a design (meta-analysis, systematic/scoping/umbrella/narrative review, cross-sectional, cohort, case-control, RCT, qualitative, mixed methods, case report). Filter the dashboard and board by a single type or by family (reviews vs primary studies). Primary studies use their own stage names: protocol & ethics, data collection, analysis.
- **Each project** — study type, stage, next action (who and by when), tasks with owners and due dates, team and roles, target journal, submission date, revision deadline, and notes.

## Run it

Open `index.html` in a browser. You don't need to install anything. Click **Load example projects** to try it out.

Opened as a file, data is saved in that browser only (localStorage). Published as a claude.ai artifact, it also saves to your Claude account, so your projects follow you across devices. Use **Export backup** to save a JSON file and **Import** to restore it or move it to another computer.

## Tests

```
node --test test/*.test.js
```

## Roadmap

1. ✅ Track projects and tasks
2. Shared team access (needs a small backend and sign-in)
3. Reminders (email or notifications before deadlines)
