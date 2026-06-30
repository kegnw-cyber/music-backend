const { app, BrowserWindow, ipcMain } = require('electron');
const axios = require('axios');
const path = require('path');

// ===== ТВОЙ URL НА RENDER (БЕЗ СЛЕША В КОНЦЕ!) =====
const API_URL = 'https://music-backend-zi9f.onrender.com';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
  // Для отладки (можно раскомментировать):
  // win.webContents.openDevTools();
}

// ===== ОБРАБОТЧИКИ IPC =====

// Поиск
ipcMain.handle('search', async (event, query) => {
  try {
    console.log(`🔍 Поиск: ${query}`);
    const response = await axios.get(`${API_URL}/search?q=${encodeURIComponent(query)}`);
    return response.data.results || [];
  } catch (error) {
    console.error('❌ Ошибка поиска:', error.message);
    return [];
  }
});

// Станции
ipcMain.handle('station', async (event, mood) => {
  try {
    console.log(`🎵 Станция: ${mood}`);
    const response = await axios.get(`${API_URL}/station?mood=${encodeURIComponent(mood)}`);
    return response.data.tracks || [];
  } catch (error) {
    console.error('❌ Ошибка станции:', error.message);
    return [];
  }
});

// Библиотека
ipcMain.handle('library', async (event, userId) => {
  try {
    console.log(`📚 Библиотека для: ${userId}`);
    const response = await axios.get(`${API_URL}/library/${encodeURIComponent(userId)}`);
    return response.data || { likes: [], history: [], playlists: [] };
  } catch (error) {
    console.error('❌ Ошибка библиотеки:', error.message);
    return { likes: [], history: [], playlists: [] };
  }
});

// Лайк
ipcMain.handle('like', async (event, data) => {
  try {
    await axios.post(`${API_URL}/like`, data);
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка лайка:', error.message);
    return { success: false };
  }
});

// Убрать лайк
ipcMain.handle('unlike', async (event, data) => {
  try {
    await axios.delete(`${API_URL}/like`, { data });
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка убрать лайк:', error.message);
    return { success: false };
  }
});

// История
ipcMain.handle('history', async (event, data) => {
  try {
    await axios.post(`${API_URL}/history`, data);
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка истории:', error.message);
    return { success: false };
  }
});

// Создать плейлист
ipcMain.handle('createPlaylist', async (event, data) => {
  try {
    const response = await axios.post(`${API_URL}/playlist`, data);
    return response.data || { id: 'test', name: data.name, tracks: [] };
  } catch (error) {
    console.error('❌ Ошибка создания плейлиста:', error.message);
    return null;
  }
});

// Удалить плейлист
ipcMain.handle('deletePlaylist', async (event, id) => {
  try {
    await axios.delete(`${API_URL}/playlist/${id}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка удаления плейлиста:', error.message);
    return { success: false };
  }
});

// ===== ПОЛУЧЕНИЕ АУДИО-ПОТОКА (ЭТОТ ОБРАБОТЧИК БЫЛ ОТСУТСТВУЕТ) =====
ipcMain.handle('getStream', async (event, { url, source }) => {
  try {
    console.log(`🎵 Запрос стрима: ${source} - ${url}`);
    const response = await axios.get(`${API_URL}/stream`, {
      params: { url, source }
    });
    return response.data.streamUrl;
  } catch (error) {
    console.error('❌ Ошибка получения стрима:', error.message);
    return null;
  }
});

// ===== ЗАПУСК =====
app.whenReady().then(() => {
  console.log('🚀 Electron готов');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});