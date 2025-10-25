import {View, Text, Image, Platform, TouchableOpacity} from 'react-native';
import requestStoragePermission from '../../lib/file/getStoragePermission';
import * as FileSystem from 'expo-file-system';
import {downloadFolder} from '../../lib/constants';
import * as VideoThumbnails from 'expo-video-thumbnails';
import React, {useState, useEffect, useCallback} from 'react';
import {settingsStorage, downloadsStorage} from '../../lib/storage';
import useThemeStore from '../../lib/zustand/themeStore';
import * as RNFS from '@dr.pogodin/react-native-fs';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RootStackParamList} from '../../App';
import RNReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {FlashList} from '@shopify/flash-list';

// Define supported video extensions
const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
];

const isVideoFile = (filename: string): boolean => {
  const extension = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  return VIDEO_EXTENSIONS.includes(extension);
};

// Interface for a single file item (used in FlashList data)
interface MediaItem extends FileSystem.FileInfo {
  title: string; // Title extracted from filename
}

// Function to extract a readable title from the filename
const getReadableTitle = (fileName: string): string => {
  let title = fileName;

  // 1. Remove Extension
  title = title.replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i, '');

  // 2. Replace common separators with spaces
  title = title.replace(/[\._-]/g, ' ').replace(/\s{2,}/g, ' ');

  // 3. Trim extra whitespace
  return title.trim();
};

// Function to get episode/season information (reintroduced)
const getEpisodeInfo = (
  fileName: string,
): {season: number; episode: number} => {
  // Try SxxExx
  let match = fileName.match(/s(\d{1,3})e(\d{1,3})/i);
  if (match) {
    return {season: parseInt(match[1], 10), episode: parseInt(match[2], 10)};
  }

  // Try "Episode Y" or "Ep Y"
  match = fileName.match(/(?:episode|ep)[\s._-]*(\d{1,3})/i);
  if (match) {
    let seasonMatch = fileName.match(/season[\s._-]*(\d{1,3})/i);
    const season = seasonMatch ? parseInt(seasonMatch[1], 10) : 1;
    return {season, episode: parseInt(match[1], 10)};
  }

  // Try finding a number at the end, often used for single-digit episode
  match = fileName.match(/[\s._-](\d{1,3})[\s._-]*$/);
  if (match) {
    return {season: 1, episode: parseInt(match[1], 10)};
  }

  // Default case
  return {season: 0, episode: 0}; // Use 0 for "not an episode"
};

const Downloads = () => {
  const [files, setFiles] = useState<FileSystem.FileInfo[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const {primary} = useThemeStore(state => state);

  // groupSelected now tracks selected individual file URIs
  const [groupSelected, setGroupSelected] = useState<string[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);

  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const getFiles = useCallback(async () => {
    setLoading(true);
    const granted = await requestStoragePermission();
    // ... (rest of getFiles logic remains the same)
    if (granted) {
      try {
        const properPath =
          Platform.OS === 'android'
            ? `file://${downloadFolder}`
            : downloadFolder;

        const allFiles = await FileSystem.readDirectoryAsync(properPath);

        const videoFiles = allFiles.filter(file => isVideoFile(file));

        const filesInfo = await Promise.all(
          videoFiles.map(async file => {
            const filePath =
              Platform.OS === 'android'
                ? `file://${downloadFolder}/${file}`
                : `${downloadFolder}/${file}`;

            const fileInfo = await FileSystem.getInfoAsync(filePath);
            return fileInfo;
          }),
        );

        const validFiles = filesInfo.filter(
          f =>
            f.exists &&
            isVideoFile(f.uri.split('/').pop() || '') &&
            f.uri.startsWith('file:///'),
        );

        downloadsStorage.saveFilesInfo(validFiles);
        setFiles(validFiles);
        setLoading(false);
      } catch (error) {
        console.error('Error reading files:', error);
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getFiles();
      return () => {
        setGroupSelected([]);
        setIsSelecting(false);
      };
    }, [getFiles]),
  );

  async function getThumbnail(file: FileSystem.FileInfo) {
    try {
      const fileName = file.uri.split('/').pop();
      if (!fileName || !isVideoFile(fileName)) {
        return null;
      }

      const {uri} = await VideoThumbnails.getThumbnailAsync(file.uri, {
        time: 100000,
      });
      return uri;
    } catch (error) {
      return null;
    }
  }

  // Generate and cache thumbnails
  useEffect(() => {
    const getThumbnails = async () => {
      const cachedThumbnails = downloadsStorage.getThumbnails() || {};
      const filesToProcess = files.filter(
        file => file.exists && !cachedThumbnails[file.uri],
      );

      if (filesToProcess.length === 0) {
        setThumbnails(cachedThumbnails);
        return;
      }

      try {
        const thumbnailPromises = filesToProcess.map(async file => {
          const thumbnail = await getThumbnail(file);
          return thumbnail ? {[file.uri]: thumbnail} : null;
        });

        const thumbnailResults = await Promise.all(thumbnailPromises);
        const newThumbnails = thumbnailResults.reduce((acc, curr) => {
          return curr ? {...acc, ...curr} : acc;
        }, cachedThumbnails);

        downloadsStorage.saveThumbnails(newThumbnails);
        setThumbnails(newThumbnails);
      } catch (error) {
        console.error('Error generating thumbnails:', error);
      }
    };

    getThumbnails();
  }, [files]);

  // Function to delete selected files
  const deleteFiles = async () => {
    const allUrisToDelete = groupSelected;

    if (allUrisToDelete.length === 0) return;

    try {
      await Promise.all(
        allUrisToDelete.map(async fileUri => {
          try {
            const path =
              Platform.OS === 'android'
                ? fileUri.replace('file://', '')
                : fileUri;

            const fileInfo = await FileSystem.getInfoAsync(fileUri);
            if (fileInfo.exists) {
              await RNFS.unlink(path);
            }
          } catch (error) {
            console.error(`Error deleting file ${fileUri}:`, error);
          }
        }),
      );

      const newFiles = files.filter(
        file => !allUrisToDelete.includes(file.uri),
      );
      setFiles(newFiles);
      downloadsStorage.saveFilesInfo(newFiles);

      const newThumbnails = {...thumbnails};
      allUrisToDelete.forEach(uri => delete newThumbnails[uri]);
      setThumbnails(newThumbnails);
      downloadsStorage.saveThumbnails(newThumbnails);

      setGroupSelected([]);
      setIsSelecting(false);
      RNReactNativeHapticFeedback.trigger('notificationSuccess');
    } catch (error) {
      console.error('Overall error deleting files:', error);
      RNReactNativeHapticFeedback.trigger('notificationError');
    }
  };

  // Maps FileSystem.FileInfo to MediaItem for rendering
  const mediaItems: MediaItem[] = files.map(file => ({
    ...file,
    title: getReadableTitle(file.uri.split('/').pop() || ''),
  }));

  // Function to handle a single item selection/deselection
  const toggleSelection = (fileUri: string) => {
    const isCurrentlySelected = groupSelected.includes(fileUri);

    if (settingsStorage.isHapticFeedbackEnabled()) {
      RNReactNativeHapticFeedback.trigger('effectTick');
    }

    if (isCurrentlySelected) {
      const newSelection = groupSelected.filter(f => f !== fileUri);
      setGroupSelected(newSelection);
      if (newSelection.length === 0) {
        setIsSelecting(false);
      }
    } else {
      setGroupSelected([...groupSelected, fileUri]);
    }
  };

  // Function to handle item press (navigation)
  const handleItemPress = (item: MediaItem) => {
    if (isSelecting) {
      toggleSelection(item.uri);
    } else {
      const directUrl = item.uri.startsWith('file://')
        ? item.uri
        : `file://${item.uri}`;

      navigation.navigate('Player', {
        episodeList: [{title: item.title, link: directUrl}],
        linkIndex: 0,
        type: 'download',
        directUrl: directUrl,
        primaryTitle: item.title,
        poster: thumbnails[item.uri] ? {uri: thumbnails[item.uri]} : {},
        providerValue: 'vega',
      });
    }
  };

  return (
    <View className="mt-14 px-2 w-full h-full bg-black">
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-2xl text-white">Downloads</Text>
        <View className="flex-row gap-x-7 items-center">
          {isSelecting && (
            <TouchableOpacity
              onPress={() => {
                setGroupSelected([]);
                setIsSelecting(false);
              }}>
              <MaterialCommunityIcons name="close" size={28} color={primary} />
            </TouchableOpacity>
          )}
          {isSelecting && groupSelected.length > 0 && (
            <TouchableOpacity onPress={deleteFiles}>
              <MaterialCommunityIcons
                name="delete-outline"
                size={28}
                color={primary}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlashList
        data={mediaItems}
        numColumns={3}
        estimatedItemSize={200}
        ListEmptyComponent={() =>
          !loading && (
            <View className="flex-1 justify-center items-center mt-10">
              <Text className="text-center text-lg text-white opacity-80">
                Looks Empty Here!
              </Text>
            </View>
          )
        }
        renderItem={({item}) => {
          const isSelected = isSelecting && groupSelected.includes(item.uri);
          const fileName = item.uri.split('/').pop() || '';
          const episodeInfo = getEpisodeInfo(fileName);
          const isEpisode = episodeInfo.episode > 0;
          const episodeLabel = isEpisode ? `E${episodeInfo.episode}` : '';

          return (
            <TouchableOpacity
              key={item.uri}
              className={`flex-1 m-0.5 rounded-lg overflow-hidden border-2 ${
                isSelected
                  ? `border-[${primary}] bg-quaternary/50`
                  : 'border-transparent bg-tertiary'
              }`}
              onLongPress={() => {
                if (!isSelecting) {
                  RNReactNativeHapticFeedback.trigger('impactHeavy');
                  setIsSelecting(true);
                  setGroupSelected([item.uri]);
                }
              }}
              onPress={() => handleItemPress(item)}>
              <View className="relative aspect-[2/3]">
                {thumbnails[item.uri] ? (
                  <Image
                    source={{uri: thumbnails[item.uri]}}
                    className="w-full h-full rounded-lg"
                    resizeMode="cover"
                  />
                ) : (
                  <View className="w-full h-full bg-quaternary rounded-lg justify-center items-center">
                    <MaterialCommunityIcons
                      name="movie-roll"
                      size={40}
                      color="gray"
                    />
                  </View>
                )}

                {/* EPISODE NUMBER CIRCLE */}
                {isEpisode && (
                  <View
                    className={`absolute top-1 left-1 bg-black/70 rounded-full w-8 h-8 justify-center items-center border border-[${primary}]`}>
                    <Text className="text-white text-xs font-bold">
                      {episodeLabel}
                    </Text>
                  </View>
                )}

                {/* SELECTION CHECKMARK */}
                {isSelected && (
                  <View className="absolute top-1 right-1">
                    <MaterialCommunityIcons
                      name="check-circle"
                      size={28}
                      color={primary}
                    />
                  </View>
                )}

                {/* TITLE BAR */}
                <View className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 rounded-b-lg">
                  <Text
                    className="text-white text-xs font-bold"
                    numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
};

export default Downloads;
