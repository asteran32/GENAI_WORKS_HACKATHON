# Cool Sydney · Hackathon

현재 개발 대상은 시드니 실제 GIS를 이용한 3D 그림자 대시보드입니다. **실행·데이터·검증 상태는 [Cool Sydney README](cool-sydney/README.md)**에서 확인합니다.

```bash
bash scripts/start_cool_sydney.sh
```

실행 후 http://127.0.0.1:8765 에서 GIS를 가져오면 `data/cool-sydney/processed/`에 GeoParquet로 저장됩니다. Zetaris에는 이 폴더를 읽기 전용으로 마운트해 가상 테이블로 등록합니다. 실제 서비스 연결과 브라우저 화면 확인은 세션의 포트·네트워크·Docker 권한 제한으로 아직 완료하지 못했습니다.

아래는 초기 환경 설정 및 이전 AR 아이디어의 기록입니다.

## 초기 환경 설정 기록

PDF의 Zetaris 데이터 계층과 Nemotron 모델 계층을 점검하는 Python 환경입니다. `.venv`와 Python 의존성 설치, Zetaris ZIP 압축 해제, 플랫폼 설정 검증까지 완료했고, 사용자가 Docker 레지스트리의 `Login Succeeded`를 확인했습니다. Zetaris 컨테이너 실행, Cursor 설치·로그인, API 키 입력 후 실제 연결 검사를 완료해야 합니다.

팀원에게 전달할 원본 PDF와 `zetaris-platform.zip`은 `shared/` 폴더에 모았습니다. 플랫폼 ZIP은 Git에서 제외하고 파일로 직접 전달합니다. 실행용 `zetaris-platform/`과 비밀번호를 담은 `.env`는 각자의 컴퓨터에서 관리합니다.

AR 조립 시스템 설계는 [인터랙티브 HTML 아키텍처](shared/ikea-ar-architecture.html)와 [Markdown 아키텍처](shared/ikea-ar-architecture.md)에서 확인합니다. HTML은 브라우저에서 구성 요소별 상세와 조립 상태 복원 예시를 볼 수 있고, Markdown은 GitHub에서 Mermaid 구조도와 함께 읽을 수 있습니다. 웹 우선 구현, 앱 확장, 모델별 역할, 로컬 저장소와 전체 제품 확장 계획을 담았습니다.

도시 폭염·냉방 쉼터 주제는 [Cool Sydney HTML 구조도](shared/cool-sydney-architecture.html)와 [Markdown 아키텍처](shared/cool-sydney-architecture.md)에 별도로 정리했습니다. 건물·나무 GIS, 시간별 그늘·보행 접근성, Zetaris·Meterless H-MEM·NVIDIA 모델의 역할과 현재 구현 상태를 담았습니다.

## 웹 우선 AR 구조와 로컬 데이터

휴대폰·PC에서 같은 React/TypeScript 웹을 사용하고, 기본 안내는 카메라 영상 위 Canvas로 표시하는 설계입니다. 폰 단독 촬영과 QR 페어링 + WebRTC로 폰 카메라를 PC에 연결하는 모드를 지원하도록 설계했습니다. 이후 Capacitor로 웹을 iOS/Android 앱에 포함하고, 정밀 공간 AR이 필요하면 별도 ARKit/ARCore 플러그인과 네이티브 렌더러를 추가합니다. Unity는 필수가 아니며, 앱 패키징만으로 정밀 AR이 생기지는 않습니다.

파일 저장소는 프로젝트 루트의 `data/`입니다. PDF·ZIP 배포 원본은 기존 `shared/`에 유지합니다.

```text
data/
├── raw/manuals/       # IKEA 조립 PDF
├── raw/products/      # 상품 자료·사진
├── processed/pages/   # 페이지 이미지·crop
├── processed/graphs/  # 추출·검수용 JSON
├── assets/models/     # GLB/USDZ·연결점
└── evaluation/        # 실물 평가 자료
```

파일은 제품·개정판별로 나누고, 경로·해시·관계·승인된 지식과 세션은 PostgreSQL에 기록하는 설계입니다. Zetaris는 PostgreSQL을 조회하며 브라우저에는 백엔드 Asset API로 파일을 제공합니다. 백엔드와 워커를 컨테이너로 만들 때 `./data:/app/data` 마운트를 적용합니다. 데이터 내용은 Git에서 제외하고 `.gitkeep`으로 폴더 구조만 공유합니다. 현재는 설계와 폴더만 준비되어 있으며 웹앱·Asset API·DB 연결은 아직 구현하지 않았습니다.

## Python 환경

```bash
cd /Users/suyeongkim/cs/openAgent
bash scripts/setup.sh
source .venv/bin/activate
```

`requirements.txt`는 이 환경에서 설치한 버전을 고정합니다. 기존 패키지 캐시로 오프라인 설치했으며, 재설치 스크립트는 로컬 캐시를 우선 사용합니다. `.env`는 권한 600으로 만들고 기존 값은 보존합니다. `.gitignore`는 환경 파일, 가상환경, 플랫폼 번들을 제외합니다.

## Cursor 설치

[공식 다운로드](https://cursor.com/download)에서 칩에 맞는 버전을 받아 설치하고 로그인합니다. ** → 이 Mac에 관하여**에서 Apple M 시리즈이면 **Mac (ARM64)**, Intel이면 **Mac (x64)**입니다. **Mac Universal**은 양쪽을 지원합니다. 현재 작업 터미널은 `x86_64`로 표시되지만 실제 하드웨어 칩 정보는 확인되지 않아 다운로드 선택 근거로 단정할 수 없습니다. Cursor에서 이 프로젝트를 열고 Python 인터프리터로 `.venv/bin/python`을 선택합니다. `curl https://cursor.com/install -fsS | bash`는 터미널용 Cursor CLI 설치 명령이며 데스크톱 앱 설치와 별개입니다.

PDF의 Build 검증은 Cursor Agent에서 Composer 또는 Grok를 선택하고 `hello`를 출력하는 Python 파일을 생성·실행하는 것입니다. 크레딧 지급 방법은 PDF에 없으므로 주최 측 안내를 확인합니다. NVIDIA/Meterless 키는 프로젝트 실행용 `.env`에 입력합니다.

## Zetaris 설치

[Zetaris 가입](https://cloud.enterprise.zetaris.com/register) 후 **Run locally**에서 `zetaris-platform.zip`과 레지스트리 로그인 정보를 받습니다. 다운로드가 보이지 않으면 주최 측이나 Zetaris 지원에 접근 권한을 요청합니다. 세부 절차는 [공식 설치 안내](https://github.com/zetaris/getting-started/blob/main/docs/install/updated_zetaris_installation_guide.md)를 따릅니다.

ZIP은 이미 `zetaris-platform/`에 압축을 풀었습니다. 관리자 이메일은 `admin@zetaris.com`, 조직은 `openAgent`이며, 새로 생성한 관리자 비밀번호는 `zetaris-platform/.env`의 `ZETARIS_ADMIN_PASSWORD`에서 확인합니다. 관리자 이메일·조직을 바꾸려면 최초 실행 전에 변경합니다. 프로젝트 `.env`의 선택적 `ZETARIS_USERNAME`, `ZETARIS_PASSWORD`도 현재 관리자 값으로 맞췄습니다.

Docker Desktop을 실행합니다. 사용자 터미널의 preflight 결과에서 Docker 27.1.1, Compose 2.29.1, x86_64, CPU 16개, 디스크 여유 547GB가 확인됐습니다. Docker 설정은 메모리 8GB이며 preflight는 사용 가능 메모리를 7GB로 표시해 경고를 냈습니다. 이는 필수 검사 실패가 아닙니다. 이후 사용자가 `zetarishackathon.azurecr.io` 로그인을 완료했습니다. 로그인한 컴퓨터에서는 아래 `docker login`을 다시 실행할 필요 없이 시작 스크립트를 실행하면 됩니다. 아래 명령은 맥의 일반 터미널에서 실행합니다.

```bash
cd /Users/suyeongkim/cs/openAgent
open -a Docker
docker login zetarishackathon.azurecr.io
bash scripts/start_zetaris.sh
```

로그인 정보는 다운로드 화면에서 받은 값을 입력합니다. 별도 로그인 명령을 받았다면 그 명령을 사용합니다. 스크립트는 preflight, 구성 검증, 이미지 다운로드, 시작, 준비 상태 검사를 순서대로 진행합니다. 검사는 실패 시 30초 간격으로 최대 30회 재시도합니다. 기존 데이터를 삭제하지 않습니다. 이 작업 세션은 Docker 소켓 접근과 외부 다운로드 권한이 제한되어 있습니다. Docker 엔진 실행은 사용자 터미널에서 확인했으며, 이미지 다운로드·Zetaris 서비스 구동은 아직 확인하지 못했습니다.

다음은 이미 적용한 플랫폼 설정입니다. **번들에 포함된** `.env`는 프로젝트 루트의 `.env`와 별개이며, 번들의 이미지 버전 등 다른 값은 유지했습니다.

| 설정 | 값 |
| --- | --- |
| `ZETARIS_ADMIN_EMAIL` | `admin@zetaris.com` |
| `ZETARIS_ADMIN_PASSWORD` | 생성한 28자 비밀번호, 파일에서 확인 |
| `ZETARIS_ADMIN_ORG` | `openAgent` |
| `ZSPARK_DRIVER_MEM` | `2g` |
| `ZSPARK_DRIVER_CORES` | `2` |
| `ZSPARK_MASTER_URL` | `local[2]` |
| `ZETARIS_API_MAX_HEAP` | `1g` |
| `UI_PORT` | `3000` |
| `ALLOWED_ORIGINS`, `GUI_URL` | `http://localhost:3000` |
| `COMPOSE_PROFILES` | 빈 값 |

관리자 비밀번호는 8자 이상이며 대문자·소문자·숫자와 `$ @ ! % * ? &` 중 하나를 포함해야 합니다. 다른 특수문자는 허용되지 않습니다. 제공된 `verify.sh`가 값을 단순하게 읽으므로 이번에 생성한 비밀번호는 영문·숫자·`@`만 사용해 따옴표나 변수 확장이 필요하지 않도록 했습니다. 관리자 계정은 첫 실행 전에 설정해야 합니다.

시작 스크립트 대신 각 단계를 직접 실행하려면 플랫폼 폴더에서 진행합니다.

```bash
cd /Users/suyeongkim/cs/openAgent/zetaris-platform
./preflight.sh
chmod 600 .env
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps --all
./verify.sh
```

최초 준비에 PDF 기준 30~45분 정도 걸릴 수 있습니다. 받은 번들의 구성은 `postgres`, `driver`, `api`, `ui`가 실행되고 `init`, `bootstrap`이 `Exited (0)`인 상태가 정상입니다. 이 번들에는 PDF의 `ai-datasteward` 서비스와 `ZETARIS_SEED_TPCH` 설정이 없으며, 기본 샘플 데이터는 `NY_TAXI`, `TPCDS_DB`입니다. 공급된 Compose·이미지 조합을 유지했습니다. 초기화 중 검사가 실패하면 완료 후 다시 `./verify.sh`를 실행합니다.

[로컬 Zetaris](http://localhost:3000)에 로그인해 SQL Editor에서 `SELECT 1 AS one;`을 실행합니다. API 키는 웹 UI에서 직접 생성해 프로젝트 루트 `.env`의 `ZETARIS_API_KEY`에 저장합니다.

공식 데이터 예제는 프로젝트 루트에서 내려받습니다.

```bash
cd /Users/suyeongkim/cs/openAgent
git clone https://github.com/zetaris/getting-started.git
```

`getting-started/AGENTS.md`를 읽고, PDF 1.8절에 따라 `open_data/rest_apis/sql/non_rate_limited/02_pokeapi_create.sql`의 PokéAPI 데이터베이스·컨테이너·Pikachu 테이블·abilities view 생성문을 하나씩 실행합니다. 전체 SQL 파일을 한 번에 실행하지 않습니다. 확인 쿼리는 다음과 같습니다.

```sql
SELECT pokemon_name, ability_name, is_hidden
FROM pokeapi.pikachu_abilities_table;
```

예상 결과는 `static`, `lightning-rod` 두 행입니다. 공급 데이터가 바뀌면 원본 응답도 확인합니다. 정지·재시작은 플랫폼 폴더에서 `docker compose stop`과 `docker compose start`를 사용합니다. `docker compose down -v`는 데이터와 암호화 키를 삭제합니다.

## Nemotron 연결

PDF 9~10쪽 기준으로 NVIDIA는 행사 전용 키를 지급하지 않으며 참가자가 직접 발급합니다. Meterless 경로도 계정에서 키를 만드는 절차로 적혀 있지만, 제공된 PDF의 가입·해커톤 크레딧 링크와 provider URL은 빈칸이고 지급 일정은 없습니다. 현재 공식 사이트에서 해커톤용 가입·키 발급 경로는 확인하지 못했습니다. 주최 측 링크가 필요합니다. NVIDIA 직접 API는 모델 페이지의 **Get API Key**에서 진행합니다.

기본값은 NVIDIA 직접 API입니다. [공식 Nemotron 모델 페이지](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b)에서 로그인하고 API 키를 직접 발급해 프로젝트 루트 `.env`의 `MODEL_API_KEY`에 입력합니다. 키 값은 채팅이나 Git에 올리지 않습니다.

```dotenv
MODEL_BASE_URL=https://integrate.api.nvidia.com/v1
MODEL_API_KEY=
NEMOTRON_MODEL=nvidia/nemotron-3-super-120b-a12b
```

Meterless를 사용하려면 위 세 값을 모두 Meterless 계정에서 받은 값으로 변경합니다. PDF에는 Meterless 가입·크레딧·API 주소·프롬프트 라이브러리 링크가 비어 있습니다. PDF 첫 부분은 Meterless 실행을 참가 조건으로 표현하지만 Power 절은 NVIDIA 직접 API도 허용하므로, 별도 Meterless 필수 준비 사항은 주최 측 안내를 확인해야 합니다.

## 연결 검사

```bash
.venv/bin/python smoke_test.py --config-only
.venv/bin/python smoke_test.py
```

첫 명령은 설정만 검사하며 API를 호출하지 않습니다. 두 번째는 Zetaris 웹, REST SQL, Nemotron 응답을 실제 호출해 확인합니다. 실패 시 종료 코드 1을 반환하고 키나 응답 본문은 출력하지 않습니다. 세 항목이 모두 PASS여야 Data·Power 연결 검증이 끝납니다. Cursor Agent 검사와 Zetaris `verify.sh`·Pikachu 쿼리도 별도로 통과해야 합니다.
