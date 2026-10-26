/* 네이버 스마트스코어 「홀별 스코어」 텍스트를 라운드로 바꾼다.
 * 한 라운드의 모양(여러 라운드를 이어 붙여도 됨):
 *   골프장명
 *   전반코스, 후반코스        (없으면 "-")
 *   2025-01-19 11:15
 *   96                         (총타수)
 *   ...
 *   Par    4  3  4 ... 36
 *   Score  1  2  2 ... 45     (파 기준 +/-, 마지막 칸은 9홀 타수 합계)
 *   Par / Score (후반)
 * 홀 길이는 스마트스코어 텍스트에 없으므로, 원하면 각 반쪽의 Par/Score 아래에 직접 한 줄 더 적는다:
 *   거리 343 155 318 ...      (단위 m)
 *   White 343 155 318 ...     (티 이름을 앞에 쓰면 그 티로 기록)
 *   Yard 375 170 348 ...      (야드는 m로 바꿔 저장)
 * 라운드 사이가 ", 다음골프장"처럼 한 줄에 붙어 와도 나눈다.
 */
const SmartScore = (() => {
  const DATE = /^(\d{4})[-.](\d{1,2})[-.](\d{1,2})(?:\s+(\d{1,2}:\d{2}))?\s*$/;
  // 거리 줄 머리말: 거리/Dist/m/Yard 또는 티 이름
  const TEES = { white: "White", 화이트: "White", blue: "Blue", 블루: "Blue", red: "Red", 레드: "Red", black: "Black", 블랙: "Black", gold: "Gold", 골드: "Gold", champion: "Champion", 챔피언: "Champion" };
  const DIST_ROW = /^(거리|홀\s*길이|길이|dist(?:ance)?|meters?|미터|m|yards?|yds?|yd|y|white|화이트|blue|블루|red|레드|black|블랙|gold|골드|champion|챔피언)(?:\s*\((m|y|yd|yard|미터|야드)\))?\s*[:：]?\s+(?=-?\d)/i;
  const ints = (s) => (s.match(/-?\d+/g) || []).map(Number);
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  function normalize(text) {
    const out = [];
    for (let line of String(text).replace(/\r/g, "").split("\n")) {
      line = line.replace(/\t/g, " ").trim();
      // "Score ... 51, 인천그랜드CC" / "거리 ... 470, 기흥CC" → 숫자 줄과 다음 골프장 줄로 나눈다
      if (/^(score|par)\b/i.test(line) || DIST_ROW.test(line)) {
        const m = line.match(/^(.*\d)\s*,\s*(\D.*)$/);
        if (m) { out.push(m[1].trim(), m[2].trim()); continue; }
      }
      out.push(line.replace(/^,\s*/, ""));
    }
    return out;
  }

  function prevNonEmpty(lines, i) {
    for (let j = i - 1; j >= 0; j--) if (lines[j]) return j;
    return -1;
  }

  // Par 줄의 마지막 숫자가 앞 숫자들의 합이면 합계 칸으로 보고 뺀다
  function nine(parNums, scoreNums) {
    let k = parNums.length;
    if (k >= 2 && parNums[k - 1] === sum(parNums.slice(0, k - 1))) k -= 1;
    const pars = parNums.slice(0, k);
    const scores = scoreNums.slice(0, k);
    const statedStrokes = scoreNums.length > k ? scoreNums[k] : null;
    return { pars, scores, statedStrokes };
  }

  function parse(text) {
    const lines = normalize(text);
    const dateIdx = lines.map((l, i) => (DATE.test(l) ? i : -1)).filter((i) => i >= 0);
    const rounds = [];
    dateIdx.forEach((di, n) => {
      const warnings = [];
      const [, y, mo, d, time] = lines[di].match(DATE);
      const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const ci = prevNonEmpty(lines, di);          // 코스 줄
      const gi = prevNonEmpty(lines, ci);          // 골프장 줄
      let course = gi >= 0 ? lines[gi] : "";
      let courses = ci >= 0 ? lines[ci] : "";
      // 코스 줄이 없고 바로 골프장명이 오는 경우
      if (/^\d/.test(course) || /^(par|score|홀)\b/i.test(course)) { course = courses; courses = ""; }
      const parts = courses.split(",").map((s) => s.trim()).filter((s) => s && s !== "-");
      const end = n + 1 < dateIdx.length ? prevNonEmpty(lines, prevNonEmpty(lines, dateIdx[n + 1])) : lines.length;
      let statedTotal = null;
      const ti = lines.findIndex((l, i) => i > di && l);
      if (ti > 0 && /^\d{2,3}$/.test(lines[ti])) statedTotal = Number(lines[ti]);

      const rows = lines.slice(di + 1, end).filter((l) => /^(par|score)\b/i.test(l) || DIST_ROW.test(l));
      const pars = rows.filter((l) => /^par/i.test(l)).map((l) => ints(l.slice(3)));
      const scores = rows.filter((l) => /^score/i.test(l)).map((l) => ints(l.slice(5)));
      // 거리 줄: 반쪽(전반/후반)마다 Par 줄 뒤에 나온 순서대로 짝짓는다
      let tee = "";
      const dists = rows.filter((l) => DIST_ROW.test(l)).map((l) => {
        const m = l.match(DIST_ROW);
        const head = m[1].toLowerCase();
        if (TEES[head]) tee = TEES[head];
        const yard = /^(yards?|yds?|yd|y)$/.test(head) || /^(y|yd|yard|야드)$/i.test(m[2] || "");
        return { nums: ints(l.slice(m[0].length)), yard };
      });
      // 18홀 거리를 한 줄에 적은 경우: 합계 칸을 빼고 전반·후반으로 나눈다
      if (dists.length === 1 && pars.length >= 2) {
        let a = dists[0].nums;
        if (a.length === 20) a = [...a.slice(0, 9), ...a.slice(10, 19)];
        else if (a.length === 19 && a[18] === sum(a.slice(0, 18))) a = a.slice(0, 18);
        if (a.length === 18) dists.splice(0, 1, { ...dists[0], nums: a.slice(0, 9) }, { ...dists[0], nums: a.slice(9) });
      }
      const holes = [];
      for (let half = 0; half < Math.min(2, pars.length, scores.length); half++) {
        const x = nine(pars[half], scores[half]);
        const sumStrokes = sum(x.pars) + sum(x.scores);
        if (x.statedStrokes !== null && x.statedStrokes !== sumStrokes) warnings.push(`${half ? "후반" : "전반"} 합계 불일치(표기 ${x.statedStrokes}, 계산 ${sumStrokes})`);
        const dr = dists[half];
        let dv = null;
        if (dr) {
          let nums = dr.nums;
          if (nums.length === x.pars.length + 1 && nums.at(-1) === sum(nums.slice(0, -1))) nums = nums.slice(0, -1);   // 합계 칸
          if (nums.length !== x.pars.length) warnings.push(`${half ? "후반" : "전반"} 거리 ${nums.length}개(홀 ${x.pars.length}개와 다름) — 거리는 넣지 않음`);
          else dv = nums.map((v) => (dr.yard ? Math.round(v * 0.9144) : v));
        }
        x.pars.forEach((p, i) => holes.push({ h: half * 9 + i + 1, par: p, score: x.scores[i], ...(dv && dv[i] > 0 ? { dist: dv[i] } : {}) }));
      }
      if (dists.length > Math.min(2, pars.length)) warnings.push("거리 줄이 반쪽 수보다 많습니다");
      const total = holes.length ? sum(holes.map((h) => h.par + h.score)) : null;
      if (!holes.length) warnings.push("Par/Score 줄을 찾지 못했습니다");
      else if (holes.length !== 18) warnings.push(`${holes.length}홀만 읽었습니다`);
      if (statedTotal !== null && total !== null && statedTotal !== total) warnings.push(`총타수 불일치(표기 ${statedTotal}, 계산 ${total})`);
      const distCount = holes.filter((h) => h.dist).length;
      // block: 이 라운드 부분의 원문 — 동반자 줄(「이름 숫자…」)은 Companions.parse가 따로 읽는다
      rounds.push({ date, time: time || "", course: course.trim(), front: parts[0] || "", back: parts[1] || "", tee, distCount, statedTotal, total, holes, warnings, block: lines.slice(di + 1, end).join("\n") });
    });
    return rounds;
  }

  // 이미 쓰는 골프장 이름과 맞춰 본다 (띄어쓰기·컨트리클럽/골프클럽 표기 차이)
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "").replace(/컨트리클럽|countryclub/g, "cc").replace(/골프클럽|골프앤리조트|골프리조트|golfclub/g, "gc").replace(/[()]/g, "");
  function matchCourse(name, known) {
    const n = norm(name);
    if (!n) return name;
    const exact = known.find((k) => norm(k) === n);
    if (exact) return exact;
    const pre = known.filter((k) => { const kk = norm(k); return kk.length >= 3 && (n.startsWith(kk) || kk.startsWith(n)); }).sort((a, b) => b.length - a.length);
    return pre[0] || name;
  }

  return { parse, matchCourse };
})();
if (typeof module !== "undefined") module.exports = SmartScore;
