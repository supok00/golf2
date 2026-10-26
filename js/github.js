/* GitHub 저장소를 데이터 저장소로 쓴다. 2026-10-25부터 golf-lounge 하나로 관리한다
 * (예전 golf-round-web·mygolf와의 동기화는 끊음 — 그쪽은 보기 전용 안내 페이지로 남김).
 * - 읽기: 기본 저장소(PRIMARY)의 파일을 GitHub API로 읽는다(공개 저장소라 토큰 없이도 가능).
 *         API 한도(시간당 60회/IP)에 걸리면 같은 사이트에 배포된 파일을 쓴다.
 * - 쓰기: 같은 변경(라운드 추가·수정·삭제)을 기본 저장소와 동기화 저장소(MIRRORS)의 최신 파일에 각각 적용해 커밋한다.
 *         파일 전체를 덮어쓰지 않고 변경만 적용하므로, 다른 쪽에서 먼저 저장한 내용도 지워지지 않는다.
 * - 토큰은 이 브라우저에만 저장한다. 두 저장소 모두 Contents 읽기/쓰기 권한이 있어야 한다.
 */
const GitHubStore = (() => {
  // ── 이 웹의 저장소 설정 ──
  // 페이지 주소(계정.github.io/저장소)에서 저장소를 알아낸다. 그래서 다른 사람이 Fork해도 코드 수정 없이
  // 자기 저장소에 저장된다. 원래 주인(ORIGIN_OWNER)일 때만 다른 두 웹과 동기화한다.
  const APP_KEY = "golf2";
  const ORIGIN_OWNER = "supok00";
  const ORIGIN = { owner: ORIGIN_OWNER, repo: "golf-lounge", branch: "main" };
  const ORIGIN_MIRRORS = [];   // 동기화 대상 없음. 다시 여러 저장소에 저장하려면 여기에 { owner, repo, branch }를 넣는다.
  function detect() {
    const host = location.hostname.toLowerCase();
    if (!host.endsWith(".github.io")) return ORIGIN;            // 로컬 개발 등은 원래 저장소
    const owner = host.slice(0, -".github.io".length);
    const seg = location.pathname.split("/").filter(Boolean)[0];
    return { owner, repo: seg || host, branch: "main" };        // 계정.github.io 저장소 자체에 올린 경우
  }
  // golf2는 화면만 새로 만든 것 — 기록은 golf-lounge 저장소 하나에 둔다(두 화면이 같은 기록을 본다)
  const PRIMARY = ORIGIN;
  const IS_ORIGIN = PRIMARY.owner === ORIGIN_OWNER.toLowerCase() || PRIMARY.owner === ORIGIN_OWNER;
  const MIRRORS = IS_ORIGIN ? ORIGIN_MIRRORS : [];
  // Fork한 사람은 자기 계정 이름의 폴더에 저장한다. 원래 주인의 data/rounds.json과 파일이 달라
  // 「Sync fork」로 새 기능을 받아도 기록이 섞이거나 충돌하지 않고, 처음에는 빈 기록으로 시작한다.
  const DATA_DIR = IS_ORIGIN ? "data" : `data/users/${PRIMARY.owner}`;
  const ROUNDS = `${DATA_DIR}/rounds.json`;
  const SETTINGS = `${DATA_DIR}/settings.json`;

  const KEY_CFG = APP_KEY + ".github.v1";
  const KEY_PENDING = APP_KEY + ".syncPending.v1";
  // 같은 사이트(supok00.github.io)의 다른 골프 웹에 넣어 둔 토큰이 있으면 처음 한 번 가져온다
  try {
    if (!localStorage.getItem(KEY_CFG) && location.hostname.toLowerCase().startsWith(ORIGIN_OWNER.toLowerCase() + ".")) {
      for (const k of ["lounge.github.v1", "mygolf.github.v1", "golf.github.v1"]) {
        const t = (JSON.parse(localStorage.getItem(k)) || {}).token;
        if (t) { localStorage.setItem(KEY_CFG, JSON.stringify({ token: t })); break; }
      }
    }
  } catch { /* 저장소 사용 불가 */ }

  // 저장소 위치는 코드에서 정하고, 브라우저에는 토큰만 둔다
  function cfg() {
    let token = "";
    try { token = (JSON.parse(localStorage.getItem(KEY_CFG)) || {}).token || ""; } catch { /* 무시 */ }
    return { ...PRIMARY, path: ROUNDS, token, mirrors: MIRRORS };
  }
  function setCfg(c) {
    try { localStorage.setItem(KEY_CFG, JSON.stringify({ token: c.token ?? cfg().token })); return true; } catch { return false; }
  }
  const canWrite = () => !!cfg().token;
  const label = (r) => `${r.owner}/${r.repo}`;

  // UTF-8 ↔ base64 (한글이 들어 있어 atob/btoa만으로는 깨진다)
  function b64decode(b64) {
    const bin = atob(b64.replace(/\n/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const apiUrl = (r, path) => `https://api.github.com/repos/${r.owner}/${r.repo}/contents/${path}`;
  function headers() {
    const h = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    const t = cfg().token;
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  // 한 저장소에서 파일 읽기 → { data, sha, missing }
  async function readRepo(r, path) {
    const res = await fetch(`${apiUrl(r, path)}?ref=${encodeURIComponent(r.branch)}&t=${Date.now()}`, { headers: headers(), cache: "no-store" });
    if (res.status === 404) return { data: null, sha: null, missing: true };
    if (res.status === 401) throw new Error("토큰이 올바르지 않거나 만료되었습니다(401).");
    if (!res.ok) { const e = new Error(`${label(r)} 읽기 실패 (${res.status})`); e.status = res.status; throw e; }
    const j = await res.json();
    const text = j.content ? b64decode(j.content) : await (await fetch(j.download_url, { cache: "no-store" })).text();
    return { data: JSON.parse(text), sha: j.sha, missing: false };
  }

  // 화면용 읽기: 기본 저장소 → (실패 시) 배포본
  async function load(path) {
    const p = path || ROUNDS;
    try {
      const r = await readRepo(PRIMARY, p);
      if (!r.missing) return { ...r, source: "github" };
    } catch (e) {
      if (String(e.message).includes("401")) throw e;
    }
    // golf2에는 data/가 없으므로 기록이 있는 golf-lounge 배포본을 읽는다
    const res = await fetch(`https://${PRIMARY.owner}.github.io/${PRIMARY.repo}/${p}?t=${Date.now()}`, { cache: "no-store" }).catch(() => null);
    return { data: res && res.ok ? await res.json() : null, sha: null, source: "pages" };
  }

  async function putRepo(r, path, obj, sha, message) {
    const res = await fetch(apiUrl(r, path), {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: b64encode(JSON.stringify(obj, null, 1) + "\n"), sha: sha || undefined, branch: r.branch }),
    });
    if (res.ok) return;
    const err = new Error(`${label(r)} 저장 실패 (${res.status})`);
    err.status = res.status;
    throw err;
  }

  // 한 저장소에 변경 적용. 다른 기기가 먼저 저장해 sha가 바뀌었으면(409/422) 최신본에 다시 적용
  async function updateRepo(r, mutate, message, path) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await readRepo(r, path);
      const next = mutate(cur.missing ? null : cur.data);
      try {
        await putRepo(r, path, next, cur.sha, message);
        return next;
      } catch (e) {
        if (e.status === 409 || e.status === 422) continue;
        if (e.status === 401 || e.status === 403 || e.status === 404) throw new Error(`${label(r)}에 쓸 권한이 없습니다. 토큰에 이 저장소의 Contents 읽기/쓰기 권한을 추가하세요.`);
        throw e;
      }
    }
    throw new Error(`${label(r)}: 다른 기기와 동시에 저장되어 충돌했습니다. 잠시 후 다시 저장하세요.`);
  }

  /* 기본 저장소에 저장한 뒤 동기화 저장소에도 같은 변경을 적용한다.
   * 동기화 쪽이 실패하면 기본 저장소 결과는 그대로 두고 '동기화 필요' 표시를 남긴다. 반환: { data, mirrorErrors } */
  async function update(mutate, message, path) {
    if (!canWrite()) throw new Error("GitHub 토큰이 없습니다. 설정에서 토큰을 넣어 주세요.");
    const p = path || ROUNDS;
    const data = await updateRepo(PRIMARY, mutate, message, p);
    const mirrorErrors = [];
    for (const m of MIRRORS) {
      try { await updateRepo(m, mutate, message + ` (${PRIMARY.repo}에서 동기화)`, p); } catch (e) { mirrorErrors.push(e.message); }
    }
    try {
      if (mirrorErrors.length) localStorage.setItem(KEY_PENDING, "1");
    } catch { /* 무시 */ }
    return { data, mirrorErrors };
  }

  /* 사진 같은 바이너리 파일: 기본 저장소와 동기화 저장소 모두에 같은 경로로 올린다(라운드 기록이 경로를 가리키므로).
   * b64는 파일 내용의 base64. 이미 있으면 덮어쓴다. */
  async function putFile(path, b64, message) {
    if (!canWrite()) throw new Error("GitHub 토큰이 없습니다. 설정에서 토큰을 넣어 주세요.");
    const errors = [];
    for (const [i, r] of [PRIMARY, ...MIRRORS].entries()) {
      try {
        const cur = await fetch(`${apiUrl(r, path)}?ref=${encodeURIComponent(r.branch)}`, { headers: headers(), cache: "no-store" });
        const sha = cur.ok ? (await cur.json()).sha : undefined;
        const res = await fetch(apiUrl(r, path), { method: "PUT", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ message, content: b64, sha, branch: r.branch }) });
        if (!res.ok) throw new Error(`${label(r)} 사진 저장 실패 (${res.status})`);
      } catch (e) {
        if (i === 0) throw e;   // 기본 저장소 실패는 저장 실패
        errors.push(e.message);
      }
    }
    return errors;
  }
  async function deleteFile(path, message) {
    if (!canWrite()) throw new Error("GitHub 토큰이 없습니다.");
    for (const r of [PRIMARY, ...MIRRORS]) {
      const cur = await fetch(`${apiUrl(r, path)}?ref=${encodeURIComponent(r.branch)}`, { headers: headers(), cache: "no-store" }).catch(() => null);
      if (!cur || !cur.ok) continue;   // 이미 없으면 그대로
      const { sha } = await cur.json();
      await fetch(apiUrl(r, path), { method: "DELETE", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ message, sha, branch: r.branch }) }).catch(() => null);
    }
  }
  // 저장소 파일을 브라우저에서 바로 볼 주소(공개 저장소라 토큰 없이 열림, 배포를 기다리지 않음)
  const rawUrl = (path) => `https://raw.githubusercontent.com/${PRIMARY.owner}/${PRIMARY.repo}/${PRIMARY.branch}/${path}`;

  // 동기화 상태: 두 저장소 파일이 같은지 비교
  async function syncStatus() {
    const out = [];
    for (const path of [ROUNDS, SETTINGS]) {
      const a = await readRepo(PRIMARY, path).catch((e) => ({ error: e.message }));
      for (const m of MIRRORS) {
        const b = await readRepo(m, path).catch((e) => ({ error: e.message }));
        const same = !a.error && !b.error && JSON.stringify(a.data) === JSON.stringify(b.data);
        const count = (x) => (Array.isArray(x?.data) ? x.data.length : null);
        out.push({ path, mirror: label(m), same, a: count(a), b: count(b), error: a.error || b.error || null });
      }
    }
    return out;
  }

  // 한 저장소(fromRepo) 내용으로 나머지 저장소를 모두 맞춘다
  async function resync(fromRepo, path) {
    if (!canWrite()) throw new Error("GitHub 토큰이 없습니다.");
    const all = [PRIMARY, ...MIRRORS];
    const src = all.find((r) => r.repo === fromRepo);
    const s = await readRepo(src, path);
    if (s.missing) throw new Error(`${label(src)}에 ${path}가 없습니다.`);
    for (const dst of all.filter((r) => r !== src)) await updateRepo(dst, () => s.data, `${label(src)} 기준으로 데이터 동기화`, path);
    try { localStorage.removeItem(KEY_PENDING); } catch { /* 무시 */ }
  }
  const pending = () => { if (!MIRRORS.length) return false; try { return localStorage.getItem(KEY_PENDING) === "1"; } catch { return false; } };

  async function testToken() {
    const results = [];
    for (const r of [PRIMARY, ...MIRRORS]) {
      const res = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}`, { headers: headers() });
      const j = res.ok ? await res.json() : {};
      results.push(`${r.repo}: ${res.ok && j.permissions && j.permissions.push ? "쓰기 가능" : "쓰기 권한 없음"}`);
    }
    const ok = results.every((x) => x.endsWith("쓰기 가능"));
    return { ok, msg: (ok ? "모든 저장소 저장 권한 확인됨" : "권한 확인 필요 — ") + " (" + results.join(", ") + ")" };
  }

  return { cfg, setCfg, canWrite, load, update, syncStatus, resync, pending, testToken, putFile, deleteFile, rawUrl, DATA_DIR, PRIMARY, MIRRORS, IS_ORIGIN, ORIGIN, ROUNDS, SETTINGS };
})();
