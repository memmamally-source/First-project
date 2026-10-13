# Research Project Tracker

One place to see where every paper stands.

- **This week** — what's overdue, what's due in the next 7 days, revision deadlines within 14 days, and projects with no next action. "Only mine" filters to your own tasks.
- **Projects** — a board by stage: idea → protocol → screening → extraction → writing → submitted.
- **Each project** — stage, next action (who and by when), tasks with owners and due dates, team and roles, target journal, submission date, revision deadline, and notes.

## Run it

Open `index.html` in a browser. You don't need to install anything. Click **Load example projects** to try it out.

Data is saved in that browser only (localStorage). Use **Export backup** to save a JSON file and **Import** to restore it or move it to another computer.

## Tests

```
node --test test/*.test.js
```

## Roadmap

1. ✅ Track projects and tasks
2. Shared team access (needs a small backend and sign-in)
3. Reminders (email or notifications before deadlines)
