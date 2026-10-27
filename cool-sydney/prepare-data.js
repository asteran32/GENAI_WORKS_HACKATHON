'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createGISStore } = require('./gis-store');
const { createCBDStore, dateWindow } = require('./cbd-store');

async function prepareData({ gis, cbd, date = '2025-01-15', mapOnly = false, log = console.log }) {
  dateWindow(date); // Reject invalid dates before requesting any data.
  log('[1/2] 시드니 건물·도로·녹지 GIS → GeoParquet');
  const map = await gis.load();
  log(`GIS 준비 완료: ${map.counts.building.toLocaleString()}개 건물 형상 조각 · ${map.version}`);
  if (mapOnly) return { mapVersion: map.version, cbd: null };
  log(`[2/2] ${date} 보행망·수목·보행 계수·과거 기상 → Parquet`);
  let bundle = cbd.metadata().ready ? await cbd.get() : null;
  if (!bundle || bundle.manifest.date !== date || bundle.manifest.components.buildings !== map.version) bundle = await cbd.load(date);
  log(`CBD 준비 완료: ${bundle.manifest.bundle_version}`);
  for (const file of bundle.manifest.files) log(`  ${file.name}: ${file.rows.toLocaleString()}행`);
  return { mapVersion: map.version, cbd: bundle.manifest.bundle_version };
}

async function main(args = process.argv.slice(2)) {
  let date = '2025-01-15', mapOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--map-only') mapOnly = true;
    else if (args[i] === '--date' && args[i + 1]) date = args[++i];
    else throw new Error(`지원하지 않는 옵션: ${args[i]}. --date YYYY-MM-DD 또는 --map-only를 사용하세요.`);
  }
  const project = path.resolve(__dirname, '..'), envFile = path.join(project, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const root = path.join(project, 'data', 'cool-sydney'), gis = createGISStore(root), cbd = createCBDStore(root, { gis });
  let previous = '';
  const timer = setInterval(() => {
    const messages = [gis.metadata(), cbd.metadata()].filter(s => s.loading).map(s => s.progress.message).join(' · ');
    if (messages && messages !== previous) { previous = messages; console.log(messages); }
  }, 1000);
  try {
    await prepareData({ gis, cbd, date, mapOnly });
    const csv = path.join(root, 'raw', 'microclimate', 'Stream1_Temperature_Sydney_20231209_20240306.csv');
    if (fs.existsSync(csv) && !fs.existsSync(path.join(root, 'processed', 'microclimate', 'current.json'))) {
      const python = process.env.COOL_SYDNEY_PYTHON || path.join(project, '.venv', 'bin', 'python');
      const imported = spawnSync(python, [path.join(__dirname, 'microclimate-import.py'), csv], { stdio: 'inherit' });
      if (imported.error || imported.status !== 0) throw new Error('거리 기온 CSV 변환에 실패했습니다.');
    } else if (!fs.existsSync(path.join(root, 'processed', 'microclimate', 'current.json'))) {
      console.log('거리 기온 실측 CSV는 별도 자료입니다. 미설치 상태로 표시하며 지도 실행에는 필요하지 않습니다.');
    }
    console.log(`데이터 저장 위치: ${root}`);
  } finally { clearInterval(timer); }
}
if (require.main === module) main().catch(error => {
  console.error(`데이터 준비 실패: ${error.message}`);
  console.error('서버를 시작하지 않았습니다. 인터넷 접근이 가능한 터미널에서 같은 명령을 다시 실행하면 원본 캐시를 재사용합니다.');
  process.exitCode = 1;
});
module.exports = { prepareData, main };
