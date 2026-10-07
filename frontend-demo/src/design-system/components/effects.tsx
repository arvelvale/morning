import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { useReducedMotion } from "../accessibility";
import { useTheme } from "../theme";

// ─── SVG Grain 纹理（base64 内联，无网络开销）──────────────────────────────────
const GRAIN_SVG = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.88' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='150' height='150' filter='url(%23n)' opacity='0.026'/%3E%3C/svg%3E`;

// ─── GlassSurface：毛玻璃容器 ────────────────────────────────────────────────
type GlassSurfaceProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** BlurView intensity (0-100)，默认 8 */
  intensity?: number;
};

export function GlassSurface({ children, style, intensity = 8 }: GlassSurfaceProps) {
  const theme = useTheme();
  // Web 端 BlurView 使用 CSS backdrop-filter；原生使用 expo-blur
  return (
    <BlurView
      intensity={intensity}
      tint={theme.isNight ? "dark" : "light"}
      style={[{ overflow: "hidden" }, style as ViewStyle]}
    >
      <View
        style={{
          backgroundColor: theme.isNight
            ? "rgba(50,46,56,0.55)"
            : "rgba(255,252,245,0.55)",
        }}
      >
        {children}
      </View>
    </BlurView>
  );
}

// ─── GrainTexture：纸张纹理叠加层 ─────────────────────────────────────────────
type GrainTextureProps = {
  style?: StyleProp<ImageStyle>;
};

export function GrainTexture({ style }: GrainTextureProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    // 仅在原生端读取 AccessibilityInfo
    if (Platform.OS === "web") return;
    try {
      const { AccessibilityInfo } = require("react-native");
      AccessibilityInfo.isReduceTransparencyEnabled?.()
        .then((v: boolean) => setReduceTransparency(v))
        .catch(() => {});
    } catch {
      // 非关键
    }
  }, []);

  if (reducedMotion || reduceTransparency) return null;

  return (
    <Image
      source={{ uri: GRAIN_SVG }}
      resizeMode="repeat"
      fadeDuration={0}
      style={[
        {
          position: "absolute",
          inset: 0,
          opacity: theme.isNight ? 0.015 : 0.025,
          pointerEvents: "none",
        } as ImageStyle,
        style,
      ]}
    />
  );
}

const DAY_ORBS = [
  { c: "#E6E0FA", x: 8, y: -8, s: 72, o: 0.55 },
  { c: "#F7DDD3", x: 58, y: 58, s: 78, o: 0.45 },
  { c: "#DCEFE7", x: -4, y: 48, s: 62, o: 0.4 },
  { c: "#EEE8F6", x: 48, y: 4, s: 58, o: 0.42 },
  { c: "#F3EFE9", x: 68, y: 22, s: 52, o: 0.4 },
];

const NIGHT_ORBS = [
  { c: "#2A2357", x: 8, y: -8, s: 72, o: 0.8 },
  { c: "#1E1A42", x: 58, y: 58, s: 78, o: 0.85 },
  { c: "#191633", x: -4, y: 48, s: 62, o: 0.9 },
  { c: "#231E47", x: 48, y: 4, s: 58, o: 0.85 },
  { c: "#2D2660", x: 68, y: 22, s: 52, o: 0.7 },
  { c: "#FFD467", x: 40, y: 30, s: 60, o: 0.05 },
];

export function MistBackground() {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const orbs = theme.isNight ? NIGHT_ORBS : DAY_ORBS;
  const { width, height } = useWindowDimensions();
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) {
      drift.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: 12000,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [drift, reducedMotion]);

  const dx = drift.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 12, 0] });
  const dy = drift.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -14, 0] });
  const blur = 88 * (width / 372);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { pointerEvents: "none", transform: [{ translateX: dx }, { translateY: dy }] }]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          {orbs.map((orb, index) => (
            <RadialGradient key={index} id={`orb${index}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={orb.c} stopOpacity={orb.o} />
              <Stop offset="45%" stopColor={orb.c} stopOpacity={orb.o * 0.55} />
              <Stop offset="75%" stopColor={orb.c} stopOpacity={orb.o * 0.15} />
              <Stop offset="100%" stopColor={orb.c} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {orbs.map((orb, index) => (
          <Circle
            key={index}
            cx={(orb.x / 100) * width}
            cy={(orb.y / 100) * height}
            r={(orb.s / 100) * width / 2 + blur}
            fill={`url(#orb${index})`}
          />
        ))}
      </Svg>
    </Animated.View>
  );
}

export function PetPlaceholder({ size = 200, emoji = "🌿" }: { size?: number; emoji?: string }) {
  const theme = useTheme();
  return (
    <View style={{ width: size * 1.55, height: size * 1.55, alignItems: "center", justifyContent: "center" }}>
      <View style={{
        position: "absolute",
        width: size * 1.4,
        height: size * 1.4,
        borderRadius: size,
        backgroundColor: theme.colors.accentSoft,
        opacity: theme.isNight ? 0.35 : 0.55,
      }} />
      <View style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.surfaceElevated,
        borderWidth: 1,
        borderColor: theme.colors.border,
        ...theme.shadows.floating,
      }}>
        <Text style={{ fontSize: size * 0.3 }}>{emoji}</Text>
        <Text style={{ fontSize: size * 0.072, color: theme.colors.textMuted, marginTop: size * 0.04, letterSpacing: 0.5 }}>
          Pet Artwork
        </Text>
      </View>
    </View>
  );
}

export function CreamRipple({ active }: { active: boolean }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (!active || reducedMotion) return;
    scale.setValue(0);
    opacity.setValue(0.55);
    Animated.parallel([
      Animated.timing(scale, { toValue: 4, duration: 600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, [active, opacity, reducedMotion, scale]);

  if (!active || reducedMotion) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
      <Animated.View style={{
        position: "absolute",
        width: 80,
        height: 80,
        borderRadius: 40,
        top: "50%",
        left: "50%",
        marginTop: -40,
        marginLeft: -40,
        backgroundColor: theme.colors.accentSoft,
        transform: [{ scale }],
        opacity,
      }} />
    </View>
  );
}
