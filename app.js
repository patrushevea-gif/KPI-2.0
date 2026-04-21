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

/* state holds the single source of truth; to be filled in next steps */

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
    // palette, events, props — добавляются в следующих шагах
    console.info('[BPMN Future] skeleton ready');
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
