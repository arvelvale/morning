import { DOWNLOADS } from '../config';
import { HarmonyIcon, AndroidIcon } from './DownloadIcons';

/** Download:安静的夜晚,米露坐在发光的星星旁,两个同级大按钮。 */
export default function DownloadSection() {
  return (
    <section id="download">
      <div className="dl-scene reveal">
        <div className="big-star" />
        <div className="dl-miro"><img src="/assets/miro-sit.webp?v=20260911" alt="米露坐在一颗发光的星星旁" /></div>
        <h2>今晚,要不要把一些事情<br />交给<span className="glow-word">我</span>?</h2>
        <div className="dl-row">
          <a className="dl-btn" href={DOWNLOADS.harmony.url}>
            <HarmonyIcon />
            <span>
              <span className="t1">下载 HarmonyOS 版</span>
              <span className="t2">{DOWNLOADS.harmony.sub}</span>
            </span>
          </a>
          <a className="dl-btn" href={DOWNLOADS.android.url}>
            <AndroidIcon />
            <span>
              <span className="t1">下载 Android 版</span>
              <span className="t2">{DOWNLOADS.android.sub}</span>
            </span>
          </a>
        </div>
        <p className="version-line">
          Android <i>{DOWNLOADS.android.version}</i> · HarmonyOS <i>{DOWNLOADS.harmony.version}</i> · 免费下载
        </p>
      </div>
    </section>
  );
}
