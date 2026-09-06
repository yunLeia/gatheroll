import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import ts from "typescript";

// Use the installed TypeScript compiler and Node runner; no browser test framework.
const source = await readFile(
  new URL("../lib/credentials.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
});
const credentials = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
);
const token = "a".repeat(43);

beforeEach(() => {
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  });
});

test("credentials stay scoped to their role and event", () => {
  credentials.saveCredential("participant", "scope-a", token);
  assert.equal(credentials.readCredential("participant", "scope-a"), token);
  assert.equal(credentials.readCredential("host", "scope-a"), null);
  assert.equal(credentials.readCredential("participant", "scope-b"), null);
});

test("clearing a credential does not clear another role", () => {
  credentials.saveCredential("participant", "clear", token);
  credentials.saveCredential("host", "clear", token);
  credentials.forgetCredential("participant", "clear");
  assert.equal(credentials.readCredential("participant", "clear"), null);
  assert.equal(credentials.readCredential("host", "clear"), token);
});

test("blocked persistence returns a warning signal and keeps this tab usable", () => {
  localStorage.setItem = () => {
    throw new Error("Storage blocked");
  };
  assert.equal(
    credentials.saveCredential("participant", "blocked", token),
    false,
  );
  assert.equal(credentials.readCredential("participant", "blocked"), token);
});

test("host fragment is removed before using the credential", () => {
  let replaced;
  globalThis.window = {
    location: { hash: `#token=${token}`, pathname: "/manage/restore" },
    history: {
      state: { marker: true },
      replaceState: (...args) => {
        replaced = args;
      },
    },
  };
  assert.equal(credentials.restoreHost("restore").token, token);
  assert.deepEqual(replaced, [{ marker: true }, "", "/manage/restore"]);
  assert.equal(credentials.readCredential("host", "restore"), token);
});

test("invite link contains only the share token and cannot carry a host fragment", () => {
  assert.equal(
    credentials.inviteLink("https://gatheroll.example", "share"),
    "https://gatheroll.example/e/share",
  );
  assert.equal(
    credentials.managePath("share", token),
    `/manage/share#token=${token}`,
  );
});

test("malformed credentials cannot be persisted", () => {
  assert.throws(() => credentials.saveCredential("host", "bad", "short"));
});
