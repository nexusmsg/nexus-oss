---
name: create-pull-request
description: Create (or update) a pull request for this repository with the required title and body format. Use whenever the user asks to open a PR, create a pull request, or format a PR title/body. Triggers on "create a PR", "open a pull request", "make the PR".
---

# Create Pull Request (nexus-oss)

## When to use

Use when the user wants to open a pull request, or to update an existing PR's
title/body. **First check for an existing open PR from the current branch** with
`gh pr list` and `gh pr view <n> --json headRefName,state` — if one exists, update
it instead of creating a duplicate.

## Workflow

1. Inspect the branch scope so the PR is accurate:
   - `git log main..HEAD --oneline` — the commits the PR will carry.
   - `git diff main...HEAD --stat` — the changed files.
   - Read the relevant feature/PRD plan under `.opencode/plans/` if present, so
     the description reflects what was actually built.
2. Determine the title type from the change: `feat:` (feature), `chore:`
   (maintenance), `fix:` (bugfix), `docs:`, `refactor:`, etc. Match the repo's
   conventional-commit style.
3. Confirm the base branch (default `main`) and that `gh` is authenticated.
4. Create the PR with `gh pr create` (or update an existing one with
   `gh pr edit <n>`) using the exact body format below.
5. Return the PR URL to the user.

## Required PR format

Title: `feat:` / `chore:` / `fix:` (one of the conventional-commit prefixes)
followed by a short summary, e.g. `feat: Observability UI`.

Body template — keep these exact `##` headings. The **Bugfix** section is
**only** included when the PR is a `fix:`, and then the `### Before` / `### After`
subsections are required; for non-bugfix PRs omit the entire Bugfix block:

```markdown
## Description

(What this PR does — the feature/change at a glance, key components/files.)

## Background

(Why this change exists — context, problem it solves, links to a PRD or
`git log` references.)

## Bugfix (only)

### Before

(What the behavior was before the fix.)

### After

(What the behavior is now after the fix.)

## Test Result (API Call, UI Screenshot, etc)

(Evidence the change works: API calls + responses, UI screenshots, lint/typecheck
output, test output. Prefer concrete evidence over prose.)
```

Rules:
- Use `gh pr create --title "..." --body-file <file>` or a `--body` heredoc; for
  large bodies write to a temp file to avoid shell-escaping issues.
- If an open PR already exists for the branch, use `gh pr edit <n>` with the same
  format rather than creating a new one.
- Never push a new commit as part of PR creation unless the user asks.
