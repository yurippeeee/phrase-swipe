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
};

export function accName(t) {
  if (!t) return '';
  return (ACC_STYLES[t.style] || t.style) + (t.fill ? '＋フィル' : '');
}

const ev = (s, d, v, inst = 'keys') => ({ s, d, v, inst });

// 'x' の位置に音を置くリズム（16分 × 16）
const STAB_RHYTHMS = ['x...x...x...x...', 'x..x..x...x..x..', '..x...x...x...x.', 'x.x.x.x.x.x.x.x.', 'x..x..x.x..x..x.', 'x.....x...x.....', 'x...x..x..x.x...'];
const ARP_ORDERS = [[0, 1, 2, 3], [0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 4, 2], [2, 1, 0, 1], [0, 1, 2, 4]];

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

// 1小節ぶんの型をスタイルごとに作る
function barFor(style) {
  switch (style) {
    case 'pad':
      return [ev(0, 16, ['R'], 'bass'), ev(0, 16, ['C'], 'pad')];
    case 'stab': {
      const r = pick(STAB_RHYTHMS);
      const bass = rand() < 0.5 ? [ev(0, 16, ['R'], 'bass')] : [ev(0, 8, ['R'], 'bass'), ev(8, 8, [pick(['R', 'F'])], 'bass')];
      return [...bass, ...fromRhythm(r, ['C'], 'keys', rand() < 0.5 ? 2 : 4)];
    }
    case 'oompah':
      return rand() < 0.5
        ? [ev(0, 4, ['R'], 'bass'), ev(4, 3, ['C']), ev(8, 4, ['F'], 'bass'), ev(12, 3, ['C'])]
        : [ev(0, 2, ['R'], 'bass'), ev(2, 2, ['C']), ev(4, 2, ['F'], 'bass'), ev(6, 2, ['C']), ev(8, 2, ['R'], 'bass'), ev(10, 2, ['C']), ev(12, 2, ['F'], 'bass'), ev(14, 2, ['C'])];
    case 'arp': {
      const rate = weighted([2, 1, 4], [3, 1.2, 0.6]);
      return [ev(0, 16, ['R'], 'bass'), ...arpRun(0, 16, rate, pick(ARP_ORDERS))];
    }
    case 'mix': {
      const order = pick(ARP_ORDERS);
      return rand() < 0.5
        ? [ev(0, 16, ['R'], 'bass'), ev(0, 8, ['C']), ...arpRun(8, 16, 2, order)]
        : [ev(0, 16, ['R'], 'bass'), ...arpRun(0, 8, 2, order), ev(8, 6, ['C'])];
    }
    case 'broken': {
      // 単音を不規則なリズムで。拍頭には和音を少しだけ
      const out = [ev(0, 8, ['R'], 'bass')];
      const r = pick(['x..x..x.x..x.x..', 'x.x..x..x.x..x..', '.x.x.x...x.x.x..', 'x..x...xx..x..x.']);
      let k = 0;
      for (let s = 0; s < 16; s++) {
        if (r[s] !== 'x') continue;
        if (s === 8 && rand() < 0.5) out.push(ev(s, 4, ['C']));
        else out.push(ev(s, 2, [pick([0, 1, 2, 3, 2, 1].slice(k % 3, k % 3 + 3))]));
        k++;
      }
      out.push(ev(8, 8, [pick(['R', 'F'])], 'bass'));
      return out;
    }
    case 'bassline':
    default: {
      const line = pick([
        [ev(0, 6, ['R'], 'bass'), ev(6, 2, ['R'], 'bass'), ev(8, 4, ['F'], 'bass'), ev(12, 4, ['O'], 'bass')],
        [ev(0, 3, ['R'], 'bass'), ev(3, 3, ['R'], 'bass'), ev(6, 2, ['F'], 'bass'), ev(8, 4, ['O'], 'bass'), ev(12, 4, ['F'], 'bass')],
        [ev(0, 4, ['R'], 'bass'), ev(4, 4, ['F'], 'bass'), ev(8, 4, ['O'], 'bass'), ev(12, 4, ['F'], 'bass')],
      ]);
      return [...line, ev(0, 16, ['C'], 'pad')];
    }
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
  const st = style || weighted(Object.keys(ACC_STYLES), [0.8, 1, 0.9, 1.3, 1.2, 1, 0.8]);
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
