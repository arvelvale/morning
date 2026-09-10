package com.morning.updater

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import java.io.File

internal object UpdateDownloadStore {
  private const val PREFS = "morning_updater"
  private const val KEY_DOWNLOAD_ID = "download_id"
  private const val KEY_URL = "download_url"
  private const val KEY_VERSION = "download_version"
  private const val KEY_FILE_PATH = "download_file_path"
  private const val KEY_INSTALL_REQUESTED = "install_requested"

  data class Record(
    val id: Long,
    val url: String,
    val version: String,
    val filePath: String,
  )

  fun read(context: Context): Record? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val id = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
    val url = prefs.getString(KEY_URL, null)
    val version = prefs.getString(KEY_VERSION, null)
    val filePath = prefs.getString(KEY_FILE_PATH, null)
    if (id <= 0 || url.isNullOrBlank() || version.isNullOrBlank() || filePath.isNullOrBlank()) {
      return null
    }
    return Record(id, url, version, filePath)
  }

  fun write(context: Context, record: Record) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putLong(KEY_DOWNLOAD_ID, record.id)
      .putString(KEY_URL, record.url)
      .putString(KEY_VERSION, record.version)
      .putString(KEY_FILE_PATH, record.filePath)
      .putBoolean(KEY_INSTALL_REQUESTED, false)
      .apply()
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }

  fun markInstallRequested(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(KEY_INSTALL_REQUESTED, true)
      .apply()
  }

  fun consumeInstallRequested(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val requested = prefs.getBoolean(KEY_INSTALL_REQUESTED, false)
    if (requested) prefs.edit().putBoolean(KEY_INSTALL_REQUESTED, false).apply()
    return requested
  }

  fun query(context: Context, record: Record? = read(context)): Map<String, Any?> {
    if (record == null) return idleState()
    val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    val cursor = manager.query(DownloadManager.Query().setFilterById(record.id))
    cursor.use {
      if (!it.moveToFirst()) return idleState()
      val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
      val written = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
        .coerceAtLeast(0L)
      val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
      val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
      val localFile = File(record.filePath)
      val fileUri = if (localFile.isFile) Uri.fromFile(localFile).toString() else null
      return mapOf(
        "taskId" to record.id.toString(),
        "status" to statusName(status),
        "bytesWritten" to written.toDouble(),
        "totalBytes" to total.coerceAtLeast(0L).toDouble(),
        "progress" to if (total > 0) (written.toDouble() / total).coerceIn(0.0, 1.0) else 0.0,
        "fileUri" to fileUri,
        "reason" to reason.toDouble(),
        "version" to record.version,
      )
    }
  }

  fun isActiveOrComplete(context: Context, record: Record): Boolean {
    val status = query(context, record)["status"] as? String
    return status in setOf("pending", "running", "paused", "successful")
  }

  private fun idleState(): Map<String, Any?> = mapOf(
    "taskId" to null,
    "status" to "idle",
    "bytesWritten" to 0.0,
    "totalBytes" to 0.0,
    "progress" to 0.0,
    "fileUri" to null,
    "reason" to null,
    "version" to null,
  )

  private fun statusName(status: Int): String = when (status) {
    DownloadManager.STATUS_PENDING -> "pending"
    DownloadManager.STATUS_RUNNING -> "running"
    DownloadManager.STATUS_PAUSED -> "paused"
    DownloadManager.STATUS_SUCCESSFUL -> "successful"
    DownloadManager.STATUS_FAILED -> "failed"
    else -> "idle"
  }
}
