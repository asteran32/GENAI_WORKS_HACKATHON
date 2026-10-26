# Cool Sydney

실제 시드니 GIS를 수집해 로컬 GeoParquet에 저장하고, 백엔드가 읽은 건물 형상으로 3D 지도와 시간별 그림자를 보여주는 웹 대시보드입니다. 첫 분석 범위는 Sydney CBD / Town Hall이며 NSW 전체를 수집하는 기능은 아닙니다.

## 실행

프로젝트 루트에서 실행합니다. Node.js 22 이상과 프로젝트 Python 환경의 PyArrow가 필요합니다.

```bash
.venv/bin/python -m pip install -r cool-sydney/requirements.txt
bash scripts/start_cool_sydney.sh
```

브라우저에서 **http://127.0.0.1:8765**에 접속하면 GIS 수집이 자동으로 시작되고 타일 다운로드·Parquet 저장 진행이 표시됩니다. 첫 수집에는 서버의 인터넷 접근이 필요합니다. 실패하면 오류 원인을 확인하고 **지도 데이터 다시 가져오기**로 재시도합니다. 저장 후 재실행하면 외부 호출 없이 Parquet를 검증해서 읽습니다. HTML 파일을 직접 여는 방식은 지원하지 않습니다. 코드 수정 전에 실행한 서버가 남아 있다면 Ctrl+C로 종료한 뒤 다시 시작하세요.

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
  runs/<id>.json               # 날짜·태양·그늘 표본·데이터 버전
  memory.json                  # 출처·버전별 관찰 조건
```

형상은 WKB 및 JSON, 좌표는 경도·위도(OGC:CRS84)로 저장합니다. `height_m`, `min_height_m`, `height_method`, `source_url`, `source_tile`, `source_hash`, `collected_at`, `dataset_version`을 포함합니다. 파생·기본 높이를 실측 높이로 표시하지 않고, 누락 높이는 null로 남깁니다. 타일 경계의 조각 수를 실제 건물 수로 표시하지 않습니다. 데이터 파일과 인증정보는 Git에서 제외합니다.

Zetaris 컨테이너에서는 `processed/`가 `/home/zetaris/customer-data/shared/cool-sydney`로 보입니다. 버전마다 별도 데이터베이스를 생성하므로 기존 자료를 덮어쓰지 않습니다. 여러 Spark 워커를 쓰는 배포에서는 모든 워커에 같은 경로가 보여야 합니다. 현재 번들의 local Spark 구성에 맞춘 마운트입니다.

## 현재 구현 범위

| 구성 | 구현 | 실제 서비스 검증 |
| --- | --- | --- |
| GIS + Parquet | PBF 디코딩, 출처·해시, GeoParquet 쓰기/재조회, 캐시 | 실제 공개 서버 다운로드는 이 세션에서 차단됨 |
| 3D 지도 | Three.js 실제 폴리곤 압출, 도로·물·녹지, 시점 조절 | 웹서버 포트 차단으로 브라우저 확인 미완료 |
| 그림자 | Sydney 현지 시각, 태양 위치, LoD1 폴리곤 광선 교차, 중정·하부 높이·타일 경계, 20m 지면 표본 | 고정 입력 테스트 및 워커 실행 통과 |
| Zetaris | 읽기 전용 마운트, 등록 SQL, 재시도 기록, 버전/행 수 확인, 높이 집계 | Docker 소켓 접근 차단, API 키 미설정으로 라이브 검증 전 |
| NVIDIA Nemotron | 사용자 요청에 따른 결과 설명, 실행당 4회 제한, 성공 응답 캐시 | API 키 설정 및 실제 응답 확인 필요 |
| Meterless H-MEM | 출처·버전·supersession·audit를 구현한 로컬 부분 구현 | 전체 엔진 통합 아님 |

기존 합성 인구·쉼터 최적화 코드는 단위 테스트용으로 남아 있으며, 기본 GIS 화면에서는 사용하지 않습니다. 수목별 수관/수고, 지형, ABS 인구, 냉방 쉼터의 실제 운영·수용량은 아직 연결하지 않았습니다. 따라서 현재 결과는 **그림자 시나리오**이고, 온도 예측이나 쉼터 최적 배치 결과가 아닙니다. 지도 렌더링 높이와 평지 가정의 불확실성이 있습니다. 주변 타일 밖 그림자도 누락될 수 있습니다.

## 검증

```bash
cd cool-sydney
npm test
```

24개 테스트가 통과했습니다. GIS 테스트는 테스트용 PBF 응답을 사용하되 실제 PyArrow 파일 생성·재조회, 프로세스 재시작 후 복구, 해시 손상 감지 및 계산 워커까지 실행합니다. Zetaris와 NVIDIA는 모의 HTTP 응답으로 계약을 검사하며, 실제 인증 성공을 의미하지 않습니다. 브라우저 시각 검수는 미완료입니다.

## 출처와 라이선스

- [OpenFreeMap 수집·캐시 지침](https://openfreemap.org/quick_start/): 고정된 작은 구역만 순차 수집하고 원본을 캐시합니다.
- [OpenMapTiles 스키마](https://openmaptiles.org/docs/schema/): 건물 높이는 지도용 파생값입니다.
- [OpenStreetMap ODbL](https://www.openstreetmap.org/copyright): 지도에 출처를 표시합니다.
- [GeoParquet 1.1](https://geoparquet.org/releases/v1.1.0/): WKB 및 CRS 메타데이터 형식.
- [Zetaris 로컬 파일 연결](https://kbase.zetaris.com/knowledge/sql-manual), [Parquet 등록 예](https://kbase.zetaris.com/knowledge/how-to-connect-to-minio-s3): 로컬 경로로 적용한 등록 SQL은 화면에서 확인할 수 있습니다.

`vendor/scene-vendor.mjs`는 기존 EV platform에서 사용하던 Three.js 0.180.0, OrbitControls, mergeGeometries, @mapbox/vector-tile 2.0.4 및 pbf 4.0.1 번들을 재사용했습니다. 라이선스를 같은 폴더에 보존했습니다. 기존 EV 프로젝트는 수정하지 않았습니다. npm 외부 다운로드가 차단된 현재 환경에서 기존 설치본을 복사해 사용했습니다. PyArrow도 동일한 Python 3.13 환경의 기존 로컬 설치본을 프로젝트 `.venv`로 복사했고, 팀원 설치용 버전은 `requirements.txt`로 고정했습니다.
