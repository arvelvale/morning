/* Auto-split from App.tsx (codemod). */
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mail, Film, Plus, X, ChevronLeft, ChevronRight, Check, Sun, Archive, Star, Type, Music, Play, Heart, SlidersHorizontal, MapPin } from "lucide-react";
import { useNight, NK, LETTER_DATA, CardTemplate, type LetterState } from "../theme";
import { GlassCard, CreamRipple, PrimaryBtn, BottomSheet, SafeHeader } from "../primitives";

// ─── Tasks & Keepsake Types / Mock Data ──────────────────────────────────────

export interface Task {
  id: string; title: string; date: string; time: string;
  source: string; completed: boolean;
}

export interface Keepsake {
  id: string;
  type: "letter" | "insight" | "scene" | "music" | "quote" | "moment";
  title: string; excerpt: string; savedAt: string;
  petName: string; source: string;
}

export const TODAY_DATE = "2026-07-23";

export const INITIAL_TASKS: Task[] = [
  { id:"t1", title:"回复那封邮件",  date:"2026-07-23", time:"今天内", source:"来自昨晚的整理", completed:false },
  { id:"t2", title:"和朋友见面",    date:"2026-07-23", time:"15:00",  source:"手动添加",       completed:false },
  { id:"t3", title:"记得喝水",      date:"2026-07-23", time:"持续",   source:"桌宠提醒",       completed:true  },
  { id:"t4", title:"与朋友的约定",  date:"2026-07-24", time:"15:00",  source:"来自昨晚的整理", completed:false },
  { id:"t5", title:"整理书桌",      date:"2026-07-22", time:"",       source:"手动添加",       completed:true  },
];

export const INITIAL_KEEPSAKES: Keepsake[] = [
  { id:"k1", type:"letter",  title:"桐桐写给我的信",                excerpt:"你已经做得比自己感觉到的更多了。", savedAt:"7月24日", petName:"桐桐", source:"桌宠来信"  },
  { id:"k2", type:"insight", title:"我不是害怕失败，而是害怕拖累队友。", excerpt:"",                              savedAt:"7月18日", petName:"米露", source:"今日洞察" },
  { id:"k3", type:"scene",   title:"我终于把那句话说了出来",          excerpt:"场景：和妈妈的对话",              savedAt:"6月12日", petName:"米露", source:"场景结算" },
  { id:"k4", type:"music",   title:"Bloom",                        excerpt:"桐桐夹在信里的歌",                savedAt:"6月8日",  petName:"桐桐", source:"信中附件" },
  { id:"k5", type:"quote",   title:"朋友说：你不用每次都表现得没事。", excerpt:"",                              savedAt:"5月28日", petName:"米露", source:"一句话"   },
];

// ─── Week Helpers ─────────────────────────────────────────────────────────────

export const WEEKDAYS_CN = ["周一","周二","周三","周四","周五","周六","周日"];

export const DAY_CN = ["日","一","二","三","四","五","六"];

export function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay(); // 0=Sun
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  d.setHours(0, 0, 0, 0);
  return d;
}

export function shiftDays(date: Date, n: number): Date {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function parseISO(s: string): Date {
  const [y,m,dd] = s.split("-").map(Number);
  return new Date(y, m - 1, dd);
}

// ─── WeekNavigator ────────────────────────────────────────────────────────────

export function WeekNavigator({ weekOffset, selectedDate, onWeekChange, onSelectDate, tasks }: {
  weekOffset: number; selectedDate: string;
  onWeekChange: (d: number) => void; onSelectDate: (s: string) => void;
  tasks: Task[];
}) {
  const night = useNight();
  const baseMonday = getMondayOf(parseISO(TODAY_DATE));
  const monday = shiftDays(baseMonday, weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => shiftDays(monday, i));
  const rangeLabel = `${days[0].getMonth()+1}月${days[0].getDate()}日—${days[6].getMonth()+1}月${days[6].getDate()}日`;

  const dots = (ds: string) => Math.min(tasks.filter(t => t.date === ds && !t.completed).length, 3);

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{rangeLabel}</span>
        <div className="flex gap-1">
          {([-1,1] as const).map(d => (
            <button key={d} onClick={() => onWeekChange(d)}
              className="w-7 h-7 flex items-center justify-center rounded-full active:opacity-60"
              style={{ background: night ? NK.glass : "rgba(255,252,245,0.72)", border: night ? `1px solid ${NK.glassBorder}` : "1px solid rgba(255,255,255,0.45)" }}>
              {d < 0
                ? <ChevronLeft size={13} style={{ color: "var(--text-secondary)" }}/>
                : <ChevronRight size={13} style={{ color: "var(--text-secondary)" }}/>}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-1">
        {days.map((day, i) => {
          const ds = toISO(day);
          const sel = ds === selectedDate;
          const tod = ds === TODAY_DATE;
          const dotCount = dots(ds);
          return (
            <button key={i} onClick={() => onSelectDate(ds)}
              className="flex-1 flex flex-col items-center py-2 rounded-[14px] transition-all duration-150"
              style={{
                background: sel ? "rgba(246,231,168,0.8)" : tod ? "rgba(249,240,200,0.45)" : "transparent",
                border: sel ? "1.5px solid rgba(255,255,255,0.62)" : "1.5px solid transparent",
              }}>
              <span className="text-[10px] mb-0.5"
                style={{ color: sel
                  ? (night ? NK.lsTer : "#847D72")
                  : (night ? NK.text3 : "#C0B5A8") }}>
                {WEEKDAYS_CN[i]}
              </span>
              <span className="text-[14px] font-medium"
                style={{ color: sel
                  ? (night ? NK.lsPri : "#4B463F")
                  : (tod ? (night ? NK.text2 : "#847D72") : (night ? NK.text : "#4B463F")) }}>
                {day.getDate()}
              </span>
              <div className="flex gap-0.5 mt-1 h-1.5 items-center">
                {Array.from({ length: dotCount }, (_, j) => (
                  <div key={j} className="w-1 h-1 rounded-full"
                    style={{ background: sel ? "rgba(196,149,58,0.7)" : "rgba(196,149,58,0.5)" }}/>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── TaskRow ──────────────────────────────────────────────────────────────────

export function TaskRow({ task, onToggle, onDelete }: {
  task: Task; onToggle: () => void; onDelete: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <div className="mb-2">
      <div
        className="flex items-center gap-3 px-4 py-3.5 rounded-[16px]"
        style={{
          background: task.completed ? "rgba(255,252,245,0.42)" : "rgba(255,252,245,0.72)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.45)",
        }}>
        {/* Completion ring */}
        <button
          onClick={onToggle}
          className="flex-shrink-0 active:scale-[0.94] transition-transform duration-150">
          <motion.div
            animate={task.completed ? { scale: [1, 0.9, 1.05, 1] } : { scale: 1 }}
            transition={{ duration: 0.22 }}
            style={{
              width: 22, height: 22, borderRadius: "50%",
              background: task.completed ? "rgba(246,231,168,0.9)" : "transparent",
              border: `2px solid ${task.completed ? "rgba(196,149,58,0.7)" : "rgba(91,79,62,0.2)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
            {task.completed && <Check size={11} style={{ color: "var(--text-primary)" }}/>}
          </motion.div>
        </button>

        <div className="flex-1 min-w-0">
          <div className={`text-[14px] font-medium leading-snug ${task.completed ? "line-through" : ""}`}
            style={{ color: task.completed ? "#A39A9F" : "#484145" }}>
            {task.title}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "#7E7479" }}>{task.source}</div>
        </div>

        {task.time && !actionsOpen && (
          <span className="text-[12px] flex-shrink-0" style={{ color: "var(--text-muted)" }}>{task.time}</span>
        )}

        <button
          onClick={() => setActionsOpen(v => !v)}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full active:opacity-60"
          style={{ color: "#7E7479", fontSize: 14, letterSpacing: "0.04em" }}>
          ···
        </button>
      </div>

      <AnimatePresence>
        {actionsOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="flex justify-end gap-2 px-2 pt-1.5 pb-0.5">
            <button
              onClick={() => setActionsOpen(false)}
              className="px-3 py-1.5 rounded-full text-[12px] active:opacity-60"
              style={{ background: "rgba(255,252,245,0.7)", color: "#655D61", border: "1px solid rgba(255,255,255,0.4)" }}>
              编辑
            </button>
            <button
              onClick={() => { onDelete(); setActionsOpen(false); }}
              className="px-3 py-1.5 rounded-full text-[12px] active:opacity-60"
              style={{ background: "rgba(243,216,199,0.5)", color: "#655D61", border: "1px solid rgba(255,255,255,0.4)" }}>
              删除
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── CompletedTasksSection ────────────────────────────────────────────────────

export function CompletedTasksSection({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;
  return (
    <div className="mt-1">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 py-2 active:opacity-60 transition-opacity">
        <motion.div animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronRight size={12} style={{ color: "var(--text-muted)" }}/>
        </motion.div>
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          今天完成了 {tasks.length} 件
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            {tasks.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 rounded-[14px] mb-1.5"
                style={{ background: "rgba(255,252,245,0.4)", border: "1px solid rgba(255,255,255,0.35)" }}>
                <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(196,149,58,0.5)" }}>
                  <Check size={9} style={{ color: "var(--text-primary)" }}/>
                </div>
                <span className="text-[13px] line-through flex-1 truncate" style={{ color: "var(--text-muted)" }}>
                  {t.title}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── AddTaskSheet ─────────────────────────────────────────────────────────────

export function AddTaskSheet({ defaultDate, onClose, onAdd }: {
  defaultDate: string; onClose: () => void; onAdd: (t: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const [time, setTime]   = useState("");
  const d = parseISO(defaultDate);
  const label = `${d.getMonth()+1}月${d.getDate()}日`;

  const commit = () => {
    if (!title.trim()) return;
    onAdd({ id:`t${Date.now()}`, title:title.trim(), date:defaultDate, time, source:"手动添加", completed:false });
    onClose();
  };

  return (
    <BottomSheet onClose={onClose} title="添加一件事">
      <div className="px-5 pb-8 flex flex-col gap-4 pt-1">
        <input
          value={title} onChange={e => setTitle(e.target.value)}
          placeholder="要做什么…"
          className="w-full px-4 py-3.5 rounded-[16px] outline-none text-[15px]"
          style={{ background:"rgba(255,252,245,0.65)", border:"1px solid rgba(255,255,255,0.45)", color:"#484145" }}
          onKeyDown={e => { if (e.key==="Enter") commit(); }}
          autoFocus
        />
        <div className="flex gap-3">
          <div className="flex items-center gap-2 px-4 py-3 rounded-[14px] flex-1"
            style={{ background:"rgba(246,231,168,0.45)", border:"1px solid rgba(255,255,255,0.4)" }}>
            <span className="text-[13px]">📅</span>
            <span className="text-[14px]" style={{ color:"#484145" }}>{label}</span>
          </div>
          <input
            value={time} onChange={e => setTime(e.target.value)}
            placeholder="时间（可选）"
            className="flex-1 px-4 py-3 rounded-[14px] outline-none text-[14px]"
            style={{ background:"rgba(255,252,245,0.65)", border:"1px solid rgba(255,255,255,0.4)", color:"#484145" }}
          />
        </div>
        <PrimaryBtn onClick={commit} full disabled={!title.trim()}>放到这一天</PrimaryBtn>
      </div>
    </BottomSheet>
  );
}

// ─── DailyTaskList ────────────────────────────────────────────────────────────

export function DailyTaskList({ selectedDate, tasks, onToggle, onDelete, onAdd }: {
  selectedDate: string; tasks: Task[];
  onToggle: (id: string) => void; onDelete: (id: string) => void; onAdd: () => void;
}) {
  const d = parseISO(selectedDate);
  const dayName = `星期${DAY_CN[d.getDay()]}`;
  const label = `${d.getMonth()+1}月${d.getDate()}日，${dayName}`;
  const isTd = selectedDate === TODAY_DATE;
  const active = tasks.filter(t => !t.completed);
  const done   = tasks.filter(t =>  t.completed);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[16px] font-medium" style={{ color:"var(--text-primary)" }}>{label}</div>
          <div className="text-[12px] mt-0.5" style={{ color:"var(--text-secondary)" }}>
            {active.length > 0
              ? `${isTd ? "今天" : "这天"}有 ${active.length} 件事等你接住`
              : `${isTd ? "今天" : "这天"}还没有待办`}
          </div>
        </div>
        <button onClick={onAdd}
          className="flex items-center gap-1 px-3.5 py-1.5 rounded-full text-[13px] font-medium active:scale-[0.97] transition-transform"
          style={{ background:"rgba(246,231,168,0.78)", color:"#463F3C", border:"1px solid rgba(255,255,255,0.5)" }}>
          <Plus size={12}/>添加
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center py-10 gap-4">
          <div style={{
            width:64, height:64, borderRadius:16,
            background:"rgba(255,252,245,0.65)",
            backdropFilter:"blur(16px)",
            border:"1px solid rgba(255,255,255,0.45)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:24,
          }}>✦</div>
          <div className="text-center">
            <p className="text-[15px] font-medium mb-1" style={{ color:"var(--text-primary)" }}>这一天还是空的</p>
            <p className="text-[13px]" style={{ color:"var(--text-muted)" }}>可以先留一点位置给自己。</p>
          </div>
          <button onClick={onAdd}
            className="px-4 py-2 rounded-full text-[13px] active:opacity-60"
            style={{ background:"rgba(246,231,168,0.65)", color:"#463F3C" }}>
            添加一件事
          </button>
        </div>
      ) : (
        <>
          {active.map(t => (
            <TaskRow key={t.id} task={t} onToggle={() => onToggle(t.id)} onDelete={() => onDelete(t.id)}/>
          ))}
          <CompletedTasksSection tasks={done}/>
        </>
      )}
    </div>
  );
}

// ─── Keepsake Artifact ────────────────────────────────────────────────────────

// Unified glass material for all keepsake cards
export const GLASS_CARD: React.CSSProperties = {
  background: "rgba(255,252,245,0.62)",
  backdropFilter: "blur(28px)",
  WebkitBackdropFilter: "blur(28px)",
  border: "1px solid rgba(255,255,255,0.52)",
  boxShadow: "0 8px 28px rgba(121,100,72,0.07)",
  borderRadius: 24,
  overflow: "hidden",
  position: "relative",
};

// Per-type accent glow color (corner hint only, no big fills)
export const TYPE_META: Record<Keepsake["type"], {
  label: string; glow: string; accentText: string;
}> = {
  letter:  { label:"桌宠来信", glow:"rgba(246,231,168,0.45)", accentText:"#9C691D" },
  insight: { label:"今日洞察", glow:"rgba(246,231,168,0.35)", accentText:"#826E50" },
  scene:   { label:"片场记录", glow:"rgba(243,216,199,0.45)", accentText:"#A26458" },
  music:   { label:"音乐",     glow:"rgba(233,228,244,0.45)", accentText:"#75679D" },
  quote:   { label:"一句话",   glow:"rgba(243,216,199,0.35)", accentText:"#70656B" },
  moment:  { label:"时刻",     glow:"rgba(223,231,245,0.45)", accentText:"#70656B" },
};

export const CARD_TEMPLATE: Record<Keepsake["type"], CardTemplate> = {
  insight: "text", quote: "text", moment: "text",
  music: "media",
  letter: "experience", scene: "experience",
};

export const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.88' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='150' height='150' filter='url(%23n)' opacity='0.026'/%3E%3C/svg%3E\")";

export function KeepsakeArtifact({ item, onOpen }: { item: Keepsake; onOpen: () => void }) {
  const meta = TYPE_META[item.type];
  const template = CARD_TEMPLATE[item.type];

  const TypeIcon = () => {
    if (item.type === "letter")  return <Mail   size={11} strokeWidth={1.5}/>;
    if (item.type === "scene")   return <Film   size={11} strokeWidth={1.5}/>;
    if (item.type === "music")   return <Music  size={11} strokeWidth={1.5}/>;
    if (item.type === "moment")  return <MapPin size={11} strokeWidth={1.5}/>;
    return null;
  };

  return (
    <motion.div
      onClick={onOpen}
      whileTap={{ scale: 0.98, transition: { duration: 0.14, ease: "easeOut" } }}
      className="cursor-pointer mb-3">
      <div style={GLASS_CARD}>
        {/* Grain texture */}
        <div style={{ position:"absolute", inset:0, backgroundImage:GRAIN, opacity:0.5,
          pointerEvents:"none", zIndex:0 }}/>
        {/* Corner glow — type hint */}
        <div style={{
          position:"absolute", top:-18, right:-18, width:64, height:64, borderRadius:"50%",
          background:`radial-gradient(circle,${meta.glow} 0%,transparent 70%)`,
          pointerEvents:"none", zIndex:0,
        }}/>

        {/* ── Template A: Text card (insight / quote / moment) ── */}
        {template === "text" && (
          <div style={{ position:"relative", zIndex:1, padding:"14px 15px 14px" }}>
            {/* Type label row */}
            <div className="flex items-center gap-1.5 mb-3">
              <div style={{ color: meta.accentText }}>
                <TypeIcon/>
              </div>
              <span className="text-[11px] tracking-wide uppercase"
                style={{ color: meta.accentText, letterSpacing:"0.04em", fontWeight:500 }}>
                {meta.label}
              </span>
            </div>
            {/* Core sentence */}
            <p className="text-[14px] font-medium leading-snug mb-3"
              style={{ color:"#484145" }}>
              {item.title}
            </p>
            {/* Excerpt */}
            {item.excerpt && (
              <p className="text-[12px] leading-snug mb-3" style={{ color:"#655D61" }}>
                {item.excerpt}
              </p>
            )}
            {/* Source + date */}
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color:"#7E7479" }}>{item.source}</span>
              <span className="text-[11px]" style={{ color:"#7E7479" }}>{item.savedAt}</span>
            </div>
          </div>
        )}

        {/* ── Template B: Media card (music) ── */}
        {template === "media" && (
          <div style={{ position:"relative", zIndex:1, padding:"13px 13px 12px" }}>
            {/* Soft gradient cover */}
            <div style={{
              width:"100%", aspectRatio:"1",
              borderRadius:14, marginBottom:10, overflow:"hidden",
              background:"linear-gradient(140deg,rgba(233,228,244,0.72) 0%,rgba(246,231,168,0.38) 100%)",
              display:"flex", alignItems:"center", justifyContent:"center",
              border:"1px solid rgba(255,255,255,0.45)",
            }}>
              <Music size={22} strokeWidth={1.5} style={{ color:"#75679D" }}/>
            </div>
            {/* Type label */}
            <div className="flex items-center gap-1 mb-1.5">
              <span className="text-[11px] uppercase tracking-wide"
                style={{ color: meta.accentText, fontWeight:500, letterSpacing:"0.04em" }}>
                {meta.label}
              </span>
            </div>
            {/* Title */}
            <p className="text-[14px] font-medium leading-tight mb-1 truncate"
              style={{ color:"#484145" }}>{item.title}</p>
            {/* Excerpt */}
            {item.excerpt && (
              <p className="text-[12px] leading-snug mb-2 truncate" style={{ color:"#655D61" }}>
                {item.excerpt}
              </p>
            )}
            {/* Bottom row */}
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px]" style={{ color:"#7E7479" }}>{item.savedAt}</span>
              {/* Play button */}
              <div className="flex items-center justify-center rounded-full"
                style={{
                  width:26, height:26,
                  background:"rgba(255,255,255,0.55)",
                  border:"1px solid rgba(255,255,255,0.5)",
                }}>
                <Play size={9} strokeWidth={2} style={{ color:"#75679D", marginLeft:1 }}/>
              </div>
            </div>
          </div>
        )}

        {/* ── Template C: Experience card (letter / scene) ── */}
        {template === "experience" && (
          <div style={{ position:"relative", zIndex:1, padding:"14px 15px 14px" }}>
            {/* Type label row */}
            <div className="flex items-center gap-1.5 mb-3">
              <div style={{ color: meta.accentText }}>
                <TypeIcon/>
              </div>
              <span className="text-[11px] uppercase tracking-wide"
                style={{ color: meta.accentText, fontWeight:500, letterSpacing:"0.04em" }}>
                {meta.label}
              </span>
            </div>
            {/* Title */}
            <p className="text-[14px] font-medium leading-snug mb-2"
              style={{ color:"#484145" }}>{item.title}</p>
            {/* Excerpt */}
            {item.excerpt && (
              <p className="text-[12px] leading-snug mb-3"
                style={{ color:"#655D61", fontStyle:"italic" }}>
                {item.excerpt}
              </p>
            )}
            {/* Source + date */}
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color:"#7E7479" }}>{item.source}</span>
              <span className="text-[11px]" style={{ color:"#7E7479" }}>{item.savedAt}</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Keepsake Detail ──────────────────────────────────────────────────────────

export function KeepsakeDetail({ item, onClose, onRemove }: {
  item: Keepsake; onClose: () => void; onRemove: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const meta = TYPE_META[item.type];
  return (
    <motion.div className="absolute inset-0 z-40"
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      transition={{ duration:0.18 }}>
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose}
        style={{ background:"rgba(255,251,243,0.72)", backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)" }}/>
      {/* Card */}
      <motion.div className="absolute left-5 right-5 overflow-hidden" style={{ top:70, bottom:96 }}
        initial={{ scale:0.88, opacity:0, y:24 }}
        animate={{ scale:1, opacity:1, y:0 }}
        exit={{ scale:0.9, opacity:0, y:12 }}
        transition={{ type:"spring", damping:24, stiffness:220 }}>
        <div className="h-full overflow-y-auto rounded-[24px]"
          style={{ background:"rgba(255,252,245,0.92)", backdropFilter:"blur(32px)",
            WebkitBackdropFilter:"blur(32px)", borderRadius:24, scrollbarWidth:"none",
            boxShadow:"0 24px 64px rgba(121,100,72,0.14)" }}>
          {/* Grain */}
          <div style={{ position:"absolute", inset:0, backgroundImage:GRAIN, opacity:0.5, pointerEvents:"none",
            zIndex:0, borderRadius:24 }}/>
          <div style={{ position:"relative", zIndex:1, padding:"20px 20px 24px" }}>
            <div className="flex justify-end mb-3">
              <button onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center active:opacity-60"
                style={{ background:"var(--row-divider)" }}>
                <X size={14} style={{ color:"var(--text-secondary)" }}/>
              </button>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[11px] px-2.5 py-1 rounded-full font-medium"
                style={{ background:"rgba(255,255,255,0.65)", color:meta.accentText }}>{item.source}</span>
              <span className="text-[11px]" style={{ color:"#7E7479" }}>{item.savedAt}</span>
            </div>
            <h2 className="text-[19px] font-medium leading-snug mb-3" style={{ color:"#484145" }}>
              {item.title}
            </h2>
            {item.excerpt && (
              <p className="text-[14px] leading-relaxed mb-4" style={{ color:"#655D61" }}>{item.excerpt}</p>
            )}
            <div className="flex flex-col gap-1.5 mb-5 pb-5"
              style={{ borderBottom:"1px solid rgba(98,87,93,0.12)" }}>
              <div className="flex items-center gap-2">
                <span className="text-[12px]" style={{ color:"#7E7479" }}>来自</span>
                <span className="text-[12px]" style={{ color:"#655D61" }}>{item.source}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px]" style={{ color:"#7E7479" }}>陪伴</span>
                <span className="text-[12px]" style={{ color:"#655D61" }}>{item.petName} 🌿</span>
              </div>
            </div>
            {/* Type-specific actions */}
            <div className="flex flex-col gap-2">
              {item.type === "letter" && (
                <button className="w-full py-3 rounded-full text-[14px] active:scale-[0.97] transition-transform"
                  style={{ background:"rgba(246,231,168,0.72)", color:"#4D4249" }}>
                  回到对话
                </button>
              )}
              {item.type === "scene" && (
                <button className="w-full py-3 rounded-full text-[14px] active:scale-[0.97] transition-transform"
                  style={{ background:"rgba(243,218,202,0.65)", color:"var(--text-primary)" }}>
                  再次体验场景
                </button>
              )}
              {item.type === "music" && (
                <button className="w-full py-3 rounded-full text-[14px] active:scale-[0.97] transition-transform"
                  style={{ background:"rgba(233,228,244,0.72)", color:"var(--text-primary)" }}>
                  播放歌曲
                </button>
              )}
              {!confirmRemove ? (
                <button onClick={() => setConfirmRemove(true)}
                  className="w-full py-2.5 text-[13px] active:opacity-60"
                  style={{ color:"var(--text-muted)" }}>
                  移出珍藏
                </button>
              ) : (
                <motion.div initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }}
                  className="rounded-[16px] p-4"
                  style={{ background:"rgba(255,252,245,0.7)", border:"1px solid rgba(255,255,255,0.45)" }}>
                  <p className="text-[13px] text-center mb-3" style={{ color:"var(--text-secondary)" }}>
                    移出后不能恢复，确定吗？
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmRemove(false)}
                      className="flex-1 py-2.5 rounded-full text-[13px] active:opacity-60"
                      style={{ background:"rgba(255,252,245,0.8)", color:"#655D61" }}>再想想</button>
                    <button onClick={onRemove}
                      className="flex-1 py-2.5 rounded-full text-[13px] font-medium active:opacity-60"
                      style={{ background:"rgba(243,218,202,0.65)", color:"var(--text-primary)" }}>确认移出</button>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Keepsake Filter Sheet ────────────────────────────────────────────────────

export function KeepsakeFilterSheet({ active, onSelect, onClose }: {
  active: string; onSelect: (f: string) => void; onClose: () => void;
}) {
  const filters = ["全部","来信","洞察","灵感","场景","音乐与书籍"];
  return (
    <BottomSheet onClose={onClose} title="筛选珍藏">
      <div className="px-5 pb-8 pt-2 flex flex-wrap gap-2">
        {filters.map(f => (
          <button key={f} onClick={() => { onSelect(f); onClose(); }}
            className="px-4 py-2.5 rounded-full text-[14px] transition-all active:scale-[0.97]"
            style={{
              background: active===f ? "rgba(246,231,168,0.88)" : "rgba(255,252,245,0.65)",
              color: active===f ? "#4B4346" : "#6E6764",
              border: active===f ? "1.5px solid rgba(156,105,29,0.35)" : "1px solid rgba(255,255,255,0.45)",
            }}>
            {f}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

// ─── Keepsake Album ───────────────────────────────────────────────────────────

export function KeepsakeAlbum({ keepsakes, onSelectItem, onRemove }: {
  keepsakes: Keepsake[];
  onSelectItem: (k: Keepsake) => void;
  onRemove: (id: string) => void;
}) {
  const [showFilter, setShowFilter] = useState(false);
  const [activeFilter, setActiveFilter] = useState("全部");

  const filterMap: Record<string, Keepsake["type"][]> = {
    "全部":      ["letter","insight","scene","music","quote","moment"],
    "来信":      ["letter"],
    "洞察":      ["insight"],
    "灵感":      ["quote"],
    "场景":      ["scene"],
    "音乐与书籍":["music"],
  };
  const visible = activeFilter === "全部"
    ? keepsakes
    : keepsakes.filter(k => (filterMap[activeFilter]||[]).includes(k.type));
  const leftCol  = visible.filter((_,i) => i % 2 === 0);
  const rightCol = visible.filter((_,i) => i % 2 !== 0);

  return (
    <div>
      {/* Filter row */}
      <div className="flex justify-end mb-3">
        <button onClick={() => setShowFilter(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] active:opacity-60"
          style={{ background:"rgba(255,252,245,0.65)", border:"1px solid rgba(255,255,255,0.45)", color:"#7E7479" }}>
          <SlidersHorizontal size={12}/>
          {activeFilter !== "全部" ? activeFilter : "筛选"}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center py-12 gap-4">
          <div style={{
            width:66, height:84, borderRadius:14,
            background:"rgba(255,252,245,0.65)", backdropFilter:"blur(16px)",
            border:"1px solid rgba(255,255,255,0.45)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:24,
          }}>✉</div>
          <div className="text-center">
            <p className="text-[15px] font-medium mb-1.5" style={{ color:"#484145" }}>这里还空着</p>
            <p className="text-[13px] leading-snug" style={{ color:"#7E7479" }}>
              只有你决定留下的东西，<br/>才会来到这里。
            </p>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="flex-1 flex flex-col">
            {leftCol.map(k => (
              <KeepsakeArtifact key={k.id} item={k} onOpen={() => onSelectItem(k)}/>
            ))}
          </div>
          <div className="flex-1 flex flex-col" style={{ marginTop: 20 }}>
            {rightCol.map(k => (
              <KeepsakeArtifact key={k.id} item={k} onOpen={() => onSelectItem(k)}/>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showFilter && (
          <KeepsakeFilterSheet active={activeFilter} onSelect={setActiveFilter} onClose={() => setShowFilter(false)}/>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Letter: Sealed Envelope ─────────────────────────────────────────────────

export function SealedEnvelope({ onOpen, isOpening }: { onOpen: () => void; isOpening: boolean }) {
  const [showRipple, setShowRipple] = useState(false);

  const handleTap = () => {
    setShowRipple(true);
    setTimeout(() => setShowRipple(false), 700);
    onOpen();
  };

  return (
    <motion.div
      onClick={handleTap}
      className="cursor-pointer relative flex flex-col items-center"
      whileTap={{ scale: 0.98, transition: { duration: 0.14, ease: "easeOut" } }}
      style={{ touchAction: "manipulation" }}
    >
      <CreamRipple active={showRipple}/>
      {/* Ambient glow */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 380, height: 260,
        background: "radial-gradient(ellipse, rgba(246,231,168,0.28) 0%, transparent 68%)",
        pointerEvents: "none", zIndex: 0,
      }}/>

      <div style={{ width: 320, height: 205, position: "relative", zIndex: 1 }}>
        {/* Envelope body */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(158deg, rgba(255,253,247,0.96) 0%, rgba(249,241,204,0.90) 100%)",
          borderRadius: 22,
          border: "1px solid rgba(255,255,255,0.58)",
          boxShadow: "0 18px 50px rgba(121,100,72,0.10), 0 2px 10px rgba(121,100,72,0.05)",
          overflow: "hidden",
        }}>
          {/* X fold lines */}
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(135deg, transparent 49.2%, rgba(160,140,100,0.055) 49.7%, transparent 50.2%)",
          }}/>
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(-135deg, transparent 49.2%, rgba(160,140,100,0.055) 49.7%, transparent 50.2%)",
          }}/>
          {/* Bottom V fold */}
          <div style={{
            position: "absolute", bottom: -1, left: -1, right: -1, height: 74,
            background: "rgba(243,216,199,0.18)",
            clipPath: "polygon(0 100%, 50% 0%, 100% 100%)",
          }}/>
          {/* Paper grain overlay */}
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E\")",
            opacity: 0.5,
          }}/>
          {/* Content */}
          <div style={{ position: "relative", zIndex: 2, padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 9,
                background: "rgba(246,231,168,0.72)",
                border: "1px solid rgba(255,255,255,0.55)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 17, boxShadow: "0 2px 8px rgba(121,100,72,0.08)",
              }}>🌿</div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 500, color: "var(--text-primary)", marginBottom: 6, letterSpacing: "-0.01em" }}>
              桐桐今天写给你
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 5 }}>
              {LETTER_DATA.deliveryTime}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {LETTER_DATA.preview}
            </div>
          </div>
        </div>

        {/* Animatable top flap */}
        <div style={{
          position: "absolute", top: 0, left: 0, width: 320, height: 102,
          perspective: "600px", perspectiveOrigin: "50% 0%",
          overflow: "visible", pointerEvents: "none", zIndex: 3,
        }}>
          <motion.div
            style={{
              width: 320, height: 102,
              background: "linear-gradient(178deg, rgba(249,242,210,0.92) 0%, rgba(255,252,245,0.80) 100%)",
              clipPath: "polygon(0 0, 100% 0, 50% 100%)",
              transformOrigin: "50% 0%",
              borderRadius: "22px 22px 0 0",
            }}
            animate={isOpening ? { rotateX: -164, opacity: 0.55 } : { rotateX: 0, opacity: 1 }}
            transition={{ duration: 0.26, ease: [0.45, 0, 0.55, 1] }}
          />
        </div>
      </div>

      <motion.p
        className="mt-5 text-[13px]"
        style={{ color: "var(--text-muted)", letterSpacing: "0.01em" }}
        animate={isOpening ? { opacity: 0 } : { opacity: 1 }}
        transition={{ duration: 0.15 }}
      >
        轻点拆开
      </motion.p>
    </motion.div>
  );
}

// ─── Letter: Attachment Card ──────────────────────────────────────────────────

export function LetterAttachment({ saved, onSave }: { saved: boolean; onSave: () => void }) {
  return (
    <div className="my-5 rounded-[18px] overflow-hidden"
      style={{
        background: "rgba(249,241,204,0.55)",
        border: "1px solid rgba(255,255,255,0.55)",
        boxShadow: "0 4px 14px rgba(121,100,72,0.07)",
      }}>
      <div className="px-4 py-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Music size={12} style={{ color: "#B98232" }}/>
          <span className="text-[12px] font-medium" style={{ color: "#B98232" }}>
            {LETTER_DATA.attachment.label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Album art placeholder */}
          <div className="w-12 h-12 rounded-[10px] flex-shrink-0 flex items-center justify-center text-xl"
            style={{
              background: "rgba(246,231,168,0.65)",
              border: "1px solid rgba(255,255,255,0.5)",
            }}>
            🎵
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium truncate" style={{ color: "#4D4249" }}>
              {LETTER_DATA.attachment.title}
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: "#8C8187" }}>
              {LETTER_DATA.attachment.artist}
            </div>
          </div>
        </div>
        <p className="text-[13px] mt-3 leading-snug" style={{ color: "#62575D" }}>
          {LETTER_DATA.attachment.reason}
        </p>
        <div className="flex gap-2 mt-3">
          <button className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium active:scale-[0.97] transition-transform"
            style={{ background: "rgba(246,231,168,0.72)", color: "#4D4249", border: "1px solid rgba(255,255,255,0.5)" }}>
            <Play size={11} fill="currentColor"/>
            试听一下
          </button>
          <button onClick={onSave}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] active:scale-[0.97] transition-transform"
            style={{
              background: saved ? "rgba(221,237,227,0.55)" : "rgba(255,255,255,0.5)",
              color: saved ? "#5A8A6A" : "#8C8187",
              border: "1px solid rgba(255,255,255,0.45)",
            }}>
            <Heart size={11} fill={saved ? "currentColor" : "none"}/>
            {saved ? "已留着" : "替我留着"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Letter: Actions ──────────────────────────────────────────────────────────

export function LetterActions({ saved, onAck, onReply, onSave }: {
  saved: boolean; onAck: () => void; onReply: () => void; onSave: () => void;
}) {
  return (
    <div className="mt-6">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button onClick={onAck}
            className="flex-1 py-3 rounded-full text-[14px] font-medium active:scale-[0.97] transition-transform"
            style={{ background: "rgba(246,231,168,0.75)", color: "#4D4249", border: "1px solid rgba(255,255,255,0.5)" }}>
            收到啦
          </button>
          <button onClick={onReply}
            className="flex-1 py-3 rounded-full text-[14px] active:scale-[0.97] transition-transform"
            style={{ background: "rgba(255,252,245,0.7)", color: "#62575D", border: "1px solid rgba(255,255,255,0.45)" }}>
            回它一句
          </button>
        </div>
        <button onClick={onSave}
          className="w-full py-3 rounded-full text-[14px] active:scale-[0.97] transition-transform"
          style={{
            background: saved ? "rgba(221,237,227,0.55)" : "rgba(255,252,245,0.6)",
            color: saved ? "#5A8A6A" : "#8C8187",
            border: "1px solid rgba(255,255,255,0.4)",
          }}>
          {saved ? "✓ 已经替你收好" : "把这封信留下"}
        </button>
      </div>
      {!saved && (
        <p className="text-center text-[11px] mt-3 leading-snug" style={{ color: "#8C8187" }}>
          如果不留下，它会在明天的新信到达时离开。
        </p>
      )}
      {saved && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className="text-center mt-3">
          <button className="text-[12px] active:opacity-60" style={{ color: "var(--text-muted)" }}>
            去长久珍藏看看
          </button>
        </motion.div>
      )}
    </div>
  );
}

// ─── Letter: Paper ────────────────────────────────────────────────────────────

export function LetterPaper({ saved, onAck, onReply, onSave }: {
  saved: boolean; onAck: () => void; onReply: () => void; onSave: () => void;
}) {
  const [attachSaved, setAttachSaved] = useState(false);
  return (
    <div style={{ width: "100%" }}>
      {/* Paper */}
      <div style={{
        background: "rgba(255,253,247,0.96)",
        borderRadius: 24,
        border: "1px solid rgba(255,255,255,0.6)",
        boxShadow: "0 12px 40px rgba(121,100,72,0.09), 0 2px 8px rgba(121,100,72,0.05)",
        overflow: "hidden",
        position: "relative",
      }}>
        {/* Subtle paper grain */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.022'/%3E%3C/svg%3E\")",
          opacity: 0.6, zIndex: 0,
        }}/>
        {/* Subtle left margin line */}
        <div style={{
          position: "absolute", left: 44, top: 0, bottom: 0, width: 1,
          background: "rgba(243,216,199,0.3)", zIndex: 0,
        }}/>

        <div style={{ position: "relative", zIndex: 1, padding: "24px 22px 22px 24px" }}>
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="text-[12px] mb-1" style={{ color: "#8C8187" }}>{LETTER_DATA.date}</div>
              <div className="text-[20px] font-medium leading-tight tracking-[-0.01em]"
                style={{ color: "#4D4249" }}>
                {LETTER_DATA.greeting}
              </div>
            </div>
            {/* Stamp placeholder */}
            <div style={{
              width: 38, height: 38, borderRadius: 8, flexShrink: 0,
              background: "rgba(246,231,168,0.6)",
              border: "1.5px dashed rgba(196,149,58,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18,
            }}>🌿</div>
          </div>

          {/* Body paragraphs */}
          <div className="flex flex-col gap-4">
            {LETTER_DATA.body.map((para, i) => (
              <p key={i} className="text-[15px] leading-[1.65]" style={{ color: "#62575D" }}>
                {para}
              </p>
            ))}
          </div>

          {/* Attachment card */}
          <LetterAttachment saved={attachSaved} onSave={() => setAttachSaved(s => !s)}/>

          {/* Signature */}
          <div className="flex items-center gap-3 mt-1 mb-1">
            <div>
              <div className="text-[15px]" style={{
                color: "#8C8187",
                fontStyle: "italic",
                letterSpacing: "0.02em",
              }}>
                {LETTER_DATA.from}
              </div>
            </div>
            {/* Doodle placeholder */}
            <div style={{
              width: 28, height: 28,
              background: "rgba(243,216,199,0.45)",
              borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14,
            }}>✦</div>
          </div>

          {/* Actions */}
          <LetterActions saved={saved} onAck={onAck} onReply={onReply} onSave={onSave}/>
        </div>
      </div>
    </div>
  );
}

// ─── Letter: Waiting State ────────────────────────────────────────────────────

export function WaitingLetterState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-5">
      <div style={{
        width: 120, height: 80, borderRadius: 14,
        background: "rgba(255,252,245,0.65)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.45)",
        boxShadow: "0 8px 24px rgba(121,100,72,0.07)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 28,
      }}>✉️</div>
      <div className="text-center">
        <p className="text-[15px] font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>今天的信还在路上</p>
        <p className="text-[13px] leading-snug" style={{ color: "var(--text-muted)" }}>
          有想告诉你的时候，它会送来。
        </p>
      </div>
    </div>
  );
}

// ─── Letter: Daily Letter View ────────────────────────────────────────────────

export function DailyLetterView({ onReply, letterState, onOpenLetter, onSaveLetter, onAckLetter }: {
  onReply: () => void;
  letterState: LetterState;
  onOpenLetter: () => void;
  onSaveLetter: () => void;
  onAckLetter: () => void;
}) {
  const saved = letterState === "saved";
  const isOpening = letterState === "opening";
  const showEnvelope = letterState === "sealed" || letterState === "opening";
  const showLetter = letterState === "opened" || letterState === "saved";

  return (
    <div className="flex flex-col">
      <AnimatePresence mode="wait">
        {letterState === "waiting" && (
          <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <WaitingLetterState/>
          </motion.div>
        )}

        {showEnvelope && (
          <motion.div key="envelope"
            className="flex flex-col items-center py-8"
            exit={{ opacity: 0, y: -16, scale: 0.97 }}
            transition={{ duration: 0.25 }}>
            <SealedEnvelope onOpen={onOpenLetter} isOpening={isOpening}/>
          </motion.div>
        )}

        {showLetter && (
          <motion.div key="letter"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 190, mass: 0.9 }}>
            <LetterPaper
              saved={saved}
              onAck={onAckLetter}
              onReply={onReply}
              onSave={onSaveLetter}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Mailbox ─────────────────────────────────────────────────────────────────

export function MailboxScreen({ onTaskDetail, onStorageDetail, letterState, onOpenLetter, onSaveLetter, onAckLetter, onReplyLetter }: {
  onTaskDetail: () => void;
  onStorageDetail: () => void;
  letterState: LetterState;
  onOpenLetter: () => void;
  onSaveLetter: () => void;
  onAckLetter: () => void;
  onReplyLetter: () => void;
}) {
  const night = useNight();
  const [sec, setSec] = useState(0);
  const sections = ["桌宠来信", "今日待启", "长久珍藏", "三日寄存"];

  // Tasks state
  const [tasks, setTasks]               = useState<Task[]>(INITIAL_TASKS);
  const [selectedDate, setSelectedDate] = useState(TODAY_DATE);
  const [weekOffset, setWeekOffset]     = useState(0);
  const [showAddTask, setShowAddTask]   = useState(false);

  // Keepsake state
  const [keepsakes, setKeepsakes]           = useState<Keepsake[]>(INITIAL_KEEPSAKES);
  const [selectedKeepsake, setSelectedKeepsake] = useState<Keepsake | null>(null);

  const dayTasks = tasks.filter(t => t.date === selectedDate);

  const toggleTask = (id: string) =>
    setTasks(ts => ts.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  const deleteTask = (id: string) =>
    setTasks(ts => ts.filter(t => t.id !== id));
  const addTask = (t: Task) =>
    setTasks(ts => [...ts, t]);
  const removeKeepsake = (id: string) => {
    setKeepsakes(ks => ks.filter(k => k.id !== id));
    setSelectedKeepsake(null);
  };

  return (
    <div className="flex flex-col h-full relative">
      <div className="px-5 pt-[52px] pb-3 flex-shrink-0">
        <h1 className="text-[26px] font-medium tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>信箱</h1>
      </div>
      <div className="px-5 mb-4 flex-shrink-0">
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {sections.map((s, i) => (
            <button key={i} onClick={() => setSec(i)}
              className="flex-shrink-0 px-4 py-2 rounded-full text-[13px] font-medium transition-all duration-150"
              style={{
                background: sec === i
                  ? (night ? "rgba(216,188,118,0.32)" : "rgba(246,231,168,0.88)")
                  : (night ? "rgba(59,51,64,0.55)" : "rgba(255,252,245,0.65)"),
                color: sec === i
                  ? (night ? "#F4EFEA" : "#494145")
                  : (night ? "#B7ADB4" : "#6E6764"),
                border: night ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.4)",
                backdropFilter: "blur(16px)",
              }}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-[100px]" style={{ scrollbarWidth: "none" }}>
        <AnimatePresence mode="wait">
          <motion.div key={sec} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2 }}>
            {sec === 1 && (
              <>
                <WeekNavigator
                  weekOffset={weekOffset}
                  selectedDate={selectedDate}
                  onWeekChange={d => setWeekOffset(o => o + d)}
                  onSelectDate={setSelectedDate}
                  tasks={tasks}
                />
                <AnimatePresence mode="wait">
                  <motion.div key={selectedDate}
                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.2 }}>
                    <DailyTaskList
                      selectedDate={selectedDate}
                      tasks={dayTasks}
                      onToggle={toggleTask}
                      onDelete={deleteTask}
                      onAdd={() => setShowAddTask(true)}
                    />
                  </motion.div>
                </AnimatePresence>
              </>
            )}
            {sec === 0 && (
              <DailyLetterView
                letterState={letterState}
                onOpenLetter={onOpenLetter}
                onSaveLetter={onSaveLetter}
                onAckLetter={onAckLetter}
                onReply={onReplyLetter}
              />
            )}
            {sec === 2 && (
              <KeepsakeAlbum
                keepsakes={keepsakes}
                onSelectItem={setSelectedKeepsake}
                onRemove={removeKeepsake}
              />
            )}
            {sec === 3 && (
              <>
                {[
                  { title: "那次和妈妈的通话",    time: "2天后到期", tag: "温暖" },
                  { title: "昨晚想到的一个主意",  time: "1天后到期", tag: "灵感" },
                  { title: "有点烦那件事",         time: "今天到期",  tag: "情绪" },
                ].map((s, i) => (
                  <GlassCard key={i} className="p-4 flex items-center gap-4 mb-3" onClick={onStorageDetail}>
                    <div className="flex-1">
                      <div className="text-[15px] font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>{s.title}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(246,231,168,0.65)", color: "#655D61" }}>{s.tag}</span>
                        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{s.time}</span>
                      </div>
                    </div>
                    <ChevronRight size={15} style={{ color: "var(--text-muted)" }}/>
                  </GlassCard>
                ))}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* AddTask bottom sheet */}
      <AnimatePresence>
        {showAddTask && (
          <AddTaskSheet
            defaultDate={selectedDate}
            onClose={() => setShowAddTask(false)}
            onAdd={addTask}
          />
        )}
      </AnimatePresence>

      {/* Keepsake detail overlay */}
      <AnimatePresence>
        {selectedKeepsake && (
          <KeepsakeDetail
            item={selectedKeepsake}
            onClose={() => setSelectedKeepsake(null)}
            onRemove={() => removeKeepsake(selectedKeepsake.id)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Task Detail ─────────────────────────────────────────────────────────────

export function TaskDetail({ onBack }: { onBack: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack} title="今日待启"/>
      <div className="flex-1 px-5 pt-4 pb-[100px] flex flex-col gap-4">
        <GlassCard className="p-6">
          <div className="text-3xl mb-3">📅</div>
          <h2 className="text-[20px] font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>与朋友的约定</h2>
          <p className="text-[14px] mb-3" style={{ color: "var(--text-secondary)" }}>下午 3:00 · 你昨晚提到担心会迟到</p>
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            昨晚你说起这件事，有点担心来不及。我帮你留着了。
          </p>
        </GlassCard>
        <button onClick={() => setDone(!done)}
          className="w-full p-4 rounded-[20px] flex items-center gap-3 transition-all duration-200 active:scale-[0.97]"
          style={{
            background: done ? "rgba(246,231,168,0.6)" : "rgba(255,252,245,0.65)",
            border: "1px solid rgba(255,255,255,0.45)",
            backdropFilter: "blur(20px)",
          }}>
          <div className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{
              background: done ? "rgba(196,149,58,0.8)" : "transparent",
              border: `2px solid ${done ? "rgba(196,149,58,0.8)" : "rgba(91,79,62,0.22)"}`,
            }}>
            {done && <Check size={12} style={{ color: "#fff" }}/>}
          </div>
          <span className={`text-[15px] font-medium ${done ? "line-through" : ""}`} style={{ color: "var(--text-primary)" }}>
            {done ? "已完成，做到了" : "标记为完成"}
          </span>
        </button>
        {done && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <GlassCard className="p-4 text-center" style={{ background: "rgba(221,237,227,0.45)" }}>
              <p className="text-[14px]" style={{ color: "var(--text-primary)" }}>做完了，今天又少了一件事 🌿</p>
            </GlassCard>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─── Storage Detail ───────────────────────────────────────────────────────────

export function StorageDetail({ onBack }: { onBack: () => void }) {
  const [action, setAction] = useState<"none" | "treasure" | "release">("none");
  return (
    <div className="flex flex-col h-full">
      <SafeHeader onBack={onBack} title="三日寄存"/>
      <div className="flex-1 px-5 pt-4 pb-[100px] flex flex-col gap-4">
        <GlassCard className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] px-2.5 py-1 rounded-full font-medium"
              style={{ background: "rgba(246,231,168,0.7)", color: "#655D61" }}>情绪</span>
            <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>1天后到期</span>
          </div>
          <h2 className="text-[18px] font-medium mb-3" style={{ color: "var(--text-primary)" }}>那次和妈妈的通话</h2>
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            昨晚说到你们的对话，你有点担心她最近的状态。这个感受被我留在这里了，三天后如果你没有更多想说的，我会轻轻放下它。
          </p>
        </GlassCard>
        {action === "none" && (
          <div className="flex gap-3">
            <button onClick={() => setAction("treasure")}
              className="flex-1 py-4 rounded-[20px] flex flex-col items-center gap-2 active:scale-[0.97] transition-transform"
              style={{ background: "rgba(246,231,168,0.55)", border: "1px solid rgba(255,255,255,0.4)" }}>
              <Star size={20} style={{ color: "#C4953A" }}/>
              <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>珍藏</span>
            </button>
            <button onClick={() => setAction("release")}
              className="flex-1 py-4 rounded-[20px] flex flex-col items-center gap-2 active:scale-[0.97] transition-transform"
              style={{ background: "rgba(221,237,227,0.55)", border: "1px solid rgba(255,255,255,0.4)" }}>
              <Archive size={20} style={{ color: "#5A8A6A" }}/>
              <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>放下</span>
            </button>
          </div>
        )}
        {action !== "none" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <GlassCard className="p-5 text-center"
              style={{ background: action === "treasure" ? "rgba(246,231,168,0.42)" : "rgba(221,237,227,0.42)" }}>
              <div className="text-2xl mb-2">{action === "treasure" ? "⭐" : "🌊"}</div>
              <p className="text-[14px]" style={{ color: "var(--text-primary)" }}>
                {action === "treasure" ? "已加入长久珍藏" : "已轻轻放下，谢谢你把它告诉我"}
              </p>
            </GlassCard>
          </motion.div>
        )}
      </div>
    </div>
  );
}
