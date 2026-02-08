# 👔 Admin API

Order management and admin user management endpoints.

## Files

| File | Purpose |
|------|---------|
| `adminUsers.js` | Router — admin user CRUD (mounted at `/admin-users`) |
| `adminUserHandlers.js` | Handler implementations for user CRUD |
| `getOrder.js` | Handlers — `getOrder` + `listOrders` |
| `updateOrderStatus.js` | Handler — update order status/tracking |

---

## Endpoints

### Order Management

Mounted directly in `index.js` with `requireAuth` + `requireAdmin`.

#### POST `/admin/updateOrderStatus`

Update order lifecycle: status, fulfillment, tracking info, notes.

**Auth:** `requireAuth` + `requireAdmin`  
**Body:**
```json
{
  "orderId": "pi_xxx_item1",
  "orderStatus": "shipped",
  "fulfillmentStatus": "shipped",
  "trackingNumber": "9400111899223456789012",
  "carrier": "USPS",
  "estimatedDelivery": "2026-02-15",
  "internalNote": "Priority shipped"
}
```
**Response:** `{ success: true, orderId, updates }`  
**Side effects:** Updates `orders/{orderId}` and syncs parent `payment_intents/{parentOrderId}` if all items share same status.

#### GET `/admin/getOrder`

Fetch a single order or all orders for a payment intent.

**Auth:** `requireAuth` + `requireAdmin`  
**Query params:** `orderId` OR `parentOrderId`  
**Response (orderId):** `{ success: true, order }`  
**Response (parentOrderId):** `{ success: true, paymentIntent, orders, totalItems }`

#### GET `/admin/listOrders`

List orders with filters and pagination.

**Auth:** `requireAuth` + `requireAdmin`  
**Query params:** `orderStatus`, `fulfillmentStatus`, `paymentStatus`, `limit` (default 50), `startAfter`  
**Response:** `{ success: true, orders: [...], count, hasMore }`

---

### User Management

Router mounted at `/admin-users` in `index.js`.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/admin-users/me` | Current admin profile | `requireAuth` |
| GET | `/admin-users/users` | List all admin users | `requireAuth` + `requireRole('super-admin')` |
| GET | `/admin-users/users/:uid` | Get admin user | `requireAuth` + `requireRole('super-admin')` |
| POST | `/admin-users/users` | Create admin user | `requireAuth` + `requireRole('super-admin')` |
| PUT | `/admin-users/users/:uid` | Update admin user | `requireAuth` + `requireRole('super-admin')` |
| DELETE | `/admin-users/users/:uid` | Soft-delete admin user | `requireAuth` + `requireRole('super-admin')` |
| GET | `/admin-users/roles` | List available roles & permissions | `requireAuth` |

**Roles:** `super-admin`, `admin`, `manager`, `viewer`

---

## Firestore Collections

- **`orders`** — Individual order items with status, tracking, shipping address
- **`payment_intents`** — Parent payment records with item list and totals
- **`admin_users`** — Admin user profiles with role, permissions, metadata

---

**Test suite:** `__tests__/admin.test.js` (36 tests)
