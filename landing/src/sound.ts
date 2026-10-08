/**
 * 短片配乐：用 WebAudio 现场合成，不引用音频文件（包体不增加）。
 *
 * 音乐写在「短片时间」上，而不是自己按音频时钟循环：
 * - 每帧短片报告时间 t，这里把 t 往后 0.3 秒内的音符排进音频时钟。短片暂停、滚出视口、
 *   切到后台时 t 不再前进，配乐在 0.3 秒内淡出；短片继续时从当前和弦淡入，所以永远和画面对齐。
 * - 72 BPM，12 小节正好 40 秒，和短片一个循环一样长。和弦跟着剧情走：
 *   清晨（C）→ 念头飘出来（Am、Dm，悬着）→ 米露接住最重的那片（回到 C）→ 入夜（低一点、暗一点）→ 字幕（Fm6 → C 收尾）。
 * - 画面上的动作都有对应的声音：波比四次跳过来、放下水杯、四张念头纸条冒出来、火锅纸条被吃掉、
 *   米露接住纸条、光点飞进星星、抱住星星。时间取自 pet-rig.js 的时间线（mountFilm 里的 HOPS / NOTES / MOTES）。
 * - 入夜后垫音的滤波器逐渐收窄、旋律变轻，和天色一起暗下来。
 * - 浏览器不允许页面一打开就出声，所以要等用户点「声音」按钮才创建音频上下文。默认关闭。
 */

const LOOP = 40;
const BEAT = LOOP / 48; // 72 BPM：48 拍 = 12 小节 = 40 秒
const LOOKAHEAD = 0.3; // 每帧往后排多少秒的音符
const LEAD = 0.05; // 从暂停里恢复时，第一个和弦晚这么多再起，避免排到过去

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/** 入夜程度 0–1，与短片 nightK（20.5s → 28s）一致。 */
const nightAt = (t: number) => smooth(20.5, 28, t);

/* ─────────────── 乐谱 ─────────────── */

type Chord = { bass: number; pad: number[] };
const CHORDS: Record<string, Chord> = {
  Cadd9: { bass: 36, pad: [55, 60, 62, 64] },
  'Fmaj7/C': { bass: 36, pad: [53, 57, 60, 64] },
  Em7: { bass: 40, pad: [55, 59, 62, 64] },
  Am7: { bass: 45, pad: [57, 60, 64, 67] },
  Fmaj7: { bass: 41, pad: [53, 57, 60, 64] },
  Dm7: { bass: 38, pad: [53, 57, 60, 62] },
  G7sus4: { bass: 43, pad: [55, 60, 62, 65] },
  G7: { bass: 43, pad: [55, 59, 62, 65] },
  C: { bass: 36, pad: [55, 60, 64, 67] },
  Fm6: { bass: 41, pad: [53, 56, 60, 62] },
};

/** 和弦进行：[起始拍, 和弦]。最后一个和弦在 39.2s 结束，与短片淡出到黑同时。 */
const PROGRESSION: [number, string][] = [
  [0, 'Cadd9'], [4, 'Fmaj7/C'], // 清晨，米露在打盹，波比跳过来
  [8, 'Cadd9'], [10, 'Em7'], // 米露醒来
  [12, 'Am7'], [14, 'Fmaj7'], // 念头一张张飘出来
  [16, 'Dm7'], [18, 'G7sus4'], // 最重的那张飘向米露，悬着
  [20, 'C'], // 接住，抱住星星
  [24, 'Am7'], [28, 'Fmaj7'], // 黄昏，波比打哈欠
  [32, 'Em7'], [34, 'Am7'], // 入夜，波比睡着
  [36, 'Dm7'], [38, 'G7sus4'], [39, 'G7'], // 米露也打起盹
  [40, 'Fmaj7'], [42, 'Fm6'], // 字幕「把明天的事，还给明天。」
  [44, 'Cadd9'],
];
const PROGRESSION_END = 47.04; // 拍，= 39.2s

/** 旋律（音乐盒）：[拍, MIDI 音高, 力度 0–1]。第 6 小节留空，让接住星星的点缀音唱。 */
const MELODY: [number, number, number][] = [
  [1, 79, 0.45], [2.5, 76, 0.4],
  [8, 76, 0.8], [9, 79, 0.8], [10, 81, 0.85], [10.5, 79, 0.65], [11, 76, 0.75],
  [12, 72, 0.75], [13, 74, 0.7], [13.5, 76, 0.75], [14, 69, 0.7],
  [16, 77, 0.8], [17, 76, 0.7], [17.5, 74, 0.7], [18, 79, 0.85],
  [24, 76, 0.75], [25, 79, 0.75], [26, 84, 0.8], [27.5, 81, 0.6],
  [28, 81, 0.7], [29.5, 79, 0.55], [30, 77, 0.6], [31, 76, 0.55],
  [32, 76, 0.6], [33, 74, 0.5], [34, 72, 0.6],
  [36, 77, 0.6], [37, 76, 0.5], [38, 74, 0.55],
  [40, 72, 0.6], [41, 69, 0.5], [42, 68, 0.6], [43.5, 67, 0.45],
  [44, 76, 0.6], [45, 79, 0.6], [46, 84, 0.65],
];

/** 白天的轻拨奏：反拍上轮流弹和弦音（高八度），给画面一点流动感。入夜后停。 */
const ARP_FROM = 8, ARP_TO = 28;
const ARP_ORDER = [0, 2, 1, 3];

type Cue = [number, (v: Voices, at: number) => void];
/** 画面动作 → 点缀音。时间（秒）取自 pet-rig.js 的时间线。 */
const CUES: Cue[] = [
  // 波比四次跳过来（HOPS 起跳时刻），一次比一次高
  ...([[3.0, 79], [3.62, 81], [4.24, 84], [4.86, 86]] as const).map(
    ([t, m]): Cue => [t, (v, at) => v.tine(v.fx, at, hz(m), 0.05, 0.5)],
  ),
  // 放下水杯
  [6.3, (v, at) => v.tock(at)],
  // 四张念头纸条冒出来（NOTES.t0），第一张是最重的那句，音最低
  ...([[9.4, 76], [10.0, 81], [10.4, 84], [10.9, 88]] as const).map(
    ([t, m]): Cue => [t, (v, at) => v.bubble(at, hz(m), 0.06)],
  ),
  // 「想吃火锅」被波比一口接走
  [12.47, (v, at) => v.pop(at, hz(91))],
  // 米露接住最重的那张：一声铃
  [16.9, (v, at) => v.chime(at, hz(84), 0.09, 3.2)],
  // 光点飞进星星（MOTES 16.75–17.6s）：一串很轻的上行音
  ...[84, 86, 88, 91, 93, 96, 98, 100].map(
    (m, i): Cue => [16.98 + i * 0.075, (v, at) => v.chime(at, hz(m), 0.018, 0.9)],
  ),
  // 抱住星星（18.45s 星星弹一下）：上行的琶音
  ...[79, 84, 88, 91].map((m, i): Cue => [18.45 + i * 0.07, (v, at) => v.chime(at, hz(m), 0.05, 2.6)]),
];

/* ─────────────── 事件表（按短片时间排好） ─────────────── */

type Ev = { t: number; play: (v: Voices, at: number) => void };
const chordSpans = PROGRESSION.map(([b, name], i) => {
  const end = i + 1 < PROGRESSION.length ? PROGRESSION[i + 1][0] : PROGRESSION_END;
  return { t0: b * BEAT, t1: end * BEAT, chord: CHORDS[name] };
});

const EVENTS: Ev[] = (() => {
  const ev: Ev[] = [];
  chordSpans.forEach(({ t0, t1, chord }, i) => {
    // 第一个和弦跟着画面从黑里慢慢亮起来（短片 0–1.6s 淡入）
    const attack = i === 0 ? 1.6 : 0.5;
    ev.push({ t: t0, play: (v, at) => v.chord(chord, at, t1 - t0, attack, nightAt(t0)) });
  });
  for (const [b, m, vel] of MELODY) {
    const t = b * BEAT;
    const n = nightAt(t);
    ev.push({ t, play: (v, at) => v.tine(v.mel, at, hz(m), 0.13 * vel * (1 - 0.3 * n), 2.6) });
  }
  for (let b = ARP_FROM + 0.5, k = 0; b < ARP_TO; b += 1, k++) {
    const t = b * BEAT;
    const span = chordSpans.find((s) => s.t0 <= t && t < s.t1)!;
    const m = span.chord.pad[ARP_ORDER[k % 4]] + 12;
    ev.push({ t, play: (v, at) => v.tine(v.arp, at, hz(m), 0.035, 1.4) });
  }
  for (const [t, play] of CUES) ev.push({ t, play });
  return ev.sort((a, b) => a.t - b.t);
})();

/* ─────────────── 音色 ─────────────── */

/** 混响：用衰减的噪声现场生成冲激响应，尾巴越往后越暗。 */
function makeReverb(ctx: BaseAudioContext, seconds = 2.8): ConvolverNode {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const k = 0.55 - 0.45 * x; // 一阶低通系数随时间减小：高频先衰减
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - x, 2.4) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  return conv;
}

/** 常驻的音频链：总音量 → 柔和的限幅 → 输出；混响挂在总线上。 */
class Engine {
  readonly master: GainNode;
  readonly verb: ConvolverNode;
  constructor(readonly ctx: BaseAudioContext) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 1.0;
    this.master.connect(limiter);
    this.verb = makeReverb(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    this.verb.connect(wet).connect(this.master);
  }
}

/**
 * 一段连续播放用的声部（每次从暂停里恢复都新建一段）。
 * 淡出时只需把这一段的干声、混响送出量拉到 0；已经排好的音符照常结束，不会有爆音。
 */
class Voices {
  readonly mel: AudioNode;
  readonly arp: AudioNode;
  readonly pad: AudioNode;
  readonly bass: AudioNode;
  readonly fx: AudioNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;

  constructor(private readonly ctx: BaseAudioContext, eng: Engine, fadeIn = 0) {
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.dry.connect(eng.master);
    this.wet.connect(eng.verb);
    if (fadeIn > 0) {
      const now = ctx.currentTime;
      for (const g of [this.dry, this.wet]) {
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(1, now + fadeIn);
      }
    }
    // 声部：[声像, 混响送出量]
    this.mel = this.group(-0.12, 0.42);
    this.arp = this.group(0.32, 0.5);
    this.pad = this.group(0, 0.55);
    this.bass = this.group(0, 0.12);
    this.fx = this.group(0.18, 0.6);
  }

  private group(pan: number, send: number): AudioNode {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let tail: AudioNode = g;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    tail.connect(this.dry);
    const s = ctx.createGain();
    s.gain.value = send;
    tail.connect(s).connect(this.wet);
    return g;
  }

  fadeOut(sec: number): void {
    const now = this.ctx.currentTime;
    for (const g of [this.dry, this.wet]) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + sec);
    }
    // 等已经排好的音符（最长约 8 秒）放完，再断开整段
    setTimeout(() => { this.dry.disconnect(); this.wet.disconnect(); }, 10000);
  }

  /** 一个衰减的正弦分音。 */
  private partial(dest: AudioNode, at: number, f: number, vol: number, decay: number, attack = 0.004): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + attack);
    g.gain.setTargetAtTime(0, at + attack, decay / 5);
    g.connect(dest);
    const o = ctx.createOscillator();
    o.frequency.value = f;
    o.connect(g);
    o.start(at);
    o.stop(at + attack + decay + 0.05);
  }

  /** 音乐盒 / 钢片琴：基音 + 八度 + 一个很短的高泛音（敲击感）。 */
  tine(dest: AudioNode, at: number, f: number, vol: number, len: number): void {
    this.partial(dest, at, f, vol, len);
    this.partial(dest, at, f * 2, vol * 0.2, len * 0.4);
    if (f * 4 < 9000) this.partial(dest, at, f * 4.02, vol * 0.06, 0.2);
  }

  /** 铃：非整数倍的泛音，听起来像小铃铛。 */
  chime(at: number, f: number, vol: number, len: number): void {
    this.partial(this.fx, at, f, vol, len, 0.002);
    this.partial(this.fx, at, f * 2.76, vol * 0.3, len * 0.4, 0.002);
    if (f * 5.4 < 12000) this.partial(this.fx, at, f * 5.4, vol * 0.1, len * 0.18, 0.002);
  }

  /** 冒泡：音高从低往上滑一下。 */
  bubble(at: number, f: number, vol: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.012);
    g.gain.setTargetAtTime(0, at + 0.012, 0.07);
    g.connect(this.fx);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 0.72, at);
    o.frequency.exponentialRampToValueAtTime(f, at + 0.07);
    o.connect(g);
    o.start(at);
    o.stop(at + 0.5);
  }

  /** 啵：短促、往下掉的一声。 */
  pop(at: number, f: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.07, at + 0.004);
    g.gain.setTargetAtTime(0, at + 0.004, 0.035);
    g.connect(this.fx);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 1.5, at);
    o.frequency.exponentialRampToValueAtTime(f * 0.85, at + 0.06);
    o.connect(g);
    o.start(at);
    o.stop(at + 0.25);
  }

  /** 杯子放到地上：很短的木质轻响。 */
  tock(at: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.06, at + 0.002);
    g.gain.setTargetAtTime(0, at + 0.002, 0.025);
    g.connect(this.fx);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1250, at);
    o.frequency.exponentialRampToValueAtTime(620, at + 0.04);
    o.connect(g);
    o.start(at);
    o.stop(at + 0.2);
  }

  /**
   * 和弦：垫音（锯齿 + 三角，各偏几音分，过低通）+ 低音（正弦 + 八度，小音箱也听得到）。
   * night 越大，低通越窄，声音越暗。
   */
  chord(c: Chord, at: number, dur: number, attack: number, night: number): void {
    const ctx = this.ctx;
    const release = 1.1;
    const end = at + dur;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1900 - 1150 * night;
    lp.Q.value = 0.6;
    const env = ctx.createGain();
    const level = 0.03;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + Math.min(attack, dur * 0.6));
    env.gain.setValueAtTime(level, Math.max(at + Math.min(attack, dur * 0.6), end - 0.05));
    env.gain.linearRampToValueAtTime(0, end + release);
    lp.connect(env).connect(this.pad);
    for (const m of c.pad) {
      for (const [type, cents] of [['sawtooth', -6], ['triangle', 6]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz(m);
        o.detune.value = cents;
        o.connect(lp);
        o.start(at);
        o.stop(end + release + 0.05);
      }
    }
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, at);
    bg.gain.linearRampToValueAtTime(0.13, at + 0.04);
    bg.gain.setTargetAtTime(0.05, at + 0.04, Math.max(0.3, dur / 3));
    bg.gain.setValueAtTime(0.05, Math.max(at + 0.05, end - 0.05));
    bg.gain.linearRampToValueAtTime(0, end + 0.6);
    bg.connect(this.bass);
    for (const [mul, vol] of [[1, 1], [2, 0.35]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = hz(c.bass) * mul;
      const g = ctx.createGain();
      g.gain.value = vol;
      o.connect(g).connect(bg);
      o.start(at);
      o.stop(end + 0.7);
    }
  }
}

/* ─────────────── 对外接口 ─────────────── */

export class Score {
  private ctx: AudioContext | null = null;
  private eng: Engine | null = null;
  private voices: Voices | null = null;
  private on = false;
  private cycle = 0;
  private lastT = 0;
  private lastAbs = 0; // 展开循环后的短片时间
  private cursor = 0; // 已经排到的短片时间（展开后）
  private offset = 0; // 音频时钟 − 短片时间（平滑过，避免每帧的抖动传进节奏）
  private lastSeen = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  /** 用户点「声音」时调用（必须在点击事件里，浏览器才允许出声）。 */
  enable(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.eng = new Engine(this.ctx);
    }
    this.on = true;
    void this.ctx.resume();
    // 短片停下来（暂停、滚出视口、切后台）时不再报告时间：超过 0.3 秒没收到就淡出
    this.watchdog ??= setInterval(() => {
      if (this.voices && performance.now() - this.lastSeen > 300) this.drop(0.4);
    }, 120);
  }

  /** 用户关掉声音：淡出后挂起音频上下文，不再占用资源。 */
  disable(): void {
    this.on = false;
    this.drop(0.3);
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    const ctx = this.ctx;
    setTimeout(() => { if (!this.on && ctx) void ctx.suspend(); }, 450);
  }

  /** 短片被手动暂停：立刻淡出（不用等看门狗）。 */
  pause(): void {
    this.drop(0.3);
  }

  destroy(): void {
    this.disable();
    void this.ctx?.close();
    this.ctx = null;
    this.eng = null;
  }

  /** 每帧由短片调用，t 是短片时间（0–40 秒，循环）。 */
  update(t: number): void {
    const ctx = this.ctx, eng = this.eng;
    if (!this.on || !ctx || !eng || ctx.state !== 'running') return;
    this.lastSeen = performance.now();
    const now = ctx.currentTime;

    let abs = (t < this.lastT - LOOP / 2 ? this.cycle + 1 : this.cycle) * LOOP + t;
    if (!this.voices || abs < this.lastAbs || abs - this.lastAbs > 0.5) {
      // 第一次、或者短片跳了（暂停后继续、拖动）：重新开一段，从当前和弦淡入
      this.voices?.fadeOut(0.3);
      this.voices = new Voices(ctx, eng, 0.35);
      this.cycle = 0;
      abs = t;
      this.offset = now - abs;
      this.cursor = abs;
      const span = chordSpans.find((s) => s.t0 <= t && t < s.t1);
      if (span && span.t1 - t > 0.4) {
        this.voices.chord(span.chord, now + LEAD, span.t1 - t, 0.5, nightAt(t));
      }
    } else {
      const raw = now - abs;
      this.offset = Math.abs(raw - this.offset) > 0.08 ? raw : this.offset + (raw - this.offset) * 0.05;
    }
    this.cycle = Math.floor(abs / LOOP);
    this.lastT = t;
    this.lastAbs = abs;

    const until = abs + LOOKAHEAD;
    if (until <= this.cursor) return;
    // 声音从排进时钟到真正从喇叭出来还有一段输出延迟，提前这么多排，声画才对得上
    const latency = Math.min(0.1, ctx.outputLatency || ctx.baseLatency || 0);
    scheduleRange(this.voices, this.cursor, until, this.offset - latency, now);
    this.cursor = until;
  }

  private drop(fade: number): void {
    this.voices?.fadeOut(fade);
    this.voices = null;
  }
}

/** 把短片时间 (from, to] 内的事件排进音频时钟：音频时间 = 短片时间 + offset。 */
function scheduleRange(v: Voices, from: number, to: number, offset: number, now: number): void {
  for (let c = Math.floor(from / LOOP); c * LOOP <= to; c++) {
    for (const ev of EVENTS) {
      const abs = c * LOOP + ev.t;
      if (abs <= from) continue;
      if (abs > to) break;
      ev.play(v, Math.max(now + 0.01, abs + offset));
    }
  }
}

/** 离线渲染一整个循环（仅供测试：检查响度、削波、点缀音是否落在画面时刻）。 */
export async function renderLoop(sampleRate = 44100): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * (LOOP + 3)), sampleRate);
  const v = new Voices(ctx, new Engine(ctx));
  scheduleRange(v, -0.001, LOOP, 0, 0);
  return ctx.startRendering();
}

export const SCORE_FOR_TEST = { EVENTS, BEAT, chordSpans };
