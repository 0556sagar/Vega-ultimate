import React, {useEffect, useState, useRef, useCallback, useMemo} from 'react';
import {
  ScrollView,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
  Platform,
  TouchableNativeFeedback,
  StatusBar,
  AppState,
  AppStateStatus,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
} from 'react-native-reanimated';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../../App';
import {cacheStorage, settingsStorage} from '../../lib/storage';
import {OrientationLocker, LANDSCAPE} from 'react-native-orientation-locker';
import VideoPlayer from '@8man/react-native-media-console';
import {useNavigation} from '@react-navigation/native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  VideoRef,
  SelectedVideoTrack,
  SelectedVideoTrackType,
  ResizeMode,
  SelectedTrack,
  SelectedTrackType,
} from 'react-native-video';
import useContentStore from '../../lib/zustand/contentStore';
// import {CastButton, useRemoteMediaClient} from 'react-native-google-cast';
import {SafeAreaView} from 'react-native-safe-area-context';
// import GoogleCast from 'react-native-google-cast';
import * as DocumentPicker from 'expo-document-picker';
import useThemeStore from '../../lib/zustand/themeStore';
import {FlashList} from '@shopify/flash-list';
import SearchSubtitles from '../../components/SearchSubtitles';
import useWatchHistoryStore from '../../lib/zustand/watchHistrory';
import {useStream, useVideoSettings} from '../../lib/hooks/useStream';
import {
  usePlayerProgress,
  usePlayerSettings,
} from '../../lib/hooks/usePlayerSettings';
import FullScreenChz from 'react-native-fullscreen-chz';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

// --- FAST FORWARD SETTINGS MOCK (FIXED: Removed all storage logic) ---
const MOCK_FAST_FORWARD_RATES = [1.5, 2.0, 3.0, 4.0];
const MOCK_DEFAULT_FF_RATE = 2.0;

const getFastForwardRate = () => {
  return MOCK_DEFAULT_FF_RATE;
};
// ---------------------------------------------------------------------

// FIX: Changed from 1500ms to 2000ms (2 seconds)
const FAST_FORWARD_DELAY_MS = 1300;

const Player = ({route}: Props): React.JSX.Element => {
  const {primary} = useThemeStore(state => state);
  const {provider} = useContentStore();
  const navigation = useNavigation();
  const {addItem, updatePlaybackInfo, updateItemWithInfo} =
    useWatchHistoryStore();

  // Player ref
  const playerRef: React.RefObject<VideoRef> = useRef(null);
  const hasSetInitialTracksRef = useRef(false);

  // <<< FIX FOR PIP RESTORATION: State to force re-render/reset video view size on PIP restore
  const [keyForPlayer, setKeyForPlayer] = useState(0);

  // <<< FIX FOR PIP RESTORATION: State to conditionally render the player for layout reset
  const [showPlayer, setShowPlayer] = useState(true);
  // >>> END OF PIP RESTORATION STATES

  // Timer ref for the fast-forward long press delay
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // === FIX: Touch tracking refs for scroll/swipe cancellation ===
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const isMovingRef = useRef(false);
  // ==============================================================

  // Shared values for animations
  const loadingOpacity = useSharedValue(0);
  const loadingScale = useSharedValue(0.8);
  const loadingRotation = useSharedValue(0);
  const lockButtonTranslateY = useSharedValue(-150);
  const lockButtonOpacity = useSharedValue(0);
  const textVisibility = useSharedValue(0);
  const speedIconOpacity = useSharedValue(1);
  const controlsTranslateY = useSharedValue(150);
  const controlsOpacity = useSharedValue(0);
  const toastOpacity = useSharedValue(0);
  const settingsTranslateY = useSharedValue(10000);
  const settingsOpacity = useSharedValue(0);

  // Animated styles
  const loadingContainerStyle = useAnimatedStyle(() => ({
    opacity: loadingOpacity.value,
    transform: [{scale: loadingScale.value}],
  }));

  const loadingIconStyle = useAnimatedStyle(() => ({
    transform: [{rotate: `${loadingRotation.value}deg`}],
  }));

  const lockButtonStyle = useAnimatedStyle(() => ({
    transform: [{translateY: lockButtonTranslateY.value}],
    opacity: lockButtonOpacity.value,
  }));

  const controlsStyle = useAnimatedStyle(() => ({
    transform: [{translateY: controlsTranslateY.value}],
    opacity: controlsOpacity.value,
  }));

  const toastStyle = useAnimatedStyle(() => ({
    opacity: toastOpacity.value,
  }));

  const settingsStyle = useAnimatedStyle(() => ({
    transform: [{translateY: settingsTranslateY.value}],

    opacity: settingsOpacity.value,
  }));

  // Active episode state
  const [activeEpisode, setActiveEpisode] = useState(
    route.params?.episodeList?.[route.params.linkIndex],
  );

  // Search subtitles state
  const [searchQuery, setSearchQuery] = useState('');

  // Custom hooks for stream management
  const {
    streamData,
    selectedStream,
    setSelectedStream,
    externalSubs,
    setExternalSubs,
    isLoading: streamLoading,
    error: streamError,
    switchToNextStream,
  } = useStream({
    activeEpisode,
    routeParams: route.params,
    provider: provider.value,
  });

  // Custom hooks for video settings
  const {
    audioTracks,
    textTracks,
    videoTracks,
    selectedAudioTrackIndex,
    selectedTextTrackIndex,
    selectedQualityIndex,
    setSelectedAudioTrackIndex,
    setSelectedTextTrackIndex,
    setSelectedQualityIndex,
    setTextTracks,
    processAudioTracks,
    processVideoTracks,
  } = useVideoSettings();

  // Local state for toast message
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  // Custom hooks for player settings
  const {
    showControls,
    setShowControls,
    showSettings,
    setShowSettings,
    activeTab,
    setActiveTab,
    resizeMode,
    playbackRate: basePlaybackRate,
    setPlaybackRate: setBasePlaybackRate,
    isPlayerLocked,
    showUnlockButton,
    isTextVisible,
    handleResizeMode,
    togglePlayerLock,
    handleLockedScreenTap,
    unlockButtonTimerRef,
  } = usePlayerSettings();

  // --- FAST FORWARD FEATURE STATE AND LOGIC ---
  const [isFastForwarding, setIsFastForwarding] = useState(false);
  const [fastForwardRate, setLocalFastForwardRate] = useState(
    getFastForwardRate(),
  );

  // Determine the final playback rate
  const finalPlaybackRate = useMemo(() => {
    // If fast-forwarding, use the custom fastForwardRate, otherwise use the basePlaybackRate.
    return isFastForwarding ? fastForwardRate : basePlaybackRate;
  }, [isFastForwarding, fastForwardRate, basePlaybackRate]);

  // Handle touch events for fast-forward
  const handleTouchStart = useCallback(
    (e: any) => {
      // Record initial touch position for movement detection
      touchStartXRef.current = e.nativeEvent.pageX;
      touchStartYRef.current = e.nativeEvent.pageY;
      isMovingRef.current = false; // Reset movement flag

      // 1. Only activate FF if player is not locked, controls are hidden, and settings are hidden
      if (
        !isPlayerLocked &&
        !showControls &&
        !showSettings &&
        playerRef.current
      ) {
        // 2. Clear any existing timer just in case
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
        }

        // 3. Start a timer for the 2-second long press delay (FAST_FORWARD_DELAY_MS)
        longPressTimerRef.current = setTimeout(() => {
          // 4. Only activate FF after the delay AND if not a scroll/move
          if (!isMovingRef.current) {
            setIsFastForwarding(true);
            // Show Fast Forward toast
            setToastMessage(`Fast Forward ${fastForwardRate.toFixed(1)}x`);
            setShowToast(true);
            // Clear the timer reference since it has completed
            longPressTimerRef.current = null;
          } else {
            // If it was a move and the timer fires, just clear the timer.
            longPressTimerRef.current = null;
          }
        }, FAST_FORWARD_DELAY_MS);
      }
    },
    [
      isPlayerLocked,
      showControls,
      showSettings,
      fastForwardRate,
      setShowToast,
      setToastMessage,
    ],
  );

  // FIX: This now actively detects movement and cancels the pending long-press.
  const handleTouchMove = useCallback(
    (e: any) => {
      // Check if the touch has moved significantly (e.g., more than 10 pixels in either axis)
      const deltaX = Math.abs(e.nativeEvent.pageX - touchStartXRef.current);
      const deltaY = Math.abs(e.nativeEvent.pageY - touchStartYRef.current);
      const MIN_MOVE_DISTANCE = 10; // Threshold for movement (e.g., 10 pixels)

      if (deltaX > MIN_MOVE_DISTANCE || deltaY > MIN_MOVE_DISTANCE) {
        isMovingRef.current = true; // Mark as a move/scroll gesture

        // If a timer is running (meaning a long press is pending), clear it immediately.
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        // If fast-forwarding was active (e.g., if we try to FF and then scroll)
        if (isFastForwarding) {
          setIsFastForwarding(false);
          setShowToast(false);
        }
      }
    },
    [isFastForwarding, setShowToast],
  );

  const handleTouchEnd = useCallback(() => {
    // 1. If the timer is still running, clear it (means hold was too short)
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // 2. Stop fast-forwarding if it was active
    // This immediately stops the FF action upon release.
    if (isFastForwarding) {
      setIsFastForwarding(false);
      // Hide Fast Forward toast
      setShowToast(false);
    }

    // Reset the moving flag after a brief moment to ensure a clean start for the next touch.
    setTimeout(() => {
      isMovingRef.current = false;
    }, 50);
  }, [isFastForwarding, setShowToast]);
  // --- END OF FAST FORWARD FEATURE LOGIC ---

  // Custom hook for progress handling
  const {videoPositionRef, handleProgress} = usePlayerProgress({
    activeEpisode,
    routeParams: route.params,
    playbackRate: finalPlaybackRate,
    updatePlaybackInfo,
  });

  // Memoized values
  const playbacks = useMemo(
    () => [0.25, 0.5, 1.0, 1.25, 1.35, 1.5, 1.75, 2],
    [],
  );
  const hideSeekButtons = useMemo(
    () => settingsStorage.hideSeekButtons() || false,
    [],
  );

  const enableSwipeGesture = useMemo(
    () => settingsStorage.isSwipeGestureEnabled(),
    [],
  );
  const showMediaControls = useMemo(
    () => settingsStorage.showMediaControls() || false,
    [],
  );

  // Memoized watched duration
  const watchedDuration = useMemo(() => {
    const cached = cacheStorage.getString(activeEpisode?.link);
    return cached ? JSON.parse(cached).position : 0;
  }, [activeEpisode?.link]);

  // Memoized selected tracks
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<SelectedTrack>({
    type: SelectedTrackType.INDEX,
    value: 0,
  });

  const [selectedTextTrack, setSelectedTextTrack] = useState<SelectedTrack>({
    type: SelectedTrackType.DISABLED,
  });

  const [selectedVideoTrack, setSelectedVideoTrack] =
    useState<SelectedVideoTrack>({
      type: SelectedVideoTrackType.AUTO,
    });

  // Remote media client for casting
  // const remoteMediaClient = Platform.isTV ? null : useRemoteMediaClient();

  // Memoized format quality function
  const formatQuality = useCallback((quality: string) => {
    if (quality === 'auto') {
      return quality;
    }
    const num = Number(quality);
    if (num > 1080) {
      return '4K';
    }
    if (num > 720) {
      return '1080p';
    }
    if (num > 480) {
      return '720p';
    }
    if (num > 360) {
      return '480p';
    }
    if (num > 240) {
      return '360p';
    }
    if (num > 144) {
      return '240p';
    }
    return quality;
  }, []);

  // Memoized next episode handler
  const handleNextEpisode = useCallback(() => {
    const currentIndex = route.params?.episodeList?.indexOf(activeEpisode);
    if (
      currentIndex !== undefined &&
      currentIndex < route.params?.episodeList?.length - 1
    ) {
      setActiveEpisode(route.params?.episodeList[currentIndex + 1]);
      hasSetInitialTracksRef.current = false;
    } else {
      ToastAndroid.show('No more episodes', ToastAndroid.SHORT);
    }
  }, [activeEpisode, route.params?.episodeList]);

  // Memoized error handler
  const handleVideoError = useCallback(
    (e: any) => {
      console.log('PlayerError', e);
      if (!switchToNextStream()) {
        ToastAndroid.show(
          'Video could not be played, try again later',
          ToastAndroid.SHORT,
        );
        navigation.goBack();
      }
      setShowControls(true);
    },
    [switchToNextStream, navigation, setShowControls],
  );

  // <<< FIX FOR PIP RESTORATION: Handler for returning from Picture-in-Picture
  const handleRestorePIP = useCallback(() => {
    // 1. Reset playback rate to 1.0 (recommended after PIP)
    setBasePlaybackRate(1.0);

    // 2. Temporarily hide the player to UNMOUNT it. This is CRITICAL to force the
    //    native view to release its previous smaller PIP bounds and trigger a full
    //    re-render/re-measure when it is shown again.
    setShowPlayer(false);

    // 3. Use an extended delay (400ms) to ensure the unmount and the full-screen layout
    //    pass completes before remounting.
    setTimeout(() => {
      // 4. Force component re-render by updating the key.
      setKeyForPlayer(prev => prev + 1);

      // 5. Re-show the player. It will mount now with the new full-screen layout.
      setShowPlayer(true);

      // 6. Resume the player after a brief moment to ensure the Video component is mounted
      setTimeout(() => {
        playerRef?.current?.resume();
      }, 200); // Resume delay increased to 200ms
    }, 400); // **Core delay increased to 400ms**
  }, [setBasePlaybackRate]);
  // >>> END OF PIP RESTORATION LOGIC

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      // FIX: Ensure video is paused on unmount as a fallback
      playerRef?.current?.pause();
      if (unlockButtonTimerRef.current) {
        clearTimeout(unlockButtonTimerRef.current);
      }
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, [unlockButtonTimerRef]);

  // Enter/Exit fullscreen immersive mode on mount/unmount
  useEffect(() => {
    FullScreenChz.enable();
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      FullScreenChz.disable();
      // FIX: Ensure video is paused immediately before screen removal/unmount
      playerRef?.current?.pause();
    });
    return unsubscribe;
  }, [navigation]);

  // --- FIX FOR AUTOMATIC PIP ON BACKGROUND: useEffect for AppState ---
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        nextAppState.match(/inactive|background/) &&
        playerRef.current &&
        !isPlayerLocked &&
        !showSettings
      ) {
        playerRef.current.enterPictureInPicture();
      }
    };

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );

    return () => {
      subscription.remove();
    };
  }, [isPlayerLocked, showSettings]);
  // --- END OF APPSTATE LOGIC ---

  // Reset track selections when stream changes
  useEffect(() => {
    setSelectedAudioTrackIndex(0);
    setSelectedTextTrackIndex(1000);
    setSelectedQualityIndex(1000);
  }, [
    selectedStream,
    setSelectedAudioTrackIndex,
    setSelectedTextTrackIndex,
    setSelectedQualityIndex,
  ]);

  // Initialize search query
  useEffect(() => {
    setSearchQuery(route.params?.primaryTitle || '');
  }, [route.params?.primaryTitle]);

  // Add to watch history
  useEffect(() => {
    if (route.params?.primaryTitle) {
      addItem({
        id: route.params.infoUrl || activeEpisode.link,
        title: route.params.primaryTitle,
        poster:
          route.params.poster?.poster || route.params.poster?.background || '',
        link: route.params.infoUrl || '',
        provider: route.params?.providerValue || provider.value,
        lastPlayed: Date.now(),
        duration: 0,
        currentTime: 0,
        playbackRate: 1,
        episodeTitle: route.params?.secondaryTitle,
      });

      updateItemWithInfo(
        route.params.episodeList[route.params.linkIndex].link,
        {
          ...route.params,
          cachedAt: Date.now(),
        },
      );
    }
  }, [
    route.params?.primaryTitle,
    activeEpisode.link,
    addItem,
    updateItemWithInfo,
    route.params,
    provider.value,
  ]);

  // Set last selected audio and subtitle tracks
  useEffect(() => {
    if (hasSetInitialTracksRef.current) {
      return;
    }

    const lastAudioTrack = cacheStorage.getString('lastAudioTrack') || 'auto';
    const lastTextTrack = cacheStorage.getString('lastTextTrack') || 'auto';

    const audioTrackIndex = audioTracks.findIndex(
      track => track.language === lastAudioTrack,
    );
    const textTrackIndex = textTracks.findIndex(
      track => track.language === lastTextTrack,
    );

    if (audioTrackIndex !== -1) {
      setSelectedAudioTrack({
        type: SelectedTrackType.INDEX,
        value: audioTrackIndex,
      });
      setSelectedAudioTrackIndex(audioTrackIndex);
    }

    if (textTrackIndex !== -1) {
      setSelectedTextTrack({
        type: SelectedTrackType.INDEX,
        value: textTrackIndex,
      });
      setSelectedTextTrackIndex(textTrackIndex);
    }

    if (audioTracks.length > 0 && textTracks.length > 0) {
      hasSetInitialTracksRef.current = true;
    }
  }, [
    textTracks,
    audioTracks,
    setSelectedAudioTrackIndex,
    setSelectedTextTrackIndex,
  ]);

  // Animation effects
  useEffect(() => {
    // Loading animations
    if (streamLoading) {
      loadingOpacity.value = withTiming(1, {duration: 800});
      loadingScale.value = withTiming(1, {duration: 800});
      loadingRotation.value = withRepeat(
        withSequence(
          withDelay(500, withTiming(180, {duration: 900})),
          withTiming(180, {duration: 600}),
          withTiming(360, {duration: 900}),
          withTiming(360, {duration: 600}),
        ),
        -1,
      );
    }
  }, [streamLoading]);

  useEffect(() => {
    // Lock button animations
    const shouldShow =
      (isPlayerLocked && showUnlockButton) || (!isPlayerLocked && showControls);
    lockButtonTranslateY.value = withTiming(shouldShow ? 0 : -150, {
      duration: 250,
    });
    lockButtonOpacity.value = withTiming(shouldShow ? 1 : 0, {
      duration: 250,
    });
  }, [isPlayerLocked, showUnlockButton, showControls]);

  useEffect(() => {
    // 2x speed text visibility
    textVisibility.value = withTiming(isTextVisible ? 1 : 0, {duration: 250});

    // Speed icon blinking animation
    if (isTextVisible) {
      speedIconOpacity.value = withRepeat(
        withSequence(
          withTiming(1, {duration: 250}),
          withTiming(0, {duration: 150}),
          withTiming(1, {duration: 150}),
        ),
        -1,
      );
    } else {
      speedIconOpacity.value = withTiming(1, {duration: 150});
    }
  }, [isTextVisible]);

  useEffect(() => {
    // Controls visibility
    controlsTranslateY.value = withTiming(showControls ? 0 : 150, {
      duration: 250,
    });
    controlsOpacity.value = withTiming(showControls ? 1 : 0, {
      duration: 250,
    });
  }, [showControls]);

  useEffect(() => {
    // Toast visibility
    toastOpacity.value = withTiming(showToast ? 1 : 0, {duration: 250});
  }, [showToast]);

  useEffect(() => {
    // Settings modal visibility
    settingsTranslateY.value = withTiming(showSettings ? 0 : 5000, {
      duration: 250,
    });
    settingsOpacity.value = withTiming(showSettings ? 1 : 0, {
      duration: 250,
    });
  }, [showSettings]);

  // Memoized video player props
  const videoPlayerProps = useMemo(
    () => ({
      disableGesture: isPlayerLocked || !enableSwipeGesture,
      doubleTapTime: 200,
      disableSeekButtons: isPlayerLocked || hideSeekButtons,
      showOnStart: !isPlayerLocked,
      source: {
        textTracks: externalSubs,
        uri: selectedStream?.link || '',
        bufferConfig: {backBufferDurationMs: 30000},
        shouldCache: true,
        ...(selectedStream?.type === 'm3u8' && {type: 'm3u8'}),
        headers: selectedStream?.headers,
        metadata: {
          title: route.params?.primaryTitle,
          subtitle: activeEpisode?.title,
          artist: activeEpisode?.title,
          description: activeEpisode?.title,
          imageUri: route.params?.poster?.poster,
        },
      },
      onProgress: handleProgress,
      onLoad: () => {
        playerRef?.current?.seek(watchedDuration);
        playerRef?.current?.resume(); // Ensure player is resumed on load/seek
        setBasePlaybackRate(1.0); // Use the base setter
      },
      // <<< FIX FOR PIP RESTORATION: Pass the handler to the player
      onRestoreUserInterfaceForPictureInPicture: handleRestorePIP,
      // >>> END OF PIP RESTORATION PROP
      videoRef: playerRef,
      rate: finalPlaybackRate, // Use the final calculated rate
      poster: route.params?.poster?.logo || '',
      subtitleStyle: {
        fontSize: settingsStorage.getSubtitleFontSize() || 16,
        opacity: settingsStorage.getSubtitleOpacity() || 1,
        paddingBottom: settingsStorage.getSubtitleBottomPadding() || 10,
        subtitlesFollowVideo: false,
      },
      title: {
        primary:
          route.params?.primaryTitle && route.params?.primaryTitle?.length > 70
            ? route.params?.primaryTitle.slice(0, 70) + '...'
            : route.params?.primaryTitle || '',
        secondary: activeEpisode?.title,
      },
      navigator: navigation,
      seekColor: primary,
      showDuration: true,
      toggleResizeModeOnFullscreen: false,
      fullscreenOrientation: 'landscape' as const,
      fullscreenAutorotate: true,
      onShowControls: () => setShowControls(true),
      onHideControls: () => setShowControls(false),
      rewindTime: 10,
      isFullscreen: true,
      disableFullscreen: true,
      disableVolume: true,
      showHours: true,
      progressUpdateInterval: 1000,
      showNotificationControls: showMediaControls,
      onError: handleVideoError,
      resizeMode,
      selectedAudioTrack,
      onAudioTracks: (e: any) => processAudioTracks(e.audioTracks),
      selectedTextTrack,
      onTextTracks: (e: any) => setTextTracks(e.textTracks),
      onVideoTracks: (e: any) => processVideoTracks(e.videoTracks),
      selectedVideoTrack,
      style: {flex: 1, zIndex: 100},
      controlAnimationTiming: 357,
      controlTimeoutDelay: 10000,
      hideAllControlls: isPlayerLocked,
    }),
    [
      isPlayerLocked,
      enableSwipeGesture,
      hideSeekButtons,
      externalSubs,
      selectedStream,
      route.params,
      activeEpisode,
      handleProgress,
      watchedDuration,
      finalPlaybackRate,
      setBasePlaybackRate,
      primary,
      navigation,
      setShowControls,
      showMediaControls,
      handleVideoError,
      resizeMode,
      selectedAudioTrack,
      selectedTextTrack,
      selectedVideoTrack,
      processAudioTracks,
      processVideoTracks,
      handleRestorePIP,
    ],
  );

  // Show loading state
  if (streamLoading) {
    return (
      <SafeAreaView
        edges={{right: 'off', top: 'off', left: 'off', bottom: 'off'}}
        className="bg-black flex-1 justify-center items-center">
        <StatusBar translucent={true} hidden={true} />
        <OrientationLocker orientation={LANDSCAPE} />
        {/* create ripple effect */}
        <TouchableNativeFeedback
          background={TouchableNativeFeedback.Ripple(
            'rgba(255,255,255,0.15)',
            false, // ripple shows at tap location
          )}>
          <View className="w-full h-full justify-center items-center">
            <Animated.View
              style={[loadingContainerStyle]}
              className="justify-center items-center">
              <Animated.View style={[loadingIconStyle]} className="mb-2">
                <MaterialIcons name="hourglass-empty" size={60} color="white" />
              </Animated.View>
              <Text className="text-white text-lg mt-4">Loading stream...</Text>
            </Animated.View>
          </View>
        </TouchableNativeFeedback>
      </SafeAreaView>
    );
  }

  // Show error state
  if (streamError) {
    return (
      <SafeAreaView className="bg-black flex-1 justify-center items-center">
        <StatusBar translucent={true} hidden={true} />
        <OrientationLocker orientation={LANDSCAPE} />
        <Text className="text-red-500 text-lg text-center mb-4">
          Failed to load stream. Please try again.
        </Text>
        <TouchableOpacity
          className="bg-red-600 px-4 py-2 rounded-md"
          onPress={() => navigation.goBack()}>
          <Text className="text-white">Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={{
        right: 'off',
        top: 'off',
        left: 'off',
        bottom: 'off',
      }}
      className="bg-black flex-1 relative">
      <StatusBar translucent={true} hidden={true} />
      <OrientationLocker orientation={LANDSCAPE} />

      {/* Main touch area for fast-forward gesture */}
      {/* This view now correctly uses onTouchMove to cancel the long-press timer if movement (swipe/scroll) is detected. */}
      <View
        className="flex-1"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove} // <<< CRITICAL FIX: Added onTouchMove
        onTouchEnd={handleTouchEnd}>
        {/* NEW WRAPPER: This TouchableOpacity is placed directly over the VideoPlayer. */}
        {/* It captures all touches meant for the player area (including volume/brightness gestures) */}
        {/* and PREVENTS them from bubbling up to the main View, solving the unintended FF issue. */}
        <TouchableOpacity
          activeOpacity={1}
          className="flex-1"
          // CRITICAL FIX: Stop the touch events from the VideoPlayer area from bubbling up
          // to the parent View (which has the handleTouchStart/End logic).
          onTouchStart={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()} // Added stopPropagation for move events too
          onTouchEnd={e => e.stopPropagation()}>
          {/* <<< FIX FOR PIP RESTORATION: Conditionally render with key to force layout reset */}
          {showPlayer && (
            <VideoPlayer key={keyForPlayer} {...videoPlayerProps} />
          )}
          {/* >>> END OF PIP RESTORATION RENDER */}
        </TouchableOpacity>

        {/* Full-screen overlay to detect taps when locked */}
        {isPlayerLocked && (
          <TouchableOpacity
            activeOpacity={1}
            onPress={handleLockedScreenTap}
            className="absolute top-0 left-0 right-0 bottom-0 z-40 bg-transparent"
          />
        )}

        {/* Lock/Unlock button */}
        {!streamLoading && !Platform.isTV && (
          <Animated.View
            style={[lockButtonStyle]}
            className="absolute top-5 right-5 flex-row items-center gap-2 z-50">
            <TouchableOpacity
              onPress={togglePlayerLock}
              className="opacity-70 p-2 rounded-full">
              <MaterialIcons
                name={isPlayerLocked ? 'lock' : 'lock-open'}
                color={'hsl(0, 0%, 70%)'}
                size={24}
              />
            </TouchableOpacity>
            {/* {!isPlayerLocked && (
              <CastButton
                style={{width: 40, height: 40, opacity: 0.5, tintColor: 'white'}}
              />
            )} */}
          </Animated.View>
        )}

        {/* Bottom controls */}
        {!isPlayerLocked && (
          <Animated.View
            style={[controlsStyle]}
            className="absolute bottom-3 right-6 flex flex-row justify-center w-full gap-x-12">
            {/* Audio controls */}
            <TouchableOpacity
              onPress={() => {
                setActiveTab('audio');
                setShowSettings(!showSettings);
              }}
              className="flex flex-row gap-2 items-center">
              <MaterialIcons
                style={{opacity: 0.7}}
                name={'multitrack-audio'}
                size={26}
                color="white"
              />
              <Text className="capitalize text-xs text-white opacity-70">
                {audioTracks[selectedAudioTrackIndex]?.language || 'auto'}
              </Text>
            </TouchableOpacity>

            {/* Subtitle controls */}
            <TouchableOpacity
              onPress={() => {
                setActiveTab('subtitle');
                setShowSettings(!showSettings);
              }}
              className="flex flex-row gap-2 items-center">
              <MaterialIcons
                style={{opacity: 0.6}}
                name={'subtitles'}
                size={24}
                color="white"
              />
              <Text className="text-xs capitalize text-white opacity-70">
                {selectedTextTrackIndex === 1000
                  ? 'none'
                  : textTracks[selectedTextTrackIndex]?.language}
              </Text>
            </TouchableOpacity>

            {/* Speed controls (Base Rate) */}
            <TouchableOpacity
              className="flex-row gap-1 items-center opacity-60"
              onPress={() => {
                setActiveTab('speed');
                setShowSettings(!showSettings);
              }}>
              <MaterialIcons name="speed" size={26} color="white" />
              <Text className="text-white text-sm">
                {basePlaybackRate === 1 ? '1.0' : basePlaybackRate}
              </Text>
            </TouchableOpacity>

            {/* Fast Forward Speed Setting Button */}
            <TouchableOpacity
              className="flex-row gap-1 items-center opacity-60"
              onPress={() => {
                setActiveTab('fastForward');
                setShowSettings(!showSettings);
              }}>
              <MaterialIcons name="fast-forward" size={25} color="white" />
              <Text className="text-xs text-white capitalize">
                ({fastForwardRate.toFixed(1)}x)
              </Text>
            </TouchableOpacity>

            {/* PIP */}
            {!Platform.isTV && (
              <TouchableOpacity
                className="flex-row gap-1 items-center opacity-60"
                onPress={() => {
                  playerRef?.current?.enterPictureInPicture();
                }}>
                <MaterialIcons
                  name="picture-in-picture"
                  size={24}
                  color="white"
                />
                <Text className="text-white text-xs">PIP</Text>
              </TouchableOpacity>
            )}

            {/* Server & Quality */}
            <TouchableOpacity
              className="flex-row gap-1 items-center opacity-60"
              onPress={() => {
                setActiveTab('server');
                setShowSettings(!showSettings);
              }}>
              <MaterialIcons name="video-settings" size={25} color="white" />
              <Text className="text-xs text-white capitalize">
                {videoTracks?.length === 1
                  ? formatQuality(videoTracks[0]?.height?.toString() || 'auto')
                  : formatQuality(
                      videoTracks?.[selectedQualityIndex]?.height?.toString() ||
                        'auto',
                    )}
              </Text>
            </TouchableOpacity>

            {/* Resize button */}
            <TouchableOpacity
              className="flex-row gap-1 items-center opacity-60"
              onPress={handleResizeMode}>
              <MaterialIcons name="fit-screen" size={28} color="white" />
              <Text className="text-white text-sm min-w-[38px]">
                {resizeMode === ResizeMode.NONE
                  ? 'Fit'
                  : resizeMode === ResizeMode.COVER
                  ? 'Cover'
                  : resizeMode === ResizeMode.STRETCH
                  ? 'Stretch'
                  : 'Contain'}
              </Text>
            </TouchableOpacity>

            {/* Next episode button */}
            {route.params?.episodeList?.indexOf(activeEpisode) <
              route.params?.episodeList?.length - 1 &&
              videoPositionRef.current.position /
                videoPositionRef.current.duration >
                0.7 &&
              videoPositionRef.current.position /
                videoPositionRef.current.duration <
                0.9 && (
                <TouchableOpacity
                  className="flex-row items-center opacity-60"
                  onPress={handleNextEpisode}>
                  <Text className="text-white text-base">Next</Text>
                  <MaterialIcons name="skip-next" size={28} color="white" />
                </TouchableOpacity>
              )}
          </Animated.View>
        )}
      </View>

      {/* Toast message (used for fast-forward notification) */}
      <Animated.View
        style={[toastStyle]}
        pointerEvents="none"
        className="absolute w-full top-12 justify-center items-center px-2 z-50">
        <Text className="text-white bg-black/70 p-2 rounded-full text-base font-semibold">
          {toastMessage}
        </Text>
      </Animated.View>

      {/* Settings Modal */}
      {!streamLoading && !isPlayerLocked && showSettings && (
        <Animated.View
          style={[settingsStyle]}
          className="absolute opacity-0 top-0 left-0 w-full h-full bg-black/20 justify-end items-center"
          onTouchEnd={() => setShowSettings(false)}>
          <View
            className="bg-black p-3 w-[600px] h-72 rounded-t-lg flex-row justify-start items-center"
            onTouchEnd={e => e.stopPropagation()}>
            {/* Audio Tab */}
            {activeTab === 'audio' && (
              <ScrollView className="w-full h-full p-1 px-4">
                <Text className="text-lg font-bold text-center text-white">
                  Audio
                </Text>
                {audioTracks.length === 0 && (
                  <View className="flex justify-center items-center">
                    <Text className="text-white text-xs">
                      Loading audio tracks...
                    </Text>
                  </View>
                )}
                {audioTracks.map((track, i) => (
                  <TouchableOpacity
                    className="flex-row gap-2 items-center rounded-md my-1 overflow-hidden ml-2"
                    key={i}
                    onPress={() => {
                      setSelectedAudioTrack({
                        type: SelectedTrackType.LANGUAGE,
                        value: track.language,
                      });
                      cacheStorage.setString(
                        'lastAudioTrack',
                        track.language || '',
                      );
                      setSelectedAudioTrackIndex(i);
                      setShowSettings(false);
                    }}>
                    <Text
                      className={'text-lg font-semibold'}
                      style={{
                        color:
                          selectedAudioTrackIndex === i ? primary : 'white',
                      }}>
                      {track.language}
                    </Text>
                    <Text
                      className={'text-base italic'}
                      style={{
                        color:
                          selectedAudioTrackIndex === i ? primary : 'white',
                      }}>
                      {track.type}
                    </Text>
                    <Text
                      className={'text-sm italic'}
                      style={{
                        color:
                          selectedAudioTrackIndex === i ? primary : 'white',
                      }}>
                      {track.title}
                    </Text>
                    {selectedAudioTrackIndex === i && (
                      <MaterialIcons name="check" size={20} color="white" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Subtitle Tab - FIX: Replaced FlashList with ScrollView to fix Invariant Violation */}
            {activeTab === 'subtitle' && (
              <ScrollView className="w-full h-full p-1 px-4">
                <Text className="text-lg font-bold text-center text-white">
                  Subtitle
                </Text>
                <TouchableOpacity
                  className="flex-row gap-2 items-center rounded-md my-1 overflow-hidden ml-3"
                  onPress={() => {
                    setSelectedTextTrack({
                      type: SelectedTrackType.DISABLED,
                    });
                    setSelectedTextTrackIndex(1000);
                    cacheStorage.setString('lastTextTrack', '');
                    setShowSettings(false);
                  }}>
                  <Text
                    className="text-base font-semibold"
                    style={{
                      color:
                        selectedTextTrackIndex === 1000 ? primary : 'white',
                    }}>
                    Disabled
                  </Text>
                </TouchableOpacity>

                {textTracks.map(track => (
                  <TouchableOpacity
                    className="flex-row gap-2 items-center rounded-md my-1 overflow-hidden ml-2"
                    key={track.index}
                    onPress={() => {
                      setSelectedTextTrack({
                        type: SelectedTrackType.INDEX,
                        value: track.index,
                      });
                      setSelectedTextTrackIndex(track.index);
                      cacheStorage.setString(
                        'lastTextTrack',
                        track.language || '',
                      );
                      setShowSettings(false);
                    }}>
                    <Text
                      className={'text-base font-semibold'}
                      style={{
                        color:
                          selectedTextTrackIndex === track.index
                            ? primary
                            : 'white',
                      }}>
                      {track.language}
                    </Text>
                    <Text
                      className={'text-sm italic'}
                      style={{
                        color:
                          selectedTextTrackIndex === track.index
                            ? primary
                            : 'white',
                      }}>
                      {track.type}
                    </Text>
                    <Text
                      className={'text-sm italic text-white'}
                      style={{
                        color:
                          selectedTextTrackIndex === track.index
                            ? primary
                            : 'white',
                      }}>
                      {track.title}
                    </Text>
                    {selectedTextTrackIndex === track.index && (
                      <MaterialIcons name="check" size={20} color="white" />
                    )}
                  </TouchableOpacity>
                ))}

                {/* External Subtitle controls (kept outside the map) */}
                <TouchableOpacity
                  className="flex-row gap-2 items-center rounded-md my-1 overflow-hidden ml-2"
                  onPress={async () => {
                    try {
                      const res = await DocumentPicker.getDocumentAsync({
                        type: [
                          'text/vtt',
                          'application/x-subrip',
                          'text/srt',
                          'application/ttml+xml',
                        ],
                        multiple: false,
                      });

                      if (!res.canceled && res.assets?.[0]) {
                        const asset = res.assets[0];
                        const track = {
                          type: asset.mimeType as any,
                          title:
                            asset.name && asset.name.length > 20
                              ? asset.name.slice(0, 20) + '...'
                              : asset.name || 'undefined',
                          language: 'und',
                          uri: asset.uri,
                        };
                        setExternalSubs((prev: any) => [track, ...prev]);
                      }
                    } catch (err) {
                      console.log(err);
                    }
                  }}>
                  <MaterialIcons name="add" size={20} color="white" />
                  <Text className="text-base font-semibold text-white">
                    Add external file
                  </Text>
                </TouchableOpacity>
                <SearchSubtitles
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  setExternalSubs={setExternalSubs}
                />
              </ScrollView>
            )}

            {/* Server Tab */}
            {activeTab === 'server' && (
              <View className="flex flex-row w-full h-full p-1 px-4">
                <ScrollView className="border-r border-white/50">
                  <Text className="w-full text-center text-white text-lg font-extrabold">
                    Server
                  </Text>
                  {streamData?.length > 0 &&
                    streamData?.map((track, i) => (
                      <TouchableOpacity
                        className="flex-row gap-2 items-center rounded-md my-1 overflow-hidden ml-2"
                        key={i}
                        onPress={() => {
                          setSelectedStream(track);
                          setShowSettings(false);
                          playerRef?.current?.resume();
                        }}>
                        <Text
                          className={'text-base capitalize font-semibold'}
                          style={{
                            color:
                              track.link === selectedStream.link
                                ? primary
                                : 'white',
                          }}>
                          {track.server}
                        </Text>
                        {track.link === selectedStream.link && (
                          <MaterialIcons name="check" size={20} color="white" />
                        )}
                      </TouchableOpacity>
                    ))}
                </ScrollView>

                <ScrollView>
                  <Text className="w-full text-center text-white text-lg font-extrabold">
                    Quality
                  </Text>
                  {videoTracks &&
                    videoTracks.map((track: any, i: any) => (
                      <TouchableOpacity
                        className="flex-row gap-2 items-center rounded-md my-1 overflow-hidden ml-2"
                        key={i}
                        onPress={() => {
                          setSelectedVideoTrack({
                            type: SelectedVideoTrackType.INDEX,
                            value: track.index,
                          });
                          setSelectedQualityIndex(i);
                        }}>
                        <Text
                          className={'text-base font-semibold'}
                          style={{
                            color:
                              selectedQualityIndex === i ? primary : 'white',
                          }}>
                          {track.height + 'p'}
                        </Text>
                        <Text
                          className={'text-sm italic'}
                          style={{
                            color:
                              selectedQualityIndex === i ? primary : 'white',
                          }}>
                          {'Bitrate-' +
                            track.bitrate +
                            ' | Codec-' +
                            (track?.codecs || 'unknown')}
                        </Text>
                        {selectedQualityIndex === i && (
                          <MaterialIcons name="check" size={20} color="white" />
                        )}
                      </TouchableOpacity>
                    ))}
                </ScrollView>
              </View>
            )}

            {/* Speed Tab (Base Rate) */}
            {activeTab === 'speed' && (
              <ScrollView className="w-full h-full p-1 px-4">
                <Text className="text-lg font-bold text-center text-white">
                  Playback Speed
                </Text>
                {playbacks.map((rate, i) => (
                  <TouchableOpacity
                    className="flex-row gap-2 items-center rounded-md my-1 overflow-hidden ml-2"
                    key={i}
                    onPress={() => {
                      setBasePlaybackRate(rate);
                      setShowSettings(false);
                    }}>
                    <Text
                      className={'text-lg font-semibold'}
                      style={{
                        color: basePlaybackRate === rate ? primary : 'white',
                      }}>
                      {rate}x
                    </Text>
                    {basePlaybackRate === rate && (
                      <MaterialIcons name="check" size={20} color="white" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Fast Forward Speed Tab */}
            {activeTab === 'fastForward' && (
              <ScrollView className="w-full h-full p-1 px-4">
                <Text className="text-lg font-bold text-center text-white">
                  Fast Forward Speed
                </Text>
                {MOCK_FAST_FORWARD_RATES.map((rate, i) => (
                  <TouchableOpacity
                    className="flex-row gap-2 items-center rounded-md my-1 overflow-hidden ml-2"
                    key={i}
                    onPress={() => {
                      // FIX: Only update local state to avoid storage error
                      setLocalFastForwardRate(rate);
                      setShowSettings(false);
                    }}>
                    <Text
                      className={'text-lg font-semibold'}
                      style={{
                        color: fastForwardRate === rate ? primary : 'white',
                      }}>
                      {rate}x
                    </Text>
                    {fastForwardRate === rate && (
                      <MaterialIcons name="check" size={20} color="white" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
};

export default Player;
