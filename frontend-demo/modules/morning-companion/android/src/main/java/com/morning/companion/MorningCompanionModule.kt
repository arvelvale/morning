package com.morning.companion

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 常驻陪伴前台服务①的原生入口。JS 侧通过 requireOptionalNativeModule("MorningCompanion") 调用。
 */
class MorningCompanionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MorningCompanion")

    AsyncFunction("startCompanionService") { petName: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      val intent = Intent(ctx, CompanionForegroundService::class.java).apply {
        action = CompanionForegroundService.ACTION_START
        putExtra(CompanionForegroundService.EXTRA_PET_NAME, petName)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      true
    }

    AsyncFunction("stopCompanionService") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      // Stopping must never instantiate a service during the app's initial token load.
      ctx.stopService(Intent(ctx, CompanionForegroundService::class.java))
      true
    }
  }
}
