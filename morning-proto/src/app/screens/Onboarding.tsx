/* Auto-split from App.tsx (codemod). */
import { Check } from "lucide-react";
import { PetPlaceholder, GlassCard, PrimaryBtn, GhostBtn, SafeHeader } from "../primitives";

// ═══════════════════════════════════════════════════════════════════════════
// SCREENS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Onboarding 1: Welcome ───────────────────────────────────────────────────

export function OnboardWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center justify-between h-full px-8 pb-12 pt-20">
      <div/>
      <div className="flex flex-col items-center gap-8">
        <PetPlaceholder size={168}/>
        <div className="text-center">
          <h1 className="text-[30px] font-medium mb-3 leading-tight tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
            思绪纷乱时，<br/>有个地方接住你
          </h1>
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Morning 是你的情感陪伴伙伴
          </p>
        </div>
      </div>
      <div className="w-full flex flex-col items-center gap-3">
        <PrimaryBtn onClick={onNext} full>认识一下</PrimaryBtn>
        <GhostBtn onClick={onNext}>已经了解，直接开始</GhostBtn>
      </div>
    </div>
  );
}

// ─── Onboarding 2: How ───────────────────────────────────────────────────────

export function OnboardHow({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const items = [
    { icon: "💬", title: "自然聊天",  desc: "随时找它说说话，它会静静地听，不催、不评判" },
    { icon: "🌙", title: "睡前清空",  desc: "把今天所有的念头一股脑倒出来，整理是它的事" },
    { icon: "📬", title: "内容托管",  desc: "它会在合适的时候送来值得的东西" },
  ];
  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack}/>
      <div className="flex-1 px-6 pt-2 flex flex-col justify-between pb-12">
        <div>
          <h2 className="text-[26px] font-medium mb-1.5 leading-tight tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
            陪伴的三种方式
          </h2>
          <p className="text-[15px] mb-7" style={{ color: "var(--text-secondary)" }}>不是工具，更像一个会等你回来的朋友</p>
          <div className="flex flex-col gap-3">
            {items.map((item, i) => (
              <GlassCard key={i} className="p-5 flex items-center gap-4">
                <div className="text-3xl">{item.icon}</div>
                <div>
                  <div className="text-[15px] font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>{item.title}</div>
                  <div className="text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>{item.desc}</div>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
        <PrimaryBtn onClick={onNext} full>选择你的伙伴</PrimaryBtn>
      </div>
    </div>
  );
}

// ─── Onboarding 3: Choose Pet ────────────────────────────────────────────────

export function OnboardPet({ onNext, onBack, selected, onSelect }: {
  onNext: () => void; onBack: () => void; selected: number; onSelect: (i: number) => void;
}) {
  const pets = [
    { name: "米露", trait: "温柔，善于倾听", desc: "喜欢在安静的傍晚陪你说话", emoji: "🌿" },
    { name: "晴晴", trait: "活泼，偶尔调皮", desc: "会在你沮丧时想办法让你笑一下", emoji: "☀️" },
    { name: "暮云", trait: "沉稳，有时神秘", desc: "话不多，但每句都刚好", emoji: "🌙" },
  ];
  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack}/>
      <div className="flex-1 px-6 pt-2 flex flex-col justify-between pb-12 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div>
          <h2 className="text-[26px] font-medium mb-1.5 leading-tight tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
            选择你的伙伴
          </h2>
          <p className="text-[15px] mb-6" style={{ color: "var(--text-secondary)" }}>之后随时可以更换，记忆会妥善交接</p>
          <div className="flex flex-col gap-3">
            {pets.map((pet, i) => (
              <GlassCard key={i} onClick={() => onSelect(i)} className="p-5 flex items-center gap-4"
                style={{
                  border: selected === i ? "1.5px solid rgba(196,149,58,0.5)" : "1px solid rgba(255,255,255,0.45)",
                  background: selected === i ? "rgba(246,231,168,0.42)" : "rgba(255,252,245,0.65)",
                }}>
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
                  style={{ background: "rgba(255,252,245,0.85)", border: "1px solid rgba(255,255,255,0.5)" }}>
                  {pet.emoji}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[16px] font-medium" style={{ color: "var(--text-primary)" }}>{pet.name}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(243,216,199,0.6)", color: "#655D61" }}>{pet.trait}</span>
                  </div>
                  <div className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{pet.desc}</div>
                </div>
                {selected === i && (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(196,149,58,0.8)" }}>
                    <Check size={11} style={{ color: "#fff" }}/>
                  </div>
                )}
              </GlassCard>
            ))}
          </div>
        </div>
        <PrimaryBtn onClick={onNext} full disabled={selected === -1}>就选它了</PrimaryBtn>
      </div>
    </div>
  );
}

// ─── Onboarding 4: Permission ─────────────────────────────────────────────────

export function OnboardPermission({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const items = [
    { icon: "🧠", title: "主动陪伴",    desc: "它会在合适的时刻主动出现，随时可以关闭" },
    { icon: "🔐", title: "记忆授权",    desc: "对话内容存在你的设备，可以随时查看和删除" },
    { icon: "🔕", title: "不会打扰你",  desc: "不依赖通知、连续签到或任何情感绑架" },
  ];
  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack}/>
      <div className="flex-1 px-6 pt-2 flex flex-col justify-between pb-12">
        <div>
          <h2 className="text-[26px] font-medium mb-1.5 leading-tight tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
            在开始之前
          </h2>
          <p className="text-[15px] mb-7" style={{ color: "var(--text-secondary)" }}>你一直掌握主动权</p>
          <div className="flex flex-col gap-3">
            {items.map((item, i) => (
              <GlassCard key={i} className="p-5 flex items-start gap-4">
                <div className="text-2xl mt-0.5">{item.icon}</div>
                <div>
                  <div className="text-[15px] font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>{item.title}</div>
                  <div className="text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>{item.desc}</div>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-center gap-3">
          <PrimaryBtn onClick={onNext} full>开始了</PrimaryBtn>
          <p className="text-[12px] text-center" style={{ color: "var(--text-muted)" }}>
            可以在「我的」里随时修改这些设置
          </p>
        </div>
      </div>
    </div>
  );
}
