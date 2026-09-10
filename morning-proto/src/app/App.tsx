/* Auto-split from App.tsx (codemod). */
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { NightCtx, NK, NIGHT_VARS, DAY_VARS, type Tab, type LetterState, type Screen } from "./theme";
import { MistBackground, TabBar } from "./primitives";
import { OnboardWelcome, OnboardHow, OnboardPet, OnboardPermission } from "./screens/Onboarding";
import { CompanionIdle, CompanionChat, ModeSheet } from "./screens/Companion";
import { SleepDump, ProcessingScreen, ReceiptScreen } from "./screens/Dump";
import { MailboxScreen, TaskDetail, StorageDetail } from "./screens/Mailbox";
import { SceneScreen, SceneCreate, ScenePlay, SceneEnd } from "./screens/Scene";
import { ProfileScreen, PetChange, PetHandoff } from "./screens/Profile";

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════

export const PET_DATA = [
  { name: "米露", emoji: "🌿" },
  { name: "晴晴", emoji: "☀️" },
  { name: "暮云", emoji: "🌙" },
];

export default function App() {
  const [screen, setScreen]     = useState<Screen>("onboard-1");
  const [tab, setTab]           = useState<Tab>("companion");
  const [night, setNight]       = useState(false);
  const [petIndex, setPetIndex] = useState(0);
  const [onboardPet, setOnboardPet] = useState(0);
  const [showMode, setShowMode]     = useState(false);
  const [pendingPet, setPendingPet] = useState(0);
  const [letterState, setLetterState] = useState<LetterState>("sealed");
  const [frameToast, setFrameToast]   = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setFrameToast(msg);
    toastTimer.current = setTimeout(() => setFrameToast(null), 2200);
  };

  const handleOpenLetter = () => {
    if (letterState !== "sealed") return;
    setLetterState("opening");
    setTimeout(() => setLetterState("opened"), 680);
  };

  const handleSaveLetter = () => {
    setLetterState("saved");
    showToast("已放入长久珍藏 ✦");
  };

  const handleAckLetter = () => {
    showToast("它知道你收到了");
  };

  const pet = PET_DATA[petIndex];

  const go = (s: Screen) => setScreen(s);

  const tabScreens: Tab[] = ["companion", "mailbox", "scene", "profile"];
  const fullScreens: Screen[] = [
    "chat", "sleep-dump", "processing", "receipt",
    "task-detail", "storage-detail",
    "scene-create", "scene-play", "scene-end",
    "pet-change", "pet-handoff",
  ];

  const isMainApp = !screen.startsWith("onboard");
  const showTabBar = isMainApp && !fullScreens.includes(screen);

  const handleTabChange = (t: Tab) => {
    setTab(t);
    go(t as Screen);
  };

  return (
    <NightCtx.Provider value={night}>
    <div className={`min-h-screen flex items-center justify-center ${night ? "dark" : ""}`}
      style={{ background: night ? "#1C1A20" : "#D8D2CA", ...(night ? NIGHT_VARS : DAY_VARS) }}>
      <div className={`relative overflow-hidden select-none${night ? " night-root" : ""}`} style={{
        width: 393, height: 852,
        borderRadius: 50,
        boxShadow: "0 48px 96px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(255,255,255,0.12)",
        background: night ? NK.bg : "#FFFBF3",
        flexShrink: 0,
      }}>
        {/* Night typography global overrides */}
        <style>{`
          .night-root input::placeholder,
          .night-root textarea::placeholder { color: ${NK.placeholder}; }
          .night-root .row-divider { background: ${NK.divider}; }
        `}</style>

        {/* Mist background */}
        <MistBackground night={night}/>

        {/* Screens */}
        <div className="absolute inset-0 z-10">
          <AnimatePresence mode="wait">
            <motion.div key={screen} className="absolute inset-0"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.2 }}>

              {screen === "onboard-1" && <OnboardWelcome onNext={() => go("onboard-2")}/>}
              {screen === "onboard-2" && <OnboardHow     onNext={() => go("onboard-3")} onBack={() => go("onboard-1")}/>}
              {screen === "onboard-3" && (
                <OnboardPet onNext={() => go("onboard-4")} onBack={() => go("onboard-2")}
                  selected={onboardPet} onSelect={i => { setOnboardPet(i); }}/>
              )}
              {screen === "onboard-4" && (
                <OnboardPermission
                  onNext={() => { setPetIndex(onboardPet); go("companion"); }}
                  onBack={() => go("onboard-3")}/>
              )}

              {screen === "companion" && (
                <CompanionIdle petName={pet.name} petEmoji={pet.emoji}
                  night={night} onNightToggle={() => setNight(n => !n)}
                  onChat={() => go("chat")} onModeSheet={() => setShowMode(true)}/>
              )}
              {screen === "chat" && (
                <CompanionChat petName={pet.name} petEmoji={pet.emoji}
                  onBack={() => { go("companion"); setTab("companion"); }}/>
              )}
              {screen === "sleep-dump" && (
                <SleepDump onBack={() => { go("companion"); setTab("companion"); }}
                  onProcess={() => go("processing")}/>
              )}
              {screen === "processing" && <ProcessingScreen onDone={() => go("receipt")}/>}
              {screen === "receipt" && (
                <ReceiptScreen onDone={() => { go("companion"); setTab("companion"); }}
                  onView={() => { go("mailbox"); setTab("mailbox"); }}/>
              )}

              {screen === "mailbox" && (
                <MailboxScreen
                  onTaskDetail={() => go("task-detail")}
                  onStorageDetail={() => go("storage-detail")}
                  letterState={letterState}
                  onOpenLetter={handleOpenLetter}
                  onSaveLetter={handleSaveLetter}
                  onAckLetter={handleAckLetter}
                  onReplyLetter={() => { go("chat"); setTab("companion"); }}
                />
              )}
              {screen === "task-detail" && <TaskDetail onBack={() => { go("mailbox"); setTab("mailbox"); }}/>}
              {screen === "storage-detail" && <StorageDetail onBack={() => { go("mailbox"); setTab("mailbox"); }}/>}

              {screen === "scene" && (
                <SceneScreen onCreate={() => go("scene-create")} onPlay={() => go("scene-play")}/>
              )}
              {screen === "scene-create" && (
                <SceneCreate onBack={() => { go("scene"); setTab("scene"); }}
                  onReady={() => go("scene-play")}/>
              )}
              {screen === "scene-play" && <ScenePlay onEnd={() => go("scene-end")}/>}
              {screen === "scene-end" && (
                <SceneEnd onBack={() => { go("scene"); setTab("scene"); }}
                  onReplay={() => go("scene-play")}/>
              )}

              {screen === "profile" && (
                <ProfileScreen petName={pet.name} petEmoji={pet.emoji}
                  night={night} onNightToggle={() => setNight(n => !n)}
                  onChangePet={() => go("pet-change")}/>
              )}
              {screen === "pet-change" && (
                <PetChange onBack={() => { go("profile"); setTab("profile"); }}
                  onHandoff={i => { setPendingPet(i + 1); go("pet-handoff"); }}/>
              )}
              {screen === "pet-handoff" && (
                <PetHandoff newPetEmoji={PET_DATA[pendingPet]?.emoji ?? "☀️"}
                  onBack={() => go("pet-change")}
                  onDone={() => { setPetIndex(pendingPet); go("companion"); setTab("companion"); }}/>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Mode sheet overlay */}
          <AnimatePresence>
            {showMode && (
              <ModeSheet
                onClose={() => setShowMode(false)}
                onSleepDump={() => { setShowMode(false); go("sleep-dump"); }}
                onChat={() => { setShowMode(false); go("chat"); }}/>
            )}
          </AnimatePresence>
        </div>

        {/* In-frame toast */}
        <AnimatePresence>
          {frameToast && (
            <motion.div
              className="absolute left-1/2 z-50 pointer-events-none"
              style={{ bottom: 100, transform: "translateX(-50%)", whiteSpace: "nowrap" }}
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.95 }}
              transition={{ type: "spring", damping: 22, stiffness: 260 }}>
              <div className="px-5 py-2.5 rounded-full text-[13px] font-medium"
                style={{
                  background: night ? "rgba(50,46,56,0.94)" : "rgba(255,252,245,0.92)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  border: night ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(255,255,255,0.55)",
                  boxShadow: night ? "0 8px 24px rgba(10,8,14,0.20)" : "0 8px 24px rgba(121,100,72,0.12)",
                  color: "var(--text-primary)",
                }}>
                {frameToast}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tab bar */}
        {showTabBar && (
          <div className="absolute bottom-0 left-0 right-0 z-20">
            <TabBar active={tab} onChange={handleTabChange}/>
          </div>
        )}
      </div>
    </div>
    </NightCtx.Provider>
  );
}
