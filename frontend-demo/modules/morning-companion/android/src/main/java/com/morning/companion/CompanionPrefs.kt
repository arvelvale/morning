package com.morning.companion

import android.content.Context

/**
 * 常驻陪伴 / 悬浮桌宠的本机状态（SharedPreferences）。
 *
 * - enabled：JS 侧希望服务在跑（已登录且「常驻陪伴」开着）。开机、更新应用后据此自动拉起。
 * - paused：用户点了通知上的「暂停陪伴」。暂停期间开机、重启 App 都不再自动拉起，
 *   直到用户在设置里重新打开（JS 以 force=true 启动才清除）。
 */
object CompanionPrefs {
  private const val NAME = "morning_companion"

  /** 悬浮桌宠被点击后要去的页面（进程内一次性交接，JS 回到前台时取走）：mailbox / null。 */
  @Volatile
  var pendingTarget: String? = null

  private fun p(c: Context) = c.getSharedPreferences(NAME, Context.MODE_PRIVATE)

  fun enabled(c: Context) = p(c).getBoolean("enabled", false)
  fun setEnabled(c: Context, v: Boolean) = p(c).edit().putBoolean("enabled", v).apply()

  fun paused(c: Context) = p(c).getBoolean("paused", false)
  fun setPaused(c: Context, v: Boolean) = p(c).edit().putBoolean("paused", v).apply()

  fun petName(c: Context) = p(c).getString("petName", null) ?: "米露"
  fun petKind(c: Context) = p(c).getString("petKind", null) ?: "miro"
  fun setPet(c: Context, name: String?, kind: String?) {
    val e = p(c).edit()
    if (!name.isNullOrBlank()) e.putString("petName", name)
    if (!kind.isNullOrBlank()) e.putString("petKind", kind)
    e.apply()
  }

  fun unread(c: Context) = p(c).getInt("unread", 0)
  fun setUnread(c: Context, n: Int) = p(c).edit().putInt("unread", n.coerceAtLeast(0)).apply()

  fun overlayEnabled(c: Context) = p(c).getBoolean("overlay", false)
  fun setOverlayEnabled(c: Context, v: Boolean) = p(c).edit().putBoolean("overlay", v).apply()

  /** 悬浮桌宠停靠的一边（true=右）与高度占屏幕高度的比例，转屏、换分辨率后仍能摆回原处。 */
  fun overlayRight(c: Context) = p(c).getBoolean("overlayRight", true)
  fun overlayYFraction(c: Context) = p(c).getFloat("overlayY", 0.30f)
  fun setOverlayDock(c: Context, right: Boolean, yFraction: Float) =
    p(c).edit().putBoolean("overlayRight", right).putFloat("overlayY", yFraction.coerceIn(0f, 1f)).apply()

  /** 长按悬浮桌宠「先收起一会儿」：到这个时刻之前不显示。 */
  fun hiddenUntil(c: Context) = p(c).getLong("hiddenUntil", 0L)
  fun setHiddenUntil(c: Context, ms: Long) = p(c).edit().putLong("hiddenUntil", ms).apply()
}
