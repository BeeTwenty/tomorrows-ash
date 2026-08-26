import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getContent, listContent } from "./content";

test("docs are listed in their declared order", async () => {
  const docs = await listContent("docs");
  assert.ok(docs.length > 0, "there is at least one doc");
  const orders = docs.map((d) => d.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.ok(docs.every((d) => d.title.length > 0));
});

test("patch notes come back newest first", async () => {
  const notes = await listContent("patch-notes");
  assert.ok(notes.length > 0);
  const times = notes.map((n) => n.date?.getTime() ?? 0);
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("a doc renders to HTML with anchored headings", async () => {
  const doc = await getContent("docs", "classless");
  assert.ok(doc, "the classless explainer exists");
  assert.match(doc!.html, /<h2 id="/);
  assert.ok(doc!.headings.length > 0);
});

test("path traversal in a slug is refused", async () => {
  assert.equal(await getContent("docs", "../../package"), null);
  assert.equal(await getContent("docs", "..%2Fpackage"), null);
  assert.equal(await getContent("docs", "nope"), null);
});
