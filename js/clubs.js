/* 내 클럽 거리표와, 그걸로 만드는 공략 가이드·추정 분석.
 * 필드에서 샷마다 입력하지 않아도 되도록, 이미 기록하는 '홀 거리'와 설정의 클럽 거리만 쓴다.
 * 실제로 어떤 클럽을 쳤는지는 모르므로 모든 결과는 '추정'이다(티샷은 드라이버 평균 거리로 가정).
 */
const Clubs = (() => {
  // 예시값(남성 아마추어 평균 정도). 설정에서 내 거리로 바꿔 쓴다.
  const DEFAULT_BAG = [
    ["D", "드라이버", 210], ["3W", "3번 우드", 190], ["5W", "5번 우드", 175], ["UT", "유틸리티", 165],
    ["4i", "4번 아이언", 160], ["5i", "5번 아이언", 150], ["6i", "6번 아이언", 140], ["7i", "7번 아이언", 130],
    ["8i", "8번 아이언", 120], ["9i", "9번 아이언", 110], ["PW", "피칭 웨지", 100], ["AW", "어프로치 웨지(50°)", 85],
    ["SW", "샌드 웨지(56°)", 70], ["LW", "로브 웨지(58°)", 55],
  ].map(([key, label, dist]) => ({ key, label, dist, on: key !== "4i" && key !== "LW" }));

  const bag = (settings) => {
    const saved = settings && Array.isArray(settings.clubs) ? settings.clubs : null;
    return (saved || DEFAULT_BAG).filter((c) => c.on && c.dist > 0).slice().sort((a, b) => b.dist - a.dist);
  };
  const isDefault = (settings) => !(settings && Array.isArray(settings.clubs));

  // 남은 거리에 맞는 클럽: 가장 가까운 거리, 같으면 긴 쪽(짧게 치는 실수가 더 흔하다)
  function pick(bagList, remain, exclude = []) {
    const list = bagList.filter((c) => !exclude.includes(c.key));
    if (!list.length) return null;
    const shortest = list.at(-1);
    if (remain < shortest.dist * 0.75) return { key: "chip", label: "어프로치(컨트롤 샷)", dist: Math.round(remain) };
    return list.reduce((b, c) => (Math.abs(c.dist - remain) < Math.abs(b.dist - remain) || (Math.abs(c.dist - remain) === Math.abs(b.dist - remain) && c.dist > b.dist) ? c : b));
  }

  /* 홀 공략 추정. 반환: { steps:[{label, dist, remain}], approach: 클럽, text } */
  function plan(par, dist, bagList) {
    if (!(par >= 3) || !(dist > 0) || !bagList.length) return null;
    if (par === 3) {
      const c = pick(bagList, dist, ["D"]);
      return { approach: c, steps: [{ label: c.label, dist: c.dist, remain: 0 }], text: `티샷 ${c.label}(${c.dist}m)` };
    }
    const driver = bagList.find((c) => c.key === "D") || bagList[0];
    let remain = dist - driver.dist;
    const steps = [{ label: driver.label, dist: driver.dist, remain: Math.max(0, remain) }];
    if (par >= 5 && remain > 0) {
      // 파5 두 번째 샷: 남은 거리를 한 번에 못 가면 '좋아하는 웨지 거리'를 남기도록 레이업
      const longest = bagList.find((c) => c.key !== "D") || driver;
      const wedge = bagList.find((c) => c.key === "PW") || bagList.at(-1);
      let second;
      if (remain <= longest.dist) second = pick(bagList, remain, ["D"]);
      else second = pick(bagList, Math.max(remain - wedge.dist, 0), ["D"]) || longest;
      if (remain > longest.dist) {
        remain -= second.dist;
        steps.push({ label: second.label, dist: second.dist, remain: Math.max(0, remain) });
      }
    }
    if (remain <= 15) return { approach: { key: "near", label: "그린 근처", dist: 0 }, steps, text: `${steps.map((s) => `${s.label}(${s.dist}m)`).join(" → ")} → 그린 근처까지. 티샷을 짧은 클럽으로 바꿔 원하는 거리를 남기는 것도 방법` };
    const ap = pick(bagList, remain, ["D"]);
    return { approach: ap, steps, text: `${steps.map((s) => `${s.label}(${s.dist}m)`).join(" → ")} → 남은 약 ${Math.round(remain)}m → <b>${ap.label}</b>${ap.key !== "chip" ? `(${ap.dist}m)` : ""}` };
  }

  // 클럽 간 거리 차이 점검: 너무 붙으면 겹치는 클럽, 너무 벌어지면 빈 구간
  function gaps(bagList) {
    const out = [];
    for (let i = 1; i < bagList.length; i++) {
      const a = bagList[i - 1], b = bagList[i], g = a.dist - b.dist;
      if (g <= 5) out.push({ type: "겹침", text: `${a.label}(${a.dist}m)와 ${b.label}(${b.dist}m) 차이 ${g}m — 거의 같은 거리, 한 개는 빼도 됨` });
      else if (g >= 20 && a.key !== "D") out.push({ type: "빈 구간", text: `${a.label}(${a.dist}m)와 ${b.label}(${b.dist}m) 사이 ${g}m — 이 거리가 남으면 애매함` });
    }
    return out;
  }

  /* 예상 어프로치 클럽별 성적: 홀 거리로 그린을 노리는 클럽을 추정해 GIR·평균 스코어를 묶는다 */
  function approachStats(rounds, settings, rid) {
    const S = GolfStats;
    const list = bag(settings);
    const rows = new Map();
    for (const r of rounds) {
      if (rid && r.id !== rid) continue;
      for (const h of r.holes || []) {
        if (!S.isNum(h.score) || !S.isNum(h.par) || !(h.dist > 0)) continue;
        const p = plan(h.par, h.dist, list);
        if (!p) continue;
        const k = p.approach.key;
        if (!rows.has(k)) rows.set(k, { key: k, label: p.approach.label, dist: p.approach.dist, holes: [] });
        rows.get(k).holes.push(h);
      }
    }
    const order = (k) => { const i = list.findIndex((c) => c.key === k); return i < 0 ? (k === "chip" ? 98 : 99) : i; };
    return [...rows.values()].sort((a, b) => order(a.key) - order(b.key)).map((x) => {
      const g = x.holes.map(S.holeGir).filter((v) => v !== null);
      return {
        label: x.label, dist: x.dist, n: x.holes.length,
        over: S.avg(x.holes.map((h) => h.score)),
        gir: g.length ? S.sum(g) / g.length : null, girN: g.length,
        dbl: x.holes.filter((h) => h.score >= 2).length / x.holes.length,
      };
    });
  }

  return { DEFAULT_BAG, bag, isDefault, plan, gaps, approachStats };
})();
