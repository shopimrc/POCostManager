import assert from "node:assert/strict";
import test from "node:test";
import {
  listPoRecords,
  savePoRecord,
} from "../app/lib/shopify-po-storage.server.js";

function fakeAdmin(responses, calls) {
  return {
    async graphql(document, options) {
      calls.push({ document, variables: options?.variables });
      const result = responses.shift();
      if (!result) throw new Error("Unexpected GraphQL request");
      return { async json() { return result; } };
    },
  };
}

test("paginates Shopify PO records and preserves stable IDs", async () => {
  const calls = [];
  const admin = fakeAdmin([
    { data: { metaobjects: {
      nodes: [{ id: "gid://shopify/Metaobject/1", handle: "one", fields: [
        { key: "record_id", value: "one" },
        { key: "payload", value: JSON.stringify({ id: "one", poNumber: "PO1" }) },
      ] }],
      pageInfo: { hasNextPage: true, endCursor: "next" },
    } } },
    { data: { metaobjects: {
      nodes: [{ id: "gid://shopify/Metaobject/2", handle: "two", fields: [
        { key: "record_id", value: "two" },
        { key: "payload", value: JSON.stringify({ id: "two", poNumber: "PO2" }) },
      ] }],
      pageInfo: { hasNextPage: false, endCursor: null },
    } } },
  ], calls);
  const records = await listPoRecords(admin, "purchaseOrder");
  assert.deepEqual(records.map((record) => record.poNumber), ["PO1", "PO2"]);
  assert.equal(calls[1].variables.after, "next");
});

test("saves PO JSON without exposing a session token", async () => {
  const calls = [];
  const admin = fakeAdmin([
    { data: { metaobjectCreate: {
      metaobject: { id: "gid://shopify/Metaobject/3", handle: "three", fields: [
        { key: "record_id", value: "three" },
        { key: "payload", value: JSON.stringify({ id: "three", poNumber: "PO3" }) },
      ] },
      userErrors: [],
    } } },
  ], calls);
  const saved = await savePoRecord(admin, "purchaseOrder", { id: "three", poNumber: "PO3" });
  assert.equal(saved.shopifyMetaobjectId, "gid://shopify/Metaobject/3");
  assert.equal(calls[0].variables.metaobject.type, "imrc_purchase_order");
});
