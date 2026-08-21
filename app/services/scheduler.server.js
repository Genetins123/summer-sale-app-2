import cron from "node-cron";
import prisma from "../db.server";
import { getOfflineGraphqlClient, applyProductVariantsPrice } from "./shopifyPrice.server";

console.log("Scheduler initializing...");

cron.schedule("* * * * *", async () => {
  try {
    await processScheduledSales();
    await processRunningSales();
  } catch (error) {
    console.error("Scheduler encountered a critical error:", error);
  }
});

async function processScheduledSales() {
  const now = new Date();
  
  // Pick up scheduled sales, OR sales that are "Running" but have items that failed to apply
  const scheduledSales = await prisma.sale.findMany({
    where: {
      OR: [
        { status: "Scheduled", startAt: { lte: now } },
        { 
          status: "Running", 
          startAt: { lte: now },
          items: { some: { appliedAt: null } }
        }
      ]
    },
    include: { items: { where: { appliedAt: null } } }
  });

  for (const sale of scheduledSales) {
    if (sale.items.length === 0) continue; // Nothing to do if no unapplied items

    console.log(`Starting/Resuming sale: ${sale.name} (${sale.id}) - ${sale.items.length} items to process`);
    
    // Only set to starting if it was Scheduled. If it was Running, keep it Running to avoid UI flickering.
    if (sale.status === "Scheduled") {
      await prisma.sale.update({
        where: { id: sale.id },
        data: { status: "Starting" }
      });
    }
    
    try {
      const client = await getOfflineGraphqlClient(sale.shop);
      let successCount = 0;

      const groupedByProduct = {};
      for (const item of sale.items) {
        if (!item.variantId || !item.productId) continue;
        if (!groupedByProduct[item.productId]) {
          groupedByProduct[item.productId] = [];
        }
        groupedByProduct[item.productId].push({
          id: item.variantId,
          price: item.salePrice.toString(),
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
            data: { appliedAt: new Date() }
          });
          
          successCount += variants.length;
        } catch (itemError) {
          console.error(`Failed to apply sale price for product ${productId}:`, itemError.message || itemError);
        }
        
        // Sleep to avoid rate limits (Shopify REST/GraphQL restores at ~50 points/sec, each mutation is 10)
        // Sleeping for 250ms ensures max 40 points/sec, preventing Throttled errors.
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      // If we finished processing, ensure it is set to Running.
      await prisma.sale.update({
        where: { id: sale.id },
        data: { status: "Running" }
      });
      console.log(`Sale ${sale.name} is RUNNING. Processed ${successCount} items in this batch.`);

    } catch (saleError) {
      console.error(`Failed to process sale ${sale.name}:`, saleError.message || saleError);
      // We don't mark as Failed here because we might want to retry on next cron tick
    }
  }
}

async function processRunningSales() {
  const now = new Date();
  const runningSales = await prisma.sale.findMany({
    where: {
      status: "Running",
      endAt: { lte: now }
    },
    // Only include items that were actually applied and haven't been restored yet
    include: { items: { where: { appliedAt: { not: null }, restoredAt: null } } }
  });

  for (const sale of runningSales) {
    console.log(`Ending running sale: ${sale.name} (${sale.id})`);
    
    await prisma.sale.update({
      where: { id: sale.id },
      data: { status: "Ending" }
    });
    
    try {
      const client = await getOfflineGraphqlClient(sale.shop);
      let successCount = 0;

      const groupedByProduct = {};
      for (const item of sale.items) {
        if (!item.variantId || !item.productId) continue;
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
          console.error(`Failed to restore price for product ${productId}:`, itemError.message || itemError);
        }

        // Sleep to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      // Check if there are any items left unrestored (due to errors)
      const remainingItems = await prisma.saleItem.count({
        where: { saleId: sale.id, appliedAt: { not: null }, restoredAt: null }
      });

      if (remainingItems === 0) {
        await prisma.sale.update({
          where: { id: sale.id },
          data: { status: "Completed" }
        });
        console.log(`Sale ${sale.name} is now COMPLETED. Restored prices for ${successCount} items.`);
      } else {
        // Keep it as 'Ending' or 'Running' so next tick can retry, but for UI, let's keep it 'Running'
        // so we don't introduce a new unhandled state. We'll set it back to 'Running' so this function picks it up again.
        await prisma.sale.update({
          where: { id: sale.id },
          data: { status: "Running" }
        });
        console.log(`Sale ${sale.name} failed to restore ${remainingItems} items. Will retry.`);
      }

    } catch (saleError) {
      console.error(`Failed to end sale ${sale.name}:`, saleError.message || saleError);
      await prisma.sale.update({
        where: { id: sale.id },
        data: { status: "Running" } // Revert to running so it retries
      });
    }
  }
}
