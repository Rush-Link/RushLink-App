# HeadRush Flex Prime API reference

This directory contains an unofficial snapshot and generated OpenAPI 3.1 description of the local HeadRush Remote Editor API.

Files:

- `openapi.json`: generated OpenAPI 3.1 documentation with concrete paths for every reflected object and method.
- `DISCOVERY.md`: verified coverage, asset inventory, and device-content findings.
- `FILE-CAPABILITIES.md`: live-tested typed file persistence and arbitrary-file API boundaries.
- `route-discovery.json`: results from the safe candidate-route sweep.
- `web-file-crawl.json`: recursive inventory of confirmed public web roots.
- `raw/index.html`: the Remote Editor HTML shell.
- `raw/main.4a9a9934.js`: the deployed Remote Editor JavaScript bundle.
- `raw/subtree.json`: the response from `GET /api/v1/subtree`, including schemas and values current at capture time.
- `raw/device-assets/`: downloadable manifest, icon, and model artwork advertised by the captured subtree.
- `../../tools/generate-headrush-openapi.js`: reproducible Node.js generator.
- `../../tools/audit-headrush-openapi.js`: exact subtree/bundle coverage audit.
- `../../tools/download-headrush-assets.js`: reproducible device-asset downloader.
- `../../tools/discover-headrush-routes.js`: read-only route candidate sweep.
- `../../tools/crawl-headrush-web-files.js`: public web-root crawler/downloader.

Regenerate the OpenAPI file with:

```powershell
node tools/generate-headrush-openapi.js
```

Validate it with Redocly CLI:

```powershell
npx --yes @redocly/cli lint reference/headrush/openapi.json
```

The device does not expose Swagger or OpenAPI itself. Its API is a reflection protocol built around `subtree`, `object-meta`, `object-properties`, and `object-method` endpoints. Treat every `PUT` and object-method `POST` as potentially state-changing.

Schemas generated from `raw/subtree.json` are exact copies of the reflected metadata. Optional objects found only in the frontend bundle are marked with `x-headrush-source: frontend-bundle`; these return 404 on the captured device and their schemas are explicitly partial/inferred.
