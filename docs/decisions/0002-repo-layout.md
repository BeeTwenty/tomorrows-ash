# ADR 0002 — Overlay repository instead of a core fork

**Date:** 2026-08-25
**Status:** Accepted (reversible)

## Context

The brief said "fork/clone AzerothCore ... into tomorrows-ash" with "upstream
tracking + classless-dev". The intent I read from that is **upstream tracking**
and a clear place for classless work — not a specific git mechanism.

The standard private-server practice is to fork the core outright and
`git merge upstream/master` periodically. That works, but it imports ~1 GB of
history we did not write and makes "how far have we diverged?" hard to answer.

## Decision

`tomorrows-ash` holds only our own work plus an exact upstream commit pin in
`upstream.json`. `tools/ta.py bootstrap` fetches AzerothCore into a gitignored
`.acore/` and links our module into it.

## Rationale

The Phase 0 investigation found we need **zero core C++ patches**
(`docs/CLASS-RESTRICTIONS.md`). That removes the main advantage of forking —
easy core edits — and leaves only its costs.

Concretely this buys:
- Upstream bump = edit one SHA, rebuild. No merge conflicts in code we don't own.
- Our entire divergence from upstream *is* the repo. Nothing hides in a merge.
- Fast clones, fast pushes, reviewable history.

## Consequences and escape hatch

- Contributors run `ta.py bootstrap` instead of a plain `git clone`. That is
  the main cost, and it is why `SETUP.md` leads with it.
- **If we ever do need a core patch**, we add `patches/*.patch` and have
  `ta.py bootstrap` `git apply` them after checkout. The model degrades
  gracefully; it does not break.
- Converting overlay → fork later is mechanical. Converting fork → overlay
  after a year of divergence is not. Choosing overlay keeps both doors open.

## Branching

Intended model once the repo has a default branch:

| Branch | Purpose |
|---|---|
| `main` | known-good, deployable Ashmorrow |
| `classless-dev` | integration branch for classless work |
| `claude/*` | agent working branches, merged into `classless-dev` |

The repository was empty at Phase 0, so the first push creates the default
branch. **Creating `main` and `classless-dev` needs your go-ahead** — the
working agreement is to push only to the assigned branch.
