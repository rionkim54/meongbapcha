const express = require('express');
const multer = require('multer');
const cookieSession = require('cookie-session');
const { exiftool } = require('exiftool-vendored');
const heicConvert = require('heic-convert');
const sharp = require('sharp');
const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 업로드 임시 폴더 (사진은 DB에 저장하고 이 파일은 곧 삭제)
const TMP_DIR = path.join(os.tmpdir(), 'meongbapcha-uploads');
fs.mkdirSync(TMP_DIR, { recursive: true });

// 로그인 설정 (배포 시 환경변수로 꼭 변경!)
const APP_PASSWORD = process.env.APP_PASSWORD || 'meongbapcha';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-please-change';

// ---------- DB (Turso / 로컬 파일 자동 선택) ----------
// 배포: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN 환경변수 사용
// 로컬: 환경변수 없으면 data/meongbapcha.db 파일 사용
const LOCAL_DB = path.join(__dirname, 'data', 'meongbapcha.db');
if (!process.env.TURSO_DATABASE_URL) fs.mkdirSync(path.dirname(LOCAL_DB), { recursive: true });
const db = process.env.TURSO_DATABASE_URL
  ? createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  : createClient({ url: 'file:' + LOCAL_DB });

async function initDb() {
  await db.execute(`CREATE TABLE IF NOT EXISTS dogs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    gender     TEXT,
    age        TEXT,
    location   TEXT,
    notes      TEXT,
    photo      TEXT,
    found_at   TEXT,
    lat        REAL,
    lng        REAL,
    address    TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS treatments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    dog_id     INTEGER NOT NULL,
    date       TEXT,
    symptom    TEXT,
    treatment  TEXT,
    hospital   TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  // 사진은 DB에 보관 (Render 무료는 파일 저장이 임시라 사라지므로)
  await db.execute(`CREATE TABLE IF NOT EXISTS photos (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    mime TEXT,
    data BLOB
  )`);
  // 예전 로컬 DB 대비 컬럼 보강 (이미 있으면 무시)
  for (const col of ['lat REAL', 'lng REAL', 'address TEXT']) {
    try { await db.execute(`ALTER TABLE dogs ADD COLUMN ${col}`); } catch { /* 이미 있음 */ }
  }
}

// 작은 SQL 헬퍼
const all = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const get = async (sql, args = []) => (await db.execute({ sql, args })).rows[0] || null;
const run = async (sql, args = []) => await db.execute({ sql, args });

const pad = (n) => String(n).padStart(2, '0');

// 업로드된 사진에서 촬영일시 + GPS 좌표 추출 (ExifTool: JPEG/PNG/HEIC 모두 지원)
async function readPhotoExif(filePath) {
  const out = { found_at: null, lat: null, lng: null };
  try {
    const t = await exiftool.read(filePath);
    if (Number.isFinite(t.GPSLatitude) && Number.isFinite(t.GPSLongitude)) {
      out.lat = t.GPSLatitude;
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

// 위경도 → 한글 주소 (OpenStreetMap Nominatim, 무료)
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ko&zoom=18`;
    const r = await fetch(url, { headers: { 'User-Agent': 'meongbapcha-app/1.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.display_name) return null;
    const parts = j.display_name.split(',').map((s) => s.trim())
      .filter((s) => s && s !== '대한민국' && !/^\d{4,6}$/.test(s));
    return parts.reverse().join(' ');
  } catch {
    return null;
  }
}

// 업로드 사진 처리: EXIF 추출 → HEIC면 JPEG 변환 → 회전보정/리사이즈/압축 → 주소
// 반환: { buffer, mime, lat, lng, found_at, address }
async function processPhoto(file) {
  const exif = await readPhotoExif(file.path);
  let buf = fs.readFileSync(file.path);
  const isHeic = /image\/hei[cf]/i.test(file.mimetype) || /\.hei[cf]$/i.test(file.originalname);
  if (isHeic) {
    try { buf = Buffer.from(await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.9 })); }
    catch (e) { console.error('HEIC 변환 실패:', e.message); }
  }
  let mime = 'image/jpeg';
  try {
    buf = await sharp(buf).rotate()  // EXIF 방향 보정
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 }).toBuffer();
  } catch (e) {
    console.error('이미지 처리 실패:', e.message);
    mime = file.mimetype || 'image/jpeg';
  }
  fs.unlink(file.path, () => {}); // 임시 파일 삭제
  let address = null;
  if (exif.lat != null && exif.lng != null) address = await reverseGeocode(exif.lat, exif.lng);
  return { buffer: buf, mime, lat: exif.lat, lng: exif.lng, found_at: exif.found_at, address };
}

async function savePhoto(buffer, mime) {
  const r = await run('INSERT INTO photos (mime, data) VALUES (?, ?)', [mime, buffer]);
  return Number(r.lastInsertRowid);
}
async function deletePhotoByUrl(url) {
  const m = url && url.match(/^\/photo\/(\d+)$/);
  if (m) { try { await run('DELETE FROM photos WHERE id = ?', [Number(m[1])]); } catch {} }
}

// 이름을 비워두면 자동으로 지어줄 귀여운 기본 이름 풀
const NAME_POOL = ['초코', '보리', '까미', '콩이', '별이', '구름', '단추', '두부',
  '감자', '뭉치', '솜이', '호두', '마루', '복실', '봄이', '하루', '코코', '몽이'];
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
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieSession({
  name: 'mbc_session',
  secret: SESSION_SECRET,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
}));
app.use(express.static(path.join(__dirname, 'public')));

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

// 사진 제공 (DB 블롭) — 로그인 필요
app.get('/photo/:id', requireAuth, async (req, res) => {
  const row = await get('SELECT mime, data FROM photos WHERE id = ?', [Number(req.params.id)]);
  if (!row || !row.data) return res.status(404).end();
  res.set('Content-Type', row.mime || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(Buffer.from(row.data));
});

// 예전 로컬 데이터 호환: data/uploads 의 사진도 계속 제공 (배포 환경엔 파일이 없어 영향 없음)
app.use('/uploads', requireAuth, express.static(path.join(__dirname, 'data', 'uploads')));

// 이 아래의 모든 /api 는 로그인 필요
app.use('/api', requireAuth);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || /\.(hei[cf]|jpe?g|png|webp|gif)$/i.test(file.originalname);
    cb(null, ok);
  },
});

// ---------- 강아지 API ----------
app.get('/api/dogs', async (req, res) => {
  const rows = await all(`
    SELECT d.*, (SELECT COUNT(*) FROM treatments t WHERE t.dog_id = d.id) AS treatment_count
    FROM dogs d ORDER BY d.id DESC`);
  res.json(rows);
});

app.get('/api/dogs/:id', async (req, res) => {
  const dog = await get('SELECT * FROM dogs WHERE id = ?', [req.params.id]);
  if (!dog) return res.status(404).json({ error: '강아지를 찾을 수 없습니다.' });
  dog.treatments = await all('SELECT * FROM treatments WHERE dog_id = ? ORDER BY date DESC, id DESC', [req.params.id]);
  res.json(dog);
});

app.post('/api/dogs', upload.single('photo'), async (req, res) => {
  const { name, gender, age, location, notes, found_at } = req.body;
  const providedName = name && name.trim();

  let photo = null, lat = null, lng = null, address = null, finalFoundAt = found_at || null;
  if (req.file) {
    const p = await processPhoto(req.file);
    lat = p.lat; lng = p.lng; address = p.address;
    if (!finalFoundAt && p.found_at) finalFoundAt = p.found_at;
    photo = `/photo/${await savePhoto(p.buffer, p.mime)}`;
  }

  const info = await run(
    `INSERT INTO dogs (name, gender, age, location, notes, photo, found_at, lat, lng, address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [providedName || '', gender || null, age || null, location || null, notes || null,
     photo, finalFoundAt, lat, lng, address]);

  const id = Number(info.lastInsertRowid);
  const autoNamed = !providedName;
  const finalName = providedName || autoName(id);
  if (autoNamed) await run('UPDATE dogs SET name = ? WHERE id = ?', [finalName, id]);

  res.json({ id, name: finalName, autoNamed, lat, lng, address, found_at: finalFoundAt, exifGps: lat != null });
});

app.put('/api/dogs/:id', upload.single('photo'), async (req, res) => {
  const dog = await get('SELECT * FROM dogs WHERE id = ?', [req.params.id]);
  if (!dog) return res.status(404).json({ error: '강아지를 찾을 수 없습니다.' });
  const { name, gender, age, location, notes, found_at } = req.body;

  let photo = dog.photo, lat = dog.lat, lng = dog.lng, address = dog.address;
  let finalFoundAt = found_at ?? dog.found_at;
  if (req.file) {
    const p = await processPhoto(req.file);
    lat = p.lat; lng = p.lng; address = p.address;
    if (!found_at && p.found_at) finalFoundAt = p.found_at;
    await deletePhotoByUrl(dog.photo);                 // 옛 사진 정리
    photo = `/photo/${await savePhoto(p.buffer, p.mime)}`;
  }

  const finalName = (name && name.trim()) ? name.trim() : dog.name;
  await run(
    `UPDATE dogs SET name=?, gender=?, age=?, location=?, notes=?, photo=?, found_at=?, lat=?, lng=?, address=? WHERE id=?`,
    [finalName, gender ?? dog.gender, age ?? dog.age, location ?? dog.location, notes ?? dog.notes,
     photo, finalFoundAt, lat, lng, address, req.params.id]);
  res.json({ ok: true, lat, lng, address, found_at: finalFoundAt, exifGps: lat != null });
});

// 사진 분석 (저장하지 않고 EXIF GPS·상세정보만 추출)
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
    fs.unlink(req.file.path, () => {});
  }
});

app.delete('/api/dogs/:id', async (req, res) => {
  const dog = await get('SELECT photo FROM dogs WHERE id = ?', [req.params.id]);
  if (dog) await deletePhotoByUrl(dog.photo);
  await run('DELETE FROM treatments WHERE dog_id = ?', [req.params.id]);
  await run('DELETE FROM dogs WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- 치료기록 API ----------
app.post('/api/dogs/:id/treatments', async (req, res) => {
  const dog = await get('SELECT id FROM dogs WHERE id = ?', [req.params.id]);
  if (!dog) return res.status(404).json({ error: '강아지를 찾을 수 없습니다.' });
  const { date, symptom, treatment, hospital } = req.body;
  const info = await run(
    'INSERT INTO treatments (dog_id, date, symptom, treatment, hospital) VALUES (?, ?, ?, ?, ?)',
    [req.params.id, date || null, symptom || null, treatment || null, hospital || null]);
  res.json({ id: Number(info.lastInsertRowid) });
});

app.delete('/api/treatments/:id', async (req, res) => {
  await run('DELETE FROM treatments WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// 에러 처리
app.use((err, req, res, next) => {
  console.error('에러:', err.message);
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '사진 용량이 너무 큽니다 (최대 30MB).' });
  }
  res.status(500).json({ error: '처리 중 오류가 발생했습니다: ' + err.message });
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`🐶 멍이밥차 지원 프로그램 실행 중: http://localhost:${PORT}`)))
  .catch((e) => { console.error('DB 초기화 실패:', e); process.exit(1); });
