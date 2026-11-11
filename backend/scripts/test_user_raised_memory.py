"""用户自己提起时的脆弱记忆放行（2026-10 隐私口径）测试：免服务、免真实 LLM。

口径：vulnerable/core 只在用户发起的对话里、且与「当前这条消息」相关时放进 prompt；
米露主动路径一律不放；burn_after_read 永不放。
运行：cd backend && PYTHONUTF8=1 PYTHONPATH=. .venv/Scripts/python.exe scripts/test_user_raised_memory.py
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.graphs import companion
from app.models.user import User
from app.services.memory import context_builder, privacy
from app.services.memory.memory_store import MemoryStore
from app.services.scene import scene_recommend
from app.services.signals.context import _surface_material

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(bind=engine, expire_on_commit=False)
Base.metadata.create_all(engine)

SECRET_V = "外婆走的那天我没赶回去"          # vulnerable，实体：外婆
SECRET_C = "我其实一直害怕被所有人抛下"        # core，无实体
SECRET_B = "和前任分手时说的狠话"              # vulnerable + burn_after_read
SURFACE = "明天下午三点要交实验报告"


with Session() as db:
    user = User(username="user_raised", password_hash="x", is_active=True)
    db.add(user); db.commit(); db.refresh(user)
    uid = user.id
    st = MemoryStore(db)
    m_surface = st.create(user_id=uid, layer="state", kind="待办", depth="surface",
                          content=SURFACE, surface_text=SURFACE)
    m_vuln = st.create(user_id=uid, layer="episodic", kind="片段", depth="vulnerable",
                       content="用户外婆去世时未能赶回，长期自责", surface_text=SECRET_V,
                       entities=["外婆", "signal-key:grief"])
    m_core = st.create(user_id=uid, layer="profile", kind="情绪", depth="core",
                       content="核心恐惧：被抛弃", surface_text=SECRET_C)
    m_burn = st.create(user_id=uid, layer="episodic", kind="片段", depth="vulnerable",
                       content="分手时对前任说了很重的话", surface_text=SECRET_B, entities=["前任"])
    m_burn.privacy = "burn_after_read"
    db.commit()

    # 1) 回归：默认参数下 vulnerable/core/即焚照旧被剔除
    for mode in ("full", "query", "profile"):
        ctx = context_builder.build(db, uid, mode=mode, query="外婆 前任 抛下 实验报告")
        assert SECRET_V not in ctx and SECRET_C not in ctx and SECRET_B not in ctx, mode
    assert SURFACE in context_builder.build(db, uid, mode="full", query="实验报告")
    kept = privacy.filter_for_cloud_prompt([m_surface, m_vuln, m_core, m_burn])
    assert [m.id for m in kept] == [m_surface.id]
    # 只传 user_initiated 不给消息，或只给消息不开开关，都不放
    ctx = context_builder.build(db, uid, mode="full", query="外婆", user_initiated=True)
    assert SECRET_V not in ctx
    ctx = context_builder.build(db, uid, mode="full", query="外婆", user_text="外婆")
    assert SECRET_V not in ctx
    print("REGRESSION: 默认/单参数下脆弱记忆仍被剔除 PASS")

    # 2) 用户发起 + 相关 → 放入，带温和标注，用 surface_text
    msg = "今天路过外婆家那条街，心里又堵了一下"
    ctx = context_builder.build(db, uid, mode="full", query=msg, user_initiated=True, user_text=msg)
    assert SECRET_V in ctx, ctx
    assert context_builder.USER_RAISED_NOTE in ctx and "不要追问细节" in ctx
    assert "核心恐惧" not in ctx and "长期自责" not in ctx, "不得用内部分析措辞"
    assert SECRET_C not in ctx and SECRET_B not in ctx, "不相关的 core / 即焚不放"
    assert ctx.index(context_builder.USER_RAISED_NOTE) < ctx.index(SECRET_V)
    # 进 companion 的 system prompt 后围栏/标注都在
    system_text = companion._build_messages("free_chat", [{"role": "user", "content": msg}],
                                            memory_context=ctx)[0].content
    assert SECRET_V in system_text and "较私密" in system_text
    print("USER-RAISED: 相关的 vulnerable 放入且带标注 PASS")

    # 3) 用户发起但不相关 / 闲聊 → 不放
    for chat in ("今天食堂的面真好吃", "帮我想想明天穿什么", "我们今天去哪里玩好呢", "好累啊"):
        ctx = context_builder.build(db, uid, mode="full", query=chat, user_initiated=True, user_text=chat)
        assert SECRET_V not in ctx and SECRET_C not in ctx and SECRET_B not in ctx, chat
        assert context_builder.USER_RAISED_NOTE not in ctx, chat
    assert privacy.select_user_raised_sensitive([m_vuln, m_core], "") == []
    assert privacy.select_user_raised_sensitive([m_vuln, m_core], None) == []
    print("USER-RAISED: 闲聊/不相关不放 PASS")

    # 4) core：关键词（二字组）相关 → 放；相关度阈值
    msg_core = "我总觉得自己会被所有人抛下，一直很害怕"
    got = privacy.select_user_raised_sensitive([m_vuln, m_core, m_burn], msg_core)
    assert [m.id for m in got] == [m_core.id]
    assert privacy.user_raised_relevance(m_core, "我害怕") < privacy.USER_RAISED_MIN_SCORE  # 单个二字组不够
    print("USER-RAISED: core 按词面相关放入，单个弱命中不够阈值 PASS")

    # 5) 回指句：词面无命中时只放最近 1 条（非即焚）
    got = privacy.select_user_raised_sensitive([m_vuln, m_core, m_burn], "我又想起那件事了")
    assert [m.id for m in got] == [m_core.id], "最近的非即焚脆弱记忆（id 最大）"
    assert privacy.select_user_raised_sensitive([m_vuln, m_core, m_burn], "今天吃了那个面") == []
    print("USER-RAISED: 回指句最多放最近 1 条 PASS")

    # 6) 即焚永不放：即使消息直接点名、即使回指
    for text in ("前任 分手 狠话 我又想起那件事了", "分手时说的狠话我一直记得"):
        got = privacy.select_user_raised_sensitive([m_burn], text)
        assert got == [], text
        ctx = context_builder.build(db, uid, mode="full", query=text, user_initiated=True, user_text=text)
        assert SECRET_B not in ctx
    print("BURN: burn_after_read 任何情况都不放 PASS")

    # 7) 预算：条数与字符上限
    extra = [
        st.create(user_id=uid, layer="episodic", kind="片段", depth="vulnerable",
                  content=f"关于咖啡馆往事{i}", surface_text=f"咖啡馆往事{i}号" + "细节" * 5,
                  entities=["咖啡馆"])
        for i in range(5)
    ]
    got = privacy.select_user_raised_sensitive(extra, "我又去了那家咖啡馆")
    assert len(got) == privacy.USER_RAISED_MAX_ITEMS
    assert sum(len(m.surface_text) for m in got) <= privacy.USER_RAISED_MAX_CHARS
    long_one = st.create(user_id=uid, layer="episodic", kind="片段", depth="core",
                         content="x", surface_text="咖啡馆" + "很长" * 200, entities=["咖啡馆"])
    assert privacy.select_user_raised_sensitive([long_one], "咖啡馆") == []
    print("BUDGET: 条数/字符预算生效 PASS")

    # 8) 主动路径仍不含脆弱记忆（即使用户刚好有相关内容）
    # 8a 信号融合 / 问候素材
    assert not any(SECRET_V in s or SECRET_C in s or SECRET_B in s for s in _surface_material(db, uid))
    # 8b 自动推荐片场的片段收集
    frags = scene_recommend._gather_dump_fragments(db, uid)
    assert not any(m.depth in ("vulnerable", "core") for m in frags)
    # 8c 晚间来信素材（只读调用；该模块有并发改动，导入失败不算本特性失败但要报）
    from app.services.mailbox import evening_letter
    letter_items = evening_letter._material_items(db, uid)
    assert not any(m.depth in ("vulnerable", "core") for m in letter_items)
    # 8d 主动路径用的 profile 模式 build_context：不带开关、没有 query
    ctx = context_builder.build(db, uid, mode="profile")
    assert SECRET_V not in ctx and SECRET_C not in ctx and SECRET_B not in ctx
    # 8e profile 模式即使被误传开关也不放（没有 query 段）
    ctx = context_builder.build(db, uid, mode="profile", user_initiated=True, user_text="外婆")
    assert SECRET_V not in ctx
    print("PROACTIVE: 晚间来信/信号素材/推荐片场/profile 上下文仍不含脆弱记忆 PASS")

print("\n=== User-raised memory ALL PASS ===")
