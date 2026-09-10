/* Auto-split from App.tsx (codemod). */
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Send, Plus, ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";
import { PetPlaceholder, LiquidGlassShell, WarmDot, AgentBubble, UserBubble, BottomSheet } from "../primitives";

// ─── Companion: Idle ─────────────────────────────────────────────────────────

export function CompanionIdle({ onChat, onModeSheet, onNightToggle, night, petName, petEmoji }: {
  onChat: () => void; onModeSheet: () => void; onNightToggle: () => void;
  night: boolean; petName: string; petEmoji: string;
}) {
  const [bubbleVisible, setBubbleVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setBubbleVisible(false), 4200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 pt-[52px] pb-2">
        <div>
          <div className="text-[17px] font-medium" style={{ color: "var(--text-primary)" }}>{petName}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <WarmDot/>
            <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>在等你</span>
          </div>
        </div>
        <button onClick={onNightToggle}
          className="w-9 h-9 rounded-full flex items-center justify-center active:opacity-60 transition-opacity"
          style={{ background: "rgba(255,252,245,0.65)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.45)" }}>
          {night
            ? <Sun  size={15} style={{ color: "var(--text-primary)" }}/>
            : <Moon size={15} style={{ color: "var(--text-primary)" }}/>}
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center relative" onClick={onChat}>
        <AnimatePresence>
          {bubbleVisible && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              className="absolute px-5 py-3 rounded-[20px] rounded-bl-[6px] text-[15px]"
              style={{
                top: "8%", left: "50%", transform: "translateX(-50%)",
                background: "rgba(255,252,245,0.85)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.5)",
                color: "#484145",
                boxShadow: "0 8px 24px rgba(121,100,72,0.08)",
                whiteSpace: "nowrap",
              }}>
              今天怎么样？✨
            </motion.div>
          )}
        </AnimatePresence>

        <PetPlaceholder size={215}/>
        <p className="mt-5 text-[13px]" style={{ color: "var(--text-muted)" }}>轻触打招呼</p>
      </div>

      <div className="px-5 pb-[110px]">
        <div className="flex items-center gap-3">
          <LiquidGlassShell
            onClick={onChat}
            className="flex-1 flex items-center gap-3 px-5 py-4 rounded-full cursor-text">
            <span className="text-[15px] flex-1" style={{ color: "var(--text-muted)" }}>说点什么…</span>
            <Mic size={17} style={{ color: "var(--text-muted)" }}/>
          </LiquidGlassShell>
          <motion.button onClick={onModeSheet}
            whileTap={{ scale: 0.95, transition: { duration: 0.14, ease: "easeOut" } }}
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 relative overflow-hidden"
            style={{
              background: "rgba(246,231,168,0.82)",
              border: "1px solid rgba(255,255,255,0.5)",
              boxShadow: "0 4px 16px rgba(121,100,72,0.1)",
            }}>
            <Plus size={20} style={{ color: "var(--text-primary)" }}/>
          </motion.button>
        </div>
      </div>
    </div>
  );
}

// ─── Companion: Chat ─────────────────────────────────────────────────────────

export function CompanionChat({ onBack, petName, petEmoji }: {
  onBack: () => void; petName: string; petEmoji: string;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { role: "agent", text: "嗯，我在。今天有什么想聊的吗？" },
  ]);
  const [thinking, setThinking] = useState(false);

  const send = () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    setMessages(m => [...m, { role: "user", text }]);
    setThinking(true);
    setTimeout(() => {
      setMessages(m => [...m, { role: "agent", text: "我听到了。能多说一点吗？" }]);
      setThinking(false);
    }, 1300);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 pt-[52px] pb-3 flex-shrink-0">
        <button onClick={onBack} className="active:opacity-60 transition-opacity">
          <ChevronLeft size={22} style={{ color: "var(--text-primary)" }}/>
        </button>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: "rgba(255,252,245,0.82)", border: "1px solid rgba(255,255,255,0.5)" }}>
          {petEmoji}
        </div>
        <div>
          <div className="text-[16px] font-medium" style={{ color: "var(--text-primary)" }}>{petName}</div>
          <div className="flex items-center gap-1.5">
            <WarmDot/>
            <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>在听</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-2" style={{ scrollbarWidth: "none" }}>
        {messages.map((m, i) => (
          m.role === "agent"
            ? <AgentBubble key={i} text={m.text}/>
            : <UserBubble   key={i} text={m.text}/>
        ))}
        {thinking && (
          <div className="flex items-end gap-2 mb-4">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-sm"
              style={{ background: "rgba(255,252,245,0.82)", border: "1px solid rgba(255,255,255,0.5)" }}>
              {petEmoji}
            </div>
            <div className="px-4 py-3 rounded-[18px] rounded-bl-[6px]"
              style={{ background: "rgba(255,252,245,0.75)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.45)" }}>
              <div className="flex gap-1 items-center h-5">
                {[0, 1, 2].map(j => (
                  <div key={j} className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "#C0B5A8", animation: `typingDot 0.9s ${j * 0.16}s infinite` }}/>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pb-[110px] pt-2 flex-shrink-0">
        <LiquidGlassShell className="flex items-end gap-2 px-4 py-3 rounded-[24px]">
          <textarea value={input} onChange={e => setInput(e.target.value)}
            placeholder="说点什么…" rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-[15px] leading-relaxed"
            style={{ color: "var(--text-primary)", maxHeight: 80 }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <motion.button onClick={send}
            whileTap={{ scale: 0.9, transition: { duration: 0.12 } }}
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: input.trim() ? "rgba(246,231,168,0.92)" : "var(--row-divider)" }}>
            <Send size={13} style={{ color: input.trim() ? "#4B463F" : "var(--text-muted)" }}/>
          </motion.button>
        </LiquidGlassShell>
      </div>
    </div>
  );
}

// ─── Mode Sheet ───────────────────────────────────────────────────────────────

export function ModeSheet({ onClose, onSleepDump, onChat }: {
  onClose: () => void; onSleepDump: () => void; onChat: () => void;
}) {
  const modes = [
    { icon: "☁️",  label: "自由聊聊",      desc: "随便聊点什么，没有主题",         act: onChat },
    { icon: "🌊",  label: "一股脑倒出来",  desc: "把今天的念头一次全说出来",       act: onSleepDump },
    { icon: "🪨",  label: "说件放不下的事", desc: "有什么在心里反复出现",           act: onChat },
    { icon: "📽️", label: "回看一个片段",   desc: "回到某段记忆里看看",             act: onChat },
  ];
  return (
    <BottomSheet onClose={onClose} title="想怎么聊？">
      <div className="px-5 pb-8 pt-2 flex flex-col gap-2">
        {modes.map((m, i) => (
          <button key={i} onClick={m.act}
            className="flex items-center gap-4 p-4 rounded-[20px] text-left w-full active:scale-[0.97] transition-transform duration-100"
            style={{ background: "rgba(255,252,245,0.5)", border: "1px solid rgba(255,255,255,0.4)" }}>
            <span className="text-2xl">{m.icon}</span>
            <div>
              <div className="text-[15px] font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>{m.label}</div>
              <div className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{m.desc}</div>
            </div>
            <ChevronRight size={15} style={{ color: "var(--text-muted)", marginLeft: "auto" }}/>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
