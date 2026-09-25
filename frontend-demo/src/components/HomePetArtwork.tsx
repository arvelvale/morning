import React, { useEffect, useRef, useState } from "react";
import { Animated, AppState, Easing, Image, StyleSheet, View } from "react-native";

import { PetPlaceholder, useReducedMotion, useTheme } from "../design-system";
import { getPetStill } from "../pets/assets";
import { PetRigView } from "../pets/rig/PetRigView";
import { isRigPet, type PetMood } from "../pets/rig/types";

const FALLBACK_FADE_MS = 260;

type HomePetArtworkProps = {
  presetId: string | null;
  fallbackEmoji: string;
  size?: number;
  /** 桌宠状态；默认待机。夜间的待机会自动变成打盹。 */
  mood?: PetMood;
  /** 0~1，倾听时传用户音量。 */
  level?: number;
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
      <View
        style={{
          position: "absolute",
          width: size * 1.34,
          height: size * 1.34,
          borderRadius: size,
          backgroundColor: night ? "rgba(216,169,78,0.10)" : "rgba(184,134,11,0.09)",
        }}
      />
      <View style={{ width: size * 1.42, height: size * 1.42 }}>
        {rigFailed ? null : (
          <PetRigView
            level={level}
            mood={effectiveMood}
            night={night}
            onError={() => setRigFailed(true)}
            onReady={onReady}
            paused={!appActive}
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
