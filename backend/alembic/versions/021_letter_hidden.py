"""letters.hidden_at：用户在信箱里「删除」的信只对用户隐藏，不物理删除。

为什么不真删：睡前提醒的「今天发过没」、generation_key / delivery_date 当日幂等、
晚间信 material_ids 防复读、「有句话」每 7 天最多 2 封，都靠信件行本身。
因此也暂不做已隐藏信件的定期物理清理。
"""
from alembic import op
import sqlalchemy as sa

revision = "021_letter_hidden"
down_revision = "020_user_last_active"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("letters", sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_letters_user_hidden", "letters", ["user_id", "hidden_at"])


def downgrade():
    op.drop_index("ix_letters_user_hidden", table_name="letters")
    op.drop_column("letters", "hidden_at")
