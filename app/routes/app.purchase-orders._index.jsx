import { Link, useLoaderData, useLocation } from "react-router";
import prisma from "../db.server";

export async function loader() {
  const pos = await prisma.purchaseOrder.findMany({
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });

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
