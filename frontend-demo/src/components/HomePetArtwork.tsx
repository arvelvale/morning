import React, { useEffect, useRef, useState } from "react";
import { Animated, AppState, Easing, Image, StyleSheet, View } from "react-native";

import { PetPlaceholder, useReducedMotion, useTheme } from "../design-system";
import { getPetStill } from "../pets/assets";
import { PetRigView } from "../pets/rig/PetRigView";
import { isRigPet, type PetLook, type PetMood } from "../pets/rig/types";

const FALLBACK_FADE_MS = 260;

type HomePetArtworkProps = {
  presetId: string | null;
  fallbackEmoji: string;
  size?: number;
  /** 桌宠状态；默认待机。夜间的待机会自动变成打盹。 */
  mood?: PetMood;
  /** 0~1，倾听时传用户音量。 */
  level?: number;
  /** 视线（引导时看向被高亮的地方）。 */
  look?: PetLook;
  /** 变化一次就被戳一下。 */
  pokeKey?: number;
  /** 强制用夜间配色（坐在夜空主卡、登录天空上时眼睛和星星发光）；缺省跟随主题。 */
  glow?: boolean;
  /** 身后的淡色光晕；放在深色卡片上时关掉。 */
  halo?: boolean;
  /** 所在页面不可见时暂停渲染。 */
  paused?: boolean;
};

/**
 * 桌宠立绘：米露 / 波比是程序化骨骼动画（src/pets/rig/pet-rig.js），
 * 原生端跑在 WebView 里，网页端直接画 canvas。
 *
 * - 同一姿势的静态 PNG 垫在下面：动画第一帧画好后淡出，加载失败则一直显示；
 * - 夜间的待机 = 同一只猫困了（打盹），不是换装；
 * - 系统减弱动态 → 定格姿势；App 进后台 → 暂停渲染。
 */
export function HomePetArtwork({
  presetId,
  fallbackEmoji,
  size = 215,
  mood = "idle",
  level = 0,
  look = null,
  pokeKey,
  glow,
  halo = true,
  paused = false,
}: HomePetArtworkProps) {
  const night = useTheme().isNight;
  const reduceMotion = useReducedMotion();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [rigFailed, setRigFailed] = useState(false);
  const fallbackOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setRigFailed(false);
    fallbackOpacity.setValue(1);
  }, [presetId, fallbackOpacity]);

  if (!isRigPet(presetId)) {
    return <PetPlaceholder size={size} emoji={fallbackEmoji} />;
  }

  const effectiveMood: PetMood = night && mood === "idle" ? "sleep" : mood;
  const still = getPetStill(presetId, effectiveMood === "sleep" ? "sleep" : "idle");

  const onReady = () => {
    Animated.timing(fallbackOpacity, {
      toValue: 0,
      duration: reduceMotion ? 0 : FALLBACK_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  return (
    <View
      style={{
        pointerEvents: "none",
        width: size * 1.55,
        height: size * 1.55,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {halo ? (
        <View
          style={{
            position: "absolute",
            width: size * 1.34,
            height: size * 1.34,
            borderRadius: size,
            backgroundColor: night ? "rgba(255,212,103,0.08)" : "rgba(117,99,222,0.07)",
          }}
        />
      ) : null}
      <View style={{ width: size * 1.42, height: size * 1.42 }}>
        {rigFailed ? null : (
          <PetRigView
            level={level}
            look={look}
            mood={effectiveMood}
            night={glow ?? night}
            onError={() => setRigFailed(true)}
            onReady={onReady}
            paused={!appActive || paused}
            pokeKey={pokeKey}
            pet={presetId}
            reduceMotion={reduceMotion}
            style={StyleSheet.absoluteFill}
          />
        )}
        {/* 外层管位置与淡出，内层普通 Image：react-native-web 上 Animated.Image 会丢掉尺寸样式 */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: rigFailed ? 1 : fallbackOpacity }]}
        >
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={still}
            style={{ width: "100%", height: "100%" }}
          />
        </Animated.View>
      </View>
    </View>
  );
}
