import { Asset } from "expo-asset";
import { Image as ExpoImage } from "expo-image";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Image,
  Platform,
  type ImageSourcePropType,
  View,
} from "react-native";

import { PetPlaceholder, useTheme } from "../design-system";
import { getPetArtwork } from "../pets/assets";

/** 间歇节律：动一会儿 → 静一会儿。静止 = GIF 定格在自己的第一帧。 */
const MOTION_ACTIVE_MS = 6000;
const MOTION_REST_MS = 4500;
const MOTION_FADE_MS = 260;

type HomePetArtworkProps = {
  presetId: string | null;
  fallbackEmoji: string;
  size?: number;
};

function moduleIds(sources: (ImageSourcePropType | undefined)[]) {
  return sources.filter((source): source is number => typeof source === "number");
}

/**
 * 首页桌宠：GIF 动图间歇播放（expo-image）。
 *
 * P3 最终版：**单层动图 + autoplay 切换**。
 * - 动段：autoplay=true，GIF 循环播放；
 * - 静段：autoplay=false，GIF 定格在**自身第一帧**——画面与动画完全同一张画，
 *   彻底消灭旧版"垫底 PNG（睁眼版）与 GIF（闭眼版）内容不一致"造成的
 *   动与不动叠加/换画跳变；
 * - 垫底 PNG 降级为加载中/动图不可用（减动态/后台/失败）时的兜底；
 * - 切换用 260ms 交叉淡化，任何瞬间单层可见。
 */
export function HomePetArtwork({
  presetId,
  fallbackEmoji,
  size = 215,
}: HomePetArtworkProps) {
  const night = useTheme().isNight;
  const artwork = useMemo(() => getPetArtwork(presetId), [presetId]);
  const motion = night ? artwork?.motionNight : artwork?.motionDay;
  const [assetsReady, setAssetsReady] = useState(false);
  const [motionFailed, setMotionFailed] = useState(false);
  const [staticFailed, setStaticFailed] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [motionPlaying, setMotionPlaying] = useState(true);
  const motionOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setAssetsReady(false);
    setMotionFailed(false);
    setStaticFailed(false);
    if (!artwork) return;

    let alive = true;
    Asset.loadAsync(
      moduleIds([artwork.idle, artwork.motionDay, artwork.motionNight]),
    )
      .then(() => {
        if (alive) setAssetsReady(true);
      })
      .catch(() => {
        if (alive) setMotionFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [artwork]);

  // 间歇节律：动 MOTION_ACTIVE_MS → 静 MOTION_REST_MS → 循环。
  // 静段 autoplay=false（GIF 定格首帧），动段恢复播放。后台/减弱动态时不轮转。
  const canPlay = assetsReady && !motionFailed && !reduceMotion && appActive && motion != null;
  useEffect(() => {
    if (!canPlay) {
      setMotionPlaying(true);
      motionOpacity.setValue(1);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (playing: boolean, delay: number) => {
      timer = setTimeout(() => {
        if (!alive) return;
        setMotionPlaying(playing);
        Animated.timing(motionOpacity, {
          toValue: playing ? 1 : 0.82,   // 静段不完全消失：定格帧仍可见，只轻微"入睡"
          duration: MOTION_FADE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== "web",
        }).start();
        schedule(!playing, playing ? MOTION_ACTIVE_MS : MOTION_REST_MS);
      }, delay);
    };
    setMotionPlaying(true);
    schedule(false, MOTION_ACTIVE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [canPlay, motionOpacity]);

  if (!artwork || staticFailed) {
    return <PetPlaceholder size={size} emoji={fallbackEmoji} />;
  }

  // 减弱动态 / 后台 / 动图损坏 → 只显示静态首帧。
  const showMotion = canPlay;

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
          backgroundColor: night
            ? "rgba(216,169,78,0.10)"
            : "rgba(184,134,11,0.09)",
        }}
      />
      <View style={{ width: size * 1.42, height: size * 1.42 }}>
        {/* 静态 PNG：仅作 GIF 不可用（加载中/失败/减动态/后台）的兜底 */}
        {!showMotion ? (
          <Image
            source={artwork.idle}
            resizeMode="contain"
            fadeDuration={0}
            onError={() => setStaticFailed(true)}
            accessibilityIgnoresInvertColors
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
          />
        ) : null}
        {showMotion ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              opacity: motionOpacity,
            }}
          >
            {/* key 含播放状态：autoplay 切换时重挂载，确保从第一帧定格/重播 */}
            <ExpoImage
              key={`${night ? "n" : "d"}-${motionPlaying ? "play" : "rest"}`}
              source={motion}
              autoplay={motionPlaying}
              contentFit="contain"
              transition={0}
              accessibilityIgnoresInvertColors
              style={{ width: "100%", height: "100%" }}
            />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}
