package com.morning.companion

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 常驻陪伴 + 悬浮米露的原生入口。JS 侧通过 requireOptionalNativeModule("MorningCompanion") 调用。
 */
class MorningCompanionModule : Module() {
  private fun ctx(): Context? = appContext.reactContext

  private fun startService(c: Context, action: String, configure: Intent.() -> Unit = {}) {
    val intent = Intent(c, CompanionForegroundService::class.java).apply {
      this.action = action
      configure()
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(intent) else c.startService(intent)
  }

  /** 服务在跑时才给它发更新；没在跑就只写本机状态，下次拉起时读取。 */
  private fun pushToService(c: Context, action: String, configure: Intent.() -> Unit = {}) {
    if (!CompanionForegroundService.isRunning) return
    startService(c, action, configure)
  }

  override fun definition() = ModuleDefinition {
    Name("MorningCompanion")

    /** force=true 表示用户明确要开（设置里的开关），会清掉「已暂停」；默认遵守暂停。 */
    AsyncFunction("startCompanionService") { petName: String, petKind: String?, force: Boolean? ->
      val c = ctx() ?: return@AsyncFunction false
      CompanionPrefs.setEnabled(c, true)
      CompanionPrefs.setPet(c, petName, petKind)
      if (force == true) CompanionPrefs.setPaused(c, false)
      if (CompanionPrefs.paused(c)) return@AsyncFunction false
      startService(c, CompanionForegroundService.ACTION_START) {
        putExtra(CompanionForegroundService.EXTRA_PET_NAME, petName)
      }
      true
    }

    AsyncFunction("stopCompanionService") {
      val ctx = ctx() ?: return@AsyncFunction false
      CompanionPrefs.setEnabled(ctx, false)
      // Stopping must never instantiate a service during the app's initial token load.
      ctx.stopService(Intent(ctx, CompanionForegroundService::class.java))
      true
    }

    AsyncFunction("isCompanionPaused") {
      val c = ctx() ?: return@AsyncFunction false
      CompanionPrefs.paused(c)
    }

    AsyncFunction("hasOverlayPermission") {
      val c = ctx() ?: return@AsyncFunction false
      Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(c)
    }

    /** 打开系统里「显示在其他应用上层」的授权页（只能让用户自己去开）。 */
    AsyncFunction("requestOverlayPermission") {
      val c = ctx() ?: return@AsyncFunction false
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${c.packageName}")).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      runCatching { c.startActivity(intent) }.isSuccess
    }

    AsyncFunction("setOverlayEnabled") { enabled: Boolean ->
      val c = ctx() ?: return@AsyncFunction false
      CompanionPrefs.setOverlayEnabled(c, enabled)
      if (enabled) CompanionPrefs.setHiddenUntil(c, 0L)
      pushToService(c, CompanionForegroundService.ACTION_SYNC)
      true
    }

    /** 同步桌宠与未读数：通知文案、悬浮米露的小红点与外观；wiggle=true 表示刚来了新信，晃一下。 */
    AsyncFunction("updateCompanionState") { unread: Int, petName: String?, petKind: String?, wiggle: Boolean? ->
      val c = ctx() ?: return@AsyncFunction false
      CompanionPrefs.setUnread(c, unread)
      CompanionPrefs.setPet(c, petName, petKind)
      pushToService(c, CompanionForegroundService.ACTION_UPDATE) {
        putExtra(CompanionForegroundService.EXTRA_WIGGLE, wiggle == true)
      }
      true
    }

    /** 取走「点悬浮米露要去哪」的一次性交接（回到前台时调用）；没有就返回 null。 */
    AsyncFunction("consumeLaunchTarget") {
      val target = CompanionPrefs.pendingTarget
      CompanionPrefs.pendingTarget = null
      target
    }
  }
}
