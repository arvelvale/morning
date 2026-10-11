/** 站点级配置:下载地址与版本号。安装包不放在官网里，而是挂在 morning-site 仓库的 Release 附件上（见 deploy/publish_site.py）。 */
import type { CSSProperties } from 'react';

export const DOWNLOADS = {
  harmony: {
    url: 'https://github.com/arvelvale/morning-site/releases/download/v0.1-beta/morning-harmony.hap',
    version: '0.1 Beta',
    sub: 'HarmonyOS NEXT',
  },
  android: {
    url: 'https://github.com/arvelvale/morning-site/releases/download/v0.3.15/morning-android-0.3.15.apk',
    version: 'v0.3.15',
    sub: 'Android 7.0 起，建议 Android 10 及以上',
  },
} as const;

export const GITHUB_URL = 'https://github.com/arvelvale/morning-site';

/** 允许带 CSS 自定义属性(--xxx)的 style 对象 */
export type VarStyle = CSSProperties & Record<`--${string}`, string | number>;
