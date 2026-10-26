/* 골프 라운드 통계 계산 — 「골프 라운드 분석_v2.xlsx」의 수식과 같은 정의를 쓴다.
 * 홀 데이터(v2 홀별입력과 같은 항목):
 *   h 홀, par, dist 거리(m), hcp 핸디캡, score(+/-), fw FW 안착(1/0), miss 티샷 미스(L/R/H/S/-),
 *   drive 티샷 거리(m), ong 온그린 타수, putts, fp 1st 퍼트 거리(m),
 *   gmiss 그린 미스(짧음/길음/좌/우/-), appr 어프로치 시작거리(m), bunker 벙커샷 수, sg 숏게임 성공(1/0), pen 벌타, memo
 */
const GolfStats = (() => {
  const isNum = (v) => typeof v === "number" && !Number.isNaN(v);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : null);
  const ratio = (n, d) => (d ? n / d : null);

  const DEFAULT_SETTINGS = {
    // 레이더 0점/100점 기준 (v2 기준값 시트와 동일)
    radar: {
      fw: { label: "드라이빙", metric: "FW 안착률", zero: 0.2, full: 0.7 },
      gir: { label: "아이언", metric: "GIR 비율", zero: 0, full: 0.7 },
      scr: { label: "숏게임", metric: "스크램블", zero: 0, full: 0.6 },
      pph: { label: "퍼팅", metric: "홀당 퍼트", zero: 2.4, full: 1.75 },
      p3: { label: "3퍼트", metric: "18홀당 3퍼트 수", zero: 4, full: 1 },
      fp: { label: "거리감", metric: "1st 퍼트 거리(m)", zero: 15, full: 5 },
      crisis: { label: "위기관리", metric: "18홀당 벌타+더블+ 초과타", zero: 12, full: 0 },
    },
    radarTarget: 70,
    targets: {
      strokes: { label: "평균 타수", v: 89, low: true, fmt: "1" },
      parlow: { label: "파 이하 홀 수", v: 6, low: false, fmt: "1" },
      dbl: { label: "더블보기+ 홀 수", v: 3, low: true, fmt: "1" },
      putts: { label: "퍼트 수", v: 33, low: true, fmt: "1" },
      p3: { label: "3퍼트 수", v: 2, low: true, fmt: "1" },
      girp: { label: "GIR", v: 0.25, low: false, fmt: "%" },
      fwp: { label: "FW 안착", v: 0.5, low: false, fmt: "%" },
      scrp: { label: "스크램블", v: 0.25, low: false, fmt: "%" },
      pen: { label: "벌타", v: 2, low: true, fmt: "1" },
    },
  };
  const TARGET_BASIS = { strokes: "full", parlow: "full", dbl: "full", putts: "detail", p3: "detail", girp: "detail", fwp: "detail", scrp: "detail", pen: "detail" };

  const missSide = (m) => {
    const x = String(m || "").toUpperCase();
    return x === "L" || x === "H" ? "L" : x === "R" || x === "S" ? "R" : null;
  };

  // GIR: 온그린 타수 ≤ Par−2, 온그린 타수가 없으면 (타수−퍼트) ≤ Par−2. (v1.1부터 'GIR 직접' 입력은 없앴다)
  function holeGir(h) {
    if (!isNum(h.par)) return null;
    if (isNum(h.ong)) return h.ong <= h.par - 2 ? 1 : 0;
    if (isNum(h.putts) && isNum(h.score)) return h.par + h.score - h.putts <= h.par - 2 ? 1 : 0;
    return null;
  }
  // 기록 확인: 온그린 타수 + 퍼트 ≠ 타수
  const holeCheck = (h) => isNum(h.ong) && isNum(h.putts) && isNum(h.par) && isNum(h.score) && h.ong + h.putts !== h.par + h.score;

  function round(r) {
    const hs = (r.holes || []).filter((h) => isNum(h.score));
    const n = hs.length;
    const full = n === 18 && hs.every((h) => isNum(h.par));
    const out = {
      id: r.id, date: r.date, time: r.time || "", region: r.region || "", year: Number(String(r.date).slice(0, 4)), course: r.course, holes: n, full,
      over: sum(hs.map((h) => h.score)),
      strokes: full ? sum(hs.map((h) => h.par + h.score)) : null,
      front: full ? sum(hs.filter((h) => h.h <= 9).map((h) => h.par + h.score)) : null,
      back: full ? sum(hs.filter((h) => h.h > 9).map((h) => h.par + h.score)) : null,
      birdie: hs.filter((h) => h.score <= -1).length,
      parn: hs.filter((h) => h.score === 0).length,
      bogey: hs.filter((h) => h.score === 1).length,
      double: hs.filter((h) => h.score === 2).length,
      triple: hs.filter((h) => h.score >= 3).length,
      blow: sum(hs.map((h) => Math.max(0, h.score - 1))),
    };
    out.dbl = out.double + out.triple;
    out.parlow = out.birdie + out.parn;
    const pt = hs.filter((h) => isNum(h.putts));
    out.detail = pt.length > 0 && pt.length >= n;
    if (out.detail) {
      out.putts = sum(pt.map((h) => h.putts));
      out.p3 = pt.filter((h) => h.putts >= 3).length;
      out.p3loss = sum(pt.map((h) => Math.max(0, h.putts - 2)));
      out.onep = pt.filter((h) => h.putts === 1).length;
      out.pph = out.putts / pt.length;
      out.p3r = (out.p3 * 18) / pt.length;   // 18홀당 3퍼트 수(9홀만 기록한 라운드도 같은 잣대로 비교)
      const gs = hs.map(holeGir).filter((g) => g !== null);
      out.gir = sum(gs);
      out.girp = ratio(out.gir, gs.length);
      const miss = hs.filter((h) => holeGir(h) === 0);
      out.scrOp = miss.length;
      out.scrOk = miss.filter((h) => h.score <= 0).length;
      out.scrp = ratio(out.scrOk, miss.length);
      out.scrFail = out.scrOp - out.scrOk;
      const pens = hs.filter((h) => isNum(h.pen));
      out.pen = pens.length ? sum(pens.map((h) => h.pen)) : null;
      out.fp = avg(hs.filter((h) => isNum(h.fp) && h.fp > 0).map((h) => h.fp));
      out.crisis = n ? ((out.pen || 0) + out.blow) * 18 / n : null;
      const sgs = hs.filter((h) => isNum(h.sg));
      out.sgp = ratio(sgs.filter((h) => h.sg === 1).length, sgs.length);
    }
    const fws = hs.filter((h) => isNum(h.fw) && (!isNum(h.par) || h.par > 3));
    out.fw = fws.filter((h) => h.fw === 1).length;
    out.fwp = ratio(out.fw, fws.length);
    out.teeL = hs.filter((h) => missSide(h.miss) === "L").length;
    out.teeR = hs.filter((h) => missSide(h.miss) === "R").length;
    // 드라이버 거리: 파4·파5 티샷만(파3 티샷은 아이언이라 섞으면 평균이 내려간다)
    const drv = hs.filter((h) => isNum(h.drive) && h.drive > 0 && (!isNum(h.par) || h.par > 3)).map((h) => h.drive);
    out.drive = avg(drv);
    out.driveN = drv.length;
    out.driveMax = drv.length ? Math.max(...drv) : null;
    out.bunker = hs.some((h) => isNum(h.bunker)) ? sum(hs.filter((h) => isNum(h.bunker)).map((h) => h.bunker)) : null;
    out.checks = hs.filter(holeCheck).map((h) => h.h);
    for (const p of [3, 4, 5]) out["p" + p + "avg"] = avg(hs.filter((h) => h.par === p).map((h) => h.score));
    return out;
  }

  function radarScore(key, v, settings) {
    if (!isNum(v)) return null;
    const c = settings.radar[key];
    return Math.round(Math.max(0, Math.min(100, ((v - c.zero) / (c.full - c.zero)) * 100)));
  }
  const radarOf = (list, settings) => {
    const pick = (k) => avg(list.map((r) => r[k]).filter(isNum));
    const raw = { fw: pick("fwp"), gir: pick("girp"), scr: pick("scrp"), pph: pick("pph"), p3: pick("p3r"), fp: pick("fp"), crisis: pick("crisis") };
    return { raw, score: Object.fromEntries(Object.keys(settings.radar).map((k) => [k, radarScore(k, raw[k], settings)])) };
  };

  // 최근 순: 날짜 내림차순(같은 날짜면 나중에 입력한 것이 최근)
  function byRecent(list) {
    return list.map((x, i) => ({ x, i })).sort((a, b) => (a.x.date < b.x.date ? 1 : a.x.date > b.x.date ? -1 : b.i - a.i)).map((o) => o.x);
  }

  function analyze(rounds, settings) {
    const rs = rounds.map(round);
    const recent = byRecent(rs);
    const fulls = recent.filter((r) => r.full);
    const dets = recent.filter((r) => r.detail);
    const pick = (list, k) => list.map((r) => r[k]).filter(isNum);
    const metric = (key) => {
      const list = TARGET_BASIS[key] === "full" ? fulls : dets;
      return { all: avg(pick(list, key)), r5: avg(pick(list.slice(0, 5), key)), last: list.length ? list[0][key] : null, n: list.length };
    };
    const best = fulls.length ? fulls.reduce((b, r) => (r.strokes < b.strokes ? r : b)) : null;
    const d5 = dets.slice(0, 5);
    const loss = [["벌타", "pen"], ["3퍼트 손실타", "p3loss"], ["스크램블 실패(홀)", "scrFail"], ["더블+ 초과타", "blow"]]
      .map(([label, k]) => ({ label, all: avg(pick(dets, k)), r5: avg(pick(d5, k)) }));
    return {
      rs, recent, fulls, dets, best, metric, loss,
      radar: radarOf(d5, settings), radarAll: radarOf(dets, settings),
      courses: new Set(rs.map((r) => r.course)).size,
      tee: { L: sum(rs.map((r) => r.teeL)), R: sum(rs.map((r) => r.teeR)) },
    };
  }

  const agg = (hs) => ({
    n: hs.length,
    par: avg(hs.filter((h) => isNum(h.par)).map((h) => h.par)),
    over: avg(hs.map((h) => h.score)),
    strokes: avg(hs.filter((h) => isNum(h.par)).map((h) => h.par + h.score)),
    parlow: ratio(hs.filter((h) => h.score <= 0).length, hs.length),
    birdie: ratio(hs.filter((h) => h.score <= -1).length, hs.length),
    parExact: ratio(hs.filter((h) => h.score === 0).length, hs.length),
    bogey: ratio(hs.filter((h) => h.score === 1).length, hs.length),
    double: ratio(hs.filter((h) => h.score === 2).length, hs.length),
    triple: ratio(hs.filter((h) => h.score >= 3).length, hs.length),
    dbl: ratio(hs.filter((h) => h.score >= 2).length, hs.length),
    putts: avg(hs.filter((h) => isNum(h.putts)).map((h) => h.putts)),
    pen: avg(hs.filter((h) => isNum(h.pen)).map((h) => h.pen)),
  });

  function allHoles(rounds) {
    const out = [];
    for (const r of rounds) for (const h of r.holes || []) if (isNum(h.score)) out.push({ ...h, rid: r.id, year: Number(String(r.date).slice(0, 4)) });
    return out;
  }

  // 홀 단위 집계 (Par가 있는 홀)
  function holeLevel(rounds) {
    const all = allHoles(rounds).filter((h) => isNum(h.par));
    const years = [...new Set(all.map((h) => h.year))].sort();
    return {
      total: agg(all),
      byPar: Object.fromEntries([3, 4, 5].map((p) => [p, agg(all.filter((h) => h.par === p))])),
      byHole: Array.from({ length: 18 }, (_, i) => agg(all.filter((h) => h.h === i + 1))),
      byYearPar: years.map((y) => ({
        year: y,
        ...Object.fromEntries([3, 4, 5].map((p) => ["p" + p, agg(all.filter((h) => h.year === y && h.par === p)).over])),
        all: agg(all.filter((h) => h.year === y)).over,
      })),
    };
  }

  // v2 「상세분석」 시트와 같은 7개 블록. rid가 있으면 그 라운드만
  function detailBlocks(rounds, rid) {
    const hs = allHoles(rounds).filter((h) => !rid || h.rid === rid);
    const P45 = hs.filter((h) => isNum(h.par) && h.par > 3);
    const scr = (list) => {
      const miss = list.filter((h) => holeGir(h) === 0);
      return ratio(miss.filter((h) => h.score <= 0).length, miss.length);
    };
    const band = (list, k, lo, hi) => list.filter((h) => isNum(h[k]) && h[k] > lo && h[k] <= hi);
    const fwIn = agg(P45.filter((h) => h.fw === 1)), fwOut = agg(P45.filter((h) => h.fw === 0));
    return {
      n: hs.length,
      fw: { in: fwIn, out: fwOut, diff: isNum(fwIn.over) && isNum(fwOut.over) ? fwOut.over - fwIn.over : null },
      gir: { hit: agg(hs.filter((h) => holeGir(h) === 1)), miss: agg(hs.filter((h) => holeGir(h) === 0)) },
      fp: [["0~2m", 0, 2], ["2~5m", 2, 5], ["5~10m", 5, 10], ["10m 이상", 10, 999]].map(([l, a, b]) => {
        const x = band(hs, "fp", a, b).filter((h) => isNum(h.putts));
        return { l, n: x.length, putts: avg(x.map((h) => h.putts)), one: ratio(x.filter((h) => h.putts <= 1).length, x.length), three: ratio(x.filter((h) => h.putts >= 3).length, x.length) };
      }),
      par: [3, 4, 5].map((p) => ({ p, ...agg(hs.filter((h) => h.par === p)) })),
      miss: (() => {
        const tagged = hs.filter((h) => h.miss);
        return [["왼쪽 (L)", "L"], ["오른쪽 (R)", "R"], ["훅 (H)", "H"], ["슬라이스 (S)", "S"], ["미스 없음 (-)", "-"]].map(([l, c]) => {
          const x = tagged.filter((h) => String(h.miss).toUpperCase() === c);
          return { l, n: x.length, share: ratio(x.length, tagged.length), over: avg(x.map((h) => h.score)), pen: avg(x.filter((h) => isNum(h.pen)).map((h) => h.pen)) };
        });
      })(),
      hcp: [["핸디캡 1~6 (어려움)", 1, 6], ["핸디캡 7~12", 7, 12], ["핸디캡 13~18 (쉬움)", 13, 18]].map(([l, a, b]) => {
        const x = hs.filter((h) => isNum(h.hcp) && h.hcp >= a && h.hcp <= b);
        return { l, n: x.length, over: avg(x.map((h) => h.score)) };
      }).concat([["전반 9홀", 1, 9], ["후반 9홀", 10, 18]].map(([l, a, b]) => {
        const x = hs.filter((h) => h.h >= a && h.h <= b);
        return { l, n: x.length, over: avg(x.map((h) => h.score)) };
      })),
      green: [["짧음", "짧음"], ["길음", "길음"], ["좌", "좌"], ["우", "우"]].map(([l, c]) => {
        const x = hs.filter((h) => h.gmiss === c);
        return { l: "그린 미스 " + l, n: x.length, over: avg(x.map((h) => h.score)), scr: null };
      }).concat([["어프로치 10m 이내", 0, 10], ["어프로치 10~30m", 10, 30], ["어프로치 30m 이상", 30, 999]].map(([l, a, b]) => {
        const x = band(hs, "appr", a, b);
        return { l, n: x.length, over: avg(x.map((h) => h.score)), scr: scr(x) };
      })),
      // 드라이버(파4·파5 티샷) 거리대별 FW 안착·스코어
      drive: (() => {
        const x = hs.filter((h) => isNum(h.drive) && h.drive > 0 && (!isNum(h.par) || h.par > 3));
        const row = (l, list) => {
          const fw = list.filter((h) => isNum(h.fw));
          return { l, n: list.length, fwp: ratio(fw.filter((h) => h.fw === 1).length, fw.length), over: avg(list.map((h) => h.score)), dbl: ratio(list.filter((h) => h.score >= 2).length, list.length) };
        };
        return {
          n: x.length, avg: avg(x.map((h) => h.drive)), max: x.length ? Math.max(...x.map((h) => h.drive)) : null,
          bands: [["180m 미만", 0, 180], ["180~200m", 180, 200], ["200~220m", 200, 220], ["220m 이상", 220, 9999]].map(([l, a, b]) => row(l, x.filter((h) => h.drive >= a && h.drive < b))),
        };
      })(),
      // 거리(실제로 친 티 기준)가 기록된 홀만. 긴 홀과 짧은 홀 중 어디서 타수를 잃는지 본다
      len: (() => {
        const lenRow = (l, x) => {
          const g = x.map(holeGir).filter((v) => v !== null);
          return { l, n: x.length, over: avg(x.map((h) => h.score)), parlow: ratio(x.filter((h) => h.score <= 0).length, x.length), dbl: ratio(x.filter((h) => h.score >= 2).length, x.length), gir: ratio(sum(g), g.length) };
        };
        const withDist = hs.filter((h) => isNum(h.dist) && h.dist > 0);
        const band = (par, lo, hi) => withDist.filter((h) => h.par === par && h.dist >= lo && h.dist < hi);
        return {
          n: withDist.length,
          p4: [["300m 미만", 0, 300], ["300~340m", 300, 340], ["340m 이상", 340, 9999]].map(([l, a, b]) => lenRow(l, band(4, a, b))),
          p3: [["130m 미만", 0, 130], ["130~160m", 130, 160], ["160m 이상", 160, 9999]].map(([l, a, b]) => lenRow(l, band(3, a, b))),
          p5: [["450m 미만", 0, 450], ["450m 이상", 450, 9999]].map(([l, a, b]) => lenRow(l, band(5, a, b))),
        };
      })(),
    };
  }

  // ───── MyGolf 추가: 스코어 유형·안정성·추이·인사이트 ─────
  const SCORE_TYPES = [
    ["hio", "홀인원", (h) => h.par + h.score === 1],
    ["alb", "알바트로스", (h) => h.score <= -3 && h.par + h.score !== 1],
    ["eagle", "이글", (h) => h.score === -2 && h.par + h.score !== 1],
    ["birdie", "버디", (h) => h.score === -1 && h.par + h.score !== 1],
    ["par", "파", (h) => h.score === 0],
    ["bogey", "보기", (h) => h.score === 1],
    ["double", "더블보기", (h) => h.score === 2],
    ["triple", "트리플+", (h) => h.score >= 3],
  ];
  function scoreTypes(rounds) {
    return SCORE_TYPES.map(([key, label, fn]) => {
      const per = rounds.map((r) => ({ id: r.id, date: r.date, course: r.course, n: (r.holes || []).filter((h) => isNum(h.score) && isNum(h.par) && fn(h)).length })).filter((x) => x.n > 0);
      return { key, label, n: sum(per.map((x) => x.n)), rounds: per };
    });
  }

  function stability(fulls) {
    const xs = fulls.map((r) => r.strokes).filter(isNum);
    if (!xs.length) return null;
    const m = avg(xs);
    const sd = xs.length > 1 ? Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1)) : 0;
    return { n: xs.length, avg: m, sd, min: Math.min(...xs), max: Math.max(...xs), last10: avg(xs.slice(0, 10)) };
  }

  // 기간 길이에 따라 월/분기/연 단위로 묶는다 (1년 이하 월, 3년 이하 분기, 그 이상 연)
  function trendBuckets(rs, forceMonth) {
    const dated = rs.filter((r) => r.date).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!dated.length) return { unit: "월", buckets: [] };
    const days = (new Date(dated.at(-1).date) - new Date(dated[0].date)) / 864e5;
    const unit = forceMonth || days <= 366 ? "월" : days <= 366 * 3 ? "분기" : "연";
    const key = (d) => {
      const y = d.slice(0, 4), m = Number(d.slice(5, 7));
      return unit === "월" ? `${y}.${String(m).padStart(2, "0")}` : unit === "분기" ? `${y} Q${Math.ceil(m / 3)}` : y;
    };
    const map = new Map();
    for (const r of dated) {
      const k = key(r.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return { unit, buckets: [...map].map(([k, list]) => ({ k, n: list.length, avg: avg(list.filter((r) => r.full).map((r) => r.strokes)) })) };
  }

  function insights(rs, today = new Date()) {
    const dated = rs.filter((r) => r.date).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!dated.length) return null;
    const d = (s) => new Date(s + "T00:00:00");
    const iso = (x) => x.toISOString().slice(0, 10);
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const y = String(t0.getFullYear()), ym = iso(t0).slice(0, 7);
    const gaps = dated.slice(1).map((r, i) => (d(r.date) - d(dated[i].date)) / 864e5);
    const thisYear = dated.filter((r) => r.date.startsWith(y));
    const since90 = iso(new Date(t0 - 90 * 864e5));
    const r90 = dated.filter((r) => r.date >= since90);
    const weekend = dated.filter((r) => [0, 6].includes(d(r.date).getDay())).length;
    const timed = rs.filter((r) => /^\d{1,2}:\d{2}/.test(r.time || ""));
    const am = timed.filter((r) => Number(r.time.split(":")[0]) < 12);
    const pm = timed.filter((r) => Number(r.time.split(":")[0]) >= 12);
    const fullAvg = (list) => avg(list.filter((r) => r.full).map((r) => r.strokes));
    const best = (list) => { const f = list.filter((r) => r.full).map((r) => r.strokes); return f.length ? Math.min(...f) : null; };
    const dow = ["일", "월", "화", "수", "목", "금", "토"].map((l, i) => ({ l, n: dated.filter((r) => d(r.date).getDay() === i).length }));
    return {
      first: dated[0].date, last: dated.at(-1).date,
      daysSinceFirst: Math.round((t0 - d(dated[0].date)) / 864e5),
      daysSinceLast: Math.round((t0 - d(dated.at(-1).date)) / 864e5),
      avgGap: avg(gaps),
      thisYear: { n: thisYear.length, avg: fullAvg(thisYear), best: best(thisYear), courses: new Set(thisYear.map((r) => r.course)).size },
      thisMonth: { n: dated.filter((r) => r.date.startsWith(ym)).length, courses: new Set(dated.filter((r) => r.date.startsWith(ym)).map((r) => r.course)).size },
      d90: { n: r90.length, avg: fullAvg(r90), best: best(r90), list: r90.slice().reverse() },
      weekendShare: weekend / dated.length,
      dow,
      ampm: timed.length ? { am: { n: am.length, avg: fullAvg(am) }, pm: { n: pm.length, avg: fullAvg(pm) }, n: timed.length } : null,
    };
  }

  return { DEFAULT_SETTINGS, TARGET_BASIS, round, analyze, holeLevel, detailBlocks, holeGir, holeCheck, byRecent, isNum, avg, sum, scoreTypes, stability, trendBuckets, insights };
})();
