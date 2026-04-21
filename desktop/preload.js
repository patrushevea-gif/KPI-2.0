/* =============================================================
   BPMN Rossilber — preload (isolated bridge)
   Проброс нативных диалогов в renderer через window.electronAPI.
   Браузерная версия этот объект не получит → работает по-старому.
   ============================================================= */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    saveFile:        (opts) => ipcRenderer.invoke('dialog:save', opts),
    saveBinaryFile:  (opts) => ipcRenderer.invoke('dialog:saveBinary', opts),
    openFile:        ()     => ipcRenderer.invoke('dialog:open'),
    appInfo:         ()     => ipcRenderer.invoke('app:info'),
    onMenuAction:    (cb)   => ipcRenderer.on('menu:action', (_e, action) => cb(action)),
});
