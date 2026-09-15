# Test Checklist

Run before any change counts as done.

| # | Command | Expected |
|---|---|---|
| 1 | `npm run typecheck` | exits 0, no errors |
| 2 | `npm test` | all pass, N tests |
| 3 | `npm run lint` | no new warnings |
| 4 | <manual check> | <specific observable result> |

## Task-specific
<checks that only apply to the current area of work>