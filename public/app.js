const $ = (s) => document.querySelector(s);
let allDogs = [];
let overviewMap = null;
let detailMap = null;
let formMap = null; // 사진 선택 시 EXIF 미리보기 지도
window.openDog = (id) => showDetail(id); // 지도 마커 팝업에서 호출

const OSM = () =>
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  });

// ---------- 유틸 ----------
function fmt(dt) {
  if (!dt) return '';
  const d = new Date(dt.replace(' ', 'T'));
  if (isNaN(d)) return dt;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function esc(s) {
  return (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

// ---------- 목록 ----------
async function loadDogs() {
  const res = await fetch('/api/dogs');
  if (res.status === 401) { showLogin(); return; }
  allDogs = await res.json();
  renderList();
  renderOverviewMap();
}

// 전체 발견 위치 지도 (좌표가 있는 강아지만 마커 표시)
function renderOverviewMap() {
  const located = allDogs.filter((d) => d.lat != null && d.lng != null);
  const wrap = $('#overviewMapWrap');
  if (overviewMap) { overviewMap.remove(); overviewMap = null; }
  if (located.length === 0) { wrap.hidden = true; return; }
  wrap.hidden = false;
  overviewMap = L.map('overviewMap');
  OSM().addTo(overviewMap);
  const pts = [];
  located.forEach((d) => {
    const m = L.marker([d.lat, d.lng]).addTo(overviewMap);
    m.bindPopup(`<div class="popup-name" onclick="openDog(${d.id})">${esc(d.name)} 🔎</div>${d.address || d.location ? esc(d.address || d.location) : ''}`);
    pts.push([d.lat, d.lng]);
  });
  if (pts.length === 1) overviewMap.setView(pts[0], 15);
  else overviewMap.fitBounds(pts, { padding: [40, 40] });
  setTimeout(() => overviewMap && overviewMap.invalidateSize(), 100);
}

function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const dogs = allDogs.filter(
    (d) => !q || (d.name || '').toLowerCase().includes(q) || (d.location || '').toLowerCase().includes(q)
  );
  const grid = $('#grid');
  $('#emptyMsg').hidden = allDogs.length > 0;
  grid.innerHTML = dogs.map((d) => `
    <div class="card" data-id="${d.id}">
      ${d.photo ? `<img class="thumb" src="${d.photo}" alt="">` : `<div class="thumb">🐶</div>`}
      <div class="body">
        <h3>${esc(d.name)}</h3>
        <div class="meta">
          ${d.gender ? esc(d.gender) + ' · ' : ''}${d.age ? esc(d.age) : ''}
          ${d.address || d.location ? '<br>📍 ' + esc(d.address || d.location) : ''}
        </div>
        ${d.treatment_count > 0 ? `<span class="badge">🏥 치료 ${d.treatment_count}건</span>` : ''}
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('.card').forEach((c) =>
    c.addEventListener('click', () => showDetail(c.dataset.id))
  );
}

// 폰 내비게이션 앱으로 바로 차량 길찾기 (카카오맵 / T맵)
function navButtons(d) {
  const name = encodeURIComponent(d.name || '발견 위치');
  const kakao = `https://map.kakao.com/link/to/${name},${d.lat},${d.lng}`;   // 앱 없으면 웹으로 열림
  const naver = `nmap://route/car?dlat=${d.lat}&dlng=${d.lng}&dname=${name}&appname=com.meongbapcha`; // 차량 경로
  const tmap = `tmap://route?goalname=${name}&goalx=${d.lng}&goaly=${d.lat}`; // x=경도, y=위도
  return `
    <div class="nav-btns">
      <a class="nav-btn kakao" href="${kakao}" target="_blank" rel="noopener">🚗 카카오맵</a>
      <a class="nav-btn naver" href="${naver}">🟢 네이버지도</a>
      <a class="nav-btn tmap" href="${tmap}">🧭 T맵</a>
    </div>
    <p class="nav-hint">📱 폰에서 누르면 내비 앱이 열려 바로 차량 안내가 시작돼요.</p>`;
}

// ---------- 상세 ----------
async function showDetail(id) {
  const res = await fetch(`/api/dogs/${id}`);
  const d = await res.json();
  $('#listView').hidden = true;
  const v = $('#detailView');
  v.hidden = false;
  v.innerHTML = `
    <button class="back" id="backBtn">← 목록으로</button>
    <div class="detail-head">
      ${d.photo ? `<img class="detail-photo" src="${d.photo}" alt="">` : `<div class="detail-photo">🐶</div>`}
      <div class="detail-info">
        <h2>${esc(d.name)}</h2>
        ${d.gender ? `<div class="field"><b>성별</b>${esc(d.gender)}</div>` : ''}
        ${d.age ? `<div class="field"><b>추정나이</b>${esc(d.age)}</div>` : ''}
        ${d.found_at ? `<div class="field"><b>발견일시</b>${fmt(d.found_at)}</div>` : ''}
        ${d.location ? `<div class="field"><b>위치메모</b>${esc(d.location)}</div>` : ''}
        ${d.address ? `<div class="field"><b>주소</b>${esc(d.address)}</div>` : ''}
        ${d.notes ? `<div class="field"><b>메모</b>${esc(d.notes)}</div>` : ''}
        <div class="field"><b>등록</b>${fmt(d.created_at)}</div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button class="ghost small" id="editBtn">수정</button>
          <button class="danger small" id="deleteBtn">삭제</button>
        </div>
      </div>
    </div>

    <div class="section-title">
      <h3>📍 발견 위치</h3>
    </div>
    ${d.lat != null && d.lng != null
      ? `<div id="detailMap" class="map"></div>${navButtons(d)}`
      : `<p class="no-geo">사진에 GPS 위치정보가 없어 지도를 표시할 수 없어요. (카카오톡 등으로 받은 사진은 위치정보가 제거됩니다)</p>`}

    <div class="section-title">
      <h3>🏥 치료 기록</h3>
      <button class="primary small" id="addTreatBtn">+ 기록 추가</button>
    </div>
    <div id="treatList">
      ${d.treatments.length === 0 ? '<p class="empty">아직 치료 기록이 없습니다.</p>' :
        d.treatments.map((t) => `
        <div class="treat">
          <button class="danger del small" data-tid="${t.id}">삭제</button>
          <div class="date">${t.date ? fmt(t.date) : '날짜 미입력'}</div>
          ${t.symptom ? `<div class="line"><b>증상</b>${esc(t.symptom)}</div>` : ''}
          ${t.treatment ? `<div class="line"><b>처치</b>${esc(t.treatment)}</div>` : ''}
          ${t.hospital ? `<div class="line"><b>병원</b>${esc(t.hospital)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
  $('#backBtn').onclick = backToList;
  $('#editBtn').onclick = () => openDogModal(d);
  $('#deleteBtn').onclick = () => deleteDog(d.id);
  $('#addTreatBtn').onclick = () => openTreatModal(d.id);
  v.querySelectorAll('.del').forEach((b) =>
    b.addEventListener('click', () => deleteTreatment(b.dataset.tid, d.id))
  );

  if (detailMap) { detailMap.remove(); detailMap = null; }
  if (d.lat != null && d.lng != null) {
    detailMap = L.map('detailMap').setView([d.lat, d.lng], 16);
    OSM().addTo(detailMap);
    L.marker([d.lat, d.lng]).addTo(detailMap)
      .bindPopup(`<b>${esc(d.name)}</b> 발견 위치${d.address ? '<br>' + esc(d.address) : ''}`).openPopup();
    setTimeout(() => detailMap && detailMap.invalidateSize(), 100);
  }
}

function backToList() {
  $('#detailView').hidden = true;
  $('#listView').hidden = false;
  loadDogs();
}

// ---------- 강아지 등록/수정 모달 ----------
function openDogModal(dog) {
  $('#dogForm').reset();
  $('#photoPreview').hidden = true;
  resetExifBox();
  $('#dogModalTitle').textContent = dog ? '강아지 정보 수정' : '강아지 등록';
  $('#dogId').value = dog ? dog.id : '';
  if (dog) {
    $('#name').value = dog.name || '';
    $('#gender').value = dog.gender || '';
    $('#age').value = dog.age || '';
    $('#location').value = dog.location || '';
    $('#notes').value = dog.notes || '';
    if (dog.found_at) $('#found_at').value = dog.found_at.replace(' ', 'T').slice(0, 16);
    if (dog.photo) { $('#photoPreview').src = dog.photo; $('#photoPreview').hidden = false; }
  }
  $('#dogModal').hidden = false;
}

// EXIF 미리보기 영역 초기화
function resetExifBox() {
  if (formMap) { formMap.remove(); formMap = null; }
  $('#exifBox').hidden = true;
  $('#exifMapWrap').hidden = true;
  $('#exifDetailBtn').hidden = true;
  $('#exifDetails').hidden = true;
  $('#exifDetails').innerHTML = '';
  $('#exifSummary').innerHTML = '';
}

// 사진 선택 시: 미리보기 + 서버 분석(GPS/상세정보)
$('#photo').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  resetExifBox();
  if (!f) return;
  $('#photoPreview').src = URL.createObjectURL(f);
  $('#photoPreview').hidden = false;

  $('#exifBox').hidden = false;
  $('#exifSummary').textContent = '🔍 사진 정보 분석 중…';
  try {
    const fd = new FormData();
    fd.append('photo', f);
    const r = await fetch('/api/analyze', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || '분석 실패');
    renderExif(data);
  } catch (err) {
    $('#exifSummary').textContent = '⚠️ 사진 정보를 읽지 못했어요.';
  }
});

function renderExif(data) {
  // 요약: GPS 주소 + 촬영일시
  if (data.gps) {
    $('#exifSummary').innerHTML =
      `📍 <b>${esc(data.address || '위치정보 있음')}</b>` +
      (data.dateTime ? `<br><span class="exif-sub">🕑 ${esc(data.dateTime)}</span>` : '');
    // 미리보기 지도
    $('#exifMapWrap').hidden = false;
    formMap = L.map('exifMap').setView([data.gps.lat, data.gps.lng], 16);
    OSM().addTo(formMap);
    L.marker([data.gps.lat, data.gps.lng]).addTo(formMap);
    setTimeout(() => formMap && formMap.invalidateSize(), 150);
  } else {
    $('#exifSummary').innerHTML =
      `ℹ️ 이 사진에는 <b>GPS 위치정보가 없어요.</b>` +
      (data.dateTime ? `<br><span class="exif-sub">🕑 ${esc(data.dateTime)}</span>` : '');
  }
  // 상세정보 버튼/내용
  if (data.details && data.details.length) {
    $('#exifDetailBtn').hidden = false;
    $('#exifDetails').innerHTML = data.details
      .map((d) => `<div class="exif-row"><b>${esc(d.label)}</b><span>${esc(d.value)}</span></div>`)
      .join('');
  }
}

// 상세정보 버튼 토글
$('#exifDetailBtn').addEventListener('click', () => {
  const box = $('#exifDetails');
  box.hidden = !box.hidden;
  $('#exifDetailBtn').textContent = box.hidden ? '📋 상세정보 보기' : '📋 상세정보 닫기';
});

$('#dogForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#dogId').value;
  const fd = new FormData();
  fd.append('name', $('#name').value);
  fd.append('gender', $('#gender').value);
  fd.append('age', $('#age').value);
  fd.append('location', $('#location').value);
  fd.append('notes', $('#notes').value);
  fd.append('found_at', $('#found_at').value);
  if ($('#photo').files[0]) fd.append('photo', $('#photo').files[0]);

  const url = id ? `/api/dogs/${id}` : '/api/dogs';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, { method, body: fd });
  if (!res.ok) { alert((await res.json()).error || '저장 실패'); return; }
  const data = await res.json();
  $('#dogModal').hidden = true;
  resetExifBox();
  if (!id && data.autoNamed) toast(`🐶 이름을 '${data.name}'(으)로 지어줬어요`);
  if ($('#photo').files[0]) {
    if (data.exifGps) toast('📍 위치: ' + (data.address || '지도에 표시했어요!'));
    else toast('ℹ️ 사진에 GPS 위치정보가 없어요.');
  }
  if (id) showDetail(id); else loadDogs();
});

async function deleteDog(id) {
  if (!confirm('이 강아지와 모든 치료 기록을 삭제할까요?')) return;
  await fetch(`/api/dogs/${id}`, { method: 'DELETE' });
  backToList();
}

// ---------- 치료기록 모달 ----------
function openTreatModal(dogId) {
  $('#treatForm').reset();
  $('#treatDogId').value = dogId;
  $('#treatModal').hidden = false;
}

$('#treatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dogId = $('#treatDogId').value;
  const body = {
    date: $('#t_date').value,
    symptom: $('#t_symptom').value,
    treatment: $('#t_treatment').value,
    hospital: $('#t_hospital').value,
  };
  await fetch(`/api/dogs/${dogId}/treatments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  $('#treatModal').hidden = true;
  showDetail(dogId);
});

async function deleteTreatment(tid, dogId) {
  if (!confirm('이 치료 기록을 삭제할까요?')) return;
  await fetch(`/api/treatments/${tid}`, { method: 'DELETE' });
  showDetail(dogId);
}

// ---------- 이벤트 바인딩 ----------
$('#newBtn').onclick = () => openDogModal(null);
$('#search').addEventListener('input', renderList);
document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => { $('#dogModal').hidden = true; $('#treatModal').hidden = true; resetExifBox(); })
);
document.querySelectorAll('.modal').forEach((m) =>
  m.addEventListener('click', (e) => { if (e.target === m) { m.hidden = true; resetExifBox(); } })
);

// ---------- 로그인 ----------
function showLogin() {
  $('#loginView').hidden = false;
  $('#logoutBtn').hidden = true;
  document.querySelector('main').style.display = 'none';
  setTimeout(() => $('#loginPassword').focus(), 50);
}
function showApp() {
  $('#loginView').hidden = true;
  $('#logoutBtn').hidden = false;
  document.querySelector('main').style.display = '';
  loadDogs();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').hidden = true;
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: $('#loginPassword').value }),
  });
  if (r.ok) { $('#loginPassword').value = ''; showApp(); }
  else {
    $('#loginError').textContent = '비밀번호가 올바르지 않습니다.';
    $('#loginError').hidden = false;
  }
});
$('#logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  showLogin();
});

// 시작: 로그인 상태 확인
(async () => {
  try {
    const d = await (await fetch('/api/me')).json();
    d.authed ? showApp() : showLogin();
  } catch { showLogin(); }
})();
