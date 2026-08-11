import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { updateSale, getSale } from "../services/sales.server";
import { SaleEditorLayout } from "../components/sales/SaleEditorLayout";
import {
  useLoaderData,
  useNavigation,
  useSubmit,
  redirect,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const sale = await getSale(params.id);

  if (!sale) {
    throw new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const cursor = url.searchParams.get("cursor");
  const direction = url.searchParams.get("direction") || "next";
  const searchType = url.searchParams.get("searchType") || "product";

  try {
    // Load server-only product functions only inside the server-side loader.
    const {
      searchProducts,
      searchCollections,
    } = await import("../services/product.server");

    let searchResults;

    if (searchType === "collection") {
      searchResults = await searchCollections(admin, {
        query,
        cursor,
        direction,
      });
    } else {
      searchResults = await searchProducts(admin, {
        query,
        cursor,
        direction,
      });
    }

    return {
      sale,
      searchResults,
      searchError: null,
      query,
      searchType,
    };
  } catch (error) {
    console.error("Search error:", error);

    return {
      sale,
      searchResults: null,
      searchError: error?.message || "Failed to load search results",
      query,
      searchType,
    };
  }
};

export const action = async ({ request, params }) => {
  await authenticate.admin(request);

  const formData = await request.formData();

  if (formData.get("intent") === "save") {
    const saleName = formData.get("saleName");
    const startAt = formData.get("startAt");
    const endAt = formData.get("endAt");

    const saleType = formData.get("saleType") || "PRODUCT";

    const collectionId = formData.get("collectionId");
    const collectionTitle = formData.get("collectionTitle");
    const collectionSalePrice = formData.get("collectionSalePrice");

    let products = [];

    if (saleType === "COLLECTION") {
      /*
       * IMPORTANT:
       * For an existing collection sale, keep using the existing SaleItems.
       *
       * We do NOT re-fetch the collection here.
       *
       * This preserves the collection snapshot that was created when
       * the sale was originally created.
       */
      const existingSale = await getSale(params.id);

      if (!existingSale) {
        throw new Response("Sale Not Found", { status: 404 });
      }

      products = existingSale.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        title: item.productTitle,
        sku: item.sku,
        originalPrice: item.originalPrice,
        salePrice: item.salePrice,
        imageUrl: item.imageUrl,
      }));
    } else {
      /*
       * Existing PRODUCT sale behavior.
       * Keep using the products supplied by the current UI.
       */
      products = JSON.parse(formData.get("products") || "[]");
    }

    await updateSale(params.id, {
      name: saleName,
      startAt: startAt || null,
      endAt: endAt || null,

      saleType,

      collectionId:
        saleType === "COLLECTION" ? collectionId : null,

      collectionTitle:
        saleType === "COLLECTION" ? collectionTitle : null,

      items: products,
    });

    return redirect("/app/sales");
  }

  return null;
};

export default function EditSalePage() {
  const {
    sale,
    searchResults,
    searchError,
    query,
    searchType,
  } = useLoaderData();

  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const isSearching =
    navigation.state === "loading" &&
    !navigation.formData?.get("intent");

  const handleSearch = (newQuery, currentSearchType) => {
    const params = {
      searchType: currentSearchType,
    };

    if (newQuery) {
      params.q = newQuery;
    }

    submit(params, {
      replace: true,
    });
  };

  const handlePaginate = (
    newCursor,
    dir,
    currentSearchType
  ) => {
    const params = {
      searchType: currentSearchType,
    };

    if (query) {
      params.q = query;
    }

    if (newCursor) {
      params.cursor = newCursor;
      params.direction = dir;
    }

    submit(params);
  };

  /*
   * Convert SaleItems into the structure expected by SaleEditorLayout.
   */
  const mappedProducts = sale.items.map((item) => ({
    id: item.variantId || item.id,
    productId: item.productId,
    variantId: item.variantId,
    title: item.productTitle,
    sku: item.sku,
    originalPrice: item.originalPrice,
    salePrice: item.salePrice,
    imageUrl: item.imageUrl,
    imageAlt: item.productTitle,
  }));

  /*
   * Only Draft and Scheduled sales should be editable.
   *
   * Running/Completed sales remain protected.
   */
  const isEditable =
    sale.status === "Draft" ||
    sale.status === "Scheduled";

  const formattedStart = sale.startAt
    ? new Date(sale.startAt)
        .toISOString()
        .slice(0, 16)
    : "";

  const formattedEnd = sale.endAt
    ? new Date(sale.endAt)
        .toISOString()
        .slice(0, 16)
    : "";

  return (
    <SaleEditorLayout
      initialSaleName={sale.name}
      initialProducts={mappedProducts}
      initialStartAt={formattedStart}
      initialEndAt={formattedEnd}
      initialSaleType={sale.saleType || "PRODUCT"}
      initialCollectionId={sale.collectionId || null}
      initialCollectionTitle={sale.collectionTitle || ""}
      isEditable={isEditable}
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

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);