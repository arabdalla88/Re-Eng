import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Vercel deploys the existing frontend as a static site", async () => {
  const config = JSON.parse(await read("vercel.json"));
  const html = await read("public/index.html");
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, "public");
  assert.match(html, /\/static\/styles\.css/);
  assert.match(html, /\/static\/app\.js/);
});

test("the app stores submissions in this browser without external services", async () => {
  const app = await read("public/static/app.js");
  const html = await read("public/index.html");
  const readme = await read("README.md");
  assert.match(app, /indexedDB\.open/);
  assert.match(app, /createObjectStore/);
  assert.match(app, /put\(submission\)/);
  assert.doesNotMatch(app, /supabase|signInWithPassword|\/api\//i);
  assert.doesNotMatch(html, /supabase/i);
  assert.match(html, /submissions are saved only in this browser/i);
  assert.match(readme, /مفيش مزامنة مع أجهزة الزوار/);
});
