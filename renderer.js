const { ipcRenderer } = require('electron');
const videoPlayer = document.getElementById('videoPlayer');
const openFileButton = document.getElementById('openFile');
const audioTracksContainer = document.getElementById('audioTracks');
const loadingElement = document.getElementById('loading');

let currentVideo = null;
let audioPlayers = new Map(); // トラックIDとaudio要素のマップ
let syncIntervals = new Map(); // 同期用のインターバルを管理
let previousVolume = 1.0; // ミュート前の音量を保存
let isInitialLoad = true; // 初回読み込みフラグ

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

// ミュート状態の管理
let muteStates = {
  all: false,    // 全体のミュート状態
  tracks: new Map() // 各トラックのミュート状態を管理
};

// トラックのミュート状態を設定
function setTrackMuteState(trackId, muted) {
  muteStates.tracks.set(trackId, muted);
}

// トラックのミュート状態を取得
function getTrackMuteState(trackId) {
  // デフォルトfalse
  return muteStates.tracks.has(trackId) ? muteStates.tracks.get(trackId) : false;
}

// ミュート状態を計算
function calculateMuteState(trackId) {
  return muteStates.all || getTrackMuteState(trackId);
}

// ミュートボタンを監視（スピーカーアイコンのクリックのみ）
videoPlayer.addEventListener('volumechange', () => {
  if (!isInitialLoad && videoPlayer.muted !== muteStates.all) {
    // スピーカーアイコンがクリックされた場合のみ全体のミュート状態を変更
    muteStates.all = videoPlayer.muted;
    if (muteStates.all) {
      previousVolume = videoPlayer.volume || previousVolume;
    }
    // 各プレイヤーのミュート状態を更新
    updatePlayerMuteStates();
  }
});

// 各プレイヤーのミュート状態を更新
function updatePlayerMuteStates() {
  // 各トラックのミュート状態を更新
  audioPlayers.forEach((audio, trackId) => {
    const trackMuted = calculateMuteState(trackId);
    audio.muted = trackMuted;
  });
}

openFileButton.addEventListener('click', async () => {
  try {
    loadingElement.style.display = 'block';
    openFileButton.disabled = true;
    const result = await ipcRenderer.invoke('open-file-dialog');
    if (result) {
      await loadVideo(result);
    }
  } catch (error) {
    console.error('Error opening file:', error);
    alert('ファイルの読み込み中にエラーが発生しました。');
  } finally {
    loadingElement.style.display = 'none';
    openFileButton.disabled = false;
  }
});

async function loadVideo(videoData) {
  currentVideo = videoData;
  isInitialLoad = true;

  // 初期のミュート状態を設定
  muteStates.all = false;     // 全体はミュートしない
  muteStates.tracks.clear();  // 各トラックのミュート状態をリセット

  // 既存のオーディオプレーヤーをクリア
  clearAudioPlayers();

  // メインビデオプレーヤーを設定
  videoPlayer.src = videoData.path;
  videoPlayer.muted = true; // 初期はミュートにしておき、トラック選択で解除
  videoPlayer.volume = previousVolume; // 前回の音量を設定

  // 音声トラックのUIを更新
  updateAudioTracks(videoData.audioTracks);

  // ビデオの読み込みを待機
  await new Promise((resolve, reject) => {
    videoPlayer.onloadedmetadata = resolve;
    videoPlayer.onerror = reject;
  }).catch(error => {
    console.error('Error loading video:', error);
    throw new Error('ビデオの読み込みに失敗しました。');
  });

  // audioTracks のチェック状態を初期化 (README仕様準拠)
  videoData.audioTracks.forEach(track => {
    const checkbox = document.getElementById(`track-${track.id}`);
    if (checkbox) {
      if (track.isMainTrack) {
        checkbox.checked = true; // メイン音声はデフォルトでオン
        videoPlayer.muted = false; // メイン音声オンなのでビデオプレーヤーのミュート解除
        setTrackMuteState(track.id, false); // メイン音声のミュート状態も更新
      } else {
        checkbox.checked = false; // 追加音声はデフォルトでオフ
        setTrackMuteState(track.id, true); // 追加トラックは初期ミュート
      }
    }
  });
  updatePlayerMuteStates(); // 初期ミュート状態を各プレイヤーに反映

  isInitialLoad = false;
}

function updateAudioTracks(tracks) {
  audioTracksContainer.innerHTML = '<h3>音声トラック</h3>';

  tracks.forEach((track, index) => {
    const trackItem = document.createElement('div');
    trackItem.className = 'track-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `track-${track.id}`; // IDは main.js から渡されたものを使用

    const label = document.createElement('label');
    label.htmlFor = `track-${track.id}`;
    if (track.isMainTrack) {
      label.textContent = `トラック ${index + 1} (メイン) (${track.language || 'unknown'}) - ${track.channels || '?'}ch`;
    } else {
      label.textContent = `トラック ${index + 1} (${track.language || 'unknown'}) - ${track.channels || '?'}ch`;
    }

    checkbox.addEventListener('change', () => toggleAudioTrack(track, checkbox.checked));

    trackItem.appendChild(checkbox);
    trackItem.appendChild(label);
    audioTracksContainer.appendChild(trackItem);
  });
}

async function toggleAudioTrack(track, enabled) {
  if (track.isMainTrack) {
    videoPlayer.muted = !enabled;
    // muteStates.all と個別のミュート状態は videoPlayer の 'volumechange' イベントや
    // setTrackMuteState/updatePlayerMuteStates で管理される。
    // ここでは videoPlayer.muted の変更に集中する。
    // 必要に応じて、メインプレーヤーのミュート状態を muteStates.tracks にも反映
    setTrackMuteState(track.id, !enabled); 
    updatePlayerMuteStates(); // 全体のミュート状態を再計算・適用
  } else {
    // 追加音声トラックの処理
    setTrackMuteState(track.id, !enabled);
    updatePlayerMuteStates();

    if (enabled && !audioPlayers.has(track.id)) {
      // 新しいオーディオプレイヤーを作成
      if (!track.audioPath) {
        console.error('Audio path is missing for track:', track.id);
        return;
      }
      const audio = new Audio(track.audioPath);
      audio.volume = videoPlayer.volume; // メインプレーヤーの音量に合わせる
      audio.muted = calculateMuteState(track.id);

      // ビデオと同期を維持
      audio.currentTime = videoPlayer.currentTime;
      const syncInterval = setInterval(() => {
        if (Math.abs(audio.currentTime - videoPlayer.currentTime) > 0.1) {
          audio.currentTime = videoPlayer.currentTime;
        }
      }, 100);
      syncIntervals.set(track.id, syncInterval);

      // ビデオのイベントと連動
      const playHandler = () => { if (!audio.muted) audio.play().catch(console.error); };
      const pauseHandler = () => audio.pause();
      const seekedHandler = () => { audio.currentTime = videoPlayer.currentTime; };
      const rateChangeHandler = () => { audio.playbackRate = videoPlayer.playbackRate; };

      videoPlayer.addEventListener('play', playHandler);
      videoPlayer.addEventListener('pause', pauseHandler);
      videoPlayer.addEventListener('seeked', seekedHandler);
      videoPlayer.addEventListener('ratechange', rateChangeHandler);

      audio.eventListeners = { play: playHandler, pause: pauseHandler, seeked: seekedHandler, ratechange: rateChangeHandler };
      audioPlayers.set(track.id, audio);

      if (!videoPlayer.paused && !calculateMuteState(track.id)) {
        audio.play().catch(console.error);
      }
    } else if (!enabled) {
      // オーディオプレーヤーを停止して削除
      const audio = audioPlayers.get(track.id);
      if (audio) {
        audio.pause();
      
      // イベントリスナーを削除
      const { eventListeners } = audio;
      if (eventListeners) {
        videoPlayer.removeEventListener('play', eventListeners.play);
        videoPlayer.removeEventListener('pause', eventListeners.pause);
        videoPlayer.removeEventListener('seeked', eventListeners.seeked);
        videoPlayer.removeEventListener('ratechange', eventListeners.ratechange);
        videoPlayer.removeEventListener('volumechange', eventListeners.volumechange);
      }
      
      // 同期用インターバルをクリア
      clearInterval(syncIntervals.get(track.id));
      syncIntervals.delete(track.id);
      
      audioPlayers.delete(track.id);
    }
    
    // ミュート状態を更新
    // updateMuteState();
  }
}


}
