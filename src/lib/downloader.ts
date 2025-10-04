import * as RNFS from '@dr.pogodin/react-native-fs';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { Alert, Platform } from 'react-native';
import axios from 'axios';
import { downloadFolder } from './constants';
import requestStoragePermission from './file/getStoragePermission';
import { hlsDownloader2, cancelHlsDownload } from './hlsDownloader2';
import { ifExists } from './file/ifExists';

interface DownloadTask {
  jobId: number | string;
  fileName: string;
  url: string;
  path: string;
  headers?: any;
  downloadedBytes: number;
  totalBytes: number;
  paused: boolean;
  type: 'normal' | 'hls';
}

const activeDownloads = new Map<number | string, DownloadTask>();
let nextHlsId = 1000;

// Create download channel on Android
async function initDownloadChannel() {
  if (Platform.OS === 'android') {
    await notifee.createChannel({
      id: 'download',
      name: 'Downloads',
      importance: AndroidImportance.HIGH,
    });
  }
}

// Helper to display notification with pause/resume/cancel actions
async function showDownloadNotification(task: DownloadTask) {
  const progress = task.totalBytes ? (task.downloadedBytes / task.totalBytes) * 100 : 0;

  await notifee.displayNotification({
    id: task.fileName,
    title: task.fileName,
    body: `${Math.floor(progress)}% - ${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)}`,
    android: {
      channelId: 'download',
      smallIcon: 'ic_notification',
      color: task.paused ? '#FFA000' : '#FF6347',
      progress: { max: 100, current: Math.floor(progress), indeterminate: false },
      actions: [
        {
          title: task.paused ? 'Resume' : 'Pause',
          pressAction: { id: `toggle_${task.fileName}` },
        },
        { title: 'Cancel', pressAction: { id: `cancel_${task.fileName}` } },
      ],
      onlyAlertOnce: true,
    },
  });
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Handle notification actions
notifee.onForegroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS) {
    const actionId = detail.pressAction.id;
    if (actionId.startsWith('toggle_')) {
      const fileName = actionId.replace('toggle_', '');
      togglePauseResume(fileName);
    } else if (actionId.startsWith('cancel_')) {
      const fileName = actionId.replace('cancel_', '');
      cancelDownload(fileName);
    }
  }
});

async function togglePauseResume(fileName: string) {
  const task = Array.from(activeDownloads.values()).find(d => d.fileName === fileName);
  if (!task) return;

  if (task.type === 'hls') {
    if (task.paused) {
      // Resume HLS
      hlsDownloader2({
        videoUrl: task.url,
        path: task.path,
        fileName: task.fileName,
        setDownloadActive: val => {},
        setAlreadyDownloaded: val => {},
        setDownloadId: val => {},
        headers: task.headers,
      });
    } else {
      cancelHlsDownload(task.jobId);
    }
  } else {
    task.paused = !task.paused;
    if (task.paused) {
      RNFS.stopDownload(task.jobId as number);
    } else {
      resumeDownload(task);
    }
  }
  showDownloadNotification(task);
}

async function cancelDownload(fileName: string) {
  const task = Array.from(activeDownloads.values()).find(d => d.fileName === fileName);
  if (!task) return;

  if (task.type === 'hls') cancelHlsDownload(task.jobId);
  else if (!task.paused) RNFS.stopDownload(task.jobId as number);

  activeDownloads.delete(task.jobId);
  await notifee.cancelNotification(fileName);
  if (await RNFS.exists(task.path)) await RNFS.unlink(task.path);
}

async function resumeDownload(task: DownloadTask) {
  const headers = task.headers || {};
  if (task.downloadedBytes > 0) {
    headers['Range'] = `bytes=${task.downloadedBytes}-`;
  }
  const ret = RNFS.downloadFile({
    fromUrl: task.url,
    toFile: task.path,
    headers,
    background: true,
    progressInterval: 1000,
    begin: res => {
      task.jobId = res.jobId;
      activeDownloads.set(res.jobId, task);
    },
    progress: res => {
      task.downloadedBytes = res.bytesWritten;
      task.totalBytes = res.contentLength;
      showDownloadNotification(task);
    },
  });
  ret.promise.then(() => {
    activeDownloads.delete(task.jobId);
    notifee.displayNotification({
      id: `complete_${task.fileName}`,
      title: 'Download Complete',
      body: task.fileName,
      android: { channelId: 'download', smallIcon: 'ic_notification', color: '#00C853' },
    });
  }).catch(err => {
    activeDownloads.delete(task.jobId);
    notifee.displayNotification({
      id: `failed_${task.fileName}`,
      title: 'Download Failed',
      body: task.fileName,
      android: { channelId: 'download', smallIcon: 'ic_notification', color: '#D50000' },
    });
  });
}

export async function downloadManager({
  url,
  fileName,
  fileType,
  title,
  setDownloadActive,
  setAlreadyDownloaded,
  setDownloadId,
  headers,
}: {
  url: string;
  fileName: string;
  fileType: string;
  title: string;
  setDownloadActive: (val: boolean) => void;
  setAlreadyDownloaded: (val: boolean) => void;
  setDownloadId: (val: number) => void;
  headers?: any;
}) {
  await requestStoragePermission();
  await initDownloadChannel();

  if (await ifExists(fileName)) {
    setAlreadyDownloaded(true);
    setDownloadActive(false);
    return;
  }

  setDownloadActive(true);
  if (!(await RNFS.exists(downloadFolder))) await RNFS.mkdir(downloadFolder);

  const downloadPath = `${downloadFolder}/${fileName}.${fileType}`;

  if (fileType === 'm3u8') {
    const hlsId = nextHlsId++;
    hlsDownloader2({
      videoUrl: url,
      path: downloadPath,
      fileName,
      title,
      setDownloadActive,
      setAlreadyDownloaded,
      setDownloadId,
      headers,
    });
    activeDownloads.set(hlsId, { jobId: hlsId, fileName, url, path: downloadPath, downloadedBytes: 0, totalBytes: 0, paused: false, type: 'hls' });
    return hlsId;
  }

  const task: DownloadTask = { jobId: 0, fileName, url, path: downloadPath, downloadedBytes: 0, totalBytes: 0, paused: false, type: 'normal', headers };
  setDownloadId(0);

  const ret = RNFS.downloadFile({
    fromUrl: url,
    toFile: downloadPath,
    headers: headers || {},
    background: true,
    progressInterval: 1000,
    begin: res => {
      task.jobId = res.jobId;
      activeDownloads.set(res.jobId, task);
      showDownloadNotification(task);
    },
    progress: res => {
      task.downloadedBytes = res.bytesWritten;
      task.totalBytes = res.contentLength;
      showDownloadNotification(task);
    },
  });

  ret.promise.then(() => {
    activeDownloads.delete(task.jobId);
    setAlreadyDownloaded(true);
    setDownloadActive(false);
    notifee.displayNotification({
      id: `complete_${fileName}`,
      title: 'Download Complete',
      body: fileName,
      android: { channelId: 'download', smallIcon: 'ic_notification', color: '#00C853' },
    });
  }).catch(err => {
    activeDownloads.delete(task.jobId);
    setAlreadyDownloaded(false);
    setDownloadActive(false);
    Alert.alert('Download failed', err.message || 'Failed to download');
    notifee.displayNotification({
      id: `failed_${fileName}`,
      title: 'Download Failed',
      body: fileName,
      android: { channelId: 'download', smallIcon: 'ic_notification', color: '#D50000' },
    });
  });

  return ret.jobId;
}