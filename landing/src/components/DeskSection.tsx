/** Feature 03 · 桌宠:模拟桌面场景 + 米露三态(静坐/打盹/挥手递卡)。 */
export default function DeskSection() {
  return (
    <section id="desk">
      <div className="wrap">
        <div className="reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto' }}>
          <p className="eyebrow">桌面伙伴</p>
          <h2>她不是住在聊天框里的 AI。</h2>
          <p className="lede" style={{ margin: '20px auto 0' }}>她住在你的数字生活里。</p>
        </div>
        <div className="desk-scene reveal">
          <div className="desk-bar"><i /><i /><i /></div>
          <div className="desk-body">
            <div className="desk-icon" style={{ left: '7%', top: '12%' }}>
              <b><svg viewBox="0 0 24 24" fill="none" stroke="#eef0ff" strokeWidth="1.6"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg></b>
              实训材料.docx
            </div>
            <div className="desk-icon" style={{ left: '7%', top: '42%' }}>
              <b><svg viewBox="0 0 24 24" fill="none" stroke="#eef0ff" strokeWidth="1.6"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 8l9 6 9-6" /></svg></b>
              邮件
            </div>
            <div className="desk-icon" style={{ left: '16%', top: '12%' }}>
              <b><svg viewBox="0 0 24 24" fill="none" stroke="#eef0ff" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5" /></svg></b>
              日程
            </div>
            <div className="desk-glow" />
            <div className="reminder-card">
              <p className="rc-t">米露递来的提醒</p>
              <p className="rc-b">明天 9:00 · 提交实训材料,别忘了呀</p>
            </div>
            <div className="desk-miro"><img src="/assets/miro-idle.webp?v=20260911" alt="桌宠形态的米露坐在桌面角落" /></div>
          </div>
        </div>
        <div className="pet-states reveal">
          <div className="pstate">
            <div className="frame"><img src="/assets/miro-sit.webp?v=20260911" alt="" /></div>
            <p>有时安静地坐在角落</p>
          </div>
          <div className="pstate">
            <div className="frame"><img src="/assets/miro-blink.webp?v=20260911" alt="" /></div>
            <p>有时抱着星星打盹</p>
          </div>
          <div className="pstate">
            <div className="frame"><img src="/assets/miro-wave.webp?v=20260911" alt="" /></div>
            <p>有时递出一张提醒卡片</p>
          </div>
        </div>
      </div>
    </section>
  );
}
