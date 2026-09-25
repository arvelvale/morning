"""独立验证邮箱、一次性验证码及跨进程限流。"""
from alembic import op
import sqlalchemy as sa

revision = "019_email_auth"
down_revision = "018_mailbox_delivery_guard"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("email_identities",
        sa.Column("email", sa.String(255), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), unique=True, nullable=False))
    op.create_table("email_challenges",
        sa.Column("email_key", sa.String(64), primary_key=True),
        sa.Column("challenge_id", sa.String(32), nullable=False),
        sa.Column("purpose", sa.String(10), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("ready", sa.Integer(), nullable=False))
    op.create_index("ix_email_challenges_expires_at", "email_challenges", ["expires_at"])
    op.create_table("email_auth_rates",
        sa.Column("key", sa.String(120), primary_key=True),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False))
    op.create_index("ix_email_auth_rates_expires_at", "email_auth_rates", ["expires_at"])


def downgrade():
    op.drop_table("email_auth_rates")
    op.drop_table("email_challenges")
    op.drop_table("email_identities")
