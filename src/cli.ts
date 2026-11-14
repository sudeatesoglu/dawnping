#!/usr/bin/env node
// Entry point (composition root): wires adapters into the CLI and runs it.
// Keep logic out of this file; it is excluded from unit-test coverage.
import { createProgram } from './cli/program.ts';

await createProgram().parseAsync(process.argv);
