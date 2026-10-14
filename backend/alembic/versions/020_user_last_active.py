"""users.last_active_at：最近一次打开 App，定时任务据此跳过沉睡用户。

回填口径：用户自己发出的最后一条对话消息时间；从没聊过的用注册时间。
回填偏保守会让「只看信不聊天」的用户被暂时判为沉睡——他下次打开 App 的任何请求都会立即恢复。
"""
from alembic import op
import sqlalchemy as sa

revision = "020_user_last_active"
down_revision = "019_email_auth"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        """
        UPDATE users SET last_active_at = COALESCE(
            (SELECT MAX(m.created_at)
               FROM conversation_messages m
               JOIN conversations c ON c.id = m.conversation_id
              WHERE c.user_id = users.id AND m.role = 'user'),
            users.created_at)
        """
    )


def downgrade():
    op.drop_column("users", "last_active_at")
