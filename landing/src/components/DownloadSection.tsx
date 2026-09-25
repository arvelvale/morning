import { DOWNLOADS } from '../config';
import { HarmonyIcon, AndroidIcon } from './DownloadIcons';
import Pet from './Pet';

/** 下载：夜里的纸面，米露抱着发光的星星等你。 */
export default function DownloadSection() {
  return (
    <section id="download">
      <div className="dl-scene reveal">
        <Pet className="dl-pet" label="夜里的米露，点一下它" night pet="miro" />
        <h2>今晚，要不要把一些事情<br />交给<span className="scribble">我</span>？</h2>
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
          Android {DOWNLOADS.android.version} · HarmonyOS {DOWNLOADS.harmony.version} · 免费下载
        </p>
      </div>
    </section>
  );
}
