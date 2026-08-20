import prisma from "../db.server";

export async function createSale(data) {
  // Determine status based on dates
  let status = "Draft";
  if (data.startAt && data.endAt) {
    status = "Scheduled";
  }

  return prisma.sale.create({
    data: {
      shop: data.shop || "",
      name: data.name,
      status: status,
      startAt: data.startAt ? new Date(data.startAt) : null,
      endAt: data.endAt ? new Date(data.endAt) : null,
      scheduledAt: status === "Scheduled" ? new Date() : null,
      saleType: data.saleType || "PRODUCT",
      collectionId: data.collectionId || null,
      collectionTitle: data.collectionTitle || null,
      collections: data.collections || null,
      items: {
        create: data.items.map(item => ({
          productId: item.productId,
          variantId: item.variantId,
          productTitle: item.title,
          sku: item.sku,
          originalPrice: item.originalPrice,
          salePrice: item.salePrice,
          imageUrl: item.imageUrl
        }))
      }
    }
  });
}

export async function updateSale(id, data) {
  let status = "Draft";
  if (data.startAt && data.endAt) {
    status = "Scheduled";
  }

  // Delete old items and recreate
  await prisma.saleItem.deleteMany({ where: { saleId: id } });
  return prisma.sale.update({
    where: { id },
    data: {
      name: data.name,
      status: status,
      startAt: data.startAt ? new Date(data.startAt) : null,
      endAt: data.endAt ? new Date(data.endAt) : null,
      scheduledAt: status === "Scheduled" ? new Date() : null,
      saleType: data.saleType || "PRODUCT",
      collectionId: data.collectionId || null,
      collectionTitle: data.collectionTitle || null,
      items: {
        create: data.items.map(item => ({
          productId: item.productId,
          variantId: item.variantId,
          productTitle: item.title,
          sku: item.sku,
          originalPrice: item.originalPrice,
          salePrice: item.salePrice,
          imageUrl: item.imageUrl
        }))
      }
    }
  });
}

export async function deleteSale(id) {
  return prisma.sale.delete({ where: { id } });
}

export async function getSale(id) {
  return prisma.sale.findUnique({
    where: { id },
    include: { items: true }
  });
}

export async function listSales(query = "") {
  return prisma.sale.findMany({
    where: {
      name: {
        contains: query
      }
    },
    include: {
      _count: {
        select: { items: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function updateSaleEndTime(id, endAtStr, shop) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { items: true }
  });

  if (!sale) throw new Error("Sale not found");
  if (sale.status === "Completed") throw new Error("Cannot update end time of a completed sale");

  const newEndAt = new Date(endAtStr);
  if (isNaN(newEndAt.getTime())) throw new Error("Invalid end date");

  if (sale.status === "Scheduled" && sale.startAt && newEndAt <= new Date(sale.startAt)) {
    throw new Error("End date must be after start date");
  }

  const now = new Date();

  // If it's just a future change or a scheduled sale, just update the date
  if (sale.status === "Scheduled" || (sale.status === "Running" && newEndAt > now)) {
    await prisma.sale.update({
      where: { id },
      data: { endAt: newEndAt }
    });
    return { endedImmediately: false };
  }

  // If it's RUNNING and the new end time is in the past, restore immediately
  if (sale.status === "Running" && newEndAt <= now) {
    // Atomically try to mark it as Ending to avoid race condition with scheduler
    const updatedSale = await prisma.sale.updateMany({
      where: { id: sale.id, status: "Running" },
      data: { status: "Ending", endAt: newEndAt }
    });

    if (updatedSale.count === 0) {
      // It was already picked up by the scheduler or something else
      return;
    }

    const { getOfflineGraphqlClient, applyProductVariantsPrice } = await import("./shopifyPrice.server");
    const client = await getOfflineGraphqlClient(shop);
    let successCount = 0;

    const groupedByProduct = {};
    for (const item of sale.items) {
      if (!item.variantId || !item.productId) continue;
      if (item.restoredAt) continue; // Idempotent check

      if (!groupedByProduct[item.productId]) {
        groupedByProduct[item.productId] = [];
      }
      groupedByProduct[item.productId].push({
        id: item.variantId,
        price: item.originalPrice.toString(),
        _dbId: item.id
      });
    }

    for (const [productId, variants] of Object.entries(groupedByProduct)) {
      try {
        const shopifyVariants = variants.map(v => ({ id: v.id, price: v.price }));
        await applyProductVariantsPrice(client, productId, shopifyVariants);
        
        const dbIds = variants.map(v => v._dbId);
        await prisma.saleItem.updateMany({
          where: { id: { in: dbIds } },
          data: { restoredAt: new Date() }
        });
        
        successCount += variants.length;
      } catch (itemError) {
        console.error(`Failed to restore price for product ${productId} on immediate end:`, itemError);
      }
    }

    if (successCount > 0 || sale.items.length === 0) {
      await prisma.sale.update({
        where: { id: sale.id },
        data: { status: "Completed" }
      });
    } else {
      await prisma.sale.update({
        where: { id: sale.id },
        data: { status: "Failed" }
      });
    }
    return { endedImmediately: true };
  }
  
  return { endedImmediately: false };
}
