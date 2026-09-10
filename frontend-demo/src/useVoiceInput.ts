/**
 * 语音输入钩子：按住/点击录音，松手后转文字。
 *
 * 优先走原生 PCM 采集（真机 Android）：录 16k/mono/PCM16 → 写临时 .pcm → POST /ai/stt(type=pcm)。
 * 这是因为阶跃 ASR 只吃 wav/mp3/flac/opus/pcm，而 expo-audio 在安卓只能产出 m4a，对不上。
 * 原生模块不可用时（web / 未编进原生）降级到 expo-audio 录文件上传（best-effort）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as FileSystem from "expo-file-system";
import type { EventSubscription } from "expo-modules-core";
import {
  addAudioChunkListener,
  isPcmAvailable,
  startPcmCapture,
  stopPcmCapture,
} from "morning-companion";

import { sttOnce, wsAuthUrl } from "./api";
import {
  createSpeechGate,
  observeSpeech,
  replaceCumulativeTranscript,
  type SpeechGate,
} from "./voice/speechGuards";
import { parseVoiceStreamError } from "./voice/streamErrors";

export interface VoiceInputState {
  isRecording: boolean;
  transcribing: boolean;
  error: string | null;
  durationMillis: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/** 根据平台推断 expo-audio HIGH_QUALITY 的实际录音格式（仅降级路径用）。 */
function recordingType(): string {
  if (Platform.OS === "web") return "webm";
  return "m4a";
}

/** 把整段 base64 PCM 落到临时文件，返回可上传的 file uri。 */
async function writePcmTemp(base64: string): Promise<string> {
  const uri = `${FileSystem.cacheDirectory}stt-${Date.now()}.pcm`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

let voiceEventId = 0;
const nextVoiceEventId = () => `voice_${Date.now()}_${++voiceEventId}`;

const STREAMING_SESSION_UPDATE = {
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
        turn_detection: { type: "server_vad", silence_duration_ms: 1200, threshold: 0.6 },
      },
    },
  },
};

export function useVoiceInput(
  onResult: (text: string) => void,
  onPartial?: (text: string) => void,
): VoiceInputState {
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 原生 PCM 路径的录音态（不经 expo-audio）
  const [pcmRecording, setPcmRecording] = useState(false);
  const usingPcm = useRef(false);
  const streamSocket = useRef<WebSocket | null>(null);
  const chunkSubscription = useRef<EventSubscription | null>(null);
  const operation = useRef<"idle" | "starting" | "recording" | "stopping">("idle");
  const sessionId = useRef(0);
  const cooldownUntil = useRef(0);
  const latestTranscript = useRef("");
  const speechGate = useRef<SpeechGate>(createSpeechGate());
  const resultCallback = useRef(onResult);
  const partialCallback = useRef(onPartial);
  resultCallback.current = onResult;
  partialCallback.current = onPartial;

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);

  const closeStreaming = useCallback(() => {
    chunkSubscription.current?.remove();
    chunkSubscription.current = null;
    const ws = streamSocket.current;
    streamSocket.current = null;
    try {
      ws?.close();
    } catch {
      /* best-effort cleanup */
    }
  }, []);

  useEffect(() => () => {
    sessionId.current += 1;
    operation.current = "idle";
    closeStreaming();
    if (usingPcm.current) void stopPcmCapture();
  }, [closeStreaming]);

  const connectStreaming = useCallback(async (currentSessionId: number): Promise<boolean> => {
    latestTranscript.current = "";
    const ws = new WebSocket(wsAuthUrl("/ai/stt/stream"));
    streamSocket.current = ws;

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ready);
      };
      const timer = setTimeout(() => finish(false), 4000);
      ws.onmessage = (event) => {
        let message: any;
        try {
          message = JSON.parse(typeof event.data === "string" ? event.data : "");
        } catch {
          return;
        }
        const streamError = parseVoiceStreamError(message);
        if (streamError) {
          if (streamError.retryAfterMs > 0) {
            cooldownUntil.current = Date.now() + streamError.retryAfterMs;
          }
          setError(streamError.message);
          finish(false);
          return;
        }
        if (message?.type === "conversation.item.input_audio_transcription.delta"
            && typeof message.text === "string") {
          latestTranscript.current = replaceCumulativeTranscript(
            latestTranscript.current,
            message.text,
          );
          if (speechGate.current.detected) {
            partialCallback.current?.(latestTranscript.current);
          }
        }
        if (message?.type === "conversation.item.input_audio_transcription.completed") {
          latestTranscript.current = replaceCumulativeTranscript(
            latestTranscript.current,
            message.transcript,
          );
          if (speechGate.current.detected && latestTranscript.current) {
            partialCallback.current?.(latestTranscript.current);
          }
        }
      };
      ws.onopen = () => {
        if (sessionId.current !== currentSessionId) {
          try { ws.close(); } catch { /* best-effort cancellation */ }
          finish(false);
          return;
        }
        try {
          ws.send(JSON.stringify({ event_id: nextVoiceEventId(), ...STREAMING_SESSION_UPDATE }));
          finish(true);
        } catch {
          finish(false);
        }
      };
      ws.onerror = () => finish(false);
      ws.onclose = () => {
        if (streamSocket.current === ws) streamSocket.current = null;
        finish(false);
      };
    });
  }, []);

  const start = useCallback(async () => {
    if (operation.current !== "idle") return;
    if (Date.now() < cooldownUntil.current) {
      setError("语音服务正在忙，请稍等几秒再试");
      return;
    }
    operation.current = "starting";
    const currentSessionId = ++sessionId.current;
    setError(null);
    speechGate.current = createSpeechGate();
    latestTranscript.current = "";
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("需要麦克风权限才能录音");
        return;
      }
      if (sessionId.current !== currentSessionId) return;
      if (isPcmAvailable) {
        const streamingReady = await connectStreaming(currentSessionId);
        if (sessionId.current !== currentSessionId) {
          closeStreaming();
          return;
        }
        const ok = await startPcmCapture();
        if (sessionId.current !== currentSessionId) {
          if (ok) void stopPcmCapture();
          closeStreaming();
          return;
        }
        if (ok) {
          usingPcm.current = true;
          operation.current = "recording";
          setPcmRecording(true);
          if (!streamingReady) {
            // 流式链路不可用时保留原有整段识别，用户仍可正常录音。
            closeStreaming();
          }
          // 无论流式连接是否可用都观察本地音量：整段识别同样需要静音保护。
          chunkSubscription.current = addAudioChunkListener(({ base64, rms }) => {
            speechGate.current = observeSpeech(speechGate.current, rms);
            if (streamSocket.current?.readyState === WebSocket.OPEN) {
              streamSocket.current.send(JSON.stringify({
                event_id: nextVoiceEventId(),
                type: "input_audio_buffer.append",
                audio: base64,
              }));
            }
          });
          return;
        }
        closeStreaming();
      }
      usingPcm.current = false;
      await recorder.record();
      if (sessionId.current !== currentSessionId) {
        await recorder.stop();
        return;
      }
      operation.current = "recording";
    } catch (e: any) {
      closeStreaming();
      if (usingPcm.current) void stopPcmCapture();
      usingPcm.current = false;
      setPcmRecording(false);
      setError(e?.message || "无法启动录音");
    } finally {
      if (operation.current === "starting") operation.current = "idle";
    }
  }, [closeStreaming, connectStreaming, recorder]);

  const stop = useCallback(async () => {
    if (operation.current === "idle" || operation.current === "stopping") return;
    operation.current = "stopping";
    sessionId.current += 1;
    try {
      if (usingPcm.current) {
        setPcmRecording(false);
        chunkSubscription.current?.remove();
        chunkSubscription.current = null;
        const base64 = await stopPcmCapture();
        usingPcm.current = false;
        closeStreaming();
        if (!base64) {
          setError("录音保存失败");
          return;
        }
        // 没有连续清晰人声时不把整段静音交给 ASR，避免模型凭底噪生成文字。
        if (!speechGate.current.detected) return;
        setTranscribing(true);
        const uri = await writePcmTemp(base64);
        const { text } = await sttOnce(uri, "pcm");
        if (text) resultCallback.current(text);
        return;
      }

      if (!state.isRecording) return;
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setError("录音保存失败");
        return;
      }
      setTranscribing(true);
      const { text } = await sttOnce(uri, recordingType());
      if (text) resultCallback.current(text);
    } catch (e: any) {
      setError(e?.message || "语音识别失败");
    } finally {
      setTranscribing(false);
      operation.current = "idle";
    }
  }, [closeStreaming, recorder, state.isRecording]);

  return {
    isRecording: usingPcm.current ? pcmRecording : state.isRecording,
    transcribing,
    error,
    durationMillis: state.durationMillis,
    start,
    stop,
  };
}
