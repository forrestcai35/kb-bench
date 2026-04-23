---
id: doc-12-capture-transport
title: Capture Desktop Transport
---

# Capture Desktop Transport

The Capture desktop app sends captures via HTTPS `POST /api/v1/ingest`. Authentication priority:
1. **Supabase JWT** (preferred, auto-refresh in-app)
2. **PAT** (fallback for legacy installs)

The JWT is stored in the system keychain. Short-text captures (< 200 chars) are batch-buffered for up to 2 seconds before being sent as a single request.
