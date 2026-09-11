# Commissioner Suite

## Git workflow
- Work on the branch selected when the session starts. Don't create `claude/` or other new branches unless I ask.
- If the task comes from a GitHub issue, include "Closes #<number>" in the PR description.
- Bump the version in `nextjs/package.json` in every PR: patch for fixes, minor for features, major for breaking changes. Bump it with `npm version <patch|minor|major> --no-git-tag-version` from `nextjs/` so `package-lock.json` stays in step.
