import {
  Form,
  Link,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import { useEffect, useMemo, useState } from "react";
import prisma from "../db.server";
import { ensurePoMetaobjectDefinitions, listPoRecords, getPoRecord, savePoRecord, deletePoRecord } from "../lib/shopify-po-storage.server.js";
import { authenticate } from "../shopify.server";


function normalizeLocationGid(...values) {
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (trimmed && trimmed !== "pending-location") return trimmed;
  }
  return null;
}

function getDefaultLocationGid() {
  return (
    process.env.SHOPIFY_LOCATION_GID ||
    process.env.DEFAULT_LOCATION_GID ||
    ""
  );
}


export async function loader({ request, params }) {
  const shopifyStorage = process.env.IMRC_PO_STORAGE === "shopify";
  const admin = shopifyStorage ? (await authenticate.admin(request)).admin : null;
  if (shopifyStorage) await ensurePoMetaobjectDefinitions(admin);
  const storedPo = shopifyStorage ? await getPoRecord(admin, "purchaseOrder", params.id) : null;
  const storedSupplier = storedPo?.supplierId ? await getPoRecord(admin, "supplier", storedPo.supplierId) : null;
  const po = shopifyStorage ? (storedPo ? { ...storedPo, supplier: storedSupplier, lines: storedPo.lines || [] } : null) : await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: {
      supplier: true,
      lines: true,
    },
  });

  if (!po) {
    throw new Response("PO not found", { status: 404 });
  }

  const suppliers = shopifyStorage
    ? (await listPoRecords(admin, "supplier")).sort((a, b) => a.company.localeCompare(b.company))
    : await prisma.supplier.findMany({ orderBy: { company: "asc" } });

  return { po, suppliers, resolvedLocationGid: normalizeLocationGid(po.locationGid, getDefaultLocationGid()) };
}

export async function action({ request, params }) {
  const shopifyStorage = process.env.IMRC_PO_STORAGE === "shopify";
  const admin = shopifyStorage ? (await authenticate.admin(request)).admin : null;
  if (shopifyStorage) await ensurePoMetaobjectDefinitions(admin);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const url = new URL(request.url);


  if (intent === "delete-draft") {
    const po = shopifyStorage
      ? await getPoRecord(admin, "purchaseOrder", params.id)
      : await prisma.purchaseOrder.findUnique({ where: { id: params.id }, select: { id: true, status: true } });

    if (!po) {
      return { error: "PO not found." };
    }

    if (po.status !== "DRAFT") {
      return { error: "Only draft POs can be deleted." };
    }

    if (shopifyStorage) {
      await deletePoRecord(admin, po);
    } else {
      await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: params.id } });
      await prisma.purchaseOrder.delete({ where: { id: params.id } });
    }

    return redirect(`/app/purchase-orders${url.search}`);
  }

  if (intent === "create-supplier") {
    const company = String(formData.get("company") || "").trim();
    const country = String(formData.get("country") || "").trim();
    const address1 = String(formData.get("address1") || "").trim();
    const address2 = String(formData.get("address2") || "").trim();
    const city = String(formData.get("city") || "").trim();
    const state = String(formData.get("state") || "").trim();
    const zip = String(formData.get("zip") || "").trim();
    const contactName = String(formData.get("contactName") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();

    if (!company) {
      return { error: "Supplier company name is required." };
    }

    const supplierData = {
        company,
        country: country || "United States",
        address1: address1 || null,
        address2: address2 || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
    };
    const supplier = shopifyStorage
      ? await savePoRecord(admin, "supplier", { id: crypto.randomUUID(), ...supplierData, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      : await prisma.supplier.create({ data: supplierData });

    return redirect(`/app/purchase-orders/${params.id}${url.search}&supplierId=${supplier.id}`);
  }

  if (intent === "search-products") {
    const q = String(formData.get("q") || "").trim();
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(
      `
      query SearchProducts($query: String!) {
        products(first: 80, query: $query) {
          nodes {
            id
            title
            featuredImage {
              url
            }
            variants(first: 80) {
              nodes {
                id
                title
                sku
                inventoryQuantity
                image {
                  url
                }
                inventoryItem {
                  id
                  unitCost {
                    amount
                  }
                }
              }
            }
          }
        }
      }
      `,
      {
        variables: {
          query: q || "status:active",
        },
      },
    );

    const json = await response.json();
    const rawProducts = json?.data?.products?.nodes || [];

    const searchResults = rawProducts.flatMap((product) =>
      (product.variants?.nodes || []).map((variant) => ({
        id: `${variant.id || product.id}-${variant.sku || ""}`,
        productTitle: product.title,
        variantTitle: variant.title,
        sku: variant.sku || "",
        variantId: variant.id || "",
        inventoryItemGid: variant.inventoryItem?.id || "",
        currentInventory: Number(variant.inventoryQuantity || 0),
        currentCost: Number(variant.inventoryItem?.unitCost?.amount || 0),
        imageUrl: variant.image?.url || product.featuredImage?.url || "",
      })),
    );

    return { searchResults };
  }

  if (intent === "save-po" || intent === "mark-ordered") {
    const poNumber = String(formData.get("poNumber") || "").trim();
    const supplierId = String(formData.get("supplierId") || "").trim();
    const destinationName = String(formData.get("destinationName") || "").trim();
    const destinationAddr = String(formData.get("destinationAddr") || "").trim();
    const locationGid = String(formData.get("locationGid") || "").trim();

    const estimatedArrival = String(formData.get("estimatedArrival") || "").trim();
    const shippingCarrier = String(formData.get("shippingCarrier") || "").trim();
    const trackingNumber = String(formData.get("trackingNumber") || "").trim();

    const shippingTotal = Number(formData.get("shippingTotal") || 0);
    const dutyTotal = Number(formData.get("dutyTotal") || 0);
    const otherFeesTotal = Number(formData.get("otherFeesTotal") || 0);
    const taxTotal = Number(formData.get("taxTotal") || 0);

    const noteToSupplier = String(formData.get("noteToSupplier") || "").trim();
    const tags = String(formData.get("tags") || "").trim();

    let lines = [];
    try {
      lines = JSON.parse(String(formData.get("linesJson") || "[]"));
    } catch {
      lines = [];
    }

    if (!poNumber || !supplierId) {
      return { error: "PO Number and Supplier are required." };
    }

    const existingPo = shopifyStorage
      ? (await listPoRecords(admin, "purchaseOrder")).find((po) => po.poNumber === poNumber && po.id !== params.id)
      : await prisma.purchaseOrder.findFirst({ where: { poNumber, NOT: { id: params.id } } });

    if (existingPo) {
      return { error: `PO Number ${poNumber} already exists.` };
    }

    const supplier = shopifyStorage
      ? await getPoRecord(admin, "supplier", supplierId)
      : await prisma.supplier.findUnique({ where: { id: supplierId } });

    if (!supplier) {
      return { error: "Selected supplier was not found." };
    }

    const vendorAddress = [
      supplier.address1,
      supplier.address2,
      [supplier.city, supplier.state, supplier.zip].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join("\n");

    const existing = shopifyStorage
      ? await getPoRecord(admin, "purchaseOrder", params.id)
      : await prisma.purchaseOrder.findUnique({ where: { id: params.id }, include: { lines: true } });

    const receivedByVariant = new Map(
      (existing?.lines || []).map((line) => [
        line.variantId || `${line.sku}-${line.productTitle}`,
        Number(line.qtyReceivedTotal || 0),
      ]),
    );

    const resolvedLocationGid = normalizeLocationGid(
      locationGid,
      existing?.locationGid,
      getDefaultLocationGid(),
    );

    const updateData = {
        poNumber,
        vendorName: supplier.company,
        vendorAddress: vendorAddress || null,

        ...(resolvedLocationGid ? { locationGid: resolvedLocationGid } : {}),
        destinationName: destinationName || existing?.destinationName || null,
        destinationAddr: destinationAddr || existing?.destinationAddr || null,

        estimatedArrival: estimatedArrival || null,
        shippingCarrier: shippingCarrier || null,
        trackingNumber: trackingNumber || null,

        shippingTotal,
        dutyTotal,
        otherFeesTotal,
        taxTotal,

        noteToSupplier: noteToSupplier || null,
        tags: tags || null,

        ...(intent === "mark-ordered" ? { status: "ORDERED" } : {}),
    };
    const updatedLines = lines.map((line) => {
      const key = line.variantId || `${line.sku}-${line.productTitle}`;
      const prevReceived = receivedByVariant.get(key) || 0;
      return {
        purchaseOrderId: params.id,
        productTitle: line.productTitle || "", sku: line.sku || "", supplierSku: line.supplierSku || null,
        inventoryItemGid: line.inventoryItemGid || null, variantId: line.variantId || null,
        imageUrl: line.imageUrl || null, currentInventory: Number(line.currentInventory || 0),
        currentCost: Number(line.currentCost || 0), qtyOrdered: Number(line.qtyOrdered || line.qtyReceiving || 1),
        qtyReceiving: Number(line.qtyReceiving || line.qtyOrdered || 1), qtyReceivedTotal: prevReceived,
        itemCost: Number(line.itemCost || 0),
      };
    });
    if (shopifyStorage) {
      if (!existing) return { error: "PO not found." };
      await savePoRecord(admin, "purchaseOrder", { ...existing, ...updateData, supplierId: supplier.id, lines: updatedLines, updatedAt: new Date().toISOString() });
    } else {
      await prisma.purchaseOrder.update({ where: { id: params.id }, data: { supplier: { connect: { id: supplier.id } } } });
      await prisma.purchaseOrder.updateMany({ where: { id: params.id }, data: updateData });
      await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: params.id } });
      if (updatedLines.length) await prisma.purchaseOrderLine.createMany({ data: updatedLines });
    }

    return redirect(`/app/purchase-orders/${params.id}${url.search}`);
  }

  if (intent === "receive-items" || intent === "complete-order") {
    const po = shopifyStorage
      ? await getPoRecord(admin, "purchaseOrder", params.id)
      : await prisma.purchaseOrder.findUnique({ where: { id: params.id }, include: { lines: true } });

    if (!po) {
      return { error: "PO not found." };
    }

    let lines = [];
    try {
      lines = JSON.parse(String(formData.get("linesJson") || "[]"));
    } catch {
      lines = [];
    }

    const locationGid = normalizeLocationGid(
      formData.get("locationGid"),
      po.locationGid,
      getDefaultLocationGid(),
    );

    if (!locationGid) {
      return { error: "This PO does not have a valid Shopify location yet. Save the PO with a valid location before receiving inventory." };
    }

    const { admin } = await authenticate.admin(request);

    const receiptLines = computeReceiptLines({
      lines,
      shippingTotal: Number(formData.get("shippingTotal") || po.shippingTotal || 0),
      dutyTotal: Number(formData.get("dutyTotal") || po.dutyTotal || 0),
      otherFeesTotal: Number(formData.get("otherFeesTotal") || po.otherFeesTotal || 0),
      taxTotal: Number(formData.get("taxTotal") || po.taxTotal || 0),
    });

    for (const line of receiptLines) {
      const qtyReceivingNow = Number(line.qtyReceivingNow || 0);
      if (qtyReceivingNow <= 0) continue;
      if (!line.inventoryItemGid) continue;

      const adjustResponse = await admin.graphql(
        `
        mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
          inventoryAdjustQuantities(input: $input) {
            userErrors {
              field
              message
            }
          }
        }
        `,
        {
          variables: {
            input: {
              reason: "correction",
              name: "available",
              referenceDocumentUri: `po://${po.poNumber}`,
              changes: [
                {
                  delta: qtyReceivingNow,
                  inventoryItemId: line.inventoryItemGid,
                  locationId: locationGid,
                },
              ],
            },
          },
        },
      );

      const adjustJson = await adjustResponse.json();
      const adjustErrors = adjustJson?.data?.inventoryAdjustQuantities?.userErrors || [];
      if (adjustErrors.length) {
        return { error: `Inventory update failed for ${line.sku}: ${adjustErrors[0].message}` };
      }

      const costResponse = await admin.graphql(
        `
        mutation UpdateInventoryItemCost($id: ID!, $input: InventoryItemInput!) {
          inventoryItemUpdate(id: $id, input: $input) {
            userErrors {
              field
              message
            }
            inventoryItem {
              id
            }
          }
        }
        `,
        {
          variables: {
            id: line.inventoryItemGid,
            input: {
              cost: String(Number(line.newWeightedCost).toFixed(2)),
            },
          },
        },
      );

      const costJson = await costResponse.json();
      const costErrors = costJson?.data?.inventoryItemUpdate?.userErrors || [];
      if (costErrors.length) {
        return { error: `Cost update failed for ${line.sku}: ${costErrors[0].message}` };
      }
    }

    const nextStatus = intent === "complete-order"
          ? "RECEIVED"
          : receiptLines.every((l) => Number(l.qtyRemainingAfter) <= 0)
          ? "RECEIVED"
          : receiptLines.some((l) => Number(l.qtyReceivedTotalAfter) > 0)
          ? "PARTIALLY_RECEIVED"
          : po.status;
    const nextLines = receiptLines.map((line) => ({
      purchaseOrderId: params.id,
      productTitle: line.productTitle || "", sku: line.sku || "", supplierSku: line.supplierSku || null,
      inventoryItemGid: line.inventoryItemGid || null, variantId: line.variantId || null,
      imageUrl: line.imageUrl || null, currentInventory: Number(line.currentInventory || 0),
      currentCost: Number(line.currentCost || 0), qtyOrdered: Number(line.qtyOrdered || 0),
      qtyReceiving: Number(line.qtyRemainingAfter || 0), qtyReceivedTotal: Number(line.qtyReceivedTotalAfter || 0),
      itemCost: Number(line.itemCost || 0),
    }));
    if (shopifyStorage) {
      await savePoRecord(admin, "purchaseOrder", { ...po, status: nextStatus, lines: nextLines, updatedAt: new Date().toISOString() });
    } else {
      await prisma.purchaseOrder.updateMany({ where: { id: params.id }, data: { status: nextStatus } });
      await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: params.id } });
      if (nextLines.length) await prisma.purchaseOrderLine.createMany({ data: nextLines });
    }

    return redirect(`/app/purchase-orders/${params.id}${url.search}`);
  }

  return null;
}

export default function PurchaseOrderDetailPage() {
  const { po, suppliers, resolvedLocationGid } = useLoaderData();
  const actionData = useActionData();
  const location = useLocation();
  const navigation = useNavigation();
  const productFetcher = useFetcher();

  const [selectedSupplierId, setSelectedSupplierId] = useState(po.supplierId || "");
  const [estimatedArrival, setEstimatedArrival] = useState(po.estimatedArrival || "");
  const [shippingCarrier, setShippingCarrier] = useState(po.shippingCarrier || "");
  const [trackingNumber, setTrackingNumber] = useState(po.trackingNumber || "");
  const [shippingTotal, setShippingTotal] = useState(Number(po.shippingTotal || 0));
  const [dutyTotal, setDutyTotal] = useState(Number(po.dutyTotal || 0));
  const [otherFeesTotal, setOtherFeesTotal] = useState(Number(po.otherFeesTotal || 0));
  const [taxTotal, setTaxTotal] = useState(Number(po.taxTotal || 0));
  const [productSearch, setProductSearch] = useState("");
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);

  const [selectedProducts, setSelectedProducts] = useState(
    (po.lines || []).map((line) => ({
      productTitle: line.productTitle,
      sku: line.sku,
      supplierSku: line.supplierSku || "",
      qtyOrdered: Number(line.qtyOrdered || 1),
      qtyReceiving: Number(line.qtyReceiving || line.qtyOrdered || 1),
      qtyReceivedTotal: Number(line.qtyReceivedTotal || 0),
      qtyReceivingNow: 0,
      itemCost: Number(line.itemCost || 0),
      currentInventory: Number(line.currentInventory || 0),
      currentCost: Number(line.currentCost || 0),
      inventoryItemGid: line.inventoryItemGid || "",
      variantId: line.variantId || "",
      imageUrl: line.imageUrl || "",
    })),
  );
  const [checkedMap, setCheckedMap] = useState({});

  const selectedSupplier =
    suppliers.find((s) => s.id === selectedSupplierId) || null;

  const searchResults = productFetcher.data?.searchResults || [];

  const selectedProductIds = useMemo(
    () => new Set(selectedProducts.map((p) => p.variantId || `${p.sku}-${p.productTitle}`)),
    [selectedProducts],
  );

  useEffect(() => {
    if (!showProductModal) return;

    const formData = new FormData();
    formData.append("intent", "search-products");
    formData.append("q", productSearch.trim());

    productFetcher.submit(formData, { method: "post" });
  }, [showProductModal, productSearch]);

  const computedLines = computeReceiptLines({
    lines: selectedProducts,
    shippingTotal,
    dutyTotal,
    otherFeesTotal,
    taxTotal,
  });

  function toggleChecked(item) {
    const key = item.variantId || `${item.sku}-${item.productTitle}`;
    setCheckedMap((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  function addCheckedProducts() {
    const toAdd = searchResults.filter((item) => {
      const key = item.variantId || `${item.sku}-${item.productTitle}`;
      return checkedMap[key];
    });

    const existingKeys = new Set(
      selectedProducts.map((item) => item.variantId || `${item.sku}-${item.productTitle}`),
    );

    const normalized = toAdd
      .filter((item) => {
        const key = item.variantId || `${item.sku}-${item.productTitle}`;
        return !existingKeys.has(key);
      })
      .map((item) => ({
        productTitle:
          item.variantTitle && item.variantTitle !== "Default Title"
            ? `${item.productTitle} — ${item.variantTitle}`
            : item.productTitle,
        sku: item.sku || "",
        supplierSku: "",
        qtyOrdered: 1,
        qtyReceiving: 1,
        qtyReceivedTotal: 0,
        qtyReceivingNow: 0,
        itemCost: Number(item.currentCost || 0),
        currentInventory: Number(item.currentInventory || 0),
        currentCost: Number(item.currentCost || 0),
        inventoryItemGid: item.inventoryItemGid || "",
        variantId: item.variantId || "",
        imageUrl: item.imageUrl || "",
      }));

    setSelectedProducts((prev) => [...prev, ...normalized]);
    setShowProductModal(false);
    setCheckedMap({});
  }

  function updateLine(index, field, value) {
    setSelectedProducts((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;

        const numericValue =
          field === "qtyOrdered" ||
          field === "qtyReceiving" ||
          field === "qtyReceivedTotal" ||
          field === "qtyReceivingNow" ||
          field === "itemCost" ||
          field === "currentInventory" ||
          field === "currentCost"
            ? Number(value || 0)
            : value;

        if (field === "qtyOrdered") {
          return {
            ...item,
            qtyOrdered: Number(value || 0),
            qtyReceiving: Number(value || 0),
          };
        }

        if (field === "qtyReceiving" && po.status === "DRAFT") {
          return {
            ...item,
            qtyReceiving: Number(value || 0),
            qtyOrdered: Number(value || 0),
          };
        }

        return {
          ...item,
          [field]: numericValue,
        };
      }),
    );
  }

  function removeLine(index) {
    setSelectedProducts((prev) => prev.filter((_, i) => i !== index));
  }

  const receiptMode = po.status === "ORDERED" || po.status === "PARTIALLY_RECEIVED";

  return (
    <div style={pageStyle}>
      {actionData?.error ? <div style={errorBoxStyle}>{actionData.error}</div> : null}

      <Form method="post">
        <input type="hidden" name="supplierId" value={selectedSupplierId} />
        <input type="hidden" name="destinationName" value={po.destinationName || ""} />
        <input type="hidden" name="destinationAddr" value={po.destinationAddr || ""} />
        <input type="hidden" name="locationGid" value={resolvedLocationGid || ""} />
        <input type="hidden" name="linesJson" value={JSON.stringify(selectedProducts)} />
        <input type="hidden" name="shippingTotal" value={shippingTotal} />
        <input type="hidden" name="dutyTotal" value={dutyTotal} />
        <input type="hidden" name="otherFeesTotal" value={otherFeesTotal} />
        <input type="hidden" name="taxTotal" value={taxTotal} />

        <div style={headerRowStyle}>
          <div>
            <h1 style={pageTitleStyle}>#{po.poNumber}</h1>
            <div style={statusStyle}>{po.status}</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to={`/app/purchase-orders${location.search || ""}`}>
              <button type="button" style={secondaryButtonStyle}>Back</button>
            </Link>

            <button
              type="submit"
              name="intent"
              value="save-po"
              style={secondaryButtonStyle}
              disabled={navigation.state === "submitting"}
            >
              Save Changes
            </button>

            {po.status === "DRAFT" ? (
              <>
                <button
                  type="submit"
                  name="intent"
                  value="mark-ordered"
                  style={saveButtonStyle}
                  disabled={navigation.state === "submitting"}
                >
                  Mark as Ordered
                </button>

                <button
                  type="submit"
                  name="intent"
                  value="delete-draft"
                  style={dangerButtonStyle}
                  disabled={navigation.state === "submitting"}
                  onClick={(e) => {
                    if (!window.confirm("Delete this draft PO?")) {
                      e.preventDefault();
                    }
                  }}
                >
                  Delete Draft
                </button>
              </>
            ) : null}

            {receiptMode ? (
              <>
                <button
                  type="submit"
                  name="intent"
                  value="receive-items"
                  style={saveButtonStyle}
                  disabled={navigation.state === "submitting"}
                >
                  Receive
                </button>

                <button
                  type="submit"
                  name="intent"
                  value="complete-order"
                  style={secondaryButtonStyle}
                  disabled={navigation.state === "submitting"}
                >
                  Complete Order
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div style={topWrapStyle}>
          <section style={topPanelStyleLeft}>
            <div style={panelLabelStyle}>Supplier</div>

            <div style={selectorRowStyle}>
              <select
                value={selectedSupplierId}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "__create_new__") {
                    setShowSupplierModal(true);
                    return;
                  }
                  setSelectedSupplierId(value);
                }}
                style={topSelectStyle}
              >
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.company}
                  </option>
                ))}
                <option value="__create_new__">+ New supplier</option>
              </select>
            </div>

            <div style={subTextStyle}>
              {selectedSupplier
                ? formatSupplierAddress(selectedSupplier)
                : "No supplier selected"}
            </div>
          </section>

          <section style={topPanelStyleRight}>
            <div style={panelLabelStyle}>Destination</div>
            <div style={destinationTitleStyle}>{po.destinationName || "—"}</div>
            <div style={subTextStyle}>{po.destinationAddr || "—"}</div>
          </section>
        </div>

        <section style={shipmentBandStyle}>
          <div style={shipmentTitleStyle}>Shipment details</div>

          <div style={shipmentGridStyle}>
            <div>
              <label style={smallLabelStyle}>Estimated arrival</label>
              <input
                name="estimatedArrival"
                value={estimatedArrival}
                onChange={(e) => setEstimatedArrival(e.target.value)}
                style={compactInputStyle}
                placeholder="YYYY-MM-DD"
              />
            </div>

            <div>
              <label style={smallLabelStyle}>Shipping carrier</label>
              <input
                name="shippingCarrier"
                value={shippingCarrier}
                onChange={(e) => setShippingCarrier(e.target.value)}
                style={compactInputStyle}
                placeholder="Carrier"
              />
            </div>

            <div>
              <label style={smallLabelStyle}>Tracking number</label>
              <input
                name="trackingNumber"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                style={compactInputStyle}
                placeholder="Tracking number"
              />
            </div>
          </div>
        </section>

        <section style={productsCardStyle}>
          <div style={sectionTitleStyle}>Products</div>

          <div style={searchRowStyle}>
            <input
              value={productSearch}
              onFocus={() => setShowProductModal(true)}
              onChange={(e) => {
                setProductSearch(e.target.value);
                if (!showProductModal) setShowProductModal(true);
              }}
              style={searchInputStyle}
              placeholder="Search products"
            />
          </div>

          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Products</Th>
                  <Th>Supp SKU</Th>
                  <Th num>Qty Ord.</Th>
                  <Th num>Qty Rec.</Th>
                  {receiptMode ? <Th num>Rec. Now</Th> : null}
                  <Th num>Remaining</Th>
                  <Th num>PO Cost</Th>
                  <Th num>Total</Th>
                  <Th sep num>Inv. On Hand</Th>
                  <Th num>On-Ground Cost</Th>
                  <Th num>Landed Cost</Th>
                  <Th num>Avg. Cost</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {computedLines.length === 0 ? (
                  <tr>
                    <td colSpan={receiptMode ? 13 : 12} style={emptyTdStyle}>
                      No products added yet.
                    </td>
                  </tr>
                ) : (
                  computedLines.map((line, index) => (
                    <tr key={`${line.variantId || line.sku}-${index}`}>
                      <Td>
                        <div style={productCellStyle}>
                          <div style={thumbStyle}>
                            {line.imageUrl ? (
                              <img src={line.imageUrl} alt={line.productTitle} style={thumbImgStyle} />
                            ) : null}
                          </div>

                          <div>
                            <div style={productTitleStyle}>{line.productTitle}</div>
                            <div style={skuStyle}>{line.sku}</div>
                          </div>
                        </div>
                      </Td>

                      <Td>
                        <input
                          value={line.supplierSku || ""}
                          onChange={(e) => updateLine(index, "supplierSku", e.target.value)}
                          style={inlineInputStyle}
                        />
                      </Td>

                      <Td num>
                        <input
                          type="number"
                          value={line.qtyOrdered}
                          onChange={(e) => updateLine(index, "qtyOrdered", e.target.value)}
                          style={inlineNumberStyle}
                        />
                      </Td>

                      <Td num>{line.qtyReceivedTotal}</Td>

                      {receiptMode ? (
                        <Td num>
                          <input
                            type="number"
                            min="0"
                            max={line.qtyRemaining}
                            value={line.qtyReceivingNow}
                            onChange={(e) => updateLine(index, "qtyReceivingNow", e.target.value)}
                            style={inlineNumberStyle}
                          />
                        </Td>
                      ) : null}

                      <Td num>{line.qtyRemaining}</Td>

                      <Td num>
                        <input
                          type="number"
                          step="0.01"
                          value={line.itemCost}
                          onChange={(e) => updateLine(index, "itemCost", e.target.value)}
                          style={inlineNumberStyle}
                        />
                      </Td>

                      <Td num>{money(line.receiptTotal)}</Td>
                      <Td sep num>{line.currentInventory}</Td>
                      <Td num>{money(line.currentCost)}</Td>
                      <Td num>{money(line.newLandedCost)}</Td>
                      <Td num><strong>{money(line.newWeightedCost)}</strong></Td>

                      <Td>
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          style={deleteButtonStyle}
                        >
                          ×
                        </button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div style={bottomGridStyle}>
          <section style={cardStyle}>
            <div style={sectionTitleStyle}>Additional details</div>

            <div style={{ marginBottom: 10 }}>
              <label style={smallLabelStyle}>PO Number</label>
              <input name="poNumber" defaultValue={po.poNumber} style={compactInputStyle} />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={smallLabelStyle}>Note to supplier</label>
              <textarea
                name="noteToSupplier"
                rows={4}
                defaultValue={po.noteToSupplier || ""}
                style={miniTextareaStyle}
                placeholder="Notes..."
              />
            </div>

            <div>
              <label style={smallLabelStyle}>Tags</label>
              <input
                name="tags"
                defaultValue={po.tags || ""}
                style={compactInputStyle}
                placeholder="spring order"
              />
            </div>
          </section>

          <section style={cardStyle}>
            <div style={sectionTitleStyle}>Cost summary</div>

            <div style={{ marginBottom: 10 }}>
              <label style={smallLabelStyle}>Shipping</label>
              <input
                type="number"
                step="0.01"
                value={shippingTotal}
                onChange={(e) => setShippingTotal(Number(e.target.value || 0))}
                style={compactInputStyle}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={smallLabelStyle}>Duty</label>
              <input
                type="number"
                step="0.01"
                value={dutyTotal}
                onChange={(e) => setDutyTotal(Number(e.target.value || 0))}
                style={compactInputStyle}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={smallLabelStyle}>Other fees</label>
              <input
                type="number"
                step="0.01"
                value={otherFeesTotal}
                onChange={(e) => setOtherFeesTotal(Number(e.target.value || 0))}
                style={compactInputStyle}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={smallLabelStyle}>Tax</label>
              <input
                type="number"
                step="0.01"
                value={taxTotal}
                onChange={(e) => setTaxTotal(Number(e.target.value || 0))}
                style={compactInputStyle}
              />
            </div>
          </section>
        </div>
      </Form>

      {showSupplierModal ? (
        <div style={overlayStyle} onClick={() => setShowSupplierModal(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Create supplier</h2>
              <button type="button" onClick={() => setShowSupplierModal(false)} style={closeButtonStyle}>
                ✕
              </button>
            </div>

            <Form method="post">
              <input type="hidden" name="intent" value="create-supplier" />

              <div style={modalGridStyle}>
                <ModalField label="Company" name="company" />
                <ModalField label="Country/region" name="country" defaultValue="United States" />
                <ModalField label="Address" name="address1" />
                <ModalField label="Apartment, suite, etc" name="address2" />
                <ModalField label="City" name="city" />
                <ModalField label="State" name="state" />
                <ModalField label="ZIP code" name="zip" />
                <ModalField label="Contact name" name="contactName" />
                <ModalField label="Email address" name="email" />
                <ModalField label="Phone number" name="phone" />
              </div>

              <div style={modalFooterStyle}>
                <button type="button" onClick={() => setShowSupplierModal(false)} style={secondaryButtonStyle}>
                  Close
                </button>
                <button type="submit" style={saveButtonStyle}>
                  Save
                </button>
              </div>
            </Form>
          </div>
        </div>
      ) : null}

      {showProductModal ? (
        <div style={overlayStyle} onClick={() => setShowProductModal(false)}>
          <div style={productModalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Add products</h2>
              <button type="button" onClick={() => setShowProductModal(false)} style={closeButtonStyle}>
                ✕
              </button>
            </div>

            <div style={{ padding: 16 }}>
              <div style={searchModalRowStyle}>
                <input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  style={searchInputStyle}
                  placeholder="Search products"
                />
              </div>

              <div style={productListStyle}>
                {searchResults.length === 0 ? (
                  <div style={emptySearchStyle}>Search for products or SKU.</div>
                ) : (
                  searchResults.map((item, index) => {
                    const key = item.variantId || `${item.sku}-${item.productTitle}`;
                    const checked = !!checkedMap[key];
                    const alreadySelected = selectedProductIds.has(key);

                    return (
                      <div key={`${key}-${index}`} style={productResultRowStyle}>
                        <div>
                          <input
                            type="checkbox"
                            checked={checked || alreadySelected}
                            disabled={alreadySelected}
                            onChange={() => toggleChecked(item)}
                          />
                        </div>

                        <div style={thumbStyle}>
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.productTitle} style={thumbImgStyle} />
                          ) : null}
                        </div>

                        <div style={{ flex: 1 }}>
                          <div style={productTitleStyle}>
                            {item.productTitle}
                            {item.variantTitle && item.variantTitle !== "Default Title"
                              ? ` — ${item.variantTitle}`
                              : ""}
                          </div>
                          <div style={skuStyle}>
                            {item.sku || "No SKU"}
                            {alreadySelected ? " • Item already selected" : ""}
                          </div>
                        </div>

                        <div style={{ width: 54, textAlign: "right" }}>
                          <div style={smallLabelStyle}>Available</div>
                          <div style={infoValueStyle}>{item.currentInventory}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div style={modalFooterStyle}>
              <button type="button" onClick={() => setShowProductModal(false)} style={secondaryButtonStyle}>
                Cancel
              </button>
              <button type="button" onClick={addCheckedProducts} style={saveButtonStyle}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModalField({ label, name, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={smallLabelStyle}>{label}</label>
      <input name={name} style={compactInputStyle} {...props} />
    </div>
  );
}

function formatSupplierAddress(supplier) {
  return [
    supplier.address1,
    supplier.address2,
    [supplier.city, supplier.state, supplier.zip].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" ");
}

function computeReceiptLines(poLike) {
  const extraCharges =
    Number(poLike.shippingTotal || 0) +
    Number(poLike.dutyTotal || 0) +
    Number(poLike.otherFeesTotal || 0) +
    Number(poLike.taxTotal || 0);

  const normalizedLines = (poLike.lines || []).map((line) => {
    const qtyOrdered = Number(line.qtyOrdered || 0);
    const qtyReceivedTotal = Number(line.qtyReceivedTotal || 0);
    const qtyReceiving = Number(line.qtyReceiving || qtyOrdered || 0);
    const qtyReceivingNow = Math.max(0, Number(line.qtyReceivingNow || 0));
    const qtyRemaining = Math.max(0, qtyOrdered - qtyReceivedTotal);

    const displayQty =
      qtyReceivingNow > 0
        ? qtyReceivingNow
        : qtyRemaining > 0
        ? qtyRemaining
        : qtyReceiving;

    return {
      ...line,
      qtyOrdered,
      qtyReceivedTotal,
      qtyReceiving,
      qtyReceivingNow,
      qtyRemaining,
      displayQty,
    };
  });

  const subtotal = normalizedLines.reduce((sum, line) => {
    return sum + line.qtyReceivingNow * Number(line.itemCost || 0);
  }, 0);

  return normalizedLines.map((line) => {
    const itemCost = Number(line.itemCost || 0);
    const currentInventory = Number(line.currentInventory || 0);
    const currentCost = Number(line.currentCost || 0);

    const receiptQty = line.qtyReceivingNow;
    // Only the quantity actually received belongs in the inventory cost average.
    // The previous displayQty fallback could average unreceived units on partial receipts.
    const displayTotal = receiptQty * itemCost;
    const allocatedExtra = subtotal > 0 ? (displayTotal / subtotal) * extraCharges : 0;
    const newLandedCost = receiptQty > 0 ? (displayTotal + allocatedExtra) / receiptQty : 0;
    const newWeightedCost =
      currentInventory + receiptQty > 0
        ? ((currentInventory * currentCost) + (receiptQty * newLandedCost)) /
          (currentInventory + receiptQty)
        : currentCost;

    const qtyReceivedTotalAfter = line.qtyReceivedTotal + receiptQty;
    const qtyRemainingAfter = Math.max(0, line.qtyOrdered - qtyReceivedTotalAfter);

    return {
      ...line,
      receiptQty,
      receiptTotal: displayTotal,
      newLandedCost,
      newWeightedCost,
      qtyReceivedTotalAfter,
      qtyRemainingAfter,
    };
  });
}

function Th({ children, num = false, sep = false }) {
  return (
    <th
      style={{
        textAlign: num ? "right" : "left",
        borderLeft: sep ? "2px solid #e5e7eb" : "none",
        padding: "9px 6px",
        borderBottom: "1px solid #e5e7eb",
        fontSize: 12,
        color: "#374151",
        whiteSpace: "normal",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, num = false, sep = false }) {
  return (
    <td
      style={{
        textAlign: num ? "right" : "left",
        borderLeft: sep ? "2px solid #f0f0f0" : "none",
        padding: "8px 6px",
        borderBottom: "1px solid #f0f0f0",
        verticalAlign: "middle",
        whiteSpace: "normal",
      }}
    >
      {children}
    </td>
  );
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

const pageStyle = {
  padding: 12,
  maxWidth: 1280,
  margin: "0 auto",
};

const headerRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 14,
};

const pageTitleStyle = {
  margin: 0,
  fontSize: 24,
  fontWeight: 700,
};

const statusStyle = {
  marginTop: 6,
  color: "#2563eb",
  fontSize: 12,
  fontWeight: 700,
};

const topWrapStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  border: "1px solid #d9d9d9",
  borderRadius: 14,
  overflow: "hidden",
  background: "#fff",
};

const topPanelStyleLeft = {
  padding: "12px 14px 10px 14px",
  borderRight: "1px solid #e5e7eb",
};

const topPanelStyleRight = {
  padding: "12px 14px 10px 14px",
};

const panelLabelStyle = {
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 8,
  color: "#374151",
  letterSpacing: "0.01em",
};

const selectorRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
};

const topSelectStyle = {
  flex: 1,
  height: 42,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 15,
  fontWeight: 650,
  background: "#fff",
  color: "#111827",
  outline: "none",
};

const destinationTitleStyle = {
  fontSize: 18,
  fontWeight: 650,
  color: "#111827",
  marginBottom: 6,
};

const subTextStyle = {
  fontSize: 12,
  color: "#6b7280",
  lineHeight: 1.45,
  minHeight: 18,
};

const shipmentBandStyle = {
  marginTop: 10,
  background: "#fff",
  border: "1px solid #d9d9d9",
  borderRadius: 14,
  padding: "10px 12px",
};

const shipmentTitleStyle = {
  fontSize: 14,
  fontWeight: 700,
  marginBottom: 10,
  color: "#333",
};

const shipmentGridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 8,
};

const productsCardStyle = {
  marginTop: 10,
  background: "#fff",
  border: "1px solid #d9d9d9",
  borderRadius: 14,
  padding: 12,
};

const sectionTitleStyle = {
  fontSize: 14,
  fontWeight: 700,
  marginBottom: 10,
  color: "#333",
};

const searchRowStyle = {
  display: "flex",
  gap: 10,
};

const compactInputStyle = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  boxSizing: "border-box",
  fontSize: 14,
  background: "#fff",
  color: "#111827",
};

const miniTextareaStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  boxSizing: "border-box",
  fontSize: 12,
  resize: "vertical",
  background: "#fff",
  color: "#111827",
};

const searchInputStyle = {
  flex: 1,
  height: 42,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 14,
  background: "#fff",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 980,
};

const productCellStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 150,
};

const thumbStyle = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  overflow: "hidden",
  flexShrink: 0,
};

const thumbImgStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const productTitleStyle = {
  fontSize: 14,
  fontWeight: 600,
  color: "#1f2937",
  whiteSpace: "normal",
};

const skuStyle = {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 2,
};

const inlineInputStyle = {
  width: 78,
  height: 32,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 12,
};

const inlineNumberStyle = {
  width: 54,
  height: 32,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 12,
  textAlign: "right",
};

const emptyTdStyle = {
  padding: 18,
  color: "#6b7280",
  textAlign: "left",
};

const deleteButtonStyle = {
  border: "none",
  background: "transparent",
  color: "#999",
  fontSize: 20,
  cursor: "pointer",
};

const bottomGridStyle = {
  display: "grid",
  gridTemplateColumns: "1.2fr 0.8fr",
  gap: 8,
  marginTop: 10,
};

const cardStyle = {
  background: "#fff",
  border: "1px solid #d9d9d9",
  borderRadius: 14,
  padding: 12,
};

const smallLabelStyle = {
  display: "block",
  marginBottom: 4,
  fontSize: 12,
  fontWeight: 600,
  color: "#555",
};

const infoValueStyle = {
  fontSize: 14,
  color: "#111827",
};

const footerRowStyle = {
  marginTop: 10,
  display: "flex",
  justifyContent: "flex-end",
};

const saveButtonStyle = {
  padding: "10px 16px",
  borderRadius: 9,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  padding: "10px 16px",
  borderRadius: 9,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  fontWeight: 600,
  cursor: "pointer",
};

const dangerButtonStyle = {
  padding: "10px 16px",
  borderRadius: 9,
  border: "1px solid #b91c1c",
  background: "#fff",
  color: "#b91c1c",
  fontWeight: 700,
  cursor: "pointer",
};

const errorBoxStyle = {
  marginBottom: 12,
  padding: 10,
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const modalStyle = {
  width: 640,
  maxWidth: "92vw",
  background: "#fff",
  borderRadius: 16,
  border: "1px solid #ddd",
  boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
  overflow: "hidden",
};

const productModalStyle = {
  width: 760,
  maxWidth: "96vw",
  background: "#fff",
  borderRadius: 16,
  border: "1px solid #ddd",
  boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
  overflow: "hidden",
};

const modalHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 18px",
  borderBottom: "1px solid #eee",
};

const closeButtonStyle = {
  border: "none",
  background: "transparent",
  fontSize: 20,
  cursor: "pointer",
};

const modalGridStyle = {
  padding: 18,
};

const modalFooterStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  padding: "0 18px 18px 18px",
};

const searchModalRowStyle = {
  display: "flex",
  gap: 10,
  marginBottom: 14,
};

const productListStyle = {
  maxHeight: 420,
  overflowY: "auto",
  border: "1px solid #ececec",
  borderRadius: 12,
};

const productResultRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px",
  borderBottom: "1px solid #f0f0f0",
  background: "#fff",
};

const emptySearchStyle = {
  padding: 20,
  color: "#6b7280",
};