import { describe, expect, it } from 'vitest';
import {
  BUNDLED_CATALOGS,
  BUNDLED_CATALOG_PROVIDERS,
  BUNDLED_CF_STANDARD_NAME_ENTRIES,
  BUNDLED_DCTERMS_ENTRIES,
  BUNDLED_ISO_4217_ENTRIES,
  BUNDLED_ISO_4217_PROVIDER,
  BUNDLED_JSON_STRUCTURE_UNITS_ENTRIES,
  BUNDLED_QUDT_QUANTITY_KIND_ENTRIES,
  BUNDLED_SCHEMA_ORG_ENTRIES,
  BUNDLED_SEMANTIC_ENTRIES,
  BUNDLED_SEMANTIC_PROVIDER,
  BUNDLED_SKOS_PROV_ENTRIES,
  BUNDLED_SOSA_ENTRIES,
  BUNDLED_UCUM_ENTRIES,
  BUNDLED_UCUM_PROVIDER,
  CatalogRegistry,
  PROTOCOL_VERSION,
  bundledCatalogResult,
  catalogCustomValueKind,
  createBundledCatalogProvider,
  createCatalogRegistry,
  type CatalogFamily,
  type CatalogProviderManifest,
  type CatalogProviderResult,
  type CatalogSearchRequest
} from '../src/index.js';

const manifests: readonly CatalogProviderManifest[] = [
  BUNDLED_UCUM_PROVIDER,
  BUNDLED_ISO_4217_PROVIDER,
  { id: 'workspace.units', label: 'Workspace units', kind: 'workspace', families: ['unit'], source: 'workspace://catalogs/units.json', version: 'sha256:1' },
  { id: 'https.units', label: 'Remote units', kind: 'https', families: ['unit'], source: 'https://example.test/catalog', endpoint: 'https://example.test/search', version: 'etag:1' },
  { id: 'host.units', label: 'Host units', kind: 'host', families: ['unit'], source: 'extension:example.units', version: '1.0.0' }
];
function result(request: ReturnType<CatalogRegistry['createRequest']>, providerId: string, entries: CatalogProviderResult['entries'], stale = false): CatalogProviderResult {
  return { ...request, kind: 'catalog-results', providerId, entries, stale };
}

describe('host-neutral annotation catalogs', () => {
  it('registers the exact offline built-in provider inventory with versioned provenance and counts', () => {
    const registry = createCatalogRegistry();
    expect(registry.listProviders().map((provider) => provider.id)).toEqual([
      'bundled.cf-standard-names',
      'bundled.dublin-core-terms',
      'bundled.iso-4217',
      'bundled.json-structure-units',
      'bundled.qudt-quantity-kinds',
      'bundled.schema-org',
      'bundled.semantic-annotations',
      'bundled.skos-prov-o',
      'bundled.sosa',
      'bundled.ucum'
    ]);
    expect(BUNDLED_CATALOG_PROVIDERS).toHaveLength(10);
    expect(Object.fromEntries(BUNDLED_CATALOGS.map(({ manifest, entries }) => [manifest.id, entries.length]))).toEqual({
      'bundled.json-structure-units': 22,
      'bundled.ucum': 113,
      'bundled.iso-4217': 179,
      'bundled.qudt-quantity-kinds': 13,
      'bundled.cf-standard-names': 6,
      'bundled.sosa': 7,
      'bundled.schema-org': 9,
      'bundled.dublin-core-terms': 8,
      'bundled.skos-prov-o': 7,
      'bundled.semantic-annotations': 67
    });
    for (const provider of registry.listProviders()) {
      expect(provider.kind).toBe('bundled');
      expect(provider.source).toMatch(/^[a-z][a-z0-9+.-]*:/i);
      expect(provider.version).not.toBe('');
      expect(provider.entryCount).toBeGreaterThan(0);
    }
  });

  it('ships representative exact values and semantic kinds in each distinct provider', () => {
    expect(BUNDLED_JSON_STRUCTURE_UNITS_ENTRIES).toContainEqual(expect.objectContaining({ family: 'unit', value: 'm/s^2', label: 'metres per second squared' }));
    expect(BUNDLED_QUDT_QUANTITY_KIND_ENTRIES).toContainEqual(expect.objectContaining({
      family: 'semanticConcept', value: { reference: 'http://qudt.org/vocab/quantitykind/Length', kind: 'qudt-quantity-kind' }
    }));
    expect(BUNDLED_CF_STANDARD_NAME_ENTRIES).toContainEqual(expect.objectContaining({
      family: 'observedProperty', value: { reference: expect.stringContaining('#air_temperature'), kind: 'cf-standard-name' }
    }));
    expect(BUNDLED_SOSA_ENTRIES).toContainEqual(expect.objectContaining({ value: { reference: 'http://www.w3.org/ns/sosa/Sensor', kind: 'owl-class' } }));
    expect(BUNDLED_SCHEMA_ORG_ENTRIES).toContainEqual(expect.objectContaining({ value: { reference: 'https://schema.org/name', kind: 'rdf-property' } }));
    expect(BUNDLED_DCTERMS_ENTRIES).toContainEqual(expect.objectContaining({ value: { reference: 'http://purl.org/dc/terms/title', kind: 'dcterms-property' } }));
    expect(BUNDLED_SKOS_PROV_ENTRIES).toContainEqual(expect.objectContaining({ value: { reference: 'http://www.w3.org/ns/prov#wasDerivedFrom', kind: 'owl-object-property' } }));
  });

  it('uses one generic bundled provider adapter and exposes custom values only for open families', async () => {
    const registry = createCatalogRegistry();
    const request = registry.createRequest('generic-bundled', 1, 'semanticConcept', 'length');
    const provider = createBundledCatalogProvider('bundled.qudt-quantity-kinds');
    const result = await registry.search(request, [provider]);
    expect(result.suggestions[0]).toMatchObject({
      label: 'Length',
      value: { reference: 'http://qudt.org/vocab/quantitykind/Length', kind: 'qudt-quantity-kind' }
    });
    expect(() => createBundledCatalogProvider('missing')).toThrow('Unknown bundled catalog provider');
    expect((['unit', 'ucumUnit', 'currency'] as CatalogFamily[]).map(catalogCustomValueKind)).toEqual(['string', 'string', 'string']);
    expect((['semanticConcept', 'observedProperty'] as CatalogFamily[]).map(catalogCustomValueKind)).toEqual(['reference', 'reference']);
    expect((['semanticRole', 'derivation', 'statistic', 'cadence'] as CatalogFamily[]).map(catalogCustomValueKind)).toEqual(['closed', 'closed', 'closed', 'closed']);
  });

  it('registers bundled, workspace, HTTPS, and host manifests without an I/O API', () => {
    const registry = new CatalogRegistry();
    manifests.forEach((manifest) => registry.register(manifest));
    expect(registry.listProviders().map((provider) => provider.kind).sort()).toEqual(['bundled', 'bundled', 'host', 'https', 'workspace']);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(registry))).not.toContain('fetch');
    expect(() => registry.register({ ...manifests[3], id: 'bad', endpoint: 'http://example.test' })).toThrow();
  });

  it('keeps invocation-correlated provider contracts JSON serializable', () => {
    const registry = new CatalogRegistry();
    registry.register(BUNDLED_UCUM_PROVIDER);
    const request = registry.createRequest('serializable', 3, 'ucumUnit', 'm');
    const providerResult = bundledCatalogResult(request, BUNDLED_UCUM_PROVIDER.id);

    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
    expect(JSON.parse(JSON.stringify(providerResult))).toEqual(providerResult);
    expect(providerResult.invocationId).toBe(request.invocationId);
  });

  it('keeps suggestions advisory, open-vocabulary, and exact in emitted JSON', () => {
    const registry = new CatalogRegistry();
    registry.register(BUNDLED_UCUM_PROVIDER);
    const request = registry.createRequest('open', 7, 'ucumUnit', 'custom');
    const merged = registry.merge(request, [], [{ family: 'ucumUnit', value: 'X[\"quoted\"]\\unit', label: 'Custom escaped unit' }]);
    expect(merged.suggestions).toHaveLength(1);
    expect(merged.suggestions[0]).toMatchObject({ advisory: true, value: 'X["quoted"]\\unit', emittedJson: '"X[\\"quoted\\"]\\\\unit"' });
    expect(JSON.parse(merged.suggestions[0].emittedJson)).toBe(merged.suggestions[0].value);
    expect(merged.suggestions[0].provenance[0].providerId).toBe('custom');
  });

  it('merges duplicate values predictably while preserving every provenance source', () => {
    const registry = new CatalogRegistry();
    registry.register({ ...manifests[2], priority: 10 });
    registry.register({ ...manifests[3], priority: 20 });
    const request = registry.createRequest('duplicates', 1, 'unit', 'met');
    const entry = { family: 'unit' as const, value: 'm', label: 'metre' };
    const merged = registry.merge(request, [result(request, 'workspace.units', [entry]), result(request, 'https.units', [{ ...entry, label: 'meter' }])]);
    expect(merged.suggestions).toHaveLength(1);
    expect(merged.suggestions[0].label).toBe('meter');
    expect(merged.suggestions[0].provenance.map((source) => source.providerId)).toEqual(['https.units', 'workspace.units']);
  });

  it('gives exact custom values deterministic override precedence without closing the vocabulary', () => {
    const registry = new CatalogRegistry();
    registry.register(manifests[2]);
    const request = registry.createRequest('override', 1, 'unit', 'm');
    const providerEntry = { family: 'unit' as const, value: 'm', label: 'metre' };
    const customEntry = { family: 'unit' as const, value: 'm', label: 'My project metre' };
    const merged = registry.merge(request, [result(request, 'workspace.units', [providerEntry])], [customEntry]);
    expect(merged.suggestions[0].label).toBe('My project metre');
    expect(merged.suggestions[0].provenance.map((source) => source.providerId)).toEqual(['custom', 'workspace.units']);
  });

  it('rejects cancelled and catalog-stale requests', () => {
    const registry = new CatalogRegistry();
    registry.register(BUNDLED_UCUM_PROVIDER);
    const cancelled = registry.createRequest('cancelled', 1, 'ucumUnit', 'm');
    registry.cancel(cancelled);
    expect(registry.merge(cancelled, [bundledCatalogResult(cancelled, BUNDLED_UCUM_PROVIDER.id)])).toMatchObject({ cancelled: true, suggestions: [] });
    const catalogStale = registry.createRequest('catalog-stale', 1, 'ucumUnit', 'm');
    registry.register({ ...manifests[4], id: 'later' });
    expect(registry.merge(catalogStale, [])).toMatchObject({ stale: true, suggestions: [] });
  });

  it('requires request, invocation, and document correlation fields on provider result envelopes', () => {
    const registry = new CatalogRegistry();
    registry.register(manifests[2]);

    const missingRequestId = registry.createRequest('missing-request-id', 4, 'unit', 'm');
    const { requestId: omittedRequestId, ...withoutRequestId } = result(missingRequestId, 'workspace.units', [{ family: 'unit', value: 'm', label: 'metre' }]);
    expect(omittedRequestId).toBe(missingRequestId.requestId);
    expect(registry.merge(missingRequestId, [withoutRequestId])).toMatchObject({
      stale: false, suggestions: [], providerIssues: [{ providerId: 'workspace.units', code: 'invalid-envelope' }]
    });

    const missingInvocationId = registry.createRequest('missing-invocation-id', 4, 'unit', 'm');
    const { invocationId: omittedInvocationId, ...withoutInvocationId } = result(missingInvocationId, 'workspace.units', [{ family: 'unit', value: 'm', label: 'metre' }]);
    expect(omittedInvocationId).toBe(missingInvocationId.invocationId);
    expect(registry.merge(missingInvocationId, [withoutInvocationId])).toMatchObject({
      stale: false, suggestions: [], providerIssues: [{ providerId: 'workspace.units', code: 'invalid-envelope' }]
    });

    const missingDocumentVersion = registry.createRequest('missing-document-version', 4, 'unit', 'm');
    const { documentVersion: omittedDocumentVersion, ...withoutDocumentVersion } = result(missingDocumentVersion, 'workspace.units', [{ family: 'unit', value: 'm', label: 'metre' }]);
    expect(omittedDocumentVersion).toBe(missingDocumentVersion.documentVersion);
    expect(registry.merge(missingDocumentVersion, [withoutDocumentVersion])).toMatchObject({
      stale: false, suggestions: [], providerIssues: [{ providerId: 'workspace.units', code: 'invalid-envelope' }]
    });
  });

  it('isolates mismatched provider correlation while valid envelopes still contribute', () => {
    const registry = new CatalogRegistry();
    registry.register(manifests[2]);
    registry.register(manifests[3]);

    const requestIdMismatch = registry.createRequest('request-id-mismatch', 4, 'unit', 'm');
    const validRequestIdEnvelope = result(requestIdMismatch, 'workspace.units', [{ family: 'unit', value: 'm', label: 'metre' }]);
    const requestIdMerged = registry.merge(requestIdMismatch, [
      { ...result(requestIdMismatch, 'https.units', [{ family: 'unit', value: 'mm', label: 'millimetre' }]), requestId: 'other' },
      validRequestIdEnvelope
    ]);
    expect(requestIdMerged).toMatchObject({ stale: false, providerIssues: [{ providerId: 'https.units', code: 'request-mismatch' }] });
    expect(requestIdMerged.suggestions.map((entry) => entry.value)).toEqual(['m']);

    const documentVersionMismatch = registry.createRequest('document-version-mismatch', 4, 'unit', 'm');
    const validDocumentVersionEnvelope = result(documentVersionMismatch, 'workspace.units', [{ family: 'unit', value: 'm', label: 'metre' }]);
    const documentVersionMerged = registry.merge(documentVersionMismatch, [
      { ...result(documentVersionMismatch, 'https.units', [{ family: 'unit', value: 'mm', label: 'millimetre' }]), documentVersion: 5 },
      validDocumentVersionEnvelope
    ]);
    expect(documentVersionMerged).toMatchObject({ stale: false, providerIssues: [{ providerId: 'https.units', code: 'request-mismatch' }] });
    expect(documentVersionMerged.suggestions.map((entry) => entry.value)).toEqual(['m']);
  });

  it('validates provider envelopes and entries before iteration and reports isolated issues', async () => {
    const registry = new CatalogRegistry();
    registry.register(manifests[2]);
    registry.register(manifests[3]);
    registry.register(manifests[4]);
    const request = registry.createRequest('provider-validation', 4, 'unit', 'm');
    const valid = result(request, 'workspace.units', [{ family: 'unit', value: 'm', label: 'metre' }]);
    const merged = await registry.search(request, [
      { providerId: 'workspace.units', search: async () => valid },
      { providerId: 'https.units', search: async () => ({ ...result(request, 'https.units', []), protocolVersion: 99 }) },
      { providerId: 'host.units', search: async () => { throw new Error('offline'); } }
    ]);
    expect(merged.suggestions.map((entry) => entry.value)).toEqual(['m']);
    expect(merged.providerIssues).toMatchObject([
      { providerId: 'host.units', code: 'provider-threw' },
      { providerId: 'https.units', code: 'invalid-envelope' }
    ]);

    const malformed = registry.createRequest('malformed-entry', 4, 'unit', 'm');
    const malformedResult = { ...result(malformed, 'workspace.units', []), entries: [{ family: 'unit', value: 'm', label: 42 }] };
    expect(registry.merge(malformed, [malformedResult])).toMatchObject({ suggestions: [], providerIssues: [{ code: 'invalid-envelope' }] });
    const nonArray = registry.createRequest('non-array', 4, 'unit', 'm');
    expect(registry.merge(nonArray, [{ ...result(nonArray, 'workspace.units', []), entries: { 0: 'unsafe' } }])).toMatchObject({ suggestions: [], providerIssues: [{ code: 'invalid-envelope' }] });
    const malformedCustom = registry.createRequest('malformed-custom', 4, 'unit', 'm');
    expect(registry.merge(malformedCustom, [], [{ family: 'unit', value: 'm', label: 42 } as never])).toMatchObject({
      suggestions: [], providerIssues: [{ providerId: 'custom', code: 'invalid-envelope' }]
    });
  });

  it('binds cancellation to an invocation when caller request IDs overlap', () => {
    const registry = new CatalogRegistry();
    registry.register(BUNDLED_UCUM_PROVIDER);
    const oldRequest = registry.createRequest('reused', 1, 'ucumUnit', 'm');
    const newRequest = registry.createRequest('reused', 1, 'ucumUnit', 's');
    expect(() => registry.cancel('reused')).toThrow(/exactly one active invocation/);
    registry.cancel(oldRequest);
    expect(registry.merge(oldRequest, [bundledCatalogResult(oldRequest, BUNDLED_UCUM_PROVIDER.id)])).toMatchObject({ cancelled: true, suggestions: [] });
    const current = registry.merge(newRequest, [bundledCatalogResult(newRequest, BUNDLED_UCUM_PROVIDER.id)]);
    expect(current.cancelled).toBe(false);
    expect(current.suggestions.some((entry) => entry.value === 's')).toBe(true);
  });

  it('rejects a late result from an older identical invocation as a provider issue', async () => {
    const registry = new CatalogRegistry();
    registry.register(manifests[2]);
    registry.register(manifests[3]);
    const olderRequest = registry.createRequest('crossover', 9, 'unit', 'm');
    const newerRequest = registry.createRequest('crossover', 9, 'unit', 'm');
    const olderResult = result(olderRequest, 'workspace.units', [{ family: 'unit', value: 'mm', label: 'millimetre' }]);
    const seenInvocationIds: string[] = [];

    const merged = await registry.search(newerRequest, [
      { providerId: 'workspace.units', search: async (request) => {
        seenInvocationIds.push(request.invocationId);
        return olderResult;
      } },
      { providerId: 'https.units', search: async (request) => {
        seenInvocationIds.push(request.invocationId);
        return result(request, 'https.units', [{ family: 'unit', value: 'm', label: 'metre' }]);
      } }
    ]);

    expect(seenInvocationIds).toEqual([newerRequest.invocationId, newerRequest.invocationId]);
    expect(olderResult).toMatchObject({
      requestId: newerRequest.requestId,
      documentVersion: newerRequest.documentVersion,
      catalogVersion: newerRequest.catalogVersion,
      kind: 'catalog-results',
      protocolVersion: newerRequest.protocolVersion
    });
    expect(olderResult.invocationId).not.toBe(newerRequest.invocationId);
    expect(merged.suggestions.map((entry) => entry.value)).toEqual(['m']);
    expect(merged.providerIssues).toEqual([{
      providerId: 'workspace.units', code: 'request-mismatch', message: 'Provider result does not match the catalog request.'
    }]);
  });

  it('canonicalizes same-provider duplicates and ranks independently of entry order and provider timing', async () => {
    const run = async (reverse: boolean) => {
      const registry = new CatalogRegistry();
      registry.register({ ...manifests[2], priority: 10 });
      registry.register({ ...manifests[3], priority: 10 });
      const request = registry.createRequest('stable-order', 1, 'unit', 'm');
      const workspaceEntries = [
        { family: 'unit' as const, value: 'm', label: 'Metre beta', aliases: ['meter'] },
        { family: 'unit' as const, value: 'm', label: 'Metre alpha', aliases: ['metre'] }
      ];
      const providers = [
        { providerId: 'workspace.units', search: async (searchRequest: CatalogSearchRequest) => {
          if (!reverse) await Promise.resolve();
          return result(searchRequest, 'workspace.units', reverse ? [...workspaceEntries].reverse() : workspaceEntries);
        } },
        { providerId: 'https.units', search: async (searchRequest: CatalogSearchRequest) => {
          if (reverse) await Promise.resolve();
          return result(searchRequest, 'https.units', [{ family: 'unit', value: 'm', label: 'Metre remote' }]);
        } }
      ];
      return registry.search(request, reverse ? [...providers].reverse() : providers);
    };
    const forward = await run(false);
    const reversed = await run(true);
    expect(reversed.suggestions).toEqual(forward.suggestions);
    expect(forward.suggestions[0].label).toBe('Metre remote');
    expect(forward.suggestions[0].provenance.map((source) => source.providerId)).toEqual(['https.units', 'workspace.units']);
  });

  it('ranks exact, prefix, and substring matches deterministically', () => {
    const registry = new CatalogRegistry();
    registry.register(BUNDLED_ISO_4217_PROVIDER);
    const request = registry.createRequest('rank', 1, 'currency', 'usd');
    const first = registry.merge(request, [bundledCatalogResult(request, BUNDLED_ISO_4217_PROVIDER.id)]);
    const second = registry.merge(request, [bundledCatalogResult(request, BUNDLED_ISO_4217_PROVIDER.id)]);
    expect(first.suggestions[0].value).toBe('USD');
    expect(second.suggestions).toEqual(first.suggestions);
  });

  it('ships substantial unique advisory UCUM and ISO 4217 seeds', () => {
    expect(BUNDLED_UCUM_ENTRIES.length).toBeGreaterThanOrEqual(100);
    expect(BUNDLED_ISO_4217_ENTRIES.length).toBeGreaterThanOrEqual(170);
    expect(new Set(BUNDLED_UCUM_ENTRIES.map((entry) => entry.value)).size).toBe(BUNDLED_UCUM_ENTRIES.length);
    expect(new Set(BUNDLED_ISO_4217_ENTRIES.map((entry) => entry.value)).size).toBe(BUNDLED_ISO_4217_ENTRIES.length);
    expect(BUNDLED_UCUM_ENTRIES.some((entry) => entry.value === 'Cel')).toBe(true);
    expect(BUNDLED_ISO_4217_ENTRIES.some((entry) => entry.value === 'EUR')).toBe(true);
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('ships semantic families through the existing advisory provider contract', () => {
    const families = new Set(BUNDLED_SEMANTIC_ENTRIES.map((entry) => entry.family));
    expect(BUNDLED_SEMANTIC_ENTRIES).toHaveLength(67);
    expect(families).toEqual(new Set(BUNDLED_SEMANTIC_PROVIDER.families));
    expect(families).toEqual(new Set([
      'semanticRole', 'derivation', 'statistic', 'codedValues', 'measurementConditioning', 'referenceRole', 'phenomenonTimeRelation',
      'temporalReferenceSystem', 'cadence', 'coordinateReferenceSystem', 'vectorReferenceFrame',
      'tensorReferenceFrame', 'frameTransform', 'linearReferenceSystem', 'colorSpace',
      'audioChannelLayout', 'spectralBandSet'
    ]));
    expect(BUNDLED_SEMANTIC_PROVIDER.trusted).toBe(true);
  });

  it('ranks semantic object values deterministically and emits exact JSON previews', () => {
    const registry = new CatalogRegistry();
    registry.register(BUNDLED_SEMANTIC_PROVIDER);
    const request = registry.createRequest('semantic-crs', 2, 'coordinateReferenceSystem', 'EPSG:4326');
    const merged = registry.merge(request, [bundledCatalogResult(request, BUNDLED_SEMANTIC_PROVIDER.id)]);
    expect(merged.suggestions[0].label).toBe('WGS 84 geographic coordinates');
    expect(JSON.parse(merged.suggestions[0].emittedJson)).toEqual(merged.suggestions[0].value);
    expect(merged.suggestions[0]).toMatchObject({ advisory: true, provenance: [{ providerId: BUNDLED_SEMANTIC_PROVIDER.id }] });
  });

  it('lets authored semantic objects override bundled values while retaining provenance', () => {
    const registry = new CatalogRegistry();
    registry.register(BUNDLED_SEMANTIC_PROVIDER);
    const request = registry.createRequest('semantic-override', 2, 'cadence', 'PT1S');
    const value = { kind: 'fixed', period: 'PT1S' } as const;
    const merged = registry.merge(
      request,
      [bundledCatalogResult(request, BUNDLED_SEMANTIC_PROVIDER.id)],
      [{ family: 'cadence', value, label: 'Project sampling interval' }]
    );
    expect(merged.suggestions[0].label).toBe('Project sampling interval');
    expect(merged.suggestions[0].provenance.map((source) => source.providerId)).toEqual([BUNDLED_SEMANTIC_PROVIDER.id, 'custom']);
  });

  it('keeps semantic seed JSON values unique within each family', () => {
    const keys = BUNDLED_SEMANTIC_ENTRIES.map((entry) => `${entry.family}\u0000${JSON.stringify(entry.value)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(BUNDLED_SEMANTIC_ENTRIES.some((entry) => entry.family === 'audioChannelLayout' && entry.label === 'Stereo')).toBe(true);
    expect(BUNDLED_SEMANTIC_ENTRIES.some((entry) => entry.family === 'spectralBandSet')).toBe(true);
  });
});