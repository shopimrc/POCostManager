import assert from "node:assert/strict";
import test from "node:test";
import { EmbeddedSessionStorage } from "../app/lib/embedded-session-storage.server.js";

test("session storage saves, loads and removes sessions without a database", async () => {
  const storage = new EmbeddedSessionStorage();
  const session = { id: "offline-test.myshopify.com", shop: "test.myshopify.com", scope: "read_products" };
  assert.equal(await storage.storeSession(session), true);
  assert.equal((await storage.loadSession(session.id)).shop, session.shop);
  assert.equal((await storage.findSessionsByShop(session.shop)).length, 1);
  await storage.updateSessionsScope(session.shop, "write_products");
  assert.equal((await storage.loadSession(session.id)).scope, "write_products");
  await storage.deleteSessionsByShop(session.shop);
  assert.equal(await storage.loadSession(session.id), undefined);
});

test("expired session cannot be reused", async () => {
  const storage = new EmbeddedSessionStorage();
  await storage.storeSession({ id: "expired", shop: "test.myshopify.com", expires: new Date(0) });
  assert.equal(await storage.loadSession("expired"), undefined);
});
