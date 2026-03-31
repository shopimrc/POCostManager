import { authenticate } from "../shopify.server";

export async function getSingleStoreLocation(request) {
  try {
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(`
      query GetSingleStoreLocation {
        locations(first: 1) {
          nodes {
            id
            name
            address {
              address1
              address2
              city
              province
              provinceCode
              zip
            }
          }
        }
      }
    `);

    const json = await response.json();
    const location = json?.data?.locations?.nodes?.[0] || null;

    if (!location) return null;

    return {
      id: location.id || "",
      name: location.name || "",
      address1: location.address?.address1 || "",
      address2: location.address?.address2 || "",
      city: location.address?.city || "",
      province: location.address?.province || "",
      provinceCode: location.address?.provinceCode || "",
      zip: location.address?.zip || "",
    };
  } catch (error) {
    console.warn("[shopify-location] Unable to read locations. Falling back to manual destination.", {
      message: error?.message || String(error),
    });
    return null;
  }
}
