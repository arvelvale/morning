/** 站点级配置:下载地址与版本号。发新版时改这里并替换 public/dl/ 下的安装包。 */
import type { CSSProperties } from 'react';

export const DOWNLOADS = {
  harmony: {
    url: '/dl/morning-harmony.hap',
    version: '0.1 Beta',
    sub: 'HarmonyOS NEXT',
  },
  android: {
    url: '/dl/morning-android-0.3.10.apk',
    version: 'v0.3.10',
    sub: 'Android 10+',
  },
} as const;

export const GITHUB_URL = 'https://github.com/arvelvale/morning';

/** 允许带 CSS 自定义属性(--xxx)的 style 对象 */
export type VarStyle = CSSProperties & Record<`--${string}`, string | number>;
