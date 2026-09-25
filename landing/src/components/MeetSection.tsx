import Pet from './Pet';

/** 认识一下：两位伙伴。人设文案与 App 内置预设一致（backend/app/services/pet/pet_presets.py）。 */
export default function MeetSection() {
  return (
    <section id="meet">
      <div className="wrap">
        <div className="head reveal">
          <p className="eyebrow">两位伙伴</p>
          <h2>一只<span className="scribble">安静</span>，一只<span className="scribble">热烈</span>。</h2>
          <p className="lede">选一位陪你。之后也能换，新伙伴只会知道粗粒度的近况，不会复述细节。</p>
        </div>
        <div className="meet-grid">
          <article className="meet-card sticker tilt-l reveal">
            <Pet label="米露，点一下它" pet="miro" />
            <h3>米露</h3>
            <p className="role">情绪碎片收藏家</p>
            <p>安静、敏锐，擅长倾听和承接情绪。感受得到，但不擅自解释；愿意接住，也会明确地关心你。</p>
          </article>
          <article className="meet-card sticker tilt-r reveal">
            <Pet label="波比，点一下它" pet="bobi" />
            <h3>波比</h3>
            <p className="role">晨光信使</p>
            <p>温暖、热烈、有行动力，也尊重边界。会陪你做一点具体的小事，但从不要求你马上振作。</p>
          </article>
        </div>
      </div>
    </section>
  );
}
