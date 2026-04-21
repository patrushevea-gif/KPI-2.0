/* =============================================================
   BPMN Rossilber — Electron main process
   Тонкая обёртка: грузит корневой index.html в BrowserWindow.
   Предоставляет нативные Open/Save-диалоги через preload → IPC.
   ============================================================= */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const buildMenu = require('./menu');

/* В собранном билде ресурсы лежат в resources/app/ (extraResources).
   В dev-режиме (`npm run start` из desktop/) — корень проекта это ../. */
const isPackaged = app.isPackaged;
const APP_ROOT = isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        show: false,
        backgroundColor: '#0f172a',
        icon: path.join(__dirname, 'build', 'icon.ico'),
        title: 'BPMN Rossilber',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    mainWindow.setMenu(buildMenu(mainWindow));

    const indexPath = path.join(APP_ROOT, 'index.html');
    mainWindow.loadFile(indexPath);

    mainWindow.once('ready-to-show', () => mainWindow.show());

    // Внешние ссылки — в системный браузер, а не в окне приложения
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

/* ---------- IPC: нативные диалоги ---------- */
ipcMain.handle('dialog:save', async (_e, { defaultName, filters, data }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Сохранить карту',
        defaultPath: defaultName || 'map.bpmn',
        filters: filters || [
            { name: 'BPMN 2.0',        extensions: ['bpmn'] },
            { name: 'JSON',            extensions: ['json'] },
            { name: 'Все файлы',       extensions: ['*'] },
        ],
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, data, { encoding: 'utf8' });
    return { canceled: false, filePath };
});

ipcMain.handle('dialog:saveBinary', async (_e, { defaultName, filters, dataBase64 }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Экспортировать',
        defaultPath: defaultName || 'export.png',
        filters: filters || [{ name: 'Все файлы', extensions: ['*'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, Buffer.from(dataBase64, 'base64'));
    return { canceled: false, filePath };
});

ipcMain.handle('dialog:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Открыть карту',
        filters: [
            { name: 'Карты BPMN Rossilber', extensions: ['bpmn','json','xml'] },
            { name: 'BPMN 2.0',              extensions: ['bpmn','xml'] },
            { name: 'JSON',                  extensions: ['json'] },
            { name: 'Все файлы',             extensions: ['*'] },
        ],
        properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { canceled: true };
    const filePath = filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    return { canceled: false, filePath, content };
});

ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    electron: process.versions.electron,
}));
