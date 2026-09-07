import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../features/events/date.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { eventDateLabel } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

test("optional calendar date never invents times or shifts across viewer timezones", () => {
  const old = process.env.TZ;
  try {
    for (const zone of ["America/Los_Angeles", "Asia/Seoul", "Pacific/Honolulu"]) {
      process.env.TZ = zone;
      assert.equal(eventDateLabel("2026-09-06"), "September 6, 2026");
    }
    assert.equal(eventDateLabel(null), null);
    assert.equal(eventDateLabel("2026-02-30"), null);
    assert.equal(eventDateLabel("2026-09-06T18:00:00Z"), null);
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});
