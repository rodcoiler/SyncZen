const COLOMBIA_DANE_PROVINCES = {
  '05': 'Antioquia',
  '08': 'Atlántico',
  '11': 'Bogotá, D.C.',
  '13': 'Bolívar',
  '15': 'Boyacá',
  '17': 'Caldas',
  '18': 'Caquetá',
  '19': 'Cauca',
  '20': 'Cesar',
  '23': 'Córdoba',
  '25': 'Cundinamarca',
  '27': 'Chocó',
  '41': 'Huila',
  '44': 'La Guajira',
  '47': 'Magdalena',
  '50': 'Meta',
  '52': 'Nariño',
  '54': 'Norte de Santander',
  '63': 'Quindío',
  '66': 'Risaralda',
  '68': 'Santander',
  '70': 'Sucre',
  '73': 'Tolima',
  '76': 'Valle del Cauca',
  '81': 'Arauca',
  '85': 'Casanare',
  '86': 'Putumayo',
  '88': 'San Andrés, Providencia y Santa Catalina',
  '91': 'Amazonas',
  '94': 'Guainía',
  '95': 'Guaviare',
  '97': 'Vaupés',
  '99': 'Vichada'
};

const COLOMBIA_CODE_MAP = {
  'AMA': 'Amazonas',
  'ANT': 'Antioquia',
  'ARA': 'Arauca',
  'ATL': 'Atlántico',
  'BOG': 'Bogotá, D.C.',
  'DC': 'Bogotá, D.C.',
  'BOL': 'Bolívar',
  'BOY': 'Boyacá',
  'CAL': 'Caldas',
  'CAQ': 'Caquetá',
  'CAS': 'Casanare',
  'CAU': 'Cauca',
  'CES': 'Cesar',
  'CHO': 'Chocó',
  'COR': 'Córdoba',
  'CUN': 'Cundinamarca',
  'GUA': 'Guainía',
  'GUV': 'Guaviare',
  'HUI': 'Huila',
  'LAG': 'La Guajira',
  'MAG': 'Magdalena',
  'MET': 'Meta',
  'NAR': 'Nariño',
  'NSA': 'Norte de Santander',
  'PUT': 'Putumayo',
  'QUI': 'Quindío',
  'RIS': 'Risaralda',
  'SAN': 'Santander',
  'SAP': 'San Andrés, Providencia y Santa Catalina',
  'SUC': 'Sucre',
  'TOL': 'Tolima',
  'VAC': 'Valle del Cauca',
  'VAU': 'Vaupés',
  'VID': 'Vichada'
};

function normalizeProvince(state, country = 'CO') {
  if (!state) return undefined;
  const str = state.toString().trim();
  if (!str) return undefined;

  if (country === 'CO') {
    const cleanDigits = str.replace(/\D/g, '');
    if (cleanDigits.length >= 2) {
      const prefix2 = cleanDigits.slice(0, 2);
      if (COLOMBIA_DANE_PROVINCES[prefix2]) {
        return COLOMBIA_DANE_PROVINCES[prefix2];
      }
    }

    const upper = str.toUpperCase();
    if (COLOMBIA_CODE_MAP[upper]) {
      return COLOMBIA_CODE_MAP[upper];
    }

    const normalized = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (const [code, name] of Object.entries(COLOMBIA_CODE_MAP)) {
      const nameNorm = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (nameNorm === normalized || normalized.includes(nameNorm) || nameNorm.includes(normalized)) {
        return name;
      }
    }

    return undefined;
  }

  return str;
}

class SyncManager {
  constructor(wooClient, shopifyClient, storeConfig = {}) {
    this.woo = wooClient;
    this.shopify = shopifyClient;
    this.storeConfig = storeConfig;
    this.isRunning = false;
    this.stopRequested = false;
    this.stats = {
      lastRun: null,
      status: 'idle', // idle, running, success, error, stopped
      currentTask: null,
      customersSynced: 0,
      customersSkipped: 0,
      productsSynced: 0,
      productsSkipped: 0,
      productsUpdated: 0,
      productsDeleted: 0,
      productsArchived: 0,
      ordersSynced: 0,
      ordersSkipped: 0,
      errorsCount: 0,
      recentLogs: []
    };
  }

  updateClients(wooClient, shopifyClient, storeConfig = {}) {
    this.woo = wooClient;
    this.shopify = shopifyClient;
    this.storeConfig = storeConfig;
    this.log(`Configuración actualizada para tienda activa: "${storeConfig.name || 'Personalizada'}"`, 'info');
  }

  log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = { timestamp, message: msg, type };
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${msg}`);
    this.stats.recentLogs.unshift(entry);
    if (this.stats.recentLogs.length > 300) {
      this.stats.recentLogs.pop();
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stopSync() {
    if (!this.isRunning) {
      this.log('No hay ninguna sincronización activa para detener.', 'warn');
      return false;
    }
    this.stopRequested = true;
    this.stats.status = 'stopped';
    this.log('🛑 Solicitud de detención recibida. Frenando sincronización...', 'warn');
    return true;
  }

  formatE164(phone, defaultCountry = (this.storeConfig.defaultCountry || 'CO')) {
    if (!phone) return null;
    let raw = phone.toString().trim();
    if (!raw) return null;

    if (raw.startsWith('+')) {
      const clean = '+' + raw.replace(/\D/g, '');
      return clean.length >= 8 ? clean : null;
    }

    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;

    const country = (defaultCountry || '').toUpperCase();

    if (country === 'CO') {
      if (digits.startsWith('57') && digits.length === 12) {
        return `+${digits}`;
      }
      if (digits.length === 10) {
        return `+57${digits}`;
      }
    } else if (country === 'BR') {
      if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
        return `+${digits}`;
      }
      if (digits.length === 10 || digits.length === 11) {
        return `+55${digits}`;
      }
    }

    if (digits.length === 10) {
      const prefix = country === 'BR' ? '55' : '57';
      return `+${prefix}${digits}`;
    }

    return digits.length >= 8 ? `+${digits}` : null;
  }

  // ==========================================
  // Sincronización de Clientes (Woo ➔ Shopify)
  // ==========================================
  async syncCustomers(options = {}) {
    const storeName = this.storeConfig.name || 'Store';
    const direction = options.direction || 'woo_to_shopify';

    if (direction === 'shopify_to_woo') {
      return await this.syncCustomersShopifyToWoo(options);
    }

    this.log(`Iniciando sincronización de clientes WooCommerce ➔ Shopify [${storeName}]... ${options.startDate ? `(Desde: ${options.startDate})` : ''} ${options.endDate ? `(Hasta: ${options.endDate})` : ''}`);
    let page = 1;
    let total = 0;

    while (true) {
      if (this.stopRequested) {
        this.log('⏹️ Sincronización de clientes detenida por el usuario.', 'warn');
        break;
      }

      this.log(`Obteniendo página ${page} de clientes desde WooCommerce...`);
      let customers = [];
      try {
        customers = await this.woo.getCustomers(page, 50, options);
      } catch (err) {
        this.log(`Error obteniendo clientes en página ${page}: ${err.message}`, 'error');
        this.stats.errorsCount++;
        break;
      }

      if (!customers || customers.length === 0) break;

      for (const c of customers) {
        if (this.stopRequested) {
          this.log('⏹️ Sincronización de clientes detenida por el usuario.', 'warn');
          break;
        }

        try {
          const email = (c.email || c.billing?.email || '').trim();
          if (!email) continue;

          const firstName = (c.first_name || c.billing?.first_name || '').trim();
          const lastName = (c.last_name || c.billing?.last_name || '').trim();
          const rawPhone = c.billing?.phone || c.phone || '';
          const customerCountry = (c.billing?.country || this.storeConfig.defaultCountry || 'CO').toUpperCase();
          const phoneE164 = this.formatE164(rawPhone, customerCountry);

          const rawState = c.billing?.state || c.address?.province || '';
          const validProvince = normalizeProvince(rawState, customerCountry);

          const payload = {
            first_name: firstName,
            last_name: lastName,
            email: email,
            verified_email: true,
            tags: `WooCommerce, DereneSync, ${storeName}`,
            note: `Importado de WooCommerce. ${c.billing?.cpf ? `Doc/CPF: ${c.billing.cpf}. ` : ''}DANE/State: ${rawState}. Pedidos previos: ${c.orders_count || 0}`
          };

          if (phoneE164) {
            payload.phone = phoneE164;
          }

          const billing = c.billing || {};
          if (billing.address_1 || billing.city) {
            const addrObj = {
              first_name: firstName,
              last_name: lastName,
              address1: [billing.address_1, billing.number].filter(Boolean).join(', ') || billing.address_1,
              address2: [billing.address_2, billing.neighborhood].filter(Boolean).join(' - ') || billing.address_2 || '',
              city: billing.city || '',
              country: billing.country || customerCountry,
              zip: billing.postcode || '',
              phone: rawPhone || undefined,
              default: true
            };
            if (validProvince) addrObj.province = validProvince;
            payload.addresses = [addrObj];
          } else if (c.address && c.address.address1) {
            const addrObj = {
              first_name: firstName,
              last_name: lastName,
              address1: c.address.address1,
              address2: c.address.address2 || '',
              city: c.address.city || '',
              country: c.address.country || customerCountry,
              zip: c.address.zip || '',
              phone: rawPhone || undefined,
              default: true
            };
            if (validProvince) addrObj.province = validProvince;
            payload.addresses = [addrObj];
          }

          try {
            await this.shopify.createCustomer(payload);
          } catch (createErr) {
            const errMsg = createErr.message || '';
            if (errMsg.includes('has already been taken')) {
              this.log(`⏭️ [YA EXISTE] Cliente en Shopify: ${email} (Omitido sin duplicar)`, 'info');
              this.stats.customersSkipped++;
              continue;
            }

            if (errMsg.includes('province') && errMsg.includes('invalid') && payload.addresses?.length) {
              this.log(`⚠️ Ajustando provincia no reconocida (${rawState}) para ${email}. Reintentando...`, 'warn');
              delete payload.addresses[0].province;
              try {
                await this.shopify.createCustomer(payload);
              } catch (retryErr) {
                if (retryErr.message.includes('has already been taken')) {
                  this.stats.customersSkipped++;
                  continue;
                }
                if (retryErr.message.includes('addresses')) {
                  payload.note += ` | Dir: ${payload.addresses[0].address1 || ''}, ${payload.addresses[0].city || ''}`;
                  delete payload.addresses;
                  await this.shopify.createCustomer(payload);
                } else {
                  throw retryErr;
                }
              }
            } else {
              throw createErr;
            }
          }

          this.stats.customersSynced++;
          total++;
          this.log(`Cliente transferido: ${firstName} ${lastName} (${email})${validProvince ? ` - ${validProvince}` : ''}`);
        } catch (err) {
          if (err.message && err.message.includes('has already been taken')) {
            this.log(`⏭️ [YA EXISTE] Cliente en Shopify: ${c.email || c.billing?.email} (Omitido sin duplicar)`, 'info');
            this.stats.customersSkipped++;
          } else {
            this.log(`Error al transferir cliente ${c.email || c.id}: ${err.message}`, 'error');
            this.stats.errorsCount++;
          }
        }
        await this.sleep(400);
      }

      page++;
      if (customers.length < 50 || this.stopRequested) break;
    }

    this.log(`Sincronización de clientes completada. Creados: ${total}, Ya existentes: ${this.stats.customersSkipped}`);
    return total;
  }

  // ==========================================
  // Utilidades de Precios Mayoristas (Precios 2, 3 y 4)
  // ==========================================
  extractTierPrices(metaData = [], fallbackMetaData = []) {
    const prices = { price_2: null, price_3: null, price_4: null };
    const parseFromList = (list) => {
      if (!Array.isArray(list)) return;
      for (const m of list) {
        if (!m || !m.key) continue;
        const key = m.key.toString().toLowerCase().trim();
        const rawVal = m.value != null ? String(m.value).trim() : '';
        if (!rawVal || isNaN(Number(rawVal)) || Number(rawVal) <= 0) continue;
        const formatted = parseFloat(rawVal).toFixed(1);

        if ((key === 'variable_price_2' || key === '_variable_price_2' || key === 'price_2') && !prices.price_2) {
          prices.price_2 = formatted;
        } else if ((key === 'variable_price_3' || key === '_variable_price_3' || key === 'price_3') && !prices.price_3) {
          prices.price_3 = formatted;
        } else if ((key === 'variable_price_4' || key === '_variable_price_4' || key === 'price_4') && !prices.price_4) {
          prices.price_4 = formatted;
        }
      }
    };

    parseFromList(metaData);
    parseFromList(fallbackMetaData);
    return prices;
  }

  buildRestMetafields(tierPrices = {}) {
    const list = [];
    if (tierPrices.price_2) {
      list.push({ namespace: 'dumashe', key: 'price_2', value: tierPrices.price_2, type: 'number_decimal' });
    }
    if (tierPrices.price_3) {
      list.push({ namespace: 'dumashe', key: 'price_3', value: tierPrices.price_3, type: 'number_decimal' });
    }
    if (tierPrices.price_4) {
      list.push({ namespace: 'dumashe', key: 'price_4', value: tierPrices.price_4, type: 'number_decimal' });
    }
    return list;
  }

  buildGraphqlMetafields(ownerId, tierPrices = {}) {
    if (!ownerId) return [];
    const list = [];
    if (tierPrices.price_2) {
      list.push({ ownerId, namespace: 'dumashe', key: 'price_2', value: tierPrices.price_2, type: 'number_decimal' });
    }
    if (tierPrices.price_3) {
      list.push({ ownerId, namespace: 'dumashe', key: 'price_3', value: tierPrices.price_3, type: 'number_decimal' });
    }
    if (tierPrices.price_4) {
      list.push({ ownerId, namespace: 'dumashe', key: 'price_4', value: tierPrices.price_4, type: 'number_decimal' });
    }
    return list;
  }

  // ==========================================
  // Sincronización de Productos (Woo ➔ Shopify)
  // ==========================================
  async syncProducts(options = {}) {
    const storeName = this.storeConfig.name || 'Store';
    const direction = options.direction || 'woo_to_shopify';

    if (direction === 'shopify_to_woo') {
      return await this.syncProductsShopifyToWoo(options);
    }

    const productStatus = options.productStatus || 'publish'; // 'publish', 'any', 'draft'
    const onExisting = options.onExisting || 'update_stock_price'; // 'update_stock_price', 'skip', 'update_all'
    const onMissing = options.onMissing || 'create'; // 'create', 'skip'

    this.log(`Iniciando sincronización de productos WooCommerce ➔ Shopify [${storeName}]...`);
    this.log(`Configuración: Estado origen = "${productStatus}", Si ya existe = "${onExisting}", Si no existe = "${onMissing}"`);

    let primaryLocationId = null;
    try {
      primaryLocationId = await this.shopify.getPrimaryLocationId();
    } catch (locErr) {
      this.log(`Aviso al obtener ubicación de inventario: ${locErr.message}`, 'warn');
    }

    // 1. Cargar índice completo de productos, variantes, SKUs y títulos de Shopify
    this.log('🔍 Analizando catálogo existente en Shopify (SKUs, variaciones y precios 2/3)...');
    const existingSkus = new Set();
    const skuToVariant = new Map();
    const titleToProduct = new Map();

    try {
      const shopifyCatalog = await this.shopify.getAllProducts();
      for (const sp of shopifyCatalog) {
        const normTitle = (sp.title || '').trim().toLowerCase();
        const existingByTitle = titleToProduct.get(normTitle);
        // Preferir la publicación que tiene múltiples variantes o SKUs válidos
        if (!existingByTitle || (sp.variants.length > existingByTitle.variants.length) || (sp.skus.length > existingByTitle.skus.length)) {
          titleToProduct.set(normTitle, sp);
        }
        for (const v of sp.variants || []) {
          const vSku = (v.sku || '').trim().toLowerCase();
          if (vSku) {
            existingSkus.add(vSku);
            skuToVariant.set(vSku, { product: sp, variant: v });
          }
        }
      }
      this.log(`✅ Catálogo de Shopify indexado: ${shopifyCatalog.length} productos y ${existingSkus.size} SKUs detectados.`);
    } catch (skuErr) {
      this.log(`Aviso al indexar catálogo de Shopify: ${skuErr.message}.`, 'warn');
    }

    let page = 1;
    let totalCreated = 0;
    let totalUpdated = 0;

    while (true) {
      if (this.stopRequested) {
        this.log('⏹️ Sincronización de productos detenida por el usuario.', 'warn');
        break;
      }

      this.log(`Obteniendo página ${page} de productos desde WooCommerce (Filtro: ${productStatus})...`);
      let products = [];
      try {
        products = await this.woo.getProducts(page, 50, { status: productStatus });
      } catch (err) {
        this.log(`Error obteniendo productos en página ${page}: ${err.message}`, 'error');
        this.stats.errorsCount++;
        break;
      }

      if (!products || products.length === 0) break;

      for (const p of products) {
        if (this.stopRequested) {
          this.log('⏹️ Sincronización de productos detenida por el usuario.', 'warn');
          break;
        }

        try {
          const normTitle = (p.name || '').trim().toLowerCase();
          const rawSku = (p.sku || '').trim();
          const lowerSku = rawSku.toLowerCase();
          const isVariable = p.type === 'variable' || (Array.isArray(p.variations) && p.variations.length > 0);

          const vendor = (p.brands && p.brands.length) ? p.brands[0].name : (storeName || 'General');
          const productType = (p.categories && p.categories.length) ? p.categories[0].name : 'General';

          const rawImages = p.images || [];
          const formattedImages = rawImages.map(img => {
            if (typeof img === 'string') return { src: img };
            if (img && img.src) return { src: img.src };
            return null;
          }).filter(Boolean);

          const tagsList = ['WooCommerce', 'DereneSync', storeName];
          if (Array.isArray(p.categories)) {
            p.categories.forEach(c => { if (c.name) tagsList.push(c.name); });
          }
          if (Array.isArray(p.tags)) {
            p.tags.forEach(t => { if (t.name) tagsList.push(t.name); });
          }

          // ==========================================
          // PRODUCTO VARIABLE (Con Variaciones en 1 Sola Publicación)
          // ==========================================
          if (isVariable) {
            const wooVariations = await this.woo.getProductVariations(p.id);
            const activeVars = wooVariations.filter(v => !v.status || v.status === 'publish');

            if (activeVars.length === 0) {
              this.log(`⚠️ Producto variable "${p.name}" no tiene variaciones activas en WooCommerce. Omitiendo.`, 'warn');
              this.stats.productsSkipped++;
              continue;
            }

            // Buscar si ya existe en Shopify por SKU de alguna variación o por título
            let matchedShopifyProd = titleToProduct.get(normTitle) || null;
            if (!matchedShopifyProd) {
              for (const wv of activeVars) {
                const vSku = (wv.sku || '').trim().toLowerCase();
                if (vSku && skuToVariant.has(vSku)) {
                  matchedShopifyProd = skuToVariant.get(vSku).product;
                  break;
                }
              }
            }

            // Verificar si el producto existe y ya tiene sus variaciones en Shopify
            if (matchedShopifyProd && matchedShopifyProd.variants.length > 1) {
              // Asegurar que todas sus variantes tengan Precios 2 y 3 (y actualizar si se solicitó)
              const metafieldsToSet = [];
              const inventoryUpdates = [];
              let firstTierPrices = null;

              for (const wv of activeVars) {
                const vSku = (wv.sku || '').trim().toLowerCase();
                const tierPrices = this.extractTierPrices(wv.meta_data, p.meta_data);
                if (!firstTierPrices && (tierPrices.price_2 || tierPrices.price_3)) {
                  firstTierPrices = tierPrices;
                }

                const shopifyVar = matchedShopifyProd.variants.find(sv =>
                  (vSku && (sv.sku || '').trim().toLowerCase() === vSku)
                );

                if (shopifyVar) {
                  const existingMetaEdges = shopifyVar.metafields?.edges || [];
                  const currPrice2 = existingMetaEdges.find(e => e.node?.key === 'price_2')?.node?.value;
                  const currPrice3 = existingMetaEdges.find(e => e.node?.key === 'price_3')?.node?.value;

                  const needsPrice2Update = tierPrices.price_2 && currPrice2 !== tierPrices.price_2;
                  const needsPrice3Update = tierPrices.price_3 && currPrice3 !== tierPrices.price_3;

                  if (needsPrice2Update || needsPrice3Update || !currPrice2 || !currPrice3 || onExisting !== 'skip') {
                    metafieldsToSet.push(...this.buildGraphqlMetafields(shopifyVar.id, tierPrices));
                  }

                  if (onExisting === 'update_stock_price' || onExisting === 'update_all') {
                    const newPrice = wv.price || wv.regular_price || p.price || '0.00';
                    await this.shopify.updateVariant(shopifyVar.legacyResourceId, {
                      price: newPrice,
                      compare_at_price: (wv.sale_price && wv.regular_price && wv.sale_price !== wv.regular_price) ? wv.regular_price : null
                    });

                    const stockQty = wv.stock_quantity != null ? wv.stock_quantity : (wv.stock != null ? wv.stock : null);
                    if (primaryLocationId && shopifyVar.inventoryItem?.id && stockQty != null) {
                      inventoryUpdates.push({
                        inventoryItemId: shopifyVar.inventoryItem.id,
                        locationId: primaryLocationId,
                        quantity: Math.max(0, parseInt(stockQty, 10) || 0)
                      });
                    }
                  }
                }
              }

              if (firstTierPrices && matchedShopifyProd.id) {
                metafieldsToSet.push(...this.buildGraphqlMetafields(matchedShopifyProd.id, firstTierPrices));
              }

              if (metafieldsToSet.length > 0) {
                await this.shopify.setMetafieldsBatch(metafieldsToSet);
              }

              if (inventoryUpdates.length > 0) {
                await this.shopify.setInventoryQuantities(inventoryUpdates);
              }

              if (onExisting === 'skip') {
                this.stats.productsSkipped++;
                this.log(`⏭️ [OMITIDO] Producto variable "${p.name}" (${activeVars.length} variaciones) ya existe en Shopify.${metafieldsToSet.length > 0 ? ' (Precios 2/3 sincronizados)' : ''}`, 'info');
              } else {
                this.stats.productsUpdated++;
                totalUpdated++;
                this.log(`🔄 [ACTUALIZADO] Producto variable "${p.name}" (${activeVars.length} variaciones): Stock y Precios 1, 2 y 3 actualizados en Shopify.`);
              }
              continue;
            }

            // Si no existe (o estaba incompleto como simple de 1 variante cuando en Woo tiene múltiples variaciones)
            if (!matchedShopifyProd && onMissing === 'skip') {
              this.stats.productsSkipped++;
              this.log(`⏭️ [OMITIDO] Producto variable "${p.name}" no existe en destino y se configuró omitir.`, 'info');
              continue;
            }

            // Si había una publicación simple incompleta con el mismo título/SKU, eliminarla para recrearla con todas sus variaciones
            if (matchedShopifyProd && matchedShopifyProd.variants.length <= 1 && activeVars.length > 1) {
              try {
                await this.shopify.deleteProduct(matchedShopifyProd.numericId);
                this.log(`♻️ Reemplazando publicación simple incompleta de "${p.name}" por publicación con ${activeVars.length} variaciones...`);
              } catch (delErr) {}
            }

            // Construir opciones de producto en Shopify (máximo 3 opciones soportadas por Shopify)
            const variationAttrs = (p.attributes || []).filter(a => a.variation).slice(0, 3);
            const optionNames = variationAttrs.length > 0
              ? variationAttrs.map(a => a.name || 'Opción')
              : ['Opción'];

            const usedOptionKeys = new Set();
            const variantsPayload = [];
            const tierPricesList = [];
            let productTierPrices = null;

            // Ordenar variaciones en orden inverso o por menu_order para mantener el orden natural de WooCommerce
            const orderedVars = [...activeVars].reverse();

            for (let idx = 0; idx < orderedVars.length; idx++) {
              const wv = orderedVars[idx];
              const vAttrs = Array.isArray(wv.attributes) ? wv.attributes : [];
              const optValues = optionNames.map((optName, optIdx) => {
                const found = vAttrs.find(a =>
                  (a.name && a.name.toLowerCase() === optName.toLowerCase()) ||
                  (variationAttrs[optIdx] && a.slug === variationAttrs[optIdx].slug)
                ) || vAttrs[optIdx];
                return (found && found.option) ? String(found.option).trim() : `${wv.sku || 'Variante'} #${idx + 1}`;
              });

              let optKey = optValues.join('||').toLowerCase();
              if (usedOptionKeys.has(optKey)) {
                optValues[0] = `${optValues[0]} (${wv.sku || idx + 1})`;
                optKey = optValues.join('||').toLowerCase();
              }
              usedOptionKeys.add(optKey);

              const vSku = (wv.sku || '').trim();
              const vStock = wv.stock_quantity != null ? Math.max(0, wv.stock_quantity) : 0;
              const vPrice = wv.price || wv.regular_price || p.price || '0.00';
              const vCompare = (wv.sale_price && wv.regular_price && wv.sale_price !== wv.regular_price) ? wv.regular_price : null;
              const tierPrices = this.extractTierPrices(wv.meta_data, p.meta_data);

              if (!productTierPrices && (tierPrices.price_2 || tierPrices.price_3)) {
                productTierPrices = tierPrices;
              }
              tierPricesList.push(tierPrices);

              if (wv.image && wv.image.src && !formattedImages.some(img => img.src === wv.image.src)) {
                formattedImages.push({ src: wv.image.src });
              }

              const varObj = {
                option1: optValues[0] || `Opción ${idx + 1}`,
                price: vPrice,
                compare_at_price: vCompare,
                sku: vSku,
                inventory_management: 'shopify',
                inventory_quantity: vStock,
                metafields: this.buildRestMetafields(tierPrices)
              };
              if (optValues[1]) varObj.option2 = optValues[1];
              if (optValues[2]) varObj.option3 = optValues[2];

              variantsPayload.push(varObj);
            }

            const optionsPayload = optionNames.map((name, idx) => ({
              name,
              values: [...new Set(variantsPayload.map(v => v[`option${idx + 1}`]).filter(Boolean))]
            }));

            const payload = {
              title: p.name,
              body_html: p.description || p.short_description || p.short_desc || '',
              vendor: vendor,
              product_type: productType,
              status: (p.status === 'draft' || p.status === 'pending') ? 'draft' : 'active',
              tags: tagsList.join(', '),
              options: optionsPayload,
              variants: variantsPayload,
              images: formattedImages,
              metafields: productTierPrices ? this.buildRestMetafields(productTierPrices) : []
            };

            const createdRes = await this.shopify.createProduct(payload);
            const createdProd = createdRes?.product;

            for (const vp of variantsPayload) {
              if (vp.sku) existingSkus.add(vp.sku.toLowerCase());
            }
            if (createdProd) {
              titleToProduct.set(normTitle, {
                id: createdProd.admin_graphql_api_id,
                numericId: createdProd.id,
                title: createdProd.title,
                variants: createdProd.variants || [],
                skus: (createdProd.variants || []).map(v => (v.sku || '').toLowerCase()).filter(Boolean)
              });

              // Sincronizar metafields de precios 2 y 3 por GraphQL inmediatamente
              const newMetas = [];
              if (productTierPrices && createdProd.admin_graphql_api_id) {
                newMetas.push(...this.buildGraphqlMetafields(createdProd.admin_graphql_api_id, productTierPrices));
              }
              const createdVars = createdProd.variants || [];
              for (let i = 0; i < createdVars.length; i++) {
                const cv = createdVars[i];
                const tp = tierPricesList[i];
                const vGid = cv.admin_graphql_api_id;
                if (vGid && tp && (tp.price_2 || tp.price_3)) {
                  newMetas.push(...this.buildGraphqlMetafields(vGid, tp));
                }
              }
              if (newMetas.length > 0) {
                await this.shopify.setMetafieldsBatch(newMetas);
              }
            }

            this.stats.productsSynced++;
            totalCreated++;
            this.log(`✨ Producto variable creado en 1 publicación: "${p.name}" con ${variantsPayload.length} variaciones y Precios 2/3.`);
            await this.sleep(450);
            continue;
          }

          // ==========================================
          // PRODUCTO SIMPLE
          // ==========================================
          const tierPrices = this.extractTierPrices(p.meta_data);
          let matchedEntry = (lowerSku && skuToVariant.get(lowerSku)) ? skuToVariant.get(lowerSku) : null;
          let matchedProd = matchedEntry ? matchedEntry.product : (titleToProduct.get(normTitle) || null);
          let matchedVar = matchedEntry ? matchedEntry.variant : (matchedProd?.variants?.[0] || null);

          let skuExists = Boolean(matchedProd);
          if (!skuExists && lowerSku && existingSkus.has(lowerSku)) {
            skuExists = true;
          }

          // Caso 1: El producto simple ya existe en Shopify
          if (skuExists) {
            // Verificar si le faltan Precios 2 y 3 en Shopify o si cambiaron, y sincronizarlos
            let metafieldsUpdated = false;
            if (matchedVar && (tierPrices.price_2 || tierPrices.price_3)) {
              const existingMetaEdges = matchedVar.metafields?.edges || [];
              const currPrice2 = existingMetaEdges.find(e => e.node?.key === 'price_2')?.node?.value;
              const currPrice3 = existingMetaEdges.find(e => e.node?.key === 'price_3')?.node?.value;

              const needsPrice2Update = tierPrices.price_2 && currPrice2 !== tierPrices.price_2;
              const needsPrice3Update = tierPrices.price_3 && currPrice3 !== tierPrices.price_3;

              if (needsPrice2Update || needsPrice3Update || !currPrice2 || !currPrice3 || onExisting !== 'skip') {
                const metas = [
                  ...this.buildGraphqlMetafields(matchedVar.id, tierPrices),
                  ...(matchedProd?.id ? this.buildGraphqlMetafields(matchedProd.id, tierPrices) : [])
                ];
                if (metas.length > 0) {
                  await this.shopify.setMetafieldsBatch(metas);
                  metafieldsUpdated = true;
                }
              }
            }

            if (onExisting === 'skip') {
              this.stats.productsSkipped++;
              this.log(`⏭️ [OMITIDO] Producto "${p.name}" (SKU: "${rawSku}") ya existe en Shopify.${metafieldsUpdated ? ' (Precios 2/3 sincronizados)' : ''}`, 'info');
              continue;
            }

            // Actualizar precio y stock en Shopify si se eligió actualizar
            if (matchedVar?.legacyResourceId) {
              const newPrice = p.price || p.regular_price || '0.00';
              await this.shopify.updateVariant(matchedVar.legacyResourceId, {
                price: newPrice,
                compare_at_price: (p.sale_price && p.regular_price && p.sale_price !== p.regular_price) ? p.regular_price : null
              });

              const stockQty = p.stock_quantity != null ? p.stock_quantity : (p.stock != null ? p.stock : null);
              if (primaryLocationId && matchedVar.inventoryItem?.id && stockQty != null) {
                await this.shopify.setInventoryQuantities([{
                  inventoryItemId: matchedVar.inventoryItem.id,
                  locationId: primaryLocationId,
                  quantity: Math.max(0, parseInt(stockQty, 10) || 0)
                }]);
              }
            }

            this.stats.productsUpdated++;
            totalUpdated++;
            this.log(`🔄 [ACTUALIZADO] Producto "${p.name}" (SKU: "${rawSku}") actualizado con Stock y Precios 1, 2 y 3 en Shopify.`);
            continue;
          }

          // Caso 2: El producto simple NO existe en Shopify
          if (onMissing === 'skip') {
            this.stats.productsSkipped++;
            this.log(`⏭️ [OMITIDO] Producto "${p.name}" no existe en destino y se configuró omitir no existentes.`, 'info');
            continue;
          }

          const stockQty = p.stock_quantity != null ? Math.max(0, p.stock_quantity) : (p.stock != null ? Math.max(0, p.stock) : 0);
          const restMetafields = this.buildRestMetafields(tierPrices);

          const payload = {
            title: p.name,
            body_html: p.description || p.short_description || p.short_desc || '',
            vendor: vendor,
            product_type: productType,
            status: (p.status === 'draft' || p.status === 'pending') ? 'draft' : 'active',
            tags: tagsList.join(', '),
            metafields: restMetafields,
            variants: [{
              price: p.price || p.regular_price || '0.00',
              compare_at_price: (p.sale_price && p.regular_price && p.sale_price !== p.regular_price) ? p.regular_price : null,
              sku: rawSku,
              inventory_management: 'shopify',
              inventory_quantity: stockQty,
              metafields: restMetafields
            }],
            images: formattedImages
          };

          const createdRes = await this.shopify.createProduct(payload);
          const createdProd = createdRes?.product;

          if (createdProd && (tierPrices.price_2 || tierPrices.price_3)) {
            const varGid = createdProd.variants?.[0]?.admin_graphql_api_id;
            const prodGid = createdProd.admin_graphql_api_id;
            const metas = [
              ...(varGid ? this.buildGraphqlMetafields(varGid, tierPrices) : []),
              ...(prodGid ? this.buildGraphqlMetafields(prodGid, tierPrices) : [])
            ];
            if (metas.length > 0) {
              await this.shopify.setMetafieldsBatch(metas);
            }
          }

          if (lowerSku) existingSkus.add(lowerSku);
          this.stats.productsSynced++;
          totalCreated++;
          this.log(`✨ Producto nuevo transferido: ${p.name} (SKU: ${rawSku || 'Sin SKU'}) - $${p.price || p.regular_price || 0} (P2: ${tierPrices.price_2 || '-'}, P3: ${tierPrices.price_3 || '-'})`);
        } catch (err) {
          this.log(`Error al transferir producto ${p.name}: ${err.message}`, 'error');
          this.stats.errorsCount++;
        }
        await this.sleep(450);
      }

      page++;
      if (products.length < 50 || this.stopRequested) break;
    }

    this.log(`Sincronización de productos completada. Creados: ${totalCreated}, Actualizados: ${totalUpdated}, Omitidos: ${this.stats.productsSkipped}`);
    return totalCreated;
  }

  // ==========================================
  // Sincronización de Pedidos (Woo ➔ Shopify)
  // ==========================================
  async syncOrders(options = {}) {
    const storeName = this.storeConfig.name || 'Store';
    const direction = options.direction || 'woo_to_shopify';

    if (direction === 'shopify_to_woo') {
      return await this.syncOrdersShopifyToWoo(options);
    }

    this.log(`Iniciando sincronización de pedidos WooCommerce ➔ Shopify [${storeName}]... ${options.startDate ? `(Desde: ${options.startDate})` : ''} ${options.endDate ? `(Hasta: ${options.endDate})` : ''}`);

    this.log(`Consultando pedidos ya importados en Shopify para evitar duplicados...`);
    let existingWooOrderIds = new Set();
    try {
      existingWooOrderIds = await this.shopify.getExistingWooOrderIds();
      this.log(`Se detectaron ${existingWooOrderIds.size} pedidos de WooCommerce ya registrados en Shopify.`);
    } catch (e) {
      this.log(`Aviso: No se pudo precargar la lista de pedidos existentes: ${e.message}`, 'warn');
    }

    let page = 1;
    let total = 0;

    while (true) {
      if (this.stopRequested) {
        this.log('⏹️ Sincronización de pedidos detenida por el usuario.', 'warn');
        break;
      }

      this.log(`Obteniendo página ${page} de pedidos desde WooCommerce...`);
      let orders = [];
      try {
        orders = await this.woo.getOrders(page, 50, options);
      } catch (err) {
        this.log(`Error obteniendo pedidos en página ${page}: ${err.message}`, 'error');
        this.stats.errorsCount++;
        break;
      }

      if (!orders || orders.length === 0) break;

      for (const o of orders) {
        if (this.stopRequested) {
          this.log('⏹️ Sincronización de pedidos detenida por el usuario.', 'warn');
          break;
        }

        const wooOrderId = String(o.order_number || o.number || o.id);
        if (existingWooOrderIds.has(wooOrderId)) {
          this.stats.ordersSkipped++;
          continue;
        }

        try {
          const billing = o.billing || {};
          const shipping = o.shipping || {};
          const customerEmail = (billing.email || o.customer_email || shipping.email || '').trim();
          const firstName = (billing.first_name || shipping.first_name || '').trim();
          const lastName = (billing.last_name || shipping.last_name || '').trim();
          const rawPhone = billing.phone || shipping.phone || '';
          const orderCountry = (billing.country || shipping.country || this.storeConfig.defaultCountry || 'CO').toUpperCase();
          const orderCurrency = o.currency || this.storeConfig.defaultCurrency || 'COP';
          const phoneE164 = this.formatE164(rawPhone, orderCountry);

          const billingProvince = normalizeProvince(billing.state, orderCountry);
          const shippingProvince = normalizeProvince(shipping.state || billing.state, orderCountry);

          const items = o.line_items || o.items || [];
          const line_items = items.map(item => ({
            title: item.name,
            price: item.price != null ? parseFloat(item.price).toFixed(2) : (item.total ? (parseFloat(item.total) / Math.max(1, item.quantity)).toFixed(2) : '0.00'),
            quantity: item.quantity || 1,
            sku: item.sku || ''
          }));

          const noteParts = [`Importado de WooCommerce Pedido #${wooOrderId}`];
          if (o.status) noteParts.push(`Estado Woo: ${o.status}`);
          if (billing.cpf) noteParts.push(`Doc/CPF: ${billing.cpf}`);
          if (billing.state) noteParts.push(`DANE/State: ${billing.state}`);
          if (o.payment_method_title) noteParts.push(`Pago: ${o.payment_method_title}`);

          const isPaid = (
            o.status === 'completed' ||
            o.status === 'processing' ||
            o.status === 'pago-mercadopago' ||
            Boolean(o.date_paid)
          );

          const payload = {
            financial_status: isPaid ? 'paid' : 'pending',
            currency: orderCurrency,
            total_price: o.total,
            note: noteParts.join(' | '),
            tags: `WooCommerce, DereneSync, ${storeName}, WooOrder-${wooOrderId}`,
            send_receipt: false,
            send_fulfillment_receipt: false,
            inventory_behaviour: 'bypass',
            line_items: line_items.length > 0 ? line_items : [{ title: 'Item General', price: o.total || '0.00', quantity: 1 }]
          };

          if (customerEmail) {
            payload.email = customerEmail;
          }

          if (customerEmail || firstName || lastName) {
            payload.customer = {
              first_name: firstName,
              last_name: lastName,
              email: customerEmail || undefined
            };
            if (phoneE164) {
              payload.customer.phone = phoneE164;
            }
          }

          if (billing.address_1 || billing.city) {
            const billObj = {
              first_name: firstName,
              last_name: lastName,
              address1: [billing.address_1, billing.number].filter(Boolean).join(', ') || billing.address_1,
              address2: [billing.address_2, billing.neighborhood].filter(Boolean).join(' - ') || billing.address_2 || '',
              city: billing.city || '',
              country: billing.country || orderCountry,
              zip: billing.postcode || '',
              phone: rawPhone || undefined
            };
            if (billingProvince) billObj.province = billingProvince;
            payload.billing_address = billObj;
          }

          if (shipping.address_1 || shipping.city) {
            const shipObj = {
              first_name: shipping.first_name || firstName,
              last_name: shipping.last_name || lastName,
              address1: [shipping.address_1, shipping.number].filter(Boolean).join(', ') || shipping.address_1,
              address2: [shipping.address_2, shipping.neighborhood].filter(Boolean).join(' - ') || shipping.address_2 || '',
              city: shipping.city || billing.city || '',
              country: shipping.country || orderCountry,
              zip: shipping.postcode || billing.postcode || '',
              phone: shipping.phone || rawPhone || undefined
            };
            if (shippingProvince) shipObj.province = shippingProvince;
            payload.shipping_address = shipObj;
          }

          if (o.date_created_gmt) {
            const isoDate = new Date(`${o.date_created_gmt}Z`).toISOString();
            payload.created_at = isoDate;
            payload.processed_at = isoDate;
          } else if (o.date_created) {
            const isoDate = new Date(o.date_created).toISOString();
            payload.created_at = isoDate;
            payload.processed_at = isoDate;
          }

          try {
            await this.shopify.createOrder(payload);
          } catch (orderErr) {
            if (orderErr.message && orderErr.message.includes('province') && orderErr.message.includes('invalid')) {
              if (payload.billing_address) delete payload.billing_address.province;
              if (payload.shipping_address) delete payload.shipping_address.province;
              await this.shopify.createOrder(payload);
            } else {
              throw orderErr;
            }
          }

          existingWooOrderIds.add(wooOrderId);
          this.stats.ordersSynced++;
          total++;
          this.log(`Pedido transferido: #${wooOrderId} - ${firstName} ${lastName} (${orderCurrency} ${o.total}) [Woo: ${o.status}]`);
        } catch (err) {
          this.log(`Error al transferir pedido #${o.id || o.number}: ${err.message}`, 'error');
          this.stats.errorsCount++;
        }
        await this.sleep(450);
      }

      page++;
      if (orders.length < 50 || this.stopRequested) break;
    }

    this.log(`Sincronización de pedidos completada. Total nuevos transferidos: ${total}, Ya existentes omitidos: ${this.stats.ordersSkipped}`);
    return total;
  }

  // ==========================================
  // Limpieza de Productos Huérfanos en Shopify
  // (Eliminar productos de Shopify que no existen en WooCommerce)
  // ==========================================
  async cleanupOrphanProducts(options = {}) {
    if (this.isRunning) {
      this.log('Ya existe un proceso de sincronización activo', 'warn');
      return;
    }

    const dryRun = options.dryRun !== false; // Por defecto modo simulación para seguridad
    const actionType = options.actionType || 'delete'; // 'delete', 'archive', 'draft'
    const status = options.status || 'any'; // Estado en WooCommerce

    this.isRunning = true;
    this.stopRequested = false;
    this.stats.status = 'running';
    this.stats.currentTask = 'Limpieza de Huérfanos';
    this.log(`=== INICIO DE ANÁLISIS DE PRODUCTOS HUÉRFANOS [${dryRun ? 'MODO SIMULACIÓN' : 'MODO ACCIÓN: ' + actionType.toUpperCase()}] ===`);

    try {
      // 1. Obtener todos los SKUs y títulos de WooCommerce
      this.log('Paso 1/3: Obteniendo todos los SKUs y títulos desde WooCommerce...');
      const { skus: wooSkus, titles: wooTitles } = await this.woo.getAllSkusAndTitles({ status });
      this.log(`✅ WooCommerce: Se cargaron ${wooSkus.size} SKUs válidos y ${wooTitles.size} nombres de producto.`);

      if (this.stopRequested) {
        this.log('⏹️ Proceso detenido por el usuario.', 'warn');
        return;
      }

      // 2. Obtener todos los productos de Shopify
      this.log('Paso 2/3: Descargando catálogo completo desde Shopify...');
      const shopifyProducts = await this.shopify.getAllProducts();
      this.log(`✅ Shopify: Se detectaron ${shopifyProducts.length} productos registrados en total.`);

      if (this.stopRequested) {
        this.log('⏹️ Proceso detenido por el usuario.', 'warn');
        return;
      }

      // 3. Comparar para encontrar huérfanos y publicaciones duplicadas
      this.log('Paso 3/3: Comparando catálogos para identificar productos huérfanos o duplicados...');
      const orphans = [];
      const matched = [];

      // Agrupar por título normalizado para detectar copias duplicadas (conservar la que tenga más variantes o SKUs)
      const bestByTitle = new Map();
      for (const sp of shopifyProducts) {
        const normTitle = (sp.title || '').trim().toLowerCase();
        const currentBest = bestByTitle.get(normTitle);
        if (
          !currentBest ||
          sp.variants.length > currentBest.variants.length ||
          (sp.variants.length === currentBest.variants.length && sp.skus.length > currentBest.skus.length)
        ) {
          bestByTitle.set(normTitle, sp);
        }
      }

      for (const sp of shopifyProducts) {
        const hasMatchingSku = sp.skus.some(sku => wooSkus.has(sku));
        const normTitle = (sp.title || '').trim().toLowerCase();
        const hasMatchingTitle = wooTitles.has(normTitle);
        const bestForTitle = bestByTitle.get(normTitle);

        // Si es una copia duplicada inferior (ej. copia simple sin SKU de un producto que ya existe), marcarla para limpieza
        if (bestForTitle && bestForTitle.id !== sp.id) {
          orphans.push(sp);
          continue;
        }

        if (hasMatchingSku || hasMatchingTitle) {
          matched.push(sp);
        } else {
          orphans.push(sp);
        }
      }

      this.log(`--------------------------------------------------`);
      this.log(`📊 RESULTADO DEL ANÁLISIS:`);
      this.log(`✅ Coinciden en WooCommerce: ${matched.length} productos.`);
      this.log(`⚠️ HUÉRFANOS (No existen en WooCommerce): ${orphans.length} productos.`);
      this.log(`--------------------------------------------------`);

      if (orphans.length === 0) {
        this.log('🎉 ¡Excelente! No se encontró ningún producto huérfano en Shopify. Tu catálogo está 100% alineado.');
        this.stats.status = 'success';
        return;
      }

      // Reportar muestra de los primeros 15 huérfanos
      orphans.slice(0, 15).forEach((o, idx) => {
        this.log(`[Huérfano #${idx + 1}] "${o.title}" | SKUs: [${o.skus.join(', ') || 'Sin SKU'}] | ID Shopify: ${o.numericId}`);
      });
      if (orphans.length > 15) {
        this.log(`... y ${orphans.length - 15} productos huérfanos más.`);
      }

      if (dryRun) {
        this.log(`ℹ️ [SIMULACIÓN COMPLETADA] No se borró nada en Shopify. Para eliminarlos definitivamente, selecciona "Eliminar definitivamente" y ejecuta sin marcar simulación.`);
        this.stats.status = 'success';
        return;
      }

      // Ejecución real
      this.log(`⚠️ Ejecutando acción "${actionType.toUpperCase()}" sobre los ${orphans.length} productos huérfanos...`);
      let processedCount = 0;

      for (const orphan of orphans) {
        if (this.stopRequested) {
          this.log('⏹️ Limpieza interrumpida por el usuario.', 'warn');
          break;
        }

        try {
          if (actionType === 'delete') {
            await this.shopify.deleteProduct(orphan.numericId);
            this.stats.productsDeleted++;
            this.log(`🗑️ [ELIMINADO] "${orphan.title}" (ID: ${orphan.numericId}, SKU: ${orphan.skus.join(', ') || 'N/A'}) eliminado de Shopify.`);
          } else if (actionType === 'archive') {
            await this.shopify.archiveProduct(orphan.numericId);
            this.stats.productsArchived++;
            this.log(`📦 [ARCHIVADO] "${orphan.title}" (ID: ${orphan.numericId}) archivado en Shopify.`);
          } else if (actionType === 'draft') {
            await this.shopify.draftProduct(orphan.numericId);
            this.stats.productsArchived++;
            this.log(`📝 [BORRADOR] "${orphan.title}" (ID: ${orphan.numericId}) puesto como borrador en Shopify.`);
          }
          processedCount++;
          await this.sleep(400); // Respetar rate limits
        } catch (err) {
          this.log(`Error al procesar huérfano "${orphan.title}": ${err.message}`, 'error');
          this.stats.errorsCount++;
        }
      }

      this.stats.status = 'success';
      this.log(`=== LIMPIEZA FINALIZADA: ${processedCount} productos ${actionType === 'delete' ? 'eliminados' : 'modificados'} en Shopify ===`);
    } catch (err) {
      this.stats.status = 'error';
      this.log(`Fallo general en la limpieza de huérfanos: ${err.message}`, 'error');
    } finally {
      this.isRunning = false;
      this.stopRequested = false;
      this.stats.currentTask = null;
    }
  }

  // ==========================================
  // Sincronización Inversa: Shopify ➔ WooCommerce
  // ==========================================
  async syncProductsShopifyToWoo(options = {}) {
    this.log('=== INICIO SINCRONIZACIÓN INVERSA (Shopify ➔ WooCommerce) ===');
    const onExisting = options.onExisting || 'skip';
    const onMissing = options.onMissing || 'create';

    this.log('Paso 1: Obteniendo SKUs de WooCommerce...');
    const { skus: wooSkus } = await this.woo.getAllSkusAndTitles();

    this.log('Paso 2: Obteniendo productos de Shopify...');
    const shopifyProducts = await this.shopify.getAllProducts();
    let created = 0;

    for (const sp of shopifyProducts) {
      if (this.stopRequested) break;
      const mainSku = sp.skus[0] || '';
      const lowerSku = mainSku.toLowerCase();

      if (lowerSku && wooSkus.has(lowerSku)) {
        if (onExisting === 'skip') {
          this.stats.productsSkipped++;
          this.log(`⏭️ [OMITIDO] Producto "${sp.title}" ya existe en WooCommerce.`);
          continue;
        }
      }

      if (onMissing === 'skip' && (!lowerSku || !wooSkus.has(lowerSku))) {
        this.stats.productsSkipped++;
        continue;
      }

      try {
        const v = sp.variants[0] || {};
        const wooPayload = {
          name: sp.title,
          type: 'simple',
          regular_price: v.price || '0',
          sku: mainSku,
          manage_stock: true,
          stock_quantity: v.inventoryQuantity || 0,
          status: sp.status === 'ACTIVE' ? 'publish' : 'draft'
        };

        await this.woo.createProduct(wooPayload);
        if (lowerSku) wooSkus.add(lowerSku);
        this.stats.productsSynced++;
        created++;
        this.log(`✨ Producto transferido a WooCommerce: ${sp.title} (SKU: ${mainSku})`);
        await this.sleep(400);
      } catch (err) {
        this.log(`Error al transferir a WooCommerce "${sp.title}": ${err.message}`, 'error');
        this.stats.errorsCount++;
      }
    }

    this.log(`Sincronización Shopify ➔ WooCommerce completada. Creados: ${created}`);
    return created;
  }

  async syncCustomersShopifyToWoo(options = {}) {
    this.log('=== INICIO SINCRONIZACIÓN CLIENTES (Shopify ➔ WooCommerce) ===');
    let page = 1;
    let created = 0;

    while (true) {
      if (this.stopRequested) break;
      const res = await this.shopify.getCustomers(page, 50);
      const customers = res?.customers || [];
      if (customers.length === 0) break;

      for (const sc of customers) {
        if (this.stopRequested) break;
        try {
          const addr = sc.default_address || {};
          const wooPayload = {
            email: sc.email,
            first_name: sc.first_name,
            last_name: sc.last_name,
            billing: {
              first_name: sc.first_name,
              last_name: sc.last_name,
              address_1: addr.address1 || '',
              city: addr.city || '',
              state: addr.province || '',
              postcode: addr.zip || '',
              country: addr.country_code || 'CO',
              phone: sc.phone || addr.phone || ''
            }
          };

          await this.woo.createCustomer(wooPayload);
          this.stats.customersSynced++;
          created++;
          this.log(`Cliente transferido a WooCommerce: ${sc.email}`);
          await this.sleep(400);
        } catch (err) {
          if (err.message && err.message.includes('already registered')) {
            this.stats.customersSkipped++;
            this.log(`⏭️ Cliente ya existe en WooCommerce: ${sc.email}`);
          } else {
            this.stats.errorsCount++;
          }
        }
      }
      page++;
      if (customers.length < 50) break;
    }
    return created;
  }

  async syncOrdersShopifyToWoo(options = {}) {
    this.log('=== INICIO SINCRONIZACIÓN PEDIDOS (Shopify ➔ WooCommerce) ===');
    let page = 1;
    let created = 0;

    while (true) {
      if (this.stopRequested) break;
      const res = await this.shopify.getOrders(page, 50);
      const orders = res?.orders || [];
      if (orders.length === 0) break;

      for (const so of orders) {
        if (this.stopRequested) break;
        try {
          const line_items = (so.line_items || []).map(li => ({
            name: li.name,
            quantity: li.quantity,
            total: li.price,
            sku: li.sku
          }));

          const wooPayload = {
            payment_method: 'shopify',
            payment_method_title: 'Shopify Order',
            set_paid: so.financial_status === 'paid',
            line_items: line_items
          };

          await this.woo.createOrder(wooPayload);
          this.stats.ordersSynced++;
          created++;
          this.log(`Pedido transferido a WooCommerce: #${so.order_number || so.id}`);
          await this.sleep(400);
        } catch (err) {
          this.stats.errorsCount++;
        }
      }
      page++;
      if (orders.length < 50) break;
    }
    return created;
  }

  // ==========================================
  // Sincronizaciones Combinadas
  // ==========================================
  async syncCustomersAndOrders(options = {}) {
    if (this.isRunning) {
      this.log('Ya existe un proceso de sincronización activo', 'warn');
      return;
    }

    const storeName = this.storeConfig.name || 'Store';
    this.isRunning = true;
    this.stopRequested = false;
    this.stats.status = 'running';
    this.stats.lastRun = new Date().toISOString();
    this.log(`=== INICIO SINCRONIZACIÓN CLIENTES Y PEDIDOS [${storeName.toUpperCase()}] ===`);
    this.log('ℹ️ Modo Clientes y Pedidos: Los productos NO serán modificados ni duplicados.');

    try {
      this.stats.currentTask = 'Clientes';
      await this.syncCustomers(options);

      if (this.stopRequested) {
        this.log('=== SINCRONIZACIÓN DETENIDA TRAS CLIENTES ===', 'warn');
        return;
      }

      this.stats.currentTask = 'Pedidos';
      await this.syncOrders(options);

      if (this.stopRequested) {
        this.stats.status = 'stopped';
        this.log('=== SINCRONIZACIÓN INTERRUMPIDA POR EL USUARIO ===', 'warn');
      } else {
        this.stats.status = 'success';
        this.log(`=== SINCRONIZACIÓN DE CLIENTES Y PEDIDOS COMPLETADA [${storeName}] ===`);
      }
    } catch (err) {
      this.stats.status = 'error';
      this.log(`Fallo general en la sincronización: ${err.message}`, 'error');
    } finally {
      this.isRunning = false;
      this.stopRequested = false;
      this.stats.currentTask = null;
    }
  }

  async runFullSync(options = {}) {
    if (this.isRunning) {
      this.log('Ya existe un proceso de sincronización activo', 'warn');
      return;
    }

    const storeName = this.storeConfig.name || 'Store';
    this.isRunning = true;
    this.stopRequested = false;
    this.stats.status = 'running';
    this.stats.lastRun = new Date().toISOString();
    this.log(`=== INICIO DE SINCRONIZACIÓN TOTAL [${storeName.toUpperCase()}] ===`);

    try {
      this.stats.currentTask = 'Clientes';
      await this.syncCustomers(options);

      if (this.stopRequested) {
        this.log('=== SINCRONIZACIÓN DETENIDA TRAS CLIENTES ===', 'warn');
        return;
      }

      this.stats.currentTask = 'Productos';
      await this.syncProducts(options);

      if (this.stopRequested) {
        this.log('=== SINCRONIZACIÓN DETENIDA TRAS PRODUCTOS ===', 'warn');
        return;
      }

      this.stats.currentTask = 'Pedidos';
      await this.syncOrders(options);

      if (this.stopRequested) {
        this.stats.status = 'stopped';
        this.log('=== SINCRONIZACIÓN INTERRUMPIDA POR EL USUARIO ===', 'warn');
      } else {
        this.stats.status = 'success';
        this.log(`=== SINCRONIZACIÓN COMPLETA FINALIZADA CON ÉXITO [${storeName}] ===`);
      }
    } catch (err) {
      this.stats.status = 'error';
      this.log(`Fallo general en la sincronización: ${err.message}`, 'error');
    } finally {
      this.isRunning = false;
      this.stopRequested = false;
      this.stats.currentTask = null;
    }
  }
}

module.exports = SyncManager;
