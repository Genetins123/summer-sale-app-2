import { useState, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useSubmit, useNavigation } from "react-router";
import { SaleBuilder } from "./SaleBuilder";

export function SaleEditorLayout({ 
  initialSaleName, 
  initialProducts, 
  initialStartAt,
  initialEndAt,
  initialSaleType,
  initialCollections,
  isEditable,
  searchResults, 
  searchError, 
  isSearching, 
  searchQuery,
  searchType,
  onSearch, 
  onPaginate 
}) {
  const shopify = useAppBridge();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === "save";

  const [saleName, setSaleName] = useState(initialSaleName || "");
  const [startAt, setStartAt] = useState(initialStartAt || "");
  const [endAt, setEndAt] = useState(initialEndAt || "");
  const [saleType, setSaleType] = useState(initialSaleType || "PRODUCT");
  const [selectedCollections, setSelectedCollections] = useState(initialCollections || []);
  const [pendingCollection, setPendingCollection] = useState(null);
  const [pendingPrice, setPendingPrice] = useState("");
  
  const [selectedProducts, setSelectedProducts] = useState(() => {
    const grouped = {};
    for (const p of initialProducts || []) {
      if (!grouped[p.productId]) {
        grouped[p.productId] = {
          id: p.productId,
          productId: p.productId,
          title: p.title.includes(' - ') ? p.title.split(' - ').slice(0, -1).join(' - ') : p.title,
          sku: p.sku,
          originalPrice: p.originalPrice,
          salePrice: p.salePrice,
          imageUrl: p.imageUrl,
          imageAlt: p.imageAlt,
          variants: []
        };
      } else {
        grouped[p.productId].sku = 'Multiple SKUs';
      }
      grouped[p.productId].variants.push(p);
    }
    return Object.values(grouped);
  });
  const [queryValue, setQueryValue] = useState(searchQuery || "");

  useEffect(() => { setQueryValue(searchQuery || ""); }, [searchQuery]);

  useEffect(() => {
    // When saleType changes, auto-trigger a search so the table populates
    if (saleType === "COLLECTION" && searchType !== "collection") {
      onSearch(queryValue, "collection");
    } else if (saleType === "PRODUCT" && searchType !== "product") {
      onSearch(queryValue, "product");
    }
  }, [saleType]);

  const handleSearchClick = () => onSearch(queryValue, saleType === "COLLECTION" ? "collection" : "product");
  const handleKeyDown = (e) => { if (e.key === "Enter") handleSearchClick(); };

  const handleAddProduct = (product) => {
    if (!isEditable) return;
    
    const variants = product.variants?.nodes || [];
    if (variants.length === 0) return;

    const exists = selectedProducts.find(p => p.productId === product.id);
    if (exists) {
      shopify.toast.show("Product is already in the sale", { isError: true });
      return;
    }

    const price = parseFloat(variants[0].price || 0);

    const newItem = {
      id: product.id, 
      productId: product.id,
      title: product.title,
      sku: variants.length > 1 ? 'Multiple SKUs' : (variants[0].sku || '-'),
      originalPrice: price,
      salePrice: price,
      imageUrl: product.featuredImage?.url,
      imageAlt: product.featuredImage?.altText || product.title,
      variants: variants.map(v => ({
        id: v.id,
        productId: product.id,
        variantId: v.id,
        title: variants.length > 1 && v.title && v.title !== 'Default Title' 
          ? `${product.title} - ${v.title}` 
          : product.title,
        sku: v.sku || '-',
        originalPrice: parseFloat(v.price || 0),
        salePrice: price,
        imageUrl: product.featuredImage?.url
      }))
    };

    setSelectedProducts(prev => [...prev, newItem]);
    shopify.toast.show(`Added product with ${variants.length} variant(s) to sale`);
  };

  const handleSelectCollection = (collection) => {
    if (selectedCollections.some(c => c.collectionId === collection.id)) {
      shopify.toast.show(`Collection is already added`, { isError: true });
      return;
    }
    setPendingCollection({ collectionId: collection.id, collectionTitle: collection.title });
    setPendingPrice("");
    shopify.toast.show(`Selected collection: ${collection.title}`);
  };

  const handleAddPendingCollection = () => {
    if (!pendingCollection) return;
    if (!pendingPrice || isNaN(parseFloat(pendingPrice))) {
      shopify.toast.show("A valid price is required", { isError: true });
      return;
    }
    setSelectedCollections(prev => [...prev, {
      ...pendingCollection,
      salePrice: parseFloat(pendingPrice)
    }]);
    setPendingCollection(null);
    setPendingPrice("");
    shopify.toast.show(`Added ${pendingCollection.collectionTitle} to the sale`);
  };

  const handleRemoveCollection = (collectionId) => {
    if (!isEditable) return;
    setSelectedCollections(prev => prev.filter(c => c.collectionId !== collectionId));
  };

  const handleUpdateSalePrice = (id, newPrice) => {
    if (!isEditable) return;
    setSelectedProducts(prev => prev.map(p => p.id === id ? { ...p, salePrice: newPrice } : p));
  };

  const handleRemoveProduct = (id) => {
    if (!isEditable) return;
    setSelectedProducts(prev => prev.filter(p => p.id !== id));
  };

  const handleSaveSale = () => {
    if (!saleName.trim()) {
      shopify.toast.show("Sale name is required", { isError: true });
      return;
    }
    
    if (saleType === "PRODUCT" && selectedProducts.length === 0) {
      shopify.toast.show("At least one product is required", { isError: true });
      return;
    }

    if (saleType === "COLLECTION") {
      if (selectedCollections.length === 0) {
        shopify.toast.show("At least one collection must be added", { isError: true });
        return;
      }
    }

    if ((startAt && !endAt) || (!startAt && endAt)) {
      shopify.toast.show("Both start and end dates are required if scheduling", { isError: true });
      return;
    }

    if (startAt && endAt) {
      const sDate = new Date(startAt);
      const eDate = new Date(endAt);
      if (eDate <= sDate) {
        shopify.toast.show("End date must be after start date", { isError: true });
        return;
      }
    }
    
    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("saleName", saleName);
    formData.append("saleType", saleType);
    if (startAt) formData.append("startAt", new Date(startAt).toISOString());
    if (endAt) formData.append("endAt", new Date(endAt).toISOString());
    
    if (saleType === "COLLECTION") {
      formData.append("collections", JSON.stringify(selectedCollections));
    } else {
      const flatProducts = [];
      for (const p of selectedProducts) {
        for (const v of p.variants) {
          flatProducts.push({
            ...v,
            salePrice: p.salePrice
          });
        }
      }
      formData.append("products", JSON.stringify(flatProducts));
    }
    
    submit(formData, { method: "POST" });
  };

  const expectedSearchType = saleType === "COLLECTION" ? "collection" : "product";
  const nodes = searchType === expectedSearchType ? (searchResults?.nodes || []) : [];
  const pageInfo = searchType === expectedSearchType ? (searchResults?.pageInfo || {}) : {};

  const saveButtonLabel = (startAt && endAt) ? "Save & Schedule" : "Save Draft";

  return (
    <s-page heading={initialSaleName ? "Edit Sale" : "Create New Sale"}>
      {isEditable && (
        <s-button slot="primary-action" onClick={handleSaveSale} disabled={isSaving}>
          {isSaving ? "Saving..." : saveButtonLabel}
        </s-button>
      )}

      {!isEditable && (
        <s-box padding="base" background="bg-surface-warning" borderRadius="base" marginBottom="base">
          <s-text color="warning">This sale is currently running or completed. Editing is disabled.</s-text>
        </s-box>
      )}

      <s-section heading="Sale Details">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontWeight: '500' }}>Sale Type</label>
              <div style={{ display: 'flex', gap: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input 
                    type="radio" 
                    name="saleType" 
                    value="PRODUCT" 
                    checked={saleType === "PRODUCT"} 
                    onChange={() => setSaleType("PRODUCT")}
                    disabled={!isEditable || initialSaleName !== ""}
                  />
                  Products
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input 
                    type="radio" 
                    name="saleType" 
                    value="COLLECTION" 
                    checked={saleType === "COLLECTION"} 
                    onChange={() => setSaleType("COLLECTION")}
                    disabled={!isEditable || initialSaleName !== ""}
                  />
                  Collection
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontWeight: '500' }}>Sale Name</label>
              <input 
                type="text" 
                value={saleName}
                onChange={(e) => setSaleName(e.target.value)}
                placeholder="e.g. Summer Blowout 2026"
                disabled={!isEditable}
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </div>
            
            <div style={{ display: 'flex', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                <label style={{ fontWeight: '500' }}>Start Date & Time (Optional)</label>
                <input 
                  type="datetime-local" 
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  disabled={!isEditable}
                  style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                <label style={{ fontWeight: '500' }}>End Date & Time (Optional)</label>
                <input 
                  type="datetime-local" 
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  disabled={!isEditable}
                  style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
            </div>
            {(startAt || endAt) && (
              <s-text tone="subdued">Note: This sale will automatically start and end at the selected times.</s-text>
            )}
          </div>
        </s-box>
      </s-section>

      {saleType === "PRODUCT" && (
        <>
          <s-section heading="Sale Builder">
            <SaleBuilder 
              products={selectedProducts} 
              onUpdateProduct={handleUpdateSalePrice} 
              onRemoveProduct={handleRemoveProduct} 
            />
          </s-section>

          {isEditable && (
            <s-section heading="Search Products to Add">
              <s-stack direction="inline" gap="base">
                <input 
                  type="text" 
                  placeholder="Search products by title or SKU" 
                  value={queryValue}
                  onChange={(e) => setQueryValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '250px' }} 
                  disabled={isSearching}
                />
                <s-button onClick={handleSearchClick} disabled={isSearching}>
                  {isSearching ? "Searching..." : "Search"}
                </s-button>
              </s-stack>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: '16px' }}>
                  <thead>
                    <tr style={{ background: '#f4f6f8' }}>
                      <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Image</th>
                      <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Product</th>
                      <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Status</th>
                      <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>SKU</th>
                      <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Compare at Price</th>
                      <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Current Price</th>
                      <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isSearching && nodes.length === 0 ? (
                      <tr><td colSpan="7" style={{ padding: '32px', textAlign: 'center' }}><s-text>Loading...</s-text></td></tr>
                    ) : !searchError && nodes.length === 0 ? (
                      <tr><td colSpan="7" style={{ padding: '32px', textAlign: 'center' }}><s-text>No products found.</s-text></td></tr>
                    ) : (
                      nodes.map((product) => {
                        const variant = product.variants?.nodes?.[0];
                        const imageUrl = product.featuredImage?.url;
                        
                        return (
                          <tr key={product.id} style={{ borderBottom: '1px solid #ebebeb' }}>
                            <td style={{ padding: '12px 8px' }}>
                              {imageUrl ? (
                                <img src={imageUrl} alt={product.title} style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                              ) : (
                                <div style={{ width: '40px', height: '40px', background: '#e1e3e5', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <span style={{ fontSize: '10px', color: '#6d7175' }}>No img</span>
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '12px 8px' }}><s-text>{product.title}</s-text></td>
                            <td style={{ padding: '12px 8px' }}>
                              <span style={{ 
                                padding: '2px 8px', 
                                borderRadius: '12px', 
                                fontSize: '12px',
                                background: product.status === 'ACTIVE' ? '#aee9d1' : '#e3e5e7',
                                color: product.status === 'ACTIVE' ? '#0b5c3e' : '#202223'
                              }}>
                                {product.status || '-'}
                              </span>
                            </td>
                            <td style={{ padding: '12px 8px' }}><s-text>{variant?.sku || '-'}</s-text></td>
                            <td style={{ padding: '12px 8px' }}>
                              <s-text tone={variant?.compareAtPrice ? "subdued" : "base"} textDecoration={variant?.compareAtPrice ? "line-through" : "none"}>
                                {variant?.compareAtPrice ? `$${variant.compareAtPrice}` : '-'}
                              </s-text>
                            </td>
                            <td style={{ padding: '12px 8px' }}><s-text>{variant?.price ? `$${variant.price}` : '-'}</s-text></td>
                            <td style={{ padding: '12px 8px' }}>
                              <s-button onClick={() => handleAddProduct(product)} disabled={isSearching}>Add to Sale</s-button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              
              {!isSearching && nodes.length > 0 && (pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                  <s-stack direction="inline" gap="base">
                    <s-button disabled={!pageInfo.hasPreviousPage} onClick={() => onPaginate(pageInfo.startCursor, 'prev', 'product')}>Previous</s-button>
                    <s-button disabled={!pageInfo.hasNextPage} onClick={() => onPaginate(pageInfo.endCursor, 'next', 'product')}>Next</s-button>
                  </s-stack>
                </div>
              )}
            </s-section>
          )}
        </>
      )}

      {saleType === "COLLECTION" && (
        <>
          <s-section heading="Selected Collections">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {selectedCollections.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#f4f6f8' }}>
                        <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Collection Title</th>
                        <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Sale Price</th>
                        <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCollections.map((col) => (
                        <tr key={col.collectionId} style={{ borderBottom: '1px solid #ebebeb' }}>
                          <td style={{ padding: '12px 8px' }}><s-text>{col.collectionTitle}</s-text></td>
                          <td style={{ padding: '12px 8px' }}>
                            {isEditable ? (
                              <input 
                                type="number" 
                                value={col.salePrice}
                                onChange={(e) => {
                                  const newPrice = e.target.value;
                                  setSelectedCollections(prev => prev.map(c => 
                                    c.collectionId === col.collectionId ? { ...c, salePrice: newPrice } : c
                                  ));
                                }}
                                style={{ padding: '4px 8px', width: '100px', borderRadius: '4px', border: '1px solid #ccc' }}
                              />
                            ) : (
                              <s-text>${col.salePrice}</s-text>
                            )}
                          </td>
                          <td style={{ padding: '12px 8px' }}>
                            <s-button disabled={!isEditable} onClick={() => handleRemoveCollection(col.collectionId)}>Remove</s-button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <s-text tone="subdued">No collections selected yet.</s-text>
                )}

                {pendingCollection && (
                  <div style={{ marginTop: '16px', padding: '16px', border: '1px solid #c9cccf', borderRadius: '8px', background: '#fff' }}>
                    <s-text><strong>Pending Collection:</strong> {pendingCollection.collectionTitle}</s-text>
                    <div style={{ display: 'flex', alignItems: 'end', gap: '16px', marginTop: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                        <label style={{ fontWeight: '500' }}>Sale Price for this Collection</label>
                        <input 
                          type="number" 
                          value={pendingPrice}
                          onChange={(e) => setPendingPrice(e.target.value)}
                          placeholder="e.g. 80.00"
                          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                        />
                      </div>
                      <s-button onClick={handleAddPendingCollection}>Add Collection</s-button>
                      <s-button onClick={() => setPendingCollection(null)}>Cancel</s-button>
                    </div>
                  </div>
                )}
              </div>
            </s-box>
          </s-section>

          {isEditable && (
            <s-section heading="Search Collections">
              <s-stack direction="inline" gap="base">
                <input 
                  type="text" 
                  placeholder="Search collections by title" 
                  value={queryValue}
                  onChange={(e) => setQueryValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '250px' }} 
                  disabled={isSearching}
                />
                <s-button onClick={handleSearchClick} disabled={isSearching}>
                  {isSearching ? "Searching..." : "Search"}
                </s-button>
              </s-stack>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: '16px' }}>
                  <thead>
                    <tr style={{ background: '#f4f6f8' }}>
                      <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Collection Title</th>
                      <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Products</th>
                      <th style={{ padding: '12px 8px', borderBottom: '1px solid #ccc' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isSearching && nodes.length === 0 ? (
                      <tr><td colSpan="3" style={{ padding: '32px', textAlign: 'center' }}><s-text>Loading...</s-text></td></tr>
                    ) : !searchError && nodes.length === 0 ? (
                      <tr><td colSpan="3" style={{ padding: '32px', textAlign: 'center' }}><s-text>No collections found.</s-text></td></tr>
                    ) : (
                      nodes.map((collection) => {
                        return (
                          <tr key={collection.id} style={{ borderBottom: '1px solid #ebebeb' }}>
                            <td style={{ padding: '12px 8px' }}><s-text>{collection.title}</s-text></td>
                            <td style={{ padding: '12px 8px' }}>
                              <s-text>{collection.productsCount?.count || 0}</s-text>
                              <div style={{ fontSize: '10px', color: 'red' }}>{JSON.stringify(collection)}</div>
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              <s-button onClick={() => handleSelectCollection(collection)} disabled={isSearching}>Select</s-button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              
              {!isSearching && nodes.length > 0 && (pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                  <s-stack direction="inline" gap="base">
                    <s-button disabled={!pageInfo.hasPreviousPage} onClick={() => onPaginate(pageInfo.startCursor, 'prev', 'collection')}>Previous</s-button>
                    <s-button disabled={!pageInfo.hasNextPage} onClick={() => onPaginate(pageInfo.endCursor, 'next', 'collection')}>Next</s-button>
                  </s-stack>
                </div>
              )}
            </s-section>
          )}
        </>
      )}
    </s-page>
  );
}
