package com.morning.companion

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.Activity
import android.app.Application
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.Toast
import java.util.Calendar
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * 悬浮米露：在别的 App 上面停一只小桌宠（「显示在其他应用上层」权限）。
 *
 * - 只在喵灵自己不在前台时显示（数「已开始」的 Activity，进了喵灵就收起、出来再现身）。
 * - 可拖动，松手吸到左右边；位置按「哪一边 + 高度比例」记，转屏后摆回原处。
 * - 点一下回到喵灵（有没看的信就直接去信箱）；长按「先收起 1 小时」，到点自己回来。
 * - 有没看的信时角上一个橙色小点；新来信时轻轻晃一下。
 * - 23:00–07:00 换成睡觉的样子。
 * - 不需要权限时（没授权 / 没开）什么都不画，也不报错。
 *
 * 所有方法都在主线程调用（Service 的回调与 Activity 生命周期回调都在主线程）。
 */
class FloatingPet(private val app: Application) {
  private val wm = app.getSystemService(android.content.Context.WINDOW_SERVICE) as WindowManager
  private val density = app.resources.displayMetrics.density
  private val handler = Handler(Looper.getMainLooper())
  private val boxPx = dp(72f)
  private val spritePx = dp(64f)

  private var startedActivities = 0
  private var root: FrameLayout? = null
  private var sprite: ImageView? = null
  private var badge: View? = null
  private var params: WindowManager.LayoutParams? = null
  private var snapAnim: ValueAnimator? = null
  private var attached = false

  private val showAgain = Runnable { sync() }

  private val lifecycle = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityStarted(activity: Activity) {
      startedActivities++
      sync()
    }

    override fun onActivityStopped(activity: Activity) {
      startedActivities = (startedActivities - 1).coerceAtLeast(0)
      sync()
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
  }

  fun attach() {
    if (attached) return
    attached = true
    app.registerActivityLifecycleCallbacks(lifecycle)
    sync()
  }

  fun detach() {
    handler.removeCallbacks(showAgain)
    if (attached) runCatching { app.unregisterActivityLifecycleCallbacks(lifecycle) }
    attached = false
    remove()
  }

  /** 按当前设置、权限、前后台状态决定显示还是收起。 */
  fun sync() {
    val now = System.currentTimeMillis()
    val hiddenUntil = CompanionPrefs.hiddenUntil(app)
    handler.removeCallbacks(showAgain)
    if (hiddenUntil > now) handler.postDelayed(showAgain, hiddenUntil - now + 500)
    val want = attached &&
      CompanionPrefs.overlayEnabled(app) &&
      canDraw() &&
      startedActivities == 0 &&
      now >= hiddenUntil
    if (want) show() else remove()
  }

  /** 未读数、桌宠换了、新来信：刷新外观；[wiggle] 为 true 时晃一下提醒。 */
  fun update(wiggle: Boolean) {
    refreshLook()
    if (wiggle) wiggleOnce()
  }

  private fun canDraw(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(app)

  private fun dp(v: Float) = (v * density).roundToInt()

  private fun screenW() = app.resources.displayMetrics.widthPixels
  private fun screenH() = app.resources.displayMetrics.heightPixels

  private fun spriteRes(): Int {
    val h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    val sleeping = h >= 23 || h < 7
    return when (CompanionPrefs.petKind(app)) {
      "bobi" -> if (sleeping) R.drawable.pet_bobi_sleep else R.drawable.pet_bobi_idle
      else -> if (sleeping) R.drawable.pet_miro_sleep else R.drawable.pet_miro_idle
    }
  }

  private fun refreshLook() {
    sprite?.setImageResource(spriteRes())
    badge?.visibility = if (CompanionPrefs.unread(app) > 0) View.VISIBLE else View.GONE
  }

  private fun wiggleOnce() {
    val v = sprite ?: return
    ObjectAnimator.ofFloat(v, View.ROTATION, 0f, -12f, 12f, -8f, 8f, 0f).apply { duration = 700 }.start()
  }

  private fun show() {
    if (root != null) {
      refreshLook()
      return
    }
    val box = FrameLayout(app)
    val img = ImageView(app).apply {
      scaleType = ImageView.ScaleType.FIT_CENTER
      setImageResource(spriteRes())
    }
    box.addView(img, FrameLayout.LayoutParams(spritePx, spritePx, Gravity.CENTER))
    val dot = View(app).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(0xFFE5603F.toInt())
        setStroke(dp(2f), Color.WHITE)
      }
      visibility = if (CompanionPrefs.unread(app) > 0) View.VISIBLE else View.GONE
    }
    box.addView(
      dot,
      FrameLayout.LayoutParams(dp(14f), dp(14f), Gravity.TOP or Gravity.END).apply {
        topMargin = dp(4f)
        rightMargin = dp(4f)
      },
    )

    val right = CompanionPrefs.overlayRight(app)
    val lp = WindowManager.LayoutParams(
      boxPx,
      boxPx,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
      },
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = if (right) screenW() - boxPx else 0
      y = (CompanionPrefs.overlayYFraction(app) * (screenH() - boxPx)).roundToInt().coerceIn(0, screenH() - boxPx)
    }

    box.setOnTouchListener(DragListener(lp))
    try {
      wm.addView(box, lp)
    } catch (e: RuntimeException) {
      // 权限刚被收回、系统不允许：当作没有悬浮窗，不影响其余功能
      return
    }
    root = box
    sprite = img
    badge = dot
    params = lp
  }

  private fun remove() {
    snapAnim?.cancel()
    snapAnim = null
    root?.let { runCatching { wm.removeViewImmediate(it) } }
    root = null
    sprite = null
    badge = null
    params = null
  }

  private fun openApp() {
    CompanionPrefs.pendingTarget = if (CompanionPrefs.unread(app) > 0) "mailbox" else null
    val intent = app.packageManager.getLaunchIntentForPackage(app.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    } ?: return
    runCatching { app.startActivity(intent) }
  }

  private fun hideForAWhile() {
    CompanionPrefs.setHiddenUntil(app, System.currentTimeMillis() + HIDE_MS)
    Toast.makeText(app, "${CompanionPrefs.petName(app)}先去睡一会儿，1 小时后回来", Toast.LENGTH_SHORT).show()
    sync()
  }

  private fun snapToEdge(lp: WindowManager.LayoutParams) {
    val view = root ?: return
    val toRight = lp.x + boxPx / 2 > screenW() / 2
    val targetX = if (toRight) screenW() - boxPx else 0
    snapAnim?.cancel()
    snapAnim = ValueAnimator.ofInt(lp.x, targetX).apply {
      duration = 180
      addUpdateListener {
        lp.x = it.animatedValue as Int
        if (root === view) runCatching { wm.updateViewLayout(view, lp) }
      }
      start()
    }
    val room = (screenH() - boxPx).coerceAtLeast(1)
    CompanionPrefs.setOverlayDock(app, toRight, lp.y.toFloat() / room)
  }

  /** 拖动 / 点按 / 长按的判断：先超过系统的触摸阈值算拖动，没动且时间够长算长按，其余算点按。 */
  private inner class DragListener(private val lp: WindowManager.LayoutParams) : View.OnTouchListener {
    private val slop = ViewConfiguration.get(app).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false
    private var longPressed = false
    private val longPress = Runnable {
      longPressed = true
      root?.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
      hideForAWhile()
    }

    override fun onTouch(v: View, e: MotionEvent): Boolean {
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          snapAnim?.cancel()
          downX = e.rawX
          downY = e.rawY
          startX = lp.x
          startY = lp.y
          dragging = false
          longPressed = false
          handler.postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong() + 200)
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - downX
          val dy = e.rawY - downY
          if (!dragging && hypot(dx, dy) > slop) {
            dragging = true
            handler.removeCallbacks(longPress)
          }
          if (dragging) {
            lp.x = (startX + dx).roundToInt().coerceIn(0, screenW() - boxPx)
            lp.y = (startY + dy).roundToInt().coerceIn(0, screenH() - boxPx)
            runCatching { wm.updateViewLayout(v, lp) }
          }
        }
        MotionEvent.ACTION_UP -> {
          handler.removeCallbacks(longPress)
          when {
            longPressed -> Unit
            dragging -> snapToEdge(lp)
            else -> openApp()
          }
        }
        MotionEvent.ACTION_CANCEL -> {
          handler.removeCallbacks(longPress)
          if (dragging) snapToEdge(lp)
        }
      }
      return true
    }
  }

  companion object {
    private const val HIDE_MS = 60 * 60 * 1000L
  }
}
