import { DOWNLOADS } from '../config';
import { HarmonyIcon, AndroidIcon } from './DownloadIcons';
import Film from './Film';

/** 首屏：左侧文案与下载，右侧是米露和波比的一天（程序化短片）。 */
export default function Hero() {
  return (
    <section id="hero">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">你的数字世界，也应该有人陪你。</p>
          <h1>有些事情，<br /><span className="nowrap">不必<span className="scribble">一个人</span>想完。</span></h1>
          <p className="lede">
            把脑海里的事情交给喵灵。<br />她会听你说、帮你记住，也会在下一次见面时继续陪你。
          </p>
          <div className="dl-row">
            <a className="dl-btn" href={DOWNLOADS.harmony.url}>
              <HarmonyIcon />
              <span>
                <span className="t1">鸿蒙版下载</span>
                <span className="t2">{DOWNLOADS.harmony.sub}</span>
              </span>
            </a>
            <a className="dl-btn" href={DOWNLOADS.android.url}>
              <AndroidIcon />
              <span>
                <span className="t1">Android 版下载</span>
                <span className="t2">{DOWNLOADS.android.sub}</span>
              </span>
            </a>
          </div>
          <p className="dl-note">Windows / macOS 正在准备中</p>
        </div>
        <Film />
      </div>
    </section>
  );
}
