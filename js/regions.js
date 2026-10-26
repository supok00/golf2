/* 골프장 지역(시·도). 지역은 라운드마다 입력한다(round.region).
 * 새 라운드를 입력할 때는 같은 골프장의 최근 라운드 지역을, 없으면 아는 골프장 기본값을 제안한다. */
const Regions = (() => {
  // 한국 시·도 타일 지도 배치 [이름, 열, 행] — 대략적인 위치만 맞춘 칸 지도
  const TILES = [
    ["경기", 1, 0], ["강원", 2, 0],
    ["인천", 0, 1], ["서울", 1, 1], ["충북", 2, 1], ["경북", 3, 1],
    ["충남", 0, 2], ["세종", 1, 2], ["대전", 2, 2], ["대구", 3, 2],
    ["전북", 1, 3], ["경남", 2, 3], ["울산", 3, 3],
    ["광주", 0, 4], ["전남", 1, 4], ["부산", 3, 4],
    ["제주", 1, 5],
  ];
  const NAMES = [...TILES.map((t) => t[0]), "해외"];

  // 기본값: [지역, 추정 여부]
  const DEFAULTS = {
    "라헨느": ["제주"], "해비치": ["제주"], "엘리시안제주": ["제주"],
    "빅토리아CC": ["경기"], "더헤븐CC": ["경기"], "레이크사이드CC": ["경기"], "솔라고CC": ["충남"], "시그너스": ["충북"],
    "골프존카운티 안성W": ["경기"], "로제비앙 곤지암": ["경기"], "신라CC": ["경기"], "캐슬파인GC": ["경기"],
    "마이다스레이크 이천": ["경기"], "뉴서울CC": ["경기"], "기흥CC": ["경기"], "오크힐스CC": ["강원"], "양주CC": ["경기"],
    "안성베네스트GC": ["경기"], "인천그랜드CC": ["인천"], "포웰CC 안성": ["경기"], "드림파크CC": ["인천"],
    "에덴블루CC": ["경기", true], "무등산CC": ["광주", true], "벨라45CC": ["강원", true], "아세코밸리GC": ["경기", true],
    "남여주GC": ["경기"], "써닝포인트CC": ["경기"], "센추리21CC": ["강원"], "양지파인CC": ["경기"], "은화삼CC": ["경기"],
  };

  // 이 골프장에 넣을 지역 제안: 같은 골프장 최근 라운드의 지역 → 기본값 → 이름에 든 시·도 → 없음("")
  function suggest(course, rounds) {
    const prev = (rounds || []).filter((r) => r.course === course && r.region).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (prev) return prev.region;
    if (DEFAULTS[course]) return DEFAULTS[course][0];
    return NAMES.find((n) => String(course || "").includes(n)) || "";
  }
  // 라운드의 지역: 입력한 값, 없으면(예전 기록) 제안값, 그것도 없으면 '미지정'
  const of = (r, rounds) => r.region || suggest(r.course, rounds) || "미지정";

  /* 지역별 집계: { 지역: { courses: [{course, n, avg, best, last, lastScore}], rounds } }
   * rs: 통계용 라운드(GolfStats.round 결과, region 포함), rounds: 원본 라운드(지역 제안용) */
  function summarize(rs, rounds) {
    const S = GolfStats;
    const out = {};
    for (const r of rs) {
      const reg = of(r, rounds);
      (out[reg] = out[reg] || { rounds: 0, byCourse: new Map() }).rounds++;
      const m = out[reg].byCourse;
      if (!m.has(r.course)) m.set(r.course, []);
      m.get(r.course).push(r);
    }
    for (const reg of Object.keys(out)) {
      out[reg].courses = [...out[reg].byCourse].map(([course, list]) => {
        const recent = S.byRecent(list), fulls = list.filter((x) => x.full);
        return { course, n: list.length, avg: S.avg(fulls.map((x) => x.strokes)), best: fulls.length ? Math.min(...fulls.map((x) => x.strokes)) : null, last: recent[0].date, lastScore: recent[0].strokes };
      }).sort((a, b) => b.n - a.n || (a.last < b.last ? 1 : -1));
      delete out[reg].byCourse;
    }
    return out;
  }

  /* 실제 지도(SVG): 지역을 방문 골프장 수만큼 진하게 칠하고, 숫자 말풍선을 올린다.
   * 서울·인천처럼 작은 지역은 이름이 겹치지 않게 말풍선을 옆으로 빼고 가는 선으로 잇는다. */
  const LABEL = {   // [x, y] — 기본 위치(지역 중심)에서 옮긴 말풍선 자리
    경기: [292, 108], 서울: [236, 92], 인천: [172, 150], 세종: [222, 226], 대전: [300, 302],
    광주: [196, 432], 대구: [430, 318], 울산: [492, 360], 부산: [470, 448], 충남: [196, 285],
  };
  function svg(RS) {
    if (typeof KoreaMap === "undefined") return "";
    const lv = (n) => (!n ? "l0" : n <= 2 ? "l1" : n <= 5 ? "l2" : "l3");
    // 제주는 실제 위치가 멀어 지도가 길어지므로 위로 올려 붙인다(지도 관례상 인셋 배치)
    const JEJU_UP = 75;
    const vb = [KoreaMap.viewBox[0], KoreaMap.viewBox[1], KoreaMap.viewBox[2], KoreaMap.viewBox[3] - JEJU_UP];
    const tf = (n) => (n === "제주" ? ` transform="translate(0,-${JEJU_UP})"` : "");
    const shapes = KoreaMap.regions.map((r) => {
      const n = RS[r.n] ? RS[r.n].courses.length : 0;
      return `<path class="kr ${lv(n)}" data-reg="${r.n}" d="${r.d}"${tf(r.n)}><title>${r.n} ${n}곳</title></path>`;
    }).join("");
    const labels = KoreaMap.regions.map((r) => {
      const x = RS[r.n], n = x ? x.courses.length : 0;
      const [cx, cy] = r.c, [lx, ly] = LABEL[r.n] || r.c;
      const moved = LABEL[r.n] && (Math.abs(lx - cx) > 4 || Math.abs(ly - cy) > 4);
      const line = moved ? `<line class="kl" x1="${cx}" y1="${cy}" x2="${lx}" y2="${ly}"/><circle class="kd" cx="${cx}" cy="${cy}" r="2.5"/>` : "";
      if (!n) return `<text class="kn0" x="${lx}" y="${ly + 4}"${tf(r.n)}>${r.n}</text>`;
      return `<g class="kb" data-reg="${r.n}"${tf(r.n)}>${line}<circle cx="${lx}" cy="${ly}" r="19"/><text class="kc" x="${lx}" y="${ly + 2}">${n}곳</text><text class="kn" x="${lx}" y="${ly + 14}">${r.n}</text></g>`;
    }).join("");
    return `<svg class="kmap-svg" viewBox="${vb.join(" ")}" role="img" aria-label="대한민국 지역별 방문 골프장 수">${shapes}${labels}</svg>`;
  }

  return { TILES, NAMES, DEFAULTS, suggest, of, summarize, svg };
})();
