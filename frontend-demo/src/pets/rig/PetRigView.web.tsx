import React, { useEffect, useRef } from "react";
import { View } from "react-native";

import { PET_RIG_SOURCE } from "./petRigSource.generated";
import type { PetLook, PetMood, PetRigKind, PetRigProps } from "./types";

type RigController = {
  set: (patch: { mood?: PetMood; night?: boolean; level?: number; reduceMotion?: boolean; look?: PetLook }) => void;
  poke: () => void;
  pause: () => void;
  resume: () => void;
  destroy: () => void;
};
type PetRigGlobal = {
  mountPet: (el: HTMLElement, opts: { pet: PetRigKind; mood?: PetMood; night?: boolean; reduceMotion?: boolean }) => RigController;
};

/** 运行时是一个挂到 window.PetRig 的 IIFE；网页端直接执行，不经过 WebView。 */
function runtime(): PetRigGlobal {
  const host = window as unknown as { PetRig?: PetRigGlobal };
  if (!host.PetRig) new Function(PET_RIG_SOURCE)();
  return host.PetRig as PetRigGlobal;
}

/** 网页端：同一份 pet-rig.js 直接画进 canvas。 */
export function PetRigView({
  pet,
  mood = "idle",
  night = false,
  level = 0,
  reduceMotion = false,
  paused = false,
  look = null,
  pokeKey,
  onReady,
  onError,
  style,
}: PetRigProps) {
  const hostRef = useRef<View>(null);
  const rigRef = useRef<RigController | null>(null);

  useEffect(() => {
    const el = hostRef.current as unknown as HTMLElement | null;
    if (!el) return;
    try {
      rigRef.current = runtime().mountPet(el, { pet, mood, night, reduceMotion });
      onReady?.();
    } catch {
      onError?.();
    }
    return () => {
      rigRef.current?.destroy();
      rigRef.current = null;
    };
    // 只在换角色时重建；其余变化走 set()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet]);

  useEffect(() => {
    rigRef.current?.set({ mood, night, reduceMotion });
  }, [mood, night, reduceMotion]);

  useEffect(() => {
    rigRef.current?.set({ level });
  }, [level]);

  useEffect(() => {
    if (paused) rigRef.current?.pause();
    else rigRef.current?.resume();
  }, [paused]);

  const lookKey = look ? `${look[0].toFixed(2)},${look[1].toFixed(2)}` : "";
  useEffect(() => {
    rigRef.current?.set({ look: lookKey ? (lookKey.split(",").map(Number) as unknown as PetLook) : null });
  }, [lookKey]);

  useEffect(() => {
    if (pokeKey) rigRef.current?.poke();
  }, [pokeKey]);

  return <View pointerEvents="none" ref={hostRef} style={style} />;
}
