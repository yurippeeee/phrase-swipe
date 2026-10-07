import { KEY_NAMES, parseProgression } from './theory.js';
import { generateAcc, defaultAcc, accVariants, accName, realizeBar } from './accomp.js';
import { START_DEGREES, PROGRESSIONS, PROG_NAMES } from './progressions.js';
import { generatePhrase, makeVariants, copyPhrase, endingVariants, reharmonize, originLabel, STEPS_PER_BAR } from './generator.js';
import * as audio from './audio.js';
import { drawRoll } from './roll.js';
import { buildMidi, downloadMidi } from './midi.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'phraseSwipe.v1';
const SETTINGS_VER = 2;

const state = {
  settings: { key: 0, scale: 'major', bpm: 100, prog: 'I-V-vi-IV', bars: 'random', accVol: 0 },
  deck: [],
  shelf: [],
  mode: 'melody', // 'melody' | 'acc'（伴奏を選ぶ）
  accDeck: [],
  accTargetId: null, // 伴奏を選ぶ対象のフレーズ
  accDefault: defaultAcc(), // これからキープするフレーズに付く伴奏
  forcePos: null, // 次の候補をコード進行のこの位置から始める（進行の帯で指定・進行を変えた直後）
  contextOn: false,
  padOn: true,
  cardPlaying: true,
  judged: 0,
};

// ---------- 保存 ----------
function save() {
  try {
    const { settings, shelf, contextOn, padOn, judged, accDefault, forcePos } = state;
    localStorage.setItem(STORE_KEY, JSON.stringify({ settings, settingsVer: SETTINGS_VER, shelf, contextOn, padOn, judged, accDefault, forcePos }));
  } catch (e) {
    /* 容量超過やプライベートモード */
  }
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!d) return;
    Object.assign(state.settings, d.settings || {});
    // v1 は長さ固定（2小節）が既定だったので、ランダムに移行
    if ((d.settingsVer || 1) < 2) state.settings.bars = 'random';
    state.shelf = Array.isArray(d.shelf) ? d.shelf : [];
    state.contextOn = !!d.contextOn;
    state.padOn = d.padOn !== false;
    state.judged = d.judged || 0;
    if (d.accDefault && d.accDefault.bars) state.accDefault = d.accDefault;
    state.forcePos = Number.isInteger(d.forcePos) ? d.forcePos : null;
  } catch (e) {
    /* 壊れたデータは無視 */
  }
}

// ---------- 候補の生成 ----------
function progression() {
  const s = state.settings;
  const chords = parseProgression(s.prog, s.key, s.scale);
  return chords.length ? chords : parseProgression('I', s.key, s.scale);
}

const lastKept = () => state.shelf[state.shelf.length - 1];

// 直前のフレーズの続き（コード進行上の位置）から、次のフレーズが担当するコードを決める。
// くり返したフレーズはコードも同じなので、くり返しの後は元のフレーズの続きから進む
function nextSlot(bars) {
  const prog = progression();
  const last = lastKept();
  const pos =
    state.forcePos != null ? state.forcePos : !last ? 0 : last.pos != null ? last.pos + last.bars : state.shelf.reduce((a, p) => a + p.bars, 0);
  const chords = [];
  for (let b = 0; b < bars; b++) chords.push(prog[(pos + b) % prog.length]);
  return { chords, bars, pos: pos % prog.length };
}

// 長さ「ランダム」は 1小節多め
const pickBars = () => (state.settings.bars === 'random' ? (Math.random() < 0.6 ? 1 : 2) : state.settings.bars);

const chordsKey = (chords) => chords.map((c) => c.label).join(' ');
const motifOf = (p) => p.motif || p.id;
// 候補が今の位置に置けるか（語尾違いは直前のフレーズと同じ位置の代わりなので、直前と同じ動機なら可）
const fitsSlot = (p) =>
  p.origin === 'ending' ? !!lastKept() && motifOf(lastKept()) === p.motif : chordsKey(p.chords) === chordsKey(nextSlot(p.bars).chords);

function newCandidate() {
  const s = state.settings;
  const { chords, bars, pos } = nextSlot(pickBars());
  const last = lastKept();
  const prevPitch = last && last.notes.length ? last.notes[last.notes.length - 1].p : undefined;
  return generatePhrase({ key: s.key, scale: s.scale, chords, bars, pos, prevPitch });
}

function fillDeck() {
  while (state.deck.length < 3) state.deck.push(newCandidate());
}

// ---------- 再生用シーケンス ----------
const accOf = (ph) => ph.acc || state.accDefault;

// accOverride: 伴奏の候補を試すときに、フレーズの伴奏の代わりに使う型
function buildSeq(phrases, withAcc, accOverride) {
  const notes = [];
  const acc = [];
  const ranges = [];
  let off = 0;
  for (const ph of phrases) {
    for (const n of ph.notes) notes.push({ p: n.p, s: n.s + off, d: n.d });
    const t = accOverride || accOf(ph);
    for (let b = 0; b < ph.bars; b++) {
      const c = ph.chords[b % ph.chords.length];
      if (c) for (const a of realizeBar(t, c, b)) acc.push({ ...a, s: a.s + off + b * STEPS_PER_BAR });
    }
    ranges.push([off, off + ph.bars * STEPS_PER_BAR]);
    off += ph.bars * STEPS_PER_BAR;
  }
  return { steps: off, notes, acc: withAcc ? acc : [], allAcc: acc, ranges };
}

// ---------- 伴奏モード ----------
const curDeck = () => (state.mode === 'acc' ? state.accDeck : state.deck);

// 伴奏を合わせる対象：棚で指定したフレーズ → 直前のキープ → メロディ候補
function accTarget() {
  const t = state.shelf.find((p) => p.id === state.accTargetId) || lastKept();
  if (t) return t;
  fillDeck();
  return state.deck[0];
}

function fillCur() {
  if (state.mode === 'acc') while (state.accDeck.length < 3) state.accDeck.push(generateAcc());
  else fillDeck();
}

function setMode(mode) {
  state.mode = mode;
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === mode);
  $('tglContext').classList.toggle('hidden', mode === 'acc');
  $('btnAccAll').classList.toggle('hidden', mode !== 'acc');
  if (!$('viewSwipe').classList.contains('hidden')) renderDeck();
}

// 選んでいる伴奏を棚の全フレーズに
function applyAccToAll() {
  const t = state.accDeck[0];
  if (!t) return;
  for (const ph of state.shelf) ph.acc = t;
  state.accDefault = t;
  save();
  toast(`棚の全フレーズを「${accName(t)}」に`);
}

// ---------- カード ----------
const deckEl = $('deck');

function cardEl(item, behind) {
  if (state.mode === 'acc') return accCardEl(item, behind);
  const phrase = item;
  const el = document.createElement('div');
  el.className = 'card' + (behind ? ' behind' : '');
  el.innerHTML = `
    <div class="card-head"><span class="tag"></span><span class="ctx"></span><span class="num"></span></div>
    <canvas></canvas>
    <div class="card-foot"><span>← ボツ</span><span>タップで再生/停止</span><span>キープ →</span></div>
    <div class="stamp keep">KEEP</div><div class="stamp nope">NOPE</div>`;
  const tag = el.querySelector('.tag');
  tag.textContent = originLabel(phrase.origin);
  tag.classList.add(phrase.origin);
  el.querySelector('.num').textContent = `#${state.judged + (behind ? 2 : 1)}`;
  el._phrase = phrase;
  return el;
}

function accCardEl(t, behind) {
  const el = document.createElement('div');
  el.className = 'card' + (behind ? ' behind' : '');
  el.innerHTML = `
    <div class="card-head"><span class="tag acc"></span><span class="ctx"></span><span class="num"></span></div>
    <canvas></canvas>
    <div class="card-foot"><span>← ボツ</span><span>タップで再生/停止</span><span>この伴奏 →</span></div>
    <div class="stamp keep">KEEP</div><div class="stamp nope">NOPE</div>`;
  el.querySelector('.tag').textContent = accName(t);
  const target = accTarget();
  const k = state.shelf.indexOf(target);
  el.querySelector('.num').textContent = k >= 0 ? `棚の${k + 1}番` : 'メロディ候補';
  el._acc = t;
  el._phrase = target;
  el._segs = [{ phrase: target, acc: buildSeq([target], true, t).acc, accFocus: true }];
  return el;
}

function segmentsFor(el) {
  return el._segs || cardSegments(el._phrase);
}

function cardSegments(phrase) {
  const last = lastKept();
  return state.contextOn && last ? [{ phrase: last, faded: true }, { phrase }] : [{ phrase }];
}

function renderBack() {
  fillCur();
  const old = deckEl.querySelector('.card.behind');
  const back = cardEl(curDeck()[1], true);
  if (old) old.replaceWith(back);
  else deckEl.prepend(back);
  drawRoll(back.querySelector('canvas'), back._segs || [{ phrase: back._phrase }]);
}

function renderDeck() {
  fillCur();
  deckEl.innerHTML = '';
  const top = cardEl(curDeck()[0], false);
  deckEl.append(top);
  renderBack();
  updateCtxLabel();
  updateLastBar();
  renderProgBar();
  bindSwipe(top);
  playCurrent();
}

// コード進行の帯：今のカードが進行のどこかを示す。タップでそのコードから作り直す
function renderProgBar() {
  const bar = $('progBar');
  bar.classList.toggle('hidden', state.mode === 'acc');
  const prog = progression();
  const top = topCard();
  const ph = top && top._phrase;
  const covered = new Set();
  if (ph && ph.pos != null) for (let b = 0; b < ph.bars; b++) covered.add((ph.pos + b) % prog.length);
  bar.innerHTML = '';
  prog.forEach((c, i) => {
    const b = document.createElement('button');
    b.textContent = c.label;
    b.classList.toggle('cur', covered.has(i));
    b.onclick = () => {
      state.forcePos = i;
      state.deck = state.deck.filter(fitsSlot);
      save();
      renderDeck();
      toast(`${i + 1}つ目の ${c.label} から作ります`);
    };
    bar.append(b);
  });
}

function updateCtxLabel() {
  const top = topCard();
  if (!top) return;
  if (state.mode === 'acc') top.querySelector('.ctx').textContent = '伴奏を選ぶ';
  else top.querySelector('.ctx').textContent = state.contextOn ? (lastKept() ? '◀ 直前のキープから' : '（棚が空）') : '';
}

function topCard() {
  return deckEl.querySelector('.card:not(.behind)');
}

function playCurrent() {
  const item = curDeck()[0];
  if (!item || !audio.isUnlocked() || $('viewSwipe').classList.contains('hidden')) return;
  if (!state.cardPlaying) {
    audio.stop();
    return;
  }
  const seq =
    state.mode === 'acc' ? buildSeq([accTarget()], true, item) : buildSeq(cardSegments(item).map((s) => s.phrase), state.padOn);
  audio.play({ ...seq, loop: true }, state.settings.bpm);
}

// ---------- スワイプ ----------
function bindSwipe(el) {
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let t0 = 0;
  let active = false;
  const stamps = { keep: el.querySelector('.stamp.keep'), nope: el.querySelector('.stamp.nope') };

  el.addEventListener('pointerdown', (e) => {
    active = true;
    sx = e.clientX;
    sy = e.clientY;
    dx = 0;
    t0 = performance.now();
    el.classList.remove('back');
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!active) return;
    dx = e.clientX - sx;
    const dy = (e.clientY - sy) * 0.2;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const r = Math.min(1, Math.abs(dx) / 100);
    stamps.keep.style.opacity = dx > 0 ? r : 0;
    stamps.nope.style.opacity = dx < 0 ? r : 0;
  });
  const end = () => {
    if (!active) return;
    active = false;
    const w = el.clientWidth;
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) > w * 0.28 || (Math.abs(dx) > 40 && v > 0.6)) {
      decide(dx > 0 ? 'keep' : 'nope');
    } else {
      if (Math.abs(dx) < 6) togglePlay();
      el.classList.add('back');
      el.style.transform = '';
      stamps.keep.style.opacity = 0;
      stamps.nope.style.opacity = 0;
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

let deciding = false;
function decide(kind) {
  const el = topCard();
  if (!el || deciding) return;
  deciding = true;
  const item = curDeck().shift();
  if (kind === 'keep' && state.mode === 'acc') {
    // 対象フレーズの伴奏にし、これからキープするフレーズにも使う
    const target = accTarget();
    if (state.shelf.includes(target)) target.acc = item;
    state.accDefault = item;
    toast(`伴奏「${accName(item)}」に決定`);
  } else if (kind === 'keep') {
    const ph = item;
    ph.acc = ph.acc || (ph.origin === 'ending' && lastKept() ? lastKept().acc : null) || state.accDefault;
    state.shelf.push(ph);
    state.forcePos = null;
    // 担当コードが変わるので、合わなくなった候補は作り直す（語尾違いを選んだら他の語尾違いは片付ける）
    state.deck = state.deck.filter((p) => fitsSlot(p) && !(ph.origin === 'ending' && p.origin === 'ending'));
    state.accTargetId = null;
    toast(`キープ（${state.shelf.length}）`);
  }
  const dir = kind === 'keep' ? 1 : -1;
  el.classList.add('fly');
  el.style.transform = `translate(${dir * window.innerWidth * 1.2}px, 40px) rotate(${dir * 24}deg)`;
  el.querySelector(`.stamp.${kind}`).style.opacity = 1;
  state.judged++;
  updateCounts();
  save();
  setTimeout(() => {
    deciding = false;
    renderDeck();
  }, 200);
}

// ---------- 直前のキープ：くり返し ----------
// 末尾で同じ動機が何回続いているか
function runLength() {
  const last = lastKept();
  let n = 0;
  for (let i = state.shelf.length - 1; i >= 0 && motifOf(state.shelf[i]) === motifOf(last); i--) n++;
  return n;
}

function updateLastBar() {
  const last = lastKept();
  $('lastBar').classList.toggle('hidden', !last || state.mode === 'acc');
  if (!last) return;
  $('lastCount').textContent = `×${runLength()}`;
  drawRoll($('lastRoll'), [{ phrase: last }], { labels: false });
}

// 全く同じフレーズを棚に足す
function repeatLast() {
  const last = lastKept();
  if (!last) return;
  state.shelf.push(copyPhrase(last));
  state.forcePos = null;
  state.deck = state.deck.filter(fitsSlot);
  updateCounts();
  updateLastBar();
  save();
  toast(`くり返し ×${runLength()}`);
  if (!state.deck.length) renderDeck();
}

// 直前のフレーズの語尾だけ違う候補を先頭に並べる
function endingsOfLast() {
  const last = lastKept();
  if (!last || deciding) return;
  const vars = endingVariants(last, 5);
  state.deck = [...vars, ...state.deck.filter((p) => p.origin !== 'ending')];
  renderDeck();
  toast(`語尾違いを${vars.length}つ用意`);
}

function similar() {
  const item = curDeck()[0];
  if (!item || deciding) return;
  const vars = state.mode === 'acc' ? accVariants(item, 5) : makeVariants(item, 5);
  curDeck().splice(1, 0, ...vars);
  renderBack();
  toast(`近い候補を${vars.length}つ追加`);
}

function togglePlay() {
  state.cardPlaying = !state.cardPlaying;
  $('btnPlayCard').textContent = state.cardPlaying ? '一時停止' : '▶ 再生';
  playCurrent();
}

function setContext(on) {
  state.contextOn = on;
  $('tglContext').setAttribute('aria-pressed', String(on));
  updateCtxLabel();
  save();
  playCurrent();
}

function setPad(on) {
  state.padOn = on;
  $('tglPad').setAttribute('aria-pressed', String(on));
  $('tglPad2').setAttribute('aria-pressed', String(on));
  save();
  if (!$('viewSwipe').classList.contains('hidden')) playCurrent();
  else if (songPlaying) playSong();
}

// ---------- 棚 ----------
let songPlaying = false;
let songRanges = null; // 再生中の各行の [開始, 終了] ステップ
let songRows = null; // 再生中の行インデックス

function updateCounts() {
  $('shelfCount').textContent = state.shelf.length;
}

function renderShelf() {
  const ul = $('shelf');
  ul.innerHTML = '';
  stopSong();
  $('shelfEmpty').classList.toggle('hidden', state.shelf.length > 0);
  $('btnPlaySong').disabled = !state.shelf.length;
  const bars = state.shelf.reduce((a, p) => a + p.bars, 0);
  const sec = Math.round((bars * 4 * 60) / state.settings.bpm);
  $('shelfSummary').textContent = `${state.shelf.length}フレーズ / ${bars}小節 / 約${sec}秒`;
  state.shelf.forEach((ph, i) => {
    const li = document.createElement('li');
    li.className = 'row';
    // 行はフレーズそのものを持ち、操作時に現在の位置を引き直す（古い番号で別のフレーズを触らない）
    li._phrase = ph;
    const at = () => state.shelf.indexOf(ph);
    li.innerHTML = `<button class="handle" aria-label="並べ替え">≡</button><canvas></canvas><button class="accbtn" aria-label="伴奏を選ぶ">♫</button><button class="dup" aria-label="くり返し（複製）">⧉</button><button class="del" aria-label="削除">✕</button><span class="idx">${i + 1} · ${accName(accOf(ph))}</span>`;
    li.querySelector('.del').onclick = () => {
      if (at() < 0) return;
      state.shelf.splice(at(), 1);
      updateCounts();
      save();
      renderShelf();
    };
    li.querySelector('.dup').onclick = () => {
      const k = at();
      if (k < 0) return;
      state.shelf.splice(k + 1, 0, copyPhrase(ph));
      updateCounts();
      save();
      renderShelf();
      toast(`${k + 1} をくり返しました`);
    };
    li.querySelector('canvas').onclick = () => at() >= 0 && playRow(at());
    li.querySelector('.accbtn').onclick = () => {
      state.accTargetId = ph.id;
      setMode('acc');
      showView('viewSwipe');
    };
    // 小節数が分かるよう、短いフレーズは幅も短く
    const maxBars = Math.max(...state.shelf.map((p) => p.bars));
    li.querySelector('canvas').style.width = `${(ph.bars / maxBars) * 100}%`;
    bindDrag(li);
    ul.append(li);
  });
  drawShelfRows();
}

function drawShelfRows(playStep = -1) {
  const rows = $('shelf').children;
  for (let i = 0; i < rows.length; i++) {
    let step = -1;
    if (songRanges && songRows) {
      const k = songRows.indexOf(i);
      const r = songRanges[k];
      if (r && playStep >= r[0] && playStep < r[1]) step = playStep - r[0];
    }
    rows[i].classList.toggle('playing', step >= 0);
    if (rows[i]._phrase) drawRoll(rows[i].querySelector('canvas'), [{ phrase: rows[i]._phrase }], { playStep: step });
  }
}

function playPhrases(indices) {
  if (!audio.isUnlocked() || !indices.length) return;
  const seq = buildSeq(indices.map((i) => state.shelf[i]), state.padOn);
  songRanges = seq.ranges;
  songRows = indices;
  songPlaying = true;
  $('btnPlaySong').textContent = '■ 停止';
  audio.play({ ...seq, loop: false, onEnd: stopSong }, state.settings.bpm);
}

function playSong() {
  playPhrases(state.shelf.map((_, i) => i));
}

function playRow(i) {
  playPhrases([i]);
}

function stopSong() {
  if (songPlaying) audio.stop();
  songPlaying = false;
  songRanges = null;
  songRows = null;
  $('btnPlaySong').textContent = '▶ 通し再生';
  drawShelfRows();
}

// ドラッグで並べ替え（タッチ対応のため Pointer Events で自前実装）
function bindDrag(li) {
  const handle = li.querySelector('.handle');
  const ul = $('shelf');
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const index = state.shelf.indexOf(li._phrase);
    if (index < 0) return;
    stopSong();
    handle.setPointerCapture(e.pointerId);
    const rows = [...ul.children];
    const rowH = li.getBoundingClientRect().height + 8;
    const startY = e.clientY;
    const startScroll = ul.scrollTop;
    let target = index;
    li.classList.add('dragging');
    for (const r of rows) if (r !== li) r.style.transition = 'transform 0.15s';

    const move = (ev) => {
      const rect = ul.getBoundingClientRect();
      if (ev.clientY < rect.top + 40) ul.scrollTop -= 8;
      else if (ev.clientY > rect.bottom - 40) ul.scrollTop += 8;
      const dy = ev.clientY - startY + (ul.scrollTop - startScroll);
      li.style.transform = `translateY(${dy}px)`;
      target = Math.max(0, Math.min(rows.length - 1, index + Math.round(dy / rowH)));
      rows.forEach((r, j) => {
        if (r === li) return;
        let shift = 0;
        if (index < target && j > index && j <= target) shift = -rowH;
        if (index > target && j < index && j >= target) shift = rowH;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (target !== index) {
        const [ph] = state.shelf.splice(index, 1);
        state.shelf.splice(target, 0, ph);
        save();
      }
      renderShelf();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

function exportMidi() {
  if (!state.shelf.length) {
    toast('棚が空です');
    return;
  }
  const seq = buildSeq(state.shelf, true);
  const bytes = buildMidi({
    bpm: state.settings.bpm,
    tracks: [
      { name: 'Melody', program: 0, notes: seq.notes, vel: 100 },
      { name: 'Accomp', program: 0, notes: seq.allAcc.filter((a) => a.inst !== 'bass'), vel: 70 },
      { name: 'Bass', program: 33, notes: seq.allAcc.filter((a) => a.inst === 'bass'), vel: 90 },
    ],
  });
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  downloadMidi(bytes, `phrase-swipe-${stamp}.mid`);
  toast('MIDIを書き出しました');
}

// ---------- 設定 ----------
function openSheet(open) {
  $('sheet').classList.toggle('open', open);
  $('sheet').setAttribute('aria-hidden', String(!open));
  $('sheetBackdrop').classList.toggle('hidden', !open);
  if (open) syncSettingsForm();
}

let draft = null;
function syncSettingsForm() {
  draft = { ...state.settings };
  const keyEl = $('setKey');
  keyEl.innerHTML = '';
  KEY_NAMES.forEach((n, i) => {
    const b = document.createElement('button');
    b.textContent = n;
    b.dataset.v = i;
    keyEl.append(b);
  });
  $('setBpm').value = draft.bpm;
  $('setAccVol').value = draft.accVol;
  $('setProg').value = draft.prog;
  progStart = null;
  refreshForm();
}

// 先頭コードを選ぶと、そこから続く4コード進行の一覧を出す
let progStart = null;
function renderProgList() {
  const starts = START_DEGREES[draft.scale];
  const first = draft.prog.split(/[\s\-–,|]+/)[0];
  if (!progStart || !starts.includes(progStart)) progStart = starts.includes(first) ? first : starts[0];
  const startEl = $('progStart');
  startEl.innerHTML = '';
  for (const d of starts) {
    const b = document.createElement('button');
    const c = parseProgression(d, draft.key, draft.scale)[0];
    b.innerHTML = `${d}<small>${c ? c.label : ''}</small>`;
    b.classList.toggle('on', d === progStart);
    b.onclick = () => {
      progStart = d;
      refreshForm();
    };
    startEl.append(b);
  }
  const list = $('progList');
  list.innerHTML = '';
  for (const p of PROGRESSIONS[draft.scale][progStart] || []) {
    const b = document.createElement('button');
    const names = parseProgression(p, draft.key, draft.scale).map((c) => c.label).join(' ');
    b.innerHTML = `<b>${p}</b><span>${names}</span>${PROG_NAMES[p] ? `<em>${PROG_NAMES[p]}</em>` : ''}`;
    b.classList.toggle('on', p === draft.prog);
    b.onclick = () => {
      draft.prog = p;
      $('setProg').value = p;
      refreshForm();
    };
    list.append(b);
  }
}

function refreshForm() {
  for (const b of $('setKey').children) b.classList.toggle('on', +b.dataset.v === draft.key);
  for (const b of $('setScale').children) b.classList.toggle('on', b.dataset.v === draft.scale);
  for (const b of $('setBars').children) b.classList.toggle('on', b.dataset.v === String(draft.bars));
  $('bpmOut').textContent = draft.bpm;
  $('accVolOut').textContent = `${draft.accVol > 0 ? '+' : ''}${draft.accVol} dB`;
  const chords = parseProgression(draft.prog, draft.key, draft.scale);
  const pv = $('progPreview');
  pv.classList.toggle('err', !chords.length);
  pv.textContent = chords.length ? `${chords.length}コード: ${chords.map((c) => c.label).join(' → ')}` : '度数を読み取れません（例: I-V-vi-IV）';
  renderProgList();
}

function bindSettings() {
  $('setKey').addEventListener('click', (e) => {
    if (e.target.dataset.v == null) return;
    draft.key = +e.target.dataset.v;
    refreshForm();
  });
  $('setScale').addEventListener('click', (e) => {
    if (!e.target.dataset.v) return;
    draft.scale = e.target.dataset.v;
    // スケールを変えたら、そのスケールの先頭コードの定番に
    if (!PROGRESSIONS[draft.scale][draft.prog.split(/[\s\-–,|]+/)[0]]) {
      draft.prog = PROGRESSIONS[draft.scale][START_DEGREES[draft.scale][0]][0];
      $('setProg').value = draft.prog;
    }
    progStart = null;
    refreshForm();
  });
  $('setBars').addEventListener('click', (e) => {
    if (!e.target.dataset.v) return;
    draft.bars = e.target.dataset.v === 'random' ? 'random' : +e.target.dataset.v;
    refreshForm();
  });
  $('setBpm').addEventListener('input', (e) => {
    draft.bpm = +e.target.value;
    refreshForm();
  });
  // 伴奏の音量はその場で聞き比べられるよう即反映（閉じても保存）
  $('setAccVol').addEventListener('input', (e) => {
    draft.accVol = +e.target.value;
    state.settings.accVol = draft.accVol;
    audio.setAccVolume(draft.accVol);
    save();
    refreshForm();
  });
  $('setProg').addEventListener('input', (e) => {
    draft.prog = e.target.value;
    refreshForm();
  });
  $('btnApply').onclick = () => {
    if (!parseProgression(draft.prog, draft.key, draft.scale).length) return;
    const regen = ['key', 'scale', 'prog', 'bars'].some((k) => draft[k] !== state.settings[k]);
    const harmonyChanged = ['key', 'scale', 'prog'].some((k) => draft[k] !== state.settings[k]);
    state.settings = { ...draft };
    if (regen) state.deck = [];
    if (harmonyChanged) {
      if (state.shelf.length && confirm(`棚の${state.shelf.length}フレーズにも新しいコード進行を当てはめますか？\n（メロディの強拍はコードに合わせて少し変わります。キャンセルで棚はそのまま）`)) {
        reharmonizeShelf();
        state.forcePos = null;
      } else {
        // 新しい進行は先頭のコードから使う
        state.forcePos = 0;
      }
    }
    state.accDeck = [];
    save();
    updateInfo();
    openSheet(false);
    if (!$('viewSwipe').classList.contains('hidden')) renderDeck();
    else renderShelf();
  };
  $('btnSettings').onclick = () => openSheet(true);
  $('sheetBackdrop').onclick = () => openSheet(false);
}

// 棚を先頭から新しい進行に沿って並べ直す。くり返し（同じ動機の連続）は同じコードのまま
function reharmonizeShelf() {
  const prog = progression();
  const { key, scale } = state.settings;
  let next = 0;
  let prev = null;
  state.shelf = state.shelf.map((ph) => {
    const isRepeat = prev && (ph.origin === 'repeat' || ph.origin === 'ending') && motifOf(ph) === motifOf(prev);
    const pos = isRepeat ? prev.pos : next % prog.length;
    const chords = [];
    for (let b = 0; b < ph.bars; b++) chords.push(prog[(pos + b) % prog.length]);
    const out = reharmonize(ph, { key, scale, chords, pos });
    next = pos + ph.bars;
    prev = out;
    return out;
  });
  updateLastBar();
}

function updateInfo() {
  const s = state.settings;
  $('info').textContent = `${KEY_NAMES[s.key]} ${s.scale === 'major' ? 'Major' : 'minor'} · ${s.bpm} BPM · ${s.prog}`;
}

// ---------- 共通 ----------
let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

function showView(id) {
  for (const t of document.querySelectorAll('.tab[data-view]')) t.classList.toggle('active', t.dataset.view === id);
  $('viewSwipe').classList.toggle('hidden', id !== 'viewSwipe');
  $('viewShelf').classList.toggle('hidden', id !== 'viewShelf');
  audio.stop();
  if (id === 'viewSwipe') {
    stopSong();
    // 棚の編集で担当コードが変わっていたら候補を入れ替える
    state.deck = state.deck.filter(fitsSlot);
    renderDeck();
  } else {
    renderShelf();
  }
}

// 再生位置のアニメーション
function frame() {
  if (!$('viewSwipe').classList.contains('hidden')) {
    const top = topCard();
    if (top) drawRoll(top.querySelector('canvas'), segmentsFor(top), { playStep: deciding ? -1 : audio.currentStep() });
  } else if (songPlaying) {
    drawShelfRows(audio.currentStep());
  }
  requestAnimationFrame(frame);
}

function init() {
  const ver = document.querySelector('meta[name="app-version"]');
  $('appVersion').textContent = `ver ${ver ? ver.content : '?'}`;
  load();
  updateInfo();
  updateCounts();
  bindSettings();
  $('tglContext').setAttribute('aria-pressed', String(state.contextOn));
  $('tglPad').setAttribute('aria-pressed', String(state.padOn));
  $('tglPad2').setAttribute('aria-pressed', String(state.padOn));
  for (const t of document.querySelectorAll('.tab[data-view]')) t.onclick = () => showView(t.dataset.view);
  $('btnKeep').onclick = () => decide('keep');
  $('btnNope').onclick = () => decide('nope');
  $('btnSimilar').onclick = similar;
  $('btnRepeat').onclick = repeatLast;
  $('btnEnding').onclick = endingsOfLast;
  $('btnPlayCard').onclick = togglePlay;
  $('btnAccAll').onclick = applyAccToAll;
  for (const b of document.querySelectorAll('#modeSeg button')) b.onclick = () => setMode(b.dataset.mode);
  $('tglContext').onclick = () => setContext(!state.contextOn);
  $('tglPad').onclick = () => setPad(!state.padOn);
  $('tglPad2').onclick = () => setPad(!state.padOn);
  $('btnPlaySong').onclick = () => (songPlaying ? stopSong() : playSong());
  $('btnMidi').onclick = exportMidi;
  $('btnClear').onclick = () => {
    if (!state.shelf.length || !confirm('キープ棚を全部消しますか？')) return;
    state.shelf = [];
    state.deck = [];
    updateCounts();
    save();
    renderShelf();
  };
  window.addEventListener('resize', () => {
    if (!$('viewShelf').classList.contains('hidden')) drawShelfRows();
  });
  setMode('melody');
  renderDeck();
  requestAnimationFrame(frame);

  audio.setAccVolume(state.settings.accVol || 0);
  $('unlock').addEventListener('click', async () => {
    await audio.unlock();
    $('unlock').remove();
    playCurrent();
  });
}

init();
