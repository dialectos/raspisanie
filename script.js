'use strict';

// 09.11.2026 — понедельник верхней недели. Дальше недели чередуются каждые 7 дней.
// Даты и текущая пара рассчитываются по времени Читы, даже если устройство в другом часовом поясе.
const UPPER_ANCHOR = '2026-11-09';
const TIME_ZONE = 'Asia/Chita';
const STORAGE_KEY = 'schedule-simple-v2';

// Время строго по расписанию. Настройка времени пользователю не требуется.
const PERIODS = [
  ['08:30', '10:05'],
  ['10:15', '11:50'],
  ['12:35', '14:10'],
  ['14:20', '15:55'],
];

// 0 = понедельник, 1 = вторник, ... 5 = суббота.
// period — номер пары; type: 'Лекция' или 'Практика'.
const LESSONS = {
  upper: {
    2: [
      { period:1, title:'Актуальные проблемы семейного права', type:'Лекция', room:'422' },
      { period:2, title:'Актуальные проблемы семейного права', type:'Практика', room:'422' },
      { period:3, title:'Профессиональная этика', type:'Лекция', room:'217' },
      { period:4, title:'Английский язык', type:'Практика', room:'210' },
    ],
    3: [
      { period:1, title:'Актуальные проблемы гражданского права', type:'Лекция', room:'216', building:'экономфак' },
      { period:2, title:'МЧП', type:'Практика', room:'313' },
      { period:3, title:'НИС', type:'Практика', room:'302' },
      { period:4, title:'Юридическая техника', type:'Практика', room:'302' },
    ],
  },
  lower: {
    2: [
      { period:1, title:'Философия права', type:'Лекция', room:'422' },
      { period:2, title:'Философия права', type:'Практика', room:'422' },
      { period:3, title:'Профессиональная этика', type:'Практика', room:'422' },
      { period:4, title:'Юридическая техника', type:'Лекция', room:'302' },
    ],
    3: [
      { period:1, title:'Актуальные проблемы гражданского права', type:'Практика', room:'216', building:'экономфак' },
      { period:2, title:'МЧП', type:'Лекция', room:'313' },
    ],
  },
};

const DAYS = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
const pad = n => String(n).padStart(2, '0');
const toMinutes = time => Number(time.slice(0,2)) * 60 + Number(time.slice(3,5));
const dateNumber = date => {
  const [y,m,d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y,m-1,d) / 86400000);
};
const isoDate = dayNumber => new Date(dayNumber*86400000).toISOString().slice(0,10);
const addDays = (iso,days) => isoDate(dateNumber(iso)+days);
const weekDay = iso => (new Date(dateNumber(iso)*86400000).getUTCDay()+6)%7;
const monday = iso => addDays(iso,-weekDay(iso));
function isUpper(iso) {
  const n = Math.round((dateNumber(monday(iso))-dateNumber(UPPER_ANCHOR))/7);
  return ((n%2)+2)%2===0;
}
const weekType = iso => isUpper(iso) ? 'upper' : 'lower';
const dateFormat = (iso, options) => new Intl.DateTimeFormat('ru-RU', {timeZone:'UTC', ...options})
  .format(new Date((dateNumber(iso)*86400000)+12*3600000));
const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

const nowFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone:TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
});
function getNow() {
  const p = Object.fromEntries(nowFormatter.formatToParts(new Date()).map(x => [x.type,x.value]));

  return { iso:`${p.year}-${p.month}-${p.day}`, minutes:Number(p.hour)*60+Number(p.minute) };
}
function getEvents(iso) {
  return (LESSONS[weekType(iso)][weekDay(iso)] || []).map(entry => ({
    ...entry, date:iso, start:PERIODS[entry.period-1][0], end:PERIODS[entry.period-1][1],
  }));
}

// По умолчанию показываем неделю с ближайшими занятиями.
// В четверг после последней пары и в выходные автоматически переходим к следующей неделе.
function nearestTeachingMonday(now) {
  const current = monday(now.iso);
  for (let shift=0;shift<8;shift++) {
    const start=addDays(current,shift*7);
    for (let day=0;day<6;day++) {
      const iso=addDays(start,day);
      for (const e of getEvents(iso)) {
        if (dateNumber(iso)>dateNumber(now.iso) || (iso===now.iso && toMinutes(e.end)>now.minutes)) {
          return start;
        }
      }
    }
  }
  return current;
}
function upcomingEvents(now) {
  const future=[];
  for (let d=0;d<22 && future.length<3;d++) {
    const date=addDays(now.iso,d);
    for (const e of getEvents(date)) {
      if (d===0 && toMinutes(e.end)<=now.minutes) continue;
      future.push(e);
    }
  }
  const current=future.find(e => e.date===now.iso && toMinutes(e.start)<=now.minutes && now.minutes<toMinutes(e.end));
  const next=future.find(e => e!==current && (e.date>now.iso || toMinutes(e.start)>now.minutes));
  return { current, next };
}

function getSettings() {
  const defaults={showEmptyDays:false,theme:'system'};
  try {
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));
    const old=JSON.parse(localStorage.getItem('pary.settings.v1'));
    const theme=saved?.theme || old?.theme || defaults.theme;
    return {
      showEmptyDays:typeof saved?.showEmptyDays==='boolean' ? saved.showEmptyDays : false,
      theme:['light','dark','system'].includes(theme) ? theme : 'system',
    };
  } catch {return defaults;}
}
let settings=getSettings();
let baseMonday=nearestTeachingMonday(getNow());
let selectedWeek=weekType(baseMonday);
let manuallySelected=false;
let lastMinuteKey='';
const $ = id => document.getElementById(id);
const saveSettings=() => { try { localStorage.setItem(STORAGE_KEY,JSON.stringify(settings)); } catch {} };

function applyTheme() {
  const resolved=settings.theme==='system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')
    : settings.theme;
  document.documentElement.dataset.theme=resolved;
  document.querySelector('meta[name="theme-color"]').content=resolved==='dark'?'#101319':'#f8f9fc';
  document.querySelectorAll('[data-theme]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.theme===settings.theme)));
}
function displayedMonday() {
  return selectedWeek===weekType(baseMonday) ? baseMonday : addDays(baseMonday,7);
}
function render() {
  const now=getNow();
  const start=displayedMonday();
  const finish=addDays(start,5);
  const startMonth=dateFormat(start,{day:'numeric',month:'long'}).replace(/^\d+\s*/, '');
  const endMonth=dateFormat(finish,{day:'numeric',month:'long'}).replace(/^\d+\s*/, '');
  const a=Number(start.slice(-2)), b=Number(finish.slice(-2));
  $('dateRange').textContent=startMonth===endMonth?`${a}–${b} ${endMonth}`:`${a} ${startMonth} — ${b} ${endMonth}`;
  $('upperWeek').setAttribute('aria-pressed', String(selectedWeek==='upper'));
  $('lowerWeek').setAttribute('aria-pressed', String(selectedWeek==='lower'));
  const {current,next}=upcomingEvents(now);
  const indices=settings.showEmptyDays?[0,1,2,3,4,5]:[2,3];
  $('schedule').innerHTML=indices.map(index=>{
    const iso=addDays(start,index);
    const lessons=getEvents(iso);
    const date=dateFormat(iso,{day:'numeric',month:'long'});
    const rows=lessons.map(entry=>{
      const isCurrent=Boolean(current && current.date===entry.date && current.period===entry.period);
      const isNext=Boolean(next && next.date===entry.date && next.period===entry.period);
      const status=isCurrent?'Сейчас':isNext?'Следующая':'';
      return `<article class="lesson ${isCurrent?'is-now':isNext?'is-next':''}" ${isCurrent?'aria-current="time"':''}>
        <span class="lesson-number">${entry.period}</span>
        <div class="lesson-clock"><time class="lesson-start">${entry.start}</time><time class="lesson-end">${entry.end}</time></div>
        <div class="lesson-detail"><h3 class="lesson-title">${escapeHTML(entry.title)}</h3>
          <div class="lesson-meta"><span>${entry.type}</span><span class="lesson-sep">·</span><span class="lesson-room">${escapeHTML(entry.room)} ауд.${entry.building?' · '+escapeHTML(entry.building):''}</span>${status?`<span class="lesson-status">${status}</span>`:''}</div>
        </div>
      </article>`;
    }).join('');
    return `<section class="day ${lessons.length?'':'is-empty'}" aria-label="${DAYS[index]}, ${date}">
      <header class="day-heading"><h2 class="day-name">${DAYS[index]}</h2><span class="day-date">${date}</span></header>
      ${lessons.length?`<div class="lesson-list">${rows}</div>`:'<p class="empty-copy">Нет занятий</p>'}
    </section>`;
  }).join('');
}

$('openSettings').addEventListener('click',()=> $('settingsDialog').showModal());
$('closeSettings').addEventListener('click',()=> $('settingsDialog').close());
$('settingsDialog').addEventListener('click',e=> { if(e.target===$('settingsDialog')) $('settingsDialog').close(); });
$('showEmptyDays').checked=settings.showEmptyDays;
$('showEmptyDays').addEventListener('change',e=> {settings.showEmptyDays=e.target.checked;saveSettings();render();});
document.querySelectorAll('[data-week]').forEach(button=>button.addEventListener('click',()=>{
  selectedWeek=button.dataset.week;manuallySelected=true;render();
}));
document.querySelectorAll('[data-theme]').forEach(button=>button.addEventListener('click',()=>{
  settings.theme=button.dataset.theme;saveSettings();applyTheme();
}));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{
  if(settings.theme==='system') applyTheme();
});
function tick() {
  const now=getNow();
  const key=`${now.iso} ${now.minutes}`;
  if(key===lastMinuteKey) return;
  lastMinuteKey=key;
  const nearest=nearestTeachingMonday(now);
  if(nearest!==baseMonday) {
    baseMonday=nearest;
    if(!manuallySelected) selectedWeek=weekType(baseMonday);
  }
  render();
}
applyTheme();
tick();
window.setInterval(tick,10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden) tick();});
