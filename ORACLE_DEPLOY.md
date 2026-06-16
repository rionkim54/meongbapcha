# 🟢 Oracle Cloud 평생 무료 서버 배포 가이드

이 앱을 **평생 무료(Always Free)** 서버에 올려서, PC를 꺼도 24시간 접속되고
사진·기록 데이터가 영구 보존되게 만드는 방법입니다.

소요 시간: 약 30~40분 (대부분 Oracle 가입/VM 생성 클릭, 설치는 스크립트가 자동).

---

## 사전 준비: 코드를 GitHub에 올리기
VM이 코드를 받아갈 수 있도록 먼저 GitHub에 올립니다. (이미 했다면 건너뛰기)

`meongbapcha` 폴더에서:
```bash
git init
git add .
git commit -m "멍이밥차 지원 프로그램"
git remote add origin https://github.com/<내아이디>/meongbapcha.git
git branch -M main
git push -u origin main
```
> `.env`와 `data/`는 `.gitignore`로 빠지므로 비밀번호·데이터는 올라가지 않습니다.

---

## 1단계. Oracle Cloud 가입
1. https://www.oracle.com/cloud/free 접속 → **Start for free**
2. 이메일·정보 입력, **신용/체크카드 인증** (해외결제 가능 카드. *과금되지 않으며* 본인확인용입니다. 소액 승인 후 취소될 수 있어요.)
3. 홈 리전(Region)은 **South Korea (Seoul) 또는 Chuncheon** 선택 → 한국에서 빠릅니다.

## 2단계. 무료 VM(서버) 만들기
1. 콘솔 메뉴 → **Compute → Instances → Create Instance**
2. **Image**: Ubuntu (22.04 또는 24.04)
3. **Shape(사양)**: **Ampere (ARM) - VM.Standard.A1.Flex**, **1 OCPU / 6GB** 추천 (Always Free 범위)
   - 만약 "out of capacity"가 뜨면 → **VM.Standard.E2.1.Micro** (AMD, 1GB)로 선택해도 됩니다(스크립트가 스왑을 만들어 줍니다).
4. **SSH keys**: "Generate a key pair for me" 선택 → **개인키(.key)를 꼭 다운로드**해 보관 (접속에 필요).
5. **Create** 클릭 → 잠시 뒤 인스턴스의 **Public IP 주소**가 나옵니다. (예: `140.238.x.x`) — 메모해 두세요.

## 3단계. 포트 열기 (Oracle 방화벽) — ⭐ 빠지면 접속 안 됨
1. 인스턴스 화면 → **Virtual Cloud Network(VCN)** 클릭 → **Security Lists** → 기본 보안목록 클릭
2. **Add Ingress Rules** (수신 규칙 추가):
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: **TCP**
   - Destination Port Range: **3000**
   - 저장
3. (선택) 나중에 80/443도 쓰려면 같은 방식으로 추가.

## 4단계. 서버에 접속(SSH)
**Windows PowerShell**에서 (다운로드한 키 파일 경로로):
```powershell
ssh -i "C:\경로\ssh-key.key" ubuntu@<Public IP>
```
> "권한" 오류가 나면 키 파일을 안전한 폴더(예: `C:\Users\내계정\.ssh\`)로 옮겨 다시 시도하세요.
> 처음 접속 시 "yes" 입력.

## 5단계. 코드 받고 자동 설치 (복붙 한 번)
접속된 서버 터미널에서:
```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/<내아이디>/meongbapcha.git
cd meongbapcha
bash deploy/setup.sh
```
- 비밀번호를 물어보면 원하는 값을 입력 (그냥 Enter 치면 `dog0616`).
- Node 22, Perl, 패키지 설치 + 방화벽 + 자동실행 등록까지 **스크립트가 전부** 처리합니다.
- 끝나면 화면에 접속 주소가 표시됩니다.

## 6단계. 접속!
브라우저(폰/PC)에서:
```
http://<Public IP>:3000
```
로그인 화면이 뜨면 성공 🎉 정한 비밀번호로 들어가세요.

---

## 운영 명령어 (서버 터미널에서)
```bash
# 상태 확인
sudo systemctl status meongbapcha
# 로그 실시간 보기
journalctl -u meongbapcha -f
# 재시작 / 정지
sudo systemctl restart meongbapcha
sudo systemctl stop meongbapcha
```

## 코드 업데이트 (앱을 고쳤을 때)
1. PC에서 코드 수정 → `git push`
2. 서버에서:
```bash
cd ~/meongbapcha && bash deploy/update.sh
```

## 데이터 백업
사진·DB는 모두 `~/meongbapcha/data` 안에 있습니다. 가끔 PC로 내려받아 백업하세요:
```powershell
scp -i "키파일" -r ubuntu@<IP>:~/meongbapcha/data "C:\백업폴더"
```

---

## 🔒 (선택) HTTPS 적용 — 비밀번호를 더 안전하게
지금은 `http://IP:3000` 이라 로그인 정보가 암호화되지 않습니다. 소규모면 큰 문제는 아니지만,
제대로 하려면 **무료 도메인(DuckDNS) + Caddy**로 자동 HTTPS를 붙일 수 있어요.
원하시면 말씀해 주세요 — 설정 파일과 명령어를 만들어 드립니다.

## 문제 해결
- **접속이 안 돼요** → 3단계(Oracle 보안목록 3000 포트)와, `sudo systemctl status meongbapcha`(running인지) 확인.
- **사진/주소가 안 나와요** → Perl 설치 확인: `perl -v`. 없으면 `sudo apt install -y perl` 후 `bash deploy/update.sh`.
- **메모리 부족(앱이 꺼짐)** → 1GB Micro VM이면 스왑이 켜졌는지 확인: `swapon --show`.
- **sqlite 오류** → Node 버전 확인: `node -v` 가 22 이상이어야 합니다.
