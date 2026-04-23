---
id: doc-01-deploy-web
title: Deploying the Web App
---

# Deploying the Web App

To deploy the web app to production, run `npm run deploy:netlify:app` from the repo root. The script wraps the Netlify CLI and requires the `NETLIFY_AUTH_TOKEN` env var to be set. It deploys the `apps/web` build artifact to the `acme-app` Netlify site.

Staging deploys use `npm run deploy:netlify:app -- --alias=staging`. CI runs a preview deploy on every PR via the Netlify GitHub app.
