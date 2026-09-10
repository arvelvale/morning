/* Auto-split from App.tsx (codemod). */
import { useState } from "react";
import { motion } from "motion/react";
import { ChevronRight, Check, Moon, Clock, Archive, Bell, Shield, Type, Layers } from "lucide-react";
import { GlassCard, PrimaryBtn, SafeHeader } from "../primitives";

// ─── Profile ─────────────────────────────────────────────────────────────────

export function ProfileScreen({ onChangePet, night, onNightToggle, petName, petEmoji }: {
  onChangePet: () => void; night: boolean; onNightToggle: () => void;
  petName: string; petEmoji: string;
}) {
  const sections = [
    { title: "陪伴设置", rows: [
      { icon: <Bell  size={16}/>, label: "主动陪伴频率", val: "温和" },
      { icon: <Clock size={16}/>, label: "睡前提醒",     val: "22:30" },
    ]},
    { title: "记忆与隐私", rows: [
      { icon: <Archive size={16}/>, label: "记忆管理",        val: "" },
      { icon: <Clock   size={16}/>, label: "三日寄存规则",    val: "3天" },
      { icon: <Shield  size={16}/>, label: "隐私与数据删除",  val: "" },
    ]},
    { title: "界面与体验", rows: [
      { icon: <Moon   size={16}/>, label: "夜间氛围",   val: night ? "开启" : "关闭", act: onNightToggle },
      { icon: <Type   size={16}/>, label: "字体大小",   val: "标准" },
      { icon: <Layers size={16}/>, label: "减少透明度", val: "关闭" },
    ]},
  ];
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-[52px] pb-3 flex-shrink-0">
        <h1 className="text-[26px] font-medium tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>我的</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-[100px]" style={{ scrollbarWidth: "none" }}>
        <GlassCard className="p-5 mb-5 flex items-center gap-4" onClick={onChangePet}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
            style={{ background: "rgba(246,231,168,0.62)", border: "1px solid rgba(255,255,255,0.5)" }}>
            {petEmoji}
          </div>
          <div className="flex-1">
            <div className="text-[16px] font-medium" style={{ color: "var(--text-primary)" }}>{petName}</div>
            <div className="text-[13px] mt-0.5" style={{ color: "var(--text-secondary)" }}>温柔，善于倾听</div>
          </div>
          <div className="text-[13px] px-3 py-1.5 rounded-full active:opacity-70"
            style={{ background: "rgba(255,252,245,0.82)", color: "#655D61", border: "1px solid rgba(255,255,255,0.4)" }}>
            更换伙伴
          </div>
        </GlassCard>
        {sections.map((sec, si) => (
          <div key={si} className="mb-4">
            <p className="text-[13px] font-medium mb-2 px-1" style={{ color: "var(--text-secondary)" }}>{sec.title}</p>
            <GlassCard>
              {sec.rows.map((row, ri) => (
                <div key={ri}>
                  <button onClick={row.act}
                    className="w-full flex items-center gap-3 px-5 py-4 active:opacity-65 transition-opacity">
                    <span style={{ color: "var(--text-secondary)" }}>{row.icon}</span>
                    <span className="flex-1 text-[15px] text-left" style={{ color: "var(--text-primary)" }}>{row.label}</span>
                    <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>{row.val}</span>
                    <ChevronRight size={13} style={{ color: "var(--chevron)" }}/>
                  </button>
                  {ri < sec.rows.length - 1 && (
                    <div className="mx-5 h-px" style={{ background: "var(--row-divider)" }}/>
                  )}
                </div>
              ))}
            </GlassCard>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pet Change ───────────────────────────────────────────────────────────────

export function PetChange({ onBack, onHandoff }: { onBack: () => void; onHandoff: (i: number) => void }) {
  const [sel, setSel] = useState(-1);
  const opts = [
    { name: "晴晴", trait: "活泼，偶尔调皮",  emoji: "☀️" },
    { name: "暮云", trait: "沉稳，有时神秘",   emoji: "🌙" },
  ];
  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack} title="更换伙伴"/>
      <div className="flex-1 px-5 pt-3 pb-[100px] flex flex-col gap-4">
        <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>米露会把粗粒度近况告诉新伙伴，不会复述细节</p>
        {opts.map((p, i) => (
          <GlassCard key={i} className="p-5 flex items-center gap-4" onClick={() => setSel(i)}
            style={{
              border: sel === i ? "1.5px solid rgba(196,149,58,0.5)" : "1px solid rgba(255,255,255,0.45)",
              background: sel === i ? "rgba(246,231,168,0.42)" : "rgba(255,252,245,0.65)",
            }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
              style={{ background: "rgba(255,252,245,0.85)" }}>
              {p.emoji}
            </div>
            <div className="flex-1">
              <div className="text-[16px] font-medium" style={{ color: "var(--text-primary)" }}>{p.name}</div>
              <div className="text-[13px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{p.trait}</div>
            </div>
            {sel === i && (
              <div className="w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: "rgba(196,149,58,0.8)" }}>
                <Check size={11} style={{ color: "#fff" }}/>
              </div>
            )}
          </GlassCard>
        ))}
        <div className="mt-auto">
          <PrimaryBtn onClick={() => onHandoff(sel)} full disabled={sel === -1}>确认更换</PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

// ─── Pet Handoff ──────────────────────────────────────────────────────────────

export function PetHandoff({ onBack, onDone, newPetEmoji }: {
  onBack: () => void; onDone: () => void; newPetEmoji: string;
}) {
  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack}/>
      <div className="flex-1 px-5 pt-2 pb-[100px] flex flex-col gap-5 items-center justify-center">
        <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 18, stiffness: 200 }}
          className="text-6xl">{newPetEmoji}</motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }} className="text-center">
          <h2 className="text-[22px] font-medium mb-1" style={{ color: "var(--text-primary)" }}>来自米露的交接信</h2>
          <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>给新来的伙伴看的</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32 }} className="w-full">
          <GlassCard className="p-6" style={{ background: "rgba(246,231,168,0.35)" }}>
            <p className="text-[15px] leading-[1.75]" style={{ color: "var(--text-primary)" }}>
              嗨。<br/><br/>
              这位朋友最近在处理一些需要时间消化的事情，心情整体还不错，偶尔会有点累。<br/><br/>
              喜欢睡前说说话。有几件事放在信箱里还没处理完。<br/><br/>
              好好陪着她。<br/><br/>
              <span style={{ color: "var(--text-muted)" }}>— 米露</span>
            </p>
          </GlassCard>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="w-full">
          <PrimaryBtn onClick={onDone} full>认识新伙伴</PrimaryBtn>
        </motion.div>
      </div>
    </div>
  );
}
