require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const ShopifyClient = require('../ShopifyClient');
const WooClient = require('../WooClient');
const SyncManager = require('../SyncManager');

async function main() {
  console.log('--- Sincronizando Productos (WooCommerce -> Shopify) ---');
  const shopify = new ShopifyClient({
    shopDomain: process.env.SHOPIFY_SHOP_DOMAIN,
    clientId: process.env.SHOPIFY_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    apiVersion: process.env.SHOPIFY_API_VERSION
  });

  const woo = new WooClient({
    storeUrl: process.env.WOO_STORE_URL,
    consumerKey: process.env.WOO_CONSUMER_KEY,
    consumerSecret: process.env.WOO_CONSUMER_SECRET,
    pluginSecret: process.env.DERENE_PLUGIN_SECRET
  });

  const manager = new SyncManager(woo, shopify);
  await manager.syncProducts();
  console.log('Finalizado.');
}

main().catch(console.error);
