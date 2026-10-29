class WooClient {
  constructor(config = {}) {
    this.storeUrl = (config.storeUrl || '').replace(/\/$/, '');
    this.consumerKey = config.consumerKey || '';
    this.consumerSecret = config.consumerSecret || '';
    this.pluginSecret = config.pluginSecret || '';
  }

  get basicAuthHeader() {
    if (this.consumerKey && this.consumerSecret) {
      const creds = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      return `Basic ${creds}`;
    }
    return null;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async rest(endpoint, options = {}) {
    const cleanEndpoint = endpoint.replace(/^\//, '');
    const url = `${this.storeUrl}/wp-json/wc/v3/${cleanEndpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (this.basicAuthHeader) {
      headers['Authorization'] = this.basicAuthHeader;
    }

    const opts = {
      method: options.method || 'GET',
      headers: { ...headers, ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    };

    let retries = 0;
    while (retries < 3) {
      try {
        const res = await fetch(url, opts);
        if (res.status === 429) {
          await this.sleep(2000);
          retries++;
          continue;
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(JSON.stringify(data.message || data));
        }
        return { data, headers: res.headers };
      } catch (err) {
        if (retries >= 2) throw err;
        await this.sleep(1200 * (retries + 1));
        retries++;
      }
    }
  }

  async testConnection() {
    try {
      if (!this.storeUrl) {
        return { ok: false, error: 'URL de WooCommerce no configurada' };
      }

      // Probar API nativa de WooCommerce v3
      if (this.basicAuthHeader) {
        try {
          const res = await fetch(`${this.storeUrl}/wp-json/wc/v3/system_status`, {
            headers: { 'Authorization': this.basicAuthHeader }
          });
          if (res.ok) {
            const data = await res.json();
            return { ok: true, source: 'WooCommerce REST API v3', store: data.environment?.site_title || this.storeUrl };
          }
        } catch (e) {}
      }

      // Fallback a plugin Derene Sync
      const pluginUrl = `${this.storeUrl}/wp-json/derene-sync/v1/status`;
      try {
        const res = await fetch(pluginUrl, {
          headers: this.pluginSecret ? { 'X-Derene-Secret': this.pluginSecret } : {}
        });
        if (res.ok) {
          const data = await res.json();
          return { ok: true, source: 'Plugin Derene Sync', store: data.store, stats: data };
        }
      } catch (e) {}

      return { ok: false, error: 'No se pudo conectar a WooCommerce. Revisa credenciales o plugin.' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async getCustomers(page = 1, perPage = 50, options = {}) {
    let query = `page=${page}&per_page=${perPage}&role=all`;
    if (options.startDate) {
      const dt = options.startDate.includes('T') ? options.startDate : `${options.startDate}T00:00:00`;
      query += `&after=${encodeURIComponent(dt)}`;
    }
    if (options.endDate) {
      const dt = options.endDate.includes('T') ? options.endDate : `${options.endDate}T23:59:59`;
      query += `&before=${encodeURIComponent(dt)}`;
    }

    if (this.basicAuthHeader) {
      const res = await fetch(`${this.storeUrl}/wp-json/wc/v3/customers?${query}`, {
        headers: { 'Authorization': this.basicAuthHeader }
      });
      if (res.ok) return await res.json();
    }

    const res = await fetch(`${this.storeUrl}/wp-json/derene-sync/v1/customers?${query}`, {
      headers: this.pluginSecret ? { 'X-Derene-Secret': this.pluginSecret } : {}
    });
    if (!res.ok) throw new Error(`Woo Error ${res.status}`);
    return await res.json();
  }

  async getProducts(page = 1, perPage = 50, options = {}) {
    const status = options.status || 'publish'; // 'publish', 'draft', 'any'
    let query = `page=${page}&per_page=${perPage}`;
    if (status && status !== 'all' && status !== 'any') {
      query += `&status=${encodeURIComponent(status)}`;
    } else {
      query += `&status=any`;
    }

    if (this.basicAuthHeader) {
      const res = await fetch(`${this.storeUrl}/wp-json/wc/v3/products?${query}`, {
        headers: { 'Authorization': this.basicAuthHeader }
      });
      if (res.ok) return await res.json();
    }

    const res = await fetch(`${this.storeUrl}/wp-json/derene-sync/v1/products?${query}`, {
      headers: this.pluginSecret ? { 'X-Derene-Secret': this.pluginSecret } : {}
    });
    if (!res.ok) throw new Error(`Woo Error ${res.status}`);
    return await res.json();
  }

  async getOrders(page = 1, perPage = 50, options = {}) {
    let query = `page=${page}&per_page=${perPage}&status=completed,processing`;
    if (options.startDate) {
      const dt = options.startDate.includes('T') ? options.startDate : `${options.startDate}T00:00:00`;
      query += `&after=${encodeURIComponent(dt)}`;
    }
    if (options.endDate) {
      const dt = options.endDate.includes('T') ? options.endDate : `${options.endDate}T23:59:59`;
      query += `&before=${encodeURIComponent(dt)}`;
    }

    if (this.basicAuthHeader) {
      const res = await fetch(`${this.storeUrl}/wp-json/wc/v3/orders?${query}`, {
        headers: { 'Authorization': this.basicAuthHeader }
      });
      if (res.ok) return await res.json();
    }

    const res = await fetch(`${this.storeUrl}/wp-json/derene-sync/v1/orders?${query}`, {
      headers: this.pluginSecret ? { 'X-Derene-Secret': this.pluginSecret } : {}
    });
    if (!res.ok) throw new Error(`Woo Error ${res.status}`);
    return await res.json();
  }

  /**
   * Obtiene todos los SKUs y títulos existentes en WooCommerce (incluyendo variaciones)
   */
  async getAllSkusAndTitles(options = {}) {
    const status = options.status || 'any';
    const skus = new Set();
    const titles = new Set();
    const variableProductIds = [];

    let page = 1;
    while (true) {
      const query = `page=${page}&per_page=100&status=${status}&_fields=id,name,sku,type,variations`;
      const res = await fetch(`${this.storeUrl}/wp-json/wc/v3/products?${query}`, {
        headers: { 'Authorization': this.basicAuthHeader }
      });
      if (!res.ok) break;

      const prods = await res.json();
      if (!prods || prods.length === 0) break;

      for (const p of prods) {
        if (p.sku) skus.add(p.sku.trim().toLowerCase());
        if (p.name) titles.add(p.name.trim().toLowerCase());
        if (p.type === 'variable' && Array.isArray(p.variations) && p.variations.length > 0) {
          variableProductIds.push(p.id);
        }
      }

      page++;
      if (prods.length < 100) break;
      await this.sleep(100);
    }

    // Obtener SKUs de variaciones de productos variables
    for (const parentId of variableProductIds) {
      try {
        const varRes = await fetch(`${this.storeUrl}/wp-json/wc/v3/products/${parentId}/variations?per_page=100&_fields=id,sku`, {
          headers: { 'Authorization': this.basicAuthHeader }
        });
        if (varRes.ok) {
          const variations = await varRes.json();
          for (const v of variations || []) {
            if (v.sku) skus.add(v.sku.trim().toLowerCase());
          }
        }
      } catch (err) {}
      await this.sleep(80);
    }

    return { skus, titles };
  }

  async createProduct(productData) {
    const res = await this.rest('products', {
      method: 'POST',
      body: productData
    });
    return res.data;
  }

  async updateProduct(id, productData) {
    const res = await this.rest(`products/${id}`, {
      method: 'PUT',
      body: productData
    });
    return res.data;
  }

  async deleteProduct(id, force = true) {
    const res = await this.rest(`products/${id}?force=${force}`, {
      method: 'DELETE'
    });
    return res.data;
  }

  async createCustomer(customerData) {
    const res = await this.rest('customers', {
      method: 'POST',
      body: customerData
    });
    return res.data;
  }

  async createOrder(orderData) {
    const res = await this.rest('orders', {
      method: 'POST',
      body: orderData
    });
    return res.data;
  }
}

module.exports = WooClient;
