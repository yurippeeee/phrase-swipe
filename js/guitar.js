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
