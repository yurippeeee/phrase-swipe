// 伴奏パターン
// テンプレートはコードに依存しない「型」で、小節ごとのコードに当てはめて音にする。
// { id, style, reg(和音の下端), fill, bars: [[{ s, d, v:[記号], inst }]] }
//   記号: 'R' ベースの根音 / 'F' ベースの5度 / 'O' ベースの1オクターブ上 / 'C' 和音（密集配置）/ 数字 コードトーンの段（0=下から）
//   inst: 'pad' 持続する和音 / 'keys' 鍵盤 / 'bass' ベース

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
  return (ACC_STYLES[t.style] || t.style) + (t.fill ? '＋フィル' : '');
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

export function generateAcc(style) {
  const st = style || weighted(Object.keys(ACC_STYLES), [0.6, 1, 0.8, 1.2, 1.1, 1, 0.8, 1.1, 1.1]);
  const a = barFor(st);
  const fill = rand() < 0.45;
  return { id: newId(), style: st, reg: pick([50, 52, 52, 55]), fill, bars: fill ? [a, withFill(a)] : [a] };
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
  while (out.length < count) out.push({ ...generateAcc(t.style), reg: t.reg });
  return out;
}

// コードに当てはめて音（{p,s,d,inst}）にする
export function realizeBar(t, chord, barIndex) {
  const bar = t.bars[barIndex % t.bars.length];
  const root = 40 + ((chord.rootPc - 4 + 12) % 12); // E2〜D#3（スマホでも聞こえる高さ）
  // 段: reg 以上のコードトーンを下から順に
  const ladder = [];
  for (let p = t.reg; ladder.length < 7; p++) if (chord.pcs.includes(p % 12)) ladder.push(p);
  const close = ladder.slice(0, chord.pcs.length);
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
