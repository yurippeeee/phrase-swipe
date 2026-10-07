import { KEY_NAMES, parseProgression } from './theory.js';
import { generatePhrase } from './generator.js';
import * as audio from './audio.js';
import { drawRoll } from './roll.js';

const $ = (id) => document.getElementById(id);

const PRESETS = ['I-V-vi-IV', 'I-vi-IV-V', 'vi-IV-I-V', 'ii-V-I-vi', 'I-IV-V-IV', 'i-VI-III-VII', 'i-iv-v-i', 'i-VII-VI-VII'];

const state = {
  settings: { key: 0, scale: 'major', bpm: 100, prog: 'I-V-vi-IV', bars: 2 },
  deck: [],
  shelf: [],
  cardPlaying: true,
};

// ---------- 候補の生成 ----------
function progression() {
  const s = state.settings;
  const chords = parseProgression(s.prog, s.key, s.scale);
  return chords.length ? chords : parseProgression('I', s.key, s.scale);
}

// 次に置く位置（棚の長さ）から、そのフレーズが担当するコードを決める
function nextSlot() {
  const prog = progression();
  const bar = state.shelf.reduce((a, p) => a + p.bars, 0);
  const bars = state.settings.bars;
  const chords = [];
  for (let b = 0; b < bars; b++) chords.push(prog[(bar + b) % prog.length]);
  return { chords, bars };
}

function newCandidate() {
  const s = state.settings;
  const { chords, bars } = nextSlot();
  return generatePhrase({ key: s.key, scale: s.scale, chords, bars });
}

function fillDeck() {
  while (state.deck.length < 3) state.deck.push(newCandidate());
}

// ---------- カード ----------
const deckEl = $('deck');
let cardCount = 0;

function cardEl(phrase, behind) {
  const el = document.createElement('div');
  el.className = 'card' + (behind ? ' behind' : '');
  el.innerHTML = `
    <div class="card-head"><span class="tag">新規</span><span class="num"></span></div>
    <canvas></canvas>
    <div class="card-foot"><span>← ボツ</span><span>タップで再生/停止</span><span>キープ →</span></div>
    <div class="stamp keep">KEEP</div><div class="stamp nope">NOPE</div>`;
  el.querySelector('.num').textContent = `#${cardCount + (behind ? 2 : 1)}`;
  el._phrase = phrase;
  return el;
}

function renderDeck() {
  fillDeck();
  deckEl.innerHTML = '';
  const back = cardEl(state.deck[1], true);
  const top = cardEl(state.deck[0], false);
  deckEl.append(back, top);
  drawRoll(back.querySelector('canvas'), [{ phrase: state.deck[1] }]);
  bindSwipe(top);
  playCurrent();
}

function topCard() {
  return deckEl.querySelector('.card:not(.behind)');
}

function currentSegments(el) {
  return [{ phrase: el._phrase }];
}

function playCurrent() {
  const ph = state.deck[0];
  if (!ph || !audio.isUnlocked()) return;
  if (!state.cardPlaying) {
    audio.stop();
    return;
  }
  audio.play({ steps: ph.bars * 16, notes: ph.notes, loop: true }, state.settings.bpm);
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
  const ph = state.deck.shift();
  if (kind === 'keep') {
    state.shelf.push(ph);
    // 位置（担当コード）が変わるので、残りの候補を作り直す
    state.deck = [];
    toast('キープしました');
  }
  const dir = kind === 'keep' ? 1 : -1;
  el.classList.add('fly');
  el.style.transform = `translate(${dir * window.innerWidth * 1.2}px, 40px) rotate(${dir * 24}deg)`;
  el.querySelector(`.stamp.${kind}`).style.opacity = 1;
  cardCount++;
  updateCounts();
  setTimeout(() => {
    deciding = false;
    renderDeck();
  }, 200);
}

function togglePlay() {
  state.cardPlaying = !state.cardPlaying;
  $('btnPlayCard').textContent = state.cardPlaying ? '⏸' : '▶';
  playCurrent();
}

// ---------- 棚 ----------
function updateCounts() {
  $('shelfCount').textContent = state.shelf.length;
}

function renderShelf() {
  const ul = $('shelf');
  ul.innerHTML = '';
  $('shelfEmpty').classList.toggle('hidden', state.shelf.length > 0);
  const bars = state.shelf.reduce((a, p) => a + p.bars, 0);
  $('shelfSummary').textContent = `${state.shelf.length}フレーズ / ${bars}小節`;
  state.shelf.forEach((ph, i) => {
    const li = document.createElement('li');
    li.className = 'row';
    li.innerHTML = `<button class="handle">≡</button><canvas></canvas><button class="del" aria-label="削除">✕</button><span class="idx">${i + 1}</span>`;
    li.querySelector('.del').onclick = () => {
      state.shelf.splice(i, 1);
      updateCounts();
      renderShelf();
    };
    ul.append(li);
    drawRoll(li.querySelector('canvas'), [{ phrase: ph }], { labels: true });
  });
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
  $('setProg').value = draft.prog;
  refreshForm();
}

function refreshForm() {
  for (const b of $('setKey').children) b.classList.toggle('on', +b.dataset.v === draft.key);
  for (const b of $('setScale').children) b.classList.toggle('on', b.dataset.v === draft.scale);
  for (const b of $('setBars').children) b.classList.toggle('on', +b.dataset.v === draft.bars);
  $('bpmOut').textContent = draft.bpm;
  const chords = parseProgression(draft.prog, draft.key, draft.scale);
  const pv = $('progPreview');
  pv.classList.toggle('err', !chords.length);
  pv.textContent = chords.length ? chords.map((c) => c.label).join(' → ') : '度数を読み取れません（例: I-V-vi-IV）';
  $('progPresets').innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.textContent = p;
    b.onclick = () => {
      draft.prog = p;
      draft.scale = p.startsWith('i-') ? 'minor' : 'major';
      $('setProg').value = p;
      refreshForm();
    };
    $('progPresets').append(b);
  }
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
    refreshForm();
  });
  $('setBars').addEventListener('click', (e) => {
    if (!e.target.dataset.v) return;
    draft.bars = +e.target.dataset.v;
    refreshForm();
  });
  $('setBpm').addEventListener('input', (e) => {
    draft.bpm = +e.target.value;
    refreshForm();
  });
  $('setProg').addEventListener('input', (e) => {
    draft.prog = e.target.value;
    refreshForm();
  });
  $('btnApply').onclick = () => {
    if (!parseProgression(draft.prog, draft.key, draft.scale).length) return;
    state.settings = { ...draft };
    state.deck = [];
    updateInfo();
    openSheet(false);
    renderDeck();
  };
  $('btnSettings').onclick = () => openSheet(true);
  $('sheetBackdrop').onclick = () => openSheet(false);
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
  if (id === 'viewSwipe') renderDeck();
  else {
    audio.stop();
    renderShelf();
  }
}

// 再生位置のアニメーション
function frame() {
  const top = topCard();
  if (top && !$('viewSwipe').classList.contains('hidden')) {
    drawRoll(top.querySelector('canvas'), currentSegments(top), { playStep: deciding ? -1 : audio.currentStep() });
  }
  requestAnimationFrame(frame);
}

function init() {
  updateInfo();
  updateCounts();
  bindSettings();
  for (const t of document.querySelectorAll('.tab[data-view]')) t.onclick = () => showView(t.dataset.view);
  $('btnKeep').onclick = () => decide('keep');
  $('btnNope').onclick = () => decide('nope');
  $('btnPlayCard').onclick = togglePlay;
  renderDeck();
  requestAnimationFrame(frame);

  $('unlock').addEventListener('click', async () => {
    await audio.unlock();
    $('unlock').remove();
    playCurrent();
  });
}

init();
