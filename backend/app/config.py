from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """从 backend/.env 读取配置。环境变量名大小写不敏感（STEPFUN_API_KEY -> stepfun_api_key）。"""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # 阶跃接入
    stepfun_api_key: str = ""
    stepfun_base_url: str = "https://api.stepfun.com/v1"
    stepfun_ws_base: str = "wss://api.stepfun.com/v1"

    # 模型默认值
    step_text_model: str = "step-3.7-flash"  # 文字与图片理解共用；图片消息仍需客户端/业务接口接入
    step_image_model: str = "step-image-edit-2"  # 文生图（size 为 height x width）
    step_asr_file_model: str = "stepaudio-2.5-asr"
    step_asr_stream_model: str = "stepaudio-2.5-asr-stream"
    step_realtime_model: str = "stepaudio-2.5-realtime"
    step_realtime_voice: str = "linjiajiejie"
    step_realtime_instructions: str = "你是喵灵的桌宠，温柔、不催促、不评判。"
    # 桌宠语音回复（TTS）。音色「元气少女」偏可爱活泼。
    # ⚠️ 模型名必须用 stepaudio-2.5-tts：step-tts-mini 只存在于标准 /v1，
    # Step Plan（step_plan/v1）下会 404 model_invalid。stepaudio-2.5-tts 两边都可用。
    step_tts_model: str = "stepaudio-2.5-tts"
    step_tts_voice: str = "yuanqishaonv"

    # 彩云天气（Caiyun v2.6，按经纬度查实时天气；key 只在服务端使用，绝不下发前端）
    caiyun_app_key: str = ""
    caiyun_app_secret: str = ""
    caiyun_cache_minutes: int = 30

    # 数据库
    database_url: str = "sqlite:///./morning.db"

    # 文字备用路由：阶跃失败（限流 / 5xx / 超时 / key 无效）时退到 DeepSeek。空 = 服务端不提供备用。
    # 模型名随 DeepSeek 平台更新可能变化，上线前用真实 key 调一次确认。
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    # 用户自带密钥（BYOK）。false（默认）= 用户没带 key 时用服务端的 key，行为与以前一样；
    # true = 服务端的 key 一律不给用户用：没带 key 的请求调模型会失败，服务端定时任务也不再为任何人生成内容。
    # 翻成 true 之前要确认客户端已经能填 key，否则所有人都会用不了。
    byok_required: bool = False
    # 聊天图片存放目录（不经 /static 公开，读取要登录且只能读自己的）。线上指到持久卷，如 /data/chat_images。
    chat_image_dir: str = "./data/chat_images"

    # 能力开关（可回滚）
    dreaming_enabled: bool = True
    proactive_enabled: bool = True
    # 连续多少个自然日（东八区）没打开 App 就停发自动生成的消息；<=0 关闭此规则
    dormant_after_days: int = 3
    user_profile_enabled: bool = True

    # 鉴权（JWT）—— 生产务必用 .env 覆盖 jwt_secret
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 天（黑客松从宽）
    refresh_token_expire_days: int = 30

    # 邮箱验证码：SMTP 密码仅留服务端；关闭开关不影响密码登录。
    email_login_enabled: bool = False
    smtp_host: str = "smtpdm.aliyun.com"
    smtp_port: int = 465
    smtp_secure: bool = True  # False 时仍强制 STARTTLS，禁止明文认证
    smtp_email: str = ""
    smtp_password: str = ""
    smtp_sender_name: str = "喵灵"

    # 服务
    cors_origins: str = "*"
    # 运行环境：dev / prod。prod 下禁止默认 JWT 密钥启动（main.py 校验）。
    app_env: str = "dev"

    @property
    def auth_header(self) -> dict[str, str]:
        """阶跃鉴权头：用户这次请求带了自己的 key 就用用户的，否则用服务端的（见 app/llm_keys.py）。

        key 只在服务端转交给阶跃，绝不下发到前端、不写日志。没有可用的 key 时抛 LLMKeyMissing。
        """
        from app.llm_keys import resolve_stepfun_key

        return {"Authorization": f"Bearer {resolve_stepfun_key()}"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
