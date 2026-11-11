package com.morning.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * 开机、应用更新后自动把常驻陪伴拉起来（否则要用户再打开一次喵灵才恢复）。
 * 只在「JS 曾要求运行（已登录且开着）且用户没点过暂停」时才拉起；其余情况什么都不做。
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!CompanionPrefs.enabled(context) || CompanionPrefs.paused(context)) return
    val start = Intent(context, CompanionForegroundService::class.java).apply {
      this.action = CompanionForegroundService.ACTION_START
    }
    runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(start) else context.startService(start)
    }.onFailure { Log.w("MorningCompanion", "restore after $action failed", it) }
  }
}
