import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { searchProducts, searchCollections, getCollectionProductsWithVariants } from "../services/product.server";
import { createSale } from "../services/sales.server";
import { SaleEditorLayout } from "../components/sales/SaleEditorLayout";
import { useLoaderData, useNavigation, useSubmit, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const cursor = url.searchParams.get("cursor");
  const direction = url.searchParams.get("direction") || "next";
  const searchType = url.searchParams.get("searchType") || "product";

  try {
    let searchResults;
    if (searchType === "collection") {
      searchResults = await searchCollections(admin, { query, cursor, direction });
    } else {
      searchResults = await searchProducts(admin, { query, cursor, direction });
    }
    return { shop: session.shop, searchResults, searchError: null, query, searchType };
  } catch (error) {
    return { shop: session.shop, searchResults: null, searchError: error.message, query, searchType };
  }
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  if (formData.get("intent") === "save") {
    const saleName = formData.get("saleName");
    const startAt = formData.get("startAt");
    const endAt = formData.get("endAt");
    const saleType = formData.get("saleType") || "PRODUCT";
    
    let products = [];
    let collections = [];
    
    if (saleType === "COLLECTION") {
      collections = JSON.parse(formData.get("collections") || "[]");
      const allProductsMap = new Map();
      
      for (const col of collections) {
        const colProducts = await getCollectionProductsWithVariants(admin, col.collectionId, col.salePrice);
        for (const p of colProducts) {
          allProductsMap.set(p.variantId, p);
        }
      }
      products = Array.from(allProductsMap.values());
    } else {
      products = JSON.parse(formData.get("products") || "[]");
    }
    
    await createSale({
      shop: session.shop,
      name: saleName,
      startAt: startAt || null,
      endAt: endAt || null,
      saleType,
      collectionId: saleType === "COLLECTION" && collections.length > 0 ? collections[0].collectionId : null,
      collectionTitle: saleType === "COLLECTION" && collections.length > 0 ? collections[0].collectionTitle : null,
      collections: saleType === "COLLECTION" ? collections : null,
      items: products
    });
    
    return redirect("/app/sales");
  }
  return null;
};

export default function NewSalePage() {
  const { shop, searchResults, searchError, query, searchType } = useLoaderData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  
  const isSearching = navigation.state === "loading" && !navigation.formData?.get("intent");

  const handleSearch = (newQuery, currentSearchType) => {
    const params = { searchType: currentSearchType };
    if (newQuery) params.q = newQuery;
    submit(params, { replace: true });
  };

  const handlePaginate = (newCursor, dir, currentSearchType) => {
    const params = { searchType: currentSearchType };
    if (query) params.q = query;
    if (newCursor) {
      params.cursor = newCursor;
      params.direction = dir;
    }
    submit(params);
  };

  return (
    <SaleEditorLayout 
      initialSaleName=""
      initialProducts={[]}
      initialStartAt=""
      initialEndAt=""
      initialSaleType="PRODUCT"
      initialCollectionId={null}
      initialCollectionTitle=""
      isEditable={true}
      searchResults={searchResults}
      searchError={searchError}
      isSearching={isSearching}
      searchQuery={query}
      searchType={searchType}
      onSearch={handleSearch}
      onPaginate={handlePaginate}
    />
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
