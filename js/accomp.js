// 伴奏パターン
// テンプレートはコードに依存しない「型」で、小節ごとのコードに当てはめて音にする。
// { id, style, reg(和音の下端), fill, bars: [[{ s, d, v:[記号], inst }]] }
//   記号: 'R' ベースの根音 / 'F' ベースの5度 / 'O' ベースの1オクターブ上 / 'C' 和音（密集配置）/ 数字 コードトーンの段（0=下から）
//   inst: 'pad' 持続する和音 / 'keys' 鍵盤 / 'bass' ベース

import { guitarShape, guitarVoicingShape, guitarNotes } from './guitar.js';
import { chordName } from './theory.js';

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

// コードごとに構成音を変える（mix）：音階の音から自由にテンションを足す・3度を sus にする・7th を足す・5度を抜く・転回する。
// 決まった名前の形に限らない。同じコードはいつも同じ響き（種 vseed とコードで決まる）
function mixVoicing(t, chord, scale) {
  const r = chord.rootPc;
  const key = `${r}|${chord.pcs.join(',')}`;
  const R = (k) => hashRand(t.vseed || t.id, 'mix2', key, k);
  const at = (iv) => (r + iv) % 12;
  let pcs = [...chord.pcs];
  const pool = (scale || [...Array(12).keys()]).filter((pc) => !pcs.includes(pc));
  // ぶつかる音（今の音の半音上）は足さない。足した音どうしも半音でぶつけない
  const third0 = chord.pcs.find((pc) => pc === at(3) || pc === at(4));
  const ok = (pc, cur) =>
    !cur.some((x) => (pc - x + 12) % 12 === 1 || ((x - pc + 12) % 12 === 1 && !chord.pcs.includes(x))) &&
    !(third0 != null && cur.includes(third0) && Math.min((pc - third0 + 12) % 12, (third0 - pc + 12) % 12) === 1); // 3度と半音でぶつけない
  const addSome = (n, salt) => {
    const cand = pool.filter((pc) => !pcs.includes(pc));
    for (let i = 0; i < n && cand.length; i++) {
      const okc = cand.filter((pc) => ok(pc, pcs));
      if (!okc.length) break;
      const pc = okc[Math.floor(R(salt + i) * okc.length)];
      pcs.push(pc);
      cand.splice(cand.indexOf(pc), 1);
    }
  };
  const third = pcs.find((pc) => pc === at(3) || pc === at(4));
  const fifth = pcs.includes(at(7)) ? at(7) : null;
  const op = R('op');
  if (op < 0.28) addSome(1, 'a');
  else if (op < 0.5) addSome(2, 'b');
  else if (op < 0.66 && third != null) {
    // sus：3度を2度か4度に
    const subs = [at(2), at(5)].filter((pc) => !scale || scale.includes(pc));
    if (subs.length) pcs = pcs.map((pc) => (pc === third ? subs[Math.floor(R('sus') * subs.length)] : pc));
    if (R('sus+') < 0.5) addSome(1, 'c');
  } else if (op < 0.8) {
    // 7th ＋ テンション
    const sev = [at(10), at(11)].filter((pc) => (!scale || scale.includes(pc)) && !pcs.includes(pc));
    if (sev.length && !pcs.some((pc) => pc === at(10) || pc === at(11))) pcs.push(sev[0]);
    addSome(R('7n') < 0.5 ? 1 : 0, 'd');
  } else if (op < 0.9 && fifth != null) {
    // 5度を抜いてテンションで隙間を作る
    pcs = pcs.filter((pc) => pc !== fifth);
    addSome(R('o5') < 0.5 ? 1 : 2, 'e');
  }
  // 転回（ベースを根音以外に）
  let bass = r;
  const invFor = op >= 0.9 || R('inv') < 0.25;
  if (invFor) {
    const others = pcs.filter((pc) => pc !== r);
    if (others.length) bass = others[Math.floor(R('bass') * others.length)];
  }
  // 何も変わらなかったら1音足す
  if (bass === r && pcs.length === chord.pcs.length && pcs.every((pc) => chord.pcs.includes(pc))) addSome(1, 'z');
  return { pcs, bass };
}

// 伴奏の型 t がこのコードで鳴らす構成音とベース、コード名
// guitar: ギターの押さえ方も探す（見つからなければ転回をやめる→元のコード）
export function accVoicing(t, chord, scale, guitar = false) {
  let v;
  if (t.color === 'mix') v = mixVoicing(t, chord, scale);
  else v = { pcs: colorPcs(chord, t.color, scale), bass: chord.rootPc };
  const rootName = chord.label.match(/^[A-G][#b]?/)[0];
  const make = (x) => {
    const plain = x.bass === chord.rootPc && x.pcs.length === chord.pcs.length && x.pcs.every((pc) => chord.pcs.includes(pc));
    return { ...x, plain, label: plain ? chord.label : chordName(rootName, chord.rootPc, x.pcs, x.bass) };
  };
  let vc = make(v);
  if (!guitar) return vc;
  for (const cand of [vc, make({ ...v, bass: chord.rootPc })]) {
    if (cand.plain) break;
    const shape = guitarVoicingShape(cand, chord);
    if (shape) return { ...cand, shape };
  }
  vc = make({ pcs: [...chord.pcs], bass: chord.rootPc });
  return { ...vc, shape: guitarShape(chord) };
}

// 響きを付けたコード名（カードの表示用）
export function voicedLabel(t, chord, scale, guitar = false) {
  return accVoicing(t, chord, scale, guitar).label;
}

// 構成音違い：リズムはそのまま（合いの手の位置も同じ）で、コードごとに構成音を変えたもの
// ctx: { chords, scale } 曲で使うコード。あれば実際の響きで同じかどうかを比べる
export function voiceVariants(t, count = 5, avoid = [], ctx = null) {
  // 割り当てと広げ方が同じ候補は出さない
  const sig = (v) =>
    (ctx && ctx.chords.length
      ? ctx.chords.map((c) => voicedLabel(v, c, ctx.scale, ctx.guitar)).join()
      : v.color === 'mix'
        ? v.vseed
        : v.color || 'plain') + (v.spread || 'close');
  const seen = new Set([t, ...avoid].map(sig));
  const out = [];
  for (let i = 0; out.length < count && i < 400; i++) {
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
// splits: [{ cut, chord }] そのステップから先は別のコードで鳴らす（コードの変わり目を小節線からずらす）。
//   cut をまたいで伸びる音は cut で切り、続きを新しいコードで鳴らし直す
export function realizeBar(t, chord, barIndex, melody, guitar = false, scale = null, splits = null) {
  const bar = fitToMelody(t, t.bars[barIndex % t.bars.length], barIndex, melody);
  const cuts = (splits || []).filter((x) => x && x.chord && x.cut > 0 && x.cut < 16).sort((a, b) => a.cut - b.cut);
  if (!cuts.length) return realizeEvents(t, chord, bar, guitar, scale);
  const segs = [{ from: 0, chord }, ...cuts.map((x) => ({ from: x.cut, chord: x.chord }))];
  const out = [];
  segs.forEach((g, i) => {
    const to = i + 1 < segs.length ? segs[i + 1].from : 16;
    const part = [];
    for (const e of bar) {
      const s0 = Math.max(e.s, g.from);
      const s1 = Math.min(e.s + e.d, to);
      // その区間で鳴り始める音と、前の区間から伸びてきた音（区間の頭で鳴らし直す）
      if (s1 > s0 && (e.s >= g.from || s0 === g.from)) part.push({ ...e, s: s0, d: s1 - s0 });
    }
    if (i > 0) {
      // 変わり目でははっきり聞こえるように：ベースは新しいコードの根音、和音も必ず鳴らす
      const len = to - g.from;
      for (const e of part) if (e.inst === 'bass' && e.s === g.from) e.v = ['R'];
      if (bar.some((e) => e.inst === 'bass') && !part.some((e) => e.inst === 'bass' && e.s === g.from)) part.push({ s: g.from, d: len, v: ['R'], inst: 'bass' });
      if (!part.some((e) => e.inst !== 'bass' && e.s === g.from && e.v.includes('C'))) part.push({ s: g.from, d: len, v: ['C'], inst: 'keys', cut: true });
    }
    out.push(...realizeEvents(t, g.chord, part, guitar, scale));
  });
  return out;
}

function realizeEvents(t, chord, bar, guitar, scale) {
  const vc = accVoicing(t, chord, scale, guitar);
  if (guitar) {
    const shape = vc.shape;
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
  const root = 40 + ((vc.bass - 4 + 12) % 12); // E2〜D#3（スマホでも聞こえる高さ）。転回したらその音
  const fifthUp = vc.bass === chord.rootPc ? root + 7 : root + ((chord.rootPc - vc.bass + 12) % 12); // 転回のときは根音
  // 段: reg 以上のコードトーンを下から順に（広げるときは1つおき）
  const pcs = vc.pcs;
  const open = t.spread === 'open';
  const all = [];
  for (let p = t.reg; all.length < (open ? 14 : 7); p++) if (pcs.includes(p % 12)) all.push(p);
  // 広げる：密集配置の2番目・4番目…を1オクターブ上げる（構成音は全部残す）。G5 より上は下げる
  let ladder = all;
  let close = all.slice(0, pcs.length);
  if (open) {
    const spread = close.map((p, i) => (i % 2 ? p + 12 : p)).map((p) => (p > 79 ? p - 12 : p)).sort((a, b) => a - b);
    close = spread;
    const set = new Set();
    for (let o = 0; o < 3; o++) for (const p of spread) {
      let q = p + o * 24;
      while (q > 79) q -= 12;
      set.add(q);
    }
    ladder = [...set].sort((a, b) => a - b);
  }
  const out = [];
  for (const e of bar) {
    for (const v of e.v) {
      let ps;
      if (v === 'R') ps = [root];
      else if (v === 'F') ps = [fifthUp];
      else if (v === 'O') ps = [root + 12];
      else if (v === 'C') ps = close;
      else ps = [ladder[Math.min(v, ladder.length - 1)]];
      for (const p of ps) out.push({ p, s: e.s, d: e.d, inst: e.inst });
    }
  }
  return out;
}
