/* =============================================================
   BPMN Rossilber — native menu (Windows-style).
   Пункты шлют в renderer 'menu:action' с action-строкой,
   которую renderer отдаёт в handleToolAction() как обычный toolbar-клик.
   ============================================================= */
'use strict';

const { Menu, shell, app, dialog } = require('electron');

function send(win, action) {
    if (win && !win.isDestroyed()) win.webContents.send('menu:action', action);
}

function buildMenu(mainWindow) {
    const template = [
        {
            label: 'Файл',
            submenu: [
                { label: 'Новая карта',            accelerator: 'CmdOrCtrl+N', click: () => send(mainWindow, 'new') },
                { label: 'Открыть…',               accelerator: 'CmdOrCtrl+O', click: () => send(mainWindow, 'open') },
                { label: 'Сохранить JSON',         accelerator: 'CmdOrCtrl+S', click: () => send(mainWindow, 'save') },
                { type: 'separator' },
                { label: 'Экспорт BPMN 2.0…',      click: () => send(mainWindow, 'export-bpmn') },
                { label: 'Экспорт SVG…',           click: () => send(mainWindow, 'export-svg') },
                { label: 'Экспорт PNG…',           click: () => send(mainWindow, 'export-png') },
                { type: 'separator' },
                { role: 'quit', label: 'Выход',    accelerator: 'CmdOrCtrl+Q' },
            ],
        },
        {
            label: 'Правка',
            submenu: [
                { label: 'Отменить', accelerator: 'CmdOrCtrl+Z',       click: () => send(mainWindow, 'undo') },
                { label: 'Вернуть',  accelerator: 'CmdOrCtrl+Shift+Z', click: () => send(mainWindow, 'redo') },
                { type: 'separator' },
                { label: 'Дублировать', accelerator: 'CmdOrCtrl+D', click: () => send(mainWindow, 'duplicate') },
                { label: 'Удалить',     accelerator: 'Delete',      click: () => send(mainWindow, 'delete') },
            ],
        },
        {
            label: 'Вид',
            submenu: [
                { label: 'Уменьшить',    accelerator: 'CmdOrCtrl+-', click: () => send(mainWindow, 'zoom-out') },
                { label: 'Ровно 100%',   accelerator: 'CmdOrCtrl+0', click: () => send(mainWindow, 'zoom-reset') },
                { label: 'Увеличить',    accelerator: 'CmdOrCtrl+=', click: () => send(mainWindow, 'zoom-in') },
                { label: 'По размеру',   accelerator: 'CmdOrCtrl+F', click: () => send(mainWindow, 'fit') },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'Полноэкранный режим' },
                { role: 'toggleDevTools',   label: 'Инструменты разработчика' },
                { role: 'reload',           label: 'Перезагрузить окно' },
            ],
        },
        {
            label: 'Справка',
            submenu: [
                { label: 'Справочник фигур и стрелок', accelerator: 'F1', click: () => send(mainWindow, 'help') },
                { type: 'separator' },
                {
                    label: 'О программе',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'О программе',
                            message: 'BPMN Rossilber',
                            detail:
                                `Версия: ${app.getVersion()}\n` +
                                `Electron: ${process.versions.electron}\n` +
                                `Chromium: ${process.versions.chrome}\n\n` +
                                'Редактор карт процессов.\n' +
                                '© 2026 Rossilber. Все права защищены.',
                            buttons: ['Закрыть'],
                            noLink: true,
                        });
                    },
                },
                {
                    label: 'Открыть сайт Rossilber',
                    click: () => shell.openExternal('https://rossilber.ru'),
                },
            ],
        },
    ];

    return Menu.buildFromTemplate(template);
}

module.exports = buildMenu;
