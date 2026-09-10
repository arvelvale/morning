/** Morning 主题的唯一实现入口。 */
import { createContext, useContext } from "react";
import {
  darkColors,
  lightColors,
  motion,
  radii,
  shadows,
  spacing,
  typography,
  zIndices,
  type ColorTokens,
} from "./tokens";

export type ThemeMode = "light" | "dark";

export type Theme = {
  mode: ThemeMode;
  isNight: boolean;
  colors: ColorTokens;
  typography: typeof typography;
  spacing: typeof spacing;
  radii: typeof radii;
  shadows: typeof shadows;
  motion: typeof motion;
  zIndices: typeof zIndices;
};

export const NightCtx = createContext(false);
const useNight = () => useContext(NightCtx);

const sharedThemeTokens = {
  typography,
  spacing,
  radii,
  shadows,
  motion,
  zIndices,
} as const;

export const lightTheme: Theme = {
  mode: "light",
  isNight: false,
  colors: lightColors,
  ...sharedThemeTokens,
};

export const darkTheme: Theme = {
  mode: "dark",
  isNight: true,
  colors: darkColors,
  ...sharedThemeTokens,
};

/** 新代码使用的唯一主题 Hook。 */
export function useTheme(): Theme {
  return useNight() ? darkTheme : lightTheme;
}
