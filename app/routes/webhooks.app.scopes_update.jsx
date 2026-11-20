import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;

  if (session) {
    if (process.env.IMRC_PO_STORAGE === "shopify") {
      await sessionStorage.updateSessionsScope(shop, current.toString());
    } else await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: current.toString(),
      },
    });
  }

  return new Response();
};
