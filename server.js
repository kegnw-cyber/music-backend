const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { exec } = require('child_process');
const axios = require('axios');
require('dotenv').config();
console.log('ВЕРСИЯ 2.0 — С ЭНДПОИНТАМИ');
const app = express();
app.use(cors());
app.use(express.json());

// Подключение к Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ===== ПОИСК НА YOUTUBE =====
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

// ===== ПОИСК НА SOUNDCLOUD =====
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
      source: 'soundcloud'
    }));
  } catch {
    return [];
  }
}

// ===== ПОИСК НА DEEZER =====
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
      url: item.link,
      source: 'deezer'
    }));
  } catch {
    return [];
  }
}

// ===== ОБЩИЙ ПОИСК =====
async function searchAll(query) {
  const [youtube, soundcloud, deezer] = await Promise.all([
    searchYouTube(query),
    searchSoundCloud(query),
    searchDeezer(query)
  ]);
  return [...youtube, ...soundcloud, ...deezer].slice(0, 30);
}

// ===== СТАНЦИИ =====
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

// ===== ЭНДПОИНТЫ API =====

// Поиск
app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const results = await searchAll(q);
  res.json({ results });
});

// Станции
app.get('/station', async (req, res) => {
  const { mood } = req.query;
  const tracks = await getStation(mood || 'спокойный');
  res.json({ tracks, mood: mood || 'спокойный' });
});

// Библиотека
app.get('/library/:userId', async (req, res) => {
  const { userId } = req.params;
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
});

// Лайк
app.post('/like', async (req, res) => {
  const { userId, trackId, trackData } = req.body;
  await supabase
    .from('likes')
    .upsert({ user_id: userId, track_id: trackId, track_data: trackData, liked_at: new Date().toISOString() },
      { onConflict: 'user_id, track_id' }
    );
  res.json({ success: true });
});

// Убрать лайк
app.delete('/like', async (req, res) => {
  const { userId, trackId } = req.body;
  await supabase.from('likes').delete().eq('user_id', userId).eq('track_id', trackId);
  res.json({ success: true });
});

// История
app.post('/history', async (req, res) => {
  const { userId, trackData } = req.body;
  await supabase.from('history').insert({ user_id: userId, track_data: trackData, played_at: new Date().toISOString() });
  res.json({ success: true });
});

// Создать плейлист
app.post('/playlist', async (req, res) => {
  const { userId, name, tracks } = req.body;
  const { data } = await supabase
    .from('playlists')
    .insert({ user_id: userId, name, tracks: tracks || [] })
    .select()
    .single();
  res.json(data);
});

// Обновить плейлист
app.put('/playlist/:id', async (req, res) => {
  const { id } = req.params;
  const { name, tracks } = req.body;
  await supabase.from('playlists').update({ name, tracks }).eq('id', id);
  res.json({ success: true });
});

// Удалить плейлист
app.delete('/playlist/:id', async (req, res) => {
  const { id } = req.params;
  await supabase.from('playlists').delete().eq('id', id);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
console.log('✅ Сервер обновлён!');
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));  