/**
 * 角色运行时 pet-rig.js 的类型声明。
 * 运行时本体在 public/pet-rig.js（源文件：frontend-demo/src/pets/rig/pet-rig.js，
 * 在 frontend-demo 下 `npm run rig:build` 同步过来），由 index.html 先于应用脚本加载。
 */
export type PetMood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'sleep';
export type PetKind = 'miro' | 'bobi';

export type PetController = {
  set: (patch: { mood?: PetMood; night?: boolean; level?: number; reduceMotion?: boolean }) => void;
  poke: () => void;
  pause: () => void;
  resume: () => void;
  destroy: () => void;
};

export type FilmController = {
  ready: Promise<void>;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  readonly playing: boolean;
  readonly time: number;
  destroy: () => void;
};

type PetRigGlobal = {
  mountPet: (el: HTMLElement, opts: { pet: PetKind; mood?: PetMood; night?: boolean; reduceMotion?: boolean }) => PetController;
  mountFilm: (el: HTMLElement, opts: {
    fit?: 'cover' | 'contain'; loop?: boolean; autoplay?: boolean; autoPause?: boolean;
    reduceMotion?: boolean; posterTime?: number; start?: number;
    /** 每帧报告当前短片时间（秒），用来在关键时刻触发配乐点缀。 */
    onTime?: (t: number) => void;
  }) => FilmController;
};

export function petRig(): PetRigGlobal | null {
  return (window as unknown as { PetRig?: PetRigGlobal }).PetRig ?? null;
}
