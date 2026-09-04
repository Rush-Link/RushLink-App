'use strict';

const fs = require('fs');
const path = require('path');

const workspace = path.resolve(__dirname, '..');
const sourceName = 'reference/headrush/raw/subtree.json';
const sourceFile = path.join(workspace, sourceName);
const outputFile = path.join(workspace, 'reference/headrush/openapi.json');
const subtree = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));

const paths = {};
const schemas = {
  Error: {
    type: 'object',
    properties: {
      desc: { type: 'string' },
      reason: { type: 'string' },
      status: { type: 'integer' },
    },
  },
  PairingState: {
    type: 'object',
    additionalProperties: true,
    properties: {
      pairState: { type: 'string' },
      pairPin: { type: 'string' },
      pairError: { type: 'string' },
    },
  },
  DirectoryEntry: {
    type: 'object',
    required: ['name', 'type'],
    properties: {
      name: { type: 'string' },
      type: { type: 'integer', enum: [1, 2], description: 'Observed values: 1=file, 2=directory.' },
      size: { type: 'integer', minimum: 0, description: 'Present for files.' },
      mtime: { type: 'string', format: 'date-time' },
    },
  },
};

const jsonResponse = (description, schema = {}) => ({
  description,
  content: { 'application/json': { schema } },
});
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const slug = (value) => value.replace(/^\//, '').replace(/[^A-Za-z0-9]+/g, '_');
const encodeObjectPath = (value) => value.split('/').map(encodeURIComponent).join('/');
const directoryListingSchema = { type: 'array', items: ref('DirectoryEntry') };

paths['/'] = {
  get: {
    tags: ['Assets'], operationId: 'getRemoteEditorHtml', summary: 'Fetch the Remote Editor HTML shell',
    responses: { 200: { description: 'Remote Editor HTML', content: { 'text/html': { schema: { type: 'string' } } } }, 404: jsonResponse('Not found', ref('Error')) },
  },
};
paths['/manifest.json'] = {
  get: {
    tags: ['Assets'], operationId: 'getWebManifest', summary: 'Fetch the Remote Editor web manifest',
    responses: { 200: jsonResponse('Web application manifest', { type: 'object', additionalProperties: true }), 404: jsonResponse('Not found', ref('Error')) },
  },
};
paths['/icon512.png'] = {
  get: {
    tags: ['Assets'], operationId: 'getEditorIcon', summary: 'Fetch the Remote Editor icon',
    responses: { 200: { description: 'PNG icon', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } }, 404: jsonResponse('Not found', ref('Error')) },
  },
};
paths['/static'] = {
  get: {
    tags: ['File browser'], operationId: 'listStaticRoot', summary: 'List the public static-asset root',
    'x-headrush-source': 'route-discovery',
    responses: { 200: jsonResponse('Directory entries', directoryListingSchema), 404: jsonResponse('Path not found', ref('Error')) },
  },
};
paths['/static/{path}'] = {
  get: {
    tags: ['File browser'], operationId: 'getStaticPath', summary: 'List a static directory or download a static file',
    'x-headrush-source': 'route-discovery',
    parameters: [{ name: 'path', in: 'path', required: true, allowReserved: true, schema: { type: 'string' }, description: 'Slash-containing relative path.' }],
    responses: {
      200: { description: 'Directory listing or file content', content: { 'application/json': { schema: directoryListingSchema }, 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
      404: jsonResponse('Path not found', ref('Error')),
    },
  },
};
paths['/files/{client}/{path}'] = {
  get: {
    tags: ['File browser'], operationId: 'getClientFilePath', summary: 'List a client directory or download a client file',
    description: 'Undocumented public file router. Only client `Evil` and root path `Web` were discovered.',
    'x-headrush-source': 'route-discovery',
    parameters: [
      { name: 'client', in: 'path', required: true, schema: { type: 'string', example: 'Evil' } },
      { name: 'path', in: 'path', required: true, allowReserved: true, schema: { type: 'string', example: 'Web/Blocks/img/Amp.webp' }, description: 'Slash-containing client-relative path.' },
    ],
    responses: {
      200: { description: 'Directory listing or file content', content: { 'application/json': { schema: directoryListingSchema }, 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
      404: jsonResponse('Client or path not found', ref('Error')),
    },
  },
};
paths['/files/Evil/Web'] = {
  get: {
    tags: ['File browser'], operationId: 'listEvilWebRoot', summary: 'List the confirmed public Evil/Web file root',
    'x-headrush-source': 'route-discovery',
    responses: { 200: jsonResponse('Directory entries', directoryListingSchema), 404: jsonResponse('Path not found', ref('Error')) },
  },
};

paths['/api/auth'] = {
  post: {
    tags: ['Authentication'],
    operationId: 'pairDevice',
    summary: 'Pair or authenticate the web editor with the device',
    requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
    responses: {
      200: jsonResponse('Pairing state', ref('PairingState')),
      401: jsonResponse('Pairing required', ref('Error')),
    },
  },
};

paths['/api/v1/subtree'] = {
  get: {
    tags: ['Reflection'],
    operationId: 'getEntireSubtree',
    summary: 'Return metadata and current values for the complete object tree',
    responses: {
      200: jsonResponse('Complete reflected object tree', { type: 'object', additionalProperties: true }),
      400: jsonResponse('Invalid subtree request', ref('Error')),
    },
  },
};

paths['/files/Evil/Web/Blocks/img/{assetPath}'] = {
  get: {
    tags: ['Assets'],
    operationId: 'getBlockImage',
    summary: 'Fetch a block image asset',
    parameters: [{ name: 'assetPath', in: 'path', required: true, allowReserved: true, schema: { type: 'string' } }],
    responses: {
      200: { description: 'Image asset', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } },
      404: jsonResponse('Not found', ref('Error')),
    },
  },
};

let methodCount = 0;
const subtreePrefixes = new Set();
for (const [objectPath, entry] of Object.entries(subtree)) {
  const encodedPath = encodeObjectPath(objectPath);
  const objectSlug = slug(objectPath);
  const schemaName = `Properties_${objectSlug}`;
  const meta = entry.meta || {};
  const segments = objectPath.split('/').filter(Boolean);
  for (let index = 1; index < segments.length; index += 1) {
    subtreePrefixes.add(`/${segments.slice(0, index).join('/')}`);
  }

  schemas[schemaName] = meta.properties
    ? { type: 'object', additionalProperties: false, properties: meta.properties }
    : { type: 'object', additionalProperties: true };

  paths[`/api/v1/object-meta${encodedPath}`] = {
    get: {
      tags: ['Object metadata'],
      operationId: `getMeta_${objectSlug}`,
      summary: `Get schema metadata for ${objectPath}`,
      'x-headrush-object-path': objectPath,
      responses: {
        200: jsonResponse('JSON-Schema-like object metadata', { type: 'object', additionalProperties: true }),
        404: jsonResponse('Object not found', ref('Error')),
      },
    },
  };

  paths[`/api/v1/object-properties${encodedPath}`] = {
    get: {
      tags: ['Object properties'],
      operationId: `getProperties_${objectSlug}`,
      summary: `Get current properties of ${objectPath}`,
      'x-headrush-object-path': objectPath,
      responses: {
        200: jsonResponse('Current property values', ref(schemaName)),
        404: jsonResponse('Object not found', ref('Error')),
      },
    },
    put: {
      tags: ['Object properties'],
      operationId: `setProperties_${objectSlug}`,
      summary: `Set one or more properties of ${objectPath}`,
      description: 'State-changing operation. Send only properties that should change; omit properties marked readOnly.',
      'x-headrush-object-path': objectPath,
      requestBody: { required: true, content: { 'application/json': { schema: ref(schemaName) } } },
      responses: {
        200: jsonResponse('Updated property values or operation result'),
        400: jsonResponse('Invalid property value', ref('Error')),
        404: jsonResponse('Object not found', ref('Error')),
      },
    },
  };

  paths[`/api/v1/subtree${encodedPath}`] = {
    get: {
      tags: ['Reflection'],
      operationId: `getSubtree_${objectSlug}`,
      summary: `Get metadata and values beneath ${objectPath}`,
      'x-headrush-object-path': objectPath,
      responses: {
        200: jsonResponse('Reflected subtree', { type: 'object', additionalProperties: true }),
        404: jsonResponse('Object not found', ref('Error')),
      },
    },
  };

  for (const [methodName, methodMeta] of Object.entries(meta['x-methods'] || {})) {
    methodCount += 1;
    const argumentSchemas = methodMeta.argumentsMeta || [];
    const resultSchema = methodMeta.resultMeta || {};
    const methodPath = `/api/v1/object-method${encodedPath}/${encodeURIComponent(methodName)}`;
    paths[methodPath] = {
      post: {
        tags: ['Object methods'],
        operationId: `call_${objectSlug}_${slug(methodName)}`,
        summary: `Call ${objectPath}.${methodName}`,
        description: 'Potentially state-changing remote method call.',
        'x-headrush-object-path': objectPath,
        'x-headrush-method': methodName,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['arguments'],
                properties: {
                  arguments: {
                    type: 'array',
                    prefixItems: argumentSchemas,
                    minItems: argumentSchemas.length,
                    maxItems: argumentSchemas.length,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: jsonResponse('Method result', {
            type: 'object',
            properties: { methodReturnValue: resultSchema },
          }),
          400: jsonResponse('Invalid method arguments', ref('Error')),
          404: jsonResponse('Object or method not found', ref('Error')),
        },
      },
    };
  }
}

let subtreePrefixCount = 0;
for (const prefix of [...subtreePrefixes].sort()) {
  const routePath = `/api/v1/subtree${encodeObjectPath(prefix)}`;
  if (paths[routePath]) continue;
  subtreePrefixCount += 1;
  paths[routePath] = {
    get: {
      tags: ['Reflection'], operationId: `getSubtreePrefix_${slug(prefix)}`,
      summary: `Get reflected objects beneath namespace ${prefix}`,
      'x-headrush-source': 'route-discovery', 'x-headrush-namespace-prefix': prefix,
      responses: { 200: jsonResponse('Reflected namespace subtree', { type: 'object', additionalProperties: true }), 404: jsonResponse('Namespace not found', ref('Error')) },
    },
  };
}

// These objects are referenced by the deployed editor but are absent from this device's
// current subtree (and return 404). Keep them documented as optional, bundle-derived
// capabilities without representing their inferred schemas as reflection-derived facts.
const bundleOnlyObjects = {
  '/Evil/Engine/Mic': {
    properties: { On: { type: 'boolean' } },
    methods: {},
  },
  '/Evil/Engine/MicDryOut': {
    properties: {
      On: { type: 'boolean' }, LoadedPreset: { type: 'string' }, Level: { type: 'number' },
      GateThresh: { type: 'number' }, HP: { type: 'number' }, CompThresh: { type: 'number' },
      CompMakeUp: { type: 'number' }, EQOn: { type: 'boolean' }, EQLow: { type: 'number' },
      EQLowMid: { type: 'number' }, EQHighMid: { type: 'number' }, EQHigh: { type: 'number' },
    },
    methods: {
      presets: { argumentsMeta: [], resultMeta: { type: 'array', items: { type: 'string' } } },
      renamePreset: { argumentsMeta: [{ type: 'string' }, { type: 'string' }], resultMeta: { type: 'boolean' } },
      deletePreset: { argumentsMeta: [{ type: 'string' }], resultMeta: { type: 'boolean' } },
      createPreset: { argumentsMeta: [{ type: 'string' }], resultMeta: { type: 'boolean' } },
      loadPreset: { argumentsMeta: [{ type: 'string' }], resultMeta: { type: 'boolean' } },
    },
  },
  '/Evil/Engine/RigEncoder': {
    properties: Object.fromEntries([
      ...Array.from({ length: 4 }, (_, index) => [`Module${index + 1}`, { type: 'string' }]),
      ...Array.from({ length: 4 }, (_, index) => [`Param${index + 1}`, { type: 'string' }]),
      ...Array.from({ length: 4 }, (_, index) => [`EncoderTextHi${index + 1}`, { type: 'string' }]),
      ...Array.from({ length: 4 }, (_, index) => [`EncoderTextLo${index + 1}`, { type: 'string' }]),
      ...Array.from({ length: 4 }, (_, index) => [`Encoder${index + 1}`, { type: 'number' }]),
      ...Array.from({ length: 4 }, (_, index) => [`EncoderColour${index + 1}`, { type: 'integer' }]),
    ]),
    methods: {
      paramList: { argumentsMeta: [{ type: 'integer' }, { type: 'string' }], resultMeta: { type: 'array', items: { type: 'string' } } },
    },
  },
};

let bundleOnlyMethodCount = 0;
for (const [objectPath, definition] of Object.entries(bundleOnlyObjects)) {
  const encodedPath = encodeObjectPath(objectPath);
  const objectSlug = slug(objectPath);
  const schemaName = `BundleInferredProperties_${objectSlug}`;
  const sourceExtension = { 'x-headrush-source': 'frontend-bundle', 'x-headrush-current-device-status': 404 };
  schemas[schemaName] = {
    type: 'object',
    additionalProperties: true,
    properties: definition.properties,
    description: 'Partial schema inferred from frontend usage; absent from the captured reflection subtree.',
  };
  paths[`/api/v1/object-meta${encodedPath}`] = {
    get: {
      tags: ['Object metadata'], operationId: `getOptionalMeta_${objectSlug}`,
      summary: `Get optional schema metadata for ${objectPath}`, ...sourceExtension,
      responses: { 200: jsonResponse('Metadata when supported', { type: 'object', additionalProperties: true }), 404: jsonResponse('Unsupported or inactive object', ref('Error')) },
    },
  };
  paths[`/api/v1/object-properties${encodedPath}`] = {
    get: {
      tags: ['Object properties'], operationId: `getOptionalProperties_${objectSlug}`,
      summary: `Get optional properties of ${objectPath}`, ...sourceExtension,
      responses: { 200: jsonResponse('Current property values when supported', ref(schemaName)), 404: jsonResponse('Unsupported or inactive object', ref('Error')) },
    },
    put: {
      tags: ['Object properties'], operationId: `setOptionalProperties_${objectSlug}`,
      summary: `Set optional properties of ${objectPath}`, description: 'Bundle-derived, potentially state-changing operation.', ...sourceExtension,
      requestBody: { required: true, content: { 'application/json': { schema: ref(schemaName) } } },
      responses: { 200: jsonResponse('Operation result'), 400: jsonResponse('Invalid property value', ref('Error')), 404: jsonResponse('Unsupported or inactive object', ref('Error')) },
    },
  };
  paths[`/api/v1/subtree${encodedPath}`] = {
    get: {
      tags: ['Reflection'], operationId: `getOptionalSubtree_${objectSlug}`,
      summary: `Get optional subtree beneath ${objectPath}`, ...sourceExtension,
      responses: { 200: jsonResponse('Reflected subtree when supported', { type: 'object', additionalProperties: true }), 404: jsonResponse('Unsupported or inactive object', ref('Error')) },
    },
  };
  for (const [methodName, methodMeta] of Object.entries(definition.methods)) {
    bundleOnlyMethodCount += 1;
    const args = methodMeta.argumentsMeta;
    paths[`/api/v1/object-method${encodedPath}/${encodeURIComponent(methodName)}`] = {
      post: {
        tags: ['Object methods'], operationId: `callOptional_${objectSlug}_${slug(methodName)}`,
        summary: `Call optional ${objectPath}.${methodName}`, description: 'Bundle-derived, potentially state-changing remote method.', ...sourceExtension,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['arguments'], properties: { arguments: { type: 'array', prefixItems: args, minItems: args.length, maxItems: args.length } } } } } },
        responses: { 200: jsonResponse('Method result', { type: 'object', properties: { methodReturnValue: methodMeta.resultMeta } }), 400: jsonResponse('Invalid method arguments', ref('Error')), 404: jsonResponse('Unsupported or inactive object', ref('Error')) },
      },
    };
  }
}

const document = {
  openapi: '3.1.0',
  info: {
    title: 'HeadRush Flex Prime Local Reflection API',
    version: '5.1.0.2a63755-snapshot',
    description: 'Unofficial documentation generated from the Remote Editor bundle and live /api/v1/subtree metadata. The device exposes no native OpenAPI document. PUT and object-method POST operations can change device state.',
    license: {
      name: 'Unofficial documentation; underlying HeadRush API is proprietary',
      identifier: 'LicenseRef-Proprietary',
    },
  },
  servers: [
    { url: 'http://headrushflexprime.local', description: 'mDNS hostname' },
    { url: 'http://192.168.1.129', description: 'IPv4 address at capture time' },
  ],
  // The observed local API accepts requests without an HTTP authentication scheme.
  // /api/auth pairs the editor/device session but is not used as an OpenAPI security credential.
  security: [],
  tags: [
    { name: 'Authentication', description: 'Editor/device pairing.' },
    { name: 'Reflection', description: 'Discover object metadata and current values recursively.' },
    { name: 'Object metadata', description: 'JSON-Schema-like metadata for individual reflected objects.' },
    { name: 'Object properties', description: 'Read or update properties on individual reflected objects.' },
    { name: 'Object methods', description: 'Invoke reflected methods. Calls may change device state.' },
    { name: 'Assets', description: 'Static assets used by the Remote Editor.' },
    { name: 'File browser', description: 'Undocumented public directory-listing and file-download routes.' },
  ],
  paths,
  components: { schemas },
  'x-headrush-websocket': {
    url: 'ws://headrushflexprime.local/',
    description: 'Web editor event stream. Notifications include objectAdded, objectRemoved, propertyAdded, propertyRemoved, and valueChanged.',
  },
  'x-generation-summary': {
    objectCount: Object.keys(subtree).length,
    methodCount,
    bundleOnlyObjectCount: Object.keys(bundleOnlyObjects).length,
    bundleOnlyMethodCount,
    subtreePrefixCount,
    pathCount: Object.keys(paths).length,
    source: sourceName,
  },
};

fs.writeFileSync(outputFile, `${JSON.stringify(document, null, 2)}\n`);
console.log(JSON.stringify(document['x-generation-summary']));
