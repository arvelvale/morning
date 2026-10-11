"""add mailbox generation idempotency and daily slots

Revision ID: 018_mailbox_delivery_guard
Revises: 017_profile_write_gate
"""
from alembic import op
import sqlalchemy as sa


revision = "018_mailbox_delivery_guard"
down_revision = "017_profile_write_gate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("letters", sa.Column("generation_key", sa.String(120), nullable=True))
    op.add_column("letters", sa.Column("delivery_date", sa.String(10), nullable=True))
    op.add_column("letters", sa.Column("delivery_slot", sa.Integer(), nullable=True))

    # 旧信按东八区日期纳入额度；每天最早两封占槽，已有超额历史保留但不再扩张。
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "UPDATE letters SET delivery_date = "
            "to_char(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'), "
            "generation_key = 'legacy:' || id::text"
        )
    else:
        op.execute(
            "UPDATE letters "
            "SET delivery_date = strftime('%Y-%m-%d', datetime(created_at, '+8 hours')), "
            "generation_key = 'legacy:' || id"
        )
    op.execute(
        "UPDATE letters AS current SET delivery_slot = ("
        "SELECT COUNT(*) FROM letters AS earlier "
        "WHERE earlier.user_id = current.user_id "
        "AND earlier.delivery_date = current.delivery_date "
        "AND earlier.id <= current.id"
        ") WHERE ("
        "SELECT COUNT(*) FROM letters AS earlier "
        "WHERE earlier.user_id = current.user_id "
        "AND earlier.delivery_date = current.delivery_date "
        "AND earlier.id <= current.id"
        ") <= 2"
    )

    op.create_index(
        "uq_letters_user_generation_key",
        "letters",
        ["user_id", "generation_key"],
        unique=True,
    )
    op.create_index(
        "uq_letters_user_date_slot",
        "letters",
        ["user_id", "delivery_date", "delivery_slot"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_letters_user_date_slot", table_name="letters")
    op.drop_index("uq_letters_user_generation_key", table_name="letters")
    op.drop_column("letters", "delivery_slot")
    op.drop_column("letters", "delivery_date")
    op.drop_column("letters", "generation_key")
