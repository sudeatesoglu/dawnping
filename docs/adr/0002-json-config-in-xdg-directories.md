# ADR-0002: JSON config in XDG directories, managed through the CLI

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

dawnping needs a config file (working hours, weekday profiles, skip dates, ping model) and a place for state it writes itself (last ping, verification result, logs).

Users are expected to change settings mainly through CLI commands (`dawnping config set`, `dawnping profile add`, `dawnping skip`), with editing the file by hand as an option. Every CLI change is a read, modify, write cycle performed by the program.

## Decision

**Format: JSON, validated with a schema.**

- One file, `config.json`, with a `version` field so later releases can migrate older files.
- The schema (zod) is the single source of truth: it validates, applies defaults, and produces one error line per problem that names the key, e.g. `profiles.default.work: must be a range like 09:00-18:00 that ends after it starts`.
- Unknown keys are rejected, so a typo such as `timezon` is reported instead of silently ignored.
- Each weekday belongs to at most one profile. A weekday no profile covers is a rest day: no ping.
- Writes are atomic (temporary file, flush, rename), and an invalid config is never written.

**Locations: XDG Base Directory spec.**

| Purpose | Default | Override |
| --- | --- | --- |
| Config | `~/.config/dawnping/config.json` | `XDG_CONFIG_HOME` |
| State | `~/.local/state/dawnping/` | `XDG_STATE_HOME` |

Relative values of the variables are ignored, as the spec requires. Files are created with mode `0600` and new directories with `0700`, because they reveal when the user works.

## Alternatives considered

- **TOML:** easier to read and allows comments, but the CLI rewrites the file on every change, and common TOML libraries drop comments when they serialize. Users would lose their comments the first time they ran `config set`. It would also add a parser dependency.
- **YAML:** same comment problem, plus a larger and more ambiguous syntax (implicit types such as `no` becoming `false`).
- **`~/Library/Application Support/dawnping`:** the native macOS location for apps, but terminal users expect command-line tools under `~/.config`. XDG paths also work unchanged on Linux.

## Consequences

- No comments in the config file. Help lives in the CLI (`dawnping config --help`) and in error messages.
- Round trips are lossless: what the CLI writes is exactly what it read, plus the change.
- A JSON Schema for editor autocompletion can be generated from the same zod schema later (the `$schema` key is already allowed).
- New settings (for example retrigger and window anchor options) are added as optional keys with defaults, so older files stay valid without a version bump.
