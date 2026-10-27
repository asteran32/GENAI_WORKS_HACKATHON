# Cool Sydney

실제 시드니 GIS와 CBD 보행망·수목·자동 보행 계수·과거 기상을 로컬 GeoParquet/Parquet에 저장하는 웹 대시보드입니다. 건물 그림자 개요와 두 보행 경로의 직사광 노출을 비교합니다. 첫 분석 범위는 Sydney CBD / Town Hall입니다.

## 실행

프로젝트 루트에서 실행합니다. Node.js 22 이상과 프로젝트 Python 환경의 PyArrow가 필요합니다.

```bash
.venv/bin/python -m pip install -r cool-sydney/requirements.txt
bash scripts/start_cool_sydney.sh
```

브라우저에서 **http://127.0.0.1:8765**에 접속하면 GIS 수집이 자동으로 시작되고 타일 다운로드·Parquet 저장 진행이 표시됩니다. 첫 수집에는 서버의 인터넷 접근이 필요합니다. 실패하면 오류 원인을 확인하고 **지도 데이터 다시 가져오기**로 재시도합니다. 저장 후 재실행하면 외부 호출 없이 Parquet를 검증해서 읽습니다. HTML 파일을 직접 여는 방식은 지원하지 않습니다. 코드 수정 전에 실행한 서버가 남아 있다면 Ctrl+C로 종료한 뒤 다시 시작하세요.

건물 지도가 준비되면 **선택한 날짜의 CBD 자료 가져오기**를 누릅니다. 기본 날짜 `2025-01-15`는 자동 계수 자료가 존재하는 여름 하루입니다. 첫 수집은 OSM 원본 보행망, City of Sydney 수목·센서 지점·시간별 계수, Open-Meteo ERA5를 내려받아 보관하므로 몇 분 걸릴 수 있습니다. 지도에서 출발점과 도착점을 클릭하고 우회 허용 시간과 보행 프로필을 선택하면 최단시간 경로와 저노출 후보를 비교합니다. 같은 자료를 명령행에서 수집하려면 건물 GIS를 먼저 준비한 다음 실행합니다.

```bash
cd cool-sydney
npm run import:cbd -- 2025-01-15
```

Zetaris가 설치된 환경에서는 아래 명령으로 공개 GIS 폴더의 읽기 전용 마운트를 적용하고 웹서버를 실행할 수 있습니다. 기존 driver/api 컨테이너가 재생성될 수 있으나 볼륨을 삭제하지 않습니다.

```bash
bash scripts/start_cool_sydney.sh --zetaris
```

Zetaris 웹 UI에서 API 키를 생성해 프로젝트 루트 `.env`의 `ZETARIS_API_KEY`, `ZETARIS_ORG_ID`, `ZETARIS_REST_URL`을 설정하고 앱을 재시작합니다. 화면의 **Zetaris → 등록 → 조회**로 가상 테이블 등록과 실제 SQL 응답을 확인합니다. Docker 레지스트리 로그인과 이 API 키는 별개입니다. 설치 버전에 따라 `ZETARIS_SQL_PATH`를 조정해야 할 수 있습니다.

## 데이터 흐름

```text
OpenFreeMap / OpenMapTiles / OpenStreetMap
  → Node 백엔드: 제한된 구역의 TileJSON + PBF 수집·캐시
  → 형상·높이·출처 정규화
  → PyArrow: 레이어별 GeoParquet 저장, 전체 행 재조회 검증
  ├→ 백엔드 Parquet 읽기 → Three.js 실제 지도
  ├→ GIS worker: 태양 위치 + 건물 그림자 → 실행 결과 JSON
  └→ Zetaris: 로컬 파일 가상 테이블 → 행 수·버전 검증·높이 집계 → 화면

OSM 원본 노드·웨이 + City of Sydney 수목/계수 + Open-Meteo ERA5
  → Node 수집기: 원본 JSON 캐시·품질 검사·버전 묶음
  → PyArrow: 보행 노드/엣지·수목·센서 GeoParquet, 계수/기상 Parquet
  ├→ Three.js: 보행망·수목·센서 지점
  ├→ CBD worker: 최단시간·저노출 후보, 건물/수목 경로 그림자
  └→ 화면: 원천·가정·관측/재분석 구분
```

현재 지도 형상과 그림자 계산 입력은 **로컬 Parquet에서 읽습니다**. Zetaris는 같은 파일을 가상 테이블로 조회하고 집계 결과를 대시보드에 반환합니다. 지도 전체 형상을 Zetaris SQL을 통해 가져오는 구현은 아닙니다.

```text
data/cool-sydney/
  raw/openfreemap/               # 원본 TileJSON/PBF 캐시
  processed/current.json        # 현재 자료 버전·출처
  processed/ofm-<hash>/
    building.parquet
    transportation.parquet
    water.parquet
    landcover.parquet
    landuse.parquet
    poi.parquet
    manifest.json              # 행 수·파일 해시·재조회 검증
    zetaris-registration.json  # 성공한 등록 명령·SQL 검증 기록
  raw/cbd/{walk,trees,sites,counts,weather}/  # CBD 원본 JSON 캐시
  processed/bundles/current.json             # 검증된 CBD 묶음 포인터
  processed/bundles/cbd-<hash>/              # 4개 GeoParquet + 2개 Parquet + manifest
  runs/<id>.json               # 날짜·태양·그늘 표본·데이터 버전
  memory.json                  # 출처·버전별 관찰 조건
```

형상은 WKB 및 JSON, 좌표는 경도·위도(OGC:CRS84)로 저장합니다. `height_m`, `min_height_m`, `height_method`, `source_url`, `source_tile`, `source_hash`, `collected_at`, `dataset_version`을 포함합니다. 파생·기본 높이를 실측 높이로 표시하지 않고, 누락 높이는 null로 남깁니다. 타일 경계의 조각 수를 실제 건물 수로 표시하지 않습니다. 데이터 파일과 인증정보는 Git에서 제외합니다.

Zetaris 컨테이너에서는 `processed/`가 `/home/zetaris/customer-data/shared/cool-sydney`로 보입니다. 버전마다 별도 데이터베이스를 생성하므로 기존 자료를 덮어쓰지 않습니다. 여러 Spark 워커를 쓰는 배포에서는 모든 워커에 같은 경로가 보여야 합니다. 현재 번들의 local Spark 구성에 맞춘 마운트입니다.

## CBD 분석 계약과 구현 범위

`GET /api/gis/datasets`는 현재 묶음과 자료별 출처·행 수·품질을 반환합니다. `GET /api/gis/layers`는 지도에 필요한 보행 선형·수목·센서 지점을 반환합니다. `GET /api/gis/observations?instant=<UTC ISO>`는 선택 시간의 실제 자동 계수와 ERA5 재분석 값을 구분해 반환합니다. `POST /api/gis/routes`는 출발·도착 경위도, UTC 출발 시각, `standard`/`step_free` 프로필과 `max_detour_minutes`를 받습니다. 결과는 `GET /api/runs/<id>`로 다시 읽을 수 있습니다.

보행 연결은 OSM 웨이의 공유 노드와 층위/다리/터널 태그를 따릅니다. 차도 중심선만 있는 구간은 보도 위치 미확인으로 표시하고 노출 시간을 `unknown_minutes`에 둡니다. `step_free`는 계단을 제외한 **후보** 구간이며 현장 검증을 거친 무장애 경로가 아닙니다. 저노출 경로는 여러 가중치로 탐색한 후보 중 우회 한도 안에서 고른 결과로, 전역 최적을 보장하지 않습니다. 경로는 약 4m 간격으로 표본화하고 출발 뒤 경과 시간에 따라 태양 위치를 갱신합니다.

`TreeCanopyNS`를 m 단위 원형 수관 직경으로 해석하는 값과 수관 하단을 수고의 35%로 두는 값은 **가정**입니다. 원본 단위가 문서로 확인되지 않았으므로 실측 그늘로 설명하면 안 됩니다. Open-Meteo 값은 재분석 격자 자료이고 단거리 기온 관측이 아닙니다. 자동 계수 `Date`는 원천의 `Hour`와 일중 통행 패턴에 근거해 Sydney 현지 벽시계로 해석하고 UTC로 변환합니다. 서머타임 전환일은 원천 시각의 중복 여부를 식별할 수 없어 가져오지 않습니다. A004의 알려진 과소계수 기간은 수치를 관측값으로 표시하지 않습니다. 통행 횟수는 고유 보행자 수나 쉼터 수요가 아닙니다.

| 구성 | 구현 | 실제 서비스 검증 |
| --- | --- | --- |
| GIS + Parquet | PBF 디코딩, 출처·해시, GeoParquet 쓰기/재조회, 캐시 | 저장된 실제 타일을 로컬 Parquet에서 재조회 |
| CBD 4종 | 실제 OSM·City of Sydney·ERA5 수집, 6개 Parquet 검증, 자료 묶음 포인터 | 2025-01-15: 보행 엣지 23,839·수목 7,887·계수 96·기상 24행 |
| 3D 지도 | Three.js 건물·보행망·수목·센서·경로 표시 | headless Chrome에서 화면과 지도 클릭 흐름 확인 |
| 그림자 | 20m 건물 그늘 개요 및 약 4m 경로 표본의 건물·가정 기반 수관 그림자 | 고정 입력 테스트, 실제 경로 워커·브라우저 실행 통과 |
| Zetaris | 읽기 전용 마운트, 등록 SQL, 재시도 기록, 버전/행 수 확인, 높이 집계 | Docker 소켓 접근 차단, API 키 미설정으로 라이브 검증 전 |
| NVIDIA Nemotron | 사용자 요청에 따른 결과 설명, 실행당 4회 제한, 성공 응답 캐시 | API 키 설정 및 실제 응답 확인 필요 |
| Meterless H-MEM | 출처·버전·supersession·audit를 구현한 로컬 부분 구현 | 전체 엔진 통합 아님 |

기존 합성 인구·쉼터 최적화 코드는 단위 테스트용으로 남아 있으며, 기본 GIS 화면에서는 사용하지 않습니다. NSW 공개 수관 피복 교차 확인, BOM 최근 관측, 정기 보행 조사, Zetaris의 새 CBD 테이블 등록, 수목 치수 단위·현장 접근성 검증은 후속 작업입니다. 거리별 온도 예측이나 쉼터 최적 배치 결과는 제공하지 않습니다. 거리 계산은 Town Hall 중심의 국지 평면 근사이며 EPSG:7856 전환은 후속 작업입니다. 지도 파생 건물 높이·평지·자료 경계의 불확실성이 있습니다.

## 검증

```bash
cd cool-sydney
npm test
```

30개 테스트가 통과했습니다. CBD 테스트는 현지 시각 정규화, 층위별 보행 연결, 수관 광선, 실제 PyArrow 왕복과 해시 손상 거부를 확인합니다. 2025-01-15 실자료 수집과 화면 클릭을 통한 경로 비교도 별도로 확인했습니다. Zetaris와 NVIDIA는 모의 HTTP 응답으로 계약을 검사하며 실제 인증 성공을 의미하지 않습니다.

## 출처와 라이선스

- [OpenFreeMap 수집·캐시 지침](https://openfreemap.org/quick_start/): 고정된 작은 구역만 순차 수집하고 원본을 캐시합니다.
- [OpenMapTiles 스키마](https://openmaptiles.org/docs/schema/): 건물 높이는 지도용 파생값입니다.
- [OpenStreetMap ODbL](https://www.openstreetmap.org/copyright): 지도에 출처를 표시합니다.
- [GeoParquet 1.1](https://geoparquet.org/releases/v1.1.0/): WKB 및 CRS 메타데이터 형식.
- [City of Sydney 수목](https://services1.arcgis.com/cNVyNtjGVZybOQWZ/ArcGIS/rest/services/Trees/FeatureServer/0), [자동 계수 지점](https://services1.arcgis.com/cNVyNtjGVZybOQWZ/arcgis/rest/services/Automatic_Walking_Count_Sites/FeatureServer/0), [시간별 계수](https://services1.arcgis.com/cNVyNtjGVZybOQWZ/ArcGIS/rest/services/Automatic_Hourly_Pedestrian_Count/FeatureServer/0): 실제 수집 서비스.
- [Open-Meteo 과거 기상 API](https://open-meteo.com/en/docs/historical-weather-api), [이용 조건](https://open-meteo.com/en/terms): ERA5 시간별 재분석. 자료는 CC BY 4.0이며 무료 API는 비상업적 사용 조건입니다.
- [Zetaris 로컬 파일 연결](https://kbase.zetaris.com/knowledge/sql-manual), [Parquet 등록 예](https://kbase.zetaris.com/knowledge/how-to-connect-to-minio-s3): 로컬 경로로 적용한 등록 SQL은 화면에서 확인할 수 있습니다.

`vendor/scene-vendor.mjs`는 기존 EV platform의 Three.js 0.180.0, OrbitControls, mergeGeometries, @mapbox/vector-tile 2.0.4 및 pbf 4.0.1 번들을 재사용합니다. 라이선스는 같은 폴더에 보존했습니다. Python 의존성 버전은 `requirements.txt`에 고정했습니다.
