const $ = (selector) => document.querySelector(selector);
const grid = $('#movie-grid');
const statusBox = $('#status');
const picker = $('#date-picker');
const dialog = $('#movie-dialog');
const visitorKey = 'movie-moa-visitor-v1';
const legacyDiaryKey = 'movie-moa-diary-v1';
const migrationKey = 'movie-moa-diary-migrated-v1';
let currentMovies = [];
let diaryRecords = [];
let selectedRating = 0;
let toastTimer;

function localDateInput(date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}
function toKobisDate(value) { return value.replaceAll('-', ''); }
function formatNumber(value) { return Number(value || 0).toLocaleString('ko-KR'); }
function formatCompact(value) {
  const n = Number(value || 0);
  return n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만` : formatNumber(n);
}
function getVisitorId() {
  let id = localStorage.getItem(visitorKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(visitorKey, id);
  }
  return id;
}
function apiHeaders(json = false) {
  return { 'X-Visitor-Id': getVisitorId(), ...(json ? { 'Content-Type': 'application/json' } : {}) };
}
async function requestDiary(url = '/api/reviews', options = {}) {
  const response = await fetch(url, { ...options, headers: { ...apiHeaders(Boolean(options.body)), ...options.headers } });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || '영화 기록을 저장하지 못했어요.');
  }
  return response.status === 204 ? null : response.json();
}
async function initDiary() {
  const data = await requestDiary();
  diaryRecords = data.reviews || [];
  const legacy = JSON.parse(localStorage.getItem(legacyDiaryKey) || '[]');
  if (!diaryRecords.length && legacy.length && localStorage.getItem(migrationKey) !== getVisitorId()) {
    for (const item of legacy) {
      const payload = {
        movieCd: item.movieCd, title: item.title, poster: item.poster || null,
        rating: item.rating, review: item.review || '', date: item.date || localDateInput(), openDt: item.openDt || '',
      };
      try {
        await requestDiary('/api/reviews', { method: 'POST', body: JSON.stringify(payload) });
      } catch (error) {
        if (!error.message.includes('이미 기록한 영화')) throw error;
      }
    }
    localStorage.setItem(migrationKey, getVisitorId());
    const migrated = await requestDiary();
    diaryRecords = migrated.reviews || [];
  }
  updateDiaryCount();
}
function updateDiaryCount() {
  const count = $('#diary-count');
  count.textContent = diaryRecords.length;
  count.hidden = diaryRecords.length === 0;
}
function showStatus(message, loading = false) {
  statusBox.classList.add('visible');
  statusBox.innerHTML = `${loading ? '<span class="spinner"></span>' : ''}${message}`;
}
function hideStatus() { statusBox.classList.remove('visible'); }
function fallbackPoster(title) {
  const node = document.createElement('div');
  node.className = 'poster-fallback';
  node.textContent = title;
  return node;
}
function posterElement(url, title, className = 'poster') {
  if (!url) return fallbackPoster(title);
  const image = document.createElement('img');
  image.className = className;
  image.src = url;
  image.alt = `${title} 포스터`;
  image.loading = 'lazy';
  image.onerror = () => image.replaceWith(fallbackPoster(title));
  return image;
}
function renderMovies(movies) {
  grid.replaceChildren();
  if (!movies.length) {
    grid.innerHTML = '<div class="empty-state">선택한 날짜의 박스오피스 정보가 없어요.<br>다른 날짜를 골라 다시 확인해 주세요.</div>';
    return;
  }
  const diary = diaryRecords;
  for (const movie of movies) {
    const card = document.createElement('article');
    card.className = 'movie-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${movie.title}, ${movie.rank}위 영화 상세 보기`);
    const poster = document.createElement('div');
    poster.className = 'poster-wrap';
    poster.append(posterElement(movie.poster, movie.title));
    const rank = document.createElement('span');
    rank.className = `rank ${Number(movie.rank) <= 3 ? 'top' : ''}`;
    rank.textContent = `#${movie.rank}`;
    poster.append(rank);
    if (movie.isNew) {
      const badge = document.createElement('span'); badge.className = 'new-badge'; badge.textContent = 'NEW'; poster.append(badge);
    }
    const info = document.createElement('div'); info.className = 'movie-info';
    const title = document.createElement('p'); title.className = 'movie-title'; title.textContent = movie.title;
    const meta = document.createElement('div'); meta.className = 'movie-meta';
    const audience = document.createElement('span'); audience.textContent = `오늘 ${formatCompact(movie.audiCnt)}명`;
    const saved = diary.find((entry) => entry.movie_cd === movie.movieCd);
    const score = document.createElement('strong'); score.textContent = saved ? `★ ${saved.rating}` : `${movie.openDt ? movie.openDt.slice(0, 4) : '영화'}`;
    meta.append(audience, score); info.append(title, meta); card.append(poster, info);
    card.addEventListener('click', () => openMovie(movie));
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMovie(movie); } });
    grid.append(card);
  }
}
async function fetchBoxoffice() {
  showStatus('영화 정보를 불러오는 중이에요', true);
  grid.replaceChildren();
  try {
    const response = await fetch(`/api/boxoffice?date=${toKobisDate(picker.value)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '영화 정보를 불러오지 못했어요.');
    currentMovies = data.movies || [];
    renderMovies(currentMovies);
    hideStatus();
  } catch (error) {
    showStatus(`${error.message} 잠시 후 다시 시도해 주세요.`);
  }
}
function safeText(value, fallback = '정보 없음') { return value || fallback; }
async function openMovie(movie) {
  selectedRating = 0;
  const existing = diaryRecords.find((item) => item.movie_cd === movie.movieCd);
  $('#dialog-content').innerHTML = `<div class="dialog-layout"><div id="detail-poster"></div><div class="dialog-copy"><h3>${escapeHtml(movie.title)}</h3><div class="dialog-facts"><span class="pill">개봉 ${movie.openDt || '정보 없음'}</span><span class="pill">누적 ${formatCompact(movie.audiAcc)}명</span></div><p id="detail-overview" class="overview">상세 정보를 불러오는 중이에요.</p><div id="detail-credits" class="credits"></div><form id="record-form" class="record-form"><label>나의 별점</label><div class="stars" role="radiogroup" aria-label="별점">${[1,2,3,4,5].map((n) => `<button type="button" class="star-button ${existing?.rating >= n ? 'selected' : ''}" data-rating="${n}" aria-label="${n}점">★</button>`).join('')}</div><label for="review-input">한 줄 감상</label><textarea id="review-input" class="review-input" maxlength="180" placeholder="이 영화, 어땠나요?">${escapeHtml(existing?.review || '')}</textarea><button class="save-button" type="submit">${existing ? '기록 수정하기' : '내 영화로 기록하기'}</button></form></div></div>`;
  $('#detail-poster').append(posterElement(movie.poster, movie.title, 'dialog-poster'));
  dialog.showModal();
  const ratingButtons = [...dialog.querySelectorAll('.star-button')];
  selectedRating = existing?.rating || 0;
  ratingButtons.forEach((button) => button.addEventListener('click', () => {
    selectedRating = Number(button.dataset.rating);
    ratingButtons.forEach((star) => star.classList.toggle('selected', Number(star.dataset.rating) <= selectedRating));
  }));
  $('#record-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!selectedRating) { toast('별점을 먼저 선택해 주세요.'); return; }
    const payload = { movieCd: movie.movieCd, title: movie.title, poster: movie.poster, rating: selectedRating, review: $('#review-input').value.trim(), date: localDateInput(), openDt: movie.openDt };
    const method = existing ? 'PUT' : 'POST';
    const url = existing ? `/api/reviews/${encodeURIComponent(movie.movieCd)}` : '/api/reviews';
    requestDiary(url, { method, body: JSON.stringify(payload) })
      .then(() => requestDiary())
      .then((data) => {
        diaryRecords = data.reviews || [];
        updateDiaryCount();
        renderMovies(currentMovies);
        dialog.close();
        toast('나의 영화 기록을 데이터베이스에 저장했어요.');
      })
      .catch((error) => toast(error.message));
  });
  try {
    const response = await fetch(`/api/movie/${encodeURIComponent(movie.movieCd)}`);
    const detail = await response.json();
    if (!response.ok) throw new Error(detail.error || '상세 정보를 불러오지 못했어요.');
    if (!dialog.open || !$('#detail-overview')) return;
    const overview = $('#detail-overview');
    overview.textContent = detail.overview || '등록된 줄거리 정보가 없어요.';
    const credits = $('#detail-credits');
    const genres = (detail.genres || []).filter(Boolean).join(' · ');
    credits.textContent = [`감독 ${detail.directors?.join(', ') || '정보 없음'}`, `출연 ${detail.actors?.join(', ') || '정보 없음'}`, genres ? `장르 ${genres}` : ''].filter(Boolean).join('  ·  ');
  } catch (error) {
    if (dialog.open && $('#detail-overview')) $('#detail-overview').textContent = '상세 정보를 불러오지 못했어요. 별점과 감상은 기록할 수 있습니다.';
  }
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function toast(message) {
  const element = $('#toast'); element.textContent = message; element.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 2200);
}
async function renderDiary() {
  try {
    const data = await requestDiary();
    diaryRecords = data.reviews || [];
    updateDiaryCount();
  } catch (error) {
    $('#diary-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    return;
  }
  const records = diaryRecords;
  const ratings = records.map((record) => Number(record.rating) || 0);
  const average = records.length ? (ratings.reduce((a, b) => a + b, 0) / records.length).toFixed(1) : '—';
  $('#diary-stats').innerHTML = `<div class="stat-card"><div class="stat-label">기록한 영화</div><div class="stat-value">${records.length}<small> 편</small></div></div><div class="stat-card"><div class="stat-label">나의 평균 별점</div><div class="stat-value">${average}<small> / 5</small></div></div><div class="chart-card"><div class="chart-title">월별 영화 기록</div><canvas class="chart" id="monthly-chart" aria-label="최근 6개월 월별 영화 기록 그래프"></canvas></div>`;
  drawChart(records);
  const list = $('#diary-list'); list.replaceChildren();
  if (!records.length) {
    list.innerHTML = '<div class="empty-state">아직 기록한 영화가 없어요.<br>박스오피스에서 영화를 골라 나만의 감상을 남겨보세요.</div>';
    return;
  }
  records.forEach((record) => {
    const row = document.createElement('article'); row.className = 'diary-item';
    row.append(posterElement(record.poster, record.title, 'diary-poster'));
    const main = document.createElement('div'); main.className = 'diary-main';
    const title = document.createElement('strong'); title.textContent = record.title;
    const review = document.createElement('p'); review.textContent = record.review || '감상 한 줄을 남기지 않았어요.';
    const date = document.createElement('span'); date.className = 'diary-date'; date.textContent = record.watched_on || '';
    main.append(title, review, date);
    const stars = document.createElement('span'); stars.className = 'diary-stars'; stars.textContent = `${'★'.repeat(record.rating)}${'☆'.repeat(5-record.rating)}`;
    const remove = document.createElement('button'); remove.className = 'delete-button'; remove.textContent = '삭제'; remove.setAttribute('aria-label', `${record.title} 기록 삭제`);
    remove.addEventListener('click', async () => {
      try {
        await requestDiary(`/api/reviews/${encodeURIComponent(record.movie_cd)}`, { method: 'DELETE' });
        diaryRecords = diaryRecords.filter((item) => item.movie_cd !== record.movie_cd);
        updateDiaryCount(); renderDiary(); renderMovies(currentMovies); toast('DB에서 기록을 삭제했어요.');
      } catch (error) { toast(error.message); }
    });
    row.append(main, stars, remove); list.append(row);
  });
}
function drawChart(records) {
  const canvas = $('#monthly-chart'); if (!canvas) return;
  const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const width = rect.width, height = rect.height;
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push({ key: localDateInput(d).slice(0, 7), label: `${d.getMonth()+1}월`, value: 0 }); }
  records.forEach((record) => { const month = months.find((item) => item.key === record.watched_on?.slice(0, 7)); if (month) month.value++; });
  const max = Math.max(1, ...months.map((m) => m.value));
  ctx.font = '10px DM Sans, sans-serif'; ctx.textAlign = 'center';
  months.forEach((month, index) => {
    const x = ((index + .5) / months.length) * width; const barWidth = Math.min(30, width / 12);
    const barHeight = month.value ? Math.max(5, (month.value / max) * (height - 32)) : 2;
    ctx.fillStyle = month.value ? '#d7ff77' : '#ffffff20';
    ctx.beginPath(); ctx.roundRect(x - barWidth/2, height - 22 - barHeight, barWidth, barHeight, 4); ctx.fill();
    ctx.fillStyle = '#aaa9b3'; ctx.fillText(month.label, x, height - 5);
    if (month.value) { ctx.fillStyle = '#f5f3ef'; ctx.fillText(String(month.value), x, height - 27 - barHeight); }
  });
}
document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  const isDiary = button.dataset.view === 'diary';
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
  $('#boxoffice-view').classList.toggle('hidden', isDiary);
  $('#diary-view').classList.toggle('hidden', !isDiary);
  if (isDiary) renderDiary();
}));
picker.value = localDateInput(new Date(Date.now() - 86400000));
picker.max = localDateInput();
picker.addEventListener('change', fetchBoxoffice);
$('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
initDiary().then(fetchBoxoffice).catch((error) => {
  showStatus(`${error.message} 브라우저의 저장 공간을 사용할 수 있는지 확인해 주세요.`);
  fetchBoxoffice();
});
