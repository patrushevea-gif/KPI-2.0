/* =========================================================
   BPMN Rossilber — editor (app.js)
   Единый файл, без зависимостей. Весь рендер — SVG + DOM.
   Архитектура:
     - state { nodes[], edges[], selection, camera, history }
     - рендер: render() -> перерисовывает только изменённое
     - шейпы: SHAPES[kind] => { label, category, w, h, draw(node) }
   ========================================================= */
'use strict';

/* ---------- namespaces & helpers ---------- */
const SVG_NS = 'http://www.w3.org/2000/svg';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const svgEl = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const escapeXml = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ---------- default palette colors ---------- */
const PALETTES = {
    blue:   { fill:'#eaf1ff', stroke:'#2c66f5', text:'#111827' },
    purple: { fill:'#f0eaff', stroke:'#7b5cfa', text:'#111827' },
    green:  { fill:'#e6f7ef', stroke:'#10b981', text:'#0f5132' },
    orange: { fill:'#fff3e0', stroke:'#f59e0b', text:'#7a4a00' },
    yellow: { fill:'#fde68a', stroke:'#b45309', text:'#5b3a00' },
    red:    { fill:'#fee2e2', stroke:'#ef4444', text:'#7f1d1d' },
    gray:   { fill:'#f3f4f6', stroke:'#6b7280', text:'#111827' },
    white:  { fill:'#ffffff', stroke:'#1f2937', text:'#111827' },
};

/* ---------- state ---------- */
const state = {
    nodes: [],                  // {id, kind, x, y, w, h, text, fill, stroke, fontSize, level, critical, raci:{R,A,C,I}, pi, kpi, sop, z}
    edges: [],                  // {id, source:{id,port}, target:{id,port}, kind, label, waypoints}
    selection: { nodes: new Set(), edges: new Set() },
    camera: { x: 0, y: 0, zoom: 1 },
    grid: 10,
    snap: true,
    showGrid: true,
    ortho: true,
    clipboard: null,
    history: [],
    historyPos: -1,
    currentLevel: 2,
};

/* ---------- SHAPES (BPMN + SDCA) ----------
   kind => {
     label, category, defaults:{w,h,fill,stroke,text},
     draw(node): returns SVG DOM of the shape (without text),
     anchor(node, side): returns {x,y} of connection point
   }
----------------------------------------------*/
/* ---------- tooltips (краткое описание артефакта при наведении) ---------- */
const TOOLTIPS = {
    // events
    'event-start':        'Начало процесса — первый шаг.',
    'event-intermediate': 'Событие в середине процесса.',
    'event-end':          'Завершение процесса.',
    'event-timer':        'Ожидание по времени или расписанию.',
    'event-start-message':'Старт по получению сообщения.',
    'event-int-message':  'Получение сообщения в процессе.',
    'event-int-message-throw':'Отправка сообщения в процессе.',
    'event-end-message':  'Завершение с отправкой сообщения.',
    'event-boundary-message-int':   'Прерывает задачу при сообщении.',
    'event-boundary-message-nonint':'Реагирует без прерывания задачи.',
    'event-int-timer':    'Пауза процесса по таймеру.',
    'event-boundary-timer-int':   'Прерывает задачу по таймауту.',
    'event-boundary-timer-nonint':'Запуск параллельно по таймеру.',
    'event-end-terminate':'Немедленное прекращение всего процесса.',
    'event-int-error':    'Обработка известной ошибки.',
    'event-boundary-error':'Перехват ошибки внутри задачи.',
    'event-end-error':    'Завершение с ошибкой.',
    'event-int-cancel':   'Отмена транзакции внутри процесса.',
    'event-end-cancel':   'Завершение с отменой транзакции.',
    'event-int-compensation':'Запуск компенсации выполненных действий.',
    'event-end-compensation':'Завершение с компенсацией.',
    'event-int-escalation':'Передача управления вверх по процессу.',
    'event-end-escalation':'Завершение с эскалацией наверх.',
    'event-start-condition':'Старт по выполнению условия.',
    'event-int-condition':  'Срабатывает при выполнении условия.',
    'event-boundary-condition-int':   'Прерывает задачу при условии.',
    'event-boundary-condition-nonint':'Реагирует без прерывания.',
    'event-int-link-catch':'Вход в звено цепочки процесса.',
    'event-int-link-throw':'Переход в другую часть процесса.',
    'event-start-signal':'Старт при получении сигнала.',
    'event-int-signal':  'Приём/отправка широковещательного сигнала.',
    'event-end-signal':  'Завершение с отправкой сигнала.',
    'event-start-complex':'Старт при нескольких условиях.',
    'event-int-complex':  'Комбинация нескольких событий.',
    'event-end-complex':  'Завершение нескольких веток сразу.',
    'event-start-parallel-multi':'Старт при всех событиях одновременно.',
    'event-int-parallel-multi':  'Сработает только после всех событий.',

    // tasks
    'task':           'Обычная задача в процессе.',
    'task-critical':  'Критичная задача — прямое влияние на результат.',
    'task-manual':    'Выполняется человеком вручную.',
    'task-auto':      'Выполняется системой автоматически.',
    'task-external':  'Задача другого отдела или контрагента.',
    'subprocess':     'Группа задач, разворачиваемая в отдельный процесс.',

    // gateways
    'gateway-x':          'Эксклюзивное «ИЛИ» — одна ветка из нескольких.',
    'gateway-plus':       'Параллельное «И» — все ветки одновременно.',
    'gateway-o':          'Включающее «ИЛИ» — одна или несколько веток.',
    'gateway-event':      'Ветвление по первому наступившему событию.',
    'gateway-event-instance':'XOR-события с созданием нового процесса.',
    'gateway-parallel-event-instance':'Все события — один новый процесс.',
    'gateway-complex':    'Сложное условие ветвления или слияния.',

    // data & systems
    'data-io':        'Общие входы или выходы процесса.',
    'data-object':    'Документ, отчёт или информационный объект.',
    'data-store':     'Система или база данных процесса.',
    'data-external':  'Внешний контрагент или лицо.',
    'pi':             'Индикатор эффективности задачи (PI).',
    'kpi':            'Ключевой показатель эффективности (KPI).',
    'sop':            'Методика или инструкция к задаче.',

    // artifacts (Приложение Г)
    'data-input':     'Исходные данные, входящие в задачу.',
    'data-output':    'Результат выполнения задачи.',
    'data-collection':'Пакет или набор однотипных объектов.',
    'data-storage':   'Место хранения данных — БД, архив.',
    'message-initiating':'Первое сообщение в цепочке взаимодействия.',
    'message-response':  'Ответ на инициирующее сообщение.',

    // swim
    'pool':  'Пул — участник процесса или организация.',
    'lane':  'Дорожка — роль, отдел или исполнитель.',
    'group': 'Визуальная группировка связанных элементов.',

    // annotations
    'annotation':    'Текстовый комментарий к элементу.',
    'level-header':  'Заголовок уровня карты процессов.',
};

const CATEGORIES = [
    { id:'events',     title:'События' },
    { id:'tasks',      title:'Задачи' },
    { id:'gateways',   title:'Шлюзы / Развилки' },
    { id:'data',       title:'Данные и системы' },
    { id:'artifacts',  title:'Артефакты BPMN' },
    { id:'swim',       title:'Контейнеры' },
    { id:'annot',      title:'Аннотации' },
];

const SHAPES = {};

/* --- helper draws --- */
function drawRect(node, rx = 8) {
    const s = svgEl('rect', {
        class:'shape', x:0, y:0, width:node.w, height:node.h, rx, ry:rx,
        fill:node.fill, stroke:node.stroke, 'stroke-width': node.strokeWidth || 1.4,
    });
    if (node.dashed) s.setAttribute('stroke-dasharray','6 4');
    return s;
}
function drawCircle(node) {
    const r = Math.min(node.w, node.h)/2;
    return svgEl('ellipse', {
        class:'shape', cx:node.w/2, cy:node.h/2, rx:node.w/2, ry:node.h/2,
        fill:node.fill, stroke:node.stroke, 'stroke-width': node.strokeWidth || 1.6,
    });
}
function drawDiamond(node) {
    const w = node.w, h = node.h;
    const pts = `${w/2},0 ${w},${h/2} ${w/2},${h} 0,${h/2}`;
    return svgEl('polygon', {
        class:'shape', points: pts,
        fill:node.fill, stroke:node.stroke, 'stroke-width': node.strokeWidth || 1.6,
    });
}
function drawParallelogram(node) {
    const w = node.w, h = node.h, skew = Math.min(20, h*0.35);
    const pts = `${skew},0 ${w},0 ${w-skew},${h} 0,${h}`;
    return svgEl('polygon', {
        class:'shape', points: pts,
        fill:node.fill, stroke:node.stroke, 'stroke-width':1.4,
    });
}
function drawHexagon(node) {
    const w = node.w, h = node.h, off = Math.min(18, w*0.18);
    const pts = `${off},0 ${w-off},0 ${w},${h/2} ${w-off},${h} ${off},${h} 0,${h/2}`;
    return svgEl('polygon', { class:'shape', points:pts,
        fill:node.fill, stroke:node.stroke, 'stroke-width':1.4 });
}
function drawDocument(node) {
    const w = node.w, h = node.h, wave = h*0.16;
    const d = `M 0 0 H ${w} V ${h-wave}
               C ${w*0.75} ${h+wave*0.4}, ${w*0.25} ${h-wave*1.6}, 0 ${h-wave} Z`;
    return svgEl('path', { class:'shape', d,
        fill:node.fill, stroke:node.stroke, 'stroke-width':1.4 });
}
function drawCylinder(node) {
    const w = node.w, h = node.h, e = Math.min(10, h*0.18);
    const d = `
      M 0 ${e}
      C 0 ${-e*0.2}, ${w} ${-e*0.2}, ${w} ${e}
      V ${h-e}
      C ${w} ${h+e*1.2}, 0 ${h+e*1.2}, 0 ${h-e}
      Z
      M 0 ${e}
      C 0 ${2*e}, ${w} ${2*e}, ${w} ${e}
    `;
    return svgEl('path', { class:'shape', d,
        fill:node.fill, stroke:node.stroke, 'stroke-width':1.4 });
}
function iconText(x, y, txt, size = 18, weight = 700, color = '#111827') {
    const t = svgEl('text', { x, y, 'text-anchor':'middle', 'dominant-baseline':'central',
        'font-family':'Inter, sans-serif', 'font-size':size, 'font-weight':weight, fill:color,
        'pointer-events':'none' });
    t.textContent = txt;
    return t;
}
function iconPath(d, color = '#111827', stroke = 1.6) {
    return svgEl('path', { d, fill:'none', stroke:color, 'stroke-width':stroke,
        'stroke-linecap':'round', 'stroke-linejoin':'round', 'pointer-events':'none' });
}

/* --- events --- */
SHAPES['event-start'] = {
    label:'Старт', category:'events',
    defaults:{ w:64, h:64, fill:'#e6f7ef', stroke:'#10b981', text:'Старт', fontSize:12, strokeWidth:2 },
    draw: drawCircle,
};
SHAPES['event-intermediate'] = {
    label:'Промежуточное', category:'events',
    defaults:{ w:64, h:64, fill:'#fff8e6', stroke:'#f59e0b', text:'Событие', fontSize:12, strokeWidth:2 },
    draw: (node) => {
        const g = svgEl('g');
        g.appendChild(drawCircle(node));
        g.appendChild(svgEl('ellipse',{cx:node.w/2,cy:node.h/2,rx:node.w/2-4,ry:node.h/2-4,
            fill:'none',stroke:node.stroke,'stroke-width':1.2}));
        return g;
    },
};
SHAPES['event-end'] = {
    label:'Конец', category:'events',
    defaults:{ w:64, h:64, fill:'#fde2e1', stroke:'#ef4444', text:'Конец', fontSize:12, strokeWidth:3 },
    draw: drawCircle,
};
SHAPES['event-timer'] = {
    label:'Таймер', category:'events',
    defaults:{ w:64, h:64, fill:'#fff8e6', stroke:'#f59e0b', text:'Таймер', fontSize:12, strokeWidth:2 },
    draw: (node) => {
        const g = svgEl('g');
        g.appendChild(drawCircle(node));
        const cx = node.w/2, cy = node.h/2, r = Math.min(node.w,node.h)/2 - 10;
        g.appendChild(svgEl('circle',{cx,cy,r,fill:'none',stroke:node.stroke,'stroke-width':1.4}));
        g.appendChild(svgEl('line',{x1:cx,y1:cy,x2:cx,y2:cy-r+4,stroke:node.stroke,'stroke-width':1.6,'stroke-linecap':'round'}));
        g.appendChild(svgEl('line',{x1:cx,y1:cy,x2:cx+r-6,y2:cy,stroke:node.stroke,'stroke-width':1.6,'stroke-linecap':'round'}));
        return g;
    },
};

/* ---- event helpers (Приложение А) ----
   variant: 'start' | 'intermediate' | 'end' | 'boundary-int' | 'boundary-nonint'
*/
function eventBase(node, variant) {
    const g = svgEl('g');
    const cx = node.w/2, cy = node.h/2;
    const rOuter = node.w/2;
    if (variant === 'end') {
        g.appendChild(svgEl('ellipse',{class:'shape',cx,cy,rx:rOuter,ry:node.h/2,
            fill:node.fill,stroke:node.stroke,'stroke-width':3}));
    } else if (variant === 'intermediate' || variant === 'boundary-int') {
        g.appendChild(svgEl('ellipse',{class:'shape',cx,cy,rx:rOuter,ry:node.h/2,
            fill:node.fill,stroke:node.stroke,'stroke-width':1.5}));
        g.appendChild(svgEl('ellipse',{cx,cy,rx:rOuter-4,ry:node.h/2-4,
            fill:'none',stroke:node.stroke,'stroke-width':1.4,'pointer-events':'none'}));
    } else if (variant === 'boundary-nonint') {
        g.appendChild(svgEl('ellipse',{class:'shape',cx,cy,rx:rOuter,ry:node.h/2,
            fill:node.fill,stroke:node.stroke,'stroke-width':1.5,'stroke-dasharray':'3 2'}));
        g.appendChild(svgEl('ellipse',{cx,cy,rx:rOuter-4,ry:node.h/2-4,
            fill:'none',stroke:node.stroke,'stroke-width':1.4,
            'stroke-dasharray':'3 2','pointer-events':'none'}));
    } else {
        // start
        g.appendChild(svgEl('ellipse',{class:'shape',cx,cy,rx:rOuter,ry:node.h/2,
            fill:node.fill,stroke:node.stroke,'stroke-width':1.6}));
    }
    return g;
}
function eventIcon(node, trigger, filled) {
    const cx = node.w/2, cy = node.h/2;
    const color = filled ? '#ffffff' : node.stroke;
    const bg = filled ? node.stroke : 'transparent';
    const g = svgEl('g',{'pointer-events':'none'});
    if (trigger === 'message') {
        const w = 18, h = 12;
        g.appendChild(svgEl('rect',{x:cx-w/2,y:cy-h/2,width:w,height:h,fill:bg,stroke:color,'stroke-width':1.3}));
        g.appendChild(svgEl('polyline',{points:`${cx-w/2},${cy-h/2} ${cx},${cy+h/2-2} ${cx+w/2},${cy-h/2}`,
            fill:'none',stroke:color,'stroke-width':1.3}));
    } else if (trigger === 'timer') {
        g.appendChild(svgEl('circle',{cx,cy,r:9,fill:bg,stroke:color,'stroke-width':1.3}));
        g.appendChild(svgEl('line',{x1:cx,y1:cy,x2:cx,y2:cy-6,stroke:color,'stroke-width':1.3,'stroke-linecap':'round'}));
        g.appendChild(svgEl('line',{x1:cx,y1:cy,x2:cx+5,y2:cy,stroke:color,'stroke-width':1.3,'stroke-linecap':'round'}));
        // 12 ticks minimal
        for (let i=0;i<12;i++){
            const a = i*Math.PI/6;
            const x1=cx+Math.cos(a)*9, y1=cy+Math.sin(a)*9;
            const x2=cx+Math.cos(a)*7, y2=cy+Math.sin(a)*7;
            g.appendChild(svgEl('line',{x1,y1,x2,y2,stroke:color,'stroke-width':1}));
        }
    } else if (trigger === 'error') {
        // zig-zag lightning
        g.appendChild(svgEl('polygon',{
            points:`${cx-8},${cy+6} ${cx-2},${cy-2} ${cx-5},${cy-2} ${cx+8},${cy-8} ${cx+2},${cy} ${cx+6},${cy} ${cx-4},${cy+8}`,
            fill:bg, stroke:color,'stroke-width':1.3,'stroke-linejoin':'round'}));
    } else if (trigger === 'cancel') {
        g.appendChild(svgEl('path',{
            d:`M ${cx-8} ${cy-8} L ${cx+8} ${cy+8} M ${cx+8} ${cy-8} L ${cx-8} ${cy+8}`,
            stroke:color,'stroke-width':2.2,fill:'none','stroke-linecap':'round'}));
    } else if (trigger === 'compensation') {
        g.appendChild(svgEl('polygon',{
            points:`${cx-8},${cy} ${cx-2},${cy-6} ${cx-2},${cy+6}`,
            fill:bg,stroke:color,'stroke-width':1.3}));
        g.appendChild(svgEl('polygon',{
            points:`${cx-2},${cy} ${cx+6},${cy-6} ${cx+6},${cy+6}`,
            fill:bg,stroke:color,'stroke-width':1.3}));
    } else if (trigger === 'escalation') {
        g.appendChild(svgEl('polygon',{
            points:`${cx},${cy-9} ${cx+6},${cy+7} ${cx},${cy+2} ${cx-6},${cy+7}`,
            fill:bg,stroke:color,'stroke-width':1.3,'stroke-linejoin':'round'}));
    } else if (trigger === 'condition') {
        const w=14,h=14;
        g.appendChild(svgEl('rect',{x:cx-w/2,y:cy-h/2,width:w,height:h,fill:bg,stroke:color,'stroke-width':1.3}));
        for (let i=0;i<3;i++){
            const yy = cy - h/2 + 3 + i*4;
            g.appendChild(svgEl('line',{x1:cx-w/2+2,y1:yy,x2:cx+w/2-2,y2:yy,stroke:color,'stroke-width':1.1}));
        }
    } else if (trigger === 'link') {
        g.appendChild(svgEl('polygon',{
            points:`${cx-8},${cy-4} ${cx+3},${cy-4} ${cx+3},${cy-8} ${cx+9},${cy} ${cx+3},${cy+8} ${cx+3},${cy+4} ${cx-8},${cy+4}`,
            fill:bg,stroke:color,'stroke-width':1.3,'stroke-linejoin':'round'}));
    } else if (trigger === 'signal') {
        g.appendChild(svgEl('polygon',{
            points:`${cx},${cy-8} ${cx+8},${cy+6} ${cx-8},${cy+6}`,
            fill:bg,stroke:color,'stroke-width':1.3,'stroke-linejoin':'round'}));
    } else if (trigger === 'terminate') {
        g.appendChild(svgEl('circle',{cx,cy,r:9,fill:color}));
    } else if (trigger === 'complex') {
        // asterisk
        const d = 8;
        g.appendChild(svgEl('path',{
            d:`M ${cx-d} ${cy} h ${2*d}
               M ${cx} ${cy-d} v ${2*d}
               M ${cx-d*0.7} ${cy-d*0.7} l ${d*1.4} ${d*1.4}
               M ${cx+d*0.7} ${cy-d*0.7} l ${-d*1.4} ${d*1.4}`,
            stroke:color,'stroke-width':1.7,'stroke-linecap':'round',fill:'none'}));
    } else if (trigger === 'parallel-multiple') {
        const d = 8;
        g.appendChild(svgEl('path',{
            d:`M ${cx-d} ${cy} h ${2*d} M ${cx} ${cy-d} v ${2*d}`,
            stroke:color,'stroke-width':2.2,fill:'none','stroke-linecap':'round'}));
    }
    return g;
}

function addEvent(kind, label, trigger, variant, color, filledIcon) {
    SHAPES[kind] = {
        label, category:'events',
        defaults:{ w:64, h:64, fill:'#ffffff', stroke:color, text:label, fontSize:11, strokeWidth:variant==='end'?3:variant==='start'?1.6:1.5 },
        draw: n => {
            const g = svgEl('g');
            g.appendChild(eventBase(n, variant));
            if (trigger) g.appendChild(eventIcon(n, trigger, filledIcon));
            return g;
        },
    };
}

/* message events */
addEvent('event-start-message', 'Старт · Сообщение', 'message', 'start', '#10b981', false);
addEvent('event-int-message',   'Промеж. · Сообщение (получ.)', 'message', 'intermediate', '#f59e0b', false);
addEvent('event-int-message-throw','Промеж. · Сообщение (отпр.)', 'message', 'intermediate', '#f59e0b', true);
addEvent('event-end-message',   'Конец · Сообщение', 'message', 'end', '#ef4444', true);
addEvent('event-boundary-message-int',    'Гран. прерыв. · Сообщение', 'message', 'boundary-int', '#f59e0b', false);
addEvent('event-boundary-message-nonint', 'Гран. непрер. · Сообщение', 'message', 'boundary-nonint', '#f59e0b', false);

/* timer events */
addEvent('event-int-timer', 'Промеж. · Таймер', 'timer', 'intermediate', '#f59e0b', false);
addEvent('event-boundary-timer-int',    'Гран. прерыв. · Таймер', 'timer', 'boundary-int', '#f59e0b', false);
addEvent('event-boundary-timer-nonint', 'Гран. непрер. · Таймер', 'timer', 'boundary-nonint', '#f59e0b', false);

/* terminate */
addEvent('event-end-terminate', 'Конец · Терминальное', 'terminate', 'end', '#ef4444', false);

/* error */
addEvent('event-int-error', 'Промеж. · Ошибка (обраб.)', 'error', 'intermediate', '#f59e0b', false);
addEvent('event-boundary-error', 'Гран. прерыв. · Ошибка', 'error', 'boundary-int', '#f59e0b', false);
addEvent('event-end-error', 'Конец · Ошибка', 'error', 'end', '#ef4444', true);

/* cancel */
addEvent('event-int-cancel', 'Промеж. · Отмена', 'cancel', 'intermediate', '#f59e0b', false);
addEvent('event-end-cancel', 'Конец · Отмена', 'cancel', 'end', '#ef4444', true);

/* compensation */
addEvent('event-int-compensation', 'Промеж. · Компенсация', 'compensation', 'intermediate', '#f59e0b', false);
addEvent('event-end-compensation', 'Конец · Компенсация', 'compensation', 'end', '#ef4444', true);

/* escalation */
addEvent('event-int-escalation', 'Промеж. · Эскалация', 'escalation', 'intermediate', '#f59e0b', false);
addEvent('event-end-escalation', 'Конец · Эскалация', 'escalation', 'end', '#ef4444', true);

/* condition */
addEvent('event-start-condition', 'Старт · Условие', 'condition', 'start', '#10b981', false);
addEvent('event-int-condition',   'Промеж. · Условие', 'condition', 'intermediate', '#f59e0b', false);
addEvent('event-boundary-condition-int',    'Гран. прерыв. · Условие', 'condition', 'boundary-int', '#f59e0b', false);
addEvent('event-boundary-condition-nonint', 'Гран. непрер. · Условие', 'condition', 'boundary-nonint', '#f59e0b', false);

/* link */
addEvent('event-int-link-catch', 'Промеж. · Ссылка (вход)', 'link', 'intermediate', '#f59e0b', false);
addEvent('event-int-link-throw', 'Промеж. · Ссылка (выход)', 'link', 'intermediate', '#f59e0b', true);

/* signal */
addEvent('event-start-signal', 'Старт · Сигнал', 'signal', 'start', '#10b981', false);
addEvent('event-int-signal',   'Промеж. · Сигнал', 'signal', 'intermediate', '#f59e0b', false);
addEvent('event-end-signal',   'Конец · Сигнал', 'signal', 'end', '#ef4444', true);

/* complex (multiple) */
addEvent('event-start-complex', 'Старт · Комплексное', 'complex', 'start', '#10b981', false);
addEvent('event-int-complex',   'Промеж. · Комплексное', 'complex', 'intermediate', '#f59e0b', false);
addEvent('event-end-complex',   'Конец · Комплексное', 'complex', 'end', '#ef4444', false);

/* parallel multiple */
addEvent('event-start-parallel-multi', 'Старт · Паралл. комплексное', 'parallel-multiple', 'start', '#10b981', false);
addEvent('event-int-parallel-multi',   'Промеж. · Паралл. комплексное', 'parallel-multiple', 'intermediate', '#f59e0b', false);

/* --- tasks --- */
function taskBase(node, iconNode){
    const g = svgEl('g');
    g.appendChild(drawRect(node, 10));
    if (node.critical) {
        g.appendChild(svgEl('rect',{
            x:3,y:3,width:node.w-6,height:node.h-6,rx:8,ry:8,
            fill:'none', stroke:'#f59e0b', 'stroke-width':1.3, 'stroke-dasharray':'4 3',
            'pointer-events':'none'
        }));
    }
    if (iconNode) g.appendChild(iconNode);
    return g;
}
SHAPES['task'] = {
    label:'Задача', category:'tasks',
    defaults:{ w:160, h:72, fill:'#ffffff', stroke:'#1f2937', text:'Задача', fontSize:13 },
    draw: n => taskBase(n),
};
SHAPES['task-critical'] = {
    label:'Критичная задача', category:'tasks',
    defaults:{ w:160, h:72, fill:'#fde68a', stroke:'#b45309', text:'Критичная задача', fontSize:13, critical:true },
    draw: n => taskBase(n),
};
SHAPES['task-manual'] = {
    label:'Ручная задача', category:'tasks',
    defaults:{ w:160, h:72, fill:'#ffffff', stroke:'#1f2937', text:'Ручная задача', fontSize:13 },
    draw: n => taskBase(n, iconGroup(n, 'hand')),
};
SHAPES['task-auto'] = {
    label:'Автомати­ческая задача', category:'tasks',
    defaults:{ w:160, h:72, fill:'#eaf1ff', stroke:'#2c66f5', text:'Автоматическая задача', fontSize:13 },
    draw: n => taskBase(n, iconGroup(n, 'gear')),
};
SHAPES['task-external'] = {
    label:'Задача др. отдела', category:'tasks',
    defaults:{ w:160, h:72, fill:'#f3e8ff', stroke:'#7b5cfa', text:'Внешняя задача', fontSize:13 },
    draw: n => taskBase(n, iconGroup(n, 'external')),
};
SHAPES['subprocess'] = {
    label:'Подпроцесс', category:'tasks',
    defaults:{ w:180, h:84, fill:'#ffffff', stroke:'#1f2937', text:'Подпроцесс', fontSize:13 },
    draw: n => {
        const g = taskBase(n);
        const cx = n.w/2, cy = n.h - 10;
        g.appendChild(svgEl('rect',{x:cx-7,y:cy-7,width:14,height:14,rx:2,ry:2,
            fill:'#fff',stroke:n.stroke,'stroke-width':1.2,'pointer-events':'none'}));
        g.appendChild(iconPath(`M ${cx-4} ${cy} h 8 M ${cx} ${cy-4} v 8`, n.stroke, 1.4));
        return g;
    },
};

function iconGroup(node, kind){
    const g = svgEl('g',{ 'pointer-events':'none' });
    const cx = 18, cy = 18;
    if (kind === 'hand') {
        g.appendChild(iconPath(
            `M ${cx-7} ${cy+3} v-5 a1.5 1.5 0 0 1 3 0 v3
             M ${cx-4} ${cy+1} v-7 a1.5 1.5 0 0 1 3 0 v6
             M ${cx-1} ${cy+1} v-6 a1.5 1.5 0 0 1 3 0 v6
             M ${cx+2} ${cy+1} v-4 a1.5 1.5 0 0 1 3 0 v6
             a5 5 0 0 1 -10 0 v-2`,
             '#111827', 1.4));
    } else if (kind === 'gear') {
        const r = 7;
        g.appendChild(svgEl('circle',{cx,cy,r:r-3,fill:'none',stroke:'#111827','stroke-width':1.3}));
        for (let i=0;i<8;i++){
            const a = i*Math.PI/4;
            const x1 = cx + Math.cos(a)*r, y1 = cy + Math.sin(a)*r;
            const x2 = cx + Math.cos(a)*(r+3), y2 = cy + Math.sin(a)*(r+3);
            g.appendChild(svgEl('line',{x1,y1,x2,y2,stroke:'#111827','stroke-width':1.3,'stroke-linecap':'round'}));
        }
    } else if (kind === 'external') {
        g.appendChild(iconPath(
            `M ${cx-7} ${cy+5} l 14 -10 M ${cx+3} ${cy-5} h 4 v 4`,
            '#111827', 1.6));
    }
    return g;
}

/* --- gateways --- */
SHAPES['gateway-x'] = {
    label:'Шлюз «ИЛИ» (X)', category:'gateways',
    defaults:{ w:64, h:64, fill:'#fff7cc', stroke:'#b45309', text:'', fontSize:11, strokeWidth:2 },
    draw: n => {
        const g = svgEl('g');
        g.appendChild(drawDiamond(n));
        const cx = n.w/2, cy = n.h/2, d = 10;
        g.appendChild(iconPath(
            `M ${cx-d} ${cy-d} l ${2*d} ${2*d} M ${cx+d} ${cy-d} l ${-2*d} ${2*d}`,
            n.stroke, 2.4));
        return g;
    },
};
SHAPES['gateway-plus'] = {
    label:'Шлюз «И» (+)', category:'gateways',
    defaults:{ w:64, h:64, fill:'#fff7cc', stroke:'#b45309', text:'', fontSize:11, strokeWidth:2 },
    draw: n => {
        const g = svgEl('g');
        g.appendChild(drawDiamond(n));
        const cx = n.w/2, cy = n.h/2, d = 12;
        g.appendChild(iconPath(
            `M ${cx-d} ${cy} h ${2*d} M ${cx} ${cy-d} v ${2*d}`,
            n.stroke, 2.6));
        return g;
    },
};
SHAPES['gateway-o'] = {
    label:'Шлюз «включ.» (O)', category:'gateways',
    defaults:{ w:64, h:64, fill:'#fff7cc', stroke:'#b45309', text:'', fontSize:11, strokeWidth:2 },
    draw: n => {
        const g = svgEl('g');
        g.appendChild(drawDiamond(n));
        const cx = n.w/2, cy = n.h/2;
        g.appendChild(svgEl('circle',{cx,cy,r:10,fill:'none',stroke:n.stroke,'stroke-width':2.4}));
        return g;
    },
};
SHAPES['gateway-event'] = {
    label:'Событийный шлюз', category:'gateways',
    defaults:{ w:64, h:64, fill:'#fff7cc', stroke:'#b45309', text:'', fontSize:11, strokeWidth:2 },
    draw: n => {
        const g = svgEl('g');
        g.appendChild(drawDiamond(n));
        const cx = n.w/2, cy = n.h/2;
        g.appendChild(svgEl('circle',{cx,cy,r:11,fill:'none',stroke:n.stroke,'stroke-width':1.4}));
        const star = [];
        for (let i=0;i<5;i++){
            const a = -Math.PI/2 + i*2*Math.PI/5;
            star.push(`${cx + Math.cos(a)*6},${cy + Math.sin(a)*6}`);
        }
        g.appendChild(svgEl('polygon',{points:star.join(' '),fill:'none',stroke:n.stroke,'stroke-width':1.4}));
        return g;
    },
};
SHAPES['gateway-event-instance'] = {
    label:'Событийный XOR (нов. экз.)', category:'gateways',
    defaults:{ w:64, h:64, fill:'#fff7cc', stroke:'#b45309', text:'', fontSize:11, strokeWidth:2 },
    draw: n => {
        const g = svgEl('g');
        g.appendChild(drawDiamond(n));
        const cx = n.w/2, cy = n.h/2;
        g.appendChild(svgEl('circle',{cx,cy,r:13,fill:'none',stroke:n.stroke,'stroke-width':1.4}));
        g.appendChild(svgEl('circle',{cx,cy,r:10,fill:'none',stroke:n.stroke,'stroke-width':1.4}));
        const pent = [];
        for (let i=0;i<5;i++){
            const a = -Math.PI/2 + i*2*Math.PI/5;
            pent.push(`${cx + Math.cos(a)*6},${cy + Math.sin(a)*6}`);
        }
        g.appendChild(svgEl('polygon',{points:pent.join(' '),fill:'none',stroke:n.stroke,'stroke-width':1.3}));
        return g;
    },
};
SHAPES['gateway-parallel-event-instance'] = {
    label:'Параллельный событийный AND (нов. экз.)', category:'gateways',
    defaults:{ w:64, h:64, fill:'#fff7cc', stroke:'#b45309', text:'', fontSize:11, strokeWidth:2 },
    draw: n => {
        const g = svgEl('g');
        g.appendChild(drawDiamond(n));
        const cx = n.w/2, cy = n.h/2;
        g.appendChild(svgEl('circle',{cx,cy,r:12,fill:'none',stroke:n.stroke,'stroke-width':1.4}));
        const d = 7;
        g.appendChild(iconPath(
            `M ${cx-d} ${cy} h ${2*d} M ${cx} ${cy-d} v ${2*d}`,
            n.stroke, 1.8));
        return g;
    },
};
SHAPES['gateway-complex'] = {
    label:'Комплексный шлюз', category:'gateways',
    defaults:{ w:64, h:64, fill:'#fff7cc', stroke:'#b45309', text:'', fontSize:11, strokeWidth:2 },
    draw: n => {
        const g = svgEl('g');
        g.appendChild(drawDiamond(n));
        const cx = n.w/2, cy = n.h/2, d = 11;
        // star / asterisk — 3 crossing lines
        g.appendChild(iconPath(
            `M ${cx-d} ${cy} h ${2*d}
             M ${cx} ${cy-d} v ${2*d}
             M ${cx-d*0.7} ${cy-d*0.7} l ${d*1.4} ${d*1.4}
             M ${cx+d*0.7} ${cy-d*0.7} l ${-d*1.4} ${d*1.4}`,
            n.stroke, 2.4));
        return g;
    },
};

/* --- data / systems --- */
SHAPES['data-io'] = {
    label:'Вход / Выход', category:'data',
    defaults:{ w:140, h:64, fill:'#f3f4f6', stroke:'#6b7280', text:'Вход/Выход', fontSize:12 },
    draw: drawParallelogram,
};
SHAPES['data-object'] = {
    label:'Документ', category:'data',
    defaults:{ w:96, h:110, fill:'#ffffff', stroke:'#6b7280', text:'Документ', fontSize:12 },
    draw: drawDocument,
};
SHAPES['data-store'] = {
    label:'IT-система / БД', category:'data',
    defaults:{ w:112, h:110, fill:'#eef2ff', stroke:'#4338ca', text:'Система', fontSize:12 },
    draw: drawCylinder,
};
SHAPES['data-external'] = {
    label:'Внешнее лицо', category:'data',
    defaults:{ w:140, h:64, fill:'#ecfeff', stroke:'#0891b2', text:'Контрагент', fontSize:12 },
    draw: drawHexagon,
};
SHAPES['pi'] = {
    label:'PI (индикатор)', category:'data',
    defaults:{ w:110, h:44, fill:'#dcfce7', stroke:'#15803d', text:'PI', fontSize:12 },
    draw: n => drawRect(n, 22),
};
SHAPES['kpi'] = {
    label:'KPI', category:'data',
    defaults:{ w:110, h:44, fill:'#dbeafe', stroke:'#1d4ed8', text:'KPI', fontSize:12 },
    draw: n => drawRect(n, 22),
};
SHAPES['sop'] = {
    label:'Методики / инструкции', category:'data',
    defaults:{ w:150, h:44, fill:'#fef3c7', stroke:'#b45309', text:'Методика', fontSize:12 },
    draw: n => drawRect(n, 22),
};

/* --- artifacts (Приложение Г) --- */
function drawDocIcon(node, options = {}) {
    const w = node.w, h = node.h;
    const fold = Math.min(14, w*0.22);
    // folded corner in top-right
    const d = `M 0 0 H ${w-fold} L ${w} ${fold} V ${h} H 0 Z`;
    const g = svgEl('g');
    g.appendChild(svgEl('path',{class:'shape',d,fill:node.fill,stroke:node.stroke,'stroke-width':1.4}));
    g.appendChild(svgEl('path',{d:`M ${w-fold} 0 V ${fold} H ${w}`,fill:'none',stroke:node.stroke,'stroke-width':1.2,'pointer-events':'none'}));
    if (options.arrow) {
        // arrow icon inside top-left corner
        const ax = 8, ay = 8, size = 12;
        const filled = options.arrowFilled;
        const aw = size, ah = size*0.75;
        const arrowPath = `M ${ax} ${ay+ah/2} L ${ax+aw-4} ${ay+ah/2}
                           M ${ax+aw-4} ${ay+2} L ${ax+aw} ${ay+ah/2} L ${ax+aw-4} ${ay+ah-2}`;
        g.appendChild(svgEl('path',{d:arrowPath,fill:'none',stroke:node.stroke,'stroke-width':1.6,
            'stroke-linecap':'round','stroke-linejoin':'round','pointer-events':'none'}));
        if (filled) {
            g.appendChild(svgEl('polygon',{
                points:`${ax+aw-5},${ay+2} ${ax+aw},${ay+ah/2} ${ax+aw-5},${ay+ah-2}`,
                fill:node.stroke,'pointer-events':'none'}));
        }
    }
    if (options.collection) {
        // three vertical bars at bottom
        const barY1 = h - 12, barY2 = h - 4;
        for (let i=0;i<3;i++){
            const bx = w/2 - 10 + i*10;
            g.appendChild(svgEl('line',{x1:bx,y1:barY1,x2:bx,y2:barY2,
                stroke:node.stroke,'stroke-width':2,'pointer-events':'none'}));
        }
    }
    return g;
}

SHAPES['data-input'] = {
    label:'Входные данные', category:'artifacts',
    defaults:{ w:96, h:110, fill:'#ffffff', stroke:'#6b7280', text:'Вход', fontSize:12 },
    draw: n => drawDocIcon(n, { arrow:true, arrowFilled:false }),
};
SHAPES['data-output'] = {
    label:'Выходные данные', category:'artifacts',
    defaults:{ w:96, h:110, fill:'#ffffff', stroke:'#6b7280', text:'Выход', fontSize:12 },
    draw: n => drawDocIcon(n, { arrow:true, arrowFilled:true }),
};
SHAPES['data-collection'] = {
    label:'Коллекция данных', category:'artifacts',
    defaults:{ w:96, h:110, fill:'#ffffff', stroke:'#6b7280', text:'Коллекция', fontSize:12 },
    draw: n => drawDocIcon(n, { collection:true }),
};
SHAPES['data-storage'] = {
    label:'Хранилище данных', category:'artifacts',
    defaults:{ w:112, h:96, fill:'#eef2ff', stroke:'#4338ca', text:'Хранилище', fontSize:12 },
    draw: drawCylinder,
};

function drawEnvelope(node, filled) {
    const w = node.w, h = node.h;
    const g = svgEl('g');
    g.appendChild(svgEl('rect',{class:'shape',x:0,y:0,width:w,height:h,rx:2,ry:2,
        fill: filled ? '#9aa3b2' : node.fill, stroke:node.stroke,'stroke-width':1.4}));
    // flap
    g.appendChild(svgEl('polyline',{
        points: `0,0 ${w/2},${h*0.55} ${w},0`,
        fill:'none', stroke: filled ? '#ffffff' : node.stroke, 'stroke-width':1.4,
        'pointer-events':'none'
    }));
    return g;
}
SHAPES['message-initiating'] = {
    label:'Инициирующее сообщение', category:'artifacts',
    defaults:{ w:80, h:50, fill:'#ffffff', stroke:'#1f2937', text:'Сообщение', fontSize:11 },
    draw: n => drawEnvelope(n, false),
};
SHAPES['message-response'] = {
    label:'Ответное сообщение', category:'artifacts',
    defaults:{ w:80, h:50, fill:'#9aa3b2', stroke:'#1f2937', text:'Ответ', fontSize:11, textColor:'#ffffff' },
    draw: n => drawEnvelope(n, true),
};

/* --- swim / containers --- */
SHAPES['pool'] = {
    label:'Пул (Pool)', category:'swim',
    defaults:{ w:720, h:220, fill:'#ffffff', stroke:'#1f2937', text:'Пул', fontSize:13 },
    draw: n => {
        const g = svgEl('g');
        g.appendChild(svgEl('rect',{class:'shape',x:0,y:0,width:n.w,height:n.h,
            fill:n.fill,stroke:n.stroke,'stroke-width':1.4}));
        g.appendChild(svgEl('rect',{x:0,y:0,width:28,height:n.h,fill:'#f7f8fc',stroke:n.stroke,'stroke-width':1.4,'pointer-events':'none'}));
        const t = svgEl('text',{x:14,y:n.h/2,'text-anchor':'middle','transform':`rotate(-90 14 ${n.h/2})`,
            'font-family':'Inter','font-size':12,'font-weight':600,fill:'#111827','pointer-events':'none'});
        t.textContent = n.text || 'Пул';
        g.appendChild(t);
        return g;
    },
    noDefaultText: true,
};
SHAPES['lane'] = {
    label:'Дорожка (Lane)', category:'swim',
    defaults:{ w:720, h:110, fill:'#fafbfd', stroke:'#1f2937', text:'Дорожка', fontSize:12 },
    draw: n => {
        const g = svgEl('g');
        g.appendChild(svgEl('rect',{class:'shape',x:0,y:0,width:n.w,height:n.h,
            fill:n.fill,stroke:n.stroke,'stroke-width':1.2}));
        g.appendChild(svgEl('rect',{x:0,y:0,width:22,height:n.h,fill:'#eef0f4',stroke:n.stroke,'stroke-width':1.2,'pointer-events':'none'}));
        const t = svgEl('text',{x:11,y:n.h/2,'text-anchor':'middle','transform':`rotate(-90 11 ${n.h/2})`,
            'font-family':'Inter','font-size':11,'font-weight':600,fill:'#374151','pointer-events':'none'});
        t.textContent = n.text || 'Дорожка';
        g.appendChild(t);
        return g;
    },
    noDefaultText: true,
};
SHAPES['group'] = {
    label:'Группа', category:'swim',
    defaults:{ w:260, h:160, fill:'transparent', stroke:'#6b7280', text:'', fontSize:12, dashed:true },
    draw: n => drawRect(n, 14),
};

/* --- annotations --- */
SHAPES['annotation'] = {
    label:'Аннотация', category:'annot',
    defaults:{ w:200, h:60, fill:'transparent', stroke:'#1f2937', text:'Комментарий', fontSize:12 },
    draw: n => {
        const g = svgEl('g');
        g.appendChild(svgEl('polyline',{class:'shape',
            points:`12,0 0,0 0,${n.h} 12,${n.h}`,
            fill:'none',stroke:n.stroke,'stroke-width':1.4}));
        return g;
    },
};
SHAPES['level-header'] = {
    label:'Уровень (заголовок)', category:'annot',
    defaults:{ w:220, h:42, fill:'#1d2a48', stroke:'#1d2a48', text:'Уровень 2: Процесс', fontSize:13, textColor:'#ffffff', fontWeight:700 },
    draw: n => drawRect(n, 8),
};

/* ---------- renderer ---------- */
const els = { nodes: new Map(), edges: new Map() }; // id -> svg group

function renderAll() {
    // clear
    layerNodes.innerHTML = '';
    layerEdges.innerHTML = '';
    layerContainers.innerHTML = '';
    els.nodes.clear();
    els.edges.clear();

    // containers first (pools/lanes/groups with lower z)
    const sorted = [...state.nodes].sort((a,b)=> (a.z||0) - (b.z||0));
    for (const n of sorted) {
        const isContainer = n.kind === 'pool' || n.kind === 'lane' || n.kind === 'group';
        const g = renderNode(n);
        (isContainer ? layerContainers : layerNodes).appendChild(g);
        els.nodes.set(n.id, g);
    }
    for (const e of state.edges) {
        const g = renderEdge(e);
        if (g) { layerEdges.appendChild(g); els.edges.set(e.id, g); }
    }
    toggleEmptyHint();
    __hooks.render.forEach(fn => { try { fn(); } catch {} });
}

function renderNode(n) {
    const def = SHAPES[n.kind];
    if (!def) return svgEl('g');
    const g = svgEl('g', {
        'data-id': n.id,
        class: 'node node-' + n.kind + (state.selection.nodes.has(n.id) ? ' selected' : ''),
        transform: `translate(${n.x} ${n.y})`,
    });
    const shape = def.draw(n);
    if (shape) g.appendChild(shape);

    // text
    if (!def.noDefaultText && n.text) {
        g.appendChild(renderText(n));
    } else if (def.noDefaultText && n.extraText) {
        g.appendChild(renderText({ ...n, text: n.extraText }));
    }

    // event text below the circle for round events
    if (n.kind.startsWith('event-') && n.text) {
        // remove previously added inner text and put label below
        while (g.children.length > 1) g.removeChild(g.lastChild);
        g.appendChild(renderEventLabel(n));
    }

    return g;
}

function renderText(n) {
    // multiline text inside box using <foreignObject> for proper wrap
    const padX = 8, padY = 6;
    const w = Math.max(20, n.w - padX*2);
    const h = Math.max(20, n.h - padY*2);
    const fo = svgEl('foreignObject', {
        x: padX, y: padY, width: w, height: h, 'pointer-events':'none',
    });
    const div = document.createElement('div');
    div.style.cssText = `
        width:100%;height:100%;
        display:flex;align-items:center;justify-content:center;
        font-family:Inter,sans-serif;
        font-size:${n.fontSize||13}px;
        font-weight:${n.fontWeight||500};
        color:${n.textColor || PALETTES.white.text};
        text-align:center; line-height:1.25;
        overflow:hidden; word-break:break-word;`;
    div.textContent = n.text || '';
    fo.appendChild(div);
    return fo;
}

function renderEventLabel(n) {
    const t = svgEl('text', {
        x: n.w/2, y: n.h + 14, 'text-anchor':'middle',
        'font-family':'Inter','font-size':12,'font-weight':600,
        fill:'#111827', 'pointer-events':'none',
    });
    t.textContent = n.text || '';
    return t;
}

function toggleEmptyHint() {
    if (!emptyHint) return;
    emptyHint.style.display = state.nodes.length ? 'none' : 'block';
}

function renderEdge(e) {
    const src = state.nodes.find(n => n.id === e.source.id);
    const dst = state.nodes.find(n => n.id === e.target.id);
    if (!src || !dst) return null;

    // auto choose sides if they collide
    const srcSide = e.source.port || bestSide(src, dst);
    const dstSide = e.target.port || bestSide(dst, src);
    const a = portPoint(src, srcSide);
    const b = portPoint(dst, dstSide);

    const d = routeEdgeBetween(a, b, srcSide, dstSide);
    const g = svgEl('g', { 'data-id':e.id,
        class: 'edge edge-' + (e.kind||'sequence') + (state.selection.edges.has(e.id) ? ' selected' : '')
    });

    // hit box
    const hit = svgEl('path', { class:'edge-hit', d });
    g.appendChild(hit);

    const path = svgEl('path', {
        class:'edge-path', d,
        stroke: e.color || '#1f2937',
        'stroke-width': e.strokeWidth || 1.6,
        fill:'none',
    });
    if (e.kind === 'message') {
        path.setAttribute('stroke-dasharray', '6 4');
        path.setAttribute('marker-start', 'url(#arrow-circle)');
        path.setAttribute('marker-end', 'url(#arrow-open)');
    } else if (e.kind === 'association') {
        path.setAttribute('stroke-dasharray', '2 3');
    } else {
        path.setAttribute('marker-end', 'url(#arrow)');
    }
    if (e.conditional) {
        // add small diamond at start
        const diamondD = `M ${a.x} ${a.y} m -6 0 l 6 -5 l 6 5 l -6 5 z`;
        g.appendChild(svgEl('path', { d: diamondD, fill:'#fff', stroke:e.color||'#1f2937','stroke-width':1.4 }));
    }
    g.appendChild(path);

    if (e.label) {
        // label at midpoint of path (approximate — middle of bounding box of endpoints)
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const t = svgEl('text', { class:'edge-label', x:mx, y:my-6, 'text-anchor':'middle' });
        t.textContent = e.label;
        g.appendChild(t);
    }

    // click to select
    hit.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        if (!ev.shiftKey) {
            state.selection.nodes.clear();
            state.selection.edges.clear();
        }
        state.selection.edges.add(e.id);
        syncSelectionDom();
        renderProps();
    });
    // double-click: edit label
    hit.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        const lbl = prompt('Подпись стрелки:', e.label || '');
        if (lbl !== null) {
            pushHistory();
            e.label = lbl;
            renderAll();
        }
    });
    return g;
}

function bestSide(from, to) {
    const fx = from.x + from.w/2, fy = from.y + from.h/2;
    const tx = to.x + to.w/2,     ty = to.y + to.h/2;
    const dx = tx - fx, dy = ty - fy;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'e' : 'w';
    return dy > 0 ? 's' : 'n';
}

function routeEdgeBetween(a, b, aSide, bSide) {
    if (!state.ortho) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    const off = 24;
    const ax1 = a.x + (aSide==='e'?off : aSide==='w'?-off:0);
    const ay1 = a.y + (aSide==='s'?off : aSide==='n'?-off:0);
    const bx1 = b.x + (bSide==='e'?off : bSide==='w'?-off:0);
    const by1 = b.y + (bSide==='s'?off : bSide==='n'?-off:0);
    const aHoriz = aSide === 'e' || aSide === 'w';
    const bHoriz = bSide === 'e' || bSide === 'w';

    let path;
    if (aHoriz && bHoriz) {
        const mx = (ax1 + bx1) / 2;
        path = `M ${a.x} ${a.y} L ${ax1} ${a.y} L ${mx} ${a.y} L ${mx} ${b.y} L ${bx1} ${b.y} L ${b.x} ${b.y}`;
    } else if (!aHoriz && !bHoriz) {
        const my = (ay1 + by1) / 2;
        path = `M ${a.x} ${a.y} L ${a.x} ${ay1} L ${a.x} ${my} L ${b.x} ${my} L ${b.x} ${by1} L ${b.x} ${b.y}`;
    } else if (aHoriz) {
        path = `M ${a.x} ${a.y} L ${ax1} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y}`;
    } else {
        path = `M ${a.x} ${a.y} L ${a.x} ${b.y} L ${b.x} ${b.y}`;
    }
    return path;
}

function redrawIncidentEdges(nodeIds) {
    const ids = new Set(nodeIds);
    for (const e of state.edges) {
        if (ids.has(e.source.id) || ids.has(e.target.id)) {
            const g = els.edges.get(e.id);
            if (g) {
                const fresh = renderEdge(e);
                if (fresh) {
                    g.parentNode.replaceChild(fresh, g);
                    els.edges.set(e.id, fresh);
                }
            }
        }
    }
}

/* ---------- factory: add node ---------- */
function createNode(kind, x, y, overrides = {}) {
    const def = SHAPES[kind];
    if (!def) return null;
    const d = def.defaults;
    const n = {
        id: uid(), kind,
        x, y,
        w: d.w, h: d.h,
        fill: d.fill, stroke: d.stroke,
        strokeWidth: d.strokeWidth,
        text: d.text, fontSize: d.fontSize, fontWeight: d.fontWeight,
        textColor: d.textColor, dashed: d.dashed || false,
        critical: d.critical || false,
        level: state.currentLevel,
        raci: '', pi: '', kpi: '', sop: '',
        z: (kind==='pool'||kind==='lane'||kind==='group') ? -10 : 0,
        ...overrides,
    };
    state.nodes.push(n);
    return n;
}


/* ---------- refs to DOM (initialized in main) ---------- */
let svg, viewport, layerNodes, layerEdges, layerContainers, layerOverlay,
    paletteEl, propsBody, canvasHost, zoomLabel, emptyHint,
    ctxMenu, toast;

/* ---------- initialization stub ---------- */
function main() {
    svg             = $('#svg');
    viewport        = $('#viewport');
    layerNodes      = $('#layer-nodes');
    layerEdges      = $('#layer-edges');
    layerContainers = $('#layer-containers');
    layerOverlay    = $('#layer-overlay');
    paletteEl       = $('#paletteSections');
    propsBody       = $('#propsBody');
    canvasHost      = $('#canvasHost');
    zoomLabel       = $('#zoomLabel');
    emptyHint       = $('#emptyHint');
    ctxMenu         = $('#ctxMenu');
    toast           = $('#toast');

    applyCamera();
    buildPalette();
    initPaletteSearch();
    initPaletteDrag();
    initCanvasInteraction();
    initZoomAndPan();
    initInlineEditor();
    initContextMenu();
    initToolbar();
    initKeyboard();
    initMinimap();
    initElectronBridge();
    renderAll();
    pushHistory();
    console.info('[BPMN Rossilber] ready');
}

/* ---------- Electron bridge: меню main-процесса → handleToolAction ---------- */
function initElectronBridge() {
    if (!hasElectron()) return;
    if (typeof window.electronAPI.onMenuAction === 'function') {
        window.electronAPI.onMenuAction((action) => {
            try { handleToolAction(action); } catch (err) { console.error(err); }
        });
    }
    document.documentElement.classList.add('is-electron');
}

/* ---------- context menu ---------- */
function initContextMenu() {
    svg.addEventListener('contextmenu', (e) => {
        const nodeEl = e.target.closest('[data-id]');
        if (!nodeEl) return;
        e.preventDefault();
        const id = nodeEl.dataset.id;
        if (!state.selection.nodes.has(id) && !state.selection.edges.has(id)) {
            state.selection.nodes.clear();
            state.selection.edges.clear();
            if (state.nodes.find(n=>n.id===id)) state.selection.nodes.add(id);
            else state.selection.edges.add(id);
            syncSelectionDom();
            renderProps();
        }
        ctxMenu.hidden = false;
        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top  = e.clientY + 'px';
    });
    document.addEventListener('mousedown', (e) => {
        if (!ctxMenu.contains(e.target)) ctxMenu.hidden = true;
    });
    ctxMenu.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-cmd]');
        if (!b) return;
        const cmd = b.dataset.cmd;
        ctxMenu.hidden = true;
        if (cmd === 'delete') deleteSelection();
        else if (cmd === 'duplicate') duplicateSelection();
        else if (cmd === 'front') handleToolAction('front');
        else if (cmd === 'back') handleToolAction('back');
        else if (cmd === 'edit') {
            const id = [...state.selection.nodes][0];
            const n = state.nodes.find(x=>x.id===id);
            if (n) openTextEditor(n);
        }
    });
}

/* ---------- minimap ---------- */
function initMinimap() {
    const mm = document.getElementById('minimap');
    const mmSvg = document.getElementById('minimapSvg');
    const mmFrame = document.getElementById('minimapFrame');
    if (!mm || !mmSvg) return;

    const update = () => {
        const bbox = bboxOfContent();
        const pad = 40;
        const vb = {
            x: bbox.x - pad, y: bbox.y - pad,
            w: bbox.w + pad*2, h: bbox.h + pad*2,
        };
        mmSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
        // render thumbnails
        mmSvg.innerHTML = '';
        for (const n of state.nodes) {
            mmSvg.appendChild(svgEl('rect', {
                x:n.x, y:n.y, width:n.w, height:n.h,
                fill: n.fill === 'transparent' ? 'transparent' : (n.fill || '#ffffff'),
                stroke: n.stroke || '#1f2937', 'stroke-width': 2,
            }));
        }
        // viewport frame
        const rect = svg.getBoundingClientRect();
        const wx = -state.camera.x / state.camera.zoom;
        const wy = -state.camera.y / state.camera.zoom;
        const ww = rect.width  / state.camera.zoom;
        const wh = rect.height / state.camera.zoom;
        const mmR = mm.getBoundingClientRect();
        const sx = mmR.width / vb.w;
        const sy = mmR.height / vb.h;
        const fx = (wx - vb.x) * sx;
        const fy = (wy - vb.y) * sy;
        const fw = ww * sx;
        const fh = wh * sy;
        mmFrame.style.left   = fx + 'px';
        mmFrame.style.top    = fy + 'px';
        mmFrame.style.width  = fw + 'px';
        mmFrame.style.height = fh + 'px';
    };

    __hooks.render.push(update);
    __hooks.camera.push(update);

    // click minimap to jump camera
    mm.style.pointerEvents = 'auto';
    mm.style.cursor = 'crosshair';
    mm.addEventListener('mousedown', (e) => {
        const r = mm.getBoundingClientRect();
        const vb = mmSvg.getAttribute('viewBox').split(' ').map(Number);
        const wx = vb[0] + (e.clientX - r.left) / r.width  * vb[2];
        const wy = vb[1] + (e.clientY - r.top)  / r.height * vb[3];
        const rect = svg.getBoundingClientRect();
        state.camera.x = rect.width/2  - wx * state.camera.zoom;
        state.camera.y = rect.height/2 - wy * state.camera.zoom;
        applyCamera();
    });

    setTimeout(update, 50);
    window.addEventListener('resize', update);
}

/* ---------- legend in help ---------- */
function renderLegendInHelp() {
    const ul = document.getElementById('legendList');
    if (!ul || ul.dataset.ready) return;
    ul.dataset.ready = '1';
    for (const kind in SHAPES) {
        const def = SHAPES[kind];
        const li = document.createElement('li');
        li.innerHTML = `<svg viewBox="0 0 56 36" xmlns="${SVG_NS}">${paletteSvgFor(kind)}</svg><span>${def.label}</span>`;
        ul.appendChild(li);
    }
}

/* ---------- canvas interaction: select + move + marquee ---------- */
function initCanvasInteraction() {
    let dragMode = null; // 'move' | 'marquee' | null
    let startWorld = null;
    let startPositions = new Map();
    let marqueeEl = null;

    svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        // space for pan handled in zoom/pan module
        if (svg.classList.contains('panning')) return;

        const nodeEl = e.target.closest('[data-id]');
        const pt = clientToWorld(e.clientX, e.clientY);

        if (nodeEl) {
            const id = nodeEl.dataset.id;
            // if clicking a node that's not selected — select it (respect shift)
            if (!state.selection.nodes.has(id) && !state.selection.edges.has(id)) {
                if (!e.shiftKey) {
                    state.selection.nodes.clear();
                    state.selection.edges.clear();
                }
                if (state.nodes.find(n=>n.id===id)) state.selection.nodes.add(id);
                else state.selection.edges.add(id);
                syncSelectionDom();
                renderProps();
            } else if (e.shiftKey) {
                state.selection.nodes.delete(id);
                state.selection.edges.delete(id);
                syncSelectionDom();
                renderProps();
                return;
            }

            dragMode = 'move';
            startWorld = pt;
            startPositions.clear();
            pushHistory();
            for (const nid of state.selection.nodes) {
                const n = state.nodes.find(x => x.id === nid);
                if (n) startPositions.set(nid, { x:n.x, y:n.y });
            }
        } else {
            // clicked empty canvas — clear + marquee
            if (!e.shiftKey) {
                state.selection.nodes.clear();
                state.selection.edges.clear();
                syncSelectionDom();
                renderProps();
            }
            dragMode = 'marquee';
            startWorld = pt;
            marqueeEl = svgEl('rect', { class:'marquee', x:pt.x, y:pt.y, width:0, height:0 });
            layerOverlay.appendChild(marqueeEl);
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragMode) return;
        const pt = clientToWorld(e.clientX, e.clientY);
        if (dragMode === 'move') {
            const dx = pt.x - startWorld.x;
            const dy = pt.y - startWorld.y;
            for (const [id, pos] of startPositions) {
                const n = state.nodes.find(x => x.id === id);
                if (!n) continue;
                n.x = snap(pos.x + dx);
                n.y = snap(pos.y + dy);
                const g = els.nodes.get(id);
                if (g) g.setAttribute('transform', `translate(${n.x} ${n.y})`);
            }
            redrawIncidentEdges([...startPositions.keys()]);
        } else if (dragMode === 'marquee') {
            const x = Math.min(pt.x, startWorld.x);
            const y = Math.min(pt.y, startWorld.y);
            const w = Math.abs(pt.x - startWorld.x);
            const h = Math.abs(pt.y - startWorld.y);
            marqueeEl.setAttribute('x', x);
            marqueeEl.setAttribute('y', y);
            marqueeEl.setAttribute('width', w);
            marqueeEl.setAttribute('height', h);
        }
    });

    window.addEventListener('mouseup', () => {
        if (dragMode === 'marquee' && marqueeEl) {
            const x = +marqueeEl.getAttribute('x');
            const y = +marqueeEl.getAttribute('y');
            const w = +marqueeEl.getAttribute('width');
            const h = +marqueeEl.getAttribute('height');
            if (w > 3 && h > 3) {
                for (const n of state.nodes) {
                    if (n.x >= x && n.y >= y && n.x+n.w <= x+w && n.y+n.h <= y+h) {
                        state.selection.nodes.add(n.id);
                    }
                }
                syncSelectionDom();
                renderProps();
            }
            marqueeEl.remove();
            marqueeEl = null;
        }
        dragMode = null;
        startPositions.clear();
    });
}

function syncSelectionDom() {
    for (const [id, g] of els.nodes) {
        g.classList.toggle('selected', state.selection.nodes.has(id));
    }
    for (const [id, g] of els.edges) {
        g.classList.toggle('selected', state.selection.edges.has(id));
    }
    renderSelectionOverlay();
}

/* ---------- resize handles overlay ---------- */
function renderSelectionOverlay() {
    // clear previous handles
    layerOverlay.querySelectorAll('.sel-overlay').forEach(el => el.remove());
    if (state.selection.nodes.size !== 1) return;
    const id = [...state.selection.nodes][0];
    const n = state.nodes.find(x=>x.id===id);
    if (!n) return;
    const g = svgEl('g', { class:'sel-overlay', 'data-node':id });
    // 8 handles
    const pts = [
        { k:'nw', x:n.x,           y:n.y },
        { k:'n',  x:n.x+n.w/2,     y:n.y },
        { k:'ne', x:n.x+n.w,       y:n.y },
        { k:'e',  x:n.x+n.w,       y:n.y+n.h/2 },
        { k:'se', x:n.x+n.w,       y:n.y+n.h },
        { k:'s',  x:n.x+n.w/2,     y:n.y+n.h },
        { k:'sw', x:n.x,           y:n.y+n.h },
        { k:'w',  x:n.x,           y:n.y+n.h/2 },
    ];
    for (const p of pts) {
        const h = svgEl('rect', {
            class:'handle ' + p.k,
            x: p.x - 4, y: p.y - 4, width: 8, height: 8,
            'data-handle': p.k
        });
        g.appendChild(h);
    }
    // connection ports (blue circles)
    const ports = [
        { side:'n', x:n.x+n.w/2, y:n.y     },
        { side:'e', x:n.x+n.w,   y:n.y+n.h/2 },
        { side:'s', x:n.x+n.w/2, y:n.y+n.h },
        { side:'w', x:n.x,       y:n.y+n.h/2 },
    ];
    for (const p of ports) {
        g.appendChild(svgEl('circle', {
            class:'port', cx:p.x, cy:p.y, r:5,
            fill:'#2c66f5', stroke:'#fff','stroke-width':2,
            'data-port':p.side, 'data-node':n.id,
            style:'cursor:crosshair'
        }));
    }
    layerOverlay.appendChild(g);
    attachHandleListeners(g, n);
}

function attachHandleListeners(overlayG, node) {
    let mode = null; // 'resize' | 'connect'
    let anchor = null, handleKind = null;
    let connectEdgeEl = null, connectFromNode = null, connectFromPort = null;

    overlayG.addEventListener('mousedown', (e) => {
        const h = e.target.closest('.handle');
        const p = e.target.closest('.port');
        if (h) {
            e.stopPropagation();
            e.preventDefault();
            mode = 'resize';
            handleKind = h.dataset.handle;
            anchor = { x0:node.x, y0:node.y, w0:node.w, h0:node.h,
                       start: clientToWorld(e.clientX, e.clientY) };
            pushHistory();
        } else if (p) {
            e.stopPropagation();
            e.preventDefault();
            mode = 'connect';
            connectFromNode = node;
            connectFromPort = p.dataset.port;
            connectEdgeEl = svgEl('path', { class:'edge-path', d:'M 0 0',
                stroke:'#2c66f5','stroke-dasharray':'5 3', 'marker-end':'url(#arrow)' });
            layerOverlay.appendChild(connectEdgeEl);
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!mode) return;
        const pt = clientToWorld(e.clientX, e.clientY);
        if (mode === 'resize') {
            let { x0, y0, w0, h0, start } = anchor;
            let dx = pt.x - start.x, dy = pt.y - start.y;
            let nx = x0, ny = y0, nw = w0, nh = h0;
            if (handleKind.includes('e')) nw = Math.max(30, w0 + dx);
            if (handleKind.includes('s')) nh = Math.max(30, h0 + dy);
            if (handleKind.includes('w')) { nw = Math.max(30, w0 - dx); nx = x0 + (w0 - nw); }
            if (handleKind.includes('n')) { nh = Math.max(30, h0 - dy); ny = y0 + (h0 - nh); }
            node.x = snap(nx); node.y = snap(ny);
            node.w = snap(nw); node.h = snap(nh);
            const g = els.nodes.get(node.id);
            if (g) {
                // re-render this node only
                const parent = g.parentNode;
                const fresh = renderNode(node);
                parent.replaceChild(fresh, g);
                els.nodes.set(node.id, fresh);
            }
            renderSelectionOverlay();
            redrawIncidentEdges([node.id]);
        } else if (mode === 'connect') {
            const from = portPoint(connectFromNode, connectFromPort);
            const path = routeEdge(from, pt, connectFromPort, null);
            connectEdgeEl.setAttribute('d', path);
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (mode === 'connect') {
            const target = document.elementFromPoint(e.clientX, e.clientY);
            const nodeEl = target && target.closest('[data-id]');
            if (nodeEl && nodeEl.dataset.id !== connectFromNode.id) {
                const targetNode = state.nodes.find(x => x.id === nodeEl.dataset.id);
                if (targetNode) {
                    pushHistory();
                    const targetPort = nearestPort(targetNode,
                        clientToWorld(e.clientX, e.clientY));
                    state.edges.push({
                        id: uid(),
                        source: { id: connectFromNode.id, port: connectFromPort },
                        target: { id: targetNode.id, port: targetPort },
                        kind: 'sequence',
                        label: '',
                    });
                    renderAll();
                    renderProps();
                }
            }
            if (connectEdgeEl) connectEdgeEl.remove();
        }
        mode = null; anchor = null;
        connectEdgeEl = null; connectFromNode = null; connectFromPort = null;
    });
}

/* ---------- port helpers ---------- */
function portPoint(node, side) {
    switch (side) {
        case 'n': return { x: node.x + node.w/2, y: node.y };
        case 's': return { x: node.x + node.w/2, y: node.y + node.h };
        case 'w': return { x: node.x,            y: node.y + node.h/2 };
        case 'e': return { x: node.x + node.w,   y: node.y + node.h/2 };
    }
    return { x: node.x + node.w/2, y: node.y + node.h/2 };
}
function nearestPort(node, pt) {
    const sides = ['n','e','s','w'];
    let best = 'e', bestD = Infinity;
    for (const s of sides) {
        const p = portPoint(node, s);
        const d = (p.x-pt.x)**2 + (p.y-pt.y)**2;
        if (d < bestD) { bestD = d; best = s; }
    }
    return best;
}

/* ---------- edge routing (placeholder, finalized in connectors step) ---------- */
function routeEdge(from, to, fromSide, toSide) {
    if (!state.ortho) {
        return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const isHoriz = fromSide === 'e' || fromSide === 'w';
    if (isHoriz) {
        return `M ${from.x} ${from.y} L ${mx} ${from.y} L ${mx} ${to.y} L ${to.x} ${to.y}`;
    }
    return `M ${from.x} ${from.y} L ${from.x} ${my} L ${to.x} ${my} L ${to.x} ${to.y}`;
}

/* ---------- zoom & pan ---------- */
function initZoomAndPan() {
    // wheel zoom
    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = -e.deltaY * 0.0015;
        const factor = Math.exp(delta);
        zoomAt(e.clientX, e.clientY, factor);
    }, { passive:false });

    // space + drag OR middle-mouse pan
    let panning = false, panStart = null, cameraStart = null;
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !isEditingText()) {
            svg.classList.add('panning');
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') svg.classList.remove('panning','panning-active');
    });
    svg.addEventListener('mousedown', (e) => {
        if (e.button === 1 || (e.button === 0 && svg.classList.contains('panning'))) {
            e.preventDefault();
            panning = true;
            panStart = { x:e.clientX, y:e.clientY };
            cameraStart = { x:state.camera.x, y:state.camera.y };
            svg.classList.add('panning-active');
        }
    });
    window.addEventListener('mousemove', (e) => {
        if (!panning) return;
        state.camera.x = cameraStart.x + (e.clientX - panStart.x);
        state.camera.y = cameraStart.y + (e.clientY - panStart.y);
        applyCamera();
    });
    window.addEventListener('mouseup', () => {
        panning = false;
        svg.classList.remove('panning-active');
    });
}

function zoomAt(cx, cy, factor) {
    const rect = svg.getBoundingClientRect();
    const localX = cx - rect.left;
    const localY = cy - rect.top;
    const worldX = (localX - state.camera.x) / state.camera.zoom;
    const worldY = (localY - state.camera.y) / state.camera.zoom;
    state.camera.zoom = clamp(state.camera.zoom * factor, 0.2, 4);
    state.camera.x = localX - worldX * state.camera.zoom;
    state.camera.y = localY - worldY * state.camera.zoom;
    applyCamera();
}

function isEditingText() {
    const ae = document.activeElement;
    return ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
}

/* ---------- inline text editor on double-click ---------- */
function initInlineEditor() {
    svg.addEventListener('dblclick', (e) => {
        const nodeEl = e.target.closest('[data-id]');
        if (!nodeEl) return;
        const n = state.nodes.find(x => x.id === nodeEl.dataset.id);
        if (!n) return;
        openTextEditor(n);
    });
}

function openTextEditor(node) {
    // position editor over node (in screen coords)
    const svgRect = svg.getBoundingClientRect();
    const x = svgRect.left + state.camera.x + node.x * state.camera.zoom;
    const y = svgRect.top  + state.camera.y + node.y * state.camera.zoom;
    const w = node.w * state.camera.zoom;
    const h = node.h * state.camera.zoom;

    const ed = document.createElement('div');
    ed.className = 'text-editor';
    ed.contentEditable = 'true';
    ed.textContent = node.text || '';
    ed.style.left = `${x}px`;
    ed.style.top = `${y}px`;
    ed.style.width = `${w}px`;
    ed.style.minHeight = `${h}px`;
    ed.style.fontSize = `${(node.fontSize||13) * state.camera.zoom}px`;
    ed.style.fontWeight = node.fontWeight || 500;
    ed.style.color = node.textColor || '#111827';
    ed.style.display = 'flex';
    ed.style.alignItems = 'center';
    ed.style.justifyContent = 'center';
    document.body.appendChild(ed);

    // focus + select
    ed.focus();
    const range = document.createRange();
    range.selectNodeContents(ed);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const commit = () => {
        pushHistory();
        node.text = ed.innerText.trim();
        ed.remove();
        renderAll();
        renderProps();
        document.removeEventListener('mousedown', outside, true);
    };
    const cancel = () => { ed.remove(); document.removeEventListener('mousedown', outside, true); };
    const outside = (ev) => { if (!ed.contains(ev.target)) commit(); };

    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    ed.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    });
}

/* ---------- toolbar & keyboard stubs (filled later) ---------- */
function initToolbar() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        const action = btn.dataset.action;
        if (!action) return;
        btn.addEventListener('click', () => handleToolAction(action));
    });
    document.getElementById('toggleGrid').addEventListener('change', e => {
        state.showGrid = e.target.checked;
        $('#gridRect').style.display = state.showGrid ? '' : 'none';
    });
    document.getElementById('toggleSnap').addEventListener('change', e => {
        state.snap = e.target.checked;
    });
    document.getElementById('toggleOrtho').addEventListener('change', e => {
        state.ortho = e.target.checked;
        renderAll();
    });
    document.querySelectorAll('.level-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.level-btn').forEach(b=>b.classList.remove('active'));
            btn.classList.add('active');
            state.currentLevel = +btn.dataset.level;
        });
    });
}

function handleToolAction(action) {
    switch(action) {
        case 'zoom-in':  zoomAt(innerWidth/2, innerHeight/2, 1.2); break;
        case 'zoom-out': zoomAt(innerWidth/2, innerHeight/2, 1/1.2); break;
        case 'zoom-reset':
            state.camera.zoom = 1;
            applyCamera(); break;
        case 'fit': fitToContent(); break;
        case 'delete': deleteSelection(); break;
        case 'duplicate': duplicateSelection(); break;
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'save': saveJson(); break;
        case 'open':
            if (hasElectron()) {
                window.electronAPI.openFile().then(r => {
                    if (r && !r.canceled && r.content) {
                        loadMapText(r.content, r.filePath || '');
                    }
                }).catch(err => alert('Ошибка открытия: ' + err.message));
            } else {
                document.getElementById('fileInput').click();
            }
            break;
        case 'export-svg': exportSvg(); break;
        case 'export-png': exportPng(); break;
        case 'export-bpmn': exportBpmnXml(); break;
        case 'front':
        case 'back':
            for (const id of state.selection.nodes) {
                const n = state.nodes.find(x=>x.id===id);
                if (n) n.z = (action === 'front' ? 100 : -100);
            }
            renderAll(); break;
        case 'help':
            renderLegendInHelp();
            document.getElementById('helpModal').classList.add('open');
            break;
        case 'new': newMap(); break;
        default: break;
    }
}

function initKeyboard() {
    window.addEventListener('keydown', (e) => {
        if (isEditingText()) return;
        const meta = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); e.preventDefault(); }
        else if (meta && key === 'd') { duplicateSelection(); e.preventDefault(); }
        else if (meta && key === 'z') { if (e.shiftKey) redo(); else undo(); e.preventDefault(); }
        else if (meta && key === 'y') { redo(); e.preventDefault(); }
        else if (meta && key === 's') { saveJson(); e.preventDefault(); }
        else if (meta && key === 'c') { copySelection(); e.preventDefault(); }
        else if (meta && key === 'v') { pasteClipboard(); e.preventDefault(); }
        else if (meta && key === 'a') {
            state.nodes.forEach(n => state.selection.nodes.add(n.id));
            syncSelectionDom(); renderProps(); e.preventDefault();
        }
        else if (e.key === '+' || e.key === '=') zoomAt(innerWidth/2, innerHeight/2, 1.15);
        else if (e.key === '-') zoomAt(innerWidth/2, innerHeight/2, 1/1.15);
        else if (e.key === '0') { state.camera.zoom = 1; applyCamera(); }
        else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
            const step = e.shiftKey ? 10 : 1;
            const dx = e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;
            const dy = e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
            pushHistory();
            for (const id of state.selection.nodes) {
                const n = state.nodes.find(x=>x.id===id);
                if (n){ n.x += dx; n.y += dy; }
            }
            renderAll();
            e.preventDefault();
        }
    });

    document.querySelectorAll('[data-close]').forEach(b =>
        b.addEventListener('click', () => b.closest('.modal')?.classList.remove('open')));
    document.querySelectorAll('.modal').forEach(m =>
        m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); }));

    // file input for loading
    const fi = document.getElementById('fileInput');
    if (fi) fi.addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (f) loadJsonFile(f);
        fi.value = '';
    });

    // autosave to localStorage
    setInterval(() => {
        try {
            localStorage.setItem('bpmn-rossilber-autosave',
                JSON.stringify({ nodes: state.nodes, edges: state.edges }));
        } catch {}
    }, 5000);
    try {
        const saved = localStorage.getItem('bpmn-rossilber-autosave')
                   || localStorage.getItem('bpmn-future-autosave');
        if (saved) {
            const d = JSON.parse(saved);
            if (d.nodes?.length) {
                state.nodes = d.nodes;
                state.edges = d.edges || [];
                renderAll();
            }
        }
    } catch {}
}

function deleteSelection() {
    if (state.selection.nodes.size === 0 && state.selection.edges.size === 0) return;
    pushHistory();
    const remNodes = new Set(state.selection.nodes);
    state.nodes = state.nodes.filter(n => !remNodes.has(n.id));
    state.edges = state.edges.filter(e =>
        !state.selection.edges.has(e.id) &&
        !remNodes.has(e.source.id) && !remNodes.has(e.target.id));
    state.selection.nodes.clear();
    state.selection.edges.clear();
    renderAll();
    renderProps();
}

function duplicateSelection() {
    if (state.selection.nodes.size === 0) return;
    pushHistory();
    const newIds = [];
    for (const id of state.selection.nodes) {
        const n = state.nodes.find(x=>x.id===id);
        if (!n) continue;
        const copy = { ...n, id:uid(), x:n.x+20, y:n.y+20, raci: n.raci };
        state.nodes.push(copy);
        newIds.push(copy.id);
    }
    state.selection.nodes.clear();
    newIds.forEach(id => state.selection.nodes.add(id));
    renderAll();
    renderProps();
}

function fitToContent() {
    if (state.nodes.length === 0) return;
    const pad = 40;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const n of state.nodes) {
        minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x+n.w); maxY = Math.max(maxY, n.y+n.h);
    }
    const rect = svg.getBoundingClientRect();
    const w = maxX - minX + pad*2;
    const h = maxY - minY + pad*2;
    const z = Math.min(rect.width / w, rect.height / h, 1.8);
    state.camera.zoom = z;
    state.camera.x = -minX*z + pad*z + (rect.width - (maxX-minX)*z)/2 - pad*z;
    state.camera.y = -minY*z + pad*z + (rect.height - (maxY-minY)*z)/2 - pad*z;
    applyCamera();
}

function newMap() {
    if (state.nodes.length && !confirm('Создать новую карту? Текущая будет стёрта.')) return;
    state.nodes = []; state.edges = [];
    state.selection.nodes.clear(); state.selection.edges.clear();
    state.camera = { x:0, y:0, zoom:1 };
    applyCamera();
    renderAll();
    renderProps();
}

/* ---------- palette ---------- */
function buildPalette() {
    paletteEl.innerHTML = '';
    for (const cat of CATEGORIES) {
        const section = document.createElement('div');
        section.className = 'palette-section';
        section.innerHTML = `<h4>${cat.title}</h4><div class="palette-grid"></div>`;
        const grid = section.querySelector('.palette-grid');
        for (const kind in SHAPES) {
            const def = SHAPES[kind];
            if (def.category !== cat.id) continue;
            const item = document.createElement('div');
            item.className = 'palette-item';
            item.dataset.kind = kind;
            item.draggable = true;
            const tip = TOOLTIPS[kind] || def.label;
            item.title = tip;
            item.innerHTML = `
                <svg viewBox="0 0 56 36" xmlns="${SVG_NS}">${paletteSvgFor(kind)}</svg>
                <div class="pal-label">${def.label}</div>
            `;
            grid.appendChild(item);
        }
        paletteEl.appendChild(section);
    }
}

function paletteSvgFor(kind) {
    // mini thumbnail
    const def = SHAPES[kind];
    const d = def.defaults;
    const preview = {
        ...d, w: 44, h: d.h > 60 ? 28 : Math.min(28, d.h*0.45), text: ''
    };
    if (kind === 'event-start' || kind === 'event-end' || kind === 'event-intermediate' || kind === 'event-timer' ||
        kind === 'gateway-x' || kind === 'gateway-plus' || kind === 'gateway-o' || kind === 'gateway-event') {
        preview.w = 28; preview.h = 28;
    }
    const tmpNode = { ...preview, text: '' };
    const frag = def.draw(tmpNode);
    const g = svgEl('g', { transform: `translate(${(56-preview.w)/2} ${(36-preview.h)/2})` });
    g.appendChild(frag);
    const ser = new XMLSerializer();
    return ser.serializeToString(g);
}

function initPaletteSearch() {
    const input = document.getElementById('paletteSearch');
    if (!input) return;
    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        $$('#paletteSections .palette-item').forEach(el => {
            const txt = el.querySelector('.pal-label').textContent.toLowerCase();
            el.style.display = !q || txt.includes(q) ? '' : 'none';
        });
    });
}

/* ---------- palette drag&drop ---------- */
function initPaletteDrag() {
    let pending = null;  // { kind, ghost }
    paletteEl.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.palette-item');
        if (!item) return;
        pending = { kind: item.dataset.kind };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', item.dataset.kind);
        // transparent drag image
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        e.dataTransfer.setDragImage(img, 0, 0);
    });

    canvasHost.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    canvasHost.addEventListener('drop', (e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData('text/plain') || (pending && pending.kind);
        if (!kind || !SHAPES[kind]) return;
        const pt = clientToWorld(e.clientX, e.clientY);
        const def = SHAPES[kind].defaults;
        const x = snap(pt.x - def.w/2);
        const y = snap(pt.y - def.h/2);
        pushHistory();
        const n = createNode(kind, x, y);
        state.selection.nodes.clear();
        state.selection.edges.clear();
        state.selection.nodes.add(n.id);
        renderAll();
        renderProps();
        pending = null;
    });
}

/* ---------- coord helpers ---------- */
function clientToWorld(cx, cy) {
    const rect = svg.getBoundingClientRect();
    const x = (cx - rect.left - state.camera.x) / state.camera.zoom;
    const y = (cy - rect.top  - state.camera.y) / state.camera.zoom;
    return { x, y };
}
function snap(v) { return state.snap ? Math.round(v/state.grid)*state.grid : v; }

/* ---------- history (undo/redo) ---------- */
let historySuspended = false;
function pushHistory() {
    if (historySuspended) return;
    const snap = JSON.stringify({ nodes: state.nodes, edges: state.edges });
    // drop forward stack
    if (state.historyPos < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyPos + 1);
    }
    // skip duplicates
    if (state.history[state.historyPos] === snap) return;
    state.history.push(snap);
    if (state.history.length > 120) state.history.shift();
    state.historyPos = state.history.length - 1;
}
function undo() {
    if (state.historyPos <= 0) return;
    state.historyPos--;
    restoreFrom(state.history[state.historyPos]);
}
function redo() {
    if (state.historyPos >= state.history.length - 1) return;
    state.historyPos++;
    restoreFrom(state.history[state.historyPos]);
}
function restoreFrom(s) {
    const parsed = JSON.parse(s);
    state.nodes = parsed.nodes;
    state.edges = parsed.edges;
    state.selection.nodes.clear();
    state.selection.edges.clear();
    renderAll();
    renderProps();
}

/* ---------- export / import ---------- */
const hasElectron = () => typeof window !== 'undefined' && !!window.electronAPI;

async function nativeSaveText(defaultName, text, filters) {
    try {
        const r = await window.electronAPI.saveFile({ defaultName, data: text, filters });
        if (!r.canceled) showToast('Сохранено: ' + r.filePath.split(/[\\/]/).pop());
        return !r.canceled;
    } catch (err) {
        alert('Ошибка сохранения: ' + err.message);
        return false;
    }
}
async function nativeSaveBinary(defaultName, base64, filters) {
    try {
        const r = await window.electronAPI.saveBinaryFile({ defaultName, dataBase64: base64, filters });
        if (!r.canceled) showToast('Сохранено: ' + r.filePath.split(/[\\/]/).pop());
        return !r.canceled;
    } catch (err) {
        alert('Ошибка сохранения: ' + err.message);
        return false;
    }
}

function saveJson() {
    const data = {
        version: 1,
        createdAt: new Date().toISOString(),
        nodes: state.nodes,
        edges: state.edges,
    };
    const text = JSON.stringify(data, null, 2);
    if (hasElectron()) {
        nativeSaveText('bpmn-rossilber-map.json', text,
            [{ name:'JSON', extensions:['json'] }, { name:'Все файлы', extensions:['*'] }]);
        return;
    }
    downloadFile(text, 'bpmn-rossilber-map.json', 'application/json');
    showToast('JSON сохранён');
}
function loadMapText(text, nameHint) {
    const name = (nameHint || '').toLowerCase();
    const isBpmn = name.endsWith('.bpmn') || name.endsWith('.xml') || /^\s*<\?xml/.test(text);
    try {
        let data;
        if (isBpmn) {
            data = importBpmnXml(text);
        } else {
            data = JSON.parse(text);
            if (!data.nodes) throw new Error('no nodes');
        }
        pushHistory();
        state.nodes = data.nodes;
        state.edges = data.edges || [];
        state.selection.nodes.clear();
        state.selection.edges.clear();
        renderAll();
        renderProps();
        showToast(isBpmn ? 'BPMN карта загружена' : 'Карта загружена');
    } catch(err) {
        alert('Не удалось разобрать файл: ' + err.message);
    }
}
function loadJsonFile(file) {
    const rd = new FileReader();
    rd.onload = () => loadMapText(rd.result, file.name || '');
    rd.readAsText(file);
}

function exportSvg() {
    const clone = svg.cloneNode(true);
    // remove overlay (handles, ports, marquee)
    clone.querySelectorAll('#layer-overlay *').forEach(el => el.remove());
    // size: use bbox of content
    const bbox = bboxOfContent();
    clone.setAttribute('width',  bbox.w);
    clone.setAttribute('height', bbox.h);
    clone.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`);
    clone.querySelector('#gridRect')?.remove();
    // reset transform of viewport
    const vp = clone.querySelector('#viewport');
    vp.removeAttribute('transform');
    const ser = new XMLSerializer().serializeToString(clone);
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + ser;
    if (hasElectron()) {
        nativeSaveText('bpmn-rossilber-map.svg', xml,
            [{ name:'SVG', extensions:['svg'] }, { name:'Все файлы', extensions:['*'] }]);
        return;
    }
    downloadFile(xml, 'bpmn-rossilber-map.svg', 'image/svg+xml');
    showToast('SVG экспортирован');
}

function exportPng() {
    const bbox = bboxOfContent();
    const scale = 2;
    const clone = svg.cloneNode(true);
    clone.querySelectorAll('#layer-overlay *').forEach(el => el.remove());
    clone.querySelector('#gridRect')?.remove();
    const vp = clone.querySelector('#viewport');
    vp.removeAttribute('transform');
    clone.setAttribute('width',  bbox.w);
    clone.setAttribute('height', bbox.h);
    clone.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`);
    const serial = new XMLSerializer().serializeToString(clone);
    const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + serial;
    const img = new Image();
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = bbox.w * scale;
        canvas.height = bbox.h * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(async (b) => {
            if (hasElectron()) {
                // read blob as base64 and pass through IPC
                const fr = new FileReader();
                fr.onload = () => {
                    const base64 = String(fr.result).split(',')[1];
                    nativeSaveBinary('bpmn-rossilber-map.png', base64,
                        [{ name:'PNG', extensions:['png'] }, { name:'Все файлы', extensions:['*'] }]);
                };
                fr.readAsDataURL(b);
                return;
            }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = 'bpmn-rossilber-map.png';
            a.click();
            setTimeout(()=>URL.revokeObjectURL(a.href), 500);
            showToast('PNG экспортирован');
        });
    };
    img.onerror = () => { alert('Ошибка экспорта PNG'); URL.revokeObjectURL(url); };
    img.src = url;
}
function bboxOfContent() {
    if (state.nodes.length === 0) return { x:0, y:0, w:400, h:300 };
    const pad = 40;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const n of state.nodes) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x+n.w);
        maxY = Math.max(maxY, n.y+n.h);
    }
    return { x: minX-pad, y: minY-pad, w: (maxX-minX)+pad*2, h: (maxY-minY)+pad*2 };
}
function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 500);
}

/* ---------- BPMN 2.0 XML (OMG) ----------
   Формат обмена картой между версиями (desktop/browser) и внешними
   BPMN-инструментами (Camunda Modeler, bpmn.io и др.).
   Наши SDCA-поля живут в <rossilber:meta .../> (extensionElements).
   Round-trip lossless: kind + все кастомные поля сохраняются и восстанавливаются.
----------------------------------------------*/
const BPMN_NS        = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI_NS      = 'http://www.omg.org/spec/BPMN/20100524/DI';
const DC_NS          = 'http://www.omg.org/spec/DD/20100524/DC';
const DI_NS          = 'http://www.omg.org/spec/DD/20100524/DI';
const ROSS_NS        = 'https://rossilber.ru/bpmn-future';

/* kind -> { type, eventDef?, attrs? }
   "type" — bpmn element name; "eventDef" — имя event-определения если нужно;
   "attrs" — доп. атрибуты элемента (cancelActivity и т.п.). */
const BPMN_MAP = {
    'event-start':                 { type:'startEvent' },
    'event-intermediate':          { type:'intermediateThrowEvent' },
    'event-end':                   { type:'endEvent' },
    'event-timer':                 { type:'intermediateCatchEvent', eventDef:'timerEventDefinition' },
    'event-start-message':         { type:'startEvent',              eventDef:'messageEventDefinition' },
    'event-int-message':           { type:'intermediateCatchEvent',  eventDef:'messageEventDefinition' },
    'event-int-message-throw':     { type:'intermediateThrowEvent',  eventDef:'messageEventDefinition' },
    'event-end-message':           { type:'endEvent',                eventDef:'messageEventDefinition' },
    'event-boundary-message-int':  { type:'boundaryEvent', attrs:{cancelActivity:'true'},  eventDef:'messageEventDefinition' },
    'event-boundary-message-nonint':{type:'boundaryEvent', attrs:{cancelActivity:'false'}, eventDef:'messageEventDefinition' },
    'event-int-timer':             { type:'intermediateCatchEvent',  eventDef:'timerEventDefinition' },
    'event-boundary-timer-int':    { type:'boundaryEvent', attrs:{cancelActivity:'true'},  eventDef:'timerEventDefinition' },
    'event-boundary-timer-nonint': { type:'boundaryEvent', attrs:{cancelActivity:'false'}, eventDef:'timerEventDefinition' },
    'event-end-terminate':         { type:'endEvent',                eventDef:'terminateEventDefinition' },
    'event-int-error':             { type:'intermediateCatchEvent',  eventDef:'errorEventDefinition' },
    'event-boundary-error':        { type:'boundaryEvent', attrs:{cancelActivity:'true'},  eventDef:'errorEventDefinition' },
    'event-end-error':             { type:'endEvent',                eventDef:'errorEventDefinition' },
    'event-int-cancel':            { type:'intermediateCatchEvent',  eventDef:'cancelEventDefinition' },
    'event-end-cancel':            { type:'endEvent',                eventDef:'cancelEventDefinition' },
    'event-int-compensation':      { type:'intermediateThrowEvent',  eventDef:'compensateEventDefinition' },
    'event-end-compensation':      { type:'endEvent',                eventDef:'compensateEventDefinition' },
    'event-int-escalation':        { type:'intermediateThrowEvent',  eventDef:'escalationEventDefinition' },
    'event-end-escalation':        { type:'endEvent',                eventDef:'escalationEventDefinition' },
    'event-start-condition':       { type:'startEvent',              eventDef:'conditionalEventDefinition' },
    'event-int-condition':         { type:'intermediateCatchEvent',  eventDef:'conditionalEventDefinition' },
    'event-boundary-condition-int':    { type:'boundaryEvent', attrs:{cancelActivity:'true'},  eventDef:'conditionalEventDefinition' },
    'event-boundary-condition-nonint': { type:'boundaryEvent', attrs:{cancelActivity:'false'}, eventDef:'conditionalEventDefinition' },
    'event-int-link-catch':        { type:'intermediateCatchEvent',  eventDef:'linkEventDefinition' },
    'event-int-link-throw':        { type:'intermediateThrowEvent',  eventDef:'linkEventDefinition' },
    'event-start-signal':          { type:'startEvent',              eventDef:'signalEventDefinition' },
    'event-int-signal':            { type:'intermediateCatchEvent',  eventDef:'signalEventDefinition' },
    'event-end-signal':            { type:'endEvent',                eventDef:'signalEventDefinition' },
    'event-start-complex':         { type:'startEvent' },
    'event-int-complex':           { type:'intermediateCatchEvent' },
    'event-end-complex':           { type:'endEvent' },
    'event-start-parallel-multi':  { type:'startEvent',              attrs:{parallelMultiple:'true'} },
    'event-int-parallel-multi':    { type:'intermediateCatchEvent',  attrs:{parallelMultiple:'true'} },

    'task':                        { type:'task' },
    'task-critical':               { type:'task' },
    'task-manual':                 { type:'manualTask' },
    'task-auto':                   { type:'serviceTask' },
    'task-external':               { type:'sendTask' },
    'subprocess':                  { type:'subProcess' },

    'gateway-x':                   { type:'exclusiveGateway' },
    'gateway-plus':                { type:'parallelGateway' },
    'gateway-o':                   { type:'inclusiveGateway' },
    'gateway-event':               { type:'eventBasedGateway' },
    'gateway-event-instance':      { type:'eventBasedGateway', attrs:{instantiate:'true'} },
    'gateway-parallel-event-instance':{ type:'eventBasedGateway', attrs:{instantiate:'true', eventGatewayType:'Parallel'} },
    'gateway-complex':             { type:'complexGateway' },

    'data-io':                     { type:'dataObjectReference' },
    'data-object':                 { type:'dataObjectReference' },
    'data-store':                  { type:'dataStoreReference' },
    'data-external':               { type:'dataObjectReference' },
    'data-input':                  { type:'dataObjectReference' },
    'data-output':                 { type:'dataObjectReference' },
    'data-collection':             { type:'dataObjectReference', attrs:{isCollection:'true'} },
    'data-storage':                { type:'dataStoreReference' },

    'pi':                          { type:'textAnnotation' },
    'kpi':                         { type:'textAnnotation' },
    'sop':                         { type:'textAnnotation' },
    'message-initiating':          { type:'textAnnotation' },
    'message-response':            { type:'textAnnotation' },

    'pool':                        { type:'subProcess' },
    'lane':                        { type:'subProcess' },
    'group':                       { type:'group' },

    'annotation':                  { type:'textAnnotation' },
    'level-header':                { type:'textAnnotation' },
};

// reverse lookup (bpmn type + eventDef -> kind) для чтения чужих BPMN файлов
function guessKindFromBpmn(elType, eventDef) {
    for (const [kind, m] of Object.entries(BPMN_MAP)) {
        if (m.type === elType && (m.eventDef || null) === (eventDef || null)) return kind;
    }
    // без event-def — возьмём первое совпадение по типу
    for (const [kind, m] of Object.entries(BPMN_MAP)) {
        if (m.type === elType && !m.eventDef) return kind;
    }
    return 'task';
}

function xmlAttr(obj) {
    let s = '';
    for (const k in obj) {
        if (obj[k] == null || obj[k] === '') continue;
        s += ` ${k}="${escapeXml(obj[k])}"`;
    }
    return s;
}

function bpmnId(prefix, id) { return `${prefix}_${id}`; }

function exportBpmnXml() {
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push(`<bpmn:definitions xmlns:bpmn="${BPMN_NS}" xmlns:bpmndi="${BPMNDI_NS}" xmlns:dc="${DC_NS}" xmlns:di="${DI_NS}" xmlns:rossilber="${ROSS_NS}" id="Definitions_1" targetNamespace="${ROSS_NS}" exporter="BPMN Rossilber" exporterVersion="1.0">`);
    out.push('  <bpmn:process id="Process_1" isExecutable="false">');

    // индексы для sequenceFlow (incoming/outgoing)
    const incoming = new Map(), outgoing = new Map();
    for (const e of state.edges) {
        if ((e.kind || 'sequence') !== 'sequence') continue;
        if (!outgoing.has(e.source.id)) outgoing.set(e.source.id, []);
        if (!incoming.has(e.target.id)) incoming.set(e.target.id, []);
        outgoing.get(e.source.id).push(bpmnId('Flow', e.id));
        incoming.get(e.target.id).push(bpmnId('Flow', e.id));
    }

    // flow nodes
    for (const n of state.nodes) {
        const m = BPMN_MAP[n.kind] || { type:'task' };
        const elId = bpmnId('Node', n.id);
        const attrs = { id: elId, name: n.text || '', ...(m.attrs || {}) };
        out.push(`    <bpmn:${m.type}${xmlAttr(attrs)}>`);
        // extensionElements with our meta
        out.push('      <bpmn:extensionElements>');
        const meta = {
            kind: n.kind,
            fill: n.fill, stroke: n.stroke, fontSize: n.fontSize,
            level: n.level, critical: n.critical ? 'true' : '',
            pi: n.pi, kpi: n.kpi, sop: n.sop, z: n.z,
            dashed: n.dashed ? 'true' : '',
        };
        if (n.raci) {
            meta['raci-r'] = n.raci.R || ''; meta['raci-a'] = n.raci.A || '';
            meta['raci-c'] = n.raci.C || ''; meta['raci-i'] = n.raci.I || '';
        }
        out.push(`        <rossilber:meta${xmlAttr(meta)}/>`);
        out.push('      </bpmn:extensionElements>');
        for (const fid of incoming.get(n.id) || []) out.push(`      <bpmn:incoming>${fid}</bpmn:incoming>`);
        for (const fid of outgoing.get(n.id) || []) out.push(`      <bpmn:outgoing>${fid}</bpmn:outgoing>`);
        if (m.eventDef) out.push(`      <bpmn:${m.eventDef}/>`);
        out.push(`    </bpmn:${m.type}>`);
    }

    // sequence / message / association flows
    for (const e of state.edges) {
        const kind = e.kind || 'sequence';
        const fid = bpmnId('Flow', e.id);
        const sRef = bpmnId('Node', e.source.id);
        const tRef = bpmnId('Node', e.target.id);
        const tag = kind === 'message' ? 'messageFlow'
                  : kind === 'association' ? 'association'
                  : 'sequenceFlow';
        const attrs = { id: fid, sourceRef: sRef, targetRef: tRef, name: e.label || '' };
        out.push(`    <bpmn:${tag}${xmlAttr(attrs)}>`);
        out.push('      <bpmn:extensionElements>');
        out.push(`        <rossilber:meta${xmlAttr({ kind, label:e.label||'', sourcePort:e.source.port||'', targetPort:e.target.port||'' })}/>`);
        out.push('      </bpmn:extensionElements>');
        out.push(`    </bpmn:${tag}>`);
    }
    out.push('  </bpmn:process>');

    // BPMN DI (diagram interchange) — координаты и размеры
    out.push('  <bpmndi:BPMNDiagram id="Diagram_1">');
    out.push('    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">');
    for (const n of state.nodes) {
        const elId = bpmnId('Node', n.id);
        out.push(`      <bpmndi:BPMNShape id="Shape_${n.id}" bpmnElement="${elId}">`);
        out.push(`        <dc:Bounds${xmlAttr({ x:n.x, y:n.y, width:n.w, height:n.h })}/>`);
        out.push('      </bpmndi:BPMNShape>');
    }
    for (const e of state.edges) {
        const fid = bpmnId('Flow', e.id);
        const s = state.nodes.find(n => n.id === e.source.id);
        const t = state.nodes.find(n => n.id === e.target.id);
        if (!s || !t) continue;
        const waypoints = (e.waypoints && e.waypoints.length >= 2)
            ? e.waypoints
            : [ { x: s.x + s.w/2, y: s.y + s.h/2 }, { x: t.x + t.w/2, y: t.y + t.h/2 } ];
        out.push(`      <bpmndi:BPMNEdge id="Edge_${e.id}" bpmnElement="${fid}">`);
        for (const wp of waypoints) {
            out.push(`        <di:waypoint${xmlAttr({ x:wp.x, y:wp.y })}/>`);
        }
        out.push('      </bpmndi:BPMNEdge>');
    }
    out.push('    </bpmndi:BPMNPlane>');
    out.push('  </bpmndi:BPMNDiagram>');
    out.push('</bpmn:definitions>');

    const xml = out.join('\n');
    if (hasElectron()) {
        nativeSaveText('bpmn-rossilber-map.bpmn', xml,
            [
                { name:'BPMN 2.0',  extensions:['bpmn'] },
                { name:'XML',       extensions:['xml'] },
                { name:'Все файлы', extensions:['*'] },
            ]);
        return;
    }
    downloadFile(xml, 'bpmn-rossilber-map.bpmn', 'application/xml');
    showToast('BPMN 2.0 экспортирован');
}

function importBpmnXml(text) {
    const dom = new DOMParser().parseFromString(text, 'application/xml');
    if (dom.querySelector('parsererror')) {
        throw new Error('невалидный XML');
    }
    // узлы process (ищем любые process, поддержка collaboration)
    const nodes = [];
    const edges = [];
    const boundsByRef = new Map();     // bpmnElement -> {x,y,w,h}
    const waypointsByRef = new Map();  // bpmnElement -> [{x,y}]

    // parse BPMNDI first
    dom.querySelectorAll('BPMNShape, bpmndi\\:BPMNShape').forEach(sh => {
        const ref = sh.getAttribute('bpmnElement');
        const b = sh.querySelector('Bounds, dc\\:Bounds');
        if (ref && b) {
            boundsByRef.set(ref, {
                x: +b.getAttribute('x') || 0,
                y: +b.getAttribute('y') || 0,
                w: +b.getAttribute('width') || 120,
                h: +b.getAttribute('height') || 60,
            });
        }
    });
    dom.querySelectorAll('BPMNEdge, bpmndi\\:BPMNEdge').forEach(ed => {
        const ref = ed.getAttribute('bpmnElement');
        const wps = [...ed.querySelectorAll('waypoint, di\\:waypoint')].map(w => ({
            x: +w.getAttribute('x') || 0,
            y: +w.getAttribute('y') || 0,
        }));
        if (ref && wps.length) waypointsByRef.set(ref, wps);
    });

    // все flow-элементы process (кроме sequenceFlow/messageFlow/association)
    const FLOW_TAGS = new Set(['sequenceFlow','messageFlow','association']);
    const procContainers = dom.querySelectorAll('process, bpmn\\:process, subProcess, bpmn\\:subProcess');
    const procEls = procContainers.length ? procContainers : [dom.documentElement];

    const nodeIdMap = new Map(); // bpmnId -> our uid
    procEls.forEach(proc => {
        for (const child of Array.from(proc.children)) {
            const tag = child.localName;
            if (!tag || FLOW_TAGS.has(tag)) continue;
            if (tag === 'extensionElements' || tag === 'laneSet') continue;
            if (tag === 'incoming' || tag === 'outgoing') continue;

            const bpmnIdAttr = child.getAttribute('id');
            if (!bpmnIdAttr) continue;

            // ищем rossilber:meta
            const metaEl = child.querySelector('meta, rossilber\\:meta');
            let kind = metaEl?.getAttribute('kind');
            if (!kind) {
                // derive от типа + event-def
                const eventDefEl = [...child.children].find(c => c.localName && c.localName.endsWith('EventDefinition'));
                const eventDef = eventDefEl?.localName;
                kind = guessKindFromBpmn(tag, eventDef);
            }
            const def = SHAPES[kind];
            if (!def) continue;

            const b = boundsByRef.get(bpmnIdAttr);
            const id = uid();
            nodeIdMap.set(bpmnIdAttr, id);
            const palette = def.defaults || {};
            const fromMeta = (k, fallback) => {
                const v = metaEl?.getAttribute(k);
                return (v === null || v === undefined || v === '') ? fallback : v;
            };
            const n = {
                id, kind,
                x: b ? b.x : 40 + nodes.length*40,
                y: b ? b.y : 40 + nodes.length*40,
                w: b ? b.w : palette.w || 120,
                h: b ? b.h : palette.h || 60,
                text: child.getAttribute('name') || palette.text || '',
                fill:  fromMeta('fill',   palette.fill   || '#ffffff'),
                stroke:fromMeta('stroke', palette.stroke || '#111827'),
                fontSize: +fromMeta('fontSize', palette.fontSize || 12),
                level:    +fromMeta('level', 2) || 2,
                critical: fromMeta('critical','') === 'true',
                pi:  fromMeta('pi',''),
                kpi: fromMeta('kpi',''),
                sop: fromMeta('sop',''),
                z:   +fromMeta('z', 0) || 0,
                dashed: fromMeta('dashed','') === 'true',
                raci: {
                    R: fromMeta('raci-r',''),
                    A: fromMeta('raci-a',''),
                    C: fromMeta('raci-c',''),
                    I: fromMeta('raci-i',''),
                },
            };
            nodes.push(n);
        }
    });

    // flows
    procEls.forEach(proc => {
        for (const child of Array.from(proc.children)) {
            const tag = child.localName;
            if (!FLOW_TAGS.has(tag)) continue;
            const sRef = child.getAttribute('sourceRef');
            const tRef = child.getAttribute('targetRef');
            const sId = nodeIdMap.get(sRef);
            const tId = nodeIdMap.get(tRef);
            if (!sId || !tId) continue;
            const metaEl = child.querySelector('meta, rossilber\\:meta');
            const kind = (metaEl?.getAttribute('kind'))
                       || (tag === 'messageFlow' ? 'message'
                        :  tag === 'association' ? 'association' : 'sequence');
            const label = child.getAttribute('name') || metaEl?.getAttribute('label') || '';
            const wps = waypointsByRef.get(child.getAttribute('id')) || [];
            edges.push({
                id: uid(),
                source:{ id: sId, port: metaEl?.getAttribute('sourcePort') || 'auto' },
                target:{ id: tId, port: metaEl?.getAttribute('targetPort') || 'auto' },
                kind, label,
                waypoints: wps.length >= 2 ? wps : undefined,
            });
        }
    });

    return { nodes, edges };
}

/* ---------- clipboard ---------- */
function copySelection() {
    const nodes = state.nodes.filter(n => state.selection.nodes.has(n.id));
    const ids = new Set(nodes.map(n=>n.id));
    const edges = state.edges.filter(e => ids.has(e.source.id) && ids.has(e.target.id));
    state.clipboard = JSON.parse(JSON.stringify({ nodes, edges }));
}
function pasteClipboard() {
    if (!state.clipboard) return;
    pushHistory();
    const idMap = {};
    const newNodes = state.clipboard.nodes.map(n => {
        const nn = { ...n, id: uid(), x: n.x+20, y: n.y+20 };
        idMap[n.id] = nn.id;
        return nn;
    });
    const newEdges = state.clipboard.edges.map(e => ({
        ...e, id: uid(),
        source:{ id: idMap[e.source.id], port: e.source.port },
        target:{ id: idMap[e.target.id], port: e.target.port },
    }));
    state.nodes.push(...newNodes);
    state.edges.push(...newEdges);
    state.selection.nodes = new Set(newNodes.map(n=>n.id));
    state.selection.edges.clear();
    renderAll();
    renderProps();
}

/* ---------- properties panel ---------- */
const COLOR_PRESETS = [
    '#ffffff','#f3f4f6','#eaf1ff','#dbeafe','#dcfce7','#fde68a','#fee2e2','#f3e8ff',
    '#1d2a48','#2c66f5','#7b5cfa','#10b981','#f59e0b','#ef4444','#6b7280','transparent'
];
const STROKE_PRESETS = [
    '#111827','#1d2a48','#2c66f5','#7b5cfa','#10b981','#f59e0b','#ef4444','#6b7280','#4338ca','#0891b2','#b45309','#ffffff'
];

function renderProps() {
    if (!propsBody) return;
    const nodeIds = [...state.selection.nodes];
    const edgeIds = [...state.selection.edges];

    if (nodeIds.length === 0 && edgeIds.length === 0) {
        propsBody.innerHTML = `
            <div class="props-empty">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#9aa3b2" stroke-width="1.6">
                    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                <p>Выделите фигуру или стрелку, чтобы изменить её свойства.</p>
            </div>`;
        return;
    }
    if (edgeIds.length === 1 && nodeIds.length === 0) {
        renderEdgeProps(state.edges.find(e => e.id === edgeIds[0]));
        return;
    }
    if (nodeIds.length >= 1) {
        const first = state.nodes.find(n => n.id === nodeIds[0]);
        renderNodeProps(first, nodeIds.length);
    }
}

function renderNodeProps(node, count) {
    const def = SHAPES[node.kind];
    const html = `
        <div class="prop-group">
            <h5>${count > 1 ? `${count} элементов выделено` : def.label}</h5>
            <div class="prop-row full">
                <div class="prop-field">
                    <label>Текст</label>
                    <textarea data-prop="text">${escapeXml(node.text || '')}</textarea>
                </div>
            </div>
            <div class="prop-row">
                <div class="prop-field"><label>Размер шрифта</label>
                    <input type="number" min="8" max="64" data-prop="fontSize" value="${node.fontSize||13}"/></div>
                <div class="prop-field"><label>Толщина шрифта</label>
                    <select data-prop="fontWeight">
                        ${[400,500,600,700,800].map(w=>`<option value="${w}"${(node.fontWeight||500)==w?' selected':''}>${w}</option>`).join('')}
                    </select>
                </div>
            </div>
        </div>

        <div class="prop-group">
            <h5>Заливка</h5>
            <div class="color-row" data-colorset="fill">
                ${COLOR_PRESETS.map(c => colorDot(c, node.fill === c)).join('')}
            </div>
            <input type="color" data-prop="fill" value="${node.fill==='transparent'?'#ffffff':(node.fill||'#ffffff')}" style="width:100%;margin-top:6px;height:28px;border:1px solid var(--border);border-radius:6px;"/>
        </div>

        <div class="prop-group">
            <h5>Контур / Текст</h5>
            <div class="color-row" data-colorset="stroke">
                ${STROKE_PRESETS.map(c => colorDot(c, node.stroke === c)).join('')}
            </div>
            <div class="prop-row">
                <div class="prop-field"><label>Толщина</label>
                    <input type="number" step="0.2" min="0.5" max="6" data-prop="strokeWidth" value="${node.strokeWidth||1.4}"/></div>
                <div class="prop-field"><label>Цвет текста</label>
                    <input type="color" data-prop="textColor" value="${node.textColor||'#111827'}"/></div>
            </div>
            <div class="prop-field check">
                <input type="checkbox" id="pdashed" data-prop="dashed" ${node.dashed?'checked':''}/>
                <label for="pdashed">Пунктирный контур</label>
            </div>
        </div>

        <div class="prop-group">
            <h5>Размер и позиция</h5>
            <div class="prop-row">
                <div class="prop-field"><label>X</label><input type="number" data-prop="x" value="${node.x}"/></div>
                <div class="prop-field"><label>Y</label><input type="number" data-prop="y" value="${node.y}"/></div>
            </div>
            <div class="prop-row">
                <div class="prop-field"><label>Ширина</label><input type="number" min="20" data-prop="w" value="${node.w}"/></div>
                <div class="prop-field"><label>Высота</label><input type="number" min="20" data-prop="h" value="${node.h}"/></div>
            </div>
        </div>

        <div class="prop-group">
            <h5>Методология SDCA</h5>
            <div class="prop-field check">
                <input type="checkbox" id="pcrit" data-prop="critical" ${node.critical?'checked':''}/>
                <label for="pcrit">Критичный элемент</label>
            </div>
            <div class="prop-row">
                <div class="prop-field"><label>Уровень</label>
                    <select data-prop="level">
                        ${[1,2,3,4,5].map(l=>`<option value="${l}"${(node.level||2)==l?' selected':''}>Уровень ${l}</option>`).join('')}
                    </select>
                </div>
                <div class="prop-field"><label>RACI</label>
                    <input type="text" data-prop="raci" placeholder="R/A/C/I" value="${escapeXml(node.raci||'')}"/>
                </div>
            </div>
            <div class="prop-row">
                <div class="prop-field"><label>PI</label><input type="text" data-prop="pi" value="${escapeXml(node.pi||'')}"/></div>
                <div class="prop-field"><label>KPI</label><input type="text" data-prop="kpi" value="${escapeXml(node.kpi||'')}"/></div>
            </div>
            <div class="prop-row full">
                <div class="prop-field"><label>Методика / инструкция</label><input type="text" data-prop="sop" value="${escapeXml(node.sop||'')}"/></div>
            </div>
        </div>

        <div class="prop-group">
            <div class="btn-row">
                <button class="mini-btn" data-act="dup">Дублировать</button>
                <button class="mini-btn" data-act="front">На передний</button>
                <button class="mini-btn" data-act="back">На задний</button>
                <button class="mini-btn danger" data-act="del">Удалить</button>
            </div>
        </div>
    `;
    propsBody.innerHTML = html;

    bindPropInputs(() => [...state.selection.nodes].map(id => state.nodes.find(n=>n.id===id)).filter(Boolean));

    propsBody.querySelectorAll('[data-act]').forEach(b => {
        b.addEventListener('click', () => {
            const a = b.dataset.act;
            if (a==='dup') duplicateSelection();
            else if (a==='front') handleToolAction('front');
            else if (a==='back')  handleToolAction('back');
            else if (a==='del')   deleteSelection();
        });
    });
}

function colorDot(c, active) {
    const safe = c === 'transparent' ? '' : c;
    return `<div class="color-dot${c==='transparent'?' none':''}${active?' active':''}"
        data-color="${c}" style="${safe?`background:${safe};`:''}"></div>`;
}

function bindPropInputs(getTargets) {
    propsBody.querySelectorAll('[data-prop]').forEach(inp => {
        const key = inp.dataset.prop;
        inp.addEventListener('input', () => {
            pushHistory();
            let val = inp.type === 'checkbox' ? inp.checked :
                      inp.type === 'number' ? +inp.value :
                      inp.value;
            for (const t of getTargets()) t[key] = val;
            renderAll();
        });
    });
    propsBody.querySelectorAll('[data-colorset]').forEach(set => {
        const key = set.dataset.colorset;
        set.addEventListener('click', (e) => {
            const d = e.target.closest('.color-dot');
            if (!d) return;
            pushHistory();
            const c = d.dataset.color;
            for (const t of getTargets()) t[key] = c;
            renderAll();
            renderProps();
        });
    });
}

function renderEdgeProps(edge) {
    if (!edge) return;
    propsBody.innerHTML = `
        <div class="prop-group">
            <h5>Стрелка</h5>
            <div class="prop-row full">
                <div class="prop-field"><label>Подпись</label>
                    <input type="text" data-eprop="label" value="${escapeXml(edge.label||'')}"/>
                </div>
            </div>
            <div class="prop-row full">
                <div class="prop-field"><label>Тип</label>
                    <select data-eprop="kind">
                        <option value="sequence"${edge.kind==='sequence'?' selected':''}>Поток управления</option>
                        <option value="message"${edge.kind==='message'?' selected':''}>Поток сообщений (пунктир)</option>
                        <option value="association"${edge.kind==='association'?' selected':''}>Ассоциация (точки)</option>
                    </select>
                </div>
            </div>
            <div class="prop-field check">
                <input type="checkbox" id="econd" data-eprop="conditional" ${edge.conditional?'checked':''}/>
                <label for="econd">Условный (ромбик в начале)</label>
            </div>
            <div class="prop-row">
                <div class="prop-field"><label>Цвет</label>
                    <input type="color" data-eprop="color" value="${edge.color||'#1f2937'}"/></div>
                <div class="prop-field"><label>Толщина</label>
                    <input type="number" step="0.2" min="0.8" max="6" data-eprop="strokeWidth" value="${edge.strokeWidth||1.6}"/></div>
            </div>
            <div class="btn-row" style="margin-top:10px;">
                <button class="mini-btn danger" data-act="del">Удалить стрелку</button>
            </div>
        </div>
    `;
    propsBody.querySelectorAll('[data-eprop]').forEach(inp => {
        inp.addEventListener('input', () => {
            pushHistory();
            const key = inp.dataset.eprop;
            let v = inp.type==='checkbox'?inp.checked:inp.type==='number'?+inp.value:inp.value;
            edge[key] = v;
            renderAll();
        });
    });
    propsBody.querySelector('[data-act="del"]').addEventListener('click', deleteSelection);
}

/* ---------- camera ---------- */
const __hooks = { render: [], camera: [] };
function applyCamera() {
    const { x, y, zoom } = state.camera;
    viewport.setAttribute('transform', `translate(${x} ${y}) scale(${zoom})`);
    if (zoomLabel) zoomLabel.textContent = Math.round(zoom * 100) + '%';
    __hooks.camera.forEach(fn => { try { fn(); } catch {} });
}

/* ---------- toast ---------- */
function showToast(msg, ms = 1800) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), ms);
}

document.addEventListener('DOMContentLoaded', main);
