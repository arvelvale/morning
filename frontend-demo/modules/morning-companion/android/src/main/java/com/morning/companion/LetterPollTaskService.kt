package com.morning.companion

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * 后台拉信的无头 JS 任务宿主：由 [CompanionForegroundService] 定时拉起，
 * 在 JS 里执行 AppRegistry.registerHeadlessTask("MorningLetterPoll", …) 注册的那个函数（src/notifications.ts）。
 *
 * 每次只跑一轮、带超时（25 秒）。无头任务运行期间 RN 会持有 WAKE_LOCK，所以不能做成一个不退出的循环。
 * allowedInForeground=true：App 在前台时也允许跑（JS 侧有防重入与最短间隔，不会重复请求、重复通知）。
 */
class LetterPollTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), TIMEOUT_MS, true)

  companion object {
    const val TASK_KEY = "MorningLetterPoll"
    private const val TIMEOUT_MS = 25_000L
  }
}
