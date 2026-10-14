/**
 * 页面声音的总开关 + 桌宠点击音效。
 *
 * - 默认开启；用户在短片上关掉后记在本机（localStorage），下次来也保持安静。
 * - 浏览器不允许页面一打开就出声：开关是「开」也要等用户第一次点击/按键，声音才真正出来。
 * - 桌宠音效与 App 同一份文件（frontend-demo/scripts/gen-pet-sfx.mjs 生成）。
 */
import type { PetKind } from './rig';

const KEY = 'morning.sound';
const listeners = new Set<(on: boolean) => void>();

function read(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
let on = read();

export const soundOn = () => on;

export function setSoundOn(next: boolean): void {
  on = next;
  try { localStorage.setItem(KEY, next ? 'on' : 'off'); } catch { /* 隐私模式：只在本次生效 */ }
  listeners.forEach((l) => l(next));
}

export function onSoundChange(l: (on: boolean) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** 页面上第一次真实交互（点击、按键、触摸）时调用一次 fn；用于「默认开声音」的解锁。 */
export function onFirstGesture(fn: () => void): () => void {
  const events = ['pointerdown', 'keydown', 'touchend'] as const;
  const once = () => { off(); fn(); };
  const off = () => events.forEach((e) => window.removeEventListener(e, once, true));
  events.forEach((e) => window.addEventListener(e, once, { capture: true, passive: true }));
  return off;
}

let ctx: AudioContext | null = null;
const buffers = new Map<PetKind, Promise<AudioBuffer | null>>();

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  ctx = AC ? new AC() : null;
  return ctx;
}

function load(pet: PetKind, c: AudioContext): Promise<AudioBuffer | null> {
  let p = buffers.get(pet);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}assets/sfx/${pet}-poke.wav`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((b) => c.decodeAudioData(b))
      .catch(() => null);
    buffers.set(pet, p);
  }
  return p;
}

/** 点桌宠时调用（在点击事件里，浏览器允许出声）。音高每次随机偏一点，连点不会像复读机。 */
export function playPoke(pet: PetKind): void {
  if (!on) return;
  const c = audio();
  if (!c) return;
  void c.resume();
  void load(pet, c).then((buf) => {
    if (!buf || !on) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.96 + Math.random() * 0.09;
    const g = c.createGain();
    g.gain.value = 0.8;
    src.connect(g).connect(c.destination);
    src.start();
  });
}
