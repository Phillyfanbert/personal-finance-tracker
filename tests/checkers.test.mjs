// The two standing checks already in tools/, run as part of the suite so one
// command covers everything. Each parses the real source and exits non-zero
// on a failure, and prints what failed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const script of ["check-money-paths.mjs", "check-palette.mjs"]) {
  test(`${script} passes`, () => {
    const path = fileURLToPath(new URL(`../tools/${script}`, import.meta.url));
    const run = spawnSync(process.execPath, [path], { encoding: "utf8" });
    assert.equal(run.status, 0, `${script} failed:\n${run.stdout}\n${run.stderr}`);
  });
}
