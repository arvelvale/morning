/**
 * 短片配乐：用 WebAudio 现场合成，不引用音频文件（包体不增加）。
 *
 * - 40 秒一个循环，和短片的循环长度一致；五段和弦 C – Am – F – G – C，每段 8 秒。
 * - 旋律是八分音符的音乐盒拨弦（正弦 + 一个泛音），伴奏是慢起的三角波垫音，低音每两拍一下。
 * - 短片里三个关键时刻有点缀音：碎片飘出（9.4s）、米露接住最重的那片（16.9s）、抱住星星（18.45s）。
 *   这些由短片的时间回调触发，所以跟画面对得上。
 * - 浏览器不允许页面一打开就出声，所以必须由用户点「声音」按钮才会创建音频上下文。
 *   默认关闭，静音时不占用任何音频资源。
 */

const LOOP = 40;
const SLOT = 0.5; // 八分音符
const MASTER = 0.5;

type Chord = { root: number; tones: number[] };

/** 五段和弦，频率取自十二平均律（A4 = 440）。 */
const CHORDS: Chord[] = [
  { root: 130.81, tones: [261.63, 329.63, 392.0, 493.88, 523.25, 659.25] }, // C
  { root: 110.0, tones: [220.0, 261.63, 329.63, 392.0, 440.0, 523.25] }, // Am
  { root: 87.31, tones: [349.23, 440.0, 523.25, 659.25, 698.46] }, // F
  { root: 98.0, tones: [196.0, 246.94, 293.66, 392.0, 493.88] }, // G
  { root: 130.81, tones: [261.63, 329.63, 392.0, 493.88, 523.25] }, // C
];

/** 每段 16 个八分音符的旋律：-1 为休止，数字为和弦音的序号。 */
const PATTERNS: number[][] = [
  [0, -1, 2, 4, -1, 3, 2, -1, 1, -1, 3, 2, -1, 1, 0, -1],
  [1, -1, 3, -1, 2, 4, -1, 3, 2, -1, 1, 0, -1, -1, 2, -1],
  [0, -1, 2, 4, -1, 3, 2, -1, 1, -1, 3, 2, -1, 1, 0, -1],
  [0, -1, -1, 2, -1, 1, -1, 0, -1, 3, -1, 2, -1, 1, -1, -1],
  [0, -1, 2, -1, 4, -1, 2, -1, 1, -1, 0, -1, -1, -1, -1, -1],
];

type Ctx = AudioContext;

export class Score {
  private ctx: Ctx | null = null;
  private out: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextLoop = 0;
  private on = false;

  /** 用户点击「声音」时调用：创建（或恢复）音频上下文并开始排练。 */
  start(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC() as Ctx;
      const comp = this.ctx.createDynamicsCompressor();
      this.out = this.ctx.createGain();
      this.out.gain.value = MASTER;
      this.out.connect(comp);
      comp.connect(this.ctx.destination);
    }
    this.on = true;
    void this.ctx.resume();
    if (!this.timer) {
      this.nextLoop = this.ctx.currentTime + 0.12;
      this.schedule(this.nextLoop);
      this.nextLoop += LOOP;
      this.timer = setInterval(() => this.tick(), 250);
    }
  }

  /**
   * 挂起/恢复音频时钟：短片暂停、用户静音时挂起，已经排好的音符不会丢，
   * 再恢复时接着原来的位置往下走（挂起期间音频时钟不走，所以不会一次性补播）。
   */
  suspend(): void {
    if (this.ctx) void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.on) void this.ctx.resume();
  }

  /** 用户关闭声音：标记关闭并挂起。定时器保留，再打开时直接接上。 */
  stop(): void {
    this.on = false;
    if (this.ctx) void this.ctx.suspend();
  }

  /** 短片时间回调：在关键时刻补一个点缀音。跨过循环点时（t 变小）不做处理。 */
  cue(prev: number, t: number): void {
    if (!this.ctx || !this.on || this.ctx.state !== 'running' || t < prev) return;
    const at = this.ctx.currentTime + 0.02;
    for (const [when, play] of CUES) {
      if (prev < when && when <= t) play(this, at);
    }
  }

  private tick(): void {
    if (!this.ctx || !this.on) return;
    // 提前两秒排下一个循环；音频时钟暂停时这里也不会往前走
    while (this.nextLoop < this.ctx.currentTime + 2) {
      this.schedule(this.nextLoop);
      this.nextLoop += LOOP;
    }
  }

  private schedule(t0: number): void {
    CHORDS.forEach((chord, s) => {
      const start = t0 + s * 8;
      this.pad(chord, start, 8);
      this.bass(chord, start);
      PATTERNS[s].forEach((idx, i) => {
        if (idx < 0) return;
        const f = chord.tones[Math.min(idx, chord.tones.length - 1)];
        this.pluck(start + i * SLOT, f, s === 3 || s === 4 ? 0.075 : 0.105);
      });
    });
  }

  /** 音乐盒拨弦：正弦基音 + 一个很轻的二次泛音，指数衰减。 */
  private pluck(at: number, f: number, vol: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
    g.connect(this.out!);
    const a = ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = f;
    a.connect(g);
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = f * 2.01;
    const gb = ctx.createGain();
    gb.gain.value = 0.18;
    b.connect(gb).connect(g);
    a.start(at); b.start(at);
    a.stop(at + 1.9); b.stop(at + 1.9);
  }

  /** 慢起的垫音：根音、五度、八度、三度，三角波，叠在一起。 */
  private pad(chord: Chord, at: number, len: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.028, at + 1.6);
    g.gain.setValueAtTime(0.028, at + len - 2);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.4);
    g.connect(this.out!);
    const freqs = [chord.root * 2, chord.root * 3, chord.root * 4, chord.root * 2.5];
    freqs.forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(g);
      o.start(at);
      o.stop(at + len + 0.5);
    });
  }

  /** 低音：每两拍一下，很轻，只给一点底。 */
  private bass(chord: Chord, at: number): void {
    const ctx = this.ctx!;
    for (let k = 0; k < 4; k++) {
      const t = at + k * 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      g.connect(this.out!);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = chord.root;
      o.connect(g);
      o.start(t);
      o.stop(t + 2);
    }
  }

  /** 一个短促的铃音（点缀用）。 */
  bell(at: number, f: number, vol: number, len = 1.6): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    g.connect(this.out!);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    o.start(at);
    o.stop(at + len + 0.05);
  }
}

/** 短片里的关键时刻 → 点缀音。时间与 pet-rig 的 NOTES 对齐（见 frontend-demo/src/pets/rig/pet-rig.js）。 */
const CUES: [number, (s: Score, at: number) => void][] = [
  // 9.4s：第一片念头飘出来
  [9.4, (s, at) => s.bell(at, 783.99, 0.035, 1.2)],
  // 16.9s：米露接住最重的那片，星星亮一下
  [16.9, (s, at) => { s.bell(at, 1046.5, 0.085, 2.4); s.bell(at, 2093, 0.02, 1.4); }],
  // 18.45s：抱住星星，上行的三个音
  [18.45, (s, at) => { [784, 1046.5, 1318.5].forEach((f, i) => s.bell(at + i * 0.1, f, 0.05, 1.6)); }],
];
