/* Auto-split from App.tsx (codemod). */
import React, { createContext, useContext } from "react";
import { Type } from "lucide-react";

// ─── Night Mode Context & Palette ────────────────────────────────────────────

export const NightCtx = createContext(false);

export const useNight = () => useContext(NightCtx);

export const NK = {
  // Backgrounds
  bg:   "#292630",
  bg2:  "#322E38",
  bg3:  "#3B3340",
  // Glass surfaces
  glass:        "rgba(255,248,244,0.08)",
  glassBorder:  "rgba(255,255,255,0.14)",
  glassShadow:  "0 12px 40px rgba(10,8,14,0.20)",
  // ── Night Text: dark background surfaces ──────────────────────────────────
  text:         "#F4EFEA",   // Primary   — page titles, important body
  text2:        "#C5BBC1",   // Secondary — captions, status, summaries
  text3:        "#A399A0",   // Tertiary  — dates, sources, aux info
  textDisabled: "#7F767D",   // Disabled  — truly inactive only
  iconPri:      "#E8E0DC",   // Icon / Primary
  iconSec:      "#B9AFB6",   // Icon / Secondary
  placeholder:  "#978E95",   // Input placeholder
  // ── Night Text: light glass / cream paper surfaces ────────────────────────
  lsPri:  "#484145",         // Light Surface / Primary  — card titles
  lsSec:  "#655D61",         // Light Surface / Secondary — body, excerpts
  lsTer:  "#7E7479",         // Light Surface / Tertiary  — dates, sources
  lsDis:  "#A39A9F",         // Light Surface / Disabled
  lsIcon: "#625A5F",         // Light Surface / Icon
  // ── Deep glass selected state ─────────────────────────────────────────────
  selected:    "#E2C46F",    // Selected tab / active icon
  unselected:  "#AFA5AC",    // Unselected icon in deep glass
  // ── Type accent — on dark backgrounds (brighter) ──────────────────────────
  accentLetter:  "#D2A44F",
  accentInsight: "#C0A574",
  accentScene:   "#D28E80",
  accentMusic:   "#AFA0D2",
  accentQuote:   "#BEB1B8",
  // Accent gold pill
  gold:    "#D8BC76",
  // Cards
  cardBg:  "rgba(59,51,64,0.65)",
  cardBg2: "rgba(50,46,56,0.72)",
  // Misc
  divider:  "rgba(255,255,255,0.08)",
  warmGlow: "rgba(221,199,143,0.12)",
  warmGlow2:"rgba(195,143,128,0.09)",
};

// CSS custom properties injected at root — all theme-switchable colors live here
export const NIGHT_VARS: React.CSSProperties = {
  "--text-primary":      NK.text,
  "--text-secondary":    NK.text2,
  "--text-muted":        NK.text3,
  "--text-disabled":     NK.textDisabled,
  "--icon-primary":      NK.iconPri,
  "--icon-secondary":    NK.iconSec,
  "--placeholder-color": NK.placeholder,
  "--glass-surface":     NK.glass,
  "--glass-border":      NK.glassBorder,
  "--card-bg":           NK.cardBg,
  "--divider":           NK.divider,
  "--row-divider":       "rgba(255,255,255,0.07)",
  "--chevron":           "rgba(255,255,255,0.22)",
} as React.CSSProperties;

export const DAY_VARS: React.CSSProperties = {
  "--text-primary":      "#4B463F",
  "--text-secondary":    "#847D72",
  "--text-muted":        "#C0B5A8",
  "--text-disabled":     "#B4A99C",
  "--icon-primary":      "#4B463F",
  "--icon-secondary":    "#847D72",
  "--placeholder-color": "#C0B5A8",
  "--glass-surface":     "rgba(255,252,245,0.65)",
  "--glass-border":      "rgba(255,255,255,0.45)",
  "--card-bg":           "rgba(255,252,245,0.65)",
  "--divider":           "rgba(91,79,62,0.08)",
  "--row-divider":       "rgba(91,79,62,0.07)",
  "--chevron":           "#D0C8BE",
} as React.CSSProperties;

// ─── Types ───────────────────────────────────────────────────────────────────

export type Tab = "companion" | "mailbox" | "scene" | "profile";

export type LetterState = "waiting" | "sealed" | "opening" | "opened" | "saved";

export const LETTER_DATA = {
  date: "7月24日 · 星期五",
  greeting: "晚上好呀",
  from: "桐桐",
  fromEmoji: "🌿",
  deliveryTime: "7月24日 · 晚上 9:30 送达",
  preview: "今天也有一些话想告诉你",
  body: [
    "我记得你今天一直在推进那件很重要的事情，好像没有给自己留下多少喘气的时间。你已经做得比自己感觉到的更多了。",
    "如果今晚还是有点紧绷，也不用急着把所有事情想明白。先在这里坐一会儿，我会陪着你。",
    "我还给你夹了一首很慢的歌，希望它能替我抱抱你。",
  ],
  attachment: {
    label: "信里夹了一首歌",
    title: "Bloom",
    artist: "ODESZA",
    reason: "旋律很慢，适合把今天一点点放下来。",
  },
};

export type Screen =
  | "onboard-1" | "onboard-2" | "onboard-3" | "onboard-4"
  | "companion" | "chat" | "sleep-dump" | "processing" | "receipt"
  | "mailbox" | "task-detail" | "storage-detail"
  | "scene" | "scene-create" | "scene-play" | "scene-end"
  | "profile" | "pet-change" | "pet-handoff";

// Which template each type uses
export type CardTemplate = "text" | "media" | "experience";
