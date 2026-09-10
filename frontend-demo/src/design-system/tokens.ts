/**
 * Morning 设计基础 —— Quiet Ambient OS × Digital Storybook。
 *
 * 骨架（Quiet Ambient OS）：环境行、低 chrome（靠纸色分层而非描边）、日夜一体
 * （夜间不是蓝黑，而是同一盏灯调暗后的暖炭色）。灵魂（Digital Storybook）：
 * 叙事内容（信、台词、批注）用衬线，操作界面用无衬线。
 *
 * 色板全部取自米露原画：奶油毛色→纸底，瞳金→accent，尾杏→陶土，暖炭→夜底。
 * Token 使用语义命名；素材色、图片蒙层和特殊场景色不放在这里。
 */
import { Platform } from "react-native";

export const lightColors = {
  background: "#F5EFE2",
  backgroundSubtle: "#EFE7D5",
  surface: "#FCF8EE",
  surfaceElevated: "#FFFEF8",
  surfaceHover: "#F3ECDC",
  surfacePressed: "#ECE3CF",
  textPrimary: "#3B3428",
  textSecondary: "#6E6350",
  textMuted: "#9C907C",
  textOnAccent: "#FFFDF4",
  textOnDanger: "#FFF9F5",
  placeholder: "#9C907C",
  border: "rgba(90,76,55,0.18)",
  divider: "rgba(90,76,55,0.10)",
  accent: "#A97E22",
  accentSurface: "rgba(184,134,11,0.12)",
  accentSoft: "rgba(184,134,11,0.08)",
  accentHover: "#B98F33",
  accentPressed: "#8F6A1B",
  support: "#718879",
  focus: "#C4953A",
  disabledSurface: "#EFE9DA",
  disabledText: "#B8AD99",
  success: "#5E7D68",
  warning: "#A66A32",
  error: "#A8483D",
  overlay: "rgba(59,52,40,0.38)",
  scrim: "rgba(59,52,40,0.16)",
} as const;

/**
 * 夜间 = 同一盏灯调暗：暖炭纸底，墨色换成暖米，金换成烛光金。
 * 刻意不用蓝黑——夜里依然是那间书房，只是灯拧小了。
 */
export const darkColors: ColorTokens = {
  background: "#262019",
  backgroundSubtle: "#2C251D",
  surface: "#332B22",
  surfaceElevated: "#3A3128",
  surfaceHover: "#3A3128",
  surfacePressed: "#42382C",
  textPrimary: "#EFE6D2",
  textSecondary: "#C9BCA4",
  textMuted: "#97896E",
  textOnAccent: "#2A2114",
  textOnDanger: "#FFF9F5",
  placeholder: "#97896E",
  border: "rgba(238,227,206,0.14)",
  divider: "rgba(238,227,206,0.09)",
  accent: "#D8A94E",
  accentSurface: "rgba(216,169,78,0.14)",
  accentSoft: "rgba(216,169,78,0.09)",
  accentHover: "#E4BC6B",
  accentPressed: "#C2933C",
  support: "#8FA98F",
  focus: "#D8A94E",
  disabledSurface: "#332C22",
  disabledText: "#6E6350",
  success: "#8FA98F",
  warning: "#D5A16B",
  error: "#C96A55",
  overlay: "rgba(12,9,5,0.55)",
  scrim: "rgba(12,9,5,0.30)",
};

export type ColorTokens = {
  [Key in keyof typeof lightColors]: string;
};

/**
 * 拟物「奶油纸面」文字色：信件/待办卡/珍藏卡等始终保持浅色纸面的表面上的文字，
 * 日夜模式同值（纸面不随主题变暗，故不属于主题 ColorTokens，与「素材色」同类）。
 * 内容强调色（音乐/场景类型色）与渐变属素材色，同样不放在主题 token 里。
 */
export const paperColors = {
  ink:     "#484145", // 纸面主文字
  ink2:    "#4D4249", // 信纸标题/主文字（偏暖）
  body:    "#62575D", // 信纸正文
  sub:     "#655D61", // 次级文字
  sub2:    "#847D72", // 次级文字（暖调）
  meta:    "#7E7479", // 日期/来源
  meta2:   "#8C8187", // 信纸元信息
  dim:     "#A39A9F", // 弱化/已完成/占位
  goldInk: "#463F3C", // 奶油胶囊按钮文字
} as const;

/**
 * 叙事衬线：信、台词、扉页等「被阅读的内容」用衬线；
 * Android 走系统 Noto Serif（覆盖中文），iOS 用宋体-简，web 交给 CSS 泛型族。
 */
export const fontFamilies = {
  serif: Platform.select({
    ios: "Songti SC",
    android: "serif",
    default: "serif",
  }),
  sans: undefined,
} as const;

export const fontSizes = {
  ambient: 11,
  label: 12,
  caption: 13,
  body: 15,
  bodyLarge: 16,
  sectionTitle: 19,
  pageTitle: 28,
  display: 36,
} as const;

export const fontWeights = {
  regular: "400",
  medium: "500",
  semibold: "600",
} as const;

export const lineHeights = {
  ambient: 16,
  label: 16,
  caption: 19,
  body: 23,
  bodyLarge: 25,
  sectionTitle: 26,
  pageTitle: 36,
  display: 46,
  serifBody: 30,
} as const;

export const letterSpacings = {
  tight: -0.4,
  normal: 0,
  relaxed: 0.2,
  label: 0.4,
  ambient: 3.3,
} as const;

export const textStyles = {
  display: {
    fontSize: fontSizes.display,
    lineHeight: lineHeights.display,
    fontWeight: fontWeights.medium,
    letterSpacing: letterSpacings.tight,
  },
  pageTitle: {
    fontSize: fontSizes.pageTitle,
    lineHeight: lineHeights.pageTitle,
    fontWeight: fontWeights.medium,
    letterSpacing: letterSpacings.tight,
  },
  sectionTitle: {
    fontSize: fontSizes.sectionTitle,
    lineHeight: lineHeights.sectionTitle,
    fontWeight: fontWeights.medium,
    letterSpacing: letterSpacings.normal,
  },
  body: {
    fontSize: fontSizes.body,
    lineHeight: lineHeights.body,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.normal,
  },
  bodyStrong: {
    fontSize: fontSizes.body,
    lineHeight: lineHeights.body,
    fontWeight: fontWeights.medium,
    letterSpacing: letterSpacings.normal,
  },
  caption: {
    fontSize: fontSizes.caption,
    lineHeight: lineHeights.caption,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.relaxed,
  },
  label: {
    fontSize: fontSizes.label,
    lineHeight: lineHeights.label,
    fontWeight: fontWeights.medium,
    letterSpacing: letterSpacings.label,
  },
  /** 环境行：屏顶那行小字，像书页天头的页眉。 */
  ambient: {
    fontSize: fontSizes.ambient,
    lineHeight: lineHeights.ambient,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.ambient,
  },
  /** 衬线正文：信与台词等被阅读的内容（17/30，接近书页行距）。 */
  serifBody: {
    fontSize: 17,
    lineHeight: lineHeights.serifBody,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.relaxed,
    fontFamily: fontFamilies.serif,
  },
} as const;

export const typography = {
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacings,
  textStyles,
} as const;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const controlHeights = {
  compact: 36,
  default: 44,
  large: 52,
} as const;

export const iconSizes = {
  small: 16,
  default: 20,
  large: 24,
} as const;

export const touchTarget = {
  minimum: 44,
} as const;

export const radii = {
  control: 12,
  card: 18,
  dialog: 20,
  pill: 999,
} as const;

const nativeShadows = {
  none: {
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  soft: {
    shadowColor: "#3B3428",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  floating: {
    shadowColor: "#3B3428",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 8,
  },
} as const;

const webShadows = {
  none: {
    boxShadow: "none",
  },
  soft: {
    boxShadow: "0 4px 12px rgba(59,52,40,0.08)",
  },
  floating: {
    boxShadow: "0 12px 28px rgba(59,52,40,0.14)",
  },
} as const;

export const shadows =
  Platform.OS === "web" ? webShadows : nativeShadows;

export const zIndices = {
  background: -1,
  base: 0,
  navigation: 10,
  overlay: 20,
  dialog: 30,
  toast: 40,
} as const;

export const motion = {
  durations: {
    press: 150,
    state: 220,
    enter: 300,
    exit: 240,
    /** 呼吸周期：4.6s，与原型 breathe 关键帧一致。 */
    ambient: 4_600,
  },
  distances: {
    subtle: 4,
    standard: 12,
  },
  curves: {
    standard: [0.2, 0, 0, 1],
    emphasized: [0.2, 0.8, 0.2, 1],
    exit: [0.4, 0, 1, 1],
  },
} as const;
