/**
 * 点桌宠的音效：米露是一声轻铃（星星亮一下），波比是往上一蹦的「啵」。
 * 文件由 scripts/gen-pet-sfx.mjs 合成，官网用的是同一份。
 *
 * 每只桌宠只建一个播放器、重复使用：连点时从头重播，不会叠出一串回声。
 * 不改全局音频模式（静音键/勿扰照常生效）；失败一律静默，音效不能影响点击本身。
 */
import { createAudioPlayer, type AudioPlayer } from "expo-audio";

const SOURCES = {
  miro: require("../assets/sfx/miro-poke.wav"),
  bobi: require("../assets/sfx/bobi-poke.wav"),
} as const;

type PetSfx = keyof typeof SOURCES;
const players = new Map<PetSfx, AudioPlayer>();

function player(kind: PetSfx): AudioPlayer | null {
  let p = players.get(kind);
  if (!p) {
    try {
      p = createAudioPlayer(SOURCES[kind]);
      p.volume = 0.7;
    } catch {
      return null;
    }
    players.set(kind, p);
  }
  return p;
}

/** presetId 是桌宠预设（"miro" / "bobi"）；没有或不认识的按米露处理。 */
export function playPetPoke(presetId: string | null | undefined): void {
  const kind: PetSfx = presetId === "bobi" ? "bobi" : "miro";
  const p = player(kind);
  if (!p) return;
  try {
    void p.seekTo(0);
    p.play();
  } catch {
    /* 音频不可用：忽略 */
  }
}
