'use strict';

const fs = require('fs');
const path = require('path');

const workspace = path.resolve(__dirname, '..');
const subtree = JSON.parse(fs.readFileSync(path.join(workspace, 'reference/headrush/raw/subtree.json'), 'utf8'));
const openapi = JSON.parse(fs.readFileSync(path.join(workspace, 'reference/headrush/openapi.json'), 'utf8'));
const bundle = fs.readFileSync(path.join(workspace, 'reference/headrush/raw/main.4a9a9934.js'), 'utf8');

const slug = (value) => value.replace(/^\//, '').replace(/[^A-Za-z0-9]+/g, '_');
const encodeObjectPath = (value) => value.split('/').map(encodeURIComponent).join('/');
const sortDeep = (value) => {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
  }
  return value;
};
const canonical = (value) => JSON.stringify(sortDeep(value));
const failures = [];
const sourceObjects = Object.entries(subtree);
let sourcePropertyCount = 0;
let documentedPropertyCount = 0;
let sourceMethodCount = 0;

for (const [objectPath, entry] of sourceObjects) {
  const encoded = encodeObjectPath(objectPath);
  const objectSlug = slug(objectPath);
  const schemaName = `Properties_${objectSlug}`;
  const sourceProperties = entry.meta?.properties;
  const targetSchema = openapi.components?.schemas?.[schemaName];

  if (!openapi.paths[`/api/v1/object-meta${encoded}`]?.get) failures.push(`Missing metadata route: ${objectPath}`);
  if (!openapi.paths[`/api/v1/object-properties${encoded}`]?.get) failures.push(`Missing property GET: ${objectPath}`);
  if (!openapi.paths[`/api/v1/object-properties${encoded}`]?.put) failures.push(`Missing property PUT: ${objectPath}`);
  if (!openapi.paths[`/api/v1/subtree${encoded}`]?.get) failures.push(`Missing subtree route: ${objectPath}`);
  if (!targetSchema) failures.push(`Missing component schema: ${schemaName}`);

  if (sourceProperties) {
    sourcePropertyCount += Object.keys(sourceProperties).length;
    documentedPropertyCount += Object.keys(targetSchema?.properties || {}).length;
    if (canonical(sourceProperties) !== canonical(targetSchema?.properties)) {
      failures.push(`Property schema mismatch: ${objectPath}`);
    }
  }

  for (const [methodName, methodMeta] of Object.entries(entry.meta?.['x-methods'] || {})) {
    sourceMethodCount += 1;
    const route = openapi.paths[`/api/v1/object-method${encoded}/${encodeURIComponent(methodName)}`]?.post;
    if (!route) {
      failures.push(`Missing method route: ${objectPath}.${methodName}`);
      continue;
    }
    const args = route.requestBody?.content?.['application/json']?.schema?.properties?.arguments?.prefixItems || [];
    const result = route.responses?.['200']?.content?.['application/json']?.schema?.properties?.methodReturnValue || {};
    if (canonical(methodMeta.argumentsMeta || []) !== canonical(args)) failures.push(`Argument mismatch: ${objectPath}.${methodName}`);
    if (canonical(methodMeta.resultMeta || {}) !== canonical(result)) failures.push(`Result mismatch: ${objectPath}.${methodName}`);
  }
}

const bundleObjectPaths = [...new Set(bundle.match(/\/Evil(?:\/[A-Za-z0-9_.{}$+:'()-]+)+/g) || [])]
  .filter((item) => !item.startsWith('/Evil/Web/'));
const bundleApiTemplates = [...new Set(bundle.match(/\/(?:api|object-meta|object-properties|object-method|subtree|files)(?:\/[A-Za-z0-9_.?&={}:$+()-]+)*/g) || [])]
  .filter((item) => item.length > 3);
const sourceObjectNames = new Set(Object.keys(subtree));
const bundleObjectsNotInSubtree = bundleObjectPaths.filter((item) => !item.includes('${') && !sourceObjectNames.has(item));
const bundleObjectsNotDocumented = bundleObjectsNotInSubtree.filter((item) => {
  if (item === '/Evil/Engine/Pedal') return false; // Dynamic base; concrete Pedal1/Pedal2 are reflected.
  const encoded = encodeObjectPath(item);
  return !openapi.paths[`/api/v1/object-properties${encoded}`]?.get?.['x-headrush-source'];
});

const summary = {
  subtreeObjects: sourceObjects.length,
  subtreeProperties: sourcePropertyCount,
  documentedProperties: documentedPropertyCount,
  subtreeMethods: sourceMethodCount,
  openapiPaths: Object.keys(openapi.paths || {}).length,
  openapiSchemas: Object.keys(openapi.components?.schemas || {}).length,
  bundleObjectReferences: bundleObjectPaths.length,
  bundleObjectsNotInSubtree,
  bundleObjectsNotDocumented,
  bundleApiTemplates,
  failures,
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length || bundleObjectsNotDocumented.length) process.exitCode = 1;
