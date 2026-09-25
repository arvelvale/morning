from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """从 backend/.env 读取配置。环境变量名大小写不敏感（STEPFUN_API_KEY -> stepfun_api_key）。"""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # 阶跃接入
    stepfun_api_key: str = ""
    stepfun_base_url: str = "https://api.stepfun.com/step_plan/v1"
    stepfun_ws_base: str = "wss://api.stepfun.com/v1"

    # 模型默认值
    step_text_model: str = "step-3.5-flash"
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

    # 能力开关（可回滚）
    dreaming_enabled: bool = True
    proactive_enabled: bool = True
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
        """阶跃鉴权头。key 只在服务端使用，绝不下发到前端。"""
        return {"Authorization": f"Bearer {self.stepfun_api_key}"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
