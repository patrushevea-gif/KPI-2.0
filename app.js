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
    initToolbar();
    initKeyboard();
    renderAll();
    console.info('[BPMN Future] skeleton ready');
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

function redrawIncidentEdges(_nodeIds) { /* filled when edges added */ }

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
        case 'front':
        case 'back':
            for (const id of state.selection.nodes) {
                const n = state.nodes.find(x=>x.id===id);
                if (n) n.z = (action === 'front' ? 100 : -100);
            }
            renderAll(); break;
        case 'help': document.getElementById('helpModal').classList.add('open'); break;
        case 'new': newMap(); break;
        default: /* other actions later */ break;
    }
}

function initKeyboard() {
    window.addEventListener('keydown', (e) => {
        if (isEditingText()) return;
        const meta = e.ctrlKey || e.metaKey;
        if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); e.preventDefault(); }
        else if (meta && e.key.toLowerCase() === 'd') { duplicateSelection(); e.preventDefault(); }
        else if (e.key === '+' || e.key === '=') zoomAt(innerWidth/2, innerHeight/2, 1.15);
        else if (e.key === '-') zoomAt(innerWidth/2, innerHeight/2, 1/1.15);
        else if (e.key === '0') { state.camera.zoom = 1; applyCamera(); }
        else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
            const step = e.shiftKey ? 10 : 1;
            const dx = e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;
            const dy = e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
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
                <div class="prop-field"><label>SOP / OPL</label><input type="text" data-prop="sop" value="${escapeXml(node.sop||'')}"/></div>
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
