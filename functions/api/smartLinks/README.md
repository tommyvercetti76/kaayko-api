# SmartLinks Compatibility Module

This directory is kept for backward compatibility. Active implementation lives in:

```text
functions/api/kortex/
```

The production router is mounted twice from `functions/index.js`:

```js
const kortexRouter = require("./api/kortex/smartLinks");
apiApp.use("/kortex", kortexRouter);
apiApp.use("/smartlinks", kortexRouter);
```

Rules:

- New work should use `/kortex`.
- Existing `/smartlinks` clients should continue to work.
- Do not remove these compatibility shims until all deployed clients have migrated.
- Read `functions/api/kortex/README.md` for the current API contract.

Canonical architecture:

```text
kaayko/docs/products/KORTEX_TENANT_ARCHITECTURE_PLAN.md
```
