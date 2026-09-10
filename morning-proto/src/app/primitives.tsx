/* Auto-split from App.tsx (codemod). */
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MessageCircle, Mail, Film, User, X, ChevronLeft } from "lucide-react";
import { useNight, NK, type Tab } from "./theme";

// ─── Mist Background ─────────────────────────────────────────────────────────

export function MistBackground({ night = false }: { night?: boolean }) {
  const dayOrbs = [
    { c: "#F6E7A8", x: 8,   y: -8,  s: 72 },
    { c: "#F3D8C7", x: 58,  y: 58,  s: 78 },
    { c: "#DDEDE3", x: -4,  y: 48,  s: 62 },
    { c: "#DFE7F5", x: 48,  y: 4,   s: 58 },
    { c: "#E9E4F3", x: 68,  y: 22,  s: 52 },
  ];
  const nightOrbs = [
    { c: "rgba(89,70,83,0.82)",  x: 8,   y: -8,  s: 72 },
    { c: "rgba(59,51,64,0.88)",  x: 58,  y: 58,  s: 78 },
    { c: "rgba(50,46,56,0.92)",  x: -4,  y: 48,  s: 62 },
    { c: "rgba(41,38,48,0.90)",  x: 48,  y: 4,   s: 58 },
    { c: "rgba(69,58,72,0.75)",  x: 68,  y: 22,  s: 52 },
    { c: "rgba(221,199,143,0.09)", x: 40, y: 30,  s: 60 },
  ];
  const orbs = night ? nightOrbs : dayOrbs;
  const names = ["mist1","mist2","mist3","mist4","mist5"];
  const durs  = ["18s","22s","16s","20s","24s"];
  const dels  = ["0s","-6s","-3s","-9s","-12s"];

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <style>{`
        @keyframes mist1{0%,100%{transform:translate(-50%,-50%) scale(1)}40%{transform:translate(calc(-50% + 9px),calc(-50% + 13px)) scale(1.04)}70%{transform:translate(calc(-50% - 11px),calc(-50% + 5px)) scale(0.96)}}
        @keyframes mist2{0%,100%{transform:translate(-50%,-50%) scale(1)}25%{transform:translate(calc(-50% - 13px),calc(-50% + 9px)) scale(1.03)}75%{transform:translate(calc(-50% + 9px),calc(-50% - 7px)) scale(0.97)}}
        @keyframes mist3{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(calc(-50% + 11px),calc(-50% - 13px)) scale(1.05)}}
        @keyframes mist4{0%,100%{transform:translate(-50%,-50%) scale(1)}40%{transform:translate(calc(-50% - 7px),calc(-50% + 15px)) scale(0.98)}80%{transform:translate(calc(-50% + 5px),calc(-50% - 7px)) scale(1.02)}}
        @keyframes mist5{0%,100%{transform:translate(-50%,-50%) scale(1)}60%{transform:translate(calc(-50% + 15px),calc(-50% + 7px)) scale(1.03)}}
        @keyframes typingDot{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
        @keyframes fragmentIn{from{opacity:0;transform:translate(var(--fx),var(--fy)) scale(0.75)}to{opacity:0.75;transform:translate(0,0) scale(1)}}
        @keyframes fragmentOut{from{opacity:0.75}to{opacity:0;transform:translateY(20px) scale(0.85)}}
      `}</style>
      {orbs.map((o, i) => (
        <div key={i} style={{
          position: "absolute", left: `${o.x}%`, top: `${o.y}%`,
          width: `${o.s}%`, height: `${o.s}%`,
          background: o.c, borderRadius: "50%", filter: "blur(88px)",
          opacity: 0.62,
          animation: `${names[i]} ${durs[i]} ${dels[i]} infinite ease-in-out`,
        }}/>
      ))}
    </div>
  );
}

// ─── Pet Placeholder ─────────────────────────────────────────────────────────

export function PetPlaceholder({ size = 200 }: { size?: number }) {
  const night = useNight();
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div className="absolute rounded-full" style={{
        width: size * 1.55, height: size * 1.55,
        background: night
          ? "radial-gradient(circle, rgba(221,199,143,0.22) 0%, transparent 65%)"
          : "radial-gradient(circle, rgba(246,231,168,0.32) 0%, transparent 65%)",
        top: "50%", left: "50%", transform: "translate(-50%,-50%)",
      }}/>
      <div className="rounded-full flex flex-col items-center justify-center" style={{
        width: size, height: size,
        background: night ? "rgba(59,51,64,0.45)" : "rgba(255,252,245,0.7)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: night ? "1.5px solid rgba(255,255,255,0.10)" : "1.5px solid rgba(255,255,255,0.55)",
        boxShadow: night ? "0 16px 48px rgba(10,8,14,0.20)" : "0 16px 48px rgba(121,100,72,0.08)",
      }}>
        <div style={{ fontSize: size * 0.3 }}>🌿</div>
        <div style={{ fontSize: size * 0.072, color: night ? NK.text3 : "#C0B5A8", marginTop: size * 0.04, letterSpacing: "0.03em" }}>
          Pet Artwork
        </div>
      </div>
    </div>
  );
}

// ─── Glass Card ──────────────────────────────────────────────────────────────

export function GlassCard({ children, className = "", style = {}, onClick }: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const night = useNight();
  return (
    <div
      className={`rounded-[24px] ${onClick ? "cursor-pointer active:scale-[0.97] transition-transform duration-100" : ""} ${className}`}
      style={{
        background: night ? NK.cardBg : "rgba(255,252,245,0.65)",
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        border: night ? `1px solid ${NK.glassBorder}` : "1px solid rgba(255,255,255,0.45)",
        boxShadow: night ? "0 8px 32px rgba(10,8,14,0.16)" : "0 8px 32px rgba(121,100,72,0.07)",
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

// ─── Cream Ripple (3 ritual moments only) ────────────────────────────────────

export function CreamRipple({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 20 }}>
          {[{ scale: 3.2, opacity: 0.55, dur: 0.54 }, { scale: 4.8, opacity: 0.28, dur: 0.65 }].map((r, i) => (
            <motion.div key={i}
              initial={{ scale: 0, opacity: r.opacity }}
              animate={{ scale: r.scale, opacity: 0 }}
              transition={{ duration: r.dur, ease: "easeOut", delay: i * 0.07 }}
              style={{
                position: "absolute",
                width: 80, height: 80, borderRadius: "50%",
                top: "50%", left: "50%",
                marginTop: -40, marginLeft: -40,
                background: "radial-gradient(circle, rgba(246,231,168,0.72) 0%, rgba(243,216,199,0.4) 40%, transparent 70%)",
              }}
            />
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}

// ─── Edge Highlight Sweep ─────────────────────────────────────────────────────

export function EdgeHighlight({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ x: "-100%", opacity: 0 }}
          animate={{ x: "120%", opacity: [0, 0.55, 0] }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: "linear-gradient(90deg, transparent 0%, rgba(255,248,220,0.42) 50%, transparent 100%)",
            zIndex: 5, borderRadius: "inherit",
          }}
        />
      )}
    </AnimatePresence>
  );
}

// ─── Liquid Glass Input wrapper ───────────────────────────────────────────────

export function LiquidGlassShell({ children, onClick, className = "", style = {} }: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const night = useNight();
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <motion.div
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      animate={{ scale: pressed ? 0.97 : 1 }}
      transition={pressed
        ? { duration: 0.14, ease: "easeOut" }
        : { duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
      className={`relative overflow-hidden ${className}`}
      style={{
        background: night ? NK.glass : "rgba(255,252,245,0.65)",
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        border: night
          ? `1px solid ${focused ? "rgba(255,255,255,0.22)" : NK.glassBorder}`
          : `1px solid ${focused ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.45)"}`,
        boxShadow: night
          ? (focused ? "0 4px 20px rgba(10,8,14,0.20), inset 0 0 0 0.5px rgba(255,255,255,0.18)" : "0 4px 16px rgba(10,8,14,0.14)")
          : (focused ? "0 4px 20px rgba(121,100,72,0.09), inset 0 0 0 0.5px rgba(255,255,255,0.55)" : "0 4px 16px rgba(121,100,72,0.07)"),
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        ...style,
      }}>
      <EdgeHighlight active={pressed}/>
      {children}
    </motion.div>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

export function PrimaryBtn({ children, onClick, full = false, disabled = false }: {
  children: React.ReactNode; onClick?: () => void; full?: boolean; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${full ? "w-full" : ""} px-7 py-[14px] rounded-full text-[15px] font-medium transition-all duration-100 active:scale-[0.97]`}
      style={{
        background: "rgba(246,231,168,0.92)", color: "#4B463F",
        border: "1px solid rgba(255,255,255,0.5)",
        boxShadow: "0 4px 18px rgba(121,100,72,0.1)",
        opacity: disabled ? 0.5 : 1,
      }}>
      {children}
    </button>
  );
}

export function SecondaryBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full px-7 py-[13px] rounded-full text-[15px] font-medium transition-all duration-100 active:scale-[0.97]"
      style={{
        background: "rgba(243,216,199,0.55)", color: "#4B463F",
        border: "1px solid rgba(255,255,255,0.4)",
      }}>
      {children}
    </button>
  );
}

export function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className="px-5 py-3 rounded-full text-[14px] transition-all duration-100 active:opacity-60"
      style={{ color: "var(--text-secondary)" }}>
      {children}
    </button>
  );
}

// ─── Warm Dot ────────────────────────────────────────────────────────────────

export function WarmDot() {
  return (
    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
      style={{ background: "rgba(196,149,58,0.8)", boxShadow: "0 0 6px rgba(196,149,58,0.45)" }}/>
  );
}

// ─── Chat Bubbles ─────────────────────────────────────────────────────────────

export function AgentBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2 mb-4 pr-12">
      <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-sm"
        style={{ background: "rgba(255,252,245,0.8)", border: "1px solid rgba(255,255,255,0.5)" }}>
        🌿
      </div>
      <div className="px-4 py-3 rounded-[18px] rounded-bl-[6px] text-[15px] leading-relaxed"
        style={{
          background: "rgba(255,252,245,0.75)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.45)",
          color: "var(--text-primary)",
          boxShadow: "0 4px 16px rgba(121,100,72,0.06)",
        }}>
        {text}
      </div>
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-4 pl-12">
      <div className="px-4 py-3 rounded-[18px] rounded-br-[6px] text-[15px] leading-relaxed"
        style={{
          background: "rgba(246,231,168,0.75)",
          border: "1px solid rgba(255,255,255,0.45)",
          color: "var(--text-primary)",
        }}>
        {text}
      </div>
    </div>
  );
}

// ─── Bottom Sheet ─────────────────────────────────────────────────────────────

export function BottomSheet({ children, onClose, title }: {
  children: React.ReactNode; onClose?: () => void; title?: string;
}) {
  const night = useNight();
  return (
    <motion.div className="absolute inset-0 z-50"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}>
      <div className="absolute inset-0 bg-black/8" onClick={onClose}/>
      <motion.div className="absolute bottom-0 left-0 right-0 rounded-t-[32px] overflow-hidden"
        style={{
          background: night ? "rgba(50,46,56,0.96)" : "rgba(255,252,245,0.94)",
          backdropFilter: "blur(44px)",
          WebkitBackdropFilter: "blur(44px)",
          border: night ? "1px solid rgba(255,255,255,0.09)" : "1px solid rgba(255,255,255,0.5)",
          borderBottom: "none",
        }}
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "tween", duration: 0.26, ease: [0.32, 0.72, 0, 1] }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: night ? "rgba(255,255,255,0.12)" : "rgba(91,79,62,0.14)" }}/>
        </div>
        {title && (
          <div className="flex items-center justify-between px-6 py-3">
            <span className="text-[17px] font-medium" style={{ color: night ? NK.text : "#4B463F" }}>{title}</span>
            {onClose && (
              <button onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center active:opacity-60"
                style={{ background: night ? "rgba(255,255,255,0.08)" : "rgba(91,79,62,0.07)" }}>
                <X size={14} style={{ color: night ? NK.text2 : "#847D72" }}/>
              </button>
            )}
          </div>
        )}
        {children}
      </motion.div>
    </motion.div>
  );
}

// ─── Safe Header ─────────────────────────────────────────────────────────────

export function SafeHeader({ title, onBack, rightEl }: {
  title?: string; onBack?: () => void; rightEl?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between pt-[52px] pb-3 px-5">
      <div className="w-8">
        {onBack && (
          <button onClick={onBack} className="w-8 h-8 flex items-center justify-center active:opacity-60">
            <ChevronLeft size={22} style={{ color: "var(--text-primary)" }}/>
          </button>
        )}
      </div>
      {title && <span className="text-[17px] font-medium" style={{ color: "var(--text-primary)" }}>{title}</span>}
      <div className="w-8 flex justify-end">{rightEl}</div>
    </div>
  );
}

// ─── Tab Bar ─────────────────────────────────────────────────────────────────

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const night = useNight();
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "companion", label: "陪伴",   icon: <MessageCircle size={21}/> },
    { id: "mailbox",   label: "信箱",   icon: <Mail size={21}/> },
    { id: "scene",     label: "片场",   icon: <Film size={21}/> },
    { id: "profile",   label: "我的",   icon: <User size={21}/> },
  ];
  return (
    <div className="absolute bottom-0 left-0 right-0 pb-6">
      <div className="mx-4 rounded-[28px] px-2 py-1.5 flex items-center relative"
        style={{
          background: night ? "rgba(50,46,56,0.88)" : "rgba(255,252,245,0.82)",
          backdropFilter: "blur(32px)",
          WebkitBackdropFilter: "blur(32px)",
          border: night ? "1px solid rgba(255,255,255,0.09)" : "1px solid rgba(255,255,255,0.48)",
          boxShadow: night ? "0 8px 32px rgba(10,8,14,0.22)" : "0 8px 32px rgba(121,100,72,0.10)",
        }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => onChange(t.id)}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 rounded-[20px] relative z-10"
            style={{ color: active === t.id ? (night ? NK.text : "#4B463F") : (night ? NK.text3 : "#C0B5A8") }}>
            {/* Sliding pill indicator */}
            {active === t.id && (
              <motion.div
                layoutId="tab-active-pill"
                className="absolute inset-0 rounded-[20px]"
                style={{ background: night ? "rgba(216,188,118,0.45)" : "rgba(246,231,168,0.72)" }}
                transition={{ type: "tween", duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              />
            )}
            <span className="relative z-10">{t.icon}</span>
            <span className="text-[10px] font-medium relative z-10">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
