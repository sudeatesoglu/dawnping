# ADR-0001: Ports and adapters with a compiler-enforced pure core

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

dawnping's value is in its decisions: when to ping, whether a usage window is still active, which trigger time would have worked best on past days. These decisions depend on time, the user's configuration and Claude Code's session logs.

The rest of the tool is plumbing to the outside world: spawning the `claude` CLI, reading and writing files, talking to launchd, showing macOS notifications. That plumbing is platform specific (macOS first, Linux possibly later) and slow or impossible to run in unit tests.

If decision logic calls `Date.now()`, reads files or spawns processes directly, it can only be tested by faking the whole machine, and edge cases such as a daylight saving change or a Mac that woke up late become hard to reproduce.

## Decision

We will structure the code as **ports and adapters** (hexagonal architecture):

```
src/
  core/       decision logic and the interfaces (ports) it needs
  adapters/   implementations of those ports: clock, files, claude CLI, launchd, notifications
  cli/        commands that wire adapters into the core
  cli.ts      entry point (composition root)
```

- **`src/core` is pure.** It does no I/O and reads no ambient state. Time, configuration and log data are passed in, through ports such as `Clock`.
- **The boundary is enforced by the compiler.** `src/core/tsconfig.json` loads no Node types and no DOM, and `pnpm typecheck` runs it before the project-wide check. Importing `node:fs` or using `process` or `console` in the core is a type error, not a review comment.
- **Dependencies point inward.** Adapters and the CLI import from the core; the core never imports from them.
- **One package.** The repository is a single npm package. The `core` / `adapters` / `cli` folders provide the boundary; a workspace with separate packages would add configuration without adding protection.

## Alternatives considered

- **Layering by convention only:** simplest, but the rule "no I/O in the core" holds only as long as every change is reviewed carefully.
- **A pnpm workspace with a separate core package:** enforces the boundary through package dependencies, but for a single CLI it adds a second `package.json`, build wiring and publishing questions with no extra benefit over the dedicated tsconfig.
- **Mocking Node modules in tests instead:** works for a few cases, but tests become coupled to implementation details (which module was called and how), and the decision logic stays mixed with I/O.

## Consequences

- Planner, window model and simulation can be tested with plain values and a fixed clock, deterministically.
- Supporting another platform means writing new adapters (for example a systemd scheduler) without touching the core.
- Every new kind of I/O needs a port in the core and an adapter, which is more code than calling the API directly. This cost is intended.
- Core code cannot use `console` for debugging; it returns values that the CLI layer prints.
