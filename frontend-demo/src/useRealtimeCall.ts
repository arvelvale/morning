/**
 * 实时语音通话钩子（桌宠版·文字回复）。
 *
 * 链路：麦克风裸 PCM → WS /ai/stt/stream（开 server_vad，服务端自动断句）
 *   → conversation.item.input_audio_transcription.delta/completed
 *   → 整句喂带记忆的 /conversations/{id}/messages（streamChatReply）
 *   → 桌宠逐字文字回复。
 *
 * 仅真机 Android（原生 PCM 模块）可用；web/未编进原生时 available=false，由页面提示。
 */
import { useCallback, useRef, useState } from "react";
import { requestRecordingPermissionsAsync } from "expo-audio";
import {
  addAudioChunkListener,
  isPcmAvailable,
  startPcmCapture,
  stopPcmCapture,
} from "morning-companion";
import type { EventSubscription } from "expo-modules-core";

import { createConversation, detectSceneIntent, getActivePet, streamChatReply, wsAuthUrl } from "./api";
import type { IntentSeed } from "./api";
import { speakReply, stopSpeaking } from "./speak";
import {
  createSpeechGate,
  isLikelyPlaybackEcho,
  observeSpeech,
  replaceCumulativeTranscript,
  type SpeechGate,
} from "./voice/speechGuards";
import { parseVoiceStreamError } from "./voice/streamErrors";

export type CallStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended"
  | "error";

export interface CallTurn {
  id: number;
  role: "user" | "pet";
  text: string;
}

/** 通话中识别到的场景意图建议：够触发「进入片场」提示条。 */
export interface SceneSuggestion {
  seed: IntentSeed | null;
  theater_id: string | null;
  render_kind: string | null;
  confidence: number | null;
}

export interface RealtimeCall {
  available: boolean;
  status: CallStatus;
  /** 当前正在说、尚未定稿的用户转写（累计全量，整体替换展示）。 */
  liveUser: string;
  /** 已定稿的对话轮次（用户整句 + 桌宠回复）。 */
  turns: CallTurn[];
  /** 麦克风音量 0~1，用于律动 UI。 */
  level: number;
  error: string | null;
  /** 通话中识别到的场景意图（未命中为 null）；供 UI 弹出「进入片场」提示条。 */
  sceneSuggestion: SceneSuggestion | null;
  /** 忽略当前场景建议（用户点了「不了」/进入后）。 */
  dismissSuggestion: () => void;
  start: () => Promise<void>;
  stop: () => void;
}

let _eid = 0;
const eid = () => `evt_${Date.now()}_${++_eid}`;

const SESSION_UPDATE = {
  type: "session.update",
  session: {
    audio: {
      input: {
        format: { type: "pcm", codec: "pcm_s16le", rate: 16000, bits: 16, channel: 1 },
        transcription: {
          model: "stepaudio-2.5-asr-stream",
          language: "zh",
          enable_itn: true,
        },
        // server_vad：threshold 越高越不灵敏（需更清晰人声才触发，抗风声/背景噪音）；
        // silence_duration_ms 为判定「说完了」所需的静音时长。这里配合下方 GRACE_MS 续说合并：
        // VAD 先粗分句、客户端再等宽限窗确认是否真的说完，避免中途停顿被抢答。
        turn_detection: { type: "server_vad", silence_duration_ms: 1200, threshold: 0.6 },
      },
    },
  },
};

/**
 * 续说合并宽限窗（毫秒）：一句被 server_vad 判完后，先不马上回复，等这么久；
 * 期间用户又开口（speech_started）就取消，把后续整句拼到前句，直到真正停够才回。
 * 调大＝更不容易被打断但回复更慢；调小＝更跟手但更容易在停顿处抢答。
 */
const GRACE_MS = 1000;
/** TTS 播完后继续屏蔽这段时间，让扬声器与房间余音衰减。 */
const ECHO_TAIL_MS = 500;
/** 播放结束后保留最近 TTS 指纹，拦截云端稍晚返回的残余回声转写。 */
const RECENT_TTS_WINDOW_MS = 4000;

export function useRealtimeCall(voiceReply: boolean): RealtimeCall {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [liveUser, setLiveUser] = useState("");
  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sceneSuggestion, setSceneSuggestion] = useState<SceneSuggestion | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const subRef = useRef<EventSubscription | null>(null);
  const convIdRef = useRef<number | null>(null);
  const connectionStateRef = useRef<"idle" | "starting" | "active">("idle");
  const sessionIdRef = useRef(0);
  const closedRef = useRef(false);
  const turnIdRef = useRef(0);
  // 续说合并：pendingRef 暂存已定稿但尚未发送的整句；graceTimerRef 是宽限窗计时器。
  const pendingRef = useRef("");
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 场景意图识别的序号：只认最新一句的结果，避免慢返回覆盖新意图。
  const intentSeqRef = useRef(0);
  // 本地 RMS 门限：只有连续清晰人声才接受云端转写，过滤静音/耳机底噪幻听。
  const speechGateRef = useRef<SpeechGate>(createSpeechGate());
  const latestTranscriptRef = useRef("");
  // 半双工回声保护：TTS 播放及 500ms 余音期内仍采集 PCM，但不再发给 ASR。
  const inputSuppressedRef = useRef(false);
  const echoTailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackSeqRef = useRef(0);
  const recentSpokenRef = useRef<{ text: string; expiresAt: number } | null>(null);
  // 语音回复开关的最新值（用 ref 避免回调闭包读到旧值）
  const voiceReplyRef = useRef(voiceReply);
  voiceReplyRef.current = voiceReply;

  const addTurn = useCallback((role: "user" | "pet", text: string): number => {
    const id = ++turnIdRef.current;
    setTurns((prev) => [...prev, { id, role, text }]);
    return id;
  }, []);

  const cleanup = useCallback(() => {
    connectionStateRef.current = "idle";
    playbackSeqRef.current += 1;
    inputSuppressedRef.current = false;
    recentSpokenRef.current = null;
    subRef.current?.remove();
    subRef.current = null;
    if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
    if (echoTailTimerRef.current) { clearTimeout(echoTailTimerRef.current); echoTailTimerRef.current = null; }
    pendingRef.current = "";
    speechGateRef.current = createSpeechGate();
    latestTranscriptRef.current = "";
    void stopPcmCapture();
    const ws = wsRef.current;
    wsRef.current = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    stopSpeaking();
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    closedRef.current = true;
    sessionIdRef.current += 1;
    cleanup();
    setSceneSuggestion(null);
    speechGateRef.current = createSpeechGate();
    latestTranscriptRef.current = "";
    setStatus("ended");
  }, [cleanup]);

  const dismissSuggestion = useCallback(() => setSceneSuggestion(null), []);

  // 用户「整段说完」→ 走带记忆的 chat，桌宠逐字回复（由 queueUtterance 在宽限窗结束后调用）
  const sendUtterance = useCallback(
    (text: string) => {
      const clean = text.trim();
      const convId = convIdRef.current;
      if (!clean || convId == null) return;
      setLiveUser("");
      addTurn("user", clean);

      // 方案B：不阻塞主聊天/TTS，异步逐句识别场景意图；带序号防竞态，失败静默忽略。
      const seq = ++intentSeqRef.current;
      detectSceneIntent(clean)
        .then((r) => {
          if (closedRef.current || seq !== intentSeqRef.current || !r?.worth) return;
          const next: SceneSuggestion = {
            seed: r.seed ?? null,
            theater_id: r.theater_id ?? null,
            render_kind: r.render_kind ?? null,
            confidence: r.confidence ?? null,
          };
          // 已有未处理建议时，仅当新意图置信度更高才替换，避免频繁抖动。
          setSceneSuggestion((prev) =>
            prev && (prev.confidence ?? 0) >= (next.confidence ?? 0) ? prev : next
          );
        })
        .catch(() => {
          /* 意图识别失败不影响聊天与语音回复 */
        });

      const petId = addTurn("pet", "");
      setStatus("thinking");
      let full = "";
      streamChatReply(convId, clean, (delta) => {
        full += delta;
        setTurns((prev) =>
          prev.map((t) => (t.id === petId ? { ...t, text: t.text + delta } : t))
        );
      })
        .catch((e: any) => {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === petId && !t.text
                ? { ...t, text: e?.message || "刚刚没接住，你再说一遍？" }
                : t
            )
          );
        })
        .finally(() => {
          if (closedRef.current) return;
          if (!voiceReplyRef.current || !full.trim()) {
            setStatus("listening");
            return;
          }

          const playbackId = ++playbackSeqRef.current;
          let playbackStarted = false;
          speakReply(full, {
            onStart: () => {
              if (closedRef.current || playbackId !== playbackSeqRef.current) return;
              playbackStarted = true;
              inputSuppressedRef.current = true;
              recentSpokenRef.current = { text: full, expiresAt: Number.POSITIVE_INFINITY };
              if (echoTailTimerRef.current) {
                clearTimeout(echoTailTimerRef.current);
                echoTailTimerRef.current = null;
              }
              // 播放开始前清掉可能由扬声器起音触发的本地/云端临时识别状态。
              speechGateRef.current = createSpeechGate();
              latestTranscriptRef.current = "";
              setLiveUser(pendingRef.current);
              setLevel(0);
              setStatus("speaking");
            },
            onEnd: () => {
              if (closedRef.current || playbackId !== playbackSeqRef.current) return;
              if (!playbackStarted) {
                // TTS 合成失败、尚未真正播放：无需等待余音，立即恢复收音状态。
                inputSuppressedRef.current = false;
                recentSpokenRef.current = null;
                setStatus("listening");
                return;
              }

              recentSpokenRef.current = {
                text: full,
                expiresAt: Date.now() + RECENT_TTS_WINDOW_MS,
              };
              if (echoTailTimerRef.current) clearTimeout(echoTailTimerRef.current);
              echoTailTimerRef.current = setTimeout(() => {
                echoTailTimerRef.current = null;
                if (closedRef.current || playbackId !== playbackSeqRef.current) return;
                speechGateRef.current = createSpeechGate();
                latestTranscriptRef.current = "";
                inputSuppressedRef.current = false;
                setLiveUser(pendingRef.current);
                setLevel(0);
                setStatus("listening");
              }, ECHO_TAIL_MS);
            },
          });
        });
    },
    [addTurn]
  );

  // 续说合并：完句先入 pending 并重置宽限窗；窗内无人再开口才真正发送。
  const queueUtterance = useCallback(
    (transcript: string) => {
      const clean = transcript.trim();
      if (!clean) return;
      const recent = recentSpokenRef.current;
      if (
        recent
        && Date.now() <= recent.expiresAt
        && isLikelyPlaybackEcho(clean, recent.text)
      ) {
        // 系统 AEC 未完全消除或云端延迟返回的 TTS 回声：不展示、不落库、不触发回复。
        setLiveUser(pendingRef.current);
        return;
      }
      pendingRef.current = pendingRef.current ? pendingRef.current + clean : clean;
      setLiveUser(pendingRef.current);
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
      graceTimerRef.current = setTimeout(() => {
        graceTimerRef.current = null;
        const merged = pendingRef.current;
        pendingRef.current = "";
        sendUtterance(merged);
      }, GRACE_MS);
    },
    [sendUtterance]
  );

  const start = useCallback(async () => {
    if (connectionStateRef.current !== "idle") return;
    if (!isPcmAvailable) {
      setError("实时通话需在真机上使用");
      setStatus("error");
      return;
    }
    connectionStateRef.current = "starting";
    const currentSessionId = ++sessionIdRef.current;
    setError(null);
    setTurns([]);
    setLiveUser("");
    setSceneSuggestion(null);
    playbackSeqRef.current += 1;
    inputSuppressedRef.current = false;
    recentSpokenRef.current = null;
    if (echoTailTimerRef.current) {
      clearTimeout(echoTailTimerRef.current);
      echoTailTimerRef.current = null;
    }
    closedRef.current = false;
    setStatus("connecting");

    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("需要麦克风权限才能通话");
        setStatus("error");
        connectionStateRef.current = "idle";
        return;
      }
      if (sessionIdRef.current !== currentSessionId) return;

      // 复用一个会话，桌宠在整通话里有记忆连续性
      let petId: number | null = null;
      try {
        const pet = await getActivePet();
        petId = pet?.id ?? null;
      } catch {
        /* 无主桌宠也能聊 */
      }
      // 以 voice_call 模式落库：夜间场景推荐管线只扫 voice_call 会话，
      // 误用 free_chat 会让推荐永远空转（后端 scene_recommend 按 mode 过滤）。
      const conv = await createConversation(petId, "voice_call");
      if (sessionIdRef.current !== currentSessionId) return;
      convIdRef.current = conv.id;

      const ws = new WebSocket(wsAuthUrl("/ai/stt/stream"));
      wsRef.current = ws;

      ws.onopen = async () => {
        if (closedRef.current || sessionIdRef.current !== currentSessionId) {
          try { ws.close(); } catch { /* best-effort cancellation */ }
          return;
        }
        ws.send(JSON.stringify({ event_id: eid(), ...SESSION_UPDATE }));
        const ok = await startPcmCapture();
        if (closedRef.current || sessionIdRef.current !== currentSessionId) {
          if (ok) void stopPcmCapture();
          try { ws.close(); } catch { /* best-effort cancellation */ }
          return;
        }
        if (!ok) {
          setError("麦克风启动失败");
          stop();
          return;
        }
        connectionStateRef.current = "active";
        subRef.current = addAudioChunkListener(({ base64, rms }) => {
          if (inputSuppressedRef.current) {
            // 保持 AudioRecord/AEC 会话不断开，但不让扬声器声音进入云端 ASR。
            setLevel(0);
            return;
          }
          setLevel(rms);
          const previous = speechGateRef.current;
          const next = observeSpeech(previous, rms);
          speechGateRef.current = next;
          // 只有本地确认用户再次开口，才撤销上一句的发送宽限窗。
          if (!previous.detected && next.detected) {
            if (graceTimerRef.current) {
              clearTimeout(graceTimerRef.current);
              graceTimerRef.current = null;
            }
            if (!closedRef.current) setStatus("listening");
          }
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({ event_id: eid(), type: "input_audio_buffer.append", audio: base64 })
            );
          }
        });
        setStatus("listening");
      };

      ws.onmessage = (ev) => {
        if (sessionIdRef.current !== currentSessionId) return;
        let msg: any;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }
        const streamError = parseVoiceStreamError(msg);
        if (streamError) {
          closedRef.current = true;
          setError(streamError.message);
          cleanup();
          setStatus("error");
          return;
        }
        switch (msg?.type) {
          case "input_audio_buffer.speech_started":
            // 服务端 speech_started 可能由底噪误触；真正的续说由本地 RMS 门限确认。
            break;
          case "conversation.item.input_audio_transcription.delta":
            if (inputSuppressedRef.current) {
              speechGateRef.current = createSpeechGate();
              latestTranscriptRef.current = "";
              setLiveUser(pendingRef.current);
              break;
            }
            latestTranscriptRef.current = replaceCumulativeTranscript(
              latestTranscriptRef.current,
              msg.text,
            );
            if (speechGateRef.current.detected) {
              setLiveUser(pendingRef.current + latestTranscriptRef.current);
            }
            break;
          case "conversation.item.input_audio_transcription.completed":
            latestTranscriptRef.current = replaceCumulativeTranscript(
              latestTranscriptRef.current,
              msg.transcript,
            );
            if (inputSuppressedRef.current) {
              setLiveUser(pendingRef.current);
            } else if (speechGateRef.current.detected) {
              queueUtterance(latestTranscriptRef.current);
            } else {
              // 静音产生的云端幻听不展示、不落库、也不触发桌宠回复。
              setLiveUser(pendingRef.current);
            }
            speechGateRef.current = createSpeechGate();
            latestTranscriptRef.current = "";
            break;
          default:
            break;
        }
      };

      ws.onerror = () => {
        if (closedRef.current || sessionIdRef.current !== currentSessionId) return;
        closedRef.current = true;
        setError("连接中断，请重试");
        cleanup();
        setStatus("error");
      };

      ws.onclose = () => {
        if (closedRef.current || sessionIdRef.current !== currentSessionId) return;
        closedRef.current = true;
        setError("语音连接已结束，请重试");
        cleanup();
        setStatus("error");
      };
    } catch (e: any) {
      if (sessionIdRef.current !== currentSessionId) return;
      closedRef.current = true;
      setError(e?.message || "无法开始通话");
      cleanup();
      setStatus("error");
    }
  }, [cleanup, queueUtterance, stop]);

  return {
    available: isPcmAvailable,
    status,
    liveUser,
    turns,
    level,
    error,
    sceneSuggestion,
    dismissSuggestion,
    start,
    stop,
  };
}
