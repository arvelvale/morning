package com.morning.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log

/**
 * 常驻陪伴前台服务：状态栏保留一条安静的通知
 * 「{petName}正在陪伴你 · 已运行 X 分钟」，带「暂停陪伴」「打开喵灵」两个按钮。
 * 每 60s 刷新一次运行时长；点「暂停陪伴」即停止服务并移除通知。
 */
class CompanionForegroundService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var startedAtMs = 0L
  private var petName = "米露"
  private var running = false

  private val tick = object : Runnable {
    override fun run() {
      updateNotification()
      handler.postDelayed(this, REFRESH_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    startedAtMs = System.currentTimeMillis()
    // Fulfil startForegroundService's deadline before any start/stop intent is handled.
    startInForeground()
    Log.i(TAG, "Created and promoted to foreground")
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopTicking()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelfResult(startId)
      return START_NOT_STICKY
    }

    intent?.getStringExtra(EXTRA_PET_NAME)?.takeIf { it.isNotBlank() }?.let { petName = it }

    if (!running) {
      startInForeground()
      running = true
      handler.postDelayed(tick, REFRESH_MS)
    } else {
      // A repeated foreground start must also acknowledge the system request.
      startInForeground()
    }
    Log.i(TAG, "Foreground start acknowledged: $startId")
    return START_STICKY
  }

  override fun onDestroy() {
    stopTicking()
    stopForeground(STOP_FOREGROUND_REMOVE)
    Log.i(TAG, "Destroyed")
    super.onDestroy()
  }

  private fun stopTicking() {
    running = false
    handler.removeCallbacks(tick)
  }

  private fun startInForeground() {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun updateNotification() {
    if (!running) return
    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notificationManager.notify(NOTIFICATION_ID, buildNotification())
  }

  private fun buildNotification(): Notification {
    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    ensureChannel(notificationManager)

    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val contentIntent = PendingIntent.getActivity(
      this,
      41001,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )

    val stopIntent = Intent(this, CompanionForegroundService::class.java).apply { action = ACTION_STOP }
    val stopPendingIntent = PendingIntent.getService(
      this,
      41002,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("${petName}正在陪伴你")
      .setContentText("已运行 ${elapsedText()}")
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_SERVICE)
      .addAction(0, "暂停陪伴", stopPendingIntent)
      .addAction(0, "打开喵灵", contentIntent)

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      @Suppress("DEPRECATION")
      builder.setPriority(Notification.PRIORITY_LOW)
    }
    return builder.build()
  }

  private fun ensureChannel(notificationManager: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (notificationManager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "陪伴常驻",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Morning 陪伴运行时的常驻通知（安静、不打扰）"
      enableVibration(false)
      setShowBadge(false)
    }
    notificationManager.createNotificationChannel(channel)
  }

  private fun elapsedText(): String {
    val minutes = ((System.currentTimeMillis() - startedAtMs) / 60_000L).coerceAtLeast(0)
    val hours = minutes / 60
    val rest = minutes % 60
    return if (hours > 0) "${hours}小时${rest}分钟" else "${rest}分钟"
  }

  private fun immutableFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

  companion object {
    private const val TAG = "MorningCompanion"
    const val ACTION_START = "com.morning.companion.START"
    const val ACTION_STOP = "com.morning.companion.STOP"
    const val EXTRA_PET_NAME = "pet_name"
    const val CHANNEL_ID = "morning_companion_foreground"
    private const val NOTIFICATION_ID = 41000
    private const val REFRESH_MS = 60_000L
  }
}
