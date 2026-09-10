/** solarlunar 的类型声明（该包 d.ts 未在 package.json exports 中正确暴露）。 */
declare module "solarlunar" {
  export interface SolarLunarResult {
    lunarYear: number;
    lunarMonth: number;
    lunarDay: number;
    /** 中文月，如「八」或「闰八」。 */
    monthCn: string;
    /** 中文日，如「廿五」。 */
    dayCn: string;
    [key: string]: unknown;
  }
  const solarlunar: {
    /** 公历转农历（年, 月, 日均为数字）。注意：没有 solarToLunar 这个名字！ */
    solar2lunar(y: number, m: number, d: number): SolarLunarResult;
  };
  export default solarlunar;
}
