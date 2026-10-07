// ルールベースのフレーズ生成
// フレーズ: { id, bars, notes:[{p:MIDI, s:開始(16分), d:長さ(16分)}], chords:[コード×小節数], origin, tag }

import { scalePitches } from './theory.js';

export const STEPS_PER_BAR = 16;

const rand = Math.random;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function weighted(items, weights) {
  let sum = 0;
  for (const w of weights) sum += w;
  if (sum <= 0) return items[Math.floor(rand() * items.length)];
  let r = rand() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

let idCounter = 0;
export const newId = () => Date.now().toString(36) + (idCounter++).toString(36) + Math.floor(rand() * 1e4).toString(36);

// ---------- リズム ----------
// 1拍(4ステップ)単位のセル。負数は休符。[音数の目安, セル]
const BEAT_CELLS = [
  { c: [4], dens: 0.15 },
  { c: [2, 2], dens: 0.5 },
  { c: [3, 1], dens: 0.5 },
  { c: [1, 1, 2], dens: 0.75 },
  { c: [2, 1, 1], dens: 0.75 },
  { c: [1, 2, 1], dens: 0.7 },
  { c: [1, 1, 1, 1], dens: 1.0 },
  { c: [-2, 2], dens: 0.35 },
  { c: [2, -2], dens: 0.3 },
  { c: [-1, 1, 2], dens: 0.6 },
  { c: [-4], dens: 0.0 },
];
// 2拍単位のセル（拍頭 0 or 8 からのみ）
const HALF_CELLS = [
  { c: [8], dens: 0.05 },
  { c: [6, 2], dens: 0.3 },
  { c: [3, 3, 2], dens: 0.6 },
  { c: [2, 4, 2], dens: 0.45 },
  { c: [6, -2], dens: 0.2 },
];

function chooseCell(cells, density) {
  return weighted(cells, cells.map((x) => Math.exp(-Math.abs(x.dens - density) * 4) * (x.c[0] === -4 ? 0.3 : 1))).c;
}

function barRhythm(density, isLast) {
  const out = []; // [{s,d}]
  // 同じリズムセルを全拍で繰り返す小節（刻み・オスティナート）
  const ostinato = rand() < 0.35 ? chooseCell(BEAT_CELLS.filter((x) => x.c[0] > 0 && x.c.length > 1), density) : null;
  let s = 0;
  while (s < STEPS_PER_BAR) {
    let cell;
    if (ostinato) cell = ostinato;
    else if (s % 8 === 0 && rand() < 0.3) cell = chooseCell(HALF_CELLS, density);
    else cell = chooseCell(BEAT_CELLS, density);
    // フレーズ最後の拍は落ち着かせる
    if (isLast && s >= 12) cell = pick([[4], [4], [2, 2], [-2, 2], [2, -2]]);
    if (isLast && s === 8 && !ostinato && rand() < 0.35) cell = pick([[8], [6, 2]]);
    for (const v of cell) {
      if (v > 0) out.push({ s, d: v });
      s += Math.abs(v);
    }
  }
  return out;
}

// copyOf: 1小節目のどの音のリズムを写したか（音程も写す手がかりになる）
export function genRhythm(bars, density = 0.3 + rand() * 0.5) {
  const first = barRhythm(density, bars === 1);
  const all = first.map((n) => ({ ...n }));
  for (let b = 1; b < bars; b++) {
    const isLast = b === bars - 1;
    if (rand() < 0.55) {
      // 動機の反復（最後の拍だけ変える）
      first.forEach((n, k) => {
        if (n.s + n.d <= 12) all.push({ s: n.s + b * STEPS_PER_BAR, d: n.d, copyOf: k });
      });
      for (const n of barRhythm(density, isLast)) if (n.s >= 12) all.push({ s: n.s + b * STEPS_PER_BAR, d: n.d });
    } else {
      for (const n of barRhythm(density, isLast)) all.push({ s: n.s + b * STEPS_PER_BAR, d: n.d });
    }
  }
  if (all.length < 2) return genRhythm(bars, density + 0.2);
  return all;
}

// ---------- 音程 ----------
function rangeFor(key) {
  const tonic = 60 + key > 66 ? 48 + key : 60 + key; // 主音を G3〜F#4 に置く
  return { lo: tonic - 3, hi: tonic + 16 };
}

const CONTOURS = {
  arch: (t) => Math.sin(Math.PI * t) * 5,
  rise: (t) => t * 6 - 2,
  fall: (t) => 4 - t * 6,
  valley: (t) => -Math.sin(Math.PI * t) * 4 + 2,
  wave: (t) => Math.sin(2 * Math.PI * t) * 3,
};

function isChordTone(p, chord) {
  return chord.pcs.includes(((p % 12) + 12) % 12);
}

// 半小節ごとの音程パターン
//  walk: 1音ずつ選ぶ / repeat: 同音連打 / alternate: 2音交互 / run: 音階を一方向に / echo: 前の半小節をなぞる
const MODES = ['walk', 'repeat', 'alternate', 'run'];
const MODE_W = { walk: 1, repeat: 0.45, alternate: 0.5, run: 0.4 };

// rhythm に音程を割り当てる
// opts.target: 各音の目標音高（派生用。指定時はパターンを使わない）, opts.prevPitch: 直前の音（文脈）
export function assignPitches(rhythm, ctx, opts = {}) {
  const { key, scale, chords, bars } = ctx;
  const { lo, hi } = rangeFor(key);
  const pool = scalePitches(key, scale, lo, hi);
  const center = (lo + hi) / 2;
  const contour = opts.contour || CONTOURS[pick(Object.keys(CONTOURS))];
  const total = bars * STEPS_PER_BAR;
  const usePatterns = !opts.target;
  // フレーズごとに得意なパターンを1つ決め、極端に繰り返すフレーズも出るようにする
  const style = usePatterns ? weighted([...MODES, 'echo'], [1.2, 1, 1, 0.8, 1]) : 'walk';

  let prev = opts.prevPitch;
  if (prev == null || prev < lo - 5 || prev > hi + 5) prev = Math.round(center + (rand() - 0.5) * 6);
  let prevInterval = 0;
  let repeat = 0;
  const out = [];

  const chordAt = (n) => chords[Math.floor(n.s / STEPS_PER_BAR) % chords.length];
  const targetAt = (i) => (opts.target ? opts.target[i] : center + contour(rhythm[i].s / total));
  // 強拍・長い音・最後の音はコードトーン
  const needsCT = (i) => rhythm[i].s % 8 === 0 || rhythm[i].d >= 4 || i === rhythm.length - 1;

  // 1音ずつ重み付きで選ぶ
  const choose = (i) => {
    const n = rhythm[i];
    const chord = chordAt(n);
    const strong = needsCT(i);
    const last = i === rhythm.length - 1;
    const target = targetAt(i);
    const prevIdx = nearestIndex(pool, prev);
    const cands = pool.filter((c) => Math.abs(c - prev) <= 9);
    const weights = cands.map((c) => {
      const ct = isChordTone(c, chord);
      if (strong && !ct) return 0;
      const steps = Math.abs(nearestIndex(pool, c) - prevIdx);
      const semis = Math.abs(c - prev);
      let w = [0.8, 3, 1.6, 0.6, 0.35, 0.12, 0.08, 0.05][Math.min(steps, 7)];
      if (i === 0 && opts.prevPitch == null) w = 1;
      if (semis === 6) w *= 0.15;
      if (ct) w *= strong ? 1 : 1.3;
      // 跳躍の後は反対方向へ順次進行
      if (Math.abs(prevInterval) >= 5) {
        const dir = Math.sign(c - prev);
        if (dir === -Math.sign(prevInterval) && steps <= 2) w *= 3;
        else if (dir === Math.sign(prevInterval)) w *= 0.25;
      }
      if (c === prev && repeat >= 2) w *= 0.2;
      w *= Math.exp(-Math.abs(c - target) / (opts.target ? 2 : 5));
      if (last && (((c - chord.rootPc) % 12) + 12) % 12 === 0) w *= 2.5;
      return w;
    });
    const p = weighted(cands, weights);
    return p == null ? prev : p;
  };

  // コードトーンが必要な位置なら最寄りのコードトーンへ寄せて確定
  const place = (i, p) => {
    p = Math.max(pool[0], Math.min(pool[pool.length - 1], p));
    if (needsCT(i) && !isChordTone(p, chordAt(rhythm[i]))) {
      const cts = pool.filter((c) => isChordTone(c, chordAt(rhythm[i])));
      p = cts.reduce((a, c) => (Math.abs(c - p) < Math.abs(a - p) || (Math.abs(c - p) === Math.abs(a - p) && Math.abs(c - prev) < Math.abs(a - prev)) ? c : a), cts[0]);
    }
    prevInterval = p - prev;
    repeat = p === prev ? repeat + 1 : 0;
    prev = p;
    out[i] = { p, s: rhythm[i].s, d: rhythm[i].d };
  };

  // 元の音列を音階上でずらして写す（反復/ゼクエンツ）。強拍がコードトーンに乗るずらし幅を選ぶ
  const copyPitches = (idxs, srcPitches) => {
    let best = 0;
    let bestScore = -Infinity;
    for (let sh = -3; sh <= 3; sh++) {
      let score = sh === 0 ? 0.6 : -Math.abs(sh) * 0.25;
      idxs.forEach((i, k) => {
        const ni = nearestIndex(pool, srcPitches[k]) + sh;
        if (ni < 0 || ni >= pool.length) score -= 5;
        else if (needsCT(i) && isChordTone(pool[ni], chordAt(rhythm[i]))) score += 1;
      });
      score += rand() * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = sh;
      }
    }
    idxs.forEach((i, k) => {
      const ni = Math.max(0, Math.min(pool.length - 1, nearestIndex(pool, srcPitches[k]) + best));
      place(i, pool[ni]);
    });
  };

  // 半小節ごとにまとめる
  const groups = [];
  rhythm.forEach((n, i) => {
    const g = Math.floor(n.s / 8);
    if (!groups[g]) groups[g] = [];
    groups[g].push(i);
  });
  const shape = (idxs) => idxs.map((i) => `${rhythm[i].s % 8}:${rhythm[i].d}`).join(',');
  const done = []; // 確定済みの半小節 [{shape, pitches}]
  let pairOffset = null; // 2音交互の相方（音階上の距離）

  for (const idxs of groups) {
    if (!idxs) continue;
    // 1小節目のリズムを写した音は、音程も写す
    const copied = usePatterns ? idxs.filter((i) => rhythm[i].copyOf != null && out[rhythm[i].copyOf]) : [];
    if (copied.length && rand() < 0.75) {
      copyPitches(copied, copied.map((i) => out[rhythm[i].copyOf].p));
    }
    const rest = idxs.filter((i) => !out[i]);
    if (!rest.length) {
      done.push({ shape: shape(idxs), pitches: idxs.map((i) => out[i].p) });
      continue;
    }

    let mode = 'walk';
    const echoSrc = done.filter((d) => d.shape === shape(rest));
    if (usePatterns) {
      const w = MODES.map((m) => MODE_W[m] * (m === style ? 4 : 1));
      const modes = [...MODES];
      if (echoSrc.length) {
        modes.push('echo');
        w.push(style === 'echo' ? 4 : 1);
      }
      mode = weighted(modes, w);
      if (rest.length === 1 && mode !== 'echo') mode = 'walk';
    }

    if (mode === 'echo') {
      copyPitches(rest, echoSrc[echoSrc.length - 1].pitches);
    } else if (mode === 'repeat') {
      place(rest[0], choose(rest[0]));
      for (const i of rest.slice(1)) place(i, prev);
    } else if (mode === 'alternate') {
      place(rest[0], choose(rest[0]));
      const a = prev;
      if (pairOffset == null || style !== 'alternate') {
        const up = targetAt(rest[0]) >= a;
        pairOffset = weighted([1, 2, -1, -2, 3, -3], up ? [3, 2, 1.5, 1, 0.6, 0.3] : [1.5, 1, 3, 2, 0.3, 0.6]);
      }
      const ai = nearestIndex(pool, a);
      let bi = ai + pairOffset;
      if (bi < 0 || bi >= pool.length) bi = ai - pairOffset;
      const b = pool[Math.max(0, Math.min(pool.length - 1, bi))];
      rest.slice(1).forEach((i, k) => place(i, k % 2 === 0 ? b : a));
    } else if (mode === 'run') {
      place(rest[0], choose(rest[0]));
      let dir = targetAt(rest[rest.length - 1]) >= prev ? 1 : -1;
      if (rand() < 0.25) dir = -dir;
      for (const i of rest.slice(1)) {
        let ni = nearestIndex(pool, prev) + dir;
        if (ni < 0 || ni >= pool.length) {
          dir = -dir;
          ni = nearestIndex(pool, prev) + dir;
        }
        place(i, pool[ni]);
      }
    } else {
      for (const i of rest) place(i, choose(i));
    }
    done.push({ shape: shape(idxs), pitches: idxs.map((i) => out[i].p) });
  }
  return out;
}

function nearestIndex(pool, p) {
  let best = 0;
  for (let i = 1; i < pool.length; i++) if (Math.abs(pool[i] - p) < Math.abs(pool[best] - p)) best = i;
  return best;
}

// ctx: { key, scale, chords(このフレーズの各小節のコード), bars, prevPitch }
export function generatePhrase(ctx) {
  const rhythm = genRhythm(ctx.bars);
  const notes = assignPitches(rhythm, ctx, { prevPitch: ctx.prevPitch });
  return makePhrase(ctx, breathe(notes, ctx), 'new');
}

// 小節いっぱいに詰めず、語尾の休符（息継ぎ）や出だしの休符で実際の長さをばらつかせる
function breathe(notes, ctx) {
  const total = ctx.bars * STEPS_PER_BAR;
  let out = notes.map((n) => ({ ...n }));
  if (rand() < 0.45) {
    const cut = total - (ctx.bars === 1 ? 4 : pick([4, 8, 8]));
    const kept = out.filter((n) => n.s < cut);
    if (kept.length >= 3) {
      out = kept.map((n) => (n.s + n.d > cut ? { ...n, d: cut - n.s } : n));
      // 最後の音は休符まで伸ばして言い切る
      const last = out[out.length - 1];
      last.d = cut - last.s;
    }
  }
  if (rand() < 0.25) {
    const start = pick([2, 4, 4]);
    const kept = out.filter((n) => n.s >= start);
    if (kept.length >= 3) out = kept;
  }
  return snapStrong(out, ctx);
}

function makePhrase(ctx, notes, origin, parentId) {
  return {
    id: newId(),
    bars: ctx.bars,
    key: ctx.key,
    scale: ctx.scale,
    chords: ctx.chords.map((c) => ({ ...c })),
    notes,
    origin,
    parentId: parentId || null,
  };
}

// ---------- くり返し ----------
const chordsKey = (chords) => chords.map((c) => c.label).join(' ');

// 決めたフレーズを次の位置のコードに合わせてもう一度使う。
// コードが同じならそのまま、違えば音階上でずらして（ゼクエンツ）強拍をコードトーンに合わせる。
// newEnding: 語尾（最後の半小節 / 1小節なら最後の拍）だけ作り直す
export function repeatPhrase(ph, chords, { newEnding = false } = {}) {
  const ctx = { ...ctxOf(ph), chords };
  let notes = ph.notes.map((n) => ({ ...n }));
  if (chordsKey(chords) !== chordsKey(ph.chords)) {
    const { lo, hi } = rangeFor(ctx.key);
    const pool = scalePitches(ctx.key, ctx.scale, lo - 3, hi + 3);
    let best = 0;
    let bestScore = -Infinity;
    for (let sh = -3; sh <= 3; sh++) {
      let score = sh === 0 ? 0.5 : -Math.abs(sh) * 0.2;
      notes.forEach((n, i) => {
        const ni = nearestIndex(pool, n.p) + sh;
        const chord = chords[Math.floor(n.s / STEPS_PER_BAR) % chords.length];
        if (ni < 0 || ni >= pool.length) score -= 5;
        else if ((n.s % 8 === 0 || n.d >= 4 || i === notes.length - 1) && isChordTone(pool[ni], chord)) score += 1;
      });
      if (score > bestScore) {
        bestScore = score;
        best = sh;
      }
    }
    notes = snapStrong(
      notes.map((n) => ({ ...n, p: pool[Math.max(0, Math.min(pool.length - 1, nearestIndex(pool, n.p) + best))] })),
      ctx,
    );
  }
  if (newEnding) notes = regenTail(notes, ctx, ph.bars === 1 ? 4 : 8);
  const out = makePhrase(ctx, notes, newEnding ? 'repeat2' : 'repeat', ph.id);
  out.motif = ph.motif || ph.id;
  return out;
}

// 最後の len ステップだけ作り直す
function regenTail(notes, ctx, len) {
  const cut = ctx.bars * STEPS_PER_BAR - len;
  const head = notes.filter((n) => n.s < cut).map((n) => ({ ...n, d: Math.min(n.d, cut - n.s) }));
  const tailR = genRhythm(ctx.bars)
    .filter((n) => n.s >= cut)
    .map(({ s, d }) => ({ s, d }));
  const prev = head.length ? head[head.length - 1].p : undefined;
  return head.concat(assignPitches(tailR, ctx, { prevPitch: prev }));
}

// ---------- 派生（これに近いの） ----------
const ORIGIN_LABEL = { new: '新規', rhythm: 'リズム違い', pitch: '音程違い', partial: '一部変更', repeat: 'くり返し', repeat2: 'くり返し・語尾変え' };
export const originLabel = (o) => ORIGIN_LABEL[o] || o;

function ctxOf(phrase) {
  return { key: phrase.key, scale: phrase.scale, chords: phrase.chords, bars: phrase.bars };
}

function snapStrong(notes, ctx) {
  const { lo, hi } = rangeFor(ctx.key);
  const pool = scalePitches(ctx.key, ctx.scale, lo - 3, hi + 3);
  return notes.map((n, i) => {
    const chord = ctx.chords[Math.floor(n.s / STEPS_PER_BAR) % ctx.chords.length];
    const strong = n.s % 8 === 0 || n.d >= 4 || i === notes.length - 1;
    if (!strong || isChordTone(n.p, chord)) return n;
    const cts = pool.filter((c) => isChordTone(c, chord));
    const best = cts.reduce((a, c) => (Math.abs(c - n.p) < Math.abs(a - n.p) ? c : a), cts[0]);
    return { ...n, p: best };
  });
}

// リズムを作り直し、元の音程の並び（輪郭）を保つ
function varyRhythmRegen(ph) {
  const ctx = ctxOf(ph);
  const src = ph.notes;
  const r = genRhythm(ph.bars);
  const notes = r.map((n, j) => {
    const k = r.length === 1 ? 0 : Math.round((j * (src.length - 1)) / (r.length - 1));
    return { p: src[k].p, s: n.s, d: n.d };
  });
  return snapStrong(notes, ctx);
}

// 音の分割・結合・食い（シンコペーション）で少しだけリズムを変える
function varyRhythmTweak(ph) {
  let notes = ph.notes.map((n) => ({ ...n }));
  const ops = 1 + Math.floor(rand() * 2);
  for (let k = 0; k < ops; k++) {
    const op = pick(['split', 'merge', 'push', 'split']);
    const i = Math.floor(rand() * notes.length);
    const n = notes[i];
    if (op === 'split' && n.d >= 2) {
      const a = n.d >= 4 && rand() < 0.5 ? n.d - 1 : Math.floor(n.d / 2);
      notes.splice(i, 1, { ...n, d: a }, { ...n, s: n.s + a, d: n.d - a });
    } else if (op === 'merge' && i < notes.length - 1) {
      const m = notes[i + 1];
      notes.splice(i, 2, { ...n, d: m.s + m.d - n.s });
    } else if (op === 'push' && i > 0) {
      const p = notes[i - 1];
      const shift = Math.min(n.s - p.s - 1, rand() < 0.5 ? 1 : 2);
      if (shift > 0) {
        p.d = Math.min(p.d, n.s - shift - p.s);
        n.s -= shift;
        n.d += shift;
      }
    }
  }
  return notes;
}

// リズムはそのまま、元の輪郭に沿って音程を選び直す
function varyPitch(ph) {
  const ctx = ctxOf(ph);
  const rhythm = ph.notes.map(({ s, d }) => ({ s, d }));
  const shift = pick([-2, -1, 0, 1, 2]);
  const target = ph.notes.map((n) => n.p + shift);
  return assignPitches(rhythm, ctx, { target, prevPitch: ph.notes[0].p + shift });
}

// 一部の音だけ変える（1〜2音の音程 or 最後の半小節を作り直す）
function varyPartial(ph) {
  const ctx = ctxOf(ph);
  if (rand() < 0.5) {
    const notes = ph.notes.map((n) => ({ ...n }));
    const count = notes.length > 4 ? 2 : 1;
    const { lo, hi } = rangeFor(ctx.key);
    const pool = scalePitches(ctx.key, ctx.scale, lo - 3, hi + 3);
    for (let k = 0; k < count; k++) {
      const i = Math.floor(rand() * notes.length);
      const idx = nearestIndex(pool, notes[i].p);
      const ni = Math.max(0, Math.min(pool.length - 1, idx + pick([-2, -1, 1, 2])));
      notes[i].p = pool[ni];
    }
    return snapStrong(notes, ctx);
  }
  return regenTail(ph.notes, ctx, 8);
}

const sig = (notes) => notes.map((n) => `${n.p}.${n.s}.${n.d}`).join(',');

export function makeVariants(ph, count = 5) {
  const plan = ['rhythm', 'pitch', 'partial', 'rhythm', 'partial', 'pitch'].slice(0, count);
  const seen = new Set([sig(ph.notes)]);
  const out = [];
  for (const kind of plan) {
    for (let tries = 0; tries < 12; tries++) {
      let notes;
      if (kind === 'rhythm') notes = out.some((v) => v.origin === 'rhythm') ? varyRhythmTweak(ph) : varyRhythmRegen(ph);
      else if (kind === 'pitch') notes = varyPitch(ph);
      else notes = varyPartial(ph);
      notes = notes.filter((n) => n.d > 0).sort((a, b) => a.s - b.s);
      const k = sig(notes);
      if (notes.length && !seen.has(k)) {
        seen.add(k);
        out.push(makePhrase(ctxOf(ph), notes, kind, ph.id));
        break;
      }
    }
  }
  return out;
}
