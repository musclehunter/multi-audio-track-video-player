const { ipcRenderer } = require('electron');
const videoPlayer = document.getElementById('videoPlayer');
const openFileButton = document.getElementById('openFile');
const audioTracksContainer = document.getElementById('audioTracks');

let currentVideo = null;
let audioPlayers = new Map(); // トラックIDとaudio要素のマップ
let syncIntervals = new Map(); // 同期用のインターバルを管理
let previousVolume = 1.0; // ミュート前の音量を保存

// ミュートボタンと音量変更を監視
videoPlayer.addEventListener('volumechange', () => {
  if (videoPlayer.muted) {
    previousVolume = videoPlayer.volume;
    updateAllVolumes(0);
  } else {
    updateAllVolumes(previousVolume);
  }
});

// 全トラックの音量を更新
function updateAllVolumes(volume) {
  // メインプレーヤーの音量を設定
  videoPlayer.volume = volume;
  
  // 各トラックの音量を設定
  audioPlayers.forEach(audio => {
    audio.volume = volume;
  });
}

openFileButton.addEventListener('click', async () => {
  try {
    const result = await ipcRenderer.invoke('open-file-dialog');
    if (result) {
      loadVideo(result);
    }
  } catch (error) {
    console.error('Error opening file:', error);
  }
});

function loadVideo(videoData) {
  currentVideo = videoData;
  
  // 既存のオーディオプレーヤーをクリア
  clearAudioPlayers();
  
  // メインビデオプレーヤーを設定
  videoPlayer.src = videoData.path;
  videoPlayer.volume = previousVolume; // 前回の音量を設定
  
  // 音声トラックのUIを更新
  updateAudioTracks(videoData.audioTracks);
}

function updateAudioTracks(tracks) {
  audioTracksContainer.innerHTML = '<h3>音声トラック</h3>';
  
  tracks.forEach(track => {
    const trackItem = document.createElement('div');
    trackItem.className = 'track-item';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `track-${track.id}`;
    
    const label = document.createElement('label');
    label.htmlFor = `track-${track.id}`;
    label.textContent = `トラック ${track.id + 1} (${track.language}) - ${track.channels}ch`;
    
    checkbox.addEventListener('change', () => toggleAudioTrack(track, checkbox.checked));
    
    trackItem.appendChild(checkbox);
    trackItem.appendChild(label);
    audioTracksContainer.appendChild(trackItem);
  });
}

function toggleAudioTrack(track, enabled) {
  if (enabled) {
    // 新しいオーディオプレーヤーを作成
    const audio = new Audio(track.audioPath);
    audio.volume = videoPlayer.volume; // 現在のメインプレーヤーの音量を設定
    
    // ビデオと同期を維持
    audio.currentTime = videoPlayer.currentTime;
    
    const syncInterval = setInterval(() => {
      if (Math.abs(audio.currentTime - videoPlayer.currentTime) > 0.1) {
        audio.currentTime = videoPlayer.currentTime;
      }
    }, 100);
    
    syncIntervals.set(track.id, syncInterval);
    
    // ビデオのイベントと連動
    const playHandler = () => {
      audio.play().catch(console.error);
    };
    
    const pauseHandler = () => {
      audio.pause();
    };
    
    const seekedHandler = () => {
      audio.currentTime = videoPlayer.currentTime;
    };
    
    const rateChangeHandler = () => {
      audio.playbackRate = videoPlayer.playbackRate;
    };
    
    const volumeHandler = () => {
      audio.volume = videoPlayer.volume;
    };
    
    videoPlayer.addEventListener('play', playHandler);
    videoPlayer.addEventListener('pause', pauseHandler);
    videoPlayer.addEventListener('seeked', seekedHandler);
    videoPlayer.addEventListener('ratechange', rateChangeHandler);
    videoPlayer.addEventListener('volumechange', volumeHandler);
    
    // イベントリスナーを保存
    audio.eventListeners = {
      play: playHandler,
      pause: pauseHandler,
      seeked: seekedHandler,
      ratechange: rateChangeHandler,
      volumechange: volumeHandler
    };
    
    audioPlayers.set(track.id, audio);
    
    if (!videoPlayer.paused) {
      audio.play().catch(console.error);
    }
  } else {
    // オーディオプレーヤーを停止して削除
    const audio = audioPlayers.get(track.id);
    if (audio) {
      audio.pause();
      
      // イベントリスナーを削除
      const { eventListeners } = audio;
      videoPlayer.removeEventListener('play', eventListeners.play);
      videoPlayer.removeEventListener('pause', eventListeners.pause);
      videoPlayer.removeEventListener('seeked', eventListeners.seeked);
      videoPlayer.removeEventListener('ratechange', eventListeners.ratechange);
      videoPlayer.removeEventListener('volumechange', eventListeners.volumechange);
      
      // 同期用インターバルをクリア
      clearInterval(syncIntervals.get(track.id));
      syncIntervals.delete(track.id);
      
      audioPlayers.delete(track.id);
    }
  }
}

function clearAudioPlayers() {
  audioPlayers.forEach((audio, trackId) => {
    audio.pause();
    
    // イベントリスナーを削除
    const { eventListeners } = audio;
    if (eventListeners) {
      videoPlayer.removeEventListener('play', eventListeners.play);
      videoPlayer.removeEventListener('pause', eventListeners.pause);
      videoPlayer.removeEventListener('seeked', eventListeners.seeked);
      videoPlayer.removeEventListener('ratechange', eventListeners.ratechange);
    }
    
    // 同期用インターバルをクリア
    clearInterval(syncIntervals.get(trackId));
  });
  
  audioPlayers.clear();
  syncIntervals.clear();
  audioTracksContainer.innerHTML = '<h3>音声トラック</h3>';
}
