"""Morning 后端入口：AI 网关 + 双轴记忆系统。

启动：cd backend && uv run uvicorn app.main:app --reload
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.logging import install_access_token_redaction
from app.db import Base, engine
from app.routers.ai import chat, realtime, stt
from app.routers.scene import candidates, role_profiles, scenes, theater_ext
from app.routers.mailbox import ephemeral, letters, mailbox, reminders, treasures
from app.routers.companion import companion, conversations, handoffs, pets
from app.routers.memory import brain_dumps, memory, memory_review, profile, signals, stores
from app.routers.system import app_version, auth, debug, preferences, weather

settings = get_settings()
logger = logging.getLogger(__name__)
install_access_token_redaction()

# 生产环境安全底线：默认 JWT 密钥可伪造任意用户 token，禁止带它上线
_DEFAULT_JWT_SECRET = "dev-only-change-me"
if settings.app_env == "prod" and settings.jwt_secret == _DEFAULT_JWT_SECRET:
    raise RuntimeError("APP_ENV=prod 时必须通过 .env 设置 JWT_SECRET（默认密钥可伪造 token）")
if settings.jwt_secret == _DEFAULT_JWT_SECRET:
    logging.getLogger(__name__).warning("[security] 正在使用默认 JWT 密钥，仅限本地开发")

# 做梦 Agent 定时触发时间（默认凌晨 0 点，UTC）
DREAM_HOUR = 0
DREAM_MINUTE = 0

# 晚间来信定时触发时间（东八区 21:30，产品面向国内用户固定时区）
CST = timezone(timedelta(hours=8))
EVENING_HOUR = 21
EVENING_MINUTE = 30

# 每周周报触发时间（东八区周日 20:00）。weekday: 周一=0 … 周日=6
WEEKLY_WEEKDAY = 6
WEEKLY_HOUR = 20
WEEKLY_MINUTE = 0

# 主动信号扫描间隔（秒）。5 分钟一轮
SIGNAL_TICK_INTERVAL_SECONDS = 5 * 60


def _seconds_until(hour: int, minute: int, tz: timezone) -> float:
    """计算距离下一个 tz 时区 hour:minute 的秒数。"""
    now = datetime.now(tz)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _seconds_until_weekly(weekday: int, hour: int, minute: int, tz: timezone) -> float:
    """计算距离下一个 tz 时区「周 weekday 的 hour:minute」的秒数。"""
    now = datetime.now(tz)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    days_ahead = (weekday - now.weekday()) % 7
    target += timedelta(days=days_ahead)
    if target <= now:
        target += timedelta(days=7)
    return (target - now).total_seconds()


async def _dream_scheduler():
    """后台协程：每天 DREAM_HOUR:DREAM_MINUTE(UTC) 触发做梦 Agent。"""
    while True:
        wait_seconds = _seconds_until(DREAM_HOUR, DREAM_MINUTE, timezone.utc)
        logger.info("[scheduler] next dream run in %.0f seconds", wait_seconds)
        await asyncio.sleep(wait_seconds)

        if settings.dreaming_enabled:
            from app.db import SessionLocal
            from app.graphs.dreaming import run_dreaming_all

            db = SessionLocal()
            try:
                # 同步 LLM 作业可能持续数分钟，必须丢到线程池，否则阻塞整个事件循环
                results = await asyncio.to_thread(run_dreaming_all, db)
                logger.info("[scheduler] dream done: %d users", len(results))
            except Exception as e:
                logger.error("[scheduler] dream failed: %s", e)
            finally:
                db.close()

        # 做梦之后：夜间场景推荐（分析当天语音通话 → 信箱场景邀请）
        from app.db import SessionLocal as _SessionLocal
        from app.services.scene.scene_recommend import run_scene_recommend_all

        db = _SessionLocal()
        try:
            results = await asyncio.to_thread(run_scene_recommend_all, db)
            n = sum(1 for r in results if r.get("recommended"))
            logger.info("[scheduler] scene recommend: %d recommended / %d users", n, len(results))
        except Exception as e:
            logger.error("[scheduler] scene recommend failed: %s", e)
        finally:
            db.close()


async def _evening_letter_scheduler():
    """后台协程：每晚 21:30（东八区）由桌宠给每个用户写一封晚间来信。

    独立于 proactive 开关，每晚都发；只有 LLM 调用失败才不发。
    """
    while True:
        wait_seconds = _seconds_until(EVENING_HOUR, EVENING_MINUTE, CST)
        logger.info("[scheduler] next evening letter in %.0f seconds", wait_seconds)
        await asyncio.sleep(wait_seconds)

        from app.db import SessionLocal
        from app.services.mailbox.evening_letter import run_evening_letters_all

        db = SessionLocal()
        try:
            results = await asyncio.to_thread(run_evening_letters_all, db)
            sent = sum(1 for r in results if r.get("sent"))
            logger.info("[scheduler] evening letters: %d sent / %d users", sent, len(results))
        except Exception as e:
            logger.error("[scheduler] evening letter failed: %s", e)
        finally:
            db.close()


async def _weekly_report_scheduler():
    """后台协程：每周日 20:00（东八区）给每个用户投一封本周小结。

    独立于 proactive 开关，每周日都发；只有 LLM 调用失败才不发。
    """
    while True:
        wait_seconds = _seconds_until_weekly(WEEKLY_WEEKDAY, WEEKLY_HOUR, WEEKLY_MINUTE, CST)
        logger.info("[scheduler] next weekly report in %.0f seconds", wait_seconds)
        await asyncio.sleep(wait_seconds)

        from app.db import SessionLocal
        from app.services.mailbox.weekly_report import run_weekly_reports_all

        db = SessionLocal()
        try:
            results = await asyncio.to_thread(run_weekly_reports_all, db)
            sent = sum(1 for r in results if r.get("sent"))
            logger.info("[scheduler] weekly reports: %d sent / %d users", sent, len(results))
        except Exception as e:
            logger.error("[scheduler] weekly report failed: %s", e)
        finally:
            db.close()


def _ensure_preference_location_columns() -> None:
    """开发期轻量迁移：给已存在的 user_preferences 补地点列与主动触发偏好列。

    create_all 不会给「已存在的表」加列；这里用 SQLite ADD COLUMN 幂等补齐，
    让重启后端即生效、不丢数据、无需手动跑 alembic（生产仍走 alembic 012）。
    """
    from sqlalchemy import inspect, text
    if engine.dialect.name != "sqlite":
        return
    try:
        insp = inspect(engine)
        names = insp.get_table_names()
        # 生产（已跑 alembic）有 alembic_version 表，迁移由 alembic 统一管理，跳过本 dev shim
        if "alembic_version" in names:
            return
        if "user_preferences" not in names:
            return
        existing = {c["name"] for c in insp.get_columns("user_preferences")}
        adds = {
            "last_lat": "FLOAT", "last_lon": "FLOAT",
            "last_city": "VARCHAR(60)", "location_updated_at": "DATETIME",
            # 主动触发（信号融合引擎）偏好
            "proactive_schedule_times": "JSON",
            "quiet_hours_start": "VARCHAR(5) NOT NULL DEFAULT '23:00'",
            "quiet_hours_end": "VARCHAR(5) NOT NULL DEFAULT '07:00'",
            "is_muted": "BOOLEAN NOT NULL DEFAULT 0",
            "scheduled_checkin_enabled": "BOOLEAN NOT NULL DEFAULT 1",
            "holiday_greeting_enabled": "BOOLEAN NOT NULL DEFAULT 1",
            "motion_detection_enabled": "BOOLEAN NOT NULL DEFAULT 1",
            "driving_alert_enabled": "BOOLEAN NOT NULL DEFAULT 1",
            "weather_alert_enabled": "BOOLEAN NOT NULL DEFAULT 1",
            "usage_anomaly_enabled": "BOOLEAN NOT NULL DEFAULT 1",
            "max_daily_triggers": "INTEGER NOT NULL DEFAULT 6",
            "driving_mode_active": "BOOLEAN NOT NULL DEFAULT 0",
            "last_motion_signal_at": "DATETIME",
            "profile_learning_enabled": "BOOLEAN NOT NULL DEFAULT 1",
        }
        with engine.begin() as conn:
            for name, typ in adds.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE user_preferences ADD COLUMN {name} {typ}"))
                    logger.info("[migrate] user_preferences += %s", name)
    except Exception as e:  # noqa: BLE001
        logger.error("[migrate] ensure location columns failed: %s", e)


async def _proactive_signal_scheduler():
    """后台协程：每 5 分钟跑一轮主动信号检测 + 融合决策。

    覆盖时间窗口 / 节假日 / 天气 / 城市变化 / 手机使用异常 / 驾车兜底。
    客户端上报速度样本时会即时触发一次，本循环是兜底与轮询类信号的唯一入口。
    """
    interval = SIGNAL_TICK_INTERVAL_SECONDS
    # 启动后先等一轮，避免与 create_all / 迁移抢 SQLite 写锁
    await asyncio.sleep(30)
    while True:
        if settings.proactive_enabled:
            from app.db import SessionLocal
            from app.services.signals.runner import run_tick_all

            db = SessionLocal()
            try:
                summary = await asyncio.to_thread(run_tick_all, db)
                if summary.get("allowed") or summary.get("detected"):
                    logger.info("[scheduler] signal tick: %s", summary)
            except Exception as e:
                logger.error("[scheduler] signal tick failed: %s", e)
            finally:
                db.close()
        await asyncio.sleep(interval)


async def _motion_cleanup_scheduler():
    """后台协程：每天清理超过 30 天的速度样本，以及过期的 TTS 音频文件。"""
    while True:
        await asyncio.sleep(24 * 3600)
        from app.db import SessionLocal
        from app.services.signals.runner import cleanup_motion_samples
        from app.services.infra.static_cleanup import cleanup_tts_audio

        db = SessionLocal()
        try:
            deleted = await asyncio.to_thread(cleanup_motion_samples, db)
            logger.info("[scheduler] motion samples cleaned: %d", deleted)
        except Exception as e:
            logger.error("[scheduler] motion cleanup failed: %s", e)
        finally:
            db.close()

        try:
            removed = await asyncio.to_thread(cleanup_tts_audio)
            if removed:
                logger.info("[scheduler] tts audio cleaned: %d files", removed)
        except Exception as e:
            logger.error("[scheduler] tts audio cleanup failed: %s", e)


async def _bedtime_reminder_scheduler():
    """后台协程：每分钟扫描，到用户设定的 sleep_reminder_time，由当前激活桌宠 agent
    写一条睡前提醒投进信箱（每天至多一条，幂等）。
    """
    while True:
        await asyncio.sleep(60)
        from app.db import SessionLocal
        from app.services.mailbox.bedtime_reminder import run_due_bedtime_reminders

        db = SessionLocal()
        try:
            results = await asyncio.to_thread(run_due_bedtime_reminders, db)
            if results:
                logger.info("[scheduler] bedtime reminders: %d sent", len(results))
        except Exception as e:
            logger.error("[scheduler] bedtime reminder failed: %s", e)
        finally:
            db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时确保表存在（开发期；生产走 Alembic）
    Base.metadata.create_all(bind=engine)
    _ensure_preference_location_columns()
    # 启动定时调度：做梦（0:00 UTC）+ 晚间来信（21:30 东八区）+ 周报（周日 20:00 东八区）
    # + 主动信号扫描（每 5 分钟）+ 速度样本/TTS 音频清理（每天）
    # ⚠️ 这些调度器假设单 worker 单副本（uvicorn 默认）；多 worker 会重复发信。
    dream_task = asyncio.create_task(_dream_scheduler())
    evening_task = asyncio.create_task(_evening_letter_scheduler())
    weekly_task = asyncio.create_task(_weekly_report_scheduler())
    signal_task = asyncio.create_task(_proactive_signal_scheduler())
    motion_cleanup_task = asyncio.create_task(_motion_cleanup_scheduler())
    bedtime_task = asyncio.create_task(_bedtime_reminder_scheduler())
    yield
    dream_task.cancel()
    evening_task.cancel()
    weekly_task.cancel()
    signal_task.cancel()
    motion_cleanup_task.cancel()
    bedtime_task.cancel()


app = FastAPI(title="Morning Backend", version="0.3.0", lifespan=lifespan)

# 静态文件：阶跃生图转存目录（/static/scene_images/xxx.png）
from fastapi.staticfiles import StaticFiles  # noqa: E402

from app.stepfun.image import SCENE_IMAGE_DIR, STATIC_DIR  # noqa: E402

SCENE_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # 通配符 origin 时不携带凭证：避免任意网页带用户凭证跨站调用
    allow_credentials="*" not in _origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AI 网关
app.include_router(chat.router)
app.include_router(stt.router)
app.include_router(realtime.router)

# 业务层：账号
app.include_router(auth.router)

# 业务层：交接信
app.include_router(handoffs.router)

# 业务层：桌宠（PUT /pets/active 切换时触发交接信生成）
app.include_router(pets.router)
app.include_router(companion.router)

# 业务层：记忆系统
app.include_router(memory.router)
app.include_router(brain_dumps.router)
app.include_router(mailbox.router)

# 业务层：对话
app.include_router(conversations.router)

# 业务层：五类存储（待办/小结/灵感/情绪）
app.include_router(stores.todos_router)
app.include_router(stores.summaries_router)
app.include_router(stores.ideas_router)
app.include_router(stores.emotions_router)

# 业务层：片场候选片段（待确认候选的读/确认/忽略）
app.include_router(candidates.router)

# 业务层：片场扩展（模板/细节补充/角色校准）——先注册，让 /scenes/templates 优先于 /scenes/{id}
app.include_router(theater_ext.router)
# 业务层：片场场景（候选确认后生成，互动体验/结算）
app.include_router(scenes.router)

# 业务层：角色档案
app.include_router(role_profiles.router)

# 业务层：信箱扩展（来信/三日寄存/长久珍藏）
app.include_router(letters.router)
app.include_router(ephemeral.router)
app.include_router(treasures.router)

# 业务层：偏好设置
app.include_router(preferences.router)

# 业务层：记忆审阅控制面（我的·记忆）
app.include_router(memory_review.router)
app.include_router(profile.router)

# 业务层：主动提醒（待办到期桌宠提醒）
app.include_router(reminders.router)

# 业务层：主动触发信号（时间窗口/节假日/驾车/天气/城市变化/手机使用异常）
app.include_router(signals.router)

# 调试：做梦 Agent 手动触发
app.include_router(debug.router)

# 业务层：天气（环境上下文，供对话/主动感知）
app.include_router(weather.router)

# 系统：应用版本信息（公开，App 启动检查更新）
app.include_router(app_version.router)


@app.get("/health")
async def health():
    """存活检查。只报告 key 是否已加载（布尔），绝不回显 key 本身。"""
    s = get_settings()
    return {
        "status": "ok",
        "stepfun_key_loaded": bool(s.stepfun_api_key),
        "text_model": s.step_text_model,
        "asr_stream_model": s.step_asr_stream_model,
        "realtime_model": s.step_realtime_model,
        "dreaming_enabled": s.dreaming_enabled,
        "proactive_enabled": s.proactive_enabled,
    }
