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
async function extractAudioTrack(videoPath, ffmpegAudioMapIndex, newTrackId) {
  console.log(`[TIMER] extractAudioTrack for ffmpeg map index ${ffmpegAudioMapIndex} (new id ${newTrackId}) started`);
  const startTime = Date.now();
  const outputPath = path.join(tempDir, `audio_track_${newTrackId}.m4a`);
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .on('stderr', function(stderrLine) {
        console.log('Stderr output (audio ffmpeg map ' + ffmpegAudioMapIndex + ' new id ' + newTrackId + '): ' + stderrLine);
      })
      .outputOptions([
        `-map 0:a:${ffmpegAudioMapIndex}`,
        '-vn',
        '-acodec copy'
      ])
      .output(outputPath)
      .on('end', () => {
        const endTime = Date.now();
        console.log(`[TIMER] (ffmpeg) extractAudioTrack for ffmpeg map index ${ffmpegAudioMapIndex} (new id ${newTrackId}) finished in ${endTime - startTime}ms`);
        resolve(outputPath);
      })
      .on('error', (err) => reject(err))
      .run();
  });
}

// ファイル選択ダイアログを開く
ipcMain.handle('open-file-dialog', async () => {
  console.log('[TIMER] open-file-dialog started');
  const mainProcessStartTime = Date.now();
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
        analyzeduration: 2000000, // 2秒間の分析
      };

      console.log('[TIMER] ffprobe started');
      const ffprobeStartTime = Date.now();
      ffmpeg.ffprobe(filePath, ffprobeOptions, async (err, metadata) => {
        const ffprobeEndTime = Date.now();
        console.log(`[TIMER] ffprobe finished in ${ffprobeEndTime - ffprobeStartTime}ms`);
        if (err) {
          const mainProcessEndTime = Date.now(); // エラー時も記録
          console.error(`[TIMER] open-file-dialog (ffprobe) failed in ${mainProcessEndTime - mainProcessStartTime}ms`, err);
          reject(err);
          return;
        }

        const allAudioStreams = metadata.streams.filter(stream => stream.codec_type === 'audio');
let audioTracksForRenderer = [];
        let mainPlayerAudioStreamInfo = null; // メインプレーヤーで再生される音声ストリームの情報
        let additionalAudioTracksInfo = [];   // 追加で抽出する音声トラックの情報

        if (allAudioStreams.length > 0) {
          // 全音声トラックをaudioTracksForRendererに格納
          const audioTrackPromises = allAudioStreams.map(async (stream, idx) => {
            if (idx === 0) {
              // メイントラック（抽出不要）
              return {
                id: 'main_audio_track',
                isMainTrack: true,
                language: stream.tags ? stream.tags.language : 'unknown',
                codec: stream.codec_name,
                channels: stream.channels,
                audioPath: null
              };
            } else {
              // 追加トラック（抽出）
              const trackId = `additional_track_${idx - 1}`;
              try {
                const extractedPath = await extractAudioTrack(filePath, idx, trackId);
                return {
                  id: trackId,
                  isMainTrack: false,
                  language: stream.tags ? stream.tags.language : 'unknown',
                  codec: stream.codec_name,
                  channels: stream.channels,
                  audioPath: extractedPath
                };
              } catch (extractError) {
                console.error(`Error extracting audio track ${trackId} (ffmpeg map ${idx}):`, extractError);
                return null;
              }
            }
          });
          const resolvedTracks = await Promise.all(audioTrackPromises);
          resolvedTracks.forEach(trackInfo => {
            if (trackInfo) audioTracksForRenderer.push(trackInfo);
          });

        } else {
          console.log('[INFO] No audio streams found in the video.');
        }

        const mainProcessEndTime = Date.now();
        console.log(`[TIMER] open-file-dialog finished in ${mainProcessEndTime - mainProcessStartTime}ms`);
        resolve({
          path: filePath, 
          audioTracks: audioTracksForRenderer
        });
      });
    });
  }
  return null;
});

// 終了時に一時ファイルを削除
app.on('before-quit', () => {
  if (fs.existsSync(tempDir)) {
    fs.rm(tempDir, { recursive: true, force: true }, (err) => {
      if (err) {
        console.warn('[WARN] 一時ディレクトリ削除失敗:', err.message);
        // EBUSY等は無視して続行
      }
    });
  }
});
