/** 顶部导航：品牌 + 锚点链接。 */
export default function Nav() {
  return (
    <nav>
      <a className="brand" href="#hero">
        <img src={`${import.meta.env.BASE_URL}assets/favicon.png`} alt="喵灵 logo" />
        <b>喵灵</b>
        <span>Morning</span>
      </a>
      <div className="nav-links">
        <a href="#meet">伙伴</a>
        <a href="#dump">倾倒</a>
        <a href="#memory">记忆</a>
        <a href="#desk">桌宠</a>
        <a href="#theater">场景重演</a>
        <a className="nav-cta" href="#download">下载</a>
      </div>
    </nav>
  );
}
