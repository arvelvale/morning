/* Auto-split from App.tsx (codemod). */
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, ChevronLeft, Play } from "lucide-react";
import { type Screen } from "../theme";
import { CreamRipple, PrimaryBtn, SafeHeader } from "../primitives";
import { GRAIN } from "./Mailbox";

// ─── Scene ────────────────────────────────────────────────────────────────────

// ─── Scene Data ───────────────────────────────────────────────────────────────

export interface BuiltInScene {
  id: string; title: string; desc: string;
  relationships: string[]; bgGradient: string;
  ambientColor: string; ambientColor2: string;
}

export const BUILT_IN_SCENES: BuiltInScene[] = [
  {
    id: "night-call",
    title: "深夜通话",
    desc: "有些话，隔着一通电话才说得出口。",
    relationships: ["恋人","朋友","异地家人"],
    bgGradient: "linear-gradient(185deg,#261A10 0%,#3A2618 45%,#4D3828 75%,#5C4838 100%)",
    ambientColor: "rgba(255,148,48,0.18)",
    ambientColor2: "rgba(255,200,100,0.10)",
  },
  {
    id: "dinner-table",
    title: "家中餐桌",
    desc: "最难说出口的话，常常发生在最熟悉的地方。",
    relationships: ["父母","家庭","伴侣"],
    bgGradient: "linear-gradient(180deg,#F5ECD8 0%,#EDD9BE 45%,#E2C9A0 100%)",
    ambientColor: "rgba(255,195,60,0.38)",
    ambientColor2: "rgba(255,230,140,0.22)",
  },
  {
    id: "leaving-road",
    title: "离开的路上",
    desc: "有些告别，也许还来得及换一种说法。",
    relationships: ["恋人","朋友","同学","同事"],
    bgGradient: "linear-gradient(180deg,#E8D5C0 0%,#D9C09E 42%,#C8A882 72%,#B89878 100%)",
    ambientColor: "rgba(255,175,70,0.32)",
    ambientColor2: "rgba(240,200,130,0.18)",
  },
];

export interface TempCharacter {
  displayName: string; relationship: string; role: string;
  personalitySummary: string; speakingStyle: string;
  conflictResponse: string; currentAdjustment: string;
  traits: string[];
}

export type SceneSubState =
  | "browsing" | "capturing" | "reviewing"
  | "setup-who" | "setup-describe" | "setup-confirm";

// ─── Scene Portal (one carousel card) ────────────────────────────────────────

export function ScenePortal({ scene, isActive, onEnter }: {
  scene: BuiltInScene; isActive: boolean; onEnter: () => void;
}) {
  return (
    <motion.div
      animate={{ scale: isActive ? 1 : 0.93, opacity: isActive ? 1 : 0.72 }}
      transition={{ type: "spring", damping: 28, stiffness: 260 }}
      className="flex-shrink-0 rounded-[30px] overflow-hidden relative cursor-pointer"
      style={{ width: 310, height: 390 }}
      onClick={isActive ? onEnter : undefined}>
      {/* Background */}
      <div className="absolute inset-0" style={{ background: scene.bgGradient }}/>
      {/* Ambient glow */}
      <div className="absolute inset-0" style={{
        background: `radial-gradient(ellipse at 45% 38%,${scene.ambientColor} 0%,transparent 58%)`
      }}/>
      <div className="absolute inset-0" style={{
        background: `radial-gradient(ellipse at 72% 72%,${scene.ambientColor2} 0%,transparent 52%)`
      }}/>
      {/* Grain */}
      <div className="absolute inset-0" style={{ backgroundImage: GRAIN, opacity: 0.7 }}/>
      {/* Top label */}
      <div className="absolute top-5 left-5">
        <span className="text-[10px] px-2.5 py-1 rounded-full font-medium"
          style={{ background: "rgba(255,255,255,0.18)", backdropFilter: "blur(12px)",
            color: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.2)" }}>
          内置场景
        </span>
      </div>
      {/* Bottom gradient + content */}
      <div className="absolute bottom-0 left-0 right-0 px-5 pb-5 pt-20"
        style={{ background: "linear-gradient(to top, rgba(30,20,12,0.72) 0%, transparent 100%)" }}>
        <div className="text-[11px] mb-2" style={{ color: "rgba(255,255,255,0.55)" }}>
          {scene.relationships.join(" · ")}
        </div>
        <h3 className="text-[22px] font-medium mb-1 leading-tight"
          style={{ color: "rgba(255,255,255,0.95)" }}>{scene.title}</h3>
        <p className="text-[13px] leading-snug mb-4"
          style={{ color: "rgba(255,255,255,0.65)" }}>{scene.desc}</p>
        {isActive && (
          <button onClick={e => { e.stopPropagation(); onEnter(); }}
            className="px-5 py-2.5 rounded-full text-[13px] font-medium active:scale-[0.96] transition-transform"
            style={{ background: "rgba(255,252,245,0.2)", backdropFilter: "blur(16px)",
              color: "rgba(255,255,255,0.92)", border: "1.5px solid rgba(255,255,255,0.32)" }}>
            进入场景
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Voice Create Entry ───────────────────────────────────────────────────────

export function CreateSceneEntry({ onStart }: { onStart: () => void }) {
  const [pulsing, setPulsing] = useState(false);
  return (
    <div className="mx-0 mt-8 mb-4">
      <div className="text-center mb-6">
        <h3 className="text-[16px] font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>
          描述一个你想进入的场景
        </h3>
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          你来说发生了什么，我们替你搭好片场。
        </p>
      </div>
      {/* Voice button with glow rings */}
      <div className="flex flex-col items-center gap-5">
        <div className="relative flex items-center justify-center" style={{ width: 88, height: 88 }}>
          <div className="absolute rounded-full" style={{
            width: 88, height: 88,
            background: "rgba(246,231,168,0.18)",
            animation: "scenePulse 2.8s ease-in-out infinite",
          }}/>
          <div className="absolute rounded-full" style={{
            width: 72, height: 72,
            background: "rgba(243,216,199,0.22)",
            animation: "scenePulse 2.8s ease-in-out infinite 0.6s",
          }}/>
          <motion.button
            onClick={() => { setPulsing(true); onStart(); }}
            whileTap={{ scale: 0.93 }}
            className="relative z-10 flex items-center justify-center rounded-full"
            style={{
              width: 56, height: 56,
              background: "rgba(255,252,245,0.82)",
              backdropFilter: "blur(20px)",
              border: "1.5px solid rgba(255,255,255,0.6)",
              boxShadow: "0 8px 32px rgba(196,149,58,0.18)",
            }}>
            <Mic size={20} style={{ color: "#C4953A" }}/>
          </motion.button>
        </div>
        <button onClick={onStart}
          className="text-[12px] active:opacity-60" style={{ color: "var(--text-muted)" }}>
          用文字描述
        </button>
      </div>
      <style>{`
        @keyframes scenePulse {
          0%,100%{transform:scale(1);opacity:0.7}
          50%{transform:scale(1.12);opacity:0.35}
        }
      `}</style>
    </div>
  );
}

// ─── Scene Narration Capture ──────────────────────────────────────────────────

export function SceneNarrationCapture({ onBack, onConfirm }: {
  onBack: () => void;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const placeholder = "我想回到上周和朋友吵架之后。地点在学校门口，她准备打车离开。她平时比较敏感，生气后会假装不在意，但其实很希望我先道歉。我想试着把她叫住。";
  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack} title="描述你的场景"/>
      <div className="flex-1 px-5 pb-6 flex flex-col gap-5 overflow-y-auto" style={{ scrollbarWidth:"none" }}>
        <div>
          <p className="text-[16px] font-medium mb-1.5" style={{ color:"var(--text-primary)" }}>
            说说你在哪里、谁在你面前，以及发生了什么。
          </p>
          <p className="text-[13px]" style={{ color:"var(--text-muted)" }}>
            不用分段，像说话一样讲就好。
          </p>
        </div>
        <div className="flex-1 relative">
          <textarea
            value={text} onChange={e => setText(e.target.value)}
            placeholder={placeholder} rows={8}
            className="w-full h-full px-5 py-4 rounded-[20px] outline-none text-[14px] leading-relaxed resize-none"
            style={{
              background:"rgba(255,252,245,0.65)", backdropFilter:"blur(20px)",
              border:"1px solid rgba(255,255,255,0.45)", color:"#484145",
              minHeight: 200,
            }}
          />
        </div>
        {/* Voice button */}
        <div className="flex flex-col items-center gap-3">
          <motion.button
            onTouchStart={() => setIsRecording(true)} onTouchEnd={() => setIsRecording(false)}
            onClick={() => setIsRecording(v => !v)}
            animate={isRecording ? { scale: [1,1.06,1], transition:{ repeat:Infinity, duration:1.1 }} : { scale:1 }}
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: isRecording ? "rgba(243,216,199,0.88)" : "rgba(246,231,168,0.72)",
              border: `2px solid ${isRecording ? "rgba(196,149,58,0.55)" : "rgba(255,255,255,0.55)"}`,
              boxShadow: isRecording ? "0 0 0 8px rgba(246,231,168,0.2)" : "none",
            }}>
            <Mic size={22} style={{ color: "#C4953A" }}/>
          </motion.button>
          <span className="text-[12px]" style={{ color:"var(--text-muted)" }}>
            {isRecording ? "松开结束录音" : "按住说话"}
          </span>
        </div>
        <PrimaryBtn onClick={() => onConfirm(text || placeholder)} full disabled={!text.trim() && false}>
          我说完了
        </PrimaryBtn>
      </div>
    </div>
  );
}

// ─── Scene Summary Preview ────────────────────────────────────────────────────

export function SceneSummaryPreview({ onBack, onConfirm }: {
  onBack: () => void; onConfirm: () => void;
}) {
  const items = [
    { label:"地点", value:"学校门口" },
    { label:"人物", value:"朋友" },
    { label:"对方当前行动", value:"准备打车离开" },
    { label:"对方性格", value:"敏感、表面冷淡、希望对方先行动" },
    { label:"你想尝试", value:"叫住她并道歉" },
  ];
  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack} title="场景整理"/>
      <div className="flex-1 px-5 pb-6 flex flex-col gap-5 overflow-y-auto" style={{ scrollbarWidth:"none" }}>
        <div>
          <p className="text-[17px] font-medium mb-1" style={{ color:"var(--text-primary)" }}>我整理了一下</p>
          <p className="text-[13px]" style={{ color:"var(--text-muted)" }}>有不准确的地方可以告诉我。</p>
        </div>
        <div className="rounded-[20px] overflow-hidden"
          style={{ background:"rgba(255,252,245,0.72)", backdropFilter:"blur(20px)",
            border:"1px solid rgba(255,255,255,0.45)" }}>
          {items.map((item, i) => (
            <div key={i} className={`flex gap-3 px-5 py-3.5 ${i < items.length-1 ? "border-b" : ""}`}
              style={{ borderColor:"rgba(91,79,62,0.06)" }}>
              <span className="text-[12px] flex-shrink-0 pt-0.5 w-24" style={{ color:"var(--text-muted)" }}>{item.label}</span>
              <span className="text-[14px] flex-1 leading-snug" style={{ color:"var(--text-primary)" }}>{item.value}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 mt-auto">
          <PrimaryBtn onClick={onConfirm} full>就是这样，继续</PrimaryBtn>
          <button onClick={onBack}
            className="w-full py-3 text-[13px] active:opacity-60" style={{ color:"var(--text-muted)" }}>
            有些地方不对，我重新说
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Character Setup Sheet ────────────────────────────────────────────────────

export function CharacterSetupSheet({ scene, onBack, onReady }: {
  scene: BuiltInScene | null; onBack: () => void;
  onReady: (char: TempCharacter) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [rel, setRel] = useState(scene?.relationships[0] ?? "");
  const [desc, setDesc] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [adjusted, setAdjusted] = useState("");
  const [entryRipple, setEntryRipple] = useState(false);

  const mockTraits = [
    `说话${scene?.id === "dinner-table" ? "直接，语气偏强势" : "温柔，但习惯绕弯"}`,
    "关心你，但不擅长直接表达",
    "遇到冲突时容易先防御",
    "很少主动承认自己说重了",
    "担心常常表现为批评",
  ];

  const finalChar: TempCharacter = {
    displayName: name || "她", relationship: rel, role: rel,
    personalitySummary: desc, speakingStyle: "温和，偶尔强势",
    conflictResponse: "先防御，再沉默",
    currentAdjustment: adjusted, traits: mockTraits,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Blurred scene background */}
      <div className="absolute inset-0" style={{
        background: scene?.bgGradient ?? "linear-gradient(180deg,#F2E8D5,#E8D9C0)",
        filter: "blur(8px) brightness(1.08)", transform: "scale(1.05)",
      }}/>
      <div className="absolute inset-0" style={{ background:"rgba(255,251,243,0.55)", backdropFilter:"blur(8px)" }}/>

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center px-5 pt-[52px] pb-4">
          <button onClick={onBack}
            className="w-8 h-8 flex items-center justify-center rounded-full active:opacity-60"
            style={{ background:"rgba(255,252,245,0.65)", border:"1px solid rgba(255,255,255,0.45)" }}>
            <ChevronLeft size={16} style={{ color:"var(--text-secondary)" }}/>
          </button>
          <div className="flex-1 flex justify-center gap-1.5">
            {[0,1,2].map(i => (
              <div key={i} className="h-1 w-8 rounded-full transition-all duration-200"
                style={{ background: i <= step ? "rgba(196,149,58,0.65)" : "rgba(91,79,62,0.12)" }}/>
            ))}
          </div>
          <div className="w-8"/>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6" style={{ scrollbarWidth:"none" }}>
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
              exit={{ opacity:0, y:-8 }} transition={{ duration:0.2 }} className="flex flex-col gap-5">

              {step === 0 && (
                <>
                  <div>
                    <h2 className="text-[20px] font-medium mb-1.5" style={{ color:"var(--text-primary)" }}>
                      这个场景里，谁在你面前？
                    </h2>
                    <p className="text-[13px]" style={{ color:"var(--text-muted)" }}>不需要真实姓名，用你习惯的称呼。</p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <input value={name} onChange={e => setName(e.target.value)}
                      placeholder="比如：妈妈、她、老朋友…"
                      className="w-full px-5 py-4 rounded-[20px] outline-none text-[15px]"
                      style={{ background:"rgba(255,252,245,0.72)", backdropFilter:"blur(20px)",
                        border:"1px solid rgba(255,255,255,0.5)", color:"#484145" }}
                    />
                    <div>
                      <p className="text-[12px] mb-2 px-1" style={{ color:"var(--text-muted)" }}>关系</p>
                      <div className="flex flex-wrap gap-2">
                        {(scene?.relationships ?? ["朋友","家人","恋人","同事"]).map(r => (
                          <button key={r} onClick={() => setRel(r)}
                            className="px-4 py-2 rounded-full text-[13px] transition-all active:scale-[0.96]"
                            style={{
                              background: rel===r ? "rgba(246,231,168,0.88)" : "rgba(255,252,245,0.65)",
                              color:"var(--text-primary)",
                              border: rel===r ? "1.5px solid rgba(196,149,58,0.45)" : "1px solid rgba(255,255,255,0.45)",
                            }}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <PrimaryBtn onClick={() => setStep(1)} full disabled={!rel}>继续</PrimaryBtn>
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <div>
                    <h2 className="text-[20px] font-medium mb-1.5" style={{ color:"var(--text-primary)" }}>
                      像向一个没见过 TA 的朋友那样，介绍一下 TA。
                    </h2>
                    <p className="text-[13px]" style={{ color:"var(--text-muted)" }}>
                      TA 平时怎么说话？遇到冲突时会怎样？有什么话总是不愿意直接说？
                    </p>
                  </div>
                  <textarea value={desc} onChange={e => setDesc(e.target.value)}
                    placeholder={`比如：${name||"她"}平时说话比较直，不太表达关心，但其实很在意我…`}
                    rows={5}
                    className="w-full px-5 py-4 rounded-[20px] outline-none text-[14px] leading-relaxed resize-none"
                    style={{ background:"rgba(255,252,245,0.72)", backdropFilter:"blur(20px)",
                      border:"1px solid rgba(255,255,255,0.5)", color:"#484145" }}
                  />
                  <div className="flex flex-col items-center gap-2">
                    <motion.button
                      onClick={() => setIsRecording(v => !v)}
                      animate={isRecording ? { scale:[1,1.05,1], transition:{ repeat:Infinity, duration:1.2 }} : { scale:1 }}
                      className="w-14 h-14 rounded-full flex items-center justify-center"
                      style={{
                        background: isRecording ? "rgba(243,216,199,0.88)" : "rgba(246,231,168,0.72)",
                        border:`2px solid ${isRecording ? "rgba(196,149,58,0.55)" : "rgba(255,255,255,0.55)"}`,
                      }}>
                      <Mic size={18} style={{ color:"#C4953A" }}/>
                    </motion.button>
                    <span className="text-[11px]" style={{ color:"var(--text-muted)" }}>
                      {isRecording ? "松开结束" : "也可以说"}
                    </span>
                  </div>
                  <PrimaryBtn onClick={() => setStep(2)} full>整理一下</PrimaryBtn>
                </>
              )}

              {step === 2 && (
                <>
                  <div>
                    <p className="text-[13px] mb-0.5" style={{ color:"var(--text-muted)" }}>根据你说的，</p>
                    <h2 className="text-[20px] font-medium" style={{ color:"var(--text-primary)" }}>
                      {name || "TA"}，在这场对话中：
                    </h2>
                  </div>
                  <div className="rounded-[20px] overflow-hidden"
                    style={{ background:"rgba(255,252,245,0.78)", backdropFilter:"blur(20px)",
                      border:"1px solid rgba(255,255,255,0.5)" }}>
                    {mockTraits.map((trait, i) => (
                      <div key={i} className={`flex items-start gap-3 px-5 py-3 ${i < mockTraits.length-1 ? "border-b" : ""}`}
                        style={{ borderColor:"rgba(91,79,62,0.06)" }}>
                        <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                          style={{ background:"rgba(196,149,58,0.55)" }}/>
                        <span className="text-[14px] leading-snug" style={{ color:"var(--text-primary)" }}>{trait}</span>
                      </div>
                    ))}
                  </div>
                  {/* Adjust input */}
                  <div>
                    <input value={adjusted} onChange={e => setAdjusted(e.target.value)}
                      placeholder="有一点不像？补充一句…"
                      className="w-full px-5 py-3.5 rounded-[16px] outline-none text-[14px]"
                      style={{ background:"rgba(255,252,245,0.65)", backdropFilter:"blur(16px)",
                        border:"1px solid rgba(255,255,255,0.45)", color:"#484145" }}
                    />
                    <p className="text-[11px] mt-3 text-center" style={{ color:"var(--text-muted)" }}>
                      人物设定仅用于本次场景，离开后会清除。
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 mt-2">
                    <div className="relative overflow-hidden rounded-full">
                      <CreamRipple active={entryRipple}/>
                      <PrimaryBtn onClick={() => {
                        setEntryRipple(true);
                        setTimeout(() => { setEntryRipple(false); onReady(finalChar); }, 380);
                      }} full>就是这样的，进入场景</PrimaryBtn>
                    </div>
                    <button onClick={() => setStep(1)}
                      className="w-full py-3 text-[13px] active:opacity-60" style={{ color:"var(--text-muted)" }}>
                      有一点不像，重新描述
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ─── Scene Screen (Home) ──────────────────────────────────────────────────────

export function SceneScreen({ onCreate, onPlay }: { onCreate: () => void; onPlay: () => void }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [subState, setSubState] = useState<SceneSubState>("browsing");
  const [selectedScene, setSelectedScene] = useState<BuiltInScene | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSelectScene = (scene: BuiltInScene) => {
    setSelectedScene(scene);
    setSubState("setup-who");
  };
  const handleVoiceStart = () => setSubState("capturing");
  const handleNarrationConfirm = () => setSubState("reviewing");
  const handleSummaryConfirm = () => setSubState("setup-who");
  const handleCharReady = () => onPlay();
  const handleBack = () => {
    if (subState === "capturing") setSubState("browsing");
    else if (subState === "reviewing") setSubState("capturing");
    else if (subState === "setup-who") setSubState(selectedScene ? "browsing" : "reviewing");
    else setSubState("browsing");
  };

  if (subState === "capturing") {
    return <SceneNarrationCapture onBack={handleBack} onConfirm={handleNarrationConfirm}/>;
  }
  if (subState === "reviewing") {
    return <SceneSummaryPreview onBack={handleBack} onConfirm={handleSummaryConfirm}/>;
  }
  if (subState === "setup-who" || subState === "setup-describe" || subState === "setup-confirm") {
    return <CharacterSetupSheet scene={selectedScene} onBack={handleBack} onReady={handleCharReady}/>;
  }

  // ── Browsing ──
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-[52px] pb-4 flex-shrink-0">
        <h1 className="text-[26px] font-medium tracking-[-0.02em]" style={{ color:"var(--text-primary)" }}>片场</h1>
        <p className="text-[13px] mt-1" style={{ color:"var(--text-muted)" }}>
          进入一个场景，试着说出不同的话。
        </p>
      </div>

      {/* Carousel */}
      <div className="flex-shrink-0 relative" style={{ height: 420 }}>
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto h-full items-center"
          style={{ scrollbarWidth:"none", scrollSnapType:"x mandatory",
            paddingLeft: 24, paddingRight: 24 }}
          onScroll={e => {
            const el = e.currentTarget;
            const idx = Math.round(el.scrollLeft / 326);
            setActiveIdx(Math.max(0, Math.min(idx, BUILT_IN_SCENES.length-1)));
          }}>
          {BUILT_IN_SCENES.map((scene, i) => (
            <div key={scene.id} style={{ scrollSnapAlign:"center", flexShrink:0 }}>
              <ScenePortal
                scene={scene}
                isActive={activeIdx === i}
                onEnter={() => handleSelectScene(scene)}
              />
            </div>
          ))}
        </div>
        {/* Dot indicators */}
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
          {BUILT_IN_SCENES.map((_, i) => (
            <div key={i} className="rounded-full transition-all duration-200"
              style={{
                width: activeIdx===i ? 16 : 6, height: 6,
                background: activeIdx===i ? "rgba(196,149,58,0.7)" : "rgba(196,149,58,0.25)",
              }}/>
          ))}
        </div>
      </div>

      {/* Voice create entry + scroll */}
      <div className="flex-1 overflow-y-auto px-5 pb-[100px]" style={{ scrollbarWidth:"none" }}>
        <div className="h-px my-6" style={{ background:"rgba(91,79,62,0.08)" }}/>
        <CreateSceneEntry onStart={handleVoiceStart}/>
      </div>
    </div>
  );
}

// ─── Scene Create (unused shell kept for navigation type compat) ──────────────

export function SceneCreate({ onBack, onReady }: { onBack: () => void; onReady: () => void }) {
  const [step, setStep] = useState(0);
  const [who, setWho]   = useState("");
  const [where, setWhere] = useState("");
  const [what, setWhat] = useState("");
  const [intent, setIntent] = useState("");

  const stepLabels = ["人物", "地点", "经过", "想尝试"];
  const choices = [
    "说出当时没说的话",
    "尝试另一种回应方式",
    "只是重新经历一次",
  ];

  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack}/>
      <div className="flex-1 px-5 pb-[100px] flex flex-col">
        <div className="flex gap-2 mb-6">
          {stepLabels.map((s, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="h-1 w-full rounded-full"
                style={{ background: i <= step ? "rgba(196,149,58,0.65)" : "rgba(91,79,62,0.1)" }}/>
              <span className="text-[11px]" style={{ color: i === step ? "#847D72" : "#C0B5A8" }}>{s}</span>
            </div>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}
            className="flex-1 flex flex-col gap-4">
            {step === 0 && (
              <>
                <h2 className="text-[22px] font-medium" style={{ color: "var(--text-primary)" }}>涉及到谁？</h2>
                <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>不需要真实姓名，用你习惯的称呼</p>
                <input value={who} onChange={e => setWho(e.target.value)}
                  placeholder="比如：妈妈、老朋友、前同事…"
                  className="w-full px-5 py-4 rounded-[20px] outline-none text-[15px]"
                  style={{ background: "rgba(255,252,245,0.65)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.45)", color: "#484145" }}
                />
              </>
            )}
            {step === 1 && (
              <>
                <h2 className="text-[22px] font-medium" style={{ color: "var(--text-primary)" }}>在哪里？</h2>
                <input value={where} onChange={e => setWhere(e.target.value)}
                  placeholder="咖啡厅、家里、电话里…"
                  className="w-full px-5 py-4 rounded-[20px] outline-none text-[15px]"
                  style={{ background: "rgba(255,252,245,0.65)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.45)", color: "#484145" }}
                />
              </>
            )}
            {step === 2 && (
              <>
                <h2 className="text-[22px] font-medium" style={{ color: "var(--text-primary)" }}>简单说说经过</h2>
                <textarea value={what} onChange={e => setWhat(e.target.value)}
                  placeholder="发生了什么，或者你当时是什么感受…" rows={5}
                  className="w-full px-5 py-4 rounded-[20px] outline-none text-[15px] resize-none leading-relaxed"
                  style={{ background: "rgba(255,252,245,0.65)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.45)", color: "#484145" }}
                />
              </>
            )}
            {step === 3 && (
              <>
                <h2 className="text-[22px] font-medium" style={{ color: "var(--text-primary)" }}>你想尝试什么？</h2>
                <div className="flex flex-col gap-2">
                  {choices.map((c, i) => (
                    <button key={i} onClick={() => setIntent(c)}
                      className="w-full p-4 rounded-[20px] text-left text-[15px] leading-snug transition-all duration-100 active:scale-[0.97]"
                      style={{
                        background: intent === c ? "rgba(246,231,168,0.55)" : "rgba(255,252,245,0.65)",
                        border: intent === c ? "1.5px solid rgba(196,149,58,0.45)" : "1px solid rgba(255,255,255,0.45)",
                        color: "var(--text-primary)",
                        backdropFilter: "blur(20px)",
                      }}>
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="pt-4">
          {step < 3
            ? <PrimaryBtn onClick={() => setStep(s => s + 1)} full>继续</PrimaryBtn>
            : <PrimaryBtn onClick={onReady} full disabled={!intent}>准备好了</PrimaryBtn>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Character Artwork Placeholder ───────────────────────────────────────────

export function CharacterArtwork({ name, isSpeaking, isListening }: {
  name: string; isSpeaking: boolean; isListening: boolean;
}) {
  return (
    <motion.div
      animate={isSpeaking
        ? { y: [0, -4, 0], transition: { repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
        : isListening
          ? { y: [0, -2, 0], transition: { repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
          : { y: 0 }}
      className="relative flex flex-col items-center">
      {/* Soft glow behind figure */}
      <div className="absolute" style={{
        width: 140, height: 200, top: -20, left: "50%", transform: "translateX(-50%)",
        background: "radial-gradient(ellipse,rgba(255,240,200,0.32) 0%,transparent 70%)",
        pointerEvents: "none",
      }}/>
      {/* Abstract figure */}
      <div className="relative" style={{ width: 110, height: 155 }}>
        {/* Head */}
        <div className="absolute rounded-full" style={{
          width: 58, height: 58, top: 0, left: "50%", transform: "translateX(-50%)",
          background: "linear-gradient(145deg,rgba(255,245,225,0.85),rgba(240,225,200,0.75))",
          backdropFilter: "blur(8px)",
          border: "1.5px solid rgba(255,255,255,0.45)",
          boxShadow: "0 6px 20px rgba(121,100,72,0.14)",
        }}>
          {/* Minimal face dots */}
          <div className="absolute" style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(91,79,62,0.28)", top: 20, left: 15 }}/>
          <div className="absolute" style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(91,79,62,0.28)", top: 20, right: 15 }}/>
          {/* Mouth — subtle */}
          <div className="absolute" style={{
            width: 16, height: 4, bottom: 13, left: "50%", transform: "translateX(-50%)",
            borderBottom: `2px solid rgba(91,79,62,${isSpeaking ? "0.42" : "0.22"})`,
            borderRadius: "0 0 8px 8px",
          }}/>
        </div>
        {/* Body */}
        <div className="absolute rounded-[28px]" style={{
          width: 80, height: 85, top: 62, left: "50%", transform: "translateX(-50%)",
          background: "linear-gradient(160deg,rgba(255,245,230,0.72),rgba(240,225,205,0.62))",
          backdropFilter: "blur(8px)",
          border: "1.5px solid rgba(255,255,255,0.4)",
          boxShadow: "0 8px 24px rgba(121,100,72,0.10)",
        }}>
          {/* Breathing animation */}
          <motion.div
            animate={{ scaleY: [1, 1.02, 1] }}
            transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}
            className="absolute inset-0 rounded-[28px]"
            style={{ background: "rgba(255,255,255,0.08)" }}
          />
        </div>
      </div>
      {/* Name tag */}
      <div className="mt-3 px-4 py-1.5 rounded-full text-[13px] font-medium"
        style={{
          background: "rgba(255,252,245,0.55)", backdropFilter: "blur(12px)",
          color: "rgba(255,255,255,0.88)", border: "1px solid rgba(255,255,255,0.28)",
          textShadow: "0 1px 4px rgba(0,0,0,0.18)",
        }}>
        {name}
        {isSpeaking && <span className="ml-1.5 text-[10px]" style={{ color:"rgba(255,200,100,0.9)" }}>●</span>}
      </div>
    </motion.div>
  );
}

// ─── Scene Play ───────────────────────────────────────────────────────────────

export function ScenePlay({ onEnd }: { onEnd: () => void }) {
  const [phase, setPhase]         = useState<"intro"|"playing"|"paused">("intro");
  const [dlgIdx, setDlgIdx]       = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [adjustInput, setAdjustInput] = useState("");
  const [showAdjust, setShowAdjust] = useState(false);

  const charName = "妈妈";
  const sceneName = "家中餐桌";

  const dialogs = [
    { from:"char", text:"你最近怎么了？感觉你一直很忙，也不怎么联系家里…" },
    { from:"user-prompt", text:"你想说什么？" },
    { from:"char", text:"我就是担心你。你一个人在外面，遇到事情了也不跟我说。" },
  ];

  const curr = dlgIdx < dialogs.length ? dialogs[dlgIdx] : dialogs[dialogs.length-1];

  const handleUserSpeak = () => {
    setIsListening(v => !v);
    if (isListening) {
      setTimeout(() => {
        setIsListening(false);
        setIsSpeaking(true);
        setDlgIdx(i => Math.min(i+1, dialogs.length-1));
        setTimeout(() => setIsSpeaking(false), 2800);
      }, 800);
    }
  };

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Scene background */}
      <div className="absolute inset-0" style={{
        background: "linear-gradient(180deg,#EDD9BE 0%,#E2C9A0 50%,#D8BA8A 100%)",
      }}>
        {/* Warm lamp glow */}
        <div className="absolute" style={{
          width: 280, height: 280, top: 60, left: "50%", transform: "translateX(-50%)",
          background: "radial-gradient(ellipse,rgba(255,195,60,0.38) 0%,transparent 65%)",
          animation: "lampFlicker 4s ease-in-out infinite",
        }}/>
        {/* Steam particles */}
        <div className="absolute" style={{ bottom: 220, left: "42%", opacity:0.4,
          animation: "steamRise 3.5s ease-in-out infinite" }}>
          <div style={{ width:3, height:18, borderRadius:2,
            background:"rgba(255,255,255,0.5)", filter:"blur(2px)" }}/>
        </div>
        <div className="absolute" style={{ bottom: 210, left: "52%", opacity:0.3,
          animation: "steamRise 3.5s ease-in-out infinite 1.2s" }}>
          <div style={{ width:2, height:14, borderRadius:2,
            background:"rgba(255,255,255,0.45)", filter:"blur(2px)" }}/>
        </div>
        <div className="absolute inset-0" style={{ backgroundImage: GRAIN, opacity:0.55 }}/>
      </div>

      <style>{`
        @keyframes lampFlicker{0%,100%{opacity:1}50%{opacity:0.82}}
        @keyframes steamRise{0%{transform:translateY(0) scaleX(1);opacity:0.4}
          50%{transform:translateY(-24px) scaleX(1.4);opacity:0.2}
          100%{transform:translateY(-42px) scaleX(0.7);opacity:0}}
      `}</style>

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-[52px] pb-4">
        <button onClick={() => setPhase(phase === "paused" ? "playing" : "paused")}
          className="px-3.5 py-2 rounded-full text-[13px] active:opacity-70 flex items-center gap-1.5"
          style={{ background:"rgba(255,252,245,0.28)", backdropFilter:"blur(16px)",
            border:"1px solid rgba(255,255,255,0.38)", color:"rgba(255,255,255,0.82)" }}>
          {phase==="paused" ? <Play size={12}/> : <span style={{fontSize:10}}>⏸</span>}
          {phase==="paused" ? "继续" : "暂停"}
        </button>
        <div className="text-center">
          <div className="text-[13px] font-medium" style={{ color:"rgba(255,255,255,0.9)" }}>{sceneName}</div>
          <div className="text-[11px]" style={{ color:"rgba(255,255,255,0.55)" }}>{charName}</div>
        </div>
        <button onClick={onEnd}
          className="px-3.5 py-2 rounded-full text-[13px] active:opacity-70"
          style={{ background:"rgba(255,252,245,0.22)", backdropFilter:"blur(16px)",
            border:"1px solid rgba(255,255,255,0.35)", color:"rgba(255,255,255,0.72)" }}>
          离开
        </button>
      </div>

      {/* Character in center */}
      <div className="relative z-10 flex-1 flex items-center justify-center pb-4">
        <CharacterArtwork name={charName} isSpeaking={isSpeaking} isListening={isListening}/>
      </div>

      {/* Subtitle + controls panel */}
      <div className="relative z-10 mx-3 mb-4 rounded-[28px] overflow-hidden"
        style={{ background:"rgba(255,252,245,0.88)", backdropFilter:"blur(36px)",
          WebkitBackdropFilter:"blur(36px)", border:"1px solid rgba(255,255,255,0.55)",
          boxShadow:"0 -8px 32px rgba(121,100,72,0.08)" }}>

        {/* Intro phase */}
        <AnimatePresence>
          {phase === "intro" && (
            <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-6 }}
              className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <span style={{ fontSize:14 }}>🌿</span>
                <span className="text-[12px]" style={{ color:"var(--text-muted)" }}>米露</span>
              </div>
              <p className="text-[14px] leading-relaxed mb-4" style={{ color:"var(--text-primary)" }}>
                场景准备好了。你可以随时离开，这里没有对错。
              </p>
              <button onClick={() => { setPhase("playing"); setIsSpeaking(true); setTimeout(()=>setIsSpeaking(false),2400); }}
                className="w-full py-3 rounded-full text-[14px] font-medium active:scale-[0.97] transition-transform"
                style={{ background:"rgba(246,231,168,0.82)", color:"#4D4249" }}>
                好的，开始
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Playing phase */}
        {phase === "playing" && (
          <div>
            {/* Subtitle */}
            <AnimatePresence mode="wait">
              <motion.div key={dlgIdx} initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}
                exit={{ opacity:0 }} transition={{ duration:0.18 }}
                className="px-5 pt-4 pb-2">
                {curr.from === "char" && (
                  <>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-[12px] font-medium" style={{ color:"#C4953A" }}>{charName}</span>
                      {isSpeaking && (
                        <div className="flex gap-0.5 items-end h-3">
                          {[1,2,3].map(j => (
                            <motion.div key={j}
                              animate={{ height:[4,10,4], transition:{repeat:Infinity, duration:0.6, delay:j*0.15}}}
                              style={{ width:2, background:"rgba(196,149,58,0.6)", borderRadius:1 }}/>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-[15px] leading-relaxed" style={{ color:"var(--text-primary)" }}>{curr.text}</p>
                  </>
                )}
                {curr.from === "user-prompt" && (
                  <p className="text-[13px] text-center py-1" style={{ color:"var(--text-muted)" }}>
                    轻点麦克风，说出你想说的话
                  </p>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Voice control row */}
            <div className="flex items-center justify-between px-5 pb-4 pt-2 gap-4">
              <button
                className="flex-1 py-2.5 rounded-full text-[12px] active:scale-[0.97] transition-transform"
                style={{ background:"rgba(246,231,168,0.55)", color:"#4D4249", border:"1px solid rgba(255,255,255,0.45)" }}
                onClick={() => setDlgIdx(i => Math.min(i+1, dialogs.length-1))}>
                换一种说法
              </button>

              {/* Main mic button */}
              <motion.button
                onTouchStart={() => setIsListening(true)} onTouchEnd={handleUserSpeak}
                onClick={handleUserSpeak}
                animate={isListening ? { scale:[1,1.08,1.04], transition:{repeat:Infinity, duration:0.9}} : { scale:1 }}
                className="flex-shrink-0 flex items-center justify-center rounded-full"
                style={{
                  width: 58, height: 58,
                  background: isListening ? "rgba(243,216,199,0.95)" : "rgba(246,231,168,0.88)",
                  border:`2px solid ${isListening ? "rgba(196,149,58,0.65)" : "rgba(255,255,255,0.55)"}`,
                  boxShadow: isListening ? "0 0 0 8px rgba(246,231,168,0.22)" : "0 4px 16px rgba(196,149,58,0.18)",
                }}>
                <Mic size={22} style={{ color:"#C4953A" }}/>
              </motion.button>

              <button onClick={onEnd}
                className="flex-1 py-2.5 rounded-full text-[12px] active:scale-[0.97] transition-transform"
                style={{ background:"rgba(255,252,245,0.65)", color:"#655D61", border:"1px solid rgba(255,255,255,0.45)" }}>
                离开场景
              </button>
            </div>
          </div>
        )}

        {/* Paused phase */}
        {phase === "paused" && (
          <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} className="p-5">
            <p className="text-[14px] font-medium mb-4" style={{ color:"var(--text-primary)" }}>已暂停</p>
            {!showAdjust ? (
              <div className="flex flex-col gap-2">
                <button onClick={() => setPhase("playing")}
                  className="w-full py-3 rounded-full text-[14px] font-medium active:scale-[0.97] transition-transform"
                  style={{ background:"rgba(246,231,168,0.82)", color:"#4D4249" }}>
                  继续场景
                </button>
                <button onClick={() => setShowAdjust(true)}
                  className="w-full py-3 rounded-full text-[14px] active:scale-[0.97] transition-transform"
                  style={{ background:"rgba(255,252,245,0.65)", color:"#655D61",
                    border:"1px solid rgba(255,255,255,0.45)" }}>
                  TA 不太像
                </button>
                <button onClick={onEnd}
                  className="w-full py-2.5 text-[13px] active:opacity-60" style={{ color:"var(--text-muted)" }}>
                  离开场景
                </button>
              </div>
            ) : (
              <motion.div initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} className="flex flex-col gap-3">
                <p className="text-[13px]" style={{ color:"var(--text-secondary)" }}>
                  补充一句，比如"她不会这么快原谅我。"
                </p>
                <input value={adjustInput} onChange={e => setAdjustInput(e.target.value)}
                  placeholder="她其实更固执一点…"
                  className="w-full px-4 py-3 rounded-[16px] outline-none text-[14px]"
                  style={{ background:"rgba(255,252,245,0.72)", border:"1px solid rgba(255,255,255,0.45)",
                    color:"#484145" }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={() => setShowAdjust(false)}
                    className="flex-1 py-3 rounded-full text-[13px] active:opacity-60"
                    style={{ background:"rgba(255,252,245,0.65)", color:"#655D61" }}>取消</button>
                  <button onClick={() => { setShowAdjust(false); setAdjustInput(""); setPhase("playing"); }}
                    className="flex-1 py-3 rounded-full text-[13px] font-medium active:opacity-60"
                    style={{ background:"rgba(246,231,168,0.82)", color:"#4D4249" }}>
                    调整后继续
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─── Scene End ────────────────────────────────────────────────────────────────

export function SceneEnd({ onBack, onReplay }: { onBack: () => void; onReplay: () => void }) {
  const [saved, setSaved] = useState(false);
  const keyQuote = "我其实一直很在意。";

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      <div className="absolute inset-0" style={{
        background: "linear-gradient(180deg,#FFFBF3 0%,#F9EDD8 100%)",
      }}/>
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse at 50% 28%,rgba(246,231,168,0.38) 0%,transparent 60%)",
      }}/>

      <div className="relative z-10 flex flex-col h-full px-5">
        <div className="pt-[52px] pb-6">
          <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.1 }}>
            <p className="text-[13px] mb-1.5" style={{ color:"var(--text-muted)" }}>这一次，你说出了</p>
            <h2 className="text-[22px] font-medium leading-snug" style={{ color:"var(--text-primary)" }}>
              "{keyQuote}"
            </h2>
          </motion.div>
        </div>

        <div className="flex-1 flex flex-col gap-4 pb-10 overflow-y-auto" style={{ scrollbarWidth:"none" }}>
          <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.22 }}>
            <div className="rounded-[22px] p-5 relative overflow-hidden"
              style={{ background:"rgba(255,252,245,0.88)", backdropFilter:"blur(24px)",
                border:"1px solid rgba(255,255,255,0.55)", boxShadow:"0 8px 32px rgba(121,100,72,0.07)" }}>
              <div style={{ position:"absolute", inset:0, backgroundImage:GRAIN, opacity:0.45, pointerEvents:"none" }}/>
              <div className="relative z-10">
                <div className="text-[22px] leading-none mb-2"
                  style={{ color:"rgba(196,149,58,0.35)", fontFamily:"serif" }}>"</div>
                <p className="text-[17px] leading-relaxed font-medium" style={{ color:"var(--text-primary)" }}>{keyQuote}</p>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.36 }}>
            <div className="rounded-[18px] px-5 py-4"
              style={{ background:"rgba(246,231,168,0.32)", border:"1px solid rgba(255,255,255,0.45)" }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span style={{ fontSize:13 }}>🌿</span>
                <span className="text-[12px]" style={{ color:"var(--text-muted)" }}>米露</span>
              </div>
              <p className="text-[14px] leading-relaxed" style={{ color:"var(--text-secondary)" }}>
                这里没有答案，也没有正确的说法。你表达了，这就够了。
              </p>
            </div>
          </motion.div>

          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.5 }}
            className="mt-auto flex flex-col gap-2 pt-4">
            {!saved ? (
              <button onClick={() => setSaved(true)}
                className="w-full py-3.5 rounded-full text-[14px] font-medium active:scale-[0.97] transition-transform"
                style={{ background:"rgba(246,231,168,0.88)", color:"#4D4249" }}>
                把这句话留下
              </button>
            ) : (
              <motion.div initial={{ opacity:0, scale:0.95 }} animate={{ opacity:1, scale:1 }}
                className="w-full py-3.5 rounded-full text-[14px] text-center font-medium"
                style={{ background:"rgba(221,237,227,0.72)", color:"var(--text-primary)" }}>
                已放入长久珍藏 ✦
              </motion.div>
            )}
            <button onClick={onReplay}
              className="w-full py-3.5 rounded-full text-[14px] font-medium active:scale-[0.97] transition-transform"
              style={{ background:"rgba(255,252,245,0.72)", color:"#484145",
                border:"1px solid rgba(255,255,255,0.5)" }}>
              再试一次
            </button>
            <button onClick={onBack}
              className="w-full py-3 text-[13px] active:opacity-60" style={{ color:"var(--text-muted)" }}>
              直接离开
            </button>
            <p className="text-[11px] text-center mt-1" style={{ color:"#D0C8BF" }}>
              离开后，场景中的人物设定和对话将被清除。
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
