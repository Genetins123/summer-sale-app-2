import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { updateSale, getSale } from "../services/sales.server";
import { SaleEditorLayout } from "../components/sales/SaleEditorLayout";
import {
  useLoaderData,
  useNavigation,
  useSubmit,
  redirect,
  useActionData,
} from "react-router";
import { useEffect } from "react";
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
  
  if (formData.get("intent") === "update_end_time") {
    const endAt = formData.get("endAt");
    const { updateSaleEndTime } = await import("../services/sales.server");
    const result = await updateSaleEndTime(params.id, endAt, session.shop);
    return { success: true, message: result?.endedImmediately ? "Sale ended and original prices were restored successfully." : "Sale end time updated successfully." };
  }

  if (formData.get("intent") === "save") {
    const saleName = formData.get("saleName");
    const startAt = formData.get("startAt");
    const endAt = formData.get("endAt");

    const saleType = formData.get("saleType") || "PRODUCT";
    
    let products = [];
    let collections = [];
    
    if (saleType === "COLLECTION") {
      collections = JSON.parse(formData.get("collections") || "[]");
      const existingSale = await getSale(params.id);
      products = existingSale.items.map(item => ({
        productId: item.productId,
        variantId: item.variantId,
        title: item.productTitle,
        sku: item.sku,
        originalPrice: item.originalPrice,
        salePrice: item.salePrice,
        imageUrl: item.imageUrl
      }));
    } else {
      products = JSON.parse(formData.get("products") || "[]");
    }
    
    await updateSale(params.id, {
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

export default function EditSalePage() {
  const {
    sale,
    searchResults,
    searchError,
    query,
    searchType,
  } = useLoaderData();

  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.success && actionData?.message) {
      shopify.toast.show(actionData.message);
    }
  }, [actionData, shopify]);

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
   * Draft sales are fully editable.
   */
  const isEditable = sale.status === "Draft";

  /*
   * Scheduled and Running sales allow editing endAt only.
   */
  const isEndDateTimeEditableOnly = sale.status === "Scheduled" || sale.status === "Running";

  let lockMessage = "";
  if (sale.status === "Running") {
    lockMessage = "This sale is currently running. Only the end date and time can be changed.";
  } else if (sale.status === "Scheduled") {
    lockMessage = "This sale is scheduled. Only the end date and time can be changed.";
  } else if (sale.status === "Completed") {
    lockMessage = "This sale has completed and can no longer be edited.";
  }

  const formattedStart = sale.startAt
    ? new Date(sale.startAt).toISOString()
    : "";

  const formattedEnd = sale.endAt
    ? new Date(sale.endAt).toISOString()
    : "";

  return (
    <SaleEditorLayout
      initialSaleName={sale.name}
      initialProducts={mappedProducts}
      initialStartAt={formattedStart}
      initialEndAt={formattedEnd}
      initialSaleType={sale.saleType || "PRODUCT"}
      initialCollections={sale.collections ? (typeof sale.collections === 'string' ? JSON.parse(sale.collections) : sale.collections) : (sale.collectionId ? [{collectionId: sale.collectionId, collectionTitle: sale.collectionTitle, salePrice: ''}] : [])}
      isEditable={isEditable}
      isEndDateTimeEditableOnly={isEndDateTimeEditableOnly}
      lockMessage={lockMessage}
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