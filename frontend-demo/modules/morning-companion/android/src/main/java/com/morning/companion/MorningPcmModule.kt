package com.morning.companion

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.os.Bundle
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import kotlin.concurrent.thread

/**
 * 麦克风裸 PCM 采集：16kHz / mono / PCM16。
 *
 * - 边采边通过 onAudioChunk 事件下发 base64 分片（约 100ms 一片，含音量 rms）——供实时通话流式转写用；
 * - stop() 返回整段录音的 base64 PCM——供「语音消息」一次性识别用。
 *
 * JS 侧通过 requireOptionalNativeModule("MorningPcm") 调用；采集前需先取得 RECORD_AUDIO 权限。
 */
class MorningPcmModule : Module() {
  private val sampleRate = 16000
  private val chunkBytes = 3200 // ~100ms @ 16k*16bit mono

  @Volatile private var recording = false
  private var recorder: AudioRecord? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var worker: Thread? = null
  private val fullBuffer = ByteArrayOutputStream()

  override fun definition() = ModuleDefinition {
    Name("MorningPcm")

    Events("onAudioChunk")

    AsyncFunction("start") {
      if (recording) return@AsyncFunction false

      val minBuf = AudioRecord.getMinBufferSize(
        sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
      )
      if (minBuf <= 0) return@AsyncFunction false
      val bufSize = maxOf(minBuf, sampleRate * 2)

      val rec = try {
        AudioRecord(
          // 通话源允许 Android/OEM 启用更适合扬声器双向通话的前处理链路。
          MediaRecorder.AudioSource.VOICE_COMMUNICATION,
          sampleRate,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT,
          bufSize
        )
      } catch (e: Exception) {
        null
      }
      if (rec == null || rec.state != AudioRecord.STATE_INITIALIZED) {
        rec?.release()
        return@AsyncFunction false
      }

      // AEC 能力随设备而异：可用则启用，不可用/初始化失败时由 JS 半双工门控兜底。
      echoCanceler = try {
        if (AcousticEchoCanceler.isAvailable()) {
          AcousticEchoCanceler.create(rec.audioSessionId)?.apply { enabled = true }
        } else {
          null
        }
      } catch (_: Exception) {
        null
      }

      recorder = rec
      synchronized(fullBuffer) { fullBuffer.reset() }
      recording = true
      try {
        rec.startRecording()
      } catch (_: Exception) {
        recording = false
        releaseEchoCanceler()
        recorder = null
        rec.release()
        return@AsyncFunction false
      }

      worker = thread(start = true, name = "morning-pcm") {
        val buf = ByteArray(chunkBytes)
        while (recording) {
          val n = rec.read(buf, 0, buf.size)
          if (n > 0) {
            synchronized(fullBuffer) { fullBuffer.write(buf, 0, n) }
            val b64 = Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
            val payload = Bundle().apply {
              putString("base64", b64)
              putDouble("rms", computeRms(buf, n))
            }
            sendEvent("onAudioChunk", payload)
          }
        }
      }
      true
    }

    AsyncFunction("stop") {
      recording = false
      worker?.join(500)
      worker = null
      releaseEchoCanceler()
      recorder?.let {
        try { it.stop() } catch (_: Exception) {}
        it.release()
      }
      recorder = null
      val bytes = synchronized(fullBuffer) { fullBuffer.toByteArray() }
      Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
  }

  private fun releaseEchoCanceler() {
    try {
      echoCanceler?.release()
    } catch (_: Exception) {
      // best-effort：录音停止不能被厂商音效实现拖垮
    }
    echoCanceler = null
  }

  /** 计算一片 PCM16 的归一化音量（0~1），用于通话页的音量律动 UI。 */
  private fun computeRms(buf: ByteArray, n: Int): Double {
    var sum = 0.0
    var i = 0
    while (i + 1 < n) {
      val sample = ((buf[i].toInt() and 0xff) or (buf[i + 1].toInt() shl 8)).toShort().toInt()
      sum += sample.toDouble() * sample.toDouble()
      i += 2
    }
    val count = (n / 2).coerceAtLeast(1)
    return Math.sqrt(sum / count) / 32768.0
  }
}
