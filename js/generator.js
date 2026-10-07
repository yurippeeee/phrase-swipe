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
  let s = 0;
  while (s < STEPS_PER_BAR) {
    let cell;
    if (s % 8 === 0 && rand() < 0.3) cell = chooseCell(HALF_CELLS, density);
    else cell = chooseCell(BEAT_CELLS, density);
    // フレーズ最後の拍は落ち着かせる
    if (isLast && s >= 12) cell = pick([[4], [4], [2, 2], [-2, 2], [2, -2]]);
    if (isLast && s === 8 && rand() < 0.35) cell = pick([[8], [6, 2]]);
    for (const v of cell) {
      if (v > 0) out.push({ s, d: v });
      s += Math.abs(v);
    }
  }
  return out;
}

export function genRhythm(bars, density = 0.3 + rand() * 0.5) {
  const first = barRhythm(density, bars === 1);
  const all = first.map((n) => ({ ...n }));
  for (let b = 1; b < bars; b++) {
    const isLast = b === bars - 1;
    let r;
    if (rand() < 0.45) {
      // 動機の反復（最後の拍だけ変える）
      r = first.filter((n) => n.s < 12).map((n) => ({ ...n }));
      const tail = barRhythm(density, isLast).filter((n) => n.s >= 12);
      r = r.filter((n) => n.s + n.d <= 12).concat(tail);
    } else {
      r = barRhythm(density, isLast);
    }
    for (const n of r) all.push({ s: n.s + b * STEPS_PER_BAR, d: n.d });
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

// rhythm に音程を割り当てる
// opts.target: 各音の目標音高（派生用）, opts.prevPitch: 直前の音（文脈）
export function assignPitches(rhythm, ctx, opts = {}) {
  const { key, scale, chords, bars } = ctx;
  const { lo, hi } = rangeFor(key);
  const pool = scalePitches(key, scale, lo, hi);
  const center = (lo + hi) / 2;
  const contour = opts.contour || CONTOURS[pick(Object.keys(CONTOURS))];
  const total = bars * STEPS_PER_BAR;

  let prev = opts.prevPitch;
  if (prev == null || prev < lo - 5 || prev > hi + 5) prev = Math.round(center + (rand() - 0.5) * 6);
  let prevInterval = 0;
  let repeat = 0;
  const out = [];

  rhythm.forEach((n, i) => {
    const chord = chords[Math.floor(n.s / STEPS_PER_BAR) % chords.length];
    const strong = n.s % 8 === 0 || n.d >= 4;
    const last = i === rhythm.length - 1;
    const target = opts.target ? opts.target[i] : center + contour(n.s / total);
    const prevIdx = nearestIndex(pool, prev);

    const cands = pool.filter((c) => Math.abs(c - prev) <= 9);
    const weights = cands.map((c) => {
      const ct = isChordTone(c, chord);
      if ((strong || last) && !ct) return 0; // 強拍・長い音・最後の音はコードトーン
      const steps = Math.abs(nearestIndex(pool, c) - prevIdx);
      const semis = Math.abs(c - prev);
      let w = [0.5, 3, 1.6, 0.6, 0.35, 0.12, 0.08, 0.05][Math.min(steps, 7)];
      if (i === 0 && opts.prevPitch == null) w = 1;
      if (semis === 6) w *= 0.15;
      if (ct) w *= strong ? 1 : 1.3;
      // 跳躍の後は反対方向へ順次進行
      if (Math.abs(prevInterval) >= 5) {
        const dir = Math.sign(c - prev);
        if (dir === -Math.sign(prevInterval) && steps <= 2) w *= 3;
        else if (dir === Math.sign(prevInterval)) w *= 0.25;
      }
      if (c === prev) w *= repeat >= 1 ? 0.04 : 0.35;
      w *= Math.exp(-Math.abs(c - target) / (opts.target ? 2 : 5));
      if (last) {
        const deg = (((c - chord.rootPc) % 12) + 12) % 12;
        if (deg === 0) w *= 2.5;
      }
      return w;
    });
    let p = weighted(cands, weights);
    if (p == null) p = prev;
    prevInterval = p - prev;
    repeat = p === prev ? repeat + 1 : 0;
    prev = p;
    out.push({ p, s: n.s, d: n.d });
  });
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
  return makePhrase(ctx, notes, 'new');
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

// ---------- 派生（これに近いの） ----------
const ORIGIN_LABEL = { new: '新規', rhythm: 'リズム違い', pitch: '音程違い', partial: '一部変更' };
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
  const total = ph.bars * STEPS_PER_BAR;
  const cut = total - 8;
  const head = ph.notes.filter((n) => n.s < cut).map((n) => ({ ...n, d: Math.min(n.d, cut - n.s) }));
  const tailR = genRhythm(ph.bars).filter((n) => n.s >= cut);
  const prev = head.length ? head[head.length - 1].p : undefined;
  const tail = assignPitches(tailR, ctx, { prevPitch: prev });
  return head.concat(tail);
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
