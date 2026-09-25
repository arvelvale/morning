import Pet from './Pet';

const FileIcon = () => <svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
const MailIcon = () => <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7.5l8 5.5 8-5.5" /></svg>;
const CalIcon = () => <svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M8 3v3M16 3v3" /></svg>;

/** 桌面伙伴：纸片桌面 + 米露三种状态（都是活的）。 */
export default function DeskSection() {
  return (
    <section id="desk">
      <div className="wrap">
        <div className="head center reveal">
          <p className="eyebrow">桌面伙伴</p>
          <h2>她不是住在聊天框里的 AI。</h2>
          <p className="lede">她住在你的数字生活里。</p>
        </div>
        <div className="desk-scene sticker reveal">
          <div className="desk-bar"><i /><i /><i /></div>
          <div className="desk-body">
            <div className="desk-icons">
              <span><b><FileIcon /></b>实训材料.docx</span>
              <span><b><MailIcon /></b>邮件</span>
              <span><b><CalIcon /></b>日程</span>
            </div>
            <div className="reminder-card">
              <p className="rc-t">米露递来的提醒</p>
              <p className="rc-b">明天 9:00 · 提交实训材料，别忘了呀</p>
            </div>
            <Pet className="desk-pet" label="桌面上的米露，点一下它" pet="miro" />
          </div>
        </div>
        <div className="pet-states">
          <figure className="pstate sticker tilt-l reveal">
            <Pet label="安静坐着的米露" pet="miro" />
            <figcaption>有时安静地坐在角落</figcaption>
          </figure>
          <figure className="pstate night sticker reveal">
            <Pet label="抱着星星打盹的米露" mood="sleep" night pet="miro" />
            <figcaption>有时抱着星星打盹</figcaption>
          </figure>
          <figure className="pstate sticker tilt-r reveal">
            <Pet label="竖起耳朵的米露" mood="listening" pet="miro" />
            <span className="mini-card" aria-hidden="true">别忘了喝水</span>
            <figcaption>有时递出一张提醒卡片</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
