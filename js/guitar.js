// ギターで弾きやすい伴奏のための押さえ方（コードフォーム）
// 1小節の間は1つのフォームを押さえたまま、伴奏の型を「どの弦を鳴らすか」に置き換える

export const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // 6弦→1弦（レギュラーチューニング）

// コードの種類（ルートからの音程）
const QUALITIES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
};

// オープンコード（6弦→1弦のフレット、-1 は鳴らさない）
const OPEN_SHAPES = [
  { name: 'C', pc: 0, q: 'maj', f: [-1, 3, 2, 0, 1, 0] },
  { name: 'A', pc: 9, q: 'maj', f: [-1, 0, 2, 2, 2, 0] },
  { name: 'G', pc: 7, q: 'maj', f: [3, 2, 0, 0, 0, 3] },
  { name: 'E', pc: 4, q: 'maj', f: [0, 2, 2, 1, 0, 0] },
  { name: 'D', pc: 2, q: 'maj', f: [-1, -1, 0, 2, 3, 2] },
  { name: 'Am', pc: 9, q: 'min', f: [-1, 0, 2, 2, 1, 0] },
  { name: 'Em', pc: 4, q: 'min', f: [0, 2, 2, 0, 0, 0] },
  { name: 'Dm', pc: 2, q: 'min', f: [-1, -1, 0, 2, 3, 1] },
  { name: 'C7', pc: 0, q: '7', f: [-1, 3, 2, 3, 1, 0] },
  { name: 'A7', pc: 9, q: '7', f: [-1, 0, 2, 0, 2, 0] },
  { name: 'G7', pc: 7, q: '7', f: [3, 2, 0, 0, 0, 1] },
  { name: 'E7', pc: 4, q: '7', f: [0, 2, 0, 1, 0, 0] },
  { name: 'D7', pc: 2, q: '7', f: [-1, -1, 0, 2, 1, 2] },
  { name: 'B7', pc: 11, q: '7', f: [-1, 2, 1, 2, 0, 2] },
  { name: 'Am7', pc: 9, q: 'm7', f: [-1, 0, 2, 0, 1, 0] },
  { name: 'Em7', pc: 4, q: 'm7', f: [0, 2, 0, 0, 0, 0] },
  { name: 'Dm7', pc: 2, q: 'm7', f: [-1, -1, 0, 2, 1, 1] },
  { name: 'CM7', pc: 0, q: 'maj7', f: [-1, 3, 2, 0, 0, 0] },
  { name: 'FM7', pc: 5, q: 'maj7', f: [-1, -1, 3, 2, 1, 0] },
  { name: 'AM7', pc: 9, q: 'maj7', f: [-1, 0, 2, 1, 2, 0] },
  { name: 'DM7', pc: 2, q: 'maj7', f: [-1, -1, 0, 2, 2, 2] },
];

// 移動できるフォーム（バレー）。f はルートのフレット r からの相対、rs はルートの弦（0=6弦）
const MOVABLE = {
  maj: [{ form: 'Eフォーム', rs: 0, f: [0, 2, 2, 1, 0, 0] }, { form: 'Aフォーム', rs: 1, f: [-1, 0, 2, 2, 2, 0] }],
  min: [{ form: 'Emフォーム', rs: 0, f: [0, 2, 2, 0, 0, 0] }, { form: 'Amフォーム', rs: 1, f: [-1, 0, 2, 2, 1, 0] }],
  7: [{ form: 'E7フォーム', rs: 0, f: [0, 2, 0, 1, 0, 0] }, { form: 'A7フォーム', rs: 1, f: [-1, 0, 2, 0, 2, 0] }],
  m7: [{ form: 'Em7フォーム', rs: 0, f: [0, 2, 0, 0, 0, 0] }, { form: 'Am7フォーム', rs: 1, f: [-1, 0, 2, 0, 1, 0] }],
  maj7: [{ form: 'AM7フォーム', rs: 1, f: [-1, 0, 2, 1, 2, 0] }],
  dim: [{ form: 'dimフォーム', rs: 1, f: [-1, 0, 1, 2, 1, -1] }],
  aug: [{ form: 'augフォーム', rs: 1, f: [-1, 0, 3, 2, 2, -1] }],
};

const KEY = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function qualityOf(chord) {
  const ivs = [...new Set(chord.pcs.map((pc) => (pc - chord.rootPc + 12) % 12))].sort((a, b) => a - b).join(',');
  const q = Object.keys(QUALITIES).find((k) => QUALITIES[k].join(',') === ivs);
  if (q) return q;
  return ivs.split(',').includes('3') ? 'min' : 'maj'; // 表にない和音は3和音で
}

// フォーム → 鳴らす弦 [{ s, f, p }]（6弦から順）
function stringsOf(f) {
  const out = [];
  f.forEach((fret, s) => {
    if (fret >= 0) out.push({ s, f: fret, p: OPEN_MIDI[s] + fret });
  });
  return out;
}

// コードの押さえ方を選ぶ。オープンコードを優先し、なければ低いフレットのバレー
export function guitarShape(chord) {
  const q = qualityOf(chord);
  const open = OPEN_SHAPES.find((sh) => sh.pc === chord.rootPc && sh.q === q);
  if (open) {
    const strings = stringsOf(open.f);
    const bass = strings.find((x) => x.p % 12 === chord.rootPc) || strings[0];
    return { name: `${open.name}（オープン）`, strings, bass: bass.s, base: 0 };
  }
  let best = null;
  for (const m of MOVABLE[q] || MOVABLE.maj) {
    let r = (chord.rootPc - (OPEN_MIDI[m.rs] % 12) + 12) % 12;
    if (r === 0) r = 12; // 開放はオープンコード側で扱う
    const cost = r + (m.rs === 1 ? 0.5 : 0); // 低いフレットを優先（同じなら6弦ルート）
    if (!best || cost < best.cost) best = { cost, r, m };
  }
  const { r, m } = best;
  const strings = stringsOf(m.f.map((x) => (x < 0 ? -1 : x + r)));
  return { name: `${KEY[chord.rootPc]}${q === 'maj' ? '' : q === 'min' ? 'm' : q}（${m.form} ${r}f）`, strings, bass: m.rs, base: r };
}

// 伴奏の型の記号を、フォームの弦に置き換える
//   R: ルートの弦 / F: ルートの次の弦（交互ベース）/ O: ルートの2本上の弦
//   C: 和音（pad はベースから全部、それ以外はベースより上の弦）/ 数字: ベースより上の弦を低い方から順に
export function guitarNotes(shape, v, inst) {
  const above = shape.strings.filter((x) => x.s > shape.bass);
  const bassStr = shape.strings.find((x) => x.s === shape.bass) || shape.strings[0];
  const pick = (s) => shape.strings.find((x) => x.s === s);
  if (v === 'R') return [bassStr];
  if (v === 'F') return [pick(shape.bass + 1) || above[0] || bassStr];
  if (v === 'O') return [pick(shape.bass + 2) || above[1] || above[0] || bassStr];
  if (v === 'C') return inst === 'pad' ? shape.strings.filter((x) => x.s >= shape.bass) : above.length ? above : [bassStr];
  const k = Math.max(0, Math.min(above.length - 1, Number(v)));
  return [above[k] || bassStr];
}

// 構成音とベースから押さえ方を探す（名前の決まった形でなくても）
//   4フレットの範囲・中の弦はミュートしない（低音側と1弦だけ休ませてよい）
//   複数の弦をまとめて押さえるのは人差し指（セーハ）だけ、指は4本まで
const shapeCache = new Map();
export function guitarVoicingShape(vc, chord) {
  const key = `${vc.pcs.slice().sort((a, b) => a - b).join(',')}|${vc.bass}|${chord.rootPc}`;
  if (shapeCache.has(key)) return shapeCache.get(key);
  const pcs = new Set(vc.pcs);
  const fifth = (chord.rootPc + 7) % 12;
  // 4音以上で根音がベースなら5度は省いてよい（転回形で省くと別のコードに聞こえる）
  const need = [...pcs].filter((pc) => !(pc === fifth && pcs.size >= 4 && vc.bass === chord.rootPc));
  let best = null;
  for (let b = 0; b <= 9; b++) {
    const lo = Math.max(1, b);
    const hi = lo + 3;
    const opts = OPEN_MIDI.map((m) => {
      const o = [-1];
      if (b === 0 && pcs.has(m % 12)) o.push(0);
      for (let f = lo; f <= hi; f++) if (pcs.has((m + f) % 12)) o.push(f);
      return o;
    });
    const f = new Array(6);
    const visit = (s) => {
      if (s < 6) {
        for (const x of opts[s]) {
          f[s] = x;
          visit(s + 1);
        }
        return;
      }
      const score = rate(f, pcs, need, vc.bass);
      if (score != null && (!best || score < best.score)) best = { score, f: [...f] };
    };
    visit(0);
  }
  let shape = null;
  if (best) {
    const strings = stringsOf(best.f);
    const fretted = best.f.filter((x) => x > 0);
    const minF = fretted.length ? Math.min(...fretted) : 0;
    const pos = best.f.some((x) => x === 0) && Math.max(0, ...fretted) <= 4 ? 'オープン' : `${minF}f`;
    shape = { name: `${vc.label}（${pos}）`, strings, bass: strings[0].s, base: minF };
  }
  shapeCache.set(key, shape);
  return shape;
}

function rate(f, pcs, need, bassPc) {
  const first = f.findIndex((x) => x >= 0);
  if (first < 0) return null;
  // 中の弦のミュートは不可（1弦だけは休ませてよい）
  let top = 5;
  if (f[5] < 0) top = 4;
  for (let s = first; s <= top; s++) if (f[s] < 0) return null;
  const sounding = top - first + 1;
  if (sounding < 4) return null;
  if ((OPEN_MIDI[first] + f[first]) % 12 !== bassPc) return null;
  const got = new Set();
  const count = new Map();
  for (let s = first; s <= top; s++) {
    const pc = (OPEN_MIDI[s] + f[s]) % 12;
    got.add(pc);
    count.set(pc, (count.get(pc) || 0) + 1);
  }
  if (!need.every((pc) => got.has(pc))) return null;
  const fretted = [];
  for (let s = first; s <= top; s++) if (f[s] > 0) fretted.push(s);
  let fingers = 0;
  let barre = false;
  if (fretted.length) {
    const minF = Math.min(...fretted.map((s) => f[s]));
    const maxF = Math.max(...fretted.map((s) => f[s]));
    if (maxF - minF > 3) return null;
    const atMin = fretted.filter((s) => f[s] === minF);
    if (atMin.length >= 2) {
      // セーハ：一番低い押さえ弦から上に開放弦があると押さえられない
      for (let s = atMin[0]; s <= top; s++) if (f[s] === 0) return null;
      barre = true;
      fingers = 1 + fretted.length - atMin.length;
    } else fingers = fretted.length;
    if (fingers > 4) return null;
  }
  const opens = f.filter((x, s) => s >= first && s <= top && x === 0).length;
  const minF = fretted.length ? Math.min(...fretted.map((s) => f[s])) : 0;
  let dup = 0;
  for (const [, n] of count) if (n > 2) dup += n - 2;
  return minF * 0.5 + (6 - sounding) * 0.7 - opens * 0.3 + (barre ? 0.8 : 0) + dup * 0.6 + (f[5] < 0 ? 0.4 : 0) + first * 0.2;
}
