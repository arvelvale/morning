package com.morning.updater

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/**
 * 自有服务器 APK 更新的 Android 安装桥接。
 *
 * 下载由 JS 侧 expo-file-system 完成；本模块只接受当前 App 私有目录里的 APK，随后校验：
 * 文件大小 → SHA-256 → applicationId → versionCode → 签名证书，最后交给系统安装器。
 * 普通应用不能静默安装；Android 8+ 未授权时返回 permission_required。
 */
class MorningUpdaterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MorningUpdater")

    AsyncFunction("startDownload") { url: String, versionName: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android 上下文尚未就绪")
      val uri = Uri.parse(url)
      if (uri.scheme !in setOf("http", "https")) {
        throw IllegalArgumentException("安装包地址必须使用 HTTP 或 HTTPS")
      }
      val safeVersion = versionName.replace(Regex("[^0-9A-Za-z._-]"), "_")
        .ifBlank { "latest" }
      val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      val existing = UpdateDownloadStore.read(context)
      if (
        existing != null &&
        existing.url == url &&
        existing.version == safeVersion &&
        UpdateDownloadStore.isActiveOrComplete(context, existing)
      ) {
        return@AsyncFunction UpdateDownloadStore.query(context, existing)
      }

      if (existing != null) {
        manager.remove(existing.id)
        File(existing.filePath).takeIf { it.isFile }?.delete()
      }

      val downloadsDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        ?: throw IllegalStateException("无法访问应用下载目录")
      downloadsDir.mkdirs()
      val destination = File(downloadsDir, "morning-$safeVersion.apk")
      if (destination.exists() && !destination.delete()) {
        throw IllegalStateException("无法清理旧安装包，请稍后重试")
      }

      val request = DownloadManager.Request(uri)
        .setTitle("喵灵 v$safeVersion")
        .setDescription("安装包下载完成后，点击通知即可安装")
        .setMimeType(APK_MIME)
        .setAllowedOverMetered(true)
        .setAllowedOverRoaming(false)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationUri(Uri.fromFile(destination))
      val id = manager.enqueue(request)
      val record = UpdateDownloadStore.Record(id, url, safeVersion, destination.absolutePath)
      UpdateDownloadStore.write(context, record)
      UpdateDownloadStore.query(context, record)
    }

    AsyncFunction("getDownloadState") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android 上下文尚未就绪")
      UpdateDownloadStore.query(context)
    }

    AsyncFunction("consumeNotificationInstallRequest") {
      val context = appContext.reactContext
        ?: return@AsyncFunction false
      UpdateDownloadStore.consumeInstallRequested(context)
    }

    AsyncFunction("canRequestPackageInstalls") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      canInstallPackages(context.packageManager)
    }

    AsyncFunction("openInstallPermissionSettings") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@AsyncFunction true
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}")
      ).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
      true
    }

    AsyncFunction("inspectAndInstall") {
        fileUri: String,
        expectedSha256: String?,
        expectedSizeBytes: Double? ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android 上下文尚未就绪")
      val apk = resolvePrivateApk(context, fileUri)

      val sizeBytes = apk.length()
      val expectedSize = expectedSizeBytes?.toLong()?.takeIf { it > 0 }
      if (expectedSize != null && sizeBytes != expectedSize) {
        throw IllegalArgumentException("APK 文件大小校验失败，请重新下载")
      }

      val actualSha256 = sha256(apk)
      val expectedHash = expectedSha256?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
      if (expectedHash != null && actualSha256 != expectedHash) {
        throw IllegalArgumentException("APK 完整性校验失败，请重新下载")
      }

      val packageManager = context.packageManager
      val archive = archivePackageInfo(packageManager, apk)
        ?: throw IllegalArgumentException("下载的文件不是有效的 Android 安装包")
      if (archive.packageName != context.packageName) {
        throw IllegalArgumentException("安装包身份不匹配，已阻止安装")
      }

      val current = currentPackageInfo(packageManager, context.packageName)
      val archiveVersionCode = versionCodeOf(archive)
      val currentVersionCode = versionCodeOf(current)
      if (archiveVersionCode <= currentVersionCode) {
        throw IllegalArgumentException("下载的版本不比当前版本新")
      }

      val archiveSignatures = signatureDigests(archive)
      val currentSignatures = signatureDigests(current)
      if (archiveSignatures.isEmpty() || currentSignatures.isEmpty() || archiveSignatures != currentSignatures) {
        throw SecurityException("安装包签名与当前应用不一致，已阻止安装")
      }

      val result = mutableMapOf<String, Any?>(
        "packageName" to archive.packageName,
        "versionCode" to archiveVersionCode.toDouble(),
        "versionName" to archive.versionName,
        "sha256" to actualSha256,
        "sizeBytes" to sizeBytes.toDouble(),
      )

      if (!canInstallPackages(packageManager)) {
        result["status"] = "permission_required"
        return@AsyncFunction result
      }

      val contentUri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.morning-updater-provider",
        apk,
      )
      val installIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, APK_MIME)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      context.startActivity(installIntent)
      result["status"] = "installer_opened"
      result
    }
  }

  private fun canInstallPackages(packageManager: PackageManager): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()

  private fun resolvePrivateApk(context: android.content.Context, fileUri: String): File {
    val uri = Uri.parse(fileUri)
    if (uri.scheme != "file" || uri.path.isNullOrBlank()) {
      throw IllegalArgumentException("只允许安装应用自己下载的本地 APK")
    }
    val file = File(requireNotNull(uri.path)).canonicalFile
    if (!file.isFile || !file.name.endsWith(".apk", ignoreCase = true)) {
      throw IllegalArgumentException("找不到已下载的 APK 文件")
    }

    val roots = listOfNotNull(
      context.filesDir,
      context.cacheDir,
      context.externalCacheDir,
      context.getExternalFilesDir(null),
    ).map { it.canonicalFile }
    val insidePrivateRoot = roots.any { root ->
      file.path == root.path || file.path.startsWith(root.path + File.separator)
    }
    if (!insidePrivateRoot) {
      throw SecurityException("APK 不在应用私有目录，已阻止安装")
    }
    return file
  }

  private fun archivePackageInfo(packageManager: PackageManager, apk: File): PackageInfo? {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      @Suppress("DEPRECATION")
      PackageManager.GET_SIGNATURES
    }
    return packageManager.getPackageArchiveInfo(apk.absolutePath, flags)
  }

  private fun currentPackageInfo(packageManager: PackageManager, packageName: String): PackageInfo {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      @Suppress("DEPRECATION")
      PackageManager.GET_SIGNATURES
    }
    return packageManager.getPackageInfo(packageName, flags)
  }

  private fun versionCodeOf(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode
    else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }

  private fun signatureDigests(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.signingInfo?.apkContentsSigners?.toList().orEmpty()
    } else {
      @Suppress("DEPRECATION")
      info.signatures?.toList().orEmpty()
    }
    return signatures.map { signature ->
      MessageDigest.getInstance("SHA-256")
        .digest(signature.toByteArray())
        .joinToString("") { "%02x".format(it) }
    }.toSet()
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  companion object {
    private const val APK_MIME = "application/vnd.android.package-archive"
  }
}
