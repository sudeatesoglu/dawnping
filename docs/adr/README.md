# Architecture Decision Records

An Architecture Decision Record (ADR) captures one significant technical decision: the context that forced it, what was decided, which alternatives were rejected and what follows from it. ADRs explain *why* the code is shaped the way it is.

## When to write one

Write an ADR when a decision is expensive to reverse or shapes many parts of the codebase, for example the architecture, a file format, or an assumption about how Claude Code behaves. Routine implementation choices do not need one.

## How to add one

1. Copy [`template.md`](template.md) to `NNNN-short-title.md`, using the next free number.
2. Fill in every section. Keep it short: one decision per record.
3. Open a pull request with the status `Proposed`. Once the decision is agreed in review, set it to `Accepted` before merging; the merge makes it final.
4. Add it to the index below.

Accepted records are immutable. When a decision changes, write a new ADR that supersedes the old one, and set the old record's status to `Superseded by ADR-NNNN`.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-ports-and-adapters-with-a-pure-core.md) | Ports and adapters with a tool-enforced pure core | Accepted |
| [0002](0002-json-config-in-xdg-directories.md) | JSON config in XDG directories, managed through the CLI | Accepted |
| [0003](0003-start-the-window-with-a-headless-haiku-ping.md) | Start the usage window with a headless Haiku ping | Accepted |
| [0004](0004-optimize-the-trigger-over-a-demand-profile.md) | Optimize the trigger time over a demand profile | Superseded by 0005 (objective) |
| [0005](0005-minimize-squared-window-loads.md) | Minimize the sum of squared window loads | Accepted |
