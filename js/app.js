/* 골프 라운드 분석 웹앱 — 화면 렌더링.
 * 데이터 원본은 GitHub 저장소의 rounds.json, settings.json 이다(위치는 GitHubStore가 정한다 — 원래 주인은 data/, Fork한 사람은 data/users/계정/).
 * 입력 중인 라운드만 이 브라우저에 임시 저장해, 저장 전에 화면이 닫혀도 잃지 않게 한다.
 */
(() => {
  const S = GolfStats;
  const G = GitHubStore;
  const KEY_DRAFT = "golf2.draft.v1";
  const KEY_CACHE = "golf2.cache.v1";
  const KEY_FILTER = "golf2.filter.v1";
  const app = document.getElementById("app");
  let rounds = [];
  let settings = structuredClone(S.DEFAULT_SETTINGS);
  let source = "";
  let loadedAt = null;
  let charts = [];

  // ───────────── 유틸 ─────────────
  const isNum = S.isNum;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f1 = (v) => (isNum(v) ? v.toFixed(1) : "-");
  const f2 = (v) => (isNum(v) ? v.toFixed(2) : "-");
  const pct = (v) => (isNum(v) ? Math.round(v * 100) + "%" : "-");
  const sgn = (v, d = 2) => (isNum(v) ? (v > 0 ? "+" : "") + v.toFixed(d) : "-");
  const fmtT = (v, t) => (t === "%" ? pct(v) : f1(v));
  const dot = (d) => String(d || "").replaceAll("-", ".");
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 공간 없음 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
  };
  function toast(msg, ms = 2800) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  function chart(id, cfg) {
    const el = document.getElementById(id);
    if (el && window.Chart) charts.push(new Chart(el, cfg));
  }
  // 차트 데이터 레이블: 값만 표시 (계열·항목 이름 없음)
  const valueLabels = (fmt, color) => ({
    id: "valueLabels",
    afterDatasetsDraw(c) {
      const { ctx } = c;
      ctx.save();
      ctx.font = "600 11px Pretendard, sans-serif";
      ctx.fillStyle = "#333";
      ctx.textAlign = "center";
      c.data.datasets.forEach((ds, i) => {
        if (ds.noLabels) return;
        const meta = c.getDatasetMeta(i);
        if (meta.hidden) return;
        meta.data.forEach((el, j) => {
          const v = ds.data[j];
          if (!isNum(v)) return;
          const hz = c.options.indexAxis === "y";
          ctx.fillStyle = (color && color(v, j, ds)) || "#333";
          ctx.fillText(fmt(v), hz ? el.x + 18 : el.x, hz ? el.y + 4 : el.y - 6);
        });
      });
      ctx.restore();
    },
  });
  const UP = "#d9475a", DOWN = "#2f6fd6";   // 평균보다 높음(나쁨) / 낮음(좋음) — 타수 기준
  const popHover = {
    id: "popHover",
    afterDatasetsDraw(c) {
      const act = c.getActiveElements ? c.getActiveElements() : [];
      c.canvas.style.cursor = act.length ? "pointer" : "default";
      for (const a of act) {
        const meta = c.getDatasetMeta(a.datasetIndex);
        if (meta.type !== "bar") continue;
        const el = a.element, ds = c.data.datasets[a.datasetIndex];
        const { x, y, base, width, height } = el.getProps(["x", "y", "base", "width", "height"], true);
        const hz = c.options.indexAxis === "y", g = 3;
        const left = hz ? Math.min(x, base) : x - width / 2, top = hz ? y - height / 2 : Math.min(y, base);
        const w = hz ? Math.abs(x - base) : width, h = hz ? height : Math.abs(base - y);
        const bg = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[a.index] : ds.backgroundColor;
        const ctx = c.ctx;
        ctx.save();
        ctx.shadowColor = "rgba(30, 40, 60, .3)";
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 5;
        ctx.fillStyle = bg;
        ctx.beginPath();
        (ctx.roundRect ? ctx.roundRect(left - g, top - g, w + g * 2, h + g, 4) : ctx.rect(left - g, top - g, w + g * 2, h + g));
        ctx.fill();
        ctx.restore();
      }
    },
  };
  if (window.Chart) Chart.register(popHover);
  const baseOpts = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, ...extra });
  const legendOn = { legend: { display: true, position: "bottom" } };
  const noGrid = { grid: { display: false } };

  // ───────────── 데이터 ─────────────
  async function loadAll(quiet) {
    try {
      const r = await G.load();
      if (Array.isArray(r.data)) {
        rounds = r.data;
        source = r.missing ? "pages" : r.source;
        loadedAt = new Date();
        ls.set(KEY_CACHE, rounds);
      }
      const s = await G.load(G.SETTINGS);
      if (s.data) settings = deepMerge(structuredClone(S.DEFAULT_SETTINGS), s.data);
      if (!quiet) toast(source === "github" ? "GitHub 최신 데이터를 불러왔습니다." : "배포본 데이터를 불러왔습니다(GitHub API 한도 초과 등).");
    } catch (e) {
      const cached = ls.get(KEY_CACHE);
      if (Array.isArray(cached)) { rounds = cached; source = "cache"; }
      toast("데이터를 불러오지 못했습니다: " + e.message, 5000);
    }
    renderStatus();
  }
  function deepMerge(a, b) {
    for (const k of Object.keys(b || {})) {
      if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) a[k] = deepMerge(a[k] || {}, b[k]);
      else a[k] = b[k];
    }
    return a;
  }
  function renderStatus() {
    const el = document.getElementById("status");
    if (!el) return;
    const src = { github: "GitHub 최신본", pages: "배포본(최대 몇 분 늦을 수 있음)", cache: "이 기기 캐시(오프라인)" }[source] || "-";
    el.innerHTML = `${G.pending() ? `<a class="ng" href="#/settings" style="color:#d9475a;font-weight:700">⚠ 동기화 필요</a>` : ""}<span>데이터: ${src}${loadedAt ? " · " + loadedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
      <span class="${G.canWrite() ? "ok" : "muted"}">${G.canWrite() ? "● 저장 가능" : "○ 읽기 전용"}</span>
      <button class="link" id="bReload" type="button">새로고침</button>
      <a class="ver" href="#/settings" title="버전 · 변경 내역">v${APP_VERSION}</a>`;
    document.getElementById("bReload").onclick = async () => { await loadAll(); route(); };
  }
  async function commit(mutate, message) {
    const { data: next, mirrorErrors } = await G.update((data) => mutate(Array.isArray(data) ? data : []), message);
    if (mirrorErrors.length) setTimeout(() => toast("저장은 됐지만 다른 저장소 동기화에 실패했습니다. 설정 → 동기화에서 다시 맞춰 주세요.\n" + mirrorErrors.join("\n"), 8000), 3000);
    rounds = next;
    source = "github";
    loadedAt = new Date();
    ls.set(KEY_CACHE, rounds);
    renderStatus();
  }

  // ───────────── 공통 필터 (모든 분석 화면에 같은 조건) ─────────────
  let F = { period: "all", course: "", full: false, ...(ls.get(KEY_FILTER) || {}) };
  const iso = (d) => d.toISOString().slice(0, 10);
  function inPeriod(date) {
    const t = new Date(), p = F.period;
    if (p === "all") return true;
    if (p === "d90") return date >= iso(new Date(t - 90 * 864e5));
    if (p === "month") return date.startsWith(iso(t).slice(0, 7));
    if (p === "lastMonth") { const m = new Date(t.getFullYear(), t.getMonth() - 1, 15); return date.startsWith(iso(m).slice(0, 7)); }
    if (p.startsWith("y")) return date.startsWith(p.slice(1));
    return true;
  }
  function frounds() {
    return rounds.filter((r) => inPeriod(r.date || "") && (!F.course || String(r.course).includes(F.course)) && (!F.full || S.round(r).full));
  }
  const PERIOD_LABEL = { all: "전체", d90: "최근 90일", month: "이번 달", lastMonth: "지난 달" };
  function filterBar() {
    const years = [...new Set(rounds.map((r) => String(r.date).slice(0, 4)))].sort().reverse();
    const opts = [...Object.entries(PERIOD_LABEL), ...years.map((y) => ["y" + y, y + "년"])];
    const n = frounds().length;
    return `<div class="fbar" id="fbar">
      <div class="chips">${opts.map(([v, l]) => `<button type="button" class="chip ${F.period === v ? "on" : ""}" data-p="${v}">${l}</button>`).join("")}</div>
      <div class="row">
        <input id="fCourseQ" placeholder="골프장 검색" value="${esc(F.course)}" list="fCourseList">
        <datalist id="fCourseList">${[...new Set(rounds.map((r) => r.course))].sort().map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
        <label class="row" style="gap:4px;font-size:14px"><input type="checkbox" id="fFull" ${F.full ? "checked" : ""}> 18홀만</label>
        <span class="muted">${n}라운드${F.period !== "all" || F.course || F.full ? ` · <button class="link" id="fReset" type="button">조건 초기화</button>` : ""}</span>
      </div></div>`;
  }
  function bindFilter() {
    const bar = document.getElementById("fbar");
    if (!bar) return;
    const save = () => { ls.set(KEY_FILTER, F); route(); };
    bar.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { F.period = b.dataset.p; save(); }));
    const q = document.getElementById("fCourseQ");
    q.onchange = () => { F.course = q.value.trim(); save(); };
    document.getElementById("fFull").onchange = (e) => { F.full = e.target.checked; save(); };
    const rs = document.getElementById("fReset");
    if (rs) rs.onclick = () => { F = { period: "all", course: "", full: false }; save(); };
  }
  // 각 탭 위에 무엇을 기준으로 집계했는지 짧게 적는다
  const DESC = {
    dashboard: ["위 조건에 맞는 라운드로 실력 진단·육각형·타수 손실을 계산합니다.", "타수 지표는 18홀 라운드, 퍼트·GIR·FW·스크램블·벌타는 퍼트를 기록한 라운드 기준입니다."],
    rounds: ["라운드를 누르면 스코어카드가 열립니다. 골프장 검색·기간으로 좁혀 볼 수 있습니다."],
    stats: ["스코어 유형 카드를 누르면 그 스코어가 나온 라운드가 아래에 나옵니다.", "추이 그래프는 기간이 1년 이하면 월별, 3년 이하면 분기별, 그 이상은 연도별로 묶습니다. 연도를 고르면 그해를 월별로 봅니다.", "골프장 이름을 누르면 그 골프장 라운드만 걸러 봅니다."],
    insights: ["라운드 날짜·시간으로 만든 요약입니다. 오전/오후는 티오프 시간이 있는 라운드(스마트스코어 붙여넣기 등)만 집계합니다."],
    holes: ["Par가 기록된 홀만 집계합니다."],
    detail: ["v2 「상세분석」 7개 블록에 ⑧ 홀 길이별(실제로 친 티 거리) 분석을 더했습니다. 상세 항목을 기록한 홀만 각 표에 들어갑니다."],
  };
  const desc = (k) => (DESC[k] ? `<ul class="desc">${DESC[k].map((x) => `<li>${x}</li>`).join("")}</ul>` : "");
  const head = (k) => filterBar() + desc(k);

  // ───────────── 라우팅 ─────────────
  // ───────────── 정리 내역: golf-lounge에서 겹치던 것과 golf2에서 바꾼 것 ─────────────
  const REVIEW = [
    ["등록 값", "FW 안착(○/×)과 티샷 미스(L·R·H·S·-)", "같은 티샷 결과를 두 칸에 적음(FW ○ = 미스 「-」)", "「티샷 결과」 한 칸(FW 안착 / L / R / H / S). FW ○/×는 자동"],
    ["등록 값", "온그린 타수", "타수 − 퍼트로 계산되는 값을 또 입력", "입력칸 제거(자동 계산해 저장은 그대로)"],
    ["등록 값", "숏게임 성공 ○/×", "GIR·퍼트·첫 퍼트 거리로 자동 판정되는 값", "입력칸 제거(자동 판정)"],
    ["등록 값", "그린 미스 방향", "GIR 성공 홀에서는 의미 없음(늘 「-」)", "GIR 홀은 「해당 없음」으로 잠금"],
    ["스코어카드", "FW 안착 줄·티샷 미스 줄, 온그린 타수 줄·GIR 줄", "같은 내용을 두 줄로 표시", "「티샷」 한 줄(○ 또는 방향), 온그린 타수 줄 제거"],
    ["홈", "실력 진단 표와 7영역 육각형", "FW·GIR·스크램블·퍼트·3퍼트가 두 기준(목표·0~100점)에 따로", "한 표에 목표·판정·점수를 같이"],
    ["홈", "강점·약점 목록", "실력 진단의 판정 열을 다시 나열", "「먼저 볼 것」: 1순위 손실·목표 미달·티샷 쏠림만"],
    ["홈", "파 유형·전후반 문장", "홀·파 분석과 같은 내용", "홀·파 화면으로 안내"],
    ["설정", "목표 기준값과 육각형 점수 기준", "같은 지표가 두 표, 단위도 다름(%와 0~1, 라운드당 퍼트와 홀당 퍼트)", "「지표 기준」 한 표, 같은 단위(%, 라운드당)"],
    ["설정·홈", "퍼트 수(라운드당)와 홀당 퍼트", "같은 지표를 두 단위로", "한 줄(라운드당)로 표시"],
    ["분석", "상세 분석 ④ 파 유형별", "홀·파 분석 「파 유형별」과 같은 표", "삭제"],
    ["분석", "상세 분석 ⑥ 홀 난이도·전후반", "홀·파 성격의 표가 샷 분석에 있음", "홀·파로 옮김"],
    ["분석", "통계 평균 타수 KPI", "홈 요약의 평균 타수와 같음", "삭제(표준편차·최근 10R·최저최고만)"],
    ["분석·인사이트", "통계 「자주 가는 골프장」", "인사이트 지역별 골프장 표(방문·평균·베스트·최근)와 같은 열", "지역 표에 「전체 골프장」 칩으로 합침"],
    ["인사이트", "최근 90일 라운드 표", "공통 필터 「최근 90일」 + 라운드 목록과 같음", "삭제(필터로 봄)"],
    ["인사이트", "올해 골프장 KPI", "홈 「방문 골프장」·인사이트 요약 줄과 겹침", "삭제"],
    ["홈·분석", "「타수 추이」 두 개", "이름은 같지만 내용이 다름(라운드별 / 기간별 평균)", "둘 다 두고 이름 구분: 홈 「라운드별」, 분석 「기간별 평균 타수」"],
    ["메뉴", "통계·홀파·상세 분석 / 라운드 입력·붙여넣기", "비슷한 화면이 메뉴 10개로 흩어짐", "「분석」(스코어·홀파·샷) · 「등록」(직접·붙여넣기) 하위 탭, 메뉴 7개"],
  ];
  function reviewView() {
    app.innerHTML = `<h2>golf2 — 중복 정리 내역</h2>
      <p class="legend-note">golf-lounge(v1.0)의 등록 값·통계·분석을 모두 훑어 같은 것을 두 번 묻거나 보여 주는 곳을 찾아 정리한 화면입니다. <b>기록은 golf-lounge와 같은 저장소</b>를 쓰므로 어느 쪽에서 저장해도 양쪽에 보입니다.</p>
      <div class="tbl-wrap"><table><thead><tr><th class="l">위치</th><th class="l">겹치던 것</th><th class="l">왜 중복인가</th><th class="l">golf2에서</th></tr></thead>
        <tbody>${REVIEW.map((r) => `<tr><td class="l"><span class="pill">${r[0]}</span></td><td class="l"><b>${r[1]}</b></td><td class="l wrap">${r[2]}</td><td class="l wrap">${r[3]}</td></tr>`).join("")}</tbody></table></div>
      <h3>그대로 둔 것</h3>
      <ul class="desc">
        <li><b>거리·핸디캡</b>: 같은 골프장이면 라운드마다 같지만, 「이전 라운드 코스 정보 불러오기」로 한 번에 채워 입력 부담이 없어 유지.</li>
        <li><b>지역</b>: 골프장마다 같은 값이지만, 라운드마다 입력하기로 정한 방식이라 유지(골프장을 적으면 자동 선택).</li>
        <li><b>스코어 유형(홀 단위)과 스코어 구간(라운드 단위)</b>: 이름은 비슷하지만 세는 단위가 달라 유지.</li>
        <li><b>라운드 상세의 퍼트·GIR·FW 카드와 7영역 표</b>: 일부 겹치지만, 카드는 숫자·표는 점수 환산이라 유지.</li>
      </ul>
      <p><a href="https://supok00.github.io/golf-lounge/">golf-lounge(원래 화면) 열기</a></p>`;
  }

  // 메뉴를 줄이려고 비슷한 화면을 한 메뉴의 하위 탭으로 묶었다
  const SUB = {
    analysis: [["score", "스코어", () => statsView()], ["holes", "홀·파", () => holesView()], ["shots", "샷 분석", () => detailView()]],
    register: [["input", "직접 입력", () => inputView(null)], ["paste", "붙여넣기·사진", () => importView()]],
  };
  function route() {
    charts.forEach((c) => c.destroy());
    charts = [];
    const [, tab = "dashboard", arg] = location.hash.split("?")[0].split("/");
    // 예전 주소(#/stats 등)도 새 메뉴의 하위 탭으로 연다
    const OLD = { stats: ["analysis", "score"], holes: ["analysis", "holes"], detail: ["analysis", "shots"], input: ["register", "input"], import: ["register", "paste"] };
    const [grp, sub] = OLD[tab] || (SUB[tab] ? [tab, arg] : [null, null]);
    const active = tab === "round" || tab === "edit" ? "rounds" : grp || tab;
    document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === active));
    const views = { dashboard, input: () => inputView(null), edit: () => inputView(decodeURIComponent(arg || "")), rounds: roundsView, round: () => roundView(decodeURIComponent(arg || "")), stats: statsView, insights: insightsView, holes: holesView, detail: detailView, import: importView, guide: guideView, settings: settingsView, review: reviewView };
    const nav = document.getElementById("subnav");
    if (grp) {
      const list = SUB[grp], it = list.find((x) => x[0] === sub) || list[0];
      nav.innerHTML = `<div class="subtabs">${list.map(([k, l]) => `<a href="#/${grp}/${k}" class="${k === it[0] ? "active" : ""}">${l}</a>`).join("")}</div>`;
      it[2]();
    } else {
      nav.innerHTML = "";
      (views[tab] || dashboard)();
    }
    bindFilter();
    window.scrollTo(0, 0);
  }

  // ───────────── 대시보드 ─────────────
  function kpi(lbl, val, sub, cls = "") {
    return `<div class="kpi"><div class="lbl">${lbl}</div><div class="val ${cls}">${val}</div><div class="sub">${sub || "&nbsp;"}</div></div>`;
  }
  // 목표 달성 여부: 낮을수록 좋은 지표(타수·퍼트·벌타 등)는 목표 이하, 높을수록 좋은 지표(파 이하 홀·GIR 등)는 목표 이상이면 달성
  const meets = (v, t) => (isNum(v) ? (t.low ? v <= t.v : v >= t.v) : null);
  const judge = (ok) => (ok === null ? "-" : `<span class="pill ${ok ? "ok" : "ng"}">${ok ? "달성" : "미달"}</span>`);
  const valCell = (v, t, ok, strong) => `<td class="${ok === null ? "" : ok ? "ok" : "ng"}">${strong ? "<b>" : ""}${fmtT(v, t.fmt)}${strong ? "</b>" : ""}</td>`;
  const goalText = (t) => `${fmtT(t.v, t.fmt)} ${t.low ? "이하" : "이상"}`;

  // Fork한 사이트는 자기 폴더(data/users/계정)에 저장해 빈 기록으로 시작한다. 처음 쓰는 분께 순서를 안내한다.
  function welcomeBox() {
    if (G.IS_ORIGIN || rounds.length) return "";
    return `<div class="card welcome">
      <h3 class="mt0">👋 내 골프 라운지에 오신 것을 환영합니다</h3>
      <p>아직 기록이 없습니다. 이 사이트의 기록은 <b>${esc(G.PRIMARY.owner)}/${esc(G.PRIMARY.repo)}</b> 저장소의 <code>${esc(G.ROUNDS)}</code>에 저장됩니다.</p>
      <ol>
        <li>${G.canWrite() ? "✅ GitHub 토큰 준비 완료" : `<a href="#/settings">설정</a>에서 <b>내 저장소용 GitHub 토큰</b>을 넣어 주세요`}</li>
        <li><a href="#/import">붙여넣기 등록</a>(스마트스코어) 또는 <a href="#/input">라운드 입력</a>으로 첫 라운드를 남겨 보세요.</li>
        <li>자세한 방법은 <a href="#/guide">📖 가이드</a>에 있습니다.</li>
      </ol>
    </div>`;
  }
  async function claimSite(fresh) {
    if (fresh) await commit(() => [], "새 사용자: 빈 기록으로 시작");
    const next = fresh ? structuredClone(S.DEFAULT_SETTINGS) : settings;
    await G.update(() => next, fresh ? "새 사용자: 기본 기준값" : "새 사용자: 기존 기록 그대로 사용", G.SETTINGS);
    settings = next;
    toast(fresh ? "빈 기록으로 시작합니다. 라운드 입력이나 붙여넣기 등록으로 첫 기록을 남겨 보세요." : "지금 기록 그대로 씁니다.", 4000);
    route();
  }
  /* 같은 지표가 「목표 기준값」과 「육각형 점수 기준」 두 곳에 따로 있던 것을 한 줄로 묶는다.
   * t: settings.targets 키(목표 판정), r: settings.radar 키(0~100점). 퍼트는 목표가 라운드당, 점수는 홀당이라 화면에서 라운드당(×18)으로 맞춘다. */
  const UNI = [
    { label: "평균 타수", t: "strokes", low: true },
    { label: "파 이하 홀 수", t: "parlow" },
    { label: "더블보기+ 홀 수", t: "dbl", low: true },
    { label: "FW 안착", t: "fwp", r: "fw" },
    { label: "GIR", t: "girp", r: "gir" },
    { label: "스크램블", t: "scrp", r: "scr" },
    { label: "퍼트 수", t: "putts", r: "pph", low: true },
    { label: "3퍼트 수", t: "p3", r: "p3", low: true },
    { label: "1st 퍼트 거리", r: "fp", low: true },
    { label: "벌타", t: "pen", low: true },
    { label: "위기관리(벌타+더블+ 초과타)", r: "crisis", low: true },
  ];
  // 설정 표에서 육각형 기준을 목표와 같은 단위로 보여 준다: 비율은 %, 홀당 퍼트는 라운드당
  const PCT = new Set(["fw", "gir", "scr"]);
  const RSCALE = { fw: 100, gir: 100, scr: 100, pph: 18 };
  const uniFmt = (r, v) => (!isNum(v) ? "-" : r === "fp" ? v.toFixed(1) + "m" : v.toFixed(1));
  function dashboard() {
    const fr = frounds();
    const A = S.analyze(fr, settings);
    const rows = Object.entries(settings.targets).map(([k, t]) => {
      const m = A.metric(k);
      return { t, m, ok: meets(m.r5, t), okLast: meets(m.last, t) };
    });
    const okList = rows.filter((r) => r.ok === true).map((r) => r.t.label);
    const ngList = rows.filter((r) => r.ok === false).map((r) => r.t.label);
    const lossTop = A.loss.filter((l) => isNum(l.r5)).sort((a, b) => b.r5 - a.r5)[0];
    const H = S.holeLevel(fr);
    const ps = [3, 4, 5].filter((p) => isNum(H.byPar[p].over)).sort((a, b) => H.byPar[a].over - H.byPar[b].over);
    const frA = S.avg(A.fulls.map((r) => r.front)), bk = S.avg(A.fulls.map((r) => r.back));
    app.innerHTML = `
      ${welcomeBox()}
      <div class="notice" style="margin-bottom:10px">🆕 <b>Golf 2</b>는 golf-lounge에서 겹치던 입력·통계·분석을 정리한 화면입니다(기록은 같음). <a href="#/review">무엇을 정리했나 보기 (${REVIEW.length}가지)</a></div>
      ${head("dashboard")}
      <h2>요약</h2>
      <div class="kpis">
        ${kpi("등록 라운드", A.rs.length, `18홀 ${A.fulls.length}회`)}
        ${kpi("베스트 스코어", A.best ? A.best.strokes : "-", A.best ? `${dot(A.best.date)} ${esc(A.best.course)}` : "", "best")}
        ${kpi("평균 타수", f1(S.avg(A.fulls.map((r) => r.strokes))), "18홀 평균")}
        ${kpi("최근 5R 평균", f1(S.avg(A.fulls.slice(0, 5).map((r) => r.strokes))), "최근 18홀 5라운드")}
        ${kpi("방문 골프장", A.courses, "서로 다른 골프장")}
      </div>
      <h2>실력 진단 <span class="muted">최근 5라운드 · 목표 판정과 영역 점수를 한 표로</span></h2>
      <div class="tbl-wrap"><table>
        <thead><tr><th class="l">지표</th><th>목표</th><th>최근 5R</th><th>판정</th><th>점수</th><th>전체 평균</th></tr></thead>
        <tbody>${UNI.map((u) => {
          const t = u.t && settings.targets[u.t], m = u.t ? A.metric(u.t) : null;
          const r5 = m ? m.r5 : A.radar.raw[u.r], all = m ? m.all : A.radarAll.raw[u.r];
          const ok = t ? meets(r5, t) : null, sc = u.r ? A.radar.score[u.r] : null;
          const fmt = (v) => (t ? fmtT(v, t.fmt) : uniFmt(u.r, v));
          return `<tr><td class="l"><b>${u.label}</b>${u.r ? ` <span class="pill">${settings.radar[u.r].label}</span>` : ""}<br><span class="muted">${u.low ? "▼ 낮을수록 좋음" : "▲ 높을수록 좋음"}</span></td>
            <td>${t ? `<b>${goalText(t)}</b>` : `<span class="muted">-</span>`}</td>${t ? valCell(r5, t, ok, true) : `<td><b>${fmt(r5)}</b></td>`}<td>${judge(ok)}</td>
            <td class="${isNum(sc) ? (sc >= settings.radarTarget ? "ok" : "ng") : ""}">${isNum(sc) ? `<b>${sc}</b>` : "-"}</td><td class="muted">${fmt(all)}</td></tr>`;
        }).join("")}</tbody>
      </table></div>
      <p class="legend-note">판정은 목표값 기준(최근 5R), 점수는 설정의 0점·100점 기준으로 바꾼 값입니다(오른쪽 육각형). 예전에는 두 표(실력 진단·육각형 기준)에 같은 지표가 따로 있었는데 하나로 합쳤습니다. 타수 지표는 18홀 라운드(${A.fulls.length}회), 나머지는 퍼트를 기록한 라운드(${A.dets.length}회) 기준.</p>
      <div class="grid g2" style="margin-top:12px">
        <div class="card"><h3 class="mt0">7영역 육각형 <span class="muted">최근 상세 5R vs 전체</span></h3><div class="chart-box tall"><canvas id="cRadar"></canvas></div>
          <p class="legend-note">초록: 최근 5라운드 · 파랑: 전체 평균 · 주황 점선: 목표선(${settings.radarTarget}점).</p></div>
        <div class="card"><h3 class="mt0">라운드당 타수 손실 <span class="muted">최근 상세 5R</span></h3><div class="chart-box tall"><canvas id="cLoss"></canvas></div>
          <p class="legend-note">항목끼리 일부 겹칩니다(벌타 홀은 더블+가 되기 쉬움). 크기 비교로 연습 순서를 정하는 용도입니다.</p></div>
      </div>
      <h2>먼저 볼 것</h2>
      <div class="card"><ul class="sw">
        ${lossTop ? `<li><span class="ng">1순위</span> 가장 많이 잃는 곳: ${lossTop.label} (최근 5R 라운드당 ${f1(lossTop.r5)}타)</li>` : ""}
        ${ngList.length ? `<li><span class="ng">목표 미달</span> ${ngList.join(", ")}</li>` : `<li><span class="ok">목표</span> 모든 지표 달성</li>`}
        ${A.tee.L + A.tee.R ? `<li><b>티샷 미스</b> 왼쪽(L·H) ${A.tee.L}회 / 오른쪽(R·S) ${A.tee.R}회${A.tee.R >= 2 * A.tee.L ? " → 오른쪽 쏠림(슬라이스 계열) 점검" : A.tee.L >= 2 * A.tee.R ? " → 왼쪽 쏠림(훅 계열) 점검" : ""}</li>` : ""}
        <li class="muted">파 유형·전후반 비교는 <a href="#/analysis/holes">분석 → 홀·파</a>에 있습니다.</li>
      </ul></div>
      <h2>타수 추이 <span class="muted">라운드별 · 최근 18홀 30라운드 (기간별 평균은 분석 → 스코어)</span></h2>
      <div class="card"><div class="chart-box tall"><canvas id="cTrend"></canvas></div></div>`;
    const rk = Object.keys(settings.radar);
    chart("cRadar", {
      type: "radar",
      data: {
        labels: rk.map((k) => settings.radar[k].label),
        datasets: [
          { label: "최근 5R", data: rk.map((k) => A.radar.score[k]), backgroundColor: "rgba(63,174,134,.22)", borderColor: "#3fae86", pointBackgroundColor: "#3fae86" },
          { label: "전체 평균", data: rk.map((k) => A.radarAll.score[k]), borderColor: "#7aa7f7", backgroundColor: "transparent", pointRadius: 2 },
          { label: "목표", data: rk.map(() => settings.radarTarget), borderColor: "#ffb27a", borderDash: [6, 4], backgroundColor: "transparent", pointRadius: 0 },
        ],
      },
      options: baseOpts({ plugins: legendOn, scales: { r: { min: 0, max: 100, ticks: { stepSize: 20, display: true, showLabelBackdrop: true, backdropColor: "rgba(255,255,255,.75)", color: "#8a93a6", font: { size: 10 } }, pointLabels: { font: { size: 13, weight: "600" } } } } }),
      plugins: [{
        id: "radarVals",
        afterDatasetsDraw(c) {
          const meta = c.getDatasetMeta(0), ctx = c.ctx;
          ctx.save(); ctx.font = "700 12px Pretendard, sans-serif"; ctx.fillStyle = "#3fae86"; ctx.textAlign = "center";
          meta.data.forEach((p, i) => { const v = c.data.datasets[0].data[i]; if (isNum(v)) ctx.fillText(v, p.x, p.y - 8); });
          ctx.restore();
        },
      }],
    });
    chart("cLoss", {
      type: "bar",
      data: { labels: A.loss.map((l) => l.label), datasets: [{ data: A.loss.map((l) => l.r5), backgroundColor: "#ff8f8f" }] },
      options: baseOpts({ indexAxis: "y", scales: { x: { beginAtZero: true, ...noGrid }, y: noGrid } }),
      plugins: [valueLabels(f1)],
    });
    const list = A.fulls.slice(0, 30).reverse(), all = A.fulls.slice().reverse();
    // 5라운드 이동평균: 이 라운드까지의 최근 5개(18홀) 평균. 점수 색은 이 값과 비교한다(높으면 빨강, 낮으면 파랑)
    const trendMA = list.map((r) => { const i = all.indexOf(r); return S.avg(all.slice(Math.max(0, i - 4), i + 1).map((x) => x.strokes)); });
    chart("cTrend", {
      type: "line",
      data: {
        labels: list.map((r) => r.date.slice(2).replaceAll("-", ".")),
        datasets: [
          { label: "총타수", data: list.map((r) => r.strokes), borderColor: "#ff8f8f", backgroundColor: "#ff8f8f", borderDash: [6, 4], pointRadius: 2.5, pointHoverRadius: 5, tension: 0 },
          { label: "5R 이동평균", data: trendMA, borderColor: "#7aa7f7", pointRadius: 0, tension: 0.2, noLabels: true },
        ],
      },
      options: baseOpts({ plugins: legendOn, scales: { y: { suggestedMin: 75, suggestedMax: 110 }, x: noGrid } }),
      plugins: [valueLabels((v) => v, (v, j, ds) => (ds.label !== "총타수" ? null : v > trendMA[j] ? UP : v < trendMA[j] ? DOWN : null))],
    });
  }

  // ───────────── 라운드 입력 (v2 스코어카드 전 항목) ─────────────
  // [키, 라벨, 종류, 옵션]
  const FIELDS = [
    ["기본", [["par", "Par", "sel", [3, 4, 5, 6]], ["score", "Score (+/-)", "sel", [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8]], ["putts", "Putts", "sel", [0, 1, 2, 3, 4, 5]], ["pen", "벌타", "sel", [0, 1, 2, 3, 4]]]],
    ["코스 정보", [["dist", "거리 (m)", "num"], ["hcp", "핸디캡", "sel", Array.from({ length: 18 }, (_, i) => i + 1)]]],
    ["티샷", [["miss", "티샷 결과", "sel", ["-", "L", "R", "H", "S"]], ["drive", "티샷 거리 (m)", "num"]]],
    ["그린", [["fp", "1st 퍼트 거리 (m)", "num"]]],
    ["숏게임", [["gmiss", "그린 미스", "sel", ["짧음", "길음", "좌", "우", "-"]], ["appr", "어프로치 거리 (m)", "num"], ["bunker", "벙커샷 수", "sel", [0, 1, 2, 3, 4]]]],
    ["메모", [["memo", "메모", "text"]]],
  ];
  const FLAT = FIELDS.flatMap(([, fs]) => fs);
  const TEE_ONLY = new Set(["fw", "miss"]);   // 파4·파5 티샷에만 해당하는 칸(티샷 거리는 파3도 적되 드라이버 평균에서는 뺀다)
  // 홀 표시: 파3은 짧은 홀 '.', 파5는 긴 홀 '-' (파4는 표시 없음)
  const parMark = (p) => (p === 3 ? `<em class="pb p3" title="파3(짧은 홀)">.</em>` : p === 5 ? `<em class="pb p5" title="파5(긴 홀)">-</em>` : "");
  const TEXT_KEYS = new Set(["miss", "gmiss", "memo"]);
  // 고르는 값의 표시 이름(저장 값은 golf-lounge와 같게 둔다: FW 안착은 "-" → FW ○ 자동)
  const OPT_LABEL = { miss: { "-": "FW 안착", L: "L 왼쪽", R: "R 오른쪽", H: "H 훅", S: "S 슬라이스" } };
  const HINT = {
    dist: "실제로 친 티 기준(m)",
    drive: "파3도 적어 두세요(드라이버 평균에는 파4·파5만)",
    score: "파=0, 보기=1, 더블=2, 버디=-1", miss: "파4·파5만. FW에 떨어졌으면 「FW 안착」, 아니면 놓친 방향(FW ○/×는 자동)",
    ong: "그린에 올라가기까지 친 타수(벌타 포함). 비우면 타수−퍼트로 계산", sg: "자동: 그린 놓친 홀에서 1퍼트로 막았거나 첫 퍼트 2m 이내면 ○",
    gmiss: "그린을 놓친 방향", appr: "그린을 놓쳤을 때 핀까지 남은 거리",
  };

  function inputView(id) {
    const edit = id ? rounds.find((r) => r.id === id) : null;
    if (id && !edit) { app.innerHTML = `<p>라운드를 찾을 수 없습니다. <a href="#/rounds">목록으로</a></p>`; return; }
    const draftKey = KEY_DRAFT + (edit ? ":" + edit.id : ":new");
    const draft = ls.get(draftKey);
    const base = edit ? structuredClone(edit) : { date: new Date().toISOString().slice(0, 10), course: "", front: "", back: "", tee: "White", region: "", memo: "", holes: [] };
    let r = draft && draft.holes ? draft : base;
    const H = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, { h: i + 1 }]));
    (r.holes || []).forEach((h) => (H[h.h] = { ...h }));
    let cur = 1;

    /* ── 자동 입력: 위에서 적은 값으로 아래 칸을 채운다 ──
     * AUTO[홀]은 자동으로 채운 칸 이름 모음. 사용자가 그 칸을 직접 바꾸면 빠지고(직접 입력이 우선),
     * 남아 있는 자동 칸은 Score·Putts 등이 바뀔 때마다 다시 계산한다. 이 표시는 저장하지 않는다. */
    const AUTO = Object.fromEntries(Object.keys(H).map((n) => [n, new Set()]));
    function derive(h) {
      const out = {};
      const known = isNum(h.par) && isNum(h.score);
      if (known && isNum(h.putts) && h.par + h.score - h.putts >= 1) out.ong = h.par + h.score - h.putts;
      if (isNum(h.par) && h.par > 3) {
        const m = String(h.miss || "").toUpperCase();
        if (["L", "R", "H", "S"].includes(m)) out.fw = 0;
        else if (m === "-") out.fw = 1;
        if (h.fw === 1 && !AUTO[h.h]?.has("fw")) out.miss = "-";
      }
      const ongManual = isNum(h.ong) && !AUTO[h.h]?.has("ong");
      const g = S.holeGir({ ...h, ong: ongManual ? h.ong : out.ong });
      if (g === 1) { out.gmiss = "-"; out.sg = null; }
      if (g === 0 && isNum(h.putts)) out.sg = h.putts <= 1 || (isNum(h.fp) && h.fp > 0 && h.fp <= 2) ? 1 : 0;
      if (isNum(h.score)) out.pen = 0;
      return out;   // null = 비워야 함(해당 없음)
    }
    function autoFill(n) {
      let any = false;
      for (let i = 0; i < 4 && autoFillOnce(n); i++) any = true;
      return any;
    }
    function autoFillOnce(n) {
      const h = H[n], set = AUTO[n];
      let changed = false;
      for (const [k, v] of Object.entries(derive(h))) {
        const manual = h[k] !== undefined && !set.has(k);
        if (manual) continue;
        if (v === null) { if (set.has(k)) { delete h[k]; set.delete(k); changed = true; } continue; }
        if (h[k] !== v) { h[k] = v; changed = true; }
        set.add(k);
      }
      // 근거가 사라진 자동 칸은 지운다(예: Putts를 지우면 온그린 타수도 비움)
      const d = derive(h);
      for (const k of [...set]) if (!(k in d)) { delete h[k]; set.delete(k); changed = true; }
      return changed;
    }
    // 불러온 기록: 저장된 값이 계산값과 같으면 자동 칸으로 본다(나중에 Score를 고치면 같이 바뀌도록)
    for (const n of Object.keys(H)) {
      const d = derive(H[n]);
      for (const [k, v] of Object.entries(d)) if (v !== null && H[n][k] === v) AUTO[n].add(k);
    }
    const courses = [...new Set(rounds.map((x) => x.course))].sort();
    const tees = [...new Set(["White", "Blue", "Black", "Red", "Gold", ...rounds.map((x) => x.tee).filter(Boolean)])];

    app.innerHTML = `
      <h2>${edit ? "라운드 수정" : "라운드 입력"}</h2>
      ${G.canWrite() ? "" : `<div class="notice">지금은 <b>읽기 전용</b>입니다. 저장하려면 <a href="#/settings">설정</a>에서 GitHub 토큰을 넣어 주세요. 입력 내용은 이 기기에 임시 저장됩니다.</div>`}
      ${draft ? `<div class="notice" style="margin-top:8px">이전에 입력하던 내용을 불러왔습니다. <button class="link" id="bDiscard" type="button">버리고 새로 시작</button></div>` : ""}
      <div class="card" style="margin-top:12px">
        <div class="form">
          <label class="f">날짜<input id="fDate" type="date" value="${esc(r.date)}"></label>
          <label class="f">골프장<input id="fCourse" list="courseList" value="${esc(r.course)}" placeholder="예: 기흥CC"></label>
          <label class="f">전반 코스<input id="fFront" value="${esc(r.front)}" placeholder="예: NORTH"></label>
          <label class="f">후반 코스<input id="fBack" value="${esc(r.back)}" placeholder="예: WEST"></label>
          <label class="f">티<input id="fTee" list="teeList" value="${esc(r.tee || "")}"></label>
          <label class="f">지역<select id="fRegion"><option value="">선택</option>${Regions.NAMES.map((n) => `<option ${n === (r.region || Regions.suggest(r.course, rounds)) ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          <label class="f">날씨·컨디션·메모<input id="fMemo" value="${esc(r.memo)}"></label>
        </div>
        <datalist id="courseList">${courses.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
        <datalist id="teeList">${tees.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
        <div class="row" style="margin-top:10px"><button class="btn ghost" id="bCourse" type="button">이전 라운드 코스 정보 불러오기 (Par·거리·핸디캡)</button></div>
      </div>

      <div class="holenav" id="holeNav"></div>
      <div class="card holecard" id="holeCard"></div>
      <div class="row" style="margin-top:10px;justify-content:space-between">
        <button class="btn ghost" id="bPrev" type="button">◀ 이전 홀</button>
        <button class="btn ghost" id="bNext" type="button">다음 홀 ▶</button>
      </div>

      <h3>스코어카드 미리보기</h3>
      <div id="preview"></div>
      <div class="totals" id="totals"></div>
      <div class="row" style="margin-top:14px">
        <button class="btn" id="bSave" type="button" ${G.canWrite() ? "" : "disabled"}>GitHub에 저장</button>
        <a class="btn ghost" href="${edit ? "#/round/" + encodeURIComponent(edit.id) : "#/rounds"}">취소</a>
      </div>
      <p class="legend-note">중간에 저장해도 됩니다. 나중에 「수정」으로 이어서 입력할 수 있습니다.</p>`;

    const $ = (s) => document.getElementById(s);
    const meta = () => ({ date: $("fDate").value, course: $("fCourse").value.trim(), front: $("fFront").value.trim(), back: $("fBack").value.trim(), tee: $("fTee").value.trim(), region: $("fRegion").value, memo: $("fMemo").value.trim() });
    const holesArr = () => Object.values(H).map((h) => Object.fromEntries(Object.entries(h).filter(([, v]) => v !== "" && v !== null && v !== undefined))).filter((h) => Object.keys(h).length > 1);
    const saveDraft = () => ls.set(draftKey, { ...meta(), id: edit?.id, holes: holesArr() });

    function field([k, lab, type, opts]) {
      const v = H[cur][k];
      // 파3은 드라이버 티샷이 없어 FW 안착·티샷 미스·티샷 거리가 해당 없다 → '-'로 잠근다
      if (TEE_ONLY.has(k) && H[cur].par === 3) return `<label class="f na">${lab}<select disabled><option>해당 없음</option></select><span class="hint">파3은 드라이버 티샷이 없음</span></label>`;
      const dis = "";
      // 그린에 올렸으면(GIR) 그린 미스 방향은 해당 없음 — 온그린 타수는 타수−퍼트로 자동 계산된다
      if (k === "gmiss" && S.holeGir(H[cur]) === 1) return `<label class="f na">${lab}<select disabled><option>해당 없음</option></select><span class="hint">GIR 성공 홀</span></label>`;
      let ctl;
      if (type === "sel") ctl = `<select data-k="${k}" ${dis}><option value=""></option>${opts.map((o) => `<option value="${o}" ${String(v) === String(o) ? "selected" : ""}>${OPT_LABEL[k]?.[o] ?? (typeof o === "number" && o > 0 && k === "score" ? "+" + o : o)}</option>`).join("")}</select>`;
      else if (type === "ox") ctl = `<select data-k="${k}" ${dis}><option value=""></option><option value="1" ${v === 1 ? "selected" : ""}>○</option><option value="0" ${v === 0 ? "selected" : ""}>×</option></select>`;
      else if (type === "num") ctl = `<input data-k="${k}" type="number" inputmode="decimal" step="0.5" min="0" value="${v ?? ""}">`;
      else ctl = `<input data-k="${k}" value="${esc(v ?? "")}">`;
      const auto = AUTO[cur].has(k) && v !== undefined;
      return `<label class="f ${k === "score" ? "key" : ""} ${k === "memo" ? "wide" : ""} ${auto ? "auto" : ""}">${lab}${auto ? ` <span class="autotag">자동</span>` : ""}${ctl}${HINT[k] ? `<span class="hint">${HINT[k]}</span>` : ""}</label>`;
    }
    function drawCard() {
      const h = H[cur];
      const gir = S.holeGir(h);
      $("holeCard").innerHTML = `
        <div class="row" style="justify-content:space-between;align-items:baseline">
          <div class="hc-title">${cur}번 홀 <span class="muted">${cur <= 9 ? "전반" : "후반"}</span></div>
          <div class="muted">${isNum(h.par) && isNum(h.score) ? `타수 <b>${h.par + h.score}</b>` : ""} ${gir === null ? "" : `· GIR ${gir ? "○" : "×"}`} ${S.holeCheck(h) ? `<span class="ng"> · 온그린+퍼트 ≠ 타수</span>` : ""}</div>
        </div>
        ${(() => {
          const p = Clubs.plan(h.par, h.dist, Clubs.bag(settings));
          if (p) return `<div class="plan">🏌️ <b>공략 가이드</b> <span class="muted">(추정)</span> ${p.text}</div>`;
          return isNum(h.par) ? `<div class="plan muted">거리를 넣으면 내 클럽 거리로 공략 가이드가 나옵니다</div>` : "";
        })()}
        ${FIELDS.map(([g, fs]) => `<div class="fgroup"><div class="fg-title">${g}</div><div class="form">${fs.map(field).join("")}</div></div>`).join("")}`;
      $("holeCard").querySelectorAll("[data-k]").forEach((el) => {
        el.addEventListener("change", () => {
          const k = el.dataset.k;
          const raw = el.value;
          H[cur][k] = raw === "" ? undefined : TEXT_KEYS.has(k) ? raw.trim() : k === "dist" || k === "drive" ? Math.round(Number(raw)) : Number(raw);
          AUTO[cur].delete(k);   // 직접 고친 칸은 자동 계산 대상에서 뺀다
          if (k === "par" && H[cur].par === 3) for (const t of TEE_ONLY) { delete H[cur][t]; AUTO[cur].delete(t); }
          const filled = autoFill(cur);
          saveDraft();
          drawAll(k === "par" || filled);
        });
      });
    }
    function drawNav() {
      $("holeNav").innerHTML = Array.from({ length: 18 }, (_, i) => {
        const h = H[i + 1];
        const s = h.score;
        const cls = isNum(s) ? (s <= -1 ? "sc-m2" : s === 0 ? "sc-0" : s === 1 ? "sc-1" : s === 2 ? "sc-2" : "sc-3") : "";
        const pb = parMark(h.par);
        return `<button type="button" class="hn-btn ${cls} ${i + 1 === cur ? "cur" : ""}" data-h="${i + 1}">${pb}<span>${i + 1}</span><small>${isNum(s) ? (s > 0 ? "+" + s : s) : "·"}</small></button>`;
      }).join("");
      $("holeNav").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { cur = Number(b.dataset.h); drawAll(true); }));
    }
    function drawPreview() {
      $("preview").innerHTML = scorecard({ holes: holesArr() }, true);
      const st = S.round({ date: meta().date, holes: holesArr() });
      $("totals").innerHTML = `<span>입력 홀 <b>${st.holes}</b></span><span>총타수 <b>${st.strokes ?? "-"}</b></span><span>오버 <b>${sgn(st.over, 0)}</b></span>
        ${st.detail ? `<span>퍼트 <b>${st.putts}</b></span><span>GIR <b>${st.gir}</b></span><span>3퍼트 <b>${st.p3}</b></span>` : ""}<span>더블+ <b>${st.dbl}</b></span>
        ${st.checks.length ? `<span class="ng">기록 확인: ${st.checks.join(", ")}번 홀</span>` : ""}`;
    }
    function drawAll(card = true) { drawNav(); if (card) drawCard(); drawPreview(); }
    drawAll();
    ["fDate", "fCourse", "fFront", "fBack", "fTee", "fRegion", "fMemo"].forEach((x) => $(x).addEventListener("input", saveDraft));
    // 골프장을 바꾸면 지역을 그 골프장의 최근 지역으로 맞춘다. 지역을 직접 고른 뒤에는 건드리지 않는다.
    let regionTouched = !!r.region;
    $("fRegion").addEventListener("change", () => (regionTouched = true));
    $("fCourse").addEventListener("input", () => {
      if (regionTouched) return;
      $("fRegion").value = Regions.suggest($("fCourse").value.trim(), rounds);
      saveDraft();
    });
    $("bPrev").onclick = () => { cur = cur === 1 ? 18 : cur - 1; drawAll(); };
    $("bNext").onclick = () => { cur = cur === 18 ? 1 : cur + 1; drawAll(); };
    if ($("bDiscard")) $("bDiscard").onclick = () => { ls.del(draftKey); inputView(id); };
    $("bCourse").onclick = () => {
      const m = meta();
      const prev = S.byRecent(rounds.filter((x) => x.course === m.course && x.id !== edit?.id));
      if (!prev.length) return toast("같은 골프장 이전 기록이 없습니다.");
      const norm = (t) => String(t || "").trim().toLowerCase();
      // 9홀 정보 찾기: 코스명이 전반·후반 어느 쪽에 있었든 같은 코스명의 9홀을 쓴다.
      // 코스명을 적었는데 같은 코스 기록이 없으면 다른 코스 값을 쓰지 않는다(엉뚱한 Par가 들어가지 않게).
      const nine = (list, name, front) => {
        for (const p of list) {
          if (name && p.front === name) return { p, holes: p.holes.filter((h) => h.h <= 9) };
          if (name && p.back === name) return { p, holes: p.holes.filter((h) => h.h > 9) };
        }
        if (name || !list.length) return null;
        return { p: list[0], holes: list[0].holes.filter((h) => (front ? h.h <= 9 : h.h > 9)) };
      };
      const fill = (src, start, keys) => {
        if (!src) return 0;
        let n = 0;
        src.holes.slice().sort((a, b) => a.h - b.h).forEach((h, i) => {
          const t = H[start + i];
          if (!t) return;
          for (const k of keys) if (isNum(h[k]) && !isNum(t[k])) { t[k] = h[k]; n++; }
        });
        return n;
      };
      // Par·핸디캡은 티와 상관없이 같고, 거리는 티마다 달라 '같은 티'로 친 기록에서만 가져온다
      const sameTee = prev.filter((p) => norm(p.tee) && norm(p.tee) === norm(m.tee));
      const pf = nine(prev, m.front, true), pb = nine(prev, m.back, false);
      const df = nine(sameTee, m.front, true), db = nine(sameTee, m.back, false);
      const nPar = fill(pf, 1, ["par", "hcp"]) + fill(pb, 10, ["par", "hcp"]);
      const nDist = fill(df, 1, ["dist"]) + fill(db, 10, ["dist"]);
      saveDraft();
      drawAll();
      const src = [pf, pb].filter(Boolean).map((x) => dot(x.p.date));
      toast((nPar ? `Par·핸디캡: ${[...new Set(src)].join(", ")} 기록에서 불러왔습니다.` : "같은 코스명의 이전 기록이 없어 Par·핸디캡을 채우지 못했습니다.")
        + "\n" + (nDist ? `거리: 같은 티(${m.tee})로 친 기록에서 불러왔습니다.` : `거리: ${m.tee ? `같은 티(${m.tee})로 친` : "티를 적은"} 기록이 없어 비워 두었습니다. 스코어카드의 ${m.tee || "친 티"} 거리를 넣어 주세요.`), 6000);
    };
    $("bSave").onclick = async () => {
      const m = meta();
      const hs = holesArr();
      if (!m.date || !m.course) return toast("날짜와 골프장을 입력하세요.");
      if (!hs.some((h) => isNum(h.score))) return toast("스코어를 한 홀 이상 입력하세요.");
      // 수정할 때 입력 화면에 없는 값(티오프 시간 등)은 그대로 둔다
      const obj = { ...(edit || {}), id: edit ? edit.id : "r" + m.date.replaceAll("-", "") + "-" + Date.now().toString(36), ...m, holes: hs };
      $("bSave").disabled = true;
      $("bSave").textContent = "저장 중…";
      try {
        await commit((data) => {
          const i = data.findIndex((x) => x.id === obj.id);
          if (i >= 0) data[i] = obj; else data.push(obj);
          return data.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        }, `${edit ? "라운드 수정" : "라운드 추가"}: ${m.date} ${m.course}`);
        ls.del(draftKey);
        toast("GitHub에 저장했습니다.");
        location.hash = "#/round/" + encodeURIComponent(obj.id);
      } catch (e) {
        toast(e.message, 6000);
        $("bSave").disabled = false;
        $("bSave").textContent = "GitHub에 저장";
      }
    };
  }

  // v2 「스코어카드」와 같은 행 구성
  const CARD_ROWS = [["dist", "거리 (m)", "sum"], ["hcp", "핸디캡"], ["par", "Par", "sum"], ["score", "Score (+/-)", "sum"], ["tee", "티샷", "tee"], ["drive", "티샷 거리 (m)", "avg"], ["gir", "GIR"], ["putts", "Putts", "sum"], ["fp", "1st 퍼트 (m)"], ["gmiss", "그린 미스"], ["appr", "어프로치 (m)"], ["bunker", "벙커샷", "sum"], ["sg", "숏게임"], ["pen", "벌타", "sum"], ["memo", "메모"]];
  function scorecard(r, compact) {
    const hm = Object.fromEntries((r.holes || []).map((h) => [h.h, h]));
    const used = new Set(r.holes.flatMap((h) => Object.keys(h)));
    used.add("par"); used.add("score"); used.add("gir");
    if (used.has("fw") || used.has("miss")) used.add("tee");
    const rowsUsed = compact ? CARD_ROWS.filter(([k]) => used.has(k)) : CARD_ROWS;
    const cell = (h, k) => {
      const x = hm[h] || {};
      const v = x[k];
      if (k === "par" && (v === 3 || v === 5)) return `<td class="pc p${v}">${v}</td>`;
      if (TEE_ONLY.has(k) && x.par === 3) return `<td class="na" title="파3 해당 없음"></td>`;
      if (k === "score" && isNum(v)) return `<td class="sc-cell ${v <= -1 ? "sc-m2" : v === 0 ? "sc-0" : v === 1 ? "sc-1" : v === 2 ? "sc-2" : "sc-3"}">${v > 0 ? "+" + v : v}</td>`;
      // 티샷: FW ○, 놓쳤으면 방향(L/R/H/S), 방향 없이 놓쳤으면 ×
      if (k === "tee") { const m = String(x.miss || "").toUpperCase(); return `<td>${x.fw === 1 || m === "-" ? "○" : ["L", "R", "H", "S"].includes(m) ? m : x.fw === 0 ? "×" : ""}</td>`; }
      if (k === "gir") { const g = hm[h] ? S.holeGir(x) : null; return `<td>${g === null ? "" : g ? "○" : "×"}</td>`; }
      if (k === "fw" || k === "sg") return `<td>${v === 1 ? "○" : v === 0 ? "×" : ""}</td>`;
      if (k === "memo") return `<td class="memo">${esc(v ?? "")}</td>`;
      return `<td>${esc(v ?? "")}</td>`;
    };
    const tot = (a, k, how) => {
      const xs = Array.from({ length: 9 }, (_, i) => hm[a + i]?.[k]);
      if (how === "sum") { const n = xs.filter(isNum); return n.length ? S.sum(n) : ""; }
      // 티샷 거리 평균은 드라이버를 치는 파4·파5만(파3 아이언 티샷은 뺀다)
      if (how === "avg") { const n = Array.from({ length: 9 }, (_, i) => hm[a + i]).filter((h) => h && isNum(h.drive) && h.drive > 0 && (!isNum(h.par) || h.par > 3)).map((h) => h.drive); return n.length ? `평균 ${Math.round(S.avg(n))}` : ""; }
      if (how === "tee") { const n = Array.from({ length: 9 }, (_, i) => hm[a + i]).filter((x) => x && (isNum(x.fw) || x.miss)).map((x) => (x.fw === 1 || x.miss === "-" ? 1 : 0)); return n.length ? `${S.sum(n)}/${n.length}` : ""; }
      if (how === "fw") { const n = xs.filter(isNum); return n.length ? `${n.filter((v) => v === 1).length}/${n.length}` : ""; }
      if (k === "gir") { const g = Array.from({ length: 9 }, (_, i) => (hm[a + i] ? S.holeGir(hm[a + i]) : null)).filter((v) => v !== null); return g.length ? `${S.sum(g)}/${g.length}` : ""; }
      return "";
    };
    const half = (a, name) => `<div class="tbl-wrap card-tbl" style="margin-top:8px"><table>
      <thead><tr><th class="l">${name}</th>${Array.from({ length: 9 }, (_, i) => { const p = hm[a + i]?.par; return `<th>${parMark(p)}${a + i}</th>`; }).join("")}<th>${a === 1 ? "OUT" : "IN"}</th></tr></thead>
      <tbody>${rowsUsed.map(([k, lab, how]) => `<tr><th class="l">${lab}</th>${Array.from({ length: 9 }, (_, i) => cell(a + i, k)).join("")}<td><b>${tot(a, k, how || (k === "gir" ? "gir" : ""))}</b></td></tr>`).join("")}</tbody></table></div>`;
    return half(1, "전반") + half(10, "후반");
  }

  // ───────────── 동반자·사진 ─────────────
  // 가려진 이름(홍*동) → 내가 고친 이름. 이 기기에만 기억한다(공개 저장소에는 올리지 않음).
  const KEY_ALIAS = KEY_DRAFT.split(".")[0] + ".alias.v1";
  const parsOf = (r) => Object.fromEntries((r.holes || []).filter((h) => isNum(h.par)).map((h) => [h.h, h.par]));
  function applyAlias(list) {
    const al = ls.get(KEY_ALIAS) || {};
    list.forEach((c) => {
      c.orig = c.name;
      if (al[c.name]) { c.name = al[c.name]; c.warnings = (c.warnings || []).filter((w) => !w.startsWith("이름에")); }
    });
    return list;
  }
  // 저장할 모양: 홀 기록이 있으면 홀만(합계는 계산), 없으면 적은 점수만
  function cleanComp(c) {
    const o = { name: c.name.trim() };
    if (c.holes && c.holes.length) o.holes = c.holes.map(({ h, st }) => ({ h, st }));
    else for (const k of ["front", "back", "total"]) if (isNum(c[k])) o[k] = c[k];
    return o;
  }
  const compProblem = (st) => {
    if (st.comps.some((c) => !c.name.trim())) return "이름이 빈 동반자가 있습니다.";
    if (st.comps.some((c) => c.name.includes("*"))) return "이름 가운데 *가 있는 동반자가 있습니다. 이름을 고쳐 주세요.";
    if (new Set(st.comps.map((c) => c.name.trim())).size !== st.comps.length) return "같은 이름의 동반자가 두 번 있습니다.";
    return "";
  };
  const newEditState = (r) => ({ comps: structuredClone(r.companions || []), photos: (r.photos || []).map((path) => ({ path })), removed: [], text: "" });

  // 라운드 상세의 동반자 비교: 순위표 + (홀 기록이 있으면) 홀별 비교·홀 매치
  function companionCompare(r) {
    const comps = r.companions || [];
    if (!comps.length) return "";
    const pars = parsOf(r), me = S.round(r);
    const myHm = Object.fromEntries((r.holes || []).filter((h) => isNum(h.par) && isNum(h.score)).map((h) => [h.h, h.par + h.score]));
    const P = [{ name: "나", me: true, hm: myHm, front: me.front ?? null, back: me.back ?? null, total: me.full ? me.strokes : null, over: me.full ? me.over : null },
      ...comps.map((c) => ({ name: c.name, ...Companions.summary(c, pars) }))];
    const ranked = P.filter((p) => isNum(p.total)).map((p) => p.total).sort((a, b) => a - b);
    const rank = (p) => (isNum(p.total) ? ranked.indexOf(p.total) + 1 : "-");
    const diff = (p) => {
      if (p.me || !isNum(p.total) || !isNum(P[0].total)) return "";
      const d = p.total - P[0].total;
      return d > 0 ? `<span class="ok">내가 ${d}타 앞섬</span>` : d < 0 ? `<span class="ng">${-d}타 뒤짐</span>` : "동타";
    };
    let html = `<div class="tbl-wrap"><table><thead><tr><th>순위</th><th class="l">이름</th><th>전반</th><th>후반</th><th>총타수</th><th>오버</th><th class="l">나와 비교</th></tr></thead>
      <tbody>${[...P].sort((a, b) => (isNum(a.total) ? a.total : 999) - (isNum(b.total) ? b.total : 999)).map((p) => `<tr${p.me ? ` class="me-row"` : ""}><td>${rank(p)}</td><td class="l"><b>${esc(p.name)}</b></td><td>${p.front ?? "-"}</td><td>${p.back ?? "-"}</td><td><b>${p.total ?? "-"}</b></td><td>${isNum(p.over) ? sgn(p.over, 0) : "-"}</td><td class="l">${diff(p)}</td></tr>`).join("")}</tbody></table></div>`;
    const withHoles = P.filter((p) => !p.me && Object.keys(p.hm).length);
    if (withHoles.length && Object.keys(myHm).length) {
      const rows = [P[0], ...withHoles];
      const half = (a, label) => `<div class="tbl-wrap card-tbl" style="margin-top:8px"><table><thead><tr><th class="l">${label}</th>${Array.from({ length: 9 }, (_, i) => `<th>${parMark(pars[a + i])}${a + i}</th>`).join("")}<th>${a === 1 ? "OUT" : "IN"}</th></tr></thead>
        <tbody><tr><th class="l">Par</th>${Array.from({ length: 9 }, (_, i) => `<td>${pars[a + i] ?? ""}</td>`).join("")}<td>${S.sum(Array.from({ length: 9 }, (_, i) => pars[a + i] || 0)) || ""}</td></tr>
        ${rows.map((p) => `<tr${p.me ? ` class="me-row"` : ""}><th class="l">${esc(p.name)}</th>${Array.from({ length: 9 }, (_, i) => {
          const h = a + i, v = p.hm[h], par = pars[h];
          if (!isNum(v)) return "<td></td>";
          const best = Math.min(...rows.map((q) => q.hm[h]).filter(isNum));
          const solo = rows.filter((q) => q.hm[h] === best).length === 1;
          const d = isNum(par) ? v - par : null;
          return `<td class="sc-cell ${d === null ? "" : d <= -1 ? "sc-m2" : d === 0 ? "sc-0" : d === 1 ? "sc-1" : d === 2 ? "sc-2" : "sc-3"}${v === best && solo ? " hw" : ""}" title="${v}타">${d === null ? v : d > 0 ? "+" + d : d}</td>`;
        }).join("")}<td><b>${(() => {
          const hs = Array.from({ length: 9 }, (_, i) => a + i);
          if (!hs.every((h) => isNum(p.hm[h]))) return "";
          const st = S.sum(hs.map((h) => p.hm[h]));
          if (!hs.every((h) => isNum(pars[h]))) return st;
          const ov = st - S.sum(hs.map((h) => pars[h]));
          return `${ov > 0 ? "+" + ov : ov}<br><span class="muted">${st}타</span>`;
        })()}</b></td></tr>`).join("")}</tbody></table></div>`;
      const match = withHoles.map((p) => {
        let w = 0, l = 0, t = 0;
        for (let h = 1; h <= 18; h++) { const a = myHm[h], b = p.hm[h]; if (!isNum(a) || !isNum(b)) continue; if (a < b) w++; else if (a > b) l++; else t++; }
        return `<span class="pill">vs ${esc(p.name)} · 이긴 홀 <b>${w}</b> / 비긴 홀 ${t} / 진 홀 <b>${l}</b></span>`;
      }).join(" ");
      html += half(1, "전반") + half(10, "후반") + `<p class="legend-note">숫자는 Par 대비(0 파 · +1 보기 · +2 더블 · -1 버디), OUT·IN은 Par 대비 합과 타수. 테두리 칸은 그 홀 단독 1등. ${match}</p>`;
    }
    return html;
  }

  /* 사진을 라운드 편집 상태(st)에 넣는다: 사진은 저장 목록에, 사진 속 「이름 숫자…」 줄은 동반자로 바로 추가.
   * 동반자로 못 읽은 글자는 붙여넣기 칸(st.text)에 남겨 직접 고치게 한다. 반환: 추가된 동반자 수 */
  async function photosIn(files, st, pars, msg, onChange = () => {}) {
    let added = 0, unread = 0;
    for (const [n, f] of files.entries()) {
      try {
        if (st.keep !== false) { st.photos.push(await Companions.shrink(f)); onChange(); }
        if (st.ocr === false) continue;
        if (msg) msg.innerHTML = `<div class="notice">사진 ${n + 1}/${files.length}에서 글자 읽는 중… <span data-p>0%</span> (처음에는 인식 데이터를 받느라 오래 걸릴 수 있음)</div>`;
        const text = await Companions.ocr(f, (s, p) => { const el = msg && msg.querySelector("[data-p]"); if (el) el.textContent = `${Math.round(p * 100)}%`; });
        const got = applyAlias(Companions.parse(text, pars, { skipScore: true }));
        for (const c of got) { const i = st.comps.findIndex((x) => x.name === c.name); if (i >= 0) st.comps[i] = c; else st.comps.push(c); }
        added += got.length;
        // 못 읽었거나 숫자가 의심스러우면 읽은 글자를 붙여넣기 칸에도 넣어, 고친 뒤 「읽어서 추가」로 덮어쓰게 한다
        if ((!got.length || got.some((c) => c.warnings.some((w) => w.includes("확인 필요") || w.includes("홀만")))) && text.trim()) { st.text = (st.text ? st.text + "\n" : "") + text; unread++; }
        onChange();
      } catch (err) { toast(err.message || String(err), 6000); }
    }
    if (msg) msg.innerHTML = st.ocr === false ? "" : `<div class="notice">${added ? `사진에서 동반자 <b>${added}명</b>을 읽어 넣었습니다. 이름(*)·숫자가 맞는지 확인해 주세요. ` : ""}${unread ? `읽은 글자를 「붙여넣기로 추가」 칸에도 넣었습니다. 틀린 숫자·이름을 고친 뒤 「읽어서 추가」를 누르면 같은 이름은 고친 값으로 바뀝니다.` : added ? "" : "사진에서 글자를 읽지 못했습니다. 동반자 점수를 직접 넣어 주세요."}</div>`;
    return added;
  }

  // 동반자 한 명의 18홀 타수 입력칸(전반·후반 두 줄). 칸 위에 Par를 보여 줘 타수로 적기 쉽게 한다.
  const hsumText = (sm) => `전반 <b>${sm.front ?? "-"}</b> · 후반 <b>${sm.back ?? "-"}</b> · 합계 <b>${sm.total ?? "-"}</b>${isNum(sm.over) ? ` (${sgn(sm.over, 0)})` : ""} · 입력 ${sm.holeCount}홀`;
  function holeGrid(c, i) {
    const hm = Object.fromEntries((c.holes || []).map((x) => [x.h, x.st]));
    const pars = holeGrid.pars || {};
    const half = (a, label) => `<div class="tbl-wrap card-tbl"><table class="hgrid"><thead><tr><th class="l">${label}</th>${Array.from({ length: 9 }, (_, k) => `<th>${a + k}${isNum(pars[a + k]) ? `<br><span class="muted">P${pars[a + k]}</span>` : ""}</th>`).join("")}</tr></thead>
      <tbody><tr><th class="l">타수</th>${Array.from({ length: 9 }, (_, k) => `<td><input data-hs="${i}" data-h="${a + k}" type="number" inputmode="numeric" min="1" max="15" value="${hm[a + k] ?? ""}"></td>`).join("")}</tr></tbody></table></div>`;
    return `<div class="hgrid-box"><div class="hgrid-head">✏️ <b>${esc(c.name) || "새 동반자"}</b> 홀별 타수 <span class="muted">(Par 대비가 아니라 친 타수 — 예: 파4 보기면 5)</span></div>
      ${half(1, "전반")}${half(10, "후반")}<p class="legend-note" data-hsum>${hsumText(Companions.summary(c, pars))}</p></div>`;
  }

  /* 동반자·사진 편집기. st = { comps, photos: [{path} | {dataUrl, b64}], removed: [지울 사진 경로], text: 붙여넣기 칸 }
   * 저장은 부르는 쪽에서 한다(라운드 상세는 바로, 붙여넣기 등록은 라운드를 등록할 때). */
  function companionEditor(box, st, pars, onChange = () => {}) {
    const changed = () => { onChange(); draw(); };
    function draw() {
      holeGrid.pars = pars;
      const bad = st.comps.some((c) => c.name.includes("*"));
      box.innerHTML = `
        <div class="tbl-wrap"><table><thead><tr><th class="l">이름(별명)</th><th>전반</th><th>후반</th><th>총타수</th><th>홀 기록</th><th></th></tr></thead>
        <tbody>${st.comps.length ? st.comps.map((c, i) => {
          const s = Companions.summary(c, pars), hasH = (c.holes || []).length > 0;
          const warn = (c.warnings || []).filter((w) => !w.startsWith("이름에"));
          return `<tr><td class="l"><input data-cn="${i}" value="${esc(c.name)}" placeholder="예: 철수, A" class="${c.name.includes("*") || !c.name.trim() ? "warn" : ""}" style="width:130px">${c.orig && c.orig !== c.name ? `<br><span class="muted">원문 ${esc(c.orig)}</span>` : ""}${warn.length ? `<br><span class="ng">${esc(warn.join(" / "))}</span>` : ""}</td>
            ${["front", "back", "total"].map((k) => (hasH ? `<td>${s[k] ?? "-"}</td>` : `<td><input data-cv="${i}" data-k="${k}" type="number" inputmode="numeric" value="${isNum(c[k]) ? c[k] : ""}" style="width:64px"></td>`)).join("")}
            <td>${hasH ? s.holeCount + "홀" : "-"}<br><button class="link" data-hopen="${i}" type="button">${st.openH === i ? "입력 닫기" : hasH ? "홀 점수 수정" : "홀 점수 입력"}</button></td><td><button class="link" data-cdel="${i}" type="button">삭제</button></td></tr>`;
        }).join("") : `<tr><td colspan="6" class="muted">아직 동반자가 없습니다.</td></tr>`}</tbody></table></div>
        <p class="legend-note${bad ? " ng" : ""}">${bad ? "이름 가운데 <b>*</b>가 있는 동반자는 이름을 고쳐 주세요. " : ""}저장소가 공개라 실명 대신 <b>별명·이니셜</b>을 권장합니다. *가 있던 이름을 고치면 이 기기에 기억해 두었다가 다음 붙여넣기 때 자동으로 바꿉니다.</p>
        ${isNum(st.openH) && st.comps[st.openH] ? holeGrid(st.comps[st.openH], st.openH) : ""}
        <div class="row" style="margin-top:6px"><button class="btn ghost" data-act="addH" type="button">+ 홀별로 직접 추가</button><button class="btn ghost" data-act="add" type="button">+ 스코어만 추가</button></div>
        <h4>붙여넣기로 추가</h4>
        <textarea class="pastebox small" data-act="text" placeholder="한 줄에 한 명. 예)&#10;철수 85&#10;영희 42 45&#10;홍*동 5 4 6 5 4 5 3 5 6 4 5 4 6 5 4 3 5 6&#10;(타수 또는 +/-, 끝에 합계 칸이 있어도 됩니다)">${esc(st.text)}</textarea>
        <div class="row" style="margin-top:6px"><button class="btn ghost" data-act="parse" type="button">읽어서 추가</button></div>
        <h4>사진</h4>
        <div class="row"><label class="btn ghost filebtn">📷 사진 선택<input type="file" accept="image/*" multiple data-act="file" hidden></label>
          <label class="chk"><input type="checkbox" data-act="ocr" ${st.ocr === false ? "" : "checked"}> 사진에서 점수 읽기</label>
          <label class="chk"><input type="checkbox" data-act="keep" ${st.keep === false ? "" : "checked"}> 라운드에 사진 저장</label></div>
        <p class="legend-note">점수 읽기는 사진 속 글자를 <b>이 기기에서</b> 읽어 동반자 「이름·점수」를 바로 넣습니다(처음 한 번 인식 데이터를 받느라 시간이 걸림). 손글씨·흐린 사진은 틀리기 쉬우니 숫자를 확인하고, 이상하면 읽은 글이 들어간 붙여넣기 칸을 고쳐 「읽어서 추가」를 누르세요. 저장한 사진은 공개 저장소에 올라가며, 촬영 위치 등 사진 속 정보는 지우고 올립니다.</p>
        <div class="ocr-msg" data-act="msg"></div>
        ${st.photos.length ? `<div class="photos">${st.photos.map((p, i) => `<div class="ph"><img src="${p.dataUrl || G.rawUrl(p.path)}" alt="사진 ${i + 1}">${p.dataUrl ? `<span class="ph-new">저장 전</span>` : ""}<button type="button" class="ph-x" data-pdel="${i}" aria-label="사진 빼기">✕</button></div>`).join("")}</div>` : ""}`;
      const q = (s) => box.querySelector(s);
      box.querySelectorAll("[data-cn]").forEach((el) => (el.onchange = () => {
        const c = st.comps[el.dataset.cn], v = el.value.trim();
        c.name = v;
        if (c.orig && c.orig.includes("*") && v && !v.includes("*")) { const al = ls.get(KEY_ALIAS) || {}; al[c.orig] = v; ls.set(KEY_ALIAS, al); }
        changed();
      }));
      box.querySelectorAll("[data-cv]").forEach((el) => (el.onchange = () => { st.comps[el.dataset.cv][el.dataset.k] = el.value === "" ? null : Number(el.value); onChange(); }));
      box.querySelectorAll("[data-cdel]").forEach((el) => (el.onclick = () => { st.comps.splice(Number(el.dataset.cdel), 1); changed(); }));
      box.querySelectorAll("[data-pdel]").forEach((el) => (el.onclick = () => { const [p] = st.photos.splice(Number(el.dataset.pdel), 1); if (p.path) st.removed.push(p.path); changed(); }));
      q('[data-act="addH"]').onclick = () => { st.comps.push({ name: "", front: null, back: null, total: null, holes: [] }); st.openH = st.comps.length - 1; changed(); setTimeout(() => box.querySelector(`[data-cn="${st.openH}"]`)?.focus(), 0); };
      box.querySelectorAll("[data-hopen]").forEach((b) => (b.onclick = () => { const i = Number(b.dataset.hopen); st.openH = st.openH === i ? null : i; draw(); }));
      // 홀 점수 칸: 입력할 때마다 기록만 바꾸고 합계 글자만 고친다(다시 그리면 입력 중인 칸의 커서가 사라짐)
      box.querySelectorAll("[data-hs]").forEach((el) => (el.oninput = () => {
        const c = st.comps[Number(el.dataset.hs)], h = Number(el.dataset.h), v = el.value === "" ? null : Number(el.value);
        c.holes = (c.holes || []).filter((x) => x.h !== h);
        if (isNum(v) && v > 0) c.holes.push({ h, st: v });
        c.holes.sort((a, b) => a.h - b.h);
        c.warnings = (c.warnings || []).filter((w) => w.startsWith("이름"));
        const sm = Companions.summary(c, pars);
        const t = box.querySelector("[data-hsum]");
        if (t) t.innerHTML = hsumText(sm);
        el.classList.toggle("warn", isNum(v) && (v < 1 || v > 15));
        onChange();
      }));
      q('[data-act="add"]').onclick = () => { st.comps.push({ name: "", front: null, back: null, total: null, holes: [] }); changed(); };
      q('[data-act="text"]').oninput = (e) => (st.text = e.target.value);
      q('[data-act="ocr"]').onchange = (e) => (st.ocr = e.target.checked);
      q('[data-act="keep"]').onchange = (e) => (st.keep = e.target.checked);
      q('[data-act="parse"]').onclick = () => {
        const got = applyAlias(Companions.parse(st.text, pars));
        if (!got.length) { toast("동반자 점수를 찾지 못했습니다. '이름 점수' 모양으로 적어 주세요."); return; }
        for (const c of got) { const i = st.comps.findIndex((x) => x.name === c.name); if (i >= 0) st.comps[i] = c; else st.comps.push(c); }
        st.text = "";
        toast(`동반자 ${got.length}명을 읽었습니다.`);
        changed();
      };
      q('[data-act="file"]').onchange = async (e) => {
        const files = [...e.target.files];
        const msg = q('[data-act="msg"]');
        await photosIn(files, st, pars, msg, onChange);
        const keep = msg.innerHTML;
        draw();
        q('[data-act="msg"]').innerHTML = keep;
      };
    }
    draw();
  }

  // 새 사진을 올리고 경로 목록을 돌려준다(라운드 기록에는 경로만 저장)
  async function uploadPhotos(st, id, what) {
    const errs = [];
    for (const [i, p] of st.photos.entries()) {
      if (p.path) continue;
      const path = `${G.DATA_DIR}/photos/${id}-${Date.now().toString(36)}${i}.jpg`;
      errs.push(...(await G.putFile(path, p.b64, `사진 추가: ${what}`)));
      p.path = path;
      delete p.b64;
    }
    return { paths: st.photos.map((p) => p.path), errs };
  }
  async function saveCompanions(r, st) {
    const what = `${r.date} ${r.course}`;
    const { paths, errs } = await uploadPhotos(st, r.id, what);
    const comps = st.comps.map(cleanComp);
    await commit((data) => data.map((x) => (x.id === r.id ? { ...x, companions: comps.length ? comps : undefined, photos: paths.length ? paths : undefined } : x)), `동반자·사진 저장: ${what}`);
    for (const p of st.removed) await G.deleteFile(p, `사진 삭제: ${what}`).catch(() => null);
    if (errs.length) toast("사진은 저장했지만 다른 저장소 동기화 실패: " + errs.join(" / "), 6000);
  }

  // 인사이트: 동반자별 전적(18홀 총타수끼리 비교)
  function companionRecords(list) {
    const m = new Map();
    for (const r of list) {
      if (!r.companions) continue;
      const me = S.round(r), pars = parsOf(r);
      for (const c of r.companions) {
        const s = Companions.summary(c, pars);
        const x = m.get(c.name) || { name: c.name, n: 0, w: 0, l: 0, t: 0, mine: [], theirs: [], last: "" };
        x.n++;
        if (r.date > x.last) x.last = r.date;
        if (me.full && isNum(s.total)) {
          x.mine.push(me.strokes); x.theirs.push(s.total);
          if (me.strokes < s.total) x.w++; else if (me.strokes > s.total) x.l++; else x.t++;
        }
        m.set(c.name, x);
      }
    }
    return [...m.values()].sort((a, b) => b.n - a.n || (a.last < b.last ? 1 : -1));
  }

  // ───────────── 라운드 목록·상세 ─────────────
  function roundsView() {
    const list = S.byRecent(frounds());
    app.innerHTML = `${head("rounds")}
      <div class="row" style="justify-content:space-between"><h2>라운드 목록 <span class="muted">${list.length}회</span></h2><a class="btn" href="#/input">+ 새 라운드</a></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>날짜</th><th class="l">골프장</th><th>홀</th><th>총타수</th><th>오버</th><th>전반</th><th>후반</th><th>퍼트</th><th>GIR</th><th>FW</th><th>드라이버</th><th>더블+</th><th>벌타</th></tr></thead>
        <tbody>${list.map((r) => {
          const s = S.round(r);
          return `<tr class="click" data-id="${esc(r.id)}"><td>${dot(r.date)}</td><td class="l">${esc(r.course)}</td><td>${s.holes}</td><td><b>${s.strokes ?? "-"}</b></td><td>${sgn(s.over, 0)}</td><td>${s.front ?? "-"}</td><td>${s.back ?? "-"}</td><td>${s.detail ? s.putts : "-"}</td><td>${s.detail ? pct(s.girp) : "-"}</td><td>${pct(s.fwp)}</td><td>${isNum(s.drive) ? Math.round(s.drive) + "m" : "-"}</td><td>${s.dbl}</td><td>${s.detail && isNum(s.pen) ? s.pen : "-"}</td></tr>`;
        }).join("")}</tbody>
      </table></div>`;
    app.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => (location.hash = "#/round/" + encodeURIComponent(tr.dataset.id))));
  }
  function roundView(id) {
    const r = rounds.find((x) => x.id === id);
    if (!r) { app.innerHTML = `<p>라운드를 찾을 수 없습니다. <a href="#/rounds">목록으로</a></p>`; return; }
    const s = S.round(r);
    const R1 = S.analyze([r], settings).radar;   // 이 라운드 한 개의 지표 → 점수
    const rad = R1.score;
    const rawFmt = (k, v) => (!isNum(v) ? "-" : ["fw", "gir", "scr"].includes(k) ? pct(v) : k === "pph" ? v.toFixed(2) + "개" : k === "p3" ? v.toFixed(1) + "개" : k === "fp" ? v.toFixed(1) + "m" : v.toFixed(1) + "타");
    app.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <h2>${dot(r.date)} ${esc(r.course)} <span class="muted">${esc([r.front, r.back].filter(Boolean).join(" / "))}${r.tee ? " · " + esc(r.tee) : ""}${r.region ? " · 📍" + esc(r.region) : ""}</span></h2>
        <div class="row"><a class="btn ghost" href="#/edit/${encodeURIComponent(r.id)}">수정</a><button class="btn danger" id="bDel" type="button" ${G.canWrite() ? "" : "disabled"}>삭제</button></div>
      </div>
      <div class="kpis">
        ${kpi("총타수", s.strokes ?? "-", s.full ? `전반 ${s.front} / 후반 ${s.back}` : `${s.holes}홀 입력`)}
        ${kpi("오버파", sgn(s.over, 0), `버디+ ${s.birdie} / 파 ${s.parn} / 보기 ${s.bogey}`)}
        ${kpi("더블+", s.dbl, `초과타 ${s.blow}`)}
        ${isNum(s.drive) ? kpi("드라이버 평균", Math.round(s.drive) + "m", `최장 ${s.driveMax}m · ${s.driveN}홀`) : ""}
        ${s.detail ? kpi("퍼트", s.putts, `3퍼트 ${s.p3} / 1퍼트 ${s.onep}`) + kpi("GIR", pct(s.girp), `스크램블 ${pct(s.scrp)}`) + kpi("FW", pct(s.fwp), `벌타 ${s.pen ?? "-"}`) : ""}
      </div>
      ${s.checks.length ? `<div class="notice" style="margin-top:10px">기록 확인: ${s.checks.join(", ")}번 홀은 온그린 타수 + 퍼트가 타수와 다릅니다.</div>` : ""}
      ${scorecard(r, false)}
      ${r.memo ? `<p class="card" style="margin-top:12px">${esc(r.memo)}</p>` : ""}
      ${s.detail ? `<div class="card" style="margin-top:12px"><h3 class="mt0">이 라운드 7영역</h3>
        <div class="grid g2">
          <div class="chart-box tall"><canvas id="cR"></canvas></div>
          <div class="tbl-wrap"><table><thead><tr><th class="l">영역</th><th>이 라운드</th><th>점수</th><th>100점 기준(목표)</th></tr></thead>
            <tbody>${Object.entries(settings.radar).map(([k, c]) => `<tr><td class="l"><b>${c.label}</b><br><span class="muted">${c.metric}</span></td><td>${rawFmt(k, R1.raw[k])}</td><td class="${isNum(rad[k]) ? (rad[k] >= settings.radarTarget ? "ok" : "ng") : ""}"><b>${rad[k] ?? "-"}</b></td><td class="muted">${rawFmt(k, c.full)}</td></tr>`).join("")}</tbody></table></div>
        </div>
        <p class="legend-note">이 라운드 <b>한 경기만</b>의 지표를 점수로 바꾼 것입니다(홈의 육각형은 최근 5라운드 평균이라 한 경기보다 덜 들쭉날쭉합니다). 주황 점선은 목표선 ${settings.radarTarget}점, 표의 「100점 기준」이 그 목표에 해당하는 실제 값입니다.</p></div>` : ""}
      <h3>동반자 비교 <span class="muted">${(r.companions || []).length ? (r.companions || []).length + "명" : "없음"}</span></h3>
      ${companionCompare(r) || `<p class="muted">함께 친 동반자의 점수를 넣으면 순위·홀별로 비교합니다.</p>`}
      ${(r.photos || []).length ? `<div class="photos view">${r.photos.map((p, i) => `<a class="ph" href="${G.rawUrl(p)}" target="_blank" rel="noopener"><img src="${G.rawUrl(p)}" alt="라운드 사진 ${i + 1}" loading="lazy"></a>`).join("")}</div>` : ""}
      <div class="row" style="margin-top:10px"><button class="btn ghost" id="bComp" type="button">👥 동반자·사진 ${(r.companions || []).length || (r.photos || []).length ? "편집" : "추가"}</button></div>
      <div id="compBox"></div>
      <div id="delBox"></div>
      <p><a href="#/rounds">← 목록으로</a></p>`;
    if (s.detail) {
      const rk = Object.keys(settings.radar);
      chart("cR", {
        type: "radar",
        data: {
          labels: rk.map((k) => settings.radar[k].label),
          datasets: [
            { label: "이 라운드", data: rk.map((k) => rad[k]), backgroundColor: "rgba(63,174,134,.22)", borderColor: "#3fae86", pointBackgroundColor: "#3fae86" },
            { label: `목표 ${settings.radarTarget}점`, data: rk.map(() => settings.radarTarget), borderColor: "#ffb27a", borderDash: [6, 4], backgroundColor: "transparent", pointRadius: 0 },
          ],
        },
        options: baseOpts({ plugins: legendOn, scales: { r: { min: 0, max: 100, ticks: { stepSize: 20, display: true, showLabelBackdrop: true, backdropColor: "rgba(255,255,255,.75)", color: "#8a93a6", font: { size: 10 } }, pointLabels: { font: { size: 13, weight: "600" } } } } }),
        plugins: [{
          id: "radarVals1",
          afterDatasetsDraw(c) {
            const meta = c.getDatasetMeta(0), ctx = c.ctx;
            ctx.save(); ctx.font = "700 12px Pretendard, sans-serif"; ctx.fillStyle = "#2f7d5b"; ctx.textAlign = "center";
            meta.data.forEach((pt, i) => { const v = c.data.datasets[0].data[i]; if (isNum(v)) ctx.fillText(v, pt.x, pt.y - 8); });
            ctx.restore();
          },
        }],
      });
    }
    document.getElementById("bComp").onclick = () => {
      const box = document.getElementById("compBox");
      const st = newEditState(r);
      box.innerHTML = `<div class="card" style="margin-top:10px"><h3 class="mt0">동반자·사진 편집</h3><div id="compEd"></div>
        <div class="row" style="margin-top:12px"><button class="btn" id="bCompSave" type="button" ${G.canWrite() ? "" : "disabled"}>GitHub에 저장</button><button class="btn ghost" id="bCompCancel" type="button">닫기</button></div></div>`;
      companionEditor(document.getElementById("compEd"), st, parsOf(r));
      document.getElementById("bCompCancel").onclick = () => (box.innerHTML = "");
      document.getElementById("bCompSave").onclick = async (e) => {
        const bad = compProblem(st);
        if (bad) { toast(bad, 4000); return; }
        e.target.disabled = true; e.target.textContent = "저장 중…";
        try { await saveCompanions(r, st); toast("동반자·사진을 저장했습니다."); roundView(id); }
        catch (err) { toast(err.message, 6000); e.target.disabled = false; e.target.textContent = "GitHub에 저장"; }
      };
      box.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    document.getElementById("bDel").onclick = () => {
      document.getElementById("delBox").innerHTML = `<div class="notice">이 라운드를 GitHub에서 삭제할까요? <button class="btn danger" id="bDel2" type="button">삭제 확인</button></div>`;
      document.getElementById("bDel2").onclick = async () => {
        try {
          await commit((data) => data.filter((x) => x.id !== id), `라운드 삭제: ${r.date} ${r.course}`);
          toast("삭제했습니다.");
          location.hash = "#/rounds";
        } catch (e) { toast(e.message, 6000); }
      };
    };
  }

  // ───────────── 통계 ─────────────
  let trendYear = "";
  function statsView() {
    const fr = frounds();
    const A = S.analyze(fr, settings);
    const ST = S.stability(A.fulls);
    const types = S.scoreTypes(fr);
    const bands = [["70대 이하", 0, 79], ["80대", 80, 89], ["90대", 90, 99], ["100 이상", 100, 999]].map(([l, a, b]) => ({ l, n: A.fulls.filter((r) => r.strokes >= a && r.strokes <= b).length }));
    const yr = [...new Set(A.rs.map((r) => r.year))].sort().map((y) => {
      const rs = A.rs.filter((r) => r.year === y), fs = rs.filter((r) => r.full);
      return { y, n: rs.length, f: fs.length, c: new Set(rs.map((r) => r.course)).size, avg: S.avg(fs.map((r) => r.strokes)), best: fs.length ? Math.min(...fs.map((r) => r.strokes)) : null, worst: fs.length ? Math.max(...fs.map((r) => r.strokes)) : null };
    });
    const top10 = A.fulls.slice().sort((a, b) => a.strokes - b.strokes || (a.date < b.date ? 1 : -1)).slice(0, 10);
    const cs = [...new Set(A.recent.map((r) => r.course))].map((c) => {
      const rs = A.recent.filter((r) => r.course === c), fs = rs.filter((r) => r.full);
      return { c, n: rs.length, avg: S.avg(fs.map((r) => r.strokes)), best: fs.length ? Math.min(...fs.map((r) => r.strokes)) : null, last: rs[0].date, lastScore: rs[0].strokes };
    }).sort((a, b) => b.n - a.n || (a.last < b.last ? 1 : -1));
    const trendSrc = trendYear ? A.rs.filter((r) => String(r.year) === trendYear) : A.rs;
    const TB = S.trendBuckets(trendSrc, !!trendYear);
    app.innerHTML = `${head("stats")}
      <h2>스코어 유형 <span class="muted">홀 단위 횟수</span></h2>
      <div class="kpis">${types.map((t) => `<button type="button" class="kpi kbtn ${t.n ? "" : "dim"}" data-st="${t.key}" ${t.n ? "" : "disabled"}><div class="lbl">${t.label}</div><div class="val ${["hio", "alb", "eagle", "birdie"].includes(t.key) ? "best" : ""}">${t.n}</div></button>`).join("")}</div>
      <div id="stList"></div>

      <h2>평균 · 안정성 <span class="muted">18홀 ${A.fulls.length}회</span></h2>
      <div class="kpis">
        ${kpi("최근 10R 평균", f1(ST?.last10), "최근 18홀 10라운드")}
        ${kpi("표준편차", isNum(ST?.sd) ? "±" + ST.sd.toFixed(1) : "-", "작을수록 점수가 안정적")}
        ${kpi("최저 · 최고", ST ? `${ST.min} · ${ST.max}` : "-", "베스트 · 워스트")}
      </div>

      <h2>기간별 평균 타수 <span class="muted">${TB.unit}별 (라운드별 추이는 홈)</span></h2>
      <div class="chips" style="margin-bottom:8px"><button type="button" class="chip ${trendYear ? "" : "on"}" data-ty="">자동</button>${yr.map((r) => `<button type="button" class="chip ${trendYear === String(r.y) ? "on" : ""}" data-ty="${r.y}">${r.y}</button>`).join("")}</div>
      <div class="card"><div class="chart-box tall"><canvas id="cTB"></canvas></div></div>

      <h2>베스트 스코어 TOP 10</h2>
      <div class="tbl-wrap"><table><thead><tr><th>순위</th><th>날짜</th><th class="l">골프장</th><th>타수</th><th>전반</th><th>후반</th></tr></thead>
        <tbody>${top10.map((r, i) => `<tr class="click" data-id="${esc(r.id)}"><td><b>${i + 1}</b></td><td>${dot(r.date)}</td><td class="l">${esc(r.course)}</td><td class="${i === 0 ? "ng" : ""}"><b>${r.strokes}</b></td><td>${r.front}</td><td>${r.back}</td></tr>`).join("")}</tbody></table></div>

      <h2>스코어 구간</h2>
      <div class="grid g2">
        <div class="tbl-wrap"><table><thead><tr><th class="l">구간</th><th>라운드</th><th>비율</th></tr></thead>
          <tbody>${bands.map((b) => `<tr><td class="l">${b.l}</td><td>${b.n}</td><td>${pct(A.fulls.length ? b.n / A.fulls.length : null)}</td></tr>`).join("")}</tbody></table></div>
        <div class="card"><div class="chart-box"><canvas id="cBand"></canvas></div></div>
      </div>

      <h2>연도별</h2>
      <div class="tbl-wrap"><table><thead><tr><th>연도</th><th>라운드</th><th>18홀</th><th>골프장 수</th><th>평균 타수</th><th>베스트</th><th>워스트</th></tr></thead>
        <tbody>${yr.map((r) => `<tr><td><b>${r.y}</b></td><td>${r.n}</td><td>${r.f}</td><td>${r.c}</td><td>${f1(r.avg)}</td><td>${r.best ?? "-"}</td><td>${r.worst ?? "-"}</td></tr>`).join("")}</tbody></table></div>

      <p class="legend-note">골프장별 방문·평균·베스트는 <a href="#/insights">인사이트 → 다녀온 지역</a>의 「전체」에 있습니다.</p>`;

    app.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => {
      const t = types.find((x) => x.key === b.dataset.st);
      app.querySelectorAll("[data-st]").forEach((x) => x.classList.toggle("sel", x === b));
      const list = S.byRecent(t.rounds);
      document.getElementById("stList").innerHTML = `<h3>${t.label}가 나온 라운드 <span class="muted">${list.length}회 · 총 ${t.n}번</span></h3>
        <div class="tbl-wrap"><table><thead><tr><th>날짜</th><th class="l">골프장</th><th>횟수</th></tr></thead>
        <tbody>${list.map((x) => `<tr class="click" data-id="${esc(x.id)}"><td>${dot(x.date)}</td><td class="l">${esc(x.course)}</td><td><b>${x.n}</b></td></tr>`).join("")}</tbody></table></div>`;
      bindRows();
    }));
    app.querySelectorAll("[data-ty]").forEach((b) => (b.onclick = () => { trendYear = b.dataset.ty; statsView(); }));
    app.querySelectorAll("[data-course]").forEach((tr) => (tr.onclick = () => { F.course = tr.dataset.course; ls.set(KEY_FILTER, F); location.hash = "#/rounds"; }));
    const bindRows = () => app.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => (location.hash = "#/round/" + encodeURIComponent(tr.dataset.id))));
    bindRows();
    charts.forEach((c) => c.destroy());
    charts = [];
    chart("cTB", {
      type: "bar",
      data: {
        labels: TB.buckets.map((b) => b.k),
        datasets: [
          { type: "line", label: "평균 타수", data: TB.buckets.map((b) => b.avg), borderColor: "#ff8f8f", backgroundColor: "#ff8f8f", yAxisID: "y", pointRadius: 2.5, pointHoverRadius: 5, tension: 0, spanGaps: true },
          { type: "bar", label: "라운드 수", data: TB.buckets.map((b) => b.n), backgroundColor: "rgba(122,167,247,.45)", yAxisID: "y1" },
        ],
      },
      options: baseOpts({ plugins: legendOn, scales: { y: { position: "left", suggestedMin: 80, suggestedMax: 105, ...noGrid }, y1: { position: "right", beginAtZero: true, ...noGrid, ticks: { precision: 0 } }, x: noGrid } }),
      plugins: [valueLabels((v) => (Number.isInteger(v) ? v : v.toFixed(1)), (v, j, ds) => {
        if (ds.type !== "line") return null;
        const m = S.avg(TB.buckets.map((b) => b.avg).filter(isNum));
        return v > m ? UP : v < m ? DOWN : null;
      })],
    });
    chart("cBand", {
      type: "doughnut",
      data: { labels: bands.map((b) => b.l), datasets: [{ data: bands.map((b) => b.n), backgroundColor: ["#5b8def", "#3fae86", "#f2b33d", "#ff8f8f"], borderColor: "#fff", borderWidth: 2, hoverOffset: 10 }] },
      options: baseOpts({ cutout: "55%", plugins: { legend: { display: true, position: "right" }, tooltip: { callbacks: { label: (x) => ` ${x.label}: ${x.raw}회 (${pct(A.fulls.length ? x.raw / A.fulls.length : null)})` } } } }),
      plugins: [{
        id: "donutVals",
        afterDatasetsDraw(c) {
          const ctx = c.ctx, meta = c.getDatasetMeta(0), tot = S.sum(c.data.datasets[0].data);
          ctx.save(); ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "800 12px Pretendard, sans-serif";
          meta.data.forEach((arc, i) => {
            const v = c.data.datasets[0].data[i];
            if (!v) return;
            const p = arc.tooltipPosition();
            ctx.fillText(`${v}회`, p.x, p.y - 2);
            ctx.font = "600 11px Pretendard, sans-serif"; ctx.fillText(pct(v / tot), p.x, p.y + 12); ctx.font = "800 12px Pretendard, sans-serif";
          });
          const area = c.chartArea, cx = (area.left + area.right) / 2, cy = (area.top + area.bottom) / 2;
          ctx.fillStyle = "#2b3140"; ctx.font = "800 18px Pretendard, sans-serif"; ctx.fillText(`${tot}`, cx, cy + 2);
          ctx.font = "600 11px Pretendard, sans-serif"; ctx.fillStyle = "#8a93a6"; ctx.fillText("18홀 라운드", cx, cy + 18);
          ctx.restore();
        },
      }],
    });
    bindFilter();
  }

  // ───────────── 라운드 인사이트 ─────────────
  function insightsView() {
    const fr = frounds();
    const A = S.analyze(fr, settings);
    const I = S.insights(A.rs);
    if (!I) { app.innerHTML = head("insights") + `<p class="muted">조건에 맞는 라운드가 없습니다.</p>`; return; }
    app.innerHTML = `${head("insights")}
      <div class="card oneline">
        올해 <b>${I.thisYear.n}라운드</b>${isNum(I.thisYear.avg) ? ` · 평균 <b>${f1(I.thisYear.avg)}</b>` : ""}${I.thisYear.best ? ` · 베스트 <b>${I.thisYear.best}</b>` : ""} ·
        첫 기록(${dot(I.first)}) 후 <b>${I.daysSinceFirst.toLocaleString()}일째</b> ·
        이번 달 <b>${I.thisMonth.courses}곳</b>에서 ${I.thisMonth.n}라운드 ·
        ${I.daysSinceLast > 0 ? `마지막 라운드 <b>${I.daysSinceLast}일 전</b>` : I.daysSinceLast === 0 ? `마지막 라운드 <b>오늘</b>` : `다음 라운드 <b>${-I.daysSinceLast}일 뒤</b>`}
      </div>
      <h2>다녀온 지역 <span class="muted">시·도별 골프장 수 · 누르면 골프장 목록</span></h2>
      <div class="card">
        ${(() => {
          const RS = Regions.summarize(A.rs, rounds);
          const extra = ["__all", "해외", "미지정"].filter((k) => k === "__all" || RS[k]).map((k) => k === "__all" ? `<button type="button" class="chip" data-reg="__all">전체 골프장 ${S.sum(Object.values(RS).map((x) => x.courses.length))}곳</button>` : `<button type="button" class="chip" data-reg="${k}">${k} ${RS[k].courses.length}곳</button>`).join(" ");
          const regs = Object.keys(RS).filter((k) => k !== "미지정");
          return `<div class="kmap-wrap"><div class="kmap-map">${Regions.svg(RS)}</div>
            <div class="kmap-side"><div class="kmap-total"><b>${regs.length}</b>개 지역 · <b>${S.sum(Object.values(RS).map((x) => x.courses.length))}</b>곳 골프장</div>${extra ? `<div class="row" style="margin-top:8px">${extra}</div>` : ""}
            ${RS["미지정"] ? `<p class="legend-note">지역이 없는 라운드는 「미지정」입니다. 라운드 「수정」에서 지역을 골라 주세요.</p>` : ""}</div></div>
            <div id="regionPanel"></div>`;
        })()}
      </div>

      ${(() => {
        const CR = companionRecords(fr);
        if (!CR.length) return "";
        return `<h2>동반자 전적 <span class="muted">18홀 총타수 비교 · 이름을 고치면 모든 라운드에 반영</span></h2>
        <div class="tbl-wrap"><table><thead><tr><th class="l">동반자</th><th>함께</th><th>나의 승-패-무</th><th>내 평균</th><th>동반자 평균</th><th>평균 차</th><th>최근</th><th></th></tr></thead>
        <tbody>${CR.map((x, i) => { const d = x.mine.length ? S.avg(x.theirs) - S.avg(x.mine) : null; return `<tr><td class="l"><b>${esc(x.name)}</b>${x.name.includes("*") ? ` <span class="pill ng">이름 확인</span>` : ""}</td><td>${x.n}회</td><td>${x.mine.length ? `<b>${x.w}</b>-${x.l}-${x.t}` : "-"}</td><td>${f1(S.avg(x.mine))}</td><td>${f1(S.avg(x.theirs))}</td><td class="${isNum(d) ? (d > 0 ? "ok" : d < 0 ? "ng" : "") : ""}">${isNum(d) ? (d > 0 ? `내가 ${d.toFixed(1)}타 앞섬` : d < 0 ? `${(-d).toFixed(1)}타 뒤짐` : "같음") : "-"}</td><td>${dot(x.last)}</td><td><button class="link" data-rename="${i}" type="button" ${G.canWrite() ? "" : "disabled"}>이름 고치기</button></td></tr>`; }).join("")}</tbody></table></div>
        <div id="renameBox"></div>`;
      })()}

      <h2>라운드 패턴</h2>
      <div class="kpis">
        ${kpi("평균 라운드 간격", isNum(I.avgGap) ? I.avgGap.toFixed(0) + "일" : "-", "라운드 사이 평균 일수")}
        ${kpi("주말 비중", pct(I.weekendShare), "토·일 라운드")}
        ${I.ampm ? kpi("오전 / 오후", `${I.ampm.am.n} / ${I.ampm.pm.n}`, `평균 ${f1(I.ampm.am.avg)} / ${f1(I.ampm.pm.avg)}`) : kpi("오전 / 오후", "-", "티오프 시간 기록 없음")}
      </div>
      <div class="card" style="margin-top:12px"><h3 class="mt0">요일별 라운드</h3><div class="chart-box"><canvas id="cDow"></canvas></div></div>
      <p class="legend-note">최근 90일 라운드는 위 필터의 「최근 90일」로 모든 화면에서 볼 수 있습니다.</p>`;
    app.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => (location.hash = "#/round/" + encodeURIComponent(tr.dataset.id))));
    // 지역 타일을 누르면 그 지역 골프장 목록
    const RS = Regions.summarize(A.rs, rounds);
    const showRegion = (reg) => {
      // 「전체」: 예전 통계 → 자주 가는 골프장 표를 여기로 합침(지역 칸을 붙여서)
      const x = reg === "__all" ? { rounds: S.sum(Object.values(RS).map((v) => v.rounds)), courses: Object.entries(RS).flatMap(([g, v]) => v.courses.map((c) => ({ ...c, g }))).sort((a, b) => b.n - a.n || (a.last < b.last ? 1 : -1)) } : RS[reg];
      app.querySelectorAll("[data-reg]").forEach((b) => b.classList.toggle("sel", b.dataset.reg === reg));
      if (!x) { document.getElementById("regionPanel").innerHTML = ""; return; }
      document.getElementById("regionPanel").innerHTML = `<div class="region-panel"><div class="region-head">📍 ${reg === "__all" ? "전체" : reg} <span class="muted">골프장 ${x.courses.length}곳 · ${x.rounds}라운드</span></div>
        <div class="tbl-wrap"><table><thead><tr><th class="l">골프장</th><th>방문</th><th>18홀 평균</th><th>베스트</th><th>최근 방문</th><th>최근 점수</th></tr></thead>
        <tbody>${x.courses.map((c) => `<tr class="click" data-course="${esc(c.course)}"><td class="l"><b>${esc(c.course)}</b>${c.g ? ` <span class="muted">${esc(c.g)}</span>` : ""}</td><td>${c.n}</td><td>${f1(c.avg)}</td><td>${c.best ?? "-"}</td><td>${dot(c.last)}</td><td>${c.lastScore ?? "-"}</td></tr>`).join("")}</tbody></table></div>
        <p class="legend-note">골프장을 누르면 그 골프장 라운드만 라운드 목록에서 봅니다.</p></div>`;
      document.querySelectorAll("#regionPanel [data-course]").forEach((tr) => (tr.onclick = () => { F.course = tr.dataset.course; ls.set(KEY_FILTER, F); location.hash = "#/rounds"; }));
    };
    app.querySelectorAll("[data-reg]").forEach((b) => (b.onclick = () => showRegion(b.dataset.reg)));
    const top = Object.entries(RS).filter(([k]) => k !== "미지정").sort((a, b) => b[1].courses.length - a[1].courses.length)[0];
    if (top) showRegion(top[0]);
    // 동반자 이름 고치기: 그 이름이 들어간 모든 라운드를 한 번에 바꾼다
    const CR = companionRecords(rounds);
    const CRf = companionRecords(fr);
    app.querySelectorAll("[data-rename]").forEach((b) => (b.onclick = () => {
      const old = CRf[b.dataset.rename].name;
      document.getElementById("renameBox").innerHTML = `<div class="notice" style="margin-top:8px">「${esc(old)}」 → <input id="rnNew" value="${esc(old)}" style="width:140px"> <button class="btn" id="rnGo" type="button">모든 라운드에서 바꾸기</button> <span class="muted">${(CR.find((x) => x.name === old) || { n: 0 }).n}개 라운드</span></div>`;
      document.getElementById("rnGo").onclick = async () => {
        const nv = document.getElementById("rnNew").value.trim();
        if (!nv || nv === old) return;
        if (nv.includes("*")) { toast("*를 빼고 적어 주세요."); return; }
        try {
          await commit((data) => data.map((r) => (r.companions && r.companions.some((c) => c.name === old) && !r.companions.some((c) => c.name === nv) ? { ...r, companions: r.companions.map((c) => (c.name === old ? { ...c, name: nv } : c)) } : r)), `동반자 이름 변경: ${old} → ${nv}`);
          if (old.includes("*")) { const al = ls.get(KEY_ALIAS) || {}; al[old] = nv; ls.set(KEY_ALIAS, al); }
          toast("이름을 바꿨습니다.");
          insightsView();
        } catch (e) { toast(e.message, 6000); }
      };
    }));
    chart("cDow", { type: "bar", data: { labels: I.dow.map((d) => d.l), datasets: [{ data: I.dow.map((d) => d.n), backgroundColor: I.dow.map((d, i) => (i === 0 || i === 6 ? "#ff8f8f" : "#7fd1ae")) }] }, options: baseOpts({ scales: { y: { beginAtZero: true, ticks: { precision: 0 }, ...noGrid }, x: noGrid } }), plugins: [valueLabels((v) => v)] });
  }

  // ───────────── 스마트스코어 붙여넣기 등록 ─────────────
  let parsed = [];
  let compIdx = -1;
  const compLabel = (r) => `${r.st.comps.length ? `👥 ${r.st.comps.length}명` : "-"}${r.st.photos.length ? ` · 📷 ${r.st.photos.length}` : ""}${r.st.comps.some((c) => c.name.includes("*")) ? ` <span class="pill ng">이름 확인</span>` : ""}`;
  function importView() {
    const known = [...new Set(rounds.map((r) => r.course))];
    app.innerHTML = `
      <h2>스마트스코어 붙여넣기 등록</h2>
      <ul class="desc">
        <li>네이버 스마트스코어의 라운드 화면(골프장 · 코스 · 날짜 시간 · 총타수 · 홀별 Par/Score)을 복사해 아래에 붙여 넣으세요. 여러 라운드를 한꺼번에 붙여도 됩니다.</li>
        <li>읽은 결과를 확인하고 고칠 수 있습니다. 같은 날짜·골프장이 이미 있으면 기본으로 빼 둡니다.</li>
        <li><b>홀 길이도 넣을 수 있습니다.</b> 스마트스코어 텍스트에는 거리가 없으니, 각 반쪽의 Par/Score 줄 아래에 <code>거리 343 318 314 ...</code>처럼 한 줄을 더 적으세요. 앞에 티 이름을 쓰면(<code>White 343 318 ...</code>) 그 티로 기록되고, <code>Yard 375 ...</code>로 쓰면 m로 바꿔 저장합니다. 18홀을 한 줄에 적어도 됩니다. 거리는 <b>실제로 친 티</b> 기준으로 넣으세요.</li>
        <li><b>스코어카드 표 형식도 됩니다</b>: 날짜 줄, 「홀 1 2 3 …」·「PAR …」 줄, 그리고 선수마다 「이름 +/- … SUB TOT」 줄로 된 결과를 붙여 넣고 「읽기」를 누르면 확인 카드가 나옵니다. 내 줄을 「나」로 고르고 골프장을 적으면 나머지 선수는 동반자로 들어갑니다.</li>
        <li><b>동반자</b>: 붙여 넣은 글에 「이름 숫자…」 줄(예: <code>홍*동 1 0 2 …</code>, <code>철수 85</code>)이 있으면 동반자로 읽습니다. 「추가·편집」에서 스코어만 넣거나, 따로 붙여 넣거나, 스코어카드 사진에서 읽을 수 있고 사진을 라운드에 붙일 수도 있습니다. 이름 가운데 *가 있으면 고쳐 주세요.</li>
        <li>홀별 Par·Score·거리와 티오프 시간이 들어옵니다. 퍼트 등 상세 항목은 등록 뒤 「수정」에서 채우면 됩니다.</li>
      </ul>
      ${G.canWrite() ? "" : `<div class="notice">저장하려면 <a href="#/settings">설정</a>에서 GitHub 토큰을 넣어 주세요. 읽기와 확인은 지금도 됩니다.</div>`}
      <textarea id="ssText" class="pastebox" placeholder="예)&#10;기흥CC&#10;NORTH, WEST&#10;2026-08-29 07:10&#10;80&#10;홀별 스코어&#10;Par 4 4 3 ...&#10;Score 0 1 0 ...&#10;White 320 300 140 ...   ← 홀 길이(선택)&#10;Par ...&#10;Score ...&#10;White ..."></textarea>
      <div class="row" style="margin-top:8px"><button class="btn" id="bParse" type="button">읽기</button><button class="btn ghost" id="bClear" type="button">지우기</button>
        <label class="btn ghost filebtn">📷 사진 첨부 (동반자 점수)<input type="file" accept="image/*" multiple id="ssPhoto" hidden></label></div>
      <p class="legend-note"><b>사진만 첨부해도 됩니다.</b> 스코어카드나 스마트스코어 화면 사진을 고르면 날짜·골프장·Par·선수별 점수를 읽어 「사진에서 읽은 스코어」로 보여 주고, 내 줄을 고르면 나머지는 동반자로 등록됩니다. 글을 먼저 붙여 넣었다면 사진은 그 라운드에 붙고 사진 속 동반자 점수만 더합니다.</p>
      <div id="ssPhotoMsg" class="ocr-msg"></div>
      <div id="photoCard"></div>
      <div id="ssOut"></div>`;
    const $ = (x) => document.getElementById(x);
    $("bClear").onclick = () => { $("ssText").value = ""; $("ssOut").innerHTML = ""; $("ssPhotoMsg").innerHTML = ""; parsed = []; card = null; drawCard(); };
    $("ssPhoto").onchange = async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      if (!files.length) return;
      if (!$("ssText").value.trim() && !parsed.length) { await photoOnly(files); return; }
      if (!parsed.length && $("ssText").value.trim()) $("bParse").click();
      const idx = compIdx >= 0 && parsed[compIdx] ? compIdx : parsed.findIndex((r) => r.pick) >= 0 ? parsed.findIndex((r) => r.pick) : parsed.findIndex((r) => r.holes.length);
      if (idx < 0) { $("ssPhotoMsg").innerHTML = `<div class="notice">먼저 위 칸에 스마트스코어 글을 붙여 넣어 주세요. 사진과 동반자는 그 라운드에 붙습니다.</div>`; return; }
      const pr = parsed[idx];
      compIdx = idx;
      drawParsed();
      const msg = $("ssPhotoMsg");
      await photosIn(files, pr.st, parsOf(pr), msg);
      const keep = msg.innerHTML.replace('<div class="notice">', `<div class="notice">📎 ${dot(pr.date)} ${esc(pr.course)}: `);
      drawParsed();
      $("ssPhotoMsg").innerHTML = keep;
      $("ssComp").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    $("bParse").onclick = () => {
      parsed = SmartScore.parse($("ssText").value).map((r) => {
        const course = SmartScore.matchCourse(r.course, known);
        const dup = rounds.some((x) => x.date === r.date && x.course === course);
        const st = { comps: applyAlias(Companions.parse(r.block, parsOf(r), { skipScore: true })), photos: [], removed: [], text: "" };
        return { ...r, course, origCourse: r.course, dup, pick: !dup && r.holes.length > 0, st };
      });
      compIdx = -1;
      // 스마트스코어 「Score」 줄이 없으면 스코어카드 표(홀·PAR 줄 + 선수 이름 줄)로 다시 읽어 확인 카드를 띄운다
      if (!parsed.some((r) => r.holes.length)) {
        const sc = Companions.scanCard($("ssText").value, known);
        if (sc.players.length && Object.keys(sc.pars).length >= 9) {
          parsed = [];
          $("ssOut").innerHTML = "";
          card = { text: $("ssText").value, photos: [], date: "", course: "", tee: "", me: null };
          drawCard();
          $("photoCard").scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
      drawParsed();
    };
    /* ── 사진만으로 라운드 읽기 ──
     * 사진 글자를 읽어 스마트스코어 화면이면 기존 읽기로, 아니면 스코어카드로 보고 확인 카드를 띄운다. */
    const KEY_ME = KEY_DRAFT.split(".")[0] + ".meName.v1";   // 지난번 「나」로 고른 줄 이름(이 기기에만)
    let card = null;
    async function photoOnly(files) {
      const msg = $("ssPhotoMsg"), photos = [], texts = [];
      try {
        for (const [n, f] of files.entries()) {
          photos.push(await Companions.shrink(f));
          msg.innerHTML = `<div class="notice">사진 ${n + 1}/${files.length} 글자 읽는 중… <span data-p>0%</span> (처음에는 인식 데이터를 받느라 1분 가까이 걸릴 수 있음)</div>`;
          texts.push(await Companions.ocr(f, (st, pr) => { const el = msg.querySelector("[data-p]"); if (el) el.textContent = Math.round(pr * 100) + "%"; }));
        }
      } catch (err) { msg.innerHTML = ""; toast(err.message || String(err), 6000); return; }
      const text = texts.join("\n");
      const ss = SmartScore.parse(text).filter((r) => r.holes.length >= 9);
      if (ss.length) {
        $("ssText").value = text;
        $("bParse").click();
        const pr = parsed.find((r) => r.holes.length);
        if (pr) { pr.st.photos.push(...photos); compIdx = parsed.indexOf(pr); drawParsed(); }
        msg.innerHTML = `<div class="notice">스마트스코어 화면으로 읽었습니다. 아래 표에서 확인하세요(읽은 글은 위 칸에 있어 고친 뒤 「읽기」를 다시 눌러도 됩니다).</div>`;
        return;
      }
      msg.innerHTML = "";
      card = { text, photos, date: "", course: "", tee: "", me: null };
      drawCard();
    }
    function cardPars(sc) {
      if (Object.keys(sc.pars).length >= 9) return { pars: sc.pars, src: "스코어카드에서 읽음" };
      const prev = S.byRecent(rounds.filter((r) => r.course === card.course && (r.holes || []).some((h) => isNum(h.par))))[0];
      if (prev) return { pars: parsOf(prev), src: `${dot(prev.date)} 라운드의 Par` };
      return { pars: sc.pars, src: "" };
    }
    function drawCard() {
      const box = $("photoCard");
      if (!card) { box.innerHTML = ""; return; }
      const sc = Companions.scanCard(card.text, known);
      if (!card.date) card.date = sc.date || new Date().toISOString().slice(0, 10);
      if (!card.course && sc.course) card.course = SmartScore.matchCourse(sc.course, known);
      const { pars, src } = cardPars(sc);
      // 선수 줄은 Par를 안 뒤에 다시 읽는다(+/-로 적힌 줄을 타수로 바꾸려면 Par가 필요)
      const players = applyAlias(Companions.parse(card.text, pars, { scoreName: "나" }));
      const myName = ls.get(KEY_ME);
      if (card.me === null || card.me >= players.length) {
        const i = players.findIndex((p) => p.name === "나" || p.orig === myName || p.name === myName);
        card.me = i >= 0 ? i : 0;
      }
      card.players = players; card.pars = pars;
      const parTxt = Array.from({ length: 18 }, (_, i) => pars[i + 1] ?? "·").join(" ");
      if (card.time === undefined) card.time = sc.time || "";
      box.innerHTML = `<div class="card" style="margin-top:12px"><h3 class="mt0">${card.photos.length ? "📷 사진에서 읽은 스코어" : "📋 붙여 넣은 스코어카드"}</h3>
        ${card.photos.length ? "" : `<p class="legend-note">「Score」 줄 대신 선수 이름 줄로 된 스코어카드로 읽었습니다. 내 줄을 「나」로 고르고 <b>골프장</b>을 적어 주세요.</p>`}
        <div class="photos">${card.photos.map((p) => `<div class="ph"><img src="${p.dataUrl}" alt="첨부 사진"></div>`).join("")}</div>
        <div class="form" style="margin-top:10px">
          <label class="f">날짜<input id="pcDate" type="date" value="${esc(card.date)}"></label>
          <label class="f">골프장<input id="pcCourse" list="pcCourses" value="${esc(card.course)}" placeholder="골프장 이름"></label>
          <label class="f">티<input id="pcTee" value="${esc(card.tee)}" placeholder="예: White"></label>
        </div>
        <datalist id="pcCourses">${[...known].sort().map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
        <p class="legend-note">Par: <b>${parTxt}</b> ${src ? `<span class="muted">(${src})</span>` : `<span class="ng">— Par를 읽지 못했습니다. 골프장을 고르면 이전 라운드의 Par를 쓰고, 처음 가는 곳이면 아래 글에 <code>Par 4 4 3 …</code> 줄을 적어 주세요.</span>`}</p>
        ${players.length ? `<div class="tbl-wrap"><table><thead><tr><th>나</th><th class="l">읽은 이름</th><th>전반</th><th>후반</th><th>총타수</th><th>홀</th><th class="l">확인</th></tr></thead>
          <tbody>${players.map((p, i) => { const sm = Companions.summary(p, pars); return `<tr${i === card.me ? ` class="me-row"` : ""}><td><input type="radio" name="pcMe" value="${i}" ${i === card.me ? "checked" : ""}></td><td class="l"><b>${esc(p.name)}</b></td><td>${sm.front ?? "-"}</td><td>${sm.back ?? "-"}</td><td><b>${sm.total ?? "-"}</b></td><td>${sm.holeCount || "-"}</td><td class="l">${p.warnings.length ? `<span class="ng">${esc(p.warnings.filter((w) => !(i === card.me && w.startsWith("이름"))).join(" / "))}</span>` : `<span class="ok">정상</span>`}</td></tr>`; }).join("")}</tbody></table></div>
          <p class="legend-note">「나」로 고른 줄이 내 라운드가 되고, 나머지 줄은 동반자로 들어갑니다(이름은 다음 단계에서 고칠 수 있음).</p>`
          : `<div class="notice">선수별 점수 줄을 찾지 못했습니다. 아래 읽은 글을 「이름 숫자…」 모양으로 고친 뒤 「다시 읽기」를 누르세요.</div>`}
        <h4>읽은 글 <span class="muted">틀린 글자를 고치고 「다시 읽기」</span></h4>
        <textarea id="pcText" class="pastebox small">${esc(card.text)}</textarea>
        <div class="row" style="margin-top:8px"><button class="btn ghost" id="pcRe" type="button">다시 읽기</button><button class="btn" id="pcAdd" type="button" ${players.length ? "" : "disabled"}>읽기 결과에 추가</button><button class="btn ghost" id="pcDrop" type="button">취소</button></div></div>`;
      $("pcDate").onchange = (e) => (card.date = e.target.value);
      $("pcCourse").onchange = (e) => { card.course = e.target.value.trim(); drawCard(); };
      $("pcTee").onchange = (e) => (card.tee = e.target.value.trim());
      box.querySelectorAll('[name="pcMe"]').forEach((r) => (r.onchange = () => { card.me = Number(r.value); drawCard(); }));
      $("pcRe").onclick = () => { card.text = $("pcText").value; drawCard(); };
      $("pcDrop").onclick = () => { card = null; drawCard(); };
      $("pcAdd").onclick = () => {
        card.text = $("pcText").value;
        const me = card.players[card.me];
        if (!card.date || !card.course) { toast("날짜와 골프장을 적어 주세요."); return; }
        if (!me || !me.holes.length) { toast("내 줄에 홀별 점수가 없습니다. 홀별 점수가 있는 줄을 「나」로 골라 주세요.", 5000); return; }
        const noPar = me.holes.filter((h) => !isNum(card.pars[h.h])).map((h) => h.h);
        if (noPar.length) { toast(`${noPar.join("·")}번 홀 Par를 모릅니다. 읽은 글에 Par 줄을 적거나 골프장을 골라 주세요.`, 6000); return; }
        if (me.orig && me.orig !== "나") ls.set(KEY_ME, me.orig);
        const holes = me.holes.map(({ h, st }) => ({ h, par: card.pars[h], score: st - card.pars[h] }));
        const comps = card.players.filter((_, i) => i !== card.me);
        const dup = rounds.some((x) => x.date === card.date && x.course === card.course);
        parsed.push({ date: card.date, time: card.time || "", course: card.course, origCourse: card.course, front: "", back: "", tee: card.tee, distCount: 0, statedTotal: null,
          total: S.sum(holes.map((h) => h.par + h.score)), holes, warnings: holes.length === 18 ? [] : [`${holes.length}홀만 읽었습니다`], block: "", dup, pick: !dup,
          st: { comps, photos: card.photos, removed: [], text: "" } });
        compIdx = parsed.length - 1;
        card = null;
        drawCard();
        drawParsed();
        toast("읽기 결과에 추가했습니다. 동반자 이름을 확인하고 등록하세요.");
      };
    }
    function drawParsed() {
      if (!parsed.length) { $("ssOut").innerHTML = `<div class="notice" style="margin-top:10px">라운드를 찾지 못했습니다. 날짜 줄(예: 2025-01-19 11:15)과 Par/Score 줄이 들어 있는지 확인하세요.</div>`; return; }
      const n = parsed.filter((r) => r.pick).length;
      $("ssOut").innerHTML = `
        <h3>읽은 라운드 <span class="muted">${parsed.length}개 · 등록 대상 ${n}개</span></h3>
        <div class="tbl-wrap"><table><thead><tr><th>등록</th><th>날짜</th><th class="l">골프장</th><th class="l">코스</th><th class="l">티</th><th>홀</th><th>거리</th><th>총타수</th><th>동반자·사진</th><th class="l">확인</th></tr></thead>
        <tbody>${parsed.map((r, i) => `<tr>
          <td><input type="checkbox" data-pick="${i}" ${r.pick ? "checked" : ""} ${r.holes.length ? "" : "disabled"}></td>
          <td>${dot(r.date)}${r.time ? "<br><span class='muted'>" + esc(r.time) + "</span>" : ""}</td>
          <td class="l"><input data-course="${i}" value="${esc(r.course)}" list="knownCourses" style="width:150px">${r.origCourse !== r.course ? `<br><span class="muted">원문: ${esc(r.origCourse)}</span>` : ""}</td>
          <td class="l">${esc([r.front, r.back].filter(Boolean).join(" / ") || "-")}</td>
          <td class="l"><input data-tee="${i}" value="${esc(r.tee || "")}" list="teeOpts" placeholder="${r.distCount ? "티 입력" : "-"}" style="width:84px"></td>
          <td>${r.holes.length}</td>
          <td>${r.distCount ? `${r.distCount}홀` : `<span class="muted">-</span>`}</td>
          <td><b>${r.total ?? "-"}</b>${r.statedTotal !== null && r.statedTotal !== r.total ? `<br><span class="ng">표기 ${r.statedTotal}</span>` : ""}</td>
          <td><span data-ccount="${i}">${compLabel(r)}</span><br><button class="link" data-cedit="${i}" type="button">${compIdx === i ? "편집 중" : "추가·편집"}</button></td>
          <td class="l">${r.dup ? `<span class="pill ng">이미 있음</span> ` : ""}${r.warnings.length ? `<span class="ng">${esc(r.warnings.join(" / "))}</span>` : `<span class="ok">정상</span>`}</td></tr>`).join("")}</tbody></table></div>
        <datalist id="teeOpts">${["White", "Blue", "Red", "Black", "Gold"].map((t) => `<option value="${t}">`).join("")}</datalist>
        ${parsed.some((r) => r.distCount && !r.tee) ? `<p class="legend-note ng">거리가 있는 라운드는 <b>티</b>를 적어 주세요. 다음에 같은 티로 칠 때 거리를 자동으로 불러올 수 있습니다.</p>` : ""}
        <datalist id="knownCourses">${known.sort().map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
        ${compIdx >= 0 ? `<div class="card" style="margin-top:12px"><h3 class="mt0">동반자·사진 — ${dot(parsed[compIdx].date)} ${esc(parsed[compIdx].course)}</h3><div id="ssComp"></div></div>` : ""}
        <div class="row" style="margin-top:10px"><button class="btn" id="bImport" type="button" ${G.canWrite() && n ? "" : "disabled"}>선택한 ${n}개 GitHub에 등록</button></div>`;
      if (compIdx >= 0) {
        const pr = parsed[compIdx];
        companionEditor($("ssComp"), pr.st, parsOf(pr), () => { const el = app.querySelector(`[data-ccount="${compIdx}"]`); if (el) el.innerHTML = compLabel(pr); });
      }
      app.querySelectorAll("[data-cedit]").forEach((b) => (b.onclick = () => { compIdx = compIdx === Number(b.dataset.cedit) ? -1 : Number(b.dataset.cedit); drawParsed(); if (compIdx >= 0) $("ssComp").scrollIntoView({ behavior: "smooth", block: "start" }); }));
      app.querySelectorAll("[data-pick]").forEach((c) => (c.onchange = () => { parsed[c.dataset.pick].pick = c.checked; drawParsed(); }));
      app.querySelectorAll("[data-tee]").forEach((c) => (c.onchange = () => { parsed[c.dataset.tee].tee = c.value.trim(); drawParsed(); }));
      app.querySelectorAll("[data-course]").forEach((c) => (c.onchange = () => {
        const r = parsed[c.dataset.course];
        r.course = c.value.trim();
        r.dup = rounds.some((x) => x.date === r.date && x.course === r.course);
        drawParsed();
      }));
      const bi = $("bImport");
      if (bi) bi.onclick = async () => {
        const picks = parsed.filter((r) => r.pick);
        const bad = picks.map((r) => compProblem(r.st) && `${dot(r.date)} ${r.course}: ${compProblem(r.st)}`).find(Boolean);
        if (bad) { toast(bad, 5000); return; }
        bi.disabled = true;
        bi.textContent = "등록 중…";
        const ids = picks.map((r, i) => "r" + r.date.replaceAll("-", "") + "-" + (Date.now() + i).toString(36));
        const objs = picks.map((r, i) => ({ id: ids[i], date: r.date, time: r.time, course: r.course, front: r.front, back: r.back, tee: r.tee || "", region: Regions.suggest(r.course, rounds), memo: "스마트스코어 붙여넣기로 등록" + (r.distCount ? ` (거리 ${r.distCount}홀 포함)` : ""), holes: r.holes }));
        try {
          // 사진을 먼저 올리고, 동반자·사진 경로를 라운드에 붙인다
          for (const [i, r] of picks.entries()) {
            const { paths } = await uploadPhotos(r.st, ids[i], `${r.date} ${r.course}`);
            const comps = r.st.comps.map(cleanComp);
            if (comps.length) objs[i].companions = comps;
            if (paths.length) objs[i].photos = paths;
          }
          await commit((data) => data.concat(objs).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)), `스마트스코어 등록 ${objs.length}건: ${objs.map((o) => o.date + " " + o.course).join(", ")}`.slice(0, 250));
          toast(`${objs.length}개 라운드를 등록했습니다.`);
          parsed = [];
          location.hash = "#/rounds";
        } catch (e) {
          toast(e.message, 6000);
          bi.disabled = false;
          bi.textContent = `선택한 ${picks.length}개 GitHub에 등록`;
        }
      };
    }
  }

  // ───────────── 홀·파 분석 ─────────────
  function holesView() {
    const H = S.holeLevel(frounds());
    const os = H.byHole.map((h) => h.over).filter(isNum);
    const maxO = Math.max(...os), minO = Math.min(...os);
    const prow = (lab, x) => `<tr><td class="l"><b>${lab}</b></td><td>${x.n}</td><td>${f2(x.strokes)}</td><td><b>${sgn(x.over)}</b></td><td>${pct(x.birdie)}</td><td>${pct(x.parExact)}</td><td>${pct(x.bogey)}</td><td>${pct(x.double)}</td><td>${pct(x.triple)}</td></tr>`;
    app.innerHTML = `${head("holes")}
      <h2>파 유형별 <span class="muted">Par가 기록된 ${H.total.n}홀</span></h2>
      <div class="tbl-wrap"><table><thead><tr><th class="l">파 유형</th><th>홀 수</th><th>평균 타수</th><th>평균 오버</th><th>버디+</th><th>파</th><th>보기</th><th>더블</th><th>트리플+</th></tr></thead>
        <tbody>${[3, 4, 5].map((p) => prow("파" + p, H.byPar[p])).join("")}${prow("전체", H.total)}</tbody></table></div>
      <div class="grid g2" style="margin-top:12px">
        <div class="card"><h3 class="mt0">파 유형별 평균 오버</h3><div class="chart-box"><canvas id="cPar"></canvas></div></div>
        <div class="card"><h3 class="mt0">연도별 파 유형 평균 오버</h3><div class="chart-box"><canvas id="cYearPar"></canvas></div></div>
      </div>
      <h2>홀 번호별</h2>
      <div class="card"><div class="chart-box"><canvas id="cHole"></canvas></div>
        <p class="legend-note">골프장마다 홀 구성이 달라 홀 난이도 비교가 아니라, 첫 홀(워밍업)·막판(체력·집중력) 같은 흐름 패턴을 보는 용도입니다. 빨강=가장 약함, 파랑=가장 좋음.</p></div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>홀</th><th>기록 수</th><th>평균 Par</th><th>평균 타수</th><th>평균 오버</th><th>파 이하</th><th>더블+</th></tr></thead>
        <tbody>${H.byHole.map((x, i) => `<tr><td><b>${i + 1}</b></td><td>${x.n}</td><td>${f1(x.par)}</td><td>${f2(x.strokes)}</td><td class="${x.over === maxO ? "ng" : x.over === minO ? "ok" : ""}"><b>${sgn(x.over)}</b></td><td>${pct(x.parlow)}</td><td>${pct(x.dbl)}</td></tr>`).join("")}</tbody></table></div>
      ${(() => { const D = S.detailBlocks(frounds()); return D.hcp && D.hcp.length ? `<h2>홀 난이도 · 전후반 <span class="muted">핸디캡을 기록한 라운드</span></h2>
        <div class="tbl-wrap"><table><thead><tr><th class="l"></th><th>홀 수</th><th>평균 Score</th></tr></thead><tbody>${D.hcp.map((x) => `<tr><td class="l">${x.l}</td><td>${x.n}</td><td>${sgn(x.over)}</td></tr>`).join("")}</tbody></table></div>
        <p class="legend-note">쉬운 홀(핸디캡 13~18)에서도 평균 +1 이상이면 실수 관리 문제입니다. (예전 상세 분석 ⑥을 옮김)</p>` : ""; })()}`;
    chart("cPar", { type: "bar", data: { labels: ["파3", "파4", "파5"], datasets: [{ data: [3, 4, 5].map((p) => H.byPar[p].over), backgroundColor: "#ffb27a" }] }, options: baseOpts({ scales: { y: { beginAtZero: true, ...noGrid }, x: noGrid } }), plugins: [valueLabels(f2)] });
    chart("cYearPar", { type: "line", data: { labels: H.byYearPar.map((y) => y.year), datasets: [["p3", "파3", "#7aa7f7"], ["p4", "파4", "#7fd1ae"], ["p5", "파5", "#ffb27a"]].map(([k, l, c]) => ({ label: l, data: H.byYearPar.map((y) => y[k]), borderColor: c, backgroundColor: c, pointRadius: 4, tension: 0 })) }, options: baseOpts({ plugins: legendOn, scales: { y: noGrid, x: noGrid } }), plugins: [valueLabels(f2)] });
    chart("cHole", { type: "bar", data: { labels: H.byHole.map((_, i) => i + 1), datasets: [{ data: H.byHole.map((h) => h.over), backgroundColor: H.byHole.map((h) => (h.over === maxO ? "#ff8f8f" : h.over === minO ? "#7aa7f7" : "#7fd1ae")) }] }, options: baseOpts({ scales: { y: { beginAtZero: true, ...noGrid }, x: noGrid } }), plugins: [valueLabels(f1)] });
  }

  // ───────────── 상세 분석 (v2 「상세분석」 시트) ─────────────
  function detailView() {
    const fr = frounds();
    const list = S.byRecent(fr);
    const sel = new URLSearchParams(location.hash.split("?")[1] || "").get("r") || "";
    const D = S.detailBlocks(fr, sel || null);
    const t = (title, heads, rows, note) => `<h3>${title}</h3><div class="tbl-wrap"><table><thead><tr>${heads.map((h, i) => `<th class="${i ? "" : "l"}">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "" : "l"}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${note ? `<p class="legend-note">${note}</p>` : ""}`;
    app.innerHTML = `${head("detail")}
      <h2>상세 분석 <span class="muted">무엇이 스코어를 바꾸나</span></h2>
      <div class="card"><label class="f">분석 범위<select id="scope"><option value="">조건 전체 (${fr.length}라운드)</option>${list.map((r) => `<option value="${esc(r.id)}" ${r.id === sel ? "selected" : ""}>${dot(r.date)} ${esc(r.course)}</option>`).join("")}</select></label>
        <p class="legend-note">${D.n}홀 분석. 상세 항목(FW·퍼트·1st 퍼트·미스 방향 등)을 기록한 홀만 각 표에 집계됩니다.</p></div>
      ${t("① 티샷 FW (파4·파5)", ["", "홀 수", "평균 Score", "더블+ 비율"], [["FW 안착", D.fw.in.n, sgn(D.fw.in.over), pct(D.fw.in.dbl)], ["FW 미스", D.fw.out.n, sgn(D.fw.out.over), pct(D.fw.out.dbl)], ["<b class='ng'>FW 미스 시 추가 타수</b>", "", `<b class="ng">${sgn(D.fw.diff)}</b>`, ""]], "FW 미스 홀의 평균 Score가 안착 홀보다 얼마나 높은지가 '티샷 정확도의 값'입니다. 차이가 크면 비거리보다 방향을 우선 연습합니다.")}
      ${t("② 그린 적중 (GIR)", ["", "홀 수", "평균 Score", "평균 퍼트"], [["GIR 성공", D.gir.hit.n, sgn(D.gir.hit.over), f2(D.gir.hit.putts)], ["GIR 실패", D.gir.miss.n, sgn(D.gir.miss.over), f2(D.gir.miss.putts)]], "GIR 실패 홀의 평균 Score가 +1.5 이상이면 그린 주변(어프로치·벙커)에서 타수가 크게 새고 있다는 뜻입니다.")}
      ${t("③ 첫 퍼트 거리대별", ["", "홀 수", "평균 퍼트", "1퍼트율", "3퍼트율"], D.fp.map((x) => [x.l, x.n, f2(x.putts), pct(x.one), pct(x.three)]), "3퍼트율이 높은 거리대가 거리감 연습 1순위입니다.")}
      <div class="card" style="margin-top:8px"><div class="chart-box"><canvas id="cFp"></canvas></div></div>
      ${t("⑤ 티샷 미스 방향", ["", "횟수", "비율", "평균 Score", "평균 벌타"], D.miss.map((x) => [x.l, x.n, pct(x.share), sgn(x.over), f2(x.pen)]), "한쪽으로 쏠림이 크면(예: R 60% 이상) 셋업·그립 점검 신호입니다.")}
      ${t("⑧ 홀 길이별 (실제로 친 티 거리)", ["", "홀 수", "평균 Score", "파 이하율", "더블+ 비율", "GIR"],
        [...D.len.p3.map((x) => ["파3 " + x.l, x.n, sgn(x.over), pct(x.parlow), pct(x.dbl), pct(x.gir)]),
         ...D.len.p4.map((x) => ["파4 " + x.l, x.n, sgn(x.over), pct(x.parlow), pct(x.dbl), pct(x.gir)]),
         ...D.len.p5.map((x) => ["파5 " + x.l, x.n, sgn(x.over), pct(x.parlow), pct(x.dbl), pct(x.gir)])],
        `거리를 기록한 ${D.len.n}홀 기준. 긴 파4에서만 크게 무너지면 '보기 공략(3온)'을, 짧은 홀에서도 더블이 많으면 티샷·어프로치 실수를 먼저 점검합니다. 파3 거리대별 GIR은 그 거리의 아이언 정확도입니다.`)}
      ${(() => {
        const AP = Clubs.approachStats(typeof fr !== "undefined" ? fr : rounds, settings, sel || null);
        return t("⑨ 예상 어프로치 클럽별 (추정)", ["", "홀 수", "평균 Score", "GIR", "더블+ 비율"],
          AP.map((x) => [x.label + (x.dist ? ` <span class="muted">${x.dist}m</span>` : ""), x.n, sgn(x.over), pct(x.gir), pct(x.dbl)]),
          `홀 거리와 <a href="#/settings">내 클럽 거리</a>로 그린을 노린 클럽을 추정했습니다(티샷은 드라이버 평균 거리, 파5는 웨지 거리를 남기는 레이업으로 가정). 실제 친 클럽과 다를 수 있으니 경향만 보세요. GIR이 유난히 낮은 클럽이 연습 1순위입니다.${Clubs.isDefault(settings) ? " <b>지금은 예시 클럽 거리</b>로 계산했습니다." : ""}`);
      })()}
      ${(() => {
        const DV = D.drive;
        const recent = S.byRecent((typeof fr !== "undefined" ? fr : rounds).map(S.round)).filter((r) => isNum(r.drive)).slice(0, 5);
        const r5 = S.avg(recent.map((r) => r.drive));
        return `<h3>⑩ 드라이버 거리 <span class="muted">파4·파5 티샷</span></h3>
          <div class="kpis">
            ${kpi("평균 거리", isNum(DV.avg) ? Math.round(DV.avg) + "m" : "-", `${DV.n}홀 기록`)}
            ${kpi("최근 5R 평균", isNum(r5) ? Math.round(r5) + "m" : "-", `${recent.length}라운드`)}
            ${kpi("최장 거리", DV.max ? DV.max + "m" : "-", "기록 중 가장 먼 티샷")}
          </div>` + t("", ["거리대", "홀 수", "FW 안착", "평균 Score", "더블+ 비율"], DV.bands.map((x) => [x.l, x.n, pct(x.fwp), sgn(x.over), pct(x.dbl)]),
          "홀 입력의 「티샷 거리」를 적은 파4·파5 홀만 집계합니다. 멀리 칠수록 FW 안착이 떨어지고 스코어가 나빠지면, 거리보다 방향(컨트롤 샷)을 우선하는 편이 낫습니다. 평균 거리는 설정 → 내 클럽 거리의 드라이버 값으로 쓸 수 있습니다.");
      })()}
      ${t("⑦ 그린 미스 · 어프로치 거리", ["", "홀 수", "평균 Score", "스크램블%"], D.green.map((x) => [x.l, x.n, sgn(x.over), x.scr === null ? "-" : pct(x.scr)]), "짧음이 대부분이면 한 클럽 길게, 30m 이상에서 스크램블이 낮으면 하프 웨지 거리 연습을 우선합니다.")}`;
    document.getElementById("scope").onchange = (e) => { location.hash = "#/detail" + (e.target.value ? "?r=" + encodeURIComponent(e.target.value) : ""); };
    chart("cFp", { type: "bar", data: { labels: D.fp.map((x) => x.l), datasets: [{ label: "1퍼트율", data: D.fp.map((x) => x.one), backgroundColor: "#7fd1ae" }, { label: "3퍼트율", data: D.fp.map((x) => x.three), backgroundColor: "#ff8f8f" }] }, options: baseOpts({ plugins: legendOn, scales: { y: { beginAtZero: true, ticks: { callback: (v) => Math.round(v * 100) + "%" }, ...noGrid }, x: noGrid } }), plugins: [valueLabels(pct)] });
  }

  // ───────────── 사용자 가이드 ─────────────
  const GUIDE = {
    app: "My Golf Lounge",
    url: `${G.PRIMARY.owner}.github.io/${G.PRIMARY.repo}`,
    features: { filter: true, import: true, insights: true, fork: true },
    repos: [G.PRIMARY.repo, ...G.MIRRORS.map((m) => m.repo)],
    origin: `${G.ORIGIN.owner}/${G.ORIGIN.repo}`,
    isOrigin: G.IS_ORIGIN,
  };
  function guideView() {
    // 가이드 본문은 golf-lounge와 같다. 메뉴 이름이 달라진 것만 맨 위에 알려 준다.
    app.innerHTML = `<div class="notice" style="margin-bottom:12px"><b>Golf 2 메뉴 안내</b> — 가이드의 「통계」「홀·파 분석」「상세 분석」은 <b>분석</b> 메뉴의 스코어·홀파·샷 분석 탭, 「라운드 입력」「붙여넣기 등록」은 <b>등록</b> 메뉴의 직접 입력·붙여넣기 탭입니다. 라운드 입력의 「FW 안착」「티샷 미스」는 <b>티샷 결과</b> 한 칸으로 합쳤고, 온그린 타수·숏게임 성공은 자동 계산이라 입력칸이 없습니다. 목표 기준값과 육각형 기준은 설정의 <b>지표 기준</b> 한 표입니다. <a href="#/review">정리 내역</a></div>` + Guide.render(GUIDE);
    Guide.bind(app);
  }

  // ───────────── 설정·데이터 ─────────────
  function settingsView() {
    const c = G.cfg();
    const tg = settings.targets, rd = settings.radar;
    app.innerHTML = `
      ${native ? "" : `<h2>휴대폰에 앱으로 설치</h2>
      <div class="card">
        ${installPrompt ? `<button class="btn" id="bInstall" type="button">앱 설치</button>` : `<p class="muted mt0">${window.matchMedia("(display-mode: standalone)").matches ? "앱으로 실행 중입니다." : "안드로이드 Chrome: 오른쪽 위 ⋮ 메뉴 → <b>앱 설치</b>(또는 홈 화면에 추가)를 누르세요."}</p>`}
        <p class="legend-note">설치하면 홈 화면 아이콘으로 전체 화면에서 열리고, 인터넷이 없어도 마지막으로 받은 기록을 볼 수 있습니다. APK와 달리 Play 프로텍트 경고가 없습니다.</p>
      </div>`}

      <h2>GitHub 연결</h2>
      <div class="card">
        <p class="muted mt0">데이터 저장 위치: <b>${esc(c.owner)}/${esc(c.repo)}</b> · ${esc(c.path)} — 저장할 때 <b>${c.mirrors.map((m) => esc(m.owner + "/" + m.repo)).join(", ")}</b>에도 같은 변경을 적용합니다.</p>
        <label class="f">GitHub 토큰 (저장하는 기기에서만 입력)<input id="tok" type="password" autocomplete="off" placeholder="${c.token ? "저장됨 (바꾸려면 새로 입력)" : "github_pat_..."}"></label>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="bTok" type="button">토큰 저장</button>
          <button class="btn ghost" id="bTest" type="button" ${c.token ? "" : "disabled"}>연결 확인</button>
          <button class="btn danger" id="bTokDel" type="button" ${c.token ? "" : "disabled"}>토큰 삭제</button>
        </div>
        <div class="notice" style="margin-top:12px">
          <b>토큰 만드는 법</b> (한 번만): GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token<br>
          · Repository access: <b>Only select repositories → ${esc(c.repo)}, ${c.mirrors.map((m) => esc(m.repo)).join(", ")}</b> (두 저장소 모두 선택. 이미 만든 토큰은 Edit에서 저장소를 추가하면 됩니다)<br>
          · Permissions → Repository permissions → <b>Contents: Read and write</b> (나머지는 그대로)<br>
          · 만료 기간은 짧게(예: 90일) 두고 만료되면 다시 만드세요.<br>
          토큰은 이 브라우저에만 저장되고 GitHub 외 다른 곳으로 보내지 않습니다. 공용 PC에서는 입력하지 말고, 쓰고 나면 「토큰 삭제」를 누르세요. 보기만 하는 기기에는 토큰이 필요 없습니다.
        </div>
      </div>

      ${G.MIRRORS.length ? `<h2>동기화</h2>
      <div class="card">
        <div id="syncBox" class="muted">확인 중…</div>
        <div class="row" style="margin-top:10px">
          <button class="btn ghost" id="bSyncCheck" type="button">다시 확인</button>
          ${[G.PRIMARY, ...G.MIRRORS].map((r) => `<button class="btn ghost" data-sync="${esc(r.repo)}" type="button" ${G.canWrite() ? "" : "disabled"}>${esc(r.repo)} 기준으로 맞추기</button>`).join("")}
        </div>
        <p class="legend-note">평소에는 저장할 때마다 자동으로 모든 저장소에 같이 반영됩니다. 네트워크 오류 등으로 어긋났을 때만 맞추기를 누르세요. 맞추기는 한쪽 내용으로 다른 쪽을 덮어씁니다.</p>
      </div>` : ""}

      <h2>지표 기준 <span class="muted">목표(판정) · 0점 · 100점(육각형)</span></h2>
      <div class="tbl-wrap"><table><thead><tr><th class="l">지표</th><th>목표</th><th>0점</th><th>100점</th></tr></thead>
        <tbody>${UNI.map((u) => {
          const t = u.t && tg[u.t], x = u.r && rd[u.r], k = RSCALE[u.r] || 1, unit = u.r && PCT.has(u.r) ? "%" : "";
          const tIn = t ? `<input data-t="${u.t}" type="number" step="${t.fmt === "%" ? 1 : 0.5}" value="${t.fmt === "%" ? Math.round(t.v * 100) : t.v}" style="width:70px">${t.fmt === "%" ? " %" : ""}` : `<span class="muted">-</span>`;
          const rIn = (w, v) => `<input data-${w}="${u.r}" type="number" step="${unit ? 1 : 0.1}" value="${+(v * k).toFixed(2)}" style="width:70px">${unit ? " %" : ""}`;
          return `<tr><td class="l"><b>${u.label}</b>${x ? ` <span class="pill">${x.label}</span>` : ""}<br><span class="muted">${u.low ? "낮을수록 좋음" : "높을수록 좋음"}${u.r === "pph" ? " · 라운드(18홀)당" : ""}</span></td><td>${tIn}</td><td>${x ? rIn("rz", x.zero) : "-"}</td><td>${x ? rIn("rf", x.full) : "-"}</td></tr>`;
        }).join("")}
        <tr><td class="l"><b>육각형 목표선</b><br><span class="muted">점수 기준선</span></td><td colspan="3"><input id="rTarget" type="number" value="${settings.radarTarget}" style="width:70px"> 점</td></tr></tbody></table></div>
      <p class="legend-note">기준값은 아마추어 핸디캡별 통계 경향을 참고한 가정값입니다(100점 ≈ 싱글~10 핸디캡, 0점 ≈ 초보). 비율은 %로, 퍼트는 라운드당으로 입력합니다(저장은 golf-lounge와 같은 형식으로 바꿔서 함 — 두 화면이 같은 기준을 씀).</p>
      <div class="row" style="margin-top:10px"><button class="btn" id="bSaveSet" type="button" ${G.canWrite() ? "" : "disabled"}>기준값 GitHub에 저장</button><button class="btn ghost" id="bResetSet" type="button">기본값 불러오기</button></div>

      <h2>내 클럽 거리 <span class="muted">평균 거리(m), 굴러간 거리 포함</span></h2>
      ${Clubs.isDefault(settings) ? `<div class="notice">지금은 <b>예시값</b>입니다. 내 평균 거리로 바꾸고 저장하세요. 연습장이나 스마트 거리측정 기록의 '평소 거리'를 넣으면 됩니다(최고 거리 아님).</div>` : ""}
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>사용</th><th class="l">클럽</th><th>거리(m)</th></tr></thead>
        <tbody>${(Array.isArray(settings.clubs) ? settings.clubs : Clubs.DEFAULT_BAG).map((c, i) => `<tr><td><input type="checkbox" data-con="${i}" ${c.on ? "checked" : ""}></td><td class="l"><input data-clab="${i}" value="${esc(c.label)}" style="width:170px"></td><td><input data-cdist="${i}" type="number" inputmode="numeric" step="5" min="0" value="${c.dist}" style="width:84px"></td></tr>`).join("")}</tbody></table></div>
      ${(() => {
        const ds = S.analyze(rounds, settings).rs.filter((r) => isNum(r.drive));
        const n = S.sum(ds.map((r) => r.driveN));
        const v = n ? Math.round(S.sum(ds.map((r) => r.drive * r.driveN)) / n) : null;
        return v ? `<p class="legend-note">📏 기록된 드라이버 평균 거리: <b>${v}m</b> (파4·파5 티샷 ${n}홀) <button class="link" id="bUseDrive" data-v="${v}" type="button">드라이버 거리에 적용</button></p>` : "";
      })()}
      <div id="gapBox" style="margin-top:8px"></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="bSaveClubs" type="button" ${G.canWrite() ? "" : "disabled"}>클럽 거리 GitHub에 저장</button><button class="btn ghost" id="bClubDefault" type="button">예시값으로</button></div>
      <p class="legend-note">저장하면 라운드 입력의 <b>공략 가이드</b>와 상세 분석 <b>⑨ 예상 어프로치 클럽별</b>에 쓰입니다. 안 쓰는 클럽은 「사용」을 끄세요.</p>

      <h2>버전 <span class="muted">v${APP_VERSION}</span></h2>
      <div class="card">${APP_CHANGES.map((c) => `<h3 class="mt0">v${c.v} <span class="muted">${c.date}</span></h3><ul>${c.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}
        <p class="legend-note">이전 버전 화면 보기(읽기 전용): ${APP_CHANGES.filter((c) => c.v !== APP_VERSION).map((c) => `<a href="v${c.v}/" target="_blank" rel="noopener">v${c.v}</a>`).join(" · ")} — 주소 뒤에 <code>/v0.9</code>처럼 붙여도 됩니다.</p>
        <p class="legend-note">2026.10.25 정식판을 1.0으로 정했습니다(이전 개발 과정은 0.1~0.9). 기능을 고쳐도 당분간 버전은 1.0으로 두고, 배포 번호(${typeof APP_BUILD === "string" ? APP_BUILD : "-"})만 바뀝니다. 새 버전이 나오면 화면 아래에 「새 버전이 있습니다 — 지금 적용」이 뜹니다.</p></div>

      <h2>백업</h2>
      ${native ? `<p class="muted">앱에서는 파일 내려받기가 안 됩니다. 백업은 웹 페이지에서 하거나 GitHub 저장소의 data/rounds.json을 쓰세요.</p>` : `<div class="row"><button class="btn ghost" id="bExport" type="button">rounds.json 내려받기</button></div>`}
      <p class="muted">현재 ${rounds.length}라운드 · GitHub 저장소의 커밋 기록에 모든 변경 이력이 남습니다.</p>
      ${G.IS_ORIGIN ? "" : `<h2>데이터 초기화</h2>
      <div class="card">
        <p class="mt0">내 저장소(${esc(G.PRIMARY.owner)}/${esc(G.PRIMARY.repo)})의 라운드를 모두 지우고 기준값을 기본값으로 되돌립니다. 지운 기록도 GitHub 커밋 기록에서 되살릴 수 있습니다.</p>
        <button class="btn danger" id="bWipe" type="button" ${G.canWrite() ? "" : "disabled"}>모든 기록 지우고 새로 시작</button>
        <div id="wipeBox" style="margin-top:8px"></div>
      </div>`}`;
    const $ = (s) => document.getElementById(s);
    if ($("bInstall")) $("bInstall").onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; settingsView(); };
    $("bTok").onclick = async () => {
      const v = $("tok").value.trim();
      if (!v) return toast("토큰을 입력하세요.");
      G.setCfg({ token: v });
      $("tok").value = "";
      const t = await G.testToken();
      toast(t.msg, 4000);
      renderStatus();
      settingsView();
    };
    const syncCheck = async () => {
      const box = $("syncBox");
      box.textContent = "확인 중…";
      try {
        const st = await G.syncStatus();
        box.innerHTML = st.map((x) => `<div>${x.same ? `<span class="ok">● 일치</span>` : `<span class="ng">● 다름</span>`} ${esc(x.path)} ↔ ${esc(x.mirror)}${x.a !== null ? ` (${x.a} / ${x.b}라운드)` : ""}${x.error ? ` <span class="ng">${esc(x.error)}</span>` : ""}</div>`).join("");
      } catch (e) { box.textContent = "확인 실패: " + e.message; }
    };
    if ($("syncBox")) { syncCheck(); $("bSyncCheck").onclick = syncCheck; }
    if ($("bWipe")) $("bWipe").onclick = () => {
      $("wipeBox").innerHTML = `<div class="notice">정말 ${rounds.length}라운드를 모두 지울까요? <button class="btn danger" id="bWipe2" type="button">지우기 확인</button></div>`;
      $("bWipe2").onclick = () => claimSite(true).catch((e) => toast(e.message, 6000));
    };
    const doSync = async (from) => {
      try {
        for (const p of [G.ROUNDS, G.SETTINGS]) await G.resync(from, p);
        toast("두 저장소를 맞췄습니다.");
        await loadAll(true);
        settingsView();
      } catch (e) { toast(e.message, 6000); }
    };
    app.querySelectorAll("[data-sync]").forEach((b) => (b.onclick = () => doSync(b.dataset.sync)));
    $("bTest").onclick = async () => toast((await G.testToken()).msg, 4000);
    $("bTokDel").onclick = () => { G.setCfg({ token: "" }); toast("이 기기에서 토큰을 지웠습니다."); renderStatus(); settingsView(); };
    $("bSaveSet").onclick = async () => {
      app.querySelectorAll("[data-t]").forEach((el) => { const t = tg[el.dataset.t]; const v = Number(el.value); if (el.value !== "" && isNum(v)) t.v = t.fmt === "%" ? v / 100 : v; });
      app.querySelectorAll("[data-rz]").forEach((el) => { const v = Number(el.value); if (el.value !== "" && isNum(v)) rd[el.dataset.rz].zero = v / (RSCALE[el.dataset.rz] || 1); });
      app.querySelectorAll("[data-rf]").forEach((el) => { const v = Number(el.value); if (el.value !== "" && isNum(v)) rd[el.dataset.rf].full = v / (RSCALE[el.dataset.rf] || 1); });
      const rt = Number($("rTarget").value);
      if (isNum(rt)) settings.radarTarget = rt;
      try {
        const { mirrorErrors } = await G.update(() => settings, "기준값 변경", G.SETTINGS);
        if (mirrorErrors.length) throw new Error("기준값은 저장했지만 동기화 실패: " + mirrorErrors.join(" / "));
        toast("기준값을 GitHub에 저장했습니다.");
      } catch (e) { toast(e.message, 6000); }
    };
    $("bResetSet").onclick = () => { settings = structuredClone(S.DEFAULT_SETTINGS); settingsView(); toast("기본값을 불러왔습니다. 저장하려면 「기준값 GitHub에 저장」을 누르세요."); };
    // 클럽 거리: 입력이 바뀔 때마다 간격 점검을 다시 보여 준다
    const baseClubs = (Array.isArray(settings.clubs) ? settings.clubs : Clubs.DEFAULT_BAG).map((c) => ({ ...c }));
    const readClubs = () => baseClubs.map((c, i) => ({
      key: c.key, label: (app.querySelector(`[data-clab="${i}"]`).value || c.label).trim(),
      dist: Number(app.querySelector(`[data-cdist="${i}"]`).value) || 0, on: app.querySelector(`[data-con="${i}"]`).checked,
    }));
    const drawGaps = () => {
      const gs = Clubs.gaps(Clubs.bag({ clubs: readClubs() }));
      $("gapBox").innerHTML = gs.length ? `<div class="notice"><b>클럽 간격 점검</b><br>${gs.map((g) => `· [${g.type}] ${esc(g.text)}`).join("<br>")}</div>` : `<p class="legend-note ok">클럽 간 거리 간격이 고릅니다.</p>`;
    };
    app.querySelectorAll("[data-con],[data-clab],[data-cdist]").forEach((el) => el.addEventListener("input", drawGaps));
    if ($("bUseDrive")) $("bUseDrive").onclick = () => {
      const i = baseClubs.findIndex((c) => c.key === "D");
      const el = i >= 0 && app.querySelector(`[data-cdist="${i}"]`);
      if (!el) return toast("클럽 목록에 드라이버가 없습니다.");
      el.value = $("bUseDrive").dataset.v;
      drawGaps();
      toast("드라이버 거리를 바꿨습니다. 「클럽 거리 GitHub에 저장」을 눌러야 저장됩니다.", 4000);
    };
    drawGaps();
    $("bSaveClubs").onclick = async () => {
      settings.clubs = readClubs();
      try {
        const { mirrorErrors } = await G.update(() => settings, "클럽 거리 변경", G.SETTINGS || "data/settings.json");
        toast(mirrorErrors.length ? "클럽 거리는 저장했지만 동기화 실패: " + mirrorErrors.join(" / ") : "클럽 거리를 저장했습니다.", 4000);
        settingsView();
      } catch (e) { toast(e.message, 6000); }
    };
    $("bClubDefault").onclick = () => { delete settings.clubs; settingsView(); toast("예시값을 불러왔습니다. 저장하려면 「클럽 거리 GitHub에 저장」을 누르세요."); };
    if ($("bExport")) $("bExport").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(rounds, null, 1)], { type: "application/json" }));
      a.download = `rounds-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
  }

  // ───────────── 안드로이드 앱(Capacitor) ─────────────
  // 뒤로 가기 버튼: 화면 이동 기록이 있으면 이전 화면, 없으면 앱 종료
  const native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if (native && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack && location.hash && location.hash !== "#/dashboard") history.back();
      else window.Capacitor.Plugins.App.exitApp();
    });
  }

  // ───────────── 설치형 웹앱(PWA) ─────────────
  let installPrompt = null;
  if (!native && "serviceWorker" in navigator && location.protocol === "https:") {
    // 새 버전 알림: 새 서비스 워커가 설치되어 화면을 넘겨받으면(controllerchange) 적용 버튼을 띄운다.
    // 처음 설치할 때는 이전 버전이 없으므로 띄우지 않는다.
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) showUpdateBar();
      hadController = true;
    });
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const check = () => reg.update().catch(() => { /* 오프라인 */ });
      // 설치형 앱은 오래 켜 두거나 백그라운드에서 돌아오는 일이 많아, 돌아올 때와 30분마다 새 버전을 확인한다
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => { /* 지원하지 않는 브라우저 */ });
  }
  function showUpdateBar() {
    if (document.getElementById("updBar")) return;
    const bar = document.createElement("div");
    bar.id = "updBar";
    bar.className = "updbar";
    bar.innerHTML = `<span>✨ 새 버전이 있습니다</span><button class="btn" id="updNow" type="button">지금 적용</button><button class="link" id="updLater" type="button">나중에</button>`;
    document.body.appendChild(bar);
    // 입력 중인 라운드는 기기에 임시 저장되어 있어 새로고침해도 이어서 쓸 수 있다
    document.getElementById("updNow").onclick = () => location.reload();
    document.getElementById("updLater").onclick = () => bar.remove();
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    if (location.hash.startsWith("#/settings")) settingsView();
  });

  // ───────────── 시작 ─────────────
  (() => {
    const KEY_VER = KEY_CACHE.split(".")[0] + ".seenVersion";
    const seen = ls.get(KEY_VER);
    if (seen && seen !== APP_VERSION) {
      const c = APP_CHANGES.find((x) => x.v === APP_VERSION);
      setTimeout(() => toast(`v${APP_VERSION}로 업데이트되었습니다${c ? "\n" + c.items.slice(0, 3).map((x) => "· " + x).join("\n") : ""}`, 7000), 1200);
    }
    ls.set(KEY_VER, APP_VERSION);
  })();
  (async () => {
    const cached = ls.get(KEY_CACHE);
    if (Array.isArray(cached)) { rounds = cached; source = "cache"; }
    window.addEventListener("hashchange", route);
    if (rounds.length) route();
    else app.innerHTML = `<p class="muted">데이터를 불러오는 중…</p>`;
    await loadAll(true);
    route();
  })();
})();
