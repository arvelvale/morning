/**
 * 来信四类的手绘图标（24×24 viewBox，线宽 1.8、圆角端点，一点淡淡的填色做双色）。
 * 替换原来的 lucide 默认图标，和米露的星星、夜空是一家人：
 *
 * - 晚间信 = 一只信封 + 右上角一弯小月亮：晚上 21:30 才拆的那封信；
 * - 有句话 = 对话气泡里一颗四角星：米露替你想好了一句话，那颗星就是它胸口的星；
 * - 周报   = 小日历上三颗渐次变亮的点（最后一颗长成星）：一周里被你接住的事，一天比一天亮；
 * - 小纸条 = 右下角卷起一角的便签，两行短短的字：一两句话的随手提醒。
 *
 * 颜色只传一个主色 color，淡填充用同色低透明度，所以放在各类自己的浅色圆底上最干净。
 * 16px 与 20px 都看得清：小点和星的最小半径 ≥ 1，线宽不随尺寸缩小到发糊（按 viewBox 等比）。
 */
import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { Mail } from "lucide-react-native";

import type { LetterKind } from "./shared";

/** 四角星（外半径 r，内半径 = r * k），返回 path d。 */
export function sparklePath(cx: number, cy: number, r: number, k = 0.34): string {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const rr = i % 2 ? r * k : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

const SW = 1.8;
const TINT = 0.16;

/** 晚间信：信封 + 小月亮 */
function EveningIcon({ c, size }: { c: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2.8} y={8.8} width={16.6} height={11.6} rx={3.2} fill={c} fillOpacity={TINT}
        stroke={c} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M3.8 10.8 11.1 15.6l7.3-4.8" stroke={c} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M19.6 1.4a3.4 3.4 0 1 0 2.9 4.9 2.7 2.7 0 0 1-2.9-4.9z" fill={c} stroke={c} strokeWidth={1} strokeLinejoin="round" />
    </Svg>
  );
}

/** 周报：小日历 + 三颗渐次变亮的点 */
function WeeklyIcon({ c, size }: { c: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={5} width={17} height={15.5} rx={3.6} fill={c} fillOpacity={TINT}
        stroke={c} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M8.2 2.8v4M15.8 2.8v4" stroke={c} strokeWidth={SW} strokeLinecap="round" />
      <Circle cx={7.6} cy={16.8} r={1.05} fill={c} fillOpacity={0.45} />
      <Circle cx={11.3} cy={14.9} r={1.35} fill={c} fillOpacity={0.75} />
      <Path d={sparklePath(15.6, 12.8, 2.7)} fill={c} stroke={c} strokeWidth={0.8} strokeLinejoin="round" />
    </Svg>
  );
}

/** 有句话：对话气泡里一颗星 */
function RehearseIcon({ c, size }: { c: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 3.8h12a3.5 3.5 0 0 1 3.5 3.5v6.4a3.5 3.5 0 0 1-3.5 3.5h-6.2l-4.6 3.6v-3.6H6a3.5 3.5 0 0 1-3.5-3.5V7.3A3.5 3.5 0 0 1 6 3.8z"
        fill={c} fillOpacity={TINT} stroke={c} strokeWidth={SW} strokeLinejoin="round" />
      <Path d={sparklePath(12, 10.4, 3.4)} fill={c} stroke={c} strokeWidth={0.8} strokeLinejoin="round" />
    </Svg>
  );
}

/** 小纸条：右下角卷起一角的便签 */
function NoteIcon({ c, size }: { c: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6.5 3.6h11a3 3 0 0 1 3 3v8.1l-5.8 5.7H6.5a3 3 0 0 1-3-3V6.6a3 3 0 0 1 3-3z"
        fill={c} fillOpacity={TINT} stroke={c} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M20.4 14.8h-3.7a2 2 0 0 0-2 2v3.7" fill={c} fillOpacity={0.35}
        stroke={c} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7.6 9h8.2M7.6 12.6h4.6" stroke={c} strokeWidth={SW} strokeLinecap="round" />
    </Svg>
  );
}

/** 按类别取图标；「来信」(other) 没有专属图形，沿用 lucide 的信封。 */
export function LetterKindIcon({ kind, size = 16, color }: { kind: LetterKind; size?: number; color: string }) {
  if (kind === "evening") return <EveningIcon c={color} size={size} />;
  if (kind === "weekly") return <WeeklyIcon c={color} size={size} />;
  if (kind === "rehearse") return <RehearseIcon c={color} size={size} />;
  if (kind === "note") return <NoteIcon c={color} size={size} />;
  return <Mail size={size} color={color} />;
}
