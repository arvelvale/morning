/* Auto-split from App.tsx (codemod). */
import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Mic, Clock } from "lucide-react";
import { GlassCard, CreamRipple, PrimaryBtn, SecondaryBtn, SafeHeader } from "../primitives";

// ─── Sleep Dump ───────────────────────────────────────────────────────────────

export function SleepDump({ onBack, onProcess }: { onBack: () => void; onProcess: () => void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack} title="今晚的念头"/>
      <div className="flex-1 px-5 flex flex-col gap-4 pb-[110px] pt-2">
        <p className="text-[14px] leading-snug" style={{ color: "var(--text-secondary)" }}>
          计划、担忧、灵感、情绪——什么都可以，混在一起说也没关系
        </p>
        <div className="flex-1 rounded-[24px] p-5"
          style={{
            background: "rgba(255,252,245,0.65)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
            border: "1px solid rgba(255,255,255,0.45)",
          }}>
          <textarea value={text} onChange={e => setText(e.target.value)}
            placeholder={"今天想说的都在这里…\n\n整理是我的事，你只管说。"}
            className="w-full h-full bg-transparent outline-none resize-none text-[15px] leading-[1.65]"
            style={{ color: "#484145", minHeight: 220 }}
          />
        </div>
        <div className="flex items-center gap-3">
          <button className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 active:opacity-70"
            style={{ background: "rgba(255,252,245,0.65)", border: "1px solid rgba(255,255,255,0.45)" }}>
            <Mic size={19} style={{ color: "var(--text-secondary)" }}/>
          </button>
          <PrimaryBtn onClick={onProcess} full>说完了，帮我整理</PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

// ─── Processing ───────────────────────────────────────────────────────────────

export function ProcessingScreen({ onDone }: { onDone: () => void }) {
  const [showRipple, setShowRipple] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setShowRipple(true);
      setTimeout(() => { setShowRipple(false); onDone(); }, 600);
    }, 2600);
    return () => clearTimeout(t);
  }, [onDone]);

  const fragments = [
    "明天的会议", "担心妈妈", "那本书", "睡前运动",
    "和朋友的事", "灵感：旅行", "今天好累", "想喝奶茶",
    "下周计划", "一直没做的事",
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 relative">
      <CreamRipple active={showRipple}/>
      <div className="relative w-72 h-72 flex items-center justify-center">
        {fragments.map((f, i) => {
          const angle = (i / fragments.length) * Math.PI * 2;
          const r = 85 + (i % 3) * 12;
          const fx = Math.cos(angle) * r;
          const fy = Math.sin(angle) * r;
          return (
            <div key={i}
              className="absolute text-[12px] font-medium px-2.5 py-1 rounded-full"
              style={{
                background: "rgba(255,252,245,0.78)",
                color: "#655D61",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(255,255,255,0.45)",
                ["--fx" as string]: `${fx}px`,
                ["--fy" as string]: `${fy}px`,
                animation: `fragmentIn 0.5s ${i * 0.11}s both, fragmentOut 0.7s ${1.9 + i * 0.04}s both`,
              }}>
              {f}
            </div>
          );
        })}
        <div className="w-20 h-20 rounded-full flex flex-col items-center justify-center"
          style={{
            background: "rgba(255,252,245,0.82)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.5)",
            boxShadow: "0 8px 32px rgba(121,100,72,0.08)",
          }}>
          <div className="text-2xl">🌿</div>
        </div>
      </div>
      <p className="text-[15px]" style={{ color: "var(--text-secondary)" }}>正在接住你的念头…</p>
    </div>
  );
}

// ─── Receipt ─────────────────────────────────────────────────────────────────

export function ReceiptScreen({ onDone, onView }: { onDone: () => void; onView: () => void }) {
  const items = [
    { icon: "📅", label: "明天要接住", value: "3 件事" },
    { icon: "💡", label: "值得留下的想法", value: "2 条" },
    { icon: "🫂", label: "被听见的感受", value: "1 个" },
    { icon: "🌊", label: "今晚无需处理", value: "3 个" },
  ];
  return (
    <div className="flex flex-col h-full">
      <div className="pt-[52px] px-6 pb-4 flex-shrink-0">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <p className="text-[14px] mb-1" style={{ color: "var(--text-secondary)" }}>今晚</p>
          <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
            已替你接住<br/>
            <span style={{ color: "#C4953A" }}>9 个念头</span>
          </h1>
        </motion.div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4" style={{ scrollbarWidth: "none" }}>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {items.map((item, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.09 }}>
              <GlassCard className="p-4">
                <div className="text-2xl mb-2">{item.icon}</div>
                <div className="text-[22px] font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>{item.value}</div>
                <div className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{item.label}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <GlassCard className="p-5" style={{ background: "rgba(246,231,168,0.42)" }}>
            <div className="flex items-center gap-2 mb-1.5">
              <Clock size={13} style={{ color: "#C4953A" }}/>
              <span className="text-[12px] font-medium" style={{ color: "#C4953A" }}>明天最值得关注</span>
            </div>
            <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>与朋友的约定 · 下午 3 点</p>
            <p className="text-[13px] mt-0.5" style={{ color: "var(--text-secondary)" }}>你担心会迟到，我帮你留着了</p>
          </GlassCard>
        </motion.div>
      </div>
      <div className="px-5 pb-[100px] flex flex-col gap-3 pt-3 flex-shrink-0">
        <PrimaryBtn onClick={onDone} full>今晚到这里</PrimaryBtn>
        <SecondaryBtn onClick={onView}>看看我替你放在哪里</SecondaryBtn>
      </div>
    </div>
  );
}
