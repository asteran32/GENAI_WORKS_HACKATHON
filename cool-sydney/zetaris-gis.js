'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { zetarisQuery } = require('./integrations');
const { LAYERS } = require('./gis-store');
const MOUNT = '/home/zetaris/customer-data/shared/cool-sydney';
function database(version) { if (!/^ofm-[a-f0-9]{16}$/.test(version)) throw new Error('유효하지 않은 데이터 버전입니다.'); return `cool_sydney_${version.slice(4)}`; }
function plan(info) {
  const db = database(info.version);
  return { database: db, version: info.version, containerPath: `${MOUNT}/${info.version}`, statements: [
    `CREATE LIGHTNING DATABASE ${db}`,
    ...LAYERS.map(layer => `CREATE LIGHTNING FILESTORE TABLE ${layer} FROM ${db} FORMAT PARQUET OPTIONS (path "${MOUNT}/${info.version}/${layer}.parquet")`)
  ], verificationSQL: `SELECT COUNT(*), MIN(dataset_version), MAX(dataset_version) FROM ${db}.building` };
}
function createZetarisGIS(root, env, transport) {
  let active = null;
  const recordPath = version => path.join(root, 'processed', version, 'zetaris-registration.json');
  async function verify(info) {
    const p = plan(info), r = await zetarisQuery(p.verificationSQL, env, transport);
    const row = r.data?.[0];
    if (!Array.isArray(row) || Number(row[0]) !== info.counts.building || row[1] !== info.version || row[2] !== info.version) throw new Error('Zetaris 조회 결과의 행 수 또는 버전이 로컬 Parquet와 다릅니다.');
    return { verified: true, source: 'zetaris', rows: Number(row[0]), datasetVersion: row[1], checkedAt: new Date().toISOString(), database: p.database };
  }
  return {
    plan,
    async register(info) {
      if (active) return active;
      active = (async () => {
        const p = plan(info), location = recordPath(info.version);
        const record = fs.existsSync(location) ? JSON.parse(fs.readFileSync(location, 'utf8')) : { version: info.version, completed: [] };
        const save = () => { fs.writeFileSync(`${location}.tmp`, JSON.stringify(record, null, 2)); fs.renameSync(`${location}.tmp`, location); };
        for (const sql of p.statements) {
          if (record.completed.includes(sql)) continue;
          const r = await zetarisQuery(sql, env, transport);
          if (r.error || r.errors?.length || r.success === false) throw new Error('Zetaris가 자료 등록을 거절했습니다. 마운트 경로와 SQL 권한을 확인하세요.');
          record.completed.push(sql); save();
        }
        record.verification = await verify(info); save(); return record.verification;
      })();
      try { return await active; } finally { active = null; }
    },
    verify,
    async summary(info) {
      const verification = await verify(info), db = database(info.version);
      const query = `SELECT height_method, COUNT(*), AVG(height_m), MAX(height_m) FROM ${db}.building GROUP BY height_method`;
      const r = await zetarisQuery(query, env, transport);
      if (!Array.isArray(r.data) || r.data.some(row => !Array.isArray(row) || row.length < 4)) throw new Error('Zetaris GIS 집계 응답을 확인할 수 없습니다.');
      return { ...verification, query, columns: ['height_method', 'geometry_fragments', 'average_height_m', 'max_height_m'], data: r.data };
    }
  };
}
module.exports = { MOUNT, database, plan, createZetarisGIS };
