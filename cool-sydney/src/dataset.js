/* Reproducible, synthetic city. No geometry or demographic claim is real. */
(function (root) {
  'use strict';
  function createDataset() {
    let seed = 73421;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const nodes = [], edges = [], buildings = [], trees = [], demand = [];
    const id = (x, y) => y * 8 + x;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
      const n = { id: id(x, y), x: 80 + x * 160, y: 80 + y * 160 };
      nodes.push(n);
      if (x) edges.push({ a: id(x - 1, y), b: n.id, length: 160, accessible: true });
      if (y) edges.push({ a: id(x, y - 1), b: n.id, length: 160, accessible: !(x === 5 && y === 3) });
      const population = 22 + Math.floor(random() * 40);
      demand.push({ id: `D${n.id}`, node: n.id, population, priority: Math.floor(population * (x > 4 ? .38 : .18)) });
    }
    for (let y = -1; y < 6; y++) for (let x = -1; x < 8; x++) {
      if ((x === 3 && y === 2) || (x === 6 && y === 3)) continue;
      const bx = 102 + x * 160, by = 104 + y * 160;
      const h = 12 + Math.floor(random() * 37);
      buildings.push({ id: `B${x}_${y}a`, x: bx, y: by, w: 49 + random() * 16, d: 111, height: h });
      buildings.push({ id: `B${x}_${y}b`, x: bx + 76, y: by, w: 40, d: 80 + random() * 28, height: 8 + random() * 24 });
    }
    for (const n of nodes) {
      if (random() < .8) trees.push({ id: `T${n.id}a`, x: n.x + 20, y: n.y + 18, radius: 7 + random() * 4, height: 10 + random() * 5, transmission: .25 });
      if (n.id % 3 === 0) trees.push({ id: `T${n.id}b`, x: n.x - 18, y: n.y - 20, radius: 9, height: 13, transmission: .25 });
    }
    for (let i = 0; i < 22; i++) trees.push({ id: `P${i}`, x: 600 + random() * 118, y: 440 + random() * 112, radius: 8, height: 11 + random() * 6, transmission: .25 });
    return {
      version: 'synthetic-parramatta-v1', kind: 'synthetic', areaId: 'parramatta-demo',
      name: 'Parramatta · 합성 시연 구역', latitude: -33.815, longitude: 151.004, timezone: 'Australia/Sydney',
      width: 1280, height: 960, nodes, edges, buildings, trees, demand,
      parks: [{ x: 590, y: 430, w: 145, d: 140 }, { x: 1070, y: 590, w: 145, d: 140 }],
      facilities: [
        { id: 'F0', name: '기존 커뮤니티 허브', short: '기존 허브', node: id(1, 2), capacity: 210, cost: 0, existing: true, open: 9, close: 17, accessible: true },
        { id: 'F1', name: '동부 도서관 후보', short: '동부 도서관', node: id(6, 3), capacity: 320, cost: 24000, existing: false, open: 8, close: 20, accessible: true },
        { id: 'F2', name: '북부 주민센터 후보', short: '북부 주민센터', node: id(3, 5), capacity: 240, cost: 18000, existing: false, open: 8, close: 20, accessible: true },
        { id: 'F3', name: '남부 스포츠홀 후보', short: '남부 스포츠홀', node: id(4, 0), capacity: 290, cost: 22000, existing: false, open: 8, close: 20, accessible: true },
        { id: 'F4', name: '서부 문화공간 후보', short: '서부 문화공간', node: id(0, 4), capacity: 170, cost: 12000, existing: false, open: 9, close: 17, accessible: false },
        { id: 'F5', name: '동남부 학교 강당 후보', short: '학교 강당', node: id(7, 1), capacity: 260, cost: 20000, existing: false, open: 8, close: 20, accessible: true }
      ],
      provenance: {
        geometry: '고정 난수로 생성한 합성 건물·나무·보행망. 실제 Parramatta 배치가 아닙니다.',
        demand: '합성 인구. 우선 지원 집단은 일반 집단과 중복되지 않는 시연용 분류입니다. ABS/HVI를 불러오지 않았습니다.',
        facilities: '가상 시설·운영시간·비용·수용량. 실제 시설의 냉방 또는 개방을 보장하지 않습니다.',
        solar: 'Parramatta 좌표와 날짜를 사용한 NOAA 근사 태양 위치. 기상 관측이나 기온 예측이 아닙니다.',
        assumptions: ['평탄한 지형', '건물은 불투명 직육면체', '나무 수관은 투과율 25%의 단순 형상', '시설 수용량은 1회 30분 체류 슬롯 기준', '도로 교차점에 배분한 합성 수요', '높이 버퍼 160m: 매우 낮은 태양에서는 경계 오차 가능']
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createDataset };
  else root.CoolData = { createDataset };
})(typeof globalThis !== 'undefined' ? globalThis : this);
