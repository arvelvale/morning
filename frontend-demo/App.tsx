/**
 * Morning RN — 主入口（屏幕状态机）。
 * 桌宠/设置/记忆已接 /api/v1；原型 mock 仅在离线或 dev bypass 时降级。
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, AppState, Linking, StatusBar } from "react-native";
import {
  AppShell,
  DesignSystemPreview,
  MistBackground,
  NightCtx,
  ToastSurface,
  type AppTab,
} from "./src/design-system";
import {
  OnboardHow, OnboardPermission, OnboardPet, OnboardWelcome,
} from "./src/screens/Onboarding";
import { CompanionChat, CompanionIdle, CompanionJournal, ModeSheet } from "./src/screens/Companion";
import { VoiceCall } from "./src/screens/VoiceCall";
import { ProcessingScreen, ReceiptScreen, SleepDump } from "./src/screens/Dump";
import {
  MailboxScreen,
} from "./src/screens/Mailbox";
import { SceneEnd, ScenePlay, SceneScreen } from "./src/screens/Scene";
import { PetChange, PetHandoff, ProfileScreen, MemoryScreen, MemoryReviewScreen, Preferences } from "./src/screens/Profile";
import { UserProfileScreen } from "./src/screens/UserProfile";
import { AuthScreen } from "./src/screens/Auth";
import { Scene3DPreview } from "./src/screens/Scene3DPreview";
import {
  getActivePet, getPreferences, listHandoffs, listPets, listPetPresets,
  loadTokens, logout, setActivePet, Tokens, updatePreferences,
} from "./src/api";
import { initNotifications, startLetterPolling, stopLetterPolling } from "./src/notifications";
import { UpdateSheet } from "./src/components/UpdateSheet";
import { checkForUpdate, type AvailableUpdateInfo } from "./src/updateCheck";
import {
  downloadApkUpdate,
  consumeApkInstallNotification,
  INITIAL_APK_UPDATE_STATE,
  installDownloadedApk,
  isApkUpdaterAvailable,
  requestApkInstallPermission,
  restoreApkUpdateDownload,
  updateErrorMessage,
  type ApkUpdateState,
} from "./src/apkUpdater";
import { reportCurrentLocation } from "./src/location";
import { startCompanion, stopCompanion } from "morning-companion";
import type { TheaterSceneId } from "./src/theater";
import { THEATER_SCENE_IDS } from "./src/theater";

const SCREEN_IDS = [
  "auth",
  "onboard-1", "onboard-2", "onboard-3", "onboard-4",
  "companion", "chat", "journal", "voice-call", "sleep-dump", "processing", "receipt",
  "mailbox",
  "scene", "scene-play", "scene-end",
  "profile", "pet-change", "pet-handoff",
  "memory-list", "memory-review", "user-profile",
  "design-system", "scene3d-preview",
] as const;

type Screen = (typeof SCREEN_IDS)[number];

function isScreen(value: string | null): value is Screen {
  return value !== null && (SCREEN_IDS as readonly string[]).includes(value);
}

type PetInfo = {
  id: number;
  presetId: string | null;
  name: string;
  emoji: string;
  summary: string;
};

// 内置预设的展示映射（后端预设无 emoji，前端按 preset_id 补表情）。
const PRESET_EMOJI: Record<string, string> = { miro: "✨", bobi: "☀️" };
const DEFAULT_PET: PetInfo = {
  id: 0,
  presetId: "miro",
  name: "米露",
  emoji: "✨",
  summary: "情绪碎片收藏家",
};

function petFromPreset(p: any): PetInfo {
  const presetId = p.id as string;
  const emoji = PRESET_EMOJI[presetId] ?? "🌿";
  const summary = (p.personality as string) || "陪伴伙伴";
  return { id: presetId as any, presetId, name: p.name, emoji, summary };
}

function petFromOwned(p: any): PetInfo {
  const presetId = (p.preset_id as string) || "";
  const emoji = PRESET_EMOJI[presetId] ?? "🌿";
  const summary = (p.personality as string) || "陪伴伙伴";
  return { id: p.id as number, presetId: presetId || null, name: p.name, emoji, summary };
}

// 开发/验收钩子：web 下可用合法的 ?screen=xxx 直达某屏（原生自动跳过）。
const DEV_SCREEN: Screen | null = (() => {
  if (typeof window === "undefined" || !window.location?.search) return null;
  const value = new URLSearchParams(window.location.search).get("screen");
  return isScreen(value) ? value : null;
})();

const INITIAL_SCREEN: Screen = DEV_SCREEN ?? "onboard-1";
const INITIAL_TAB: AppTab =
  DEV_SCREEN === "mailbox"
    ? "mailbox"
    : DEV_SCREEN === "scene" || DEV_SCREEN === "scene-play" || DEV_SCREEN === "scene-end"
      ? "scene"
      : DEV_SCREEN === "profile" || DEV_SCREEN === "pet-change" || DEV_SCREEN === "pet-handoff"
          || DEV_SCREEN === "memory-list" || DEV_SCREEN === "memory-review" || DEV_SCREEN === "user-profile"
        ? "profile"
        : "companion";

// auth 预览强制显示登录；其他合法页面 ID 才跳过登录。
const DEV_AUTH = DEV_SCREEN === "auth";
const DEV_BYPASS = DEV_SCREEN !== null && !DEV_AUTH;
const DEV_TOKENS: Tokens = { access_token: "dev", refresh_token: "dev", token_type: "bearer" };

const FULL_SCREENS: Screen[] = [
  "chat", "journal", "voice-call", "sleep-dump", "processing", "receipt",
  "scene-play", "scene-end",
  "pet-change", "pet-handoff", "memory-list", "memory-review", "user-profile", "design-system", "scene3d-preview",
];

const PREFERENCE_DEFAULTS: Preferences = {
  proactive_enabled: true,
  proactive_frequency: "温和",
  sleep_reminder_time: "22:30",
  keep_raw_dump: false,
  ephemeral_ttl_days: 3,
  font_size: "标准",
  companion_tone: "温暖",
  reduce_transparency: false,
  profile_learning_enabled: true,
};

export default function App() {
  const [screen, setScreen] = useState<Screen>(INITIAL_SCREEN);
  const [tokens, setTokens] = useState<Tokens | null>(DEV_BYPASS ? DEV_TOKENS : null);
  const [tab, setTab] = useState<AppTab>(INITIAL_TAB);
  const [night, setNight] = useState(false);
  const [pet, setPet] = useState<PetInfo>(DEFAULT_PET);
  const [presets, setPresets] = useState<PetInfo[]>([]);
  const [ownedPets, setOwnedPets] = useState<PetInfo[]>([]);
  const [activePetId, setActivePetId] = useState<number | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [pendingPetId, setPendingPetId] = useState<number | string | null>(null);
  const [pendingPet, setPendingPet] = useState<PetInfo | null>(null);
  const [changingPet, setChangingPet] = useState(false); // 防 double-tap / 并发切换
  const [handoffContent, setHandoffContent] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<typeof PREFERENCE_DEFAULTS>(PREFERENCE_DEFAULTS);
  const [showMode, setShowMode] = useState(false);
  const [chatMode, setChatMode] = useState("free_chat");
  const [sceneId, setSceneId] = useState<number | null>(null);
  const [sceneTheater, setSceneTheater] = useState<TheaterSceneId>("dining");
  const [toast, setToast] = useState<string | null>(null);
  // 版本更新提示：每次启动或从后台回到前台，只要仍是旧版就弹底部抽屉。
  const [updateInfo, setUpdateInfo] = useState<AvailableUpdateInfo | null>(null);
  const [apkUpdateState, setApkUpdateState] = useState<ApkUpdateState>(INITIAL_APK_UPDATE_STATE);
  const [dumpText, setDumpText] = useState("");
  const [dumpReceipt, setDumpReceipt] = useState<any>(null);
  const [chatSeedText, setChatSeedText] = useState("");
  const [letterReplyBody, setLetterReplyBody] = useState("");  // 「回它一句」带上的来信正文，供宠物基于信回复
  const [dumpSeedText, setDumpSeedText] = useState("");
  const [seedConvId, setSeedConvId] = useState<number | null>(null);  // 往日会话：进入聊天页时加载该会话历史并续聊
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fade = useRef(new Animated.Value(1)).current;

  // 启动时从存储恢复登录态（token 持久化，重启免重登）。
  useEffect(() => {
    if (DEV_BYPASS || DEV_AUTH) return;
    loadTokens().then((t) => {
      if (t) {
        setTokens(t);
        setScreen("companion");
        setTab("companion");
      }
    });
  }, []);

  // 启动及每次回到前台都检查版本更新（公开接口，不依赖登录）。
  // 「以后再说」只关闭当前一次；用户下次重新进入 App 时仍会看到提示。
  useEffect(() => {
    if (DEV_SCREEN) return;  // ?screen= 预览不打扰
    let alive = true;
    let previousState = AppState.currentState;

    const refreshUpdate = async () => {
      const info = await checkForUpdate();
      if (alive) setUpdateInfo(info);
    };

    void refreshUpdate();
    const subscription = AppState.addEventListener("change", (nextState) => {
      const returnedToForeground =
        nextState === "active" &&
        (previousState === "background" || previousState === "inactive");
      previousState = nextState;
      if (returnedToForeground) void refreshUpdate();
    });

    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  // 登录后：拉取当前桌宠 + 偏好；申请通知权限 + 开启来信轮询 + 拉起常驻陪伴前台服务。
  useEffect(() => {
    if (!tokens || DEV_BYPASS) {
      stopLetterPolling();
      stopCompanion();
      return;
    }
    let alive = true;
    initNotifications().then(() => {
      if (alive) startLetterPolling();
    });
    reportCurrentLocation();  // 登录后上报一次位置（供天气/环境上下文，best-effort）
    Promise.all([
      getActivePet().catch(() => null),
      getPreferences().catch(() => null),
    ]).then(([active, prefs]) => {
      if (!alive) return;
      if (active) {
        const p = petFromOwned(active);
        setPet(p);
        setActivePetId(p.id);
      }
      if (prefs) setPreferences({ ...PREFERENCE_DEFAULTS, ...prefs });
    });
    return () => {
      alive = false;
      stopLetterPolling();
    };
  }, [tokens]);

  // 当前桌宠变化时，更新常驻陪伴服务。
  useEffect(() => {
    if (!tokens || DEV_BYPASS) return;
    startCompanion(pet.name);
  }, [tokens, pet.name]);

  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const installApkUpdate = async (downloadedUri: string, info: AvailableUpdateInfo) => {
    try {
      setApkUpdateState((current) => ({
        ...current,
        phase: "verifying",
        progress: 1,
        downloadedUri,
        error: null,
      }));
      const result = await installDownloadedApk(downloadedUri, info);
      if (result.status === "permission_required") {
        setApkUpdateState((current) => ({
          ...current,
          phase: "permission_required",
          progress: 1,
          downloadedUri,
          error: null,
        }));
        await requestApkInstallPermission();
        return;
      }
      setApkUpdateState((current) => ({
        ...current,
        phase: "installer_opened",
        progress: 1,
        downloadedUri,
        error: null,
      }));
    } catch (error) {
      setApkUpdateState((current) => ({
        ...current,
        phase: "error",
        progress: 0,
        downloadedUri: null,
        error: updateErrorMessage(error),
      }));
    }
  };

  const handleApkUpdate = async () => {
    if (!updateInfo) return;
    if (!isApkUpdaterAvailable) {
      // Web/iOS/旧安装包没有原生模块时，保留原来的浏览器下载兜底。
      await Linking.openURL(updateInfo.apk_url);
      setUpdateInfo(null);
      return;
    }

    try {
      if (apkUpdateState.phase === "permission_required") {
        const alreadyAllowed = await requestApkInstallPermission();
        if (!alreadyAllowed) return;
      }

      if (apkUpdateState.downloadedUri) {
        await installApkUpdate(apkUpdateState.downloadedUri, updateInfo);
        return;
      }

      const state = await downloadApkUpdate(updateInfo);
      setApkUpdateState(state);
      if (state.phase === "downloaded" && state.downloadedUri) {
        await installApkUpdate(state.downloadedUri, updateInfo);
      }
    } catch (error) {
      setApkUpdateState((current) => ({
        ...current,
        phase: "error",
        progress: 0,
        downloadedUri: null,
        error: updateErrorMessage(error),
      }));
    }
  };

  // DownloadManager 持有下载任务；JS 只在前台同步进度。点击完成通知后，
  // 回到 App 先做原生完整性/签名校验，再进入 Android 系统安装确认。
  useEffect(() => {
    if (!updateInfo || !isApkUpdaterAvailable) return;
    let alive = true;
    let openingInstaller = false;

    const syncDownload = async () => {
      try {
        const restored = await restoreApkUpdateDownload(updateInfo.latest);
        if (!alive) return;
        setApkUpdateState((current) => {
          if (
            current.phase === "verifying" ||
            current.phase === "permission_required" ||
            current.phase === "installer_opened"
          ) return current;
          return restored;
        });

        // 只有任务已确认成功后才消费通知点击标记；即使状态查询短暂延迟，
        // 也不会把这次安装请求提前吃掉。
        const installRequested = restored.phase === "downloaded"
          ? await consumeApkInstallNotification()
          : false;
        if (
          alive &&
          installRequested &&
          !openingInstaller &&
          restored.phase === "downloaded" &&
          restored.downloadedUri
        ) {
          openingInstaller = true;
          await installApkUpdate(restored.downloadedUri, updateInfo);
        }
      } catch {
        // 下载状态同步失败不影响主流程；用户仍可重新点击更新按钮。
      }
    };

    void syncDownload();
    const timer = setInterval(() => { void syncDownload(); }, 1_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [updateInfo?.latest]);

  const go = (s: Screen) => {
    Animated.timing(fade, { toValue: 0, duration: 90, useNativeDriver: true }).start(() => {
      setScreen(s);
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    });
  };

  // 进入换宠屏时：拉取预设（换宠候选＝两位固定伙伴 米露/波比）与当前主宠。
  // 候选用预设而非「我拥有的桌宠」，避免因历史重复实例化导致列表里堆一排同名桌宠。
  useEffect(() => {
    if (screen !== "pet-change" || !tokens || DEV_BYPASS) return;
    Promise.all([
      listPetPresets().catch(() => []),
      getActivePet().catch(() => null),
    ]).then(([data, active]) => {
      setPresets((data as any[]).map(petFromPreset));
      if (active) {
        setActivePetId((active as any).id);
        setActivePresetId((active as any).preset_id ?? null);
      }
    });
  }, [screen, tokens]);

  // 进入选宠引导时，拉取后端预设。
  useEffect(() => {
    if (screen !== "onboard-3" || !tokens || DEV_BYPASS) return;
    listPetPresets()
      .then((data) => setPresets((data as any[]).map(petFromPreset)))
      .catch(() => setPresets([
        { id: "miro" as any, presetId: "miro", name: "米露", emoji: "✨", summary: "情绪碎片收藏家：安静、敏锐、擅长倾听和承接情绪" },
        { id: "bobi" as any, presetId: "bobi", name: "波比", emoji: "☀️", summary: "晨光信使：温暖、热烈、有行动力，也尊重边界" },
      ]));
  }, [screen, tokens]);

  const handleSetPreference = async (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    if (!tokens || DEV_BYPASS) return;
    try {
      const saved = await updatePreferences(patch);
      setPreferences({ ...PREFERENCE_DEFAULTS, ...saved });
    } catch (e: any) {
      showToast(e?.message || "保存失败");
    }
  };

  const handleOnboardPetDone = async (selectedId: number | string | null) => {
    if (!selectedId || changingPet) return;
    if (!tokens || DEV_BYPASS) {
      const fallback = presets.find((p) => p.id === selectedId) || DEFAULT_PET;
      setPet(fallback);
      go("companion");
      setTab("companion");
      return;
    }
    setChangingPet(true);
    try {
      const res = await setActivePet(selectedId);
      const activated = res?.pet;
      if (activated) {
        const p = petFromOwned(activated);
        setPet(p);
        setActivePetId(p.id);
      }
      go("companion");
      setTab("companion");
    } catch (e: any) {
      showToast(e?.message || "选宠失败");
    } finally {
      setChangingPet(false);
    }
  };

  const handlePetChange = async (petId: number | string | null) => {
    if (petId == null || changingPet) return;
    const target = [...presets, ...ownedPets].find((p) => p.id === petId);
    if (!target) return;
    setPendingPetId(petId);
    setPendingPet(target);
    if (!tokens || DEV_BYPASS) {
      setHandoffContent(null);
      go("pet-handoff");
      return;
    }
    setChangingPet(true);
    try {
      // petId 为预设 id（字符串）时后端会复用已拥有实例、没有才新建，避免重复
      const res = await setActivePet(petId);
      if (res?.pet) {
        const p = petFromOwned(res.pet);
        setPet(p);
        setActivePetId(p.id);
        setActivePresetId((res.pet as any).preset_id ?? null);
      }
      // 优先用本次切换返回的交接信，否则读最新一封。
      const summary = res?.handoff?.summary || (await latestHandoffSummary());
      setHandoffContent(summary);
      go("pet-handoff");
    } catch (e: any) {
      showToast(e?.message || "切换失败");
    } finally {
      setChangingPet(false);
    }
  };

  const latestHandoffSummary = async (): Promise<string | null> => {
    try {
      const list = await listHandoffs();
      return (list as any[])?.[0]?.summary ?? null;
    } catch {
      return null;
    }
  };

  const isMainApp = !screen.startsWith("onboard");
  const showTabBar = Boolean(tokens) && isMainApp && !FULL_SCREENS.includes(screen);

  return (
    <NightCtx.Provider value={night}>
      <StatusBar barStyle={night ? "light-content" : "dark-content"} />
      <AppShell
        activeTab={tab}
        background={<MistBackground />}
        onTabChange={(nextTab) => {
          setTab(nextTab);
          go(nextTab as Screen);
        }}
        showNavigation={showTabBar}
        toast={toast ? <ToastSurface message={toast} /> : undefined}
      >
          {!tokens ? (
            <AuthScreen
              onAuthed={(t, m) => {
                setTokens(t);
                if (m === "register") {
                  setScreen("onboard-1");
                } else {
                  setScreen("companion");
                  setTab("companion");
                }
              }}
            />
          ) : (
          <>
          <Animated.View style={{ flex: 1, opacity: fade }}>
            {screen === "onboard-1" && (
              <OnboardWelcome
                onNext={() => go("onboard-2")}
                onSkip={() => { go("companion"); setTab("companion"); }}
              />
            )}
            {screen === "onboard-2" && <OnboardHow onNext={() => go("onboard-3")} onBack={() => go("onboard-1")} />}
            {screen === "onboard-3" && (
              <OnboardPet onNext={() => go("onboard-4")} onBack={() => go("onboard-2")}
                pets={presets.length ? presets : [
                  { id: "miro" as any, name: "米露", emoji: "✨", summary: "情绪碎片收藏家：安静、敏锐、擅长倾听和承接情绪" },
                  { id: "bobi" as any, name: "波比", emoji: "☀️", summary: "晨光信使：温暖、热烈、有行动力，也尊重边界" },
                ]}
                selectedId={pendingPetId}
                onSelect={(id) => setPendingPetId(id)} />
            )}
            {screen === "onboard-4" && (
              <OnboardPermission
                onNext={() => handleOnboardPetDone(pendingPetId)}
                onBack={() => go("onboard-3")} />
            )}

            {screen === "companion" && (
              <CompanionIdle petName={pet.name} petEmoji={pet.emoji} petPresetId={pet.presetId}
                night={night} onNightToggle={() => setNight(n => !n)}
                onChat={() => { setSeedConvId(null); setLetterReplyBody(""); go("chat"); }}
                onVoiceChat={(text) => { setSeedConvId(null); setLetterReplyBody(""); setChatSeedText(text); go("chat"); }}
                onVoiceCall={() => go("voice-call")}
                onOpenJournal={() => go("journal")}
                onResumeChat={(id) => { setChatSeedText(""); setLetterReplyBody(""); setSeedConvId(id); go("chat"); }}
                onModeSheet={() => setShowMode(true)} />
            )}
            {screen === "chat" && (
              <CompanionChat petName={pet.name} petEmoji={pet.emoji} mode={chatMode}
                initialText={chatSeedText} letterContext={letterReplyBody}
                seedConversationId={seedConvId}
                onBack={() => { setChatSeedText(""); setLetterReplyBody(""); setSeedConvId(null); go("companion"); setTab("companion"); }} />
            )}
            {screen === "journal" && (
              <CompanionJournal petEmoji={pet.emoji}
                onBack={() => { go("companion"); setTab("companion"); }}
                onOpenConversation={(id) => { setChatSeedText(""); setLetterReplyBody(""); setSeedConvId(id); go("chat"); setTab("companion"); }} />
            )}
            {screen === "voice-call" && (
              <VoiceCall petName={pet.name} petEmoji={pet.emoji} petPresetId={pet.presetId}
                onEnd={() => { go("companion"); setTab("companion"); }}
                onToast={showToast}
                onEnterScene={(sceneId, theaterId) => {
                  setSceneId(sceneId);
                  setSceneTheater(
                    THEATER_SCENE_IDS.includes((theaterId ?? "") as TheaterSceneId)
                      ? (theaterId as TheaterSceneId)
                      : "dining" // 无/非法 theater_id 时用默认剧场兜底
                  );
                  go("scene-play");
                  setTab("scene");
                }} />
            )}
            {screen === "sleep-dump" && (
              <SleepDump initialText={dumpSeedText}
                onBack={() => { setDumpSeedText(""); go("companion"); setTab("companion"); }}
                onProcess={(t) => { setDumpText(t); go("processing"); }} />
            )}
            {screen === "processing" && (
              <ProcessingScreen text={dumpText}
                onDone={(r) => { setDumpReceipt(r); go("receipt"); }} />
            )}
            {screen === "receipt" && (
              <ReceiptScreen receipt={dumpReceipt}
                onDone={() => { go("companion"); setTab("companion"); }}
                onView={() => { go("mailbox"); setTab("mailbox"); }} />
            )}

            {screen === "mailbox" && (
              <MailboxScreen
                petName={pet.name}
                onToast={showToast}
                onPlayScene={(sceneId, theaterId) => {
                  setSceneId(sceneId);
                  setSceneTheater(
                    THEATER_SCENE_IDS.includes((theaterId ?? "") as TheaterSceneId)
                      ? (theaterId as TheaterSceneId)
                      : "dining" // 一期：dynamic_image 邀请先用默认剧场兜底
                  );
                  go("scene-play");
                  setTab("scene");
                }}
                onReplyLetter={(letter) => { setSeedConvId(null); setChatSeedText(""); setLetterReplyBody(letter?.body ?? ""); go("chat"); setTab("companion"); }} />
            )}

            {screen === "scene" && <SceneScreen onPlay={(id, theater) => { setSceneId(id); if (theater) setSceneTheater(theater); go("scene-play"); }} />}
            {screen === "scene-play" && <ScenePlay sceneId={sceneId} theater={sceneTheater} onEnd={() => go("scene-end")} />}
            {screen === "scene-end" && (
              <SceneEnd sceneId={sceneId} onBack={() => { go("scene"); setTab("scene"); }}
                onReplay={() => go("scene-play")} />
            )}

            {screen === "profile" && (
              <ProfileScreen petName={pet.name} petEmoji={pet.emoji} petPresetId={pet.presetId} petSummary={pet.summary}
                night={night} onNightToggle={() => setNight(n => !n)}
                onChangePet={() => go("pet-change")}
                onMemory={() => go("memory-list")}
                onMemoryReview={() => go("memory-review")}
                onUserProfile={() => go("user-profile")}
                preferences={preferences}
                onSetPreference={handleSetPreference}
                onLogout={async () => {
                  await logout();          // 清本地 token（即使 /logout 401 也会清）
                  setTokens(null);         // → 回到登录页（AuthScreen）
                  setScreen("companion");  // 重置导航，重登后从主页进入
                  setTab("companion");
                }} />
            )}
            {screen === "pet-change" && (
              <PetChange pets={presets} activePetId={activePresetId}
                onBack={() => { go("profile"); setTab("profile"); }}
                onHandoff={handlePetChange} />
            )}
            {screen === "pet-handoff" && (
              <PetHandoff oldPet={pet} newPet={pendingPet ?? undefined}
                handoffContent={handoffContent}
                onBack={() => go("pet-change")}
                onDone={() => { go("companion"); setTab("companion"); }} />
            )}
            {screen === "memory-list" && (
              <MemoryScreen onBack={() => { go("profile"); setTab("profile"); }} onToast={showToast} />
            )}
            {screen === "memory-review" && (
              <MemoryReviewScreen onBack={() => { go("profile"); setTab("profile"); }} onToast={showToast} />
            )}
            {screen === "user-profile" && (
              <UserProfileScreen onBack={() => { go("profile"); setTab("profile"); }} onToast={showToast} />
            )}
            {screen === "design-system" && <DesignSystemPreview />}
            {screen === "scene3d-preview" && <Scene3DPreview />}
          </Animated.View>

          <ModeSheet visible={showMode} onClose={() => setShowMode(false)}
            onSleepDump={() => { setDumpSeedText(""); setShowMode(false); go("sleep-dump"); }}
            onChat={(m) => { setSeedConvId(null); setChatSeedText(""); setLetterReplyBody(""); setChatMode(m); setShowMode(false); go("chat"); }} />
          </>
          )}
      </AppShell>
      {updateInfo && (
        <UpdateSheet
          info={updateInfo}
          updateState={apkUpdateState}
          onUpdate={() => { void handleApkUpdate(); }}
          onLater={() => {
            setUpdateInfo(null);
            setApkUpdateState(INITIAL_APK_UPDATE_STATE);
          }}
        />
      )}
    </NightCtx.Provider>
  );
}
