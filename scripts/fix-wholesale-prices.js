const StoreManager = require('../StoreManager');
const ShopifyClient = require('../ShopifyClient');
const WooClient = require('../WooClient');
const SyncManager = require('../SyncManager');

async function run() {
  const storeManager = new StoreManager();
  const store = storeManager.getActiveStore();
  if (!store) {
    console.error('No hay tienda activa configurada');
    return;
  }

  console.log(`Tienda activa: "${store.name}" (${store.shopifyShopDomain})`);

  const shopify = new ShopifyClient({
    shopDomain: store.shopifyShopDomain,
    clientId: store.shopifyClientId,
    clientSecret: store.shopifyClientSecret,
    accessToken: store.shopifyAccessToken,
    apiVersion: store.shopifyApiVersion || '2024-01'
  });

  const woo = new WooClient({
    storeUrl: store.wooStoreUrl,
    consumerKey: store.wooConsumerKey,
    consumerSecret: store.wooConsumerSecret,
    pluginSecret: store.derenePluginSecret
  });

  const syncManager = new SyncManager(woo, shopify, store);

  console.log('1. Obteniendo productos de Shopify con metafields dumashe...');
  const shopifyCatalog = await shopify.getAllProducts();
  console.log(`Total productos Shopify indexados: ${shopifyCatalog.length}`);

  const skuToShopifyVariant = new Map();
  const titleToShopifyProduct = new Map();

  for (const sp of shopifyCatalog) {
    const normTitle = (sp.title || '').trim().toLowerCase();
    if (!titleToShopifyProduct.has(normTitle) || sp.variants.length > titleToShopifyProduct.get(normTitle).variants.length) {
      titleToShopifyProduct.set(normTitle, sp);
    }
    for (const v of sp.variants || []) {
      const vSku = (v.sku || '').trim().toLowerCase();
      if (vSku) {
        skuToShopifyVariant.set(vSku, { product: sp, variant: v });
      }
    }
  }

  console.log('2. Obteniendo productos de WooCommerce y sincronizando precios mayoristas 2 y 3 faltantes...');
  let page = 1;
  let totalFixed = 0;
  let totalChecked = 0;
  const batchUpdates = [];

  while (true) {
    console.log(`Consultando página ${page} de WooCommerce...`);
    const wooProducts = await woo.getProducts(page, 50, { status: 'publish' });
    if (!wooProducts || wooProducts.length === 0) break;

    for (const p of wooProducts) {
      totalChecked++;
      const normTitle = (p.name || '').trim().toLowerCase();
      const rawSku = (p.sku || '').trim().toLowerCase();
      const isVariable = p.type === 'variable' || (Array.isArray(p.variations) && p.variations.length > 0);

      if (isVariable) {
        try {
          const wooVariations = await woo.getProductVariations(p.id);
          const activeVars = wooVariations.filter(v => !v.status || v.status === 'publish');

          let matchedShopifyProd = titleToShopifyProduct.get(normTitle) || null;
          if (!matchedShopifyProd) {
            for (const wv of activeVars) {
              const vSku = (wv.sku || '').trim().toLowerCase();
              if (vSku && skuToShopifyVariant.has(vSku)) {
                matchedShopifyProd = skuToShopifyVariant.get(vSku).product;
                break;
              }
            }
          }

          if (matchedShopifyProd) {
            let firstTierPrices = null;
            for (const wv of activeVars) {
              const vSku = (wv.sku || '').trim().toLowerCase();
              const tierPrices = syncManager.extractTierPrices(wv.meta_data, p.meta_data);
              if (!firstTierPrices && (tierPrices.price_2 || tierPrices.price_3)) {
                firstTierPrices = tierPrices;
              }

              const shopifyVar = matchedShopifyProd.variants.find(sv =>
                (vSku && (sv.sku || '').trim().toLowerCase() === vSku)
              );

              if (shopifyVar && (tierPrices.price_2 || tierPrices.price_3)) {
                const existingMetaEdges = shopifyVar.metafields?.edges || [];
                const currPrice2 = existingMetaEdges.find(e => e.node?.key === 'price_2')?.node?.value;
                const currPrice3 = existingMetaEdges.find(e => e.node?.key === 'price_3')?.node?.value;

                if (tierPrices.price_2 && currPrice2 !== tierPrices.price_2) {
                  batchUpdates.push({
                    ownerId: shopifyVar.id,
                    namespace: 'dumashe',
                    key: 'price_2',
                    value: tierPrices.price_2,
                    type: 'number_decimal'
                  });
                }
                if (tierPrices.price_3 && currPrice3 !== tierPrices.price_3) {
                  batchUpdates.push({
                    ownerId: shopifyVar.id,
                    namespace: 'dumashe',
                    key: 'price_3',
                    value: tierPrices.price_3,
                    type: 'number_decimal'
                  });
                }
              }
            }

            if (firstTierPrices && matchedShopifyProd.id) {
              if (firstTierPrices.price_2) {
                batchUpdates.push({
                  ownerId: matchedShopifyProd.id,
                  namespace: 'dumashe',
                  key: 'price_2',
                  value: firstTierPrices.price_2,
                  type: 'number_decimal'
                });
              }
              if (firstTierPrices.price_3) {
                batchUpdates.push({
                  ownerId: matchedShopifyProd.id,
                  namespace: 'dumashe',
                  key: 'price_3',
                  value: firstTierPrices.price_3,
                  type: 'number_decimal'
                });
              }
            }
          }
        } catch (err) {
          console.warn(`Error en variaciones de "${p.name}":`, err.message);
        }
      } else {
        // Simple product
        const tierPrices = syncManager.extractTierPrices(p.meta_data);
        if (tierPrices.price_2 || tierPrices.price_3) {
          const matchedEntry = rawSku ? skuToShopifyVariant.get(rawSku) : null;
          const matchedProd = matchedEntry ? matchedEntry.product : (titleToShopifyProduct.get(normTitle) || null);
          const matchedVar = matchedEntry ? matchedEntry.variant : (matchedProd?.variants?.[0] || null);

          if (matchedVar) {
            const existingMetaEdges = matchedVar.metafields?.edges || [];
            const currPrice2 = existingMetaEdges.find(e => e.node?.key === 'price_2')?.node?.value;
            const currPrice3 = existingMetaEdges.find(e => e.node?.key === 'price_3')?.node?.value;

            if (tierPrices.price_2 && currPrice2 !== tierPrices.price_2) {
              batchUpdates.push({
                ownerId: matchedVar.id,
                namespace: 'dumashe',
                key: 'price_2',
                value: tierPrices.price_2,
                type: 'number_decimal'
              });
            }
            if (tierPrices.price_3 && currPrice3 !== tierPrices.price_3) {
              batchUpdates.push({
                ownerId: matchedVar.id,
                namespace: 'dumashe',
                key: 'price_3',
                value: tierPrices.price_3,
                type: 'number_decimal'
              });
            }

            if (matchedProd?.id) {
              if (tierPrices.price_2) {
                batchUpdates.push({
                  ownerId: matchedProd.id,
                  namespace: 'dumashe',
                  key: 'price_2',
                  value: tierPrices.price_2,
                  type: 'number_decimal'
                });
              }
              if (tierPrices.price_3) {
                batchUpdates.push({
                  ownerId: matchedProd.id,
                  namespace: 'dumashe',
                  key: 'price_3',
                  value: tierPrices.price_3,
                  type: 'number_decimal'
                });
              }
            }
          }
        }
      }

      // Flush batch periodically if growing
      if (batchUpdates.length >= 50) {
        console.log(`Aplicando lote de ${batchUpdates.length} metafields a Shopify...`);
        const toSend = batchUpdates.splice(0, batchUpdates.length);
        await shopify.setMetafieldsBatch(toSend);
        totalFixed += toSend.length;
      }
    }

    page++;
    if (wooProducts.length < 50) break;
  }

  if (batchUpdates.length > 0) {
    console.log(`Aplicando lote final de ${batchUpdates.length} metafields a Shopify...`);
    const toSend = batchUpdates.splice(0, batchUpdates.length);
    await shopify.setMetafieldsBatch(toSend);
    totalFixed += toSend.length;
  }

  console.log(`\n Reparación finalizada con éxito.`);
  console.log(`Total productos revisados: ${totalChecked}`);
  console.log(`Total metafields de precios 2 y 3 actualizados/creados: ${totalFixed}`);
}

run().catch(err => {
  console.error('Error fatal:', err);
});

