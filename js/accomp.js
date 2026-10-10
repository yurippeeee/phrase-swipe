// 伴奏パターン
// テンプレートはコードに依存しない「型」で、小節ごとのコードに当てはめて音にする。
// { id, style, reg(和音の下端), fill, bars: [[{ s, d, v:[記号], inst }]] }
//   記号: 'R' ベースの根音 / 'F' ベースの5度 / 'O' ベースの1オクターブ上 / 'C' 和音（密集配置）/ 数字 コードトーンの段（0=下から）
//   inst: 'pad' 持続する和音 / 'keys' 鍵盤 / 'bass' ベース

import { guitarShape, guitarNotes } from './guitar.js';

const rand = Math.random;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function weighted(items, weights) {
  let sum = 0;
  for (const w of weights) sum += w;
  let r = rand() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
let idc = 0;
const newId = () => 'a' + Date.now().toString(36) + (idc++).toString(36);

export const ACC_STYLES = {
  pad: 'パッド',
  stab: '刻み',
  oompah: 'ベース＋和音',
  arp: 'アルペジオ',
  mix: '和音＋アルペジオ',
  broken: '分散',
  bassline: 'ベースライン＋パッド',
  arp16: '細かいアルペジオ',
  funk: 'カッティング',
};

export function accName(t) {
  if (!t) return '';
  const f = t.fit || 0;
  const fit = f < 0.15 ? '' : `・合いの手${Math.round(f * 100)}%`;
  const v = voiceName(t);
  return (ACC_STYLES[t.style] || t.style) + (t.fill ? '＋フィル' : '') + (v ? `（${v}）` : '') + fit;
}

const ev = (s, d, v, inst = 'keys') => ({ s, d, v, inst });

const ARP_ORDERS = [[0, 1, 2, 3], [0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 4, 2], [2, 1, 0, 1], [0, 1, 2, 4]];

// 'x' の位置に音を置くリズム（16分 × 16）
function fromRhythm(str, v, inst, maxLen = 4) {
  const on = [];
  for (let i = 0; i < str.length; i++) if (str[i] === 'x') on.push(i);
  return on.map((s, k) => ev(s, Math.min(maxLen, (on[k + 1] ?? 16) - s), v, inst));
}

function arpRun(from, to, rate, order, offset = 0) {
  const out = [];
  for (let s = from, k = offset; s < to; s += rate, k++) out.push(ev(s, rate, [order[k % order.length]]));
  return out;
}

// ---- リズムはメロディと同じく1拍ごとに選ぶ（16分・8分・4分・付点・休符が混ざる） ----
// 1拍（4ステップ）のセル。負数は休符。dens は細かさの目安
const BEAT_CELLS = [
  { c: [4], dens: 0.1 },
  { c: [2, 2], dens: 0.45 },
  { c: [3, 1], dens: 0.55 },
  { c: [1, 1, 2], dens: 0.75 },
  { c: [2, 1, 1], dens: 0.75 },
  { c: [1, 2, 1], dens: 0.7 },
  { c: [1, 1, 1, 1], dens: 1.0 },
  { c: [-2, 2], dens: 0.4 },
  { c: [2, -2], dens: 0.3 },
  { c: [-1, 1, 2], dens: 0.65 },
  { c: [-1, 1, 1, 1], dens: 0.85 },
  { c: [1, -1, 1, 1], dens: 0.85 },
  { c: [-4], dens: 0.0 },
];
// 2拍（8ステップ）のセル
const HALF_CELLS = [
  { c: [8], dens: 0.0 },
  { c: [6, 2], dens: 0.3 },
  { c: [3, 3, 2], dens: 0.55 },
  { c: [2, 4, 2], dens: 0.45 },
  { c: [3, 3, 1, 1], dens: 0.75 },
];

function chooseCell(cells, density) {
  return weighted(cells, cells.map((x) => Math.exp(-Math.abs(x.dens - density) * 4) * (x.c[0] === -4 ? 0.25 : 1))).c;
}

// 1小節ぶんのリズム [{s,d}]
function mixedRhythm(density) {
  const out = [];
  let s = 0;
  while (s < 16) {
    let cell = s % 8 === 0 && rand() < 0.2 ? chooseCell(HALF_CELLS, density) : chooseCell(BEAT_CELLS, density);
    // 小節の頭は鳴らすことが多い
    if (s === 0 && cell[0] < 0 && rand() < 0.7) cell = chooseCell(BEAT_CELLS.filter((x) => x.c[0] > 0), density);
    for (const v of cell) {
      if (v > 0) out.push({ s, d: v });
      s += Math.abs(v);
    }
  }
  return out.length >= 2 ? out : mixedRhythm(Math.min(1, density + 0.2));
}

// ベースのリズム（半小節ごと）
const BASS_CELLS = {
  steady: [[[8], 2], [[4, 4], 2], [[6, 2], 1], [[4, 2, 2], 1]],
  move: [[[4, 4], 1.5], [[3, 3, 2], 1.5], [[2, 2, 4], 1], [[6, 2], 1], [[4, 2, 2], 1], [[3, 1, 4], 1]],
  busy: [[[3, 1, 2, 2], 1.5], [[2, 1, 1, 4], 1], [[1, 1, 2, 2, 2], 1], [[3, 3, 2], 1.5], [[2, 2, 2, 2], 1], [[1, 1, 1, 1, 4], 0.6]],
};
function bassLine(kind) {
  const out = [];
  for (const half of [0, 8]) {
    const cells = BASS_CELLS[kind];
    let s = half;
    for (const d of weighted(cells.map((c) => c[0]), cells.map((c) => c[1]))) {
      const v = s === 0 ? 'R' : weighted(['R', 'O', 'F'], [0.5, 0.25, 0.25]);
      out.push(ev(s, d, [v], 'bass'));
      s += d;
    }
  }
  return out;
}

// スタイル = 和音で鳴らす割合・細かさの傾向・ベースの動き
const FLAVORS = {
  stab: { chord: 0.95, dens: 0.45, bass: 'steady' },
  funk: { chord: 0.85, dens: 0.8, bass: 'busy', staccato: true },
  arp: { chord: 0.05, dens: 0.5, bass: 'steady' },
  arp16: { chord: 0.05, dens: 0.8, bass: 'steady' },
  mix: { chord: 0.5, dens: 0.55, bass: 'steady' },
  broken: { chord: 0.25, dens: 0.6, bass: 'move', shuffle: true },
};

function flavoredBar(f) {
  const density = Math.max(0, Math.min(1, f.dens + (rand() - 0.5) * 0.3));
  const order = pick(ARP_ORDERS);
  let k = 0;
  const notes = mixedRhythm(density).map(({ s, d }) => {
    const dur = f.staccato ? Math.min(d, rand() < 0.5 ? 1 : 2) : d;
    if (rand() < f.chord) return ev(s, dur, ['C']);
    const tone = f.shuffle ? pick([0, 1, 2, 3]) : order[k++ % order.length];
    return ev(s, dur, [tone]);
  });
  return [...bassLine(f.bass), ...notes];
}

// 1小節ぶんの型をスタイルごとに作る
function barFor(style) {
  if (FLAVORS[style]) return flavoredBar(FLAVORS[style]);
  switch (style) {
    case 'pad':
      return [ev(0, 16, ['R'], 'bass'), ev(0, 16, ['C'], 'pad')];
    case 'oompah':
      return rand() < 0.5
        ? [ev(0, 4, ['R'], 'bass'), ev(4, 3, ['C']), ev(8, 4, ['F'], 'bass'), ev(12, 3, ['C'])]
        : [ev(0, 2, ['R'], 'bass'), ev(2, 2, ['C']), ev(4, 2, ['F'], 'bass'), ev(6, 2, ['C']), ev(8, 2, ['R'], 'bass'), ev(10, 2, ['C']), ev(12, 2, ['F'], 'bass'), ev(14, 2, ['C'])];
    case 'bassline':
    default:
      return [...bassLine(rand() < 0.5 ? 'move' : 'busy'), ev(0, 16, ['C'], 'pad')];
  }
}

// 2小節目の後半を単音のフィルに差し替える（ときどき単音を混ぜる）
function withFill(bar) {
  const cut = pick([8, 12]);
  const keep = bar.filter((e) => e.s < cut).map((e) => (e.inst !== 'bass' && e.s + e.d > cut ? { ...e, d: cut - e.s } : e));
  const fill = pick([
    () => arpRun(cut, 16, 1, [0, 1, 2, 3, 4]),
    () => arpRun(cut, 16, 2, [3, 2, 1, 0]),
    () => arpRun(cut, 16, 2, [0, 1, 2, 3]),
    () => [ev(cut, 2, [2]), ev(cut + 2, 2, [1]), ev(Math.min(14, cut + 4), 16 - Math.min(14, cut + 4), [0])],
  ])();
  return [...keep, ...fill.filter((e) => e.s < 16)];
}

// fitBias: 合いの手の強さの目安（0〜1）。その前後で散らす。null なら全体からランダム
export function generateAcc(style, fitBias = null) {
  const st = style || weighted(Object.keys(ACC_STYLES), [0.6, 1, 0.8, 1.2, 1.1, 1, 0.8, 1.1, 1.1]);
  const a = barFor(st);
  const fill = rand() < 0.45;
  const fit = fitBias == null ? pick([0, 0.35, 0.65, 1]) : Math.max(0, Math.min(1, fitBias + (rand() - 0.5) * 0.4));
  return { id: newId(), style: st, reg: pick([50, 52, 52, 55]), fill, fit: Math.round(fit * 20) / 20, bars: fill ? [a, withFill(a)] : [a] };
}

// 伴奏を選ぶ前の標準：8分で刻む和音＋拍の頭のベース（テンポが伴奏でも分かるように）
export const DEFAULT_ACC_ID = 'default2';
export function defaultAcc() {
  return {
    id: DEFAULT_ACC_ID,
    style: 'stab',
    reg: 52,
    fill: false,
    bars: [[ev(0, 8, ['R'], 'bass'), ev(8, 8, ['F'], 'bass'), ...fromRhythm('x.x.x.x.x.x.x.x.', ['C'], 'keys', 2)]],
  };
}

// 「これに近いの」：同じスタイルで作り直し・フィルの有無・音域違い
export function accVariants(t, count = 5) {
  const out = [];
  out.push({ ...t, id: newId(), fill: !t.fill, bars: t.fill ? [t.bars[0]] : [t.bars[0], withFill(t.bars[0])] });
  out.push({ ...t, id: newId(), reg: t.reg >= 52 ? t.reg - 4 : t.reg + 5 });
  const f = t.fit || 0;
  out.push({ ...t, id: newId(), fit: f >= 0.5 ? Math.max(0, f - 0.35) : Math.min(1, f + 0.35) });
  out.push(...voiceVariants(t, 1));
  while (out.length < count) out.push({ ...generateAcc(t.style, f), reg: t.reg, color: t.color, spread: t.spread });
  return out;
}

// ---- 響き（構成音）：リズムと鳴らす位置はそのままで、和音の中身だけ変える ----
//   color: 足す・入れ替える音 / spread: 'close' 密集 / 'open' 1つおきに広げる
export const VOICE_COLORS = {
  plain: '',
  seventh: '7th',
  add9: 'add9',
  sus4: 'sus4',
  sus2: 'sus2',
  six: '6th',
  power: '3度抜き',
};
export function voiceName(t) {
  const c = t.color === 'mix' ? '構成音アレンジ' : VOICE_COLORS[t.color || 'plain'];
  const o = t.spread === 'open' ? '広げ' : '';
  return [c, o].filter(Boolean).join('・');
}

// コードごとに構成音を変える（mix）。同じコードはいつも同じ響き、違うコードには違う響き
//   コードの役割で候補を絞る：ドミナント(V)は 7th・sus4、メジャーは M7・add9・6th・sus2、マイナーは m7・add9・sus4
const MIX_CANDIDATES = {
  dom: ['seventh', 'sus4'],
  maj: ['seventh', 'add9', 'six', 'sus2'],
  min: ['seventh', 'add9', 'plain'],
  other: ['seventh', 'plain'],
};
function colorFor(t, chord, scale) {
  if (t.color !== 'mix') return t.color;
  const r = chord.rootPc;
  const has = (iv) => chord.pcs.includes((r + iv) % 12);
  const tonic = scale ? scale[0] : null;
  const kind = !has(7) ? 'other' : tonic != null && r === (tonic + 7) % 12 && has(4) ? 'dom' : has(4) ? 'maj' : has(3) ? 'min' : 'other';
  const list = MIX_CANDIDATES[kind];
  // 種（vseed）とキーの主音からの距離で決める：同じ度数はいつも同じ響き、度数ごとにばらばら
  // 度数の順に候補を1つずつずらして割り当てるので、同じ種類のコードが並んでも同じ響きになりにくい
  // （長調の I・IV／ii・iii・vi、短調の i・iv・v／III・VI・VII がそれぞれ別の響きになる並び）
  const DEG_RANK = [0, 1, 2, 1, 2, 0, 3];
  const deg = scale && scale.includes(r) ? DEG_RANK[scale.indexOf(r)] : r;
  const base = Math.floor(hashRand(t.vseed || t.id, 'mix', kind) * list.length);
  return list[(base + deg) % list.length];
}

// 響きを付けたコード名（カードの表示用）
export function voicedLabel(t, chord, scale) {
  const pcs = colorPcs(chord, colorFor(t, chord, scale), scale);
  if (pcs.join() === chord.pcs.join()) return chord.label;
  const r = chord.rootPc;
  const has = (iv) => pcs.includes((r + iv) % 12);
  const root = chord.label.match(/^[A-G][#b]?/)[0];
  if (!has(3) && !has(4)) return root + (has(5) ? 'sus4' : has(2) ? 'sus2' : '5');
  const base = chord.label;
  if (pcs.length > chord.pcs.length) {
    if (has(9) && !chord.pcs.includes((r + 9) % 12)) return base + '6';
    if (has(2)) return base + 'add9';
    if (has(11)) return base + 'M7';
    if (has(10)) return has(6) ? root + 'm7-5' : base + '7';
  }
  return base;
}

// 構成音違い：リズムはそのまま（合いの手の位置も同じ）で、コードごとに構成音を変えたもの
export function voiceVariants(t, count = 5) {
  // 割り当て（種類ごとの開始位置）と広げ方が同じ候補は出さない
  const sig = (v) => (v.color === 'mix' ? Object.keys(MIX_CANDIDATES).map((k) => Math.floor(hashRand(v.vseed || v.id, 'mix', k) * MIX_CANDIDATES[k].length)).join('') : v.color || 'plain') + (v.spread || 'close');
  const seen = new Set([sig(t)]);
  const out = [];
  for (let i = 0; out.length < count && i < 200; i++) {
    const spread = out.length < 3 ? t.spread || 'close' : pick(['close', 'open']);
    const v = { ...t, id: newId(), seed: t.seed || t.id, color: 'mix', vseed: newId() + i, spread };
    if (seen.has(sig(v))) continue;
    seen.add(sig(v));
    out.push(v);
  }
  return out;
}

// コードの構成音（ピッチクラス）を響きに合わせて変える。scale があればその音階の音を優先
function colorPcs(chord, color, scale) {
  const r = chord.rootPc;
  const at = (iv) => (r + iv) % 12;
  const inScale = (pc) => !scale || scale.includes(pc);
  const pcs = [...chord.pcs];
  const third = pcs.find((pc) => pc === at(3) || pc === at(4));
  const triadOnly = pcs.length === 3 && pcs.includes(at(7));
  switch (color) {
    case 'seventh': {
      if (pcs.length > 3) return pcs;
      const m7 = at(10);
      const M7 = at(11);
      const sev = inScale(M7) && !inScale(m7) ? M7 : inScale(m7) ? m7 : third === at(4) ? M7 : m7;
      return [...pcs, sev];
    }
    case 'add9':
      return inScale(at(2)) ? [...pcs, at(2)] : pcs;
    case 'six':
      return inScale(at(9)) && triadOnly ? [...pcs, at(9)] : pcs;
    case 'sus4':
      return triadOnly && third != null && inScale(at(5)) ? pcs.map((pc) => (pc === third ? at(5) : pc)) : pcs;
    case 'sus2':
      return triadOnly && third != null && inScale(at(2)) ? pcs.map((pc) => (pc === third ? at(2) : pc)) : pcs;
    case 'power':
      return triadOnly ? pcs.filter((pc) => pc !== third) : pcs;
    default:
      return pcs;
  }
}

// 同じ型・同じ小節・同じ位置なら毎回同じになる乱数（再生のたびに変わらないように）
function hashRand(...keys) {
  let h = 2166136261;
  for (const ch of keys.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// 合いの手：メロディの間（休み・伸ばし）に単音のフレーズを入れ、メロディの出だしとぶつかる音は間引く。
// melody: この小節で鳴っているメロディ [{s,d}]（小節頭からのステップ）
function fitToMelody(t, bar, barIndex, melody) {
  const f = t.fit || 0;
  if (!f || !melody) return bar;
  // メロディの出だし直後（2ステップ）は「動いている」。伸ばしの後半と休みは「間」
  const busy = new Array(16).fill(false);
  for (const n of melody) for (let s = Math.max(0, n.s); s < Math.min(16, n.s + Math.min(n.d, 2)); s++) busy[s] = true;
  const R = (...k) => hashRand(t.seed || t.id, barIndex, ...k);
  const kept = bar.filter((e) => {
    if (e.inst !== 'keys' || e.s === 0 || !busy[e.s]) return true;
    return R('drop', e.s) >= (e.v.includes('C') ? f * 0.6 : f * 0.9);
  });
  const fills = [];
  for (let s = 0; s < 16; ) {
    if (busy[s]) {
      s++;
      continue;
    }
    let e = s;
    while (e < 16 && !busy[e]) e++;
    const len = e - s;
    if (len >= 2 && R('gap', s) < f) {
      // 間の終わりに向かって最大4音、次のメロディへつなぐ
      const rate = len >= 4 && R('rate', s) < 0.5 ? 2 : 1;
      const from = Math.max(s, e - rate * 4);
      const up = R('dir', s) < 0.6;
      const base = Math.floor(R('base', s) * 3);
      let k = 0;
      for (let x = from; x + rate <= e; x += rate, k++) {
        if (kept.some((ev) => ev.inst === 'keys' && ev.s === x)) continue;
        fills.push({ s: x, d: rate, v: [up ? base + k : Math.max(0, base + 3 - k)], inst: 'keys' });
      }
    }
    s = e;
  }
  return [...kept, ...fills];
}

// コードに当てはめて音（{p,s,d,inst}）にする。melody を渡すと合いの手を合わせる
// guitar: ギターの押さえ方（1小節1フォーム）の弦で鳴らす（響きは押さえ方が決めるので使わない）
// scale: キーの音階のピッチクラス（響きの音を選ぶため）
export function realizeBar(t, chord, barIndex, melody, guitar = false, scale = null) {
  const bar = fitToMelody(t, t.bars[barIndex % t.bars.length], barIndex, melody);
  if (guitar) {
    const shape = guitarShape(chord);
    const out = [];
    const seen = new Set();
    for (const e of bar) {
      for (const v of e.v) {
        for (const x of guitarNotes(shape, v, e.inst)) {
          const k = `${e.s}|${x.p}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ p: x.p, s: e.s, d: e.d, inst: e.inst });
        }
      }
    }
    return out;
  }
  const root = 40 + ((chord.rootPc - 4 + 12) % 12); // E2〜D#3（スマホでも聞こえる高さ）
  // 段: reg 以上のコードトーンを下から順に（広げるときは1つおき）
  const pcs = colorPcs(chord, colorFor(t, chord, scale), scale);
  const open = t.spread === 'open';
  const all = [];
  for (let p = t.reg; all.length < (open ? 14 : 7); p++) if (pcs.includes(p % 12)) all.push(p);
  // 広げると上が高くなりすぎるので、G5 より上は1オクターブ下げる
  const ladder = open ? all.filter((_, i) => i % 2 === 0).map((p) => { while (p > 79) p -= 12; return p; }) : all;
  const close = ladder.slice(0, pcs.length);
  const out = [];
  for (const e of bar) {
    for (const v of e.v) {
      let ps;
      if (v === 'R') ps = [root];
      else if (v === 'F') ps = [root + 7];
      else if (v === 'O') ps = [root + 12];
      else if (v === 'C') ps = close;
      else ps = [ladder[Math.min(v, ladder.length - 1)]];
      for (const p of ps) out.push({ p, s: e.s, d: e.d, inst: e.inst });
    }
  }
  return out;
}
