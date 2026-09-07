import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../features/photos/diagnostics.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
});
const diagnostics = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
);

test("diagnostics are allowlisted, bounded and silent in production", async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalInfo = console.info;
  const logs = [];
  console.info = (...args) => logs.push(args);
  try {
    process.env.NODE_ENV = "development";
    diagnostics.recordDiagnostic("selection", {
      count: 2,
      bytes: 1024,
      filename: "secret.jpg",
      token: "secret",
      url: "https://signed",
      latitude: 37,
      elapsed_ms: Infinity,
    });
    assert.deepEqual(diagnostics.diagnosticStore.getSnapshot()[0].metrics, {
      count: 2,
      bytes: 1024,
    });
    diagnostics.recordDiagnostic("secret-event-token", { count: 1 });
    assert.equal(logs.length, 1);
    await assert.rejects(
      diagnostics.tracePhotoStep("object_put", { bytes: 3 }, async () => {
        throw new Error("secret URL");
      }),
    );
    assert.equal(
      diagnostics.diagnosticStore.getSnapshot().at(-1).metrics.success,
      false,
    );
    assert.ok(!JSON.stringify(logs).includes("secret"));
    for (let i = 0; i < 120; i++)
      diagnostics.recordDiagnostic("list_loaded", { count: i });
    assert.equal(diagnostics.diagnosticStore.getSnapshot().length, 100);
    const count = logs.length;
    process.env.NODE_ENV = "production";
    diagnostics.recordDiagnostic("selection", { count: 99 });
    assert.equal(logs.length, count);
  } finally {
    console.info = originalInfo;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
});
