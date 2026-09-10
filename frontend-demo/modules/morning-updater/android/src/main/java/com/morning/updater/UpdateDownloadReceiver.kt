package com.morning.updater

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 用户点击 DownloadManager 的“下载完成”通知后回到喵灵。
 * JS 恢复时先做大小、SHA-256、包名和签名校验，再打开系统安装器。
 */
class UpdateDownloadReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != DownloadManager.ACTION_NOTIFICATION_CLICKED) return
    val record = UpdateDownloadStore.read(context) ?: return
    val clickedIds = intent.getLongArrayExtra(DownloadManager.EXTRA_NOTIFICATION_CLICK_DOWNLOAD_IDS)
      ?: return
    if (!clickedIds.contains(record.id)) return

    UpdateDownloadStore.markInstallRequested(context)
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    context.startActivity(launchIntent)
  }
}
