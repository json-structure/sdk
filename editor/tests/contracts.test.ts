import { describe, expect, it } from 'vitest';
import { GESTURE_CONTRACT, PROTOCOL_VERSION, SERIALIZATION_GUARANTEES, coverageErrors, isLibraryOperationRequest, isProtocolEnvelope, sameSelection } from '../src/index.js';
describe('Phase 0 contracts', () => {
  it('accepts only versioned request envelopes', () => {
    expect(isProtocolEnvelope({ protocolVersion: PROTOCOL_VERSION, requestId: 'r1' })).toBe(true);
    expect(isProtocolEnvelope({ protocolVersion: 2, requestId: 'r1' })).toBe(false);
  });
  it('accepts only supported serializable library operation requests', () => {
    expect(isLibraryOperationRequest({ protocolVersion: 1, requestId: 'library-1', kind: 'library-request', operation: 'listCatalog' })).toBe(true);
    expect(isLibraryOperationRequest({ protocolVersion: 1, requestId: 'library-1', kind: 'library-request', operation: 'deleteEverything' })).toBe(false);
    expect(isLibraryOperationRequest({ protocolVersion: 1, requestId: 'library-1', kind: 'library-request', operation: 'publish', payload: { value: () => undefined } })).toBe(false);
  });
  it('defines lossless serialization and gesture guarantees', () => {
    expect(SERIALIZATION_GUARANTEES.preservesUnknownKeys).toBe(true);
    expect(GESTURE_CONTRACT.dragThresholdCssPx).toBe(4);
    expect(GESTURE_CONTRACT.touchTargetCssPx).toBe(44);
  });
  it('uses one shared selection identity', () => {
    expect(sameSelection({ kind: 'type', pointer: '#/definitions/A' }, { kind: 'type', pointer: '#/definitions/A' })).toBe(true);
  });
  it('rejects duplicate IDs and false completed claims', () => {
    const feature = { id: 'x', spec: 'Core', requirement: 'x', status: 'complete', evidence: { editing: { status: 'gap', ids: ['rationale.x'] } } };
    const errors = coverageErrors([feature, feature], 1);
    expect(errors.some((error) => error.includes('duplicate'))).toBe(true);
    expect(errors.some((error) => error.includes('false') || error.includes('lacks complete'))).toBe(true);
  });
});
