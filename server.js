const express = require('express');
const multer = require('multer');
const cookieSession = require('cookie-session');
const { exiftool } = require('exiftool-vendored');
const heicConvert = require('heic-convert');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// 데이터 폴더: 배포 시 영구 디스크 경로를 DATA_DIR 환경변수로 지정 (예: /data)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 로그인 설정 (배포 시 환경변수로 꼭 변경!)
const APP_PASSWORD = process.env.APP_PASSWORD || 'meongbapcha';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-please-change';

// ---------- DB ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'meongbapcha.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS dogs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    gender     TEXT,
    age        TEXT,
    location   TEXT,
    notes      TEXT,
    photo      TEXT,
    found_at   TEXT,                                  -- 발견/등록 일시 (사용자 지정 또는 사진 EXIF)
    lat        REAL,                                  -- 사진 EXIF GPS 위도
    lng        REAL,                                  -- 사진 EXIF GPS 경도
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS treatments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    dog_id     INTEGER NOT NULL,
    date       TEXT,                                  -- 치료 일시
    symptom    TEXT,                                  -- 증상
    treatment  TEXT,                                  -- 처치 내용
    hospital   TEXT,                                  -- 병원
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (dog_id) REFERENCES dogs(id) ON DELETE CASCADE
  );
`);

// 기존 DB에 lat/lng 컬럼이 없으면 추가 (마이그레이션)
const dogCols = db.prepare('PRAGMA table_info(dogs)').all().map((c) => c.name);
if (!dogCols.includes('lat')) db.exec('ALTER TABLE dogs ADD COLUMN lat REAL');
if (!dogCols.includes('lng')) db.exec('ALTER TABLE dogs ADD COLUMN lng REAL');
if (!dogCols.includes('address')) db.exec('ALTER TABLE dogs ADD COLUMN address TEXT'); // GPS → 주소

const pad = (n) => String(n).padStart(2, '0');

// 업로드된 사진에서 촬영일시 + GPS 좌표 추출 (ExifTool: JPEG/PNG/HEIC 모두 지원)
async function readPhotoExif(filePath) {
  const out = { found_at: null, lat: null, lng: null };
  try {
    const t = await exiftool.read(filePath);
    if (Number.isFinite(t.GPSLatitude) && Number.isFinite(t.GPSLongitude)) {
      out.lat = t.GPSLatitude;     // ExifTool은 위/경도 부호까지 적용된 십진수 반환
      out.lng = t.GPSLongitude;
    }
    const d = t.DateTimeOriginal;
    if (d && typeof d === 'object' && d.year) {
      out.found_at = `${d.year}-${pad(d.month)}-${pad(d.day)}T${pad(d.hour || 0)}:${pad(d.minute || 0)}`;
    } else if (typeof d === 'string') {
      const m = d.match(/^(\d{4})[:-](\d{2})[:-](\d{2})\D+(\d{2}):(\d{2})/);
      if (m) out.found_at = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
    }
  } catch { /* EXIF 없음 */ }
  return out;
}

// 아이폰 HEIC/HEIF 사진은 브라우저가 못 띄우므로 JPEG로 변환. 변환된 새 파일명을 반환.
async function convertHeicIfNeeded(file) {
  const isHeic = /image\/hei[cf]/i.test(file.mimetype) || /\.hei[cf]$/i.test(file.originalname);
  if (!isHeic) return file.filename;
  try {
    const inputBuffer = fs.readFileSync(file.path);
    const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.85 });
    const newName = file.filename.replace(/\.[^.]+$/, '') + '.jpg';
    fs.writeFileSync(path.join(UPLOAD_DIR, newName), outputBuffer);
    fs.unlinkSync(file.path); // 원본 HEIC 삭제
    return newName;
  } catch (e) {
    console.error('HEIC 변환 실패:', e.message);
    return file.filename; // 변환 실패 시 원본 유지
  }
}

// 위경도 → 한글 주소 (OpenStreetMap Nominatim, 무료)
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ko&zoom=18`;
    const r = await fetch(url, { headers: { 'User-Agent': 'meongbapcha-app/1.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.display_name) return null;
    // "110, 세종대로, 명동, 중구, 서울특별시, 04524, 대한민국" → "서울특별시 중구 명동 세종대로 110"
    const parts = j.display_name.split(',').map((s) => s.trim())
      .filter((s) => s && s !== '대한민국' && !/^\d{4,6}$/.test(s));
    return parts.reverse().join(' ');
  } catch {
    return null;
  }
}

// 업로드 사진 처리: HEIC 변환 → EXIF(일시·GPS) 추출 → GPS면 주소 변환
async function processPhoto(file) {
  const exif = await readPhotoExif(file.path);            // 변환 전 원본에서 EXIF 읽기 (HEIC도 GPS 보유)
  const filename = await convertHeicIfNeeded(file);       // 그 다음 JPEG로 변환
  let address = null;
  if (exif.lat != null && exif.lng != null) address = await reverseGeocode(exif.lat, exif.lng);
  return { photo: `/uploads/${filename}`, lat: exif.lat, lng: exif.lng, found_at: exif.found_at, address };
}

// 이름을 비워두면 자동으로 지어줄 귀여운 기본 이름 풀
const NAME_POOL = ['초코', '보리', '까미', '콩이', '별이', '구름', '단추', '두부',
  '감자', '뭉치', '솜이', '호두', '마루', '복실', '봄이', '하루', '코코', '몽이'];
// id 기준으로 중복 없는 이름 생성 (풀을 한 바퀴 넘기면 번호 부여)
function autoName(id) {
  const base = NAME_POOL[(id - 1) % NAME_POOL.length];
  const round = Math.floor((id - 1) / NAME_POOL.length);
  return round === 0 ? base : `${base} ${round + 1}`;
}

// EXIF 상세정보 표시용 포맷터
function formatBytes(b) {
  if (!b) return null;
  return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function formatShutter(e) {
  if (e == null) return null;
  if (typeof e === 'number') return e < 1 ? `1/${Math.round(1 / e)}초` : `${e}초`;
  return String(e);
}
function exifDateStr(d) {
  if (d && typeof d === 'object' && d.year)
    return `${d.year}-${pad(d.month)}-${pad(d.day)} ${pad(d.hour || 0)}:${pad(d.minute || 0)}`;
  return typeof d === 'string' ? d : null;
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1); // 클라우드(프록시) 뒤 환경 대응
app.use(express.json());
app.use(cookieSession({
  name: 'mbc_session',
  secret: SESSION_SECRET,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30일 로그인 유지
  httpOnly: true,
  sameSite: 'lax',
}));
app.use(express.static(path.join(__dirname, 'public'))); // 로그인 페이지는 누구나 접근

// ---------- 로그인 ----------
function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  res.status(401).json({ error: '로그인이 필요합니다.' });
}
app.post('/api/login', (req, res) => {
  if ((req.body.password || '') === APP_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
});
app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ authed: !!(req.session && req.session.authed) }));

// 이 아래의 모든 /api 와 /uploads 는 로그인 필요
app.use('/api', requireAuth);
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB (요즘 폰 사진 대응)
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || /\.(hei[cf]|jpe?g|png|webp|gif)$/i.test(file.originalname);
    cb(null, ok);
  },
});

// ---------- 강아지 API ----------
// 목록
app.get('/api/dogs', (req, res) => {
  const rows = db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM treatments t WHERE t.dog_id = d.id) AS treatment_count
    FROM dogs d ORDER BY d.id DESC
  `).all();
  res.json(rows);
});

// 상세 (+ 치료기록)
app.get('/api/dogs/:id', (req, res) => {
  const dog = db.prepare('SELECT * FROM dogs WHERE id = ?').get(req.params.id);
  if (!dog) return res.status(404).json({ error: '강아지를 찾을 수 없습니다.' });
  dog.treatments = db.prepare(
    'SELECT * FROM treatments WHERE dog_id = ? ORDER BY date DESC, id DESC'
  ).all(req.params.id);
  res.json(dog);
});

// 등록
app.post('/api/dogs', upload.single('photo'), async (req, res) => {
  const { name, gender, age, location, notes, found_at } = req.body;
  const providedName = name && name.trim();

  let photo = null, lat = null, lng = null, address = null, finalFoundAt = found_at || null;
  if (req.file) {
    const p = await processPhoto(req.file);
    photo = p.photo; lat = p.lat; lng = p.lng; address = p.address;
    if (!finalFoundAt && p.found_at) finalFoundAt = p.found_at; // 사용자 입력 우선, 없으면 EXIF
  }

  // 이름 없이 먼저 등록 → 부여된 id로 기본 이름 자동 생성
  const info = db.prepare(`
    INSERT INTO dogs (name, gender, age, location, notes, photo, found_at, lat, lng, address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(providedName || '', gender || null, age || null, location || null, notes || null,
         photo, finalFoundAt, lat, lng, address);

  const id = info.lastInsertRowid;
  const autoNamed = !providedName;
  const finalName = providedName || autoName(id);
  if (autoNamed) db.prepare('UPDATE dogs SET name=? WHERE id=?').run(finalName, id);

  res.json({ id, name: finalName, autoNamed, lat, lng, address, found_at: finalFoundAt, exifGps: lat != null });
});

// 수정
app.put('/api/dogs/:id', upload.single('photo'), async (req, res) => {
  const dog = db.prepare('SELECT * FROM dogs WHERE id = ?').get(req.params.id);
  if (!dog) return res.status(404).json({ error: '강아지를 찾을 수 없습니다.' });
  const { name, gender, age, location, notes, found_at } = req.body;

  let photo = dog.photo, lat = dog.lat, lng = dog.lng, address = dog.address;
  let finalFoundAt = found_at ?? dog.found_at;
  if (req.file) {
    const p = await processPhoto(req.file);   // 새 사진이면 사진·좌표·주소·일시 갱신
    photo = p.photo; lat = p.lat; lng = p.lng; address = p.address;
    if (!found_at && p.found_at) finalFoundAt = p.found_at;
  }

  const finalName = (name && name.trim()) ? name.trim() : dog.name; // 비우면 기존 이름 유지
  db.prepare(`
    UPDATE dogs SET name=?, gender=?, age=?, location=?, notes=?, photo=?, found_at=?, lat=?, lng=?, address=? WHERE id=?
  `).run(
    finalName, gender ?? dog.gender, age ?? dog.age,
    location ?? dog.location, notes ?? dog.notes, photo, finalFoundAt, lat, lng, address,
    req.params.id
  );
  res.json({ ok: true, lat, lng, address, found_at: finalFoundAt, exifGps: lat != null });
});

// 사진 분석 (저장하지 않고 EXIF GPS·상세정보만 추출해서 미리보기 제공)
app.post('/api/analyze', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '사진이 없습니다.' });
  try {
    const t = await exiftool.read(req.file.path);

    let gps = null, address = null;
    if (Number.isFinite(t.GPSLatitude) && Number.isFinite(t.GPSLongitude)) {
      gps = { lat: t.GPSLatitude, lng: t.GPSLongitude };
      address = await reverseGeocode(gps.lat, gps.lng);
    }
    const dateTime = exifDateStr(t.DateTimeOriginal) || exifDateStr(t.CreateDate);

    const details = [];
    const push = (label, value) => { if (value != null && value !== '') details.push({ label, value: String(value) }); };
    push('촬영일시', dateTime);
    push('기종', [t.Make, t.Model].filter(Boolean).join(' '));
    push('렌즈', t.LensModel || t.LensID);
    if (t.ImageWidth && t.ImageHeight) push('해상도', `${t.ImageWidth} × ${t.ImageHeight}`);
    push('화소', t.Megapixels ? `${t.Megapixels}MP` : null);
    push('파일형식', t.FileType);
    push('용량', formatBytes(req.file.size));
    push('조리개', t.FNumber ? `f/${t.FNumber}` : null);
    push('셔터속도', formatShutter(t.ExposureTime));
    push('ISO', t.ISO);
    push('초점거리', t.FocalLength);
    push('편집프로그램', t.Software);
    if (gps) push('GPS 좌표', `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`);

    res.json({ gps, address, dateTime, details });
  } catch (e) {
    res.status(500).json({ error: '사진을 분석하지 못했어요: ' + e.message });
  } finally {
    fs.unlink(req.file.path, () => {}); // 임시 파일 삭제
  }
});

// 삭제
app.delete('/api/dogs/:id', (req, res) => {
  db.prepare('DELETE FROM treatments WHERE dog_id = ?').run(req.params.id);
  db.prepare('DELETE FROM dogs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 치료기록 API ----------
app.post('/api/dogs/:id/treatments', (req, res) => {
  const dog = db.prepare('SELECT id FROM dogs WHERE id = ?').get(req.params.id);
  if (!dog) return res.status(404).json({ error: '강아지를 찾을 수 없습니다.' });
  const { date, symptom, treatment, hospital } = req.body;
  const info = db.prepare(`
    INSERT INTO treatments (dog_id, date, symptom, treatment, hospital)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, date || null, symptom || null, treatment || null, hospital || null);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/treatments/:id', (req, res) => {
  db.prepare('DELETE FROM treatments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 업로드/일반 에러 처리 (사진 용량 초과 등)
app.use((err, req, res, next) => {
  console.error('에러:', err.message);
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '사진 용량이 너무 큽니다 (최대 30MB).' });
  }
  res.status(500).json({ error: '처리 중 오류가 발생했습니다: ' + err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🐶 멍이밥차 지원 프로그램 실행 중: http://localhost:${PORT}`));
