import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { petRig, type FilmController } from '../rig';
import { Score } from '../sound';

/**
 * 首屏短片：40 秒程序化动画（米露与波比的一天），与 App 角色同源。
 * 自动播放、滚出视口暂停；超过 5 秒的自动动画必须能停，所以右下角有暂停键。
 * 配乐默认关闭（浏览器不允许自动出声），点「声音」按钮才开始，由 sound.ts 现场合成。
 */
export default function Film() {
  const hostRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<FilmController | null>(null);
  const scoreRef = useRef<Score | null>(null);
  const lastT = useRef(0);
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(!reduced);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);

  useEffect(() => {
    scoreRef.current = new Score();
    return () => { scoreRef.current?.stop(); scoreRef.current = null; };
  }, []);

  useEffect(() => {
    const host = hostRef.current, rig = petRig();
    if (!host || !rig) return;
    const film = rig.mountFilm(host, {
      fit: 'cover', loop: true, autoplay: !reduced, reduceMotion: reduced, posterTime: 19.2,
      // 每帧报告短片时间：跨过关键时刻时补一个点缀音；循环回到 0 时由 cue() 自行忽略
      onTime: (t: number) => { scoreRef.current?.cue(lastT.current, t); lastT.current = t; },
    });
    filmRef.current = film;
    film.ready.then(() => setReady(true));
    return () => { film.destroy(); filmRef.current = null; };
  }, [reduced]);

  const toggle = () => {
    const film = filmRef.current;
    if (!film) return;
    if (film.playing) {
      film.pause();
      scoreRef.current?.suspend();
    } else {
      film.play();
      scoreRef.current?.resume();
    }
    setPlaying(film.playing);
  };

  const toggleSound = () => {
    const score = scoreRef.current, film = filmRef.current;
    if (!score) return;
    if (sound) {
      score.stop();
      setSound(false);
      return;
    }
    score.start();
    setSound(true);
    // 短片暂停时打开声音：音频也先挂起，等短片播放再响
    if (film && !film.playing) score.suspend();
  };

  return (
    <figure className="film sticker">
      <div
        aria-label="动画短片：黎明时米露在打盹，波比送来一杯水；念头碎片飘过，米露把最重的那一片收进星星；入夜后它守着睡着的波比。"
        className={`film-canvas${ready ? ' is-ready' : ''}`}
        ref={hostRef}
        role="img"
      />
      {reduced ? null : (
        <button aria-label={playing ? '暂停短片' : '播放短片'} className="film-toggle" onClick={toggle} type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {playing ? <path d="M9 6v12M15 6v12" /> : <path d="M8 5l11 7-11 7z" />}
          </svg>
        </button>
      )}
      <button
        aria-label={sound ? '关闭配乐' : '打开配乐'}
        aria-pressed={sound}
        className="film-toggle film-sound"
        onClick={toggleSound}
        type="button"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
          {sound
            ? <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
            : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
        </svg>
      </button>
      <i className="tape tape-l" aria-hidden="true" />
      <i className="tape tape-r" aria-hidden="true" />
    </figure>
  );
}
