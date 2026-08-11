export async function searchProducts(admin, { query, cursor, direction = 'next', limit = 10 }) {
  const isNext = direction === 'next';
  const first = isNext ? limit : null;
  const last = isNext ? null : limit;
  const after = isNext && cursor ? cursor : null;
  const before = !isNext && cursor ? cursor : null;

  // Shopify query syntax allows matching title and sku.
  const searchQuery = query ? `title:*${query}* OR sku:*${query}*` : "";

  const graphqlQuery = `#graphql
    query SearchProducts($query: String, $first: Int, $last: Int, $after: String, $before: String) {
      products(first: $first, last: $last, after: $after, before: $before, query: $query) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        nodes {
          id
          title
          status
          featuredImage {
            url
            altText
          }
          variants(first: 100) {
            nodes {
              id
              title
              sku
              price
              compareAtPrice
            }
          }
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(graphqlQuery, {
      variables: {
        query: searchQuery,
        first,
        last,
        after,
        before
      }
    });

    const json = await response.json();

    if (json.errors) {
      console.error("GraphQL Errors:", json.errors);
      throw new Error(json.errors[0]?.message || "GraphQL Error");
    }

    return json.data.products;
  } catch (error) {
    console.error("Failed to fetch products:", error);
    throw new Error(error.message || "Network failure");
  }
}

export async function searchCollections(admin, { query, cursor, direction = 'next', limit = 10 }) {
  const isNext = direction === 'next';
  const first = isNext ? limit : null;
  const last = isNext ? null : limit;
  const after = isNext && cursor ? cursor : null;
  const before = !isNext && cursor ? cursor : null;

  const searchQuery = query ? `title:*${query}*` : "";

  const graphqlQuery = `#graphql
    query SearchCollections($query: String, $first: Int, $last: Int, $after: String, $before: String) {
      collections(first: $first, last: $last, after: $after, before: $before, query: $query) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        nodes {
          id
          title
          productsCount {
            count
          }
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(graphqlQuery, {
      variables: { query: searchQuery, first, last, after, before }
    });
    const json = await response.json();
    if (json.errors) throw new Error(json.errors[0]?.message || "GraphQL Error");
    return json.data.collections;
  } catch (error) {
    console.error("Failed to fetch collections:", error);
    throw new Error(error.message || "Network failure");
  }
}

export async function getCollectionProductsWithVariants(admin, collectionId, collectionSalePrice) {
  let hasNextPage = true;
  let cursor = null;
  const allItems = [];

  const graphqlQuery = `#graphql
    query GetCollectionProducts($id: ID!, $first: Int!, $after: String) {
      collection(id: $id) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            featuredImage {
              url
              altText
            }
            variants(first: 100) {
              nodes {
                id
                title
                sku
                price
                compareAtPrice
              }
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const response = await admin.graphql(graphqlQuery, {
      variables: { id: collectionId, first: 50, after: cursor }
    });
    const json = await response.json();
    if (json.errors) throw new Error(json.errors[0]?.message || "GraphQL Error");
    
    const products = json.data?.collection?.products;
    if (!products) break;

    for (const product of products.nodes) {
      const variants = product.variants?.nodes || [];
      if (variants.length === 0) continue;
      
      const priceForSale = collectionSalePrice;
      
      const imageUrl = product.featuredImage?.url;
      const imageAlt = product.featuredImage?.altText || product.title;

      for (const variant of variants) {
        allItems.push({
          id: variant.id,
          productId: product.id,
          variantId: variant.id,
          title: variants.length > 1 && variant.title && variant.title !== 'Default Title'
            ? `${product.title} - ${variant.title}`
            : product.title,
          sku: variant.sku || '-',
          originalPrice: parseFloat(variant.price || 0),
          salePrice: parseFloat(priceForSale),
          imageUrl: imageUrl,
          imageAlt: imageAlt
        });
      }
    }

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  return allItems;
}
