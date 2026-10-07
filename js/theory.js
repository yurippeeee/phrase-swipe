// 音楽理論ユーティリティ：キー・スケール・コード進行（度数表記）の解釈

export const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export function noteName(midi) {
  return KEY_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// "I-V-vi-IV" → [{degree, label, rootPc, pcs}]
// 対応表記: 大文字=メジャー, 小文字=マイナー, 末尾 °/dim=ディミニッシュ, 7=セブンス, 先頭 b/#=半音変化
export function parseProgression(text, key, scale) {
  const tokens = String(text)
    .split(/[\s\-–,|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const chords = [];
  for (const tok of tokens) {
    const c = parseDegree(tok, key, scale);
    if (c) chords.push(c);
  }
  return chords;
}

function parseDegree(tok, key, scale) {
  const m = tok.match(/^([b#♭♯]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(°|o|dim|\+|aug)?(maj7|M7|7)?$/);
  if (!m) return null;
  const [, acc, rn, qual, sev] = m;
  const idx = ROMAN.indexOf(rn.toUpperCase());
  const steps = SCALES[scale] || SCALES.major;
  let rootPc = key + steps[idx];
  if (acc === 'b' || acc === '♭') rootPc -= 1;
  if (acc === '#' || acc === '♯') rootPc += 1;
  rootPc = ((rootPc % 12) + 12) % 12;

  const upper = rn === rn.toUpperCase();
  let ivs;
  if (qual === '°' || qual === 'o' || qual === 'dim') ivs = [0, 3, 6];
  else if (qual === '+' || qual === 'aug') ivs = [0, 4, 8];
  else ivs = upper ? [0, 4, 7] : [0, 3, 7];
  if (sev === '7') ivs = [...ivs, 10];
  if (sev === 'maj7' || sev === 'M7') ivs = [...ivs, 11];

  const pcs = ivs.map((i) => (rootPc + i) % 12);
  const label = KEY_NAMES[rootPc] + (ivs[1] === 3 && ivs[2] === 7 ? 'm' : '') + (ivs[2] === 6 ? 'dim' : '') + (ivs[2] === 8 ? 'aug' : '') + (sev ? (sev === '7' ? '7' : 'M7') : '');
  return { degree: tok, label, rootPc, pcs };
}

// スケール音（MIDI番号）を範囲内で列挙
export function scalePitches(key, scale, lo, hi) {
  const steps = SCALES[scale] || SCALES.major;
  const out = [];
  for (let p = lo; p <= hi; p++) {
    if (steps.includes((((p - key) % 12) + 12) % 12)) out.push(p);
  }
  return out;
}

// パッド用のボイシング（C3〜C4付近）
export function voiceChord(chord) {
  const base = 48 + chord.rootPc; // C3〜B3
  const root = base > 55 ? base - 12 : base;
  const notes = chord.pcs.map((pc) => root + ((pc - chord.rootPc + 12) % 12));
  return [root - 12, ...notes];
}
