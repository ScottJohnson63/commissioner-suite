# Commissioner Suite

## Git workflow
- Work on the branch selected when the session starts. Don't create `claude/` or other new branches unless I ask.
- Merge `main` into the working branch before starting work, so the branch carries the latest pushes to `main` (`git fetch origin main && git merge origin/main`). Resolve any conflicts before making changes of your own.
- If the task comes from a GitHub issue, include "Closes #<number>" in the PR description.
- Bump the version in `nextjs/package.json` in every PR. The size comes from the issue's own label: `bug` is a patch, `enhancement` is a minor, and a breaking change is a major. Bump it with `npm version <patch|minor|major> --no-git-tag-version` from `nextjs/` so `package-lock.json` stays in step.
