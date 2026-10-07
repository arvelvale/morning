/**
 * Morning 设计基础 —— 米露的夜空 × 贴纸绘本（2026-10 改版第二稿）。
 *
 * 层级靠明度拉开，而不是一片米白：
 * - 纸色只做底；最重的一块是「米露的夜空」深靛（sky），首页主卡、登录天空用它；
 * - 金色（star）只给星星，也就是被接住的东西；
 * - 四类碎片各一色：待办 番茄 / 灵感 柠檬 / 情绪 薰衣草 / 片段 薄荷（todo/idea/mood/frag，各带一个浅底 *Soft）；
 * - 主操作与选中态用深靛实心（accent），夜间反转成浅薰衣草。
 * Token 使用语义命名；素材色、图片蒙层和特殊场景色不放在这里。
 */
import { Platform } from "react-native";

export const lightColors = {
  background: "#F3EFE9",
  backgroundSubtle: "#E9E3DA",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  surfaceHover: "#F6F3EE",
  surfacePressed: "#EEE9E1",
  textPrimary: "#211D32",
  textSecondary: "#5C566C",
  textMuted: "#8F889C",
  textOnAccent: "#FFFFFF",
  textOnDanger: "#FFF9F5",
  placeholder: "#9A93A6",
  border: "rgba(33,29,50,0.12)",
  divider: "rgba(33,29,50,0.07)",
  accent: "#2D2754",
  accentSurface: "rgba(45,39,84,0.09)",
  accentSoft: "rgba(45,39,84,0.05)",
  accentHover: "#3A3270",
  accentPressed: "#1F1A40",
  support: "#23917A",
  focus: "#7563DE",
  disabledSurface: "#ECE7E0",
  disabledText: "#B3ADBD",
  success: "#23917A",
  warning: "#C98E00",
  error: "#D0533A",
  overlay: "rgba(14,11,28,0.55)",
  scrim: "rgba(14,11,28,0.22)",
  /** 米露的夜空：主卡与登录天空的渐变两端 + 右下角的紫色辉光。日夜都是深色。 */
  sky: "#2D2754",
  skyDeep: "#1C1833",
  skyGlow: "#7660D6",
  /** 星星：只用于「被接住的东西」（计数、星光、高亮圈）。 */
  star: "#FFD467",
  starDeep: "#F2A93B",
  /** 四类碎片的语义色。 */
  todo: "#E5603F",
  todoSoft: "#FCE4DC",
  idea: "#C98E00",
  ideaSoft: "#FBEFC8",
  mood: "#7563DE",
  moodSoft: "#ECE8FD",
  frag: "#23917A",
  fragSoft: "#D8F0E7",
  /** 信封纸面与封舌。 */
  envelope: "#FFF6E4",
  envelopeFlap: "#F4E3C3",
} as const;

/** 夜间：深靛纸底，主操作反转为浅薰衣草；四类色提亮以保证在深底上可读。 */
export const darkColors: ColorTokens = {
  background: "#141127",
  backgroundSubtle: "#0F0D20",
  surface: "#1F1B39",
  surfaceElevated: "#27224A",
  surfaceHover: "#2A2550",
  surfacePressed: "#312B5A",
  textPrimary: "#F1EDF8",
  textSecondary: "#BEB6D2",
  textMuted: "#8C84A6",
  textOnAccent: "#17142C",
  textOnDanger: "#FFF9F5",
  placeholder: "#7D7598",
  border: "rgba(241,237,248,0.12)",
  divider: "rgba(241,237,248,0.07)",
  accent: "#BBAFFF",
  accentSurface: "rgba(187,175,255,0.14)",
  accentSoft: "rgba(187,175,255,0.08)",
  accentHover: "#CBC2FF",
  accentPressed: "#A497F0",
  support: "#4CC9A6",
  focus: "#BBAFFF",
  disabledSurface: "#221E3E",
  disabledText: "#5E577A",
  success: "#4CC9A6",
  warning: "#F2C14E",
  error: "#FF8A6B",
  overlay: "rgba(5,4,12,0.62)",
  scrim: "rgba(5,4,12,0.32)",
  sky: "#231C4F",
  skyDeep: "#0D0B1C",
  skyGlow: "#5B47C4",
  star: "#FFD467",
  starDeep: "#F2A93B",
  todo: "#FF8A6B",
  todoSoft: "#3B2236",
  idea: "#F2C14E",
  ideaSoft: "#382F2A",
  mood: "#A595FF",
  moodSoft: "#2B2652",
  frag: "#4CC9A6",
  fragSoft: "#16343A",
  envelope: "#2A2549",
  envelopeFlap: "#352E5E",
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
 * 标题与米露说的话用「Miaoling Kai」（霞鹜文楷 Screen 常用字子集，见 scripts/build-font-subset.py），
 * 在 App.tsx 用 expo-font 加载；正文、按钮、输入框仍用系统无衬线，保证小字清楚。
 * 自定义字体只有一个字重，用到 hand 的样式一律 fontWeight 400，避免安卓找不到粗体回退成系统字。
 */
export const HAND_FONT = "MiaolingKai";
export const fontFamilies = {
  hand: Platform.select({
    web: `"${HAND_FONT}", "KaiTi", "STKaiti", serif`,
    default: HAND_FONT,
  }),
  /** 兼容旧引用：情绪性标题原先用系统衬线，现统一换成 hand。 */
  serif: Platform.select({
    web: `"${HAND_FONT}", "KaiTi", "STKaiti", serif`,
    default: HAND_FONT,
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
  readingBody: 30,
} as const;

export const letterSpacings = {
  tight: -0.4,
  normal: 0,
  relaxed: 0.2,
  label: 0.4,
  /** 环境行常是整句（日期 · 节气 · 状态），宽字距会把句子拆散，只留一点呼吸。 */
  ambient: 0.6,
} as const;

export const textStyles = {
  /** 叠加在标题字号之后：仅登录欢迎语、信件标题、片场引导语使用。 */
  emotionalTitle: {
    fontFamily: fontFamilies.hand,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.normal,
  },
  display: {
    fontSize: fontSizes.display,
    lineHeight: lineHeights.display,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.normal,
    fontFamily: fontFamilies.hand,
  },
  pageTitle: {
    fontSize: fontSizes.pageTitle,
    lineHeight: lineHeights.pageTitle,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.normal,
    fontFamily: fontFamilies.hand,
  },
  sectionTitle: {
    fontSize: fontSizes.sectionTitle,
    lineHeight: lineHeights.sectionTitle,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.normal,
    fontFamily: fontFamilies.hand,
  },
  /** 米露说的话（气泡、引导提示）：手写体，稍大一号。 */
  petVoice: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.normal,
    fontFamily: fontFamilies.hand,
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
  /** 对话摘要等阅读内容使用系统无衬线，保留舒展的行距。 */
  readingBody: {
    fontSize: 17,
    lineHeight: lineHeights.readingBody,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.relaxed,
    fontFamily: fontFamilies.sans,
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
  control: 14,
  card: 20,
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
    shadowColor: "#211D32",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  floating: {
    shadowColor: "#211D32",
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
    boxShadow: "0 4px 12px rgba(33,29,50,0.08)",
  },
  floating: {
    boxShadow: "0 12px 28px rgba(33,29,50,0.14)",
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
