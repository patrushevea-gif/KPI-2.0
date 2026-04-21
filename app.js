/* =========================================================
   BPMN Future — editor (app.js)
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
const CATEGORIES = [
    { id:'events',     title:'События' },
    { id:'tasks',      title:'Задачи' },
    { id:'gateways',   title:'Шлюзы / Развилки' },
    { id:'data',       title:'Данные и системы' },
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
    label:'SOP / OPL', category:'data',
    defaults:{ w:110, h:44, fill:'#fef3c7', stroke:'#b45309', text:'SOP', fontSize:12 },
    draw: n => drawRect(n, 22),
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

/* edges are filled in a later step */
function renderEdge(_e) { return null; }

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
    renderAll();
    console.info('[BPMN Future] skeleton ready');
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

/* ---------- history stub ---------- */
function pushHistory() { /* filled later */ }

/* ---------- props stub ---------- */
function renderProps() { /* filled later */ }

/* ---------- camera ---------- */
function applyCamera() {
    const { x, y, zoom } = state.camera;
    viewport.setAttribute('transform', `translate(${x} ${y}) scale(${zoom})`);
    if (zoomLabel) zoomLabel.textContent = Math.round(zoom * 100) + '%';
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
