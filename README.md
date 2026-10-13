# Research Project Tracker

One place to see where every paper stands.

- **Dashboard** — "What needs my attention this week?": summary tiles (active projects, overdue, due in 7 days, tasks completed), a 30-day deadline timeline across projects, a stage pipeline chart, open tasks by person, an action list you can tick off, and a portfolio table. "Only mine" filters to your own work.
- **Projects** — a board by stage: idea → protocol → screening → extraction → writing → submitted.
- **Study types** — every project has a design (meta-analysis, systematic/scoping/umbrella/narrative review, cross-sectional, cohort, case-control, RCT, qualitative, mixed methods, case report). Filter the dashboard and board by a single type or by family (reviews vs primary studies). Primary studies use their own stage names: protocol & ethics, data collection, analysis.
- **Each project** — study type, stage, next action (who and by when), tasks with owners and due dates, team and roles, target journal, submission date, revision deadline, and notes.

## Website and accounts

The site is published to GitHub Pages from `main` (see `.github/workflows/pages.yml`).
When `config.js` has a Supabase project URL and anon key, it runs with real accounts:

- Everyone signs up with email and password and gets their own private dashboard.
- On a project page, the owner can share the project with a co-author's email. They see it on their dashboard and can edit it; if they haven't signed up yet, it appears once they do.
- Access is enforced by the database (row-level security in `supabase/schema.sql`), not just the page.

Setting up a Supabase project: run `supabase/schema.sql` in the SQL Editor, set Authentication → URL Configuration → Site URL to the site address, and put the Project URL and anon key in `config.js`.

Moving projects from the browser-only or Claude version: click **Export backup** there, then **Import** on the website. Importing adds projects; it never replaces existing ones.

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
