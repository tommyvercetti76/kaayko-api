# 👔 Admin API

This folder contains server-side admin endpoints for order management and admin user management.

Important note (code-derived): index.js mounts some admin endpoints directly at `/admin/*`. Other admin routes are implemented in `admin/adminUsers.js` but are not mounted by default in `functions/index.js` (present but not mounted).

Files in this folder
- `getOrder.js` — `GET /admin/getOrder` and `GET /admin/listOrders` helpers
- `updateOrderStatus.js` — `POST /admin/updateOrderStatus` (updates order/fulfillment/tracking info)
- `adminUsers.js` — Express router for admin user management (create/list/get/update/delete roles). This router is implemented but not registered in `index.js` by default — (present, verify mount)

--------------------------------------------------------------------------------
POST /admin/updateOrderStatus
Method: POST
Path: /admin/updateOrderStatus
Description: Change order lifecycle and tracking information (status, fulfillment, tracking number, notes). Updates Firestore `orders` documents and may update `payment_intents` when all items share same status.
Auth: **NO authorization enforced by index.js when mounted** — the route `apiApp.post('/admin/updateOrderStatus', require('./api/admin/updateOrderStatus'));` is mounted without `requireAuth` in `functions/index.js`. TODO: verify intended security posture in deployment and add `requireAuth`/`requireAdmin` if needed.
Body (JSON): { orderId (required), orderStatus, fulfillmentStatus, trackingNumber, carrier, estimatedDelivery, internalNote, customerNote }
Response: { success: true, orderId, updates }
Errors: 400 missing orderId, 404 order not found, 500 internal error
Side effects:
 - Writes to Firestore `orders/{orderId}` updates (status, timestamps, history)
 - Updates parent `payment_intents/{parentOrderId}` if all related orders changed

--------------------------------------------------------------------------------
GET /admin/getOrder
Method: GET
Path: /admin/getOrder
Description: Fetch a single order by `orderId` or all orders for a `parentOrderId` (payment intent). Returns order(s) and (if parentOrderId provided) payment intent data.
Auth: **No auth enforced by index.js** — index.js mounts handler directly as `apiApp.get('/admin/getOrder', getOrder)`; verify whether this should be protected.
Query params:
 - orderId (optional) — single order document ID
 - parentOrderId (optional) — payment intent ID to return all child order items
Responses:
 - orderId: { success: true, order }
 - parentOrderId: { success: true, paymentIntent, orders, totalItems }
Errors: 400 missing both orderId/parentOrderId; 404 order not found; 500 internal error

--------------------------------------------------------------------------------
GET /admin/listOrders
Method: GET
Path: /admin/listOrders
Description: List orders with optional filters and pagination (status, fulfillmentStatus, paymentStatus). Uses Firestore queries.
Auth: **No auth enforced by index.js** — review mount in production.
Query params: orderStatus, fulfillmentStatus, paymentStatus, limit (default 50), startAfter (doc id for pagination)
Response: { success: true, orders: [...], count, hasMore }
Errors: 500 internal error

--------------------------------------------------------------------------------
Admin Users (implemented, not mounted by default)
File: `adminUsers.js` — provides REST endpoints for admin user management (requires `requireAuth` and `requireRole('super-admin')` for most operations). Endpoints implemented include:
- GET /admin/me — current user profile (requireAuth)
- GET /admin/users — list users (super-admin)
- GET /admin/users/:uid — get user (super-admin)
- POST /admin/users — create admin user (super-admin)
- PUT /admin/users/:uid — update admin user (super-admin)
- DELETE /admin/users/:uid — delete (soft) admin user (super-admin)
- GET /admin/roles — list available roles and permissions (requireAuth)

Notes / TODOs:
- Several admin routes are mounted without auth in `functions/index.js` (see getOrder/listOrders/updateOrderStatus). Please verify the intended public vs protected access and update mounts to include `requireAuth` or `requireAdmin` where appropriate.
