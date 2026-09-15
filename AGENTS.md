# Working Agreement

You are working in a traced workflow. Speed is not the goal — a reviewable paper trail is.
Every change must be explainable, reversible, and recorded. Follow the protocols below
literally, not in spirit only.

All working documents live in `docs/ai/`. If a file referenced here does not exist, create it
from `docs/ai/TEMPLATES.md` before proceeding.

---

## Session start protocol

Before responding to the first real request of a session, read in this order:

1. `docs/ai/HANDOVER.md` — where things stand right now
2. `docs/ai/CONSTRAINTS.md` — what you are not allowed to do
3. `docs/ai/ARCHITECTURE.md` — the system map
4. `docs/ai/FLOW.md` — only the sections relevant to the current task

Then output a **Session Start Block** before anything else:

```
SESSION START
Model: <your model name and version>
Picking up from: <one line from HANDOVER.md>
Constraints in force: <the 2–3 constraints that actually apply to this task>
Open risks: <anything HANDOVER.md flags as broken or in progress>
```

Do not start editing files until this block has been printed.

---

## Before writing any code

**Plan first, always.** For any request beyond a one-line fix, respond with a plan and stop.
Do not write code in the same turn as the plan unless I explicitly say "plan and implement."

A plan contains:

- The problem restated in your own words
- Files you intend to touch, and what changes in each
- The execution path affected (reference `FLOW.md`; if the path isn't documented, say so)
- At least one alternative you considered and why you rejected it
- What could break, and how we'd know
- How this will be verified (specific commands from `docs/ai/TEST-CHECKLIST.md`)

**Scope control.** One logical change per request. If I ask for something that spans multiple
logical changes, do not attempt it — split it into a numbered sequence, show me the sequence,
and implement only step 1 after I confirm. Refusing to over-scope is expected behavior here,
not unhelpfulness.

**Constraint check.** If the task touches anything listed in `CONSTRAINTS.md`, stop and say so
explicitly. Never work around a constraint because it seems inconvenient or outdated. Ask.

---

## While writing code

- **Comment intent, not syntax.** Do not write `// increment counter`. Do write what a block
  is for, what calls into it, what it assumes already exists, and what breaks if it's removed.
- Match existing patterns in the file over your preferred style.
- No new dependencies. If one is genuinely required, stop and ask, with the reason and at
  least one no-dependency alternative.
- No opportunistic refactors, renames, formatting sweeps, or "while I was in there" cleanups.
  If you notice something worth fixing, add it to `HANDOVER.md` under Open Items instead.
- Do not delete or rewrite code you don't understand. Flag it.

---

## After every change

Report in this exact shape:

```
CHANGED
- <file>: <what changed, one line>

WHY
- <reasoning, including the tradeoff accepted>

VERIFY
- <exact commands I should run>
- <exact expected output>

NOT VERIFIED
- <anything you could not test, honestly listed>
```

Rules for this block:

- Never claim something "works," "is fixed," or "should be fine" unless you ran the
  verification and can show the output. Distinguish *I ran this and it passed* from
  *this ought to pass*. If you didn't run it, it goes under NOT VERIFIED.
- If a change is large, risky, touches data, or affects more than three files, write the
  rollback plan into `docs/ai/ROLLBACK.md` **before** making the change, and reference it here.
- I read the full diff, every time. Write diffs to be read: small, coherent, no unrelated noise.

---

## Documents you maintain

Update these as part of the work, not as an afterthought. A change is not complete until its
documents are updated.

| File | You update it when | Contains |
|---|---|---|
| `HANDOVER.md` | End of every session, and after any status change | Current state: done, in progress, broken, avoid |
| `DECISIONS.md` | Any time a non-obvious choice is made | Date, model version, decision, reasoning, alternatives rejected |
| `FLOW.md` | Whenever execution paths change | What calls what, in what order, across files |
| `ARCHITECTURE.md` | Only on structural change | Modules, services, how data moves |
| `CONSTRAINTS.md` | Never — I own this file | Hard boundaries |
| `TEST-CHECKLIST.md` | When a new verification step is needed | Real commands, real expected outputs |
| `ROLLBACK.md` | Before risky changes | Commit to revert to, files to restore, what to re-check |
| `bugs/BUG-<id>.md` | Throughout any bug investigation | Symptom, reproduction, hypotheses tried, what worked, verification |
| `features/FEATURE-<id>.md` | Throughout any feature build | Scope, decisions, status, what's left |

Bug and feature files are living traces. Log failed attempts too — knowing what *didn't* work
is often more valuable than the fix. Anyone should be able to read one cold and pick it up.

**Version-pin every entry.** In `DECISIONS.md`, `HANDOVER.md`, and bug/feature files, prefix
entries with the date and the model that made them, e.g. `2026-08-10 · claude-opus-5`. When
debugging later, knowing which model reasoned through a change matters.

---

## Session end protocol

When I say "wrap up," "end session," or the work reaches a natural stopping point, append to
`HANDOVER.md`:

```
## <date> · <model version>
Did: <what actually landed>
Left: <what's unfinished, and where it stops>
Watch: <traps, fragile spots, things I'd get wrong next time>
Next: <the single next action>
Verified: <what was actually run and passed>
```

Five lines. Then confirm what was written. Do not end a session silently.

---

## Standing rules

1. **Never present a summary as a substitute for the diff.** Summaries compress; I need the
   compression to be my job, not yours.
2. **Uncertainty is information.** Say "I don't know," "I'm guessing here," or "this assumes X"
   plainly. A confident wrong answer costs far more than an uncertain right one.
3. **If I can't explain the change in my own words, I shouldn't accept it.** If I approve
   something quickly and you suspect I haven't understood it, say so and offer a walkthrough.
   The documents exist to support my mental model, not replace it.
4. **Permission is scoped, never blanket.** An approval covers the change we discussed and
   nothing adjacent to it.
