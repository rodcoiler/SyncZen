class ShopifyClient {
  constructor(config = {}) {
    this.shopDomain = (config.shopDomain || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.clientId = config.clientId || null;
    this.clientSecret = config.clientSecret || null;
    this.accessToken = config.accessToken || null;
    this.apiVersion = config.apiVersion || '2024-01';
    this.tokenExpiresAt = null;
  }

  get baseUrl() {
    return `https://${this.shopDomain}/admin/api/${this.apiVersion}`;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtiene o renueva el Access Token usando Client ID y Client Secret (OAuth Client Credentials)
   */
  async getValidAccessToken() {
    if (this.accessToken && !this.tokenExpiresAt) {
      return this.accessToken;
    }

    const now = Date.now();
    if (this.accessToken && this.tokenExpiresAt && now < this.tokenExpiresAt - 120000) {
      return this.accessToken;
    }

    if (this.clientId && this.clientSecret) {
      try {
        const tokenUrl = `https://${this.shopDomain}/admin/oauth/access_token`;
        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'client_credentials'
          })
        });

        const data = await res.json();
        if (res.ok && data.access_token) {
          this.accessToken = data.access_token;
          const expiresInSec = data.expires_in || 86400;
          this.tokenExpiresAt = Date.now() + (expiresInSec * 1000);
          return this.accessToken;
        } else {
          if (data.error === 'shop_not_permitted' || data.error_description || !res.ok) {
            throw new Error('Esta tienda requiere autorizar la app mediante el botón "🔑 Vincular Shopify" o configurar un Token directo (shpat_...)');
          }
          throw new Error(JSON.stringify(data.errors || data));
        }
      } catch (err) {
        throw new Error(err.message);
      }
    }

    if (this.accessToken) {
      return this.accessToken;
    }

    throw new Error('Faltan credenciales de Shopify: Haz clic en "🔑 Vincular Shopify" o ingresa un Token de Acceso (shpat_...)');
  }

  /**
   * Intercambia el código de autorización OAuth por un Access Token permanente
   */
  async exchangeAuthCode(code) {
    const tokenUrl = `https://${this.shopDomain}/admin/oauth/access_token`;
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code
      })
    });

    const data = await res.json();
    if (res.ok && data.access_token) {
      this.accessToken = data.access_token;
      return data.access_token;
    } else {
      throw new Error(`Error en intercambio OAuth de Shopify: ${JSON.stringify(data.errors || data)}`);
    }
  }

  async getHeaders() {
    const token = await this.getValidAccessToken();
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    };
  }

  async testConnection() {
    try {
      if (!this.shopDomain) {
        return { ok: false, error: 'Dominio de Shopify no configurado.' };
      }
      if (!this.accessToken && (!this.clientId || !this.clientSecret)) {
        return { ok: false, error: 'Falta Token de Acceso o Client ID + Client Secret de Shopify.' };
      }
      const headers = await this.getHeaders();
      const res = await fetch(`${this.baseUrl}/shop.json`, { headers });
      const data = await res.json();
      if (res.ok && data.shop) {
        return { ok: true, shop: data.shop.name, domain: data.shop.myshopify_domain };
      }
      return { ok: false, error: JSON.stringify(data.errors || data) || `Status HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async rest(endpoint, options = {}) {
    const headers = await this.getHeaders();
    const url = `${this.baseUrl}/${endpoint.replace(/^\//, '')}`;
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
          const retryAfter = parseFloat(res.headers.get('Retry-After') || '2');
          await this.sleep(retryAfter * 1000);
          retries++;
          continue;
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(JSON.stringify(data.errors || data));
        }
        return data;
      } catch (err) {
        if (retries >= 2) throw err;
        await this.sleep(1500 * (retries + 1));
        retries++;
      }
    }
  }

  async graphql(query, variables = {}) {
    const token = await this.getValidAccessToken();
    const url = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;

    let retries = 0;
    while (retries < 3) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': token
          },
          body: JSON.stringify({ query, variables })
        });

        if (res.status === 429) {
          const retryAfter = parseFloat(res.headers.get('Retry-After') || '2');
          await this.sleep(retryAfter * 1000);
          retries++;
          continue;
        }

        const data = await res.json();
        return data;
      } catch (err) {
        if (retries >= 2) throw err;
        await this.sleep(1500 * (retries + 1));
        retries++;
      }
    }
  }

  /**
   * Carga todos los SKUs existentes en Shopify en un Set para verificación ultra-rápida O(1)
   */
  async getAllExistingSkus() {
    const skus = new Set();
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = `
        query getSkus($cursor: String) {
          productVariants(first: 250, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                sku
              }
            }
          }
        }
      `;

      const data = await this.graphql(query, { cursor });
      const variants = data?.data?.productVariants;
      if (!variants) break;

      for (const edge of variants.edges || []) {
        if (edge.node?.sku) {
          skus.add(edge.node.sku.trim().toLowerCase());
        }
      }

      hasNextPage = variants.pageInfo?.hasNextPage;
      cursor = variants.pageInfo?.endCursor;
      await this.sleep(120);
    }

    return skus;
  }

  /**
   * Obtiene todos los productos de Shopify con sus variantes, IDs y SKUs
   */
  async getAllProducts(options = {}) {
    const products = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = `
        query getShopifyProducts($cursor: String) {
          products(first: 100, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                legacyResourceId
                title
                handle
                status
                variants(first: 100) {
                  edges {
                    node {
                      id
                      legacyResourceId
                      sku
                      title
                      price
                      inventoryQuantity
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const data = await this.graphql(query, { cursor });
      const prods = data?.data?.products;
      if (!prods) break;

      for (const edge of prods.edges || []) {
        if (edge.node) {
          const p = edge.node;
          const variantsList = (p.variants?.edges || []).map(v => v.node);
          products.push({
            id: p.id,
            numericId: p.legacyResourceId,
            title: p.title,
            handle: p.handle,
            status: p.status,
            variants: variantsList,
            skus: variantsList.map(v => (v.sku || '').trim().toLowerCase()).filter(Boolean)
          });
        }
      }

      hasNextPage = prods.pageInfo?.hasNextPage;
      cursor = prods.pageInfo?.endCursor;
      await this.sleep(120);
    }

    return products;
  }

  async checkSkuExists(sku) {
    if (!sku) return false;
    const cleanSku = sku.trim().replace(/"/g, '\\"');
    const query = `
      query checkSku($query: String!) {
        productVariants(first: 1, query: $query) {
          edges {
            node {
              id
              sku
            }
          }
        }
      }
    `;
    const data = await this.graphql(query, { query: `sku:"${cleanSku}"` });
    const edges = data?.data?.productVariants?.edges || [];
    return edges.length > 0;
  }

  async createCustomer(customerData) {
    return await this.rest('customers.json', {
      method: 'POST',
      body: { customer: customerData }
    });
  }

  async createProduct(productData) {
    return await this.rest('products.json', {
      method: 'POST',
      body: { product: productData }
    });
  }

  async updateProduct(productId, productData) {
    const id = productId.toString().replace(/\D/g, '');
    return await this.rest(`products/${id}.json`, {
      method: 'PUT',
      body: { product: productData }
    });
  }

  async deleteProduct(productId) {
    const id = productId.toString().replace(/\D/g, '');
    return await this.rest(`products/${id}.json`, {
      method: 'DELETE'
    });
  }

  async archiveProduct(productId) {
    const id = productId.toString().replace(/\D/g, '');
    return await this.rest(`products/${id}.json`, {
      method: 'PUT',
      body: { product: { id: parseInt(id), status: 'archived' } }
    });
  }

  async draftProduct(productId) {
    const id = productId.toString().replace(/\D/g, '');
    return await this.rest(`products/${id}.json`, {
      method: 'PUT',
      body: { product: { id: parseInt(id), status: 'draft' } }
    });
  }

  async createOrder(orderData) {
    return await this.rest('orders.json', {
      method: 'POST',
      body: { order: orderData }
    });
  }

  async getCustomers(page = 1, limit = 50, params = {}) {
    let query = `limit=${limit}&page=${page}`;
    if (params.since_id) query += `&since_id=${params.since_id}`;
    return await this.rest(`customers.json?${query}`);
  }

  async getOrders(page = 1, limit = 50, params = {}) {
    let query = `limit=${limit}&status=any`;
    if (params.since_id) query += `&since_id=${params.since_id}`;
    return await this.rest(`orders.json?${query}`);
  }

  /**
   * Obtiene todos los IDs de pedidos de WooCommerce ya importados a Shopify (vía tags WooOrder-*)
   */
  async getExistingWooOrderIds() {
    const existingIds = new Set();
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const cursorArg = cursor ? `, after: "${cursor}"` : '';
      const query = `{
        orders(first: 250, query: "tag:WooCommerce"${cursorArg}) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              tags
            }
          }
        }
      }`;

      try {
        const res = await this.graphql(query);
        const ordersData = res?.data?.orders;
        const edges = ordersData?.edges || [];

        for (const edge of edges) {
          const tags = edge.node?.tags || [];
          for (const t of tags) {
            if (t.startsWith('WooOrder-')) {
              existingIds.add(t.replace('WooOrder-', '').trim());
            }
          }
        }

        hasNextPage = Boolean(ordersData?.pageInfo?.hasNextPage);
        cursor = ordersData?.pageInfo?.endCursor;

        if (edges.length === 0 || !cursor) break;
      } catch (err) {
        console.warn('[ShopifyClient] Error al consultar pedidos existentes para deduplicación:', err.message);
        break;
      }
    }

    return existingIds;
  }
}

module.exports = ShopifyClient;
