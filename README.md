# ⚡ SyncZen • Motor Universal de Sincronización WooCommerce ⇄ Shopify

**SyncZen** es una solución robusta y de alto rendimiento diseñada para sincronizar y migrar catálogos de **Productos**, **Clientes** e **Historial de Pedidos** entre **WooCommerce** (WordPress) y **Shopify**, con arquitectura multitienda y panel web interactivo.

---

## 🌟 Características Principales

- 🔄 **Sincronización Bidireccional Total**: Transfiere datos de `WooCommerce ➔ Shopify` o de `Shopify ➔ WooCommerce`.
- 🎯 **Verificación Inteligente por SKU**:
  - Evita duplicar productos ya existentes en destino.
  - Políticas configurables: Omitir existentes, actualizar solo stock y precio, o actualizar todo.
  - Creación condicional de productos nuevos.
- 🧹 **Auditoría y Limpieza de Huérfanos**:
  - Escanea productos en Shopify que no existen en WooCommerce.
  - **Modo Simulación seguro**: audita sin alterar la tienda.
  - Acciones: Eliminar definitivamente, Archivar o pasar a Borrador.
- 👥 **Migración Inteligente de Clientes**:
  - Normalización de direcciones y estados (incluyendo conversión automática de códigos DANE a departamentos en Colombia).
  - Preserva historial, direcciones y datos de contacto sin rechazos por parte de Shopify.
- 🛒 **Historial de Pedidos con Filtro de Fechas**:
  - Filtro por rangos (últimos 7, 30, 90 días o historial completo).
- 🏬 **Arquitectura Multitienda**:
  - Registra y administra múltiples tiendas sin reiniciar servidores.
  - Vinculación oficial vía OAuth o Custom App Access Token.
- 📋 **Live Logs y Métricas en Tiempo Real**:
  - Monitorea cada solicitud y avance paso a paso mediante Server-Sent Events / Polling.

---

## 🚀 Inicio Rápido

### 1. Requisitos
- Node.js >= 18
- Credenciales REST API de WooCommerce (`ck_...` y `cs_...`)
- Aplicación de Shopify con permisos de lectura/escritura (`write_products`, `write_customers`, `write_orders`, etc.)

### 2. Instalación

```bash
git clone https://github.com/rodcoiler/SyncZen.git
cd SyncZen
npm install
```

### 3. Configuración

Copia el archivo de configuración de ejemplo:

```bash
cp stores.example.json stores.json
cp .env.example .env
```

Edita `stores.json` o configúralo directamente desde la interfaz web una vez encendido el servidor.

### 4. Ejecución

```bash
# Modo desarrollo
npm start

# O con PM2 en producción
pm2 start ecosystem.config.js --name synczen
```

Abre tu navegador en `http://localhost:3001` (o el puerto configurado).

---

## 🔒 Seguridad
Los archivos `.env` y `stores.json` contienen credenciales privadas y están ignorados en `.gitignore` para prevenir filtraciones en repositorios públicos o compartidos. Utiliza siempre `stores.example.json` como referencia.

---

## 📄 Licencia
MIT License © 2026 SyncZen.
