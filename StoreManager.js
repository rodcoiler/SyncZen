const fs = require('fs');
const path = require('path');

class StoreManager {
  constructor(filePath) {
    this.filePath = filePath || path.resolve(__dirname, 'stores.json');
    this.data = {
      activeStoreId: 'dumashe',
      stores: []
    };
    this.init();
  }

  init() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
      } else {
        const examplePath = path.resolve(__dirname, 'stores.example.json');
        if (fs.existsSync(examplePath)) {
          const rawExample = fs.readFileSync(examplePath, 'utf8');
          this.data = JSON.parse(rawExample);
        } else {
          this.data = {
            activeStoreId: 'tienda-1',
            stores: []
          };
        }
        this.save();
      }
    } catch (err) {
      console.error('[StoreManager] Error leyendo stores.json:', err.message);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[StoreManager] Error guardando stores.json:', err.message);
      return false;
    }
  }

  getStores() {
    return this.data.stores || [];
  }

  getActiveStore() {
    const store = (this.data.stores || []).find(s => s.id === this.data.activeStoreId);
    if (store) return store;
    if (this.data.stores && this.data.stores.length > 0) {
      this.data.activeStoreId = this.data.stores[0].id;
      this.save();
      return this.data.stores[0];
    }
    return null;
  }

  setActiveStore(storeId) {
    const exists = (this.data.stores || []).some(s => s.id === storeId);
    if (!exists) {
      throw new Error(`La tienda con id "${storeId}" no existe.`);
    }
    this.data.activeStoreId = storeId;
    this.save();
    return this.getActiveStore();
  }

  saveStore(storePayload) {
    if (!storePayload || typeof storePayload !== 'object') {
      throw new Error('Payload inválido');
    }

    const id = (storePayload.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || `store_${Date.now()}`;
    const cleanDomain = (storePayload.shopifyShopDomain || '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .trim();

    const cleanWooUrl = (storePayload.wooStoreUrl || '')
      .trim()
      .replace(/\/$/, '');

    const newStore = {
      id,
      name: (storePayload.name || 'Nueva Tienda').trim(),
      shopifyShopDomain: cleanDomain,
      shopifyClientId: (storePayload.shopifyClientId || '').trim(),
      shopifyClientSecret: (storePayload.shopifyClientSecret || '').trim(),
      shopifyAccessToken: (storePayload.shopifyAccessToken || '').trim(),
      shopifyApiVersion: storePayload.shopifyApiVersion || '2024-01',
      wooStoreUrl: cleanWooUrl,
      wooConsumerKey: (storePayload.wooConsumerKey || '').trim(),
      wooConsumerSecret: (storePayload.wooConsumerSecret || '').trim(),
      defaultCountry: (storePayload.defaultCountry || 'CO').trim().toUpperCase(),
      defaultCurrency: (storePayload.defaultCurrency || 'COP').trim().toUpperCase()
    };

    const existingIdx = this.data.stores.findIndex(s => s.id === id);
    if (existingIdx >= 0) {
      // Mantener token si no se envió uno nuevo y ya existía uno guardado
      if (!newStore.shopifyAccessToken && this.data.stores[existingIdx].shopifyAccessToken) {
        newStore.shopifyAccessToken = this.data.stores[existingIdx].shopifyAccessToken;
      }
      this.data.stores[existingIdx] = newStore;
    } else {
      this.data.stores.push(newStore);
    }

    this.save();
    return newStore;
  }

  deleteStore(storeId) {
    if (this.data.stores.length <= 1) {
      throw new Error('No se puede eliminar la única tienda configurada.');
    }
    this.data.stores = this.data.stores.filter(s => s.id !== storeId);
    if (this.data.activeStoreId === storeId) {
      this.data.activeStoreId = this.data.stores[0].id;
    }
    this.save();
    return this.getActiveStore();
  }

  updateAccessToken(storeId, token) {
    const store = (this.data.stores || []).find(s => s.id === storeId);
    if (store) {
      store.shopifyAccessToken = token;
      this.save();
      return true;
    }
    return false;
  }
}

module.exports = StoreManager;

