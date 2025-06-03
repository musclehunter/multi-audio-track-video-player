const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const os = require('os');
const fs = require('fs');

let mainWindow;
let tempDir = path.join(os.tmpdir(), 'electron-video-player');

// 一時フォルダの作成
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 音声トラックを分離する関数
async function extractAudioTrack(videoPath, trackIndex) {
  const outputPath = path.join(tempDir, `audio_track_${trackIndex}.m4a`);
  
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        `-map 0:a:${trackIndex}`,  // 指定したトラックのみを選択
        '-vn',  // ビデオを除外
        '-acodec copy'  // 音声コーデックをそのままコピー
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

// ファイル選択ダイアログを開く
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'mkv'] }]
  });
  
  if (!result.canceled) {
    const filePath = result.filePaths[0];
    return new Promise((resolve, reject) => {
      // ffprobeのオプションを設定して必要な情報のみを取得
      const ffprobeOptions = {
        probesize: 5000000, // 5MBまでのファイル読み込み
        analyzeduration: 5000000, // 5秒間の分析
      };

      ffmpeg.ffprobe(filePath, ffprobeOptions, async (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        
        const audioTracks = metadata.streams.filter(stream => stream.codec_type === 'audio');
        const trackInfo = audioTracks.map((track, index) => ({
          id: index,
          language: track.tags ? track.tags.language : 'unknown',
          codec: track.codec_name,
          channels: track.channels
        }));

        // 各トラックを分離して保存
        try {
          const extractedTracks = await Promise.all(
            trackInfo.map(track => extractAudioTrack(filePath, track.id))
          );

          resolve({
            path: filePath,
            audioTracks: trackInfo.map((track, index) => ({
              ...track,
              audioPath: extractedTracks[index]
            }))
          });
        } catch (extractError) {
          reject(extractError);
        }
      });
    });
  }
  return null;
});

// 終了時に一時ファイルを削除
app.on('before-quit', () => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
