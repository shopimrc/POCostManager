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
    <div style={{ padding: 20 }}>
      <h1>Purchase Orders</h1>

      <Link to={`/app/purchase-orders/new${location.search}`}>
        <button>Create New PO</button>
      </Link>

      <table style={{ width: "100%", marginTop: 20 }}>
        <thead>
          <tr>
            <th>PO #</th>
            <th>Vendor</th>
            <th>Status</th>
            <th>Lines</th>
          </tr>
        </thead>
        <tbody>
          {pos.map((po) => (
            <tr key={po.id}>
              <td>
                <Link to={`/app/purchase-orders/${po.id}${location.search}`}>
                  {po.poNumber}
                </Link>
              </td>
              <td>{po.vendorName}</td>
              <td>{po.status}</td>
              <td>{po.lines.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
