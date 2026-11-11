"""user_preferences：晚间来信可关闭、可改时间。

- evening_letter_enabled：是否收晚间来信，老用户默认开启
- evening_letter_time：HH:MM（东八区），老用户默认 21:30

server_default 保证升级后老用户行为完全不变（开启、21:30，与此前全员固定 21:30 一致）。
"""
from alembic import op
import sqlalchemy as sa

revision = "022_evening_letter_pref"
down_revision = "021_letter_hidden"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user_preferences",
        sa.Column("evening_letter_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "user_preferences",
        sa.Column("evening_letter_time", sa.String(5), nullable=False, server_default="21:30"),
    )


def downgrade():
    op.drop_column("user_preferences", "evening_letter_time")
    op.drop_column("user_preferences", "evening_letter_enabled")
