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
  assert.match(html, /\/static\/config\.js/);
  assert.match(html, /\/static\/app\.js/);
});

test("public browser configuration contains no server secret", async () => {
  const config = await read("public/static/config.js");
  assert.match(config, /supabaseUrl/);
  assert.match(config, /supabaseAnonKey/);
  assert.doesNotMatch(config, /service_role|secret_key/i);
});

test("public listing projection never exposes owner contact fields", async () => {
  const sql = await read("supabase_setup.sql");
  const view = sql.split("CREATE VIEW public.listings")[1].split("REVOKE ALL ON public.listings")[0];
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /CREATE POLICY "Public can submit tools"/);
  assert.match(sql, /CREATE POLICY "Admins can view submissions"/);
  assert.doesNotMatch(view, /contact_name|email|phone/i);
});

test("admin access and photo uploads are protected by Supabase policies", async () => {
  const sql = await read("supabase_setup.sql");
  const app = await read("public/static/app.js");
  assert.match(sql, /CREATE POLICY "Admins can update submissions"/);
  assert.match(sql, /CREATE POLICY "Admins can read their own access"/);
  assert.match(sql, /CREATE POLICY "Public can upload Re-Eng photos"/);
  assert.match(app, /signInWithPassword/);
  assert.match(app, /from\("admin_users"\)/);
});
