import {
  View,
  Text,
  Linking,
  TouchableOpacity,
  TouchableNativeFeedback,
  ScrollView,
  Dimensions,
  Switch,
  TextInput,
  Clipboard,
  ToastAndroid,
} from 'react-native';
import React, {useCallback, useMemo, useEffect, useState} from 'react';
import {
  settingsStorage,
  cacheStorageService,
  ProviderExtension,
} from '../../lib/storage';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import useContentStore from '../../lib/zustand/contentStore';
import {
  NativeStackScreenProps,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import {
  SettingsStackParamList,
  TabStackParamList,
  RootStackParamList,
} from '../../App';
import {
  MaterialCommunityIcons,
  AntDesign,
  Feather,
  MaterialIcons,
} from '@expo/vector-icons';
import useThemeStore from '../../lib/zustand/themeStore';
import useWatchHistoryStore from '../../lib/zustand/watchHistrory';
import Animated, {FadeInDown, FadeInUp, Layout} from 'react-native-reanimated';
import {useNavigation} from '@react-navigation/native';
import {check, request, PERMISSIONS, RESULTS} from 'react-native-permissions';

import RenderProviderFlagIcon from '../../components/RenderProviderFLagIcon';
import useAppModeStore from '../../lib/zustand/appModeStore';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

// Notification permission component (kept for completeness)
const NotificationPrompt = () => {
  const [permissionStatus, setPermissionStatus] = useState<RESULTS | null>(
    null,
  );
  const {primary} = useThemeStore(state => state);

  useEffect(() => {
    const getPermissionStatus = async () => {
      const status = await check(PERMISSIONS.ANDROID.POST_NOTIFICATIONS);
      setPermissionStatus(status);
    };
    getPermissionStatus();
  }, []);

  const requestPermission = async () => {
    const result = await request(PERMISSIONS.ANDROID.POST_NOTIFICATIONS);
    setPermissionStatus(result);
    if (result !== RESULTS.GRANTED) {
      Linking.openSettings();
    }
  };

  if (permissionStatus === RESULTS.GRANTED || permissionStatus === null) {
    return null; // Don't show anything if permission is granted or not yet checked
  }

  return (
    <View
      className="bg-[#1A1A1A] rounded-xl overflow-hidden mb-3"
      style={{
        marginHorizontal: 20,
      }}>
      <TouchableNativeFeedback
        onPress={requestPermission}
        background={TouchableNativeFeedback.Ripple('#333333', false)}>
        <View className="flex-row items-center justify-between p-4">
          <View className="flex-row items-center">
            <MaterialIcons
              name="notifications-none"
              size={22}
              color={primary}
            />
            <View className="flex-col ml-3">
              <Text className="text-white text-base">Enable Notifications</Text>
              <Text className="text-gray-400 text-xs">
                Receive updates on new content and announcements.
              </Text>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color="gray" />
        </View>
      </TouchableNativeFeedback>
    </View>
  );
};

// --- WATCH TOGETHER PERSISTENCE (Matches Player.tsx KEY) ---
const KEY_WATCH_TOGETHER = 'watchTogetherMode';

const getWatchTogetherMode = () => {
  // Uses cacheStorageService, as cacheStorage is likely an instance of cacheStorageService
  const modeStr = cacheStorageService.getString(KEY_WATCH_TOGETHER);
  return modeStr === 'true' ? true : false;
};

const setWatchTogetherModeStorage = (mode: boolean) => {
  cacheStorageService.setString(KEY_WATCH_TOGETHER, String(mode));
};
// -----------------------------------------------------------

// Helper for Internal Navigation (Chevron icon)
type IconElement = React.ReactElement<{
  size?: number;
  color?: string;
  name: string;
}>;

const InternalOptionRow = React.memo(
  ({
    icon,
    text,
    onPress,
    primaryColor,
    isLast = false,
  }: {
    icon: IconElement;
    text: string;
    onPress: () => void;
    primaryColor: string;
    isLast?: boolean;
  }) => (
    <TouchableNativeFeedback
      onPress={onPress}
      background={TouchableNativeFeedback.Ripple('#333333', false)}>
      <View
        className={`flex-row items-center justify-between p-4 ${
          !isLast ? 'border-b border-[#262626]' : ''
        }`}>
        <View className="flex-row items-center">
          {React.cloneElement(icon, {size: 22, color: primaryColor})}
          <Text className="text-white ml-3 text-base">{text}</Text>
        </View>
        <Feather name="chevron-right" size={20} color="gray" />
      </View>
    </TouchableNativeFeedback>
  ),
);

// Helper for External Links (External-link icon)
const ExternalLinkRow = React.memo(
  ({
    icon,
    text,
    url,
    iconColor,
    isLast = false,
  }: {
    icon: IconElement;
    text: string;
    url: string;
    iconColor: string;
    isLast?: boolean;
  }) => (
    <TouchableNativeFeedback
      onPress={() => Linking.openURL(url)}
      background={TouchableNativeFeedback.Ripple('#333333', false)}>
      <View
        className={`flex-row items-center justify-between p-4 ${
          !isLast ? 'border-b border-[#262626]' : ''
        }`}>
        <View className="flex-row items-center">
          {React.cloneElement(icon, {size: 22, color: iconColor})}
          <Text className="text-white ml-3 text-base">{text}</Text>
        </View>
        <Feather name="external-link" size={20} color="gray" />
      </View>
    </TouchableNativeFeedback>
  ),
);

const Settings = ({navigation}: Props) => {
  const tabNavigation =
    useNavigation<NativeStackNavigationProp<TabStackParamList>>();
  const rootNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>(); // For navigating to Player
  const {primary} = useThemeStore(state => state);
  const {provider, setProvider, installedProviders} = useContentStore(
    state => state,
  );
  const {clearHistory} = useWatchHistoryStore(state => state);
  const {appMode, setAppMode} = useAppModeStore(state => state);

  // --- NEW WATCH TOGETHER STATES ---
  const [watchTogetherMode, setWatchTogetherMode] = useState(
    getWatchTogetherMode(),
  );
  const [syncLink, setSyncLink] = useState(''); // State for the link input
  // ---------------------------------

  const handleProviderSelect = useCallback(
    (item: ProviderExtension) => {
      setProvider(item);
      setAppMode('video');
      if (settingsStorage.isHapticFeedbackEnabled()) {
        ReactNativeHapticFeedback.trigger('virtualKey', {
          enableVibrateFallback: true,
          ignoreAndroidSystemSettings: false,
        });
      }
      tabNavigation.navigate('HomeStack');
    },
    [setProvider, tabNavigation, setAppMode],
  );

  const renderProviderItem = useCallback(
    (item: ProviderExtension, isSelected: boolean) => (
      <TouchableOpacity
        key={item.value}
        onPress={() => handleProviderSelect(item)}
        className={`mr-3 rounded-lg ${
          isSelected ? 'bg-[#333333]' : 'bg-[#262626]'
        }`}
        style={{
          width: Dimensions.get('window').width * 0.3,
          height: 65,
          borderWidth: 1.5,
          borderColor: isSelected ? primary : '#333333',
        }}>
        <View className="flex-col items-center justify-center h-full p-2">
          <RenderProviderFlagIcon type={item.type} />
          <Text
            numberOfLines={1}
            className="text-white text-xs font-medium text-center mt-2">
            {item.display_name}
          </Text>
          {isSelected && (
            <Text style={{position: 'absolute', top: 6, right: 6}}>
              <MaterialIcons name="check-circle" size={16} color={primary} />
            </Text>
          )}
        </View>
      </TouchableOpacity>
    ),
    [handleProviderSelect, primary],
  );

  const providersList = useMemo(
    () =>
      installedProviders.map(item =>
        renderProviderItem(item, provider.value === item.value),
      ),
    [installedProviders, provider.value, renderProviderItem],
  );

  const clearCacheHandler = useCallback(() => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('virtualKey', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    cacheStorageService.clearAll();
  }, []);

  const clearHistoryHandler = useCallback(() => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('virtualKey', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    clearHistory();
  }, [clearHistory]);

  // --- NEW WATCH TOGETHER HANDLERS ---
  const toggleWatchTogether = useCallback(() => {
    const newState = !watchTogetherMode;
    setWatchTogetherMode(newState);
    setWatchTogetherModeStorage(newState);

    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('virtualKey', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
  }, [watchTogetherMode]);

  const parseSyncLink = (link: string) => {
    // FIX: Updated regex to allow any character that is NOT '&' or a newline,
    // ensuring the entire content URL is captured for video_id.
    const videoIdMatch = link.match(/video_id=([^&\n]+)/i);
    const timeMatch = link.match(/time=(\d+)/i);

    const videoId = videoIdMatch ? videoIdMatch[1] : null;
    const time = timeMatch ? parseInt(timeMatch[1], 10) : null;

    if (videoId && time !== null) {
      return {
        videoId: videoId,
        time: time,
      };
    }
    return null;
  };

  const handleJoinSession = useCallback(() => {
    const linkToJoin = syncLink.trim();
    if (!linkToJoin) {
      ToastAndroid.show(
        'Please paste a sync link to join.',
        ToastAndroid.SHORT,
      );
      return;
    }

    // ⭐ CRITICAL FIX: Ensure a provider is selected before attempting to join a session.
    if (!provider || !provider.value) {
      ToastAndroid.show(
        'Please select a Content Provider before joining a session.',
        ToastAndroid.LONG,
      );
      return;
    }

    const parsedData = parseSyncLink(linkToJoin);

    if (parsedData) {
      // ✅ FIX: Mock necessary player parameters for navigation, including the provider,
      // and ensure a more complete item structure to prevent deep-nested crashes.
      const mockPlayerParams = {
        // 'id' is often the unique ID for the video entry.
        id: parsedData.videoId,
        primaryTitle: 'Watch Together Session',
        // ⭐ CRASH FIX: Player screen often expects 'title' as a primary property.
        title: 'Watch Together Session', // <--- ADDED FIX
        // 'link' is the source URL for the stream.
        link: parsedData.videoId,
        poster: {logo: 'mock_poster_url'},
        linkIndex: 0,
        episodeList: [{link: parsedData.videoId, title: 'Synchronized Video'}],

        // **CRITICAL FIX**: Pass the required provider object.
        // Explicitly create a ProviderExtension object to ensure all expected properties are present.
        provider: {
          value: provider.value,
          type: provider.type,
          display_name: provider.display_name,
          icon: provider.icon,
        } as ProviderExtension,

        // **POTENTIAL CRASH FIX**: Add other properties the Player might expect, if any.
        // Assuming 'Player' expects a 'type' (Movie/TV) on the item being passed.
        type: 'Movie', // Use a default type, adjust based on your Player's expectation

        // Crucial Watch Together parameters:
        initialSeekTime: parsedData.time,
        syncLink: linkToJoin,
      };

      try {
        // Navigate to Player, casting the parameters to bypass local type checks
        rootNavigation.navigate(
          'Player' as never, // Assuming 'Player' is the key in RootStackParamList
          mockPlayerParams as never,
        );

        // Clear the link input after successful attempt
        setSyncLink('');
        ToastAndroid.show(
          `Joining session for video... at ${parsedData.time}s`,
          ToastAndroid.LONG,
        );
      } catch (error) {
        // Added a catch block to log and display any navigation error
        console.error('Navigation Crash Error:', error);
        ToastAndroid.show(
          'Failed to join session. Check console for specific error details.',
          ToastAndroid.LONG,
        );
      }
    } else {
      ToastAndroid.show(
        'Invalid sync link format. Expected: vegaNext://watch/video_id=...&time=...',
        ToastAndroid.LONG,
      );
    }
  }, [syncLink, rootNavigation, provider]);

  const handlePasteLink = useCallback(async () => {
    try {
      const text = await Clipboard.getString();
      // FIX: Check for the new parameters
      if (text && text.includes('video_id=') && text.includes('time=')) {
        setSyncLink(text);
        ToastAndroid.show(
          `Pasted link: ${text.substring(0, 30)}...`,
          ToastAndroid.SHORT,
        );
      } else {
        ToastAndroid.show(
          'No valid sync link (vegaNext://watch/video_id=...&time=...) found in clipboard.',
          ToastAndroid.SHORT,
        );
      }
    } catch (error) {
      ToastAndroid.show('Failed to read from clipboard.', ToastAndroid.SHORT);
    }
  }, []);
  // -----------------------------------

  const AnimatedSection = ({
    delay,
    children,
  }: {
    delay: number;
    children: React.ReactNode;
  }) => (
    <Animated.View
      entering={FadeInDown.delay(delay).springify()}
      layout={Layout.springify()}>
      {children}
    </Animated.View>
  );

  return (
    <Animated.ScrollView
      className="w-full h-full bg-black"
      showsVerticalScrollIndicator={false}
      bounces={true}
      overScrollMode="always"
      entering={FadeInUp.springify()}
      layout={Layout.springify()}
      contentContainerStyle={{
        paddingTop: 15,
        paddingBottom: 24,
        flexGrow: 1,
      }}>
      <View className="p-5">
        <Animated.View entering={FadeInUp.springify()}>
          <Text className="text-2xl font-bold text-white mb-6">Settings</Text>
        </Animated.View>

        {/* App Mode Section (delay 50) */}
        <AnimatedSection delay={50}>
          <View className="mb-6 flex-col gap-3">
            <Text className="text-gray-400 text-sm mb-1">App Mode</Text>
            <View className="bg-[#1A1A1A] rounded-xl overflow-hidden">
              {/* Vega-TV Mode Switch */}
              <View className="flex-row items-center justify-between p-4">
                <View className="flex-row items-center">
                  <MaterialCommunityIcons
                    name="television-play"
                    size={22}
                    color={primary}
                  />
                  <Text className="text-white ml-3 text-base">
                    Vega-TV Mode
                  </Text>
                </View>
                <Switch
                  trackColor={{false: '#767577', true: primary}}
                  thumbColor={appMode === 'vegaTv' ? '#f4f3f4' : '#f4f3f4'}
                  ios_backgroundColor="#3e3e3e"
                  onValueChange={() => {
                    setAppMode('vegaTv');
                    if (settingsStorage.isHapticFeedbackEnabled()) {
                      ReactNativeHapticFeedback.trigger('impactLight', {
                        enableVibrateFallback: true,
                        ignoreAndroidSystemSettings: false,
                      });
                    }
                    tabNavigation.navigate('VegaTVStack');
                  }}
                  value={appMode === 'vegaTv'}
                />
              </View>
            </View>
          </View>
        </AnimatedSection>

        {/* Notification Section (delay 100) */}
        <AnimatedSection delay={100}>
          <Text className="text-gray-400 text-sm mb-3 ml-5">Notifications</Text>
          <NotificationPrompt />
        </AnimatedSection>

        {/* Content provider section (only visible in video mode) (delay 150) */}
        {appMode === 'video' && (
          <AnimatedSection delay={150}>
            <View className="mb-6 flex-col gap-3">
              <Text className="text-gray-400 text-sm mb-1">
                Content Provider
              </Text>
              <View className="bg-[#1A1A1A] rounded-xl py-4">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: 10,
                  }}>
                  {providersList}
                  {installedProviders.length === 0 && (
                    <Text className="text-gray-500 text-sm">
                      No providers installed
                    </Text>
                  )}
                </ScrollView>
              </View>
              {/* Extensions */}
              <View className="bg-[#1A1A1A] rounded-xl overflow-hidden mb-3">
                <InternalOptionRow
                  icon={<MaterialCommunityIcons name="puzzle" />}
                  text="Provider Manager"
                  onPress={() => navigation.navigate('Extensions')}
                  primaryColor={primary}
                  isLast={true}
                />
              </View>
            </View>
          </AnimatedSection>
        )}

        {/* Watch Together Section (NEW) (delay 200) */}
        <AnimatedSection delay={200}>
          <View className="mb-6 flex-col gap-3">
            <Text className="text-gray-400 text-sm mb-1">Watch Together</Text>
            <View className="bg-[#1A1A1A] rounded-xl overflow-hidden">
              {/* Watch Together Mode Switch */}
              <View className="flex-row items-center justify-between p-4 border-b border-[#262626]">
                <View className="flex-row items-center">
                  <MaterialIcons name="group" size={22} color={primary} />
                  <Text className="text-white ml-3 text-base">
                    Enable Watch Together Mode
                  </Text>
                </View>
                <Switch
                  trackColor={{false: '#767577', true: primary}}
                  thumbColor={watchTogetherMode ? '#f4f3f4' : '#f4f3f4'}
                  ios_backgroundColor="#3e3e3e"
                  onValueChange={toggleWatchTogether}
                  value={watchTogetherMode}
                />
              </View>

              {/* Join Session Input/Button (Conditional) */}
              {watchTogetherMode && (
                <View className="flex-col p-4">
                  <Text className="text-gray-400 text-sm mb-2">
                    Paste Sync Link to Join
                  </Text>
                  <View className="flex-row items-center">
                    <TextInput
                      className="flex-1 bg-white/10 text-white rounded-l-md p-2 h-10"
                      // FIX: Updated placeholder to match the generated link format
                      placeholder="e.g., app://watch/video_id=...&time=..."
                      placeholderTextColor="#9CA3AF"
                      value={syncLink}
                      onChangeText={setSyncLink}
                    />
                    <TouchableOpacity
                      className="bg-gray-500 p-2 h-10 justify-center items-center"
                      onPress={handlePasteLink}>
                      <MaterialIcons
                        name="content-paste"
                        size={20}
                        color="white"
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="bg-blue-600 rounded-r-md p-2 h-10 justify-center items-center"
                      onPress={handleJoinSession}>
                      <Text className="text-white font-semibold">Join</Text>
                    </TouchableOpacity>
                  </View>
                  <Text className="text-gray-500 text-xs mt-2">
                    Enabling this mode allows you to create and join
                    synchronized playback sessions.
                  </Text>
                </View>
              )}
            </View>
          </View>
        </AnimatedSection>
        {/* End Watch Together Section */}

        {/* Main options section (delay 250) */}
        <AnimatedSection delay={250}>
          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-3">Options</Text>
            <View className="bg-[#1A1A1A] rounded-xl overflow-hidden">
              {/* Downloads */}
              <InternalOptionRow
                icon={<MaterialCommunityIcons name="folder-download" />}
                text="Downloads"
                onPress={() => navigation.navigate('Downloads')}
                primaryColor={primary}
              />

              {/* Subtitle Style */}
              <InternalOptionRow
                icon={<MaterialCommunityIcons name="subtitles" />}
                text="Subtitle Style"
                onPress={() => navigation.navigate('SubTitlesPreferences')}
                primaryColor={primary}
              />

              {/* Watch History */}
              <InternalOptionRow
                icon={<MaterialCommunityIcons name="history" />}
                text="Watch History"
                onPress={() => navigation.navigate('WatchHistoryStack')}
                primaryColor={primary}
              />

              {/* Preferences */}
              <InternalOptionRow
                icon={<MaterialIcons name="room-preferences" />}
                text="Preferences"
                onPress={() => navigation.navigate('Preferences')}
                primaryColor={primary}
                isLast={true}
              />
            </View>
          </View>
        </AnimatedSection>

        {/* Data Management section (delay 350) */}
        <AnimatedSection delay={350}>
          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-3">Data Management</Text>
            <View className="bg-[#1A1A1A] rounded-xl overflow-hidden">
              {/* Clear Cache */}
              <View className="flex-row items-center justify-between p-4 border-b border-[#262626]">
                <Text className="text-white text-base">Clear Cache</Text>
                <TouchableOpacity
                  className="bg-[#262626] px-4 py-2 rounded-lg"
                  onPress={clearCacheHandler}>
                  <MaterialCommunityIcons
                    name="delete-outline"
                    size={20}
                    color={primary}
                  />
                </TouchableOpacity>
              </View>

              {/* Clear Watch History */}
              <View className="flex-row items-center justify-between p-4">
                <Text className="text-white text-base">
                  Clear Watch History
                </Text>
                <TouchableOpacity
                  className="bg-[#262626] px-4 py-2 rounded-lg"
                  onPress={clearHistoryHandler}>
                  <MaterialCommunityIcons
                    name="delete-outline"
                    size={20}
                    color={primary}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </AnimatedSection>

        {/* About & GitHub section (delay 450) */}
        <AnimatedSection delay={450}>
          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-3">About</Text>
            <View className="bg-[#1A1A1A] rounded-xl overflow-hidden">
              {/* About */}
              <InternalOptionRow
                icon={<Feather name="info" />}
                text="About"
                onPress={() => navigation.navigate('About')}
                primaryColor={primary}
              />

              {/* GitHub */}
              <ExternalLinkRow
                icon={<AntDesign name="github" />}
                text="Give a star ⭐"
                url="https://github.com/DHR-Store/Vega-Next"
                iconColor={primary}
              />

              {/* Error and Suggestions */}
              <ExternalLinkRow
                icon={<AntDesign name="info" />}
                text="Error and Suggestions"
                url="https://radio-nu-five.vercel.app/"
                iconColor={primary}
              />

              {/* Kreate */}
              <ExternalLinkRow
                icon={<Feather name="music" />}
                text="Kreate"
                url="https://kreate-that.vercel.app/"
                iconColor="white" // Keep original color
              />

              {/* sponsore */}
              <ExternalLinkRow
                icon={<AntDesign name="heart" />}
                text="Go to DHR-Store"
                url="https://dhr-store.vercel.app/"
                iconColor="#ff69b4" // Keep original color
                isLast={true}
              />
            </View>
          </View>
        </AnimatedSection>
      </View>
    </Animated.ScrollView>
  );
};

export default Settings;
