/**
 * Shopify metaobject persistence adapter for the IMRC PO Cost Manager.
 *
 * This is an isolated migration module. The live Prisma routes are unchanged.
 * Call with an authenticated Shopify Admin GraphQL client. It never stores
 * access tokens or other authentication material in Shopify custom data.
 */
const DEFINITIONS = {
  supplier: { type: "imrc_po_supplier", name: "IMRC PO Supplier" },
  purchaseOrder: { type: "imrc_purchase_order", name: "IMRC Purchase Order" },
};

const FIELDS = [
  { key: "record_id", name: "Record ID", type: "single_line_text_field" },
  { key: "payload", name: "JSON payload", type: "multi_line_text_field" },
];

async function gql(admin, document, variables = {}) {
  const response = await admin.graphql(document, { variables });
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }
  return body.data;
}

function checkErrors(errors, operation) {
  if (errors?.length) {
    throw new Error(`${operation}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

function recordType(kind) {
  const definition = DEFINITIONS[kind];
  if (!definition) throw new Error(`Unknown PO record kind: ${kind}`);
  return definition.type;
}

function parseRecord(node) {
  if (!node) return null;
  const fields = Object.fromEntries((node.fields || []).map((f) => [f.key, f.value]));
  if (!fields.payload) throw new Error(`Metaobject ${node.id} is missing its payload`);
  const payload = JSON.parse(fields.payload);
  if (fields.record_id !== payload.id) {
    throw new Error(`Metaobject ${node.id} has a mismatched record ID`);
  }
  return { ...payload, shopifyMetaobjectId: node.id };
}

const RECORD_FIELDS = `id handle fields { key value }`;

export async function ensurePoMetaobjectDefinitions(admin) {
  const existing = await gql(admin, `query IMRCDefinitions {
    metaobjectDefinitions(first: 250) {
      nodes { type }
      pageInfo { hasNextPage }
    }
  }`);
  const nodes = existing.metaobjectDefinitions;
  if (nodes.pageInfo.hasNextPage) {
    throw new Error("Too many metaobject definitions to verify safely; paginate before setup");
  }
  const present = new Set(nodes.nodes.map((node) => node.type));
  for (const definition of Object.values(DEFINITIONS)) {
    if (present.has(definition.type)) continue;
    const data = await gql(admin, `mutation CreateIMRCDefinition($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition { id type }
        userErrors { field message code }
      }
    }`, {
      definition: {
        type: definition.type,
        name: definition.name,
        access: { admin: "MERCHANT_READ_WRITE" },
        fieldDefinitions: FIELDS,
      },
    });
    checkErrors(data.metaobjectDefinitionCreate.userErrors, "Create metaobject definition");
  }
}

export async function listPoRecords(admin, kind) {
  const type = recordType(kind);
  const records = [];
  let cursor = null;
  do {
    const data = await gql(admin, `query IMRCList($type: String!, $after: String) {
      metaobjects(type: $type, first: 100, after: $after) {
        nodes { ${RECORD_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }`, { type, after: cursor });
    const connection = data.metaobjects;
    records.push(...connection.nodes.map(parseRecord));
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return records;
}

export async function getPoRecord(admin, kind, id) {
  if (!id) return null;
  const records = await listPoRecords(admin, kind);
  return records.find((record) => record.id === id) || null;
}

export async function savePoRecord(admin, kind, record) {
  if (!record?.id || typeof record.id !== "string") {
    throw new Error("A stable record ID is required");
  }
  const type = recordType(kind);
  const { shopifyMetaobjectId, ...payload } = record;
  const fields = [
    { key: "record_id", value: payload.id },
    { key: "payload", value: JSON.stringify(payload) },
  ];
  if (shopifyMetaobjectId) {
    const data = await gql(admin, `mutation IMRCUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { ${RECORD_FIELDS} }
        userErrors { field message code }
      }
    }`, { id: shopifyMetaobjectId, metaobject: { fields } });
    checkErrors(data.metaobjectUpdate.userErrors, "Update PO record");
    return parseRecord(data.metaobjectUpdate.metaobject);
  }
  const data = await gql(admin, `mutation IMRCCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject { ${RECORD_FIELDS} }
      userErrors { field message code }
    }
  }`, {
    metaobject: { type, fields },
  });
  checkErrors(data.metaobjectCreate.userErrors, "Create PO record");
  return parseRecord(data.metaobjectCreate.metaobject);
}

export async function deletePoRecord(admin, record) {
  if (!record?.shopifyMetaobjectId) throw new Error("Missing Shopify metaobject ID");
  const data = await gql(admin, `mutation IMRCDelete($id: ID!) {
    metaobjectDelete(id: $id) { deletedId userErrors { field message code } }
  }`, { id: record.shopifyMetaobjectId });
  checkErrors(data.metaobjectDelete.userErrors, "Delete PO record");
}
