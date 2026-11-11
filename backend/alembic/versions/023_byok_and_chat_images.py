"""自带密钥（BYOK）与聊天图片。

- users.uses_own_key：用户是否在手机上填了自己的模型密钥（密钥本身不入库）。老用户默认 false，
  行为不变（继续由服务端定时任务生成内容）。
- job_runs：由手机触发的定时活的防重复登记（做梦、场景推荐）。
- conversation_messages.attachments：消息带的图片清单（可空，老消息为空）。
"""
from alembic import op
import sqlalchemy as sa

revision = "023_byok_and_chat_images"
down_revision = "022_evening_letter_pref"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("uses_own_key", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("conversation_messages", sa.Column("attachments", sa.JSON(), nullable=True))
    op.create_table(
        "job_runs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("job", sa.String(40), nullable=False),
        sa.Column("period", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "job", "period", name="uq_job_runs_user_job_period"),
    )
    op.create_index("ix_job_runs_user_id", "job_runs", ["user_id"])


def downgrade():
    op.drop_index("ix_job_runs_user_id", table_name="job_runs")
    op.drop_table("job_runs")
    op.drop_column("conversation_messages", "attachments")
    op.drop_column("users", "uses_own_key")
