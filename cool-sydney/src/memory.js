/* A small H-MEM-inspired contract subset, not the full Meterless engine.
 * Implements provenance, version-scoped retrieval, supersession, and audit.
 * No embedding ranker, automatic mining, dreaming, or sleep consolidation. */
(function (root) {
  'use strict';
  function createStore(initial) {
    const state = initial?.version === 1 && Array.isArray(initial.records) && Array.isArray(initial.ledger) ? JSON.parse(JSON.stringify(initial)) : { version: 1, records: [], ledger: [] };
    const audit = (action, id, time, detail) => state.ledger.push({ action, memoryId: id, timestamp: time, actor: 'local-user', detail });
    return {
      state,
      save({ scope, constraints, source, now = new Date().toISOString() }) {
        if (!scope?.areaId || !scope?.datasetVersion || !source?.type || !source?.id || !constraints) throw new Error('Memory requires scope, source and constraints.');
        const previous = state.records.findLast(r => !r.supersededBy && r.namespace === scope.areaId && r.datasetVersion === scope.datasetVersion);
        const id = `mem-${Date.parse(now)}-${state.records.length + 1}`;
        const r = { id, type: 'preference', layer: 'working', domain: 'cooling-access', namespace: scope.areaId, datasetVersion: scope.datasetVersion, content: JSON.stringify(constraints), constraints: JSON.parse(JSON.stringify(constraints)), source: { ...source }, confidence: 1, provenance: { learnedAt: now, how: '사용자가 현재 시나리오 제약의 저장을 요청함' }, timestamp: now, lastAccessed: now, accessCount: 0, entities: [scope.areaId], relatedTo: [], derivedFrom: [], supersedes: previous?.id ?? null, supersededBy: null };
        if (previous) { previous.supersededBy = id; audit('supersede', previous.id, now, { supersededBy: id }); }
        state.records.push(r); audit('create', id, now, { source }); return r;
      },
      retrieve(scope, now = new Date().toISOString()) {
        const r = state.records.findLast(r => !r.supersededBy && r.namespace === scope.areaId && r.datasetVersion === scope.datasetVersion);
        if (!r) return null;
        r.accessCount++; r.lastAccessed = now; audit('read', r.id, now, { reason: 'exact-area-and-dataset-version' });
        return JSON.parse(JSON.stringify(r));
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createStore }; else root.CoolMemory = { createStore };
})(typeof globalThis !== 'undefined' ? globalThis : this);
