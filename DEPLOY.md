# 🚀 배포 가이드 (Railway, 항상 켜짐)

이 앱을 인터넷에 올려서 **PC를 끄더라도 24시간 접속** 가능하게 만드는 방법입니다.
사진과 데이터가 재배포해도 사라지지 않도록 **영구 저장소(볼륨)** 까지 설정합니다.

> 추천 서비스: **Railway** (https://railway.app) — Node + 볼륨 + 환경변수가 가장 쉽습니다.
> 무료 크레딧으로 시작할 수 있고, 이후 사용량에 따라 월 소액(보통 $5 내외)입니다.

---

## 0. 준비물
- GitHub 계정 (코드를 올릴 곳)
- Railway 계정 (GitHub으로 가입 가능)

## 1. 코드를 GitHub에 올리기
이 `meongbapcha` 폴더에서 (터미널):

```bash
git init
git add .
git commit -m "멍이밥차 지원 프로그램"
# GitHub에서 새 저장소(repository)를 하나 만든 뒤, 주소를 아래에 붙여넣기
git remote add origin https://github.com/<내아이디>/meongbapcha.git
git branch -M main
git push -u origin main
```
> `.gitignore`에 `node_modules`와 `data`가 들어 있어, 무거운 파일과 개인 데이터는 올라가지 않습니다.

## 2. Railway에서 프로젝트 생성
1. https://railway.app 접속 → **New Project**
2. **Deploy from GitHub repo** 선택 → 방금 올린 `meongbapcha` 저장소 선택
3. Railway가 자동으로 Node.js 앱으로 인식하고 빌드를 시작합니다.
   - `nixpacks.toml` 덕분에 사진 분석에 필요한 **Perl** 이 자동 설치됩니다.
   - `package.json`의 `engines`로 **Node 22**가 사용됩니다.

## 3. 영구 저장소(볼륨) 추가 — ⭐ 중요
사진과 DB가 재배포 시 사라지지 않게 하려면 볼륨이 꼭 필요합니다.
1. 서비스 화면에서 **Variables/Settings** 옆 **Volumes** (또는 우클릭 → New Volume)
2. **Mount path**를 `/data` 로 지정하고 생성
3. 이게 `DATA_DIR` 환경변수와 연결됩니다 (다음 단계).

## 4. 환경변수 설정
서비스 → **Variables** 탭에서 아래 3개를 추가하세요:

| 변수 이름 | 값 | 설명 |
|-----------|-----|------|
| `APP_PASSWORD` | (원하는 비밀번호) | 봉사자들에게 공유할 **로그인 비밀번호** |
| `SESSION_SECRET` | (길고 무작위한 문자열) | 세션 암호화 키. 아무도 모르게 |
| `DATA_DIR` | `/data` | 3번에서 만든 볼륨 경로와 동일하게 |

> `SESSION_SECRET`은 예를 들어 키보드를 마구 쳐서 만든 40자 이상의 문자열을 쓰세요.
> `PORT`는 Railway가 자동으로 넣어주므로 설정하지 않아도 됩니다.

## 5. 배포 & 주소 확인
1. 변수를 저장하면 자동으로 다시 배포됩니다.
2. **Settings → Networking → Generate Domain** 을 누르면
   `https://meongbapcha-production.up.railway.app` 같은 **공개 주소**가 생깁니다.
3. 그 주소로 접속 → 로그인 화면이 뜨면 성공! `APP_PASSWORD`로 로그인하세요.

---

## ✅ 배포 후 체크리스트
- [ ] 공개 주소로 접속하면 로그인 화면이 나온다
- [ ] 비밀번호로 로그인된다
- [ ] 강아지를 등록하고, **재배포(또는 재시작) 후에도 데이터가 남아있다** (볼륨이 잘 연결된 것)
- [ ] 사진을 올리면 GPS 주소/지도가 나온다 (Perl 설치가 잘 된 것)

## 🔧 문제가 생기면
- **사진 EXIF/주소가 안 나옴** → Railway 빌드 로그에서 Perl 설치를 확인. `nixpacks.toml`이 저장소에 있는지 확인.
- **재배포하면 데이터가 사라짐** → 볼륨 Mount path가 `/data`인지, `DATA_DIR=/data`인지 확인.
- **앱이 안 켜짐 (sqlite 오류)** → Node 22가 맞는지 확인 (`engines` 필드). 빌드 로그의 Node 버전 확인.

## 💸 비용 참고
- Railway는 무료 크레딧 소진 후 사용량 과금(보통 소규모 앱은 월 $5 내외).
- 더 저렴하게: **Fly.io**(볼륨 무료 한도 있음)도 가능하지만 설정이 조금 더 복잡합니다.
- **Render**는 무료 플랜에 영구 디스크가 없어(사진이 사라짐) 이 앱에는 권장하지 않습니다.
