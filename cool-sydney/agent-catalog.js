'use strict';
const fs = require('node:fs');
const path = require('node:path');

function readCatalog(root) {
  const file = path.join(root, 'catalog/current.json');
  if (!fs.existsSync(file)) throw new Error('메타 카탈로그가 없습니다. python3 scripts/register_zetaris.py --date 2025-12-19 --sync를 실행하세요.');
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^cool_sydney_[a-f0-9]{16}$/.test(catalog.database) || !Array.isArray(catalog.tables) || catalog.tables.length < 12) throw new Error('메타 카탈로그 형식이 올바르지 않습니다.');
  if (!/^ofm-[a-f0-9]{16}$/.test(catalog.gis_version) || !/^cbd-[a-f0-9]{16}$/.test(catalog.cbd_version)) throw new Error('카탈로그 자료 버전이 올바르지 않습니다.');
  // Pin this agent to its dated snapshot. A different dashboard import must not
  // silently switch the agent to January or invalidate a retained December set.
  const gis = JSON.parse(fs.readFileSync(path.join(root,'processed',catalog.gis_version,'manifest.json'), 'utf8'));
  const cbd = JSON.parse(fs.readFileSync(path.join(root,'processed/bundles',catalog.cbd_version,'manifest.json'), 'utf8'));
  if (cbd.date !== catalog.analysis_date || cbd.components.buildings !== catalog.gis_version) throw new Error('카탈로그 날짜·자료 버전이 일치하지 않습니다. 다시 생성하세요.');
  const files = [...gis.files,...cbd.files];
  const models=new Set(), surveys=new Set();
  const extra=new Set(['pedestrian_forecasts','pedestrian_history','forecast_backtest']);
  const base=new Set(['building','transportation','water','landcover','landuse','poi','walk_nodes','walk_edges','trees','pedestrian_sites','pedestrian_counts','weather']);
  const names=new Set(catalog.tables.map(t=>t.name));
  if(names.size!==catalog.tables.length || [...base].some(n=>!names.has(n)))throw new Error('카탈로그 기본 테이블이 누락되거나 중복됐습니다.');
  for(const t of catalog.tables){
    if(t.qualified_name!==catalog.database+'.'+t.name)throw new Error('카탈로그 테이블 경로 불일치');
    if(extra.has(t.name))models.add(t.dataset_version);
    else if(/^survey_[a-z0-9_]+$/.test(t.name))surveys.add(t.dataset_version);
    else if(!base.has(t.name))throw new Error('알 수 없는 카탈로그 테이블');
  }
  for(const version of models){
    if(!/^ped-[a-f0-9]{16}$/.test(version))throw new Error('잘못된 예측 버전');
    const m=JSON.parse(fs.readFileSync(path.join(root,'processed/pedestrian-forecasts',version,'manifest.json'),'utf8'));
    if(m.date!==catalog.analysis_date)throw new Error('예측 날짜 불일치');
    files.push(...m.files.filter(f=>extra.has(f.name.replace(/\.parquet$/,''))));
  }
  for(const version of surveys){
    if(!/^survey-[a-f0-9]{16}$/.test(version))throw new Error('잘못된 정기 조사 버전');
    const m=JSON.parse(fs.readFileSync(path.join(root,'processed/walking-surveys',version,'manifest.json'),'utf8'));
    if(m.version!==version)throw new Error('정기 조사 버전 불일치');
    files.push(...m.files.map(f=>({...f,name:'survey_'+f.name})));
  }
  if (catalog.tables.some(t=>!files.some(f=>f.name===t.name+'.parquet' && f.sha256===t.file_sha256 && f.rows===t.row_count))) throw new Error('카탈로그와 Parquet manifest가 다릅니다. 다시 생성하세요.');
  return catalog;
}
function catalogSummary(catalog) {
  return { database:catalog.database, catalog_version:catalog.catalog_version, analysis_date:catalog.analysis_date, area:catalog.area,
    tables:catalog.tables.map(t=>({table:t.qualified_name, description:t.description, rows:t.row_count,
      date_range:t.date_range, analysis_date:t.analysis_date, availability:t.availability, limitations:t.limitations, quality:t.quality, columns:t.columns})),
    joins:catalog.joins, notes:catalog.notes };
}
function describeTables(catalog, names) {
  if (!Array.isArray(names) || names.length < 1 || names.length > 4 || names.some(n=>typeof n!=='string')) throw new Error('table_names에는 테이블 이름 1~4개를 지정하세요.');
  return names.map(name=>{
    const table = catalog.tables.find(t=>t.name===name || t.qualified_name===name);
    if (!table) throw new Error('카탈로그에 없는 테이블입니다.');
    return table;
  });
}
module.exports = { readCatalog, catalogSummary, describeTables };
