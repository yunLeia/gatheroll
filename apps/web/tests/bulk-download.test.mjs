import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function module(name) {
  const source = await readFile(
    new URL(`../features/photos/${name}.ts`, import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
  );
}
const { collectAll } = await module("bulk-download-core");

function photo(id, filename = `${id}.jpg`) {
  return {
    id,
    original_filename: filename,
    content_type: "image/jpeg",
    file_size_bytes: 100,
    status: "uploaded_private",
    preview_url: null,
    preview_expires_in_seconds: 300,
  };
}

test("collectAll pages through the album until next_offset is null", async () => {
  const calls = [];
  const service = {
    list: async (_signal, offset, excludeMine) => {
      calls.push({ offset, excludeMine });
      if (offset === 0)
        return { photos: [photo("a"), photo("b")], next_offset: 2 };
      return { photos: [photo("c")], next_offset: null };
    },
  };
  const result = await collectAll(service, new AbortController().signal, true);
  assert.deepEqual(
    result.map((p) => p.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(calls, [
    { offset: 0, excludeMine: true },
    { offset: 2, excludeMine: true },
  ]);
});

test("collectAll stops early once the signal is aborted", async () => {
  const controller = new AbortController();
  let calls = 0;
  const service = {
    list: async (_signal, offset) => {
      calls++;
      controller.abort();
      return { photos: [photo(String(offset))], next_offset: offset + 1 };
    },
  };
  const result = await collectAll(service, controller.signal, false);
  assert.equal(calls, 1);
  assert.equal(result.length, 1);
});
