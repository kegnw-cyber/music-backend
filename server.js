const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { exec } = require('child_process');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ===== ПОДКЛЮЧЕНИЕ К SUPABASE =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =====================================================
// 1. ПОИСК НА YOUTUBE
// =====================================================
async function searchYouTube(query) {
  return new Promise((resolve) => {
    exec(`yt-dlp "ytsearch10:${query}" --flat-playlist --dump-json`, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      const lines = stdout.trim().split('\n').filter(line => line);
      const results = lines.map(line => {
        const data = JSON.parse(line);
        return {
          id: data.id,
          title: data.title,
          artist: data.uploader || 'Неизвестен',
          duration: data.duration || 0,
          cover: `https://img.youtube.com/vi/${data.id}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${data.id}`,
          source: 'youtube'
        };
      });
      resolve(results);
    });
  });
}

// =====================================================
// 2. ПОИСК НА SOUNDCLOUD
// =====================================================
async function searchSoundCloud(query) {
  try {
    const response = await axios.get(
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=10`,
      { headers: { 'Authorization': 'OAuth 1-0-0' } }
    );
    if (!response.data || !response.data.collection) return [];
    return response.data.collection.map(item => ({
      id: item.id.toString(),
      title: item.title,
      artist: item.user.username,
      duration: Math.floor(item.duration / 1000) || 0,
      cover: item.artwork_url || item.user.avatar_url || '',
      url: item.permalink_url,
      source: 'soundcloud',
      // Сохраняем ссылку для стрима, если есть
      streamUrl: item.media?.transcodings?.[0]?.url || null
    }));
  } catch {
    return [];
  }
}

// =====================================================
// 3. ПОИСК НА DEEZER
// =====================================================
async function searchDeezer(query) {
  try {
    const response = await axios.get(
      `https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=10`
    );
    if (!response.data || !response.data.data) return [];
    return response.data.data.map(item => ({
      id: item.id.toString(),
      title: item.title,
      artist: item.artist.name,
      duration: item.duration || 0,
      cover: item.album.cover_medium || '',
      url: item.preview || '', // Прямая ссылка на аудио (preview)
      source: 'deezer'
    }));
  } catch {
    return [];
  }
}

// =====================================================
// 4. ОБЩИЙ ПОИСК
// =====================================================
async function searchAll(query) {
  return await searchYouTube(query);
}

// =====================================================
// 5. СТАНЦИИ
// =====================================================
const MOODS = {
  'энергичный': ['energetic', 'upbeat', 'dance'],
  'спокойный': ['chill', 'ambient', 'lofi'],
  'грустный': ['sad', 'melancholic', 'ballad'],
  'веселый': ['happy', 'party', 'pop'],
  'меланхоличный': ['indie', 'alternative', 'folk'],
  'ночной': ['night', 'deep house', 'downtempo']
};

async function getStation(mood) {
  const keywords = MOODS[mood] || MOODS['спокойный'];
  return await searchAll(keywords.join(' '));
}

// =====================================================
// 6. ЭНДПОИНТЫ
// =====================================================

// Корень
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Сервер работает! 🎵' });
});

// Поиск
app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  try {
    const results = await searchAll(q);
    res.json({ results });
  } catch (error) {
    console.error('Ошибка поиска:', error);
    res.status(500).json({ error: error.message });
  }
});

// Станции
app.get('/station', async (req, res) => {
  const { mood } = req.query;
  try {
    const tracks = await getStation(mood || 'спокойный');
    res.json({ tracks, mood: mood || 'спокойный' });
  } catch (error) {
    console.error('Ошибка станции:', error);
    res.status(500).json({ error: error.message });
  }
});

// Библиотека
app.get('/library/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const [likes, history, playlists] = await Promise.all([
      supabase.from('likes').select('track_id, track_data').eq('user_id', userId),
      supabase.from('history').select('track_data').eq('user_id', userId).order('played_at', { ascending: false }).limit(50),
      supabase.from('playlists').select('*').eq('user_id', userId)
    ]);
    res.json({
      likes: likes.data || [],
      history: history.data || [],
      playlists: playlists.data || []
    });
  } catch (error) {
    console.error('Ошибка библиотеки:', error);
    res.status(500).json({ error: error.message });
  }
});

// Лайк
app.post('/like', async (req, res) => {
  const { userId, trackId, trackData } = req.body;
  try {
    await supabase
      .from('likes')
      .upsert({ user_id: userId, track_id: trackId, track_data: trackData, liked_at: new Date().toISOString() },
        { onConflict: 'user_id, track_id' }
      );
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка лайка:', error);
    res.status(500).json({ error: error.message });
  }
});

// Убрать лайк
app.delete('/like', async (req, res) => {
  const { userId, trackId } = req.body;
  try {
    await supabase.from('likes').delete().eq('user_id', userId).eq('track_id', trackId);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка удаления лайка:', error);
    res.status(500).json({ error: error.message });
  }
});

// История
app.post('/history', async (req, res) => {
  const { userId, trackData } = req.body;
  try {
    await supabase.from('history').insert({ user_id: userId, track_data: trackData, played_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка истории:', error);
    res.status(500).json({ error: error.message });
  }
});

// Плейлисты (CRUD)
app.post('/playlist', async (req, res) => {
  const { userId, name, tracks } = req.body;
  try {
    const { data } = await supabase
      .from('playlists')
      .insert({ user_id: userId, name, tracks: tracks || [] })
      .select()
      .single();
    res.json(data);
  } catch (error) {
    console.error('Ошибка создания плейлиста:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/playlist/:id', async (req, res) => {
  const { id } = req.params;
  const { name, tracks } = req.body;
  try {
    await supabase.from('playlists').update({ name, tracks }).eq('id', id);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления плейлиста:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/playlist/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await supabase.from('playlists').delete().eq('id', id);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка удаления плейлиста:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== АУДИО-ПОТОК (для плеера) =====
app.get('/stream', async (req, res) => {
  const { url, source } = req.query;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    if (source === 'youtube') {
      // Получаем прямую ссылку на аудио через yt-dlp
      exec(`yt-dlp -g -f bestaudio ${url}`, (error, stdout) => {
        if (error) {
          console.error('yt-dlp error:', error);
          return res.status(500).json({ error: 'Failed to get stream' });
        }
        const streamUrl = stdout.trim();
        res.json({ streamUrl });
      });
    } else if (source === 'deezer') {
      // Deezer: используем preview (уже есть в данных)
      res.json({ streamUrl: url });
    } else if (source === 'soundcloud') {
      // SoundCloud: пробуем получить прямой поток (если есть)
      // В большинстве случаев требует авторизации, поэтому пока отдаём ссылку на страницу
      // Для простоты используем тот же подход, что и для YouTube (через yt-dlp)
      exec(`yt-dlp -g -f bestaudio ${url}`, (error, stdout) => {
        if (error) {
          console.error('yt-dlp error for SoundCloud:', error);
          return res.status(500).json({ error: 'Failed to get stream' });
        }
        const streamUrl = stdout.trim();
        res.json({ streamUrl });
      });
    } else {
      res.status(400).json({ error: 'Unsupported source' });
    }
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// 7. ЗАПУСК
// =====================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📡 Проверьте: http://localhost:${PORT}`);
});