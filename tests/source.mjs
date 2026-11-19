// Shared by the tests: read a file from the repository, and lift a piece of
// app/app.js out so a test runs the REAL definition rather than a copy of it.
//
// app.js is the DOM entry point and cannot be imported (it reaches for
// window, document and the Supabase client at load), so the pure parts it
// holds are sliced out by exact markers and evaluated. A copy in a test would
// only prove the copy agrees with itself, which is the check that passes while
// the app is wrong. Keep the markers tight: a slice that runs into DOM code
// fails with "$ is not defined", which reads like a broken test rather than a
// bad slice.

import { readFileSync } from "node:fs";

export const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

export const APP = read("app/app.js");

// The source from the line that starts with `from` up to (not including) the
// line that starts with `to`. Throws if either is missing or ambiguous, so a
// rename in app.js fails the test loudly instead of slicing the wrong thing.
export function slice(src, from, to) {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`slice: start marker not found: ${from}`);
  if (src.indexOf(from, start + 1) >= 0) throw new Error(`slice: start marker appears twice: ${from}`);
  const end = src.indexOf(to, start + from.length);
  if (end < 0) throw new Error(`slice: end marker not found after start: ${to}`);
  return src.slice(start, end);
}

// Evaluates `code` with the given names in scope and returns the named
// bindings it defines.
export function evaluate(code, scope, exportNames) {
  const names = Object.keys(scope);
  const body = `${code}\nreturn { ${exportNames.join(", ")} };`;
  return new Function(...names, body)(...names.map((n) => scope[n]));
}
