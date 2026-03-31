import {
  Form,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { useEffect, useMemo, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

async function getShopifyLocations(request) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `
    query GetLocations {
      locations(first: 25) {
        nodes {
          id
          name
          address {
            address1
            address2
            city
            provinceCode
            zip
          }
        }
      }
    }
    `,
  );

  const json = await response.json();
  const nodes = json?.data?.locations?.nodes || [];

  return nodes.map((location) => ({
    id: location.id,
    name: location.name || "Store",
    address1: location.address?.address1 || "",
    address2: location.address?.address2 || "",
    city: location.address?.city || "",
    provinceCode: location.address?.provinceCode || "",
    zip: location.address?.zip || "",
  }));
}

function buildDestination(location) {
  return {
    storeName: "IMRC Racing N Repair",
    destinationName: location?.name || "717 West 5th Avenue",
    destinationAddr:
      [
        location?.address1,
        location?.address2,
        [location?.city, location?.provinceCode, location?.zip].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .join(", ") || "717 West 5th Avenue, Warren, PA",
    locationGid: location?.id || "",
  };
}

async function fetchLiveVariantSnapshots(admin, lines) {
  const variantIds = Array.from(
    new Set(
      (lines || [])
        .map((line) => String(line?.variantId || "").trim())
        .filter(Boolean),
    ),
  );

  if (!variantIds.length) {
    return new Map();
  }

  const snapshots = new Map();

  for (let i = 0; i < variantIds.length; i += 100) {
    const batchIds = variantIds.slice(i, i + 100);

    const response = await admin.graphql(
      `
      query GetLiveVariantSnapshots($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            sku
            inventoryQuantity
            image {
              url
            }
            product {
              title
              featuredImage {
                url
              }
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
      `,
      {
        variables: { ids: batchIds },
      },
    );

    const json = await response.json();
    const nodes = json?.data?.nodes || [];

    for (const node of nodes) {
      if (!node?.id) continue;
      snapshots.set(node.id, {
        variantId: node.id,
        sku: node.sku || "",
        currentInventory: Number(node.inventoryQuantity || 0),
        currentCost: Number(node.inventoryItem?.unitCost?.amount || 0),
        inventoryItemGid: node.inventoryItem?.id || "",
        imageUrl: node.image?.url || node.product?.featuredImage?.url || "",
      });
    }
  }

  return snapshots;
}

function mergeLiveLineData(lines, snapshots) {
  return (lines || []).map((line) => {
    const live = snapshots.get(line?.variantId);
    if (!live) return line;

    return {
      ...line,
      sku: live.sku || line.sku || "",
      currentInventory: Number(live.currentInventory || 0),
      currentCost: Number(live.currentCost || 0),
      inventoryItemGid: live.inventoryItemGid || line.inventoryItemGid || "",
      imageUrl: live.imageUrl || line.imageUrl || "",
    };
  });
}

export async function loader({ request }) {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { company: "asc" },
  });

  const locations = await getShopifyLocations(request);
  const defaultDestination = buildDestination(locations[0] || null);

  const existingPoNumbers = await prisma.purchaseOrder.findMany({
    select: { poNumber: true },
  });

  let highestPoNumber = 0;
  for (const row of existingPoNumbers) {
    const match = String(row?.poNumber || "").match(/(\d+)/);
    const value = match ? Number(match[1]) : 0;
    if (value > highestPoNumber) highestPoNumber = value;
  }

  const nextPoNumber = `PO${highestPoNumber + 1}`;

  return {
    suppliers,
    locations,
    defaultDestination,
    nextPoNumber,
  };
}

export async function action({ request }) {
  const formData = await request.formData();
  const url = new URL(request.url);
  const intent = String(formData.get("intent") || "");

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

    const supplier = await prisma.supplier.create({
      data: {
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
      },
    });

    const next = new URLSearchParams(url.search);
    next.set("supplierId", supplier.id);
    next.delete("createSupplier");

    return redirect(`/app/purchase-orders/new?${next.toString()}`);
  }

  if (intent === "search-products") {
    const q = String(formData.get("q") || "").trim();
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(
      `
      query SearchProducts($query: String!) {
        products(first: 25, query: $query) {
          nodes {
            id
            title
            featuredImage {
              url
            }
            variants(first: 25) {
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

  const supplierId = String(formData.get("supplierId") || "").trim();
  const poNumber = String(formData.get("poNumber") || "").trim();
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

  const existingPo = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
  });

  if (existingPo) {
    return { error: `PO Number ${poNumber} already exists.` };
  }

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  });

  if (!supplier) {
    return { error: "Selected supplier was not found." };
  }

  if (!locationGid) {
    return { error: "Please select a store destination before saving this PO." };
  }

  if (lines.length) {
    const { admin } = await authenticate.admin(request);
    const liveSnapshots = await fetchLiveVariantSnapshots(admin, lines);
    lines = mergeLiveLineData(lines, liveSnapshots);
  }

  const vendorAddress = [
    supplier.address1,
    supplier.address2,
    [supplier.city, supplier.state, supplier.zip].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join("\n");

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      supplierId: supplier.id,
      vendorName: supplier.company,
      vendorAddress: vendorAddress || null,

      locationGid,
      destinationName: destinationName || null,
      destinationAddr: destinationAddr || null,

      estimatedArrival: estimatedArrival || null,
      shippingCarrier: shippingCarrier || null,
      trackingNumber: trackingNumber || null,

      shippingTotal,
      dutyTotal,
      otherFeesTotal,
      taxTotal,

      noteToSupplier: noteToSupplier || null,
      tags: tags || null,

      referenceNumber: "IMRC Racing N Repair",
      status: "DRAFT",

      lines: {
        create: lines.map((line) => ({
          productTitle: line.productTitle || "",
          sku: line.sku || "",
          supplierSku: line.supplierSku || null,
          inventoryItemGid: line.inventoryItemGid || null,
          variantId: line.variantId || null,
          imageUrl: line.imageUrl || null,
          currentInventory: Number(line.currentInventory || 0),
          currentCost: Number(line.currentCost || 0),
          qtyOrdered: Number(line.qtyOrdered || line.qtyReceiving || 1),
          qtyReceiving: Number(line.qtyOrdered || line.qtyReceiving || 1),
          itemCost: Number(line.itemCost || 0),
        })),
      },
    },
  });

  return redirect(`/app/purchase-orders/${po.id}${url.search}`);
}

export default function NewPurchaseOrderPage() {
  const { suppliers, locations, defaultDestination, nextPoNumber } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const productFetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();

  const [shippingTotal, setShippingTotal] = useState(0);
  const [dutyTotal, setDutyTotal] = useState(0);
  const [otherFeesTotal, setOtherFeesTotal] = useState(0);
  const [taxTotal, setTaxTotal] = useState(0);
  const [productSearch, setProductSearch] = useState("");
  const [selectedLocationGid, setSelectedLocationGid] = useState(defaultDestination.locationGid);
  const [destinationName, setDestinationName] = useState(defaultDestination.destinationName);
  const [destinationAddr, setDestinationAddr] = useState(defaultDestination.destinationAddr);

  const selectedSupplierId = searchParams.get("supplierId") || "";
  const showSupplierModal = searchParams.get("createSupplier") === "1";
  const showProductModal = searchParams.get("addProducts") === "1";

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId) || null;

  const [selectedProducts, setSelectedProducts] = useState([]);
  const [checkedMap, setCheckedMap] = useState({});

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

  function handleLocationChange(value) {
    setSelectedLocationGid(value);
    const selectedLocation = locations.find((loc) => loc.id === value);
    const destination = buildDestination(selectedLocation || null);
    setDestinationName(destination.destinationName);
    setDestinationAddr(destination.destinationAddr);
  }

  function openSupplierModal() {
    const next = new URLSearchParams(searchParams);
    next.set("createSupplier", "1");
    setSearchParams(next);
  }

  function closeSupplierModal() {
    const next = new URLSearchParams(searchParams);
    next.delete("createSupplier");
    setSearchParams(next);
  }

  function chooseSupplier(id) {
    const next = new URLSearchParams(searchParams);
    next.set("supplierId", id);
    next.delete("createSupplier");
    setSearchParams(next);
  }

  function openProductModal() {
    const next = new URLSearchParams(searchParams);
    next.set("addProducts", "1");
    setSearchParams(next);
  }

  function closeProductModal() {
    const next = new URLSearchParams(searchParams);
    next.delete("addProducts");
    setSearchParams(next);
    setCheckedMap({});
  }

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
        itemCost: Number(item.currentCost || 0),
        currentInventory: Number(item.currentInventory || 0),
        currentCost: Number(item.currentCost || 0),
        inventoryItemGid: item.inventoryItemGid || "",
        variantId: item.variantId || "",
        imageUrl: item.imageUrl || "",
      }));

    setSelectedProducts((prev) => [...prev, ...normalized]);
    closeProductModal();
  }

  function updateLine(index, field, value) {
    setSelectedProducts((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;

        const numericValue =
          field === "qtyOrdered" ||
          field === "qtyReceiving" ||
          field === "itemCost" ||
          field === "currentInventory" ||
          field === "currentCost"
            ? Number(value || 0)
            : value;

        if (field === "qtyReceiving" || field === "qtyOrdered") {
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

  const computedLines = computeDraftLines({
    lines: selectedProducts,
    shippingTotal,
    dutyTotal,
    otherFeesTotal,
    taxTotal,
  });

  return (
    <div style={pageStyle}>
      {actionData?.error ? <div style={errorBoxStyle}>{actionData.error}</div> : null}

      <Form method="post">
        <input type="hidden" name="supplierId" value={selectedSupplierId} />
        <input type="hidden" name="destinationName" value={destinationName} />
        <input type="hidden" name="destinationAddr" value={destinationAddr} />
        <input type="hidden" name="locationGid" value={selectedLocationGid} />
        <input type="hidden" name="linesJson" value={JSON.stringify(selectedProducts)} />

        <div style={topWrapStyle}>
          <section style={topPanelStyleLeft}>
            <div style={panelLabelStyle}>Supplier</div>

            <div style={selectorRowStyle}>
              <select
                value={selectedSupplierId}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "__create_new__") {
                    openSupplierModal();
                    return;
                  }
                  chooseSupplier(value);
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
              {selectedSupplier ? formatSupplierAddress(selectedSupplier) : "No supplier selected"}
            </div>
          </section>

          <section style={topPanelStyleRight}>
            <div style={panelLabelStyle}>Destination Store</div>
            <select
              value={selectedLocationGid}
              onChange={(e) => handleLocationChange(e.target.value)}
              style={topSelectStyle}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <div style={{ ...subTextStyle, marginTop: 8 }}>{destinationAddr}</div>
          </section>
        </div>

        <section style={shipmentBandStyle}>
          <div style={shipmentTitleStyle}>Shipment details</div>

          <div style={shipmentGridStyle}>
            <div>
              <label style={smallLabelStyle}>Estimated arrival</label>
              <input name="estimatedArrival" style={compactInputStyle} placeholder="YYYY-MM-DD" />
            </div>

            <div>
              <label style={smallLabelStyle}>Shipping carrier</label>
              <input name="shippingCarrier" style={compactInputStyle} placeholder="Carrier" />
            </div>

            <div>
              <label style={smallLabelStyle}>Tracking number</label>
              <input name="trackingNumber" style={compactInputStyle} placeholder="Tracking number" />
            </div>
          </div>
        </section>

        <section style={productsCardStyle}>
          <div style={sectionTitleStyle}>Add products</div>

          <div style={searchRowStyle}>
            <input
              value={productSearch}
              onFocus={openProductModal}
              onChange={(e) => {
                const value = e.target.value;
                setProductSearch(value);
                if (!showProductModal) openProductModal();
              }}
              style={searchInputStyle}
              placeholder="Search products"
            />
            <button type="button" onClick={openProductModal} style={browseButtonStyle}>
              Browse
            </button>
          </div>

          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Products</Th>
                  <Th>Supp SKU</Th>
                  <Th num>Qty</Th>
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
                    <td colSpan="10" style={emptyTdStyle}>
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
                          value={line.qtyReceiving}
                          onChange={(e) => updateLine(index, "qtyReceiving", e.target.value)}
                          style={inlineNumberStyle}
                        />
                      </Td>

                      <Td num>
                        <input
                          type="number"
                          step="0.01"
                          value={line.itemCost}
                          onChange={(e) => updateLine(index, "itemCost", e.target.value)}
                          style={inlineNumberStyle}
                        />
                      </Td>

                      <Td num>{money(line.total)}</Td>
                      <Td sep num>{line.currentInventory}</Td>
                      <Td num>{money(line.currentCost)}</Td>
                      <Td num>{money(line.newLandedCost)}</Td>
                      <Td num><strong>{money(line.newAverageCost)}</strong></Td>

                      <Td>
                        <button type="button" onClick={() => removeLine(index)} style={deleteButtonStyle}>
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
              <input name="poNumber" defaultValue={nextPoNumber} style={compactInputStyle} />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={smallLabelStyle}>Note to supplier</label>
              <textarea name="noteToSupplier" rows={4} style={miniTextareaStyle} placeholder="Notes..." />
            </div>

            <div>
              <label style={smallLabelStyle}>Tags</label>
              <input name="tags" style={compactInputStyle} placeholder="spring order" />
            </div>
          </section>

          <section style={cardStyle}>
            <div style={sectionTitleStyle}>Cost summary</div>

            <div style={{ marginBottom: 10 }}>
              <label style={smallLabelStyle}>Shipping</label>
              <input
                name="shippingTotal"
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
                name="dutyTotal"
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
                name="otherFeesTotal"
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
                name="taxTotal"
                type="number"
                step="0.01"
                value={taxTotal}
                onChange={(e) => setTaxTotal(Number(e.target.value || 0))}
                style={compactInputStyle}
              />
            </div>
          </section>
        </div>

        <div style={footerRowStyle}>
          <button type="submit" style={saveButtonStyle} disabled={navigation.state === "submitting"}>
            {navigation.state === "submitting" ? "Saving..." : "Save PO"}
          </button>
        </div>
      </Form>

      {showSupplierModal ? (
        <div style={overlayStyle} onClick={closeSupplierModal}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Create supplier</h2>
              <button type="button" onClick={closeSupplierModal} style={closeButtonStyle}>
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
                <button type="button" onClick={closeSupplierModal} style={secondaryButtonStyle}>
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
        <div style={overlayStyle} onClick={closeProductModal}>
          <div style={productModalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Add products</h2>
              <button type="button" onClick={closeProductModal} style={closeButtonStyle}>
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

                        <div style={{ width: 62, textAlign: "right" }}>
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
              <button type="button" onClick={closeProductModal} style={secondaryButtonStyle}>
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

function computeDraftLines(poLike) {
  const extraCharges =
    Number(poLike.shippingTotal || 0) +
    Number(poLike.dutyTotal || 0) +
    Number(poLike.otherFeesTotal || 0) +
    Number(poLike.taxTotal || 0);

  const subtotal = (poLike.lines || []).reduce((sum, line) => {
    const qty = Number(line.qtyReceiving || line.qtyOrdered || 0);
    return sum + qty * Number(line.itemCost || 0);
  }, 0);

  return (poLike.lines || []).map((line) => {
    const qty = Number(line.qtyReceiving || line.qtyOrdered || 0);
    const itemCost = Number(line.itemCost || 0);
    const currentInventory = Number(line.currentInventory || 0);
    const currentCost = Number(line.currentCost || 0);

    const total = qty * itemCost;
    const allocatedExtra = subtotal > 0 ? (total / subtotal) * extraCharges : 0;
    const newLandedCost = qty > 0 ? (total + allocatedExtra) / qty : 0;
    const newAverageCost =
      currentInventory + qty > 0
        ? ((currentInventory * currentCost) + qty * newLandedCost) /
          (currentInventory + qty)
        : 0;

    return {
      ...line,
      total,
      newLandedCost,
      newAverageCost,
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
        whiteSpace: "nowrap",
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
  maxWidth: 1120,
  margin: "0 auto",
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

const browseButtonStyle = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#fff",
  color: "#111",
  fontWeight: 600,
  cursor: "pointer",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 900,
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
