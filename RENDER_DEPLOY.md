# 🚀 무료 배포 가이드 (Render + Turso)

**카드 없이 완전 무료**로 인터넷에 올리는 방법입니다.
- **Render**: 앱을 돌리는 무료 호스팅 (Docker)
- **Turso**: 데이터·사진을 영구 보관하는 무료 클라우드 DB

> Render 무료 플랜은 15분간 접속이 없으면 잠들었다가, 다음 첫 접속 때 ~1분 깨어납니다. (그 뒤엔 빠름)

소요 시간: 약 15~20분.

---

## A. Turso 데이터베이스 만들기 (사진·기록 영구 보관)
1. https://turso.tech 접속 → **Sign up** (GitHub 계정으로 로그인, 카드 불필요)
2. **Create Database** → 이름 입력(예: `meongbapcha`) → 리전은 **Tokyo (nrt)** 추천 → 생성
3. 생성된 DB 클릭 → **Database URL** 복사 (`libsql://meongbapcha-...turso.io`) — 메모
4. **Create Token** (또는 Tokens 탭) → 토큰 생성 → 긴 문자열 복사 — 메모
   - 이 **URL**과 **토큰** 두 개를 잠시 뒤 Render에 넣습니다.

## B. Render에 앱 올리기
1. https://render.com 접속 → **Sign up** (GitHub 계정으로)
2. **New + → Web Service** → **Build and deploy from a Git repository**
3. `rionkim54/meongbapcha` 저장소 연결 (없으면 GitHub 연동 후 선택)
4. 설정 확인:
   - **Language/Runtime**: Docker (저장소의 `Dockerfile` 자동 인식)
   - **Instance Type**: **Free**
5. **Environment Variables** 에 아래 4개 추가:

| Key | Value |
|-----|-------|
| `APP_PASSWORD` | `dog0616` (원하는 로그인 비밀번호) |
| `SESSION_SECRET` | 아무 긴 무작위 문자열 (예: 키보드 마구 치기 40자+) |
| `TURSO_DATABASE_URL` | A-3에서 복사한 `libsql://...` |
| `TURSO_AUTH_TOKEN` | A-4에서 복사한 토큰 |

6. **Create Web Service** → 빌드 시작 (몇 분 소요. Perl·이미지 처리 도구까지 자동 설치).
7. 완료되면 상단에 **공개 주소**(`https://meongbapcha.onrender.com` 같은)가 생깁니다.

## C. 접속!
주소를 폰·PC 브라우저에서 열기 → **로그인 화면** → 비밀번호(`dog0616`)로 입장 🎉

---

## ✅ 확인 체크리스트
- [ ] 로그인 화면이 뜨고 비밀번호로 들어가진다
- [ ] 강아지 등록 → 사진·지도·주소가 나온다
- [ ] **Render가 다시 배포된 뒤에도 데이터가 그대로** (= Turso에 잘 저장된 것)
- [ ] 폰에서 길찾기 버튼이 내비 앱을 연다

## 코드 업데이트 방법
PC에서 코드를 고친 뒤 `git push` 하면, **Render가 자동으로 다시 배포**합니다. (별도 작업 불필요)

## 문제 해결
- **빌드 실패** → Render의 **Logs** 탭 내용을 복사해 알려주세요.
- **로그인은 되는데 데이터가 안 보임/저장 안 됨** → `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` 값이 정확한지 확인.
- **사진·주소가 안 나옴** → 빌드 로그에서 Perl 설치 확인(`Dockerfile`이 처리). 사진에 GPS가 없으면 주소·지도는 원래 안 나옵니다.
- **첫 접속이 느림(~1분)** → 무료 플랜이 잠들었다 깨는 정상 동작입니다.

## 💡 사진 저장 용량
사진은 업로드 시 자동으로 **압축(최대 1600px)** 되어 Turso에 저장됩니다(보통 장당 0.2~0.5MB).
Turso 무료 용량은 넉넉하지만, 많이 쌓이면 대시보드에서 사용량을 확인하세요.
