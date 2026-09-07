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
const { uploadBatch, UPLOAD_CONCURRENCY, putObject } = await module("upload");
const { selectionError, contentType, capturedAt } = await module("selection");
const limits = { max_bytes: 100, accepted_types: ["image/jpeg", "image/heic"] };

function jobs(count) {
  return Array.from({ length: count }, (_, i) => ({
    input: { client_id: `${i}` },
    file: new Blob([`${i}`]),
    thumbnail: null,
    state: "selected",
    originalUploaded: false,
    thumbnailUploaded: false,
  }));
}
function authorizations(inputs) {
  return inputs.map(({ client_id }) => ({
    client_id,
    id: client_id,
    status: "pending_upload",
    original: { url: `https://r2.example/${client_id}`, headers: {} },
  }));
}

test("blank HEIC MIME fallback, authoritative supplied type, and size checks", () => {
  assert.equal(contentType({ type: "", name: "IMG.HEIC" }), "image/heic");
  assert.equal(
    selectionError({ type: "", name: "IMG.HEIC", size: 99 }, limits),
    null,
  );
  assert.ok(
    selectionError({ type: "text/html", name: "IMG.HEIC", size: 99 }, limits),
  );
  assert.ok(
    selectionError({ type: "image/jpeg", name: "a.jpg", size: 101 }, limits),
  );
  assert.ok(
    selectionError({ type: "image/jpeg", name: "a.jpg", size: 0 }, limits),
  );
});

test("EXIF wall time without offset is not invented UTC", () => {
  assert.equal(capturedAt("2026:09:01 10:20:30", undefined), null);
  assert.equal(
    capturedAt("2026:09:01 10:20:30", "+09:00"),
    "2026-09-01T01:20:30.000Z",
  );
  assert.equal(capturedAt("bad", "+09:00"), null);
  assert.equal(capturedAt("2026:02:30 10:20:30", "+09:00"), null);
});

test("one batch authorization and no more than three concurrent uploads", async () => {
  let active = 0,
    maximum = 0,
    initCount = 0;
  const result = new Map();
  await uploadBatch(
    jobs(10),
    {
      initialize: async (inputs) => {
        initCount++;
        return authorizations(inputs);
      },
      put: async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
      },
      complete: async () => {},
    },
    new AbortController().signal,
    (job) => result.set(job.input.client_id, job),
  );
  assert.equal(initCount, 1);
  assert.equal(maximum, UPLOAD_CONCURRENCY);
  assert.equal(
    [...result.values()].filter((j) => j.state === "uploaded").length,
    10,
  );
});

test("partial failure and retry skip successful photos and successful original PUT", async () => {
  let state = jobs(2);
  const update = (job) => {
    state = state.map((j) =>
      j.input.client_id === job.input.client_id ? job : j,
    );
  };
  let fail = true,
    putCount = 0;
  const initialized = [];
  const services = {
    initialize: async (inputs) => {
      initialized.push(inputs.map((i) => i.client_id));
      return authorizations(inputs);
    },
    put: async () => {
      putCount++;
    },
    complete: async (id) => {
      if (id === "1" && fail) throw new Error("offline after PUT");
    },
  };
  await uploadBatch(state, services, new AbortController().signal, update);
  assert.equal(state[0].state, "uploaded");
  assert.equal(state[1].state, "failed");
  assert.equal(state[1].originalUploaded, true);
  fail = false;
  await uploadBatch(state, services, new AbortController().signal, update);
  assert.deepEqual(initialized, [["0", "1"], ["1"]]);
  assert.equal(putCount, 2);
  assert.equal(state[1].state, "uploaded");
});

test("controlled one-original-PUT failure leaves peers complete and Retry Failed retries only it", async () => {
  let state = jobs(3), fail = true;
  const puts = [], initialized = [];
  const services = {
    initialize: async (inputs) => {
      initialized.push(inputs.map(i => i.client_id));
      return authorizations(inputs);
    },
    put: async (target) => {
      puts.push(target.url);
      if (target.url.endsWith("/1") && fail) throw new Error("controlled single PUT failure");
    },
    complete: async () => {},
  };
  const update = (job) => { state = state.map(j => j.input.client_id === job.input.client_id ? job : j); };
  await uploadBatch(state, services, new AbortController().signal, update);
  assert.deepEqual(state.map(j => j.state), ["uploaded", "failed", "uploaded"]);
  assert.equal(state[1].originalUploaded, false);
  fail = false;
  await uploadBatch(state, services, new AbortController().signal, update);
  assert.deepEqual(initialized, [["0", "1", "2"], ["1"]]);
  assert.deepEqual(puts, ["https://r2.example/0", "https://r2.example/1", "https://r2.example/2", "https://r2.example/1"]);
  assert.ok(state.every(j => j.state === "uploaded"));
});

test("lost initialization response preserves retry identities", async () => {
  let state = jobs(2);
  await uploadBatch(
    state,
    {
      initialize: async () => {
        throw new Error("lost response");
      },
      put: async () => assert.fail("no PUT before authorization"),
      complete: async () => {},
    },
    new AbortController().signal,
    (job) => {
      state = state.map((j) =>
        j.input.client_id === job.input.client_id ? job : j,
      );
    },
  );
  assert.deepEqual(
    state.map((j) => j.input.client_id),
    ["0", "1"],
  );
  assert.ok(state.every((j) => j.state === "failed"));
});

test("thumbnail-only failure retries thumbnail without resending original", async () => {
  let state = jobs(1);
  state[0].thumbnail = new Blob(["thumb"]);
  let fail = true;
  const puts = [];
  const services = {
    initialize: async (inputs) =>
      authorizations(inputs).map((target) => ({
        ...target,
        thumbnail: { url: "thumb", headers: {} },
      })),
    put: async (target) => {
      puts.push(target.url);
      if (target.url === "thumb" && fail) throw new Error("offline");
    },
    complete: async () => {},
  };
  await uploadBatch(state, services, new AbortController().signal, (job) => {
    state = [job];
  });
  assert.equal(state[0].originalUploaded, true);
  assert.equal(state[0].thumbnailUploaded, false);
  fail = false;
  await uploadBatch(state, services, new AbortController().signal, (job) => {
    state = [job];
  });
  assert.deepEqual(puts, ["https://r2.example/0", "thumb", "thumb"]);
  assert.equal(state[0].state, "uploaded");
});

test("HEAD conflict clears PUT checkpoints so retry repairs missing bytes", async () => {
  let state = jobs(1),
    puts = 0,
    fail = true;
  const services = {
    initialize: async (inputs) => authorizations(inputs),
    put: async () => {
      puts++;
    },
    complete: async () => {
      if (fail) throw { status: 409 };
    },
  };
  await uploadBatch(state, services, new AbortController().signal, (job) => {
    state = [job];
  });
  assert.equal(state[0].originalUploaded, false);
  fail = false;
  await uploadBatch(state, services, new AbortController().signal, (job) => {
    state = [job];
  });
  assert.equal(puts, 2);
  assert.equal(state[0].state, "uploaded");
});

test("an already completed server record is never reuploaded", async () => {
  let final;
  await uploadBatch(
    jobs(1),
    {
      initialize: async () => [
        { id: "0", client_id: "0", status: "uploaded_private" },
      ],
      put: async () => assert.fail("no PUT"),
      complete: async () => assert.fail("no completion"),
    },
    new AbortController().signal,
    (job) => {
      final = job;
    },
  );
  assert.equal(final.state, "uploaded");
});

test("abort stops starting queued uploads", async () => {
  const controller = new AbortController();
  let puts = 0;
  await uploadBatch(
    jobs(10),
    {
      initialize: async (inputs) => authorizations(inputs),
      put: async () => {
        puts++;
        controller.abort();
        throw new Error("aborted");
      },
      complete: async () => {},
    },
    controller.signal,
    () => {},
  );
  assert.ok(puts <= UPLOAD_CONCURRENCY);
});

test("direct PUT does not send participant token or cookies", async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (...args) => {
    call = args;
    return { ok: true };
  };
  try {
    const blob = new Blob(["photo"]);
    await putObject(
      {
        url: "https://private.r2.example/key?signed",
        headers: { "Content-Type": "image/jpeg" },
      },
      blob,
      new AbortController().signal,
    );
    assert.equal(call[0], "https://private.r2.example/key?signed");
    assert.equal(call[1].body, blob);
    assert.equal(call[1].credentials, "omit");
    assert.equal(call[1].headers.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
