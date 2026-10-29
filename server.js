require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const path = require('path');
const ShopifyClient = require('./ShopifyClient');
const WooClient = require('./WooClient');
const SyncManager = require('./SyncManager');
const StoreManager = require('./StoreManager');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar Administrador de Tiendas Multitienda
const storeManager = new StoreManager();

let activeStore = null;
let shopify = null;
let woo = null;
let syncManager = null;

function reloadClients() {
  activeStore = storeManager.getActiveStore();
  if (!activeStore) {
    console.warn('[CONFIG] No hay ninguna tienda configurada.');
    return;
  }

  shopify = new ShopifyClient({
    shopDomain: activeStore.shopifyShopDomain,
    clientId: activeStore.shopifyClientId,
    clientSecret: activeStore.shopifyClientSecret,
    accessToken: activeStore.shopifyAccessToken,
    apiVersion: activeStore.shopifyApiVersion || '2024-01'
  });

  woo = new WooClient({
    storeUrl: activeStore.wooStoreUrl,
    consumerKey: activeStore.wooConsumerKey,
    consumerSecret: activeStore.wooConsumerSecret,
    pluginSecret: activeStore.derenePluginSecret
  });

  if (!syncManager) {
    syncManager = new SyncManager(woo, shopify, activeStore);
  } else {
    syncManager.updateClients(woo, shopify, activeStore);
  }

  console.log(`[CONFIG] Tienda activa cargada: "${activeStore.name}" (${activeStore.shopifyShopDomain} ➔ ${activeStore.wooStoreUrl})`);
}

// Carga inicial
reloadClients();

// Programación de cron automático si está habilitado
const cronSchedule = process.env.CRON_SCHEDULE;
if (cronSchedule) {
  cron.schedule(cronSchedule, () => {
    console.log(`[CRON] Disparando sincronización automática: ${cronSchedule}`);
    if (syncManager && !syncManager.isRunning) {
      syncManager.runFullSync().catch(err => console.error(err));
    }
  });
}

// ==========================================
// Rutas de Configuración Multitienda
// ==========================================

app.get('/api/config', (req, res) => {
  res.json({
    activeStoreId: storeManager.data.activeStoreId,
    activeStore: storeManager.getActiveStore(),
    stores: storeManager.getStores()
  });
});

app.post('/api/stores/select', (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Falta el id de la tienda' });
    const store = storeManager.setActiveStore(id);
    reloadClients();
    res.json({ success: true, activeStore: store });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/stores/save', (req, res) => {
  try {
    const { store, makeActive } = req.body || {};
    if (!store) return res.status(400).json({ error: 'Faltan datos de la tienda' });
    const saved = storeManager.saveStore(store);
    if (makeActive || storeManager.data.activeStoreId === saved.id) {
      storeManager.setActiveStore(saved.id);
    }
    reloadClients();
    res.json({ success: true, store: saved, activeStore: storeManager.getActiveStore() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/stores/delete', (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Falta el id de la tienda a eliminar' });
    const currentActive = storeManager.deleteStore(id);
    reloadClients();
    res.json({ success: true, activeStore: currentActive, stores: storeManager.getStores() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// Autenticación Shopify OAuth
// ==========================================

app.get('/api/auth/shopify', (req, res) => {
  const store = activeStore || storeManager.getActiveStore();
  if (!store || !store.shopifyShopDomain || !store.shopifyClientId) {
    return res.status(400).send('La tienda activa no tiene configurado el dominio de Shopify o Client ID.');
  }

  const shop = store.shopifyShopDomain;
  const clientId = store.shopifyClientId;
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const redirectUri = `${protocol}://${host}/api/auth/callback`;
  const scopes = 'read_orders,write_orders,read_customers,write_customers,read_products,write_products';

  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  console.log(`[AUTH] Redirigiendo a autorización Shopify para ${shop}: ${authUrl}`);
  res.redirect(authUrl);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, shop } = req.query;
  if (!code) {
    return res.status(400).send('Falta el código de autorización de Shopify en la respuesta.');
  }

  const store = activeStore || storeManager.getActiveStore();
  try {
    const accessToken = await shopify.exchangeAuthCode(code);
    storeManager.updateAccessToken(store.id, accessToken);
    reloadClients();

    console.log(`[AUTH] Shopify vinculado exitosamente para ${store.name}. Token guardado.`);
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Autorización Exitosa</title><meta charset="utf-8"></head>
        <body style="font-family: system-ui, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="background: #172036; padding: 40px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); text-align: center; max-width: 520px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
            <div style="font-size: 52px; margin-bottom: 16px;">🎉</div>
            <h2 style="color: #10b981; margin-bottom: 12px; font-size: 22px;">¡Shopify Autorizado con Éxito!</h2>
            <p style="color: #94a3b8; font-size: 14px; margin-bottom: 8px;">La tienda <strong>${store.name}</strong> (${store.shopifyShopDomain}) ha quedado vinculada y autorizada.</p>
            <p style="color: #64748b; font-size: 13px; margin-bottom: 24px;">El token de acceso permanente se guardó automáticamente en tu configuración.</p>
            <a href="/" style="display: inline-block; background: #e59819; color: #0b0f19; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 800; transition: transform 0.2s;">Volver al Panel de Control</a>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('[AUTH ERROR]', err);
    res.status(500).send(`Error en autorización con Shopify: ${err.message}`);
  }
});

// ==========================================
// Rutas de Estado y Sincronización
// ==========================================

app.get('/api/stats', (req, res) => {
  res.json({
    stats: syncManager ? syncManager.stats : {},
    isRunning: syncManager ? syncManager.isRunning : false,
    activeStore: activeStore ? { id: activeStore.id, name: activeStore.name, domain: activeStore.shopifyShopDomain } : null
  });
});

app.get('/api/test-connections', async (req, res) => {
  if (!shopify || !woo) {
    return res.status(400).json({
      shopify: { ok: false, error: 'Clientes no inicializados.' },
      woo: { ok: false, error: 'Clientes no inicializados.' }
    });
  }
  const [shopifyRes, wooRes] = await Promise.all([
    shopify.testConnection(),
    woo.testConnection()
  ]);
  res.json({
    store: activeStore ? activeStore.name : 'Desconocida',
    shopify: shopifyRes,
    woo: wooRes
  });
});

app.post('/api/stop-sync', (req, res) => {
  if (!syncManager) return res.json({ success: false, message: 'SyncManager no listo' });
  const stopped = syncManager.stopSync();
  res.json({
    success: stopped,
    message: stopped ? 'Se ha enviado la señal para detener la sincronización.' : 'No hay ningún proceso activo para detener.'
  });
});

app.post('/api/cleanup-orphans', (req, res) => {
  if (!syncManager) return res.status(500).json({ message: 'SyncManager no inicializado' });
  if (syncManager.isRunning) {
    return res.status(409).json({ message: 'Ya hay un proceso activo en ejecución.' });
  }
  const { dryRun, actionType, status } = req.body || {};
  syncManager.cleanupOrphanProducts({ dryRun, actionType, status }).catch(err => console.error(err));
  res.json({ message: `Proceso de análisis/limpieza iniciado (${dryRun !== false ? 'Modo Simulación / Auditoría' : 'Acción: ' + (actionType || 'delete').toUpperCase()}).` });
});

app.post('/api/sync-customers-orders', (req, res) => {
  if (!syncManager) return res.status(500).json({ message: 'SyncManager no inicializado' });
  if (syncManager.isRunning) {
    return res.status(409).json({ message: 'Ya hay una sincronización en progreso.' });
  }
  const payload = req.body || {};
  syncManager.syncCustomersAndOrders(payload).catch(err => console.error(err));
  res.json({ message: `Sincronización de Clientes y Pedidos iniciada para [${activeStore?.name || 'Tienda'}]. Los productos NO serán tocados.` });
});

app.post('/api/sync-all', (req, res) => {
  if (!syncManager) return res.status(500).json({ message: 'SyncManager no inicializado' });
  if (syncManager.isRunning) {
    return res.status(409).json({ message: 'Ya hay una sincronización en progreso.' });
  }
  const payload = req.body || {};
  syncManager.runFullSync(payload).catch(err => console.error(err));
  res.json({ message: `Sincronización completa iniciada para [${activeStore?.name || 'Tienda'}].` });
});

app.post('/api/sync-customers', (req, res) => {
  if (!syncManager) return res.status(500).json({ message: 'SyncManager no inicializado' });
  if (syncManager.isRunning) {
    return res.status(409).json({ message: 'Ya hay una tarea en progreso.' });
  }
  const payload = req.body || {};
  syncManager.isRunning = true;
  syncManager.stopRequested = false;
  syncManager.stats.status = 'running';
  syncManager.stats.currentTask = 'Clientes';
  syncManager.syncCustomers(payload)
    .catch(err => {
      console.error(err);
      syncManager.stats.status = 'error';
    })
    .finally(() => {
      syncManager.isRunning = false;
      syncManager.stopRequested = false;
      syncManager.stats.currentTask = null;
    });
  res.json({ message: `Sincronización de clientes iniciada para [${activeStore?.name || 'Tienda'}].` });
});

app.post('/api/sync-products', (req, res) => {
  if (!syncManager) return res.status(500).json({ message: 'SyncManager no inicializado' });
  if (syncManager.isRunning) {
    return res.status(409).json({ message: 'Ya hay una tarea en progreso.' });
  }
  const payload = req.body || {};
  syncManager.isRunning = true;
  syncManager.stopRequested = false;
  syncManager.stats.status = 'running';
  syncManager.stats.currentTask = 'Productos';
  syncManager.syncProducts(payload)
    .catch(err => {
      console.error(err);
      syncManager.stats.status = 'error';
    })
    .finally(() => {
      syncManager.isRunning = false;
      syncManager.stopRequested = false;
      syncManager.stats.currentTask = null;
    });
  res.json({ message: `Sincronización de productos iniciada para [${activeStore?.name || 'Tienda'}].` });
});

app.post('/api/sync-orders', (req, res) => {
  if (!syncManager) return res.status(500).json({ message: 'SyncManager no inicializado' });
  if (syncManager.isRunning) {
    return res.status(409).json({ message: 'Ya hay una tarea en progreso.' });
  }
  const payload = req.body || {};
  syncManager.isRunning = true;
  syncManager.stopRequested = false;
  syncManager.stats.status = 'running';
  syncManager.stats.currentTask = 'Pedidos';
  syncManager.syncOrders(payload)
    .catch(err => {
      console.error(err);
      syncManager.stats.status = 'error';
    })
    .finally(() => {
      syncManager.isRunning = false;
      syncManager.stopRequested = false;
      syncManager.stats.currentTask = null;
    });
  res.json({ message: `Sincronización de pedidos iniciada para [${activeStore?.name || 'Tienda'}].` });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Universal WooCommerce ➔ Shopify Sync Engine`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`🏪 Tienda Activa: ${activeStore ? activeStore.name : 'Ninguna'}`);
  console.log(`==================================================\n`);
});
