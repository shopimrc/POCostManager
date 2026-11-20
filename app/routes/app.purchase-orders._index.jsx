import { Link, useLoaderData, useLocation } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { listPoRecords } from "../lib/shopify-po-storage.server.js";

export async function loader({ request }) {
  // Keep the live Prisma path until the migration and auth cutover are complete.
  if (process.env.IMRC_PO_STORAGE !== "shopify") {
    const pos = await prisma.purchaseOrder.findMany({
      include: { lines: true },
      orderBy: { createdAt: "desc" },
    });
    return { pos };
  }

  const { admin } = await authenticate.admin(request);
  const records = await listPoRecords(admin, "purchaseOrder");
  const pos = records
    .map((po) => ({ ...po, lines: Array.isArray(po.lines) ? po.lines : [] }))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return { pos };
}

export default function PurchaseOrdersIndex() {
  const { pos } = useLoaderData();
  const location = useLocation();

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 16px", color: "#1f2937", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Purchase Orders</h1>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>{pos.length} purchase order{pos.length === 1 ? "" : "s"}</p>
        </div>
        <Link to={`/app/purchase-orders/new${location.search}`} style={{ background: "#111827", color: "white", textDecoration: "none", padding: "11px 16px", borderRadius: 9, fontWeight: 600, fontSize: 14 }}>+ Create New PO</Link>
      </header>
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflowX: "auto", background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, tableLayout: "fixed" }}>
          <thead style={{ background: "#f9fafb" }}>
            <tr>
              {["PO #", "Supplier", "Status", "Products"].map((heading, i) => (
                <th key={heading} style={{ width: i === 1 ? "40%" : "20%", textAlign: i === 3 ? "right" : "left", padding: "14px 18px", fontSize: 12, color: "#4b5563", borderBottom: "1px solid #e5e7eb" }}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pos.length === 0 ? <tr><td colSpan={4} style={{ padding: 36, textAlign: "center", color: "#6b7280" }}>No purchase orders yet. Create your first PO to get started.</td></tr> : pos.map((po) => (
              <tr key={po.id}>
                <td style={{ padding: "16px 18px", borderBottom: "1px solid #f3f4f6", fontWeight: 600 }}>
                  <Link style={{ color: "#2563eb", textDecoration: "none" }} to={`/app/purchase-orders/${po.id}${location.search}`}>{po.poNumber}</Link>
                </td>
                <td style={{ padding: "16px 18px", borderBottom: "1px solid #f3f4f6" }}>{po.vendorName}</td>
                <td style={{ padding: "16px 18px", borderBottom: "1px solid #f3f4f6" }}>
                  <span style={{ display: "inline-block", borderRadius: 20, background: po.status === "RECEIVED" ? "#dcfce7" : "#eff6ff", color: po.status === "RECEIVED" ? "#166534" : "#1d4ed8", padding: "5px 10px", fontSize: 12, fontWeight: 700 }}>{po.status}</span>
                </td>
                <td style={{ padding: "16px 18px", borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>{po.lines.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
