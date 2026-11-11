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
import android.os.PowerManager
import android.util.Log

/**
 * 常驻陪伴前台服务：状态栏保留一条安静的通知「{petName}在陪着你」，带「暂停陪伴」「打开喵灵」。
 *
 * 它做三件事：
 * 1. 保活：前台服务让系统不轻易杀掉进程；
 * 2. 后台收信：RN 的 JS 定时器在 App 退到后台后会停（JavaTimerManager 在 host pause 时清掉帧回调），
 *    所以由这里的 Handler 每隔一阵起一次很短的无头 JS 任务（[LetterPollTaskService]）去拉信箱，
 *    亮屏 60 秒一次，息屏 5 分钟一次（息屏时系统本来也会限制网络，拉得勤没有意义）；
 * 3. 托管悬浮米露（[FloatingPet]）。
 *
 * 点「暂停陪伴」：记下「已暂停」并停止服务；开机、重启 App 都不再自动拉起，直到用户在设置里重新打开。
 */
class CompanionForegroundService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var running = false
  private var floatingPet: FloatingPet? = null

  private val pollTick = object : Runnable {
    override fun run() {
      pollNow()
      handler.postDelayed(this, nextDelayMs())
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    isRunning = true
    // Fulfil startForegroundService's deadline before any start/stop intent is handled.
    startInForeground()
    floatingPet = FloatingPet(application).also { it.attach() }
    Log.i(TAG, "Created and promoted to foreground")
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        CompanionPrefs.setPaused(this, true)
        shutdown()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelfResult(startId)
        return START_NOT_STICKY
      }
      ACTION_UPDATE -> {
        // 未读数 / 桌宠 / 新来信：状态已由模块写进 CompanionPrefs，这里只刷新显示
        updateNotification()
        floatingPet?.update(intent.getBooleanExtra(EXTRA_WIGGLE, false))
      }
      ACTION_SYNC -> floatingPet?.sync()
    }

    if (!running) {
      startInForeground()
      running = true
      handler.post(pollTick)
    } else {
      // A repeated foreground start must also acknowledge the system request.
      startInForeground()
    }
    Log.i(TAG, "Foreground start acknowledged: $startId")
    return START_STICKY
  }

  override fun onDestroy() {
    shutdown()
    stopForeground(STOP_FOREGROUND_REMOVE)
    isRunning = false
    Log.i(TAG, "Destroyed")
    super.onDestroy()
  }

  private fun shutdown() {
    running = false
    handler.removeCallbacks(pollTick)
    floatingPet?.detach()
    floatingPet = null
  }

  /** 起一次短的无头 JS 任务去拉信；后台限制起不来时吞掉异常，下个周期再试。 */
  private fun pollNow() {
    runCatching { startService(Intent(this, LetterPollTaskService::class.java)) }
      .onFailure { Log.w(TAG, "poll task not started", it) }
  }

  private fun nextDelayMs(): Long {
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    return if (pm.isInteractive) POLL_INTERACTIVE_MS else POLL_IDLE_MS
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

    val petName = CompanionPrefs.petName(this)
    val unread = CompanionPrefs.unread(this)
    val text = if (unread > 0) "有 $unread 封信还没看，点开看看" else "有新来信和提醒，我会第一时间告诉你"

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("${petName}在陪着你")
      .setContentText(text)
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
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
      description = "喵灵在后台陪着你、帮你收信的常驻通知（安静、不打扰）"
      enableVibration(false)
      setShowBadge(false)
    }
    notificationManager.createNotificationChannel(channel)
  }

  private fun immutableFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

  companion object {
    private const val TAG = "MorningCompanion"
    const val ACTION_START = "com.morning.companion.START"
    const val ACTION_STOP = "com.morning.companion.STOP"
    const val ACTION_UPDATE = "com.morning.companion.UPDATE"
    const val ACTION_SYNC = "com.morning.companion.SYNC"
    const val EXTRA_PET_NAME = "pet_name"
    const val EXTRA_WIGGLE = "wiggle"
    const val CHANNEL_ID = "morning_companion_foreground"
    private const val NOTIFICATION_ID = 41000
    private const val POLL_INTERACTIVE_MS = 60_000L
    private const val POLL_IDLE_MS = 5 * 60_000L

    /** 服务是否在跑（模块据此决定要不要给它发更新）；进程被杀时随进程一起复位。 */
    @Volatile
    var isRunning = false
  }
}
