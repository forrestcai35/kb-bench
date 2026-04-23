---
id: doc-02-node-version
title: Node Version Policy
---

# Node Version Policy

The project targets **Node 20 LTS**. Node 22 is known to break the Capture native build because of a runtime mismatch between napi-rs and the N-API header bundled in Node 22.x. The root `.nvmrc` pins 20. CI uses `actions/setup-node@v4` with `node-version-file: .nvmrc`.

If you see a `symbol not found: napi_*` error during `cargo build`, your local Node is likely 22 — switch to 20.
