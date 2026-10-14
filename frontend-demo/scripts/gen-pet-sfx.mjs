/**
 * 生成桌宠「点一下」的音效 WAV（App 与官网共用同一份文件）。纯数学合成，无第三方素材、无版权问题。
 *
 *   node scripts/gen-pet-sfx.mjs
 *
 * 输出：frontend-demo/assets/sfx/{miro,bobi}-poke.wav 与 landing/public/assets/sfx/ 同名文件。
 * 音色与人设对应：
 * - 米露（安静、敏锐，胸口抱着星星；被点时星星转一圈）：一声很轻的低音木琴 + 三颗往上的小铃，像星星亮了一下。
 * - 波比（温暖、热烈；被点时会跳起来）：一声往上弹的「啵」+ 两个跳着往上的音乐盒音，像蹦了一下。
 * 音色与官网短片配乐（landing/src/sound.ts 的 tine / chime / pop）同一套做法，听起来是一家人。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RATE = 22050;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function buffer(sec) {
  return new Float32Array(Math.ceil(sec * RATE));
}

/** 衰减正弦分音：attack 线性起，指数衰减（与 sound.ts 的 partial 一致：时间常数 = decay/5）。 */
function partial(out, at, f, vol, decay, attack = 0.004, sweep = null) {
  const start = Math.floor(at * RATE);
  const len = Math.floor((attack + decay) * RATE);
  let phase = 0;
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / RATE;
    const env = t < attack ? t / attack : Math.exp(-(t - attack) / (decay / 5));
    const freq = sweep ? sweep(t) : f;
    phase += (2 * Math.PI * freq) / RATE;
    out[start + i] += vol * env * Math.sin(phase);
  }
}

const tine = (o, at, f, vol, len) => {
  partial(o, at, f, vol, len);
  partial(o, at, f * 2, vol * 0.2, len * 0.4);
  if (f * 4 < RATE / 2.2) partial(o, at, f * 4.02, vol * 0.06, 0.2);
};
const chime = (o, at, f, vol, len) => {
  partial(o, at, f, vol, len, 0.002);
  partial(o, at, f * 2.76, vol * 0.3, len * 0.4, 0.002);
  if (f * 5.4 < RATE / 2.2) partial(o, at, f * 5.4, vol * 0.1, len * 0.18, 0.002);
};
/** 往上弹的「啵」：音高 0.07 秒内从 lo 滑到 hi。 */
const boing = (o, at, lo, hi, vol) =>
  partial(o, at, lo, vol, 0.28, 0.006, (t) => lo * Math.pow(hi / lo, Math.min(1, t / 0.07)));

/** 很小的房间感：几次衰减的回声，代替混响。 */
function room(o, taps = [[0.043, 0.22], [0.071, 0.15], [0.113, 0.1], [0.167, 0.06]]) {
  const src = Float32Array.from(o);
  for (const [d, g] of taps) {
    const off = Math.floor(d * RATE);
    for (let i = 0; i + off < o.length; i++) o[i + off] += src[i] * g;
  }
}

/** 峰值归一到 peakDb，再给末尾 30ms 淡出，防止截断爆音。 */
function finish(o, peakDb) {
  let peak = 0;
  for (const v of o) peak = Math.max(peak, Math.abs(v));
  const k = Math.pow(10, peakDb / 20) / (peak || 1);
  const fade = Math.floor(0.03 * RATE);
  for (let i = 0; i < o.length; i++) {
    const tail = o.length - i < fade ? (o.length - i) / fade : 1;
    o[i] *= k * tail;
  }
  return o;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function miro() {
  const o = buffer(1.1);
  tine(o, 0, hz(67), 0.16, 0.9);                   // G4：轻轻「嗯」一声
  [84, 88, 91].forEach((m, i) => chime(o, 0.07 + i * 0.075, hz(m), 0.07, 0.9)); // C6 E6 G6：星星亮起来
  room(o);
  return finish(o, -4);
}

function bobi() {
  const o = buffer(0.8);
  boing(o, 0, hz(64), hz(76), 0.22);               // E4→E5：往上一蹦
  tine(o, 0.09, hz(81), 0.12, 0.5);                // A5
  tine(o, 0.19, hz(88), 0.11, 0.55);               // E6：落地前再跳一下
  room(o);
  return finish(o, -4);
}

for (const dir of ["frontend-demo/assets/sfx", "landing/public/assets/sfx"]) {
  mkdirSync(resolve(ROOT, dir), { recursive: true });
  for (const [name, gen] of [["miro", miro], ["bobi", bobi]]) {
    const file = resolve(ROOT, dir, `${name}-poke.wav`);
    const buf = wav(gen());
    writeFileSync(file, buf);
    console.log(`${dir}/${name}-poke.wav  ${(buf.length / 1024).toFixed(1)} KB`);
  }
}
