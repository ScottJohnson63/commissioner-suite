# Commissioner Suite

## Git workflow
- Work on the branch selected when the session starts. Don't create `claude/` or other new branches unless I ask.
- Merge `main` into the working branch before starting work, so the branch carries the latest pushes to `main` (`git fetch origin main && git merge origin/main`). Resolve any conflicts before making changes of your own.
- If the task comes from a GitHub issue, include "Closes #<number>" in the PR description.
- Bump the version in `nextjs/package.json` in every PR. The size comes from a label on the issue — `patch`, `minor` or `major`. Read it off the issue; don't infer it from `bug`, `enhancement` or the nature of the change, and if the issue carries none of the three, ask me rather than picking one. Bump it with `npm version <patch|minor|major> --no-git-tag-version` from `nextjs/` so `package-lock.json` stays in step.
