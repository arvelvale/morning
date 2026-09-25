import Pet from './Pet';

/** 场景重演：纸偶剧场——剪纸夜景、两个人物剪影、米露在一旁陪着。 */
export default function TheaterSection() {
  return (
    <section id="theater">
      <div className="wrap theater-grid">
        <div className="stage sticker reveal">
          <div className="stage-sky">
            <i className="stage-moon" />
            {[['12%', '14%'], ['30%', '8%'], ['58%', '16%'], ['76%', '9%'], ['88%', '22%'], ['44%', '24%']].map(([l, t], i) => (
              <i className="stage-star" key={i} style={{ left: l, top: t, animationDelay: `${-i * .7}s` }} />
            ))}
          </div>
          <svg className="stage-city" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 200V120h40V90h36v30h30V70h44v50h26V100h40v20h34V60h50v60h30V96h44v24h36V80h40v40h40V104h50v96z" />
          </svg>
          <div className="stage-lamp"><i /></div>
          <div className="stage-fig a" />
          <div className="stage-fig b" />
          <Pet className="stage-pet" label="在一旁陪着的米露" mood="listening" night pet="miro" />
          <div className="stage-floor" />
          <p className="stage-line"><b>米露</b>那天没说出口的话，要不要再想一次？这次我陪你。</p>
          <i className="curtain l" aria-hidden="true" />
          <i className="curtain r" aria-hidden="true" />
        </div>
        <div className="reveal">
          <p className="eyebrow">场景重演</p>
          <h2>有些事情，<br />可以<span className="scribble">重新想一次</span>。</h2>
          <p className="lede">
            通过场景重演，回顾过去发生的事情，或者提前预演明天可能发生的对话。它不是治疗，只是一种有人陪着的思考方式。
          </p>
        </div>
      </div>
    </section>
  );
}
