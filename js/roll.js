// 簡易ピアノロール（canvas）

const BLACK = [1, 3, 6, 8, 10];

const COLOR_VARS = ['roll-bg', 'roll-black', 'roll-fade', 'roll-bar', 'roll-beat', 'muted', 'chord', 'note', 'note-pass', 'playhead', 'acc', 'acc-bass'];
let palette = null;
function colors() {
  if (!palette) {
    const cs = getComputedStyle(document.documentElement);
    palette = {};
    for (const v of COLOR_VARS) palette[v] = cs.getPropertyValue('--' + v).trim();
  }
  return palette;
}

// segments: [{ phrase, faded, acc:[{p,s,d,inst}], accFocus }] を左から並べて描画
// accFocus: 伴奏を主役に描く（メロディは薄く）
// opts: { playStep, labels(コード名表示) }
export function drawRoll(canvas, segments, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const C = colors();
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const labelH = opts.labels === false ? 0 : 16;
  const totalSteps = segments.reduce((a, s) => a + s.phrase.bars * 16, 0);
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of segments) for (const n of [...s.phrase.notes, ...(s.acc || [])]) {
    lo = Math.min(lo, n.p);
    hi = Math.max(hi, n.p);
  }
  if (!isFinite(lo)) {
    lo = 60;
    hi = 72;
  }
  const minSpan = 14;
  if (hi - lo < minSpan) {
    const extra = minSpan - (hi - lo);
    lo -= Math.floor(extra / 2);
    hi += Math.ceil(extra / 2);
  }
  lo -= 1;
  hi += 1;
  const rows = hi - lo + 1;
  const rowH = (h - labelH) / rows;
  const stepW = w / totalSteps;
  const y = (p) => labelH + (hi - p) * rowH;

  // 背景（黒鍵の行を暗く）
  g.fillStyle = C['roll-bg'];
  g.fillRect(0, 0, w, h);
  g.fillStyle = C['roll-black'];
  for (let p = lo; p <= hi; p++) if (BLACK.includes(((p % 12) + 12) % 12)) g.fillRect(0, y(p), w, rowH);

  let x0 = 0;
  for (const seg of segments) {
    const ph = seg.phrase;
    const segSteps = ph.bars * 16;
    // 文脈部分は暗くする
    if (seg.faded) {
      g.fillStyle = C['roll-fade'];
      g.fillRect(x0 * stepW, 0, segSteps * stepW, h);
    }
    // 拍線・小節線
    for (let s = 0; s <= segSteps; s += 4) {
      const xx = Math.round((x0 + s) * stepW) + 0.5;
      g.strokeStyle = s % 16 === 0 ? C['roll-bar'] : C['roll-beat'];
      g.lineWidth = s % 16 === 0 ? 1.5 : 1;
      g.beginPath();
      g.moveTo(xx, labelH);
      g.lineTo(xx, h);
      g.stroke();
    }
    // コード名
    if (labelH) {
      g.font = '600 11px system-ui, sans-serif';
      g.textBaseline = 'middle';
      for (let b = 0; b < ph.bars; b++) {
        const c = ph.chords[b % ph.chords.length];
        g.fillStyle = seg.faded ? C.muted : C.chord;
        g.fillText(c ? c.label : '', (x0 + b * 16) * stepW + 5, labelH / 2 + 1);
      }
    }
    // 伴奏
    for (const n of seg.acc || []) {
      g.globalAlpha = seg.faded ? 0.3 : seg.accFocus ? 0.95 : 0.45;
      g.fillStyle = n.inst === 'bass' ? C['acc-bass'] : C.acc;
      roundRect(g, (x0 + n.s) * stepW + 1, y(n.p) + 0.5, Math.max(3, n.d * stepW - 2), Math.max(2, rowH - 1), Math.min(3, rowH / 2));
      g.fill();
    }
    g.globalAlpha = 1;
    // ノート
    for (const n of ph.notes) {
      const chord = ph.chords[Math.floor(n.s / 16) % ph.chords.length];
      const ct = chord && chord.pcs.includes(((n.p % 12) + 12) % 12);
      const nx = (x0 + n.s) * stepW + 1;
      const nw = Math.max(3, n.d * stepW - 2);
      const ny = y(n.p) + 0.5;
      const nh = Math.max(3, rowH - 1);
      g.globalAlpha = seg.faded ? 0.35 : seg.accFocus ? 0.5 : 1;
      g.fillStyle = ct ? C.note : C['note-pass'];
      roundRect(g, nx, ny, nw, nh, Math.min(4, nh / 2));
      g.fill();
      g.globalAlpha = 1;
    }
    x0 += segSteps;
  }

  // 再生位置
  if (opts.playStep != null && opts.playStep >= 0) {
    const px = opts.playStep * stepW;
    g.fillStyle = C.playhead;
    g.fillRect(px - 1, 0, 2, h);
  }
}

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
