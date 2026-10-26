'use strict';
const { createService } = require('./service');
async function main() {
  const date = process.argv[2] || '2025-01-15';
  const service = createService();
  try {
    const result = await service.dispatch('POST','/api/gis/cbd/import',{date});
    console.log(JSON.stringify({ bundle_version:result.bundle_version, date:result.date, files:result.files.map(f=>({name:f.name,rows:f.rows})), quality:result.quality },null,2));
  } finally { service.close(); }
}
if (require.main === module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
