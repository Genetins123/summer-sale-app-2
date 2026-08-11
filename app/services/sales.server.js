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
